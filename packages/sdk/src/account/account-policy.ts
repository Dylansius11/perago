import {
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  keccak256,
  stringToHex,
} from "viem";
import { z } from "zod";
import { mandateExecutorAbi } from "../abi/perago-contracts.js";
import {
  type Address,
  addressSchema,
  hasDuplicates,
  hashSchema,
  selectorSchema,
  uint48StringSchema,
  uint64StringSchema,
  uint256StringSchema,
} from "../domain/primitives.js";
import {
  encodeAccountExecuteBatch,
  encodeInstallMandateSession,
  encodeUninstallMandateSession,
  MAX_SESSION_ENTITY_ID,
  type MandateSessionPermission,
  PRIVILEGED_SELECTORS,
} from "./modular-account.js";

const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroHash = `0x${"0".repeat(64)}`;
const policyRevocationDomain = keccak256(stringToHex("PERAGO_POLICY_REVOKED"));
const nonzeroAddressSchema = addressSchema.refine(
  (value) => value !== zeroAddress,
  "address must not be zero",
);
const nonzeroHashSchema = hashSchema.refine(
  (value) => value !== zeroHash,
  "hash must not be zero",
);

export const mandateSessionPermissionSchema = z
  .strictObject({
    account: nonzeroAddressSchema,
    entityId: z.int().min(1).max(MAX_SESSION_ENTITY_ID),
    nativeSpendLimit: uint256StringSchema,
    selectors: z.array(selectorSchema).min(1),
    sessionSigner: nonzeroAddressSchema,
    target: nonzeroAddressSchema,
    validAfter: uint48StringSchema,
    validUntil: uint48StringSchema,
  })
  .superRefine((permission, context) => {
    if (permission.account === permission.target) {
      context.addIssue({
        code: "custom",
        message: "session target must not be the account",
        path: ["target"],
      });
    }
    if (hasDuplicates(permission.selectors)) {
      context.addIssue({
        code: "custom",
        message: "session selectors must be unique",
        path: ["selectors"],
      });
    }
    const privileged = new Set(
      PRIVILEGED_SELECTORS.map((selector) => selector.toLowerCase()),
    );
    if (permission.selectors.some((selector) => privileged.has(selector))) {
      context.addIssue({
        code: "custom",
        message:
          "session selectors must not grant privileged account authority",
        path: ["selectors"],
      });
    }
    if (BigInt(permission.validUntil) <= BigInt(permission.validAfter)) {
      context.addIssue({
        code: "custom",
        message: "session validUntil must be greater than validAfter",
        path: ["validUntil"],
      });
    }
  });

export type MandateSessionPermissionDocument = z.infer<
  typeof mandateSessionPermissionSchema
>;

export const accountPolicySchema = z
  .strictObject({
    account: nonzeroAddressSchema,
    chainId: uint256StringSchema,
    ownerEpoch: uint64StringSchema,
    permissionHash: nonzeroHashSchema,
    policyHash: nonzeroHashSchema,
    rootOwner: nonzeroAddressSchema,
    validUntil: uint48StringSchema,
  })
  .superRefine((policy, context) => {
    if (policy.ownerEpoch === "0") {
      context.addIssue({
        code: "custom",
        message: "ownerEpoch must be positive",
        path: ["ownerEpoch"],
      });
    }
    if (policy.validUntil === "0") {
      context.addIssue({
        code: "custom",
        message: "validUntil must be set",
        path: ["validUntil"],
      });
    }
  });

export type AccountPolicy = z.infer<typeof accountPolicySchema>;

export const accountPolicyTypeString =
  "AccountPolicy(address account,address rootOwner,uint64 ownerEpoch,uint256 chainId,bytes32 policyHash,bytes32 permissionHash,uint48 validUntil)";

export const accountPolicyTypes = {
  AccountPolicy: [
    { name: "account", type: "address" },
    { name: "rootOwner", type: "address" },
    { name: "ownerEpoch", type: "uint64" },
    { name: "chainId", type: "uint256" },
    { name: "policyHash", type: "bytes32" },
    { name: "permissionHash", type: "bytes32" },
    { name: "validUntil", type: "uint48" },
  ],
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

const accountPolicyDomainSchema = z.strictObject({
  chainId: uint256StringSchema,
  verifyingContract: nonzeroAddressSchema,
});

export type AccountPolicyDomain = z.infer<typeof accountPolicyDomainSchema>;

export function toMandateSessionPermission(
  input: unknown,
): MandateSessionPermission {
  const permission = mandateSessionPermissionSchema.parse(input);
  return {
    ...permission,
    nativeSpendLimit: BigInt(permission.nativeSpendLimit),
    validAfter: Number(permission.validAfter),
    validUntil: Number(permission.validUntil),
  };
}

export function hashMandateSessionPermission(input: unknown) {
  return keccak256(
    encodeInstallMandateSession(toMandateSessionPermission(input)),
  );
}

export function hashMandateSessionRevocation(input: unknown) {
  return keccak256(
    encodeUninstallMandateSession(toMandateSessionPermission(input)),
  );
}

export function hashPolicyRevocation(policyHashInput: unknown) {
  const policyHash = hashSchema.parse(policyHashInput);
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [policyRevocationDomain, policyHash],
    ),
  );
}

function accountPolicyContractValue(policy: AccountPolicy) {
  return {
    ...policy,
    chainId: BigInt(policy.chainId),
    ownerEpoch: BigInt(policy.ownerEpoch),
    validUntil: Number(policy.validUntil),
  };
}

export function encodeSetAccountPolicy(
  policyInput: unknown,
  rootSignature: Hex,
) {
  const policy = accountPolicySchema.parse(policyInput);
  return encodeFunctionData({
    abi: mandateExecutorAbi,
    args: [accountPolicyContractValue(policy), rootSignature],
    functionName: "setAccountPolicy",
  });
}

export function encodeAccountPolicyTransition(input: {
  account: Address;
  mandateExecutor: Address;
  permissionCallData: Hex;
  policy: AccountPolicy;
  rootSignature: Hex;
}) {
  return encodeAccountExecuteBatch([
    {
      data: input.permissionCallData,
      target: input.account,
      value: 0n,
    },
    {
      data: encodeSetAccountPolicy(input.policy, input.rootSignature),
      target: input.mandateExecutor,
      value: 0n,
    },
  ]);
}

export function getAccountPolicyTypedData(
  policyInput: unknown,
  domainInput: unknown,
) {
  const policy = accountPolicySchema.parse(policyInput);
  const domain = accountPolicyDomainSchema.parse(domainInput);
  if (policy.chainId !== domain.chainId) {
    throw new RangeError("policy chainId must match the EIP-712 domain");
  }

  return {
    domain: {
      name: "Perago",
      version: "1",
      chainId: BigInt(domain.chainId),
      verifyingContract: domain.verifyingContract,
    },
    message: accountPolicyContractValue(policy),
    primaryType: "AccountPolicy",
    types: accountPolicyTypes,
  } as const;
}
