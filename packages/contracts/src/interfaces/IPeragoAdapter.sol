// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PeragoTypes} from "../types/PeragoTypes.sol";

interface IPeragoAdapter {
    function kind() external pure returns (bytes32);

    function verifier() external view returns (address);

    function validate(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
        view
        returns (bytes32 normalizedActionHash);

    function execute(PeragoTypes.TaskMandate calldata mandate, bytes calldata action)
        external
        returns (PeragoTypes.AdapterResult memory result);
}
