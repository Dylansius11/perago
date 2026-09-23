import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CAKE_POOL_ID,
  cakeStakeAdapterAbi,
  cakeStakePositionAbi,
  encodeStakeAction,
  encodeSwapAction,
  hashStakePostcondition,
  hashSwapPostcondition,
  mandateExecutorAbi,
  pancakeV3SwapAdapterAbi,
  stakeVerifierAbi,
  swapVerifierAbi,
  type TaskMandate,
  taskMandateSchema,
} from "@perago/sdk";
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  type Hash,
  type Hex,
  http,
  keccak256,
  parseAbi,
  parseEther,
  stringToHex,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import { required } from "../lib/environment.ts";
import { writeEvidence } from "../lib/evidence.ts";

/**
 * Live proof of the deployed production adapter/verifier pairs on chain 97. The
 * adapters are permissionless and spend only what their caller grants, so a
 * disposable EOA drives each one directly against the real PancakeSwap router and
 * CAKE Pool; the verifiers then measure the result at the exact post-transaction
 * block. The full MandateExecutor lifecycle through a smart account is P4-003/P5-002.
 */
const CHAIN_ID = 97;
const SWAP_IN = parseEther("0.002");
const SLIPPAGE_BPS = 100n;
const EXECUTE_SELECTOR = toFunctionSelector(
  "execute((address,address,uint64,address,uint256,uint256,uint48,bytes32,bytes32,bytes32,bytes32,address,bytes4,address,uint256,address,uint256,address,bytes32,bytes32,address,uint256),bytes)",
);

type DeployedContract = { address: Address; codeHash: Hash };
type Deployment = {
  chainId: number;
  contracts: Record<string, DeployedContract>;
  constructor: { executionWindowSeconds: string };
};
type Protocols = { contracts: Record<string, { address: Address }> };

const readJson = <T>(path: string): T =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../../${path}`, import.meta.url)),
      "utf8",
    ),
  ) as T;

const deployment = readJson<Deployment>("deployments/bsc-testnet.perago.json");
const protocols = readJson<Protocols>("deployments/bsc-testnet.protocols.json");
function manifestAddress(
  entries: Record<string, { address: Address }>,
  name: string,
): Address {
  const entry = entries[name];
  if (entry === undefined) throw new Error(`manifest has no ${name}`);
  return getAddress(entry.address);
}
const deployed = (name: string) => manifestAddress(deployment.contracts, name);
const protocol = (name: string) => manifestAddress(protocols.contracts, name);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const wbnbAbi = parseAbi(["function deposit() payable"]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const cakePoolAbi = parseAbi([
  "function userInfo(address) view returns (uint256 shares,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256)",
]);

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const signer = privateKeyToAccount(
  required("PERAGO_DISPOSABLE_OWNER_KEY") as Hex,
);
const transport = http(required("PERAGO_BSC_TESTNET_RPC"), { retryCount: 2 });
const client = createPublicClient({ chain: bscTestnet, transport });
const wallet = createWalletClient({
  account: signer,
  chain: bscTestnet,
  transport,
});

async function confirm(label: string, hash: Hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  expect(receipt.status === "success", `${label} reverted in ${hash}`);
  return {
    label,
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}
type Sent = Awaited<ReturnType<typeof confirm>>;

/**
 * Node estimates proved too tight for the CAKE Pool exit (259,168 of 259,465 gas
 * used, reverted out of gas on chain 97), so every probe write carries 30% headroom.
 */
async function send(
  label: string,
  request: Parameters<typeof wallet.writeContract>[0],
): Promise<Sent> {
  const estimate = await client.estimateContractGas({
    ...request,
    account: signer,
  } as Parameters<typeof client.estimateContractGas>[0]);
  return confirm(
    label,
    await wallet.writeContract({ ...request, gas: (estimate * 13n) / 10n }),
  );
}

/** Names the custom error (or string reason) an `eth_call` reverted with, or fails the probe. */
async function revertName(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    if (error instanceof BaseError) {
      const reverted = error.walk(
        (cause) => cause instanceof ContractFunctionRevertedError,
      );
      if (reverted instanceof ContractFunctionRevertedError) {
        const name = reverted.data?.errorName;
        if (name !== undefined && name !== "Error") return name;
        return `Error(${reverted.reason ?? "unnamed"})`;
      }
    }
    throw error;
  }
  throw new Error("expected the call to revert");
}

function probeMandate(
  fields: Partial<TaskMandate>,
  expiresAt: bigint,
): TaskMandate {
  const probeHash = (label: string) =>
    keccak256(stringToHex(`perago.probe.${label}`));
  return taskMandateSchema.parse({
    account: signer.address,
    rootOwner: signer.address,
    ownerEpoch: "1",
    executor: signer.address,
    chainId: String(CHAIN_ID),
    nonce: "1",
    expiresAt: expiresAt.toString(),
    policyHash: probeHash("policy"),
    intentHash: probeHash("intent"),
    planHash: probeHash("plan"),
    simulationHash: probeHash("simulation"),
    adapterSelector: EXECUTE_SELECTOR,
    recipient: signer.address,
    commerceContract: "0x0000000000000000000000000000000000000000",
    commerceJobId: "0",
    ...fields,
  });
}

const onchain = (mandate: TaskMandate) => ({
  ...mandate,
  ownerEpoch: BigInt(mandate.ownerEpoch),
  chainId: BigInt(mandate.chainId),
  nonce: BigInt(mandate.nonce),
  expiresAt: Number(mandate.expiresAt),
  maxInput: BigInt(mandate.maxInput),
  minOutput: BigInt(mandate.minOutput),
  commerceJobId: BigInt(mandate.commerceJobId),
});

async function verifyDeployment() {
  expect((await client.getChainId()) === deployment.chainId, "wrong chain");
  for (const [name, entry] of Object.entries(deployment.contracts)) {
    const code = await client.getCode({ address: entry.address });
    expect(
      code !== undefined && keccak256(code) === entry.codeHash,
      `${name} code hash drifted`,
    );
  }
  const executor = {
    address: deployed("mandateExecutor"),
    abi: mandateExecutorAbi,
  } as const;
  const [swapAdapter, stakeAdapter, window, unbound] = await Promise.all([
    client.readContract({ ...executor, functionName: "swapAdapter" }),
    client.readContract({ ...executor, functionName: "stakeAdapter" }),
    client.readContract({ ...executor, functionName: "executionWindow" }),
    client.readContract({
      ...executor,
      functionName: "allowUnboundCommerceJobs",
    }),
  ]);
  expect(
    swapAdapter === deployed("swapAdapter"),
    "executor pins another swap adapter",
  );
  expect(
    stakeAdapter === deployed("stakeAdapter"),
    "executor pins another stake adapter",
  );
  expect(
    String(window) === deployment.constructor.executionWindowSeconds,
    "executor window differs from the manifest",
  );
  expect(unbound === false, "executor accepts unbound commerce jobs");
}

async function probeSwap() {
  const wbnb = protocol("wbnb");
  const cake = protocol("cake");
  const adapter = deployed("swapAdapter");
  const verifier = deployed("swapVerifier");
  const router = protocol("pancakeV3SwapRouter");
  const transactions: Sent[] = [];

  const wbnbHeld = await client.readContract({
    address: wbnb,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [signer.address],
  });
  if (wbnbHeld < SWAP_IN) {
    transactions.push(
      await confirm(
        "wrap tBNB",
        await wallet.writeContract({
          address: wbnb,
          abi: wbnbAbi,
          functionName: "deposit",
          value: SWAP_IN - wbnbHeld,
        }),
      ),
    );
  }

  const { result: quote } = await client.simulateContract({
    address: protocol("pancakeV3QuoterV2"),
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: wbnb,
        tokenOut: cake,
        amountIn: SWAP_IN,
        fee: 500,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const minOut = (quote[0] * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const head = await client.getBlock({ blockTag: "latest" });
  const expiresAt = head.timestamp + 600n;

  const action = encodeSwapAction({
    tokenIn: wbnb,
    tokenOut: cake,
    poolFee: "500",
    amountIn: SWAP_IN.toString(),
    minAmountOut: minOut.toString(),
    recipient: signer.address,
    deadline: expiresAt.toString(),
  });
  const mandate = probeMandate(
    {
      adapter,
      inputToken: wbnb,
      maxInput: SWAP_IN.toString(),
      outputToken: cake,
      minOutput: minOut.toString(),
      actionHash: keccak256(action),
      postconditionHash: hashSwapPostcondition(
        signer.address,
        cake,
        minOut.toString(),
      ),
    },
    expiresAt,
  );

  // The deployed adapter reads the SDK's bytes as the same commitment.
  const validated = await client.readContract({
    address: adapter,
    abi: pancakeV3SwapAdapterAbi,
    functionName: "validate",
    args: [onchain(mandate), action],
  });
  expect(
    validated === mandate.actionHash,
    "deployed adapter disagrees with the SDK action hash",
  );

  const rejections = {
    wrongRecipient: await revertName(() =>
      client.readContract({
        address: adapter,
        abi: pancakeV3SwapAdapterAbi,
        functionName: "validate",
        args: [
          onchain({ ...mandate, recipient: deployed("mandateExecutor") }),
          action,
        ],
      }),
    ),
    unreachableMinimum: "",
  };

  transactions.push(
    await send("approve exact swap input", {
      address: wbnb,
      abi: erc20Abi,
      functionName: "approve",
      args: [adapter, SWAP_IN],
    }),
  );
  const unreachable = encodeSwapAction({
    tokenIn: wbnb,
    tokenOut: cake,
    poolFee: "500",
    amountIn: SWAP_IN.toString(),
    minAmountOut: (quote[0] * 2n).toString(),
    recipient: signer.address,
    deadline: expiresAt.toString(),
  });
  rejections.unreachableMinimum = await revertName(() =>
    client.simulateContract({
      account: signer,
      address: adapter,
      abi: pancakeV3SwapAdapterAbi,
      functionName: "execute",
      args: [
        onchain({
          ...mandate,
          minOutput: (quote[0] * 2n).toString(),
          actionHash: keccak256(unreachable),
        }),
        unreachable,
      ],
    }),
  );

  const [before, context] = await client.readContract({
    address: verifier,
    abi: swapVerifierAbi,
    functionName: "measure",
    args: [onchain(mandate), action],
  });
  const swap = await send("swap through deployed adapter", {
    address: adapter,
    abi: pancakeV3SwapAdapterAbi,
    functionName: "execute",
    args: [onchain(mandate), action],
  });
  transactions.push(swap);

  const after = await client.readContract({
    address: cake,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [signer.address],
    blockNumber: swap.blockNumber,
  });
  const received = after - before;
  const pool = await client.readContract({
    address: adapter,
    abi: pancakeV3SwapAdapterAbi,
    functionName: "pool",
  });
  const protocolEvidenceHash = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [pool, SWAP_IN, received],
    ),
  );
  const evidence = await client.readContract({
    address: verifier,
    abi: swapVerifierAbi,
    functionName: "verify",
    blockNumber: swap.blockNumber,
    args: [
      onchain(mandate),
      action,
      before,
      context,
      {
        inputSpent: SWAP_IN,
        outputOrPositionReceived: received,
        protocolEvidenceHash,
      },
    ],
  });
  expect(received >= minOut, "swap output is below the signed minimum");
  expect(
    evidence.observedOutputOrPositionDelta === received,
    "verifier measured a different output",
  );
  const leftovers = await Promise.all([
    client.readContract({
      address: wbnb,
      abi: erc20Abi,
      functionName: "allowance",
      args: [adapter, router],
      blockNumber: swap.blockNumber,
    }),
    client.readContract({
      address: wbnb,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [adapter],
      blockNumber: swap.blockNumber,
    }),
    client.readContract({
      address: cake,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [adapter],
      blockNumber: swap.blockNumber,
    }),
    client.readContract({
      address: wbnb,
      abi: erc20Abi,
      functionName: "allowance",
      args: [signer.address, adapter],
      blockNumber: swap.blockNumber,
    }),
  ]);
  expect(
    leftovers.every((value) => value === 0n),
    "the swap left an allowance or balance behind",
  );

  return {
    pool,
    quote: quote[0],
    minOut,
    received,
    actionHash: mandate.actionHash,
    postconditionHash: mandate.postconditionHash,
    verifierEvidenceHash: evidence.evidenceHash,
    rejections,
    leftoversAllZero: true,
    transactions,
  };
}

async function probeStake(amount: bigint) {
  const cake = protocol("cake");
  const cakePool = protocol("cakePool");
  const adapter = deployed("stakeAdapter");
  const verifier = deployed("stakeVerifier");
  const transactions: Sent[] = [];
  const holder = await client.readContract({
    address: adapter,
    abi: cakeStakeAdapterAbi,
    functionName: "positionOf",
    args: [signer.address],
  });
  const head = await client.getBlock({ blockTag: "latest" });
  const expiresAt = head.timestamp + 600n;

  const build = (minShares: bigint) => {
    const action = encodeStakeAction({
      asset: cake,
      amount: amount.toString(),
      minPositionOut: minShares.toString(),
      recipient: signer.address,
      deadline: expiresAt.toString(),
      poolId: CAKE_POOL_ID,
    });
    const mandate = probeMandate(
      {
        adapter,
        inputToken: cake,
        maxInput: amount.toString(),
        outputToken: cake,
        minOutput: minShares.toString(),
        actionHash: keccak256(action),
        postconditionHash: hashStakePostcondition(
          signer.address,
          CAKE_POOL_ID,
          minShares.toString(),
        ),
      },
      expiresAt,
    );
    return { action, mandate };
  };

  transactions.push(
    await send("approve exact stake input", {
      address: cake,
      abi: erc20Abi,
      functionName: "approve",
      args: [adapter, amount],
    }),
  );
  // The share count this block would mint, read by simulating the exact call.
  const preview = build(1n);
  const { result: simulated } = await client.simulateContract({
    account: signer,
    address: adapter,
    abi: cakeStakeAdapterAbi,
    functionName: "execute",
    args: [onchain(preview.mandate), preview.action],
  });
  const minShares =
    (simulated.outputOrPositionReceived * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const { action, mandate } = build(minShares);

  const validated = await client.readContract({
    address: adapter,
    abi: cakeStakeAdapterAbi,
    functionName: "validate",
    args: [onchain(mandate), action],
  });
  expect(
    validated === mandate.actionHash,
    "deployed adapter disagrees with the SDK stake action hash",
  );
  const unreachable = build(simulated.outputOrPositionReceived * 2n);
  const rejections = {
    unreachableMinimum: await revertName(() =>
      client.simulateContract({
        account: signer,
        address: adapter,
        abi: cakeStakeAdapterAbi,
        functionName: "execute",
        args: [onchain(unreachable.mandate), unreachable.action],
      }),
    ),
    foreignPostcondition: await revertName(() =>
      client.readContract({
        address: verifier,
        abi: stakeVerifierAbi,
        functionName: "measure",
        args: [
          onchain({
            ...mandate,
            postconditionHash: keccak256(stringToHex("foreign")),
          }),
          action,
        ],
      }),
    ),
  };

  const [before, context] = await client.readContract({
    address: verifier,
    abi: stakeVerifierAbi,
    functionName: "measure",
    args: [onchain(mandate), action],
  });
  const stake = await send("stake through deployed adapter", {
    address: adapter,
    abi: cakeStakeAdapterAbi,
    functionName: "execute",
    args: [onchain(mandate), action],
  });
  transactions.push(stake);

  const [shares] = await client.readContract({
    address: cakePool,
    abi: cakePoolAbi,
    functionName: "userInfo",
    args: [holder],
    blockNumber: stake.blockNumber,
  });
  const minted = shares - before;
  const protocolEvidenceHash = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [cakePool, holder, amount, minted],
    ),
  );
  const evidence = await client.readContract({
    address: verifier,
    abi: stakeVerifierAbi,
    functionName: "verify",
    blockNumber: stake.blockNumber,
    args: [
      onchain(mandate),
      action,
      before,
      context,
      {
        inputSpent: amount,
        outputOrPositionReceived: minted,
        protocolEvidenceHash,
      },
    ],
  });
  const owner = await client.readContract({
    address: holder,
    abi: cakeStakePositionAbi,
    functionName: "owner",
  });
  expect(owner === signer.address, "the holder belongs to someone else");
  expect(
    minted >= minShares && evidence.observedOutputOrPositionDelta === minted,
    "verifier measured a different position",
  );

  const attackerExit = await revertName(() =>
    client.simulateContract({
      account: deployed("mandateExecutor"),
      address: holder,
      abi: cakeStakePositionAbi,
      functionName: "withdrawAll",
    }),
  );
  const cakeBefore = await client.readContract({
    address: cake,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [signer.address],
  });
  const exit = await send("owner withdraws the whole position", {
    address: holder,
    abi: cakeStakePositionAbi,
    functionName: "withdrawAll",
  });
  transactions.push(exit);
  const [sharesAfterExit] = await client.readContract({
    address: cakePool,
    abi: cakePoolAbi,
    functionName: "userInfo",
    args: [holder],
    blockNumber: exit.blockNumber,
  });
  const returned =
    (await client.readContract({
      address: cake,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [signer.address],
      blockNumber: exit.blockNumber,
    })) - cakeBefore;
  expect(
    sharesAfterExit === 0n && returned > 0n,
    "the owner could not leave the position",
  );

  return {
    holder,
    amount,
    minShares,
    minted,
    actionHash: mandate.actionHash,
    postconditionHash: mandate.postconditionHash,
    verifierEvidenceHash: evidence.evidenceHash,
    rejections: { ...rejections, nonOwnerWithdraw: attackerExit },
    exit: { returned, sharesAfterExit },
    transactions,
  };
}

async function main() {
  await verifyDeployment();
  const swap = await probeSwap();
  const stake = await probeStake(swap.received);
  const path = writeEvidence("bsc-testnet.adapters-live", {
    schemaVersion: 1,
    label: "testnet",
    chainId: CHAIN_ID,
    observedAt: new Date().toISOString(),
    command: "pnpm --filter @perago/executor probe:adapters-live",
    deploymentManifest: "deployments/bsc-testnet.perago.json",
    caller: signer.address,
    scope:
      "The deployed adapters driven directly by a disposable EOA against the real PancakeSwap router and CAKE Pool, with each paired verifier measuring at the post-transaction block. Mandate fields not read by an adapter or verifier are labelled probe values; no mandate was authorized and MandateExecutor was not called.",
    deploymentVerified: true,
    swap,
    stake,
  });
  console.log(`evidence written to ${path}`);
}

await main();
