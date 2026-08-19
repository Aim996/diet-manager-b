# validate-product-0.1.ps1
# 可重复的完整产品自动化门。只依赖 PATH 中的工具；缺失时返回 ENVIRONMENT_BLOCKED:*，
# 不写死任何一次性缓存路径。所有业务/测试写入只发生在预检全部通过之后。
[CmdletBinding()]
param(
  [switch]$PreflightOnly,
  [string]$EvidencePath,
  [switch]$SkipPluginValidation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$pluginRoot = Join-Path $repoRoot 'version-b-lite-plugin'
$gatesFixture = Join-Path $repoRoot 'shared\tests\fixtures\product-validation\expected-gates.json'

function Exit-Blocked([string]$code) {
  [Console]::Error.WriteLine($code)
  exit 1
}

# ---------- 预检（只读） ----------

if ($PSVersionTable.PSVersion.Major -lt 7) { Exit-Blocked 'ENVIRONMENT_BLOCKED:powershell' }

$securityModule = $true
try { Import-Module Microsoft.PowerShell.Security -ErrorAction Stop } catch { $securityModule = $false }
if (-not $securityModule) { Exit-Blocked 'ENVIRONMENT_BLOCKED:powershell_security' }

$nodeCmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Exit-Blocked 'ENVIRONMENT_BLOCKED:node' }
$nodeVersionRaw = (& node --version).Trim()
if ($nodeVersionRaw -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { Exit-Blocked 'ENVIRONMENT_BLOCKED:node' }
$nodeMajor = [int]$Matches[1]; $nodeMinor = [int]$Matches[2]
if ($nodeMajor -ne 24 -or ($nodeMinor -lt 15)) { Exit-Blocked 'ENVIRONMENT_BLOCKED:node' }

$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCmd) { Exit-Blocked 'ENVIRONMENT_BLOCKED:pnpm' }
$pnpmVersion = (& pnpm --version 2>&1 | Select-Object -Last 1).ToString().Trim()

$gitCmd = Get-Command git -CommandType Application -ErrorAction SilentlyContinue
if (-not $gitCmd) { Exit-Blocked 'ENVIRONMENT_BLOCKED:git' }

$openclawLocal = Join-Path $pluginRoot 'node_modules\.bin\openclaw.CMD'
$openclawCmd = Get-Command openclaw -ErrorAction SilentlyContinue
if (-not $openclawCmd -and -not (Test-Path -LiteralPath $openclawLocal -PathType Leaf)) {
  Exit-Blocked 'ENVIRONMENT_BLOCKED:openclaw'
}

$evidenceRoot = Join-Path $repoRoot 'docs\evidence\product-0.1.1'
$resolvedEvidence = $null
if ($EvidencePath) {
  $evidenceParent = Split-Path -Parent $EvidencePath
  if (-not $evidenceParent) { Exit-Blocked 'PRODUCT_VALIDATOR_EVIDENCE_PATH' }
  if (-not (Test-Path -LiteralPath $evidenceRoot)) { New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null }
  $normalizedParent = [System.IO.Path]::GetFullPath($evidenceParent)
  $normalizedRoot = [System.IO.Path]::GetFullPath($evidenceRoot)
  if (-not $normalizedParent.StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Exit-Blocked 'PRODUCT_VALIDATOR_EVIDENCE_PATH'
  }
  $resolvedEvidence = [System.IO.Path]::GetFullPath($EvidencePath)
}

$preflight = [ordered]@{
  schema_version = 'diet-manager/product-validation/v1'
  node_major = $nodeMajor
  node_version = $nodeVersionRaw
  pnpm_version = $pnpmVersion
  powershell_version = $PSVersionTable.PSVersion.ToString()
  powershell_security_module = $securityModule
  git_available = $true
  openclaw_available = $true
  secret_value_count = 0
}

if ($PreflightOnly) {
  $preflight | ConvertTo-Json -Compress
  exit 0
}

# ---------- 保护文件清单（前） ----------

$protectedPatterns = @('*.sqlite', '*.sqlite3', '*.db', '*-wal', '*.db-wal', '*-shm', '*.db-shm', '*journal*', '.env', '*.env', '*authority-secret*')
function Get-ProtectedInventory {
  $items = @()
  foreach ($pattern in $protectedPatterns) {
    $items += Get-ChildItem -LiteralPath $repoRoot -Recurse -File -Filter $pattern -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.FullName -notmatch '\\node_modules\\' }
  }
  $items | Select-Object -ExpandProperty FullName -Unique | Sort-Object
}
$inventoryBefore = @(Get-ProtectedInventory)

# vitest 等工具在非 TTY 下仍可能输出 ANSI 颜色码，干扰下游 Test Files/Tests 解析；强制关闭。
$env:NO_COLOR = '1'

# ---------- 有序门 ----------

$expected = Get-Content -Raw -LiteralPath $gatesFixture | ConvertFrom-Json
$gateResults = New-Object System.Collections.Generic.List[object]
$testFiles = 0
$testCount = 0

function Invoke-Gate([string]$id, [string[]]$commandLine, [string]$workingDirectory) {
  Push-Location -LiteralPath $workingDirectory
  try {
    # Windows 批处理 shim（pnpm.CMD 等）对数组传参不可靠，统一经 cmd /c 单字符串执行
    $joined = $commandLine -join ' '
    $output = & cmd.exe /d /s /c $joined 2>&1
    $exit = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  $text = ($output | Out-String)
  $script:gateResults.Add([ordered]@{
    gate = $id
    command = ($commandLine -join ' ')
    exit_code = $exit
  })
  if ($id -eq 'vitest_full') {
    if ($text -match 'Test Files\s+(\d+) passed \((\d+)\)') { $script:testFiles = [int]$Matches[1] }
    if ($text -match '\bTests\s+(\d+) passed \((\d+)\)') { $script:testCount = [int]$Matches[1] }
  }
  if ($exit -ne 0) {
    [Console]::Error.WriteLine("GATE_FAILED:$id")
    [Console]::Error.WriteLine(($text -split "`r?`n" | Select-Object -Last 40) -join "`n")
    exit 1
  }
}

foreach ($gate in $expected.gates) {
  switch ($gate) {
    'typescript_noemit'   { Invoke-Gate $gate @('pnpm', 'exec', 'tsc', '-p', 'tsconfig.json', '--noEmit') $pluginRoot }
    'vitest_full'         { Invoke-Gate $gate @('pnpm', 'exec', 'vitest', 'run', '--maxWorkers=1', '--minWorkers=1', '--no-file-parallelism') $pluginRoot }
    'build'               { Invoke-Gate $gate @('pnpm', 'run', 'build') $pluginRoot }
    'openclaw_build_check' {
      if (-not $SkipPluginValidation) { Invoke-Gate $gate @('pnpm', 'exec', 'openclaw', 'plugins', 'build', '--check', '--root', '.', '--entry', './dist/index.js') $pluginRoot }
    }
    'openclaw_validate' {
      if (-not $SkipPluginValidation) { Invoke-Gate $gate @('pnpm', 'exec', 'openclaw', 'plugins', 'validate', '--root', '.', '--entry', './dist/index.js') $pluginRoot }
    }
    'governance'          { Invoke-Gate $gate @('node', 'shared\tests\validate-product-0.1.1-governance.mjs') $repoRoot }
    default               { Exit-Blocked "PRODUCT_VALIDATOR_UNKNOWN_GATE:$gate" }
  }
}

if ($testFiles -lt $expected.min_test_files) { Exit-Blocked "PRODUCT_VALIDATOR_BASELINE_FILES:$testFiles" }
if ($testCount -lt $expected.min_tests) { Exit-Blocked "PRODUCT_VALIDATOR_BASELINE_TESTS:$testCount" }

# ---------- 保护文件清单（后） ----------

$inventoryAfter = @(Get-ProtectedInventory)
$newProtected = @($inventoryAfter | Where-Object { $inventoryBefore -notcontains $_ })
if ($newProtected.Count -gt 0) {
  [Console]::Error.WriteLine('PRODUCT_VALIDATOR_PROTECTED_DELTA')
  $newProtected | ForEach-Object { [Console]::Error.WriteLine($_) }
  exit 1
}

# ---------- 证据 ----------

$evidence = [ordered]@{
  schema_version = 'diet-manager/product-validation/v1'
  generated_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  environment = $preflight
  gates = $gateResults
  test_files = $testFiles
  tests = $testCount
  protected_inventory_before_count = $inventoryBefore.Count
  protected_inventory_after_count = $inventoryAfter.Count
  protected_new_files = @()
  secret_value_count = 0
}
$evidenceJson = $evidence | ConvertTo-Json -Depth 6
if ($resolvedEvidence) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedEvidence) | Out-Null
  Set-Content -LiteralPath $resolvedEvidence -Value $evidenceJson -Encoding utf8
}
$evidenceJson
exit 0
