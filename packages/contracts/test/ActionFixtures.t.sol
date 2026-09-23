// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PeragoTypes} from "../src/types/PeragoTypes.sol";
import {SwapVerifier} from "../src/verifiers/SwapVerifier.sol";

/// @notice Frozen action and postcondition commitments. `packages/sdk` asserts the same
/// constants for the same fixture, so a drift in field order, width, or domain tag on
/// either side of the stack fails here or there - never at authorization time.
contract ActionFixturesTest is Test {
    bytes32 private constant SWAP_ACTION_HASH = 0xb314f7ad556ecb09babd714727205aad08c0410153a8c1ca2222d663a3daa4ed;
    bytes32 private constant SWAP_POSTCONDITION_HASH =
        0x8e9bdd42262669bfe9f6d5176565192fd6aa6f866badcd2b2e57eb2a888bcb93;

    address private constant TOKEN_IN = 0x5555555555555555555555555555555555555555;
    address private constant TOKEN_OUT = 0x6666666666666666666666666666666666666666;
    address private constant RECIPIENT = 0x1111111111111111111111111111111111111111;

    function test_swapActionEncodesToSevenWordsAndTheFrozenHash() public pure {
        bytes memory action = abi.encode(
            PeragoTypes.SwapAction({
                tokenIn: TOKEN_IN,
                tokenOut: TOKEN_OUT,
                poolFee: 500,
                amountIn: 0.05 ether,
                minAmountOut: 123_456_789,
                recipient: RECIPIENT,
                deadline: 2_000_000_000
            })
        );
        assertEq(action.length, 7 * 32);
        assertEq(keccak256(action), SWAP_ACTION_HASH);
    }

    function test_swapPostconditionMatchesTheFrozenHash() public {
        assertEq(new SwapVerifier().postconditionHash(RECIPIENT, TOKEN_OUT, 123_456_789), SWAP_POSTCONDITION_HASH);
        assertEq(PeragoTypes.SWAP_POSTCONDITION_KIND, keccak256("perago.postcondition.swap.v1"));
    }
}
