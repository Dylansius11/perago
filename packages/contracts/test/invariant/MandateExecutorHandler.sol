// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {MandateExecutor} from "../../src/MandateExecutor.sol";
import {IPeragoAdapter} from "../../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPeragoAdapter, MockStakeAdapter, MockSwapAdapter} from "../mocks/MockPeragoAdapter.sol";
import {MockPeragoVerifier} from "../mocks/MockPeragoVerifier.sol";

/// @notice What the handler observed for one mandate across a whole call sequence.
/// @dev Counters instead of in-handler assertions: a violated safety property is reported
/// by the named invariant that owns it, not as an anonymous handler revert.
struct MandateGhost {
    uint8 authorizations;
    uint8 begins;
    uint8 receipts;
    PeragoTypes.MandateStatus terminalStatus;
}

/// @notice Stateful actor model for `MandateExecutor`: root owner, smart account, scoped
/// executor, attacker, adapter, and verifier drive arbitrary orderings of configure,
/// authorize, begin, perform, revoke, expire, stall, replay, and time advance.
/// @dev Every executor call is wrapped: the invariant suite runs with `fail_on_revert`,
/// so a rejected call is evidence the boundary held, not a broken sequence. Whatever a
/// call did to the mandate it touched is re-read from the contract in `_sync`, which is
/// where per-mandate safety is measured; the test contract asserts the aggregates.
contract MandateExecutorHandler is Test {
    uint48 public constant EXECUTION_WINDOW = 15 minutes;
    uint256 public constant ACCOUNT_FUNDING = 1e27;
    /// @notice Output the signed action always promises, so recipient credit is a literal
    /// expectation rather than a number measured by the code under test.
    uint256 public constant AMOUNT_OUT = 2e18;

    uint48 private constant PROOF_LIFETIME = 5 minutes;
    uint256 private constant MIN_OUTPUT = 1e18;
    uint256 private constant MAX_INPUT = 5e18;
    uint256 private constant ADAPTER_FUNDING = 1e27;
    uint256 private constant ROOT_OWNER_KEY = 0xA11CE;
    uint256 private constant SECOND_ROOT_OWNER_KEY = 0xB0B;
    uint256 private constant EXECUTOR_KEY = 0xE0E0;
    uint256 private constant SESSION_KEY = 0x5E5510;
    address private constant COMMERCE = address(0xC0FFEE);
    /// @dev Full adversarial ranges; `_arm` remaps the total-gas-burn slot for run time.
    uint256 private constant MAX_ADAPTER_MODE = uint256(MockPeragoAdapter.Mode.SHORT_OUTPUT);
    uint256 private constant MAX_VERIFIER_MODE = uint256(MockPeragoVerifier.Mode.REPORTS_MEASUREMENT);

    MandateExecutor public immutable executor;
    MockSwapAdapter public immutable swapAdapter;
    MockStakeAdapter public immutable stakeAdapter;
    MockPeragoVerifier public immutable swapVerifier;
    MockPeragoVerifier public immutable stakeVerifier;
    MockERC20 public immutable inputToken;
    MockERC20 public immutable outputToken;
    address public immutable executorSigner;
    address public immutable sessionSigner;

    address public constant account = address(0xACC0);
    address public constant attacker = address(0xBAD);
    address public constant secondRecipient = address(0xFEE5);

    // --- violation counters, each owned by one named invariant --------------------

    uint256 public staleAuthorizationsAccepted;
    uint256 public sessionSignedAuthorizationsAccepted;
    uint256 public sessionSignedProofsAccepted;
    uint256 public unauthorizedCallsAccepted;
    uint256 public duplicateAuthorizations;
    uint256 public duplicateBegins;
    uint256 public duplicateReceipts;
    uint256 public terminalTransitions;
    uint256 public unverifiedSuccesses;
    uint256 public settlementEvidenceWithoutSuccess;
    uint256 public unpinnedExecutionPairs;
    uint256 public jobBindingConflicts;
    uint256 public resurrectedNonces;
    uint256 public overspentAttempts;
    uint256 public successesBelowSignedMinimum;
    uint256 public nonAtomicFailures;

    // --- ledger ghosts ------------------------------------------------------------

    /// @notice Sum of the signed `maxInput` of every attempt the account actually made.
    uint256 public spendCeiling;
    /// @notice Output owed to the alternate signed recipient: `AMOUNT_OUT` per success.
    uint256 public secondRecipientCredits;
    uint256 public succeededMandates;

    bytes32[] private _hashes;
    uint256[] private _burnedNonces;
    mapping(bytes32 mandateHash => PeragoTypes.TaskMandate mandate) private _mandates;
    mapping(bytes32 mandateHash => bytes rootSignature) private _rootSignatures;
    mapping(bytes32 mandateHash => bytes action) private _actions;
    mapping(bytes32 mandateHash => MandateGhost ghost) private _ghosts;

    address private rootOwner;
    uint256 private rootOwnerKey;
    uint64 private ownerEpoch;
    bytes32 private policyHash;
    uint256 private nextNonce = 1;
    /// @dev The ERC-8183 job the last tracked mandate claimed, re-offered to later ones.
    uint256 private _lastJobId;

    constructor() {
        executorSigner = vm.addr(EXECUTOR_KEY);
        sessionSigner = vm.addr(SESSION_KEY);

        swapVerifier = new MockPeragoVerifier(keccak256("perago.verifier.swap.v1"));
        stakeVerifier = new MockPeragoVerifier(keccak256("perago.verifier.stake.v1"));
        swapAdapter = new MockSwapAdapter(address(swapVerifier));
        stakeAdapter = new MockStakeAdapter(address(stakeVerifier));
        executor = new MandateExecutor(address(swapAdapter), address(stakeAdapter), EXECUTION_WINDOW, false);

        inputToken = new MockERC20("Input", "IN");
        outputToken = new MockERC20("Output", "OUT");
        inputToken.mint(account, ACCOUNT_FUNDING);
        outputToken.mint(address(swapAdapter), ADAPTER_FUNDING);
        inputToken.mint(address(stakeAdapter), ADAPTER_FUNDING);

        rootOwnerKey = ROOT_OWNER_KEY;
        rootOwner = vm.addr(ROOT_OWNER_KEY);
        _setPolicy(ROOT_OWNER_KEY, 1, keccak256("policy.v1"));
    }

    // --- actions ------------------------------------------------------------------

    /// @notice Root owner rotates owner or policy, then the executor replays a mandate the
    /// previous configuration signed. Accepting it would mean a mutation did not end
    /// authority.
    function rotatePolicy(uint256 seed) external {
        PeragoTypes.TaskMandate memory stale = _newMandate(seed, false, false);
        bytes memory staleSignature = _sign(rootOwnerKey, executor.hashMandate(stale));

        uint256 nextKey = seed % 2 == 0 ? ROOT_OWNER_KEY : SECOND_ROOT_OWNER_KEY;
        _setPolicy(nextKey, ownerEpoch + 1, keccak256(abi.encode("policy", seed)));

        vm.prank(executorSigner);
        try executor.authorize(stale, staleSignature) {
            staleAuthorizationsAccepted += 1;
        } catch {}
    }

    /// @notice One root Task Mandate on the honest path.
    /// @dev Each adversarial variant is its own action rather than a branch keyed on the
    /// seed: the fuzzer chooses functions uniformly, but it reuses a small dictionary of
    /// argument values, so a `seed % n` branch is sampled far too rarely to be evidence.
    function authorize(uint256 seed) external {
        _authorize(seed, rootOwnerKey, executorSigner, false);
    }

    /// @notice A mandate signed by the scoped session key instead of the root owner.
    function authorizeWithSessionSignature(uint256 seed) external {
        _authorize(seed, SESSION_KEY, executorSigner, false);
    }

    /// @notice A valid root mandate submitted by an address the mandate never named.
    function authorizeFromUnnamedExecutor(uint256 seed) external {
        _authorize(seed, rootOwnerKey, attacker, false);
    }

    /// @notice A fresh, fully valid mandate that claims the ERC-8183 job an earlier
    /// mandate already bound.
    function authorizeReusingCommerceJob(uint256 seed) external {
        _authorize(seed, rootOwnerKey, executorSigner, true);
    }

    /// @notice Replays a stored root signature against an existing mandate.
    function replayAuthorization(uint256 target) external {
        bytes32 mandateHash = _pick(target);
        if (mandateHash == bytes32(0)) return;

        vm.prank(executorSigner);
        try executor.authorize(_mandates[mandateHash], _rootSignatures[mandateHash]) {
            _ghosts[mandateHash].authorizations += 1;
        } catch {}
        _sync(mandateHash);
    }

    function begin(uint256 target) external {
        _begin(target, executorSigner);
    }

    function beginFromAttacker(uint256 target) external {
        _begin(target, attacker);
    }

    /// @notice The smart account performs an attempt while the adapter and verifier are
    /// free to misbehave, and measures the account/recipient ledger around the call.
    function performAttempt(uint256 target, uint256 seed, uint8 adapterMode, uint8 verifierMode) external {
        bytes32 mandateHash = _pick(target);
        if (mandateHash == bytes32(0)) return;

        PeragoTypes.TaskMandate memory mandate = _mandates[mandateHash];
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, EXECUTOR_KEY);

        _arm(mandate, mandateHash, proof, proofSignature, adapterMode, verifierMode, seed);
        _submit(mandateHash, mandate, proof, proofSignature, false, false);
        _sync(mandateHash);
    }

    /// @notice The same attempt, proved by the session key instead of the executor the root
    /// owner named. Everything else is honest, so only root authority can reject it.
    function performWithForeignProof(uint256 target, uint256 seed) external {
        bytes32 mandateHash = _pick(target);
        if (mandateHash == bytes32(0)) return;

        PeragoTypes.TaskMandate memory mandate = _mandates[mandateHash];
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, SESSION_KEY);

        _arm(mandate, mandateHash, proof, proofSignature, 0, 0, seed);
        _submit(mandateHash, mandate, proof, proofSignature, true, false);
        _sync(mandateHash);
    }

    /// @notice An attempt submitted by someone other than the signed smart account.
    function performFromAttacker(uint256 target, uint256 seed) external {
        bytes32 mandateHash = _pick(target);
        if (mandateHash == bytes32(0)) return;

        PeragoTypes.TaskMandate memory mandate = _mandates[mandateHash];
        (PeragoTypes.ExecutionProof memory proof, bytes memory proofSignature) = _proof(mandateHash, EXECUTOR_KEY);

        _arm(mandate, mandateHash, proof, proofSignature, 0, 0, seed);
        _submit(mandateHash, mandate, proof, proofSignature, false, true);
        _sync(mandateHash);
    }

    /// @dev The account submits the attempt and the ledger is measured around it.
    function _submit(
        bytes32 mandateHash,
        PeragoTypes.TaskMandate memory mandate,
        PeragoTypes.ExecutionProof memory proof,
        bytes memory proofSignature,
        bool foreignProof,
        bool wrongCaller
    ) private {
        vm.prank(account);
        inputToken.approve(address(executor), mandate.maxInput);

        uint256 accountInputBefore = inputToken.balanceOf(account);
        uint256 recipientOutputBefore = outputToken.balanceOf(mandate.recipient);

        vm.prank(wrongCaller ? attacker : account);
        try executor.perform(mandate, _actions[mandateHash], proof, proofSignature) returns (
            PeragoTypes.MandateStatus status
        ) {
            if (wrongCaller) unauthorizedCallsAccepted += 1;
            if (foreignProof) sessionSignedProofsAccepted += 1;
            _ghosts[mandateHash].receipts += 1;
            spendCeiling += mandate.maxInput;
            _accountAttempt(mandate, status, accountInputBefore, recipientOutputBefore);
        } catch {}
    }

    function revokeAttempt(uint256 target) external {
        _revoke(target, account);
    }

    function revokeFromAttacker(uint256 target) external {
        _revoke(target, attacker);
    }

    /// @notice Permissionless closures are driven by the attacker on purpose: they may end
    /// authority, never extend or redirect it.
    function finalizeExpiredAttempt(uint256 target) external {
        bytes32 mandateHash = _pick(target);
        if (mandateHash == bytes32(0)) return;

        vm.prank(attacker);
        try executor.finalizeExpired(mandateHash) {} catch {}
        _sync(mandateHash);
    }

    function finalizeStalledAttempt(uint256 target) external {
        bytes32 mandateHash = _pick(target);
        if (mandateHash == bytes32(0)) return;

        vm.prank(attacker);
        try executor.finalizeStalledExecution(mandateHash) {
            _ghosts[mandateHash].receipts += 1;
        } catch {}
        _sync(mandateHash);
    }

    /// @notice The account burns fresh nonces; a burned nonce may never come back.
    function invalidateNonce(uint256 seed) external {
        uint256 count = bound(seed, 1, 2);
        uint256[] memory nonces = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            nonces[i] = nextNonce;
            nextNonce += 1;
        }

        vm.prank(account);
        try executor.invalidateNonces(nonces) {
            for (uint256 i = 0; i < count; ++i) {
                _burnedNonces.push(nonces[i]);
            }
        } catch {}
    }

    function advanceTime(uint256 seed) external {
        vm.warp(block.timestamp + bound(seed, 1 minutes, 20 minutes));
    }

    // --- views for the invariant suite ---------------------------------------------

    function mandateCount() external view returns (uint256) {
        return _hashes.length;
    }

    function mandateHashAt(uint256 index) external view returns (bytes32) {
        return _hashes[index];
    }

    function trackedMandate(bytes32 mandateHash) external view returns (PeragoTypes.TaskMandate memory) {
        return _mandates[mandateHash];
    }

    function ghostOf(bytes32 mandateHash) external view returns (MandateGhost memory) {
        return _ghosts[mandateHash];
    }

    function burnedNonceCount() external view returns (uint256) {
        return _burnedNonces.length;
    }

    function burnedNonceAt(uint256 index) external view returns (uint256) {
        return _burnedNonces[index];
    }

    // --- internals ------------------------------------------------------------------

    /// @dev One authorization attempt: `signingKey` decides whether root authority really
    /// signed it, `caller` whether the mandate named the submitter.
    function _authorize(uint256 seed, uint256 signingKey, address caller, bool reuseJob) private {
        PeragoTypes.TaskMandate memory mandate = _newMandate(seed, seed % 3 == 1, reuseJob);
        // The signed action often spends less than the cap, so the refund path and any
        // allowance the executor forgets to clear are both reachable.
        bytes memory action = abi.encode(bound(seed >> 32, mandate.maxInput / 4, mandate.maxInput), AMOUNT_OUT);
        mandate.actionHash = keccak256(action);
        bytes memory signature = _sign(signingKey, executor.hashMandate(mandate));

        vm.prank(caller);
        try executor.authorize(mandate, signature) returns (bytes32 mandateHash) {
            if (signingKey == SESSION_KEY) sessionSignedAuthorizationsAccepted += 1;
            if (caller != mandate.executor) unauthorizedCallsAccepted += 1;
            _track(mandateHash, mandate, action, signature);
            _sync(mandateHash);
        } catch {}
    }

    function _begin(uint256 target, address caller) private {
        bytes32 mandateHash = _pick(target);
        if (mandateHash == bytes32(0)) return;

        vm.prank(caller);
        try executor.beginExecution(mandateHash) {
            if (caller != executorSigner) unauthorizedCallsAccepted += 1;
            _ghosts[mandateHash].begins += 1;
        } catch {}
        _sync(mandateHash);
    }

    function _revoke(uint256 target, address caller) private {
        bytes32 mandateHash = _pick(target);
        if (mandateHash == bytes32(0)) return;

        vm.prank(caller);
        try executor.revoke(mandateHash) {
            if (caller != account) unauthorizedCallsAccepted += 1;
        } catch {}
        _sync(mandateHash);
    }

    /// @dev Re-reads the touched mandate and measures every per-mandate safety property
    /// the specification names, so a violation is attributed to the call that caused it.
    function _sync(bytes32 mandateHash) private {
        MandateGhost storage ghost = _ghosts[mandateHash];
        PeragoTypes.MandateRecord memory record = executor.mandateRecord(mandateHash);
        PeragoTypes.TaskMandate memory mandate = _mandates[mandateHash];

        if (ghost.authorizations > 1) duplicateAuthorizations += 1;
        if (ghost.begins > 1) duplicateBegins += 1;
        if (ghost.receipts > 1) duplicateReceipts += 1;

        if (_isTerminal(record.status)) {
            if (_isTerminal(ghost.terminalStatus)) {
                if (ghost.terminalStatus != record.status) terminalTransitions += 1;
            } else {
                ghost.terminalStatus = record.status;
            }
        } else if (_isTerminal(ghost.terminalStatus)) {
            terminalTransitions += 1;
        }

        if (record.status == PeragoTypes.MandateStatus.SUCCEEDED) {
            if (record.verificationHash == bytes32(0) || record.failureReasonHash != bytes32(0)) {
                unverifiedSuccesses += 1;
            }
        } else if (record.verificationHash != bytes32(0)) {
            settlementEvidenceWithoutSuccess += 1;
        } else if (record.status == PeragoTypes.MandateStatus.FAILED && record.failureReasonHash == bytes32(0)) {
            settlementEvidenceWithoutSuccess += 1;
        }

        bool pinned = (record.adapter == address(swapAdapter) && record.verifier == address(swapVerifier))
            || (record.adapter == address(stakeAdapter) && record.verifier == address(stakeVerifier));
        if (!pinned || record.adapter != mandate.adapter) unpinnedExecutionPairs += 1;

        if (executor.commerceJobBinding(mandate.commerceContract, mandate.commerceJobId) != mandateHash) {
            jobBindingConflicts += 1;
        }
        if (!executor.isNonceUsed(mandate.account, mandate.nonce)) resurrectedNonces += 1;
    }

    /// @dev Measures the account and recipient ledger around one attempt: an admissible
    /// attempt may spend at most the signed input, must credit at least the signed minimum
    /// on success, and must move nothing at all when it ends `FAILED`.
    function _accountAttempt(
        PeragoTypes.TaskMandate memory mandate,
        PeragoTypes.MandateStatus status,
        uint256 accountInputBefore,
        uint256 recipientOutputBefore
    ) private {
        uint256 accountInputAfter = inputToken.balanceOf(account);
        uint256 spent = accountInputBefore > accountInputAfter ? accountInputBefore - accountInputAfter : 0;
        if (spent > mandate.maxInput) overspentAttempts += 1;

        uint256 recipientOutputAfter = outputToken.balanceOf(mandate.recipient);

        if (status == PeragoTypes.MandateStatus.SUCCEEDED) {
            succeededMandates += 1;
            if (mandate.outputToken == address(outputToken)) {
                if (recipientOutputAfter - recipientOutputBefore < mandate.minOutput) {
                    successesBelowSignedMinimum += 1;
                }
                if (mandate.recipient == secondRecipient) secondRecipientCredits += AMOUNT_OUT;
            }
            return;
        }

        if (accountInputAfter != accountInputBefore || recipientOutputAfter != recipientOutputBefore) {
            nonAtomicFailures += 1;
        }
    }

    function _arm(
        PeragoTypes.TaskMandate memory mandate,
        bytes32 mandateHash,
        PeragoTypes.ExecutionProof memory proof,
        bytes memory proofSignature,
        uint8 adapterMode,
        uint8 verifierMode,
        uint256 seed
    ) private {
        MockPeragoAdapter.Mode mode = MockPeragoAdapter.Mode(bound(adapterMode, 0, MAX_ADAPTER_MODE));
        // Total-gas-burn costs a whole block per call; it is covered deterministically in
        // `MandateExecutorExecutionTest`, so stateful runs spend that slot on the honest path.
        if (mode == MockPeragoAdapter.Mode.BURN_ALL_GAS) mode = MockPeragoAdapter.Mode.HONEST;

        MockPeragoAdapter adapter = MockPeragoAdapter(mandate.adapter);
        adapter.setMode(mode);
        if (mode == MockPeragoAdapter.Mode.REENTER_EXECUTOR) {
            bytes memory reentry = seed % 2 == 0
                ? abi.encodeCall(MandateExecutor.revoke, (mandateHash))
                : abi.encodeCall(MandateExecutor.perform, (mandate, _actions[mandateHash], proof, proofSignature));
            adapter.setReentry(address(executor), reentry);
        }

        MockPeragoVerifier verifier = mandate.adapter == address(swapAdapter) ? swapVerifier : stakeVerifier;
        // An under-delivering protocol is paired with a verifier that reports the truth
        // instead of rejecting it: otherwise the mock, not the executor, would be the
        // thing enforcing `minOutput`, and the contract's own guard would go unmeasured.
        verifier.setMode(
            mode == MockPeragoAdapter.Mode.SHORT_OUTPUT
                ? MockPeragoVerifier.Mode.REPORTS_MEASUREMENT
                : MockPeragoVerifier.Mode(bound(verifierMode, 0, MAX_VERIFIER_MODE))
        );
    }

    function _track(
        bytes32 mandateHash,
        PeragoTypes.TaskMandate memory mandate,
        bytes memory action,
        bytes memory signature
    ) private {
        if (_ghosts[mandateHash].authorizations == 0) {
            _hashes.push(mandateHash);
            _mandates[mandateHash] = mandate;
            _actions[mandateHash] = action;
            _rootSignatures[mandateHash] = signature;
            _burnedNonces.push(mandate.nonce);
            _lastJobId = mandate.commerceJobId;
        }
        _ghosts[mandateHash].authorizations += 1;
    }

    function _newMandate(uint256 seed, bool stake, bool reuseJob)
        private
        returns (PeragoTypes.TaskMandate memory mandate)
    {
        uint256 nonce = nextNonce;
        nextNonce += 1;

        mandate = PeragoTypes.TaskMandate({
            account: account,
            rootOwner: rootOwner,
            ownerEpoch: ownerEpoch,
            executor: executorSigner,
            chainId: block.chainid,
            nonce: nonce,
            expiresAt: uint48(block.timestamp + bound(seed, 5 minutes, 30 minutes)),
            policyHash: policyHash,
            intentHash: keccak256("intent"),
            planHash: keccak256("plan"),
            simulationHash: keccak256("simulation"),
            adapter: stake ? address(stakeAdapter) : address(swapAdapter),
            adapterSelector: IPeragoAdapter.execute.selector,
            inputToken: address(inputToken),
            maxInput: bound(seed >> 8, 1e18, MAX_INPUT),
            // A stake mandate keeps the position in the same asset; a swap must cross two.
            outputToken: stake ? address(inputToken) : address(outputToken),
            minOutput: MIN_OUTPUT,
            recipient: (!stake && seed % 5 == 1) ? secondRecipient : account,
            actionHash: keccak256("action"),
            postconditionHash: keccak256("postcondition"),
            commerceContract: COMMERCE,
            // Each mandate claims its own ERC-8183 job, except when the sequence
            // deliberately re-claims the job a previous mandate already bound.
            commerceJobId: (reuseJob && _lastJobId != 0) ? _lastJobId : nonce
        });
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
        signature = _sign(key, executor.hashExecutionProof(proof));
    }

    function _setPolicy(uint256 ownerKey, uint64 epoch, bytes32 nextPolicyHash) private {
        PeragoTypes.AccountPolicy memory policy = PeragoTypes.AccountPolicy({
            account: account,
            rootOwner: vm.addr(ownerKey),
            ownerEpoch: epoch,
            chainId: block.chainid,
            policyHash: nextPolicyHash,
            permissionHash: keccak256(abi.encode("permission", epoch)),
            validUntil: uint48(block.timestamp) + 30 days
        });

        // The digest read is an external call, so it is taken before the prank: otherwise
        // the account impersonation lands on `hashAccountPolicy` instead of the write.
        bytes memory rootSignature = _sign(ownerKey, executor.hashAccountPolicy(policy));

        vm.prank(account);
        executor.setAccountPolicy(policy, rootSignature);

        rootOwnerKey = ownerKey;
        rootOwner = policy.rootOwner;
        ownerEpoch = epoch;
        policyHash = nextPolicyHash;
    }

    function _pick(uint256 seed) private view returns (bytes32) {
        if (_hashes.length == 0) return bytes32(0);
        return _hashes[seed % _hashes.length];
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _isTerminal(PeragoTypes.MandateStatus status) private pure returns (bool) {
        return status == PeragoTypes.MandateStatus.SUCCEEDED || status == PeragoTypes.MandateStatus.FAILED
            || status == PeragoTypes.MandateStatus.REVOKED || status == PeragoTypes.MandateStatus.EXPIRED;
    }
}
