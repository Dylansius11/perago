# Perago Agent Operating Contract

## Mission

Perago is a bounded execution layer for onchain agents: it turns a plain-English goal into a one-time onchain mandate, executes only within explicit limits, proves the requested outcome, and permanently drops its authority.

Product lines:

- **Intent, carried through.**
- **Give the goal, not the wallet.**

Optimize for a judge-verifiable, security-first product. AI may propose and explain; deterministic policy, contracts, adapters, and verifiers authorize and prove.

## Current gate

The repository has completed Phase 5. Phase 3 is complete through `P3-004`. By explicit user decision on 2026-09-23, `P4-001` (swap adapter) and `P5-001` (stake adapter with a per-account position holder) were completed ahead of order and the production MandateExecutor is deployed on chain 97. `P4-003` and `P5-002` are complete, each proven on a fork and on the labelled `testnet-demo` MandateExecutor (`SC-D-006`). `P6-001` is open by user request on 2026-09-24 and is implementing the finalized public receipt; do not start `P6-002` or any other later-phase task until the user opens it. Task definitions live in [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md).

The approved `P7-001` landing shell exists by explicit out-of-order authorization. Do not extend product screens, wallet journeys, CSS, tokens, logos, mockups, or visual specifications until the corresponding build-plan task is opened and the user supplies or approves its direction.

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
| Durable technical lessons and verified user preferences | `docs/LESSONS.md` |
| Repository entry point and current status | `README.md` |

Priority when sources disagree: current user instruction, accepted PRD, accepted technical specifications, build plan, implementation. Correct the lower-priority source in the same change.

External integration claims require a primary-source link and an explicit status: `verified`, `proposed`, `needs re-verification`, or `blocked`. Existing experiments are evidence, not proof of current third-party behavior.

## Agent skills

Skills are installed in [`.agents/skills/`](.agents/skills) and are discovered from there by every runtime used on this repository. They are **working method, never authority**: when a skill and a canonical document disagree, the canonical document wins and the work proceeds under the document. No skill may assert a chain address, protocol status, or dependency version; those facts belong to `docs/technical/INTEGRATION.md` and `docs/technical/TECH-STACK.md` alone.

### Routing

Project-role skills first - they carry this repository's decisions. Upstream skills supply method.

| Situation | Skill | Non-negotiable part |
| --- | --- | --- |
| Writing, changing, testing, or deploying any Solidity - `MandateExecutor`, an adapter, a verifier, `OutcomeEvaluator`, storage, events, errors, Foundry tests | `perago-contract-engineer` | The 22-field `TaskMandate`, the legal status transitions, the separate `beginExecution` checkpoint, and the 12 safety invariants are not negotiable for convenience. |
| Touching any external system - EntryPoint, account modules, bundler or paymaster, PancakeSwap, the stake target, the ERC-8183 kernel, payment tokens, RPC | `perago-integration-engineer` | A status moves to `verified` only from a probe run in this repository whose evidence file is committed; the deployed bytecode outranks the standard. |
| Wiring `apps/api` or `apps/executor` - routes, policy engine, planner adapter, compiler, simulation, schema, leased queue, indexer, reconciliation | `perago-backend-wiring` | No database row can turn a failed onchain mandate into success; idempotency is a schema constraint, not an application `if`. |
| Closing any task, or changing a claim, status, address, version, scope, or decision | `perago-proof-engineer` | Same-change document synchronization, honest evidence labels, and a `BUILD-PLAN.md` checkbox that flips only on passing criteria. |
| Reviewing authority, signatures, keys, session scope, fund routing, calldata, settlement eligibility, logging, or a user-visible safety claim | `perago-security-auditor` | Never a clean bill of health by assertion; prefer removing a capability over guarding it. |
| Any work in `apps/web` - screens, wallet interaction, typed-data review, copy, motion | `perago-frontend-polish` | Read it to confirm the UI hold is lifted before building anything; a screenshot of a mock is not verification. |
| A feature, change, or idea is not yet a written design | `brainstorming` | Do not write code or scaffold while the design is unapproved. |
| An approved design needs an executable plan | `writing-plans` | Plan against task IDs in `docs/BUILD-PLAN.md`; never invent a parallel plan document. |
| A requirement must become a precise specification | `to-spec` | Every acceptance criterion is observable and testable, or it is not a criterion. |
| Types, states, or invariants are being shaped | `domain-modeling` | Shared domain schemas live in `packages/sdk`; make illegal states unrepresentable instead of validating them later. |
| Module boundaries, dependency direction, or file placement is in question | `codebase-design` | Obey the import rules below; reuse one existing convention rather than adding a second. |
| Implementing any behavior or fixing any bug | `test-driven-development` | Write the failing test first and watch it fail. No production code without a failing test. |
| Something fails, is flaky, or behaves unexpectedly | `systematic-debugging` | Find the cause before proposing a fix; never mask a failure with a catch, mock, retry, or fallback. |
| A third-party API, SDK, or protocol behavior must be established | `find-docs` | Retrieve current primary-source documentation and record its status per the integration rules; training memory is not evidence. |
| Assumptions in a plan, claim, or specification need pressure | `grilling`, `grill-with-docs` | Use before committing to an external dependency or an architectural decision, not after. |
| Reading BNB Chain / opBNB state, transactions, or contract code during a probe | `bnbchain-mcp` | Read-only use for evidence gathering. Never hand it a production key; probe keys stay disposable and out of the repository. |
| Starting or configuring the Foundry workspace and OpenZeppelin imports | `setup-solidity-contracts` | Pinned versions and remappings come from `docs/technical/TECH-STACK.md`. |
| Writing or reviewing contract code that uses library primitives | `develop-secure-contracts` | Prefer an audited library primitive over a hand-rolled one; a library default still has to satisfy the mandate invariants. |
| Reviewing a changed TypeScript or Solidity surface before claiming it done | `code-review-skill`, `requesting-code-review` | Review the diff against the invariants and the acceptance criteria of the task, not against taste. |
| About to claim a task, test, deployment, or integration is complete | `verification-before-completion` | Produce the command and its observed output. An unrun check is a blocker, not a pass. |

### Provenance

| Source | Pinned revision | Installed |
| --- | --- | --- |
| [obra/superpowers](https://github.com/obra/superpowers) | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion` |
| [mattpocock/skills](https://github.com/mattpocock/skills) | `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` | `domain-modeling`, `codebase-design`, `grilling`, `grill-with-docs`, `to-spec` |
| [OpenZeppelin/openzeppelin-skills](https://github.com/OpenZeppelin/openzeppelin-skills) | `6f215af60eb60017ab1a933ce9d22a479cd42b26` | `setup-solidity-contracts`, `develop-secure-contracts` (AGPL-3.0-only, unmodified) |
| Workstation global install, snapshot 2026-09-19 | unpinned upstream | `bnbchain-mcp`, `code-review-skill`, `find-docs` |
| Perago repository | this commit | `perago-contract-engineer`, `perago-integration-engineer`, `perago-backend-wiring`, `perago-proof-engineer`, `perago-security-auditor`, `perago-frontend-polish` |

Upstream directories were copied unmodified; MIT license texts are retained in [`.agents/skills/licenses/`](.agents/skills/licenses) and `code-review-skill` carries its own `LICENSE`. The six `perago-*` skills are original project instructions derived from the canonical documents in `docs/`; they encode decisions and obligations, never chain facts. When a skill is added, removed, or contradicted by a document change, update this section and the affected skill in the same change.

### Deliberately absent

- **Interface skills** (`emil-design-eng`, `motion`, `impeccable`, `design-taste-frontend`, `vercel-react-best-practices`) are not installed during the current backend gate. The approved `P7-001` landing shell is complete; install the relevant skills only in the same change that explicitly opens another web task.
- **Reference-repository skills** (`bsc-foundry`, `bnb-agent-stack`, `altana-*`, `swap-*`/`liquidity-*`/`farming-*`/`hub-*` planners) are excluded on purpose. They encode another product's contracts, its vendor session wallet, and its address tables, all of which would either contradict `docs/technical/INTEGRATION.md` or reintroduce the vendor dependency the core is forbidden to have. Do not re-import them; extract a specific technique into a canonical document instead.
- **Harness tooling** (`graphify`, `orca-cli`, `orchestration`, `computer-use`) stays at the workstation level and is not vendored.

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

### Documentation synchronization

1. Every change that alters behavior, scope, evidence, status, or an external claim updates its canonical document in the same change; a documentation update is never deferred to a later commit.
2. `docs/BUILD-PLAN.md` carries live task status, current evidence, and named blockers while work is in progress; acceptance checkboxes flip only when every acceptance criterion of the task passes.
3. When an address, interface, dependency version, protocol status, or decision changes, update every canonical document that asserts it, and keep integration status values (`verified`, `proposed`, `needs re-verification`, `blocked`) accurate in `docs/technical/INTEGRATION.md`.
4. Evidence recorded in documentation names the exact chain, address, block, transaction, command, or primary source, and distinguishes local, fork, testnet, and mainnet evidence.
5. A durable lesson or verified user preference is appended to `docs/LESSONS.md` in the same change that produced it, newest first, using that file's dated entry format.
6. Documentation must never claim an unperformed run or an unverified external behavior; an unfinished criterion is recorded as a blocker with its unblocking action and owner.

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

## Lessons and insight

Durable technical lessons and verified user preferences are recorded newest-first in `docs/LESSONS.md`. Every session appends there rather than inline.
