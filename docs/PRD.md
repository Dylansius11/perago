# Perago Product Requirements

**Status:** Foundation specification for review  
**Product line:** Intent, carried through.  
**Supporting line:** Give the goal, not the wallet.

## 1. Executive summary

Perago is a bounded execution layer for onchain agents. A user states an outcome, receives a typed and simulated plan, and signs one Task Mandate whose authority is limited by asset, amount, protocol, action, recipient, chain, executor, expiry, nonce, and deterministic postcondition. An executor can optimize only inside those bounds. The system records whether the requested outcome was achieved and releases agent payment only after deterministic verification.

The category is **intent-based, policy-constrained agent execution**. Perago is not a wallet, chatbot, portfolio manager, marketplace, or general-purpose transaction signer.

## 2. Problem and timing

Wallet users must currently choose between manual transaction sequences and agents with authority broader than the task. A natural-language request is convenient but is not an authorization boundary. Approval dialogs also describe calls, not the intended end state.

Three developments make a bounded alternative practical:

1. Typed-data signatures can bind human-readable intent to machine-enforced parameters.
2. Account/session systems and minimal executor contracts can constrain targets, selectors, values, expiry, and spend.
3. Draft agent-commerce standards such as ERC-8183 define escrow and evaluator roles, allowing payment to follow verified outcomes instead of model claims.

The product opportunity is to make delegated execution legible and safe enough to demonstrate: the user gives a goal, not custody; the agent gets a one-time mandate, not a wallet.

## 3. Target user and job to be done

### Primary persona

A self-custodial BNB Smart Chain user who understands swaps and staking but does not want to monitor routing, timing, or a multistep transaction flow. The user will delegate a narrowly defined task when the spend ceiling, destination, expiry, and minimum acceptable outcome are explicit and enforceable.

### Job to be done

> When I want an onchain outcome without manually executing each step, let me state the goal, inspect the maximum downside and minimum result, authorize exactly one bounded task, and later verify what happened without giving an agent durable wallet control.

### Secondary users

- A protocol or agent developer integrating a bounded execution SDK.
- A hackathon judge verifying that the AI cannot exceed the signed authority and that payment follows objective completion.

## 4. Thesis and differentiation

Perago separates four concerns that are often collapsed:

| Concern | Owner |
| --- | --- |
| Interpret the user's language and explain choices | AI planner |
| Determine whether a plan is inside persistent wallet policy | Deterministic policy engine |
| Authorize and execute a one-time action | User signature plus mandate enforcement path |
| Decide whether the outcome earns payment | Adapter-specific deterministic verifier |

The moat is not natural-language transaction generation. It is **bounded authority with outcome evidence**:

- persistent policy limits what the user is willing to delegate;
- a Task Mandate narrows that policy to one action;
- a simulation commitment prevents silent plan substitution;
- one-use consumption prevents replay;
- a verifier checks the action's postconditions;
- an Execution Receipt makes the evidence auditable;
- ERC-8183 settlement links payment to the verified receipt.

## 5. Canonical domain concepts

| Concept | Definition |
| --- | --- |
| `WalletPolicy` | Versioned user policy describing protected/active assets, enabled services, approved protocols, per-task/day caps, and maximum slippage. |
| `TaskIntent` | The user's natural-language goal plus wallet, chain, recipient, and requested expiry. It is input, not authority. |
| `CompiledPlan` | Typed action proposed by the planner and normalized by deterministic code. |
| `TaskMandate` | EIP-712 signed, one-use authorization binding the complete bounded action and verification commitment. |
| `SimulationResult` | Deterministic preflight evidence and before/expected-after values for the exact compiled action and block context. |
| `VerificationResult` | Adapter-specific postcondition evaluation with evidence references and reason codes. |
| `ExecutionReceipt` | Public commitment connecting intent, policy, simulation, mandate, transactions, verification, terminal state, and authority consumption. |

Field ownership and persistence are canonical in [`technical/ERD.md`](technical/ERD.md). The signed schema is canonical in [`technical/SMART-CONTRACT.md`](technical/SMART-CONTRACT.md).

## 6. Core journey

1. The user connects a self-custodial owner wallet and derives or deploys its BSC smart account.
2. The user creates or activates a versioned Wallet Policy; the smart account records the active policy hash and narrowly scopes any executor session permission.
3. The user states one swap or stake outcome in natural language.
4. The AI produces a typed plan and an explanation.
5. Deterministic code normalizes the plan and intersects it with the active Wallet Policy.
6. Perago rejects any conflict; it never silently broadens either the plan or policy.
7. The exact action is simulated against a recorded block context.
8. The user reviews maximum spend, minimum output, protocol, recipient, expiry, risks, and deterministic postcondition.
9. The root owner signs one EIP-712 Task Mandate binding both owner and smart account.
10. The executor authorizes the mandate onchain, permanently consuming its nonce.
11. When ready, the executor calls `beginExecution`; this commits the single accepted attempt before protocol interaction.
12. A narrowly permissioned ERC-4337 UserOperation lets the smart account call only the committed `perform` path; the executor chooses only among routes encoded by the signed action commitment.
13. The adapter-specific verifier checks the signed postcondition.
14. The mandate reaches `SUCCEEDED`, `FAILED`, `EXPIRED`, or `REVOKED`; no terminal mandate can execute again.
15. An Execution Receipt records commitments, UserOperation/transaction evidence, and consumed authority.
16. A bound ERC-8183 job is completed only for a successful, deterministically verified receipt; otherwise it is rejected or refunded under its own lifecycle.

## 7. State transitions

### 7.1 Product-level mandate lifecycle

```text
DRAFT
  ├─ policy conflict ───────────────> REJECTED_POLICY
  └─ policy pass + simulation ──────> SIMULATED
SIMULATED
  ├─ simulation invalidated ────────> DRAFT
  └─ valid user signature ──────────> SIGNED
SIGNED
  ├─ user revokes / expires ────────> REVOKED / EXPIRED
  └─ onchain authorization ─────────> AUTHORIZED
AUTHORIZED
  ├─ user revokes / expires ────────> REVOKED / EXPIRED
  └─ executor begins attempt ───────> EXECUTING
EXECUTING
  ├─ verified postcondition ────────> SUCCEEDED
  └─ call/verifier failure ─────────> FAILED
```

`REJECTED_POLICY`, `SUCCEEDED`, `FAILED`, `EXPIRED`, and `REVOKED` are terminal. `SIGNED` is offchain; `AUTHORIZED` onward is confirmed from chain events. Detailed onchain transitions and race rules are defined in [`technical/SMART-CONTRACT.md`](technical/SMART-CONTRACT.md).

### 7.2 Wallet Policy lifecycle

Policies are immutable versions. Exactly one version per smart account and chain may be `ACTIVE`. Activating a new version makes the prior version `SUPERSEDED`. A revoked policy cannot authorize a new plan. A mandate already signed against an older policy is valid only if the mandate enforcement path still accepts its policy hash and owner epoch; the MVP rejects authorization when its policy version is no longer active.

## 8. Wallet Policy behavior

A Wallet Policy must express:

- protected assets that cannot be spend inputs;
- active assets that may be spent;
- enabled services: `SWAP` and/or `STAKE`;
- approved protocol adapter identifiers;
- maximum input per task by token;
- rolling daily maximum by token;
- maximum slippage in basis points;
- allowed recipients (`SELF` only by default);
- maximum task lifetime;
- chain ID.

Policy evaluation is deterministic and produces a structured decision containing every rule, pass/fail result, and conflicting value. The AI may propose a smaller amount, shorter expiry, stricter slippage, or narrower route. It may not add an asset, service, protocol, recipient, target, or budget absent from policy.

## 9. Task Mandate behavior

The root owner signs one typed mandate after simulation. The mandate binds at least:

- root owner, asset-holding smart account, and authorized executor/session public key;
- smart-account implementation/owner epoch where required for replay protection;
- chain and verifying contract through both fields and EIP-712 domain separation;
- nonce and expiry;
- policy, intent, plan, simulation, action, and postcondition commitments;
- approved adapter and exact adapter entry selector;
- input/output assets, maximum input, minimum output, recipient;
- ERC-8183 job binding when payment is enabled.

The smart-account session permission is transport authority only: it may submit the already user-authorized call path, but it cannot create a root-owner Task Mandate, change policy, upgrade the account, install modules, or call arbitrary targets. Authorization and execution are separate onchain transitions so an attempted action can end in `FAILED` without rolling back nonce consumption. A signature is not a reusable session. Any terminal outcome ends its authority.

## 10. AI and deterministic boundaries

### AI may

- translate natural language into the closed `CompiledPlan` schema;
- ask for missing intent information before compilation;
- explain route, timing, policy conflicts, and risks;
- choose among routes explicitly encoded in the signed action commitment;
- recommend narrower limits.

### AI must never

- sign, activate, or widen Wallet Policy;
- create executable calldata outside the typed action compiler;
- add targets, selectors, assets, recipients, or spending authority;
- receive an owner seed phrase or private key;
- decide its own payment eligibility;
- convert an ambiguous outcome into authority without user review.

### Deterministic components own

- schema validation and normalization;
- policy intersection and daily-cap accounting;
- calldata construction from a closed adapter schema;
- quote freshness and simulation commitment;
- EIP-712 digest and signature verification;
- nonce, expiry, caller, adapter, selector, token, amount, and recipient enforcement;
- postcondition verification and terminal receipt status;
- ERC-8183 evaluator decision.

## 11. MVP scope

### Included

- BSC Testnet-first external wallet connection with an ERC-4337 smart account controlled by the user's self-custodial root signer.
- Alchemy Modular Account V2 with BNB Testnet bundling/gas sponsorship, subject to deployment and EntryPoint bytecode validation.
- Versioned Wallet Policy for swap/stake, assets, protocols, amounts, daily caps, slippage, recipient, expiry, and executor-session scope.
- One natural-language intent producing exactly one executable action.
- Swap via one approved PancakeSwap adapter.
- Stake via one approved, pre-validated BSC staking adapter.
- Exact-action simulation and stale-simulation rejection.
- EIP-712 Task Mandate, one-use authorization, revocation, expiry, and terminal failure.
- Constrained executor with idempotent UserOperation/transaction reconciliation.
- Adapter-specific verification and public Execution Receipt.
- ERC-8183 job linkage and settlement after successful verification.

### Explicit non-goals

- LP position management;
- lending or borrowing automation unless a selected staking primitive strictly requires it;
- perpetuals, leverage, options, or liquidation management;
- bridging or cross-chain execution;
- arbitrary calldata or user-supplied target contracts;
- general agent marketplace, listings, profiles, leaderboard, or reputation economy;
- multi-agent committees;
- token or governance system;
- subjective LLM evaluation;
- durable custody or unrestricted wallet access;
- production-grade protocol breadth;
- UI or design-system specification before user direction.

## 12. Requirements

### Functional requirements

| ID | Requirement |
| --- | --- |
| PRD-F-001 | A user can connect a self-custodial owner wallet, derive or deploy its supported BSC smart account, and reject unsupported/mismatched chains or account implementations. |
| PRD-F-002 | A user can create, activate, supersede, and revoke immutable Wallet Policy versions. |
| PRD-F-003 | A Wallet Policy supports protected/active assets, services, protocols, per-task/day caps, slippage, recipients, task lifetime, and executor-session scope. |
| PRD-F-004 | A user can submit a natural-language swap or stake outcome that becomes a closed typed `CompiledPlan`. |
| PRD-F-005 | Deterministic policy intersection returns a complete rule-by-rule decision and rejects broader plans. |
| PRD-F-006 | The exact compiled action is simulated and reports balances, max spend, minimum output, protocol, recipient, expiry, risks, block context, and freshness. |
| PRD-F-007 | The root owner can sign exactly one EIP-712 Task Mandate only from a policy-passing, fresh simulation. |
| PRD-F-008 | The executor can authorize and execute a signed mandate only through the smart account's scoped ERC-4337 path, approved adapter, and action schema. |
| PRD-F-009 | The swap adapter executes an exact-input swap subject to signed maximum input, minimum output, recipient, route, and deadline. |
| PRD-F-010 | The staking adapter stakes no more than the signed input and proves the recipient's resulting position or receipt-token increase. |
| PRD-F-011 | An adapter-specific verifier emits a structured `VerificationResult` for every execution attempt. |
| PRD-F-012 | A public `ExecutionReceipt` links the intent, policy, plan, simulation, mandate, UserOperation/transaction evidence, verification, and consumed authority. |
| PRD-F-013 | The user can revoke an authorized but unexecuted mandate; expired mandates can be finalized without executor cooperation. |
| PRD-F-014 | A bound ERC-8183 job pays the provider only after a successful deterministic verification and remains refundable/rejectable otherwise. |
| PRD-F-015 | The executor resumes safely after restart and treats duplicate work delivery as an idempotent reconciliation or status read. |
| PRD-F-016 | Every terminal state exposes a stable machine-readable reason code and human-readable explanation. |
| PRD-F-017 | Policy activation and revocation support sponsored or batched ERC-4337 UserOperations without granting the paymaster, bundler, or executor root ownership. |

### Security and trust requirements

| ID | Requirement |
| --- | --- |
| PRD-S-001 | AI output can only narrow policy and cannot directly authorize execution. |
| PRD-S-002 | Protected assets are rejected as spend inputs in policy evaluation and mandate execution. |
| PRD-S-003 | Every smart account, root owner, target, adapter entry selector, asset, amount, recipient, executor, chain, nonce, and expiry is signed and enforced. |
| PRD-S-004 | A mandate nonce is consumed once; success, terminal failure, expiry, or revoke prevents any later execution. |
| PRD-S-005 | ERC-20 allowances are exact and temporary; unlimited approvals are forbidden and adapter allowance is cleared after an attempt. |
| PRD-S-006 | Replay across chain, deployment, smart account, owner epoch, executor, or action is rejected. |
| PRD-S-007 | Payment eligibility is decided by deterministic adapter verification, never model output or executor assertion. |
| PRD-S-008 | Secrets never enter model context, source control, telemetry, public receipts, or application logs. |
| PRD-S-009 | Simulation/action drift, stale quotes, changed policy, changed account owner, or changed account implementation invalidates signing or execution. |
| PRD-S-010 | Adapter and verifier implementations are immutable or governed by an explicit, observable admin policy; a mandate binds the selected implementation. |
| PRD-S-011 | Onchain events are the authority for execution/receipt status; offchain data is rebuildable and reconciled under reorgs. |
| PRD-S-012 | ERC-8183 settlement cannot complete from an unverified, failed, expired, revoked, or mismatched receipt. |
| PRD-S-013 | Account-abstraction permissions are defense in depth: no executor/session key may sign a root Task Mandate, change root ownership/policy, install or upgrade modules, or call outside its exact target/function/spend/time limits. |

### Operational requirements

| ID | Requirement |
| --- | --- |
| PRD-O-001 | The demo exposes trace IDs and links every lifecycle stage without logging secret or raw signed-session material. |
| PRD-O-002 | RPC, planner, quote, executor, verifier, indexer, and settlement degradation is explicit; no component reports false success. |
| PRD-O-003 | Integration evidence records chain, contract address, transaction hash, block, and verification status. |
| PRD-O-004 | Repository changes pass the verification gates in `AGENTS.md` and the phase-specific checks in `BUILD-PLAN.md`. |

## 13. Measurable success criteria

| ID | Criterion |
| --- | --- |
| SC-001 | In the judge demo, one swap mandate completes from intent to paid ERC-8183 job with a public receipt and explorer-linked transaction evidence. |
| SC-002 | One stake mandate completes from intent to verified position/receipt-token increase with consumed authority. |
| SC-003 | Attempts to exceed max input, reduce minimum output, change recipient, call another selector/adapter, replay a nonce, or execute after expiry/revoke all fail deterministically. |
| SC-004 | A forced adapter or verifier failure reaches terminal `FAILED`, withholds ERC-8183 payment, and cannot be retried under the same mandate. |
| SC-005 | Duplicate executor delivery after a confirmed terminal event causes no additional onchain action. |
| SC-006 | A fresh environment can reproduce the documented demo using only checked-in non-secret configuration and operator-supplied credentials. |
| SC-007 | Every public integration claim is backed by an official source or labeled as testnet/fork/local evidence. |

## 14. Hackathon strategy and judge-verifiable demo

Perago should compete on a single claim: **an AI agent can carry intent through without receiving wallet-wide authority**.

### Demo story

1. Show a Wallet Policy where a protected asset is visibly excluded and swap/stake limits are explicit.
2. Ask: “Swap up to X into Y when the route guarantees at least Z; send it back to me before expiry.”
3. Show the typed plan, policy intersection, simulation block, max spend, minimum result, target adapter, recipient, and expiry.
4. Sign one mandate.
5. Show autonomous execution, verifier evidence, consumed nonce, public receipt, and ERC-8183 completion/payment.
6. Replay the same signed mandate and show deterministic rejection.
7. Attempt a modified recipient or excess amount and show signature/bound failure.
8. Run a stake mandate and verify receipt-token/position increase.
9. Force a failed postcondition and show terminal failure plus withheld payment.

### Track strategy

- **BNB Chain:** real BSC execution, official chain tooling, explorer evidence, and a constrained agent runtime.
- **Agent/AI:** AI is useful but visibly subordinate to deterministic policy and verification.
- **DeFi:** exact-input swap and staking demonstrate materially different adapter postconditions.
- **Standards:** ERC-712 authorization and ERC-8183 outcome-linked settlement create a legible end-to-end trust story.

Do not add ERC-8004 solely for category coverage. It enters scope only if a target track requires identity discovery and its integration does not displace mandate safety or demo reliability.

## 15. Risks, assumptions, and decision gates

| ID | Type | Statement | Resolution / validation |
| --- | --- | --- | --- |
| R-001 | Risk | A post-execution verifier may detect failure after an irreversible protocol effect. | Verify enforceable minimums inside the adapter call; use post-verification for evidence, not as the only economic guard. |
| R-002 | Risk | RPC/quote state can move after simulation. | Bind block context, quote deadline, max input, and min output; reject stale simulation and tolerate safe favorable drift only. |
| R-003 | Risk | An approved adapter can become unsafe or protocol behavior can change. | Bind adapter implementation, keep the initial set minimal, pause new authorizations on incident, and document admin posture. |
| R-004 | Risk | Two onchain transitions (`authorize`, `execute`) add latency. | Accept the cost to preserve one-use terminal failure; use sponsored UserOperations where safe and expose every hash. |
| R-005 | Risk | Bundler, paymaster, or Wallet API outage could block the smart-account path. | Keep standard ERC-4337 semantics and an owner-funded public-bundler path; never fall back to an unrestricted server wallet. |
| A-001 | Assumption | BSC supports the required EVM typed-data, ERC-1271/ERC-4337, contract, and event behavior. | Prove with focused BSC Testnet deployment, UserOperation, and replay tests. |
| A-002 | Assumption | The selected swap pools have adequate testnet liquidity or can be seeded transparently. | Phase 1 integration probe; otherwise run a mainnet fork and label it, never fabricate liquidity. |
| D-001 | Resolved | Account abstraction provider and mandate-enforcement split. | Use Alchemy Modular Account V2 and BNB-supported bundler/paymaster APIs for ERC-4337 UX. Keep the minimal Mandate Executor as the authoritative one-use/effect boundary; provider permissions are defense in depth, not a substitute. |
| D-002 | Decision gate | Which staking deployment is live and deterministic enough for the demo. | Validate selected PancakeSwap CAKE Pool bytecode, asset flow, and withdraw/read methods on chain 97 before implementation; use a labeled fork contingency if unavailable. |
| D-003 | Decision gate | Which ERC-8183 deployment and payment token are live on target BSC network. | Resolve from the upstream deployment manifest at implementation time and pin chain/address/bytecode; no hard-coded unverified address. |
| D-004 | Decision gate | Whether a third-party simulation service is required for balance state diffs. | Begin with adapter quote + `eth_call` + explicit balance reads; add a provider only if the Phase 3 smoke test cannot produce judge-verifiable evidence. |

## 16. Acceptance criteria

| Requirement IDs | Acceptance evidence |
| --- | --- |
| PRD-F-001–003, PRD-F-017, PRD-S-013 | A self-custodial root wallet controls the expected BSC smart account; policy activation/revoke works through ERC-4337, while forbidden executor-session calls, account upgrades, and owner changes are rejected. |
| PRD-F-004–005, PRD-S-001–002 | The same intent produces a schema-valid plan; a broader AI field is rejected by deterministic intersection and never reaches simulation. |
| PRD-F-006–007, PRD-S-009 | A signed digest can be recomputed from stored canonical fields; stale block/quote/policy/account/action changes invalidate signing or authorization. |
| PRD-F-008–010, PRD-S-003–006, PRD-S-010 | Focused contract tests and BSC evidence prove exact account/target/selector/value/recipient enforcement, exact temporary approvals, one-use consumption, and both supported actions. |
| PRD-F-011–012, PRD-S-007, PRD-S-011 | Each attempt yields one deterministic verification and receipt whose hashes reconcile to UserOperation, transaction, and chain events and whose cache can be rebuilt. |
| PRD-F-013, PRD-S-004 | Revoke and expiry races have one terminal winner; subsequent execute calls fail without protocol side effects. |
| PRD-F-014, PRD-S-012 | ERC-8183 completes only from a matching `SUCCEEDED` receipt; failed/revoked/expired/mismatched evidence cannot release payment. |
| PRD-F-015–016, PRD-O-001–003 | Restart and duplicate-delivery smoke scenarios preserve one onchain attempt and expose traceable terminal reason/evidence. |
| PRD-O-004 | All phase gates and repository verification commands pass before merge. |

Task-level mapping is canonical in [`BUILD-PLAN.md`](BUILD-PLAN.md).
