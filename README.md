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

**Phase 1 complete.** The workspace, toolchain, and package manifests are pinned; the SDK carries the canonical mandate domain, its cross-stack EIP-712 digest fixture, the bounded Modular Account V2 session encoding, and ABIs generated from the compiled contracts.

Proven on BNB Smart Chain Testnet (chain 97), with per-run reports in [`docs/evidence/`](docs/evidence/) and pinned addresses in [`deployments/`](deployments/):

- a semi-modular ERC-4337 account controlled by an external owner, driven by owner-paid **and** fully sponsored UserOperations;
- a bounded session that performs its one allowlisted call and is rejected for an unrelated target, an unallowlisted selector, module install, a self-call, an over-limit spend, an expired window, and after revocation;
- a PancakeSwap V3 exact-input swap, a CAKE Pool stake, and a fee-bearing unstake, all executed by the smart account;
- an ERC-8183 job lifecycle on the official BNB APEX kernel: completion paying the provider, evaluator rejection refunding the client, and permissionless expiry refund.

Also built: the `MandateExecutor` authorization, accepted-attempt, and atomic failure boundaries, proven by 110 Foundry tests. Not built yet: the adapters, verifiers, settlement evaluator, API, executor service, and any user interface. The web app is a toolchain scaffold only — no CSS entry, no `components.json`, no component source, no design token, and no screen exists, because design direction remains the user's explicit gate.

## Planned repository map

```text
apps/
  web/       Toolchain scaffold; design execution held for the user
  api/       Policy compiler, simulation, lifecycle, receipts
  executor/  Constrained autonomous execution worker
packages/
  sdk/       Shared schemas, ABIs, typed clients
  contracts/ Foundry mandate, adapters, verifiers, settlement
docs/        Product and technical sources of truth
```

Current source is the SDK domain and account-encoding layer, the mandate contract's authorization and execution boundaries, read-only executor probes, and the web scaffold. The adapters, verifiers, API, and client journey begin with their approved tasks.

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

- Perago has no mandate contract implementation, live endpoint, deployment, or signed onchain transaction evidence yet; the account-abstraction proof is local replay of verified chain-97 bytecode, not a submitted UserOperation.
- ERC-8183 and ERC-8004 are draft standards; integration details can change.
- Session-key, staking, payment-token, and testnet deployment capabilities remain gated on source and onchain validation described in the technical documents.
- Simulation reduces execution risk but cannot guarantee future chain state.
- The MVP deliberately supports only two closed action types and a minimal protocol allowlist.
