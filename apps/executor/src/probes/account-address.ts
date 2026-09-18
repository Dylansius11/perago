import {
  type Address,
  createPublicClient,
  encodePacked,
  getAddress,
  getContractAddress,
  http,
  keccak256,
} from "viem";

const BSC_TESTNET_CHAIN_ID = 97;
const DEFAULT_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const FACTORY_ADDRESS = "0x00000000000017c61b5bEe81050EC8eFc9c6fecd";
const IMPLEMENTATION_ADDRESS = "0x00000000000002377B26b1EdA7b0BC371C60DD4f";
const DEFAULT_SALT = 0n;
const SMA_ENTITY_ID = 0xffffffff;

export function deriveSemiModularAccountAddress(
  ownerAddress: Address,
): Address {
  const owner = getAddress(ownerAddress);
  const combinedSalt = keccak256(
    encodePacked(
      ["address", "uint256", "uint32"],
      [owner, DEFAULT_SALT, SMA_ENTITY_ID],
    ),
  );
  const bytecode =
    `0x6100513d8160233d3973${IMPLEMENTATION_ADDRESS.slice(2)}60095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3${owner.slice(2)}` as const;

  return getContractAddress({
    from: FACTORY_ADDRESS,
    opcode: "CREATE2",
    salt: combinedSalt,
    bytecode,
  });
}

async function main() {
  const configuredOwner = process.env.PERAGO_ROOT_OWNER_ADDRESS;
  if (!configuredOwner) {
    throw new Error("PERAGO_ROOT_OWNER_ADDRESS is required");
  }

  const owner = getAddress(configuredOwner);
  const account = deriveSemiModularAccountAddress(owner);
  const client = createPublicClient({
    transport: http(process.env.PERAGO_BSC_TESTNET_RPC ?? DEFAULT_RPC_URL, {
      retryCount: 0,
      timeout: 20_000,
    }),
  });
  const [chainId, block, bytecode] = await Promise.all([
    client.getChainId(),
    client.getBlock(),
    client.getCode({ address: account }),
  ]);

  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(
      `expected BSC Testnet chain ${BSC_TESTNET_CHAIN_ID}, received ${chainId}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        source:
          "https://github.com/alchemyplatform/aa-sdk/blob/main/packages/smart-accounts/src/ma-v2/predictAddress.ts",
        chainId: chainId.toString(),
        blockNumber: block.number.toString(),
        blockHash: block.hash,
        rootOwner: owner.toLowerCase(),
        account,
        isDeployed: bytecode !== undefined && bytecode !== "0x",
        configuration: {
          accountType: "SMA",
          factory: FACTORY_ADDRESS.toLowerCase(),
          implementation: IMPLEMENTATION_ADDRESS.toLowerCase(),
          salt: DEFAULT_SALT.toString(),
        },
      },
      null,
      2,
    ),
  );
}

void main();
