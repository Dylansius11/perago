// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PeragoTypes} from "../../src/types/PeragoTypes.sol";

contract TaskMandateFixtures {
    bytes32 public constant TASK_MANDATE_TYPEHASH = keccak256(
        "TaskMandate(address account,address rootOwner,uint64 ownerEpoch,address executor,uint256 chainId,uint256 nonce,uint48 expiresAt,bytes32 policyHash,bytes32 intentHash,bytes32 planHash,bytes32 simulationHash,address adapter,bytes4 adapterSelector,address inputToken,uint256 maxInput,address outputToken,uint256 minOutput,address recipient,bytes32 actionHash,bytes32 postconditionHash,address commerceContract,uint256 commerceJobId)"
    );
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function hashStruct(PeragoTypes.TaskMandate memory mandate) public pure returns (bytes32) {
        bytes32[23] memory fields;
        fields[0] = TASK_MANDATE_TYPEHASH;
        fields[1] = bytes32(uint256(uint160(mandate.account)));
        fields[2] = bytes32(uint256(uint160(mandate.rootOwner)));
        fields[3] = bytes32(uint256(mandate.ownerEpoch));
        fields[4] = bytes32(uint256(uint160(mandate.executor)));
        fields[5] = bytes32(mandate.chainId);
        fields[6] = bytes32(mandate.nonce);
        fields[7] = bytes32(uint256(mandate.expiresAt));
        fields[8] = mandate.policyHash;
        fields[9] = mandate.intentHash;
        fields[10] = mandate.planHash;
        fields[11] = mandate.simulationHash;
        fields[12] = bytes32(uint256(uint160(mandate.adapter)));
        fields[13] = bytes32(mandate.adapterSelector);
        fields[14] = bytes32(uint256(uint160(mandate.inputToken)));
        fields[15] = bytes32(mandate.maxInput);
        fields[16] = bytes32(uint256(uint160(mandate.outputToken)));
        fields[17] = bytes32(mandate.minOutput);
        fields[18] = bytes32(uint256(uint160(mandate.recipient)));
        fields[19] = mandate.actionHash;
        fields[20] = mandate.postconditionHash;
        fields[21] = bytes32(uint256(uint160(mandate.commerceContract)));
        fields[22] = bytes32(mandate.commerceJobId);
        return keccak256(abi.encodePacked(fields));
    }

    function hashTypedData(PeragoTypes.TaskMandate memory mandate, uint256 chainId, address verifyingContract)
        external
        pure
        returns (bytes32)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("Perago"), keccak256("1"), chainId, verifyingContract)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, hashStruct(mandate)));
    }
}
