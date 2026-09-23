// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPeragoAdapter} from "../interfaces/IPeragoAdapter.sol";
import {IPeragoVerifier} from "../interfaces/IPeragoVerifier.sol";
import {PeragoTypes} from "../types/PeragoTypes.sol";

/// @title SwapVerifier
/// @notice Measures a swap's outcome where it must land: the signed recipient's balance of
/// the signed output token. It never trusts the adapter's reported output, accepts only an
/// adapter paired with itself, and binds its evidence to the mandate's postcondition.
contract SwapVerifier is IPeragoVerifier {
    bytes32 public constant VERIFIER_ID = keccak256("perago.verifier.swap.v1");

    error UnsupportedAdapter();
    error ActionHashMismatch();
    error PostconditionHashMismatch();
    error ContextMismatch();
    error VerificationFailed();
    error AmountOutOfBounds();

    function verifierId() external pure returns (bytes32) {
        return VERIFIER_ID;
    }

    /// @notice The commitment a swap mandate signs as `postconditionHash`.
    function postconditionHash(address recipient, address outputToken, uint256 minOutput)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(PeragoTypes.SWAP_POSTCONDITION_KIND, recipient, outputToken, minOutput));
    }

    function measure(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
        view
        returns (uint256 value, bytes32 contextHash)
    {
        _requireBound(mandate, action);
        value = IERC20(mandate.outputToken).balanceOf(mandate.recipient);
        contextHash = _context(mandate, value);
    }

    function verify(
        PeragoTypes.TaskMandate calldata mandate,
        bytes calldata action,
        uint256 beforeValue,
        bytes32 beforeContext,
        PeragoTypes.AdapterResult calldata result
    ) external view returns (PeragoTypes.VerificationEvidence memory evidence) {
        _requireBound(mandate, action);
        if (beforeContext != _context(mandate, beforeValue)) revert ContextMismatch();

        uint256 afterValue = IERC20(mandate.outputToken).balanceOf(mandate.recipient);
        if (afterValue < beforeValue || afterValue - beforeValue < mandate.minOutput) revert VerificationFailed();
        uint256 delta = afterValue - beforeValue;
        // Exact input: the only admissible spend is the signed amount. MandateExecutor
        // measures the real spend independently and commits that figure to the receipt.
        if (result.inputSpent != mandate.maxInput) revert AmountOutOfBounds();

        evidence = PeragoTypes.VerificationEvidence({
            inputSpent: result.inputSpent,
            observedOutputOrPositionDelta: delta,
            evidenceHash: keccak256(
                abi.encode(mandate.postconditionHash, result.inputSpent, delta, result.protocolEvidenceHash)
            )
        });
    }

    /// @dev The adapter must be a swap adapter paired with this verifier, must read the
    /// action as the signed commitment, and the mandate must commit this postcondition.
    function _requireBound(PeragoTypes.TaskMandate calldata mandate, bytes calldata action) private view {
        IPeragoAdapter adapter = IPeragoAdapter(mandate.adapter);
        if (adapter.verifier() != address(this) || adapter.kind() != PeragoTypes.SWAP_ADAPTER_KIND) {
            revert UnsupportedAdapter();
        }
        if (adapter.validate(mandate, action) != mandate.actionHash) revert ActionHashMismatch();
        if (postconditionHash(mandate.recipient, mandate.outputToken, mandate.minOutput) != mandate.postconditionHash) {
            revert PostconditionHashMismatch();
        }
    }

    function _context(PeragoTypes.TaskMandate calldata mandate, uint256 value) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(address(this), mandate.recipient, mandate.outputToken, mandate.postconditionHash, value)
            );
    }
}
