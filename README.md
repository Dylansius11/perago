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

**Phase 1 in progress.** The workspace, toolchain, and package manifests are pinned. The SDK now carries the canonical mandate domain, its EIP-712 digest fixture, and the bounded Modular Account V2 session encoding; contract interfaces and fixtures are frozen provisionally. Account-abstraction constraints are proven locally against Modular Account V2 bytecode replayed from BNB Smart Chain Testnet, with code hashes recorded in [`deployments/bsc-testnet.account.json`](deployments/bsc-testnet.account.json). No mandate contract, live endpoint, deployment, or signed chain-97 transaction evidence exists yet. UI and design direction remain an explicit later gate; no UI source, design system, or generated interface exists.

## Planned repository map

```text
apps/
  web/       New client after design direction is approved
  api/       Policy compiler, simulation, lifecycle, receipts
  executor/  Constrained autonomous execution worker
packages/
  sdk/       Shared schemas, ABIs, typed clients
  contracts/ Foundry mandate, adapters, verifiers, settlement
docs/        Product and technical sources of truth
```

Current source is limited to the SDK domain and account-encoding layer plus read-only executor probes. The API, web client, and contract implementation begin with their approved Phase 2 and Phase 3 tasks.

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
