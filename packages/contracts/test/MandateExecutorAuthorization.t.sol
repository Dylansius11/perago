// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {MandateExecutor} from "../src/MandateExecutor.sol";
import {IPeragoAdapter} from "../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../src/types/PeragoTypes.sol";
import {TaskMandateFixtures} from "./fixtures/TaskMandateFixtures.sol";
import {MockStakeAdapter, MockSwapAdapter} from "./mocks/MockPeragoAdapter.sol";
import {MockPeragoVerifier} from "./mocks/MockPeragoVerifier.sol";

/// @notice `P2-001`: the authorization lifecycle. Every test here asserts a boundary a
/// compromised executor, a replayed signature, or a stale policy would otherwise cross.
contract MandateExecutorAuthorizationTest is Test {
    /// Recomputed independently of the contract so a typehash edit cannot pass silently.
    bytes32 private constant ACCOUNT_POLICY_TYPEHASH = keccak256(
        "AccountPolicy(address account,address rootOwner,uint64 ownerEpoch,uint256 chainId,bytes32 policyHash,bytes32 permissionHash,uint48 validUntil)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    uint48 private constant EXECUTION_WINDOW = 15 minutes;
    uint48 private constant MANDATE_LIFETIME = 30 minutes;
    uint256 private constant MAX_INPUT = 5e18;
    uint256 private constant MIN_OUTPUT = 1e18;
    address private constant COMMERCE = address(0xC0FFEE);
    uint256 private constant JOB_ID = 1258;

    uint256 private rootOwnerKey = 0xA11CE;
    uint256 private newOwnerKey = 0xB0B;
    uint256 private sessionKey = 0x5E5510;
    address private rootOwner;
    address private newOwner;
    address private sessionSigner;

    address private account = address(0xACC0);
    address private executorSigner = address(0xE0E0);
    address private attacker = address(0xBAD);

    MandateExecutor private executor;
    MandateExecutor private localExecutor;
    MockSwapAdapter private swapAdapter;
    MockStakeAdapter private stakeAdapter;
    TaskMandateFixtures private fixtures;

    event AccountPolicySet(
        address indexed account,
        address indexed rootOwner,
        uint64 ownerEpoch,
        bytes32 policyHash,
        bytes32 permissionHash
    );
    event MandateAuthorized(
        bytes32 indexed mandateHash, address indexed account, address indexed executor, uint256 nonce, uint48 expiresAt
    );
    event MandateRevoked(bytes32 indexed mandateHash, address indexed account);
    event MandateExpired(bytes32 indexed mandateHash);
    event CommerceJobBound(address indexed commerceContract, uint256 indexed jobId, bytes32 indexed mandateHash);
    event NoncesInvalidated(address indexed account, uint256[] nonces);

    function setUp() public {
        vm.warp(1_700_000_000);
        rootOwner = vm.addr(rootOwnerKey);
        newOwner = vm.addr(newOwnerKey);
        sessionSigner = vm.addr(sessionKey);

        swapAdapter = new MockSwapAdapter(address(new MockPeragoVerifier(keccak256("perago.verifier.swap.v1"))));
        stakeAdapter = new MockStakeAdapter(address(new MockPeragoVerifier(keccak256("perago.verifier.stake.v1"))));
        executor = new MandateExecutor(address(swapAdapter), address(stakeAdapter), EXECUTION_WINDOW, false);
        localExecutor = new MandateExecutor(address(swapAdapter), address(stakeAdapter), EXECUTION_WINDOW, true);
        fixtures = new TaskMandateFixtures();

        _register(executor, rootOwnerKey, rootOwner, 1, keccak256("policy.v1"));
        _register(localExecutor, rootOwnerKey, rootOwner, 1, keccak256("policy.v1"));
    }

    // --- deployment pinning ---------------------------------------------------

    function test_pinsAdapterVerifierPairsAtConstruction() public view {
        assertEq(executor.swapAdapter(), address(swapAdapter));
        assertEq(executor.stakeAdapter(), address(stakeAdapter));
        assertEq(executor.swapVerifier(), swapAdapter.verifier());
        assertEq(executor.stakeVerifier(), stakeAdapter.verifier());
        assertEq(executor.executionWindow(), EXECUTION_WINDOW);
    }

    function test_rejectsMislabeledAdapterPair() public {
        vm.expectRevert(MandateExecutor.InvalidDeploymentPair.selector);
        new MandateExecutor(address(stakeAdapter), address(stakeAdapter), EXECUTION_WINDOW, false);
    }

    function test_rejectsSharedVerifierAcrossAdapters() public {
        address sharedVerifier = address(new MockPeragoVerifier(keccak256("perago.verifier.shared")));
        MockSwapAdapter swap = new MockSwapAdapter(sharedVerifier);
        MockStakeAdapter stake = new MockStakeAdapter(sharedVerifier);
        vm.expectRevert(MandateExecutor.InvalidDeploymentPair.selector);
        new MandateExecutor(address(swap), address(stake), EXECUTION_WINDOW, false);
    }

    function test_rejectsExecutionWindowOutsideBounds() public {
        vm.expectRevert(MandateExecutor.InvalidExecutionWindow.selector);
        new MandateExecutor(address(swapAdapter), address(stakeAdapter), 0, false);

        vm.expectRevert(MandateExecutor.InvalidExecutionWindow.selector);
        new MandateExecutor(
            address(swapAdapter), address(stakeAdapter), uint48(executor.MAX_EXECUTION_WINDOW()) + 1, false
        );
    }

    // --- account policy registration -----------------------------------------

    function test_registersAccountPolicyFromTheAccount() public {
        PeragoTypes.AccountConfig memory config = executor.accountConfig(account);
        assertEq(config.rootOwner, rootOwner);
        assertEq(config.ownerEpoch, 1);
        assertEq(config.activePolicyHash, keccak256("policy.v1"));
        assertEq(config.permissionHash, keccak256("permission.v1"));
        assertTrue(executor.isRegistered(account));
    }

    function test_emitsAccountPolicySet() public {
        PeragoTypes.AccountPolicy memory policy = _policy(rootOwner, 2, keccak256("policy.v2"));
        vm.expectEmit(true, true, false, true, address(executor));
        emit AccountPolicySet(account, rootOwner, 2, keccak256("policy.v2"), keccak256("permission.v1"));
        vm.prank(account);
        executor.setAccountPolicy(policy, _signPolicy(policy, rootOwnerKey));
    }

    function test_rejectsPolicyRegistrationFromAnotherCaller() public {
        PeragoTypes.AccountPolicy memory policy = _policy(rootOwner, 2, keccak256("policy.v2"));
        bytes memory signature = _signPolicy(policy, rootOwnerKey);
        vm.expectRevert(MandateExecutor.WrongAccountCaller.selector);
        vm.prank(attacker);
        executor.setAccountPolicy(policy, signature);
    }

    function test_rejectsPolicySignedByAnotherKey() public {
        PeragoTypes.AccountPolicy memory policy = _policy(rootOwner, 2, keccak256("policy.v2"));
        bytes memory signature = _signPolicy(policy, sessionKey);
        vm.expectRevert(MandateExecutor.InvalidRootSignature.selector);
        vm.prank(account);
        executor.setAccountPolicy(policy, signature);
    }

    function test_rejectsPolicyForAnotherChain() public {
        PeragoTypes.AccountPolicy memory policy = _policy(rootOwner, 2, keccak256("policy.v2"));
        policy.chainId = block.chainid + 1;
        bytes memory signature = _signPolicy(policy, rootOwnerKey);
        vm.expectRevert(MandateExecutor.WrongChain.selector);
        vm.prank(account);
        executor.setAccountPolicy(policy, signature);
    }

    function test_rejectsPolicyForAnotherAccount() public {
        PeragoTypes.AccountPolicy memory policy = _policy(rootOwner, 2, keccak256("policy.v2"));
        policy.account = attacker;
        bytes memory signature = _signPolicy(policy, rootOwnerKey);
        vm.expectRevert(MandateExecutor.WrongAccountCaller.selector);
        vm.prank(account);
        executor.setAccountPolicy(policy, signature);
    }

    function test_rejectsExpiredPolicyRegistration() public {
        PeragoTypes.AccountPolicy memory policy = _policy(rootOwner, 2, keccak256("policy.v2"));
        policy.validUntil = uint48(block.timestamp);
        bytes memory signature = _signPolicy(policy, rootOwnerKey);
        vm.expectRevert(MandateExecutor.ExpiredPolicy.selector);
        vm.prank(account);
        executor.setAccountPolicy(policy, signature);
    }

    function test_rejectsPolicyWithEmptyCommitments() public {
        _expectPolicyFieldRejection(_zeroOwnerPolicy());
        _expectPolicyFieldRejection(_zeroEpochPolicy());
        _expectPolicyFieldRejection(_zeroPolicyHashPolicy());
        _expectPolicyFieldRejection(_zeroPermissionHashPolicy());
    }

    function test_allowsPolicyReplacementAtSameEpochForSameOwner() public {
        PeragoTypes.AccountPolicy memory policy = _policy(rootOwner, 1, keccak256("policy.v2"));
        vm.prank(account);
        executor.setAccountPolicy(policy, _signPolicy(policy, rootOwnerKey));
        assertEq(executor.accountConfig(account).activePolicyHash, keccak256("policy.v2"));
    }

    function test_rejectsPolicyEpochRegression() public {
        _register(executor, rootOwnerKey, rootOwner, 4, keccak256("policy.v2"));
        PeragoTypes.AccountPolicy memory policy = _policy(rootOwner, 3, keccak256("policy.v3"));
        bytes memory signature = _signPolicy(policy, rootOwnerKey);
        vm.expectRevert(MandateExecutor.OwnerEpochMismatch.selector);
        vm.prank(account);
        executor.setAccountPolicy(policy, signature);
    }

    function test_requiresGreaterEpochForNewRootOwner() public {
        PeragoTypes.AccountPolicy memory sameEpoch = _policy(newOwner, 1, keccak256("policy.v2"));
        bytes memory signature = _signPolicy(sameEpoch, newOwnerKey);
        vm.expectRevert(MandateExecutor.OwnerEpochMismatch.selector);
        vm.prank(account);
        executor.setAccountPolicy(sameEpoch, signature);

        _register(executor, newOwnerKey, newOwner, 2, keccak256("policy.v2"));
        assertEq(executor.accountConfig(account).rootOwner, newOwner);
    }

    function test_policyReplacementInvalidatesMandatesSignedForOldPolicy() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        _register(executor, rootOwnerKey, rootOwner, 1, keccak256("policy.v2"));

        vm.expectRevert(MandateExecutor.PolicyHashMismatch.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_ownerRotationInvalidatesMandatesSignedByTheOldOwner() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        _register(executor, newOwnerKey, newOwner, 2, keccak256("policy.v1"));

        vm.expectRevert(MandateExecutor.RootOwnerMismatch.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    // --- authorization --------------------------------------------------------

    function test_authorizesMandateAndConsumesNonce() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(7, address(swapAdapter));
        bytes32 mandateHash = executor.hashMandate(mandate);

        vm.expectEmit(true, true, true, false, address(executor));
        emit CommerceJobBound(COMMERCE, JOB_ID, mandateHash);
        vm.expectEmit(true, true, true, true, address(executor));
        emit MandateAuthorized(mandateHash, account, executorSigner, 7, mandate.expiresAt);
        bytes memory sig1 = _signMandate(mandate, rootOwnerKey);
        vm.prank(executorSigner);
        assertEq(executor.authorize(mandate, sig1), mandateHash);

        PeragoTypes.MandateRecord memory record = executor.mandateRecord(mandateHash);
        assertEq(uint8(record.status), uint8(PeragoTypes.MandateStatus.AUTHORIZED));
        assertEq(record.account, account);
        assertEq(record.executor, executorSigner);
        assertEq(record.adapter, address(swapAdapter));
        assertEq(record.verifier, swapAdapter.verifier());
        assertEq(record.expiresAt, mandate.expiresAt);
        assertEq(record.executionStartedAt, 0);
        assertEq(record.commerceContract, COMMERCE);
        assertEq(record.commerceJobId, JOB_ID);
        assertTrue(executor.isNonceUsed(account, 7));
        assertEq(executor.commerceJobBinding(COMMERCE, JOB_ID), mandateHash);
    }

    function test_rejectsAuthorizeFromNonExecutor() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.WrongExecutor.selector);
        vm.prank(attacker);
        executor.authorize(mandate, signature);
    }

    function test_rejectsMandateForAnotherChain() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.chainId = block.chainid + 1;
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.WrongChain.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_rejectsExpiredMandate() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.warp(mandate.expiresAt);
        vm.expectRevert(MandateExecutor.ExpiredMandate.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_rejectsUnpinnedAdapter() public {
        MockSwapAdapter rogue = new MockSwapAdapter(address(new MockPeragoVerifier(keccak256("rogue"))));
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(rogue));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.UnsupportedAdapter.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_rejectsWrongAdapterSelector() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.adapterSelector = IPeragoAdapter.validate.selector;
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.WrongSelector.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_rejectsUnregisteredAccount() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.account = attacker;
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.UnsupportedAccount.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_rejectsOwnerEpochMismatch() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.ownerEpoch = 2;
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.OwnerEpochMismatch.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    /// Invariant 12: no session key, bundler key, or executor key is root authority.
    function test_rejectsSessionKeySignatureAsRoot() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, sessionKey);
        vm.expectRevert(MandateExecutor.InvalidRootSignature.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_rejectsMalleableRootSignature() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rootOwnerKey, executor.hashMandate(mandate));
        uint256 flippedS = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - uint256(s);
        bytes memory malleable = abi.encodePacked(r, bytes32(flippedS), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(MandateExecutor.InvalidRootSignature.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, malleable);
    }

    function test_rejectsSwapMandateWithIdenticalTokens() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.outputToken = mandate.inputToken;
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.InvalidTokenPair.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    /// A single-asset stake legitimately measures the position in the staked asset.
    function test_acceptsStakeMandateWithIdenticalTokens() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(stakeAdapter));
        mandate.outputToken = mandate.inputToken;
        bytes memory sig2 = _signMandate(mandate, rootOwnerKey);
        vm.prank(executorSigner);
        bytes32 mandateHash = executor.authorize(mandate, sig2);
        assertEq(executor.mandateRecord(mandateHash).verifier, stakeAdapter.verifier());
    }

    function test_rejectsMandateWithEmptyCommitments() public {
        _expectMandateFieldRejection(_mandateWithZeroField(1));
        _expectMandateFieldRejection(_mandateWithZeroField(2));
        _expectMandateFieldRejection(_mandateWithZeroField(3));
        _expectMandateFieldRejection(_mandateWithZeroField(4));
        _expectMandateFieldRejection(_mandateWithZeroField(5));
    }

    function test_rejectsMandateWithZeroAmounts() public {
        PeragoTypes.TaskMandate memory zeroInput = _mandate(1, address(swapAdapter));
        zeroInput.maxInput = 0;
        bytes memory inputSignature = _signMandate(zeroInput, rootOwnerKey);
        vm.expectRevert(MandateExecutor.AmountOutOfBounds.selector);
        vm.prank(executorSigner);
        executor.authorize(zeroInput, inputSignature);

        PeragoTypes.TaskMandate memory zeroOutput = _mandate(2, address(swapAdapter));
        zeroOutput.minOutput = 0;
        bytes memory outputSignature = _signMandate(zeroOutput, rootOwnerKey);
        vm.expectRevert(MandateExecutor.AmountOutOfBounds.selector);
        vm.prank(executorSigner);
        executor.authorize(zeroOutput, outputSignature);
    }

    function test_rejectsMandateReplay() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);

        vm.expectRevert(MandateExecutor.NonceAlreadyUsed.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_rejectsSecondMandateOnSameNonce() public {
        PeragoTypes.TaskMandate memory first = _mandate(1, address(swapAdapter));
        bytes memory sig3 = _signMandate(first, rootOwnerKey);
        vm.prank(executorSigner);
        executor.authorize(first, sig3);

        PeragoTypes.TaskMandate memory second = _mandate(1, address(swapAdapter));
        second.actionHash = keccak256("another action");
        second.commerceJobId = JOB_ID + 1;
        bytes memory signature = _signMandate(second, rootOwnerKey);
        vm.expectRevert(MandateExecutor.NonceAlreadyUsed.selector);
        vm.prank(executorSigner);
        executor.authorize(second, signature);
    }

    function test_rejectsSecondMandateOnSameCommerceJob() public {
        PeragoTypes.TaskMandate memory first = _mandate(1, address(swapAdapter));
        bytes memory sig4 = _signMandate(first, rootOwnerKey);
        vm.prank(executorSigner);
        executor.authorize(first, sig4);

        PeragoTypes.TaskMandate memory second = _mandate(2, address(swapAdapter));
        bytes memory signature = _signMandate(second, rootOwnerKey);
        vm.expectRevert(MandateExecutor.CommerceJobAlreadyBound.selector);
        vm.prank(executorSigner);
        executor.authorize(second, signature);
    }

    function test_rejectsUnboundCommerceJobUnlessConfigured() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.commerceContract = address(0);
        mandate.commerceJobId = 0;
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.CommerceBindingRequired.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_allowsUnboundCommerceJobOnLocalDeployment() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.commerceContract = address(0);
        mandate.commerceJobId = 0;
        bytes memory sig5 = _signLocalMandate(mandate, rootOwnerKey);
        vm.prank(executorSigner);
        bytes32 mandateHash = localExecutor.authorize(mandate, sig5);
        assertEq(uint8(localExecutor.mandateRecord(mandateHash).status), uint8(PeragoTypes.MandateStatus.AUTHORIZED));
    }

    function test_rejectsPartiallyBoundCommerceJob() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.commerceJobId = 0;
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.CommerceBindingRequired.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    // --- nonce invalidation ---------------------------------------------------

    function test_invalidateNoncesBlocksAuthorization() public {
        uint256[] memory nonces = new uint256[](2);
        nonces[0] = 11;
        nonces[1] = 12;

        vm.expectEmit(true, false, false, true, address(executor));
        emit NoncesInvalidated(account, nonces);
        vm.prank(account);
        executor.invalidateNonces(nonces);

        PeragoTypes.TaskMandate memory mandate = _mandate(11, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.NonceAlreadyUsed.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function test_rejectsInvalidateNoncesFromAnotherCaller() public {
        uint256[] memory nonces = new uint256[](1);
        nonces[0] = 11;
        vm.expectRevert(MandateExecutor.UnsupportedAccount.selector);
        vm.prank(attacker);
        executor.invalidateNonces(nonces);
    }

    function test_rejectsInvalidateOfAlreadyUsedNonce() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory sig6 = _signMandate(mandate, rootOwnerKey);
        vm.prank(executorSigner);
        executor.authorize(mandate, sig6);

        uint256[] memory nonces = new uint256[](1);
        nonces[0] = 1;
        vm.expectRevert(MandateExecutor.NonceAlreadyUsed.selector);
        vm.prank(account);
        executor.invalidateNonces(nonces);
    }

    // --- revocation and expiry ------------------------------------------------

    function test_revokeEndsAuthorityFromTheAccount() public {
        bytes32 mandateHash = _authorize(1);

        vm.expectEmit(true, true, false, false, address(executor));
        emit MandateRevoked(mandateHash, account);
        vm.prank(account);
        executor.revoke(mandateHash);

        assertEq(uint8(executor.mandateRecord(mandateHash).status), uint8(PeragoTypes.MandateStatus.REVOKED));
        assertTrue(executor.isNonceUsed(account, 1));
    }

    function test_rejectsRevokeFromAnotherCaller() public {
        bytes32 mandateHash = _authorize(1);
        vm.expectRevert(MandateExecutor.WrongAccountCaller.selector);
        vm.prank(attacker);
        executor.revoke(mandateHash);
    }

    function test_rejectsSecondRevoke() public {
        bytes32 mandateHash = _authorize(1);
        vm.prank(account);
        executor.revoke(mandateHash);
        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(account);
        executor.revoke(mandateHash);
    }

    function test_rejectsRevokeOfUnknownMandate() public {
        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(account);
        executor.revoke(keccak256("never authorized"));
    }

    function test_finalizeExpiredIsPermissionlessAfterExpiry() public {
        bytes32 mandateHash = _authorize(1);
        vm.warp(block.timestamp + MANDATE_LIFETIME);

        vm.expectEmit(true, false, false, false, address(executor));
        emit MandateExpired(mandateHash);
        vm.prank(attacker);
        executor.finalizeExpired(mandateHash);

        assertEq(uint8(executor.mandateRecord(mandateHash).status), uint8(PeragoTypes.MandateStatus.EXPIRED));
    }

    function test_rejectsFinalizeExpiredBeforeExpiry() public {
        bytes32 mandateHash = _authorize(1);
        vm.expectRevert(MandateExecutor.MandateNotExpired.selector);
        executor.finalizeExpired(mandateHash);
    }

    function test_rejectsFinalizeExpiredAfterRevocation() public {
        bytes32 mandateHash = _authorize(1);
        vm.prank(account);
        executor.revoke(mandateHash);
        vm.warp(block.timestamp + MANDATE_LIFETIME);
        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        executor.finalizeExpired(mandateHash);
    }

    function test_rejectsRevokeAfterExpiryIsFinalized() public {
        bytes32 mandateHash = _authorize(1);
        vm.warp(block.timestamp + MANDATE_LIFETIME);
        executor.finalizeExpired(mandateHash);
        vm.expectRevert(MandateExecutor.InvalidTransition.selector);
        vm.prank(account);
        executor.revoke(mandateHash);
    }

    // --- digest binding ------------------------------------------------------

    /// The contract must hash exactly what the SDK signs; the fixture carries the frozen vector.
    function test_matchesTheCrossStackDigest() public view {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        assertEq(executor.hashMandate(mandate), fixtures.hashTypedData(mandate, block.chainid, address(executor)));
    }

    function test_domainSeparatorTracksTheRunningChain() public {
        bytes32 before = executor.domainSeparator();
        vm.chainId(block.chainid + 1);
        assertTrue(before != executor.domainSeparator());
    }

    function test_rejectsMandateSignedForAnotherDeployment() public {
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signLocalMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.InvalidRootSignature.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    // --- fuzz ----------------------------------------------------------------

    function testFuzz_mutatedNonceBreaksTheRootSignature(uint256 nonce, uint256 mutatedNonce) public {
        vm.assume(nonce != mutatedNonce);
        PeragoTypes.TaskMandate memory mandate = _mandate(nonce, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        mandate.nonce = mutatedNonce;
        vm.expectRevert(MandateExecutor.InvalidRootSignature.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function testFuzz_mutatedRecipientBreaksTheRootSignature(address recipient) public {
        vm.assume(recipient != account && recipient != address(0));
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        mandate.recipient = recipient;
        vm.expectRevert(MandateExecutor.InvalidRootSignature.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function testFuzz_mutatedInputBoundBreaksTheRootSignature(uint256 maxInput) public {
        vm.assume(maxInput != MAX_INPUT && maxInput != 0);
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        mandate.maxInput = maxInput;
        vm.expectRevert(MandateExecutor.InvalidRootSignature.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function testFuzz_nonceConsumptionSurvivesEveryTerminalPath(uint256 nonce, bool revokeInstead) public {
        PeragoTypes.TaskMandate memory mandate = _mandate(nonce, address(swapAdapter));
        bytes memory sig7 = _signMandate(mandate, rootOwnerKey);
        vm.prank(executorSigner);
        bytes32 mandateHash = executor.authorize(mandate, sig7);

        if (revokeInstead) {
            vm.prank(account);
            executor.revoke(mandateHash);
        } else {
            vm.warp(mandate.expiresAt);
            executor.finalizeExpired(mandateHash);
        }

        assertTrue(executor.isNonceUsed(account, nonce));
    }

    function testFuzz_authorizationRejectsAnyExpiryAtOrBeforeNow(uint48 expiresAt) public {
        vm.assume(expiresAt <= uint48(block.timestamp));
        PeragoTypes.TaskMandate memory mandate = _mandate(1, address(swapAdapter));
        mandate.expiresAt = expiresAt;
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.ExpiredMandate.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    // --- helpers -------------------------------------------------------------

    function _authorize(uint256 nonce) private returns (bytes32) {
        PeragoTypes.TaskMandate memory mandate = _mandate(nonce, address(swapAdapter));
        bytes memory sig8 = _signMandate(mandate, rootOwnerKey);
        vm.prank(executorSigner);
        return executor.authorize(mandate, sig8);
    }

    function _mandate(uint256 nonce, address adapter) private view returns (PeragoTypes.TaskMandate memory) {
        return PeragoTypes.TaskMandate({
            account: account,
            rootOwner: executor.accountConfig(account).rootOwner,
            ownerEpoch: executor.accountConfig(account).ownerEpoch,
            executor: executorSigner,
            chainId: block.chainid,
            nonce: nonce,
            expiresAt: uint48(block.timestamp) + MANDATE_LIFETIME,
            policyHash: executor.accountConfig(account).activePolicyHash,
            intentHash: keccak256("intent"),
            planHash: keccak256("plan"),
            simulationHash: keccak256("simulation"),
            adapter: adapter,
            adapterSelector: IPeragoAdapter.execute.selector,
            inputToken: address(0x1111),
            maxInput: MAX_INPUT,
            outputToken: address(0x2222),
            minOutput: MIN_OUTPUT,
            recipient: account,
            actionHash: keccak256("action"),
            postconditionHash: keccak256("postcondition"),
            commerceContract: COMMERCE,
            commerceJobId: JOB_ID
        });
    }

    function _mandateWithZeroField(uint256 field) private view returns (PeragoTypes.TaskMandate memory mandate) {
        mandate = _mandate(field, address(swapAdapter));
        if (field == 1) {
            mandate.recipient = address(0);
        } else if (field == 2) {
            mandate.inputToken = address(0);
        } else if (field == 3) {
            mandate.actionHash = bytes32(0);
        } else if (field == 4) {
            mandate.postconditionHash = bytes32(0);
        } else {
            mandate.simulationHash = bytes32(0);
        }
    }

    function _expectMandateFieldRejection(PeragoTypes.TaskMandate memory mandate) private {
        bytes memory signature = _signMandate(mandate, rootOwnerKey);
        vm.expectRevert(MandateExecutor.InvalidMandateField.selector);
        vm.prank(executorSigner);
        executor.authorize(mandate, signature);
    }

    function _policy(address owner, uint64 epoch, bytes32 policyHash)
        private
        view
        returns (PeragoTypes.AccountPolicy memory)
    {
        return PeragoTypes.AccountPolicy({
            account: account,
            rootOwner: owner,
            ownerEpoch: epoch,
            chainId: block.chainid,
            policyHash: policyHash,
            permissionHash: keccak256("permission.v1"),
            validUntil: uint48(block.timestamp) + 1 hours
        });
    }

    function _zeroOwnerPolicy() private view returns (PeragoTypes.AccountPolicy memory policy) {
        policy = _policy(rootOwner, 2, keccak256("policy.v2"));
        policy.rootOwner = address(0);
    }

    function _zeroEpochPolicy() private view returns (PeragoTypes.AccountPolicy memory policy) {
        policy = _policy(rootOwner, 0, keccak256("policy.v2"));
    }

    function _zeroPolicyHashPolicy() private view returns (PeragoTypes.AccountPolicy memory policy) {
        policy = _policy(rootOwner, 2, bytes32(0));
    }

    function _zeroPermissionHashPolicy() private view returns (PeragoTypes.AccountPolicy memory policy) {
        policy = _policy(rootOwner, 2, keccak256("policy.v2"));
        policy.permissionHash = bytes32(0);
    }

    function _expectPolicyFieldRejection(PeragoTypes.AccountPolicy memory policy) private {
        bytes memory signature = _signPolicy(policy, rootOwnerKey);
        vm.expectRevert(MandateExecutor.InvalidPolicyField.selector);
        vm.prank(account);
        executor.setAccountPolicy(policy, signature);
    }

    function _register(MandateExecutor target, uint256 ownerKey, address owner, uint64 epoch, bytes32 policyHash)
        private
    {
        PeragoTypes.AccountPolicy memory policy = PeragoTypes.AccountPolicy({
            account: account,
            rootOwner: owner,
            ownerEpoch: epoch,
            chainId: block.chainid,
            policyHash: policyHash,
            permissionHash: keccak256("permission.v1"),
            validUntil: uint48(block.timestamp) + 1 hours
        });
        vm.prank(account);
        target.setAccountPolicy(policy, _signPolicyFor(target, policy, ownerKey));
    }

    function _signPolicy(PeragoTypes.AccountPolicy memory policy, uint256 key) private view returns (bytes memory) {
        return _signPolicyFor(executor, policy, key);
    }

    function _signPolicyFor(MandateExecutor target, PeragoTypes.AccountPolicy memory policy, uint256 key)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                ACCOUNT_POLICY_TYPEHASH,
                policy.account,
                policy.rootOwner,
                policy.ownerEpoch,
                policy.chainId,
                policy.policyHash,
                policy.permissionHash,
                policy.validUntil
            )
        );
        bytes32 domain = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("Perago"), keccak256("1"), block.chainid, address(target))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _signMandate(PeragoTypes.TaskMandate memory mandate, uint256 key) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, executor.hashMandate(mandate));
        return abi.encodePacked(r, s, v);
    }

    function _signLocalMandate(PeragoTypes.TaskMandate memory mandate, uint256 key)
        private
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, localExecutor.hashMandate(mandate));
        return abi.encodePacked(r, s, v);
    }
}
