# Perago BNB and Protocol Integration Map

**Status:** Evidence-backed through `P3-004`; chain-97 account, protocol, settlement, atomic policy-transition, production adapter, and pre-signature simulation proofs exist, while the executor lifecycle through a smart account remains pending
**Reviewed:** 2026-09-23
**Contract boundary:** [`SMART-CONTRACT.md`](SMART-CONTRACT.md)

## 1. Evidence policy and statuses

An official page proves what its publisher documents; it does not prove that bytecode is still deployed, configured safely, funded, or usable by Perago. Before implementation, every address and capability used in a transaction must be checked on the target chain and recorded with block number, code hash, ABI/source version, and smoke transaction.

| Status | Meaning |
| --- | --- |
| `proposed` | Selected architecture or candidate integration; implementation evidence does not yet exist. |
| `verified in reference repo` | Current source in the read-only research repository was inspected. This is historical evidence only and is never Perago proof. |
| `needs re-verification` | Official/current documentation supports the claim, but Perago must validate the exact deployment, version, configuration, or behavior before use. |
| `blocked` | A required official deployment/capability/evidence is unavailable; do not implement or claim it until resolved. |

No entry is marked “integrated” in this phase.

## 2. Integration summary

| Integration | MVP use | Status | Decision |
| --- | --- | --- | --- |
| BNB Smart Chain Testnet | Execution chain | `verified` | Selected; chain 97 executes Perago account, swap, stake, and settlement traffic today. |
| External self-custodial wallet | Root owner | `verified` | User-controlled MetaMask signatures activated and revoked the P3-002 policy on chain 97; the product wallet-connector journey remains implementation work. |
| Alchemy Modular Account V2 | ERC-4337 smart account | `verified` | Selected; deployment, ownership, bounded session, and forbidden-shape rejection are proven on chain 97. |
| Alchemy Bundler + Gas Manager | UserOperation transport/sponsorship | `verified` | Selected initial provider; sponsored and owner-paid paths both proven, and the owner-paid fallback is automatic. |
| MandateExecutor | One-use semantic authority | `proposed` | Production instance `0xc6184Fb3e12F4C79b50f37175f3229d91664EC66` on chain 97 pins the production swap and stake pairs with the `SC-D-005` 600-second window and unbound commerce jobs disabled ([manifest](../../deployments/bsc-testnet.perago.json)). Its adapters and verifiers are proven live ([evidence](../evidence/bsc-testnet.adapters-live.json)). Because the production executor requires an ERC-8183 job, which does not exist before Phase 6, the full lifecycle through a smart account is proven on the labelled `testnet-demo` instance `0x5587896753AD6f65ad40ee812f4e1160f6691b7C`. It is the same source over the same pairs and window, with unbound jobs allowed (`SC-D-006`, [manifest](../../deployments/bsc-testnet.demo.perago.json)). The swap lifecycle is proven there on chain 97 by `P4-003` ([evidence](../evidence/bsc-testnet.phase4-swap-journey.json), [fork](../evidence/bsc-testnet.fork.phase4-swap-journey.json)). The stake lifecycle is proven there by `P5-002` ([evidence](../evidence/bsc-testnet.phase5-stake-journey.json), [fork](../evidence/bsc-testnet.fork.phase5-stake-journey.json)). The production instance's job-bound lifecycle is Phase 6, so the status stays `proposed`. The P3-002 instance is policy-probe-only. |
| BNB Agent SDK | ERC-8183 helpers/BNB ecosystem utilities | `needs re-verification` | Evaluate narrowly; do not adopt its key provider or SDK wholesale. |
| Altana EIP-7702 sessions | Alternate session path | `verified in reference repo` | Not selected; historical experiment and current official SDK mention are insufficient for Perago's exact guarantees. |
| Trust Wallet Agent Kit | Alternate wallet/agent runtime | `proposed` | Not selected for MVP; no need beside the chosen ERC-4337 path. |
| ERC-8004 | Agent identity/reputation/validation | `proposed` | Deferred; does not earn MVP complexity. |
| ERC-8183 / BNB APEX | Outcome-based agent commerce | `verified` | Selected; kernel pinned, Perago hook deployed, and completion, rejection, and expiry refunds proven on chain 97. |
| PancakeSwap V3 | Exact-input swap | `verified` | Selected swap protocol; router, quoter, factory, and a liquid direct pool proven with a live swap. |
| PancakeSwap CAKE Pool | Single-asset stake | `verified` | Selected; deposit, share position, and fee-bearing withdrawal proven from the smart account, and a mandate-bound stake through `CakeStakeAdapter` proven end to end on chain 97 ([evidence](../evidence/bsc-testnet.phase5-stake-journey.json)). |
| USD1 | Mainnet payment-token candidate | `needs re-verification` | Official BSC mainnet address exists; not a testnet token. |
| APEX payment token (United Stables `U`) | ERC-8183 demo payment token | `verified` | Selected; upstream labels it USDC, onchain it is `U`. No faucet: funded through one V2 pair. |
| Quote + pinned `eth_call` state override | Pre-sign simulation | `verified` | Selected in `P3-004`: a QuoterV2 quote or exact-path share estimate at one pinned block, then the account's exact calls run against the production executor, adapter, verifier, and protocol through one `eth_call` with a state override (section 11). Proven on a chain-97 fork and read-only on chain 97 ([evidence](../evidence/bsc-testnet.fork.phase3-smoke.json)). Bundler UserOperation simulation belongs to execution (`P4-002`), because a mandate cannot be authorized before it is signed. No third-party simulator is added. |
| Groq `openai/gpt-oss-120b` | Untrusted intent planner | `verified` | Selected in `P3-003`; strict `json_schema` constrained decoding returned only the closed candidate across a ten-intent matrix on 2026-09-23 ([evidence](../evidence/p3-003-planner-live.json)). It never authorizes; the deterministic compiler owns every value. Sources: [structured outputs](https://console.groq.com/docs/structured-outputs), [data retention](https://console.groq.com/docs/your-data). |

## 3. BNB Smart Chain

### Network facts

BNB Chain's official wallet documentation lists:

| Network | Chain ID | Native symbol | Explorer | Official RPC example |
| --- | ---: | --- | --- | --- |
| BSC Testnet | `97` (`0x61`) | tBNB | `https://testnet.bscscan.com` | `https://data-seed-prebsc-1-s1.bnbchain.org:8545` |
| BSC Mainnet | `56` (`0x38`) | BNB | `https://bscscan.com` | `https://bsc-dataseed.bnbchain.org` |

Sources: [BNB wallet configuration](https://docs.bnbchain.org/bnb-smart-chain/developers/wallet-configuration/) and [BNB Agent SDK networks](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/).

The official [BSC faucet guide](https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/) links the online faucet and documents official Discord/Telegram requests with a 0.3 tBNB/user/day limit. Faucet availability and token choices are operational dependencies, not protocol guarantees.

### Perago network policy

- Chain 97 is the live demo target; chain 56 is disabled until a separate mainnet approval gate.
- API and contracts compare numeric chain ID; display names are never authoritative.
- Use at least two independently operated RPC endpoints for critical comparisons and indexer recovery.
- Record block number and block hash for every quote/simulation.
- Confirmation rule (`SC-D-005`, measured 2026-09-23): chain 97 exposes BSC fast finality, with `finalized` trailing `latest` by 1-2 blocks (about 1 s at a 450 ms average block). A transaction counts as confirmed only when its block is at or below `finalized`; one receipt alone is never finality.
- Reject endpoints returning the wrong genesis/chain ID or lagging beyond the configured threshold.

### Failure behavior

| Failure | Response |
| --- | --- |
| Primary RPC unavailable | Retry boundedly, use independent fallback, preserve pinned block constraints. |
| RPCs disagree on canonical block/code | Stop signing/submission and expose `CHAIN_DATA_UNCERTAIN`. |
| Faucet unavailable | Use already funded disposable test wallets; never ask for a production key. |
| Explorer unavailable | Continue chain reads; display evidence when explorer recovers. |
| Testnet reset/deployment disappearance | Block integration, invalidate manifests, redeploy only Perago-owned contracts, and re-run probes. |

## 4. Wallet and account abstraction

### 4.1 Selected design: Alchemy Modular Account V2

Alchemy's official [Wallet APIs supported chains](https://www.alchemy.com/docs/wallets/supported-chains) lists BNB Mainnet and BNB Testnet with bundler, gas sponsorship, ERC-20 gas payments, and batch-send-operation support. Its [smart-contract deployment page](https://www.alchemy.com/docs/wallets/smart-contracts/deployed-addresses/) states that account contracts use the same addresses across supported EVM chains.

Perago pins these contracts. Code at every address below was read on chain 97 and hashed; the code hashes, the verification block, and the signed execution evidence live in the reviewed manifest [`deployments/bsc-testnet.account.json`](../../deployments/bsc-testnet.account.json), which owns those values. `pnpm --filter @perago/executor probe:account-live` re-reads each address and fails if any live code hash drifts from the manifest.

| Contract | Version | Address | Status |
| --- | --- | --- | --- |
| `EntryPoint` | `v0.7` | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | `verified` code on chain 97 |
| `SenderCreator` | `v0.7` | `0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C` | `verified` code on chain 97; the EntryPoint's first `CREATE`, required for factory deployment |
| `SemiModularAccountBytecode` | `v2.0.0` | `0x000000000000c5A9089039570Dd36455b5C07383` | `verified` code on chain 97; the implementation Perago derives accounts from |
| `AccountFactory` | `v2.0.0` | `0x00000000000017c61b5bEe81050EC8eFc9c6fecd` | `verified` code on chain 97 |
| `SingleSignerValidationModule` | `v1.0.0` | `0x00000000000099DE0BF6fA90dEB851E2A2df7d83` | `verified` code on chain 97 |
| `AllowlistModule` | `v1.0.0` | `0x00000000003E826473A313e600B5B9b791f5A59A` | `verified` code on chain 97 |
| `NativeTokenLimitModule` | `v1.0.0` | `0x00000000000001e541f0D090868FBe24b59Fbe06` | `verified` code on chain 97 |
| `TimeRangeModule` | `v1.0.0` | `0x00000000000082B8e2012be914dFA4f62A0573eA` | `verified` code on chain 97 |
| `ModularAccount` | `v2.0.0` | `0x00000000000002377B26b1EdA7b0BC371C60DD4f` | `proposed`; not used, Perago selects the semi-modular bytecode variant |
| `PaymasterGuardModule` | `v1.0.0` | `0x0000000000001aA7A7F7E29abe0be06c72FD42A1` | `needs re-verification`; only if sponsorship guarding is adopted |

The derived account address is a CREATE2 result over factory, salt, owner, and the implementation bytecode, so the implementation address is load-bearing: a stale value points funds at an unreachable account. Chain-97 ownership and bounded execution are proven: the disposable root owner `0x2E42E0FB693765715014934282b9A7d3cF0c3818` deployed and drove account `0x2863167c8653b9369Ef51De203742A3429AC57E2` through the Alchemy bundler, including one owner-paid operation and one fully sponsored operation whose `actualGasCost` was `0`. Transaction hashes are recorded in [`../BUILD-PLAN.md`](../BUILD-PLAN.md) and the manifest.

For `P3-002`, the user-controlled root `0x712683F374Cd524F6336E87D577Fc39d1102930A` deployed the derived account `0x17fcCe2B0C0cc44c4F88C6C09b6364a766Ee7944`. One owner-paid root UserOperation atomically installed the bounded session and activated the policy; a second atomically uninstalled the session and wrote the revocation policy. The exact transaction, UserOperation, block, account-state, and probe-deployment evidence is in [`../evidence/bsc-testnet.p3-policy-live.json`](../evidence/bsc-testnet.p3-policy-live.json) and [`../../deployments/bsc-testnet.p3-policy-probe.json`](../../deployments/bsc-testnet.p3-policy-probe.json). The deployment's mock adapters/verifiers and 3,600-second window are not production evidence.

### 4.2 Session permission shape

Alchemy's official [session-key permission reference](https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys) documents expiry, ERC-20 cumulative allowance, gas limit, contract access, account-function, functions-on-contract, functions-on-all-contracts, and dangerous `root` permissions.

Perago allows only the combination now proven enforceable on the deployed modules, encoded by `encodeInstallMandateSession` in `packages/sdk/src/account/modular-account.ts`:

- one single-signer validation scoped to the account's `execute` selector only, so no other account function is reachable through the session;
- one pre-validation allowlist pinning exactly one target contract and its permitted selectors;
- one pre-execution native spend cap;
- one validation-time expiry window, which is always set;
- no `root`, wildcard contract, all-contract function, module install, upgrade, ownership, batch, `performCreate`, runtime-validation, or ERC-20 `approve` authority. The SDK rejects any of those selectors at encode time, and the selector values are taken from the deployed account's dispatcher rather than from vendor constants.

Both locally replayed chain-97 bytecode and signed chain-97 execution confirm the enforcement: the allowlisted call is accepted, while an unrelated target and an unallowlisted selector fail the allowlist hook, `installValidation` and a revoked session fail validation lookup, a self-call exceeds the account's self-call recursion guard, an over-limit spend reverts before any value moves, and an expired session fails the time-range window. Each rejection reason is decoded in [`../BUILD-PLAN.md`](../BUILD-PLAN.md).

Because a session cannot bound call arguments, granting the token `approve` selector to a session key would permit an arbitrary allowance. The production adapters did not remove the need: `MandateExecutor.executeCore` pulls exactly `maxInput` from the account with `transferFrom`. **`D-004` was resolved by user decision on 2026-09-23 (`SMART-CONTRACT.md` §7):** the root owner grants `approve(MandateExecutor, maxInput)` in one root UserOperation when signing the mandate, and the session stays `perform`-only. The executor refuses to authorize or begin until it reads an allowance and a balance of at least `maxInput`. The `P3-004` simulation runs the same account calls, `approve(MandateExecutor, maxInput)` then `perform`, and shows that a successful attempt consumes the approval exactly. A `FAILED`, revoked, or expired mandate leaves at most that exact allowance, which only another root-signed mandate of the same account can use; the root owner clears or overwrites it with a later approval.

A contract/function allowlist can still permit malicious arguments. MandateExecutor independently validates the root Task Mandate, action hash, amount, recipient, protocol, nonce, and postcondition.

### 4.3 Bundler/paymaster degradation

- Persist UserOperation hash and query EntryPoint/onchain receipts before retry.
- Sponsorship is optional. If denied/unavailable, offer an owner-funded standard UserOperation without changing calls.
- A public standards-compatible bundler (Pimlico documents BNB Testnet support) is a candidate fallback only after the same EntryPoint/version probe.
- A bundler cannot be allowed to select calls, payee, or mandate fields.
- Paymaster policies are capped by chain, account, target selectors, gas, request rate, and total budget.
- The P3-002 transitions were intentionally owner-paid; no Gas Manager policy was used or required.
- Before sponsoring later calls, validate Alchemy's current dashboard semantics and restrict the policy to chain 97, sender `0x17fcCe2B0C0cc44c4F88C6C09b6364a766Ee7944`, the exact approved account call shape, bounded gas/request counts, and a small total budget. Sponsorship is never an authorization boundary.
- Rate limits are provider/account-specific and were not found as a stable universal value; read the active plan/dashboard during Phase 1 and configure backoff from observed headers/errors.

### 4.4 Alternatives

| Option | Evidence | Decision |
| --- | --- | --- |
| Privy smart wallets | Privy documents EVM smart wallets, but its native smart-wallet owner is a Privy embedded wallet; external wallets are connectors rather than the documented native smart-wallet owner path. | Reject for MVP primary path; conflicts with existing external self-custodial owner journey and adds another custody/auth surface. |
| Biconomy Nexus/MEE | Mainnet BNB is documented, but current official staging/testnet sponsorship list does not list BSC Testnet. | Reject until official BSC Testnet support is confirmed. |
| Pimlico + open smart account | Pimlico documents chain-97 bundler/paymaster support and EIP-7702. | Keep as transport fallback candidate; does not replace selected account or mandate checks. |
| Altana/EIP-7702 | BNB Agent SDK exposes `AltanaWalletProvider`; the reference repository contains historical session experiments. | Not selected. Reuse only knowledge after current source and adversarial permission audit. |
| Trust Wallet Agent Kit | BNB Agent SDK exposes `TWAKProvider`. | Not selected; adds no required capability beyond external wallet + ERC-4337 path. |

## 5. BNB Agent SDK

The official [TypeScript quickstart](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/quickstart-typescript/) documents Node.js 20+, ERC-8004 registration, ERC-8183 client/provider helpers, `EVMWalletProvider`, `TWAKProvider`, and `AltanaWalletProvider`. The official [security page](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/security/) documents strict EIP-712 signing policy, denies Permit variants by default, and recommends scoped signers rather than raw wallet providers.

Perago may reuse:

- current ERC-8183 ABI/types and lifecycle helper behavior after exact version/ABI audit;
- network/address resolution patterns after comparing upstream deployment source;
- strict signing-policy ideas and secure local-storage rules for tests.

Perago must not use:

- a local unrestricted Keystore provider as the production owner/executor path;
- automatic token approvals that exceed exact Perago bounds;
- provider settlement defaults that use optimistic or subjective success instead of Perago's deterministic receipt;
- a high-level helper whose hidden transaction sequence cannot be bound to Perago's hashes.

Prefer Viem calls against pinned ABIs when an SDK helper obscures lifecycle or approval behavior.

## 6. ERC-8183 / BNB APEX

### Standard

[ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) is a **draft** Agentic Commerce standard. Its state machine is `Open → Funded → Submitted → Completed/Rejected/Expired`; a designated evaluator alone completes a submitted job. Its refund path after expiry is a critical liveness property.

Perago uses the standard for payment escrow, not task authorization. The Task Mandate and receipt bind the commerce contract/job ID; `OutcomeEvaluator` completes only after deterministic success.

### BNB APEX deployment — verified and selected

The official BNB Chain [`apex-contracts` repository](https://github.com/bnb-chain/apex-contracts) is the upstream source. Every address below was read on chain 97, hashed, and pinned in [`deployments/bsc-testnet.protocols.json`](../../deployments/bsc-testnet.protocols.json), which owns the code hashes and ERC-1967 implementations.

| Contract | Address | Status |
| --- | --- | --- |
| `AgenticCommerceUpgradeable` proxy | `0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE` | `verified`; selected escrow kernel, implementation `0x55c3826b39a0f671b2c3e5d0f1372cad0b911421`, `platformFeeBP` `0`, not paused |
| `EvaluatorRouterUpgradeable` proxy | `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25` | `verified`; **not used**, see the policy finding below |
| `OptimisticPolicy` | `0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6` | `verified` upstream address; **not used**, optimistic settlement is not deterministic |
| Payment token, upstream labeled USDC | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` | `verified`; onchain it is **United Stables (`U`)**, 18 decimals, ERC-1967 upgradeable, `isPaymentTokenSupported` true |
| `PeragoAcpHook` | `0x64a807FceFb25ea710B2D3cb15Abf5e46f32cff0` | `verified`; Perago-owned inert hook, source `packages/contracts/src/hooks/PeragoAcpHook.sol` |

Four findings decided the integration shape:

1. **The kernel requires a hook.** `createJob` reverts with `HookRequired()` when `hook == address(0)` and with `HookMissingInterface()` unless the hook answers `type(IACPHook).interfaceId` (`0x7ff6bc9e`). Perago therefore deploys `PeragoAcpHook`: it holds no funds, never reverts on a legitimate kernel callback, and accepts callbacks only from the pinned kernel.
2. **A Perago policy cannot be registered upstream.** `EvaluatorRouterUpgradeable.registerJob` accepts only policies enabled through `setPolicyWhitelist`, which is `onlyOwner`. Perago cannot install a deterministic policy on the official router, so Perago does not use the router or `OptimisticPolicy`. Perago is instead the job's **evaluator**, which the standard allows, and its deterministic outcome check stays in Perago's own executor and mandate path.
3. **The payment token is obtainable but thin.** It has no public mint (`Ownable` mint) and no liquid V3 pool; the only funding route on chain 97 is the PancakeSwap V2 pair `0x55ed32b1808d4Bb9aD8DF8201494b74B982915F8`. Treat funding as a scarce test resource and keep job budgets small.
4. **Expiry has a floor.** `createJob` rejects `expiredAt <= block.timestamp + 5 minutes` (`ExpiryTooShort()`) and `expiredAt > block.timestamp + MAX_EXPIRY_DURATION` (one year).

`D-003` is resolved: Perago settles on the official APEX kernel with its own hook and its own evaluator, using the pinned payment token. The lifecycle is proven on chain 97 — completion, evaluator rejection refund, and permissionless expiry refund — with transaction hashes recorded in [`../BUILD-PLAN.md`](../BUILD-PLAN.md) and the full report in [`../evidence/bsc-testnet.protocol-live.json`](../evidence/bsc-testnet.protocol-live.json).

**`P6-002` evaluator evidence (fork + live read-only preflight, 2026-09-27):** [`bsc-testnet.fork.phase6-evaluator.json`](../evidence/bsc-testnet.fork.phase6-evaluator.json) records the chain-97 fork at block `132658000` with the official APEX proxy, Perago hook, real Pancake swap, evaluator completion/refund/rejection, and fork-only seeded United Stables (`U`). A read-only live preflight at block `133413598` confirmed the pinned APEX/payment-token proxy and implementation hashes, hook and MandateExecutor runtime hashes, executor pairs, unpaused state, and zero platform fee. The upstream proxy owner `0x1611E27BE13feb93242Bf57914872eA63f9E64DC` has contract code but its governance/signers were not established; it can upgrade the kernel or change fees. Rerun `pnpm --filter @perago/contracts preflight:evaluator` immediately before deploying or submitting jobs. No OutcomeEvaluator has been broadcast; no live deterministic Perago payment is claimed. `PERAGO_SETTLEMENT_PROVIDER` is an explicit payee decision, not inferred from a session signer.

### Failure behavior

- If no compatible deterministic evaluator can be installed, do not claim APEX settlement; deploy a clearly identified Perago test instance or mark settlement blocked.
- If upgrade/admin state changes after simulation, stop new jobs and invalidate the deployment manifest.
- If settlement is temporarily unavailable after Perago success, keep the successful receipt and retry the identical eligible call after reconciliation.
- If the job expires/rejects first, payment remains unavailable even if execution later reports success; executor must check job deadline before beginning.

## 7. ERC-8004 decision

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) is a draft standard for agent identity, reputation, and validation registries; payments are explicitly orthogonal. Perago does not need cross-organizational agent discovery for a single approved executor. It is deferred because it does not strengthen Wallet Policy, mandate limits, one-use execution, adapter verification, or ERC-8183 settlement.

Add it only if a judged track requires public identity and the exact BSC deployment is officially sourced, code-verified, and integrated without delaying core security evidence. Do not create agent/profile/reputation database tables in anticipation.

## 8. PancakeSwap exact-input swap

### Selection

PancakeSwap is selected because it is BSC-native, has official developer deployment documentation, and exposes a direct V3 exact-input path with a quoter. A fixed V3 adapter is smaller and more auditable than a generic smart-router/multicall path.

The official [PancakeSwap V3 address page](https://developer.pancakeswap.finance/contracts/v3/addresses) documents:

| Contract | BSC Testnet address | Perago use | Status |
| --- | --- | --- | --- |
| V3 `SwapRouter` | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` | Exact-input execution | `verified`; its `factory()` and `WETH9()` match the pinned factory and WBNB |
| `QuoterV2` | `0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2` | Pre-sign quote | `verified`; same factory and wrapper |
| V3 factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | Pool existence/fee validation | `verified`; four direct CAKE/WBNB pools, deepest at fee `500` |
| WBNB (`WETH9`) | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` | Native wrapper both routers use | `verified`; read from the router, never hand-copied |

The router uses the eight-field `exactInputSingle` struct that still carries `deadline`, not the SwapRouter02 shape. That is read from the deployed selector set, not assumed.

Perago deliberately rejects PancakeSwap Smart Router, Universal Router, arbitrary path bytes, multicall, native unwrap, and multi-hop routes in the first adapter. One pinned direct pool/fee pair per supported token pair is enough for the demo and produces a clear verifier.

### Probe and execution requirements

1. Verify code hashes/source and factory relationship at a recorded chain-97 block.
2. Confirm token addresses, decimals, standard transfer behavior, pool address, fee tier, liquidity, and quote result.
3. Compare QuoterV2 output with exact router `eth_call` from the smart-account/adapter context.
4. Bind `amountIn`, `amountOutMinimum`, recipient, fee, and deadline in the action hash.
5. Execute through `PancakeV3SwapAdapter`; output goes directly to signed recipient.
6. Verify recipient balance delta and maximum input spent from chain state.

If testnet liquidity is inadequate, use a transparently seeded test pool or a pinned BSC mainnet fork and label the evidence. Do not present mocked quotes or a local pool as public PancakeSwap liquidity.

**Mainnet-fork pin (fork evidence only).** [`../../deployments/bsc-mainnet.fork.json`](../../deployments/bsc-mainnet.fork.json) pins the official BSC mainnet SwapRouter `0x1b81D678ffb9C0263b24A97847620C99d213eB14`, QuoterV2 `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997`, factory `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`, and MasterChefV3 `0x556B9306565093C855AEA9AE92A594704c2Cd59e` from the [official address page](https://developer.pancakeswap.finance/contracts/v3/addresses), with WBNB read from `router.WETH9()` and CAKE from `MasterChefV3.CAKE()` and code hashes at finalized block `123518579`. The deepest direct WBNB/CAKE pool there is fee `2500`. The full swap adapter suite passes on that fork. Chain 56 remains disabled as a transaction target.

## 9. Selected staking adapter

### Candidate: PancakeSwap CAKE Pool

The official [CAKE Syrup Pool integration page](https://docs.pancakeswap.finance/welcome-to-pancakeswap/how-to-guides/v3-v2-migration/migration/cake-syrup-pool) documents single-sided `deposit(amount, lockDuration)`, share-based positions via `userInfo`, and this testnet environment:

| Item | Address | Status |
| --- | --- | --- |
| Testnet CAKE | `0xFa60D973F7642B748046464e165A65B7323b0DEE` | `verified`; `mint` is `Ownable`, so CAKE is acquired by swapping, not minting |
| CAKE Pool | `0x683433ba14e8F26774D43D3E90DA6Dd7a22044Fe` | `verified`; `token()` and `masterchefV2()` match this table, contracts are not blocked from depositing |
| MasterChef V2 | `0xB4A466911556e39210a6bB2FaECBB59E4eB7E43d` | `verified` |

This is selected over LP farming because one input token and one position-share metric fit the mandate/verifier model. Flexible staking uses `lockDuration = 0`; locked staking is excluded from MVP to avoid withdrawal-time and fee complexity.

### Validation gate — passed

`D-002` is resolved: the documented CAKE Pool deployment is live and usable by a smart account. Chain-97 evidence (`pnpm --filter @perago/executor probe:protocol-live`, report in [`../evidence/bsc-testnet.protocol-live.json`](../evidence/bsc-testnet.protocol-live.json)):

1. all three addresses hold code matching the reviewed manifest, and the pool is wired to the pinned CAKE and MasterChef;
2. CAKE is funded by a V3 exact-input swap from the smart account, because the testnet token's `mint` is owner-only;
3. a flexible `deposit(amount, 0)` from the smart account produced a nonzero `userInfo.shares` position and consumed the approval exactly, leaving no standing allowance;
4. `withdrawAll()` closed the position and returned the stake minus the documented 0.1% early-withdrawal fee (`withdrawFee` `10` bp inside a `withdrawFeePeriod` of 259200 seconds), which the probe asserts rather than assumes;
5. `MIN_DEPOSIT_AMOUNT` is `1e13` wei, and a smaller deposit reverts with `Deposit amount must be greater than MIN_DEPOSIT_AMOUNT`;
6. `performanceFee` is `200` bp on yield; locked staking stays out of the MVP.

**Position ownership.** The pool keys positions by `msg.sender` and exposes no deposit-for-recipient or share transfer (bytecode selector probe on 2026-09-23 found only `deposit(uint256,uint256)`). Perago therefore stakes through one `CakeStakePosition` holder per recipient, deployed by `CakeStakeAdapter` with `CREATE2`; the holder is the pool account and only the recipient can withdraw ([`SMART-CONTRACT.md`](SMART-CONTRACT.md) §6). A pinned-fork run at block `132658000` and the live chain-97 probe ([evidence](../evidence/bsc-testnet.adapters-live.json)) prove deposit through the deployed adapter into holder `0x53239B4Df8a62E0E8836A4924Efc63E91635824d` (tx `0xcf02b385fba9f63ac9a0d0e5e8aa918c5bdbd07bf22b0053b95fc8d200b4a5f0`), share minting above the signed minimum, a non-owner exit rejected with `WrongAccountCaller`, and the owner's full exit (tx `0xd25b41e6315c56355a6a4446a1a0efa30cce2bc0552bc7d94e675693a23e66e3`) returning the stake minus the documented 0.1% fee with zero shares left.

Testnet pricing in these pools is not economically meaningful, so amounts prove mechanics, not value. If the deployment later regresses, the contingency order is: a current official PancakeSwap/BNB staking testnet deployment; a pinned BSC mainnet fork labeled as fork evidence; or, with user approval, a minimal Perago test vault labeled as Perago test infrastructure — never a silent switch to lending, LP management, or an invented address.

## 10. Payment asset

### Live BSC Testnet demo

The ERC-8183 payment token is `verified` on chain 97: `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`, name **United Stables**, symbol `U`, 18 decimals, standard `transferFrom` escrow behavior observed through three funded jobs. The upstream deployment source labels it USDC; that label is wrong onchain and Perago never presents it as Circle-issued USDC. It has no faucet or public mint, and its only liquid route on this chain is the PancakeSwap V2 pair `0x55ed32b1808d4Bb9aD8DF8201494b74B982915F8`, so demo budgets stay small.

### BSC Mainnet candidate

World Liberty Financial's official [USD1 contract-address page](https://docs.worldlibertyfinancial.com/usd1-token/contract-addresses) lists BSC USD1 at:

```text
0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d
```

It documents 18 decimals. USD1 is a mainnet candidate, not a BSC Testnet address and not approved for Perago mainnet use in this phase. Contract source, controls, liquidity, legal/product fit, and ERC-8183 deployment compatibility require re-verification.

## 11. Simulation source and limitations

### Implemented deterministic stack (`P3-004`)

Implemented in `apps/api/src/simulation/` and verified by `pnpm --filter @perago/api smoke:phase3` ([evidence](../evidence/bsc-testnet.fork.phase3-smoke.json)).

1. Pin one block: the `finalized` tag on a live chain (`SC-D-005`), `latest` on a local fork, which has no separate finality. Every read below uses that block number.
2. Read the account's `accountConfig`, the ERC-1967 implementation slot, and the code hashes of the account, MandateExecutor, adapter, verifier, and protocol target; confirm the executor pins this adapter and verifier and every code hash matches the reviewed manifest. Refuse an unregistered account, a mismatched owner, epoch, or policy hash, an executor that requires an ERC-8183 job Perago cannot yet create, a session permission that expires before the mandate, and an input balance below the spend.
3. For a stake, read the position first (`P5-002`): the holder `CakeStakeAdapter.positionOf(recipient)` names, whether it is deployed, its CAKE Pool `userInfo` shares, and the pool's `withdrawFee`, `withdrawFeePeriod`, and `performanceFee`. A read that reverts, or a fee above 10,000 bp, refuses with `POSITION_UNAVAILABLE` before any estimate; a transport failure surfaces as `CHAIN_UNAVAILABLE`. The result commits these as the explicit `position` object, and a passing stake's `sharesBefore` must equal the measured shares before.
4. Estimate the outcome: PancakeSwap `QuoterV2.quoteExactInputSingle` for a swap; for a stake, the exact path itself run once with `minPositionOut = 1`, because the CAKE Pool mints shares against its live balance. The signed minimum is the estimate less the plan's slippage bound, rounded down; a zero minimum is refused.
5. Build the canonical action, `actionHash`, `postconditionHash`, a random 128-bit nonce, the chain-time expiry, and a quote deadline no later than that expiry.
6. Run the account's exact execution calls in one `eth_call` at the pinned block: `MandateSimulationHarness` runtime code is installed at the account address by state override, MandateExecutor's `_mandates[digest]` record is overridden to `EXECUTING` for a one-off simulation executor key (storage slot 2, `forge inspect MandateExecutor storageLayout`), and the harness calls `approve(MandateExecutor, maxInput)` then the real `perform`. MandateExecutor, adapter, verifier, and protocol all run their deployed code. The harness reverts if the injected record is not where the executor reads it, so a layout drift fails closed. A `PASSED` result requires `SUCCEEDED`, exact spend, an outcome at or above the minimum, and no allowance left.
7. Store the request, the result, every code hash, the block, and the quote deadline in `SimulationResult`; its hash is the mandate's `simulationHash`, and the mandate is derived from the document alone (`taskMandateFromSimulation`).

The fork suite `test/fork/MandateSimulationHarness.fork.t.sol` proves step 6 predicts the real `authorize` → `beginExecution` → `approve` → `perform` path from the same state: equal spend, equal outcome delta, and an identical `verificationHash`, for both the swap and the stake.

`eth_simulateV1` was measured and rejected as the primary mechanism on 2026-09-23: Alchemy's chain-97 endpoint serves it, but a local anvil fork answers every `eth_simulateV1` request with `Required data unavailable`, while `eth_call` state overrides work on both. One mechanism serves the fork smoke and the live chain.

### Freshness at prepare and signature

Preparing the signing payload and accepting a signature each re-read, at a newly pinned block: the canonical hash at the simulated height, chain time against the quote deadline, the policy row and the onchain active policy hash, the onchain and stored owner and epoch, the account code and implementation, the executor, adapter, verifier, and protocol code hashes, the nonce, and for a stake every `position` fact (holder, deployment, shares, and the three pool fees). Any change marks the simulation `STALE`, returns the task to `READY_TO_SIMULATE`, and refuses with a `STALE_*` reason code (`STALE_POSITION` for the stake position). A position that can no longer be read refuses with `POSITION_UNAVAILABLE` and signs nothing. Signature acceptance also re-runs the exact path with the signed mandate itself, evaluates `authorize` with `eth_call` from the bound executor, and re-runs every Wallet Policy rule, including the rolling daily cap, inside the transaction that writes the mandate.

### Limitations

- `eth_call` proves execution against one state snapshot; it does not guarantee inclusion state or ordering.
- Quoter output is not a minimum; the signed `minOutput` is derived from the user's slippage bound.
- The simulation skips account validation (session signature, permission hooks, EntryPoint accounting). Those are proven in `P1-003`/`P3-002` and are simulated through the bundler at execution time (`P4-002`).
- Balance before/expected-after values are estimates until a transaction is mined.
- MEV can move price within accepted limits; exceeding limits must revert.
- A third-party simulator is not added: this stack produced judge-verifiable facts in `P3-004`. If one is ever added, its result stays advisory and contract limits stay authoritative.

## 12. Address and capability validation procedure

For every integration manifest entry:

1. resolve the address from the current official source;
2. record source URL, retrieval date, upstream release/commit when available;
3. query chain ID and code at a pinned block;
4. reject empty code, proxy surprises, or mismatched implementation/admin;
5. compare runtime code hash and verified source/ABI;
6. read immutable/configuration values and roles;
7. run the smallest read probe, then a disposable write smoke test;
8. record transaction, block, result, and expected event/state delta;
9. test failure/revoke/refund paths;
10. promote the deployment manifest only through review.

A source URL alone never changes status to integrated.

## 13. Integration failure matrix

| Integration | Failure | Safe degradation |
| --- | --- | --- |
| Alchemy Wallet API | API unavailable | Use low-level standard smart-account client or pause; no custody fallback. |
| Bundler | Rejects/drops UserOperation | Reconcile EntryPoint/account nonce; submit identical operation through validated fallback only when definitively absent. |
| Paymaster | Sponsorship denied | Owner pays gas for unchanged calls. |
| Account/session module | Permission too broad or behavior mismatched | Block activation; never compensate only in UI. |
| Pancake quote/pool | No liquidity/stale quote | Do not sign; refresh or use labeled fork contingency. |
| Swap router | Revert/min output missed | Atomic rollback; terminal mandate failure after begun attempt. |
| CAKE Pool | Missing/deprecated/paused | Block stake action; use approved contingency, not another protocol silently. |
| ERC-8183/APEX | Incompatible evaluator or changed proxy | Block new payment jobs; keep receipts and refund/reject under verified upstream lifecycle. |
| Payment token | Nonstandard transfer/insufficient test funding | Block funded demo or use clearly labeled test token after user approval. |
| RPC/indexer | Disagreement/reorg | Pause lifecycle progression, rollback projections, replay confirmed events. |

## 14. Required evidence before public claims

- Chain-97 account derivation/deployment and root ownership proof.
- Allowed UserOperation success plus forbidden root/upgrade/arbitrary-call failures.
- Sponsored and owner-paid UserOperation evidence.
- PancakeSwap quote and exact-input swap transaction with balance delta.
- CAKE Pool (or approved replacement) deposit transaction with position delta and recovery path.
- Mandate replay, changed recipient, excess amount, expired, and revoked rejection evidence.
- Successful and failed deterministic receipt evidence.
- ERC-8183 complete and refund/reject evidence tied to matching receipts.
- Deployment manifest with source URLs, addresses, versions, code hashes, blocks, transactions, and admin capabilities.

Until then, README and submission copy must say “documentation foundation” or “proposed,” never “live,” “integrated,” “secure,” or “verified on Perago.”

## 15. Primary sources

- [BNB Smart Chain wallet configuration](https://docs.bnbchain.org/bnb-smart-chain/developers/wallet-configuration/)
- [BNB Smart Chain faucet](https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/)
- [BNB Agent SDK networks/contracts](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/)
- [BNB Agent SDK TypeScript quickstart](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/quickstart-typescript/)
- [BNB Agent SDK security](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/security/)
- [Alchemy Wallet APIs supported chains](https://www.alchemy.com/docs/wallets/supported-chains)
- [Alchemy smart-contract deployments](https://www.alchemy.com/docs/wallets/smart-contracts/deployed-addresses/)
- [Alchemy Wallet API session permissions](https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys)
- [ERC-8183 draft](https://eips.ethereum.org/EIPS/eip-8183)
- [BNB APEX contracts and deployments](https://github.com/bnb-chain/apex-contracts)
- [ERC-8004 draft](https://eips.ethereum.org/EIPS/eip-8004)
- [PancakeSwap V3 addresses](https://developer.pancakeswap.finance/contracts/v3/addresses)
- [PancakeSwap CAKE Pool integration](https://docs.pancakeswap.finance/welcome-to-pancakeswap/how-to-guides/v3-v2-migration/migration/cake-syrup-pool)
- [USD1 official contract addresses](https://docs.worldlibertyfinancial.com/usd1-token/contract-addresses)
