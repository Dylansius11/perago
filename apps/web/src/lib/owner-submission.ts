import { type Address, type Hash, hashSchema } from "@perago/sdk";
import { type Hex, keccak256 } from "viem";

export type PendingOwnerTransaction = {
  transactionHash: Hash;
  userOperationHash: Hash | null;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function parsePending(value: string): PendingOwnerTransaction {
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("transactionHash" in parsed) ||
    !("userOperationHash" in parsed)
  )
    throw new Error(
      "The pending owner transaction record is invalid; do not broadcast again.",
    );
  return {
    transactionHash: hashSchema.parse(parsed.transactionHash),
    userOperationHash:
      parsed.userOperationHash === null
        ? null
        : hashSchema.parse(parsed.userOperationHash),
  };
}

export function ownerSubmissionKey(input: {
  chainId: number;
  owner: Address;
  target: Address;
  callData: Hex;
}): string {
  return `perago-owner:${input.chainId}:${input.owner.toLowerCase()}:${input.target.toLowerCase()}:${keccak256(input.callData)}`;
}

/** A receipt timeout leaves the identical broadcast hash available to retry, not a new wallet request. */
export async function submitOwnerOnce<T>(input: {
  key: string;
  store: Store;
  send: () => Promise<PendingOwnerTransaction>;
  confirm: (pending: PendingOwnerTransaction) => Promise<T>;
}): Promise<T> {
  const stored = input.store.getItem(input.key);
  const pending = stored === null ? await input.send() : parsePending(stored);
  if (stored === null) input.store.setItem(input.key, JSON.stringify(pending));
  const confirmed = await input.confirm(pending);
  input.store.removeItem(input.key);
  return confirmed;
}
