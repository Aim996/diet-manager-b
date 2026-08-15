# B-STOR-001 Independent Review Package

## Candidate

- repository: `https://github.com/Aim996/diet-manager-b.git`
- branch: `agent/b-stor-001-driver-spike`
- draft PR: `#6`
- stacked base: `agent/sh-trace-001-machine-mirror`
- reviewer must record the fetched commit and verify it is the PR head before issuing a verdict

## Scope

Review only the B SQLite bootstrap and migration 0001. Do not require a business repository, real dietary write, OpenClaw model conversation or MCP server in this task. Do not read the five protected lease files.

## Required checks

1. The only accepted production database leaf is `diet-manager-b.sqlite3` beneath the supplied private root.
2. Caller-controlled relative paths, root reparse/identity drift, database reparse leaves, multiply-linked leaves and unknown database identity fail closed.
3. No third-party SQLite driver or build-script approval was introduced.
4. Migration SQL matches the frozen `storage-mapping/v1` machine block: every column/type/nullability/default, primary key, CHECK, foreign key and index; cardinalities are 20/18/22.
5. Application ID, user version, migration ID and mapping checksum are exact and transactionally committed.
6. Fresh install uses candidate-first publication and never overwrites an existing final leaf.
7. `after_schema`, `before_history` and `before_commit` faults leave final/candidate/WAL/SHM absent and permit a fresh retry.
8. Unknown existing database rejection does not change its bytes.
9. The returned read-write connection revalidates the exact schema it will use.
10. All business tables are empty after bootstrap; no test uses real user data or the formal B data root.
11. The test Oracle is independent of `migration-v1.ts` and owns the mapping block identity directly.
12. Node engine and current OpenClaw host requirements agree at `>=24.15.0 <25`.
13. Package tests, TypeScript and local OpenClaw validation evidence are reproducible without model calls.
14. No machine path, test-platform address/token, secret, business database or protected lease enters the diff.
15. Public Skill behavior remains non-writing; this bootstrap is not misreported as a completed product.

## Required verdict format

```text
B_STOR_001_REVIEW|PASS|P0=0|P1=0|P2=<count>|commit=<full_sha>|cleanup=1
```

On failure, report severity, file/line, violated invariant, concrete counterexample and the minimum correction. A PASS must not claim repository, business flow, deployment or product readiness.

## Local reproduction

Use Node `>=24.15.0 <25` from `version-b-lite-plugin`:

```text
node ./node_modules/vitest/vitest.mjs run tests/storage-bootstrap.test.ts tests/sqlite-compatibility.test.ts tests/foundation.test.ts
node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ./node_modules/typescript/bin/tsc -p tsconfig.json
node ./node_modules/openclaw/openclaw.mjs plugins build --check --root . --entry ./dist/index.js
node ./node_modules/openclaw/openclaw.mjs plugins validate --root . --entry ./dist/index.js
```

All review databases must be created under one review-owned temporary root and removed before the final verdict.
