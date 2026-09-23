// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice The PancakeSwap CAKE Pool surface Perago touches. Positions are keyed by
/// `msg.sender`; there is no deposit-for-recipient and no share transfer, which is why
/// each recipient stakes through its own `CakeStakePosition`.
interface ICakePool {
    function token() external view returns (address);

    function deposit(uint256 amount, uint256 lockDuration) external;

    function withdraw(uint256 shares) external;

    function withdrawAll() external;

    function userInfo(address user)
        external
        view
        returns (
            uint256 shares,
            uint256 lastDepositedTime,
            uint256 cakeAtLastUserAction,
            uint256 lastUserActionTime,
            uint256 lockStartTime,
            uint256 lockEndTime,
            uint256 userBoostedShare,
            bool locked,
            uint256 lockedAmount
        );
}
