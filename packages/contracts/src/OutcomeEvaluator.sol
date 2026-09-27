// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MandateExecutor} from "./MandateExecutor.sol";
import {IACP} from "./interfaces/IACP.sol";
import {IPeragoVerifier} from "./interfaces/IPeragoVerifier.sol";
import {PeragoTypes} from "./types/PeragoTypes.sol";

/// @notice Releases APEX escrow only for a one-use, onchain-verified Task Mandate.
/// @dev No owner, upgrade, operator, or discretionary verdict. APEX is an upgradeable
/// external dependency: deployment and every submission must check its implementation.
contract OutcomeEvaluator is ReentrancyGuard {
    bytes32 private constant SWAP_VERIFIER_ID = keccak256("perago.verifier.swap.v1");
    bytes32 private constant STAKE_VERIFIER_ID = keccak256("perago.verifier.stake.v1");
    MandateExecutor public immutable executor;
    IACP public immutable commerce;
    address public immutable provider;
    address public immutable hook;
    address public immutable paymentToken;

    mapping(address commerceContract => mapping(uint256 jobId => bool paid)) public settled;

    event CommerceJobSettled(address indexed commerceContract, uint256 indexed jobId, bytes32 indexed mandateHash);

    error InvalidDeploymentPair();
    error SettlementNotEligible();
    error AlreadySettled();

    constructor(address executor_, address commerce_, address provider_, address hook_, address paymentToken_) {
        if (
            executor_.code.length == 0 || commerce_.code.length == 0 || provider_ == address(0)
                || hook_.code.length == 0 || paymentToken_.code.length == 0
                || IACP(commerce_).paymentToken() != paymentToken_
        ) revert InvalidDeploymentPair();
        executor = MandateExecutor(executor_);
        commerce = IACP(commerce_);
        provider = provider_;
        hook = hook_;
        paymentToken = paymentToken_;
    }

    /// @notice Anyone may relay a verified outcome. Caller's opinion is never consulted.
    function settle(uint256 jobId, bytes32 mandateHash) external nonReentrant {
        if (settled[address(commerce)][jobId]) revert AlreadySettled();
        PeragoTypes.MandateRecord memory receipt = _receipt(jobId, mandateHash);
        if (
            receipt.status != PeragoTypes.MandateStatus.SUCCEEDED || receipt.verificationHash == bytes32(0)
                || receipt.failureReasonHash != bytes32(0)
        ) revert SettlementNotEligible();
        if (_job(jobId, receipt.account).status != IACP.JobStatus.Submitted) revert SettlementNotEligible();
        if (commerce.platformFeeBP() != 0) revert SettlementNotEligible();

        settled[address(commerce)][jobId] = true;
        commerce.complete(jobId, keccak256(abi.encode(mandateHash, receipt.verificationHash)), "");
        emit CommerceJobSettled(address(commerce), jobId, mandateHash);
    }

    /// @notice Return escrow after a proven terminal non-success; expiry refunds remain
    /// permissionless on APEX itself, independent of this function.
    function reject(uint256 jobId, bytes32 mandateHash) external nonReentrant {
        if (settled[address(commerce)][jobId]) revert AlreadySettled();
        PeragoTypes.MandateRecord memory receipt = _receipt(jobId, mandateHash);
        if (
            (receipt.status != PeragoTypes.MandateStatus.FAILED
                    && receipt.status != PeragoTypes.MandateStatus.REVOKED
                    && receipt.status != PeragoTypes.MandateStatus.EXPIRED) || receipt.verificationHash != bytes32(0)
        ) revert SettlementNotEligible();
        IACP.JobStatus status = _job(jobId, receipt.account).status;
        if (status != IACP.JobStatus.Funded && status != IACP.JobStatus.Submitted) revert SettlementNotEligible();
        commerce.reject(jobId, keccak256(abi.encode(mandateHash, receipt.failureReasonHash)), "");
    }

    function _receipt(uint256 jobId, bytes32 mandateHash)
        private
        view
        returns (PeragoTypes.MandateRecord memory receipt)
    {
        receipt = executor.mandateRecord(mandateHash);
        if (
            mandateHash == bytes32(0) || receipt.commerceContract != address(commerce) || receipt.commerceJobId != jobId
                || receipt.account == address(0) || receipt.adapter == address(0) || receipt.verifier == address(0)
                || executor.commerceJobBinding(address(commerce), jobId) != mandateHash
        ) revert SettlementNotEligible();
        bytes32 expectedVerifierId;
        if (receipt.adapter == executor.swapAdapter() && receipt.verifier == executor.swapVerifier()) {
            expectedVerifierId = SWAP_VERIFIER_ID;
        } else if (receipt.adapter == executor.stakeAdapter() && receipt.verifier == executor.stakeVerifier()) {
            expectedVerifierId = STAKE_VERIFIER_ID;
        } else {
            revert SettlementNotEligible();
        }
        if (IPeragoVerifier(receipt.verifier).verifierId() != expectedVerifierId) revert SettlementNotEligible();
    }

    function _job(uint256 jobId, address account) private view returns (IACP.Job memory job) {
        job = commerce.getJob(jobId);
        if (
            job.id != jobId || job.client != account || job.provider != provider || job.evaluator != address(this)
                || job.hook != hook || job.budget == 0 || job.expiredAt <= block.timestamp
                || commerce.jobPaymentToken(jobId) != paymentToken
        ) revert SettlementNotEligible();
    }
}
