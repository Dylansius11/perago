import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  Address,
  MandateSessionPermissionDocument,
  WalletPolicy,
} from "@perago/sdk";
import {
  deriveSemiModularAccountAddress,
  encodeAccountPolicyTransition,
  encodeInstallMandateSession,
  encodeUninstallMandateSession,
  getAccountPolicyTypedData,
  hashMandateSessionPermission,
  hashMandateSessionRevocation,
  hashPolicyRevocation,
  hashWalletPolicy,
  mandateExecutorAbi,
  toMandateSessionPermission,
} from "@perago/sdk";
import {
  createPublicClient,
  getAbiItem,
  getAddress,
  type Hex,
  http,
  keccak256,
  recoverMessageAddress,
  recoverTypedDataAddress,
  toFunctionSelector,
} from "viem";
import { bscTestnet } from "viem/chains";

import { required } from "../lib/environment.ts";
import { writeEvidence } from "../lib/evidence.ts";
import {
  createUserOperationClient,
  type SubmittedUserOperation,
} from "../lib/user-operation-client.ts";

const CHAIN_ID = 97;
const ROOT_OWNER = getAddress("0x712683F374Cd524F6336E87D577Fc39d1102930A");
const SESSION_SIGNER = getAddress("0x000000000000000000000000000000000000dEaD");
const ENTITY_ID = 97_002;
const STATE_PATH = fileURLToPath(
  new URL("../../../../cache/p3-policy-live.json", import.meta.url),
);
const USER_OPERATION_SIGNATURE_PATH = fileURLToPath(
  new URL(
    "../../../../cache/p3-policy-user-operation-signature.txt",
    import.meta.url,
  ),
);
const MANIFEST_PATH = fileURLToPath(
  new URL(
    "../../../../deployments/bsc-testnet.p3-policy-probe.json",
    import.meta.url,
  ),
);
const PROTOCOL_MANIFEST_PATH = fileURLToPath(
  new URL(
    "../../../../deployments/bsc-testnet.protocols.json",
    import.meta.url,
  ),
);

class ManualSignatureRequired extends Error {}

type TransitionEvidence = {
  blockNumber: string;
  transactionHash: Hex;
  userOperationHash: Hex;
};

type ProbeState = {
  account: Address;
  activation?: TransitionEvidence;
  activationPolicy?: WalletPolicy;
  activationValidUntil?: string;
  permission?: MandateSessionPermissionDocument;
  revocation?: TransitionEvidence;
  revocationValidUntil?: string;
};
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitForUserOperationSignature(
  hash: Hex,
  transition: "activate" | "revoke",
): Promise<Hex> {
  console.log(
    printable({
      action: "SIGN_USER_OPERATION",
      hash,
      transition,
      waitingFor: "cache/p3-policy-user-operation-signature.txt",
    }),
  );
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    try {
      const signature = readFileSync(
        USER_OPERATION_SIGNATURE_PATH,
        "utf8",
      ).trim();
      rmSync(USER_OPERATION_SIGNATURE_PATH, { force: true });
      if (!/^0x[0-9a-f]{130}$/iu.test(signature)) {
        throw new Error("manual UserOperation signature is not 65-byte hex");
      }
      return signature as Hex;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
    await delay(500);
  }
  throw new Error("timed out waiting for the manual UserOperation signature");
}

function policyDocument(
  account: Address,
  wbnb: Address,
  cake: Address,
): WalletPolicy {
  return {
    account,
    activeAssets: [
      {
        maxInputPerTask: "100000000000000000",
        rollingDailyCap: "300000000000000000",
        token: wbnb,
      },
    ],
    allowedRecipients: "SELF",
    approvedAdapterIds: ["pancakeswap-v3"],
    chainId: "97",
    maxSlippageBps: "100",
    maxTaskLifetimeSeconds: "3600",
    protectedAssets: [cake],
    schemaVersion: "1",
    services: ["SWAP"],
    version: "1",
  };
}

function loadState(account: Address): ProbeState {
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as ProbeState;
    if (state.account.toLowerCase() !== account.toLowerCase()) {
      throw new Error("cached policy probe belongs to another smart account");
    }
    return state;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { account };
    }
    throw error;
  }
}

function saveState(state: ProbeState): void {
  mkdirSync(fileURLToPath(new URL("../../../../cache/", import.meta.url)), {
    recursive: true,
  });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function printable(value: unknown): string {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

async function main() {
  const transition = required("PERAGO_POLICY_TRANSITION");
  if (transition !== "activate" && transition !== "revoke") {
    throw new Error("PERAGO_POLICY_TRANSITION must be activate or revoke");
  }

  const rpcUrl = required("PERAGO_BSC_TESTNET_RPC");
  const bundlerRpc = required("PERAGO_ALCHEMY_BUNDLER_RPC");
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
    contracts: Record<string, { address: `0x${string}`; codeHash: Hex }>;
  };
  const protocols = JSON.parse(
    readFileSync(PROTOCOL_MANIFEST_PATH, "utf8"),
  ) as {
    contracts: Record<string, { address: `0x${string}` }>;
  };
  const mandateExecutor = getAddress(
    manifest.contracts.mandateExecutor?.address ?? "0x",
  );
  const account = deriveSemiModularAccountAddress({ owner: ROOT_OWNER });
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl, { retryCount: 2, timeout: 60_000 }),
  });
  if ((await client.getChainId()) !== CHAIN_ID) {
    throw new Error("policy probe RPC is not BSC Testnet");
  }

  for (const [name, contract] of Object.entries(manifest.contracts)) {
    const code = await client.getCode({ address: contract.address });
    if (!code || code === "0x" || keccak256(code) !== contract.codeHash) {
      throw new Error(`${name} code does not match the policy probe manifest`);
    }
  }

  const state = loadState(account.toLowerCase() as Address);
  if (transition === "activate" && state.activation) {
    throw new Error("policy probe is already activated; run revoke");
  }
  if (transition === "revoke" && (!state.activation || !state.permission)) {
    throw new Error("policy probe must be activated before revocation");
  }

  const block = await client.getBlock();
  const performSelector = toFunctionSelector(
    getAbiItem({ abi: mandateExecutorAbi, name: "perform" }),
  );
  const permission =
    state.permission ??
    ({
      account: account.toLowerCase() as Address,
      entityId: ENTITY_ID,
      nativeSpendLimit: "0",
      selectors: [performSelector],
      sessionSigner: SESSION_SIGNER.toLowerCase() as Address,
      target: mandateExecutor.toLowerCase() as Address,
      validAfter: block.timestamp.toString(),
      validUntil: (block.timestamp + 7_200n).toString(),
    } satisfies MandateSessionPermissionDocument);
  const policy =
    state.activationPolicy ??
    policyDocument(
      account.toLowerCase() as Address,
      getAddress(
        protocols.contracts.wbnb?.address ?? "0x",
      ).toLowerCase() as Address,
      getAddress(
        protocols.contracts.cake?.address ?? "0x",
      ).toLowerCase() as Address,
    );

  const activePolicyHash = hashWalletPolicy(policy);
  const policyHash =
    transition === "activate"
      ? activePolicyHash
      : hashPolicyRevocation(activePolicyHash);
  const permissionHash =
    transition === "activate"
      ? hashMandateSessionPermission(permission)
      : hashMandateSessionRevocation(permission);
  const validUntil =
    transition === "activate"
      ? (state.activationValidUntil ?? permission.validUntil)
      : (state.revocationValidUntil ?? (block.timestamp + 3_600n).toString());
  const accountPolicy = {
    account: account.toLowerCase() as Address,
    chainId: "97",
    ownerEpoch: "1",
    permissionHash,
    policyHash,
    rootOwner: ROOT_OWNER.toLowerCase() as Address,
    validUntil,
  };
  const typedData = getAccountPolicyTypedData(accountPolicy, {
    chainId: "97",
    verifyingContract: mandateExecutor.toLowerCase() as Address,
  });

  state.permission = permission;
  state.activationPolicy = policy;
  if (transition === "activate") state.activationValidUntil = validUntil;
  else state.revocationValidUntil = validUntil;
  saveState(state);

  const policySignature = process.env.PERAGO_POLICY_ROOT_SIGNATURE as
    | Hex
    | undefined;
  if (!policySignature) {
    console.log(
      printable({
        action: "SIGN_TYPED_DATA",
        transition,
        typedData,
      }),
    );
    return;
  }
  const validPolicySignature = await recoverTypedDataAddress({
    ...typedData,
    signature: policySignature,
  });
  if (validPolicySignature.toLowerCase() !== ROOT_OWNER.toLowerCase()) {
    throw new Error(
      `policy signature recovered ${validPolicySignature}, not configured root owner ${ROOT_OWNER}`,
    );
  }

  const permissionCallData =
    transition === "activate"
      ? encodeInstallMandateSession(toMandateSessionPermission(permission))
      : encodeUninstallMandateSession(toMandateSessionPermission(permission));
  const transitionCallData = encodeAccountPolicyTransition({
    account,
    mandateExecutor,
    permissionCallData,
    policy: accountPolicy,
    rootSignature: policySignature,
  });
  const suppliedUserOperationSignature = process.env
    .PERAGO_POLICY_USER_OPERATION_SIGNATURE as Hex | undefined;
  const waitForUserOperationSignatureFile =
    process.env.PERAGO_POLICY_WAIT_FOR_USER_OPERATION_SIGNATURE === "1";
  if (waitForUserOperationSignatureFile) {
    rmSync(USER_OPERATION_SIGNATURE_PATH, { force: true });
  }
  const manualSigner = {
    address: ROOT_OWNER,
    async signMessage({ message }: { message: { raw: Hex } }) {
      const hash = message.raw;
      const signature =
        suppliedUserOperationSignature ??
        (waitForUserOperationSignatureFile
          ? await waitForUserOperationSignature(hash, transition)
          : undefined);
      if (!signature) {
        console.log(
          printable({ action: "SIGN_USER_OPERATION", hash, transition }),
        );
        throw new ManualSignatureRequired();
      }
      const recovered = await recoverMessageAddress({
        message: { raw: hash },
        signature,
      });
      if (recovered.toLowerCase() !== ROOT_OWNER.toLowerCase()) {
        throw new Error(
          `UserOperation signature recovered ${recovered}, not configured root owner ${ROOT_OWNER}`,
        );
      }
      return signature;
    },
  };
  const userOperationClient = createUserOperationClient({
    account,
    bundlerRpc,
    chainId: CHAIN_ID,
    client,
    owner: ROOT_OWNER,
  });

  let submitted: SubmittedUserOperation;
  try {
    submitted = await userOperationClient.submit({
      callData: transitionCallData,
      entityId: 0,
      isGlobalValidation: true,
      signer: manualSigner as never,
      withFactory:
        transition === "activate" &&
        ((await client.getCode({ address: account })) ?? "0x") === "0x",
    });
  } catch (error) {
    if (error instanceof ManualSignatureRequired) return;
    throw error;
  }

  const config = await client.readContract({
    abi: mandateExecutorAbi,
    address: mandateExecutor,
    args: [account],
    blockNumber: submitted.blockNumber,
    functionName: "accountConfig",
  });
  if (
    config.rootOwner.toLowerCase() !== ROOT_OWNER.toLowerCase() ||
    config.ownerEpoch !== 1n ||
    config.activePolicyHash !== policyHash ||
    config.permissionHash !== permissionHash
  ) {
    throw new Error(
      "confirmed accountConfig does not match the signed transition",
    );
  }

  const evidence = {
    blockNumber: submitted.blockNumber.toString(),
    transactionHash: submitted.transactionHash,
    userOperationHash: submitted.userOpHash,
  } satisfies TransitionEvidence;
  if (transition === "activate") state.activation = evidence;
  else state.revocation = evidence;
  saveState(state);

  if (transition === "revoke") {
    writeEvidence("bsc-testnet.p3-policy-live", {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      label: "testnet",
      chainId: CHAIN_ID,
      rootOwner: ROOT_OWNER,
      smartAccount: account,
      mandateExecutor,
      manifest: "deployments/bsc-testnet.p3-policy-probe.json",
      activation: state.activation,
      revocation: state.revocation,
      accountConfig: {
        rootOwner: config.rootOwner,
        ownerEpoch: config.ownerEpoch.toString(),
        activePolicyHash: config.activePolicyHash,
        permissionHash: config.permissionHash,
      },
      verification: {
        command:
          "PERAGO_POLICY_TRANSITION=activate|revoke pnpm --filter @perago/executor probe:policy-live",
        rootSignatureSource: "user-controlled MetaMask wallet on BSC Testnet",
        transport: "Alchemy ERC-4337 bundler, owner-paid",
        checks: [
          "all probe-deployment runtime bytecode matched the pinned manifest before submission",
          "the bundler returned successful receipts for the recorded UserOperation and transaction hashes",
          "accountConfig at each receipt block matched the signed root owner, owner epoch, policy hash, and permission hash",
          "activation and revocation each used one account batch containing the permission transition and policy transition",
        ],
      },
      scope: {
        proved:
          "one root UserOperation atomically changed the session permission and MandateExecutor policy for activation and revocation",
        notClaimed:
          "production adapters, production executionWindow, mandate execution, or sponsored policy transitions",
      },
    });
    rmSync(STATE_PATH, { force: true });
  } else {
    console.log(printable({ transition, evidence, accountConfig: config }));
  }
}

void main();
