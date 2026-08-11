# SH-CASE-004 Golden Receipt Oracle Design

**Date:** 2026-08-12
**Task:** `SH-CASE-004`
**Product line:** B-only shared Oracle
**Status:** user-approved design candidate (`A`: exact text assets plus deterministic local validation)

## 1. Context

`SH-CASE-001/002/003` established a cumulative adapter-neutral case catalog with 20 cases. They freeze structure and business outcomes, but they do not yet freeze the exact Chinese receipt text that a future renderer must produce.

This task adds the final M2 golden-receipt Oracle package. It does not implement the renderer, SQLite, a case execution adapter, installation, OpenClaw business logic or MCP business logic.

## 2. Decision and alternatives

### A. Separate exact text assets plus one manifest — selected

Store each expected receipt as an independent UTF-8 text file. A single machine manifest maps the eight registered cases to their structured final-result input and expected text artifact. One local PowerShell validator checks exact bytes and independent structural rules.

This is readable in GitHub, reusable by the later B adapter and inexpensive to validate without a model.

### B. Embed receipt text in `cases.json` — rejected

This reduces file count but makes line endings, Emoji, long diffs and human review harder. It also mixes general business Oracle data with renderer assets.

### C. Generate expected text from structured data — rejected

This risks a self-generated Oracle: the same rendering mistake could appear in both the generator and implementation. Expected prose must be authored and frozen independently.

## 3. Scope

The package owns exactly the eight Plan 0.3 case IDs:

1. `CASE-RECEIPT-001` — complete §18.8 multi-dish receipt;
2. `CASE-RECEIPT-002` — explicit and inferred fields, with labels only on inferred fields and a bounded Issue quick-option block;
3. `CASE-RECEIPT-004` — normal success without a duplicate “current-turn nutrition” section or post-progress advice;
4. `CASE-RECEIPT-005` — user-requested factual analysis before the final progress block, without medical or automatic health advice;
5. `CASE-RECEIPT-006` — one item, with a separate title and item line and no empty placeholders;
6. `CASE-PROGRESS-006` — one-date final progress from the same `EnvelopeFinalize`, with an equal single-day alias;
7. `CASE-STORAGE-006` — a lost response followed by another write; retry returns the original frozen multi-operation/cross-date result rather than current totals;
8. `CASE-EFFECT-003` — finalizer pending: a bounded pending message with no success title, success `ReceiptData`, progress block or terminal idempotency result.

`CASE-RECEIPT-001` and `CASE-EFFECT-003` already exist and remain byte-for-byte unchanged in `cases.json`. Add the other six ordered cases, advancing the cumulative case catalog from 20 to 26 cases. The golden manifest links all eight cases externally, so previous case values do not need renderer-specific fields.

## 4. Artifact architecture

Create `shared/acceptance-cases/golden-receipts/` with:

- `manifest.json` — one exact ordered catalog containing eight entries;
- `CASE-RECEIPT-001.txt`;
- `CASE-RECEIPT-002.txt`;
- `CASE-RECEIPT-004.txt`;
- `CASE-RECEIPT-005.txt`;
- `CASE-RECEIPT-006.txt`;
- `CASE-PROGRESS-006.txt`;
- `CASE-STORAGE-006.txt`;
- `CASE-EFFECT-003.txt`.

Every text asset must be UTF-8 without BOM, use LF only, contain no NUL or CR, and end with exactly one LF. Exact comparison includes Chinese text, Emoji, punctuation, spaces and blank lines.

The manifest entry shape is fixed and plain:

```text
fixture_id
case_id
mode
final_result
text_path
utf8_length
sha256
line_count
block_order
progress_dates
daily_progress_alias
required_literals
forbidden_literals
```

`mode` is one of `terminal_success`, `terminal_replay` or `effects_pending`. Paths are repository-relative tokens under the golden directory; live local paths are forbidden.

`final_result` is a frozen renderer input, not a computed expectation. It records only the already-authoritative status, `ReceiptData`, Issue/quick-option data and `daily_progress_by_date[]`/alias values needed by the future renderer. It does not contain database rows or ask the validator to recompute nutrition, inventory or progress.

## 5. Data flow and authority

The future harness flow is:

```text
case -> final_result fixture -> renderer -> actual UTF-8 text
                                      -> exact comparison with .txt asset
                                      -> structural/forbidden assertions
```

The renderer may only present the frozen final result. It must not query progress again, subtract old snapshots, calculate nutrition, change Issue state or rebuild an idempotent result from current data.

- One affected date requires `daily_progress_by_date[0]` and an exactly equal `daily_progress` alias.
- Multiple affected dates forbid the single-day alias and render date blocks in ascending order.
- `effects_pending` forbids all success receipt and progress fields.
- A terminal replay uses the originally frozen artifact even if the manifest also models a later unrelated write.

## 6. Text and structural rules

The validator must separately prove both exact text and semantic structure:

- title is one line;
- each dish, food or drink is one line;
- dish components remain on that dish line;
- only inferred fields carry estimate labels;
- actual inventory effects are not inferred from nutrition amounts;
- Issue options contain 2–4 entries, include a safe exit and end with the exact free-text sentence;
- requested factual analysis appears before progress;
- progress is the final block for successful receipts;
- six metrics keep the frozen order, two-line form, Emoji, units and 10-cell bar;
- no separate current-turn nutrition block, internal ID, post-progress evaluation, warning or suggestion;
- pending output contains no success title or progress;
- cross-date output contains one labeled block per date and no single-day alias.

The §18.8 multi-dish text in `CASE-RECEIPT-001.txt` is copied exactly from the approved receipt/date v2 contract, not regenerated from its structured values.

## 7. Case catalog changes

Advance `shared/acceptance-cases/cases.json` from `1.2.0` to `1.3.0` and append exactly six cases in this order:

1. `CASE-RECEIPT-002`
2. `CASE-RECEIPT-004`
3. `CASE-RECEIPT-005`
4. `CASE-RECEIPT-006`
5. `CASE-PROGRESS-006`
6. `CASE-STORAGE-006`

The existing 20 case JSON values and `package_invariants` remain unchanged. Each new case contains stable structural Oracle fields and forbidden outcomes. Exact prose remains solely in the golden directory.

The existing `core-v1.json` fixture catalog remains unchanged. Renderer-specific structured final results belong to `golden-receipts/manifest.json`, preventing a second copy in the general fixture catalog.

## 8. Validator and TDD design

Create `shared/tests/validate-golden-receipts.ps1`.

The validator must:

1. parse the cumulative case catalog and golden manifest as strict JSON;
2. require version `1.3.0`, exact ordered 26-case registration and exact eight-entry golden coverage;
3. prove the previous 20 case values remain unchanged;
4. require exact property shapes and valid case references;
5. read text bytes directly, reject BOM/CR/NUL or a missing/extra terminal LF, and recompute length/SHA-256/line count;
6. treat each text artifact as the fixture-owned exact expectation, while independently checking its manifest digest and structural/forbidden rules;
7. validate one-date alias equality, multi-date alias absence, replay freezing and pending-state absence rules;
8. run anti-weakening mutations through the real validation functions;
9. emit one stable machine-readable PASS line.

Update the prior three acceptance validators only enough to recognize the cumulative 26-case suffix and version `1.3.0`; their owned assertions and mutation counts remain unchanged.

At minimum, mutations must catch:

1. one changed text byte;
2. CRLF or BOM introduction;
3. a component split onto another line;
4. an estimate label added to an explicit field;
5. progress moved before analysis or Issue options;
6. text appended after progress;
7. an unsafe or missing quick-option exit;
8. a missing exact free-text final line;
9. progress rebuilt from a later total during replay;
10. a multi-date result with a single-day alias;
11. a missing or reordered cross-date block;
12. a success title or progress block exposed while `effects_pending`.

RED must be demonstrated before production test data/validator completion; GREEN must use the same real validator functions.

## 9. Failure, hygiene and model budget

- Validation is local and deterministic; routine iterations must not call OpenClaw or any model.
- OpenClaw is reserved for one final independent interaction review of the frozen public candidate, if needed for task evidence.
- A validator failure returns nonzero and identifies the case/artifact without rewriting any fixture.
- Tests create no database, business record, product root, network request or OpenClaw session.
- Do not read, hash, edit, track or execute the five protected domain lease files.
- Repository artifacts must contain no secrets, live tokens or machine-specific absolute paths.

## 10. Expected repository changes

Create:

- `shared/acceptance-cases/golden-receipts/manifest.json`
- eight exact `.txt` assets listed in §4
- `shared/tests/validate-golden-receipts.ps1`
- normal `SH-CASE-004` brief/report/review/evidence documents after their respective gates

Modify:

- `shared/acceptance-cases/cases.json`
- the existing core/domain/ops acceptance validators for cumulative registration only
- `docs/开发进度.md`
- `总功能开发计划0.3.md`

Do not modify production storage, renderer/adapter implementations, OpenClaw configuration or protected lease files.

## 11. Completion and reopen conditions

Completion requires focused RED then GREEN, all mutations rejected, prior acceptance/contract regressions green, strict byte and JSON checks, zero protected-file delta, zero secret/local-path leakage, zero temporary/business residual, and an independent review with no P0/P1 findings.

This closes only the golden Oracle task. It does not prove that the Skill can yet execute a real record, persist SQLite data or install in OpenClaw.

Reopen `SH-CASE-004` if any selected case semantics, receipt/date or Issue/correction contract, progress formatting, evidence-label wording, quick-option wording, idempotent replay semantics or pending-state display boundary changes.
