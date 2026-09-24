---
name: perago-contract-engineer
description: Use when writing, changing, testing, or deploying Perago Solidity - MandateExecutor, the PancakeV3SwapAdapter and CakeStakeAdapter, SwapVerifier and StakeVerifier, OutcomeEvaluator, their interfaces, storage layout, events, custom errors, or Foundry tests. Covers the mandate lifecycle, the one-use guarantee, exact-allowance fund handling, and the invariant suite that must never regress.
---

# Perago Contract Engineer

## Authority

`docs/technical/SMART-CONTRACT.md` is the specification; this file is how to work against it. When they disagree, the specification wins and gets corrected in the same change. Never widen the contract surface to make a test pass.

## The five contracts, and nothing else

`MandateExecutor`, `PancakeV3SwapAdapter`, `CakeStakeAdapter` with its per-recipient `CakeStakePosition`, `SwapVerifier` + `StakeVerifier`, `OutcomeEvaluator`. There is deliberately **no** receipt contract and **no** mutable adapter registry: adapter and verifier pairs are constructor-pinned immutables. `CakeStakePosition` exists only because the CAKE Pool credits `msg.sender` (user decision, 2026-09-23); it is owned by one recipient, deployable only by its adapter, and has no admin. Adding a registry, a proxy, a pause, an admin sweep, a nonce reset, or a settlement override is a specification change, not an implementation detail.

## Non-negotiable structure

- `TaskMandate` has **22 fields** in frozen order and frozen widths. The canonical type string in `packages/sdk/src/eip712.ts`, the struct in `packages/contracts/src/types/PeragoTypes.sol`, the `TASK_MANDATE_TYPEHASH` literal in `packages/contracts/test/fixtures/TaskMandateFixtures.sol`, and the specification must stay byte-identical. Changing any one of them without the other three is a broken change, and the shared digest fixture exists to catch it.
- `MandateStatus` is `NONE, AUTHORIZED, EXECUTING, SUCCEEDED, FAILED, REVOKED, EXPIRED`. The only legal transitions are `NONE -> AUTHORIZED`, `AUTHORIZED -> EXECUTING | REVOKED | EXPIRED`, `EXECUTING -> SUCCEEDED | FAILED`. No terminal state transitions again, ever.
- `authorize` writes `usedNonce[account][nonce] = true` **before** recording `AUTHORIZED`, and performs no external protocol or token call.
- `beginExecution` is a separate transaction that commits `EXECUTING` and `executionStartedAt` before any smart-account or protocol call. This is the whole one-attempt guarantee: do not collapse it into `perform` to save a transaction. A single reverting `execute` would roll back its own nonce write and make the root signature reusable.
- `perform` requires `msg.sender == mandate.account`, stored `EXECUTING`, matching hash and critical fields, unexpired mandate and window, valid executor proof, and `keccak256(action) == mandate.actionHash`.
- Effects live in `executeCore`, an `onlySelf` external self-call, so its revert rolls back token, approval, and protocol effects while the outer `perform` still records terminal `FAILED`. The outer catch stores a **bounded** reason code plus hash; never parse unbounded revert strings.
- `finalizeStalledExecution` and `finalizeExpired` are permissionless by design. Do not gate them on the executor.

## Fund handling

Exactly `maxInput` is granted, pulled, and passed on; the adapter receives an exact allowance with a zero-first/force-approve pattern and the allowance is cleared to zero before the subcall returns success. Unspent input returns to the signed account; outputs go straight to the signed recipient. MandateExecutor is not a treasury - a nonzero user balance in it after a terminal `perform` is an invariant violation, not an accounting detail. Unlimited approvals are forbidden in contracts, scripts, tests, and demo setup. Fee-on-transfer, rebasing, and callback-capable tokens are unsupported until explicitly modeled.

## Errors and events

Use the named custom errors from the specification (`NonceAlreadyUsed`, `InvalidTransition`, `ActionHashMismatch`, `VerificationFailed`, `SettlementNotEligible`, and the rest) - never revert strings, because reason codes are mapped offchain. Emit the specified events with the specified fields; the receipt commits hashes only. Raw intent, policy JSON, model output, and action bytes are never stored or emitted.

## Verifier separation

An adapter's self-reported `AdapterResult` is never sufficient. MandateExecutor measures pre-state, calls the adapter, then passes before-values to the **immutable paired verifier**, which reads protocol or token state itself. Swap measures recipient output-token balance delta; stake measures position or receipt-token delta. A verifier that trusts the adapter's return value is the bug that makes the product a lie.

## Testing obligation

Every change carries the tests that would fail without it:

1. **Unit** - the mutation you just enabled: each EIP-712 field and domain mutation, owner-epoch monotonicity, policy replacement invalidating old signatures, exact approval and zero cleanup, protocol revert, verifier false and verifier revert, race ordering between authorize/begin/revoke/expire, stalled finalization, settlement eligibility, event fields and error selectors.
2. **Fuzz** - nonce/expiry/amount/minimum/recipient mutations, SDK-parity action encode/decode/hash, terminal transition sequences, allowance and balance conservation, malformed and oversized revert data.
3. **Invariant** - the stateful handler with actors root owner, smart account, executor, attacker, adapter, verifier, evaluator; assert **all 12 safety invariants** after every random sequence. Invariants 1 (`usedNonce` never reverts to false), 4 (`SUCCEEDED` implies verifier pass in the same atomic subcall), 5 (`FAILED` never enables settlement), 9 (zero allowance and zero balance after terminal), and 11 (one mandate per job, one settlement) are the product claims - if one of them can break, stop and report rather than adjusting the assertion.

Run `forge fmt`, `forge build`, the focused test, then the fuzz and invariant suites. A gas snapshot regression on the hot path is reported, not silently accepted.

## Traps

- Writing state in `perform` before `executeCore` and assuming it survives a revert: it does not, which is precisely why `beginExecution` exists.
- `try/catch` around a call that can consume all gas: the 63/64 rule means an inner out-of-gas can starve the outer record. Bound the subcall and test the catastrophic case.
- Treating `StakeAction.poolId` as an address or as calldata. It is a key into deployment-pinned targets.
- Allowing `amountIn < maxInput`: MVP has no partial fills, `amountIn == maxInput`.
- Accepting `commerceContract == address(0)` outside an explicitly configured local or fork test.
- Adding a recovery or sweep function "just in case". It is excluded from MVP and would have to be token-specific, timelocked, and user-authorized.
- Reading an address from a literal in source instead of the pinned deployment manifest.

## Stop conditions

Stop and report, with the failing invariant and the exact command output, when: a decision gate (`SC-D-001`..`SC-D-005`, `D-002`, `D-003`, `D-004`) is unresolved for the code you are about to write; an address, module version, or capability would have to be assumed; a required invariant cannot be expressed as a test; or the change would weaken one of the twelve safety invariants. Never fill an open decision with an assumed address or a silent fallback.
