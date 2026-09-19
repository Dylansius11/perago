import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  deriveSemiModularAccountAddress,
  encodeAccountExecute,
  encodeInstallMandateSession,
  encodeUninstallMandateSession,
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
  type PublicClient,
  parseAbi,
  parseEther,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import { required, short } from "../lib/environment.ts";
import { writeEvidence } from "../lib/evidence.ts";
import {
  createUserOperationClient,
  type SubmittedUserOperation,
} from "../lib/user-operation-client.ts";

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
/** Float the probe needs when the bundler refuses to sponsor an operation. */
const MINIMUM_ACCOUNT_BALANCE = parseEther("0.003");
const SESSION_WINDOW_SECONDS = 3600;

const wbnbAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

type MatrixCase = {
  detail: string;
  expectation: "accepted" | "rejected";
  name: string;
  outcome: "accepted" | "rejected";
};

type SessionCallOutcome = {
  mode: "owner-paid" | "sponsored";
  note: string;
  result: SubmittedUserOperation;
};

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

  // Sponsored operations cost the account nothing, but the owner-paid fallback
  // and the wrapped-value case still need a real float.
  const startBalance = await client.getBalance({ address: account });
  if (startBalance < MINIMUM_ACCOUNT_BALANCE) {
    throw new Error(
      `account ${account} holds ${formatEther(startBalance)} tBNB; fund it before running this probe`,
    );
  }

  const { submit } = createUserOperationClient({
    account,
    bundlerRpc,
    chainId,
    client: client as PublicClient,
    owner: owner.address,
    policyId,
  });

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
  writeEvidence("bsc-testnet.account-live", {
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
    ranAt: new Date().toISOString(),
    ...(sponsorship.mode === "owner-paid"
      ? { sponsorshipBlocker: sponsorship.note }
      : {}),
  });
}

void main();
