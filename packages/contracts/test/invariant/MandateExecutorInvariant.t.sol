// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {MandateExecutor} from "../../src/MandateExecutor.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MandateExecutorHandler, MandateGhost} from "./MandateExecutorHandler.sol";

/// @notice `P2-003`: the twelve safety invariants of `docs/technical/SMART-CONTRACT.md` §15
/// asserted over arbitrary orderings of configure, authorize, begin, perform, revoke,
/// expire, stall, replay, and time advance, with a hostile adapter, a hostile verifier,
/// and an attacker calling every entry point.
/// @dev Each invariant is checked after every call in a sequence, so the per-call bodies
/// stay O(1): the handler measures the mandate it touched and reports violations through
/// named counters. `afterInvariant` re-reads the full mandate set from the contract once
/// per run, so the aggregate claims never rest on the handler's bookkeeping alone.
contract MandateExecutorInvariantTest is Test {
    MandateExecutorHandler private handler;
    MandateExecutor private executor;
    MockERC20 private inputToken;
    MockERC20 private outputToken;

    function setUp() public {
        vm.warp(1_700_000_000);
        handler = new MandateExecutorHandler();
        executor = handler.executor();
        inputToken = handler.inputToken();
        outputToken = handler.outputToken();

        bytes4[] memory selectors = new bytes4[](17);
        selectors[0] = MandateExecutorHandler.rotatePolicy.selector;
        selectors[1] = MandateExecutorHandler.authorize.selector;
        selectors[2] = MandateExecutorHandler.authorizeWithSessionSignature.selector;
        selectors[3] = MandateExecutorHandler.authorizeFromUnnamedExecutor.selector;
        selectors[4] = MandateExecutorHandler.replayAuthorization.selector;
        selectors[5] = MandateExecutorHandler.begin.selector;
        selectors[6] = MandateExecutorHandler.beginFromAttacker.selector;
        selectors[7] = MandateExecutorHandler.performAttempt.selector;
        selectors[8] = MandateExecutorHandler.performWithForeignProof.selector;
        selectors[9] = MandateExecutorHandler.performFromAttacker.selector;
        selectors[10] = MandateExecutorHandler.revokeAttempt.selector;
        selectors[11] = MandateExecutorHandler.revokeFromAttacker.selector;
        selectors[12] = MandateExecutorHandler.finalizeExpiredAttempt.selector;
        selectors[13] = MandateExecutorHandler.finalizeStalledAttempt.selector;
        selectors[14] = MandateExecutorHandler.invalidateNonce.selector;
        // Without time advance the expiry and stalled-execution branches are unreachable
        // and the suite would pass vacuously on half the state machine.
        selectors[15] = MandateExecutorHandler.advanceTime.selector;
        selectors[16] = MandateExecutorHandler.authorizeReusingCommerceJob.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice The handler can drive a mandate into every terminal state. Without this,
    /// a wiring mistake that made every attempt inadmissible would leave all twelve
    /// invariants passing over an empty state space.
    function test_theHandlerReachesEveryTerminalState() public {
        handler.authorize(2);
        handler.begin(0);
        handler.performAttempt(0, 2, uint8(0), uint8(0));

        handler.authorize(3);
        handler.begin(1);
        handler.performAttempt(1, 2, uint8(1), uint8(0));

        handler.authorize(6);
        handler.revokeAttempt(2);

        handler.authorize(7);
        // Two maximum advances outrun the longest lifetime the handler can sign.
        handler.advanceTime(1200);
        handler.advanceTime(1200);
        handler.finalizeExpiredAttempt(3);

        assertEq(handler.mandateCount(), 4, "the scripted sequence lost a mandate");
        assertEq(handler.succeededMandates(), 1, "no attempt reached a verified success");
        assertTrue(_reached(PeragoTypes.MandateStatus.SUCCEEDED), "SUCCEEDED unreachable");
        assertTrue(_reached(PeragoTypes.MandateStatus.FAILED), "FAILED unreachable");
        assertTrue(_reached(PeragoTypes.MandateStatus.REVOKED), "REVOKED unreachable");
        assertTrue(_reached(PeragoTypes.MandateStatus.EXPIRED), "EXPIRED unreachable");
    }

    function _reached(PeragoTypes.MandateStatus status) private view returns (bool) {
        for (uint256 i = 0; i < handler.mandateCount(); ++i) {
            if (executor.mandateRecord(handler.mandateHashAt(i)).status == status) return true;
        }
        return false;
    }

    /// @notice Invariant 1: `usedNonce[account][nonce]` never changes from true to false.
    function invariant_consumedNoncesNeverReturnToFalse() public view {
        assertEq(handler.resurrectedNonces(), 0, "a consumed nonce stopped reporting as used");
    }

    /// @notice Invariant 2: at most one authorization, one accepted attempt, and one
    /// terminal receipt exist per mandate.
    function invariant_oneAuthorizationOneAttemptOneReceipt() public view {
        assertEq(handler.duplicateAuthorizations(), 0, "a mandate hash was authorized twice");
        assertEq(handler.duplicateBegins(), 0, "a mandate accepted a second attempt");
        assertEq(handler.duplicateReceipts(), 0, "a mandate produced a second terminal receipt");
    }

    /// @notice Invariant 3: a terminal mandate never transitions again.
    function invariant_terminalMandatesNeverTransition() public view {
        assertEq(handler.terminalTransitions(), 0, "a terminal mandate changed status");
    }

    /// @notice Invariant 4: `SUCCEEDED` implies the adapter ran and its paired verifier
    /// passed inside the same atomic subcall, crediting at least the signed minimum.
    function invariant_successImpliesVerifiedExecution() public view {
        assertEq(handler.unverifiedSuccesses(), 0, "a success carried no verification hash");
        assertEq(handler.successesBelowSignedMinimum(), 0, "a success credited less than minOutput");
    }

    /// @notice Invariant 5: only a success carries settlement evidence, so a failed,
    /// revoked, or expired mandate can never feed ERC-8183 completion.
    function invariant_onlySuccessCarriesSettlementEvidence() public view {
        assertEq(handler.settlementEvidenceWithoutSuccess(), 0, "a non-success receipt carried settlement evidence");
    }

    /// @notice Invariant 6: the adapter and verifier of every record are the immutable
    /// deployment pair the mandate named.
    function invariant_executionPairsComeFromTheDeployment() public view {
        assertEq(handler.unpinnedExecutionPairs(), 0, "a record named an unpinned adapter/verifier pair");
    }

    /// @notice Invariant 7: no attempt spends more than the signed `maxInput`, and the
    /// account's cumulative outflow never exceeds the sum of the bounds it signed.
    function invariant_spendNeverExceedsTheSignedBound() public view {
        assertEq(handler.overspentAttempts(), 0, "an attempt spent more than maxInput");

        uint256 funding = handler.ACCOUNT_FUNDING();
        uint256 balance = inputToken.balanceOf(handler.account());
        if (balance < funding) {
            assertLe(funding - balance, handler.spendCeiling(), "cumulative spend exceeded the signed bounds");
        }
    }

    /// @notice Invariant 8: protocol output reaches only the signed recipient, and a
    /// failed attempt moves nothing at all.
    function invariant_onlySignedRecipientsReceiveOutput() public view {
        assertEq(
            outputToken.balanceOf(handler.secondRecipient()),
            handler.secondRecipientCredits(),
            "the alternate recipient holds an amount no successful mandate credited"
        );
        assertEq(outputToken.balanceOf(handler.attacker()), 0, "an unsigned address received output");
        assertEq(inputToken.balanceOf(handler.attacker()), 0, "an unsigned address received input");
        assertEq(handler.nonAtomicFailures(), 0, "a failed attempt moved value");
    }

    /// @notice Invariant 9: the executor holds no user balance and grants no standing
    /// allowance between calls.
    function invariant_executorHoldsNothingAndApprovesNothing() public view {
        address boundary = address(executor);
        address swap = address(handler.swapAdapter());
        address stake = address(handler.stakeAdapter());

        assertEq(inputToken.balanceOf(boundary), 0, "the executor retained input");
        assertEq(outputToken.balanceOf(boundary), 0, "the executor retained output");
        assertEq(inputToken.allowance(boundary, swap), 0, "a swap-adapter allowance survived");
        assertEq(inputToken.allowance(boundary, stake), 0, "a stake-adapter allowance survived");
        assertEq(outputToken.allowance(boundary, swap), 0, "an output allowance was granted");
    }

    /// @notice Invariant 10: an owner, epoch, or policy mutation invalidates a mandate the
    /// previous configuration signed.
    function invariant_ownerAndPolicyMutationsEndStaleAuthority() public view {
        assertEq(handler.staleAuthorizationsAccepted(), 0, "a mandate signed before a rotation was authorized");
    }

    /// @notice Invariant 11: one ERC-8183 job binds to at most one mandate, so it can
    /// settle at most once.
    function invariant_commerceJobBindsAtMostOneMandate() public view {
        assertEq(handler.jobBindingConflicts(), 0, "a commerce job pointed at another mandate");
    }

    /// @notice Invariant 12: no session-key signature is ever accepted as root authority,
    /// on the mandate or on the executor proof.
    function invariant_noSessionSignatureIsAcceptedAsRoot() public view {
        assertEq(handler.sessionSignedAuthorizationsAccepted(), 0, "a session key authorized a mandate");
        assertEq(handler.sessionSignedProofsAccepted(), 0, "a session key signed an accepted execution proof");
    }

    /// @notice Call surface: an address the mandate never named is rejected by every entry
    /// point that is not deliberately permissionless.
    function invariant_callersOutsideTheMandateAreRejected() public view {
        assertEq(handler.unauthorizedCallsAccepted(), 0, "an unnamed caller was accepted");
    }

    /// @dev Full sweep once per run, read back from the contract rather than from ghosts.
    function afterInvariant() public view {
        uint256 mandates = handler.mandateCount();
        uint256 succeeded;

        for (uint256 i = 0; i < mandates; ++i) {
            bytes32 mandateHash = handler.mandateHashAt(i);
            PeragoTypes.TaskMandate memory mandate = handler.trackedMandate(mandateHash);
            MandateGhost memory ghost = handler.ghostOf(mandateHash);
            PeragoTypes.MandateRecord memory record = executor.mandateRecord(mandateHash);

            assertEq(ghost.authorizations, 1, "a mandate hash was authorized more than once");
            assertLe(ghost.begins, 1, "a mandate began execution more than once");
            assertLe(ghost.receipts, 1, "a mandate recorded more than one terminal receipt");
            assertTrue(executor.isNonceUsed(mandate.account, mandate.nonce), "an authorized nonce is reusable");
            assertEq(
                executor.commerceJobBinding(mandate.commerceContract, mandate.commerceJobId),
                mandateHash,
                "a commerce job no longer binds the mandate that claimed it"
            );

            if (ghost.terminalStatus != PeragoTypes.MandateStatus.NONE) {
                assertEq(uint8(record.status), uint8(ghost.terminalStatus), "a terminal mandate transitioned");
            }

            if (record.status == PeragoTypes.MandateStatus.SUCCEEDED) {
                succeeded += 1;
                assertTrue(record.verificationHash != bytes32(0), "a success carried no verification hash");
                assertEq(record.failureReasonHash, bytes32(0), "a success carried a failure reason");
            } else {
                assertEq(record.verificationHash, bytes32(0), "settlement evidence exists without a success");
            }
        }

        assertEq(succeeded, handler.succeededMandates(), "stored receipts disagree with the observed successes");

        uint256 burned = handler.burnedNonceCount();
        for (uint256 i = 0; i < burned; ++i) {
            assertTrue(
                executor.isNonceUsed(handler.account(), handler.burnedNonceAt(i)), "a burned nonce became reusable"
            );
        }
    }
}
