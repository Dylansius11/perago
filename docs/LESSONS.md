# Perago Lessons

This file is the canonical lessons log for the Perago repository, with entries ordered newest-first. Each entry records durable rules rather than task status; task status lives in [`docs/BUILD-PLAN.md`](BUILD-PLAN.md).

## Technical lessons

### 2026-09-19 - A probe that writes onchain state must claim fresh state each run

- Observed: the chain-97 session probe passed once, then failed on rerun with `AA10 sender already constructed`, and its fixed permission slot would next have collided with the expired session the earlier run left installed.
- Root cause: the probe assumed a clean account: it always sent factory data and always reused entity ids `21` and `22`, so the first successful run made the second run invalid.
- Rule: a state-writing probe reads current state before acting (send factory data only when the account has no code), claims a fresh permission slot per run, and uninstalls everything it installed; otherwise the evidence is unreproducible.

### 2026-09-19 - Alchemy's bundler enforces a minimum gas-limit efficiency

- Observed: `eth_sendUserOperation` rejected safely padded limits with `Verification gas limit efficiency too low. Required: 0.4, Actual: 0.15`, so generously over-provisioned limits fail even when the operation is valid and funded.
- Root cause: the bundler prices reserved gas, not used gas, and rejects an operation whose used/limit ratio is below a per-field threshold; the error itself names the field and both ratios.
- Rule: take limits from `eth_estimateUserOperationGas` with a small buffer, and on rejection parse the bundler's stated ratios to retune the named field rather than raising limits further.

### 2026-09-19 - A sponsorship policy's transaction count is consumed by attempts

- Observed: with a Bundler Sponsored Operations policy capped at one total and one per-wallet transaction, the sponsored UserOperation failed with `Policy max count exceeded` before any sponsored operation had been mined; raising the caps made the same call succeed with `actualGasCost` `0`.
- Root cause: policy counting is not limited to mined successes, so failed or repeated attempts during development exhaust a tight cap.
- Rule: size a testnet sponsorship policy for retries (a small spend ceiling with a generous count), and treat `Policy max count exceeded` as a policy-configuration fact rather than an account or bundler defect.

### 2026-09-18 - Vendor allowlists of privileged selectors can be stale

- Observed: `@alchemy/smart-accounts@5.2.6` blocks `installExecution` as `0x1d37e7d6` and `uninstallExecution` as `0x0b7cad71`, but the deployed semi-modular account implementation `0x000000000000c5A9089039570Dd36455b5C07383` dispatches `0x001a63e9` and `0x93b1dc61`.
- Root cause: the vendor constants predate the deployed ERC-6900 `ExecutionManifest` argument encoding, and nothing in the SDK cross-checks them against the deployed dispatcher.
- Rule: derive a security-critical selector from the deployed bytecode or its verified ABI, never from a vendor constant; a forbidden-selector list that names a function the account does not expose silently permits the real one.

### 2026-09-18 - Pruned public RPC breaks pinned forks, so replay verified bytecode instead

- Observed: `anvil --fork-url` against the public BSC Testnet endpoint failed every account read with `missing trie node`, and after switching to bytecode replay, account deployment reverted with empty data until EntryPoint v0.7's `SenderCreator` was replayed as well.
- Root cause: public BNB endpoints prune historical state, so a pinned fork block becomes unserviceable; and EntryPoint v0.7 deploys accounts through a helper contract created in its own constructor, addressed as the EntryPoint's first `CREATE` and exposed by no getter.
- Rule: for integration probes that need only code, replay hash-verified runtime bytecode onto a local chain and assert each code hash against the target chain; when replaying EntryPoint v0.7, replay its `SenderCreator` too.

### 2026-09-18 - A probe's time window must come from the chain it validates against

- Observed: a session permission whose `validUntil` was derived from the source chain clock passed on the first run and then failed with `FailedOp(0, AA22 expired or not due)` on the second, because the local chain clock had been advanced by the expiry case.
- Root cause: validation compares against the executing chain's block timestamp, while the probe computed its window from a different chain's clock, so replaying the probe reused an already-expired window.
- Rule: derive validity windows from the chain that performs validation, and treat a probe as incomplete until it passes twice in a row against the same running node.

### 2026-09-18 - Modular Account V2 rejects an empty-callData UserOperation

- Observed: a deployment UserOperation with `callData` of `0x` reverted as `FailedOpWithRevert(0, AA23 reverted, UnrecognizedFunction(0x00000000))`.
- Root cause: the account resolves validation against the call's function selector, and empty calldata yields the zero selector, which matches no execution function.
- Rule: give every UserOperation a real account function call; use a benign `execute` with empty inner data when an operation exists only to deploy the account.

### 2026-09-18 - Relay-controlled browser exposes no wallet provider

- Observed: the relay-controlled Chrome tab evaluated `window.ethereum` as absent, and a CDP target scan listed only `page` targets with no extension service worker.
- Root cause: the relay browser instance does not load the MetaMask extension, so browser automation cannot reach the owner signer regardless of MetaMask site-access settings.
- Rule: confirm signer availability before planning any work whose acceptance depends on an owner signature; when the signer is unreachable, prove the constraint locally with a disposable key against replayed deployed bytecode and record the remaining signed step as an explicit blocker instead of a completed criterion.

### 2026-09-18 - A stale account implementation constant silently relocates the smart account

- Observed: the Modular Account V2 address probe pinned implementation `0x00000000000002377B26b1EdA7b0BC371C60DD4f`, while the installed `@alchemy/smart-accounts` package resolves `DefaultAddress.SMAV2_BYTECODE` to `0x000000000000c5A9089039570Dd36455b5C07383`.
- Root cause: the counterfactual address is a CREATE2 result over factory, salt, owner, and implementation bytecode, so any stale implementation constant derives a different, unreachable account address.
- Rule: derive counterfactual addresses from the installed SDK's pinned defaults, assert the derived address against onchain code and balance before funding it, and never hand-copy an implementation address into probe code.

### 2026-09-18 - Gas sponsorship is not asset funding

- Observed: gas-sponsorship configuration was treated as if it would unblock the ERC-8183 lifecycle probe.
- Root cause: a paymaster policy only covers UserOperation gas; the escrow lifecycle needs a real payment-token balance, which is a separate prerequisite.
- Rule: separate blockers by resource type - gas sponsorship, native testnet gas, and payment-token balance are independent prerequisites, and each must name its own unblocking action.

### 2026-09-18 - Documentation must move with the work, not after it

- Observed: implementation progressed while `docs/BUILD-PLAN.md` still described an earlier state, so progress was not traceable.
- Root cause: documentation updates were deferred to a later checkpoint instead of being part of the same change.
- Rule: update the canonical document in the same change as the work it describes, and record live status and blockers separately from acceptance checkboxes so unfinished work is never presented as complete.

### 2026-09-18 - Provider error strings can leak credentials

- Observed: a third-party RPC client included the endpoint URL in an error string, exposing an Alchemy app key in a supervised-process log.
- Root cause: the client interpolated the full request URL, which carried the key, into the thrown error message.
- Rule: redact URLs before logging caught provider errors, and rotate a leaked credential before any retry.

## User insight

### 2026-09-19 - Commit cadence is a working requirement, not a style note

- Asked explicitly for more frequent commits while long onchain work was in flight.
- Application: commit at every coherent boundary - a shared helper extracted, a probe proven live, a manifest recorded, a document synchronized - instead of batching a phase into one commit, and push `dev` after each so progress is externally visible.

### 2026-09-18 - Verified working preferences

- Prefers deep, explicit documentation and acceptance criteria before implementation; make accepted requirements and gates executable before writing product code.
- Will provide Perago's design system later; do not invent UI or visual direction early.
- Rejects reuse of the reference product's UI and flow; reuse only audited technical primitives.
- Wants frequent coherent commits and `dev` development with PRs into protected `main`; checkpoint complete review units and avoid direct feature work on `main`.
- Expects the highest-quality output and informed action rather than timid scaffolding; investigate first, then deliver complete bounded work.
