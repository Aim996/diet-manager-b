# SH-TRACE-001 Machine Traceability Design

## Purpose

Turn the approved tables in `总功能开发计划0.3.md` into deterministic, reviewable JSON mirrors. The Markdown plan remains the only approved state source; generated JSON is a drift detector, not a second place to edit status.

This task closes governance debt before SQLite work begins. It does not implement a database, business repository, installable Skill, OpenClaw adapter or MCP server.

## Outputs

- `shared/traceability/requirements.json`: 71 requirement rows plus the derived 144-case registry and release selectors.
- `shared/traceability/tasks.json`: 59 task rows plus case-producer and full-case-responsibility matrices.
- `shared/traceability/decisions.json`: exact DEC/Q/RISK/DEBT/CHG rows.
- `shared/traceability/evidence-index.json`: evidence registry rows, actual evidence paths and SHA-256 identities.
- `shared/tests/validate-traceability.mjs`: dependency-free generator, validator and mutation-test entry point.

## Authority and update flow

1. A human-approved change edits the plan or an evidence file.
2. `validate-traceability.mjs --write` parses the plan, verifies references and rewrites all four mirrors atomically.
3. The default command regenerates the same in-memory model and requires byte-for-byte equality with tracked mirrors.
4. Any mismatch, duplicate, orphan, malformed composite ID, selector drift or status/evidence contradiction fails closed.

No mirror field is manually authoritative. Generated files carry the source plan path and SHA-256 so a stale mirror is obvious.

## Parsing boundary

Only formal registries are parsed:

- requirements: §30 table rows beginning with a backticked `REQ-*`;
- tasks: §31.3–§31.8 task rows, excluding §29.6 path-template rows;
- governance: the §27 DEC/Q/RISK/DEBT tables and §28 CHG table;
- evidence: §28.2 EV rows and exact `docs/evidence/EV-*.md` files;
- selectors and fixed owners: §24.4.1 machine blocks.

Free-form prose is not promoted into registry state. References inside formal rows must resolve against the parsed registries.

## Case and assertion matrices

The 144-case registry is the exact sorted union of the §30 minimum-case cells. The exact task `C[]` union must match it. The current 27-case shared catalog must be a subset; catalog membership does not imply product execution.

Briefs that contain `case_assertion_paths` contribute path-level producer rows. Tasks without a brief or without those fields remain declared producers only while `未开始`; completed legacy exceptions must be explicitly supported by the plan/evidence boundary. `full_case_set` responsibility remains fixed to the five assignments in §24.4.1 and never derives from local `C[]` alone.

## Evidence and status rules

- completed tasks require at least one registered evidence ID;
- unstarted/cancelled tasks cannot claim current completion evidence unless the plan explicitly labels it historical;
- evidence files are exact `EV-<date>-<number>-*.md` ordinary repository files and are hashed from bytes;
- EV-001/002 may remain plan-only historical entries; every later registered EV must have exactly one file;
- an evidence ID missing from §28.2 cannot satisfy a task row;
- no combined pseudo-ID such as `EV-.../014/015` is accepted.

## Stop condition

SH-TRACE-001 stops when the four mirrors regenerate deterministically, all mutation tests reject corrupt inputs, Plan 0.3 and progress documentation match the generated counts, and one bounded independent review finds no P0/P1 issue. Product execution remains `backend_pending` afterwards.
