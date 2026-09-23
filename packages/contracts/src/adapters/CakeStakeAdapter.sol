// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ICakePool} from "../interfaces/ICakePool.sol";
import {IPeragoAdapter} from "../interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../types/PeragoTypes.sol";
import {CakeStakePosition, cakeStakePositionAddress} from "./CakeStakePosition.sol";

/// @title CakeStakeAdapter
/// @notice Executes one closed flexible stake into one constructor-pinned PancakeSwap CAKE
/// Pool. Each recipient's stake lands in that recipient's own `CakeStakePosition`, which
/// this adapter deploys on first use at a deterministic address. Every economic field must
/// equal the signed value, and the signed minimum of pool shares is enforced inside the
/// call, not only afterwards.
contract CakeStakeAdapter is IPeragoAdapter {
    using SafeERC20 for IERC20;

    /// The single pool this deployment may stake into.
    bytes32 public constant poolId = keccak256("perago.stake.pancakeswap.cake-pool.flexible.v1");
    /// Six static words: the only canonical encoding of `StakeAction`.
    uint256 private constant STAKE_ACTION_BYTES = 6 * 32;

    ICakePool public immutable pool;
    address public immutable asset;
    address private immutable _verifier;

    error InvalidDeploymentPair();
    error UnsupportedAdapter();
    error WrongSelector();
    error InvalidAction();
    error InvalidTokenPair();
    error AmountOutOfBounds();
    error RecipientMismatch();
    error ExpiredMandate();

    constructor(address pool_, address asset_, address verifier_) {
        if (pool_.code.length == 0 || verifier_.code.length == 0 || asset_ == address(0)) {
            revert InvalidDeploymentPair();
        }
        if (ICakePool(pool_).token() != asset_) revert InvalidDeploymentPair();
        pool = ICakePool(pool_);
        asset = asset_;
        _verifier = verifier_;
    }

    function kind() external pure returns (bytes32) {
        return PeragoTypes.STAKE_ADAPTER_KIND;
    }

    function verifier() external view returns (address) {
        return _verifier;
    }

    /// @notice The holder that owns `recipient`'s position, deployed or not.
    function positionOf(address recipient) public view returns (address) {
        return cakeStakePositionAddress(address(this), recipient, address(pool), asset);
    }

    function validate(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
        view
        returns (bytes32 normalizedActionHash)
    {
        _decodeBound(mandate, action);
        return keccak256(action);
    }

    function execute(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
        returns (PeragoTypes.AdapterResult memory result)
    {
        PeragoTypes.StakeAction memory stake = _decodeBound(mandate, action);
        // The pool has no deadline of its own, so the signed one is enforced here.
        if (block.timestamp > stake.deadline) revert ExpiredMandate();

        address holder = positionOf(stake.recipient);
        if (holder.code.length == 0) {
            new CakeStakePosition{salt: bytes32(uint256(uint160(stake.recipient)))}(
                stake.recipient, address(pool), asset
            );
        }

        uint256 sharesBefore = _shares(holder);
        // The input goes from the caller straight to the holder; this adapter never holds it.
        IERC20(asset).safeTransferFrom(msg.sender, holder, stake.amount);
        CakeStakePosition(holder).stake(stake.amount);
        uint256 sharesAfter = _shares(holder);

        if (sharesAfter < sharesBefore || sharesAfter - sharesBefore < stake.minPositionOut) {
            revert AmountOutOfBounds();
        }
        uint256 minted = sharesAfter - sharesBefore;

        return PeragoTypes.AdapterResult({
            inputSpent: stake.amount,
            outputOrPositionReceived: minted,
            protocolEvidenceHash: keccak256(abi.encode(address(pool), holder, stake.amount, minted))
        });
    }

    function _shares(address holder) private view returns (uint256 shares) {
        (shares,,,,,,,,) = pool.userInfo(holder);
    }

    /// @dev Identity, then shape, then economics, so the reason code names the first break.
    function _decodeBound(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        private
        view
        returns (PeragoTypes.StakeAction memory stake)
    {
        if (mandate.adapter != address(this)) revert UnsupportedAdapter();
        if (mandate.adapterSelector != IPeragoAdapter.execute.selector) revert WrongSelector();
        if (action.length != STAKE_ACTION_BYTES) revert InvalidAction();
        stake = abi.decode(action, (PeragoTypes.StakeAction));

        if (stake.asset != asset || mandate.inputToken != asset || mandate.outputToken != asset) {
            revert InvalidTokenPair();
        }
        if (stake.poolId != poolId) revert InvalidTokenPair();
        if (stake.amount != mandate.maxInput || stake.minPositionOut != mandate.minOutput || stake.minPositionOut == 0)
        {
            revert AmountOutOfBounds();
        }
        if (stake.recipient != mandate.recipient) revert RecipientMismatch();
        if (stake.deadline == 0 || stake.deadline > mandate.expiresAt) revert ExpiredMandate();
    }
}
