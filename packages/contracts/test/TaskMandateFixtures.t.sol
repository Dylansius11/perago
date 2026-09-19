// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {TaskMandateFixtures} from "./fixtures/TaskMandateFixtures.sol";
import {PeragoTypes} from "../src/types/PeragoTypes.sol";

contract TaskMandateFixturesTest {
    bytes32 private constant HASH = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
    bytes32 private constant SDK_DIGEST = 0x9b204a82d741df2398ef74a699cc6a9b5cc4dae63aac247b0d69c29e4f206574;

    function testMatchesSdkDigest() external {
        TaskMandateFixtures fixture = new TaskMandateFixtures();
        assert(fixture.hashTypedData(_mandate(), 97, 0x4444444444444444444444444444444444444444) == SDK_DIGEST);
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
            adapter: 0x4444444444444444444444444444444444444444,
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
