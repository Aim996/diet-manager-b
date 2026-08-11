[CmdletBinding()]
param(
    [string]$CasesPath,
    [string]$FixturesPath
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
    "CASE-STORAGE-007"
)

$ExpectedDomainCaseIds = @(
    "CASE-PURCHASE-001",
    "CASE-INVENTORY-003",
    "CASE-NUTR-001",
    "CASE-ISSUE-001",
    "CASE-CORR-001",
    "CASE-MIXED-001",
    "CASE-EFFECT-001",
    "CASE-EFFECT-003",
    "CASE-STORAGE-007"
)

$ExpectedDomainScenarioIds = @(
    "domain-purchase-milk-2x12x250-v1",
    "domain-inventory-multiple-products-v1",
    "domain-nutrition-label-milk-v1",
    "domain-issue-amount-inventory-v1",
    "domain-correction-eggs-2-to-3-v1",
    "domain-mixed-purchase-drink-v1",
    "domain-effect-nutrition-failure-v1",
    "domain-finalizer-failure-concurrent-v1",
    "domain-idempotency-conflict-v1"
)

function Assert-DomainTrue {
    param([bool]$Condition, [string]$Code)
    if (-not $Condition) {
        throw $Code
    }
}

function Assert-DomainEqual {
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

function Assert-DomainPlainObject {
    param($Value, [string]$Code)
    Assert-DomainTrue ($null -ne $Value) $Code
    Assert-DomainTrue (-not ($Value -is [System.Array])) $Code
    Assert-DomainTrue (-not ($Value -is [string])) $Code
    Assert-DomainTrue ($Value -is [psobject]) $Code
}

function Assert-DomainExactProperties {
    param($Value, [string[]]$Expected, [string]$Code)
    Assert-DomainPlainObject $Value $Code
    $actual = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-DomainEqual $Expected.Count $actual.Count ("{0}:property_count" -f $Code)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-DomainEqual $Expected[$index] $actual[$index] ("{0}:property_{1}" -f $Code, $index)
        Assert-DomainEqual "NoteProperty" ([string]$Value.PSObject.Properties[$actual[$index]].MemberType) ("{0}:member_type_{1}" -f $Code, $index)
    }
}

function Assert-DomainExactStringArray {
    param([string[]]$Expected, $Actual, [string]$Code)
    Assert-DomainTrue ($Actual -is [System.Array]) ("{0}:array" -f $Code)
    $values = @($Actual)
    Assert-DomainEqual $Expected.Count $values.Count ("{0}:count" -f $Code)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-DomainTrue ($values[$index] -is [string]) ("{0}:type_{1}" -f $Code, $index)
        Assert-DomainEqual $Expected[$index] ([string]$values[$index]) ("{0}:value_{1}" -f $Code, $index)
    }
}

function Read-DomainJson {
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

function Copy-DomainJson {
    param($Value)
    return ($Value | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json)
}

function Get-DomainCaseById {
    param($CaseSet, [string]$Id)
    $matches = @($CaseSet.cases | Where-Object { [string]$_.id -ceq $Id })
    Assert-DomainEqual 1 $matches.Count ("DOMAIN_CASE_ID_INVALID:{0}" -f $Id)
    return $matches[0]
}

function Test-DomainCaseCandidate {
    param($CaseSet, $Fixtures)

    Assert-DomainExactProperties $CaseSet @(
        "case_set_id",
        "version",
        "contract",
        "fixture_catalog",
        "package_invariants",
        "cases"
    ) "DOMAIN_CASE_SET_SHAPE_INVALID:root"
    Assert-DomainEqual "diet-manager/core-acceptance-cases-v1" ([string]$CaseSet.case_set_id) "DOMAIN_CASE_SET_ID_INVALID"
    Assert-DomainEqual "1.1.0" ([string]$CaseSet.version) "DOMAIN_CASE_SET_VERSION_INVALID"

    $caseIds = @($CaseSet.cases | ForEach-Object { [string]$_.id })
    Assert-DomainExactStringArray $ExpectedCumulativeCaseIds $caseIds "DOMAIN_CASE_IDS_INVALID"
    foreach ($id in $ExpectedDomainCaseIds) {
        [void](Get-DomainCaseById $CaseSet $id)
    }

    Assert-DomainExactProperties $Fixtures @(
        "fixture_catalog_id",
        "version",
        "environments",
        "goals",
        "query_views",
        "domain_scenarios"
    ) "DOMAIN_CASE_FIXTURE_SHAPE_INVALID:root"
    Assert-DomainEqual "diet-manager/core-fixtures-v1" ([string]$Fixtures.fixture_catalog_id) "DOMAIN_CASE_FIXTURE_ID_INVALID"
    Assert-DomainEqual "1.1.0" ([string]$Fixtures.version) "DOMAIN_CASE_FIXTURE_VERSION_INVALID"
    $scenarioIds = @($Fixtures.domain_scenarios | ForEach-Object { [string]$_.fixture_id })
    Assert-DomainExactStringArray $ExpectedDomainScenarioIds $scenarioIds "DOMAIN_CASE_SCENARIO_IDS_INVALID"
}

$caseSet = Read-DomainJson $CasesPath "DOMAIN_CASE_SET_FILE_MISSING" "DOMAIN_CASE_SET_JSON_INVALID"
$fixtures = Read-DomainJson $FixturesPath "DOMAIN_CASE_FIXTURE_FILE_MISSING" "DOMAIN_CASE_FIXTURE_JSON_INVALID"
Test-DomainCaseCandidate $caseSet $fixtures

"DOMAIN_ACCEPTANCE_CASES|PASS|version=1.1.0|cases=9|scenarios=9|mutations=0"
