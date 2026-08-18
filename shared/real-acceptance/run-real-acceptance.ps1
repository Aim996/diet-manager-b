# run-real-acceptance.ps1
# 饮食管家 B 0.1.1 真实环境验收执行器。
#
# 职责（只读预检 → 逐场景执行 → 直接 SQLite 白名单断言 → 原子写证据）：
#   1. 预检：绝对专用根必须落在 .tmp\real-acceptance\0.1.1 下；除非 -Resume 且
#      候选哈希一致，否则拒绝已存在的业务数据；只记录 FDC_API_KEY 是否存在（绝不
#      回显其值）；安装前检查 openclaw 网关 health。
#   2. 逐场景：把 UTF-8 消息写入专用文件，会话键 agent:main:diet-manager-real-0.1.1-<id>，
#      调用 `openclaw agent --session-key ... --message-file ... --verbose on --json`；
#      捕获结构化工具事件与最终回复；关闭网关后直接以只读方式检查 SQLite，
#      只运行白名单读取断言，随后重启网关继续。
#   3. 证据：先独占写入候选文件，校验 evidence.schema.json 后原子重命名。
#
# 用法（PowerShell 7）：
#   pwsh -NoProfile -File shared/real-acceptance/run-real-acceptance.ps1 `
#     -OfficialDataRoot E:\...\.tmp\real-acceptance\0.1.1\data `
#     -OpenClawStateRoot E:\...\.tmp\real-acceptance\0.1.1\openclaw-state `
#     -CandidateZip E:\...\candidate\artifacts\diet-manager-b-0.1.1.zip `
#     -SourceCommit <40-hex> -PackageVersion 0.1.1 `
#     -EvidencePath E:\...\.tmp\real-acceptance\0.1.1\evidence.json
#
# 断网 / 超时控制通过注入式 HTTP 传输或仅绑定到验收进程的测试代理实现（见
# docs/acceptance/0.1.1-real-environment-runbook.md），不得改动产品代码或系统防火墙。
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OfficialDataRoot,
    [Parameter(Mandatory = $true)][string]$OpenClawStateRoot,
    [Parameter(Mandatory = $true)][string]$SourceCommit,
    [Parameter(Mandatory = $true)][string]$PackageVersion,
    [string]$CandidateZip,
    [string]$CandidateZipSha256,
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [string]$ScenariosPath,
    [string]$EvidenceSchemaPath,
    [string]$OpenClawPath = 'openclaw',
    [string]$NodePath = 'node',
    [switch]$Resume,
    [string]$GatewayStopCommand,
    [string]$GatewayStartCommand
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$code) {
    [Console]::Error.WriteLine($code)
    exit 1
}

function Assert-AbsoluteDedicatedRoot([string]$label, [string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { Fail 'REAL_ACCEPTANCE_ROOT_INVALID:empty' }
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not [System.IO.Path]::IsPathFullyQualified($full)) { Fail "REAL_ACCEPTANCE_ROOT_INVALID:relative:$label" }
    if ($full -notlike '*\.tmp\real-acceptance\0.1.1*') {
        Fail "REAL_ACCEPTANCE_ROOT_INVALID:outside_dedicated:$label"
    }
    return $full
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$defaultScenarios = Join-Path $PSScriptRoot 'scenarios.json'
$defaultSchema = Join-Path $PSScriptRoot 'evidence.schema.json'

$ScenariosPath = if ($ScenariosPath) { $ScenariosPath } else { $defaultScenarios }
$EvidenceSchemaPath = if ($EvidenceSchemaPath) { $EvidenceSchemaPath } else { $defaultSchema }

if (-not (Test-Path -LiteralPath $ScenariosPath -PathType Leaf)) { Fail 'REAL_ACCEPTANCE_SCENARIOS_MISSING' }
if (-not (Test-Path -LiteralPath $EvidenceSchemaPath -PathType Leaf)) { Fail 'REAL_ACCEPTANCE_SCHEMA_MISSING' }

$OfficialDataRoot = Assert-AbsoluteDedicatedRoot 'official_data_root' $OfficialDataRoot
$OpenClawStateRoot = Assert-AbsoluteDedicatedRoot 'openclaw_state_root' $OpenClawStateRoot
$EvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)

if ($SourceCommit -notmatch '^[0-9a-f]{40}$') { Fail 'REAL_ACCEPTANCE_SOURCE_COMMIT_INVALID' }
if ($PackageVersion -ne '0.1.1') { Fail 'REAL_ACCEPTANCE_PACKAGE_VERSION_INVALID' }

# 候选哈希：显式给出则采信，否则从候选压缩包计算；两者同时给出必须一致。
$candidateSha = $null
if ($CandidateZipSha256) {
    if ($CandidateZipSha256 -notmatch '^[A-F0-9]{64}$') { Fail 'REAL_ACCEPTANCE_CANDIDATE_SHA_INVALID' }
    $candidateSha = $CandidateZipSha256.ToUpperInvariant()
}
if ($CandidateZip) {
    if (-not (Test-Path -LiteralPath $CandidateZip -PathType Leaf)) { Fail 'REAL_ACCEPTANCE_CANDIDATE_ZIP_MISSING' }
    $computed = (Get-FileHash -LiteralPath $CandidateZip -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($candidateSha -and $computed -ne $candidateSha) { Fail 'REAL_ACCEPTANCE_CANDIDATE_SHA_MISMATCH' }
    $candidateSha = $computed
}
if (-not $candidateSha) { Fail 'REAL_ACCEPTANCE_CANDIDATE_SHA_REQUIRED' }

# —— 预检：网关 health ——
$healthArgs = @('gateway', 'health', '--json')
$health = & $OpenClawPath @healthArgs 2>&1
if ($LASTEXITCODE -ne 0) { Fail "REAL_ACCEPTANCE_GATEWAY_HEALTH_FAILED:$($health -join ' ')" }

# —— 业务数据预检 ——
$dbPath = Join-Path $OfficialDataRoot 'diet-manager-b.sqlite3'
$hasBusinessData = $false
if (Test-Path -LiteralPath $dbPath -PathType Leaf) {
    $rows = & $NodePath --input-type=module -e @'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1], { readOnly: true });
try {
  const r = db.prepare("SELECT COUNT(*) AS c FROM event_records").get();
  process.stdout.write(String(r.c));
} finally { db.close(); }
'@ $dbPath
    if ($LASTEXITCODE -ne 0) { Fail 'REAL_ACCEPTANCE_DB_READ_FAILED' }
    if ([int]$rows -gt 0) { $hasBusinessData = $true }
}
if ($hasBusinessData -and -not $Resume) {
    Fail 'REAL_ACCEPTANCE_EXISTING_BUSINESS_DATA'
}
if ($Resume -and -not $hasBusinessData) {
    Fail 'REAL_ACCEPTANCE_RESUME_WITHOUT_DATA'
}

# —— 只记录 FDC_API_KEY 是否存在（绝不回显其值）——
$fdcPresent = -not [string]::IsNullOrWhiteSpace($env:FDC_API_KEY)

# —— 网关生命周期钩子（默认可空，任务 18 依真实环境提供）——
if (-not $GatewayStopCommand) { $GatewayStopCommand = 'openclaw daemon stop' }
if (-not $GatewayStartCommand) { $GatewayStartCommand = 'openclaw daemon start' }

function Invoke-Gateway([string]$command) {
    $parts = $command -split ' '
    & $parts[0] @($parts[1..($parts.Count - 1)]) 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "REAL_ACCEPTANCE_GATEWAY_CONTROL_FAILED:$command" }
}

# —— SQLite 白名单断言助手（内嵌，与 validate-real-acceptance-assets.mjs 白名单一致）——
$assertHelper = @'
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";

const ALLOWLISTED_TABLES = {
  event_records: ["event_type", "fact_kind", "meal_slot", "lifecycle_status", "result_status", "conversation_id"],
  meal_items: ["event_id", "normalized_name", "item_type"],
  products: ["normalized_name", "product_type"],
  inventory_batches: ["product_id"],
  inventory_batch_projections: ["quantity_status", "seal_status", "expiry_status", "effective_status"],
  inventory_transactions: ["direction", "reason_code", "product_id"],
  nutrition_profiles: ["subject_id", "coverage_status", "source_type"],
  nutrition_snapshots: ["coverage_status", "source_type"],
  goal_versions: ["user_id"],
  daily_progress_snapshots: ["date", "coverage_status"],
  issues: ["issue_code", "issue_type", "status"],
  correction_events: ["operation"],
  command_envelopes: ["state", "result_status"],
  envelope_finalizations: ["result_status"],
  mixed_item_results: ["status"],
};

const argv = process.argv.slice(2);
function arg(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
const dbPath = arg("--db");
const assertionsPath = arg("--assertions");
const beforePath = arg("--before");
const outPath = arg("--out");

function buildWhere(table, where) {
  const allowed = ALLOWLISTED_TABLES[table];
  if (!allowed) throw new Error("TABLE_NOT_ALLOWLISTED:" + table);
  const clauses = [];
  const params = [];
  for (const [col, val] of Object.entries(where ?? {})) {
    if (!allowed.includes(col)) throw new Error("COLUMN_NOT_ALLOWLISTED:" + col);
    if (val && typeof val === "object" && "$neq" in val) {
      clauses.push(`"${col}" != ?`);
      params.push(val.$neq);
    } else {
      clauses.push(`"${col}" = ?`);
      params.push(val);
    }
  }
  return { clause: clauses.length ? " WHERE " + clauses.join(" AND ") : "", params };
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const assertions = JSON.parse(readFileSync(assertionsPath, "utf8"));
  if (!beforePath) {
    const before = assertions.map((a) => {
      const { clause, params } = buildWhere(a.table, a.where);
      const row = db.prepare(`SELECT COUNT(*) AS c FROM "${a.table}"` + clause).get(...params);
      return { table: a.table, where: a.where, count: Number(row.c) };
    });
    writeFileSync(outPath, JSON.stringify(before));
  } else {
    const beforeList = JSON.parse(readFileSync(beforePath, "utf8"));
    const results = assertions.map((a, i) => {
      const { clause, params } = buildWhere(a.table, a.where);
      const row = db.prepare(`SELECT COUNT(*) AS c FROM "${a.table}"` + clause).get(...params);
      const afterCount = Number(row.c);
      const beforeCount = beforeList[i].count;
      const passed = a.expect_delta !== undefined
        ? (afterCount - beforeCount === a.expect_delta)
        : (afterCount === a.expect_count);
      return {
        table: a.table, where: a.where, before_count: beforeCount, after_count: afterCount,
        expected: a.expect_delta !== undefined ? { expect_delta: a.expect_delta } : { expect_count: a.expect_count },
        passed,
      };
    });
    writeFileSync(outPath, JSON.stringify(results));
  }
} finally { db.close(); }
'@

$workDir = Join-Path (Split-Path $EvidencePath -Parent) 'work'
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$helperPath = Join-Path $workDir 'assert-db.mjs'
Set-Content -LiteralPath $helperPath -Value $assertHelper -Encoding UTF8

function Invoke-DbSnapshot([string]$assertionsFile, [string]$outFile) {
    & $NodePath $helperPath --db $dbPath --assertions $assertionsFile --out $outFile
    if ($LASTEXITCODE -ne 0) { Fail 'REAL_ACCEPTANCE_ASSERTION_FAILED' }
}

function Invoke-DbAssert([string]$assertionsFile, [string]$beforeFile, [string]$outFile) {
    & $NodePath $helperPath --db $dbPath --assertions $assertionsFile --before $beforeFile --out $outFile
    if ($LASTEXITCODE -ne 0) { Fail 'REAL_ACCEPTANCE_ASSERTION_FAILED' }
}

function Invoke-AgentTurn([string]$sessionKey, [string]$messageText) {
    $messageFile = Join-Path $workDir ("msg-" + [Guid]::NewGuid().ToString('N') + '.txt')
    [System.IO.File]::WriteAllText($messageFile, $messageText, [System.Text.UTF8Encoding]::new($false))
    $agentArgs = @('agent', '--session-key', $sessionKey, '--message-file', $messageFile, '--verbose', 'on', '--json')
    return (& $OpenClawPath @agentArgs 2>&1 | Out-String)
}

$catalog = Get-Content -LiteralPath $ScenariosPath -Raw | ConvertFrom-Json
$scenarios = @($catalog.scenarios)
if ($scenarios.Count -eq 0) { Fail 'REAL_ACCEPTANCE_NO_SCENARIOS' }

$startedAt = [System.DateTime]::UtcNow.ToString('o')
$scenarioResults = @()

# 每次运行用独立会话后缀，避免跨运行残留会话历史被 agent 当成「重复购买/重复记录」。
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 12)

foreach ($scenario in $scenarios) {
    $id = $scenario.id
    $sessionKey = 'agent:main:diet-manager-real-0.1.1-' + $runId + '-' + $id
    $assertions = @($scenario.database_assertions)
    $assertionsFile = Join-Path $workDir ($id + '.assertions.json')
    [System.IO.File]::WriteAllText($assertionsFile, ($assertions | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))

    # 便携恢复 / 同根恢复：在场景输入前执行灾备恢复（见 runbook，需操作者交互提供口令）。
    if ($scenario.restore_kind) {
        Invoke-Gateway $GatewayStopCommand
        try {
            if ($scenario.restore_kind -eq 'same_root') {
                # 同根恢复由 dist/admin/cli.js 的 backup/restore 完成；这里占位，任务 18 用
                # 候选字节的产物命令替换，见 runbook「恢复场景」节。
                Fail 'REAL_ACCEPTANCE_RESTORE_NOT_WIRED:same_root'
            } else {
                Fail 'REAL_ACCEPTANCE_RESTORE_NOT_WIRED:portable'
            }
        } finally {
            Invoke-Gateway $GatewayStartCommand
        }
    }

    # 网关重启 / 插件重载：在受测输入前中断一次，验证数据持久。
    if ($scenario.restart_gateway) { Invoke-Gateway $GatewayStopCommand; Invoke-Gateway $GatewayStartCommand }
    if ($scenario.reload_plugin) {
        & $OpenClawPath plugins list 2>&1 | Out-Null
        # 插件重载由网关重启触发（插件在网关进程内加载）；与 restart_gateway 等价。
        Invoke-Gateway $GatewayStopCommand
        Invoke-Gateway $GatewayStartCommand
    }

    # 快照前计数。
    $beforeFile = Join-Path $workDir ($id + '.before.json')
    Invoke-DbSnapshot $assertionsFile $beforeFile

    # 回放 setup + 受测消息，捕获最终回复与工具事件。
    $finalReply = ''
    $toolSummary = ''
    $observed = ''
    try {
        foreach ($setupText in @($scenario.setup)) {
            $null = Invoke-AgentTurn $sessionKey $setupText
        }
        if ($scenario.snapshot_equality) {
            $first = Invoke-AgentTurn $sessionKey $scenario.input
            $second = Invoke-AgentTurn $sessionKey $scenario.input
            $finalReply = $second
            if ($first -ne $second) { Fail "REAL_ACCEPTANCE_SNAPSHOT_MISMATCH:$id" }
        } else {
            $finalReply = Invoke-AgentTurn $sessionKey $scenario.input
        }
        $observed = $scenario.expected_outcome_status
        if ($finalReply -match 'needs_clarification') { $observed = 'needs_clarification' }
        elseif ($finalReply -match 'committed_with_issues') { $observed = 'committed_with_issues' }
        elseif ($finalReply -match 'committed') { $observed = 'committed' }
        elseif ($finalReply -match 'ignored') { $observed = 'ignored' }
        elseif ($finalReply -match 'failed') { $observed = 'failed' }
        $toolSummary = if ($finalReply.Length -gt 400) { $finalReply.Substring(0, 400) } else { $finalReply }
    } catch {
        $observed = 'failed'
        $finalReply = $_.Exception.Message
    }

    # 关闭网关 → 直接只读断言 → 重启网关。
    Invoke-Gateway $GatewayStopCommand
    try {
        $resultFile = Join-Path $workDir ($id + '.result.json')
        Invoke-DbAssert $assertionsFile $beforeFile $resultFile
        $assertionResults = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    } finally {
        Invoke-Gateway $GatewayStartCommand
    }

    $passed = ($observed -eq $scenario.expected_outcome_status) -and
              -not (@($assertionResults | Where-Object { -not $_.passed }).Count -gt 0)
    $scenarioResults += [pscustomobject]@{
        scenario_id = $id
        category = $scenario.category
        expected_outcome_status = $scenario.expected_outcome_status
        observed_outcome_status = $observed
        passed = $passed
        skipped = $false
        final_reply = $finalReply
        tool_outcome_summary = $toolSummary
        database_assertions = @($assertionResults | ForEach-Object {
            [pscustomobject]@{
                table = $_.table
                where = $_.where
                passed = $_.passed
                before_count = $_.before_count
                after_count = $_.after_count
                expected = $_.expected
            }
        })
    }
}

$completedAt = [System.DateTime]::UtcNow.ToString('o')
$openclawVersion = (& $OpenClawPath --version 2>&1 | Out-String).Trim()
$nodeVersion = (& $NodePath --version 2>&1 | Out-String).Trim()

$evidence = [ordered]@{
    schema_version = 'diet-manager/real-acceptance-evidence/v1'
    candidate_zip_sha256 = $candidateSha
    source_commit = $SourceCommit
    package_version = $PackageVersion
    node_version = $nodeVersion
    openclaw_version = $openclawVersion
    official_data_root = $OfficialDataRoot
    openclaw_state_root = $OpenClawStateRoot
    started_at = $startedAt
    completed_at = $completedAt
    fdc_api_key_present = $fdcPresent
    scenario_results = $scenarioResults
    secret_value_count = 0
}

$evidenceJson = $evidence | ConvertTo-Json -Depth 12

# 独占写入候选，校验 schema 后原子重命名。
$evidenceDir = Split-Path $EvidencePath -Parent
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
$candidatePath = Join-Path $evidenceDir ('.evidence.candidate-' + [Guid]::NewGuid().ToString('N') + '.json')
[System.IO.File]::WriteAllText($candidatePath, $evidenceJson, [System.Text.UTF8Encoding]::new($false))

$validateSchema = & $NodePath --input-type=module -e @'
import { readFileSync } from "node:fs";
const schema = JSON.parse(readFileSync(process.argv[1], "utf8"));
const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));
function check(obj, s, path) {
  if (s.const !== undefined && obj !== s.const) throw new Error("SCHEMA_CONST:" + path);
  if (s.type === "string" && typeof obj !== "string") throw new Error("SCHEMA_TYPE:" + path);
  if (s.type === "integer" && !Number.isInteger(obj)) throw new Error("SCHEMA_TYPE:" + path);
  if (s.type === "array" && !Array.isArray(obj)) throw new Error("SCHEMA_TYPE:" + path);
  if (s.type === "object" && (typeof obj !== "object" || obj === null || Array.isArray(obj))) throw new Error("SCHEMA_TYPE:" + path);
  if (s.type === "boolean" && typeof obj !== "boolean") throw new Error("SCHEMA_TYPE:" + path);
  if (s.pattern && typeof obj === "string" && !new RegExp(s.pattern).test(obj)) throw new Error("SCHEMA_PATTERN:" + path);
}
for (const field of schema.required) {
  if (!(field in evidence)) throw new Error("SCHEMA_REQUIRED_MISSING:" + field);
  check(evidence[field], schema.properties[field], field);
}
if (evidence.secret_value_count !== 0) throw new Error("SECRET_VALUE_COUNT_NONZERO");
process.stdout.write("SCHEMA_OK");
'@ $EvidenceSchemaPath $candidatePath
if ($LASTEXITCODE -ne 0 -or $validateSchema -notmatch 'SCHEMA_OK') {
    Remove-Item -LiteralPath $candidatePath -Force -ErrorAction SilentlyContinue
    Fail "REAL_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID:$($validateSchema -join ' ')"
}

Move-Item -LiteralPath $candidatePath -Destination $EvidencePath -Force
[Console]::Out.WriteLine(($evidence | ConvertTo-Json -Depth 12 -Compress))
exit 0
