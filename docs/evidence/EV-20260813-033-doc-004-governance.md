# EV-20260813-033 — DOC-004 Governance and Approval Closure

## Identity and result

- `evidence_id`: `EV-20260813-033`
- `evidence_type`: `E-DOC`
- `started_at`: `2026-08-13T02:46:52.4631038+08:00`
- `finished_at`: `2026-08-13T02:46:53.1303051+08:00`
- `executor`: Codex `/root`
- `task_ids`: [`DOC-004-001`, `DOC-004-002`]
- `requirement_ids`: `[]` (governance task)
- `case_ids`: `[]` (governance task)
- `decision_ids`: [`DEC-002`, `DEC-020`, `DEC-029`]
- `risk_ids`: [`RISK-001`, `RISK-010`]
- `change_ids`: [`CHG-20260813-001`]
- `result`: `PASS — document structure and recorded user approval closure only`
- `governance implementation commits`: `5104bac56b5c3dcc1144975d76376dca55dd39fd`, `ae212070246736c87915abe1d12887d841230964`

## Environment and immutable inputs

The rerun used `Microsoft Windows 11 家庭版`, version `10.0.26200`, build `26200`; Windows PowerShell `5.1.26100.8875`; and `git version 2.53.0.windows.3` in `E:\codx\skill\.worktrees\diet-manager-b-b-slice-001`.

| Input path | Bytes | SHA-256 | Role |
|---|---:|---|---|
| `总功能开发计划0.3.md` | 298059 | `9914C27DD653AF757DDF58FAC3273C11E91AAC7C9D5D1D95583FF27CDACC8C79` | frozen historical baseline |
| `总功能开发计划0.4.md` | 319869 | `BD9509CF12C54E9B3252C913D90407B3475C0F4E025F38C0C78254736D02C1BA` | current authority under check |
| `docs/work-items/DOC-004-approval.md` | 1261 | `35C17777022E11F50FB5AE8A34477ED655267CD562511F52DEEE2373556D6239` | recorded user approval |
| `.superpowers/sdd/2026-08-13-product-0.1-usable-skill/task-1-brief.md` | 3019 | `B2A991E945B6B33286F98B8E81F8A2A33D7C1C6367248AC30AB8DEED73A1E937` | governing task brief |

The EV file is not listed as an input identity because it is the evidence artifact being finalized. The plan is not modified by this evidence-only remediation; therefore its checked hash is non-self-referential. No credentials, secrets, API keys, tokens, cookies, authenticated URLs, external services, model calls, or external facts were used.

## Commands actually rerun

The following PowerShell command was run read-only at the stated start and finish times. Its complete concise output follows; every subcheck and `git diff --check` exited `0`.

```powershell
$started=(Get-Date).ToString('o'); $os=Get-CimInstance Win32_OperatingSystem; "STARTED_AT=$started"; "ENV|OS=$($os.Caption)|VERSION=$($os.Version)|BUILD=$($os.BuildNumber)|POWERSHELL=$($PSVersionTable.PSVersion.ToString())"; "ENV|GIT=$((git --version))"; $p='总功能开发计划0.4.md'; $lines=Get-Content -Encoding UTF8 $p; $taskRows=$lines | Where-Object { $_ -match '^\| `(A|B|C|DOC|SH|X-GATE|SEL)-[A-Z0-9-]+` \|' -and $_ -match '\| (未开始|进行中|阻塞|已完成|已取消) \|' }; "CHECK1|EXIT=0|REQ=$((Select-String -Path $p -Pattern '`REQ-[A-Z0-9-]+`' -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique).Count)|CASE=$((Select-String -Path $p -Pattern '`CASE-[A-Z0-9-]+`' -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique).Count)|TASK=$($taskRows.Count)"; $status=($taskRows | ForEach-Object { if ($_ -match '\| (未开始|进行中|阻塞|已完成|已取消) \|') { $matches[1] } } | Group-Object | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ','; $wip=($taskRows | Where-Object { $_ -match '\| 进行中 \|' } | ForEach-Object { if ($_ -match '^\| `([^`]+)`') { $matches[1] } }) -join ','; "CHECK2|EXIT=0|STATUS=$status|WIP=$wip"; $p03=Get-Item -LiteralPath '总功能开发计划0.3.md'; $p04=Get-Item -LiteralPath $p; $approval=Get-Item -LiteralPath 'docs\work-items\DOC-004-approval.md'; "CHECK3|EXIT=0|DOC03_BYTES=$($p03.Length)|DOC03_SHA=$((Get-FileHash -Algorithm SHA256 -LiteralPath $p03.FullName).Hash)|DOC04_BYTES=$($p04.Length)|DOC04_SHA=$((Get-FileHash -Algorithm SHA256 -LiteralPath $p04.FullName).Hash)|APPROVAL_BYTES=$($approval.Length)|APPROVAL_SHA=$((Get-FileHash -Algorithm SHA256 -LiteralPath $approval.FullName).Hash)"; "CHECK4|EXIT=0|X_GATE_DEP=$((Select-String -Path $p -Pattern '^\| `X-GATE-002`.*`SH-TRACE-001`' -Encoding UTF8).Count)|STALE_TRACE_ROWS=$((Select-String -Path $p -Pattern '^\| `shared/traceability/(requirements|tasks|decisions|evidence-index)\.json`.*已存在：DOC-0\.3陈旧镜像' -Encoding UTF8).Count)|DEC020_50_50=$((Select-String -Path $p -Pattern '^\| `DEC-020`.*50/50' -Encoding UTF8).Count)|RISK001_50_50=$((Select-String -Path $p -Pattern '^\| `RISK-001`.*50/50' -Encoding UTF8).Count)|RISK010_OPEN=$((Select-String -Path $p -Pattern '^\| `RISK-010`.*`open`' -Encoding UTF8).Count)"; git diff --check; "CHECK5|EXIT=$LASTEXITCODE|GIT_DIFF_CHECK=PASS"; "CHECK6|EXIT=0|HEAD=$(git rev-parse HEAD)|STATUS=$(git status --short | Out-String -Width 1000 | ForEach-Object { $_.Trim() })"; "FINISHED_AT=$((Get-Date).ToString('o'))"
```

```text
STARTED_AT=2026-08-13T02:46:52.4631038+08:00
ENV|OS=Microsoft Windows 11 家庭版|VERSION=10.0.26200|BUILD=26200|POWERSHELL=5.1.26100.8875
ENV|GIT=git version 2.53.0.windows.3
CHECK1|EXIT=0|REQ=74|CASE=153|TASK=63
CHECK2|EXIT=0|STATUS=进行中=1,未开始=27,已取消=8,已完成=27|WIP=SH-TRACE-001
CHECK3|EXIT=0|DOC03_BYTES=298059|DOC03_SHA=9914C27DD653AF757DDF58FAC3273C11E91AAC7C9D5D1D95583FF27CDACC8C79|DOC04_BYTES=319869|DOC04_SHA=BD9509CF12C54E9B3252C913D90407B3475C0F4E025F38C0C78254736D02C1BA|APPROVAL_BYTES=1261|APPROVAL_SHA=35C17777022E11F50FB5AE8A34477ED655267CD562511F52DEEE2373556D6239
CHECK4|EXIT=0|X_GATE_DEP=1|STALE_TRACE_ROWS=4|DEC020_50_50=1|RISK001_50_50=1|RISK010_OPEN=1
CHECK5|EXIT=0|GIT_DIFF_CHECK=PASS
CHECK6|EXIT=0|HEAD=ae212070246736c87915abe1d12887d841230964|STATUS=
FINISHED_AT=2026-08-13T02:46:53.1303051+08:00
```

## Data, cleanup, and product boundary

- `official_data_roots`: N/A — documentation-only checks did not open, create, or modify product data roots.
- `isolated_test_roots`: N/A — no test harness or temporary root was required for text, hash, and Git-diff checks.
- `before/after manifests`: N/A — no business-data or auxiliary-file operation occurred; the only tracked change under this evidence run is this E-DOC artifact.
- `cleanup`: N/A — no temporary directory, process, environment variable, database, WAL/SHM/journal, or test-owned file was created.
- `business impact`: zero — no JSONL, SQLite, trace JSON, product code, migration, manifest, release file, network request, or model call was created, changed, read as validation input, or executed.
- `external facts`: N/A — the user approval is an in-thread authorization recorded locally, not an externally fetched fact.

## Review chronology and pending state

1. The original Task 1 governance commit `5104bac...` received a review finding that the approval wording narrowed continuing authorization and that completed DOC rows lacked actual EV references.
2. Remediation commit `ae21207...` corrected the approval wording, added this EV, and updated the two task rows; a subsequent reviewer returned `Ready=NO` because the first EV draft lacked mandatory §28.1 metadata and the ignored review artifacts were stale.
3. This evidence-only remediation supplies the missing fields and records the exact rerun above. Final independent rereview is **pending**. No `Ready=YES`, independent-review PASS, trace regeneration, or product readiness claim is made by this EV.

## Scope limitation

This E-DOC closes only the documented DOC-004 structure and recorded user approval. It does not regenerate trace JSON, close `SH-TRACE-001`, start or pass `X-GATE-002`, create `selected-route-map.json`, implement product functionality, or establish installation or release readiness.
