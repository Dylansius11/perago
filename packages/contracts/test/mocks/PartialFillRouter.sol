// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPancakeV3SwapRouter} from "../../src/interfaces/IPancakeV3.sol";

/// @notice A router that stops short: it pulls half the exact input and pays the minimum
/// from its own balance, the shape a V3 pool produces when it reaches a price boundary.
/// It reports the real factory, so an adapter can be deployed against it on a fork.
contract PartialFillRouter {
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }

    function exactInputSingle(IPancakeV3SwapRouter.ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256)
    {
        require(IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn / 2), "pull failed");
        require(IERC20(params.tokenOut).transfer(params.recipient, params.amountOutMinimum), "pay failed");
        return params.amountOutMinimum;
    }
}
