import { parseAbi } from "viem";

/** Deployed BNB APEX kernel: jobs, payout evidence, and preflight getters. */
export const apexCommerceAbi = parseAbi([
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
  "function jobPaymentToken(uint256 jobId) view returns (address)",
  "function paymentToken() view returns (address)",
  "function platformFeeBP() view returns (uint256)",
  "function claimRefund(uint256 jobId)",
  "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
  "event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)",
  "event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason)",
  "event JobExpired(uint256 indexed jobId)",
  "event Refunded(uint256 indexed jobId, address indexed client, uint256 amount)",
]);
