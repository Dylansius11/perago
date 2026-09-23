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

**Phases 1 and 2 are complete; Phase 3 is complete through `P3-003`, and `P3-004` is the next unopened task.** The SDK owns the canonical mandate, policy, planner-candidate, compiled-plan, and policy-decision domains; MandateExecutor has authorization, accepted-attempt, and invariant proof; and the API has constrained PostgreSQL persistence, signed wallet authentication, authenticated policy routes, deterministic onchain-transition verification, and an untrusted Groq planner feeding a deterministic compiler that reports every Wallet Policy rule.

Proven on BNB Smart Chain Testnet (chain 97), with per-run reports in [`docs/evidence/`](docs/evidence/) and pinned addresses in [`deployments/`](deployments/):

- a semi-modular ERC-4337 account controlled by an external owner, driven by owner-paid **and** fully sponsored UserOperations;
- a bounded session that performs its one allowlisted call and is rejected for an unrelated target, an unallowlisted selector, module install, a self-call, an over-limit spend, an expired window, and after revocation;
- user-controlled MetaMask signatures activating and revoking one Wallet Policy, each through one atomic root UserOperation that changes the bounded account permission and MandateExecutor policy together;
- a PancakeSwap V3 exact-input swap, a CAKE Pool stake, and a fee-bearing unstake, all executed by the smart account;
- an ERC-8183 job lifecycle on the official BNB APEX kernel: completion paying the provider, evaluator rejection refunding the client, and permissionless expiry refund.

Also built: the approved Perago landing shell, 113 passing Foundry contract tests, local PostgreSQL lifecycle constraints and reorg-safe projections, one-use root-wallet challenge authentication, and the policy activation/revocation service. `P3-002` is closed by the owner-paid BSC Testnet activation and revocation evidence in [`docs/evidence/bsc-testnet.p3-policy-live.json`](docs/evidence/bsc-testnet.p3-policy-live.json). Its MandateExecutor deployment is explicitly policy-probe-only: production adapters/verifiers and the production execution window remain later work. Not built yet: planner/compiler, simulations, executor service, production adapters/verifiers, settlement evaluator, or the full product journey.

## Planned repository map

```text
apps/
  web/       Approved Perago landing shell; product journeys remain pending
  api/       Persistence, wallet authentication, policy lifecycle; compiler/simulation pending
  executor/  Constrained autonomous execution worker and existing probes
packages/
  sdk/       Shared schemas, ABIs, typed clients
  contracts/ Foundry mandate, adapters, verifiers, settlement
docs/        Product and technical sources of truth
```

Current source includes the SDK domain/account layer, MandateExecutor contracts and proofs, executor probes, the approved landing shell, and API persistence, authentication, policy, chain-verification, planner, and compiler infrastructure. Phase 3 stops after completed `P3-003`; `P3-004` starts only on explicit user instruction.

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

- Perago has a locally implemented and invariant-tested `MandateExecutor`, but no live API endpoint, contract deployment, or signed MandateExecutor transaction evidence yet; the account-abstraction proof is local replay of verified chain-97 bytecode, not a submitted MandateExecutor operation.
- ERC-8183 and ERC-8004 are draft standards; integration details can change.
- Session-key, staking, payment-token, and testnet deployment capabilities remain gated on source and onchain validation described in the technical documents.
- Simulation reduces execution risk but cannot guarantee future chain state.
- The MVP deliberately supports only two closed action types and a minimal protocol allowlist.
