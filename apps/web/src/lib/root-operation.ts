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
import { type Hex, numberToHex, parseEventLogs } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import {
  readContract,
  sendTransaction,
  signMessage,
  waitForTransactionReceipt,
} from "wagmi/actions";
import { ApiError, api } from "./api";
import {
  ownerSubmissionKey,
  type PendingOwnerTransaction,
  submitOwnerOnce,
} from "./owner-submission";
import { assertWalletVenue } from "./venue";
import { CHAIN_ID, wagmiConfig } from "./wagmi";

/*
 * One root UserOperation, the only way the console changes the smart account:
 * policy activation, wrapping, restoring the allowance, and mandate revocation
 * all go through here. The operation always carries zero fees, so the same
 * owner signature is valid on both submission paths:
 *
 *   sponsored   the owner signs the 32-byte EntryPoint hash (one prompt); the
 *               API submits it to Alchemy's bundler, whose gas policy pays.
 *   owner-paid  the owner signs the hash, then sends EntryPoint.handleOps from
 *               the owner wallet and pays gas (two prompts). This runs when
 *               sponsorship is off, or refuses the already signed operation,
 *               in which case only the send prompt is added.
 *
 * Success is read from the EntryPoint's `UserOperationEvent` in the mined
 * receipt on both paths, never assumed from a bundler answer. A reload while a
 * submission is pending resumes the stored hash instead of submitting again.
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

/** `sponsor` is the wallet session when the API offers sponsorship, else null. */
export type Sponsor = { token: string } | null;

const INCLUSION_POLLS = 60;
const INCLUSION_POLL_MS = 3_000;

/** The sponsor argument for a caller holding the public config and wallet session. */
export function sponsorFor(
  config: { sponsorship: { enabled: boolean } },
  session: { token: string } | null,
): Sponsor {
  return config.sponsorship.enabled && session
    ? { token: session.token }
    : null;
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type UserOperationRpc = Parameters<typeof api.submitOperation>[1];

function sponsorshipRefused(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "SPONSORSHIP_UNAVAILABLE" ||
      error.code === "SPONSORSHIP_REFUSED")
  );
}

/** The bundler reports the transaction that included the operation. */
async function includedTransaction(
  sponsor: { token: string },
  userOperationHash: Hash,
): Promise<Hash> {
  for (let attempt = 0; attempt < INCLUSION_POLLS; attempt += 1) {
    const status = await api.operationStatus(sponsor.token, userOperationHash);
    if (status.status === "INCLUDED") return status.transactionHash;
    await delay(INCLUSION_POLL_MS);
  }
  throw new Error(
    "The bundler has not included this operation yet. Retry to keep waiting; nothing will be submitted again.",
  );
}

export async function sendRootOperation(input: {
  owner: Address;
  account: Address;
  callData: Hex;
  sponsor: Sponsor;
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
      send: async (): Promise<PendingOwnerTransaction> => {
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
        let unsigned = buildUserOperation({
          callData: input.callData,
          nonce,
          sender: input.account,
        });
        // The bundler rejects over-provisioned limits, so a sponsored operation
        // uses its measured estimate. Without one, the owner-paid limits stay.
        let sponsor = input.sponsor;
        if (sponsor) {
          try {
            const gas = await api.estimateOperation(sponsor.token, {
              callData: input.callData,
              nonce: nonce.toString(),
            });
            unsigned = {
              ...unsigned,
              callGasLimit: BigInt(gas.callGasLimit),
              preVerificationGas: BigInt(gas.preVerificationGas),
              verificationGasLimit: BigInt(gas.verificationGasLimit),
            };
          } catch (error) {
            if (!sponsorshipRefused(error)) throw error;
            sponsor = null;
          }
        }
        const userOperationHash = hashUserOperation(unsigned, CHAIN_ID);
        input.onStage?.("sign", { userOperationHash });
        const signed = {
          ...unsigned,
          signature: packUserOperationSignature(
            await signMessage(wagmiConfig, {
              account: input.owner,
              message: { raw: userOperationHash },
            }),
          ),
        };
        await assertWalletVenue();
        input.onStage?.("send", { userOperationHash });
        if (sponsor) {
          const rpc: UserOperationRpc = {
            callData: signed.callData,
            callGasLimit: numberToHex(signed.callGasLimit),
            maxFeePerGas: numberToHex(signed.maxFeePerGas),
            maxPriorityFeePerGas: numberToHex(signed.maxPriorityFeePerGas),
            nonce: numberToHex(signed.nonce),
            preVerificationGas: numberToHex(signed.preVerificationGas),
            sender: signed.sender,
            signature: signed.signature,
            verificationGasLimit: numberToHex(signed.verificationGasLimit),
          };
          try {
            const submitted = await api.submitOperation(sponsor.token, rpc);
            if (
              submitted.userOperationHash.toLowerCase() !==
              userOperationHash.toLowerCase()
            ) {
              throw new OperationFailedError(
                "The bundler accepted a different operation than the one you signed.",
              );
            }
            return { transactionHash: null, userOperationHash };
          } catch (error) {
            if (!sponsorshipRefused(error)) throw error;
          }
        }
        const transactionHash = await sendTransaction(wagmiConfig, {
          account: input.owner,
          chainId: CHAIN_ID,
          data: encodeHandleOps([signed], input.owner),
          to: entryPoint,
        });
        return { transactionHash, userOperationHash };
      },
      confirm: async (pending) => {
        if (!pending.userOperationHash)
          throw new OperationFailedError(
            "The pending owner transaction has no UserOperation hash.",
          );
        let transactionHash = pending.transactionHash;
        if (transactionHash === null) {
          if (!input.sponsor)
            throw new OperationFailedError(
              "A sponsored operation is pending; sign in again to follow it.",
            );
          transactionHash = await includedTransaction(
            input.sponsor,
            pending.userOperationHash,
          );
        }
        input.onStage?.("confirm", {
          transactionHash,
          userOperationHash: pending.userOperationHash,
        });
        const receipt = await waitForTransactionReceipt(wagmiConfig, {
          chainId: CHAIN_ID,
          hash: transactionHash,
        });
        return {
          receipt,
          transactionHash,
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
