# Perago Agent Operating Contract

## Mission

Perago is a bounded execution layer for onchain agents: it turns a plain-English goal into a one-time onchain mandate, executes only within explicit limits, proves the requested outcome, and permanently drops its authority.

Product lines:

- **Intent, carried through.**
- **Give the goal, not the wallet.**

Optimize for a judge-verifiable, security-first product. AI may propose and explain; deterministic policy, contracts, adapters, and verifiers authorize and prove.

## Current gate

The repository is in the documentation-foundation phase. Do not implement application code, contracts, infrastructure, UI, visual assets, or a design system until the documentation PR is accepted and the user gives the next instruction.

The user will supply Perago's UI and design direction later. Do not invent screens, component systems, CSS, tokens, logos, mockups, or visual specifications before that direction arrives.

## Sources of truth

Each fact has one canonical owner. Link to it instead of duplicating it.

| Concern | Canonical document |
| --- | --- |
| Product scope, requirements, success criteria | `docs/PRD.md` |
| System boundaries, flows, state machines | `docs/technical/ARCHITECTURE.md` |
| Data ownership, schema, synchronization | `docs/technical/ERD.md` |
| Mandate contracts, threats, invariants | `docs/technical/SMART-CONTRACT.md` |
| Chains, protocols, external capabilities | `docs/technical/INTEGRATION.md` |
| Technology and deployment choices | `docs/technical/TECH-STACK.md` |
| Delivery phases, task IDs, acceptance gates | `docs/BUILD-PLAN.md` |
| Repository entry point and current status | `README.md` |

Priority when sources disagree: current user instruction, accepted PRD, accepted technical specifications, build plan, implementation. Correct the lower-priority source in the same change.

External integration claims require a primary-source link and an explicit status: `verified`, `proposed`, `needs re-verification`, or `blocked`. Existing experiments are evidence, not proof of current third-party behavior.

## Non-negotiable product and security invariants

1. AI may narrow authority, never create or widen it.
2. Protected assets are never valid spend inputs.
3. Every executable target and function selector is explicit and allowlisted.
4. Arbitrary calldata and unlimited ERC-20 approvals are forbidden.
5. A Task Mandate binds owner, authorized executor, chain, nonce, expiry, action commitment, spend bounds, recipient, and postcondition commitment.
6. A mandate can be consumed at most once.
7. Success, terminal failure, expiry, or revocation permanently ends authority.
8. Payment follows adapter-specific deterministic verification, never model judgment.
9. Owner seed phrases and private keys never enter the model, API, executor logs, or repository.
10. UI controls are not security boundaries. Enforcement belongs in the signer/session, smart account, and contract execution path.
11. If a session system cannot prove one-use and calldata/effect constraints, use the specified minimal Mandate Executor; never claim unsupported guarantees.
12. Onchain truth wins over offchain caches. Reconciliation must be deterministic and replay-safe.

A change that weakens an invariant is blocked until the user explicitly approves an updated PRD and security specification.

## Repository boundaries

Target shape after the implementation gate opens:

```text
apps/
  web/       New Perago client; no inherited product UI
  api/       Policy compilation, simulation, mandate lifecycle, receipts
  executor/  Constrained execution worker
packages/
  sdk/       Shared schemas, ABIs, typed clients
  contracts/ Foundry contracts and invariant tests
docs/
```

Do not add speculative packages.

### Import rules

- `apps/*` may import public APIs from `packages/sdk`; they must not import one another.
- `apps/*` must not import contract source or generated build directories directly. `packages/sdk` owns published ABIs and addresses.
- `packages/contracts` must not depend on JavaScript application packages.
- Shared domain schemas live in `packages/sdk`; do not create parallel app-local versions.
- Protocol-specific behavior lives behind explicit adapters. Core mandate logic must not depend on a vendor SDK.
- Database code stays in `apps/api`; the executor consumes typed API/SDK contracts rather than database internals.
- Environment-specific addresses belong in validated deployment manifests, never scattered literals.

## Migration and clean cutover

Perago is a new product, not a rename or UI reskin. The reference repository is read-only research.

Potential reuse requires a symbol-level audit, current tests, adaptation to Perago domain types, and provenance in the PR. Never copy secrets, generated wallets, deployment state, caches, untracked files, old product routes, marketplace schemas, fixtures, UI, branding, or Git history.

When a contract or interface changes, migrate every caller and remove the obsolete path in the same change. Do not add compatibility shims, deprecated aliases, dual schemas, or fallback behavior unless the user explicitly requires a staged migration.

## Working agreement

### Branches and pull requests

- `main` is protected release history.
- Develop on `dev`; use focused feature branches from `dev` after the foundation phase when parallel review is useful.
- Merge reviewed work into `main` through a PR using a merge commit; never squash or rebase-merge.
- Never force-push shared branches.
- Commit frequently at coherent review boundaries. A commit must leave its changed surface internally consistent and must not contain unrelated cleanup.
- Keep the worktree clean at completed checkpoints.

### Before implementation

1. Read the canonical documents for the affected requirement IDs.
2. Trace current code and all callers before changing an exported symbol.
3. Reuse one existing convention; do not introduce a second pattern for the same concern.
4. Resolve reachable decisions through code or primary sources. Record only genuinely external uncertainty as a decision gate with an owner and validation method.
5. Reject work that bypasses an accepted requirement, security invariant, or phase hold point.

### Verification standards

- **Documentation:** validate internal links, requirement/task/acceptance traceability, terminology, states, external source status, and absence of placeholders or stale product language.
- **Contracts:** run formatting, compilation, focused unit tests, fuzz tests, and invariant tests. Exercise replay, expiry, revocation, authorization, approval cleanup, adapter failure, verifier failure, and reentrancy paths on a fork or target testnet where integration behavior matters.
- **API:** type-check, lint, run focused behavior tests, and smoke the real request path with deterministic fixtures. Verify idempotency and persisted state transitions.
- **Executor:** test restart/retry behavior, nonce ownership, duplicate delivery, stale simulation, timeout, and terminal-state recovery. Smoke against the selected testnet adapter before claiming integration success.
- **Web:** wait for user-provided design direction. Then verify the actual browser surface, wallet states, keyboard access, responsive behavior, transaction rejection, and error recovery. A component test alone is not visual proof.
- **Integration:** distinguish local mocks, fork evidence, testnet evidence, and mainnet facts. Record chain, address, transaction, timestamp, and source for claims.

Never report a command, test, deployment, transaction, or integration as successful unless it was observed in the current repository or linked to verifiable evidence.

## Secrets and generated state

Never commit or paste:

- seed phrases, private keys, session keys, API tokens, cookies, or credentials;
- `.env*` values other than reviewed placeholders in `.env.example`;
- generated wallets, deployment bindings, local database contents, caches, build output, or machine-local configuration;
- third-party data whose license or provenance is unknown.

Use least-privilege test accounts and disposable funded testnet wallets. Redact sensitive values from logs and PR descriptions. If secret exposure is suspected, stop, preserve only non-secret evidence, rotate the credential, and notify the user.

## Error and blocker escalation

Do not hide failures with mocks, broad catches, fallback success, skipped checks, or fabricated data.

When blocked:

1. Finish all work that does not depend on the blocker.
2. State the failed invariant or acceptance criterion.
3. Provide the exact command, response, or primary-source evidence.
4. Name the decision owner and the smallest safe options.
5. Recommend one option and stop before irreversible or security-sensitive action.

Conflicting product or security choices require user resolution. Tooling failures do not: investigate and repair them when safe.

## Self Learning Logs

Newest entries first. Each entry records a root cause and a durable operating rule.

- Root cause: a third-party RPC client included the endpoint in an error string, exposing an Alchemy app key in a supervised-process log. Rule: redact URLs before logging caught provider errors; rotate a leaked credential before any retry.

## Self Insight Logs

Newest entries first. Each entry records a verified preference and how to apply it.

- The user prefers deep, explicit documentation and acceptance criteria before implementation; make accepted requirements and gates executable before writing product code.
- The user will provide Perago's design system later; do not invent UI or visual direction early.
- The user rejects reuse of the reference product's UI and flow; reuse only audited technical primitives.
- The user wants frequent coherent commits and `dev` development with PRs into protected `main`; checkpoint complete review units and avoid direct feature work on `main`.
- The user expects the highest-quality output and informed action rather than timid scaffolding; investigate first, then deliver complete bounded work.
