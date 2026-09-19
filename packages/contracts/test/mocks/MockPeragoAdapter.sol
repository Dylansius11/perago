// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPeragoAdapter} from "../../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";

/// @notice Stands in for a deployment-pinned adapter until `PancakeV3SwapAdapter` and
/// `CakeStakeAdapter` exist. It moves real tokens, so the executor's exact-allowance,
/// cleanup, and verification wiring is exercised rather than simulated, and it can
/// misbehave on demand so every terminal failure path is observable.
/// @dev `kind()` is `pure` in the interface, so each kind is its own contract rather
/// than a constructor argument.
abstract contract MockPeragoAdapter is IPeragoAdapter {
    /// Failure shapes a real adapter, protocol, or compromised deployment can produce.
    enum Mode {
        HONEST,
        REVERT_TYPED,
        REVERT_OVERSIZED,
        PULL_ABOVE_ALLOWANCE,
        MISREPORT_ACTION,
        LEAVE_INPUT_BEHIND,
        WITHHOLD_OUTPUT,
        STRANDS_OUTPUT,
        INFLATE_RESULT,
        REENTER_EXECUTOR,
        BURN_ALL_GAS
    }

    error AdapterProtocolFailure();

    /// Size of the revert payload `REVERT_OVERSIZED` produces, so the executor's bounded
    /// reason handling is tested against data far larger than a word.
    uint256 internal constant OVERSIZED_REASON_BYTES = 4096;

    address private immutable _verifier;
    Mode public mode;
    address public reentryTarget;
    bytes public reentryCalldata;

    constructor(address verifier_) {
        _verifier = verifier_;
    }

    function verifier() external view returns (address) {
        return _verifier;
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryCalldata = data;
    }

    function validate(PeragoTypes.TaskMandate calldata, bytes calldata action) external view returns (bytes32) {
        if (mode == Mode.MISREPORT_ACTION) return keccak256("a different action");
        return keccak256(action);
    }

    /// @dev `action` is `abi.encode(amountIn, amountOut)`: the exact input the adapter pulls
    /// from the executor and the exact output it hands to the signed recipient.
    function execute(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
        returns (PeragoTypes.AdapterResult memory)
    {
        (uint256 amountIn, uint256 amountOut) = abi.decode(action, (uint256, uint256));

        if (mode == Mode.REVERT_TYPED) revert AdapterProtocolFailure();
        if (mode == Mode.REVERT_OVERSIZED) revert(string(new bytes(OVERSIZED_REASON_BYTES)));
        if (mode == Mode.BURN_ALL_GAS) {
            while (true) {
                assembly {
                    mstore(gas(), gas())
                }
            }
        }
        if (mode == Mode.REENTER_EXECUTOR) {
            (bool ok, bytes memory returned) = reentryTarget.call(reentryCalldata);
            if (!ok) {
                assembly {
                    revert(add(returned, 0x20), mload(returned))
                }
            }
        }

        uint256 pull = mode == Mode.PULL_ABOVE_ALLOWANCE ? amountIn + 1 : amountIn;
        IERC20(mandate.inputToken).transferFrom(msg.sender, address(this), pull);

        if (mode == Mode.LEAVE_INPUT_BEHIND) {
            // Hand part of the input back to the executor instead of consuming it.
            IERC20(mandate.inputToken).transfer(msg.sender, pull / 2);
        }

        if (mode != Mode.WITHHOLD_OUTPUT) {
            IERC20(mandate.outputToken).transfer(mandate.recipient, amountOut);
        }
        if (mode == Mode.STRANDS_OUTPUT) {
            // The postcondition is met, but protocol output is also left in the executor.
            IERC20(mandate.outputToken).transfer(msg.sender, amountOut);
        }

        return PeragoTypes.AdapterResult({
            inputSpent: pull,
            outputOrPositionReceived: mode == Mode.INFLATE_RESULT ? amountOut * 2 : amountOut,
            protocolEvidenceHash: keccak256(abi.encode("mock.protocol", amountIn, amountOut))
        });
    }
}

contract MockSwapAdapter is MockPeragoAdapter {
    constructor(address verifier_) MockPeragoAdapter(verifier_) {}

    function kind() external pure returns (bytes32) {
        return PeragoTypes.SWAP_ADAPTER_KIND;
    }
}

contract MockStakeAdapter is MockPeragoAdapter {
    constructor(address verifier_) MockPeragoAdapter(verifier_) {}

    function kind() external pure returns (bytes32) {
        return PeragoTypes.STAKE_ADAPTER_KIND;
    }
}
