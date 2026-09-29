import {
  type Address,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getContractAddress,
  type Hex,
  isAddressEqual,
  keccak256,
  toHex,
} from "viem";

/**
 * Modular Account V2 encoding for Perago's bounded execution path.
 *
 * Every value here is an encoding input for the singleton Alchemy Modular
 * Account V2 deployment. Deployment evidence for BNB Smart Chain Testnet lives
 * in `deployments/bsc-testnet.account.json`; this module never reads chain
 * state and never holds a key.
 *
 * Source: https://www.alchemy.com/docs/wallets/smart-contracts/deployed-addresses
 */
export const MODULAR_ACCOUNT_V2_ADDRESSES = {
  allowlistModule: "0x00000000003E826473A313e600B5B9b791f5A59A",
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  factory: "0x00000000000017c61b5bEe81050EC8eFc9c6fecd",
  nativeTokenLimitModule: "0x00000000000001e541f0D090868FBe24b59Fbe06",
  semiModularAccountBytecode: "0x000000000000c5A9089039570Dd36455b5C07383",
  singleSignerValidationModule: "0x00000000000099DE0BF6fA90dEB851E2A2df7d83",
  timeRangeModule: "0x00000000000082B8e2012be914dFA4f62A0573eA",
} as const satisfies Record<string, Address>;

export type ModularAccountV2Addresses = typeof MODULAR_ACCOUNT_V2_ADDRESSES;

/** Fallback signer entity of a semi-modular account; never a session entity. */
export const ROOT_OWNER_ENTITY_ID = 0;

/** Entity id used by the factory when deriving a semi-modular account. */
const SEMI_MODULAR_FALLBACK_ENTITY_ID = 0xffffffff;

/**
 * Session entity ids must stay below this bound. Hook modules reserve the upper
 * half of the uint32 range for offset entity ids, so a larger session id would
 * alias another hook's storage.
 */
export const MAX_SESSION_ENTITY_ID = 2_147_483_646;

/** `executeUserOp(PackedUserOperation,bytes32)`; set when a validation owns execution hooks. */
export const EXECUTE_USER_OP_SELECTOR: Hex = "0x8dd7712f";

/** `execute(address,uint256,bytes)`; the only account selector a Perago session may validate. */
export const ACCOUNT_EXECUTE_SELECTOR: Hex = "0xb61d27f6";

/**
 * Account and token selectors that must never appear in a session allowlist.
 *
 * Every account selector was confirmed present in the dispatcher of the
 * deployed semi-modular account implementation
 * (`0x000000000000c5A9089039570Dd36455b5C07383`, BSC Testnet). `installExecution`
 * and `uninstallExecution` differ from the values hard-coded in
 * `@alchemy/smart-accounts@5.2.6`, whose constants predate the deployed
 * ERC-6900 `ExecutionManifest` encoding.
 */
export const PRIVILEGED_SELECTORS: readonly Hex[] = [
  ACCOUNT_EXECUTE_SELECTOR,
  EXECUTE_USER_OP_SELECTOR,
  "0x34fcd5be", // executeBatch((address,uint256,bytes)[])
  "0x5998db5c", // performCreate(uint256,bytes,bool,bytes32)
  "0xf2680c0f", // executeWithRuntimeValidation(bytes,bytes)
  "0x1bbf564c", // installValidation(bytes25,bytes4[],bytes,bytes[])
  "0xb6b1ccfe", // uninstallValidation(bytes24,bytes,bytes[])
  "0x001a63e9", // installExecution(address,ExecutionManifest,bytes)
  "0x93b1dc61", // uninstallExecution(address,ExecutionManifest,bytes)
  "0x4f1ef286", // upgradeToAndCall(address,bytes)
  "0x095ea7b3", // approve(address,uint256)
  "0x39509351", // increaseAllowance(address,uint256)
];

const MAX_UINT48 = 281_474_976_710_655;
const MAX_UINT256 = (1n << 256n) - 1n;
const HOOK_TYPE_EXECUTION = 0;
const HOOK_TYPE_VALIDATION = 1;

const accountFactoryAbi = [
  {
    type: "function",
    name: "createSemiModularAccount",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "nonpayable",
  },
] as const;

/** The executed subset of the deployed semi-modular account's dispatcher. */
export const modularAccountAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "executeBatch",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "results", type: "bytes[]" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "installValidation",
    inputs: [
      { name: "validationConfig", type: "bytes25" },
      { name: "selectors", type: "bytes4[]" },
      { name: "installData", type: "bytes" },
      { name: "hooks", type: "bytes[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "uninstallValidation",
    inputs: [
      { name: "validationFunction", type: "bytes24" },
      { name: "uninstallData", type: "bytes" },
      { name: "hookUninstallData", type: "bytes[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** A single-signer session that may only drive one target through `execute`. */
export type MandateSessionPermission = {
  /** Session signer; holds no root authority. */
  sessionSigner: Address;
  /** Session entity id; must be a non-root id below {@link MAX_SESSION_ENTITY_ID}. */
  entityId: number;
  /** Smart account that owns the session. */
  account: Address;
  /** Only callable target, normally the Perago mandate executor. */
  target: Address;
  /** Selectors allowed on `target`; privileged selectors are rejected. */
  selectors: readonly Hex[];
  /** Maximum native value, in wei, the session may move out of the account. */
  nativeSpendLimit: bigint;
  /** Unix second the session starts being valid. */
  validAfter: number;
  /** Unix second the session stops being valid; a session always expires. */
  validUntil: number;
};

function assertAddress(value: Address, label: string): Address {
  const address = getAddress(value);
  if (address === "0x0000000000000000000000000000000000000000") {
    throw new RangeError(`${label} must not be the zero address`);
  }
  return address;
}

function assertSessionEntityId(entityId: number): void {
  if (!Number.isInteger(entityId)) {
    throw new RangeError("session entityId must be an integer");
  }
  if (entityId <= ROOT_OWNER_ENTITY_ID) {
    throw new RangeError(
      "session entityId must not be the root owner entity id",
    );
  }
  if (entityId > MAX_SESSION_ENTITY_ID) {
    throw new RangeError(
      `session entityId must not exceed ${MAX_SESSION_ENTITY_ID}`,
    );
  }
}

function assertSelectors(selectors: readonly Hex[]): readonly Hex[] {
  if (selectors.length === 0) {
    throw new RangeError("a session must allow at least one selector");
  }

  const normalized: Hex[] = [];
  const privileged = new Set(
    PRIVILEGED_SELECTORS.map((selector) => selector.toLowerCase()),
  );
  for (const selector of selectors) {
    const value = selector.toLowerCase() as Hex;
    if (!/^0x[0-9a-f]{8}$/.test(value)) {
      throw new RangeError(`selector ${selector} must be 4 bytes`);
    }
    if (privileged.has(value)) {
      throw new RangeError(`selector ${selector} is privileged`);
    }
    if (normalized.includes(value)) {
      throw new RangeError(`selector ${selector} is duplicated`);
    }
    normalized.push(value);
  }

  return normalized;
}

function assertTimeWindow(validAfter: number, validUntil: number): void {
  if (!Number.isInteger(validAfter) || !Number.isInteger(validUntil)) {
    throw new RangeError("validAfter and validUntil must be integers");
  }
  if (validAfter < 0 || validUntil < 0) {
    throw new RangeError("validAfter and validUntil must not be negative");
  }
  if (validUntil > MAX_UINT48 || validAfter > MAX_UINT48) {
    throw new RangeError("validAfter and validUntil must fit in uint48");
  }
  if (validUntil === 0) {
    throw new RangeError("a session must expire, so validUntil must be set");
  }
  if (validUntil <= validAfter) {
    throw new RangeError("validUntil must be greater than validAfter");
  }
}

function assertSpendLimit(nativeSpendLimit: bigint): void {
  if (nativeSpendLimit < 0n || nativeSpendLimit > MAX_UINT256) {
    throw new RangeError("nativeSpendLimit must fit in uint256");
  }
}

function normalizePermission(
  permission: MandateSessionPermission,
): MandateSessionPermission {
  const account = assertAddress(permission.account, "account");
  const target = assertAddress(permission.target, "target");
  const sessionSigner = assertAddress(
    permission.sessionSigner,
    "sessionSigner",
  );

  if (isAddressEqual(target, account)) {
    throw new RangeError("target must not be the account itself");
  }
  assertSessionEntityId(permission.entityId);
  assertTimeWindow(permission.validAfter, permission.validUntil);
  assertSpendLimit(permission.nativeSpendLimit);

  return {
    ...permission,
    account,
    selectors: assertSelectors(permission.selectors),
    sessionSigner,
    target,
  };
}

/** Serializes a module entity (`bytes24`) as the account expects it. */
export function serializeModuleEntity(entity: {
  moduleAddress: Address;
  entityId: number;
}): Hex {
  return concatHex([
    getAddress(entity.moduleAddress),
    toHex(entity.entityId, { size: 4 }),
  ]);
}

/** Serializes a validation config (`bytes25`) as the account expects it. */
export function serializeValidationConfig(config: {
  moduleAddress: Address;
  entityId: number;
  isGlobal: boolean;
  isSignatureValidation: boolean;
  isUserOpValidation: boolean;
}): Hex {
  const flags =
    (config.isUserOpValidation ? 1 : 0) +
    (config.isSignatureValidation ? 2 : 0) +
    (config.isGlobal ? 4 : 0);

  return concatHex([serializeModuleEntity(config), toHex(flags, { size: 1 })]);
}

/** Serializes a hook config (`bytes26`) as the account expects it. */
export function serializeHookConfig(config: {
  moduleAddress: Address;
  entityId: number;
  hookType: typeof HOOK_TYPE_EXECUTION | typeof HOOK_TYPE_VALIDATION;
  hasPreHooks: boolean;
  hasPostHooks: boolean;
}): Hex {
  const flags =
    (config.hookType === HOOK_TYPE_VALIDATION ? 1 : 0) +
    (config.hasPostHooks ? 2 : 0) +
    (config.hasPreHooks ? 4 : 0);

  return concatHex([
    getAddress(config.moduleAddress),
    toHex(config.entityId, { size: 4 }),
    toHex(flags, { size: 1 }),
  ]);
}

const ACCOUNT_RUNTIME_PREFIX =
  "363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3";

function runtimeCodeForOwner(owner: Address): Hex {
  return `0x${ACCOUNT_RUNTIME_PREFIX}${owner.slice(2).toLowerCase()}`;
}

/** Runtime bytecode of the owner-bound account proxy, independent of its storage. */
export function semiModularAccountRuntimeCode(params: { owner: Address }): Hex {
  return runtimeCodeForOwner(assertAddress(params.owner, "owner"));
}

/**
 * Derives the counterfactual semi-modular account address for a root owner.
 *
 * The result is a CREATE2 address over the factory, the combined salt, and the
 * proxy initcode carrying the owner as an immutable argument, so a wrong
 * implementation address silently produces a different account.
 */
export function deriveSemiModularAccountAddress(params: {
  owner: Address;
  salt?: bigint;
  addresses?: ModularAccountV2Addresses;
}): Address {
  const addresses = params.addresses ?? MODULAR_ACCOUNT_V2_ADDRESSES;
  const owner = assertAddress(params.owner, "owner");
  const salt = params.salt ?? 0n;
  if (salt < 0n || salt > MAX_UINT256) {
    throw new RangeError("salt must fit in uint256");
  }

  const combinedSalt = keccak256(
    encodePacked(
      ["address", "uint256", "uint32"],
      [owner, salt, SEMI_MODULAR_FALLBACK_ENTITY_ID],
    ),
  );

  return getContractAddress({
    bytecode: `0x6100513d8160233d3973${addresses.semiModularAccountBytecode.slice(2)}60095155f3${runtimeCodeForOwner(owner).slice(2)}`,
    from: addresses.factory,
    opcode: "CREATE2",
    salt: combinedSalt,
  });
}

/** Encodes the factory call that deploys the semi-modular account. */
export function encodeSemiModularAccountFactoryData(params: {
  owner: Address;
  salt?: bigint;
}): Hex {
  return encodeFunctionData({
    abi: accountFactoryAbi,
    args: [assertAddress(params.owner, "owner"), params.salt ?? 0n],
    functionName: "createSemiModularAccount",
  });
}

/**
 * Builds the EntryPoint nonce key that selects a validation entity.
 *
 * Layout: `nonceKey << 40 | entityId << 8 | isGlobalValidation`. Perago never
 * uses deferred actions, so that bit stays clear.
 */
export function buildUserOperationNonceKey(params: {
  entityId: number;
  isGlobalValidation: boolean;
  nonceKey?: bigint;
}): bigint {
  const { entityId, isGlobalValidation } = params;
  if (!Number.isInteger(entityId) || entityId < 0 || entityId > 0xffffffff) {
    throw new RangeError("entityId must fit in uint32");
  }
  const nonceKey = params.nonceKey ?? 0n;
  if (nonceKey < 0n || nonceKey >= 1n << 112n) {
    throw new RangeError("nonceKey must fit in uint112");
  }

  return (
    (nonceKey << 40n) +
    (BigInt(entityId) << 8n) +
    (isGlobalValidation ? 1n : 0n)
  );
}

/** Wraps an ECDSA signature in the account's UserOperation signature envelope. */
export function packUserOperationSignature(signature: Hex): Hex {
  return concatHex(["0xff", "0x00", signature]);
}

/** Encodes a single bounded call through the account. */
export function encodeAccountExecute(params: {
  target: Address;
  value: bigint;
  data: Hex;
}): Hex {
  if (params.value < 0n || params.value > MAX_UINT256) {
    throw new RangeError("value must fit in uint256");
  }

  return encodeFunctionData({
    abi: modularAccountAbi,
    args: [getAddress(params.target), params.value, params.data],
    functionName: "execute",
  });
}

/** One call inside an account batch. */
export type AccountCall = {
  target: Address;
  value: bigint;
  data: Hex;
};

/**
 * Encodes several bounded calls as one atomic account execution. Only the root
 * owner may reach this selector: `executeBatch` is a privileged selector, so a
 * Perago session can never validate it (see {@link PRIVILEGED_SELECTORS}).
 */
export function encodeAccountExecuteBatch(calls: readonly AccountCall[]): Hex {
  if (calls.length === 0) {
    throw new RangeError("a batch must contain at least one call");
  }

  return encodeFunctionData({
    abi: modularAccountAbi,
    args: [
      calls.map((call) => {
        if (call.value < 0n || call.value > MAX_UINT256) {
          throw new RangeError("value must fit in uint256");
        }
        return {
          data: call.data,
          target: getAddress(call.target),
          value: call.value,
        };
      }),
    ],
    functionName: "executeBatch",
  });
}

/**
 * Prefixes call data for a validation that owns execution hooks, which the
 * account requires so `executeUserOp` runs the hooks around the call.
 */
export function wrapExecuteUserOp(callData: Hex): Hex {
  return concatHex([EXECUTE_USER_OP_SELECTOR, callData]);
}

function allowlistInputs(permission: MandateSessionPermission) {
  return [
    {
      erc20SpendLimit: 0n,
      hasERC20SpendLimit: false,
      hasSelectorAllowlist: true,
      selectors: permission.selectors,
      target: permission.target,
    },
  ] as const;
}

const allowlistParameters = [
  { type: "uint32" },
  {
    type: "tuple[]",
    components: [
      { type: "address" },
      { type: "bool" },
      { type: "bool" },
      { type: "uint256" },
      { type: "bytes4[]" },
    ],
  },
] as const;

function encodeAllowlistData(permission: MandateSessionPermission): Hex {
  return encodeAbiParameters(allowlistParameters, [
    permission.entityId,
    allowlistInputs(permission).map(
      (input) =>
        [
          input.target,
          input.hasSelectorAllowlist,
          input.hasERC20SpendLimit,
          input.erc20SpendLimit,
          [...input.selectors],
        ] as const,
    ),
  ]);
}

/**
 * Encodes the account call that installs a Perago mandate session.
 *
 * The session is narrow by construction: one single-signer validation scoped to
 * `execute`, one pre-validation allowlist pinning target and selectors, one
 * pre-execution native spend cap, and one validation-time expiry window.
 */
export function encodeInstallMandateSession(
  permissionInput: MandateSessionPermission,
  addresses: ModularAccountV2Addresses = MODULAR_ACCOUNT_V2_ADDRESSES,
): Hex {
  const permission = normalizePermission(permissionInput);
  const { entityId } = permission;

  const hooks: Hex[] = [
    concatHex([
      serializeHookConfig({
        entityId,
        hasPostHooks: false,
        hasPreHooks: true,
        hookType: HOOK_TYPE_VALIDATION,
        moduleAddress: addresses.allowlistModule,
      }),
      encodeAllowlistData(permission),
    ]),
    concatHex([
      serializeHookConfig({
        entityId,
        hasPostHooks: false,
        hasPreHooks: false,
        hookType: HOOK_TYPE_VALIDATION,
        moduleAddress: addresses.timeRangeModule,
      }),
      encodeAbiParameters(
        [{ type: "uint32" }, { type: "uint48" }, { type: "uint48" }],
        [entityId, permission.validUntil, permission.validAfter],
      ),
    ]),
    concatHex([
      serializeHookConfig({
        entityId,
        hasPostHooks: false,
        hasPreHooks: true,
        hookType: HOOK_TYPE_EXECUTION,
        moduleAddress: addresses.nativeTokenLimitModule,
      }),
      encodeAbiParameters(
        [{ type: "uint32" }, { type: "uint256" }],
        [entityId, permission.nativeSpendLimit],
      ),
    ]),
  ];

  return encodeFunctionData({
    abi: modularAccountAbi,
    args: [
      serializeValidationConfig({
        entityId,
        isGlobal: false,
        isSignatureValidation: false,
        isUserOpValidation: true,
        moduleAddress: addresses.singleSignerValidationModule,
      }),
      [ACCOUNT_EXECUTE_SELECTOR],
      encodeAbiParameters(
        [{ type: "uint32" }, { type: "address" }],
        [entityId, permission.sessionSigner],
      ),
      hooks,
    ],
    functionName: "installValidation",
  });
}

/**
 * Encodes the account call that removes a mandate session and its hook state,
 * which is how authority is revoked before or after a terminal outcome.
 */
export function encodeUninstallMandateSession(
  permissionInput: MandateSessionPermission,
  addresses: ModularAccountV2Addresses = MODULAR_ACCOUNT_V2_ADDRESSES,
): Hex {
  const permission = normalizePermission(permissionInput);
  const { entityId } = permission;

  return encodeFunctionData({
    abi: modularAccountAbi,
    args: [
      serializeModuleEntity({
        entityId,
        moduleAddress: addresses.singleSignerValidationModule,
      }),
      encodeAbiParameters([{ type: "uint32" }], [entityId]),
      [
        encodeAllowlistData(permission),
        encodeAbiParameters([{ type: "uint32" }], [entityId]),
        encodeAbiParameters([{ type: "uint32" }], [entityId]),
      ],
    ],
    functionName: "uninstallValidation",
  });
}
