# SH-CASE-003 Independent Review Package

## Review objective

Independently determine whether the `SH-CASE-003` candidate is a sound, deterministic and non-self-referential static Oracle package for privacy, official-data zero difference, clean installation, migration failure, candidate byte drift and invalid export restore rejection.

The review must not treat candidate validator PASS output as expected data and must not claim that any installer, database, migration, backup, restore, deletion or release implementation exists.

## Candidate identity

- branch: `agent/sh-case-003-ops-security-oracles`
- base: `33e51b773be66b78581e7a3d13fdd95e86c8f6a4`
- implementation head: `3f120a0e6ac037c4a071d9fce7db089cb212335e`
- status: `candidate_review_pending`

## Exact candidate hashes

| Path | Length | SHA-256 |
|---|---:|---|
| `shared/acceptance-cases/cases.json` | 24042 | `25EB44E3DBB0813457D62136C9C94C7AEF6C5B43AE7C1CCAB11360FF62090163` |
| `shared/acceptance-cases/fixtures/core-v1.json` | 21757 | `E4069D2EB2FCE22B191657BDE91CDFF737597891F3CA0535AA22C5BA6FE16C60` |
| `shared/tests/validate-core-acceptance-cases.ps1` | 27712 | `A514364092E5CA6B7E0158B1A5E14196FE494C8F5AC7C3B53BCDBC0A99E4FC07` |
| `shared/tests/validate-domain-acceptance-cases.ps1` | 35127 | `E17260460D14E620958234428399DD1F4C8B7E744E299ECD661A917938BDCB4F` |
| `shared/tests/validate-ops-security-acceptance-cases.ps1` | 64623 | `3E099833058FFE33A2CAB039AA0061CE14C0A55F020A6D0942C36C4DFBE2F989` |
| `docs/work-items/SH-CASE-003-brief.md` | 7540 | `0096182DA20DC548A03C22F5D62AEB8DBA3F8579D19F052838FB0828A3DFF043` |
| `docs/work-items/SH-CASE-003-report.md` | 7906 | `6E39859A8AA707289E38E05A1795E27029B3238523227BFC85F14F51E98056F0` |
| `docs/superpowers/specs/2026-08-11-sh-case-003-design.md` | 12127 | `D5B1F1CC07F90632165A7DD0036AD86568C66A0E8D519561484F00B26D51E20A` |
| `docs/superpowers/plans/2026-08-11-sh-case-003-plan.md` | 17198 | `27DC0F6DEBCBC0C9BB9E952A6248AF6055B378F3192F3762D7DEA828D20190D6` |

## Required independent checks

1. Build a separate expected ID list from Plan 0.3 and the brief; require exact cumulative order `14 + 6` and exact six fixture IDs.
2. Independently compare the first fourteen case JSON values and all previous fixture objects with base `33e51b7`; do not reuse candidate preservation functions.
3. Recompute every fixture Base64 decoded length and SHA-256 using a separate checker.
4. Verify logical paths use only declared fixture roots and contain no machine path, traversal, URI, secret or live data reference.
5. Verify privacy outbound keys are exactly the six allowed keys and none of the six sentinel values appears in outbound/log/evidence/receipt objects.
6. Verify foundation before/after file sets include the sidecar and are byte/time identical, while failure still requires after scan and cleanup.
7. Verify clean install is preflight/package-verification first, uses staging/atomic promotion, creates no formal JSONL or business records and keeps smoke writes isolated.
8. Verify migration failure preserves old bytes/readability/version, hides partial target and requires a fresh attempt.
9. Verify candidate original and changed bytes really differ and all promotion/rebuild/patch/substitution paths remain false.
10. Verify minimal export is readable but lacks the four backup capabilities and rejection precedes any official replacement/deletion/migration/version change.
11. Independently mutate each of the six case families and prove the candidate validator rejects the intended weakness for the intended reason.
12. Verify core/domain validators changed only for cumulative version/registered suffix compatibility; their owned assertions and mutation counts remain intact.
13. Run all nine permitted validators with Windows PowerShell 5.1 and compare stable final lines.
14. Verify strict JSON, Parser/ASCII/CR/NUL, `git diff --check`, protected changed-path count zero and business candidate count zero.
15. Report P0/P1/P2 separately and explicitly state whether `SH-CASE-003` may close.

## Required mutation coverage

- privacy: leak raw context; leak token to ordinary log
- foundation: omit changed/deleted sidecar; skip after scan on failure
- install: create a sample business record; accept package hash mismatch
- migration: advance version; make old state unreadable or partial target visible
- candidate: authorize promotion after byte drift
- export/restore: treat minimal export as backup; delete before rejection
- registration: drop one required case or fixture

## Severity

- `P0`: unsafe Oracle authorizes business-data loss/disclosure/promotion, protected files changed, prior cases silently changed, or validator cannot run.
- `P1`: required case/fixture/mutation missing, self-derived expected data, wrong requirement/case mapping, deletion/zero-write rule not enforced, or a realistic weakening survives.
- `P2`: documentation/diagnostic improvement that does not weaken the Oracle or change selected behavior.

Completion requires `P0=0` and `P1=0`. P2 may be recorded for later work.

## Review independence

- Do not edit candidate files while reviewing.
- Do not use candidate PASS text, report counts or declared hashes as the sole expected source.
- Build at least one separate checker or direct assertion matrix from Plan 0.3 and this brief.
- Do not read, hash, edit or execute protected domain lease files.
- Do not use OpenClaw unless the user separately authorizes that independent-review consumption.
