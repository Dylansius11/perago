// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {MandateExecutor} from "../src/MandateExecutor.sol";
import {IPeragoAdapter} from "../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../src/types/PeragoTypes.sol";
import {MockERC20, MockFeeOnTransferToken} from "./mocks/MockERC20.sol";
import {MockPeragoAdapter, MockStakeAdapter, MockSwapAdapter} from "./mocks/MockPeragoAdapter.sol";
import {MockPeragoVerifier} from "./mocks/MockPeragoVerifier.sol";

/// @notice `P2-002`: the accepted-attempt boundary and the atomic failure boundary. Each
/// test names a break: a second attempt on one root signature, a protocol effect that does
/// not reach the signed recipient, value left inside the executor, an adapter that outruns
/// its exact allowance, or a terminal state that could be revisited.
contract MandateExecutorExecutionTest is Test {
    uint48 private constant EXECUTION_WINDOW = 15 minutes;
    uint48 private constant MANDATE_LIFETIME = 30 minutes;
    uint48 private constant PROOF_LIFETIME = 5 minutes;
    uint256 private constant MAX_INPUT = 5e18;
    uint256 private constant MIN_OUTPUT = 1e18;
    uint256 private constant AMOUNT_OUT = 2e18;
    uint256 private constant ACCOUNT_FUNDING = 100e18;
    uint256 private constant ADAPTER_OUTPUT_FUNDING = 1000e18;
    /// The executor hashes at most this many bytes of revert data; oversized payloads are
    /// truncated, never parsed.
    uint256 private constant MAX_REASON_BYTES = 256;
    bytes32 private constant STALLED_REASON = keccak256("perago.failure.stalled.v1");
    address private constant COMMERCE = address(0xC0FFEE);

    uint256 private rootOwnerKey = 0xA11CE;
    uint256 private executorKey = 0xE0E0;
    uint256 private sessionKey = 0x5E5510;
    address private rootOwner;
    address private executorSigner;
    address private sessionSigner;

    address private account = address(0xACC0);
    address private attacker = address(0xBAD);
    uint256 private nextNonce = 1;

    MandateExecutor private executor;
    MockSwapAdapter private swapAdapter;
    MockStakeAdapter private stakeAdapter;
    MockPeragoVerifier private swapVerifier;
    MockPeragoVerifier private stakeVerifier;
    MockERC20 private inputToken;
    MockERC20 private outputToken;

    event ExecutionBegun(bytes32 indexed mandateHash, uint48 startedAt);
    event ExecutionReceiptRecorded(
        bytes32 indexed mandateHash,
        PeragoTypes.MandateStatus status,
        bytes32 verificationHash,
        bytes32 failureReasonHash
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        rootOwner = vm.addr(rootOwnerKey);
        executorSigner = vm.addr(executorKey);
        sessionSigner = vm.addr(sessionKey);

        swapVerifier = new MockPeragoVerifier(keccak256("perago.verifier.swap.v1"));
        stakeVerifier = new MockPeragoVerifier(keccak256("perago.verifier.stake.v1"));
        swapAdapter = new MockSwapAdapter(address(swapVerifier));
        stakeAdapter = new MockStakeAdapter(address(stakeVerifier));
        executor = new MandateExecutor(address(swapAdapter), address(stakeAdapter), EXECUTION_WINDOW, false);

        inputToken = new MockERC20("Input", "IN");
        outputToken = new MockERC20("Output", "OUT");
        inputToken.mint(account, ACCOUNT_FUNDING);
        outputToken.mint(address(swapAdapter), ADAPTER_OUTPUT_FUNDING);
        inputToken.mint(address(stakeAdapter), ADAPTER_OUTPUT_FUNDING);

        _register();
    }

    // --- accepted attempt -----------------------------------------------------

    function test_performRoutesOutputToTheSignedRecipientAndKeepsNothing() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);

        PeragoTypes.MandateStatus status = _perform(mandate, action, mandateHash, executorKey);

        assertEq(uint8(status), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertEq(outputToken.balanceOf(account), AMOUNT_OUT);
        assertEq(inputToken.balanceOf(account), ACCOUNT_FUNDING - MAX_INPUT);
        assertEq(inputToken.balanceOf(address(executor)), 0);
        assertEq(outputToken.balanceOf(address(executor)), 0);
        assertEq(inputToken.allowance(address(executor), address(swapAdapter)), 0);
        assertEq(inputToken.allowance(account, address(executor)), 0);

        PeragoTypes.MandateRecord memory record = executor.mandateRecord(mandateHash);
        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertTrue(record.verificationHash != bytes32(0));
        assertEq(record.failureReasonHash, bytes32(0));
    }

    function test_performRefundsInputTheAdapterDidNotSpend() public {
        uint256 spent = MAX_INPUT / 4;
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(spent);

        _perform(mandate, action, mandateHash, executorKey);

        assertEq(inputToken.balanceOf(account), ACCOUNT_FUNDING - spent);
        assertEq(inputToken.balanceOf(address(executor)), 0);
    }

    function test_performRefundsInputTheAdapterHandsBack() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.LEAVE_INPUT_BEHIND);
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);

        _perform(mandate, action, mandateHash, executorKey);

        assertEq(inputToken.balanceOf(account), ACCOUNT_FUNDING - MAX_INPUT / 2);
        assertEq(inputToken.balanceOf(address(executor)), 0);
        assertEq(outputToken.balanceOf(account), AMOUNT_OUT);
    }

    function test_performSucceedsForAStakeMandateOnTheSameAsset() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(address(stakeAdapter));
        mandate.outputToken = address(inputToken);
        bytes memory action = abi.encode(MAX_INPUT, AMOUNT_OUT);
        mandate.actionHash = keccak256(action);
        bytes32 mandateHash = _authorizeAndBegin(mandate);

        PeragoTypes.MandateStatus status = _perform(mandate, action, mandateHash, executorKey);

        assertEq(uint8(status), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertEq(inputToken.balanceOf(account), ACCOUNT_FUNDING - MAX_INPUT + AMOUNT_OUT);
        assertEq(inputToken.balanceOf(address(executor)), 0);
    }

    function test_receiptCommitsTheMandateIdentity() public {
        (PeragoTypes.TaskMandate memory first, bytes memory action, bytes32 firstHash) = _armed(MAX_INPUT);
        _perform(first, action, firstHash, executorKey);

        PeragoTypes.TaskMandate memory second = _mandate(address(swapAdapter));
        second.postconditionHash = keccak256("a different postcondition");
        second.actionHash = keccak256(action);
        bytes32 secondHash = _authorizeAndBegin(second);
        _perform(second, action, secondHash, executorKey);

        bytes32 firstReceipt = executor.mandateRecord(firstHash).verificationHash;
        bytes32 secondReceipt = executor.mandateRecord(secondHash).verificationHash;
        assertTrue(firstReceipt != secondReceipt);
    }

    function test_emitsExecutionBegunThenTheTerminalReceipt() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes memory action = abi.encode(MAX_INPUT, AMOUNT_OUT);
        mandate.actionHash = keccak256(action);
        bytes32 mandateHash = _authorize(mandate);

        vm.expectEmit(true, false, false, true, address(executor));
        emit ExecutionBegun(mandateHash, uint48(block.timestamp));
        vm.prank(executorSigner);
        executor.beginExecution(mandateHash);

        PeragoTypes.MandateRecord memory begun = executor.mandateRecord(mandateHash);
        assertEq(uint8(begun.status), uint8(PeragoTypes.MandateStatus.EXECUTING));
        assertEq(begun.executionStartedAt, uint48(block.timestamp));

        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);
        vm.recordLogs();
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);

        Vm.Log memory receiptLog = _receiptLog(vm.getRecordedLogs());
        assertEq(receiptLog.topics[1], mandateHash);
        (uint8 status, bytes32 verificationHash, bytes32 failureReasonHash) =
            abi.decode(receiptLog.data, (uint8, bytes32, bytes32));
        assertEq(status, uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertEq(verificationHash, executor.mandateRecord(mandateHash).verificationHash);
        assertEq(failureReasonHash, bytes32(0));
    }

    // --- the one-attempt guarantee -------------------------------------------

    function test_rejectsPerformBeforeBeginExecution() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes memory action = abi.encode(MAX_INPUT, AMOUNT_OUT);
        mandate.actionHash = keccak256(action);
        bytes32 mandateHash = _authorize(mandate);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);

        vm.expectRevert(MandateExecutor.ExecutionNotStarted.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_rejectsSecondPerformAfterSuccess() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        _perform(mandate, action, mandateHash, executorKey);

        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);
        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_rejectsSecondPerformAfterFailure() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.REVERT_TYPED);
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        _perform(mandate, action, mandateHash, executorKey);
        swapAdapter.setMode(MockPeragoAdapter.Mode.HONEST);

        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);
        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_failedMandateKeepsItsNonceConsumed() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.REVERT_TYPED);
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes memory action = abi.encode(MAX_INPUT, AMOUNT_OUT);
        mandate.actionHash = keccak256(action);
        bytes32 mandateHash = _authorizeAndBegin(mandate);
        _perform(mandate, action, mandateHash, executorKey);

        bytes memory rootSignature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.NonceAlreadyUsed.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, rootSignature);
    }

    function test_rejectsSecondBeginExecution() public {
        (,, bytes32 mandateHash) = _armed(MAX_INPUT);

        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(executorSigner);
        executor.beginExecution(mandateHash);
    }

    function test_rejectsBeginExecutionFromAnyoneButTheSignedExecutor() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes32 mandateHash = _authorize(mandate);

        vm.expectRevert(MandateExecutor.WrongExecutor.selector);
        vm.prank(attacker);
        executor.beginExecution(mandateHash);

        vm.expectRevert(MandateExecutor.WrongExecutor.selector);
        vm.prank(account);
        executor.beginExecution(mandateHash);
    }

    function test_rejectsBeginExecutionAfterExpiry() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes32 mandateHash = _authorize(mandate);
        vm.warp(mandate.expiresAt);

        vm.expectRevert(MandateExecutor.ExpiredMandate.selector);
        vm.prank(executorSigner);
        executor.beginExecution(mandateHash);
    }

    function test_rejectsBeginExecutionAfterRevocation() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes32 mandateHash = _authorize(mandate);
        vm.prank(account);
        executor.revoke(mandateHash);

        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(executorSigner);
        executor.beginExecution(mandateHash);
    }

    function test_revocationIsNoLongerAvailableOnceExecuting() public {
        (,, bytes32 mandateHash) = _armed(MAX_INPUT);

        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(account);
        executor.revoke(mandateHash);
    }

    // --- caller, window, proof, and action binding ----------------------------

    function test_rejectsPerformFromAnyoneButTheSmartAccount() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);

        vm.expectRevert(MandateExecutor.WrongAccountCaller.selector);
        vm.prank(executorSigner);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_rejectsPerformAfterTheExecutionWindowElapsed() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        vm.warp(block.timestamp + EXECUTION_WINDOW + 1);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);

        vm.expectRevert(MandateExecutor.ExecutionWindowElapsed.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_rejectsPerformAfterMandateExpiryInsideTheWindow() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes memory action = abi.encode(MAX_INPUT, AMOUNT_OUT);
        mandate.actionHash = keccak256(action);
        bytes32 mandateHash = _authorize(mandate);
        vm.warp(mandate.expiresAt - 60);
        vm.prank(executorSigner);
        executor.beginExecution(mandateHash);

        vm.warp(mandate.expiresAt + 1);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);

        vm.expectRevert(MandateExecutor.ExpiredMandate.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_rejectsExecutorProofSignedByTheSessionKey() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, sessionKey);

        vm.expectRevert(MandateExecutor.InvalidExecutorProof.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_rejectsExpiredExecutorProof() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        PeragoTypes.ExecutionProof memory proof = PeragoTypes.ExecutionProof({
            mandateHash: mandateHash, account: account, executor: executorSigner, validUntil: uint48(block.timestamp)
        });
        bytes memory proofSignature = _signProof(proof, executorKey);

        vm.expectRevert(MandateExecutor.InvalidExecutorProof.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_rejectsExecutorProofNamingAnotherAccount() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        PeragoTypes.ExecutionProof memory proof = PeragoTypes.ExecutionProof({
            mandateHash: mandateHash,
            account: attacker,
            executor: executorSigner,
            validUntil: uint48(block.timestamp) + PROOF_LIFETIME
        });
        bytes memory proofSignature = _signProof(proof, executorKey);

        vm.expectRevert(MandateExecutor.InvalidExecutorProof.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function test_rejectsActionBytesOutsideTheSignedCommitment() public {
        (PeragoTypes.TaskMandate memory mandate,, bytes32 mandateHash) = _armed(MAX_INPUT);
        bytes memory tampered = abi.encode(MAX_INPUT, AMOUNT_OUT / 2);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);

        vm.expectRevert(MandateExecutor.ActionHashMismatch.selector);
        vm.prank(account);
        executor.perform(mandate, tampered, proof, proofSignature);
    }

    function test_rejectsDirectExecuteCoreCall() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);

        vm.expectRevert(MandateExecutor.OnlySelf.selector);
        vm.prank(attacker);
        executor.executeCore(mandateHash, mandate, action);
    }

    // --- atomic failure boundary ---------------------------------------------

    function test_recordsFailureWhenTheAdapterReverts() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.REVERT_TYPED);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(record.verificationHash, bytes32(0));
        assertEq(
            record.failureReasonHash,
            _reasonHash(abi.encodeWithSelector(MockPeragoAdapter.AdapterProtocolFailure.selector))
        );
        _assertNothingMoved();
    }

    function test_boundsOversizedRevertDataInsteadOfParsingIt() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.REVERT_OVERSIZED);
        bytes memory fullReason = abi.encodeWithSignature("Error(string)", string(new bytes(4096)));

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(record.failureReasonHash, _reasonHash(fullReason));
        _assertNothingMoved();
    }

    function test_recordsFailureWhenThePreStateMeasurementReverts() public {
        swapVerifier.setMode(MockPeragoVerifier.Mode.MEASURE_REVERTS);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(
            record.failureReasonHash,
            _reasonHash(abi.encodeWithSelector(MockPeragoVerifier.PreStateUnavailable.selector))
        );
        _assertNothingMoved();
    }

    function test_recordsFailureWhenTheVerifierReverts() public {
        swapVerifier.setMode(MockPeragoVerifier.Mode.VERIFY_REVERTS);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(
            record.failureReasonHash,
            _reasonHash(abi.encodeWithSelector(MockPeragoVerifier.PostconditionUnmet.selector))
        );
        _assertNothingMoved();
    }

    function test_recordsFailureWhenTheMeasuredOutputIsBelowTheSignedMinimum() public {
        swapVerifier.setMode(MockPeragoVerifier.Mode.UNDER_MINIMUM);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(
            record.failureReasonHash, _reasonHash(abi.encodeWithSelector(MandateExecutor.VerificationFailed.selector))
        );
        _assertNothingMoved();
    }

    function test_recordsFailureWhenTheOutputNeverReachesTheRecipient() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.WITHHOLD_OUTPUT);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        _assertNothingMoved();
    }

    function test_recordsFailureWhenProtocolOutputIsStrandedInTheExecutor() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.STRANDS_OUTPUT);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(
            record.failureReasonHash, _reasonHash(abi.encodeWithSelector(MandateExecutor.RecipientMismatch.selector))
        );
        _assertNothingMoved();
    }

    function test_recordsFailureWhenTheAdapterInflatesItsResult() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.INFLATE_RESULT);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(
            record.failureReasonHash, _reasonHash(abi.encodeWithSelector(MandateExecutor.VerificationFailed.selector))
        );
        _assertNothingMoved();
    }

    function test_recordsFailureWhenEvidenceIsNotBoundToThisMandate() public {
        swapVerifier.setMode(MockPeragoVerifier.Mode.FOREIGN_POSTCONDITION);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(
            record.failureReasonHash,
            _reasonHash(abi.encodeWithSelector(MandateExecutor.PostconditionHashMismatch.selector))
        );
        _assertNothingMoved();
    }

    function test_recordsFailureWhenEvidenceCarriesNoCommitment() public {
        swapVerifier.setMode(MockPeragoVerifier.Mode.ZERO_EVIDENCE);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        _assertNothingMoved();
    }

    function test_recordsFailureWhenTheAdapterPullsAboveItsExactAllowance() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.PULL_ABOVE_ALLOWANCE);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        _assertNothingMoved();
    }

    function test_recordsFailureWhenTheAdapterMisreportsTheNormalizedAction() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.MISREPORT_ACTION);

        PeragoTypes.MandateRecord memory record = _runToTerminal();

        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(
            record.failureReasonHash, _reasonHash(abi.encodeWithSelector(MandateExecutor.ActionHashMismatch.selector))
        );
        _assertNothingMoved();
    }

    function test_recordsFailureWhenTheAdapterReentersPerform() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        swapAdapter.setMode(MockPeragoAdapter.Mode.REENTER_EXECUTOR);
        swapAdapter.setReentry(
            address(executor), abi.encodeCall(MandateExecutor.perform, (mandate, action, proof, proofSignature))
        );
        _approve(MAX_INPUT);

        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);

        PeragoTypes.MandateRecord memory record = executor.mandateRecord(mandateHash);
        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        _assertNothingMoved();
    }

    function test_recordsFailureWhenTheAdapterReentersRevoke() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        swapAdapter.setMode(MockPeragoAdapter.Mode.REENTER_EXECUTOR);
        swapAdapter.setReentry(address(executor), abi.encodeCall(MandateExecutor.revoke, (mandateHash)));
        _approve(MAX_INPUT);

        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);

        assertEq(uint8(executor.mandateRecord(mandateHash).status), uint8(PeragoTypes.MandateStatus.FAILED));
    }

    function test_recordsFailureWhenTheAdapterBurnsEveryAvailableGasUnit() public {
        swapAdapter.setMode(MockPeragoAdapter.Mode.BURN_ALL_GAS);
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);

        vm.prank(account);
        // Sized so the 63/64 rule alone would leave too little to write the record: this
        // fails unless the subcall is explicitly bounded.
        executor.perform{gas: 300_000}(mandate, action, proof, proofSignature);

        assertEq(uint8(executor.mandateRecord(mandateHash).status), uint8(PeragoTypes.MandateStatus.FAILED));
        _assertNothingMoved();
    }

    function test_rejectsPerformWithoutEnoughGasToRecordFailure() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);

        vm.expectRevert(MandateExecutor.InsufficientGasBudget.selector);
        vm.prank(account);
        executor.perform{gas: 120_000}(mandate, action, proof, proofSignature);
    }

    function test_recordsFailureForAFeeOnTransferInputToken() public {
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken();
        feeToken.mint(account, ACCOUNT_FUNDING);
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        mandate.inputToken = address(feeToken);
        bytes memory action = abi.encode(MAX_INPUT, AMOUNT_OUT);
        mandate.actionHash = keccak256(action);
        bytes32 mandateHash = _authorizeAndBegin(mandate);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        vm.prank(account);
        feeToken.approve(address(executor), MAX_INPUT);

        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);

        assertEq(uint8(executor.mandateRecord(mandateHash).status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(outputToken.balanceOf(account), 0);
        assertEq(feeToken.balanceOf(address(executor)), 0);
    }

    // --- stalled execution ----------------------------------------------------

    function test_anyoneFinalizesAStalledExecution() public {
        (,, bytes32 mandateHash) = _armed(MAX_INPUT);
        vm.warp(block.timestamp + EXECUTION_WINDOW + 1);

        vm.prank(attacker);
        executor.finalizeStalledExecution(mandateHash);

        PeragoTypes.MandateRecord memory record = executor.mandateRecord(mandateHash);
        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(record.failureReasonHash, STALLED_REASON);
        _assertNothingMoved();
    }

    function test_rejectsStalledFinalizationInsideTheWindow() public {
        (,, bytes32 mandateHash) = _armed(MAX_INPUT);
        vm.warp(block.timestamp + EXECUTION_WINDOW);

        vm.expectRevert(MandateExecutor.MandateNotExpired.selector);
        vm.prank(attacker);
        executor.finalizeStalledExecution(mandateHash);
    }

    function test_rejectsStalledFinalizationOnAnAuthorizedMandate() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes32 mandateHash = _authorize(mandate);

        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(attacker);
        executor.finalizeStalledExecution(mandateHash);
    }

    function test_rejectsStalledFinalizationOnATerminalMandate() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        _perform(mandate, action, mandateHash, executorKey);
        vm.warp(block.timestamp + EXECUTION_WINDOW + 1);

        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(attacker);
        executor.finalizeStalledExecution(mandateHash);
    }

    function test_rejectsPerformAfterStalledFinalization() public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        vm.warp(block.timestamp + EXECUTION_WINDOW + 1);
        vm.prank(attacker);
        executor.finalizeStalledExecution(mandateHash);
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, executorKey);
        _approve(MAX_INPUT);

        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    // --- fuzz -----------------------------------------------------------------

    function testFuzz_refundsExactlyWhatTheAdapterDidNotSpend(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, MAX_INPUT);
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(amountIn);

        PeragoTypes.MandateStatus status = _perform(mandate, action, mandateHash, executorKey);

        assertEq(uint8(status), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertEq(inputToken.balanceOf(account), ACCOUNT_FUNDING - amountIn);
        assertEq(inputToken.balanceOf(address(executor)), 0);
        assertEq(outputToken.balanceOf(account), AMOUNT_OUT);
    }

    function testFuzz_neverSucceedsBelowTheSignedMinimum(uint256 amountOut) public {
        amountOut = bound(amountOut, 0, MIN_OUTPUT - 1);
        PeragoTypes.TaskMandate memory mandate = _mandate(address(swapAdapter));
        bytes memory action = abi.encode(MAX_INPUT, amountOut);
        mandate.actionHash = keccak256(action);
        bytes32 mandateHash = _authorizeAndBegin(mandate);

        PeragoTypes.MandateStatus status = _perform(mandate, action, mandateHash, executorKey);

        assertEq(uint8(status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(outputToken.balanceOf(account), 0);
        assertEq(inputToken.balanceOf(account), ACCOUNT_FUNDING);
    }

    function testFuzz_rejectsExecutorProofBoundToAnotherMandate(bytes32 otherHash) public {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        vm.assume(otherHash != mandateHash);
        PeragoTypes.ExecutionProof memory proof = PeragoTypes.ExecutionProof({
            mandateHash: otherHash,
            account: account,
            executor: executorSigner,
            validUntil: uint48(block.timestamp) + PROOF_LIFETIME
        });
        bytes memory proofSignature = _signProof(proof, executorKey);

        vm.expectRevert(MandateExecutor.InvalidExecutorProof.selector);
        vm.prank(account);
        executor.perform(mandate, action, proof, proofSignature);
    }

    function testFuzz_keepsTheExecutorEmptyOnEveryTerminalOutcome(uint8 adapterMode) public {
        MockPeragoAdapter.Mode mode = MockPeragoAdapter.Mode(bound(adapterMode, 0, 9));
        swapAdapter.setMode(mode);
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        if (mode == MockPeragoAdapter.Mode.REENTER_EXECUTOR) {
            swapAdapter.setReentry(address(executor), abi.encodeCall(MandateExecutor.revoke, (mandateHash)));
        }

        _perform(mandate, action, mandateHash, executorKey);

        PeragoTypes.MandateStatus status = executor.mandateRecord(mandateHash).status;
        assertTrue(
            status == PeragoTypes.MandateStatus.SUCCEEDED || status == PeragoTypes.MandateStatus.FAILED,
            "one attempt must end terminally"
        );
        assertEq(inputToken.balanceOf(address(executor)), 0);
        assertEq(outputToken.balanceOf(address(executor)), 0);
        assertEq(inputToken.allowance(address(executor), address(swapAdapter)), 0);
    }

    // --- helpers --------------------------------------------------------------

    /// @dev Authorizes, begins, and returns the mandate armed for one `perform`.
    function _armed(uint256 amountIn)
        private
        returns (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash)
    {
        mandate = _mandate(address(swapAdapter));
        action = abi.encode(amountIn, AMOUNT_OUT);
        mandate.actionHash = keccak256(action);
        mandateHash = _authorizeAndBegin(mandate);
    }

    function _runToTerminal() private returns (PeragoTypes.MandateRecord memory) {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action, bytes32 mandateHash) = _armed(MAX_INPUT);
        _perform(mandate, action, mandateHash, executorKey);
        return executor.mandateRecord(mandateHash);
    }

    function _assertNothingMoved() private view {
        assertEq(inputToken.balanceOf(account), ACCOUNT_FUNDING);
        assertEq(outputToken.balanceOf(account), 0);
        assertEq(inputToken.balanceOf(address(executor)), 0);
        assertEq(outputToken.balanceOf(address(executor)), 0);
        assertEq(inputToken.allowance(address(executor), address(swapAdapter)), 0);
    }

    function _perform(
        PeragoTypes.TaskMandate memory mandate,
        bytes memory action,
        bytes32 mandateHash,
        uint256 proofKey
    ) private returns (PeragoTypes.MandateStatus) {
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, proofKey);
        _approve(mandate.maxInput);
        vm.prank(account);
        return executor.perform(mandate, action, proof, proofSignature);
    }

    function _approve(uint256 amount) private {
        vm.prank(account);
        inputToken.approve(address(executor), amount);
    }

    function _authorizeAndBegin(PeragoTypes.TaskMandate memory mandate) private returns (bytes32 mandateHash) {
        mandateHash = _authorize(mandate);
        vm.prank(executorSigner);
        executor.beginExecution(mandateHash);
    }

    function _authorize(PeragoTypes.TaskMandate memory mandate) private returns (bytes32) {
        bytes memory rootSignature = _signMandate(mandate, rootOwnerKey);
        vm.prank(executorSigner);
        return executor.authorize(mandate, rootSignature);
    }

    function _proof(bytes32 mandateHash, uint256 key)
        private
        view
        returns (PeragoTypes.ExecutionProof memory proof, bytes memory signature)
    {
        proof = PeragoTypes.ExecutionProof({
            mandateHash: mandateHash,
            account: account,
            executor: executorSigner,
            validUntil: uint48(block.timestamp) + PROOF_LIFETIME
        });
        signature = _signProof(proof, key);
    }

    function _mandate(address adapter) private returns (PeragoTypes.TaskMandate memory mandate) {
        PeragoTypes.AccountConfig memory config = executor.accountConfig(account);
        mandate = PeragoTypes.TaskMandate({
            account: account,
            rootOwner: config.rootOwner,
            ownerEpoch: config.ownerEpoch,
            executor: executorSigner,
            chainId: block.chainid,
            nonce: nextNonce,
            expiresAt: uint48(block.timestamp) + MANDATE_LIFETIME,
            policyHash: config.activePolicyHash,
            intentHash: keccak256("intent"),
            planHash: keccak256("plan"),
            simulationHash: keccak256("simulation"),
            adapter: adapter,
            adapterSelector: IPeragoAdapter.execute.selector,
            inputToken: address(inputToken),
            maxInput: MAX_INPUT,
            outputToken: address(outputToken),
            minOutput: MIN_OUTPUT,
            recipient: account,
            actionHash: keccak256("action"),
            postconditionHash: keccak256("postcondition"),
            commerceContract: COMMERCE,
            commerceJobId: nextNonce
        });
        nextNonce += 1;
    }

    function _reasonHash(bytes memory revertData) private pure returns (bytes32) {
        uint256 size = revertData.length;
        uint256 copied = size > MAX_REASON_BYTES ? MAX_REASON_BYTES : size;
        bytes memory bounded = new bytes(copied);
        for (uint256 i = 0; i < copied; ++i) {
            bounded[i] = revertData[i];
        }
        return keccak256(abi.encode(size, bounded));
    }

    /// @dev Finds the receipt the executor really emitted, so the assertion reads onchain
    /// data instead of an expectation the test itself produced.
    function _receiptLog(Vm.Log[] memory logs) private view returns (Vm.Log memory) {
        bytes32 signature = keccak256("ExecutionReceiptRecorded(bytes32,uint8,bytes32,bytes32)");
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter == address(executor) && logs[i].topics[0] == signature) return logs[i];
        }
        revert("no execution receipt was emitted");
    }

    function _register() private {
        PeragoTypes.AccountPolicy memory policy = PeragoTypes.AccountPolicy({
            account: account,
            rootOwner: rootOwner,
            ownerEpoch: 1,
            chainId: block.chainid,
            policyHash: keccak256("policy.v1"),
            permissionHash: keccak256("permission.v1"),
            validUntil: uint48(block.timestamp) + 1 days
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rootOwnerKey, executor.hashAccountPolicy(policy));
        vm.prank(account);
        executor.setAccountPolicy(policy, abi.encodePacked(r, s, v));
    }

    function _signMandate(PeragoTypes.TaskMandate memory mandate, uint256 key) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, executor.hashMandate(mandate));
        return abi.encodePacked(r, s, v);
    }

    function _signProof(PeragoTypes.ExecutionProof memory proof, uint256 key) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, executor.hashExecutionProof(proof));
        return abi.encodePacked(r, s, v);
    }
}
