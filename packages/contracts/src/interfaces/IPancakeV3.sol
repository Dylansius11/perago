// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice The two PancakeSwap V3 surfaces Perago touches, reduced to the functions it
/// calls. The chain-97 router still uses the eight-field `exactInputSingle` struct that
/// carries `deadline` (read from its deployed selector set, not assumed).
interface IPancakeV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function factory() external view returns (address);

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IPancakeV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}
