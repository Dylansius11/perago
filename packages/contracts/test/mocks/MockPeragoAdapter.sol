// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPeragoAdapter} from "../../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";

/// @notice Stands in for a deployment-pinned adapter so the authorization lifecycle can be
/// tested before `PancakeV3SwapAdapter` and `CakeStakeAdapter` exist. `kind()` is `pure` in
/// the interface, so each kind is a separate contract rather than a constructor argument.
abstract contract MockPeragoAdapter is IPeragoAdapter {
    address private immutable _verifier;

    constructor(address verifier_) {
        _verifier = verifier_;
    }

    function verifier() external view returns (address) {
        return _verifier;
    }

    function validate(PeragoTypes.TaskMandate calldata, bytes calldata action) external pure returns (bytes32) {
        return keccak256(action);
    }

    function execute(PeragoTypes.TaskMandate calldata, bytes calldata)
        external
        pure
        returns (PeragoTypes.AdapterResult memory)
    {
        return PeragoTypes.AdapterResult({inputSpent: 0, outputOrPositionReceived: 0, protocolEvidenceHash: bytes32(0)});
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
