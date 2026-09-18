import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildUserOperationNonceKey,
  deriveSemiModularAccountAddress,
  encodeAccountExecute,
  encodeInstallMandateSession,
  encodeSemiModularAccountFactoryData,
  encodeUninstallMandateSession,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  packUserOperationSignature,
  wrapExecuteUserOp,
} from "@perago/sdk";
import {
  type Address,
  concatHex,
  createPublicClient,
  formatEther,
  type Hex,
  http,
  keccak256,
  numberToHex,
  parseAbi,
  parseEther,
  toFunctionSelector,
} from "viem";
import {
  entryPoint07Abi,
  getUserOperationHash,
  type UserOperation,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const BSC_TESTNET_CHAIN_ID = 97;
/** Permission slots persist, so each run claims a pair no earlier run used. */
const ENTITY_ID_FLOOR = 1_000;
const ENTITY_ID_SPAN = 100_000;

/** Verified BSC Testnet WBNB used as the single allowlisted session target. */
const WBNB: Address = "0x094616F0BdFB0b526bD735Bf66Eca0Ad254ca81F";
const DEPOSIT_SELECTOR = toFunctionSelector("deposit()");
const WITHDRAW_SELECTOR = toFunctionSelector("withdraw(uint256)");

const SESSION_NATIVE_LIMIT = parseEther("0.005");
const ALLOWED_SPEND = parseEther("0.0002");
const EXCESS_SPEND = parseEther("0.01");
const SESSION_WINDOW_SECONDS = 3600;

const MAX_FEE_PER_GAS = 1_500_000_000n;
const MAX_PRIORITY_FEE_PER_GAS = 1_000_000_000n;
/** Placeholder limits used only for the bundler estimation request. */
const ESTIMATION_GAS = {
  callGasLimit: 500_000n,
  preVerificationGas: 150_000n,
  verificationGasLimit: 900_000n,
} as const;

/** The bundler enforces a minimum limit efficiency, so the buffer stays small. */
function withBuffer(estimate: Hex): bigint {
  return (BigInt(estimate) * 115n) / 100n;
}

/** A structurally valid signature used only for bundler gas estimation. */
const DUMMY_SIGNATURE = packUserOperationSignature(
  `0x${"11".repeat(32)}${"22".repeat(32)}1c`,
);

const wbnbAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

type MatrixCase = {
  detail: string;
  expectation: "accepted" | "rejected";
  name: string;
  outcome: "accepted" | "rejected";
};
type RpcUserOperation = Record<string, Hex>;

type GasOverrides = {
  callGasLimit?: bigint;
  preVerificationGas?: bigint;
  verificationGasLimit?: bigint;
};

type EfficiencyComplaint = {
  actual: number;
  key: "callGasLimit" | "verificationGasLimit";
  required: number;
};

/**
 * The bundler rejects a UserOperation whose gas limits exceed its measured use
 * by too much. Its error names the offending limit and both ratios.
 */
function parseEfficiencyComplaint(
  error: unknown,
): EfficiencyComplaint | undefined {
  const match =
    /(Verification|Call) gas limit efficiency too low\. Required: ([\d.]+), Actual: ([\d.]+)/.exec(
      error instanceof Error ? error.message : String(error),
    );
  if (!match) {
    return undefined;
  }
  return {
    actual: Number(match[3]),
    key: match[1] === "Verification" ? "verificationGasLimit" : "callGasLimit",
    required: Number(match[2]),
  };
}

type SubmittedUserOperation = {
  actualGasCost: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  userOpHash: Hex;
};

type SessionCallOutcome = {
  mode: "owner-paid" | "sponsored";
  note: string;
  result: SubmittedUserOperation;
};

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function toRpc(userOperation: UserOperation<"0.7">): RpcUserOperation {
  const rpc: RpcUserOperation = {
    callData: userOperation.callData,
    callGasLimit: numberToHex(userOperation.callGasLimit),
    maxFeePerGas: numberToHex(userOperation.maxFeePerGas),
    maxPriorityFeePerGas: numberToHex(userOperation.maxPriorityFeePerGas),
    nonce: numberToHex(userOperation.nonce),
    preVerificationGas: numberToHex(userOperation.preVerificationGas),
    sender: userOperation.sender,
    signature: userOperation.signature,
    verificationGasLimit: numberToHex(userOperation.verificationGasLimit),
  };
  if (userOperation.factory && userOperation.factoryData) {
    rpc.factory = userOperation.factory;
    rpc.factoryData = userOperation.factoryData;
  }
  return rpc;
}

function short(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

async function main() {
  const nodeRpc = required("PERAGO_BSC_TESTNET_RPC");
  const bundlerRpc = required("PERAGO_ALCHEMY_BUNDLER_RPC");
  const policyId = required("PERAGO_ALCHEMY_GAS_MANAGER_POLICY_ID");
  const owner = privateKeyToAccount(
    required("PERAGO_DISPOSABLE_OWNER_KEY") as Hex,
  );
  const sessionSigner = privateKeyToAccount(
    keccak256(`0x${"5e"}${owner.address.slice(2)}` as Hex),
  );

  const addresses = MODULAR_ACCOUNT_V2_ADDRESSES;
  const account = deriveSemiModularAccountAddress({ owner: owner.address });
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(nodeRpc, { retryCount: 2, timeout: 60_000 }),
  });

  const chainId = await client.getChainId();
  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(`expected chain 97, received ${chainId}`);
  }

  // 1. Re-verify the reviewed deployment manifest against live code.
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../../deployments/bsc-testnet.account.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as {
    contracts: Record<string, { address: Address; codeHash: Hex }>;
  };
  for (const [name, entry] of Object.entries(manifest.contracts)) {
    const code = await client.getCode({ address: entry.address });
    if (!code || code === "0x") {
      throw new Error(`${name} has no code on chain 97`);
    }
    if (keccak256(code) !== entry.codeHash) {
      throw new Error(`${name} code hash does not match the manifest`);
    }
  }

  const startBalance = await client.getBalance({ address: account });
  if (startBalance < parseEther("0.01")) {
    throw new Error(
      `account ${account} holds ${formatEther(startBalance)} tBNB; fund it before running this probe`,
    );
  }

  async function bundler(
    method: string,
    params: unknown[],
    sponsored = false,
  ): Promise<unknown> {
    const response = await fetch(bundlerRpc, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      headers: {
        "content-type": "application/json",
        ...(sponsored ? { "x-alchemy-policy-id": policyId } : {}),
      },
      method: "POST",
    });
    const payload = (await response.json()) as {
      error?: unknown;
      result?: unknown;
    };
    if (payload.error) {
      throw new Error(short(payload.error));
    }
    return payload.result;
  }

  async function build(params: {
    callData: Hex;
    entityId: number;
    isGlobalValidation: boolean;
    overrides?: GasOverrides;
    signer: typeof owner;
    sponsored?: boolean;
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

    const fees = params.sponsored
      ? { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }
      : {
          maxFeePerGas: MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
        };

    const draft: UserOperation<"0.7"> = {
      callData: params.callData,
      nonce,
      sender: account,
      signature: DUMMY_SIGNATURE,
      ...ESTIMATION_GAS,
      ...fees,
      ...(params.withFactory
        ? {
            factory: addresses.factory,
            factoryData: encodeSemiModularAccountFactoryData({
              owner: owner.address,
            }),
          }
        : {}),
    };

    // The bundler rejects over-provisioned limits, so the estimate is authoritative.
    const estimate = (await bundler(
      "eth_estimateUserOperationGas",
      [toRpc(draft), addresses.entryPoint],
      params.sponsored,
    )) as {
      callGasLimit: Hex;
      preVerificationGas: Hex;
      verificationGasLimit: Hex;
    };

    const unsigned: UserOperation<"0.7"> = {
      ...draft,
      callGasLimit:
        params.overrides?.callGasLimit ?? withBuffer(estimate.callGasLimit),
      preVerificationGas:
        params.overrides?.preVerificationGas ??
        withBuffer(estimate.preVerificationGas),
      signature: "0x",
      verificationGasLimit:
        params.overrides?.verificationGasLimit ??
        withBuffer(estimate.verificationGasLimit),
    };
    const hash = getUserOperationHash({
      chainId: BSC_TESTNET_CHAIN_ID,
      entryPointAddress: addresses.entryPoint,
      entryPointVersion: "0.7",
      userOperation: unsigned,
    });

    return {
      ...unsigned,
      signature: packUserOperationSignature(
        await params.signer.signMessage({ message: { raw: hash } }),
      ),
    };
  }

  async function send(
    userOperation: UserOperation<"0.7">,
    sponsored = false,
  ): Promise<{
    actualGasCost: bigint;
    blockNumber: bigint;
    transactionHash: Hex;
    userOpHash: Hex;
  }> {
    const userOpHash = (await bundler(
      "eth_sendUserOperation",
      [toRpc(userOperation), addresses.entryPoint],
      sponsored,
    )) as Hex;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const receipt = (await bundler("eth_getUserOperationReceipt", [
        userOpHash,
      ])) as {
        actualGasCost: Hex;
        receipt: { blockNumber: Hex; transactionHash: Hex };
        success: boolean;
      } | null;
      if (receipt) {
        if (!receipt.success) {
          throw new Error(
            `UserOperation ${userOpHash} executed but reverted in ${receipt.receipt.transactionHash}`,
          );
        }
        return {
          actualGasCost: BigInt(receipt.actualGasCost),
          blockNumber: BigInt(receipt.receipt.blockNumber),
          transactionHash: receipt.receipt.transactionHash,
          userOpHash,
        };
      }
      await delay(3_000);
    }
    throw new Error(`UserOperation ${userOpHash} was never mined`);
  }

  type SubmitParams = {
    callData: Hex;
    entityId: number;
    isGlobalValidation: boolean;
    signer: typeof owner;
    sponsored?: boolean;
    withFactory?: boolean;
  };

  /** Builds, signs, and submits, retuning limits when the bundler asks for tighter ones. */
  async function submit(params: SubmitParams): Promise<SubmittedUserOperation> {
    const overrides: GasOverrides = {};
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const userOperation = await build({ ...params, overrides });
      try {
        return await send(userOperation, params.sponsored ?? false);
      } catch (error) {
        const complaint = parseEfficiencyComplaint(error);
        if (!complaint) {
          throw error;
        }
        // Target the middle of the accepted band so one retry usually suffices.
        const current = userOperation[complaint.key];
        overrides[complaint.key] =
          BigInt(
            Math.ceil(
              (Number(current) * complaint.actual) / (complaint.required * 1.3),
            ),
          ) + 1n;
      }
    }
    throw new Error(
      "the bundler kept rejecting the estimated gas limits as inefficient",
    );
  }

  const entityIdBase =
    ENTITY_ID_FLOOR + Number(BigInt(Date.now()) % BigInt(ENTITY_ID_SPAN));
  const sessionEntityId = entityIdBase;
  const expiredEntityId = entityIdBase + 1;

  const permission = {
    account,
    entityId: sessionEntityId,
    nativeSpendLimit: SESSION_NATIVE_LIMIT,
    selectors: [DEPOSIT_SELECTOR],
    sessionSigner: sessionSigner.address,
    target: WBNB,
    validAfter: 0,
    validUntil:
      Number((await client.getBlock()).timestamp) + SESSION_WINDOW_SECONDS,
  } as const;

  // 2. Owner-paid UserOperation: deploy the account if needed, install the session.
  const priorCode = await client.getCode({ address: account });
  const deployedThisRun = !priorCode || priorCode === "0x";
  const sessionInstall = await submit({
    callData: encodeInstallMandateSession(permission),
    entityId: 0,
    isGlobalValidation: true,
    signer: owner,
    withFactory: deployedThisRun,
  });
  const accountCode = await client.getCode({ address: account });
  if (!accountCode || accountCode === "0x") {
    throw new Error("the owner-paid UserOperation did not deploy the account");
  }

  // 3. Sponsored UserOperation: the session performs its allowlisted call.
  const allowedCall = wrapExecuteUserOp(
    encodeAccountExecute({
      data: DEPOSIT_SELECTOR,
      target: WBNB,
      value: ALLOWED_SPEND,
    }),
  );
  const wrappedBefore = await client.readContract({
    abi: wbnbAbi,
    address: WBNB,
    args: [account],
    functionName: "balanceOf",
  });

  let sponsorship: SessionCallOutcome;
  try {
    sponsorship = {
      mode: "sponsored",
      note: "Alchemy Bundler Sponsored Operation with zero UserOperation fees",
      result: await submit({
        callData: allowedCall,
        entityId: sessionEntityId,
        isGlobalValidation: false,
        signer: sessionSigner,
        sponsored: true,
      }),
    };
  } catch (error) {
    sponsorship = {
      mode: "owner-paid",
      note: `sponsorship rejected: ${short(error instanceof Error ? error.message : error)}`,
      result: await submit({
        callData: allowedCall,
        entityId: sessionEntityId,
        isGlobalValidation: false,
        signer: sessionSigner,
      }),
    };
  }

  const wrappedAfter = await client.readContract({
    abi: wbnbAbi,
    address: WBNB,
    args: [account],
    functionName: "balanceOf",
  });
  if (wrappedAfter - wrappedBefore !== ALLOWED_SPEND) {
    throw new Error(
      "the allowlisted session call did not move the expected value",
    );
  }

  const cases: MatrixCase[] = [
    {
      detail: `${sponsorship.mode} userOpHash ${sponsorship.result.userOpHash} in transaction ${sponsorship.result.transactionHash}; ${formatEther(ALLOWED_SPEND)} tBNB wrapped`,
      expectation: "accepted",
      name: "allowlisted session call",
      outcome: "accepted",
    },
  ];

  async function expectRejected(params: {
    callData: Hex;
    entityId?: number;
    name: string;
  }): Promise<void> {
    try {
      await submit({
        callData: params.callData,
        entityId: params.entityId ?? sessionEntityId,
        isGlobalValidation: false,
        signer: sessionSigner,
      });
    } catch (error) {
      cases.push({
        detail: short(error instanceof Error ? error.message : error),
        expectation: "rejected",
        name: params.name,
        outcome: "rejected",
      });
      return;
    }
    throw new Error(`${params.name} was accepted but must be rejected`);
  }

  await expectRejected({
    callData: wrapExecuteUserOp(
      encodeAccountExecute({
        data: DEPOSIT_SELECTOR,
        target: owner.address,
        value: ALLOWED_SPEND,
      }),
    ),
    name: "unrelated target",
  });
  await expectRejected({
    callData: wrapExecuteUserOp(
      encodeAccountExecute({
        data: concatHex([WITHDRAW_SELECTOR, `0x${"00".repeat(32)}`]),
        target: WBNB,
        value: 0n,
      }),
    ),
    name: "unallowlisted selector on the allowlisted target",
  });
  await expectRejected({
    callData: encodeInstallMandateSession({
      ...permission,
      entityId: sessionEntityId + 100,
    }),
    name: "module install through the session",
  });
  await expectRejected({
    callData: wrapExecuteUserOp(
      encodeAccountExecute({ data: "0x", target: account, value: 0n }),
    ),
    name: "account self-call",
  });
  await expectRejected({
    callData: wrapExecuteUserOp(
      encodeAccountExecute({
        data: DEPOSIT_SELECTOR,
        target: WBNB,
        value: EXCESS_SPEND,
      }),
    ),
    name: "spend above the session native limit",
  });

  // 4. Expiry is enforced: install an already-expired session and use it.
  const expiredInstall = await submit({
    callData: encodeInstallMandateSession({
      ...permission,
      entityId: expiredEntityId,
      validUntil: Number((await client.getBlock()).timestamp) - 60,
    }),
    entityId: 0,
    isGlobalValidation: true,
    signer: owner,
  });
  await expectRejected({
    callData: allowedCall,
    entityId: expiredEntityId,
    name: "expired session permission",
  });

  // 5. Revocation ends authority.
  const revocation = await submit({
    callData: encodeUninstallMandateSession(permission),
    entityId: 0,
    isGlobalValidation: true,
    signer: owner,
  });
  await expectRejected({
    callData: allowedCall,
    name: "revoked session permission",
  });

  // 6. Leave no residual permission behind, so the probe is safely repeatable.
  const expiredRevocation = await submit({
    callData: encodeUninstallMandateSession({
      ...permission,
      entityId: expiredEntityId,
    }),
    entityId: 0,
    isGlobalValidation: true,
    signer: owner,
  });

  const endBalance = await client.getBalance({ address: account });
  console.log(
    JSON.stringify(
      {
        account,
        accountDeployedThisRun: deployedThisRun,
        cases,
        chainId,
        gas: {
          endBalance: formatEther(endBalance),
          startBalance: formatEther(startBalance),
        },
        ownerEoa: owner.address,
        session: {
          allowedSelectors: permission.selectors,
          entityId: sessionEntityId,
          nativeSpendLimit: formatEther(SESSION_NATIVE_LIMIT),
          signer: sessionSigner.address,
          target: WBNB,
        },
        userOperations: {
          expiredSessionInstall: expiredInstall,
          expiredSessionRevocation: expiredRevocation,
          sessionCall: { mode: sponsorship.mode, ...sponsorship.result },
          sessionInstall,
          sessionRevocation: revocation,
        },
        wrappedBalance: {
          after: formatEther(wrappedAfter),
          before: formatEther(wrappedBefore),
        },
        ...(sponsorship.mode === "owner-paid"
          ? { sponsorshipBlocker: sponsorship.note }
          : {}),
      },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
}

void main();
