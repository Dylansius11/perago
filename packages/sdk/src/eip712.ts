import { z } from "zod";
import {
  addressSchema,
  hashSchema,
  uint48StringSchema,
  uint256StringSchema,
} from "./domain/primitives.js";
import { type TaskMandate, taskMandateSchema } from "./domain/task-mandate.js";

export const taskMandateTypeString =
  "TaskMandate(address account,address rootOwner,uint64 ownerEpoch,address executor,uint256 chainId,uint256 nonce,uint48 expiresAt,bytes32 policyHash,bytes32 intentHash,bytes32 planHash,bytes32 simulationHash,address adapter,bytes4 adapterSelector,address inputToken,uint256 maxInput,address outputToken,uint256 minOutput,address recipient,bytes32 actionHash,bytes32 postconditionHash,address commerceContract,uint256 commerceJobId)";

export const taskMandateTypes = {
  TaskMandate: [
    { name: "account", type: "address" },
    { name: "rootOwner", type: "address" },
    { name: "ownerEpoch", type: "uint64" },
    { name: "executor", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint48" },
    { name: "policyHash", type: "bytes32" },
    { name: "intentHash", type: "bytes32" },
    { name: "planHash", type: "bytes32" },
    { name: "simulationHash", type: "bytes32" },
    { name: "adapter", type: "address" },
    { name: "adapterSelector", type: "bytes4" },
    { name: "inputToken", type: "address" },
    { name: "maxInput", type: "uint256" },
    { name: "outputToken", type: "address" },
    { name: "minOutput", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "actionHash", type: "bytes32" },
    { name: "postconditionHash", type: "bytes32" },
    { name: "commerceContract", type: "address" },
    { name: "commerceJobId", type: "uint256" },
  ],
} as const;

export const mandateDomainSchema = z.strictObject({
  chainId: uint256StringSchema,
  verifyingContract: addressSchema,
});

export type TaskMandateDomain = z.infer<typeof mandateDomainSchema>;

/**
 * The stored form of a signed Task Mandate: the exact EIP-712 domain and
 * message the root owner signed, as canonical strings. `getTaskMandateTypedData`
 * rebuilds the signable payload from it, so a stored document can always be
 * re-verified against its signature and digest.
 */
export const signedMandateDocumentSchema = z
  .strictObject({
    primaryType: z.literal("TaskMandate"),
    domain: mandateDomainSchema,
    message: taskMandateSchema,
  })
  .refine(
    (document) => document.message.chainId === document.domain.chainId,
    "mandate chainId must match the EIP-712 domain",
  );

export type SignedMandateDocument = z.infer<typeof signedMandateDocumentSchema>;

function asMessage(mandate: TaskMandate) {
  return {
    ...mandate,
    ownerEpoch: BigInt(mandate.ownerEpoch),
    chainId: BigInt(mandate.chainId),
    nonce: BigInt(mandate.nonce),
    expiresAt: Number(mandate.expiresAt),
    maxInput: BigInt(mandate.maxInput),
    minOutput: BigInt(mandate.minOutput),
    commerceJobId: BigInt(mandate.commerceJobId),
  };
}

export function getTaskMandateTypedData(
  mandateInput: unknown,
  domainInput: unknown,
) {
  const mandate = taskMandateSchema.parse(mandateInput);
  const domain = mandateDomainSchema.parse(domainInput);

  if (mandate.chainId !== domain.chainId) {
    throw new RangeError("mandate chainId must match the EIP-712 domain");
  }

  return {
    domain: {
      name: "Perago",
      version: "1",
      chainId: BigInt(domain.chainId),
      verifyingContract: domain.verifyingContract,
    },
    message: asMessage(mandate),
    primaryType: "TaskMandate",
    types: taskMandateTypes,
  } as const;
}

export const executionProofTypeString =
  "ExecutionProof(bytes32 mandateHash,address account,address executor,uint48 validUntil)";

export const executionProofTypes = {
  ExecutionProof: [
    { name: "mandateHash", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "executor", type: "address" },
    { name: "validUntil", type: "uint48" },
  ],
} as const;

export const executionProofSchema = z.strictObject({
  mandateHash: hashSchema,
  account: addressSchema,
  executor: addressSchema,
  validUntil: uint48StringSchema,
});

export type ExecutionProof = z.infer<typeof executionProofSchema>;

/**
 * The scoped executor's short-lived proof that it drove one execution; `perform`
 * recovers it against the executor the mandate's record names.
 */
export function getExecutionProofTypedData(
  proofInput: unknown,
  domainInput: unknown,
) {
  const proof = executionProofSchema.parse(proofInput);
  const domain = mandateDomainSchema.parse(domainInput);
  return {
    domain: {
      name: "Perago",
      version: "1",
      chainId: BigInt(domain.chainId),
      verifyingContract: domain.verifyingContract,
    },
    message: { ...proof, validUntil: Number(proof.validUntil) },
    primaryType: "ExecutionProof",
    types: executionProofTypes,
  } as const;
}
