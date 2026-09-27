# Perago Lessons

This file is the canonical lessons log for the Perago repository, with entries ordered newest-first. Each entry records durable rules rather than task status; task status lives in [`docs/BUILD-PLAN.md`](BUILD-PLAN.md).

## Technical lessons

### 2026-09-27 - Check Windows reserved ports before reusing a disposable database container

- Observed: Docker could not restart `perago-test-db` on `127.0.0.1:55432` with `bind: An attempt was made to access a socket in a way forbidden by its access permissions`; no TCP listener owned the port, but `netsh interface ipv4 show excludedportrange protocol=tcp` reported reserved range `55377–55476`. An integration command still reached `55432` after `.env` changed, because an inherited process variable took precedence over Node's env-file.
- Root cause: Docker's existing host-port binding fell inside a Windows TCP exclusion, while the test process inherited a stale `TEST_DATABASE_URL` from its parent shell.
- Rule: choose an unreserved host port (for this workstation, `56432`), remap a disposable container without erasing its named volume, and update or clear any exported `TEST_DATABASE_URL` as well as local `.env`; never change a hosted database connection to work around a local port conflict.

### 2026-09-27 - Do not gate an expired escrow refund on payout economics

- Observed: changing APEX `platformFeeBP` to 100 made the worker report `refundable: false` for a matching expired Submitted job, even though `claimRefund(jobId)` has no platform-fee precondition; a focused regression reproduced the refusal.
- Root cause: the shared job-identity check conflated mutable payout terms with the immutable job identity required for permissionless recovery.
- Rule: enforce fee terms before submitting or completing payment, but keep exact job/client/token binding and pinned runtime checks independently sufficient for a permissionless expiry refund.

### 2026-09-27 - Expired escrow needs its own permissionless recovery call

- Observed: the reviewed `OutcomeEvaluator.reject` checks `job.expiredAt > block.timestamp`, so it cannot refund an otherwise valid bound job after its deadline; the official APEX kernel exposes `claimRefund(jobId)` for funded/submitted jobs after that boundary. An existing chain-97 protocol probe recorded permissionless expiry refund for job `1260`.
- Root cause: deterministic evaluator rejection and permissionless kernel expiry are distinct transitions. Waiting for evaluator rejection after the deadline strands the worker in `REFUNDING` and leaves a successful-but-unpaid job indefinitely pending.
- Rule: pin the exact APEX kernel and job identity, submit only `claimRefund(jobId)` after expiry, and mark a successful mandate `UNPAID` only once the kernel's `Expired` status is finalized; never confuse escrow recovery with verified provider payment.

### 2026-09-27 - Recheck mutable escrow economics inside the settlement transaction

- Observed: chain-97 APEX had `platformFeeBP = 0` at block `133413598`, but a unit test changing it to 100 bp showed that `OutcomeEvaluator.settle` would otherwise release less than the job budget to the provider.
- Root cause: the upstream escrow proxy has an owner capable of changing its fee after deployment or an offchain preflight; a pinned proxy address does not pin its mutable economics.
- Rule: read the current fee inside the evaluator's payment transaction and refuse any unexpected value; recheck upstream implementation, admin, and code hashes before accepting new jobs, and leave permissionless expiry refunds available.

### 2026-09-24 - Serialize destructive database suites and fork journeys

- Observed: a combined fork smoke passed swap 9/9, then stake failed 6/12 after a concurrently launched database integration test executed `drop schema public cascade; create schema public` against the same `TEST_DATABASE_URL`. The stake worker stopped progressing at BEGIN, and its authenticated API session returned `AUTH_INVALID`.
- Root cause: the integration suite and the fork journey share one disposable PostgreSQL database; a schema reset invalidated the active worker's execution rows and wallet session while the journey was running.
- Rule: never run `test:db`, focused DB integration files, or migration resets concurrently with a fork/testnet journey using the same `TEST_DATABASE_URL`; serialize these suites and rerun a disrupted journey without changing product code.

### 2026-09-24 - Publish only verification facts the chain actually exposes

- Observed: `ExecutionReceiptRecorded` has a terminal status, `verificationHash`, and `failureReasonHash`; it does not emit measured spend, position/output delta, or a plain-language revert cause. The P6-001 public route can prove a successful verifier commitment and expose a failure commitment, but cannot reconstruct those omitted measurements from the receipt log.
- Root cause: the verified outcome is committed onchain as a hash, while detailed measurement is local to the atomic execution subcall and never persisted as independent event data.
- Rule: public receipts distinguish `PASSED`, `NOT_VERIFIED`, and `NOT_APPLICABLE`; never fill verifier-detail columns or explain a failure from simulation data, worker reports, or an undecodable hash.

### 2026-09-24 - A fork that mines while it fetches cold accounts can deadlock

- Observed: the P4-003 and P5-002 fork journeys hung in `beforeAll` until the 600 s hook timeout in four of eight runs, always inside `registerDeploymentAdapters`. A throwaway repro replayed the same setup reads on fresh forks. With `--block-time 1`, or with `evm_mine` sent every second, it stalled within one to eleven rounds on both anvil `1.8.0-nightly` and the pinned `1.8.3`. Each time, the four parallel `eth_getCode` reads of the cold stake contracts never returned, and even `eth_blockNumber` timed out. A 5 s upstream `--timeout` did not help. With automine it passed 12 of 12 rounds. Fetching every manifest account one at a time before `evm_setIntervalMining` also passed 12 of 12 rounds on the nightly build.
- Root cause: anvil's fork backend deadlocks when block production overlaps several first-time fetches of accounts from the upstream RPC. This is the class reported in foundry-rs/foundry#1688 and #6036. It is a tooling defect, and chain 97 itself is unaffected.
- Rule: a fork smoke starts anvil in automine, fetches every `deployments/*.json` account one at a time, and only then switches to interval mining (`startAnvil`). A hang in a fork hook is diagnosed by checking whether anvil still answers `eth_blockNumber` before blaming the product code or the database.

### 2026-09-24 - Prove unchanged chain state before trusting identical outputs across runs

- Observed: the P4-003 fork and live chain-97 swaps, and the P3 fork simulation 25,000 blocks earlier, all reported the same `minOutput` of 364231492571185523693864631565 CAKE; the two swaps also received the same 367910598556753054236226900571 CAKE.
- Root cause: nobody else trades the testnet fee-500 WBNB/CAKE pool. Its `sqrtPriceX96` was identical at blocks `132837392` and `132862940`, and it moved only when the live journey swapped.
- Rule: when two runs agree to the wei, read the state that prices them (pool `slot0`, reserves, balances) at both blocks before accepting the evidence. Identical output is evidence only when that state is proven unchanged; otherwise suspect a cache or a replayed fixture.

### 2026-09-24 - A path guard needs escape cases at both ends, and a mutation script must verify its restore

- Observed: the `protocolManifest` rule `^deployments/[\w.-]+\.json$` survived two mutants, one dropping `^` and one dropping `$`, until the test named `../deployments/...json` and `deployments/x.json/../../.env`. Separately, a mutation script's restore on Windows failed once with `UNKNOWN` (not `EBUSY`) and left the mutated source on disk.
- Root cause: fixtures that are wrong in both places at once cannot tell which anchor is holding. On Windows, a file a test runner just released can fail to open with several error codes, not only `EBUSY`.
- Rule: for every path or format guard, add one fixture that escapes only past the prefix and one that escapes only past the suffix. A throwaway mutation script retries writes on `EBUSY`, `EPERM`, and `UNKNOWN`, compares the restored bytes to the original, and the run ends with `git diff` on the mutated file.

### 2026-09-24 - Read logs in bounded ranges from a persisted cursor, and never across a fork point

- Observed: the executor's finalized reconciliation called `eth_getLogs` from the simulation block to `finalized`, and the chain-97 Alchemy endpoint rejected every range wider than 10 blocks. A local anvil fork failed the same way, and it also returned intermittent upstream 503s for ranges that included the fork block.
- Root cause: anvil serves blocks at or below its fork point from the upstream RPC, so a fork inherits the provider's range limit and availability. A scan that restarts from its origin grows with chain age.
- Rule: scan logs in chunks of at most 10 blocks, and advance a forward-only `indexer_checkpoints` cursor in the same database transaction that applies the events. Fork smokes read only blocks after the fork point.

### 2026-09-24 - Never make a well-known key a `handleOps` beneficiary on a fork

- Observed: in the Phase 4 fork smoke, the first root UserOperation relayed by anvil's first dev key succeeded, and every later one failed with `Insufficient funds`, even after `anvil_setBalance` to 100 BNB.
- Root cause: on chain 97 that key (`0xf39F…2266`) carries an EIP-7702 delegation (`eth_getCode` returns `0xef0100…`). `EntryPoint.handleOps` calls its beneficiary, which runs the delegate's code, and the code drains the balance.
- Rule: fork relayers, beneficiaries, and funders are freshly generated keys funded with `anvil_setBalance`. Before a smoke trusts any public address, check `eth_getCode`.

### 2026-09-24 - Persist the signed bytes, not just the intent, before broadcast

- Observed: a crash can land between signing and broadcast, a node can drop a transaction, and another transaction can consume the executor nonce. A worker that re-derives its transaction after a restart can send a second, different transaction for the same stage.
- Root cause: when only the intent is recorded durably, recovery has to guess whether the original transaction is still live.
- Rule: persist the transaction hash and exact raw bytes through the API before broadcast. Rebroadcast the same bytes while the nonce is open. Retire a hash only once its nonce is finalized under another transaction. Sign nothing new while one transaction is unresolved.

### 2026-09-24 - Node type stripping needs `erasableSyntaxOnly`

- Observed: the executor typechecked cleanly, then crashed at start under Node 24 with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on constructor parameter properties.
- Root cause: Node strips types but cannot transform TypeScript-only runtime syntax: parameter properties, enums, and namespaces.
- Rule: any package that Node runs from `.ts` source sets `"erasableSyntaxOnly": true`, so `tsc` rejects that syntax before the first run.

### 2026-09-23 - Simulate the exact onchain path with `eth_call` state overrides, not `eth_simulateV1`

- Observed: Alchemy's chain-97 endpoint serves `eth_simulateV1`, but a local anvil fork answers every request with `Required data unavailable`, so a simulator built on it could never be proven on the fork.
- Root cause: `eth_simulateV1` support differs by node implementation, while `eth_call` with code and storage overrides is served identically by the live RPC and the fork.
- Rule: run preflight as one pinned-block `eth_call` that installs a never-deployed harness at the account address and overrides only the one mandate record needed to reach `perform`. Prove on a fork that it predicts the real `authorize` → `beginExecution` → `perform` path (equal spend, outcome, and `verificationHash`). Any slot-layout drift then fails closed, never open.

### 2026-09-23 - A rejection test must break exactly one invariant

- Observed: the mutation audit showed that deleting the SDK `maxInput`, `minOutput`, and `recipient` equality checks survived the tests that claimed to cover them.
- Root cause: each fixture changed one field, which also broke a neighbouring check (spent balance or postcondition hash), so the suite rejected the fixture for another reason.
- Rule: a rejection fixture keeps every other commitment consistent with the changed field, so that only the guard under test can reject it; confirm with a mutation audit of each guard.

### 2026-09-23 - A fork whale trade needs a price limit

- Observed: an unbounded 50 WBNB `exactInputSingle` on a thin chain-97 pool hung the anvil fork past a 180-second RPC timeout.
- Root cause: the swap crossed to the tick bound, and the fork lazily fetched every empty tick-bitmap word from the remote RPC.
- Rule: bound a fork price-moving trade with `sqrtPriceLimitX96` derived from the pool's current `slot0`, just past the move the test needs.

### 2026-09-23 - Forge does not load the repository root `.env`; a green fork suite may be reading the machine environment

- Observed: the chain-97 fork suite ran without any env loading, which looked like Forge reading the root `.env`; a newly added `PERAGO_BSC_MAINNET_RPC` then silently skipped the whole mainnet suite.
- Root cause: `PERAGO_BSC_TESTNET_RPC` was also set in the workstation's own environment, so the first suite passed for a reason that does not hold on another machine; Forge reads process environment variables, not the monorepo root `.env`.
- Rule: load `.env` explicitly (`pnpm --filter @perago/contracts test:fork` runs Node with `--env-file-if-exists`) and treat an unexpectedly skipped suite as a failed prerequisite, never as a pass.

### 2026-09-23 - `vm.revertToState` also reverts the test contract's own storage

- Observed: the stake fork `setUp` measured the share delta inside a snapshot, stored it in a state variable, reverted, and then failed with "the pinned pool minted no shares".
- Root cause: a Foundry snapshot covers every account, including the test contract, so a value written to its storage before the revert is rolled back with everything else.
- Rule: carry a value measured inside a snapshot across the revert in a local variable, and assign it to storage only after `revertToState`.

### 2026-09-23 - A guard that only a misbehaving protocol can reach needs a stand-in that misbehaves

- Observed: the mutation audit showed that deleting the adapter's allowance reset or residual-input check survived every fork test, because the real PancakeSwap router and CAKE Pool always consume exactly what they are offered.
- Root cause: against an honest counterparty those guards are unreachable, so a real-protocol fork cannot distinguish a guarded adapter from an unguarded one.
- Rule: for each guard that defends against a counterparty's failure, add a minimal stand-in that produces exactly that failure (`PartialFillRouter`, `ShortDepositPool`) and pin the exact revert selector, so removing either the guard or the cleanup before it changes the observed reason.

### 2026-09-23 - Keep quote-derived values out of anything hashed before the quote

- Observed: the P1-002 `CompiledPlan` carried `minAmountOut`, `minPositionOut`, and `deadline`, but the compiler that produces the plan runs before any quote or block is pinned, and a stale quote must re-simulate without mutating the plan.
- Root cause: the plan and the onchain action struct were modelled as one shape, so values owned by simulation were forced into a document hashed at compile time.
- Rule: a hashed document contains only values known when it is produced; the plan holds the exact spend, pinned route, slippage ceiling, recipient, and lifetime, and simulation derives the minimum output and chain-time deadline into `actionHash`.

### 2026-09-23 - Show the planner the vocabulary, never the limits

- Observed: in the live Groq matrix the model transcribed "0.5 WBNB" and "2% slippage" verbatim, and deterministic intersection rejected both with the exact rule.
- Root cause: a model shown the policy caps would be invited to fit the request under them, which is a silent clamp the owner never asked for.
- Rule: give the planner the goal, the account, and the closed catalog vocabulary only; keep every limit in deterministic code so a broader request fails loudly with its own value as evidence.

### 2026-09-23 - `git checkout` cannot restore an untracked file

- Observed: a mutation check ran `sed` on the new, never-committed `apps/api/src/services/tasks.ts` and then `git checkout --` to revert; the checkout silently did nothing and the mutation stayed in the working tree until a grep caught it.
- Root cause: `git checkout -- <path>` restores from the index, and an untracked file has no index entry.
- Rule: mutate only committed files, or capture the pristine text first and restore it explicitly, then grep the restored file before trusting the next run.

### 2026-09-20 - Use deterministic witnesses for mutation audit, not random stateful scheduling

- Observed: the stateful invariant suite passed 256 runs, but repeated source mutations were caught intermittently even though their adversarial actions appeared hundreds of times in the call distribution.
- Root cause: a stateful fuzz campaign proves properties over sampled sequences; it does not guarantee the exact prerequisite state and action ordering that makes every injected fault observable in every run.
- Rule: keep stateful campaigns for sequence exploration, add deterministic reachability/regression witnesses for each load-bearing guard, and run mutation audit against the combined deterministic, fuzz, and invariant suite.

### 2026-09-19 - A guard is unproven until a mutation of it fails a test

- Observed: the full `P2-002` suite passed on the first run, yet deleting the subcall gas bound (`gas: available - FAILURE_RECORD_GAS` to `gas: available`) still passed all 49 tests, because at the 2,000,000 gas the test supplied, the EIP-150 1/64 remainder was itself enough to write the terminal `FAILED` record.
- Root cause: the test proved the failure record exists, not that it survives an adapter that consumes everything it is handed; the gas figure was chosen for comfort rather than sized against the guard.
- Rule: after a suite goes green, mutate each guard it claims to protect and confirm a named test fails; for a gas-starvation guard, size the call so the 63/64 remainder is demonstrably insufficient (300,000 here, not 2,000,000).

### 2026-09-19 - A source-mutating script must restore in `finally`, and its baseline must be read before the first mutation

- Observed: a mutation loop over `MandateExecutor.sol` asserted a pattern that `forge fmt` had reflowed, raised mid-loop, and left the file mutated; the next cell then re-read that mutated file as its "clean" baseline, so two mutations stacked and the uncommitted implementation had to be repaired by hand.
- Root cause: the restore ran after the loop instead of in a `finally`, and the baseline was re-read from disk rather than held from before the first write.
- Rule: capture the pristine text once, write mutations from that captured text, restore inside `finally`, and assert the restored file equals the capture before trusting any later result.

### 2026-09-19 - Check order decides which rejection a caller sees, so order it deliberately

- Observed: the first `MandateExecutor.authorize` implementation validated the ERC-8183 job binding inside the field-shape helper, so replaying an identical mandate reverted `CommerceJobAlreadyBound()` instead of `NonceAlreadyUsed()`; the replay test written first is what exposed it.
- Root cause: two guards cover overlapping ground, and whichever runs first defines the offchain reason code. Grouping a stateful uniqueness check with stateless field validation moved it ahead of the stricter guard by accident.
- Rule: order authorization checks caller-cheap and semantically strictest first - identity, chain, time, shape, then account state, then nonce, then binding, and signature recovery last before any state write - and pin the intended order with a test per reason code, because the reason code is a published interface.

### 2026-09-19 - A Foundry `vm.prank` is spent by the next call, including a helper's view call

- Observed: fifteen authorization tests failed with `WrongExecutor()` while the contract was correct; each read `vm.prank(executorSigner); executor.authorize(m, _signMandate(m, ...))`, and the helper's `executor.hashMandate` call consumed the prank, so `authorize` arrived from the test contract.
- Root cause: argument expressions evaluate after the cheatcode arms, and `prank` applies to exactly one call - a view call counts.
- Rule: build every signature and read every view before arming `vm.prank`, and treat an unexpected caller-authorization revert in a test as a prank-consumption bug before suspecting the contract.

### 2026-09-19 - The index is shared, so commit by pathspec when another agent works the same worktree

- Observed: a skills-only change staged with `git add .agents AGENTS.md` was committed with a bare `git commit`, and the resulting commit `7b6cf26` also carried `.gitmodules` and the `packages/contracts/lib/forge-std` submodule that a concurrently running agent had staged in the same worktree seconds earlier.
- Root cause: `git add <paths>` is scoped but `git commit` is not - it commits the entire index, including whatever another process staged, and pushing then makes that attribution permanent on a branch where force-push is forbidden.
- Rule: when a second agent or terminal is live in this worktree, commit with an explicit pathspec (`git commit -- <paths>`) and read `git diff --cached --name-only` first. Never assume the index holds only your own work.

### 2026-09-19 - A deployment's constraints are in its bytecode, not in the standard

- Observed: the deployed BNB APEX kernel rejected a spec-legal `createJob` with `HookRequired()`, then would also have rejected `expiredAt = now + 120` with `ExpiryTooShort()`; ERC-8183 mandates neither rule, and the upstream README does not lead with them.
- Root cause: an implementation may narrow a standard. Reading only the EIP produces calls that are valid on paper and revert onchain.
- Rule: before integrating, decode the deployment's own error selectors and read its validation branch; treat the standard as the outer bound and the deployed contract as the real contract.

### 2026-09-19 - A live probe must persist its own evidence

- Observed: a six-minute chain-97 run printed a complete report that was then truncated by terminal paging, and the transaction hashes could not be recovered afterwards because the free RPC tier caps `eth_getLogs` at a ten-block range.
- Root cause: the run's only output was stdout, so the evidence lived exactly as long as the scrollback.
- Rule: every state-changing probe writes its report to a committed file (`docs/evidence/<name>.json`) as well as stdout; evidence that cannot be cited later did not happen.

### 2026-09-19 - Delta assertions, never absolute balances

- Observed: the stake assertion compared the post-withdrawal balance against the amount staked, so it failed the moment the account already held a leftover balance from an earlier run.
- Root cause: the check conflated a running total with a per-run delta.
- Rule: assert on measured deltas around each action, and treat any pre-existing balance as legitimate state a repeatable probe must tolerate.

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

### 2026-09-27 - Use managed Supabase PostgreSQL at the deployment gate

- Asked for a working hosted product without relying on a local database and for smaller, frequent coherent commits with every technical decision recorded.
- Application: at `P8-001`, provision Supabase managed PostgreSQL, apply the checked-in SQL migrations and smoke the deployed API/worker against it; retain local PostgreSQL only for isolated tests, preserve the provider-neutral `postgres` driver, and record design/evidence with each bounded commit.


### 2026-09-20 - Verification and repository intelligence must be proportional

- Asked to avoid rerunning checks that already passed when the affected surface has not changed, use one final verification at the commit boundary, and skip Graphify when code-relationship analysis does not materially help.
- Application: during implementation run only the smallest failing/passing check for the changed behavior; run the full affected gate once before completion; treat Graphify as an optional code-navigation tool, never a ritual or completion gate.

### 2026-09-19 - The user executes the UI; agents prepare only the toolchain seam

- Asked for the frontend scaffold (Tailwind, Motion, shadcn, GSAP skills) and then narrowed it mid-task: install and pin the toolchain, move the brand assets, leave `shadcn init` and every stylesheet to a later agent under the user's own design direction.
- Application: for this repository, "scaffold" means manifests, configs, a `cn()` helper, a placeholder route that builds, and moved assets — never a CSS entry, `components.json`, component source, token set, font choice, or screen. Name the absent files explicitly in the handoff so the next agent knows the seam.

### 2026-09-19 - Commit cadence is a working requirement, not a style note

- Asked explicitly for more frequent commits while long onchain work was in flight.
- Application: commit at every coherent boundary - a shared helper extracted, a probe proven live, a manifest recorded, a document synchronized - instead of batching a phase into one commit, and push `dev` after each so progress is externally visible.

### 2026-09-18 - Verified working preferences

- Prefers deep, explicit documentation and acceptance criteria before implementation; make accepted requirements and gates executable before writing product code.
- Will provide Perago's design system later; do not invent UI or visual direction early.
- Rejects reuse of the reference product's UI and flow; reuse only audited technical primitives.
- Wants frequent coherent commits and `dev` development with PRs into protected `main`; checkpoint complete review units and avoid direct feature work on `main`.
- Expects the highest-quality output and informed action rather than timid scaffolding; investigate first, then deliver complete bounded work.
