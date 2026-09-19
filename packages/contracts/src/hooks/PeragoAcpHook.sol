// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IACPHook, IERC165} from "../interfaces/IACPHook.sol";

/// @title PeragoAcpHook
/// @notice The minimum hook the deployed BNB APEX ERC-8183 kernel accepts.
/// @dev The kernel rejects `createJob` when `hook == address(0)` (`HookRequired()`)
///      and when the hook does not answer `type(IACPHook).interfaceId`
///      (`HookMissingInterface()`). Perago therefore supplies this hook so its
///      jobs keep the standard lifecycle without delegating authority.
///
///      Security properties this contract deliberately keeps:
///      - it holds no funds, moves no tokens, and grants no approvals;
///      - it never reverts on a legitimate kernel callback, so it can never
///        block `complete`, `reject`, or a hookable transition;
///      - it accepts callbacks only from the one pinned kernel, so no other
///        contract can drive Perago job state through it.
///
///      Perago's authority lives in the Task Mandate, the mandate executor, and
///      the job evaluator. This hook is intentionally inert.
contract PeragoAcpHook is IACPHook {
    /// @notice The only ERC-8183 kernel allowed to invoke this hook.
    address public immutable commerce;

    /// @notice Thrown when a caller other than {commerce} invokes a callback.
    error UnauthorizedCaller(address caller);

    constructor(address commerce_) {
        if (commerce_ == address(0)) {
            revert UnauthorizedCaller(address(0));
        }
        commerce = commerce_;
    }

    /// @inheritdoc IACPHook
    function beforeAction(uint256, bytes4, bytes calldata) external view {
        _onlyCommerce();
    }

    /// @inheritdoc IACPHook
    function afterAction(uint256, bytes4, bytes calldata) external view {
        _onlyCommerce();
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _onlyCommerce() private view {
        if (msg.sender != commerce) {
            revert UnauthorizedCaller(msg.sender);
        }
    }
}
