// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice The deployed BNB APEX kernel's relevant ABI, not a generic ERC-8183 abstraction.
/// @dev The Job tuple and selectors mirror bnb-chain/apex-contracts/contracts/IACP.sol.
interface IACP {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
        uint256 submittedAt;
        bytes32 deliverable;
    }

    function getJob(uint256 jobId) external view returns (Job memory);
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    function paymentToken() external view returns (address);
    function jobPaymentToken(uint256 jobId) external view returns (address);
}
