# Perago Smart-Contract and Security Specification

**Status:** `MandateExecutor` authorization, accepted-attempt, and atomic failure boundaries implemented and tested (`P2-001`, `P2-002`); the stateful invariant suite (`P2-003`), the two adapters, the two verifiers, and `OutcomeEvaluator` remain specified and unimplemented
**Requirements:** [`../PRD.md`](../PRD.md)
**Architecture:** [`ARCHITECTURE.md`](ARCHITECTURE.md)
**Integrations:** [`INTEGRATION.md`](INTEGRATION.md)

## 1. Security objective

A valid Perago execution must prove all of the following:

1. a registered self-custodial root owner signed the exact Task Mandate;
2. the signed smart account, chain, contract, owner epoch, policy, executor, nonce, and expiry still match;
3. the action is a closed, approved adapter call whose bytes hash to the signed commitment;
4. the smart account admitted the call through a narrowly scoped ERC-4337 permission;
5. one mandate authorizes at most one accepted protocol attempt;
6. protocol economic bounds are enforced inside the same atomic call as the effect;
7. an adapter-specific verifier passed before success was committed;
8. the resulting receipt, not an executor assertion, is the only input to payment settlement.

Alchemy Modular Account V2 permissions, bundler validation, and paymaster policy are defense in depth. They do not replace the MandateExecutor because provider-side availability and permission semantics cannot be the sole basis of Perago's one-use and outcome claims.

## 2. Contract inventory

### 2.1 `MandateExecutor`

Required. It owns account registration/policy commitments, EIP-712 verification, nonce consumption, authorization/revocation/expiry state, execution gating, exact temporary adapter approval, failure capture, verification, and receipt events.

It does not parse natural language, choose a route, custody unrestricted balances, expose arbitrary calls, or decide ERC-8183 payments.

### 2.2 `PancakeV3SwapAdapter`

Required for the swap MVP. It accepts one closed exact-input action, calls the pinned PancakeSwap V3 router, and rejects any uncommitted token, pool fee, amount, recipient, deadline, or minimum output.

### 2.3 `CakeStakeAdapter`

Conditionally required after decision gate `D-002`. It accepts one closed single-asset staking action for the validated PancakeSwap CAKE Pool deployment. If the chain-97 deployment probe fails, this adapter is not implemented against an invented address; the labeled mainnet-fork contingency is used or the user selects another verified protocol.

### 2.4 `SwapVerifier` and `StakeVerifier`

Required and separate. They expose a common interface but different measurements:

- swap verifier measures recipient output-token balance delta;
- stake verifier measures the protocol position or receipt-token balance delta defined by the selected staking deployment.

They also confirm input spent, recipient, adapter identity, and signed minimums.

### 2.5 `OutcomeEvaluator`

Required when ERC-8183 settlement is enabled. It validates the `(commerceContract, jobId, mandateHash)` binding and reads a successful MandateExecutor receipt before calling the configured ERC-8183 completion function. It records a one-time settlement binding.

### 2.6 No standalone receipt or adapter-registry contract

The MVP emits immutable receipts from MandateExecutor and pins exactly two adapter/verifier pairs in constructor or deployment-time immutable storage. A mutable generic registry adds admin and upgrade risk without product value. Historical indexing belongs offchain.

## 3. Account abstraction decision

### Selected path

- **Account:** Alchemy Modular Account V2 controlled by a self-custodial external root EOA.
- **Transport:** ERC-4337 UserOperations through a BNB Testnet-supported bundler; optional gas sponsorship through a capped paymaster policy.
- **Executor permission:** non-root validation scoped to the smart account's execution function, MandateExecutor target/selectors, approved token approval selectors, token/spend limits, gas limit, and expiry.
- **Task authority:** root-owner EIP-712 Task Mandate verified independently by MandateExecutor.

### Why session/account policy is insufficient alone

A permission system may restrict target, selector, token transfer, time, or gas but does not by itself prove Perago's exact action hash, simulation/postcondition commitments, terminal verifier result, ERC-8183 binding, or cross-provider one-use lifecycle. Some permissions also authorize generic account `execute`/`executeBatch`; a global validation key can potentially change account configuration. Therefore:

- root/global executor permission is forbidden;
- executor permissions cannot call account upgrade/module-management/root-owner functions;
- the executor cannot produce the root-owner Task Mandate;
- MandateExecutor remains the authoritative semantic boundary;
- provider capability is validated on BSC Testnet before use and re-verified when pinned versions change.

Privy is not selected for the MVP because its native smart-wallet flow centers on an embedded Privy signer, while Perago's accepted primary journey starts with an existing self-custodial external wallet. Biconomy lacks current official BSC Testnet staging/sponsorship confirmation. Pimlico is a standards-compatible fallback bundler candidate, not the initial account implementation.

## 4. EIP-712 data

### 4.1 Domain

```text
name:              "Perago"
version:           "1"
chainId:           current block.chainid
verifyingContract: MandateExecutor address
```

A signature valid for another chain or deployment is invalid. The struct also carries `chainId` for explicit user display and redundant enforcement.

### 4.2 `TaskMandate`

Field order and Solidity widths are frozen before deployment and mirrored exactly in `packages/sdk`:

```solidity
struct TaskMandate {
    address account;
    address rootOwner;
    uint64 ownerEpoch;
    address executor;
    uint256 chainId;
    uint256 nonce;
    uint48 expiresAt;
    bytes32 policyHash;
    bytes32 intentHash;
    bytes32 planHash;
    bytes32 simulationHash;
    address adapter;
    bytes4 adapterSelector;
    address inputToken;
    uint256 maxInput;
    address outputToken;
    uint256 minOutput;
    address recipient;
    bytes32 actionHash;
    bytes32 postconditionHash;
    address commerceContract;
    uint256 commerceJobId;
}
```

Canonical type string:

```text
TaskMandate(address account,address rootOwner,uint64 ownerEpoch,address executor,uint256 chainId,uint256 nonce,uint48 expiresAt,bytes32 policyHash,bytes32 intentHash,bytes32 planHash,bytes32 simulationHash,address adapter,bytes4 adapterSelector,address inputToken,uint256 maxInput,address outputToken,uint256 minOutput,address recipient,bytes32 actionHash,bytes32 postconditionHash,address commerceContract,uint256 commerceJobId)
```

`commerceContract == address(0)` and `commerceJobId == 0` are allowed only in explicitly configured local/fork tests. The live demo requires a verified binding.

### 4.3 Account policy registration

The root owner signs a separate versioned typed message:

```solidity
struct AccountPolicy {
    address account;
    address rootOwner;
    uint64 ownerEpoch;
    uint256 chainId;
    bytes32 policyHash;
    bytes32 permissionHash;
    uint48 validUntil;
}
```

The smart account calls `setAccountPolicy(AccountPolicy, signature)`. MandateExecutor checks `msg.sender == account`, chain/domain, nonzero policy, increasing/current owner epoch rules, expiry, and root signature before storing `rootOwner`, `ownerEpoch`, `activePolicyHash`, and `permissionHash`.

A new root owner must use a strictly greater epoch. Any owner/epoch change invalidates prior unsigned/signed-but-unauthorized mandates because their root/epoch no longer matches. A policy-only change at the same epoch invalidates mandates with the old policy hash.

### 4.4 Executor proof

The scoped executor signs:

```solidity
struct ExecutionProof {
    bytes32 mandateHash;
    address account;
    address executor;
    uint48 validUntil;
}
```

`perform` verifies this proof even though the call originates from the smart account. This preserves explicit executor binding across ERC-4337 call indirection. The mandate state makes the proof one-use; its short `validUntil` prevents a stale executor proof from being held indefinitely.

### 4.5 Signature rules

- Root Task Mandates use canonical low-`s` ECDSA and reject zero/malleable signatures.
- MVP root owners are EOAs controlled by external wallets. Contract roots via ERC-1271 are deferred because module-specific signature context must not let an executor session masquerade as root.
- Executor proofs use the executor EOA/session public key bound in the mandate.
- No `eth_sign` or ambiguous personal-message signature is accepted for root authority.
- Web/API recompute digests independently; contract calculation is final.

## 5. Account, nonce, and one-use semantics

### 5.1 Storage keys

```solidity
mapping(address account => AccountConfig) accountConfigs;
mapping(address account => mapping(uint256 nonce => bool)) usedNonce;
mapping(bytes32 mandateHash => MandateRecord) mandates;
mapping(address commerce => mapping(uint256 jobId => bytes32 mandateHash)) jobBindings;
```

`AccountConfig` contains root owner, owner epoch, active policy hash, and permission hash. Registration status is **derived** from `rootOwner != address(0)`; a separate flag would be a second source of truth that can desynchronize. `MandateRecord` contains account, executor, expiry, status, adapter/verifier identity, commerce binding, execution-start timestamp, and terminal commitments—never raw intent.

### 5.2 Status

```solidity
enum MandateStatus {
    NONE,
    AUTHORIZED,
    EXECUTING,
    SUCCEEDED,
    FAILED,
    REVOKED,
    EXPIRED
}
```

Allowed transitions only:

```text
NONE -> AUTHORIZED
AUTHORIZED -> EXECUTING | REVOKED | EXPIRED
EXECUTING -> SUCCEEDED | FAILED
```

### 5.3 Authorization

`authorize(mandate, rootSignature)`:

1. requires `msg.sender == mandate.executor`;
2. requires `block.chainid == mandate.chainId` and `block.timestamp < expiresAt`;
3. validates all nonzero fields, spend bounds, and the commerce-binding shape: a live deployment requires a bound `(commerceContract, jobId)` pair, and only a deployment explicitly constructed with `allowUnboundCommerceJobs` accepts a fully zero pair;
4. resolves the adapter against the two constructor-pinned deployments, requires `adapterSelector == IPeragoAdapter.execute.selector`, enforces the token relationship the adapter kind implies, and carries the adapter's immutable paired verifier into the record;
5. loads `accountConfigs[account]` and matches root owner, owner epoch, active policy hash, and a registered permission hash;
6. requires the nonce unused and the ERC-8183 job binding free;
7. requires the mandate hash absent;
8. recovers the root signature over the EIP-712 digest and requires the recovered signer to equal `mandate.rootOwner`, rejecting zero, malformed, and high-`s` malleable signatures;
9. writes `usedNonce[account][nonce] = true` before recording `AUTHORIZED`;
10. reserves the commerce job binding and emits `CommerceJobBound`;
11. emits `MandateAuthorized`.

Cheap state and shape checks run before signature recovery so a replayed nonce reports `NonceAlreadyUsed` rather than spending gas on recovery; the signature is still the last gate before any state write.

No external protocol or token call occurs during authorization. Reading `kind()` and `verifier()` from the pinned adapters happens once, in the constructor.

### 5.4 Accepted attempt boundary

`beginExecution(mandateHash)` is callable only by the signed executor, requires `AUTHORIZED` and unexpired mandate, then writes `EXECUTING` and `executionStartedAt` before any smart-account/protocol call. This separate transaction makes the one-attempt claim robust across later transport failure: once begun, a second begin is impossible.

The smart account then submits `perform(mandate, action, executorProof)`. Pre-call validation failure in `perform` does not widen authority; the mandate remains `EXECUTING` and can only be completed by a valid performance or terminally failed after the execution timeout. It cannot return to `AUTHORIZED`.

`finalizeStalledExecution(mandateHash)` is permissionless after `executionStartedAt + executionWindow` and records `FAILED` if no terminal receipt exists. `executionWindow` is an immutable constructor argument, not a source literal, because its safe value is a measured chain property (`SC-D-005`); the contract rejects zero and anything above the `MAX_EXECUTION_WINDOW` ceiling of one hour, which keeps a stalled execution from outliving the mandate expiry horizon.

### 5.5 Why not a single transaction

A state write made before a protocol call is reverted if the whole transaction reverts. A single `execute` transaction therefore cannot guarantee that an out-of-gas or unexpected revert consumes authority. The separate `beginExecution` checkpoint ensures a failed later transport cannot make the root signature reusable. Expected protocol/verifier failures are caught atomically as described below.

## 6. Closed actions and call surface

`perform` accepts opaque `action` bytes only to hash and decode through the adapter-specific schema. The following must all match:

- `keccak256(action) == mandate.actionHash`;
- `mandate.adapter` equals the deployment-pinned adapter;
- `mandate.adapterSelector == IPeragoAdapter.execute.selector`;
- adapter kind determines the expected input/output token relationship and verifier;
- no target or selector appears inside action unless the adapter validates it against deployment-pinned constants;
- recipient equals the signed recipient and defaults to the smart account;
- deadline in action is no later than mandate expiry and the signed quote deadline;
- amount and minimum output are no weaker than signed limits.

### Swap action

```solidity
struct SwapAction {
    address tokenIn;
    address tokenOut;
    uint24 poolFee;
    uint256 amountIn;
    uint256 minAmountOut;
    address recipient;
    uint48 deadline;
}
```

For MVP, `amountIn == maxInput`; partial fills are excluded. Router/factory are immutable adapter constants. No path bytes, arbitrary multicall, callback target, or native-token unwrap recipient is user/model supplied.

### Stake action

The final fields depend on `D-002`, but the schema must remain closed and include at least:

```solidity
struct StakeAction {
    address asset;
    uint256 amount;
    uint256 minPositionOut;
    address recipient;
    uint48 deadline;
    bytes32 poolId;
}
```

The adapter maps `poolId` to one deployment-pinned staking target. It never treats it as an arbitrary address or raw calldata.

## 7. ERC-20 and fund handling

1. MVP actions use ERC-20 inputs; native BNB is wrapped before task creation.
2. The smart-account UserOperation grants MandateExecutor exactly `maxInput` immediately before `perform` in the same batch where account permissions permit it.
3. MandateExecutor pulls at most `maxInput` into its execution subcall.
4. It grants the approved adapter exactly the required amount with a zero-first/force-approve pattern compatible with the pinned token.
5. It clears the adapter allowance to zero before the subcall returns success.
6. The adapter cannot choose a spender other than its immutable protocol target.
7. Any unspent input is returned to the signed smart account before success, and the input spend is **measured by MandateExecutor** from its own balance delta (`heldBefore + maxInput - heldAfter`), never taken from the adapter's self-report. A measured spend above `maxInput` reverts with `AmountOutOfBounds`.
8. Outputs go directly to the signed recipient; MandateExecutor is not a treasury. A nonzero input balance after the refund reverts with `ResidualBalance`, and a nonzero output balance reverts with `RecipientMismatch`, because protocol output left inside the executor did not reach the signed recipient.
9. Fee-on-transfer, rebasing, callback-capable, or otherwise nonstandard assets are unsupported until explicitly modeled and tested. Such a token fails terminally at the transfer, refund, or residual guard; it never settles short.
10. Unlimited approvals are forbidden in account, MandateExecutor, adapter, scripts, and demo setup. The allowance is cleared to zero and re-read before success (`AllowanceNotCleared`).

If the internal execution subcall reverts, all transfers, approvals, and protocol effects in that subcall revert atomically. The outer `perform` catches the revert and records terminal `FAILED` without restoring the already consumed mandate nonce.

## 8. Atomic execution model

Implemented shape:

```solidity
function perform(
    TaskMandate calldata m,
    bytes calldata action,
    ExecutionProof calldata proof,
    bytes calldata proofSignature
) external nonReentrant returns (MandateStatus) {
    bytes32 h = hashMandate(m);
    // admissibility: caller, stored EXECUTING, expiry, window, action hash, executor proof

    uint256 available = gasleft();
    if (available <= FAILURE_RECORD_GAS * 2) revert InsufficientGasBudget();
    (bool succeeded,) = address(this).call{gas: available - FAILURE_RECORD_GAS}(
        abi.encodeCall(this.executeCore, (h, m, action))
    );
    // success: executeCore already wrote the receipt inside the verified subcall
    // failure: record FAILED with a bounded commitment to the revert data
}

function executeCore(bytes32 h, TaskMandate calldata m, bytes calldata action) external {
    if (msg.sender != address(this)) revert OnlySelf();
    // normalize action through the adapter, pull exact bounded funds, measure pre-state,
    // grant the exact allowance, call the adapter, clear the allowance, measure the spend,
    // verify, refund, prove nothing remains here, then write SUCCEEDED
}
```

Before `executeCore`, `perform` requires:

- `msg.sender == mandate.account`;
- stored status is `EXECUTING`; a still-`AUTHORIZED` mandate reports `ExecutionNotStarted`, and any terminal status reports `InvalidTransition`;
- hash and stored critical fields match, which the mandate hash itself binds;
- current time is before mandate expiry and before `executionStartedAt + executionWindow`;
- executor proof is valid, bound to this mandate/account/executor, and unexpired;
- `keccak256(action) == mandate.actionHash`.

The success receipt is written **inside** `executeCore`, in the same subcall that measured and verified the outcome, so `SUCCEEDED` cannot exist without a passing verifier measurement (invariant 4). The outer frame only records failure. `executeCore` reverts on token, protocol, cleanup, verifier, refund, or residual-balance failure. Because it is an external self-call, its effects roll back while the outer call remains able to record `FAILED`.

The subcall gas is explicitly bounded to `gasleft() - FAILURE_RECORD_GAS`. The 63/64 rule alone reserves a stipend proportional to the forwarded call, not to the terminal write, so a hostile adapter that consumes everything it is handed can starve the failure record at low gas limits. `perform` also refuses to start when the remaining gas cannot cover both the attempt and the record (`InsufficientGasBudget`).

The outer failure path never parses revert data: it commits `keccak256(abi.encode(size, prefix))`, where `size` is the true revert-data length and `prefix` is its first `MAX_REASON_BYTES` (256) bytes. A hostile adapter therefore chooses neither the cost nor the shape of the record. Reason codes are mapped offchain from this commitment.

A catastrophic outer out-of-gas transaction is not an accepted protocol attempt because no `perform` state transition is committed. The prior `EXECUTING` checkpoint still prevents a new authorization or a second `beginExecution`; the executor reconciles and the immutable timeout ends it as `FAILED`. Automated blind resubmission is forbidden once a transaction hash exists without a definitive dropped/replaced result.

## 9. Adapter and verifier interfaces

```solidity
interface IPeragoAdapter {
    function kind() external pure returns (bytes32);
    function verifier() external view returns (address);
    function validate(
        TaskMandate calldata mandate,
        bytes calldata action
    ) external view returns (bytes32 normalizedActionHash);
    function execute(
        TaskMandate calldata mandate,
        bytes calldata action
    ) external returns (AdapterResult memory result);
}

struct AdapterResult {
    uint256 inputSpent;
    uint256 outputOrPositionReceived;
    bytes32 protocolEvidenceHash;
}

interface IPeragoVerifier {
    function verifierId() external view returns (bytes32);
    function measure(
        TaskMandate calldata mandate,
        bytes calldata action
    ) external view returns (uint256 value, bytes32 contextHash);
    function verify(
        TaskMandate calldata mandate,
        bytes calldata action,
        uint256 beforeValue,
        bytes32 beforeContext,
        AdapterResult calldata result
    ) external view returns (VerificationEvidence memory evidence);
}

struct VerificationEvidence {
    uint256 inputSpent;
    uint256 observedOutputOrPositionDelta;
    bytes32 evidenceHash;
}
```

`verify` reverts with a typed error on any failed postcondition. MandateExecutor measures pre-state before adapter execution and passes it to the immutable paired verifier. An adapter's self-reported result is insufficient; the verifier reads protocol/token state and cross-checks it. MandateExecutor additionally refuses an adapter that claims more than the verifier measured (`result.outputOrPositionReceived > evidence.observedOutputOrPositionDelta`).

A verifier must bind its evidence to the mandate it measured:

```text
evidenceHash = keccak256(abi.encode(
    mandate.postconditionHash,
    evidence.inputSpent,
    evidence.observedOutputOrPositionDelta,
    result.protocolEvidenceHash
))
```

MandateExecutor recomputes this and reverts with `PostconditionHashMismatch` on any mismatch, so evidence measured for one mandate - or produced by a verifier that never read the signed postcondition - can never settle another. `measure` also returns a `contextHash` that the executor hands back unchanged to `verify`; a verifier rejects a context it did not produce.

`kind()` returns one of two frozen identities, `keccak256("perago.adapter.swap.v1")` or `keccak256("perago.adapter.stake.v1")`, declared in `PeragoTypes`. The `MandateExecutor` constructor reads `kind()` and `verifier()` from each pinned adapter, refuses a mislabeled pair, refuses a shared verifier across the two kinds, and stores both verifier addresses as immutables. A mandate therefore cannot name a verifier at all: the adapter it names determines which verifier measures the outcome.

## 10. Receipt commitment

On terminal execution, MandateExecutor emits `ExecutionReceiptRecorded(mandateHash, status, verificationHash, failureReasonHash)` and stores the same four values in the mandate record. The receipt carries hashes only; raw intent, policy documents, simulation documents, or action bytes are never stored or emitted.

On success, `verificationHash` is the commitment to the measured outcome:

```text
verificationHash = keccak256(abi.encode(
    mandateHash,                                 // binds every one of the 22 signed fields
    measuredSpend,                               // measured by MandateExecutor, not reported
    evidence.observedOutputOrPositionDelta,      // measured by the paired verifier
    evidence.evidenceHash,                       // verifier evidence, bound to the mandate
    result.protocolEvidenceHash                  // adapter's protocol reference
))
```

On failure, `verificationHash` is zero and `failureReasonHash` is either the bounded revert commitment of §8 or `STALLED_FAILURE_REASON = keccak256("perago.failure.stalled.v1")` when the window closed with no receipt. `status` plus a nonzero `verificationHash` is the only settlement-eligible shape; authority is consumed either way, because the nonce was burned at authorization.

The transaction hash, block number, block hash, and log index come from the chain envelope and are not duplicated as contract storage. Raw intent, policy JSON, model output, and private data are never emitted.

## 11. Events, errors, and storage

### Required events

```solidity
event AccountPolicySet(address indexed account, address indexed rootOwner, uint64 ownerEpoch, bytes32 policyHash, bytes32 permissionHash);
event MandateAuthorized(bytes32 indexed mandateHash, address indexed account, address indexed executor, uint256 nonce, uint48 expiresAt);
event ExecutionBegun(bytes32 indexed mandateHash, uint48 startedAt);
event MandateRevoked(bytes32 indexed mandateHash, address indexed account);
event MandateExpired(bytes32 indexed mandateHash);
event ExecutionReceiptRecorded(bytes32 indexed mandateHash, MandateStatus status, bytes32 verificationHash, bytes32 failureReasonHash);
event CommerceJobBound(address indexed commerceContract, uint256 indexed jobId, bytes32 indexed mandateHash);
event NoncesInvalidated(address indexed account, uint256[] nonces);
event CommerceJobSettled(address indexed commerceContract, uint256 indexed jobId, bytes32 indexed mandateHash);
```

### Required custom errors

`UnsupportedAccount`, `InvalidRootSignature`, `InvalidExecutorProof`, `RootOwnerMismatch`, `OwnerEpochMismatch`, `PolicyHashMismatch`, `PermissionHashMismatch`, `WrongChain`, `ExpiredPolicy`, `ExpiredMandate`, `MandateNotExpired`, `NonceAlreadyUsed`, `MandateAlreadyExists`, `InvalidTransition`, `WrongExecutor`, `WrongAccountCaller`, `UnsupportedAdapter`, `WrongSelector`, `InvalidPolicyField`, `InvalidMandateField`, `InvalidTokenPair`, `ActionHashMismatch`, `PostconditionHashMismatch`, `AmountOutOfBounds`, `RecipientMismatch`, `CommerceBindingRequired`, `CommerceJobAlreadyBound`, `ExecutionWindowElapsed`, `ExecutionNotStarted`, `VerificationFailed`, `SettlementNotEligible`, `AlreadySettled`, and the two deployment-time guards `InvalidDeploymentPair` and `InvalidExecutionWindow`.

Use custom errors, not revert strings, for bounded gas and stable reason mapping. Every field, bound, and shape rejection maps to one of these selectors; `InvalidMandateField` and `InvalidPolicyField` cover the nonzero-commitment checks so the reason set stays small enough to map offchain.

Four further selectors are fund-safety and call-shape guards that the implementation proved necessary and the specification therefore requires: `OnlySelf` (the effects boundary is reachable only through `perform`'s self-call), `AllowanceNotCleared` (the adapter allowance is re-read as zero before success), `ResidualBalance` (no input remains after the refund), and `InsufficientGasBudget` (an attempt is refused when the remaining gas cannot cover both the attempt and its terminal record).

### Storage limits

Store only data needed to prevent replay, drive lifecycle, verify settlement, and expose compact receipt commitments. Do not store full action bytes, intent text, policy documents, simulation documents, or explanations. Storage layout is frozen because contracts are non-upgradeable.

## 12. Revocation, expiry, and failure

- `invalidateNonces(uint256[] nonces)` may be called through the smart account with root authorization before those nonces are used.
- `revoke(mandateHash)` requires `msg.sender == account`, status `AUTHORIZED`, and root-authorized account call; it records `REVOKED`. Once `beginExecution` has committed the attempt, revocation is no longer available: the accurate user-visible claim is that revocation exists while authorized, and that expiry plus the immutable execution window end authority otherwise.
- `finalizeExpired(mandateHash)` is permissionless for `AUTHORIZED` after `expiresAt`; it records `EXPIRED`.
- `beginExecution` refuses an expired mandate and wins or loses races by transaction ordering.
- `finalizeStalledExecution` is permissionless for `EXECUTING` after the immutable execution window; it records `FAILED`.
- Expected token/protocol/verifier errors during `perform` are caught and record `FAILED` in the same outer transaction.
- No terminal state transitions again. There is no admin reset, nonce clearing, retry flag, or signature resurrection.
- Revocation/expiry never depends on a hook, bundler, paymaster, executor API, or model.

If funds somehow remain in MandateExecutor after a successful or failed subcall, that is an invariant violation. No general admin sweep exists for user tokens. A recovery function, if later required, must be token/account/receipt-specific, timelocked, and user-authorized; it is excluded from MVP.

## 13. ERC-8183 linkage

ERC-8183 is a draft standard with `Open`, `Funded`, `Submitted`, and terminal `Completed/Rejected/Expired` states. Perago integrates rather than reimplements its escrow kernel.

Before mandate authorization:

- commerce contract and job ID are signed;
- chain and deployment are verified;
- job client corresponds to the Perago smart account or accepted payer design;
- provider equals the expected execution provider/payment recipient;
- evaluator equals `OutcomeEvaluator`;
- job is funded/submitted at the correct lifecycle stage;
- payment token and budget match the accepted integration configuration.

`OutcomeEvaluator.settle(jobId, mandateHash)`:

1. resolves the immutable job binding;
2. requires MandateExecutor receipt `SUCCEEDED` and verification hash nonzero;
3. matches account, adapter/verifier, action/postcondition, commerce contract, and job ID;
4. requires job not previously settled;
5. marks the local settlement guard before external interaction;
6. calls the pinned ERC-8183 `complete` path with a reason commitment derived from the receipt;
7. emits `CommerceJobSettled`.

The evaluator cannot settle `FAILED`, `REVOKED`, `EXPIRED`, unverified, or mismatched receipts. ERC-8183 refund/reject/expiry behavior remains available under the selected implementation; Perago must not install a hook that blocks the standard's non-hookable refund safety path.

## 14. Threat model

| Threat | Control | Residual risk / evidence |
| --- | --- | --- |
| Cross-chain/deployment replay | EIP-712 domain plus explicit chain/account/executor fields | Incorrect wallet display; digest fixture and chain-97 test. |
| Same-chain nonce replay | Nonce consumed during `authorize`; terminal state immutable | Storage corruption only; invariant test. |
| Confused deputy | Root owner, smart account, executor, adapter, selector, recipient, action and commerce binding signed | Misconfigured initial account ownership; deployment probe. |
| Executor/session key compromise | Exact account modules plus root-signed mandate and execution proof | Attacker can execute already signed/authorized tasks within bounds; revoke permission/account policy. |
| Bundler/paymaster manipulation | Signed UserOperation/calls; simulation; onchain checks | Censorship or delay; owner-funded fallback, expiry. |
| Malicious adapter | Immutable minimal adapters, source audit, code-hash binding, verifier state reads | Protocol-approved adapter bug; fork/fuzz/invariant tests and pause new policy offchain. |
| Approval theft | Exact same-batch account approval, exact adapter approval, zero cleanup, atomic subcall | Nonstandard token behavior excluded. |
| Reentrancy | Outer non-reentrancy, checks before effects, immutable targets, no arbitrary callbacks | Protocol callback complexity; adversarial token/adapter tests. |
| Oracle/quote manipulation | Direct protocol quote, signed min output, pinned block/freshness, enforce inside call | MEV within signed slippage; user-visible risk. |
| Simulation drift | Block/code hashes, quote deadline, policy/account freshness, min result | Favorable state changes permitted only if bounds still hold. |
| Front-running/MEV | Exact input/min output/deadline/recipient; private relay only if verified | Price can move within accepted slippage. |
| Stale quote | Short quote deadline and pre-submit refresh; contract deadline | User must re-sign changed commitment. |
| Compromised planner/API | Closed schema, root review/signature, contract bounds | Socially misleading explanation; web must render deterministic values. |
| Verifier abuse | Immutable paired verifier, direct state measurement, postcondition hash | Bad verifier code; independent tests and code-hash evidence. |
| Root-owner change | Owner epoch and policy re-registration | Previously authorized mandates remain until revoke/expiry by design; surface before owner migration. |
| ERC-8183 evaluator misuse | Only successful matching receipt can complete, one settlement guard | Upstream draft/API changes; pin commit/deployment. |
| Denial of execution | Expiry, revoke, stalled-execution finalizer, ERC-8183 refund path | User may lose opportunity but not grant broader authority. |
| Privacy leakage | Hash-only onchain text commitments, salted low-entropy commitments | Timing/address linkage remains public. |

## 15. Invariants and Foundry plan

### Safety invariants

1. `usedNonce[account][nonce]` never changes from true to false.
2. A mandate has at most one `MandateAuthorized`, one `ExecutionBegun`, and one terminal receipt.
3. A terminal mandate never transitions.
4. `SUCCEEDED` implies adapter execution and paired verifier pass in the same atomic subcall.
5. `FAILED` never enables ERC-8183 completion.
6. Adapter call target and selector are from the immutable deployment pair.
7. `inputSpent <= maxInput` and observed delta `>= minOutput` for success.
8. Recipient equals the signed recipient for every protocol effect.
9. Adapter allowance is zero and MandateExecutor holds no user balance after a terminal `perform`.
10. Root owner/account/owner epoch/policy/executor/action mutations invalidate authorization or performance.
11. Commerce job binds to at most one mandate and settles at most once.
12. No session key or bundler signature is accepted as the root Task Mandate signature.

### Focused unit tests

- each EIP-712 field/domain mutation;
- account registration and owner-epoch monotonicity;
- policy replacement invalidating old signatures;
- adapter/action decoding boundaries;
- exact approval and zero cleanup;
- swap and stake happy paths;
- protocol revert, false return, verifier false/revert, nonstandard token rejection;
- authorization/begin/revoke/expiry race ordering;
- stalled execution finalization;
- ERC-8183 binding and settlement eligibility;
- event fields and custom errors.

### Fuzz tests

- arbitrary nonce/expiry/amount/minimum/recipient mutations;
- canonical action encode/decode/hash parity with SDK fixtures;
- terminal transition sequences;
- allowance/balance conservation across adapter success/failure;
- malicious revert data sizes and malformed return data.

### Stateful invariant handler

Actors: root owner, smart account, executor, attacker, adapter, verifier, evaluator. Actions: configure policy, authorize, begin, perform, revoke, expire, settle, duplicate/reorder calls, advance time, mutate protocol outcome. Assert all 12 invariants after every sequence.

### Fork/testnet tests

- BSC mainnet fork for the pinned PancakeSwap router and selected staking protocol;
- BSC Testnet deployment probe for account/bundler/paymaster, tokens/pools, router, staking target, and ERC-8183 contracts;
- at least one explorer-linked successful and one failed/replay-rejected demo receipt before public integration claims.

## 16. Upgrade and admin posture

- MandateExecutor, adapters, verifiers, and OutcomeEvaluator are non-upgradeable for MVP.
- Adapter/verifier addresses and supported account implementation/code hashes are constructor-pinned.
- No proxy admin, arbitrary call admin, token sweep, receipt rewrite, nonce reset, or settlement override.
- If an incident occurs, API/web stop creating new mandates and users revoke permissions/authorized mandates; already deployed immutable contracts remain auditable.
- A new version is a new deployment/domain. Users explicitly migrate policy/account permission; old mandates do not cross domains.
- Deployment owner powers are limited to none after constructor where feasible. Any unavoidable upstream ERC-8183/admin role is documented with owner address and capabilities in the deployment manifest.

## 17. Deployment plan

### BSC Testnet (chain 97)

1. Probe and pin EntryPoint, Modular Account V2 factory/implementation/modules, bundler, and paymaster configuration.
2. Verify official PancakeSwap router/quoter addresses and onchain code hashes.
3. Resolve `D-002` staking deployment and `D-003` ERC-8183 deployment/payment token.
4. Deploy adapters/verifiers, then MandateExecutor with their immutable pairs, then OutcomeEvaluator.
5. Publish compiler versions, source verification, constructor arguments, bytecode hashes, addresses, deployer, owner/admin capabilities, block, and transaction hashes.
6. Run unit/fuzz/invariant suite, fork probes, and live smoke scenarios.
7. Seed only labeled test assets/liquidity when official testnet assets are unavailable.

### BSC Mainnet (chain 56)

Not part of the initial public execution gate. Before any mainnet deployment: repeat every source/address/code-hash probe, obtain an independent contract/security review, choose operational multisig/incident controls, quantify gas and MEV behavior, confirm payment/staking assets, and receive explicit user approval.

## 18. Open decisions

| ID | Decision | Owner | Validation |
| --- | --- | --- | --- |
| SC-D-001 | Exact Modular Account V2/EntryPoint/module versions and permission encoding on BSC Testnet | Contract + full-stack owner | Official deployment manifest, code-hash reads, sponsored and owner-funded UserOperation probes, forbidden-call tests. |
| SC-D-002 | PancakeSwap CAKE Pool viability or replacement staking adapter | Contract/integration owner | Official source, chain-97 bytecode, asset/position reads, deposit/verification/withdraw smoke. |
| SC-D-003 | ERC-8183 kernel/router/evaluator interface and deployment | Contract/integration owner | Pin upstream commit/ABI/address/code hash; execute complete/reject/refund test lifecycle. |
| SC-D-004 | Live demo payment token | Product/contract owner | Verify chain/address/decimals/funding path and ERC-8183 compatibility; otherwise deploy and label a test token. |
| SC-D-005 | Immutable `EXECUTION_WINDOW` and BSC confirmation depth | Executor/contract owner | Measure testnet inclusion/finality and choose the smallest safe bounds before deployment. |

No open item may be filled with an assumed address, capability, or silent fallback.
