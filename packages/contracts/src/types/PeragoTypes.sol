// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

library PeragoTypes {
    /**
     * Immutable adapter identity: the deployment pins one contract per kind.
     */
    bytes32 internal constant SWAP_ADAPTER_KIND = keccak256("perago.adapter.swap.v1");
    bytes32 internal constant STAKE_ADAPTER_KIND = keccak256("perago.adapter.stake.v1");

    /// Legal transitions: NONE -> AUTHORIZED -> (EXECUTING -> SUCCEEDED | FAILED) | REVOKED | EXPIRED.
    enum MandateStatus {
        NONE,
        AUTHORIZED,
        EXECUTING,
        SUCCEEDED,
        FAILED,
        REVOKED,
        EXPIRED
    }

    struct TaskMandate {
        address account;
        address rootOwner;
        uint64 ownerEpoch;
        address executor;
        uint256 chainId;
        uint256 nonce;
        uint48 expiresAt;
        bytes32 policyHash;
        bytes32 intentHash;
        bytes32 planHash;
        bytes32 simulationHash;
        address adapter;
        bytes4 adapterSelector;
        address inputToken;
        uint256 maxInput;
        address outputToken;
        uint256 minOutput;
        address recipient;
        bytes32 actionHash;
        bytes32 postconditionHash;
        address commerceContract;
        uint256 commerceJobId;
    }

    struct AdapterResult {
        uint256 inputSpent;
        uint256 outputOrPositionReceived;
        bytes32 protocolEvidenceHash;
    }

    struct VerificationEvidence {
        uint256 inputSpent;
        uint256 observedOutputOrPositionDelta;
        bytes32 evidenceHash;
    }

    /// Root-signed registration that binds an account to its owner, epoch, policy, and session permission.
    struct AccountPolicy {
        address account;
        address rootOwner;
        uint64 ownerEpoch;
        uint256 chainId;
        bytes32 policyHash;
        bytes32 permissionHash;
        uint48 validUntil;
    }

    /// Executor-signed proof that survives ERC-4337 call indirection.
    struct ExecutionProof {
        bytes32 mandateHash;
        address account;
        address executor;
        uint48 validUntil;
    }

    /// Registration status is derived: `rootOwner != address(0)` means registered.
    struct AccountConfig {
        address rootOwner;
        uint64 ownerEpoch;
        bytes32 activePolicyHash;
        bytes32 permissionHash;
    }

    /// Lifecycle state only: never raw intent, policy, action bytes, or explanation.
    struct MandateRecord {
        address account;
        uint48 expiresAt;
        MandateStatus status;
        address executor;
        uint48 executionStartedAt;
        address adapter;
        address verifier;
        address commerceContract;
        uint256 commerceJobId;
        bytes32 verificationHash;
        bytes32 failureReasonHash;
    }
}
