import {
  deriveSemiModularAccountAddress,
  MODULAR_ACCOUNT_V2_ADDRESSES,
} from "@perago/sdk";
import { createPublicClient, formatEther, getAddress, http } from "viem";

const BSC_TESTNET_CHAIN_ID = 97;
const DEFAULT_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const DEPLOYMENT_SOURCE =
  "https://www.alchemy.com/docs/wallets/smart-contracts/deployed-addresses";

async function main() {
  const configuredOwner = process.env.PERAGO_ROOT_OWNER_ADDRESS;
  if (!configuredOwner) {
    throw new Error("PERAGO_ROOT_OWNER_ADDRESS is required");
  }

  const owner = getAddress(configuredOwner);
  const account = deriveSemiModularAccountAddress({ owner });
  const client = createPublicClient({
    transport: http(process.env.PERAGO_BSC_TESTNET_RPC ?? DEFAULT_RPC_URL, {
      retryCount: 0,
      timeout: 20_000,
    }),
  });
  const [chainId, block, bytecode, accountBalance, ownerBalance] =
    await Promise.all([
      client.getChainId(),
      client.getBlock(),
      client.getCode({ address: account }),
      client.getBalance({ address: account }),
      client.getBalance({ address: owner }),
    ]);

  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(
      `expected BSC Testnet chain ${BSC_TESTNET_CHAIN_ID}, received ${chainId}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        source: DEPLOYMENT_SOURCE,
        chainId: chainId.toString(),
        blockNumber: block.number.toString(),
        blockHash: block.hash,
        rootOwner: owner,
        rootOwnerBalanceTbnb: formatEther(ownerBalance),
        account,
        accountBalanceTbnb: formatEther(accountBalance),
        isDeployed: bytecode !== undefined && bytecode !== "0x",
        configuration: {
          accountType: "SMA",
          factory: MODULAR_ACCOUNT_V2_ADDRESSES.factory,
          implementation:
            MODULAR_ACCOUNT_V2_ADDRESSES.semiModularAccountBytecode,
          salt: "0",
        },
      },
      null,
      2,
    ),
  );
}

void main();
