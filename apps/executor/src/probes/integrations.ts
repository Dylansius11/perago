import {
  type Address,
  createPublicClient,
  http,
  keccak256,
  zeroAddress,
} from "viem";

const BSC_TESTNET_CHAIN_ID = 97;
const DEFAULT_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const PANCAKE_V3_SOURCE =
  "https://developer.pancakeswap.finance/contracts/v3/addresses";
const CAKE_POOL_SOURCE =
  "https://docs.pancakeswap.finance/welcome-to-pancakeswap/how-to-guides/v3-v2-migration/migration/cake-syrup-pool";

const deployments = [
  {
    name: "PancakeV3Factory",
    address: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  },
  {
    name: "PancakeV3SwapRouter",
    address: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
  },
  {
    name: "PancakeV3QuoterV2",
    address: "0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2",
  },
  { name: "DummyCAKE", address: "0xFa60D973F7642B748046464e165A65B7323b0DEE" },
  { name: "WBNB", address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" },
  { name: "CakePool", address: "0x683433ba14e8F26774D43D3E90DA6Dd7a22044Fe" },
  {
    name: "MasterChefV2",
    address: "0xB4A466911556e39210a6bB2FaECBB59E4eB7E43d",
  },
] as const satisfies readonly { name: string; address: Address }[];

const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "tokenA" },
      { type: "address", name: "tokenB" },
      { type: "uint24", name: "fee" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;
const erc20Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;
const cakePoolAbi = [
  {
    type: "function",
    name: "getPricePerFullShare",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "performanceFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawFeePeriod",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function main() {
  const client = createPublicClient({
    transport: http(process.env.PERAGO_BSC_TESTNET_RPC ?? DEFAULT_RPC_URL, {
      retryCount: 0,
      timeout: 20_000,
    }),
  });
  const [chainId, block] = await Promise.all([
    client.getChainId(),
    client.getBlock(),
  ]);
  if (chainId !== BSC_TESTNET_CHAIN_ID || !block.hash)
    throw new Error("BSC Testnet block context is unavailable");

  const code = await Promise.all(
    deployments.map(async (deployment) => {
      const bytecode = await client.getCode({
        address: deployment.address,
        blockNumber: block.number,
      });
      if (!bytecode || bytecode === "0x")
        throw new Error(`no runtime code at ${deployment.name}`);
      return {
        ...deployment,
        address: deployment.address.toLowerCase(),
        runtimeCodeHash: keccak256(bytecode),
        runtimeCodeSize: (bytecode.length - 2) / 2,
      };
    }),
  );
  const [
    cakeDecimals,
    cakeSymbol,
    poolPricePerShare,
    performanceFee,
    withdrawFee,
    withdrawFeePeriod,
    pools,
  ] = await Promise.all([
    client.readContract({
      address: deployments[3].address,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber: block.number,
    }),
    client.readContract({
      address: deployments[3].address,
      abi: erc20Abi,
      functionName: "symbol",
      blockNumber: block.number,
    }),
    client.readContract({
      address: deployments[5].address,
      abi: cakePoolAbi,
      functionName: "getPricePerFullShare",
      blockNumber: block.number,
    }),
    client.readContract({
      address: deployments[5].address,
      abi: cakePoolAbi,
      functionName: "performanceFee",
      blockNumber: block.number,
    }),
    client.readContract({
      address: deployments[5].address,
      abi: cakePoolAbi,
      functionName: "withdrawFee",
      blockNumber: block.number,
    }),
    client.readContract({
      address: deployments[5].address,
      abi: cakePoolAbi,
      functionName: "withdrawFeePeriod",
      blockNumber: block.number,
    }),
    Promise.all(
      [100, 500, 2_500, 10_000].map(async (fee) => ({
        fee,
        address: await client.readContract({
          address: deployments[0].address,
          abi: factoryAbi,
          functionName: "getPool",
          args: [deployments[3].address, deployments[4].address, fee],
          blockNumber: block.number,
        }),
      })),
    ),
  ]);
  console.log(
    JSON.stringify(
      {
        source: { pancakeV3: PANCAKE_V3_SOURCE, cakePool: CAKE_POOL_SOURCE },
        chainId: chainId.toString(),
        blockNumber: block.number.toString(),
        blockHash: block.hash,
        contracts: code,
        cake: { symbol: cakeSymbol, decimals: cakeDecimals },
        cakePool: {
          pricePerFullShare: poolPricePerShare.toString(),
          performanceFee: performanceFee.toString(),
          withdrawFee: withdrawFee.toString(),
          withdrawFeePeriod: withdrawFeePeriod.toString(),
        },
        directPools: pools.map((pool) => ({
          fee: pool.fee,
          address: pool.address.toLowerCase(),
          exists: pool.address !== zeroAddress,
        })),
      },
      null,
      2,
    ),
  );
}

void main();
