# Perago

**Intent, carried through.** Perago turns a plain-English goal into a one-time onchain mandate, executes within hard limits, proves the outcome, and permanently drops its authority.

## Why

Onchain agents are useful only when convenience does not require wallet-wide trust. Natural language is not authorization, a transaction receipt is not proof of intent, and an AI should not decide whether its own work deserves payment.

Perago separates interpretation from authority:

1. A self-custodial owner controls an ERC-4337 smart account with narrowly scoped executor permissions.
2. The user activates a persistent Wallet Policy on that account.
3. AI translates one outcome into a typed plan.
4. Deterministic policy intersection and simulation expose the exact limits.
5. The root owner signs one bounded Task Mandate.
6. A constrained executor commits one attempt and the smart account calls only the approved path.
7. An adapter-specific verifier proves the postcondition.
8. A public Execution Receipt records consumed authority and evidence.
9. ERC-8183 payment releases only after deterministic success.

The MVP targets one approved BSC swap adapter and one approved BSC staking adapter. No arbitrary calldata, unrestricted keys, cross-chain execution, leverage, or agent marketplace.

## Status

**Phases 1–5 and `P6-001`–`P6-002` are complete; `P6-003` (automated settlement) starts only when the user opens it.** The bounded swap (`P4-003`) and stake (`P5-002`) have fork and live chain-97 execution evidence on the labelled `testnet-demo` MandateExecutor ([swap](docs/evidence/bsc-testnet.phase4-swap-journey.json), [stake](docs/evidence/bsc-testnet.phase5-stake-journey.json)). The separately [deployed production executor](deployments/bsc-testnet.perago.json) requires a bound ERC-8183 job, not yet created by Perago.
The API has wallet authentication, policy compilation, simulation, EIP-712 signing, a durable executor queue, and [fork-proven finalized public receipt queries](docs/evidence/bsc-testnet.fork.phase5-stake-journey.json). The evaluator's completion, rejection, and independent refund paths are [proven on a chain-97 fork](docs/evidence/bsc-testnet.fork.phase6-evaluator.json), not deployed on testnet; no hosted receipt API or live Perago payment is claimed.

Proven on BNB Smart Chain Testnet (chain 97), with per-run reports in [`docs/evidence/`](docs/evidence/) and pinned addresses in [`deployments/`](deployments/):

- a semi-modular ERC-4337 account controlled by an external owner, driven by owner-paid **and** fully sponsored UserOperations;
- a bounded session that performs its one allowlisted call and is rejected for an unrelated target, an unallowlisted selector, module install, a self-call, an over-limit spend, an expired window, and after revocation;
- user-controlled MetaMask signatures activating and revoking one Wallet Policy, each through one atomic root UserOperation that changes the bounded account permission and MandateExecutor policy together;
- a PancakeSwap V3 exact-input swap, a CAKE Pool stake, and a fee-bearing unstake, all executed by the smart account;
- an ERC-8183 job lifecycle on the official BNB APEX kernel: completion paying the provider, evaluator rejection refunding the client, and permissionless expiry refund;
- one natural-language swap carried end to end on the labelled `testnet-demo` MandateExecutor (`SC-D-006`). It covers policy activation, simulation, the signed digest, authorize, begin, the executor's perform UserOperation, the measured output, and a verified receipt. Replays and a tampered spend, minimum, recipient, adapter, selector, target, or action are all refused ([`docs/evidence/bsc-testnet.phase4-swap-journey.json`](docs/evidence/bsc-testnet.phase4-swap-journey.json)). Payment is Phase 6.
- one natural-language stake carried end to end on the same executor. The simulation commits the recipient's position holder, its shares, and the CAKE Pool fees. The executor's perform UserOperation mints pool shares above the signed minimum, and a worker killed right after persisting it recovers without a second submission. A second stake simulated against the old position is refused `STALE_POSITION`. Only the account can withdraw, and the owner withdrew the stake minus the 0.1% early fee ([`docs/evidence/bsc-testnet.phase5-stake-journey.json`](docs/evidence/bsc-testnet.phase5-stake-journey.json)).

Also built: the approved Perago landing shell, Foundry invariant tests, PostgreSQL lifecycle constraints and replay-safe projections, and one-use root-wallet authentication. `P3-002` policy activation/revocation is proven on chain 97 ([evidence](docs/evidence/bsc-testnet.p3-policy-live.json)); that earlier deployment is explicitly policy-probe-only. Not built yet: production ERC-8183 job creation/automated settlement and the product web journey.

## Planned repository map

```text
apps/
  web/       Approved Perago landing shell; product journeys remain pending
  api/       Persistence, wallet auth, policy, compiler, simulation, signing, receipt query, execution queue
  executor/  Constrained autonomous execution worker and existing probes
packages/
  sdk/       Shared schemas, ABIs, typed clients
  contracts/ Foundry mandate, adapters, verifiers, settlement
docs/        Product and technical sources of truth
```

The SDK owns domain/account/action types, the evaluator ABI, and the public receipt schema; the API and worker reconcile against onchain mandate status and verification commitments. `P6-002` proves manual, receipt-bound settlement on a fork; `P6-003` must automate and index finalized live settlement.

## Documentation

- [Product requirements](docs/PRD.md)
- [Architecture](docs/technical/ARCHITECTURE.md)
- [Data model](docs/technical/ERD.md)
- [Smart-contract and security specification](docs/technical/SMART-CONTRACT.md)
- [BNB and protocol integrations](docs/technical/INTEGRATION.md)
- [Technology decisions](docs/technical/TECH-STACK.md)
- [Phased build plan](docs/BUILD-PLAN.md)
- [Lessons and verified preferences](docs/LESSONS.md)
- [Agent operating contract](AGENTS.md)

## Honest limitations

- The production MandateExecutor is deployed on chain 97, but it requires a bound ERC-8183 job; successful swap/stake mandate journeys used the separately labelled `testnet-demo` executor. Public receipt queries are verified on a chain-97 fork, not a hosted production API.
- ERC-8183 and ERC-8004 are draft standards; integration details can change. The immutable OutcomeEvaluator is fork-proven but not deployed; its APEX proxy can be upgraded by the upstream owner, and automated outcome-linked settlement remains `P6-003`.
- Session and staking paths have fork and testnet evidence; production job creation and payment-token binding remain gated by the technical integration specification.
- Simulation reduces execution risk but cannot guarantee future chain state.
- The MVP deliberately supports only two closed action types and a minimal protocol allowlist.
