// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice A pool that takes half of what it is offered, so a holder that trusts the
/// deposit to consume its exact allowance and input is observable.
contract ShortDepositPool {
    address public immutable token;

    constructor(address token_) {
        token = token_;
    }

    function deposit(uint256 amount, uint256) external {
        require(IERC20(token).transferFrom(msg.sender, address(this), amount / 2), "pull failed");
    }
}
