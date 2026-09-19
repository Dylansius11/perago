// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

library PeragoTypes {
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
}
