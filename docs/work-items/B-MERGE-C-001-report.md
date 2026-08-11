# B-MERGE-C-001 Implementation Report

## Status

- product line: B only
- state: local candidate frozen; independent review pending
- reviewed implementation candidate: `0184ac8eb53583db1e95a4c55fa146a0dfca58cf`
- stacked base: `c1181ae500769be0346450fab949701731cf49d9`
- scope: server-authoritative preview, idempotency reservation, state-transition guard and migration guard
- explicitly absent: dietary repository, `FactCommit`, effects, final receipt, OpenClaw/MCP business adapter and C product code

## Implemented boundary

The B package now has an internal server-authority layer. It canonicalizes a preview without storing raw dietary material, hashes it, signs an exact seven-field binding with HMAC-SHA256, and persists only the binding in `command_envelopes.payload_json` plus one authoritative `idempotency_records` row.

Authorization is read-only. It revalidates current database/migration identity, token signature, request identity, data revision, stored binding, envelope state and idempotency linkage. Its input shape contains no caller state; an unexpected caller-state property is rejected before a getter can run.

The public Skill/OpenClaw tool remains `foundation_not_implemented` and non-writing. B-STOR-002 must call this authority inside its future transaction before any dietary write.

## Preview and token authority

- token prefix: `dm-b-preview-v1`
- signature: HMAC-SHA256 over the versioned prefix and canonical payload segment
- key boundary: private adapter-owned byte key, minimum 32 bytes; never stored or logged
- binding: `preview_id`, `preview_version`, `preview_hash`, `input_digest`, `subject_scope`, `command_type`, `data_revision`
- canonicalization: plain JSON data properties only, sorted keys, finite numbers, no accessors/custom prototypes/sparse arrays/cycles, depth/node/string/UTF-8 bounds
- comparison: canonical payload plus constant-time signature equality

SQLite stores only `authority_kind` and the binding. It stores neither token, secret, raw chat, food name nor quantity.

## Idempotency and atomicity

First preview creation runs under `BEGIN IMMEDIATE` and inserts:

1. one `command_envelopes` row in `received/preview_ready`;
2. one `idempotency_records` row in `preview_ready`.

An injected failure after the first insert rolls back both rows. The test then retries successfully from zero rows. This directly proves the user's rule: a failed write may later have a separate redacted technical log, but it leaves no half control record and creates no dietary record.

An exact retry returns the same preview ID, binding and token with zero row delta. Same-key changes to digest, subject or command fail with a stable `IDEMPOTENCY_CONFLICT:<field>`, preserve the original rows and create no dietary data. A changed preview hash cannot replace authority; a changed data revision is stale.

## State and migration guards

Envelope transitions are restricted to:

```text
received -> facts_committed -> effects_pending -> effects_stable -> finalized
```

Effect transitions are restricted to:

```text
pending -> processing
processing -> succeeded | retryable_failed | permanent_business_skip
retryable_failed -> processing
```

Backward, skipped, self and invented caller states fail.

The migration guard checks current application ID, user version, migration history, migration ID/checksum and the complete schema identity immediately before preview authority work. The B-STOR validator was tightened to reject unregistered views/triggers as well as extra tables/indexes. Only the four `storage-mapping/v1` migration scenarios pass; backup, version and outcome mismatches fail before preview/control or business writes.

## TDD evidence

1. Token/canonical RED: Vitest could not load `authority/canonical-json.js`; 0 tests collected.
2. State/migration RED: Vitest could not load `state/transition-guard.js`; 0 tests collected.
3. Preview-store RED: Vitest could not load `preview/store.js`; 0 tests collected.
4. Initial preview GREEN: 24/25 passed; the sole failure was a test Oracle that expected a literal `AAAA...` instead of the computed preview hash. The assertion ran before cleanup, so the exact test-owned root was verified ordinary and removed. No product defect or business row was involved.
5. Corrected focused GREEN: 25/25.
6. Atomicity/schema additions: 27/27.
7. Complete package: 4 files / 48 tests PASS.

## Verification

| Gate | Result |
|---|---|
| focused server authority | PASS, 27/27 |
| complete B package Vitest | PASS, 4 files / 48 tests |
| TypeScript `--noEmit` | PASS |
| TypeScript build | PASS |
| OpenClaw local metadata build check | PASS, `Plugin metadata is up to date.` |
| OpenClaw local plugin validation | PASS, `Plugin diet-manager-b is valid.` |
| runtime | Node `v24.15.0`, SHA-256 `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5` |
| protected-path delta | PASS, 0 |
| public handler/contract/plugin/migration-v1/lock delta | PASS, 0 |
| test-owned B-MERGE roots after run | PASS, 0 |
| dietary/business rows in every authority test | PASS, 0 |

No model was invoked by the implementation or package validation commands.

## Frozen candidate files

| File | Bytes | SHA-256 |
|---|---:|---|
| `version-b-lite-plugin/src/authority/canonical-json.ts` | 3283 | `5B9F19554794EEC7F2B1EBD743A6742495D866418FC9F72A2C2E8616FE11FBEC` |
| `version-b-lite-plugin/src/preview/token.ts` | 5682 | `DD93CAFDCF075BADE6714A3D1FCA96AD2122CE63C57193C2D728F777D8C4C103` |
| `version-b-lite-plugin/src/preview/store.ts` | 15086 | `89F599B23561D9309916B2DAF0388B579B5A6D8C003F9D5ACFE85D465E7220E8` |
| `version-b-lite-plugin/src/state/transition-guard.ts` | 1423 | `1762C94BA786CAE53D69C77B29BE75BC4EDB7827299B8BE79063E8AA16D4118E` |
| `version-b-lite-plugin/src/storage/migration-guard.ts` | 5233 | `7429146D2136604493C1EB53DA3750C6CE07D6FA2081846B976FE21A472AD39C` |
| `version-b-lite-plugin/src/storage/database.ts` | 8907 | `8F5DFF451245B7C4763BAB81D5D4BFE5389B5B1E5E7BE216E76868D0B97B1ED3` |
| `version-b-lite-plugin/tests/server-authority.test.ts` | 23977 | `BD2744D1F1143CA68AC76362C798D78C85294499B65ACA91BED21438672B3178` |

## Deferred by design

- actual dietary/business transaction repository and compare-and-set updates (`B-STOR-002`);
- server computation of data revisions from domain rows;
- terminal frozen-result replay and response-loss recovery;
- user-visible preview flow and production Skill/OpenClaw/MCP adapter wiring;
- migration v2, backup/restore and upgrade orchestration;
- installable product or G1/G2/G3 claims.

These are later Plan 0.3 items, not missing claims from this candidate.
