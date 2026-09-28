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

**Phases 1–5 and `P6-001`–`P6-003` are complete at their specified evidence gates; Phase 6 automated settlement is fork-proven, not live.** The bounded swap (`P4-003`) and stake (`P5-002`) have fork and live chain-97 execution evidence on the labelled `testnet-demo` MandateExecutor ([swap](docs/evidence/bsc-testnet.phase4-swap-journey.json), [stake](docs/evidence/bsc-testnet.phase5-stake-journey.json)). The separately [deployed production executor](deployments/bsc-testnet.perago.json) requires a bound ERC-8183 job.
The API has wallet authentication, policy compilation, bound-job simulation, EIP-712 signing, a durable executor queue, and finalized public receipt queries. [Fork evidence for `P6-003`](docs/evidence/bsc-testnet.fork.phase6-settlement-smoke.json) drives the production executor with an APEX job and a locally deployed evaluator: a payment outage leaves execution `SUCCEEDED/PENDING`, restart settles once, and a failed execution refunds without paying the provider. Independent evaluator completion, rejection, and expiry refunds are [proven on a chain-97 fork](docs/evidence/bsc-testnet.fork.phase6-evaluator.json). No hosted receipt API, live evaluator, or live Perago payment is claimed.
For hosted deployment at `P8-001`, the user chose Supabase managed PostgreSQL instead of the originally planned Railway database. This changes the host, not the PostgreSQL/Drizzle schema or driver; local PostgreSQL is for isolated development and fork verification only. No Supabase service or live evaluator deployment is claimed yet.

Proven on BNB Smart Chain Testnet (chain 97), with per-run reports in [`docs/evidence/`](docs/evidence/) and pinned addresses in [`deployments/`](deployments/):

- a semi-modular ERC-4337 account controlled by an external owner, driven by owner-paid **and** fully sponsored UserOperations;
- a bounded session that performs its one allowlisted call and is rejected for an unrelated target, an unallowlisted selector, module install, a self-call, an over-limit spend, an expired window, and after revocation;
- user-controlled MetaMask signatures activating and revoking one Wallet Policy, each through one atomic root UserOperation that changes the bounded account permission and MandateExecutor policy together;
- a PancakeSwap V3 exact-input swap, a CAKE Pool stake, and a fee-bearing unstake, all executed by the smart account;
- an ERC-8183 job lifecycle on the official BNB APEX kernel: completion paying the provider, evaluator rejection refunding the client, and permissionless expiry refund;
- one natural-language swap carried end to end on the labelled `testnet-demo` MandateExecutor (`SC-D-006`). It covers policy activation, simulation, the signed digest, authorize, begin, the executor's perform UserOperation, the measured output, and a verified receipt. Replays and a tampered spend, minimum, recipient, adapter, selector, target, or action are all refused ([`docs/evidence/bsc-testnet.phase4-swap-journey.json`](docs/evidence/bsc-testnet.phase4-swap-journey.json)). Payment is Phase 6.
- one natural-language stake carried end to end on the same executor. The simulation commits the recipient's position holder, its shares, and the CAKE Pool fees. The executor's perform UserOperation mints pool shares above the signed minimum, and a worker killed right after persisting it recovers without a second submission. A second stake simulated against the old position is refused `STALE_POSITION`. Only the account can withdraw, and the owner withdrew the stake minus the 0.1% early fee ([`docs/evidence/bsc-testnet.phase5-stake-journey.json`](docs/evidence/bsc-testnet.phase5-stake-journey.json)).

Also built: the approved Perago landing shell, Foundry invariant tests, PostgreSQL lifecycle constraints and replay-safe projections, one-use root-wallet authentication, and a Phase 7 console in progress. Its [disposable chain-97 fork browser journeys](docs/evidence/bsc-testnet.fork.phase7-browser.json) exercise wallet/chain refusal, root account/policy setup, a fork-only faucet claim and repeat refusal, bounded swap and stake, stale quote, provider outage recovery, revocation, onchain expiry, verifier failure, exact-signature replay without another execution, and public receipts. Separately, a [0.02 tBNB faucet claim](docs/evidence/bsc-testnet.p7-faucet-claim.json) succeeded on live chain 97; this is not a live browser journey or a hosted product deployment. Browser evidence for bound ERC-8183 settlement and user visual review remain open. `P3-002` policy activation/revocation is proven on chain 97 ([evidence](docs/evidence/bsc-testnet.p3-policy-live.json)); that earlier deployment is explicitly policy-probe-only. Production ERC-8183 job provisioning UI and live evaluator/payment remain ahead.

Local fork tests reset PostgreSQL's public schema. `dev:fork` now accepts only the existing local `perago_dev` logical database, not the separate `perago_test` integration database; two containers using different ports but the same Docker volume must not run simultaneously.

### Local testnet-demo console

`pnpm run dev` starts the web app only; it does not boot PostgreSQL, API, or executor. On a development machine, provision a **separate migrated local PostgreSQL database** for `PERAGO_DATABASE_URL` (never `perago_test`, which integration tests reset, or `perago_dev`, which `dev:fork` resets). Configure the server-only values in ignored `.env` per [`.env.example`](.env.example); do not copy secrets into `NEXT_PUBLIC_*`. The API and worker must use the same labelled `deployments/bsc-testnet.demo.perago.json` manifest for the current console, because the production executor requires a bound ERC-8183 job the browser cannot yet provision. A shell-exported variable can override `.env`, so set the non-secret manifest/URL explicitly in each PowerShell terminal:

```powershell
$env:PERAGO_DEPLOYMENT_MANIFEST="deployments/bsc-testnet.demo.perago.json"
pnpm --filter @perago/api start
```

```powershell
$env:PERAGO_DEPLOYMENT_MANIFEST="deployments/bsc-testnet.demo.perago.json"
$env:PERAGO_API_URL="http://127.0.0.1:8787"
pnpm --filter @perago/executor start
```

```powershell
pnpm run dev
```

Check `http://127.0.0.1:8787/health`, `http://127.0.0.1:8787/config` (`deploymentLabel: testnet-demo`), `http://127.0.0.1:8081/readyz` if that worker health port is configured, and `http://localhost:3000/app`. This is **live chain 97**: the faucet uses actual testnet funds and the worker can execute an owner-authorized demo mandate. No live ERC-8183 payment is implied.

## Planned repository map

```text
apps/
  web/       Approved landing shell; policy/mandate/receipt console and faucet surface in progress
  api/       Persistence, wallet auth, policy, compiler, simulation, signing, receipt query, execution queue
  executor/  Constrained autonomous execution worker and existing probes
packages/
  sdk/       Shared schemas, ABIs, typed clients
  contracts/ Foundry mandate, adapters, verifiers, settlement
docs/        Product and technical sources of truth
```

The SDK owns domain/account/action types, the evaluator ABI, and the public receipt schema; the API and worker reconcile against onchain mandate status and verification commitments. `P6-002` proves manual, receipt-bound settlement on a fork; `P6-003` proves automated payment/refund and finalized payment indexing on a fork using the production MandateExecutor. Live evaluator deployment and hosted proof belong to `P8-001`.

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
- ERC-8183 and ERC-8004 are draft standards; integration details can change. The immutable OutcomeEvaluator is fork-proven but not deployed; its APEX proxy can be upgraded by the upstream owner. `P6-003` automation has fork proof only, not a live bound settlement.
- Session and staking paths have fork and testnet evidence; production job provisioning and live payment remain gated by the technical integration specification.
- Simulation reduces execution risk but cannot guarantee future chain state.
- The MVP deliberately supports only two closed action types and a minimal protocol allowlist.
