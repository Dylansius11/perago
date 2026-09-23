// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {cakeStakePositionAddress} from "../adapters/CakeStakePosition.sol";
import {ICakePool} from "../interfaces/ICakePool.sol";
import {IPeragoAdapter} from "../interfaces/IPeragoAdapter.sol";
import {IPeragoVerifier} from "../interfaces/IPeragoVerifier.sol";
import {PeragoTypes} from "../types/PeragoTypes.sol";

/// @title StakeVerifier
/// @notice Measures a stake where it must land: the pool shares of the signed recipient's
/// own holder. The pool and asset are pinned here and the holder address is derived here,
/// so the adapter cannot point the measurement anywhere else.
contract StakeVerifier is IPeragoVerifier {
    bytes32 public constant VERIFIER_ID = keccak256("perago.verifier.stake.v1");

    ICakePool public immutable pool;
    address public immutable asset;

    error InvalidDeploymentPair();
    error UnsupportedAdapter();
    error ActionHashMismatch();
    error PostconditionHashMismatch();
    error ContextMismatch();
    error VerificationFailed();
    error AmountOutOfBounds();

    constructor(address pool_, address asset_) {
        if (pool_.code.length == 0 || ICakePool(pool_).token() != asset_) revert InvalidDeploymentPair();
        pool = ICakePool(pool_);
        asset = asset_;
    }

    function verifierId() external pure returns (bytes32) {
        return VERIFIER_ID;
    }

    /// @notice The commitment a stake mandate signs as `postconditionHash`.
    function postconditionHash(address recipient, bytes32 poolId, uint256 minPositionOut)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(PeragoTypes.STAKE_POSTCONDITION_KIND, recipient, poolId, minPositionOut));
    }

    function measure(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
        view
        returns (uint256 value, bytes32 contextHash)
    {
        address holder = _requireBound(mandate, action);
        value = _shares(holder);
        contextHash = _context(mandate, holder, value);
    }

    function verify(
        PeragoTypes.TaskMandate calldata mandate,
        bytes calldata action,
        uint256 beforeValue,
        bytes32 beforeContext,
        PeragoTypes.AdapterResult calldata result
    ) external view returns (PeragoTypes.VerificationEvidence memory evidence) {
        address holder = _requireBound(mandate, action);
        if (beforeContext != _context(mandate, holder, beforeValue)) revert ContextMismatch();

        uint256 afterValue = _shares(holder);
        if (afterValue < beforeValue || afterValue - beforeValue < mandate.minOutput) revert VerificationFailed();
        uint256 delta = afterValue - beforeValue;
        // Stake is exact: the only admissible spend is the signed amount. MandateExecutor
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

    /// @dev The adapter must be a stake adapter paired with this verifier and read the
    /// action as the signed commitment; the postcondition names the adapter's pool id.
    function _requireBound(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        private
        view
        returns (address holder)
    {
        IPeragoAdapter adapter = IPeragoAdapter(mandate.adapter);
        if (adapter.verifier() != address(this) || adapter.kind() != PeragoTypes.STAKE_ADAPTER_KIND) {
            revert UnsupportedAdapter();
        }
        if (adapter.validate(mandate, action) != mandate.actionHash) revert ActionHashMismatch();
        PeragoTypes.StakeAction memory stake = abi.decode(action, (PeragoTypes.StakeAction));
        if (postconditionHash(mandate.recipient, stake.poolId, mandate.minOutput) != mandate.postconditionHash) {
            revert PostconditionHashMismatch();
        }
        holder = cakeStakePositionAddress(mandate.adapter, mandate.recipient, address(pool), asset);
    }

    function _shares(address holder) private view returns (uint256 shares) {
        (shares,,,,,,,,) = pool.userInfo(holder);
    }

    function _context(PeragoTypes.TaskMandate calldata mandate, address holder, uint256 value)
        private
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(this), mandate.recipient, holder, mandate.postconditionHash, value));
    }
}
