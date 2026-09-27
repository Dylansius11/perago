// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {OutcomeEvaluator} from "../src/OutcomeEvaluator.sol";
import {MandateExecutor} from "../src/MandateExecutor.sol";
import {IACP} from "../src/interfaces/IACP.sol";
import {IPeragoAdapter} from "../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../src/types/PeragoTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPeragoAdapter, MockSwapAdapter, MockStakeAdapter} from "./mocks/MockPeragoAdapter.sol";
import {MockPeragoVerifier} from "./mocks/MockPeragoVerifier.sol";

// Only the external escrow is replaced in these unit tests. Mandate authorization,
// verifier outcome, binding, and terminal receipt all run in the real executor.
contract EvaluatorEscrow is IACP {
    address public paymentToken;
    Job public job;
    address public jobToken;
    bool public refuseCompletion;

    constructor(address token) {
        paymentToken = token;
        jobToken = token;
    }

    function setJob(Job memory value) external {
        job = value;
    }

    function setJobToken(address token) external {
        jobToken = token;
    }

    function setRefuseCompletion(bool refused) external {
        refuseCompletion = refused;
    }

    function getJob(uint256) external view returns (Job memory) {
        return job;
    }

    function jobPaymentToken(uint256) external view returns (address) {
        return jobToken;
    }

    function complete(uint256 jobId, bytes32, bytes calldata) external {
        require(!refuseCompletion, "escrow unavailable");
        require(job.id == jobId && job.status == JobStatus.Submitted && job.evaluator == msg.sender, "wrong job");
        job.status = JobStatus.Completed;
        MockERC20(jobToken).transfer(job.provider, job.budget);
    }

    function reject(uint256 jobId, bytes32, bytes calldata) external {
        require(job.id == jobId && job.status == JobStatus.Submitted && job.evaluator == msg.sender, "wrong job");
        job.status = JobStatus.Rejected;
        MockERC20(jobToken).transfer(job.client, job.budget);
    }

    function claimRefund(uint256 jobId) external {
        require(job.id == jobId && job.status == JobStatus.Submitted && block.timestamp >= job.expiredAt, "not expired");
        job.status = JobStatus.Expired;
        MockERC20(jobToken).transfer(job.client, job.budget);
    }
}

contract OutcomeEvaluatorTest is Test {
    uint256 private constant JOB_ID = 7;
    uint256 private constant BUDGET = 9e18;
    uint256 private constant ROOT_KEY = 0xA11CE;
    uint256 private constant EXECUTOR_KEY = 0xE0E0;
    address private constant ACCOUNT = address(0xACC0);
    address private constant PROVIDER = address(0xB0B);
    address private constant HOOK = address(0xCAFE);

    MandateExecutor private executor;
    OutcomeEvaluator private evaluator;
    EvaluatorEscrow private escrow;
    MockSwapAdapter private adapter;
    MockPeragoVerifier private verifier;
    MockERC20 private input;
    MockERC20 private output;
    MockERC20 private payment;
    address private root;
    address private runner;

    function setUp() public {
        vm.warp(1_700_000_000);
        root = vm.addr(ROOT_KEY);
        runner = vm.addr(EXECUTOR_KEY);
        verifier = new MockPeragoVerifier(keccak256("perago.verifier.swap.v1"));
        MockPeragoVerifier stakeVerifier = new MockPeragoVerifier(keccak256("perago.verifier.stake.v1"));
        adapter = new MockSwapAdapter(address(verifier));
        executor =
            new MandateExecutor(address(adapter), address(new MockStakeAdapter(address(stakeVerifier))), 600, false);
        input = new MockERC20("Input", "IN");
        output = new MockERC20("Output", "OUT");
        payment = new MockERC20("United Stables", "U");
        input.mint(ACCOUNT, 100e18);
        output.mint(address(adapter), 100e18);
        escrow = new EvaluatorEscrow(address(payment));
        vm.etch(HOOK, hex"00");
        evaluator = new OutcomeEvaluator(address(executor), address(escrow), PROVIDER, HOOK, address(payment));
        payment.mint(address(escrow), BUDGET);

        PeragoTypes.AccountPolicy memory policy = PeragoTypes.AccountPolicy({
            account: ACCOUNT,
            rootOwner: root,
            ownerEpoch: 1,
            chainId: block.chainid,
            policyHash: keccak256("policy"),
            permissionHash: keccak256("permission"),
            validUntil: uint48(block.timestamp + 1 days)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ROOT_KEY, executor.hashAccountPolicy(policy));
        vm.prank(ACCOUNT);
        executor.setAccountPolicy(policy, abi.encodePacked(r, s, v));

        _job();
    }

    function test_rejectsAnUninstalledHookAtDeployment() public {
        vm.expectRevert(OutcomeEvaluator.InvalidDeploymentPair.selector);
        new OutcomeEvaluator(address(executor), address(escrow), PROVIDER, address(0xDEAD), address(payment));
    }

    function test_verifiedOutcomeReleasesEscrowExactlyOnce() public {
        bytes32 hash = _authorized();
        _perform(hash, false);
        bytes32 verificationHash = executor.mandateRecord(hash).verificationHash;
        assertTrue(verificationHash != bytes32(0));

        evaluator.settle(JOB_ID, hash);

        assertEq(payment.balanceOf(PROVIDER), BUDGET);
        assertEq(payment.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getJob(JOB_ID).status), uint8(IACP.JobStatus.Completed));
        assertTrue(evaluator.settled(address(escrow), JOB_ID));
        vm.expectRevert(OutcomeEvaluator.AlreadySettled.selector);
        evaluator.settle(JOB_ID, hash);
    }

    function testFuzz_aDifferentJobIdCannotUseThisSuccess(uint256 unrelatedJobId) public {
        vm.assume(unrelatedJobId != JOB_ID);
        bytes32 hash = _authorized();
        _perform(hash, false);
        vm.expectRevert(OutcomeEvaluator.SettlementNotEligible.selector);
        evaluator.settle(unrelatedJobId, hash);
        assertEq(payment.balanceOf(PROVIDER), 0);
        assertFalse(evaluator.settled(address(escrow), unrelatedJobId));
    }

    function test_failedVerifierCannotReleaseEscrow() public {
        bytes32 hash = _authorized();
        _perform(hash, true);
        assertEq(uint8(executor.mandateRecord(hash).status), uint8(PeragoTypes.MandateStatus.FAILED));
        _refuses(hash);
    }

    function test_revokedMandateCannotReleaseEscrow() public {
        bytes32 revoked = _authorized();
        vm.prank(ACCOUNT);
        executor.revoke(revoked);
        _refuses(revoked);
    }

    function test_expiredMandateCannotReleaseEscrow() public {
        bytes32 hash = _authorized();
        vm.warp(block.timestamp + 30 minutes);
        executor.finalizeExpired(hash);
        _refuses(hash);
    }

    function test_failedMandateRejectsEscrowAndRefundsClient() public {
        bytes32 hash = _authorized();
        _perform(hash, true);
        evaluator.reject(JOB_ID, hash);
        assertEq(payment.balanceOf(ACCOUNT), BUDGET);
        assertEq(payment.balanceOf(PROVIDER), 0);
        assertEq(uint8(escrow.getJob(JOB_ID).status), uint8(IACP.JobStatus.Rejected));
        vm.expectRevert(OutcomeEvaluator.SettlementNotEligible.selector);
        evaluator.settle(JOB_ID, hash);
    }

    function test_successCannotBePresentedAsARejection() public {
        bytes32 hash = _authorized();
        _perform(hash, false);
        vm.expectRevert(OutcomeEvaluator.SettlementNotEligible.selector);
        evaluator.reject(JOB_ID, hash);
        assertEq(payment.balanceOf(ACCOUNT), 0);
    }

    function test_refusesReceiptWhenThePinnedVerifierIdentityChanges() public {
        bytes32 hash = _authorized();
        _perform(hash, false);
        vm.mockCall(address(verifier), abi.encodeWithSignature("verifierId()"), abi.encode(bytes32(0)));
        _refuses(hash);
    }

    function test_unverifiedSuccessCommitmentCannotPay() public {
        bytes32 hash = _authorized();
        _perform(hash, false);
        PeragoTypes.MandateRecord memory record = executor.mandateRecord(hash);
        record.verificationHash = bytes32(0);
        vm.mockCall(address(executor), abi.encodeCall(executor.mandateRecord, (hash)), abi.encode(record));
        _refuses(hash);
    }

    function test_mismatchedJobFieldsCannotPay() public {
        bytes32 hash = _authorized();
        _perform(hash, false);
        IACP.Job memory job = escrow.getJob(JOB_ID);

        job.client = address(0xBAD);
        escrow.setJob(job);
        _refuses(hash);
        job.client = ACCOUNT;
        job.provider = address(0xBAD);
        escrow.setJob(job);
        _refuses(hash);
        job.provider = PROVIDER;
        job.evaluator = address(0xBAD);
        escrow.setJob(job);
        _refuses(hash);
        job.evaluator = address(evaluator);
        job.hook = address(0xBAD);
        escrow.setJob(job);
        _refuses(hash);
        job.hook = HOOK;
        job.status = IACP.JobStatus.Funded;
        escrow.setJob(job);
        _refuses(hash);
        job.status = IACP.JobStatus.Submitted;
        job.expiredAt = block.timestamp;
        escrow.setJob(job);
        _refuses(hash);
        job.expiredAt = block.timestamp + 1 hours;
        escrow.setJob(job);
        escrow.setJobToken(address(input));
        _refuses(hash);
        escrow.setJobToken(address(payment));
        vm.expectRevert(OutcomeEvaluator.SettlementNotEligible.selector);
        evaluator.settle(JOB_ID + 1, hash);
    }

    function test_escrowFailureRollsBackSettlementGuard() public {
        bytes32 hash = _authorized();
        _perform(hash, false);
        escrow.setRefuseCompletion(true);
        vm.expectRevert(bytes("escrow unavailable"));
        evaluator.settle(JOB_ID, hash);
        assertFalse(evaluator.settled(address(escrow), JOB_ID));
        escrow.setRefuseCompletion(false);
        evaluator.settle(JOB_ID, hash);
        assertEq(payment.balanceOf(PROVIDER), BUDGET);
    }

    function test_expiredJobRetainsIndependentRefundPath() public {
        bytes32 hash = _authorized();
        _perform(hash, false);
        IACP.Job memory job = escrow.getJob(JOB_ID);
        job.expiredAt = block.timestamp;
        escrow.setJob(job);
        _refuses(hash);
        // A third party, not the evaluator, can still trigger the upstream refund.
        vm.prank(address(0xBAD));
        escrow.claimRefund(JOB_ID);
        assertEq(payment.balanceOf(ACCOUNT), BUDGET);
    }

    function _refuses(bytes32 hash) private {
        vm.expectRevert(OutcomeEvaluator.SettlementNotEligible.selector);
        evaluator.settle(JOB_ID, hash);
        assertEq(payment.balanceOf(PROVIDER), 0);
        assertFalse(evaluator.settled(address(escrow), JOB_ID));
    }

    function _job() private {
        escrow.setJob(
            IACP.Job({
                id: JOB_ID,
                client: ACCOUNT,
                provider: PROVIDER,
                evaluator: address(evaluator),
                description: "bounded task",
                budget: BUDGET,
                expiredAt: block.timestamp + 1 hours,
                status: IACP.JobStatus.Submitted,
                hook: HOOK,
                submittedAt: block.timestamp,
                deliverable: keccak256("proof")
            })
        );
    }

    function _authorized() private returns (bytes32 hash) {
        PeragoTypes.TaskMandate memory m = PeragoTypes.TaskMandate({
            account: ACCOUNT,
            rootOwner: root,
            ownerEpoch: 1,
            executor: runner,
            chainId: block.chainid,
            nonce: 1,
            expiresAt: uint48(block.timestamp + 30 minutes),
            policyHash: keccak256("policy"),
            intentHash: keccak256("intent"),
            planHash: keccak256("plan"),
            simulationHash: keccak256("simulation"),
            adapter: address(adapter),
            adapterSelector: IPeragoAdapter.execute.selector,
            inputToken: address(input),
            maxInput: 5e18,
            outputToken: address(output),
            minOutput: 1e18,
            recipient: ACCOUNT,
            actionHash: keccak256(abi.encode(5e18, 2e18)),
            postconditionHash: keccak256("post"),
            commerceContract: address(escrow),
            commerceJobId: JOB_ID
        });
        hash = executor.hashMandate(m);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ROOT_KEY, hash);
        vm.prank(runner);
        executor.authorize(m, abi.encodePacked(r, s, v));
        mandate = m;
    }

    PeragoTypes.TaskMandate private mandate;

    function _perform(bytes32 hash, bool failVerifier) private {
        vm.prank(runner);
        executor.beginExecution(hash);
        if (failVerifier) verifier.setMode(MockPeragoVerifier.Mode.VERIFY_REVERTS);
        PeragoTypes.ExecutionProof memory proof = PeragoTypes.ExecutionProof({
            mandateHash: hash, account: ACCOUNT, executor: runner, validUntil: uint48(block.timestamp + 5 minutes)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EXECUTOR_KEY, executor.hashExecutionProof(proof));
        vm.startPrank(ACCOUNT);
        input.approve(address(executor), mandate.maxInput);
        executor.perform(mandate, abi.encode(5e18, 2e18), proof, abi.encodePacked(r, s, v));
        vm.stopPrank();
    }
}
