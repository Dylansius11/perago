// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice ERC-165 detection, mirrored locally so Perago never imports vendor code.
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @notice Hook interface required by the deployed BNB APEX ERC-8183 kernel.
/// @dev Mirrors `contracts/IACPHook.sol` of https://github.com/bnb-chain/apex-contracts
///      at commit-independent interface parity: the kernel checks
///      `ERC165Checker.supportsInterface(hook, type(IACPHook).interfaceId)` in
///      `createJob`, so any Perago hook must answer that exact interface id.
interface IACPHook is IERC165 {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
