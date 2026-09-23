// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MandateExecutor} from "../../src/MandateExecutor.sol";
import {PancakeV3SwapAdapter} from "../../src/adapters/PancakeV3SwapAdapter.sol";
import {SwapVerifier} from "../../src/verifiers/SwapVerifier.sol";
import {IPancakeV3Factory, IPancakeV3SwapRouter} from "../../src/interfaces/IPancakeV3.sol";
import {IPeragoAdapter} from "../../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";
import {MockStakeAdapter} from "../mocks/MockPeragoAdapter.sol";
import {MockPeragoVerifier} from "../mocks/MockPeragoVerifier.sol";
import {PartialFillRouter} from "../mocks/PartialFillRouter.sol";
import {PeragoForkBase} from "./PeragoForkBase.sol";

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @notice `P4-001`: the bounded PancakeSwap V3 swap against the real chain-97 router and
/// pool. Every test names the break it guards: an unpinned route, an amount, minimum,
/// recipient, or deadline the owner never signed, a standing approval, or an output the
/// verifier did not measure at the recipient.
contract PancakeV3SwapForkTest is PeragoForkBase {
    uint24 private constant POOL_FEE = 500;
    uint256 private constant AMOUNT_IN = 0.05 ether;
    uint256 private constant ACCOUNT_FUNDING = 1 ether;

    address private wbnb;
    address private cake;
    address private router;
    address private quoter;

    SwapVerifier private swapVerifier;
    PancakeV3SwapAdapter private swapAdapter;
    uint256 private quoted;

    function setUp() public {
        _selectFork();
        if (!forkReady) return;

        wbnb = _manifestAddress("wbnb");
        cake = _manifestAddress("cake");
        router = _manifestAddress("pancakeV3SwapRouter");
        quoter = _manifestAddress("pancakeV3QuoterV2");

        swapVerifier = new SwapVerifier();
        swapAdapter = new PancakeV3SwapAdapter(router, wbnb, cake, POOL_FEE, address(swapVerifier));
        MockStakeAdapter stakeStandIn = new MockStakeAdapter(address(new MockPeragoVerifier(keccak256("stake"))));
        executor = new MandateExecutor(address(swapAdapter), address(stakeStandIn), EXECUTION_WINDOW, true);
        _register();
        deal(wbnb, account, ACCOUNT_FUNDING);

        (quoted,,,) = IQuoterV2(quoter)
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                    tokenIn: wbnb, tokenOut: cake, amountIn: AMOUNT_IN, fee: POOL_FEE, sqrtPriceLimitX96: 0
                })
            );
        require(quoted > 0, "the pinned pool quotes nothing");
    }

    // --- deployment pinning -----------------------------------------------------

    function test_pinsTheFactoryPoolForThePairAndFee() public onFork {
        address factory = IPancakeV3SwapRouter(router).factory();
        assertEq(address(swapAdapter.router()), router);
        assertEq(swapAdapter.pool(), IPancakeV3Factory(factory).getPool(wbnb, cake, POOL_FEE));
        assertEq(swapAdapter.poolFee(), POOL_FEE);
        assertEq(swapAdapter.kind(), PeragoTypes.SWAP_ADAPTER_KIND);
        assertEq(swapAdapter.verifier(), address(swapVerifier));
        assertEq(swapVerifier.verifierId(), keccak256("perago.verifier.swap.v1"));
    }

    function test_refusesAFeeTierWithoutAPool() public onFork {
        vm.expectRevert(PancakeV3SwapAdapter.InvalidDeploymentPair.selector);
        new PancakeV3SwapAdapter(router, wbnb, cake, 1234, address(swapVerifier));
    }

    function test_refusesAnIdenticalPairOrAVerifierWithoutCode() public onFork {
        vm.expectRevert(PancakeV3SwapAdapter.InvalidDeploymentPair.selector);
        new PancakeV3SwapAdapter(router, wbnb, wbnb, POOL_FEE, address(swapVerifier));
        vm.expectRevert(PancakeV3SwapAdapter.InvalidDeploymentPair.selector);
        new PancakeV3SwapAdapter(router, wbnb, cake, POOL_FEE, makeAddr("no-code-verifier"));
    }

    // --- closed action ------------------------------------------------------------

    function test_validateReturnsTheHashOfTheCanonicalAction() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);
        assertEq(swapAdapter.validate(mandate, action), keccak256(action));
    }

    function test_rejectsAnyUnsignedOrUnpinnedActionField() public onFork {
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.SwapAction memory swap) = _boundParts(quoted);

        PeragoTypes.SwapAction memory mutated = _copy(swap);
        mutated.tokenIn = cake;
        mutated.tokenOut = wbnb;
        _expectRejected(mandate, mutated, PancakeV3SwapAdapter.InvalidTokenPair.selector);

        mutated = _copy(swap);
        mutated.poolFee = 2500;
        _expectRejected(mandate, mutated, PancakeV3SwapAdapter.InvalidTokenPair.selector);

        mutated = _copy(swap);
        mutated.amountIn = swap.amountIn - 1;
        _expectRejected(mandate, mutated, PancakeV3SwapAdapter.AmountOutOfBounds.selector);

        mutated = _copy(swap);
        mutated.minAmountOut = swap.minAmountOut - 1;
        _expectRejected(mandate, mutated, PancakeV3SwapAdapter.AmountOutOfBounds.selector);

        mutated = _copy(swap);
        mutated.recipient = makeAddr("attacker");
        _expectRejected(mandate, mutated, PancakeV3SwapAdapter.RecipientMismatch.selector);

        mutated = _copy(swap);
        mutated.deadline = mandate.expiresAt + 1;
        _expectRejected(mandate, mutated, PancakeV3SwapAdapter.ExpiredMandate.selector);

        mutated = _copy(swap);
        mutated.deadline = 0;
        _expectRejected(mandate, mutated, PancakeV3SwapAdapter.ExpiredMandate.selector);
    }

    function test_rejectsATokenOutsideThePinnedPoolEvenWhenSigned() public onFork {
        address foreign = _manifestAddress("apexPaymentToken");
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.SwapAction memory swap) = _boundParts(quoted);
        mandate.outputToken = foreign;
        swap.tokenOut = foreign;
        _expectRejected(mandate, swap, PancakeV3SwapAdapter.InvalidTokenPair.selector);
    }

    function test_rejectsNonCanonicalActionBytes() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);

        vm.expectRevert(PancakeV3SwapAdapter.InvalidAction.selector);
        swapAdapter.validate(mandate, bytes.concat(action, bytes32(0)));

        bytes memory truncated = new bytes(action.length - 32);
        for (uint256 i = 0; i < truncated.length; ++i) {
            truncated[i] = action[i];
        }
        vm.expectRevert(PancakeV3SwapAdapter.InvalidAction.selector);
        swapAdapter.validate(mandate, truncated);
    }

    function test_rejectsAMandateNamingAnotherAdapterOrSelector() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);

        mandate.adapter = makeAddr("other-adapter");
        vm.expectRevert(PancakeV3SwapAdapter.UnsupportedAdapter.selector);
        swapAdapter.validate(mandate, action);

        mandate.adapter = address(swapAdapter);
        mandate.adapterSelector = IPeragoAdapter.validate.selector;
        vm.expectRevert(PancakeV3SwapAdapter.WrongSelector.selector);
        swapAdapter.validate(mandate, action);
    }

    // --- protocol call ------------------------------------------------------------

    function test_executeSwapsTheExactInputToTheRecipientAndHoldsNothing() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);
        address caller = makeAddr("caller");
        deal(wbnb, caller, AMOUNT_IN);
        // A donation must neither block the swap nor be swept into it.
        deal(wbnb, address(swapAdapter), 7);

        vm.startPrank(caller);
        IERC20(wbnb).approve(address(swapAdapter), AMOUNT_IN);
        PeragoTypes.AdapterResult memory result = swapAdapter.execute(mandate, action);
        vm.stopPrank();

        assertEq(result.inputSpent, AMOUNT_IN);
        assertEq(result.outputOrPositionReceived, quoted);
        assertEq(IERC20(cake).balanceOf(account), quoted);
        assertEq(IERC20(wbnb).balanceOf(caller), 0);
        assertEq(IERC20(wbnb).balanceOf(address(swapAdapter)), 7);
        assertEq(IERC20(cake).balanceOf(address(swapAdapter)), 0);
        assertEq(IERC20(wbnb).allowance(address(swapAdapter), router), 0);
        assertEq(result.protocolEvidenceHash, keccak256(abi.encode(swapAdapter.pool(), AMOUNT_IN, quoted)));
    }

    function test_executeRevertsWhenTheSignedMinimumIsUnreachable() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted + 1);
        _fundCaller();
        vm.expectRevert();
        swapAdapter.execute(mandate, action);
    }

    function test_executeRevertsAfterTheActionDeadline() public onFork {
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.SwapAction memory swap) = _boundParts(quoted);
        swap.deadline = uint48(block.timestamp) + 1;
        bytes memory action = abi.encode(swap);
        _fundCaller();
        vm.warp(block.timestamp + 2);
        vm.expectRevert();
        swapAdapter.execute(mandate, action);
    }

    /// @dev Pins the exact reason: without the allowance reset the revert would be
    /// `AllowanceNotCleared`, and without the residual check the partial fill succeeds.
    function test_executeRejectsAPartialFillThatLeavesInputBehind() public onFork {
        PartialFillRouter shortRouter = new PartialFillRouter(IPancakeV3SwapRouter(router).factory());
        PancakeV3SwapAdapter partialAdapter =
            new PancakeV3SwapAdapter(address(shortRouter), wbnb, cake, POOL_FEE, address(swapVerifier));
        deal(cake, address(shortRouter), quoted);

        PeragoTypes.TaskMandate memory mandate = _mandate(address(partialAdapter), wbnb, AMOUNT_IN, cake, quoted);
        bytes memory action = abi.encode(
            PeragoTypes.SwapAction({
                tokenIn: wbnb,
                tokenOut: cake,
                poolFee: POOL_FEE,
                amountIn: AMOUNT_IN,
                minAmountOut: quoted,
                recipient: account,
                deadline: mandate.expiresAt
            })
        );
        deal(wbnb, address(this), AMOUNT_IN);
        IERC20(wbnb).approve(address(partialAdapter), AMOUNT_IN);

        vm.expectRevert(PancakeV3SwapAdapter.ResidualBalance.selector);
        partialAdapter.execute(mandate, action);
    }

    // --- verifier -----------------------------------------------------------------

    function test_verifierRejectsAnActionOtherThanTheSignedCommitment() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);
        mandate.actionHash = keccak256("a different action");
        vm.expectRevert(SwapVerifier.ActionHashMismatch.selector);
        swapVerifier.measure(mandate, action);
    }

    function test_verifierRejectsAForeignPostcondition() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);
        mandate.postconditionHash = keccak256("another mandate's postcondition");
        vm.expectRevert(SwapVerifier.PostconditionHashMismatch.selector);
        swapVerifier.measure(mandate, action);
    }

    function test_verifierRejectsAnAdapterPairedWithAnotherVerifier() public onFork {
        SwapVerifier other = new SwapVerifier();
        PancakeV3SwapAdapter foreign = new PancakeV3SwapAdapter(router, wbnb, cake, POOL_FEE, address(other));
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.SwapAction memory swap) = _boundParts(quoted);
        mandate.adapter = address(foreign);
        bytes memory action = abi.encode(swap);
        mandate.actionHash = keccak256(action);
        vm.expectRevert(SwapVerifier.UnsupportedAdapter.selector);
        swapVerifier.measure(mandate, action);
    }

    function test_verifierRejectsAContextItDidNotProduce() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);
        (uint256 before, bytes32 context) = swapVerifier.measure(mandate, action);
        PeragoTypes.AdapterResult memory result = PeragoTypes.AdapterResult(AMOUNT_IN, quoted, bytes32(0));
        vm.expectRevert(SwapVerifier.ContextMismatch.selector);
        swapVerifier.verify(mandate, action, before + 1, context, result);
    }

    function test_verifierRejectsAnOutputBelowTheSignedMinimum() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);
        (uint256 before, bytes32 context) = swapVerifier.measure(mandate, action);
        deal(cake, account, before + quoted - 1);
        PeragoTypes.AdapterResult memory result = PeragoTypes.AdapterResult(AMOUNT_IN, quoted, bytes32(0));
        vm.expectRevert(SwapVerifier.VerificationFailed.selector);
        swapVerifier.verify(mandate, action, before, context, result);
    }

    function test_verifierRejectsAClaimedSpendOtherThanTheSignedInput() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);
        (uint256 before, bytes32 context) = swapVerifier.measure(mandate, action);
        deal(cake, account, before + quoted);
        PeragoTypes.AdapterResult memory result = PeragoTypes.AdapterResult(AMOUNT_IN - 1, quoted, bytes32(0));
        vm.expectRevert(SwapVerifier.AmountOutOfBounds.selector);
        swapVerifier.verify(mandate, action, before, context, result);
    }

    // --- through MandateExecutor --------------------------------------------------

    function test_mandateSwapsThroughTheExecutorToASucceededReceipt() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted);

        (bytes32 mandateHash, PeragoTypes.MandateStatus status) = _execute(mandate, action);

        assertEq(uint8(status), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertEq(IERC20(cake).balanceOf(account), quoted);
        assertEq(IERC20(wbnb).balanceOf(account), ACCOUNT_FUNDING - AMOUNT_IN);
        _assertExecutorHoldsNothing();

        bytes32 evidenceHash =
            keccak256(abi.encode(mandate.postconditionHash, AMOUNT_IN, quoted, _protocolEvidence(quoted)));
        bytes32 expected =
            keccak256(abi.encode(mandateHash, AMOUNT_IN, quoted, evidenceHash, _protocolEvidence(quoted)));
        assertEq(executor.mandateRecord(mandateHash).verificationHash, expected);
    }

    function test_mandateWithAnUnreachableMinimumFailsTerminallyAndMovesNothing() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(quoted * 2);

        (bytes32 mandateHash, PeragoTypes.MandateStatus status) = _execute(mandate, action);

        assertEq(uint8(status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(executor.mandateRecord(mandateHash).verificationHash, bytes32(0));
        assertEq(IERC20(wbnb).balanceOf(account), ACCOUNT_FUNDING);
        assertEq(IERC20(cake).balanceOf(account), 0);
        _assertExecutorHoldsNothing();
    }

    function testFuzz_validateAcceptsOnlyTheSignedAmounts(uint256 amountIn, uint256 minAmountOut) public onFork {
        vm.assume(amountIn != AMOUNT_IN || minAmountOut != quoted);
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.SwapAction memory swap) = _boundParts(quoted);
        swap.amountIn = amountIn;
        swap.minAmountOut = minAmountOut;
        _expectRejected(mandate, swap, PancakeV3SwapAdapter.AmountOutOfBounds.selector);
    }

    // --- helpers ------------------------------------------------------------------

    function _boundParts(uint256 minOut)
        private
        returns (PeragoTypes.TaskMandate memory mandate, PeragoTypes.SwapAction memory swap)
    {
        mandate = _mandate(address(swapAdapter), wbnb, AMOUNT_IN, cake, minOut);
        swap = PeragoTypes.SwapAction({
            tokenIn: wbnb,
            tokenOut: cake,
            poolFee: POOL_FEE,
            amountIn: AMOUNT_IN,
            minAmountOut: minOut,
            recipient: account,
            deadline: mandate.expiresAt
        });
        mandate.actionHash = keccak256(abi.encode(swap));
        mandate.postconditionHash = swapVerifier.postconditionHash(account, cake, minOut);
    }

    function _bound(uint256 minOut) private returns (PeragoTypes.TaskMandate memory mandate, bytes memory action) {
        PeragoTypes.SwapAction memory swap;
        (mandate, swap) = _boundParts(minOut);
        action = abi.encode(swap);
    }

    function _expectRejected(
        PeragoTypes.TaskMandate memory mandate,
        PeragoTypes.SwapAction memory swap,
        bytes4 selector
    ) private {
        bytes memory action = abi.encode(swap);
        mandate.actionHash = keccak256(action);
        vm.expectRevert(selector);
        swapAdapter.validate(mandate, action);
    }

    function _copy(PeragoTypes.SwapAction memory swap) private pure returns (PeragoTypes.SwapAction memory) {
        return abi.decode(abi.encode(swap), (PeragoTypes.SwapAction));
    }

    function _fundCaller() private {
        deal(wbnb, address(this), AMOUNT_IN);
        IERC20(wbnb).approve(address(swapAdapter), AMOUNT_IN);
    }

    function _protocolEvidence(uint256 amountOut) private view returns (bytes32) {
        return keccak256(abi.encode(swapAdapter.pool(), AMOUNT_IN, amountOut));
    }

    function _assertExecutorHoldsNothing() private view {
        assertEq(IERC20(wbnb).balanceOf(address(executor)), 0);
        assertEq(IERC20(cake).balanceOf(address(executor)), 0);
        assertEq(IERC20(wbnb).allowance(address(executor), address(swapAdapter)), 0);
        assertEq(IERC20(wbnb).allowance(address(swapAdapter), router), 0);
    }
}
