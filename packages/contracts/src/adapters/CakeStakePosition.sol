// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {ICakePool} from "../interfaces/ICakePool.sol";

/// @notice The deterministic address of `owner`'s holder deployed by `deployer`. The
/// adapter deploys at it and the verifier measures at it, each computing it itself.
function cakeStakePositionAddress(address deployer, address owner, address pool, address asset) pure returns (address) {
    bytes32 initCodeHash =
        keccak256(abi.encodePacked(type(CakeStakePosition).creationCode, abi.encode(owner, pool, asset)));
    return Create2.computeAddress(bytes32(uint256(uint160(owner))), initCodeHash, deployer);
}

/// @title CakeStakePosition
/// @notice One recipient's account in the CAKE Pool. The pool credits `msg.sender`, so the
/// adapter cannot stake on a recipient's behalf; it stakes through this holder, which only
/// that adapter can deposit through and only its owner can leave. Nothing is pooled
/// across recipients and nothing can be sent anywhere but to the owner.
contract CakeStakePosition {
    using SafeERC20 for IERC20;

    ICakePool public immutable pool;
    IERC20 public immutable asset;
    address public immutable adapter;
    address public immutable owner;

    error UnsupportedAdapter();
    error WrongAccountCaller();
    error AllowanceNotCleared();
    error ResidualBalance();

    constructor(address owner_, address pool_, address asset_) {
        adapter = msg.sender;
        owner = owner_;
        pool = ICakePool(pool_);
        asset = IERC20(asset_);
    }

    /// @notice Deposits exactly `amount` the adapter already transferred here, flexible
    /// (no lock). An exact allowance is granted and reset, and the asset balance must fall
    /// by exactly `amount`, so a donation can neither block nor join a stake.
    function stake(uint256 amount) external {
        if (msg.sender != adapter) revert UnsupportedAdapter();
        uint256 held = asset.balanceOf(address(this));

        asset.forceApprove(address(pool), amount);
        pool.deposit(amount, 0);
        asset.forceApprove(address(pool), 0);

        if (asset.allowance(address(this), address(pool)) != 0) revert AllowanceNotCleared();
        if (held < amount || asset.balanceOf(address(this)) != held - amount) revert ResidualBalance();
    }

    function withdraw(uint256 shares) external {
        if (msg.sender != owner) revert WrongAccountCaller();
        pool.withdraw(shares);
        _release();
    }

    function withdrawAll() external {
        if (msg.sender != owner) revert WrongAccountCaller();
        pool.withdrawAll();
        _release();
    }

    /// @dev Everything the holder holds is the owner's: withdrawn stake and any donation.
    function _release() private {
        asset.safeTransfer(owner, asset.balanceOf(address(this)));
    }
}
