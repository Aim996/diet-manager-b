[CmdletBinding()]
param(
    [string]$CasesPath,
    [string]$FixturesPath,
    [switch]$SkipMutations,
    [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SharedRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if ([string]::IsNullOrWhiteSpace($CasesPath)) {
    $CasesPath = Join-Path $SharedRoot "acceptance-cases\cases.json"
}
if ([string]::IsNullOrWhiteSpace($FixturesPath)) {
    $FixturesPath = Join-Path $SharedRoot "acceptance-cases\fixtures\core-v1.json"
}

$ExpectedCumulativeCaseIds = @(
    "CASE-MEAL-001",
    "CASE-MEAL-021",
    "CASE-WATER-001",
    "CASE-RECEIPT-001",
    "CASE-QUERY-001",
    "CASE-PURCHASE-001",
    "CASE-INVENTORY-003",
    "CASE-NUTR-001",
    "CASE-ISSUE-001",
    "CASE-CORR-001",
    "CASE-MIXED-001",
    "CASE-EFFECT-001",
    "CASE-EFFECT-003",
    "CASE-STORAGE-007",
    "CASE-PRIV-001",
    "CASE-FOUNDATION-002",
    "CASE-OPS-001",
    "CASE-OPS-003",
    "CASE-OPS-010",
    "CASE-EXPORT-004"
)

$ExpectedOpsCaseIds = @(
    "CASE-PRIV-001",
    "CASE-FOUNDATION-002",
    "CASE-OPS-001",
    "CASE-OPS-003",
    "CASE-OPS-010",
    "CASE-EXPORT-004"
)

$ExpectedOpsScenarioIds = @(
    "ops-privacy-public-nutrition-v1",
    "ops-foundation-zero-diff-v1",
    "ops-clean-install-b-v1",
    "ops-migration-interrupted-v1",
    "ops-candidate-byte-drift-v1",
    "ops-minimal-export-restore-reject-v1"
)

function Assert-OpsTrue {
    param([bool]$Condition, [string]$Code)
    if (-not $Condition) {
        throw $Code
    }
}

function Assert-OpsEqual {
    param($Expected, $Actual, [string]$Code)
    if (($Expected -is [string]) -and (-not ($Actual -is [string]))) {
        throw ("{0}:type" -f $Code)
    }
    if (($Expected -is [bool]) -and (-not ($Actual -is [bool]))) {
        throw ("{0}:type" -f $Code)
    }
    if ($Expected -is [int]) {
        $integerTypes = @([byte], [sbyte], [int16], [uint16], [int32], [uint32], [int64], [uint64])
        $isInteger = $false
        foreach ($integerType in $integerTypes) {
            if ($Actual -is $integerType) {
                $isInteger = $true
                break
            }
        }
        if (-not $isInteger) {
            throw ("{0}:type" -f $Code)
        }
    }
    if ($Expected -ne $Actual) {
        throw ("{0}:expected={1}:actual={2}" -f $Code, $Expected, $Actual)
    }
}

function Assert-OpsPlainObject {
    param($Value, [string]$Code)
    Assert-OpsTrue ($null -ne $Value) $Code
    Assert-OpsTrue (-not ($Value -is [System.Array])) $Code
    Assert-OpsTrue (-not ($Value -is [string])) $Code
    Assert-OpsTrue ($Value -is [psobject]) $Code
}

function Assert-OpsExactProperties {
    param($Value, [string[]]$Expected, [string]$Code)
    Assert-OpsPlainObject $Value $Code
    $actual = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-OpsEqual $Expected.Count $actual.Count ("{0}:property_count" -f $Code)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-OpsEqual $Expected[$index] $actual[$index] ("{0}:property_{1}" -f $Code, $index)
        Assert-OpsEqual "NoteProperty" ([string]$Value.PSObject.Properties[$actual[$index]].MemberType) ("{0}:member_type_{1}" -f $Code, $index)
    }
}

function Assert-OpsExactStringArray {
    param([string[]]$Expected, $Actual, [string]$Code)
    Assert-OpsTrue ($Actual -is [System.Array]) ("{0}:array" -f $Code)
    $values = @($Actual)
    Assert-OpsEqual $Expected.Count $values.Count ("{0}:count" -f $Code)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-OpsTrue ($values[$index] -is [string]) ("{0}:type_{1}" -f $Code, $index)
        Assert-OpsEqual $Expected[$index] ([string]$values[$index]) ("{0}:value_{1}" -f $Code, $index)
    }
}

function Read-OpsJson {
    param([string]$Path, [string]$MissingCode, [string]$InvalidCode)
    if (-not [IO.File]::Exists($Path)) {
        throw $MissingCode
    }
    try {
        return (Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json)
    }
    catch {
        throw ("{0}:{1}" -f $InvalidCode, [string]$_.Exception.Message)
    }
}

function Copy-OpsJson {
    param($Value)
    return ($Value | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json)
}

function Get-OpsSha256 {
    param([byte[]]$Bytes)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($Bytes)
        return ([BitConverter]::ToString($hash).Replace("-", ""))
    }
    finally {
        $sha.Dispose()
    }
}

function Get-OpsCaseById {
    param($CaseSet, [string]$Id)
    $matches = @($CaseSet.cases | Where-Object { [string]$_.id -ceq $Id })
    Assert-OpsEqual 1 $matches.Count ("OPS_SECURITY_CASE_ID_INVALID:{0}" -f $Id)
    return $matches[0]
}

function Get-OpsScenarioById {
    param($Fixtures, [string]$Id)
    $matches = @($Fixtures.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq $Id })
    Assert-OpsEqual 1 $matches.Count ("OPS_SECURITY_SCENARIO_ID_INVALID:{0}" -f $Id)
    return $matches[0]
}

function Test-OpsSecurityCasesCandidate {
    param($CaseSet)

    Assert-OpsExactProperties $CaseSet @(
        "case_set_id", "version", "contract", "fixture_catalog", "package_invariants", "cases"
    ) "OPS_SECURITY_CASE_SET_SHAPE_INVALID:root"
    Assert-OpsEqual "diet-manager/core-acceptance-cases-v1" ([string]$CaseSet.case_set_id) "OPS_SECURITY_CASE_SET_ID_INVALID"
    Assert-OpsEqual "1.2.0" ([string]$CaseSet.version) "OPS_SECURITY_CASE_SET_VERSION_INVALID"
    Assert-OpsExactProperties $CaseSet.contract @("contract_id", "contract_version") "OPS_SECURITY_CONTRACT_SHAPE_INVALID"
    Assert-OpsEqual "diet-manager/contract-v2" ([string]$CaseSet.contract.contract_id) "OPS_SECURITY_CONTRACT_ID_INVALID"
    Assert-OpsEqual 2 ([int]$CaseSet.contract.contract_version) "OPS_SECURITY_CONTRACT_VERSION_INVALID"
    Assert-OpsEqual "shared/acceptance-cases/fixtures/core-v1.json" ([string]$CaseSet.fixture_catalog) "OPS_SECURITY_FIXTURE_PATH_INVALID"
    Assert-OpsExactProperties $CaseSet.package_invariants @(
        "adapters_may_rewrite_oracle",
        "technical_log",
        "technical_log_counts_as_record",
        "fact_commit_failure_business_write_count",
        "fact_commit_failure_forbidden_artifacts"
    ) "OPS_SECURITY_PACKAGE_INVARIANTS_INVALID"
    Assert-OpsEqual $false $CaseSet.package_invariants.adapters_may_rewrite_oracle "OPS_SECURITY_ORACLE_AUTHORITY_INVALID"
    Assert-OpsEqual "allowed_separate_redacted_only" ([string]$CaseSet.package_invariants.technical_log) "OPS_SECURITY_TECHNICAL_LOG_INVALID"
    Assert-OpsEqual $false $CaseSet.package_invariants.technical_log_counts_as_record "OPS_SECURITY_TECHNICAL_LOG_RECORD_INVALID"
    Assert-OpsEqual 0 $CaseSet.package_invariants.fact_commit_failure_business_write_count "OPS_SECURITY_FAILED_FACT_WRITE_INVALID"
    Assert-OpsExactStringArray @(
        "meal_or_water_fact", "inventory_change", "nutrition_snapshot", "issue", "business_outbox",
        "daily_progress", "success_receipt", "terminal_idempotency_result"
    ) $CaseSet.package_invariants.fact_commit_failure_forbidden_artifacts "OPS_SECURITY_FAILED_FACT_ARTIFACTS_INVALID"

    Assert-OpsTrue ($CaseSet.cases -is [System.Array]) "OPS_SECURITY_CASE_SET_SHAPE_INVALID:cases"
    $caseIds = @($CaseSet.cases | ForEach-Object { [string]$_.id })
    Assert-OpsExactStringArray $ExpectedCumulativeCaseIds $caseIds "OPS_SECURITY_CASE_IDS_INVALID"
    Assert-OpsEqual $caseIds.Count @($caseIds | Select-Object -Unique).Count "OPS_SECURITY_CASE_IDS_DUPLICATE"
    foreach ($id in $ExpectedOpsCaseIds) {
        [void](Get-OpsCaseById $CaseSet $id)
    }
}

function Test-OpsSecurityFixtureCandidate {
    param($Fixtures)

    Assert-OpsExactProperties $Fixtures @(
        "fixture_catalog_id", "version", "environments", "goals", "query_views",
        "domain_scenarios", "ops_security_scenarios"
    ) "OPS_SECURITY_FIXTURE_SHAPE_INVALID:root"
    Assert-OpsEqual "diet-manager/core-fixtures-v1" ([string]$Fixtures.fixture_catalog_id) "OPS_SECURITY_FIXTURE_ID_INVALID"
    Assert-OpsEqual "1.2.0" ([string]$Fixtures.version) "OPS_SECURITY_FIXTURE_VERSION_INVALID"
    Assert-OpsTrue ($Fixtures.ops_security_scenarios -is [System.Array]) "OPS_SECURITY_SCENARIOS_SHAPE_INVALID"
    $scenarioIds = @($Fixtures.ops_security_scenarios | ForEach-Object { [string]$_.fixture_id })
    Assert-OpsExactStringArray $ExpectedOpsScenarioIds $scenarioIds "OPS_SECURITY_SCENARIO_IDS_INVALID"
    Assert-OpsEqual $scenarioIds.Count @($scenarioIds | Select-Object -Unique).Count "OPS_SECURITY_SCENARIO_IDS_DUPLICATE"
    foreach ($id in $ExpectedOpsScenarioIds) {
        [void](Get-OpsScenarioById $Fixtures $id)
    }
}

function Test-OpsSecurityCandidate {
    param($CaseSet, $Fixtures)

    Test-OpsSecurityCasesCandidate $CaseSet
    Test-OpsSecurityFixtureCandidate $Fixtures
    for ($index = 0; $index -lt $ExpectedOpsCaseIds.Count; $index++) {
        $case = Get-OpsCaseById $CaseSet $ExpectedOpsCaseIds[$index]
        Assert-OpsTrue ($null -ne $case.setup) ("OPS_SECURITY_CASE_SETUP_INVALID:{0}" -f $ExpectedOpsCaseIds[$index])
        Assert-OpsEqual $ExpectedOpsScenarioIds[$index] ([string]$case.setup.ops_security_fixture) ("OPS_SECURITY_CASE_FIXTURE_REF_INVALID:{0}" -f $ExpectedOpsCaseIds[$index])
    }
}

function Invoke-OpsMutation {
    param([string]$Name, [scriptblock]$Mutator, [string]$ExpectedPrefix, $CaseSet, $Fixtures)

    $caseCandidate = Copy-OpsJson $CaseSet
    $fixtureCandidate = Copy-OpsJson $Fixtures
    & $Mutator $caseCandidate $fixtureCandidate
    $rejected = $false
    try {
        Test-OpsSecurityCandidate $caseCandidate $fixtureCandidate
    }
    catch {
        $message = [string]$_.Exception.Message
        if (-not $message.StartsWith($ExpectedPrefix, [StringComparison]::Ordinal)) {
            throw ("OPS_SECURITY_MUTATION_WRONG_ERROR:{0}:expected={1}:actual={2}" -f $Name, $ExpectedPrefix, $message)
        }
        $rejected = $true
    }
    Assert-OpsTrue $rejected ("OPS_SECURITY_MUTATION_SURVIVED:{0}" -f $Name)
    "{0}|PASS" -f $Name
}

if (-not $LibraryOnly) {
    $caseSet = Read-OpsJson $CasesPath "OPS_SECURITY_CASE_SET_FILE_MISSING" "OPS_SECURITY_CASE_SET_JSON_INVALID"
    $fixtures = Read-OpsJson $FixturesPath "OPS_SECURITY_FIXTURE_FILE_MISSING" "OPS_SECURITY_FIXTURE_JSON_INVALID"
    Test-OpsSecurityCandidate $caseSet $fixtures
    $mutationCount = 0
    if (-not $SkipMutations) {
        $mutationCount = 0
    }
    "OPS_SECURITY_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=6|scenarios=6|mutations={0}" -f $mutationCount
}
