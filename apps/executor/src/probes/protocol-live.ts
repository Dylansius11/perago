import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type AccountCall,
  deriveSemiModularAccountAddress,
  encodeAccountExecute,
  encodeAccountExecuteBatch,
} from "@perago/sdk";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  parseEther,
  stringToHex,
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

/** Native amount swapped for the stake asset; testnet pricing is not meaningful. */
const CAKE_SWAP_IN = parseEther("0.0008");
/** Native amount swapped for the ERC-8183 payment token. */
const PAYMENT_SWAP_IN = parseEther("0.001");
/** Escrowed per probe job; three jobs exercise complete, reject, and expiry. */
const JOB_BUDGET = parseEther("0.4");
/** Gas float the provider needs for its single `submit` transaction. */
const PROVIDER_GAS = parseEther("0.0006");
/** Slippage floor applied to a fresh quote, in basis points. */
const SLIPPAGE_BP = 300n;
const BP_DENOMINATOR = 10_000n;
const SWAP_DEADLINE_SECONDS = 600n;
const LONG_JOB_SECONDS = 3_600;
/**
 * The kernel rejects `expiredAt <= block.timestamp + 5 minutes` with
 * `ExpiryTooShort()`, so the expiry path must outlive that floor.
 */
const EXPIRING_JOB_SECONDS = 360;
const EXPIRY_POLL_INTERVAL_MS = 10_000;

const JOB_STATUS = {
  Completed: 3,
  Expired: 5,
  Funded: 1,
  Open: 0,
  Rejected: 4,
  Submitted: 2,
} as const;

type ManifestContract = { address: Address; codeHash: Hex };
type ProtocolManifest = { contracts: Record<string, ManifestContract> };

type JobFact = {
  budgetWei: string;
  jobId: string;
  operations: Record<string, SubmittedUserOperation | { transactionHash: Hex }>;
  outcome: string;
  statusPath: number[];
};

const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const swapRouterAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);
const quoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const v2RouterAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])",
]);
const cakePoolAbi = parseAbi([
  "function deposit(uint256 amount, uint256 lockDuration)",
  "function withdrawAll()",
  "function userInfo(address user) view returns (uint256 shares, uint256 lastDepositedTime, uint256 cakeAtLastUserAction, uint256 lastUserActionTime, uint256 lockStartTime, uint256 lockEndTime, uint256 userBoostedShare, bool locked, uint256 lockedAmount)",
  "function MIN_DEPOSIT_AMOUNT() view returns (uint256)",
]);
const kernelAbi = parseAbi([
  "struct Job { uint256 id; address client; address provider; address evaluator; string description; uint256 budget; uint256 expiredAt; uint8 status; address hook; uint256 submittedAt; bytes32 deliverable; }",
  "function claimRefund(uint256 jobId)",
  "function complete(uint256 jobId, bytes32 reason, bytes optParams)",
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)",
  "function getJob(uint256 jobId) view returns (Job)",
  "function jobCounter() view returns (uint256)",
  "function reject(uint256 jobId, bytes32 reason, bytes optParams)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
]);

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function withSlippage(amount: bigint): bigint {
  return (amount * (BP_DENOMINATOR - SLIPPAGE_BP)) / BP_DENOMINATOR;
}

async function main() {
  const owner = privateKeyToAccount(
    required("PERAGO_DISPOSABLE_OWNER_KEY") as Hex,
  );
  const account = deriveSemiModularAccountAddress({ owner: owner.address });
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(required("PERAGO_BSC_TESTNET_RPC"), {
      retryCount: 2,
      timeout: 60_000,
    }),
  });
  const providerWallet = createWalletClient({
    account: owner,
    chain: bscTestnet,
    transport: http(required("PERAGO_BSC_TESTNET_RPC"), { timeout: 60_000 }),
  });

  const chainId = await client.getChainId();
  expect(chainId === BSC_TESTNET_CHAIN_ID, `expected chain 97, got ${chainId}`);

  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../../deployments/bsc-testnet.protocols.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as ProtocolManifest;
  for (const [name, entry] of Object.entries(manifest.contracts)) {
    const code = await client.getCode({ address: entry.address });
    expect(
      code !== undefined && keccak256(code) === entry.codeHash,
      `${name} code hash drifted from deployments/bsc-testnet.protocols.json`,
    );
  }
  const at = (name: string): Address => {
    const entry = manifest.contracts[name];
    expect(entry !== undefined, `manifest has no entry for ${name}`);
    return (entry as ManifestContract).address;
  };

  const userOperations = createUserOperationClient({
    account,
    bundlerRpc: required("PERAGO_ALCHEMY_BUNDLER_RPC"),
    chainId,
    client: client as PublicClient,
    owner: owner.address,
    policyId: required("PERAGO_ALCHEMY_GAS_MANAGER_POLICY_ID"),
  });

  const sponsorshipFallbacks: string[] = [];

  /** Root-owner submission; sponsorship is preferred and never load-bearing. */
  async function run(
    label: string,
    calls: readonly AccountCall[],
  ): Promise<SubmittedUserOperation> {
    const callData =
      calls.length === 1
        ? encodeAccountExecute(calls[0] as AccountCall)
        : encodeAccountExecuteBatch(calls);
    const params = {
      callData,
      entityId: 0,
      isGlobalValidation: true,
      signer: owner,
    } as const;
    try {
      return await userOperations.submit({ ...params, sponsored: true });
    } catch (error) {
      sponsorshipFallbacks.push(`${label}: ${short(String(error))}`);
      return await userOperations.submit(params);
    }
  }

  const call = (target: Address, data: Hex, value = 0n): AccountCall => ({
    data,
    target,
    value,
  });

  const balanceOf = (token: Address, holder: Address): Promise<bigint> =>
    client.readContract({
      abi: erc20Abi,
      address: token,
      args: [holder],
      functionName: "balanceOf",
    });

  const startBalance = await client.getBalance({ address: account });
  expect(
    startBalance > CAKE_SWAP_IN + PAYMENT_SWAP_IN + PROVIDER_GAS,
    `account ${account} holds ${formatEther(startBalance)} tBNB, which cannot fund this probe`,
  );

  // 1. Swap native gas into the stake asset through the pinned V3 router.
  const deadline = BigInt(
    Number((await client.getBlock()).timestamp) + Number(SWAP_DEADLINE_SECONDS),
  );
  const quote = await client.simulateContract({
    abi: quoterAbi,
    address: at("pancakeV3QuoterV2"),
    args: [
      {
        amountIn: CAKE_SWAP_IN,
        fee: 500,
        sqrtPriceLimitX96: 0n,
        tokenIn: at("wbnb"),
        tokenOut: at("cake"),
      },
    ],
    functionName: "quoteExactInputSingle",
  });
  const minCakeOut = withSlippage(quote.result[0]);
  const cakeBeforeSwap = await balanceOf(at("cake"), account);
  const swap = await run("v3 swap", [
    call(
      at("pancakeV3SwapRouter"),
      encodeFunctionData({
        abi: swapRouterAbi,
        args: [
          {
            amountIn: CAKE_SWAP_IN,
            amountOutMinimum: minCakeOut,
            deadline,
            fee: 500,
            recipient: account,
            sqrtPriceLimitX96: 0n,
            tokenIn: at("wbnb"),
            tokenOut: at("cake"),
          },
        ],
        functionName: "exactInputSingle",
      }),
      CAKE_SWAP_IN,
    ),
  ]);
  const cakeAfterSwap = await balanceOf(at("cake"), account);
  const cakeReceived = cakeAfterSwap - cakeBeforeSwap;
  expect(
    cakeReceived >= minCakeOut,
    "the V3 swap returned less than the quoted minimum",
  );

  // 2. Stake the swapped asset, then unstake it, through the pinned CAKE Pool.
  const minDeposit = await client.readContract({
    abi: cakePoolAbi,
    address: at("cakePool"),
    functionName: "MIN_DEPOSIT_AMOUNT",
  });
  expect(
    cakeReceived > minDeposit,
    "the swap output is below the CAKE Pool minimum deposit",
  );
  const stake = await run("cake pool deposit", [
    call(
      at("cake"),
      encodeFunctionData({
        abi: erc20Abi,
        args: [at("cakePool"), cakeReceived],
        functionName: "approve",
      }),
    ),
    call(
      at("cakePool"),
      encodeFunctionData({
        abi: cakePoolAbi,
        args: [cakeReceived, 0n],
        functionName: "deposit",
      }),
    ),
  ]);
  const position = await client.readContract({
    abi: cakePoolAbi,
    address: at("cakePool"),
    args: [account],
    functionName: "userInfo",
  });
  expect(position[0] > 0n, "the CAKE Pool recorded no shares for the account");
  const cakeWhileStaked = await balanceOf(at("cake"), account);
  expect(
    cakeAfterSwap - cakeWhileStaked === cakeReceived,
    "the deposit did not move exactly the staked amount",
  );
  const residualAllowance = await client.readContract({
    abi: erc20Abi,
    address: at("cake"),
    args: [account, at("cakePool")],
    functionName: "allowance",
  });
  expect(
    residualAllowance === 0n,
    "the stake left a standing allowance on the CAKE Pool",
  );

  const unstake = await run("cake pool withdrawAll", [
    call(
      at("cakePool"),
      encodeFunctionData({ abi: cakePoolAbi, functionName: "withdrawAll" }),
    ),
  ]);
  const cakeReturned = (await balanceOf(at("cake"), account)) - cakeWhileStaked;
  const positionAfter = await client.readContract({
    abi: cakePoolAbi,
    address: at("cakePool"),
    args: [account],
    functionName: "userInfo",
  });
  expect(positionAfter[0] === 0n, "the CAKE Pool position did not close");
  // Withdrawing inside the fee window returns the stake minus the documented
  // 0.1% early-withdrawal fee, so a full return would mean the fee vanished.
  expect(
    cakeReturned > 0n && cakeReturned < cakeReceived,
    "unstaking did not return the staked asset minus the documented fee",
  );

  // 3. Fund the ERC-8183 payment token through the only route that has liquidity.
  const paymentQuote = await client.readContract({
    abi: v2RouterAbi,
    address: at("pancakeV2Router"),
    args: [PAYMENT_SWAP_IN, [at("wbnb"), at("apexPaymentToken")]],
    functionName: "getAmountsOut",
  });
  const paymentSwap = await run("v2 payment-token swap", [
    call(
      at("pancakeV2Router"),
      encodeFunctionData({
        abi: v2RouterAbi,
        args: [
          withSlippage(paymentQuote[1] as bigint),
          [at("wbnb"), at("apexPaymentToken")],
          account,
          deadline,
        ],
        functionName: "swapExactETHForTokens",
      }),
      PAYMENT_SWAP_IN,
    ),
  ]);
  const paymentBalance = await balanceOf(at("apexPaymentToken"), account);
  expect(
    paymentBalance >= JOB_BUDGET * 3n,
    `payment-token balance ${formatEther(paymentBalance)} cannot fund three jobs`,
  );

  // 4. Give the provider exactly the gas it needs for one `submit`.
  const providerGasTransfer = await run("provider gas float", [
    call(owner.address, "0x", PROVIDER_GAS),
  ]);

  const kernel = at("apexKernel");
  const paymentToken = at("apexPaymentToken");

  async function createJob(params: {
    description: string;
    expiredAt: number;
    label: string;
  }): Promise<{ jobId: bigint; operation: SubmittedUserOperation }> {
    const before = await client.readContract({
      abi: kernelAbi,
      address: kernel,
      functionName: "jobCounter",
    });
    const operation = await run(params.label, [
      call(
        kernel,
        encodeFunctionData({
          abi: kernelAbi,
          args: [
            owner.address,
            account,
            BigInt(params.expiredAt),
            params.description,
            // The deployed kernel rejects `hook == address(0)`; Perago supplies
            // an inert hook so no third party can gate its job lifecycle.
            at("peragoAcpHook"),
          ],
          functionName: "createJob",
        }),
      ),
    ]);
    const after = await client.readContract({
      abi: kernelAbi,
      address: kernel,
      functionName: "jobCounter",
    });
    // Other clients share this kernel, so the job is identified by its content.
    for (let candidate = after; candidate > before; candidate -= 1n) {
      const job = await client.readContract({
        abi: kernelAbi,
        address: kernel,
        args: [candidate],
        functionName: "getJob",
      });
      if (
        getAddress(job.client) === getAddress(account) &&
        job.description === params.description
      ) {
        return { jobId: candidate, operation };
      }
    }
    throw new Error(`created job ${params.description} was not found`);
  }

  async function fundJob(
    jobId: bigint,
    label: string,
  ): Promise<SubmittedUserOperation> {
    const operation = await run(label, [
      call(
        paymentToken,
        encodeFunctionData({
          abi: erc20Abi,
          args: [kernel, JOB_BUDGET],
          functionName: "approve",
        }),
      ),
      call(
        kernel,
        encodeFunctionData({
          abi: kernelAbi,
          args: [jobId, JOB_BUDGET, "0x"],
          functionName: "setBudget",
        }),
      ),
      call(
        kernel,
        encodeFunctionData({
          abi: kernelAbi,
          args: [jobId, JOB_BUDGET, "0x"],
          functionName: "fund",
        }),
      ),
    ]);
    const leftover = await client.readContract({
      abi: erc20Abi,
      address: paymentToken,
      args: [account, kernel],
      functionName: "allowance",
    });
    expect(leftover === 0n, "funding left a standing allowance on the kernel");
    return operation;
  }

  const status = async (jobId: bigint): Promise<number> =>
    (
      await client.readContract({
        abi: kernelAbi,
        address: kernel,
        args: [jobId],
        functionName: "getJob",
      })
    ).status;

  const now = Number((await client.getBlock()).timestamp);
  const marker = keccak256(stringToHex(`perago-probe-${now}`)).slice(0, 10);
  const jobs: Record<string, JobFact> = {};

  // 5. Completion path: the evaluator releases escrow to the provider.
  const completion = await createJob({
    description: `Perago probe complete ${marker}`,
    expiredAt: now + LONG_JOB_SECONDS,
    label: "createJob (complete path)",
  });
  const completionStatuses = [await status(completion.jobId)];
  const completionFunding = await fundJob(
    completion.jobId,
    "fund (complete path)",
  );
  completionStatuses.push(await status(completion.jobId));

  const providerBefore = await balanceOf(paymentToken, owner.address);
  const submitHash = await providerWallet.writeContract({
    abi: kernelAbi,
    address: kernel,
    args: [
      completion.jobId,
      keccak256(stringToHex(`deliverable ${marker}`)),
      "0x",
    ],
    functionName: "submit",
  });
  await client.waitForTransactionReceipt({ hash: submitHash });
  completionStatuses.push(await status(completion.jobId));
  expect(
    completionStatuses[2] === JOB_STATUS.Submitted,
    "the provider submission did not move the job to Submitted",
  );

  const completeOperation = await run("complete", [
    call(
      kernel,
      encodeFunctionData({
        abi: kernelAbi,
        args: [
          completion.jobId,
          keccak256(stringToHex(`perago receipt ${marker}`)),
          "0x",
        ],
        functionName: "complete",
      }),
    ),
  ]);
  completionStatuses.push(await status(completion.jobId));
  const providerAfter = await balanceOf(paymentToken, owner.address);
  expect(
    completionStatuses[3] === JOB_STATUS.Completed &&
      providerAfter - providerBefore === JOB_BUDGET,
    "completion did not release the exact escrow to the provider",
  );
  jobs.completed = {
    budgetWei: JOB_BUDGET.toString(),
    jobId: completion.jobId.toString(),
    operations: {
      complete: completeOperation,
      create: completion.operation,
      fund: completionFunding,
      submit: { transactionHash: submitHash },
    },
    outcome: `escrow released to provider ${owner.address}`,
    statusPath: completionStatuses,
  };

  // 6. Rejection path: the evaluator refunds a funded job before submission.
  const rejection = await createJob({
    description: `Perago probe reject ${marker}`,
    expiredAt: now + LONG_JOB_SECONDS,
    label: "createJob (reject path)",
  });
  const rejectionFunding = await fundJob(rejection.jobId, "fund (reject path)");
  const clientBeforeReject = await balanceOf(paymentToken, account);
  const rejectOperation = await run("reject", [
    call(
      kernel,
      encodeFunctionData({
        abi: kernelAbi,
        args: [
          rejection.jobId,
          keccak256(stringToHex(`perago rejection ${marker}`)),
          "0x",
        ],
        functionName: "reject",
      }),
    ),
  ]);
  const clientAfterReject = await balanceOf(paymentToken, account);
  const rejectionStatus = await status(rejection.jobId);
  expect(
    rejectionStatus === JOB_STATUS.Rejected &&
      clientAfterReject - clientBeforeReject === JOB_BUDGET,
    "rejection did not refund the exact escrow to the client",
  );
  jobs.rejected = {
    budgetWei: JOB_BUDGET.toString(),
    jobId: rejection.jobId.toString(),
    operations: {
      create: rejection.operation,
      fund: rejectionFunding,
      reject: rejectOperation,
    },
    outcome: "escrow refunded to the client before submission",
    statusPath: [JOB_STATUS.Funded, rejectionStatus],
  };

  // 7. Expiry path: the permissionless refund must survive an idle provider.
  const expiring = await createJob({
    description: `Perago probe expiry ${marker}`,
    expiredAt: now + EXPIRING_JOB_SECONDS,
    label: "createJob (expiry path)",
  });
  const expiringFunding = await fundJob(expiring.jobId, "fund (expiry path)");
  const clientBeforeRefund = await balanceOf(paymentToken, account);
  let chainTime = Number((await client.getBlock()).timestamp);
  while (chainTime < now + EXPIRING_JOB_SECONDS) {
    await delay(EXPIRY_POLL_INTERVAL_MS);
    chainTime = Number((await client.getBlock()).timestamp);
  }
  const refundOperation = await run("claimRefund", [
    call(
      kernel,
      encodeFunctionData({
        abi: kernelAbi,
        args: [expiring.jobId],
        functionName: "claimRefund",
      }),
    ),
  ]);
  const clientAfterRefund = await balanceOf(paymentToken, account);
  const expiryStatus = await status(expiring.jobId);
  expect(
    expiryStatus === JOB_STATUS.Expired &&
      clientAfterRefund - clientBeforeRefund === JOB_BUDGET,
    "the expiry refund did not return the exact escrow to the client",
  );
  jobs.expired = {
    budgetWei: JOB_BUDGET.toString(),
    jobId: expiring.jobId.toString(),
    operations: {
      claimRefund: refundOperation,
      create: expiring.operation,
      fund: expiringFunding,
    },
    outcome:
      "escrow refunded after expiry without provider or evaluator action",
    statusPath: [JOB_STATUS.Funded, expiryStatus],
  };

  writeEvidence("bsc-testnet.protocol-live", {
    account,
    chainId,
    gas: {
      endBalance: formatEther(await client.getBalance({ address: account })),
      startBalance: formatEther(startBalance),
    },
    jobs,
    provider: owner.address,
    sponsorshipFallbacks,
    stake: {
      cakeReturnedWei: cakeReturned.toString(),
      cakeStakedWei: cakeReceived.toString(),
      deposit: stake,
      sharesWhileStaked: position[0].toString(),
      withdraw: unstake,
    },
    swap: {
      amountInWei: CAKE_SWAP_IN.toString(),
      amountOutWei: cakeReceived.toString(),
      minimumOutWei: minCakeOut.toString(),
      operation: swap,
      quotedOutWei: quote.result[0].toString(),
    },
    paymentTokenFunding: {
      amountInWei: PAYMENT_SWAP_IN.toString(),
      balanceWei: paymentBalance.toString(),
      operation: paymentSwap,
      providerGasFloat: providerGasTransfer,
    },
    ranAt: new Date().toISOString(),
  });
}

void main();
