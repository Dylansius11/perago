---
name: perago-integration-engineer
description: Use when touching any external system - ERC-4337 EntryPoint, Alchemy Modular Account V2 modules, bundler or paymaster, PancakeSwap V3 router and quoter, the CAKE Pool stake target, the BNB APEX ERC-8183 kernel, payment tokens, or BSC RPC. Covers the deployment manifests, the live probes that re-verify them, the integration status vocabulary, and the per-system failure responses.
---

# Perago Integration Engineer

## Authority

`docs/technical/INTEGRATION.md` owns every external fact: addresses, versions, capabilities, and status. `docs/technical/TECH-STACK.md` owns pinned dependency versions. The deployment manifests in `deployments/` own verified onchain values. **This skill owns none of them** - it must not restate an address, and neither may any code comment or test fixture.

## Status vocabulary is a contract, not a label

Every external claim carries exactly one of `verified`, `proposed`, `needs re-verification`, or `blocked`. A row moves to `verified` only when a probe read it on the target chain in the current repository and wrote its evidence to a file. An earlier run in a sibling project, an upstream README, or an EIP is never evidence of current deployed behavior. Downgrade to `needs re-verification` the moment a pinned version, module, or provider changes - a silently stale `verified` is worse than a `blocked`.

## The manifest and probe loop

`deployments/bsc-testnet.account.json` and `deployments/bsc-testnet.protocols.json` carry `chainId`, `verifiedAt` (block number, block hash, timestamp), primary-source `sources` URLs, and per-contract address plus code hash. The probes re-read live code and **fail on any code-hash drift**:

```
pnpm --filter @perago/executor probe:account-live      # EntryPoint, factory, implementation, modules
pnpm --filter @perago/executor probe:protocol-live     # PancakeSwap, stake target, APEX, tokens
pnpm --filter @perago/executor probe:bundler
pnpm --filter @perago/executor probe:account-session
pnpm --filter @perago/executor probe:integrations
```

Rules: a probe that writes chain state reads current state first (send factory data only when the account has no code), claims a **fresh permission slot per run**, and uninstalls what it installed. It asserts on **measured deltas**, never absolute balances. It persists its report through `writeEvidence` to `docs/evidence/<name>.json` as well as stdout - a run whose only output was the terminal did not happen. These four rules are already-paid lessons in `docs/LESSONS.md`; re-learning them costs hours.

## Account abstraction

The account is Alchemy Modular Account V2 owned by an external self-custodial EOA; transport is ERC-4337 through a BNB Testnet-supported bundler with optional capped sponsorship. Hard limits:

- A session or executor permission is **defense in depth only**. It can bound target, selector, token amount, time, and gas - it cannot bound call **arguments**, so granting a token `approve` selector to a session key authorizes an arbitrary allowance. That is open decision `D-004`: authorize the spend inside one account-executed call or bound it with the AllowlistModule ERC-20 limit. Never resolve it by widening the session.
- Root or global permission for the executor is forbidden; executor permissions may not reach account upgrade, module management, or root-owner functions.
- The derived account address is a CREATE2 result over factory, salt, owner, and **implementation bytecode** - a stale implementation constant silently relocates the account to an address that will never hold funds.
- Gas sponsorship is not asset funding: a sponsored operation still needs the account to hold the asset it spends.
- Take gas limits from `eth_estimateUserOperationGas` with a small buffer. The bundler enforces a minimum used/limit efficiency ratio and names both the field and the ratios in its rejection; retune the named field instead of padding further.
- A sponsorship policy's transaction count is consumed by **attempts**, not by mined successes, so a tight cap is exhausted during development.
- A public standards-compatible bundler is a fallback candidate **only** after the same EntryPoint and version probe passes. Never fall back to a raw key when a session provider is unavailable - use the MandateExecutor path.

## PancakeSwap V3 swap

One pinned direct exact-input pool and fee pair per supported token pair. Smart Router, Universal Router, arbitrary path bytes, multicall, native unwrap, and multi-hop are **deliberately rejected** - re-adding one enlarges the attack surface and breaks the verifier's simplicity. Cross-check the `QuoterV2` output against an exact router `eth_call` from the smart-account or adapter call context; a quote that was never simulated from the real caller is not a quote. If testnet liquidity is inadequate, use a transparently seeded pool or a pinned mainnet fork and **label the evidence as fork evidence**. Never present a local pool as public liquidity.

## Stake target and ERC-8183 settlement

The stake target's behavioral quirks belong in the adapter and the docs, including any withdrawal fee, and the verifier measures the position or receipt-token delta it actually produces. ERC-8183 states are `Open`, `Funded`, `Submitted`, then `Completed`, `Rejected`, or `Expired`; Perago integrates the kernel and does not reimplement it. Before authorization the job must be at the correct lifecycle stage with the expected client, provider, evaluator (`OutcomeEvaluator`), payment token, and budget. Perago must never install a hook that blocks the standard's non-hookable refund path - refund and expiry liveness is a user protection, not a nuisance.

**A deployment narrows its standard.** Decode the deployed contract's own error selectors and read its validation branch before writing a call: a spec-legal `createJob` was rejected onchain for a required hook and would next have failed a minimum-expiry rule that the EIP does not mention. Treat the standard as the outer bound and the bytecode as the real contract.

## Per-failure response

Follow `docs/technical/INTEGRATION.md` §failure modes and `docs/technical/ARCHITECTURE.md` §8 exactly. The shape is always the same: stop the critical transition, reconcile against chain truth, and surface an explicit reason. RPC disagreement means compare a second endpoint or wait - never pick the more convenient answer. Pruned public RPC breaks pinned forks; replay verified bytecode instead of assuming archive access. A probe's time window comes from the chain it validates against, never from the host clock.

## Verification gate

An integration is proven when: the probe ran in this repository against the named chain, its evidence file is committed, the manifest's code hashes match live code, the status row in `INTEGRATION.md` was updated in the same change, and the claim names chain, address, block, transaction hash, command, and primary source. An SDK call that returned without throwing proves that the SDK did not throw - nothing more.

## Stop conditions

Stop and report when a required deployment or capability cannot be verified on the target chain, when a needed asset has no safe funding or mint path, when resolving a gate would require assuming an address, or when an upstream contract's behavior contradicts its documentation. Name the decision gate ID, the exact command and response, and the smallest safe options.
