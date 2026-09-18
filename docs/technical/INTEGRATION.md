# Perago BNB and Protocol Integration Map

**Status:** Evidence-backed foundation; no Perago deployment or live integration proof exists yet
**Reviewed:** 2026-09-17
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
| BNB Smart Chain Testnet | Execution chain | `needs re-verification` | Selected; chain/RPC facts are official, live endpoints and confirmation behavior need probe. |
| External self-custodial wallet | Root owner | `proposed` | Selected; EVM wallet connector remains implementation work. |
| Alchemy Modular Account V2 | ERC-4337 smart account | `needs re-verification` | Selected; validate chain-97 deployment/code/modules and external EOA ownership. |
| Alchemy Bundler + Gas Manager | UserOperation transport/sponsorship | `needs re-verification` | Selected initial provider; standard owner-funded fallback required. |
| MandateExecutor | One-use semantic authority | `proposed` | Perago-owned contract; required even with smart-account permissions. |
| BNB Agent SDK | ERC-8183 helpers/BNB ecosystem utilities | `needs re-verification` | Evaluate narrowly; do not adopt its key provider or SDK wholesale. |
| Altana EIP-7702 sessions | Alternate session path | `verified in reference repo` | Not selected; historical experiment and current official SDK mention are insufficient for Perago's exact guarantees. |
| Trust Wallet Agent Kit | Alternate wallet/agent runtime | `proposed` | Not selected for MVP; no need beside the chosen ERC-4337 path. |
| ERC-8004 | Agent identity/reputation/validation | `proposed` | Deferred; does not earn MVP complexity. |
| ERC-8183 / BNB APEX | Outcome-based agent commerce | `needs re-verification` | Selected; pin deployment/ABI/upgrade/admin state and test full lifecycle. |
| PancakeSwap V3 | Exact-input swap | `needs re-verification` | Selected swap protocol. |
| PancakeSwap CAKE Pool | Single-asset stake | `needs re-verification` | Selected candidate; official testnet docs are old, so chain probe is a hard gate. |
| USD1 | Mainnet payment-token candidate | `needs re-verification` | Official BSC mainnet address exists; not a testnet token. |
| APEX testnet USDC | ERC-8183 demo payment token | `needs re-verification` | Preferred live-demo candidate if deployment/token behavior passes checks. |
| Quote + pinned `eth_call` + UserOp simulation | Pre-sign simulation | `proposed` | Initial simulation source; add no third-party simulator until evidence requires it. |

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
- Determine confirmation depth by testnet measurement; do not assume finality from one receipt.
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

Perago pins these contracts. Code at every address below was read on chain 97 and hashed; the code hashes, the verification block, and the pending evidence live in the reviewed manifest [`deployments/bsc-testnet.account.json`](../../deployments/bsc-testnet.account.json), which owns those values.

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

The derived account address is a CREATE2 result over factory, salt, owner, and the implementation bytecode, so the implementation address is load-bearing: a stale value points funds at an unreachable account. Chain-97 ownership is now proven: the disposable root owner `0x2E42E0FB693765715014934282b9A7d3cF0c3818` deployed and drove account `0x2863167c8653b9369Ef51De203742A3429AC57E2` through the Alchemy bundler, with transaction hashes recorded in [`../BUILD-PLAN.md`](../BUILD-PLAN.md). Only the sponsored UserOperation is still pending, blocked on the Gas Manager policy transaction-count limit.

### 4.2 Session permission shape

Alchemy's official [session-key permission reference](https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys) documents expiry, ERC-20 cumulative allowance, gas limit, contract access, account-function, functions-on-contract, functions-on-all-contracts, and dangerous `root` permissions.

Perago allows only the combination now proven enforceable on the deployed modules, encoded by `encodeInstallMandateSession` in `packages/sdk/src/account/modular-account.ts`:

- one single-signer validation scoped to the account's `execute` selector only, so no other account function is reachable through the session;
- one pre-validation allowlist pinning exactly one target contract and its permitted selectors;
- one pre-execution native spend cap;
- one validation-time expiry window, which is always set;
- no `root`, wildcard contract, all-contract function, module install, upgrade, ownership, batch, `performCreate`, runtime-validation, or ERC-20 `approve` authority. The SDK rejects any of those selectors at encode time, and the selector values are taken from the deployed account's dispatcher rather than from vendor constants.

Locally replayed chain-97 bytecode confirms the enforcement: the allowlisted call is accepted, while an unrelated target and an unallowlisted selector fail the allowlist hook, `installValidation` and `upgradeToAndCall` fail validation lookup, an over-limit spend reverts before any value moves, and an expired or revoked session fails validation. The remaining evidence for this section is signed chain-97 execution, which is tracked in [`../BUILD-PLAN.md`](../BUILD-PLAN.md).

Because a session cannot bound call arguments, granting the token `approve` selector to a session key would permit an arbitrary allowance. Token spend for a swap must therefore be authorized inside one account-executed call, or bounded by the AllowlistModule ERC-20 spend limit. That choice is decision gate `D-004` and is resolved with the swap adapter, not by widening the session.

A contract/function allowlist can still permit malicious arguments. MandateExecutor independently validates the root Task Mandate, action hash, amount, recipient, protocol, nonce, and postcondition.

### 4.3 Bundler/paymaster degradation

- Persist UserOperation hash and query EntryPoint/onchain receipts before retry.
- Sponsorship is optional. If denied/unavailable, offer an owner-funded standard UserOperation without changing calls.
- A public standards-compatible bundler (Pimlico documents BNB Testnet support) is a candidate fallback only after the same EntryPoint/version probe.
- A bundler cannot be allowed to select calls, payee, or mandate fields.
- Paymaster policies are capped by chain, account, target selectors, gas, request rate, and total budget.
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

### BNB APEX deployment candidate

The official BNB Chain [`apex-contracts` repository](https://github.com/bnb-chain/apex-contracts) states that `scripts/addresses.ts` is the deployment source of truth and currently documents these BSC Testnet addresses:

| Contract | Address | Status |
| --- | --- | --- |
| `AgenticCommerceUpgradeable` proxy | `0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE` | `needs re-verification` |
| `EvaluatorRouterUpgradeable` proxy | `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25` | `needs re-verification` |
| `OptimisticPolicy` | `0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6` | `needs re-verification` |
| Testnet payment token labeled USDC | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` | `needs re-verification` |

APEX is upgradeable at the kernel/router layer and its default policy is optimistic. Perago's desired evaluator is deterministic. Phase 1 must determine whether:

1. the deployed router permits a Perago deterministic policy/evaluator binding;
2. the deployed proxies' implementations/admin/timelocks match upstream docs;
3. the payment token is a standard ERC-20 with verified decimals and sufficient test balance;
4. complete/reject/refund and non-hookable refund behavior match the pinned ABI;
5. Perago should integrate the deployment or deploy a separate standards-compatible test instance.

Until those checks pass, all addresses remain `needs re-verification`. The reference repository's earlier ERC-8183 work is not Perago evidence.

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
| V3 `SwapRouter` | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` | Exact-input execution | `needs re-verification` |
| `QuoterV2` | `0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2` | Pre-sign quote | `needs re-verification` |
| V3 factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | Pool existence/fee validation | `needs re-verification` |

Perago deliberately rejects PancakeSwap Smart Router, Universal Router, arbitrary path bytes, multicall, native unwrap, and multi-hop routes in the first adapter. One pinned direct pool/fee pair per supported token pair is enough for the demo and produces a clear verifier.

### Probe and execution requirements

1. Verify code hashes/source and factory relationship at a recorded chain-97 block.
2. Confirm token addresses, decimals, standard transfer behavior, pool address, fee tier, liquidity, and quote result.
3. Compare QuoterV2 output with exact router `eth_call` from the smart-account/adapter context.
4. Bind `amountIn`, `amountOutMinimum`, recipient, fee, and deadline in the action hash.
5. Execute through `PancakeV3SwapAdapter`; output goes directly to signed recipient.
6. Verify recipient balance delta and maximum input spent from chain state.

If testnet liquidity is inadequate, use a transparently seeded test pool or a pinned BSC mainnet fork and label the evidence. Do not present mocked quotes or a local pool as public PancakeSwap liquidity.

## 9. Selected staking adapter

### Candidate: PancakeSwap CAKE Pool

The official [CAKE Syrup Pool integration page](https://docs.pancakeswap.finance/welcome-to-pancakeswap/how-to-guides/v3-v2-migration/migration/cake-syrup-pool) documents single-sided `deposit(amount, lockDuration)`, share-based positions via `userInfo`, and this testnet environment:

| Item | Address | Status |
| --- | --- | --- |
| Dummy/mintable CAKE | `0xFa60D973F7642B748046464e165A65B7323b0DEE` | `needs re-verification` |
| CAKE Pool | `0x683433ba14e8F26774D43D3E90DA6Dd7a22044Fe` | `needs re-verification` |
| MasterChef V2 | `0xB4A466911556e39210a6bB2FaECBB59E4eB7E43d` | `needs re-verification` |

This is selected over LP farming because one input token and one position-share metric fit the mandate/verifier model. Flexible staking uses `lockDuration = 0`; locked staking is excluded from MVP to avoid withdrawal-time and fee complexity.

### Hard validation gate

The official page is migration-era documentation and may describe an old testnet deployment. Before implementation, Phase 1 must:

1. confirm nonempty verified code and expected ABI at all addresses;
2. mint/fund dummy CAKE through the documented test method;
3. read `userInfo`, `getPricePerFullShare`, fee configuration, and pause/ownership state;
4. perform a minimal flexible deposit from a disposable wallet;
5. prove share/position increase and withdraw/recovery behavior;
6. identify any fee, lock, allowlist, or deprecated state that makes automation unreliable.

If any step fails, this deployment is `blocked`. The contingency order is:

1. obtain a current official PancakeSwap/BNB staking testnet deployment;
2. run the adapter on a pinned BSC mainnet fork against the official mainnet CAKE Pool and label it as fork evidence;
3. with user approval, deploy a minimal test staking vault solely to demonstrate the generic verifier, labeled as Perago test infrastructure—not a third-party integration.

Do not silently switch to lending, LP management, or a made-up address.

## 10. Payment asset

### Live BSC Testnet demo

Use the APEX testnet payment token only after code/decimals/standard transfer behavior and funding path are verified. It is labeled USDC by the upstream deployment source but is not represented here as Circle-issued production USDC.

### BSC Mainnet candidate

World Liberty Financial's official [USD1 contract-address page](https://docs.worldlibertyfinancial.com/usd1-token/contract-addresses) lists BSC USD1 at:

```text
0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d
```

It documents 18 decimals. USD1 is a mainnet candidate, not a BSC Testnet address and not approved for Perago mainnet use in this phase. Contract source, controls, liquidity, legal/product fit, and ERC-8183 deployment compatibility require re-verification.

## 11. Simulation source and limitations

### Initial deterministic stack

1. Read smart-account/token balances, active policy, nonces, account/module/adapter code hashes, protocol state, and latest safe block.
2. Pin a block number/hash for all compatible reads.
3. Obtain protocol quote from PancakeSwap `QuoterV2` or staking share/price views.
4. Compile the exact closed action and Task Mandate fields.
5. Run `eth_call`/Viem `simulateContract` for adapter validation/execution from the intended call context where possible.
6. Run ERC-4337 UserOperation gas/simulation through the selected bundler for account permission/paymaster validation.
7. Re-read expected recipient/position balances and compute the advertised expected delta/minimum.
8. Store all requests, results, code hashes, block context, quote deadline, and limitations in `SimulationResult`.

### Limitations

- `eth_call` proves execution against one state snapshot; it does not guarantee inclusion state or ordering.
- Quoter output is not a minimum; the signed `minOutput` is derived from the user's slippage bound.
- Bundler simulation may differ from inclusion and is provider-operated.
- Public BSC RPCs may not expose full state diffs or trace methods.
- Balance before/expected-after values are estimates until a transaction is mined.
- MEV can move price within accepted limits; exceeding limits must revert.
- A third-party simulator is not added unless Phase 3 cannot produce judge-verifiable facts with this stack. If added, its result remains advisory and contract limits stay authoritative.

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
