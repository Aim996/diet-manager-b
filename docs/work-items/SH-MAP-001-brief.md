# SH-MAP-001 Work Item Brief

```text
task_id = SH-MAP-001
status = in_progress
milestone = M2
owner = Codex /root
reviewer = independent B storage reviewer
product_line = B-only
```

## Dependencies

- `SH-MODEL-001` / `EV-20260811-017`
- `SH-MODEL-002` / `EV-20260811-018`
- `SH-MODEL-003` / `EV-20260811-019`
- `SH-SAFE-BASE-001` / `EV-20260811-012`

## Deliverables

- `shared/contracts/storage-mapping.md`
- `shared/tests/validate-storage-mapping.ps1`
- SH-MAP-001 design, plan, report, review package, review and `EV-20260811-020`

## Allowed writes

- the deliverables above;
- `docs/开发进度.md` and `总功能开发计划0.3.md` status/evidence rows;
- no production runtime, database or plugin files.

## Forbidden scope

- do not create `.sqlite`, `.sqlite3`, `.db`, WAL, SHM, journal or JSONL business files;
- do not implement migrations, repository, outbox worker, adapters or `selected-route-map.json`;
- do not read, hash, edit, track or execute the five protected lease files;
- do not revive A/C full product implementations.

## Fixed decisions

- `DEC-023`: FactCommit -> EffectBundle -> EnvelopeFinalize layered transactions;
- `DEC-027`: B is the only product writer; A is read-only; C controls merge into B;
- `DEC-028`: no new nonessential foundation work;
- `CHG-20260811-001`: failed FactCommit may log separately but writes zero dietary business rows.

## Risks

- mapping a field twice or omitting a nested field creates silent data loss;
- JSON-only storage without extracted identity/state keys weakens constraints and recovery;
- placing technical logs in the business database can create a half-record interpretation;
- allowing FactCommit to touch finalization tables breaks the frozen three-stage protocol;
- creating A/C writers or `selected-route-map.json` would violate the B-only route decision.

## Verification commands

```powershell
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File shared\tests\validate-storage-mapping.ps1
```

Then run the six frozen contract/model validators from SH-MODEL-003 and repeat in the independent GitHub clone.

## Acceptance oracle

- exact upstream Schema hashes and IDs;
- exact 34-definition coverage, no duplicate field assignment;
- exact B filename/driver/route policy;
- exact table/index/transaction/migration/recovery/control sets;
- nine mutation checks rejected, including physical affinity/nullability/foreign-key weakening;
- technical log outside business database and FactCommit failure zero business rows;
- A has no writer, C has no independent database;
- Parser/ASCII/strict JSON block pass;
- business database candidates remain 0;
- independent review P0=0/P1=0 and GitHub clone reproduction pass.

## Reopen conditions

Any shared Schema hash, mapping field, table/index/constraint, transaction boundary, route policy, technical-log boundary, migration/recovery rule or validator change reopens this task.

## Machine traceability

case_assertion_paths:
  CASE-EFFECT-001:
    - /storage_mapping/fact_commit_transaction
    - /storage_mapping/effect_bundle_outbox
full_case_set: none
