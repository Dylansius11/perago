// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {OutcomeEvaluator} from "../../src/OutcomeEvaluator.sol";
import {MandateExecutor} from "../../src/MandateExecutor.sol";
import {PancakeV3SwapAdapter} from "../../src/adapters/PancakeV3SwapAdapter.sol";
import {IACP} from "../../src/interfaces/IACP.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";
import {SwapVerifier} from "../../src/verifiers/SwapVerifier.sol";
import {MockStakeAdapter} from "../mocks/MockPeragoAdapter.sol";
import {MockPeragoVerifier} from "../mocks/MockPeragoVerifier.sol";
import {PeragoForkBase} from "./PeragoForkBase.sol";

interface IApexLifecycle is IACP {
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256);
    function setBudget(uint256 jobId, uint256 budget, bytes calldata optParams) external;
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams) external;
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external;
    function claimRefund(uint256 jobId) external;
}

interface IQuoterForSettlement {
    struct Quote {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }
    function quoteExactInputSingle(Quote calldata quote) external returns (uint256 amountOut, uint160, uint32, uint256);
}

/// @notice Real chain-97 APEX proxy, Perago hook, swap router, and token on a pinned fork.
/// Payment balances are seeded locally; no fork transaction is claimed as live testnet proof.
contract OutcomeEvaluatorForkTest is PeragoForkBase {
    uint256 private constant BUDGET = 0.01 ether;
    uint256 private constant AMOUNT_IN = 0.01 ether;
    bytes32 private constant IMPLEMENTATION_SLOT = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    IApexLifecycle private kernel;
    OutcomeEvaluator private evaluator;
    PancakeV3SwapAdapter private swapAdapter;
    SwapVerifier private swapVerifier;
    IERC20 private payment;
    address private provider;
    address private hook;
    address private wbnb;
    address private cake;
    uint256 private quote;

    function setUp() public {
        _selectFork();
        if (!forkReady) return;
        string memory manifest = vm.readFile(_manifestPath());
        address commerce = _manifestAddress("apexKernel");
        hook = _manifestAddress("peragoAcpHook");
        provider = makeAddr("settlement-provider");
        wbnb = _manifestAddress("wbnb");
        cake = _manifestAddress("cake");
        payment = IERC20(_manifestAddress("apexPaymentToken"));
        kernel = IApexLifecycle(commerce);

        // Fail closed on an upstream proxy or implementation change at the evidence block.
        assertEq(commerce.codehash, vm.parseJsonBytes32(manifest, ".contracts.apexKernel.codeHash"));
        address implementation = address(uint160(uint256(vm.load(commerce, IMPLEMENTATION_SLOT))));
        assertEq(implementation, vm.parseJsonAddress(manifest, ".contracts.apexKernel.erc1967Implementation"));
        assertEq(implementation.codehash, vm.parseJsonBytes32(manifest, ".contracts.apexKernel.implementationCodeHash"));
        assertEq(kernel.paymentToken(), address(payment));
        assertEq(hook.codehash, vm.parseJsonBytes32(manifest, ".contracts.peragoAcpHook.codeHash"));

        swapVerifier = new SwapVerifier();
        swapAdapter = new PancakeV3SwapAdapter(
            _manifestAddress("pancakeV3SwapRouter"), wbnb, cake, _manifestSwapFee(), address(swapVerifier)
        );
        MockStakeAdapter stake = new MockStakeAdapter(address(new MockPeragoVerifier(keccak256("stake"))));
        executor = new MandateExecutor(address(swapAdapter), address(stake), EXECUTION_WINDOW, false);
        _register();
        evaluator = new OutcomeEvaluator(address(executor), commerce, provider, hook, address(payment));
        deal(wbnb, account, 1 ether);
        deal(address(payment), account, BUDGET * 3);
        (quote,,,) = IQuoterForSettlement(_manifestAddress("pancakeV3QuoterV2"))
            .quoteExactInputSingle(IQuoterForSettlement.Quote(wbnb, cake, AMOUNT_IN, _manifestSwapFee(), 0));
        assertGt(quote, 0);
    }

    function test_realKernelPaysOnlyAfterMeasuredSwapSuccess() public onFork {
        uint256 jobId = _fundAndSubmit();
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(jobId, quote * 9 / 10);
        (bytes32 hash, PeragoTypes.MandateStatus outcome) = _execute(mandate, action);
        assertEq(uint8(outcome), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        uint256 beforeProvider = payment.balanceOf(provider);
        evaluator.settle(jobId, hash);
        assertEq(uint8(kernel.getJob(jobId).status), uint8(IACP.JobStatus.Completed));
        assertEq(payment.balanceOf(provider) - beforeProvider, BUDGET);
        assertTrue(evaluator.settled(address(kernel), jobId));
        vm.expectRevert(OutcomeEvaluator.AlreadySettled.selector);
        evaluator.settle(jobId, hash);
    }

    function test_realKernelRejectsFailedSwapAndRefundsClient() public onFork {
        uint256 jobId = _fundAndSubmit();
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(jobId, quote * 2);
        (bytes32 hash, PeragoTypes.MandateStatus outcome) = _execute(mandate, action);
        assertEq(uint8(outcome), uint8(PeragoTypes.MandateStatus.FAILED));
        uint256 beforeClient = payment.balanceOf(account);
        vm.expectRevert(OutcomeEvaluator.SettlementNotEligible.selector);
        evaluator.settle(jobId, hash);
        evaluator.reject(jobId, hash);
        assertEq(uint8(kernel.getJob(jobId).status), uint8(IACP.JobStatus.Rejected));
        assertEq(payment.balanceOf(account) - beforeClient, BUDGET);
        assertEq(payment.balanceOf(provider), 0);
    }

    function test_realKernelRefundsExpiredJobEvenAfterSuccess() public onFork {
        uint256 jobId = _fundAndSubmit();
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(jobId, quote * 9 / 10);
        (bytes32 hash, PeragoTypes.MandateStatus outcome) = _execute(mandate, action);
        assertEq(uint8(outcome), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        uint256 beforeClient = payment.balanceOf(account);
        vm.warp(kernel.getJob(jobId).expiredAt);
        vm.expectRevert(OutcomeEvaluator.SettlementNotEligible.selector);
        evaluator.settle(jobId, hash);
        vm.prank(makeAddr("unrelated-refunder"));
        kernel.claimRefund(jobId);
        assertEq(uint8(kernel.getJob(jobId).status), uint8(IACP.JobStatus.Expired));
        assertEq(payment.balanceOf(account) - beforeClient, BUDGET);
        assertEq(payment.balanceOf(provider), 0);
    }

    function _fundAndSubmit() private returns (uint256 jobId) {
        vm.prank(account);
        jobId = kernel.createJob(provider, address(evaluator), block.timestamp + 1 hours, "bounded job", hook);
        vm.startPrank(account);
        kernel.setBudget(jobId, BUDGET, "");
        payment.approve(address(kernel), BUDGET);
        kernel.fund(jobId, BUDGET, "");
        vm.stopPrank();
        assertEq(payment.allowance(account, address(kernel)), 0);
        vm.prank(provider);
        kernel.submit(jobId, keccak256("deliverable"), "");
        assertEq(kernel.jobPaymentToken(jobId), address(payment));
    }

    function _bound(uint256 jobId, uint256 minimum)
        private
        returns (PeragoTypes.TaskMandate memory mandate, bytes memory action)
    {
        mandate = _mandate(address(swapAdapter), wbnb, AMOUNT_IN, cake, minimum);
        mandate.commerceContract = address(kernel);
        mandate.commerceJobId = jobId;
        PeragoTypes.SwapAction memory swap = PeragoTypes.SwapAction({
            tokenIn: wbnb,
            tokenOut: cake,
            poolFee: _manifestSwapFee(),
            amountIn: AMOUNT_IN,
            minAmountOut: minimum,
            recipient: account,
            deadline: mandate.expiresAt
        });
        action = abi.encode(swap);
        mandate.actionHash = keccak256(action);
        mandate.postconditionHash = swapVerifier.postconditionHash(account, cake, minimum);
    }
}
