// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPeragoAdapter} from "./interfaces/IPeragoAdapter.sol";
import {IPeragoVerifier} from "./interfaces/IPeragoVerifier.sol";
import {PeragoTypes} from "./types/PeragoTypes.sol";

/// @title MandateExecutor
/// @notice The semantic authority boundary of Perago: it registers root-owned accounts,
/// verifies root EIP-712 Task Mandates, consumes their nonces once, and ends authority
/// permanently. Account modules, bundler validation, and paymaster policy are defense in
/// depth around this contract, never a substitute for it.
/// @dev Non-upgradeable with a frozen storage layout. There is no admin, pause, sweep,
/// nonce reset, or settlement override, by specification.
contract MandateExecutor is ReentrancyGuard {
    using ECDSA for bytes32;

    /// @notice Ceiling for the constructor-pinned execution window. The deployment supplies
    /// the measured value; this bound keeps a stalled execution from outliving a mandate.
    uint48 public constant MAX_EXECUTION_WINDOW = 1 hours;

    /// @notice Reason commitment written when the execution window closes with no receipt.
    bytes32 public constant STALLED_FAILURE_REASON = keccak256("perago.failure.stalled.v1");

    /// @notice Bytes of adapter or verifier revert data hashed into a failure reason. The
    /// executor never parses revert data; it commits a bounded prefix and its true length,
    /// so an oversized payload cannot price the failure record out of the block.
    uint256 public constant MAX_REASON_BYTES = 256;

    /// @dev Gas withheld from the effects subcall so the terminal `FAILED` record and its
    /// event always fit, even when the adapter consumes everything it is given. The 63/64
    /// rule alone leaves a stipend proportional to the call, not to this write.
    uint256 private constant FAILURE_RECORD_GAS = 60_000;

    bytes32 private constant TASK_MANDATE_TYPEHASH = keccak256(
        "TaskMandate(address account,address rootOwner,uint64 ownerEpoch,address executor,uint256 chainId,uint256 nonce,uint48 expiresAt,bytes32 policyHash,bytes32 intentHash,bytes32 planHash,bytes32 simulationHash,address adapter,bytes4 adapterSelector,address inputToken,uint256 maxInput,address outputToken,uint256 minOutput,address recipient,bytes32 actionHash,bytes32 postconditionHash,address commerceContract,uint256 commerceJobId)"
    );
    bytes32 private constant ACCOUNT_POLICY_TYPEHASH = keccak256(
        "AccountPolicy(address account,address rootOwner,uint64 ownerEpoch,uint256 chainId,bytes32 policyHash,bytes32 permissionHash,uint48 validUntil)"
    );
    bytes32 private constant EXECUTION_PROOF_TYPEHASH =
        keccak256("ExecutionProof(bytes32 mandateHash,address account,address executor,uint48 validUntil)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant DOMAIN_NAME_HASH = keccak256("Perago");
    bytes32 private constant DOMAIN_VERSION_HASH = keccak256("1");

    /// @notice The only adapter allowed to carry a swap action, pinned at construction.
    address public immutable swapAdapter;
    /// @notice The only adapter allowed to carry a stake action, pinned at construction.
    address public immutable stakeAdapter;
    /// @notice The verifier paired with `swapAdapter`, read from the adapter at construction.
    address public immutable swapVerifier;
    /// @notice The verifier paired with `stakeAdapter`, read from the adapter at construction.
    address public immutable stakeVerifier;
    /// @notice Seconds after `beginExecution` before a stalled execution is terminally failed.
    uint48 public immutable executionWindow;
    /// @notice Local and fork deployments may authorize mandates with no ERC-8183 job.
    /// A live deployment sets this to false, so every mandate carries a verified job binding.
    bool public immutable allowUnboundCommerceJobs;

    uint256 private immutable _deploymentChainId;
    bytes32 private immutable _deploymentDomainSeparator;

    mapping(address account => PeragoTypes.AccountConfig config) private _accountConfigs;
    mapping(address account => mapping(uint256 nonce => bool used)) private _usedNonce;
    mapping(bytes32 mandateHash => PeragoTypes.MandateRecord record) private _mandates;
    mapping(address commerceContract => mapping(uint256 jobId => bytes32 mandateHash)) private _jobBindings;

    event AccountPolicySet(
        address indexed account,
        address indexed rootOwner,
        uint64 ownerEpoch,
        bytes32 policyHash,
        bytes32 permissionHash
    );
    event NoncesInvalidated(address indexed account, uint256[] nonces);
    event MandateAuthorized(
        bytes32 indexed mandateHash, address indexed account, address indexed executor, uint256 nonce, uint48 expiresAt
    );
    event MandateRevoked(bytes32 indexed mandateHash, address indexed account);
    event MandateExpired(bytes32 indexed mandateHash);
    event CommerceJobBound(address indexed commerceContract, uint256 indexed jobId, bytes32 indexed mandateHash);
    event ExecutionBegun(bytes32 indexed mandateHash, uint48 startedAt);
    event ExecutionReceiptRecorded(
        bytes32 indexed mandateHash,
        PeragoTypes.MandateStatus status,
        bytes32 verificationHash,
        bytes32 failureReasonHash
    );

    error InvalidDeploymentPair();
    error InvalidExecutionWindow();
    error UnsupportedAccount();
    error WrongAccountCaller();
    error WrongChain();
    error WrongExecutor();
    error WrongSelector();
    error UnsupportedAdapter();
    error InvalidRootSignature();
    error RootOwnerMismatch();
    error OwnerEpochMismatch();
    error PolicyHashMismatch();
    error PermissionHashMismatch();
    error InvalidPolicyField();
    error InvalidMandateField();
    error InvalidTokenPair();
    error AmountOutOfBounds();
    error ExpiredPolicy();
    error ExpiredMandate();
    error MandateNotExpired();
    error NonceAlreadyUsed();
    error MandateAlreadyExists();
    error InvalidTransition();
    error CommerceJobAlreadyBound();
    error CommerceBindingRequired();
    error ExecutionNotStarted();
    error ExecutionWindowElapsed();
    error InsufficientGasBudget();
    error InvalidExecutorProof();
    error ActionHashMismatch();
    error VerificationFailed();
    error PostconditionHashMismatch();
    error RecipientMismatch();
    error AllowanceNotCleared();
    error ResidualBalance();
    error OnlySelf();

    /// @param swapAdapter_ deployment-pinned swap adapter; its verifier is read, not passed
    /// @param stakeAdapter_ deployment-pinned stake adapter; its verifier is read, not passed
    /// @param executionWindow_ measured stalled-execution horizon, at most `MAX_EXECUTION_WINDOW`
    /// @param allowUnboundCommerceJobs_ true only for explicitly configured local/fork deployments
    constructor(address swapAdapter_, address stakeAdapter_, uint48 executionWindow_, bool allowUnboundCommerceJobs_) {
        if (swapAdapter_ == address(0) || stakeAdapter_ == address(0) || swapAdapter_ == stakeAdapter_) {
            revert InvalidDeploymentPair();
        }
        if (executionWindow_ == 0 || executionWindow_ > MAX_EXECUTION_WINDOW) revert InvalidExecutionWindow();
        if (
            IPeragoAdapter(swapAdapter_).kind() != PeragoTypes.SWAP_ADAPTER_KIND
                || IPeragoAdapter(stakeAdapter_).kind() != PeragoTypes.STAKE_ADAPTER_KIND
        ) {
            revert InvalidDeploymentPair();
        }

        address swapVerifier_ = IPeragoAdapter(swapAdapter_).verifier();
        address stakeVerifier_ = IPeragoAdapter(stakeAdapter_).verifier();
        // The specification requires two separate verifiers: one measures an output-token
        // delta, the other a staking position.
        if (swapVerifier_ == address(0) || stakeVerifier_ == address(0) || swapVerifier_ == stakeVerifier_) {
            revert InvalidDeploymentPair();
        }

        swapAdapter = swapAdapter_;
        stakeAdapter = stakeAdapter_;
        swapVerifier = swapVerifier_;
        stakeVerifier = stakeVerifier_;
        executionWindow = executionWindow_;
        allowUnboundCommerceJobs = allowUnboundCommerceJobs_;
        _deploymentChainId = block.chainid;
        _deploymentDomainSeparator = _computeDomainSeparator(block.chainid);
    }

    // --- views ---------------------------------------------------------------

    /// @notice EIP-712 domain separator; recomputed when the chain id differs from deployment.
    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _deploymentChainId ? _deploymentDomainSeparator : _computeDomainSeparator(block.chainid);
    }

    /// @notice The digest the root owner signs for a Task Mandate.
    function hashMandate(PeragoTypes.TaskMandate calldata mandate) public view returns (bytes32) {
        return _digest(_hashMandateStruct(mandate));
    }

    /// @notice The digest the root owner signs to register an account policy.
    function hashAccountPolicy(PeragoTypes.AccountPolicy calldata policy) public view returns (bytes32) {
        return _digest(
            keccak256(
                abi.encode(
                    ACCOUNT_POLICY_TYPEHASH,
                    policy.account,
                    policy.rootOwner,
                    policy.ownerEpoch,
                    policy.chainId,
                    policy.policyHash,
                    policy.permissionHash,
                    policy.validUntil
                )
            )
        );
    }

    /// @notice The digest the scoped executor signs to prove it drove one execution.
    function hashExecutionProof(PeragoTypes.ExecutionProof calldata proof) public view returns (bytes32) {
        return _digest(
            keccak256(
                abi.encode(EXECUTION_PROOF_TYPEHASH, proof.mandateHash, proof.account, proof.executor, proof.validUntil)
            )
        );
    }

    function accountConfig(address account) external view returns (PeragoTypes.AccountConfig memory) {
        return _accountConfigs[account];
    }

    /// @notice Registration status is derived from the stored root owner; there is no flag to desynchronize.
    function isRegistered(address account) public view returns (bool) {
        return _accountConfigs[account].rootOwner != address(0);
    }

    function isNonceUsed(address account, uint256 nonce) external view returns (bool) {
        return _usedNonce[account][nonce];
    }

    function mandateRecord(bytes32 mandateHash) external view returns (PeragoTypes.MandateRecord memory) {
        return _mandates[mandateHash];
    }

    function commerceJobBinding(address commerceContract, uint256 jobId) external view returns (bytes32) {
        return _jobBindings[commerceContract][jobId];
    }

    // --- account registration -------------------------------------------------

    /// @notice Registers or replaces the root owner, owner epoch, policy commitment, and
    /// session-permission commitment for the calling smart account.
    /// @dev A new root owner requires a strictly greater epoch; a policy-only change may
    /// reuse the current epoch. Either way, mandates signed against the previous owner or
    /// policy stop being authorizable.
    function setAccountPolicy(PeragoTypes.AccountPolicy calldata policy, bytes calldata rootSignature) external {
        if (msg.sender != policy.account) revert WrongAccountCaller();
        if (policy.chainId != block.chainid) revert WrongChain();
        if (policy.rootOwner == address(0) || policy.ownerEpoch == 0) revert InvalidPolicyField();
        if (policy.policyHash == bytes32(0) || policy.permissionHash == bytes32(0)) revert InvalidPolicyField();
        if (policy.validUntil <= block.timestamp) revert ExpiredPolicy();

        PeragoTypes.AccountConfig storage config = _accountConfigs[policy.account];
        if (config.rootOwner != address(0)) {
            bool sameOwner = config.rootOwner == policy.rootOwner;
            if (sameOwner ? policy.ownerEpoch < config.ownerEpoch : policy.ownerEpoch <= config.ownerEpoch) {
                revert OwnerEpochMismatch();
            }
        }

        _requireRootSignature(hashAccountPolicy(policy), rootSignature, policy.rootOwner);

        config.rootOwner = policy.rootOwner;
        config.ownerEpoch = policy.ownerEpoch;
        config.activePolicyHash = policy.policyHash;
        config.permissionHash = policy.permissionHash;

        emit AccountPolicySet(
            policy.account, policy.rootOwner, policy.ownerEpoch, policy.policyHash, policy.permissionHash
        );
    }

    /// @notice Burns unused nonces so mandates signed against them can never be authorized.
    /// @dev Root authorization comes from the account call itself; the account's root
    /// validation is what admits this call.
    function invalidateNonces(uint256[] calldata nonces) external {
        if (!isRegistered(msg.sender)) revert UnsupportedAccount();
        for (uint256 i = 0; i < nonces.length; ++i) {
            if (_usedNonce[msg.sender][nonces[i]]) revert NonceAlreadyUsed();
            _usedNonce[msg.sender][nonces[i]] = true;
        }
        emit NoncesInvalidated(msg.sender, nonces);
    }

    // --- authorization --------------------------------------------------------

    /// @notice Consumes one root Task Mandate and records it as `AUTHORIZED`.
    /// @dev Performs no token or protocol call. The nonce is burned before the status is
    /// written, so a later transport failure can never resurrect the root signature.
    function authorize(PeragoTypes.TaskMandate calldata mandate, bytes calldata rootSignature)
        external
        returns (bytes32 mandateHash)
    {
        if (msg.sender != mandate.executor) revert WrongExecutor();
        if (mandate.chainId != block.chainid) revert WrongChain();
        if (mandate.expiresAt <= block.timestamp) revert ExpiredMandate();
        _requireMandateShape(mandate);

        address verifier = _requireAdapterPair(mandate);

        PeragoTypes.AccountConfig storage config = _accountConfigs[mandate.account];
        if (config.rootOwner == address(0)) revert UnsupportedAccount();
        if (config.rootOwner != mandate.rootOwner) revert RootOwnerMismatch();
        if (config.ownerEpoch != mandate.ownerEpoch) revert OwnerEpochMismatch();
        if (config.activePolicyHash != mandate.policyHash) revert PolicyHashMismatch();
        if (config.permissionHash == bytes32(0)) revert PermissionHashMismatch();

        // Specification order: the nonce is the stricter replay guard, so a reused nonce
        // must report itself before the ERC-8183 job binding does.
        if (_usedNonce[mandate.account][mandate.nonce]) revert NonceAlreadyUsed();
        if (
            mandate.commerceContract != address(0)
                && _jobBindings[mandate.commerceContract][mandate.commerceJobId] != bytes32(0)
        ) {
            revert CommerceJobAlreadyBound();
        }

        mandateHash = hashMandate(mandate);
        if (_mandates[mandateHash].status != PeragoTypes.MandateStatus.NONE) revert MandateAlreadyExists();

        _requireRootSignature(mandateHash, rootSignature, mandate.rootOwner);

        _usedNonce[mandate.account][mandate.nonce] = true;

        PeragoTypes.MandateRecord storage record = _mandates[mandateHash];
        record.account = mandate.account;
        record.expiresAt = mandate.expiresAt;
        record.status = PeragoTypes.MandateStatus.AUTHORIZED;
        record.executor = mandate.executor;
        record.adapter = mandate.adapter;
        record.verifier = verifier;
        record.commerceContract = mandate.commerceContract;
        record.commerceJobId = mandate.commerceJobId;

        if (mandate.commerceContract != address(0)) {
            _jobBindings[mandate.commerceContract][mandate.commerceJobId] = mandateHash;
            emit CommerceJobBound(mandate.commerceContract, mandate.commerceJobId, mandateHash);
        }

        emit MandateAuthorized(mandateHash, mandate.account, mandate.executor, mandate.nonce, mandate.expiresAt);
    }

    // --- accepted attempt -----------------------------------------------------

    /// @notice The signed executor commits the one execution attempt this mandate allows.
    /// @dev A separate transaction on purpose: `EXECUTING` and `executionStartedAt` are
    /// written before any smart-account or protocol call, so a reverting attempt cannot
    /// roll back its own nonce and make the root signature reusable.
    function beginExecution(bytes32 mandateHash) external {
        PeragoTypes.MandateRecord storage record = _mandates[mandateHash];
        if (record.status != PeragoTypes.MandateStatus.AUTHORIZED) revert InvalidTransition();
        if (msg.sender != record.executor) revert WrongExecutor();
        if (block.timestamp >= record.expiresAt) revert ExpiredMandate();

        record.status = PeragoTypes.MandateStatus.EXECUTING;
        record.executionStartedAt = uint48(block.timestamp);
        emit ExecutionBegun(mandateHash, uint48(block.timestamp));
    }

    /// @notice The smart account performs the accepted attempt and receives its terminal
    /// status. Reverts only when the attempt was never admissible; an admissible attempt
    /// that fails downstream is recorded as `FAILED`, never retried.
    function perform(
        PeragoTypes.TaskMandate calldata mandate,
        bytes calldata action,
        PeragoTypes.ExecutionProof calldata proof,
        bytes calldata proofSignature
    ) external nonReentrant returns (PeragoTypes.MandateStatus) {
        bytes32 mandateHash = hashMandate(mandate);
        PeragoTypes.MandateRecord storage record = _mandates[mandateHash];
        if (record.status == PeragoTypes.MandateStatus.AUTHORIZED) revert ExecutionNotStarted();
        if (record.status != PeragoTypes.MandateStatus.EXECUTING) revert InvalidTransition();
        if (msg.sender != record.account) revert WrongAccountCaller();
        if (block.timestamp >= record.expiresAt) revert ExpiredMandate();
        if (block.timestamp > uint256(record.executionStartedAt) + executionWindow) revert ExecutionWindowElapsed();
        if (keccak256(action) != mandate.actionHash) revert ActionHashMismatch();
        _requireExecutorProof(mandateHash, record.executor, proof, proofSignature);

        uint256 available = gasleft();
        if (available <= FAILURE_RECORD_GAS * 2) revert InsufficientGasBudget();
        (bool succeeded,) = address(this).call{gas: available - FAILURE_RECORD_GAS}(
            abi.encodeCall(this.executeCore, (mandateHash, mandate, action))
        );

        if (succeeded) {
            // `executeCore` writes the receipt inside the subcall that verified it, so
            // `SUCCEEDED` can never exist without a passing verifier measurement.
            if (record.status != PeragoTypes.MandateStatus.SUCCEEDED) revert VerificationFailed();
            return PeragoTypes.MandateStatus.SUCCEEDED;
        }

        bytes32 failureReasonHash = _boundedRevertCommitment();
        record.status = PeragoTypes.MandateStatus.FAILED;
        record.failureReasonHash = failureReasonHash;
        emit ExecutionReceiptRecorded(mandateHash, PeragoTypes.MandateStatus.FAILED, bytes32(0), failureReasonHash);
        return PeragoTypes.MandateStatus.FAILED;
    }

    /// @notice The effects boundary, reachable only through `perform`'s self-call. Every
    /// token movement, approval, and protocol call lives here, so one revert rolls all of
    /// them back while the outer frame still records the terminal receipt.
    function executeCore(bytes32 mandateHash, PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
    {
        if (msg.sender != address(this)) revert OnlySelf();

        PeragoTypes.MandateRecord storage record = _mandates[mandateHash];
        address adapter = record.adapter;
        address verifier = record.verifier;
        IERC20 inputToken = IERC20(mandate.inputToken);

        // The adapter must normalize the signed action to the same commitment the root
        // owner approved; a different reading of the same bytes is not this action.
        if (IPeragoAdapter(adapter).validate(mandate, action) != mandate.actionHash) revert ActionHashMismatch();

        uint256 heldBefore = inputToken.balanceOf(address(this));
        SafeERC20.safeTransferFrom(inputToken, mandate.account, address(this), mandate.maxInput);

        (uint256 beforeValue, bytes32 beforeContext) = IPeragoVerifier(verifier).measure(mandate, action);

        SafeERC20.forceApprove(inputToken, adapter, mandate.maxInput);
        PeragoTypes.AdapterResult memory result = IPeragoAdapter(adapter).execute(mandate, action);
        SafeERC20.forceApprove(inputToken, adapter, 0);
        if (inputToken.allowance(address(this), adapter) != 0) revert AllowanceNotCleared();

        // Input spend is measured here, never taken from the adapter's self-report.
        uint256 heldAfter = inputToken.balanceOf(address(this));
        uint256 measuredSpend = heldBefore + mandate.maxInput - heldAfter;
        if (measuredSpend > mandate.maxInput) revert AmountOutOfBounds();

        PeragoTypes.VerificationEvidence memory evidence =
            IPeragoVerifier(verifier).verify(mandate, action, beforeValue, beforeContext, result);
        if (evidence.inputSpent > mandate.maxInput) revert AmountOutOfBounds();
        if (evidence.observedOutputOrPositionDelta < mandate.minOutput) revert VerificationFailed();
        // The adapter may not claim more than the verifier measured.
        if (result.outputOrPositionReceived > evidence.observedOutputOrPositionDelta) revert VerificationFailed();
        if (evidence.evidenceHash != _evidenceCommitment(mandate, evidence, result)) {
            revert PostconditionHashMismatch();
        }

        // Unspent input goes back to the signed account; protocol output was sent straight
        // to the signed recipient, so nothing of the user's may remain here.
        if (heldAfter != 0) SafeERC20.safeTransfer(inputToken, mandate.account, heldAfter);
        if (inputToken.balanceOf(address(this)) != 0) revert ResidualBalance();
        if (IERC20(mandate.outputToken).balanceOf(address(this)) != 0) revert RecipientMismatch();

        bytes32 verificationHash = keccak256(
            abi.encode(
                mandateHash,
                measuredSpend,
                evidence.observedOutputOrPositionDelta,
                evidence.evidenceHash,
                result.protocolEvidenceHash
            )
        );
        record.status = PeragoTypes.MandateStatus.SUCCEEDED;
        record.verificationHash = verificationHash;
        emit ExecutionReceiptRecorded(mandateHash, PeragoTypes.MandateStatus.SUCCEEDED, verificationHash, bytes32(0));
    }

    // --- terminal transitions -------------------------------------------------

    /// @notice The account ends an authorized mandate before it is executed.
    function revoke(bytes32 mandateHash) external {
        PeragoTypes.MandateRecord storage record = _mandates[mandateHash];
        if (record.status != PeragoTypes.MandateStatus.AUTHORIZED) revert InvalidTransition();
        if (msg.sender != record.account) revert WrongAccountCaller();

        record.status = PeragoTypes.MandateStatus.REVOKED;
        emit MandateRevoked(mandateHash, record.account);
    }

    /// @notice Permissionless: an expired authorization is closed by anyone, never by a
    /// hook, bundler, paymaster, executor API, or model.
    function finalizeExpired(bytes32 mandateHash) external {
        PeragoTypes.MandateRecord storage record = _mandates[mandateHash];
        if (record.status != PeragoTypes.MandateStatus.AUTHORIZED) revert InvalidTransition();
        if (block.timestamp < record.expiresAt) revert MandateNotExpired();

        record.status = PeragoTypes.MandateStatus.EXPIRED;
        emit MandateExpired(mandateHash);
    }

    /// @notice Permissionless: an accepted attempt that never returned a receipt is failed
    /// once its window closes. Authority ends either way, so anyone may close the record.
    function finalizeStalledExecution(bytes32 mandateHash) external {
        PeragoTypes.MandateRecord storage record = _mandates[mandateHash];
        if (record.status != PeragoTypes.MandateStatus.EXECUTING) revert InvalidTransition();
        if (block.timestamp <= uint256(record.executionStartedAt) + executionWindow) revert MandateNotExpired();

        record.status = PeragoTypes.MandateStatus.FAILED;
        record.failureReasonHash = STALLED_FAILURE_REASON;
        emit ExecutionReceiptRecorded(mandateHash, PeragoTypes.MandateStatus.FAILED, bytes32(0), STALLED_FAILURE_REASON);
    }

    // --- internals ------------------------------------------------------------

    /// @dev The executor proof survives ERC-4337 call indirection: `perform` sees the
    /// account as its caller, so the scoped executor's own short-lived signature is what
    /// ties this attempt to the executor the root owner named.
    function _requireExecutorProof(
        bytes32 mandateHash,
        address expectedExecutor,
        PeragoTypes.ExecutionProof calldata proof,
        bytes calldata signature
    ) private view {
        if (proof.mandateHash != mandateHash || proof.account != msg.sender || proof.executor != expectedExecutor) {
            revert InvalidExecutorProof();
        }
        if (proof.validUntil <= block.timestamp) revert InvalidExecutorProof();

        (address recovered, ECDSA.RecoverError err,) = hashExecutionProof(proof).tryRecoverCalldata(signature);
        if (err != ECDSA.RecoverError.NoError || recovered != expectedExecutor) revert InvalidExecutorProof();
    }

    /// @dev The verifier must bind its measurement to this mandate's postcondition, so
    /// evidence measured for one mandate can never settle another.
    function _evidenceCommitment(
        PeragoTypes.TaskMandate calldata mandate,
        PeragoTypes.VerificationEvidence memory evidence,
        PeragoTypes.AdapterResult memory result
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                mandate.postconditionHash,
                evidence.inputSpent,
                evidence.observedOutputOrPositionDelta,
                result.protocolEvidenceHash
            )
        );
    }

    /// @dev Commits a bounded prefix of the subcall's revert data plus its true length.
    /// Reason codes are mapped offchain from this hash; revert data is never parsed here,
    /// because a hostile adapter chooses its size.
    function _boundedRevertCommitment() private pure returns (bytes32) {
        uint256 size;
        assembly ("memory-safe") {
            size := returndatasize()
        }
        uint256 copied = size > MAX_REASON_BYTES ? MAX_REASON_BYTES : size;
        bytes memory reason = new bytes(copied);
        assembly ("memory-safe") {
            returndatacopy(add(reason, 0x20), 0, copied)
        }
        return keccak256(abi.encode(size, reason));
    }

    function _requireMandateShape(PeragoTypes.TaskMandate calldata mandate) private view {
        if (mandate.account == address(0) || mandate.rootOwner == address(0) || mandate.executor == address(0)) {
            revert InvalidMandateField();
        }
        if (mandate.recipient == address(0) || mandate.inputToken == address(0) || mandate.outputToken == address(0)) {
            revert InvalidMandateField();
        }
        if (
            mandate.policyHash == bytes32(0) || mandate.intentHash == bytes32(0) || mandate.planHash == bytes32(0)
                || mandate.simulationHash == bytes32(0) || mandate.actionHash == bytes32(0)
                || mandate.postconditionHash == bytes32(0)
        ) {
            revert InvalidMandateField();
        }
        if (mandate.maxInput == 0 || mandate.minOutput == 0) revert AmountOutOfBounds();

        bool bound = mandate.commerceContract != address(0) && mandate.commerceJobId != 0;
        bool unbound = mandate.commerceContract == address(0) && mandate.commerceJobId == 0;
        if (!bound && !(unbound && allowUnboundCommerceJobs)) revert CommerceBindingRequired();
    }

    /// @dev The adapter must be one of the two pinned deployments, the selector must be the
    /// adapter execution entry point, and the token relationship must match the adapter kind.
    function _requireAdapterPair(PeragoTypes.TaskMandate calldata mandate) private view returns (address verifier) {
        if (mandate.adapterSelector != IPeragoAdapter.execute.selector) revert WrongSelector();
        if (mandate.adapter == swapAdapter) {
            // A swap must move between two distinct assets.
            if (mandate.inputToken == mandate.outputToken) revert InvalidTokenPair();
            return swapVerifier;
        }
        if (mandate.adapter == stakeAdapter) {
            return stakeVerifier;
        }
        revert UnsupportedAdapter();
    }

    /// @dev `tryRecover` rejects zero, malformed, and high-`s` malleable signatures.
    function _requireRootSignature(bytes32 digest, bytes calldata signature, address expectedSigner) private pure {
        (address recovered, ECDSA.RecoverError err,) = digest.tryRecoverCalldata(signature);
        if (err != ECDSA.RecoverError.NoError || recovered != expectedSigner) revert InvalidRootSignature();
    }

    function _digest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _computeDomainSeparator(uint256 chainId) private view returns (bytes32) {
        return
            keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, chainId, address(this)));
    }

    /// @dev Encoded in two halves because every field is a 32-byte static word: the
    /// concatenation is identical to a single `abi.encode`, and the stack stays shallow.
    function _hashMandateStruct(PeragoTypes.TaskMandate calldata mandate) private pure returns (bytes32) {
        bytes memory head = abi.encode(
            TASK_MANDATE_TYPEHASH,
            mandate.account,
            mandate.rootOwner,
            mandate.ownerEpoch,
            mandate.executor,
            mandate.chainId,
            mandate.nonce,
            mandate.expiresAt,
            mandate.policyHash,
            mandate.intentHash,
            mandate.planHash
        );
        bytes memory tail = abi.encode(
            mandate.simulationHash,
            mandate.adapter,
            mandate.adapterSelector,
            mandate.inputToken,
            mandate.maxInput,
            mandate.outputToken,
            mandate.minOutput,
            mandate.recipient,
            mandate.actionHash,
            mandate.postconditionHash,
            mandate.commerceContract,
            mandate.commerceJobId
        );
        return keccak256(bytes.concat(head, tail));
    }
}
