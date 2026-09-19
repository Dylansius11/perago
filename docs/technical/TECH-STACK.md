# Perago Technology Stack

**Status:** Approved foundation choices; dependency installation begins only after the documentation gate
**Version snapshot:** Registry/official-source checks performed 2026-09-17

## 1. Version policy

Perago uses the latest **stable, non-prerelease** release that passes the repository's compatibility and behavior probes at the start of the implementation phase.

Rules:

1. Pin runtime, package-manager, direct dependency, Solidity compiler, and Foundry versions exactly. No `latest`, `*`, unbounded Git branch, caret, or tilde ranges in committed manifests.
2. Commit one `pnpm-lock.yaml`; CI uses `pnpm install --frozen-lockfile`.
3. Prefer an Active/Maintenance LTS runtime over a newer Current runtime. “Latest stable” for Node means latest patch of the newest LTS line.
4. Reject alpha, beta, RC, canary, nightly, and deprecated integration paths.
5. Before first install, re-query official registries/releases. If this snapshot is no longer current, use the newer stable release and record the compatibility smoke result in the bootstrap PR.
6. If the newest stable dependency is incompatible, pin the newest compatible stable release and document the exact upstream constraint/failure. Do not silently downgrade.
7. Update dependencies in coherent review units with focused build/type/test/runtime evidence; automated version churn is not merged without behavior checks.
8. Pin smart-contract integrations by chain, address, source revision, ABI, runtime code hash, and proxy implementation/admin—not package semver alone.

The versions below are a verified planning baseline, not installed dependencies in this documentation-only phase.

## 2. Stable baseline

| Component | Baseline | Evidence / note |
| --- | ---: | --- |
| Node.js | `24.21.0` LTS | Node official release page lists v24 Krypton as LTS and this latest branch patch. Do not use v26 Current for production. |
| pnpm | `12.4.2` | npm registry stable tag queried 2026-09-17; activate with Corepack. |
| Turborepo | `2.10.13` | npm registry stable tag. |
| TypeScript | `7.0.2` | npm registry stable tag; bootstrap must prove Next/Hono/Drizzle/Alchemy type compatibility. |
| Next.js | `16.3.5` | npm registry stable tag. |
| React / React DOM | `19.3.0` | npm registry stable tags. |
| Hono | `4.13.8` | npm registry stable tag. |
| Zod | `4.6.5` | npm registry stable tag. |
| Drizzle ORM / Kit | `0.45.2` / `0.31.10` | npm registry stable tags. |
| `postgres` driver | `3.4.9` | npm registry stable tag. |
| PostgreSQL | `18.6` | PostgreSQL official docs list latest stable 18.x patch; managed target must expose equivalent supported version. |
| Viem | `2.56.7` | npm registry stable tag. |
| Wagmi | `3.7.7` | npm registry stable tag. |
| TanStack Query | `5.103.1` | npm registry stable tag; use only where Wagmi/client state requires it. |
| Alchemy AA SDK (`@aa-sdk/core`) | `4.88.5` | npm registry stable tag; its `viem ^2.45.0` peer passes against Perago's pinned Viem baseline. |
| Legacy Alchemy AA SDK (`@alchemy/aa-core`) | `3.19.0` | npm registry stable tag, but its exact `viem 2.8.6` peer conflicts with the selected Viem baseline; do not install it. |
| Biome | `2.5.14` | npm registry stable tag. |
| Vitest | `5.0.1` | npm registry stable tag; keep only behavior tests that meet root verification rules. |
| Solidity | `0.8.37` | `solc` npm stable tag; Foundry config pins exact compiler and optimizer settings. |
| Foundry | `1.8.3` | Latest non-prerelease immutable GitHub release on 2026-09-17. |
| OpenZeppelin Contracts | `5.6.1` | npm registry stable tag; install as a pinned Git submodule/tag or exact dependency according to Foundry convention. |
| `forge-std` | `v1.16.2` | Latest non-prerelease GitHub release; installed as a pinned Git submodule at `packages/contracts/lib/forge-std`. Supplies the cheatcode surface, fuzz assertions, and `StdInvariant` the Phase 2 invariant suite requires. |

Official version sources: [Node releases](https://nodejs.org/en/about/previous-releases), [npm registry](https://www.npmjs.com/), [PostgreSQL documentation](https://www.postgresql.org/docs/), and [Foundry releases](https://github.com/foundry-rs/foundry/releases).

## 3. Workspace and language

### pnpm + Turborepo

Selected for one TypeScript workspace with explicit package boundaries and cached, dependency-aware tasks. pnpm provides a strict content-addressed dependency graph; Turborepo coordinates `build`, `typecheck`, `lint`, and focused test tasks.

Keep the root small:

```text
package.json
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
biome.json
pnpm-lock.yaml
apps/*
packages/*
```

Do not add Nx, custom build orchestration, workspace generators, changesets, or release tooling until a concrete need exists.

### TypeScript

Use strict TypeScript with:

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride`;
- ESM throughout;
- no `any` at trust boundaries;
- Zod parsing before values enter domain code;
- `bigint` for chain/token amounts and nonces;
- explicit domain types from `packages/sdk` rather than duplicate app-local interfaces.

TypeScript 7 is accepted only after the bootstrap compatibility probe. If a selected framework's published peer/tooling range rejects it, the implementation PR must pin the newest supported stable TypeScript and cite the constraint.

## 4. Web application

### Next.js + React

Selected for the future web client because it provides stable routing/build/deployment and integrates with Wagmi/Viem. The client remains a thin consumer of canonical SDK types and API facts.

- Use Next App Router and React Server Components only where they reduce shipped client code.
- Wallet, signature, and live transaction interactions are client boundaries.
- Do not create a backend-for-frontend that duplicates Hono domain logic.
- Do not add Redux, a form framework, component kit, CSS framework, motion library, or design tokens before the user provides UI/design direction and Phase 7 begins.
- TanStack Query is present through the wallet/data stack; do not add a second server-state cache.

### Wallet connection and account abstraction

- Wagmi supplies standard connector state and React wallet hooks.
- Viem owns chain definitions, typed-data hashing, contract reads/writes, event decoding, and transaction simulation.
- Alchemy's current minimal AA SDK (`@aa-sdk/core`) establishes the selected Modular Account V2 client/type baseline. Defer broader Account Kit runtime modules until `P1-003` proves the exact BSC Testnet permission path; `packages/sdk` must not depend on them.
- `packages/sdk` wraps only Perago domain behavior; it must not hide native Wagmi/Viem hooks behind an unnecessary custom client layer.
- External wallet remains the root owner. No embedded-wallet dependency is added for MVP.

## 5. API

### Hono on Node.js

Selected for a small, standards-based HTTP surface with low framework weight. Run as a long-lived Node process for the hackathon; do not couple domain code to a specific serverless runtime.

Responsibilities:

- wallet challenge/session authentication;
- TaskIntent ingestion;
- planner structured-output parsing;
- policy intersection;
- action compilation and simulation;
- mandate persistence and queueing;
- lifecycle and public receipt queries.

Use Hono middleware only for transport concerns. Domain functions accept typed values, not request/context objects. Generate an OpenAPI document only if it is used by the web/SDK or demo review; do not install a documentation stack preemptively.

### AI provider

No provider is selected in the foundation phase because model availability, structured-output behavior, and hackathon credits can change. Phase 3 chooses one provider after a fixed-schema evaluation. The adapter surface is one function that returns untrusted JSON; Zod plus deterministic policy owns correctness.

Do not install a multi-provider AI framework unless the selected provider's official SDK cannot meet structured output, timeout, cancellation, and no-training requirements. One direct official SDK is preferred over speculative portability.

## 6. Executor and indexer

Use separate Node.js process entry points under `apps/executor`:

- worker: leased database jobs, UserOperation/transaction reconciliation, authorize/begin/perform/settle;
- indexer: confirmed log ingestion, reorg detection, checkpointed projection rebuild.

They may deploy in one service with separate commands for the demo but remain separately runnable. Use Postgres row leases and `FOR UPDATE SKIP LOCKED`; do not add Redis, BullMQ, Kafka, Temporal, or a workflow engine for one worker and low volume.

The executor uses Viem and Alchemy's supported smart-account APIs. It never imports browser connector code, receives a root private key, or treats a provider response as final before chain reconciliation.

## 7. Database

### PostgreSQL + Drizzle

PostgreSQL owns durable offchain workflow, immutable authored records, raw chain events, projections, and the leased queue. Drizzle provides typed schema/migrations without hiding SQL constraints or transaction semantics.

- Use SQL migrations checked into `apps/api` or a dedicated database directory within that app; no extra shared package.
- Express unique, partial, check, and foreign-key constraints in the database.
- Use `jsonb` only for versioned canonical documents/evidence; indexed state and identities get typed columns.
- Use `bytea` for addresses/hashes/signatures and `numeric(78,0)` for uint256 values.
- Use the `postgres` driver with bounded pools per process.
- No Supabase client, ORM repository abstraction, or database-per-service in MVP.

Managed PostgreSQL 18.6 is preferred. If the deployment provider offers only a supported older major, use its newest patched supported version and record the platform constraint; schema features must remain portable.

## 8. Contracts

### Solidity + Foundry + OpenZeppelin

Foundry owns compilation, formatting, scripts, focused unit tests, fuzzing, invariant tests, and fork tests. OpenZeppelin supplies audited primitives such as EIP-712, ECDSA, SafeERC20, and reentrancy protection; copy no vendored contract implementation by hand.

- Pin `solc 0.8.37`, EVM version, optimizer settings, Foundry `1.8.3`, and OpenZeppelin `5.6.1` at implementation bootstrap after compatibility compilation.
- Use a tagged/pinned dependency revision with reproducible remappings.
- Contracts are non-upgradeable for MVP.
- Deployment manifests include chain, addresses, compiler/settings, source commit, bytecode/code hashes, constructor arguments, and admin state.
- Slither or another static analyzer is added only if it runs reliably in CI and produces reviewed signal; Foundry checks and manual invariant review remain mandatory.

Hardhat is rejected for Perago contracts because Foundry already covers the required Solidity build, fuzz, invariant, script, and fork workflow. Upstream APEX may continue to be consumed through its pinned ABI/deployment regardless of its build tool.

## 9. Validation and formatting

### Biome

One formatter/linter for supported TypeScript/JSON files. Use its stable recommended rules, then add only rules that enforce documented invariants or prevent observed defects. Avoid running ESLint and Prettier beside Biome unless Next/third-party behavior creates a concrete unsupported check.

### Tests

- Vitest for uncertain pure-domain/backend behavior and lifecycle integration tests.
- Foundry for all contract tests.
- Browser verification for later UI behavior; no UI test framework or screenshot suite before Phase 7.
- Throwaway smoke scripts for deployment/integration proof are removed or promoted only when they protect a plausible regression.

## 10. Deployment targets

### Hackathon target

| Component | Target | Reason |
| --- | --- | --- |
| Web | Vercel | Native stable Next deployment and preview URLs. |
| API | Railway long-lived service | Hono Node process, straightforward secrets/networking. |
| Executor/indexer | Railway worker services | Persistent processes and shared managed network. |
| Database | Railway managed PostgreSQL | One operational plane with API/workers; use newest supported patched major. |
| Contracts | BSC Testnet chain 97 | Official target and explorer-verifiable evidence. |
| RPC | Alchemy primary plus independent BNB-compatible fallback | AA integration plus disagreement/recovery path. |
| Bundler/paymaster | Alchemy, with validated standards-compatible fallback | Official BNB Testnet support and gas sponsorship. |

Deployment files are not created until the corresponding phase. Do not commit `.vercel`, `.railway`, environment values, generated wallet files, or provider state.

### Local prerequisites

- Node.js `24.21.0` LTS (or the re-verified latest v24 LTS patch);
- Corepack with pnpm `12.4.2`;
- Git;
- Foundry `1.8.3`;
- Docker only if a local PostgreSQL instance is needed; no Docker requirement for ordinary package tasks;
- access to BSC Testnet RPC/bundler and disposable funded test accounts for integration phases.

Windows development must work from PowerShell/Git Bash without POSIX-only package scripts. Contract scripts may document WSL if Foundry's native environment requires it, but CI remains Linux.

## 11. Dependency-minimization rules

Before adding a dependency, record which required behavior it replaces and why platform/standard library/current dependencies cannot do it. Reject:

- generic utility libraries for native JS operations;
- Axios beside standards `fetch`/Hono;
- ethers beside Viem;
- duplicated schema/type clients beside Zod/SDK;
- a queue/broker beside Postgres leases;
- a second wallet/account-abstraction provider in the happy path;
- SDK wrappers that obscure calldata, approvals, or signatures;
- observability platforms before structured logs/metrics identify a need;
- UI/design libraries before user design direction.

A dependency that touches signing, account permissions, calldata, funds, verification, or settlement requires source/version review and a focused adversarial smoke scenario.

## 12. Keep/reject decisions

| Choice | Keep | Reject / defer |
| --- | --- | --- |
| Workspace | pnpm + Turborepo | npm workspaces, Yarn, Nx |
| Runtime | Node 24 LTS | Node 26 Current, Bun production runtime |
| Web | Next 16 + React 19 | inherited UI, premature component/design frameworks |
| API | Hono | heavyweight controller/DI framework |
| Data | PostgreSQL + Drizzle | document database, Supabase-specific client coupling |
| Chain | Viem + Wagmi | ethers duplication, handwritten ABI encoders |
| AA | Alchemy Modular Account V2/Wallet APIs | Privy embedded wallet path, unconfirmed Biconomy BSC testnet path, mandate-free sessions |
| Contracts | Solidity + Foundry + OpenZeppelin | Hardhat for Perago-owned contracts, custom crypto/token libraries |
| Queue | Postgres leases | Redis/BullMQ/Kafka/Temporal |
| Quality | Biome + TypeScript + focused tests | parallel ESLint/Prettier stack without a gap |
| Identity | external root wallet + smart account | mandatory email/social identity and ERC-8004 in MVP |

## 13. Bootstrap compatibility gate

Before committing the implementation workspace:

1. re-query every baseline version and official release status;
2. initialize exact versions without product code;
3. build one empty Next route, one Hono health handler, one executor entry, one SDK schema, and one Foundry contract solely as toolchain probes;
4. type-check/build all workspaces under TypeScript 7;
5. compile Foundry with Solidity/OpenZeppelin pins;
6. instantiate a Viem BSC Testnet client and type a Modular Account V2 configuration without submitting funds;
7. run Biome and the minimal test commands;
8. resolve peer/version conflicts by upgrading to current stable or documenting the newest compatible stable fallback;
9. remove probe-only code that does not belong in the accepted package skeleton;
10. commit the exact manifests and lockfile as one coherent bootstrap checkpoint.

Passing this gate proves version compatibility only; it is not product implementation or integration evidence.
