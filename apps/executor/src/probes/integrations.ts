import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type Address,
  createPublicClient,
  getAddress,
  type Hex,
  http,
  keccak256,
  parseAbi,
  parseEther,
  zeroAddress,
} from "viem";
import { bscTestnet } from "viem/chains";

import { required } from "../lib/environment.ts";

const BSC_TESTNET_CHAIN_ID = 97;
const FEE_TIERS = [100, 500, 2_500, 10_000] as const;
/** Reference size used only to quote the pinned pools, never executed here. */
const QUOTE_AMOUNT_IN = parseEther("0.0015");

type ManifestContract = {
  address: Address;
  codeHash: Hex;
  erc1967Implementation?: Address;
  implementationCodeHash?: Hex;
  role: string;
};

type ProtocolManifest = {
  chainId: number;
  contracts: Record<string, ManifestContract>;
  tokens: Record<string, { decimals: number; name: string; symbol: string }>;
};

type PoolFact = {
  address: Address;
  fee: number;
  liquidity: string;
  sqrtPriceX96: string;
  token0: Address;
  token1: Address;
};

const routerAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
]);
const v2RouterAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
]);
const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);
const v2FactoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address)",
]);
const poolAbi = parseAbi([
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const quoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const cakePoolAbi = parseAbi([
  "function token() view returns (address)",
  "function masterchefV2() view returns (address)",
  "function MIN_DEPOSIT_AMOUNT() view returns (uint256)",
  "function withdrawFee() view returns (uint256)",
  "function withdrawFeePeriod() view returns (uint256)",
  "function performanceFee() view returns (uint256)",
  "function getPricePerFullShare() view returns (uint256)",
]);
const kernelAbi = parseAbi([
  "function paymentToken() view returns (address)",
  "function isPaymentTokenSupported(address token) view returns (bool)",
  "function jobCounter() view returns (uint256)",
  "function platformFeeBP() view returns (uint256)",
  "function platformTreasury() view returns (address)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function MAX_EXPIRY_DURATION() view returns (uint256)",
]);

function loadManifest(): ProtocolManifest {
  return JSON.parse(
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
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const manifest = loadManifest();
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(required("PERAGO_BSC_TESTNET_RPC"), {
      retryCount: 2,
      timeout: 60_000,
    }),
  });

  const chainId = await client.getChainId();
  expect(
    chainId === BSC_TESTNET_CHAIN_ID && manifest.chainId === chainId,
    `expected chain ${BSC_TESTNET_CHAIN_ID}, received ${chainId}`,
  );

  const at = { blockNumber: await client.getBlockNumber() };
  const address = (name: string): Address => {
    const entry = manifest.contracts[name];
    expect(entry !== undefined, `manifest has no entry for ${name}`);
    return (entry as ManifestContract).address;
  };

  // 1. Every pinned address still holds exactly the reviewed code.
  for (const [name, entry] of Object.entries(manifest.contracts)) {
    const code = await client.getCode({ address: entry.address, ...at });
    expect(code !== undefined && code !== "0x", `${name} has no code`);
    expect(
      keccak256(code as Hex) === entry.codeHash,
      `${name} code hash drifted from the manifest`,
    );
    if (entry.erc1967Implementation) {
      const implementation = await client.getStorageAt({
        address: entry.address,
        slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
        ...at,
      });
      expect(
        getAddress(`0x${(implementation as Hex).slice(26)}`) ===
          getAddress(entry.erc1967Implementation),
        `${name} was upgraded away from the reviewed implementation`,
      );
      const implementationCode = await client.getCode({
        address: entry.erc1967Implementation,
        ...at,
      });
      expect(
        keccak256(implementationCode as Hex) === entry.implementationCodeHash,
        `${name} implementation code hash drifted from the manifest`,
      );
    }
  }

  // 2. Router, quoter, and factory agree with each other and with the manifest.
  const [routerFactory, routerWeth9, quoterFactory, quoterWeth9] =
    await Promise.all([
      client.readContract({
        abi: routerAbi,
        address: address("pancakeV3SwapRouter"),
        functionName: "factory",
        ...at,
      }),
      client.readContract({
        abi: routerAbi,
        address: address("pancakeV3SwapRouter"),
        functionName: "WETH9",
        ...at,
      }),
      client.readContract({
        abi: routerAbi,
        address: address("pancakeV3QuoterV2"),
        functionName: "factory",
        ...at,
      }),
      client.readContract({
        abi: routerAbi,
        address: address("pancakeV3QuoterV2"),
        functionName: "WETH9",
        ...at,
      }),
    ]);
  expect(
    getAddress(routerFactory) === getAddress(address("pancakeV3Factory")),
    "the V3 router points at a different factory than the manifest",
  );
  expect(
    getAddress(quoterFactory) === getAddress(address("pancakeV3Factory")),
    "the V3 quoter points at a different factory than the manifest",
  );
  expect(
    getAddress(routerWeth9) === getAddress(address("wbnb")) &&
      getAddress(quoterWeth9) === getAddress(address("wbnb")),
    "the pinned WBNB is not the wrapper the V3 periphery uses",
  );

  // 3. At least one direct CAKE/WBNB pool must carry real liquidity.
  const pools: PoolFact[] = [];
  for (const fee of FEE_TIERS) {
    const pool = await client.readContract({
      abi: factoryAbi,
      address: address("pancakeV3Factory"),
      args: [address("cake"), address("wbnb"), fee],
      functionName: "getPool",
      ...at,
    });
    if (pool === zeroAddress) {
      continue;
    }
    const [liquidity, slot0, token0, token1] = await Promise.all([
      client.readContract({
        abi: poolAbi,
        address: pool,
        functionName: "liquidity",
        ...at,
      }),
      client.readContract({
        abi: poolAbi,
        address: pool,
        functionName: "slot0",
        ...at,
      }),
      client.readContract({
        abi: poolAbi,
        address: pool,
        functionName: "token0",
        ...at,
      }),
      client.readContract({
        abi: poolAbi,
        address: pool,
        functionName: "token1",
        ...at,
      }),
    ]);
    pools.push({
      address: pool,
      fee,
      liquidity: liquidity.toString(),
      sqrtPriceX96: slot0[0].toString(),
      token0,
      token1,
    });
  }
  const deepest = pools.reduce<PoolFact | undefined>(
    (best, pool) =>
      best === undefined || BigInt(pool.liquidity) > BigInt(best.liquidity)
        ? pool
        : best,
    undefined,
  );
  expect(
    deepest !== undefined && BigInt(deepest.liquidity) > 0n,
    "no direct CAKE/WBNB pool holds liquidity",
  );
  const liquidPool = deepest as PoolFact;

  // 4. The quoter prices that pool, which is the simulation source Perago signs against.
  const quote = await client.simulateContract({
    abi: quoterAbi,
    address: address("pancakeV3QuoterV2"),
    args: [
      {
        amountIn: QUOTE_AMOUNT_IN,
        fee: liquidPool.fee,
        sqrtPriceLimitX96: 0n,
        tokenIn: address("wbnb"),
        tokenOut: address("cake"),
      },
    ],
    functionName: "quoteExactInputSingle",
  });
  expect(quote.result[0] > 0n, "the quoter returned a zero amount out");

  // 5. The stake target must still be wired to the pinned CAKE and MasterChef.
  const [
    poolToken,
    masterChef,
    minDeposit,
    withdrawFee,
    withdrawFeePeriod,
    performanceFee,
    pricePerFullShare,
  ] = await Promise.all([
    client.readContract({
      abi: cakePoolAbi,
      address: address("cakePool"),
      functionName: "token",
      ...at,
    }),
    client.readContract({
      abi: cakePoolAbi,
      address: address("cakePool"),
      functionName: "masterchefV2",
      ...at,
    }),
    client.readContract({
      abi: cakePoolAbi,
      address: address("cakePool"),
      functionName: "MIN_DEPOSIT_AMOUNT",
      ...at,
    }),
    client.readContract({
      abi: cakePoolAbi,
      address: address("cakePool"),
      functionName: "withdrawFee",
      ...at,
    }),
    client.readContract({
      abi: cakePoolAbi,
      address: address("cakePool"),
      functionName: "withdrawFeePeriod",
      ...at,
    }),
    client.readContract({
      abi: cakePoolAbi,
      address: address("cakePool"),
      functionName: "performanceFee",
      ...at,
    }),
    client.readContract({
      abi: cakePoolAbi,
      address: address("cakePool"),
      functionName: "getPricePerFullShare",
      ...at,
    }),
  ]);
  expect(
    getAddress(poolToken) === getAddress(address("cake")),
    "the CAKE Pool stakes a different token than the manifest pins",
  );
  expect(
    getAddress(masterChef) === getAddress(address("masterChefV2")),
    "the CAKE Pool points at a different MasterChef than the manifest",
  );

  // 6. The ERC-8183 kernel must be live, unpaused, and accept the pinned token.
  const [
    kernelPaymentToken,
    tokenSupported,
    jobCounter,
    platformFeeBP,
    platformTreasury,
    paused,
    kernelOwner,
    maxExpiry,
  ] = await Promise.all([
    client.readContract({
      abi: kernelAbi,
      address: address("apexKernel"),
      functionName: "paymentToken",
      ...at,
    }),
    client.readContract({
      abi: kernelAbi,
      address: address("apexKernel"),
      args: [address("apexPaymentToken")],
      functionName: "isPaymentTokenSupported",
      ...at,
    }),
    client.readContract({
      abi: kernelAbi,
      address: address("apexKernel"),
      functionName: "jobCounter",
      ...at,
    }),
    client.readContract({
      abi: kernelAbi,
      address: address("apexKernel"),
      functionName: "platformFeeBP",
      ...at,
    }),
    client.readContract({
      abi: kernelAbi,
      address: address("apexKernel"),
      functionName: "platformTreasury",
      ...at,
    }),
    client.readContract({
      abi: kernelAbi,
      address: address("apexKernel"),
      functionName: "paused",
      ...at,
    }),
    client.readContract({
      abi: kernelAbi,
      address: address("apexKernel"),
      functionName: "owner",
      ...at,
    }),
    client.readContract({
      abi: kernelAbi,
      address: address("apexKernel"),
      functionName: "MAX_EXPIRY_DURATION",
      ...at,
    }),
  ]);
  expect(
    getAddress(kernelPaymentToken) ===
      getAddress(address("apexPaymentToken")) && tokenSupported,
    "the kernel no longer settles in the pinned payment token",
  );
  expect(!paused, "the ERC-8183 kernel is paused");

  // 7. The payment token is only obtainable through a V2 pair on this chain.
  const paymentPair = await client.readContract({
    abi: v2FactoryAbi,
    address: address("pancakeV2Factory"),
    args: [address("apexPaymentToken"), address("wbnb")],
    functionName: "getPair",
    ...at,
  });
  expect(
    paymentPair !== zeroAddress,
    "no V2 pair funds the ERC-8183 payment token",
  );
  const fundingQuote = await client.readContract({
    abi: v2RouterAbi,
    address: address("pancakeV2Router"),
    args: [QUOTE_AMOUNT_IN, [address("wbnb"), address("apexPaymentToken")]],
    functionName: "getAmountsOut",
    ...at,
  });

  console.log(
    JSON.stringify(
      {
        apexKernel: {
          jobCounter: jobCounter.toString(),
          maxExpiryDuration: maxExpiry.toString(),
          owner: kernelOwner,
          paused,
          paymentToken: kernelPaymentToken,
          paymentTokenSupported: tokenSupported,
          platformFeeBP: platformFeeBP.toString(),
          platformTreasury,
        },
        blockNumber: at.blockNumber.toString(),
        cakePool: {
          masterChefV2: masterChef,
          minDepositAmount: minDeposit.toString(),
          performanceFeeBp: performanceFee.toString(),
          pricePerFullShare: pricePerFullShare.toString(),
          token: poolToken,
          withdrawFeeBp: withdrawFee.toString(),
          withdrawFeePeriodSeconds: withdrawFeePeriod.toString(),
        },
        chainId,
        manifestContractsVerified: Object.keys(manifest.contracts).length,
        paymentTokenFunding: {
          amountInWei: QUOTE_AMOUNT_IN.toString(),
          amountOutWei: (fundingQuote[1] as bigint).toString(),
          route: "PancakeSwap V2 WBNB -> payment token",
          v2Pair: paymentPair,
        },
        swap: {
          liquidPool,
          pools,
          quotedAmountOutWei: quote.result[0].toString(),
          quotedAmountInWei: QUOTE_AMOUNT_IN.toString(),
        },
        tokens: manifest.tokens,
      },
      null,
      2,
    ),
  );
}

void main();
