import {
  type Address,
  type ExecutorAllowance,
  encodeUninstallMandateSession,
  hashMandateSessionRevocation,
  hashPolicyRevocation,
  hashWalletPolicy,
  type PolicyTransitionPrepared,
  type PolicyView,
  toMandateSessionPermission,
} from "@perago/sdk";

/**
 * Refuse an API-prepared revocation that is not exactly "end this policy":
 * the account policy must carry the revocation hash of the active policy, the
 * session call must be the uninstall of the session that policy installed, and
 * every catalog token's allowance to MandateExecutor must go to zero. Returns
 * the allowances the root operation sets.
 */
export function assertPreparedRevocation(input: {
  account: Address;
  owner: Address;
  chainId: string;
  ownerEpoch: string;
  validUntil: string;
  policy: PolicyView;
  prepared: PolicyTransitionPrepared;
  tokens: readonly Address[];
}): ExecutorAllowance[] {
  const { policy, prepared } = input;
  const { accountPolicy } = prepared;
  if (policy.status !== "ACTIVE" || policy.permission === null)
    throw new Error(
      "Only an active policy with an installed session can be revoked.",
    );
  if (policy.policyHash !== hashWalletPolicy(policy.policy))
    throw new Error("The stored policy does not match its recorded hash.");
  const sessionRemoval = encodeUninstallMandateSession(
    toMandateSessionPermission(policy.permission),
  );
  const permissionHash = hashMandateSessionRevocation(policy.permission);
  if (
    accountPolicy.account !== input.account.toLowerCase() ||
    accountPolicy.rootOwner !== input.owner.toLowerCase() ||
    accountPolicy.chainId !== input.chainId ||
    accountPolicy.ownerEpoch !== input.ownerEpoch ||
    accountPolicy.validUntil !== input.validUntil ||
    accountPolicy.policyHash !== hashPolicyRevocation(policy.policyHash) ||
    accountPolicy.permissionHash !== permissionHash ||
    prepared.permissionHash !== permissionHash ||
    prepared.permissionCallData.toLowerCase() !== sessionRemoval.toLowerCase()
  )
    throw new Error(
      "Prepared revocation differs from the active policy and its installed session.",
    );
  const allowances = prepared.allowances;
  if (
    allowances.length !== input.tokens.length ||
    input.tokens.some(
      (token, index) =>
        allowances[index]?.token.toLowerCase() !== token.toLowerCase() ||
        allowances[index]?.amount !== "0",
    )
  )
    throw new Error(
      "Prepared revocation does not set every catalog allowance to zero.",
    );
  return input.tokens.map((token) => ({ amount: 0n, token }));
}
