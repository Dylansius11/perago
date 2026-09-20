// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPeragoVerifier} from "../../src/interfaces/IPeragoVerifier.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";

/// @notice Stands in for a deployment-pinned verifier. It measures the signed recipient's
/// output-token balance itself - never the adapter's self-report - and binds its evidence
/// to the mandate's postcondition commitment, which is the shape `SwapVerifier` and
/// `StakeVerifier` must keep. Failure modes exist so the executor's terminal paths are
/// observable.
contract MockPeragoVerifier is IPeragoVerifier {
    enum Mode {
        HONEST,
        MEASURE_REVERTS,
        VERIFY_REVERTS,
        UNDER_MINIMUM,
        FOREIGN_POSTCONDITION,
        ZERO_EVIDENCE,
        /// @dev Measures and reports honestly without enforcing the signed minimum: that
        /// guard belongs to the executor, and an enforcing mock would hide it.
        REPORTS_MEASUREMENT
    }

    error PostconditionUnmet();
    error PreStateUnavailable();
    /// @dev Raised when the executor does not hand back the exact pre-state it measured.
    error ContextMismatch();

    bytes32 private immutable _verifierId;
    Mode public mode;

    constructor(bytes32 verifierId_) {
        _verifierId = verifierId_;
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function verifierId() external view returns (bytes32) {
        return _verifierId;
    }

    /// @notice Pre-state the executor must capture before the adapter runs.
    function measure(PeragoTypes.TaskMandate calldata mandate, bytes calldata)
        external
        view
        returns (uint256 value, bytes32 contextHash)
    {
        if (mode == Mode.MEASURE_REVERTS) revert PreStateUnavailable();
        return (IERC20(mandate.outputToken).balanceOf(mandate.recipient), _context(mandate));
    }

    function verify(
        PeragoTypes.TaskMandate calldata mandate,
        bytes calldata,
        uint256 beforeValue,
        bytes32 beforeContext,
        PeragoTypes.AdapterResult calldata result
    ) external view returns (PeragoTypes.VerificationEvidence memory) {
        if (mode == Mode.VERIFY_REVERTS) revert PostconditionUnmet();
        if (beforeContext != _context(mandate)) revert ContextMismatch();

        uint256 afterValue = IERC20(mandate.outputToken).balanceOf(mandate.recipient);
        uint256 delta = afterValue > beforeValue ? afterValue - beforeValue : 0;
        if (mode == Mode.UNDER_MINIMUM) delta = mandate.minOutput - 1;
        if (delta < mandate.minOutput && mode == Mode.HONEST) revert PostconditionUnmet();

        bytes32 postcondition = mode == Mode.FOREIGN_POSTCONDITION
            ? keccak256("postcondition of another mandate")
            : mandate.postconditionHash;
        bytes32 evidenceHash = mode == Mode.ZERO_EVIDENCE
            ? bytes32(0)
            : keccak256(abi.encode(postcondition, result.inputSpent, delta, result.protocolEvidenceHash));

        return PeragoTypes.VerificationEvidence({
            inputSpent: result.inputSpent, observedOutputOrPositionDelta: delta, evidenceHash: evidenceHash
        });
    }

    function _context(PeragoTypes.TaskMandate calldata mandate) private pure returns (bytes32) {
        return keccak256(abi.encode(mandate.recipient, mandate.outputToken, mandate.postconditionHash));
    }
}
