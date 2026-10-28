# API changelog

## 2026-10-28

### Public receipt read hardening

- Reuse a terminal `execution_receipts` projection only when its status agrees with `mandateRecord` at the finalized block. Such reads still compare the public receipt's verification and failure commitments with contract storage, but do not scan mandate logs or advance its checkpoint.
- Cold lifecycle scans prefer retained confirmed authorization evidence over the simulation block when no per-mandate cursor exists. Authorization is the first possible lifecycle event. Requests remain sequential and cover at most 10 blocks each; missing authorization evidence retains the simulation-block fallback.
- Cache only successfully validated terminal public responses for 15 seconds, at most 64 mandates per API process, evicting the oldest insertion first. Errors and missing receipts are never cached. A cache hit serves the last validated finalized observation, including any commerce observation, until expiry.
- Classify upstream RPC throttling, compute-unit exhaustion, provider internal errors, and timeouts as retryable chain unavailability. Contract revert data, invalid RPC parameters, and receipt commitment mismatches are not converted to successful or missing receipts.
- Unknown mandates remain database-only 404 responses; malformed hashes remain 400 responses. The SDK response schema and public field allowlist are unchanged.

The commerce scan in `readFinalizedCommerceState` is unchanged. Bound jobs can still scan evaluator and commerce logs in 10-block ranges on a cache miss. Cold lifecycle scans also remain proportional to the distance from their known authorization/cursor; there is no global request limiter or cross-process cache.

Local regression coverage uses the real Hono request path, disposable PostgreSQL, and counting chain clients. It does not establish hosted or live-chain behavior.
