// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MandateExecutor} from "../../src/MandateExecutor.sol";
import {CakeStakeAdapter} from "../../src/adapters/CakeStakeAdapter.sol";
import {CakeStakePosition} from "../../src/adapters/CakeStakePosition.sol";
import {ICakePool} from "../../src/interfaces/ICakePool.sol";
import {IPeragoAdapter} from "../../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";
import {StakeVerifier} from "../../src/verifiers/StakeVerifier.sol";
import {MockSwapAdapter} from "../mocks/MockPeragoAdapter.sol";
import {MockPeragoVerifier} from "../mocks/MockPeragoVerifier.sol";
import {PeragoForkBase} from "./PeragoForkBase.sol";
import {ShortDepositPool} from "../mocks/ShortDepositPool.sol";

/// @notice `P5-001`: the bounded CAKE Pool stake against the real chain-97 pool. The pool
/// credits `msg.sender`, so every stake lands in a per-recipient `CakeStakePosition`;
/// these tests prove that holder belongs to the signed recipient alone, that only its
/// adapter can stake through it and only its owner can leave, and that the verifier
/// measures pool shares itself.
contract CakeStakeForkTest is PeragoForkBase {
    uint256 private constant AMOUNT = 1 ether;
    uint256 private constant ACCOUNT_FUNDING = 10 ether;

    address private cake;
    ICakePool private pool;

    StakeVerifier private stakeVerifier;
    CakeStakeAdapter private stakeAdapter;
    uint256 private expectedShares;

    function setUp() public {
        _selectFork();
        if (!forkReady) return;

        cake = _manifestAddress("cake");
        pool = ICakePool(_manifestAddress("cakePool"));

        stakeVerifier = new StakeVerifier(address(pool), cake);
        stakeAdapter = new CakeStakeAdapter(address(pool), cake, address(stakeVerifier));
        MockSwapAdapter swapStandIn = new MockSwapAdapter(address(new MockPeragoVerifier(keccak256("swap"))));
        executor = new MandateExecutor(address(swapStandIn), address(stakeAdapter), EXECUTION_WINDOW, true);
        _register();
        deal(cake, account, ACCOUNT_FUNDING);

        // The exact share delta this pinned block produces, measured once and rolled back.
        uint256 snapshot = vm.snapshotState();
        (PeragoTypes.TaskMandate memory probe, bytes memory action) = _bound(1);
        _callAdapter(probe, action);
        uint256 measured = _shares(account);
        vm.revertToState(snapshot); // also rolls back this contract's own storage
        expectedShares = measured;
        require(expectedShares > 0, "the pinned pool minted no shares");
    }

    // --- deployment pinning -----------------------------------------------------

    function test_pinsThePoolAssetAndIdentity() public onFork {
        assertEq(address(stakeAdapter.pool()), address(pool));
        assertEq(stakeAdapter.asset(), cake);
        assertEq(stakeAdapter.poolId(), keccak256("perago.stake.pancakeswap.cake-pool.flexible.v1"));
        assertEq(stakeAdapter.kind(), PeragoTypes.STAKE_ADAPTER_KIND);
        assertEq(stakeAdapter.verifier(), address(stakeVerifier));
        assertEq(stakeVerifier.verifierId(), keccak256("perago.verifier.stake.v1"));
        // The verifier's own helper reproduces the frozen cross-stack fixture.
        assertEq(
            stakeVerifier.postconditionHash(
                0x1111111111111111111111111111111111111111, stakeAdapter.poolId(), 987_654_321
            ),
            0xa57569c7d1be4a062fc50f256032ef11d84965e2d274094e6042b285f4261d49
        );
    }

    function test_refusesAPoolForAnotherAssetOrAVerifierWithoutCode() public onFork {
        vm.expectRevert(CakeStakeAdapter.InvalidDeploymentPair.selector);
        new CakeStakeAdapter(address(pool), _manifestAddress("wbnb"), address(stakeVerifier));
        vm.expectRevert(CakeStakeAdapter.InvalidDeploymentPair.selector);
        new CakeStakeAdapter(address(pool), cake, makeAddr("no-code-verifier"));
    }

    // --- closed action ------------------------------------------------------------

    function test_validateReturnsTheHashOfTheCanonicalAction() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        assertEq(stakeAdapter.validate(mandate, action), keccak256(action));
    }

    function test_rejectsAnyUnsignedOrUnpinnedActionField() public onFork {
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.StakeAction memory stake) = _boundParts(expectedShares);

        PeragoTypes.StakeAction memory mutated = _copy(stake);
        mutated.poolId = keccak256("another pool");
        _expectRejected(mandate, mutated, CakeStakeAdapter.InvalidTokenPair.selector);

        mutated = _copy(stake);
        mutated.amount = AMOUNT - 1;
        _expectRejected(mandate, mutated, CakeStakeAdapter.AmountOutOfBounds.selector);

        mutated = _copy(stake);
        mutated.minPositionOut = expectedShares - 1;
        _expectRejected(mandate, mutated, CakeStakeAdapter.AmountOutOfBounds.selector);

        mutated = _copy(stake);
        mutated.recipient = makeAddr("attacker");
        _expectRejected(mandate, mutated, CakeStakeAdapter.RecipientMismatch.selector);

        mutated = _copy(stake);
        mutated.deadline = mandate.expiresAt + 1;
        _expectRejected(mandate, mutated, CakeStakeAdapter.ExpiredMandate.selector);

        mutated = _copy(stake);
        mutated.deadline = 0;
        _expectRejected(mandate, mutated, CakeStakeAdapter.ExpiredMandate.selector);
    }

    function test_rejectsAnAssetOtherThanThePinnedOneEvenWhenSigned() public onFork {
        address wbnb = _manifestAddress("wbnb");
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.StakeAction memory stake) = _boundParts(expectedShares);
        mandate.inputToken = wbnb;
        mandate.outputToken = wbnb;
        stake.asset = wbnb;
        _expectRejected(mandate, stake, CakeStakeAdapter.InvalidTokenPair.selector);

        (mandate, stake) = _boundParts(expectedShares);
        mandate.outputToken = wbnb;
        _expectRejected(mandate, stake, CakeStakeAdapter.InvalidTokenPair.selector);
        (mandate, stake) = _boundParts(expectedShares);
        mandate.inputToken = wbnb;
        _expectRejected(mandate, stake, CakeStakeAdapter.InvalidTokenPair.selector);

        (mandate, stake) = _boundParts(expectedShares);
        stake.asset = wbnb;
        _expectRejected(mandate, stake, CakeStakeAdapter.InvalidTokenPair.selector);
    }

    function test_rejectsAZeroMinimumEvenWhenSigned() public onFork {
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.StakeAction memory stake) = _boundParts(expectedShares);
        mandate.minOutput = 0;
        stake.minPositionOut = 0;
        _expectRejected(mandate, stake, CakeStakeAdapter.AmountOutOfBounds.selector);
    }

    /// @dev Pins the exact reason: without the allowance reset the revert would be
    /// `AllowanceNotCleared`, and without the balance check the short deposit succeeds.
    function test_holderRejectsADepositThatLeavesInputBehind() public onFork {
        ShortDepositPool shortPool = new ShortDepositPool(cake);
        CakeStakePosition holder = new CakeStakePosition(account, address(shortPool), cake);
        deal(cake, address(holder), AMOUNT);
        vm.expectRevert(CakeStakePosition.ResidualBalance.selector);
        holder.stake(AMOUNT);
    }

    function test_onlyTheOwnerWithdrawsPartially() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        _callAdapter(mandate, action);
        CakeStakePosition holder = CakeStakePosition(stakeAdapter.positionOf(account));
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(CakeStakePosition.WrongAccountCaller.selector);
        holder.withdraw(1);
    }

    function test_rejectsNonCanonicalActionBytes() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        vm.expectRevert(CakeStakeAdapter.InvalidAction.selector);
        stakeAdapter.validate(mandate, bytes.concat(action, bytes32(0)));
    }

    function test_rejectsAMandateNamingAnotherAdapterOrSelector() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);

        mandate.adapter = makeAddr("other-adapter");
        vm.expectRevert(CakeStakeAdapter.UnsupportedAdapter.selector);
        stakeAdapter.validate(mandate, action);

        mandate.adapter = address(stakeAdapter);
        mandate.adapterSelector = IPeragoAdapter.validate.selector;
        vm.expectRevert(CakeStakeAdapter.WrongSelector.selector);
        stakeAdapter.validate(mandate, action);
    }

    // --- protocol call and the per-recipient holder ------------------------------

    function test_executeStakesIntoTheRecipientsOwnHolderAndKeepsNothing() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        address holder = stakeAdapter.positionOf(account);
        assertEq(holder.code.length, 0);

        PeragoTypes.AdapterResult memory result = _callAdapter(mandate, action);

        assertEq(CakeStakePosition(holder).owner(), account);
        assertEq(CakeStakePosition(holder).adapter(), address(stakeAdapter));
        assertEq(_shares(account), expectedShares);
        assertEq(_poolShares(address(stakeAdapter)), 0);
        assertEq(result.inputSpent, AMOUNT);
        assertEq(result.outputOrPositionReceived, expectedShares);
        assertEq(result.protocolEvidenceHash, keccak256(abi.encode(address(pool), holder, AMOUNT, expectedShares)));
        assertEq(IERC20(cake).balanceOf(address(stakeAdapter)), 0);
        assertEq(IERC20(cake).balanceOf(holder), 0);
        assertEq(IERC20(cake).allowance(holder, address(pool)), 0);
        assertEq(IERC20(cake).allowance(address(stakeAdapter), holder), 0);
    }

    function test_recipientsNeverShareAHolder() public onFork {
        address other = makeAddr("another-account");
        assertTrue(stakeAdapter.positionOf(account) != stakeAdapter.positionOf(other));
    }

    function test_aSecondStakeReusesTheSameHolder() public onFork {
        (PeragoTypes.TaskMandate memory first, bytes memory firstAction) = _bound(expectedShares);
        _callAdapter(first, firstAction);
        uint256 afterFirst = _shares(account);

        (PeragoTypes.TaskMandate memory second, bytes memory secondAction) = _bound(1);
        _callAdapter(second, secondAction);

        assertGt(_shares(account), afterFirst);
    }

    function test_executeRevertsAfterTheActionDeadline() public onFork {
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.StakeAction memory stake) = _boundParts(1);
        stake.deadline = uint48(block.timestamp) + 1;
        bytes memory action = abi.encode(stake);
        deal(cake, address(this), AMOUNT);
        IERC20(cake).approve(address(stakeAdapter), AMOUNT);
        vm.warp(block.timestamp + 2);
        vm.expectRevert(CakeStakeAdapter.ExpiredMandate.selector);
        stakeAdapter.execute(mandate, action);
    }

    function test_executeRevertsWhenTheSignedMinimumIsUnreachable() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares + 1);
        deal(cake, address(this), AMOUNT);
        IERC20(cake).approve(address(stakeAdapter), AMOUNT);
        vm.expectRevert(CakeStakeAdapter.AmountOutOfBounds.selector);
        stakeAdapter.execute(mandate, action);
    }

    function test_onlyTheAdapterStakesThroughAHolder() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        _callAdapter(mandate, action);
        CakeStakePosition holder = CakeStakePosition(stakeAdapter.positionOf(account));

        vm.prank(account);
        vm.expectRevert(CakeStakePosition.UnsupportedAdapter.selector);
        holder.stake(AMOUNT);
    }

    function test_onlyTheOwnerLeavesAndReceivesEveryUnit() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        _callAdapter(mandate, action);
        CakeStakePosition holder = CakeStakePosition(stakeAdapter.positionOf(account));
        deal(cake, address(holder), 5); // a donation belongs to the owner, not to whoever calls

        vm.prank(makeAddr("attacker"));
        vm.expectRevert(CakeStakePosition.WrongAccountCaller.selector);
        holder.withdrawAll();

        uint256 before = IERC20(cake).balanceOf(account);
        vm.prank(account);
        holder.withdrawAll();

        assertEq(_shares(account), 0);
        assertEq(IERC20(cake).balanceOf(address(holder)), 0);
        // Inside the fee window the pool keeps its documented 0.1% early-withdrawal fee.
        assertGe(IERC20(cake).balanceOf(account) - before, AMOUNT * 998 / 1000);
    }

    function test_ownerCanLeavePartially() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        _callAdapter(mandate, action);
        CakeStakePosition holder = CakeStakePosition(stakeAdapter.positionOf(account));

        vm.prank(account);
        holder.withdraw(expectedShares / 2);

        assertEq(_shares(account), expectedShares - expectedShares / 2);
        assertEq(IERC20(cake).balanceOf(address(holder)), 0);
        assertGt(IERC20(cake).balanceOf(account), ACCOUNT_FUNDING - AMOUNT);
    }

    // --- verifier -----------------------------------------------------------------

    function test_verifierRejectsAForeignPostcondition() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        mandate.postconditionHash = keccak256("another mandate's postcondition");
        vm.expectRevert(StakeVerifier.PostconditionHashMismatch.selector);
        stakeVerifier.measure(mandate, action);
    }

    function test_verifierRejectsAnActionOtherThanTheSignedCommitment() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        mandate.actionHash = keccak256("a different action");
        vm.expectRevert(StakeVerifier.ActionHashMismatch.selector);
        stakeVerifier.measure(mandate, action);
    }

    function test_verifierRejectsAnAdapterPairedWithAnotherVerifier() public onFork {
        CakeStakeAdapter foreign =
            new CakeStakeAdapter(address(pool), cake, address(new StakeVerifier(address(pool), cake)));
        (PeragoTypes.TaskMandate memory mandate, PeragoTypes.StakeAction memory stake) = _boundParts(expectedShares);
        mandate.adapter = address(foreign);
        bytes memory action = abi.encode(stake);
        mandate.actionHash = keccak256(action);
        vm.expectRevert(StakeVerifier.UnsupportedAdapter.selector);
        stakeVerifier.measure(mandate, action);
    }

    function test_verifierRejectsAContextItDidNotProduce() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        (uint256 before, bytes32 context) = stakeVerifier.measure(mandate, action);
        PeragoTypes.AdapterResult memory result = PeragoTypes.AdapterResult(AMOUNT, expectedShares, bytes32(0));
        vm.expectRevert(StakeVerifier.ContextMismatch.selector);
        stakeVerifier.verify(mandate, action, before + 1, context, result);
    }

    function test_verifierRejectsAPositionBelowTheSignedMinimum() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        (uint256 before, bytes32 context) = stakeVerifier.measure(mandate, action);
        PeragoTypes.AdapterResult memory result = PeragoTypes.AdapterResult(AMOUNT, expectedShares, bytes32(0));
        vm.expectRevert(StakeVerifier.VerificationFailed.selector);
        stakeVerifier.verify(mandate, action, before, context, result);
    }

    function test_verifierRejectsAClaimedSpendOtherThanTheSignedInput() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);
        (uint256 before, bytes32 context) = stakeVerifier.measure(mandate, action);
        _callAdapter(mandate, action);
        PeragoTypes.AdapterResult memory result = PeragoTypes.AdapterResult(AMOUNT - 1, expectedShares, bytes32(0));
        vm.expectRevert(StakeVerifier.AmountOutOfBounds.selector);
        stakeVerifier.verify(mandate, action, before, context, result);
    }

    // --- through MandateExecutor --------------------------------------------------

    function test_mandateStakesThroughTheExecutorToASucceededReceipt() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares);

        (bytes32 mandateHash, PeragoTypes.MandateStatus status) = _execute(mandate, action);

        assertEq(uint8(status), uint8(PeragoTypes.MandateStatus.SUCCEEDED));
        assertEq(_shares(account), expectedShares);
        assertEq(IERC20(cake).balanceOf(account), ACCOUNT_FUNDING - AMOUNT);
        _assertExecutorHoldsNothing();

        bytes32 protocolEvidence =
            keccak256(abi.encode(address(pool), stakeAdapter.positionOf(account), AMOUNT, expectedShares));
        bytes32 evidenceHash =
            keccak256(abi.encode(mandate.postconditionHash, AMOUNT, expectedShares, protocolEvidence));
        bytes32 expected = keccak256(abi.encode(mandateHash, AMOUNT, expectedShares, evidenceHash, protocolEvidence));
        assertEq(executor.mandateRecord(mandateHash).verificationHash, expected);
    }

    function test_mandateWithAnUnreachableMinimumFailsTerminallyAndMovesNothing() public onFork {
        (PeragoTypes.TaskMandate memory mandate, bytes memory action) = _bound(expectedShares * 2);

        (bytes32 mandateHash, PeragoTypes.MandateStatus status) = _execute(mandate, action);

        assertEq(uint8(status), uint8(PeragoTypes.MandateStatus.FAILED));
        assertEq(executor.mandateRecord(mandateHash).verificationHash, bytes32(0));
        assertEq(IERC20(cake).balanceOf(account), ACCOUNT_FUNDING);
        assertEq(stakeAdapter.positionOf(account).code.length, 0);
        _assertExecutorHoldsNothing();
    }

    // --- helpers ------------------------------------------------------------------

    function _boundParts(uint256 minShares)
        private
        returns (PeragoTypes.TaskMandate memory mandate, PeragoTypes.StakeAction memory stake)
    {
        mandate = _mandate(address(stakeAdapter), cake, AMOUNT, cake, minShares);
        stake = PeragoTypes.StakeAction({
            asset: cake,
            amount: AMOUNT,
            minPositionOut: minShares,
            recipient: account,
            deadline: mandate.expiresAt,
            poolId: stakeAdapter.poolId()
        });
        mandate.actionHash = keccak256(abi.encode(stake));
        mandate.postconditionHash = stakeVerifier.postconditionHash(account, stakeAdapter.poolId(), minShares);
    }

    function _bound(uint256 minShares) private returns (PeragoTypes.TaskMandate memory mandate, bytes memory action) {
        PeragoTypes.StakeAction memory stake;
        (mandate, stake) = _boundParts(minShares);
        action = abi.encode(stake);
    }

    function _callAdapter(PeragoTypes.TaskMandate memory mandate, bytes memory action)
        private
        returns (PeragoTypes.AdapterResult memory result)
    {
        address caller = makeAddr("caller");
        deal(cake, caller, AMOUNT);
        vm.startPrank(caller);
        IERC20(cake).approve(address(stakeAdapter), AMOUNT);
        result = stakeAdapter.execute(mandate, action);
        vm.stopPrank();
    }

    function _expectRejected(
        PeragoTypes.TaskMandate memory mandate,
        PeragoTypes.StakeAction memory stake,
        bytes4 selector
    ) private {
        bytes memory action = abi.encode(stake);
        mandate.actionHash = keccak256(action);
        vm.expectRevert(selector);
        stakeAdapter.validate(mandate, action);
    }

    function _copy(PeragoTypes.StakeAction memory stake) private pure returns (PeragoTypes.StakeAction memory) {
        return abi.decode(abi.encode(stake), (PeragoTypes.StakeAction));
    }

    function _shares(address recipient) private view returns (uint256) {
        return _poolShares(stakeAdapter.positionOf(recipient));
    }

    function _poolShares(address user) private view returns (uint256 shares) {
        (shares,,,,,,,,) = pool.userInfo(user);
    }

    function _assertExecutorHoldsNothing() private view {
        assertEq(IERC20(cake).balanceOf(address(executor)), 0);
        assertEq(IERC20(cake).allowance(address(executor), address(stakeAdapter)), 0);
        assertEq(IERC20(cake).balanceOf(address(stakeAdapter)), 0);
    }
}
