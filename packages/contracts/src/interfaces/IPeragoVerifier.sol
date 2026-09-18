// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PeragoTypes} from "../types/PeragoTypes.sol";

interface IPeragoVerifier {
    function verifierId() external view returns (bytes32);

    function measure(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
        view
        returns (uint256 value, bytes32 contextHash);

    function verify(
        PeragoTypes.TaskMandate calldata mandate,
        bytes calldata action,
        uint256 beforeValue,
        bytes32 beforeContext,
        PeragoTypes.AdapterResult calldata result
    ) external view returns (PeragoTypes.VerificationEvidence memory evidence);
}
