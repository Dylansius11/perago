// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPeragoVerifier} from "../../src/interfaces/IPeragoVerifier.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";

/// @notice Stands in for a deployment-pinned verifier. It reports its identity only; the
/// measurement paths are exercised once `perform` exists.
contract MockPeragoVerifier is IPeragoVerifier {
    bytes32 private immutable _verifierId;

    constructor(bytes32 verifierId_) {
        _verifierId = verifierId_;
    }

    function verifierId() external view returns (bytes32) {
        return _verifierId;
    }

    function measure(PeragoTypes.TaskMandate calldata, bytes calldata) external pure returns (uint256, bytes32) {
        return (0, bytes32(0));
    }

    function verify(
        PeragoTypes.TaskMandate calldata,
        bytes calldata,
        uint256,
        bytes32,
        PeragoTypes.AdapterResult calldata result
    ) external pure returns (PeragoTypes.VerificationEvidence memory) {
        return PeragoTypes.VerificationEvidence({
            inputSpent: result.inputSpent,
            observedOutputOrPositionDelta: result.outputOrPositionReceived,
            evidenceHash: result.protocolEvidenceHash
        });
    }
}
