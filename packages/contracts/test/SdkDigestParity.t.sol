// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {MandateExecutor} from "../src/MandateExecutor.sol";
import {PeragoTypes} from "../src/types/PeragoTypes.sol";
import {MockStakeAdapter, MockSwapAdapter} from "./mocks/MockPeragoAdapter.sol";
import {MockPeragoVerifier} from "./mocks/MockPeragoVerifier.sol";

/// @notice The deployed MandateExecutor - not a mirror - produces the digests the SDK
/// signs. The executor is constructed at the SDK fixture's `verifyingContract` on chain
/// 97, so its cached domain separator is the one `packages/sdk/test/mandate-fixture.test.ts`
/// uses; a type string, field order, or domain drift on either side fails both suites.
contract SdkDigestParityTest is Test {
    address private constant VERIFYING_CONTRACT = 0x4444444444444444444444444444444444444444;
    bytes32 private constant HASH = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
    bytes32 private constant SDK_MANDATE_DIGEST = 0x9b204a82d741df2398ef74a699cc6a9b5cc4dae63aac247b0d69c29e4f206574;
    bytes32 private constant SDK_PROOF_DIGEST = 0x1b9f6acce141f1800f7b96964586e0bec5f00fa79c1b70468fbc731ed9ec5199;

    MandateExecutor private executor;

    function setUp() public {
        vm.chainId(97);
        address swap = address(new MockSwapAdapter(address(new MockPeragoVerifier(keccak256("swap")))));
        address stake = address(new MockStakeAdapter(address(new MockPeragoVerifier(keccak256("stake")))));
        deployCodeTo("MandateExecutor.sol:MandateExecutor", abi.encode(swap, stake, uint48(600), false), VERIFYING_CONTRACT);
        executor = MandateExecutor(VERIFYING_CONTRACT);
    }

    function test_hashMandateMatchesTheSdkTypedData() public view {
        assertEq(executor.hashMandate(_mandate()), SDK_MANDATE_DIGEST);
    }

    function test_hashExecutionProofMatchesTheSdkTypedData() public view {
        PeragoTypes.ExecutionProof memory proof = PeragoTypes.ExecutionProof({
            mandateHash: 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,
            account: 0x1111111111111111111111111111111111111111,
            executor: 0x3333333333333333333333333333333333333333,
            validUntil: 2_000_000_000
        });
        assertEq(executor.hashExecutionProof(proof), SDK_PROOF_DIGEST);
    }

    function _mandate() private pure returns (PeragoTypes.TaskMandate memory mandate) {
        mandate = PeragoTypes.TaskMandate({
            account: 0x1111111111111111111111111111111111111111,
            rootOwner: 0x2222222222222222222222222222222222222222,
            ownerEpoch: 1,
            executor: 0x3333333333333333333333333333333333333333,
            chainId: 97,
            nonce: 340282366920938463463374607431768211456,
            expiresAt: 2000000000,
            policyHash: HASH,
            intentHash: HASH,
            planHash: HASH,
            simulationHash: HASH,
            adapter: VERIFYING_CONTRACT,
            adapterSelector: 0x12345678,
            inputToken: 0x5555555555555555555555555555555555555555,
            maxInput: 340282366920938463463374607431768211456,
            outputToken: 0x6666666666666666666666666666666666666666,
            minOutput: 1,
            recipient: 0x1111111111111111111111111111111111111111,
            actionHash: HASH,
            postconditionHash: HASH,
            commerceContract: address(0),
            commerceJobId: 0
        });
    }
}
