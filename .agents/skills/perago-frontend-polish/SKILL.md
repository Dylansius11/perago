---
name: perago-frontend-polish
description: Use when building or changing anything in apps/web - a screen, a wallet interaction, typed-data review, a copy string, a state or error surface, or motion. Read it first to confirm the UI hold has been lifted, then for the rules every Perago screen must satisfy.
---

# Perago Frontend Polish

## 0. The hold comes first

**Interface work is currently on hold.** The user supplies Perago's design direction; until that arrives, do not invent screens, component systems, CSS, design tokens, logos, mockups, or a design-system document. This is a recorded, verified user preference, not a guess. Phase 7 (`P7-001`, `P7-002`) is where design direction becomes an accessible shell, and it runs after the Phase 6 gate.

If you were asked to build UI and the direction has not arrived, say so and stop. Everything below applies the moment it does.

## 1. What the web app is, and is not

It connects a self-custodial external owner wallet, derives or deploys the supported Modular Account V2 address, collects Wallet Policy and TaskIntent input, requests root signatures and scoped permissions, renders API-produced policy and simulation facts, and reads terminal state and public receipt evidence.

It never holds a key, never installs a broad session permission, never builds arbitrary calldata, never infers success, and is never the only place a policy is enforced. Typed data and account calls come from `packages/sdk` - a hand-rolled EIP-712 object in a component is a defect, because the digest the user signs must be identical to the one the contract recomputes.

## 2. Signing screens are the product

The confirmation surface is where trust is either earned or faked. Before a root signature, show, from API and SDK values and never from a placeholder:

- the exact action in plain language, plus maximum input, minimum output, recipient, protocol, and deadline;
- the chain and the recovered root signer, with a hard stop on a mismatched chain or account implementation;
- the simulation's block context and freshness, with signing **blocked** on a stale simulation;
- the policy decision rule by rule when a plan was rejected, not a generic denial;
- what authority is being granted and when it ends.

A value the user has not seen cannot be inside the signature. If a field is unavailable, label it unavailable - never render a zero, a dash, or an optimistic estimate as a real number.

## 3. State honesty

Every asynchronous surface distinguishes: nothing submitted, submitted and pending confirmation, confirmed succeeded, confirmed failed with its reason code and human sentence, revoked, and expired. `PENDING_CONFIRMATION` is never drawn as success. A terminal failure shows the stable reason code plus the sentence (`PRD-F-016`); a generic "something went wrong" is a bug. Wallet rejection, chain switch, insufficient balance, expired mandate, and stale simulation each get their own recoverable path.

## 4. Copy discipline

Copy states what the deployed contracts enforce. "Revocable anytime" is false once execution has begun - the truthful line is that a mandate is revocable while authorized, and that expiry plus the immutable execution window end authority otherwise. Never promise a guarantee the bytecode does not provide, never call an unconfirmed transaction complete, and never describe a fork or seeded-liquidity demo without labeling it.

## 5. Craft, once direction exists

Reuse one convention: the first screens set it, and a repeated pattern is extracted into a shared component rather than restyled. Reach for `emil-design-eng` for craft and the `motion` skill for movement - import from `motion`, never `framer-motion`, and search the Motion docs before writing animation code. Motion is functional only: state-change feedback at 150-250ms, honoring `prefers-reduced-motion`. No decorative movement on a financial confirmation. Keyboard access, focus order, visible focus, and screen-reader labels on money and status are requirements, not polish.

## 6. Verification gate

Open the real screen in a real browser, complete the interaction with a wallet, and read the values back - including the rejection path and one failure path. A component test alone is not visual proof, and a screenshot of a mock is not verification. Record what you exercised.

## 7. Traps

- Formatting token amounts with floating point. Keep integer base units to the render boundary and format once.
- Deriving the account address in the client from a stale implementation constant - the address is CREATE2 over the implementation bytecode and a stale constant relocates it.
- Showing a quote that was never simulated from the real smart-account call context.
- Letting a UI toggle imply a security boundary that no contract enforces.
- Reusing the reference product's flow or layout. Perago is a new product; that repository is read-only research.
