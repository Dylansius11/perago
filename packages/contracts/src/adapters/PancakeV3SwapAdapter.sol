// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPancakeV3Factory, IPancakeV3SwapRouter} from "../interfaces/IPancakeV3.sol";
import {IPeragoAdapter} from "../interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../types/PeragoTypes.sol";

/// @title PancakeV3SwapAdapter
/// @notice Executes one closed exact-input swap through one constructor-pinned PancakeSwap
/// V3 pool. The router, pool, fee, and token pair are immutable; the action carries no
/// path, multicall, callback target, or unwrap recipient, and every economic field must
/// equal the value the root owner signed.
/// @dev Stateless and permissionless by design: it only ever spends what its caller
/// grants for one call, sends the output straight to the signed recipient, and holds
/// nothing between calls. MandateExecutor is the only caller whose outcome counts.
contract PancakeV3SwapAdapter is IPeragoAdapter {
    using SafeERC20 for IERC20;

    /// Seven static words: the only canonical encoding of `SwapAction`.
    uint256 private constant SWAP_ACTION_BYTES = 7 * 32;

    IPancakeV3SwapRouter public immutable router;
    address public immutable pool;
    uint24 public immutable poolFee;
    address public immutable token0;
    address public immutable token1;
    address private immutable _verifier;

    error InvalidDeploymentPair();
    error UnsupportedAdapter();
    error WrongSelector();
    error InvalidAction();
    error InvalidTokenPair();
    error AmountOutOfBounds();
    error RecipientMismatch();
    error ExpiredMandate();
    error AllowanceNotCleared();
    error ResidualBalance();

    /// @dev The pool is resolved from the router's own factory, so a router, pair, and fee
    /// that do not name one existing pool cannot be deployed.
    constructor(address router_, address tokenA, address tokenB, uint24 fee, address verifier_) {
        if (tokenA == tokenB || tokenA == address(0) || tokenB == address(0)) revert InvalidDeploymentPair();
        if (router_.code.length == 0 || verifier_.code.length == 0) revert InvalidDeploymentPair();

        address pool_ = IPancakeV3Factory(IPancakeV3SwapRouter(router_).factory()).getPool(tokenA, tokenB, fee);
        if (pool_.code.length == 0) revert InvalidDeploymentPair();

        router = IPancakeV3SwapRouter(router_);
        pool = pool_;
        poolFee = fee;
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        _verifier = verifier_;
    }

    function kind() external pure returns (bytes32) {
        return PeragoTypes.SWAP_ADAPTER_KIND;
    }

    function verifier() external view returns (address) {
        return _verifier;
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
        PeragoTypes.SwapAction memory swap = _decodeBound(mandate, action);
        IERC20 tokenIn = IERC20(swap.tokenIn);

        // Balances are compared as deltas, so a donation can neither block nor join a swap.
        uint256 heldBefore = tokenIn.balanceOf(address(this));
        tokenIn.safeTransferFrom(msg.sender, address(this), swap.amountIn);
        tokenIn.forceApprove(address(router), swap.amountIn);

        uint256 amountOut = router.exactInputSingle(
            IPancakeV3SwapRouter.ExactInputSingleParams({
                tokenIn: swap.tokenIn,
                tokenOut: swap.tokenOut,
                fee: swap.poolFee,
                recipient: swap.recipient,
                deadline: swap.deadline,
                amountIn: swap.amountIn,
                amountOutMinimum: swap.minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        tokenIn.forceApprove(address(router), 0);
        if (tokenIn.allowance(address(this), address(router)) != 0) revert AllowanceNotCleared();
        // Exact input: a pool that stopped at a price boundary leaves input behind, and a
        // partial fill is not the signed action.
        if (tokenIn.balanceOf(address(this)) != heldBefore) revert ResidualBalance();

        return PeragoTypes.AdapterResult({
            inputSpent: swap.amountIn,
            outputOrPositionReceived: amountOut,
            protocolEvidenceHash: keccak256(abi.encode(pool, swap.amountIn, amountOut))
        });
    }

    /// @dev Every field is checked against the signed mandate and the pinned route; checks
    /// run from identity to shape to economics so the reason code names the first break.
    function _decodeBound(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        private
        view
        returns (PeragoTypes.SwapAction memory swap)
    {
        if (mandate.adapter != address(this)) revert UnsupportedAdapter();
        if (mandate.adapterSelector != IPeragoAdapter.execute.selector) revert WrongSelector();
        if (action.length != SWAP_ACTION_BYTES) revert InvalidAction();
        swap = abi.decode(action, (PeragoTypes.SwapAction));

        if (swap.tokenIn != mandate.inputToken || swap.tokenOut != mandate.outputToken) revert InvalidTokenPair();
        bool pinnedPair =
            (swap.tokenIn == token0 && swap.tokenOut == token1) || (swap.tokenIn == token1 && swap.tokenOut == token0);
        if (!pinnedPair || swap.poolFee != poolFee) revert InvalidTokenPair();
        if (swap.amountIn != mandate.maxInput || swap.minAmountOut != mandate.minOutput || swap.minAmountOut == 0) {
            revert AmountOutOfBounds();
        }
        if (swap.recipient != mandate.recipient) revert RecipientMismatch();
        if (swap.deadline == 0 || swap.deadline > mandate.expiresAt) revert ExpiredMandate();
    }
}
