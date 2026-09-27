import {
  type Address,
  type ConfirmPolicyActivationRequest,
  confirmPolicyActivationRequestSchema,
} from "@perago/sdk";

type Identity = { account: Address; owner: Address; chainId: number };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PendingPolicy = {
  policyId: string;
  body: ConfirmPolicyActivationRequest;
};

function parsePending(value: unknown): PendingPolicy {
  if (
    !value ||
    typeof value !== "object" ||
    !("policyId" in value) ||
    typeof value.policyId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value.policyId,
    ) ||
    !("body" in value)
  )
    throw new Error(
      "Pending policy evidence is invalid; do not broadcast again.",
    );
  return {
    policyId: value.policyId,
    body: confirmPolicyActivationRequestSchema.parse(value.body),
  };
}

export function pendingPolicyKey(identity: Identity): string {
  return `perago-policy:${identity.chainId}:${identity.owner.toLowerCase()}:${identity.account.toLowerCase()}`;
}

/** A signed and submitted transition survives reload so finality never asks for another root operation. */
export function writePendingPolicy(
  store: Store,
  identity: Identity,
  pending: PendingPolicy,
): void {
  store.setItem(
    pendingPolicyKey(identity),
    JSON.stringify(parsePending(pending)),
  );
}

export function readPendingPolicy(
  store: Store,
  identity: Identity,
): PendingPolicy | null {
  const raw = store.getItem(pendingPolicyKey(identity));
  return raw === null ? null : parsePending(JSON.parse(raw));
}

export function clearPendingPolicy(store: Store, identity: Identity): void {
  store.removeItem(pendingPolicyKey(identity));
}
