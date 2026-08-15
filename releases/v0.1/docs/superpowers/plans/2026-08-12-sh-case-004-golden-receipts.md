# SH-CASE-004 Golden Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze eight exact Chinese golden-receipt artifacts, append the six missing acceptance cases, and validate exact bytes plus receipt/progress semantics locally without implementing a renderer or database.

**Architecture:** Keep structured renderer inputs and artifact metadata in one ordered `manifest.json`, while each expected receipt remains a separate UTF-8/LF text asset. A focused PowerShell 5.1 validator treats the text files as the independent golden Oracle, checks semantic structure separately, and runs mutations through the same validation functions; prior validators only learn the cumulative case suffix/version.

**Tech Stack:** JSON, UTF-8 text fixtures, Windows PowerShell 5.1, Git.

**Execution status:** Completed on 2026-08-12. Reviewed public candidate `072c1fb9ed4242a39b7b1aeaf1c134d5d1c33508` passed with `P0=0/P1=0/P2=2`; closure evidence is `EV-20260812-024`. The unchecked boxes below remain the original executable instructions, not outstanding work.

## Global Constraints

- Work only on branch `agent/sh-case-004-golden-receipts`, based on completed `SH-CASE-003` commit `b07df0461379f8998c14344e4d7e0087302665e7`.
- Do not read, hash, edit, track or execute the five protected domain lease files named in project instructions.
- Do not create SQLite, business records, renderer/adapter code, OpenClaw/MCP configuration or network requests.
- Preserve the existing 20 case JSON values and all `core-v1.json` fixture bytes exactly.
- Golden text is UTF-8 without BOM, LF only, no CR/NUL, with exactly one terminal LF.
- Routine RED/GREEN and regression work is local. Use at most one OpenClaw interaction review after the public candidate is frozen.
- Exact comparison includes Chinese text, Emoji, punctuation, spaces, blank lines and line order.
- Use `apply_patch` for repository edits and run all PowerShell validation with `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`.

## File map

- `shared/acceptance-cases/golden-receipts/manifest.json`: eight ordered structured final-result fixtures and immutable text metadata.
- `shared/acceptance-cases/golden-receipts/*.txt`: eight independent exact expected outputs.
- `shared/acceptance-cases/cases.json`: cumulative 26-case registry; append six cases only.
- `shared/tests/validate-golden-receipts.ps1`: all focused byte, structure, semantic and mutation validation.
- `shared/tests/validate-core-acceptance-cases.ps1`: cumulative version/ID compatibility only.
- `shared/tests/validate-domain-acceptance-cases.ps1`: cumulative version/ID compatibility only.
- `shared/tests/validate-ops-security-acceptance-cases.ps1`: cumulative version/ID compatibility only.
- `docs/work-items/SH-CASE-004-brief.md`: frozen scope and case/assertion-path ownership.
- `docs/work-items/SH-CASE-004-report.md`: implementation and local verification facts.
- `docs/work-items/SH-CASE-004-review-package.md`: independent reviewer instructions.
- `docs/work-items/SH-CASE-004-review.md`: review result, created only after review.
- `docs/evidence/EV-20260812-024-sh-case-004.md`: closure evidence, created only after all gates pass.
- `docs/开发进度.md` and `总功能开发计划0.3.md`: status/count/next-action updates only after completion.

---

### Task 1: Freeze the golden asset package and byte validator

**Files:**
- Create: `shared/tests/validate-golden-receipts.ps1`
- Create: `shared/acceptance-cases/golden-receipts/manifest.json`
- Create: eight `shared/acceptance-cases/golden-receipts/CASE-*.txt` files from the design
- Create: `docs/work-items/SH-CASE-004-brief.md`

**Interfaces:**
- Consumes: design `docs/superpowers/specs/2026-08-12-sh-case-004-golden-receipts-design.md`, `cases.json`, receipt/date v2 and Issue/correction v2 contracts.
- Produces: `Read-GoldenJson(Path, MissingCode)`, `Read-GoldenTextAsset(Path, Entry)`, `Assert-GoldenCatalogCandidate(Catalog, Root)`, and `Test-GoldenAssetPackage(CatalogPath, Root)`.

- [ ] **Step 1: Write the failing asset test**

Create the validator with fixed expected case order and a missing-manifest RED:

```powershell
param(
    [string]$SharedRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$LibraryOnly
)

$script:ExpectedGoldenCaseIds = @(
    'CASE-RECEIPT-001','CASE-RECEIPT-002','CASE-RECEIPT-004','CASE-RECEIPT-005',
    'CASE-RECEIPT-006','CASE-PROGRESS-006','CASE-STORAGE-006','CASE-EFFECT-003'
)

function Assert-GoldenTrue([bool]$Condition, [string]$Code) {
    if (-not $Condition) { throw $Code }
}

function Test-GoldenAssetPackage([string]$CatalogPath, [string]$Root) {
    Assert-GoldenTrue ([IO.File]::Exists($CatalogPath)) 'GOLDEN_MANIFEST_MISSING'
}

if (-not $LibraryOnly) {
    Test-GoldenAssetPackage (Join-Path $SharedRoot 'acceptance-cases\golden-receipts\manifest.json') $SharedRoot
}
```

- [ ] **Step 2: Run the focused RED**

Run:

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File 'shared\tests\validate-golden-receipts.ps1'
```

Expected: nonzero with exact prefix `GOLDEN_MANIFEST_MISSING`.

- [ ] **Step 3: Add the manifest and eight independent text assets**

The manifest root must have exactly:

```json
{
  "golden_catalog_id": "diet-manager/golden-receipts-v1",
  "version": "1.0.0",
  "encoding": "utf-8",
  "newline": "lf",
  "terminal_newline": true,
  "entries": []
}
```

Populate `entries` in the fixed case order. Each entry must have exactly:

```text
fixture_id, case_id, mode, final_result, text_path, utf8_length, sha256,
line_count, block_order, progress_dates, daily_progress_alias,
required_literals, forbidden_literals
```

Use these mode/alias assignments:

```text
CASE-RECEIPT-001  terminal_success  required_equal_single
CASE-RECEIPT-002  terminal_success  required_equal_single
CASE-RECEIPT-004  terminal_success  required_equal_single
CASE-RECEIPT-005  terminal_success  required_equal_single
CASE-RECEIPT-006  terminal_success  required_equal_single
CASE-PROGRESS-006 terminal_success  required_equal_single
CASE-STORAGE-006  terminal_replay   forbidden_multi
CASE-EFFECT-003   effects_pending   forbidden_pending
```

Copy `CASE-RECEIPT-001.txt` exactly from receipt/date v2 §4.2. Author the other seven files according to design §§3 and 6. `CASE-STORAGE-006.txt` must describe one envelope that records an 8号 meal item and 9号 plain water, then render ordered `8号更新后` and `9号更新后` six-metric blocks. `CASE-EFFECT-003.txt` must be exactly one bounded pending paragraph and contain neither `已记录` nor any progress Emoji.

After each text file is fixed, calculate `utf8_length`, uppercase SHA-256 and logical line count from its bytes and write those values into its manifest entry. Do not generate the text from `final_result`.

- [ ] **Step 4: Implement strict asset validation**

Start with these complete primitives, then have `Assert-GoldenCatalogCandidate` call them for every fixed entry:

```powershell
function Read-GoldenJson([string]$Path, [string]$MissingCode) {
    Assert-GoldenTrue ([IO.File]::Exists($Path)) $MissingCode
    try { return ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json) }
    catch { throw ('GOLDEN_JSON_INVALID:{0}' -f $_.Exception.Message) }
}

function Assert-GoldenPlainObject($Value, [string]$Code) {
    Assert-GoldenTrue ($null -ne $Value) $Code
    Assert-GoldenTrue (-not ($Value -is [Array])) $Code
    Assert-GoldenTrue (-not ($Value -is [string])) $Code
    Assert-GoldenTrue ($Value -is [psobject]) $Code
}

function Assert-GoldenExactProperties($Value, [string[]]$Expected, [string]$Code) {
    Assert-GoldenPlainObject $Value $Code
    $actual = @($Value.PSObject.Properties.Name)
    Assert-GoldenTrue ($actual.Count -eq $Expected.Count) ("${Code}:property_count")
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-GoldenTrue ($actual[$index] -ceq $Expected[$index]) ("${Code}:property_${index}")
        Assert-GoldenTrue ($Value.PSObject.Properties[$actual[$index]].MemberType -eq 'NoteProperty') ("${Code}:member_${index}")
    }
}

function Assert-GoldenExactStringArray([string[]]$Expected, $Actual, [string]$Code) {
    Assert-GoldenTrue ($Actual -is [Array]) ("${Code}:array")
    $values = @($Actual)
    Assert-GoldenTrue ($values.Count -eq $Expected.Count) ("${Code}:count")
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-GoldenTrue ($values[$index] -is [string]) ("${Code}:type_${index}")
        Assert-GoldenTrue ([string]$values[$index] -ceq $Expected[$index]) ("${Code}:value_${index}")
    }
}

function Get-GoldenSha256([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Read-GoldenTextAsset([string]$Path, $Entry) {
    Assert-GoldenTrue ([IO.File]::Exists($Path)) ('GOLDEN_TEXT_MISSING:{0}' -f $Entry.case_id)
    $bytes = [IO.File]::ReadAllBytes($Path)
    Assert-GoldenTrue ($bytes.Count -gt 0) ('GOLDEN_TEXT_EMPTY:{0}' -f $Entry.case_id)
    Assert-GoldenTrue (-not ($bytes.Count -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)) ('GOLDEN_TEXT_BOM:{0}' -f $Entry.case_id)
    Assert-GoldenTrue (-not ($bytes -contains 13)) ('GOLDEN_TEXT_CR:{0}' -f $Entry.case_id)
    Assert-GoldenTrue (-not ($bytes -contains 0)) ('GOLDEN_TEXT_NUL:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ($bytes[$bytes.Count - 1] -eq 10) ('GOLDEN_TEXT_TERMINAL_LF:{0}' -f $Entry.case_id)
    if ($bytes.Count -gt 1) {
        Assert-GoldenTrue ($bytes[$bytes.Count - 2] -ne 10) ('GOLDEN_TEXT_EXTRA_TERMINAL_LF:{0}' -f $Entry.case_id)
    }
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    try { $text = $utf8.GetString($bytes) }
    catch { throw ('GOLDEN_TEXT_UTF8:{0}' -f $Entry.case_id) }
    Assert-GoldenTrue ($bytes.Count -eq [int]$Entry.utf8_length) ('GOLDEN_TEXT_LENGTH:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ((Get-GoldenSha256 $bytes) -ceq [string]$Entry.sha256) ('GOLDEN_TEXT_SHA256:{0}' -f $Entry.case_id)
    $withoutTerminalLf = $text.Substring(0, $text.Length - 1)
    $lines = @($withoutTerminalLf -split "`n", -1)
    Assert-GoldenTrue ($lines.Count -eq [int]$Entry.line_count) ('GOLDEN_TEXT_LINE_COUNT:{0}' -f $Entry.case_id)
    return [pscustomobject][ordered]@{ bytes = $bytes; text = $text; lines = $lines }
}
```

`Assert-GoldenCatalogCandidate` must require exact root and entry properties from Task 1 Step 3, exact ID/mode order, uppercase 64-character SHA-256, positive length/line count, unique fixture IDs and case-insensitive unique paths, then call `Read-GoldenTextAsset` for each entry.

`Read-GoldenTextAsset` must read bytes with `[IO.File]::ReadAllBytes`, reject BOM/CR/NUL, require the last byte to be LF and the previous byte not LF, decode with strict `UTF8Encoding($false,$true)`, recompute byte length/SHA-256/line count, and return a plain object `{ bytes, text, lines }`.

Path validation must require a single repository-relative path under `shared/acceptance-cases/golden-receipts/`, reject rooted paths, `..`, alternate separators outside the fixed convention and duplicate paths case-insensitively.

- [ ] **Step 5: Run asset GREEN and byte mutations**

Run the focused validator. Then use in-memory or test-owned temporary copies to prove rejection of one byte change, BOM, CRLF, NUL and extra/missing terminal LF. Never mutate the repository fixture in place.

Expected PASS suffix:

```text
GOLDEN_RECEIPT_ASSETS|PASS|version=1.0.0|entries=8
```

- [ ] **Step 6: Commit the asset package**

```powershell
git add -- 'shared/acceptance-cases/golden-receipts' 'shared/tests/validate-golden-receipts.ps1' 'docs/work-items/SH-CASE-004-brief.md'
git diff --cached --check
git commit -m 'test: freeze SH-CASE-004 golden receipt assets'
```

---

### Task 2: Append the six missing cases and validate renderer semantics

**Files:**
- Modify: `shared/acceptance-cases/cases.json`
- Modify: `shared/tests/validate-golden-receipts.ps1`

**Interfaces:**
- Consumes: Task 1 catalog and `Read-GoldenTextAsset` result.
- Produces: `Assert-GoldenCaseCatalogCandidate(CaseSet)`, `Assert-GoldenEntrySemantics(Entry, Asset)`, and `Test-GoldenReceiptsCandidate(CaseSet, Catalog, Root)`.

- [ ] **Step 1: Extend the validator first and capture the cumulative RED**

Add the fixed ordered 26-ID list: the existing 20 IDs followed by:

```text
CASE-RECEIPT-002
CASE-RECEIPT-004
CASE-RECEIPT-005
CASE-RECEIPT-006
CASE-PROGRESS-006
CASE-STORAGE-006
```

Require `cases.json.version == 1.3.0` and exact ID equality. Run the validator.

Expected: nonzero `GOLDEN_CASE_SET_VERSION_INVALID` before any missing-case error.

- [ ] **Step 2: Append six case objects without changing the first 20 values**

Set only the root version to `1.3.0`, then append six objects with the existing seven-property case shape:

```text
id, requirement_ids, stage, source_text, setup, oracle, forbidden
```

Required responsibility map:

```text
CASE-RECEIPT-002 -> REQ-RECEIPT-002, REQ-CORE-002, REQ-QUICK-001
CASE-RECEIPT-004 -> REQ-RECEIPT-002, REQ-RECEIPT-003
CASE-RECEIPT-005 -> REQ-RECEIPT-003, REQ-SCOPE-002
CASE-RECEIPT-006 -> REQ-RECEIPT-001
CASE-PROGRESS-006 -> REQ-PROGRESS-002
CASE-STORAGE-006 -> REQ-PROGRESS-002, REQ-PROGRESS-004, REQ-SAFE-003
```

All six are `PRODUCT-0.1`, use `env-zh-cn-20260811`, and reference only existing goal/query fixtures or null. Their Oracle fields must describe structure/authority/replay semantics and must not embed exact receipt prose.

- [ ] **Step 3: Implement semantic checks independent of exact bytes**

Add these exact helper signatures and keep each helper responsible for only the named rule set:

```powershell
function Assert-GoldenProgressBlock($Progress, [string]$Code)
function Assert-GoldenQuickOptions($Entry, [string[]]$Lines)
function Assert-GoldenSingleDayAlias($Entry)
function Assert-GoldenCrossDayResult($Entry, [string[]]$Lines)
function Assert-GoldenPendingResult($Entry, [string]$Text)
function Assert-GoldenReplayResult($Entry)
function Assert-GoldenEntrySemantics($Entry, $Asset)
```

Implement each function as a validator that returns no value and throws a stable `GOLDEN_*` code on the first failed invariant. Do not have any helper render or repair text.

Prove:

- all terminal-success entries have six metrics in fixed order and a field-equal single-day alias;
- the Issue entry has 2–4 options, a safe exit, and exact final free-text line before progress;
- only inferred fields use estimate wording;
- requested analysis occurs before progress and contains no diagnosis/advice;
- progress is the last block and nothing follows its final line;
- `terminal_replay` has two sorted dates, no single alias, an original frozen result, a later unrelated write and a retry result equal to the original rather than later totals;
- `effects_pending` has no `ReceiptData`, progress collection, alias, terminal result or success wording.

- [ ] **Step 4: Prove previous case bytes are unchanged**

Before editing, store the canonical compressed UTF-8 Base64 or uppercase SHA-256 of each of the first 20 plain JSON case values in the focused validator. After the append, recompute each value using the same deterministic PowerShell JSON clone path and compare all 20 independent literals.

Do not hash or access any protected file.

- [ ] **Step 5: Run focused GREEN**

Expected final line:

```text
GOLDEN_RECEIPTS|PASS|case_version=1.3.0|cases=8|assets=8
```

- [ ] **Step 6: Commit cases and semantics**

```powershell
git add -- 'shared/acceptance-cases/cases.json' 'shared/tests/validate-golden-receipts.ps1'
git diff --cached --check
git commit -m 'test: add SH-CASE-004 receipt semantics'
```

---

### Task 3: Add the anti-weakening suite and cumulative regressions

**Files:**
- Modify: `shared/tests/validate-golden-receipts.ps1`
- Modify: `shared/tests/validate-core-acceptance-cases.ps1`
- Modify: `shared/tests/validate-domain-acceptance-cases.ps1`
- Modify: `shared/tests/validate-ops-security-acceptance-cases.ps1`

**Interfaces:**
- Consumes: `Test-GoldenReceiptsCandidate` from Task 2.
- Produces: `Copy-GoldenJson(Value)`, `Invoke-GoldenMutation(Name, ExpectedPrefix, Mutator)`, stable 12-mutation output and cumulative version compatibility.

- [ ] **Step 1: Write mutation cases against the real candidate validator**

Use plain JSON clones and test-owned temporary text copies. Add exactly these mutation IDs:

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

Each mutation passes only when the real validator rejects the intended defect with its stable expected prefix.

- [ ] **Step 2: Run mutations RED then GREEN**

Temporarily omit one semantic guard at a time only in the local working edit, confirm its matching mutation reports `MUTATION_SURVIVED`, restore the guard, and confirm all 12 mutation lines PASS. Do not commit a deliberately weakened state.

- [ ] **Step 3: Update cumulative validators minimally**

In all three previous acceptance validators:

- change only the case catalog expectation from `1.2.0` to `1.3.0`;
- append the six fixed IDs to cumulative ID arrays;
- update PASS-line catalog version to `1.3.0`;
- leave `core-v1.json` fixture version at `1.2.0`;
- leave each validator's owned cases, scenarios and mutation counts unchanged.

- [ ] **Step 4: Run four acceptance validators**

Run `validate-golden-receipts.ps1`, then core, domain and ops/security acceptance validators under WinPS5.1.

Expected: all exit 0; owned counts remain `5/9/6`, golden count is `8`, mutations are `8/11/12/12` respectively.

- [ ] **Step 5: Commit mutation and cumulative compatibility**

```powershell
git add -- 'shared/tests/validate-golden-receipts.ps1' 'shared/tests/validate-core-acceptance-cases.ps1' 'shared/tests/validate-domain-acceptance-cases.ps1' 'shared/tests/validate-ops-security-acceptance-cases.ps1'
git diff --cached --check
git commit -m 'test: harden SH-CASE-004 golden receipt oracle'
```

---

### Task 4: Verify, document and prepare one independent review

**Files:**
- Create: `docs/work-items/SH-CASE-004-report.md`
- Create: `docs/work-items/SH-CASE-004-review-package.md`
- Modify after review: `docs/work-items/SH-CASE-004-review.md`
- Modify after review: `docs/evidence/EV-20260812-024-sh-case-004.md`
- Modify after review: `docs/开发进度.md`
- Modify after review: `总功能开发计划0.3.md`

**Interfaces:**
- Consumes: frozen branch SHA and raw local validator outputs.
- Produces: review package, evidence record, accurate Plan 0.3 status and next task `SH-HARNESS-001`.

- [ ] **Step 1: Run the allowed local regression set**

Run the new validator, the three acceptance validators and the relevant public contract/model validators that do not access protected files. Explicitly list every command and output in the report. Never use a broad test command that may execute a protected validator.

- [ ] **Step 2: Run repository hygiene gates**

Check Parser=0 for changed PowerShell, JSON parse for changed JSON, UTF-8/BOM/CR/NUL rules for golden assets, `git diff --check`, changed-file list, secret/token patterns, machine-path patterns, and zero temporary/business candidate residual.

Check protected scope only by comparing changed path names against the five forbidden paths; do not read or hash those files.

- [ ] **Step 3: Write report and review package, then commit**

The report must distinguish:

```text
Golden Oracle complete != renderer implemented
Golden Oracle complete != SQLite implemented
Golden Oracle complete != Skill installable
```

The review package asks for exact byte/structure/authority/replay/pending checks and an independently written checker. It must not include intended answers beyond the raw artifacts and normative contract references.

Commit:

```powershell
git add -- 'docs/work-items/SH-CASE-004-report.md' 'docs/work-items/SH-CASE-004-review-package.md'
git diff --cached --check
git commit -m 'docs: prepare SH-CASE-004 review'
```

- [ ] **Step 4: Freeze and publish the review candidate**

Re-run the local gates, record the exact candidate SHA, push the branch and create or update a stacked draft PR whose base is the published `SH-CASE-003` branch until that branch merges.

- [ ] **Step 5: Use at most one independent OpenClaw review**

Provide only the public repository/branch, frozen SHA, review package and normative public files. Require a machine-readable `P0/P1/P2` conclusion and cleanup of the isolated clone. Do not ask the model to reimplement the task.

- [ ] **Step 6: Close evidence and progress only after PASS**

If P0/P1 is nonzero, fix locally, rerun deterministic validation and use a narrow review follow-up only when genuinely required. After P0=0/P1=0:

- create `SH-CASE-004-review.md` and `EV-20260812-024-sh-case-004.md`;
- mark `SH-CASE-004` completed in Plan 0.3;
- update completed/not-started counts and `docs/开发进度.md`;
- set the next WIP to `SH-HARNESS-001` without claiming product installability;
- commit, push and verify local/remote/PR head equality.

- [ ] **Step 7: Final verification**

Re-run the four acceptance validators and all hygiene gates from the final commit. Require a clean worktree and report the final SHA, exact PASS counts, review conclusion, protected delta zero, residual zero and public PR URL.
