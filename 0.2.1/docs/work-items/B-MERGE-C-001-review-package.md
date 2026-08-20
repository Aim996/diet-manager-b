# B-MERGE-C-001 Independent Review Package

## Candidate

- repository: `https://github.com/Aim996/diet-manager-b.git`
- branch: `agent/b-merge-c-001-server-authority`
- implementation commit: `0184ac8eb53583db1e95a4c55fa146a0dfca58cf`
- stacked base: `c1181ae500769be0346450fab949701731cf49d9`
- reviewer must independently fetch the public commit and record the exact reviewed SHA

## Scope

Review only the B internal preview/token, idempotency reservation, transition guard, migration guard and their tests. Do not require a business repository, real dietary write, user-visible preview UX, OpenClaw model conversation, MCP server or C implementation. Do not read the five protected lease files.

## Required checks

1. The signed binding has exactly seven fields and HMAC covers the versioned canonical bytes.
2. Token verification rejects wrong prefix/segments, malformed/noncanonical base64/JSON, forged signature, weak key and binding shape drift; signature comparison is timing safe.
3. Canonical JSON rejects accessors without executing them, custom prototypes, symbols, sparse arrays, cycles, unsupported/nonfinite values and configured bounds.
4. Preview persistence uses only `command_envelopes.payload_json` and `idempotency_records`; no raw chat, food, quantity, credential, secret or token is stored.
5. First creation atomically inserts exactly two control rows. The `after_envelope` fault rolls back both and permits a fresh retry.
6. Exact idempotency retry returns the original preview/token with zero row delta.
7. Same key with changed digest, subject or command preserves the original rows and fails with zero dietary/business rows.
8. Changed preview hash and stale data revision cannot replace the original authority.
9. Authorization reopens and compares token, request binding, current revision, stored payload, envelope state and idempotency linkage; it performs no write.
10. Caller state is not an authority input. An extra getter-bearing caller-state property is rejected with getter count zero.
11. Envelope/effect guards implement only the documented edges and reject skip/backward/self/unknown states.
12. Migration guard checks exact current application ID, user version, migration history/checksum and complete schema identity before authority work.
13. Unregistered table/view/trigger/index or illegal migration scenario/backup/version/outcome fails before control or business writes.
14. B-STOR existing behavior remains green and unknown/drifted databases are still byte-preserving failures.
15. All 27 focused tests independently assert zero dietary rows; test roots are exact system-temp direct children and cleanup is zero.
16. `index.ts`, `contracts.ts`, plugin manifest, migration v1 and lockfile are unchanged; the public tool remains non-writing.
17. No protected file, machine path, test-platform address/token, real secret, database artifact or official data enters the diff.
18. The report and tests do not claim B-STOR-002, installation, deployment or product readiness.

## High-risk questions

- Can a same-key concurrent caller create two previews, or does `BEGIN IMMEDIATE` serialize the lookup/insert boundary?
- Can a forged/stale token be accepted because only caller values are compared and the stored row is skipped?
- Can schema drift with unchanged `user_version`/history pass the migration guard?
- Can any first-write failure leave one envelope or idempotency row behind?
- Can an adapter supply a trusted state, secret, database path or preview binding through the public tool schema?

## Required verdict format

```text
B_MERGE_C_001_REVIEW|PASS|P0=0|P1=0|P2=<count>|commit=0184ac8eb53583db1e95a4c55fa146a0dfca58cf|cleanup=1
```

On failure, report severity, file/line, violated invariant, a concrete counterexample and the minimum correction. A PASS must not claim repository, business flow, deployment or product readiness.

## Local reproduction

Use Node `>=24.15.0 <25` from `version-b-lite-plugin`:

```text
node ./node_modules/vitest/vitest.mjs run tests/server-authority.test.ts
node ./node_modules/vitest/vitest.mjs run
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/typescript/bin/tsc -p tsconfig.json
node ./node_modules/openclaw/openclaw.mjs plugins build --check --root . --entry ./dist/index.js
node ./node_modules/openclaw/openclaw.mjs plugins validate --root . --entry ./dist/index.js
```

All review databases/clones must live under one review-owned temporary root and be removed before the final verdict. No model call is required for the reproduction commands.
