import {
  AllowlistModule,
  buildFullNonceKey,
  DefaultAddress,
  DefaultModuleAddress,
  NativeTokenLimitModule,
  packUOSignature,
  predictModularAccountV2Address,
  SingleSignerValidationModule,
  TimeRangeModule,
  serializeHookConfig as vendorSerializeHookConfig,
  serializeValidationConfig as vendorSerializeValidationConfig,
} from "@alchemy/smart-accounts";
import {
  ACCOUNT_EXECUTE_SELECTOR,
  buildUserOperationNonceKey,
  deriveSemiModularAccountAddress,
  encodeAccountExecute,
  encodeInstallMandateSession,
  encodeSemiModularAccountFactoryData,
  encodeUninstallMandateSession,
  type MandateSessionPermission,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  packUserOperationSignature,
  serializeHookConfig,
  serializeValidationConfig,
  wrapExecuteUserOp,
} from "@perago/sdk";
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  concatHex,
  createPublicClient,
  createTestClient,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  type Hex,
  http,
  keccak256,
  parseEther,
  publicActions,
  toFunctionSelector,
  toHex,
  walletActions,
} from "viem";
import {
  entryPoint07Abi,
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const BSC_TESTNET_CHAIN_ID = 97;
const DEFAULT_BSC_TESTNET_RPC =
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const DEFAULT_LOCAL_RPC = "http://127.0.0.1:8545";
const SESSION_ENTITY_ID = 7;
const ROTATED_SESSION_ENTITY_ID = 8;
const MANDATE_SELECTOR = toFunctionSelector("executeMandate(bytes32)");
const UNRELATED_SELECTOR = toFunctionSelector("sweep(address)");
const NATIVE_SPEND_LIMIT = parseEther("0.01");
const ALLOWED_SPEND = parseEther("0.001");
const EXCESS_SPEND = parseEther("0.02");
const SESSION_WINDOW_SECONDS = 3600;

/** Runtime that stores the received calldata size in slot 0 and accepts value. */
const CALL_RECORDER_RUNTIME: Hex = "0x3660005500";

const addresses = MODULAR_ACCOUNT_V2_ADDRESSES;

const upgradeAbi = [
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      { name: "newImplementation", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

const entryPointDepositAbi = [
  {
    type: "function",
    name: "depositTo",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

// EntryPoint v0.7 creates its SenderCreator helper in its own constructor and
// exposes no getter, so the address is the EntryPoint's first CREATE.
const ENTRY_POINT_SENDER_CREATOR_NONCE = 1n;

type ProbeCase = {
  name: string;
  expectation: "accepted" | "rejected-at-validation" | "reverted-at-execution";
  outcome: string;
  detail: string;
};

function requireEqual(label: string, actual: string, expected: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch: ${actual} !== ${expected}`);
  }
}

function describeRevert(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (candidate) => candidate instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const args = reverted.data?.args;
      if (name) {
        return `${name}(${(args ?? []).map((arg) => String(arg)).join(", ")})`;
      }
      return reverted.shortMessage;
    }
    return error.shortMessage;
  }

  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const sourceRpc =
    process.env.PERAGO_BSC_TESTNET_RPC ?? DEFAULT_BSC_TESTNET_RPC;
  const localRpc = process.env.PERAGO_LOCAL_RPC ?? DEFAULT_LOCAL_RPC;

  const source = createPublicClient({
    transport: http(sourceRpc, { retryCount: 1, timeout: 30_000 }),
  });
  const client = createTestClient({
    chain: bscTestnet,
    mode: "anvil",
    transport: http(localRpc, { retryCount: 0, timeout: 60_000 }),
  })
    .extend(publicActions)
    .extend(walletActions);

  const [sourceChainId, localChainId] = await Promise.all([
    source.getChainId(),
    client.getChainId(),
  ]);
  if (sourceChainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(
      `evidence source must be chain ${BSC_TESTNET_CHAIN_ID}, received ${sourceChainId}`,
    );
  }
  if (localChainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(
      `local chain must report ${BSC_TESTNET_CHAIN_ID}, received ${localChainId}`,
    );
  }
  const [sourceBlock, localBlock] = await Promise.all([
    source.getBlock(),
    client.getBlock(),
  ]);

  // 1. Replay the exact deployed bytecode of every pinned address locally.
  //    Public BSC Testnet nodes prune state, so a pinned fork cannot serve
  //    account reads; replaying hash-verified code keeps the probe honest and
  //    reproducible without an archive endpoint.
  const senderCreator = getContractAddress({
    from: addresses.entryPoint,
    nonce: ENTRY_POINT_SENDER_CREATOR_NONCE,
    opcode: "CREATE",
  });
  const replayTargets: readonly (readonly [string, Address])[] = [
    ...Object.entries(addresses),
    ["entryPointSenderCreator", senderCreator],
  ];

  const deployedCode: Record<string, { address: Address; codeHash: Hex }> = {};
  for (const [name, address] of replayTargets) {
    const code = await source.getCode({ address });
    if (!code || code === "0x") {
      throw new Error(`${name} (${address}) has no code on BSC Testnet`);
    }
    await client.setCode({ address, bytecode: code });
    const localCode = await client.getCode({ address });
    if (!localCode || keccak256(localCode) !== keccak256(code)) {
      throw new Error(`${name} (${address}) was not replayed byte for byte`);
    }
    deployedCode[name] = { address, codeHash: keccak256(code) };
  }

  // 2. Perago's viem-only encoders must agree with the vendor SDK.
  requireEqual("factory", addresses.factory, DefaultAddress.MAV2_FACTORY);
  requireEqual(
    "implementation",
    addresses.semiModularAccountBytecode,
    DefaultAddress.SMAV2_BYTECODE,
  );
  requireEqual(
    "singleSignerValidationModule",
    addresses.singleSignerValidationModule,
    DefaultModuleAddress.SINGLE_SIGNER_VALIDATION,
  );
  requireEqual(
    "allowlistModule",
    addresses.allowlistModule,
    DefaultModuleAddress.ALLOWLIST,
  );
  requireEqual(
    "nativeTokenLimitModule",
    addresses.nativeTokenLimitModule,
    DefaultModuleAddress.NATIVE_TOKEN_LIMIT,
  );
  requireEqual(
    "timeRangeModule",
    addresses.timeRangeModule,
    DefaultModuleAddress.TIME_RANGE,
  );

  const owner = privateKeyToAccount(generatePrivateKey());
  const sessionSigner = privateKeyToAccount(generatePrivateKey());
  const relayer = privateKeyToAccount(generatePrivateKey());
  const account = deriveSemiModularAccountAddress({ owner: owner.address });

  requireEqual(
    "counterfactual account",
    account,
    predictModularAccountV2Address({
      factoryAddress: addresses.factory,
      implementationAddress: addresses.semiModularAccountBytecode,
      ownerAddress: owner.address,
      salt: 0n,
      type: "SMA",
    }),
  );
  requireEqual(
    "session nonce key",
    toHex(
      buildUserOperationNonceKey({
        entityId: SESSION_ENTITY_ID,
        isGlobalValidation: false,
      }),
    ),
    toHex(
      buildFullNonceKey({
        entityId: SESSION_ENTITY_ID,
        isGlobalValidation: false,
      }),
    ),
  );
  requireEqual(
    "packed signature envelope",
    packUserOperationSignature("0xdeadbeef"),
    packUOSignature({ validationSignature: "0xdeadbeef" }),
  );

  const mandateTarget = getAddress(`0x${"11".repeat(20)}`);
  const unrelatedTarget = getAddress(`0x${"22".repeat(20)}`);
  const permission: MandateSessionPermission = {
    account,
    entityId: SESSION_ENTITY_ID,
    nativeSpendLimit: NATIVE_SPEND_LIMIT,
    selectors: [MANDATE_SELECTOR],
    sessionSigner: sessionSigner.address,
    target: mandateTarget,
    validAfter: 0,
    validUntil: Number(localBlock.timestamp) + SESSION_WINDOW_SECONDS,
  };

  const installCallData = encodeInstallMandateSession(permission);
  const vendorInstallCallData = encodeFunctionData({
    abi: [
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
    ] as const,
    args: [
      vendorSerializeValidationConfig({
        entityId: SESSION_ENTITY_ID,
        isGlobal: false,
        isSignatureValidation: false,
        isUserOpValidation: true,
        moduleAddress: DefaultModuleAddress.SINGLE_SIGNER_VALIDATION,
      }),
      [ACCOUNT_EXECUTE_SELECTOR],
      SingleSignerValidationModule.encodeOnInstallData({
        entityId: SESSION_ENTITY_ID,
        signer: sessionSigner.address,
      }),
      [
        concatHex([
          vendorSerializeHookConfig(
            AllowlistModule.buildHook(
              {
                entityId: SESSION_ENTITY_ID,
                inputs: [
                  {
                    erc20SpendLimit: 0n,
                    hasERC20SpendLimit: false,
                    hasSelectorAllowlist: true,
                    selectors: [MANDATE_SELECTOR],
                    target: mandateTarget,
                  },
                ],
              },
              DefaultModuleAddress.ALLOWLIST,
            ).hookConfig,
          ),
          AllowlistModule.encodeOnInstallData({
            entityId: SESSION_ENTITY_ID,
            inputs: [
              {
                erc20SpendLimit: 0n,
                hasERC20SpendLimit: false,
                hasSelectorAllowlist: true,
                selectors: [MANDATE_SELECTOR],
                target: mandateTarget,
              },
            ],
          }),
        ]),
        concatHex([
          vendorSerializeHookConfig(
            TimeRangeModule.buildHook(
              {
                entityId: SESSION_ENTITY_ID,
                validAfter: permission.validAfter,
                validUntil: permission.validUntil,
              },
              DefaultModuleAddress.TIME_RANGE,
            ).hookConfig,
          ),
          TimeRangeModule.encodeOnInstallData({
            entityId: SESSION_ENTITY_ID,
            validAfter: permission.validAfter,
            validUntil: permission.validUntil,
          }),
        ]),
        concatHex([
          serializeHookConfig({
            entityId: SESSION_ENTITY_ID,
            hasPostHooks: false,
            hasPreHooks: true,
            hookType: 0,
            moduleAddress: DefaultModuleAddress.NATIVE_TOKEN_LIMIT,
          }),
          NativeTokenLimitModule.encodeOnInstallData({
            entityId: SESSION_ENTITY_ID,
            spendLimit: NATIVE_SPEND_LIMIT,
          }),
        ]),
      ],
    ],
    functionName: "installValidation",
  });
  requireEqual(
    "session install calldata",
    installCallData,
    vendorInstallCallData,
  );
  requireEqual(
    "validation config",
    serializeValidationConfig({
      entityId: SESSION_ENTITY_ID,
      isGlobal: false,
      isSignatureValidation: false,
      isUserOpValidation: true,
      moduleAddress: addresses.singleSignerValidationModule,
    }),
    vendorSerializeValidationConfig({
      entityId: SESSION_ENTITY_ID,
      isGlobal: false,
      isSignatureValidation: false,
      isUserOpValidation: true,
      moduleAddress: DefaultModuleAddress.SINGLE_SIGNER_VALIDATION,
    }),
  );

  // 3. Fund the fork participants and plant observable call targets.
  await client.setBalance({
    address: relayer.address,
    value: parseEther("10"),
  });
  await client.setBalance({ address: account, value: parseEther("1") });
  await client.setCode({
    address: mandateTarget,
    bytecode: CALL_RECORDER_RUNTIME,
  });
  await client.setCode({
    address: unrelatedTarget,
    bytecode: CALL_RECORDER_RUNTIME,
  });
  await client.setBalance({
    address: addresses.entryPoint,
    value: parseEther("1"),
  });

  const gasPrice = await client.getGasPrice();
  const fees = {
    maxFeePerGas: gasPrice * 2n,
    maxPriorityFeePerGas: gasPrice,
  };

  async function buildUserOperation(params: {
    callData: Hex;
    entityId: number;
    isGlobalValidation: boolean;
    signer: typeof owner;
    withFactory?: boolean;
  }): Promise<UserOperation<"0.7">> {
    const nonce = await client.readContract({
      abi: entryPoint07Abi,
      address: addresses.entryPoint,
      args: [
        account,
        buildUserOperationNonceKey({
          entityId: params.entityId,
          isGlobalValidation: params.isGlobalValidation,
        }),
      ],
      functionName: "getNonce",
    });

    const base = {
      callData: params.callData,
      callGasLimit: 900_000n,
      nonce,
      preVerificationGas: 200_000n,
      sender: account,
      signature: "0x" as Hex,
      verificationGasLimit: 1_500_000n,
      ...fees,
    } satisfies UserOperation<"0.7">;

    const userOperation: UserOperation<"0.7"> = params.withFactory
      ? {
          ...base,
          factory: addresses.factory,
          factoryData: encodeSemiModularAccountFactoryData({
            owner: owner.address,
          }),
        }
      : base;

    const hash = getUserOperationHash({
      chainId: BSC_TESTNET_CHAIN_ID,
      entryPointAddress: addresses.entryPoint,
      entryPointVersion: "0.7",
      userOperation,
    });

    return {
      ...userOperation,
      signature: packUserOperationSignature(
        await params.signer.signMessage({ message: { raw: hash } }),
      ),
    };
  }

  async function submit(userOperation: UserOperation<"0.7">) {
    const hash = await client.writeContract({
      abi: entryPoint07Abi,
      account: relayer,
      address: addresses.entryPoint,
      args: [[toPackedUserOperation(userOperation)], relayer.address],
      chain: bscTestnet,
      functionName: "handleOps",
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`handleOps reverted in transaction ${hash}`);
    }

    const events = await client.getContractEvents({
      abi: entryPoint07Abi,
      address: addresses.entryPoint,
      blockHash: receipt.blockHash,
      eventName: "UserOperationEvent",
    });
    const event = events.at(-1);
    if (!event) {
      throw new Error(`no UserOperationEvent in transaction ${hash}`);
    }

    return {
      success: event.args.success === true,
      transactionHash: hash,
      userOpHash: event.args.userOpHash as Hex,
    };
  }

  async function simulate(userOperation: UserOperation<"0.7">) {
    await client.simulateContract({
      abi: entryPoint07Abi,
      account: relayer,
      address: addresses.entryPoint,
      args: [[toPackedUserOperation(userOperation)], relayer.address],
      functionName: "handleOps",
    });
  }

  // 4. Root owner deploys the account, funds its own gas, installs the session.
  await client.writeContract({
    abi: entryPointDepositAbi,
    account: relayer,
    address: addresses.entryPoint,
    args: [account],
    chain: bscTestnet,
    functionName: "depositTo",
    value: parseEther("0.2"),
  });

  const deployment = await submit(
    await buildUserOperation({
      callData: encodeAccountExecute({
        data: "0x",
        target: mandateTarget,
        value: 0n,
      }),
      entityId: 0,
      isGlobalValidation: true,
      signer: owner,
      withFactory: true,
    }),
  );
  const deployedAccountCode = await client.getCode({ address: account });
  if (!deployedAccountCode || deployedAccountCode === "0x") {
    throw new Error("account was not deployed by the root UserOperation");
  }

  const selfFundedGas = await submit(
    await buildUserOperation({
      callData: encodeAccountExecute({
        data: encodeFunctionData({
          abi: entryPointDepositAbi,
          args: [account],
          functionName: "depositTo",
        }),
        target: addresses.entryPoint,
        value: parseEther("0.1"),
      }),
      entityId: 0,
      isGlobalValidation: true,
      signer: owner,
    }),
  );

  const installed = await submit(
    await buildUserOperation({
      callData: installCallData,
      entityId: 0,
      isGlobalValidation: true,
      signer: owner,
    }),
  );
  if (!installed.success) {
    throw new Error("session installation reverted");
  }

  // 5. Session matrix.
  const cases: ProbeCase[] = [];

  async function expectRejected(
    name: string,
    callData: Hex,
    entityId = SESSION_ENTITY_ID,
  ): Promise<void> {
    const userOperation = await buildUserOperation({
      callData,
      entityId,
      isGlobalValidation: false,
      signer: sessionSigner,
    });
    try {
      await simulate(userOperation);
    } catch (error) {
      cases.push({
        detail: describeRevert(error),
        expectation: "rejected-at-validation",
        name,
        outcome: "rejected",
      });
      return;
    }
    throw new Error(`${name} was accepted but must be rejected`);
  }

  const mandateCallData = concatHex([MANDATE_SELECTOR, `0x${"33".repeat(32)}`]);
  const allowedCall = wrapExecuteUserOp(
    encodeAccountExecute({
      data: mandateCallData,
      target: mandateTarget,
      value: ALLOWED_SPEND,
    }),
  );

  const targetBalanceBefore = await client.getBalance({
    address: mandateTarget,
  });
  const accepted = await submit(
    await buildUserOperation({
      callData: allowedCall,
      entityId: SESSION_ENTITY_ID,
      isGlobalValidation: false,
      signer: sessionSigner,
    }),
  );
  const targetBalanceAfter = await client.getBalance({
    address: mandateTarget,
  });
  const recordedCallSize = await client.getStorageAt({
    address: mandateTarget,
    slot: "0x0",
  });
  if (!accepted.success) {
    throw new Error("the allowlisted mandate call was reverted by the account");
  }
  if (targetBalanceAfter - targetBalanceBefore !== ALLOWED_SPEND) {
    throw new Error("the allowlisted call did not move the expected value");
  }
  if (
    BigInt(recordedCallSize ?? "0x0") !== BigInt(mandateCallData.length / 2 - 1)
  ) {
    throw new Error("the target did not observe the mandate calldata");
  }
  cases.push({
    detail: `userOpHash ${accepted.userOpHash}, value ${ALLOWED_SPEND.toString()} wei delivered, calldata ${BigInt(recordedCallSize ?? "0x0").toString()} bytes observed`,
    expectation: "accepted",
    name: "allowlisted mandate-shaped call",
    outcome: "accepted",
  });

  await expectRejected(
    "unrelated target",
    wrapExecuteUserOp(
      encodeAccountExecute({
        data: mandateCallData,
        target: unrelatedTarget,
        value: 0n,
      }),
    ),
  );
  await expectRejected(
    "unallowlisted selector on the allowed target",
    wrapExecuteUserOp(
      encodeAccountExecute({
        data: concatHex([UNRELATED_SELECTOR, `0x${"00".repeat(32)}`]),
        target: mandateTarget,
        value: 0n,
      }),
    ),
  );
  await expectRejected(
    "root-only module install",
    wrapExecuteUserOp(
      encodeInstallMandateSession({
        ...permission,
        entityId: ROTATED_SESSION_ENTITY_ID,
        sessionSigner: sessionSigner.address,
      }),
    ),
  );
  await expectRejected(
    "account upgrade",
    wrapExecuteUserOp(
      encodeFunctionData({
        abi: upgradeAbi,
        args: [addresses.semiModularAccountBytecode, "0x"],
        functionName: "upgradeToAndCall",
      }),
    ),
  );
  await expectRejected(
    "self-call through execute",
    wrapExecuteUserOp(
      encodeAccountExecute({
        data: mandateCallData,
        target: account,
        value: 0n,
      }),
    ),
  );

  const excessBalanceBefore = await client.getBalance({
    address: mandateTarget,
  });
  const excessStorageBefore = await client.getStorageAt({
    address: mandateTarget,
    slot: "0x0",
  });
  const excess = await submit(
    await buildUserOperation({
      callData: wrapExecuteUserOp(
        encodeAccountExecute({
          data: mandateCallData,
          target: mandateTarget,
          value: EXCESS_SPEND,
        }),
      ),
      entityId: SESSION_ENTITY_ID,
      isGlobalValidation: false,
      signer: sessionSigner,
    }),
  );
  const excessBalanceAfter = await client.getBalance({
    address: mandateTarget,
  });
  const excessStorageAfter = await client.getStorageAt({
    address: mandateTarget,
    slot: "0x0",
  });
  if (excess.success) {
    throw new Error("a spend above the session limit was executed");
  }
  if (excessBalanceAfter !== excessBalanceBefore) {
    throw new Error("an over-limit spend moved value");
  }
  cases.push({
    detail: `userOpHash ${excess.userOpHash}, limit ${NATIVE_SPEND_LIMIT.toString()} wei, attempted ${EXCESS_SPEND.toString()} wei, target balance and storage unchanged (${excessStorageBefore} -> ${excessStorageAfter})`,
    expectation: "reverted-at-execution",
    name: "native spend above the session limit",
    outcome: "reverted",
  });

  // 6. Expiry: warp past validUntil and retry the previously accepted call.
  await client.increaseTime({ seconds: SESSION_WINDOW_SECONDS * 2 });
  await client.mine({ blocks: 1 });
  await expectRejected("expired session permission", allowedCall);

  // 7. Rotation and revocation: root installs a fresh session, then revokes it.
  const warpedBlock = await client.getBlock();
  const rotated: MandateSessionPermission = {
    ...permission,
    entityId: ROTATED_SESSION_ENTITY_ID,
    validUntil: Number(warpedBlock.timestamp) + SESSION_WINDOW_SECONDS,
  };
  const rotatedInstall = await submit(
    await buildUserOperation({
      callData: encodeInstallMandateSession(rotated),
      entityId: 0,
      isGlobalValidation: true,
      signer: owner,
    }),
  );
  if (!rotatedInstall.success) {
    throw new Error("rotated session installation reverted");
  }

  const rotatedAccepted = await submit(
    await buildUserOperation({
      callData: allowedCall,
      entityId: ROTATED_SESSION_ENTITY_ID,
      isGlobalValidation: false,
      signer: sessionSigner,
    }),
  );
  if (!rotatedAccepted.success) {
    throw new Error("the rotated session rejected its allowlisted call");
  }
  cases.push({
    detail: `userOpHash ${rotatedAccepted.userOpHash} under entity ${ROTATED_SESSION_ENTITY_ID}`,
    expectation: "accepted",
    name: "rotated session accepts the allowlisted call",
    outcome: "accepted",
  });

  const revoked = await submit(
    await buildUserOperation({
      callData: encodeUninstallMandateSession(rotated),
      entityId: 0,
      isGlobalValidation: true,
      signer: owner,
    }),
  );
  if (!revoked.success) {
    throw new Error("session revocation reverted");
  }
  await expectRejected(
    "revoked session permission",
    allowedCall,
    ROTATED_SESSION_ENTITY_ID,
  );

  console.log(
    JSON.stringify(
      {
        evidence: "bsc-testnet-bytecode-replay",
        chainId: BSC_TESTNET_CHAIN_ID,
        sourceBlock: {
          number: sourceBlock.number.toString(),
          hash: sourceBlock.hash,
          timestamp: sourceBlock.timestamp.toString(),
        },
        deployedCode,
        account: {
          address: account,
          rootOwnerIsDisposable: true,
          deploymentUserOpHash: deployment.userOpHash,
          deploymentTransaction: deployment.transactionHash,
          selfFundedGasUserOpHash: selfFundedGas.userOpHash,
          sessionInstallUserOpHash: installed.userOpHash,
          sessionRevokeUserOpHash: revoked.userOpHash,
        },
        session: {
          entityId: SESSION_ENTITY_ID,
          rotatedEntityId: ROTATED_SESSION_ENTITY_ID,
          target: mandateTarget,
          allowedSelectors: [MANDATE_SELECTOR],
          nativeSpendLimitWei: NATIVE_SPEND_LIMIT.toString(),
          validUntil: permission.validUntil,
        },
        crossChecks: {
          vendor: "@alchemy/smart-accounts@5.2.6",
          addresses: "match",
          counterfactualAddress: "match",
          nonceKey: "match",
          signatureEnvelope: "match",
          sessionInstallCallData: "match",
        },
        cases,
        pendingTestnetEvidence: [
          "sponsored UserOperation on chain 97",
          "owner-paid UserOperation on chain 97",
        ],
      },
      null,
      2,
    ),
  );
}

void main();
