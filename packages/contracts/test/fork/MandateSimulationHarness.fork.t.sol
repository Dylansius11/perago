// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MandateExecutor} from "../../src/MandateExecutor.sol";
import {CakeStakeAdapter} from "../../src/adapters/CakeStakeAdapter.sol";
import {PancakeV3SwapAdapter} from "../../src/adapters/PancakeV3SwapAdapter.sol";
import {IPeragoVerifier} from "../../src/interfaces/IPeragoVerifier.sol";
import {MandateSimulationHarness} from "../../src/simulation/MandateSimulationHarness.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";
import {PeragoForkBase} from "./PeragoForkBase.sol";

interface IQuoterV2Single {
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

/// @notice `P3-004`: the pre-signature simulation must predict the real execution. The
/// harness runs at the account address with an injected `EXECUTING` record - the exact
/// state override the API applies - against the production adapters and verifiers, and
/// each observation is compared with the real authorize, begin, approve, perform path
/// from the same state.
contract MandateSimulationHarnessForkTest is PeragoForkBase {
    string private constant PERAGO_MANIFEST = "../../deployments/bsc-testnet.perago.json";
    /// `_mandates` is storage slot 2 of MandateExecutor (`forge inspect ... storageLayout`).
    uint256 private constant MANDATES_SLOT = 2;
    uint256 private constant SWAP_IN = 0.01 ether;
    uint256 private constant STAKE_IN = 1 ether;
    uint256 private constant SLIPPAGE_BPS = 100;
    uint256 private constant BPS = 10_000;

    address private wbnb;
    address private cake;
    PancakeV3SwapAdapter private swapAdapter;
    CakeStakeAdapter private stakeAdapter;
    uint256 private simulationKey = 0x51A;

    struct Real {
        PeragoTypes.MandateStatus status;
        uint256 inputSpent;
        uint256 outcomeDelta;
        bytes32 verificationHash;
    }

    /// A block after the production deployment in `bsc-testnet.perago.json`.
    function _forkBlock() internal pure override returns (uint256) {
        return 132_666_000;
    }

    function setUp() public {
        _selectFork();
        if (!forkReady) return;

        wbnb = _manifestAddress("wbnb");
        cake = _manifestAddress("cake");
        string memory perago = vm.readFile(PERAGO_MANIFEST);
        swapAdapter = PancakeV3SwapAdapter(vm.parseJsonAddress(perago, ".contracts.swapAdapter.address"));
        stakeAdapter = CakeStakeAdapter(vm.parseJsonAddress(perago, ".contracts.stakeAdapter.address"));
        // The production executor requires an ERC-8183 job, which a pre-signature mandate
        // cannot have yet; a local executor over the same production adapters proves the path.
        executor = new MandateExecutor(address(swapAdapter), address(stakeAdapter), EXECUTION_WINDOW, true);
        _register();
        deal(wbnb, account, 1 ether);
        deal(cake, account, 10 ether);
    }

    function test_swapSimulationPredictsTheRealExecution() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _swap(_quotedMinimum());

        MandateSimulationHarness.Observation memory observation = _simulateThenRollBack(mandate, action);
        Real memory real = _executeForReal(mandate, action);

        assertEq(uint8(observation.status), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertEq(uint8(real.status), uint8(observation.status));
        assertEq(observation.inputBalanceBefore - observation.inputBalanceAfter, SWAP_IN);
        assertEq(real.inputSpent, SWAP_IN);
        assertEq(observation.outcomeAfter - observation.outcomeBefore, real.outcomeDelta);
        assertGe(real.outcomeDelta, mandate.minOutput);
        assertEq(observation.verificationHash, real.verificationHash);
        assertEq(observation.allowanceAfter, 0, "the exact approval is consumed");
        assertGt(observation.gasUsed, 0);
    }

    function test_stakeSimulationPredictsTheRealExecution() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _stake(1);

        MandateSimulationHarness.Observation memory observation = _simulateThenRollBack(mandate, action);
        Real memory real = _executeForReal(mandate, action);

        assertEq(uint8(observation.status), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertEq(uint8(real.status), uint8(observation.status));
        assertEq(observation.inputBalanceBefore - observation.inputBalanceAfter, STAKE_IN);
        assertEq(observation.outcomeAfter - observation.outcomeBefore, real.outcomeDelta);
        assertGt(real.outcomeDelta, 0);
        assertEq(observation.verificationHash, real.verificationHash);
        assertEq(observation.allowanceAfter, 0);
    }

    function test_reportsTheTerminalFailureAnUnreachableMinimumWouldRecord() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _swap(_quotedMinimum() * 2);

        MandateSimulationHarness.Observation memory observation = _simulateThenRollBack(mandate, action);
        Real memory real = _executeForReal(mandate, action);

        assertEq(uint8(observation.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(uint8(real.status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(observation.inputBalanceAfter, observation.inputBalanceBefore, "a failed attempt rolls back");
        assertNotEq(observation.failureReasonHash, bytes32(0));
        // The approval the account granted is not consumed by a failed attempt, so the
        // execution UserOperation must clear it (P4-002).
        assertEq(observation.allowanceAfter, SWAP_IN);
    }

    function test_failsClosedWhenTheRecordOverrideMissesTheMapping() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _swap(_quotedMinimum());
        bytes32 mandateHash = executor.hashMandate(mandate);
        vm.etch(account, type(MandateSimulationHarness).runtimeCode);
        _injectExecutingRecord(mandate, mandateHash, MANDATES_SLOT + 1);

        (PeragoTypes.ExecutionProof memory proof, bytes memory signature) = _proof(mandateHash);
        vm.expectRevert(MandateSimulationHarness.RecordOverrideMismatch.selector);
        MandateSimulationHarness(account).simulate(executor, mandate, action, proof, signature);
    }

    // --- simulation, exactly as the API applies it ----------------------------------

    function _simulateThenRollBack(PeragoTypes.TaskMandate memory mandate, bytes memory action)
        private
        returns (MandateSimulationHarness.Observation memory observation)
    {
        uint256 snapshot = vm.snapshotState();
        bytes32 mandateHash = executor.hashMandate(mandate);
        vm.etch(account, type(MandateSimulationHarness).runtimeCode);
        _injectExecutingRecord(mandate, mandateHash, MANDATES_SLOT);
        (PeragoTypes.ExecutionProof memory proof, bytes memory signature) = _proof(mandateHash);
        observation = MandateSimulationHarness(account).simulate(executor, mandate, action, proof, signature);
        vm.revertToState(snapshot);
    }

    /// @dev The record the API writes: `EXECUTING`, started now, bound to a one-off
    /// simulation executor key, the signed adapter, and the verifier the executor pins.
    function _injectExecutingRecord(PeragoTypes.TaskMandate memory mandate, bytes32 mandateHash, uint256 mappingSlot)
        private
    {
        bytes32 base = keccak256(abi.encode(mandateHash, mappingSlot));
        address verifier = mandate.adapter == address(swapAdapter) ? executor.swapVerifier() : executor.stakeVerifier();
        _store(
            base,
            0,
            uint256(uint160(mandate.account)) | (uint256(mandate.expiresAt) << 160)
                | (uint256(uint8(PeragoTypes.MandateStatus.EXECUTING)) << 208)
        );
        _store(base, 1, uint256(uint160(vm.addr(simulationKey))) | (uint256(uint48(block.timestamp)) << 160));
        _store(base, 2, uint256(uint160(mandate.adapter)));
        _store(base, 3, uint256(uint160(verifier)));
        _store(base, 4, uint256(uint160(mandate.commerceContract)));
        _store(base, 5, mandate.commerceJobId);
    }

    function _store(bytes32 base, uint256 offset, uint256 value) private {
        vm.store(address(executor), bytes32(uint256(base) + offset), bytes32(value));
    }

    function _proof(bytes32 mandateHash)
        private
        view
        returns (PeragoTypes.ExecutionProof memory proof, bytes memory signature)
    {
        proof = PeragoTypes.ExecutionProof({
            mandateHash: mandateHash,
            account: account,
            executor: vm.addr(simulationKey),
            validUntil: uint48(block.timestamp) + PROOF_LIFETIME
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(simulationKey, executor.hashExecutionProof(proof));
        signature = abi.encodePacked(r, s, v);
    }

    // --- the real path from the same state ------------------------------------------

    function _executeForReal(PeragoTypes.TaskMandate memory mandate, bytes memory action)
        private
        returns (Real memory real)
    {
        IERC20 input = IERC20(mandate.inputToken);
        (uint256 outcomeBefore,) = _verifier(mandate).measure(mandate, action);
        uint256 inputBefore = input.balanceOf(account);
        bytes32 mandateHash;
        (mandateHash, real.status) = _execute(mandate, action);
        real.inputSpent = inputBefore - input.balanceOf(account);
        (uint256 outcomeAfter,) = _verifier(mandate).measure(mandate, action);
        real.outcomeDelta = outcomeAfter - outcomeBefore;
        real.verificationHash = executor.mandateRecord(mandateHash).verificationHash;
    }

    function _verifier(PeragoTypes.TaskMandate memory mandate) private view returns (IPeragoVerifier) {
        return
            IPeragoVerifier(
                mandate.adapter == address(swapAdapter) ? executor.swapVerifier() : executor.stakeVerifier()
            );
    }

    // --- mandates -------------------------------------------------------------------

    function _quotedMinimum() private returns (uint256) {
        (uint256 quoted,,,) = IQuoterV2Single(_manifestAddress("pancakeV3QuoterV2"))
            .quoteExactInputSingle(
                IQuoterV2Single.QuoteExactInputSingleParams({
                    tokenIn: wbnb, tokenOut: cake, amountIn: SWAP_IN, fee: swapAdapter.poolFee(), sqrtPriceLimitX96: 0
                })
            );
        return quoted * (BPS - SLIPPAGE_BPS) / BPS;
    }

    function _swap(uint256 minOut) private returns (PeragoTypes.TaskMandate memory mandate, bytes memory action) {
        mandate = _mandate(address(swapAdapter), wbnb, SWAP_IN, cake, minOut);
        action = abi.encode(
            PeragoTypes.SwapAction({
                tokenIn: wbnb,
                tokenOut: cake,
                poolFee: swapAdapter.poolFee(),
                amountIn: SWAP_IN,
                minAmountOut: minOut,
                recipient: account,
                deadline: mandate.expiresAt
            })
        );
        mandate.actionHash = keccak256(action);
        mandate.postconditionHash = keccak256(abi.encode(PeragoTypes.SWAP_POSTCONDITION_KIND, account, cake, minOut));
    }

    function _stake(uint256 minShares) private returns (PeragoTypes.TaskMandate memory mandate, bytes memory action) {
        mandate = _mandate(address(stakeAdapter), cake, STAKE_IN, cake, minShares);
        action = abi.encode(
            PeragoTypes.StakeAction({
                asset: cake,
                amount: STAKE_IN,
                minPositionOut: minShares,
                recipient: account,
                deadline: mandate.expiresAt,
                poolId: stakeAdapter.poolId()
            })
        );
        mandate.actionHash = keccak256(action);
        mandate.postconditionHash =
            keccak256(abi.encode(PeragoTypes.STAKE_POSTCONDITION_KIND, account, stakeAdapter.poolId(), minShares));
    }
}

