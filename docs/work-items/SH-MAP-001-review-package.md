# SH-MAP-001 Independent Review Package

## Review objective

Independently determine whether the candidate is an implementable and fail-closed B SQLite mapping for the frozen 34-definition shared model. Do not accept the candidate only because its own PowerShell validator passes.

## Frozen candidate inputs

- `shared/contracts/storage-mapping.md`
- `shared/tests/validate-storage-mapping.ps1`
- the four Schema sources and hashes listed in the mapping
- `docs/superpowers/specs/2026-08-11-sh-map-001-design.md`
- `docs/work-items/SH-MAP-001-brief.md`
- `docs/work-items/SH-MAP-001-report.md`

Do not read, hash, edit, track or execute the five protected lease files named in the brief.

## Required independent checks

### 1. Coverage and identity

- independently enumerate the four Schema `$defs` sets and recursively resolve `$ref`/`allOf` properties;
- require exactly 34 unique definition refs;
- require every resolved field to appear exactly once in columns/json/child_tables/response_only;
- verify the mapping does not obtain expected fields from its own candidate output.

### 2. Physical implementability

- verify all 20 table names and 18 indexes independently;
- verify every primary/index/foreign-key column exists;
- verify every foreign key targets a parent primary or unique key and does not prevent valid mixed commands;
- inspect affinity, nullability, defaults, JSON checks and state checks for contradictions with the source Schema;
- verify contextual columns such as envelope/event ownership do not masquerade as shared-model fields.

### 3. Transaction safety

- FactCommit failure must leave zero business rows, including outbox;
- EffectBundle failure must preserve facts and create no final receipt/progress;
- EnvelopeFinalize failure must roll back terminal rows and leave effects pending;
- idempotency conflict and failed migration must be zero-write/version-stable;
- technical logging must be physically and semantically outside the business database.

### 4. Route policy

- B is the only writer;
- A has no writer/migration/recovery path;
- C has no independent database;
- the five C control points are merge obligations for `B-MERGE-C-001` only;
- `selected-route-map.json` and any database file remain absent.

### 5. Independent mutations

At minimum mutate and reject:

1. one field removed or duplicated;
2. a column affinity/nullability weakened;
3. a foreign key redirected to a non-unique parent;
4. A or C made a writer;
5. a FactCommit finalization write;
6. a technical log moved into the business DB;
7. an idempotency uniqueness index removed;
8. failed migration advancing `user_version`.

## Required conclusion format

```text
SH-MAP-001-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|definitions=34|tables=20|indexes=18|mutations=<n>
```

Any P0/P1 produces FAIL and must identify the exact candidate location, consequence and minimum correction. P2 may be recorded separately but cannot be silently converted into a completion claim.
