import {
  type Address,
  buildUserOperation,
  buildUserOperationNonceKey,
  encodeHandleOps,
  type Hash,
  hashUserOperation,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  packUserOperationSignature,
  ROOT_OWNER_ENTITY_ID,
} from "@perago/sdk";
import { type Hex, parseEventLogs } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import {
  readContract,
  sendTransaction,
  signMessage,
  waitForTransactionReceipt,
} from "wagmi/actions";
import { ownerSubmissionKey, submitOwnerOnce } from "./owner-submission";
import { assertWalletVenue } from "./venue";
import { CHAIN_ID, wagmiConfig } from "./wagmi";

/*
 * One owner-paid root UserOperation, the only way the console changes the
 * smart account: policy activation, wrapping, the exact approval, revoke, and
 * cancel all go through here. Two wallet prompts, always in this order:
 *
 *   1. sign   the 32-byte ERC-4337 hash of the exact UserOperation
 *   2. send   EntryPoint.handleOps([op], owner) from the owner wallet
 *
 * Fees inside the UserOperation are zero (packages/sdk PERAGO_USER_OPERATION_GAS):
 * the owner's transaction pays gas, and the account never prefunds anything.
 * Success is read from the EntryPoint's `UserOperationEvent`, not assumed
 * from a mined transaction.
 */

export type RootStage = "sign" | "send" | "confirm";

export class OperationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationFailedError";
  }
}

export type RootOperationResult = {
  transactionHash: Hash;
  userOperationHash: Hash;
};

export async function sendRootOperation(input: {
  owner: Address;
  account: Address;
  callData: Hex;
  onStage?: (
    stage: RootStage,
    detail: { userOperationHash?: Hash; transactionHash?: Hash },
  ) => void;
}): Promise<RootOperationResult> {
  await assertWalletVenue();
  const entryPoint = MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint;
  const { receipt, transactionHash, userOperationHash } = await submitOwnerOnce(
    {
      key: ownerSubmissionKey({
        chainId: CHAIN_ID,
        owner: input.owner,
        target: entryPoint,
        callData: input.callData,
      }),
      store: sessionStorage,
      send: async () => {
        const nonce = await readContract(wagmiConfig, {
          abi: entryPoint07Abi,
          address: entryPoint,
          args: [
            input.account,
            buildUserOperationNonceKey({
              entityId: ROOT_OWNER_ENTITY_ID,
              isGlobalValidation: true,
            }),
          ],
          chainId: CHAIN_ID,
          functionName: "getNonce",
        });
        const unsigned = buildUserOperation({
          callData: input.callData,
          nonce,
          sender: input.account,
        });
        const userOperationHash = hashUserOperation(unsigned, CHAIN_ID);
        input.onStage?.("sign", { userOperationHash });
        const signature = await signMessage(wagmiConfig, {
          account: input.owner,
          message: { raw: userOperationHash },
        });
        await assertWalletVenue();
        input.onStage?.("send", { userOperationHash });
        const transactionHash = await sendTransaction(wagmiConfig, {
          account: input.owner,
          chainId: CHAIN_ID,
          data: encodeHandleOps(
            [{ ...unsigned, signature: packUserOperationSignature(signature) }],
            input.owner,
          ),
          to: entryPoint,
        });
        return { transactionHash, userOperationHash };
      },
      confirm: async (pending) => {
        if (!pending.userOperationHash)
          throw new OperationFailedError(
            "The pending owner transaction has no UserOperation hash.",
          );
        input.onStage?.("confirm", {
          transactionHash: pending.transactionHash,
          userOperationHash: pending.userOperationHash,
        });
        const receipt = await waitForTransactionReceipt(wagmiConfig, {
          chainId: CHAIN_ID,
          hash: pending.transactionHash,
        });
        return {
          receipt,
          transactionHash: pending.transactionHash,
          userOperationHash: pending.userOperationHash,
        };
      },
    },
  );
  if (receipt.status !== "success") {
    throw new OperationFailedError(
      "The EntryPoint transaction reverted. The account did not change.",
    );
  }
  const event = parseEventLogs({
    abi: entryPoint07Abi,
    eventName: "UserOperationEvent",
    logs: receipt.logs,
  }).find((log) => log.args.userOpHash === userOperationHash);
  if (!event) {
    throw new OperationFailedError(
      "The transaction was mined but carried no event for this UserOperation.",
    );
  }
  if (!event.args.success) {
    throw new OperationFailedError(
      "The UserOperation was included but its call reverted. The account did not change.",
    );
  }
  return { transactionHash, userOperationHash };
}
