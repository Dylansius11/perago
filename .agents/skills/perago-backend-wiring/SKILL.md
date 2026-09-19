---
name: perago-backend-wiring
description: Use when wiring apps/api or apps/executor - Hono routes, the policy engine, the planner adapter, the action compiler, simulation, Drizzle schema and migrations, the Postgres-backed leased queue, the indexer, reconciliation, retries, or reason codes. Covers idempotency keys, lease mechanics, reorg handling, and what the backend may never assert.
---

# Perago Backend Wiring

## Authority

`docs/technical/ARCHITECTURE.md` owns boundaries and flows; `docs/technical/ERD.md` owns tables, columns, enums, and synchronization rules. Shared schemas, hashes, and reason codes live in `packages/sdk` - if the API and the executor need the same shape, it belongs there, never duplicated app-locally.

## The one law

**No database row can turn a failed onchain mandate into success.** Postgres holds user-authored data, planner and simulation records, queue coordination, and chain-derived projections. Projections are rebuildable from user-authored rows plus chain logs; raw confirmed events are append-only. The model, the API, and the worker are all incapable of writing terminal success directly - terminal projections require the configured confirmation depth and a matching onchain state.

## Boundaries

`apps/api` and `apps/executor` never import each other. Both consume `packages/sdk`. Database code stays in `apps/api`; the executor consumes typed contracts, not schema internals. `packages/sdk` holds no database adapter, no framework request object, no key, and no network call. Hono middleware handles transport only - domain functions take typed values, never a request context.

## Idempotency keys are the design

Use exactly these, from `ARCHITECTURE.md` §7:

| Operation | Key |
| --- | --- |
| Create task intent | smart-account address + `client_request_id` |
| Compile plan | task ID + policy hash + compiler version |
| Simulate | plan hash + block number + account/adapter code hashes |
| Submit mandate | mandate EIP-712 digest |
| Queue execution | mandate digest |
| Submit execution | smart-account address + UserOperation nonce + mandate digest |
| Store chain event | chain ID + transaction hash + log index |
| Settle job | commerce contract + job ID + mandate digest |

Each has a real unique constraint: `tasks` is unique on `(wallet_id, client_request_id)`, `executions` is one row per `mandate_hash`, `wallet_policies` is unique on `(wallet_id, version)` and `(wallet_id, policy_hash)` with a partial unique index allowing **at most one `ACTIVE` row per wallet**, and `chain_events` is unique on its event identity so duplicate delivery is harmless. Enforce uniqueness in the schema, not in application `if` statements.

## Executor discipline

- Lease **one** work item at a time by mandate hash using a Postgres row lease with `FOR UPDATE SKIP LOCKED`. An active lease requires both an owner and a future expiry. No Redis, BullMQ, Kafka, or workflow engine - `ADR-007` chose one datastore deliberately.
- Before **every** submission and after **every** timeout, read chain state: MandateExecutor status, smart-account owner and module state, `activePolicyHash`, nonce state, UserOperation state. If the work is already known onchain, reconcile instead of resubmitting.
- Persist `authorize_tx_hash`, `execute_user_operation_hash`, `execute_tx_hash`, and `settlement_tx_hash` **before** waiting for inclusion. A restart begins with reconciliation, never with resubmission.
- Retries are allowed only while inclusion is unknown or before a terminal transition, and they reuse **identical** signed payload and action bytes. Blind resubmission once a transaction hash exists without a definitive dropped/replaced result is forbidden.
- `submission_attempts` counts infrastructure submissions, not business attempts - the business attempt count is one, enforced onchain by `beginExecution`.
- Worker states `QUEUED -> LEASED -> AUTHORIZING -> AUTHORIZED -> EXECUTING -> VERIFYING -> SETTLING -> TERMINAL` with `RECONCILING` and `RETRY_WAIT` branches are operational only. Worker state is not product truth, and `TERMINAL` requires the matching onchain terminal state.

## Planner boundary

The planner's output is untrusted input. Parse a **closed** `CompiledPlan` union strictly, reject unknown fields, then run deterministic policy intersection and action compilation. Store raw intent and the normalized plan separately; model prose is never an action. On planner unavailability or invalid output, return a retryable planning failure - never infer a fallback action. On policy conflict, persist the rule-by-rule decision and do not simulate. A simulation is valid only for the exact policy, plan, adapter implementation, nonce, block context, and expiry recorded in its hash; a stale simulation blocks signing.

## Indexer and reorgs

Store every relevant confirmed log once with block hash and confirmation status. Below the confirmation depth, status is `PENDING_CONFIRMATION`, never terminal. On a changed block hash, mark affected events orphaned, rewind projections to the last canonical checkpoint, and replay - **never edit an event payload**. A direct read may repair a missing projection but must retain the raw block and transaction evidence. Update events, projections, and the checkpoint in one transaction.

## Errors, logs, and secrets

Every terminal state exposes a stable machine-readable reason code plus a human sentence (`PRD-F-016`); a generic "failed" is a defect. Logs carry `traceId`, `taskId`, and `mandateHash` when known, plus stage, chain ID, adapter ID, transaction hash, block number, attempt, latency, and reason code. They exclude natural-language intent by default, key and session material, authorization headers, and raw provider payloads - **provider error strings can leak credentials, so redact before logging, not after**. No secret, key, or session material is ever a database column; raw intent is encrypted at rest.

## Verification gate

Type-check, lint, run the focused behavior test, then exercise the real path: hit the route or run the job, and read back the persisted row **and** the transaction hash. Prove idempotency by delivering the same work twice and showing one effect. Prove restart safety by killing the worker mid-flight and showing reconciliation, not a duplicate submission. A passing unit test with a mocked chain is not evidence that the wiring works.

## Traps

- Enforcing "one active policy" in application code instead of the partial unique index.
- Advancing worker state on an RPC response instead of a confirmed receipt at the configured depth.
- Letting a retry rebuild calldata: re-encoding can change bytes and invalidate the signed `actionHash`.
- Using the host clock for anything the chain decides - expiry and windows come from block timestamps.
- Adding a table that `ERD.md` §10 deliberately omits (users, agents, listings, jobs, transactions) instead of projecting from mandate and receipt fields.
- Widening authority in a degradation path. No failure mode may change a signed action or report an unconfirmed success.
