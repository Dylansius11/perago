import {
  type Address,
  type ConfirmPolicyActivationRequest,
  type ConfirmPolicyRevocationRequest,
  confirmPolicyActivationRequestSchema,
  confirmPolicyRevocationRequestSchema,
} from "@perago/sdk";

type Identity = { account: Address; owner: Address; chainId: number };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PendingPolicy = {
  policyId: string;
  body: ConfirmPolicyActivationRequest;
};

export type PendingRevocation = {
  policyId: string;
  body: ConfirmPolicyRevocationRequest;
};

const POLICY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function parsePending<Body>(
  value: unknown,
  schema: { parse: (body: unknown) => Body },
): { policyId: string; body: Body } {
  if (
    !value ||
    typeof value !== "object" ||
    !("policyId" in value) ||
    typeof value.policyId !== "string" ||
    !POLICY_ID.test(value.policyId) ||
    !("body" in value)
  )
    throw new Error(
      "Pending policy evidence is invalid; do not broadcast again.",
    );
  return { policyId: value.policyId, body: schema.parse(value.body) };
}

export function pendingPolicyKey(identity: Identity): string {
  return `perago-policy:${identity.chainId}:${identity.owner.toLowerCase()}:${identity.account.toLowerCase()}`;
}

export function pendingRevocationKey(identity: Identity): string {
  return `perago-policy-revocation:${identity.chainId}:${identity.owner.toLowerCase()}:${identity.account.toLowerCase()}`;
}

/** A signed and submitted transition survives reload so finality never asks for another root operation. */
export function writePendingPolicy(
  store: Store,
  identity: Identity,
  pending: PendingPolicy,
): void {
  store.setItem(
    pendingPolicyKey(identity),
    JSON.stringify(parsePending(pending, confirmPolicyActivationRequestSchema)),
  );
}

export function readPendingPolicy(
  store: Store,
  identity: Identity,
): PendingPolicy | null {
  const raw = store.getItem(pendingPolicyKey(identity));
  return raw === null
    ? null
    : parsePending(JSON.parse(raw), confirmPolicyActivationRequestSchema);
}

export function clearPendingPolicy(store: Store, identity: Identity): void {
  store.removeItem(pendingPolicyKey(identity));
}

/** The same guarantee for a policy revocation, stored apart so the two never shadow each other. */
export function writePendingRevocation(
  store: Store,
  identity: Identity,
  pending: PendingRevocation,
): void {
  store.setItem(
    pendingRevocationKey(identity),
    JSON.stringify(parsePending(pending, confirmPolicyRevocationRequestSchema)),
  );
}

export function readPendingRevocation(
  store: Store,
  identity: Identity,
): PendingRevocation | null {
  const raw = store.getItem(pendingRevocationKey(identity));
  return raw === null
    ? null
    : parsePending(JSON.parse(raw), confirmPolicyRevocationRequestSchema);
}

export function clearPendingRevocation(store: Store, identity: Identity): void {
  store.removeItem(pendingRevocationKey(identity));
}
