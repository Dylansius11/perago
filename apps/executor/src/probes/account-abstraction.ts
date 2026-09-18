import { type Address, createPublicClient, http, keccak256 } from "viem";

const BSC_TESTNET_CHAIN_ID = 97;
const DEFAULT_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const DEPLOYMENT_SOURCE =
  "https://www.alchemy.com/docs/wallets/smart-contracts/deployed-addresses";
const SDK_ENTRY_POINT_SOURCE = "@aa-sdk/core@4.88.5 src/entrypoint/0.7.ts";

const deployments = [
  {
    name: "EntryPoint v0.7",
    version: "0.7.0",
    address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  },
  {
    name: "ModularAccount",
    version: "2.0.0",
    address: "0x00000000000002377B26b1EdA7b0BC371C60DD4f",
  },
  {
    name: "AccountFactory",
    version: "2.0.0",
    address: "0x00000000000017c61b5bEe81050EC8eFc9c6fecd",
  },
  {
    name: "SingleSignerValidationModule",
    version: "1.0.0",
    address: "0x00000000000099DE0BF6fA90dEB851E2A2df7d83",
  },
  {
    name: "AllowlistModule",
    version: "1.0.0",
    address: "0x00000000003e826473a313e600b5b9b791f5a59a",
  },
  {
    name: "NativeTokenLimitModule",
    version: "1.0.0",
    address: "0x00000000000001e541f0D090868FBe24b59Fbe06",
  },
  {
    name: "PaymasterGuardModule",
    version: "1.0.0",
    address: "0x0000000000001aA7A7F7E29abe0be06c72FD42A1",
  },
  {
    name: "TimeRangeModule",
    version: "1.0.0",
    address: "0x00000000000082B8e2012be914dFA4f62A0573eA",
  },
] as const satisfies readonly {
  name: string;
  version: string;
  address: Address;
}[];

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

  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(
      `expected BSC Testnet chain ${BSC_TESTNET_CHAIN_ID}, received ${chainId}`,
    );
  }
  if (!block.hash) {
    throw new Error("latest BSC Testnet block did not include a hash");
  }

  const codeByDeployment = await Promise.all(
    deployments.map(async (deployment) => {
      const bytecode = await client.getCode({
        address: deployment.address,
        blockNumber: block.number,
      });
      if (!bytecode || bytecode === "0x") {
        throw new Error(
          `no runtime code at ${deployment.name} (${deployment.address})`,
        );
      }

      return {
        ...deployment,
        address: deployment.address.toLowerCase(),
        runtimeCodeHash: keccak256(bytecode),
        runtimeCodeSize: (bytecode.length - 2) / 2,
      };
    }),
  );

  console.log(
    JSON.stringify(
      {
        source: {
          deployments: DEPLOYMENT_SOURCE,
          entryPoint: SDK_ENTRY_POINT_SOURCE,
        },
        chainId: chainId.toString(),
        blockNumber: block.number.toString(),
        blockHash: block.hash,
        contracts: codeByDeployment,
      },
      null,
      2,
    ),
  );
}

void main();
