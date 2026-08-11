# SH-CASE-004 Candidate Report

## Candidate identity

- task: `SH-CASE-004`
- branch: `agent/sh-case-004-golden-receipts`
- base: `b07df0461379f8998c14344e4d7e0087302665e7`
- implementation head before review documents: `7845ea5cf626ab27024c0444908d218351859f9c`
- status: `local_verification_passed_review_pending`
- product state: static golden Oracle and acceptance cases only
- model-budget policy: deterministic local validation first; at most one final independent OpenClaw review

## Completion boundary

The following statements are deliberately separate:

```text
Golden Oracle complete != renderer implemented
Golden Oracle complete != SQLite implemented
Golden Oracle complete != Skill installable
```

This candidate freezes what eight selected user-visible final responses must mean and exactly how they must look. It does not render a live response, write a meal, open a database, install a Skill, configure OpenClaw or expose an MCP server.

## Implemented

- one ordered `diet-manager/golden-receipts-v1` manifest, version `1.0.0`
- eight independent UTF-8/LF Chinese text artifacts
- byte-level validation of BOM, CR, NUL, strict UTF-8, exact terminal LF, length, SHA-256 and line count
- cumulative case catalog `1.3.0`, twenty-six exact ordered cases
- six appended cases: receipt evidence/options, normal success, requested analysis, single item, same-finalizer progress and frozen cross-date replay
- independent SHA-256 preservation locks for each of the previous twenty case JSON values
- structured checks for six metrics, fixed metric order, single-day alias equality, bounded quick options, safe exit, factual analysis position, multi-date ordering, frozen retry and finalizer-pending behavior
- twelve real anti-weakening mutations routed through the same candidate validator
- cumulative suffix compatibility in core/domain/ops validators while preserving their owned case/scenario/mutation counts and fixture version `1.2.0`
- no product renderer, SQLite repository, OpenClaw adapter, MCP server, installer or business write

## Product safety rule retained

A failed business write may produce a separate redacted technical log, but it must not produce a partial dietary record. The only later-stage exception represented here is a finalizer failure after facts/effects already committed: it returns the bounded `effects_pending` message and exposes neither a success receipt nor progress.

## TDD record

### Asset RED

Before the golden package existed, the focused validator exited nonzero with:

```text
GOLDEN_MANIFEST_MISSING
```

### Catalog RED

After the asset package passed but before the six cases were appended, the unchanged catalog was rejected with:

```text
GOLDEN_CASE_SET_VERSION_INVALID
```

### Asset GREEN

All eight declared byte lengths, hashes and line counts matched their independent text files. Test-owned copies proved rejection of:

- a valid UTF-8 same-length content change;
- UTF-8 BOM;
- CRLF;
- NUL;
- invalid UTF-8;
- missing terminal LF;
- extra terminal LF.

Each temporary mutation root was deleted and verified absent.

### Semantic and mutation GREEN

The complete validator produced twelve rejection lines followed by:

```text
GOLDEN_RECEIPTS|PASS|case_version=1.3.0|cases=8|assets=8
```

Mutation IDs:

```text
MUT-GOLDEN-TEXT-BYTE
MUT-GOLDEN-CRLF
MUT-GOLDEN-COMPONENT-SPLIT
MUT-GOLDEN-EXPLICIT-ESTIMATED
MUT-GOLDEN-PROGRESS-NOT-LAST
MUT-GOLDEN-POST-PROGRESS-ADVICE
MUT-GOLDEN-QUICK-SAFE-EXIT
MUT-GOLDEN-QUICK-FREE-TEXT-LINE
MUT-GOLDEN-REPLAY-USES-LATEST
MUT-GOLDEN-MULTI-DATE-ALIAS
MUT-GOLDEN-CROSS-DATE-ORDER
MUT-GOLDEN-PENDING-SUCCESS
```

## Behavior frozen by this package

- Exact output is authoritative at byte level; structured input is not used to regenerate expected text.
- A multi-dish receipt keeps every dish/food/drink on one item line and progress remains last.
- Explicit values use the explicit evidence form; inferred quantity uses the approved estimate wording.
- The Issue block contains two to four ordered quick options, one safe exit and the free-text route before progress.
- Normal success has no duplicate current-turn nutrition block and no automatic post-progress advice.
- Requested analysis is factual, requested and placed before progress; diagnosis and automatic health advice are absent.
- A single item has one title, one item line and no blank placeholder.
- Single-date progress comes from the same finalizer and its alias is field-equal.
- Cross-date replay returns the exact original two-date final result after a later unrelated write; it does not return latest totals and has no single-day alias.
- Finalizer-pending output is one bounded paragraph without a success title, receipt data, progress or terminal idempotency result.

## Preservation and scope

- previous case values: `20/20` independent hashes unchanged
- appended case values: `6`
- cumulative case order: exact `20 + 6`
- existing fixture catalog version: unchanged at `1.2.0`
- protected changed-path count: `0`
- business candidate changed-path count: `0`
- temporary mutation residual: `0`
- secret/token value matches in changed files: `0`
- machine-specific path/address matches in changed files: `0`
- protected validators read or executed: `0`

## Full permitted regression

Every command used Windows PowerShell 5.1 and ran serially. No broad test command was used.

| Validator | Exit | Elapsed ms | Final output |
|---|---:|---:|---|
| `validate-golden-receipts.ps1` | 0 | 2531 | `GOLDEN_RECEIPTS|PASS|case_version=1.3.0|cases=8|assets=8` |
| `validate-core-acceptance-cases.ps1` | 0 | 660 | `CORE_ACCEPTANCE_CASES|PASS|version=1.3.0|cases=5|fixtures=3|mutations=8` |
| `validate-domain-acceptance-cases.ps1` | 0 | 982 | `DOMAIN_ACCEPTANCE_CASES|PASS|version=1.3.0|cases=9|scenarios=9|mutations=11` |
| `validate-ops-security-acceptance-cases.ps1` | 0 | 1294 | `OPS_SECURITY_ACCEPTANCE_CASES|PASS|version=1.3.0|cases=6|scenarios=6|mutations=12` |
| `validate-business-contract-v2.ps1` | 0 | 355 | `CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10` |
| `validate-receipt-and-date-contract-v2.ps1` | 0 | 369 | `RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10` |
| `validate-issue-correction-contract-v2.ps1` | 0 | 402 | `ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12` |
| `validate-core-model-schemas.ps1` | 0 | 752 | `CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4` |
| `validate-nutrition-progress-schemas.ps1` | 0 | 1121 | `NUTRITION_PROGRESS_SCHEMAS|PASS|version=1.0.0|cases=42|definitions=10|mutations=4` |
| `validate-issue-correction-mixed-schemas.ps1` | 0 | 1266 | `ISSUE_CORRECTION_MIXED_SCHEMAS|PASS|version=1.0.0|cases=65|definitions=12|semantic_only=10|mutations=4` |

## Hygiene gates

- changed files before report/review package: `17`
- changed PowerShell Parser errors: `0`
- changed JSON strict parse: PASS
- changed files BOM/CR/NUL: `0/0/0`
- golden validator non-ASCII bytes: `0`
- `git diff --check`: PASS
- protected path-name delta: `0`
- secret/token value matches: `0`
- user/machine path and private address matches: `0`
- SQLite/DB/JSONL business candidates: `0`
- `sh-case-004-*` temporary residual: `0`

The five protected domain lease files were compared by path name only and were not read, hashed, edited, tracked or executed.

## Candidate hashes

| Path | Length | SHA-256 |
|---|---:|---|
| `shared/acceptance-cases/cases.json` | 29717 | `72FA8A91CE318313668DF7D9540E66CD13E5139E321CC0AE28DFEAC9BCAC887B` |
| `shared/acceptance-cases/golden-receipts/manifest.json` | 26081 | `FF7D5268CE72B5361DB90DAB54555A80F3F41FE86F10C593A366C1127DE052AE` |
| `shared/acceptance-cases/golden-receipts/CASE-RECEIPT-001.txt` | 862 | `9F778B0FC9E3AF49973CAEEAB2B101567CFA80E54681F86DDD85F409D2530463` |
| `shared/acceptance-cases/golden-receipts/CASE-RECEIPT-002.txt` | 925 | `F57748CDE3DC278A9C02348246309E030741E474FE963CFF528674AAEF60F4B5` |
| `shared/acceptance-cases/golden-receipts/CASE-RECEIPT-004.txt` | 511 | `F300D3FE8983AA972137555596922F62807953DBCE128C9B8DB1DF21EB725B24` |
| `shared/acceptance-cases/golden-receipts/CASE-RECEIPT-005.txt` | 602 | `BE5A233E893C502719AE0B69F29BC1C35F430115516B782DCE2F72E11F80636C` |
| `shared/acceptance-cases/golden-receipts/CASE-RECEIPT-006.txt` | 542 | `D68B77AA6F75C43293D5B80BEEFC223EFB959D5619DBECF82A399361C2287EAC` |
| `shared/acceptance-cases/golden-receipts/CASE-PROGRESS-006.txt` | 462 | `87544ADD218EFF1C5D1F13811A4B72D4351C738C3EE1E8FEF57FBF1F003718BA` |
| `shared/acceptance-cases/golden-receipts/CASE-STORAGE-006.txt` | 1002 | `330795318F893993989CBE7D23B237B876DA25A609DEF63DB9AFAC23CF68A26C` |
| `shared/acceptance-cases/golden-receipts/CASE-EFFECT-003.txt` | 139 | `7FE08C39724C3E2A0A0D614D3AA2AACC7C8EC7442398E54438127A9B76F8ECA3` |
| `shared/tests/validate-golden-receipts.ps1` | 48785 | `5D3A2666FB964C24E0271A976C091BFA58A367493168F6AB75456873DD35DE88` |
| `docs/work-items/SH-CASE-004-brief.md` | 6881 | `CF02A9CD6937E3072ABCB4DDA96CFA44353CB9BD9BACAC76AC164A6C54B8BC54` |
| `docs/superpowers/specs/2026-08-12-sh-case-004-golden-receipts-design.md` | 10590 | `C06791769A4A936E9493E6F5A60D1A6A5E0E08E40D3D89AE74D659A4145320CB` |
| `docs/superpowers/plans/2026-08-12-sh-case-004-golden-receipts.md` | 21616 | `C24AA24E2955297218FB5F2423B6B9CF230818F81B00ED2160D05E81E97BE21D` |

## Discovered and corrected

- Rejected a design in which expected text would be generated from the same structured result under test; separate text assets are authoritative.
- Added independent locks for all previous twenty case values before editing the cumulative catalog.
- Kept byte checks and semantic checks separate so a candidate cannot pass by updating only declared metadata.
- Avoided repeating the heavy Windows safety-foundation work; this task contains only the small path/reparse checks needed to protect its temporary mutation copies.
- Kept all routine work local and deterministic, reserving model use for one final review.

## Pending

- one independent public-candidate review
- closure evidence and Plan 0.3/progress update after P0=0/P1=0
- next work item `SH-HARNESS-001`
- renderer, SQLite repository, adapter, install/upgrade flow and end-to-end Skill packaging
