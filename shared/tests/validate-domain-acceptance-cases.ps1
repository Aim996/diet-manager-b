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
    "CASE-STORAGE-007",
    "CASE-PRIV-001",
    "CASE-FOUNDATION-002",
    "CASE-OPS-001",
    "CASE-OPS-003",
    "CASE-OPS-010",
    "CASE-EXPORT-004",
    "CASE-RECEIPT-002",
    "CASE-RECEIPT-004",
    "CASE-RECEIPT-005",
    "CASE-RECEIPT-006",
    "CASE-PROGRESS-006",
    "CASE-STORAGE-006",
    "CASE-STORAGE-001"
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
    "CASE-STORAGE-007",
    "CASE-STORAGE-001"
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

function Get-DomainSha256 {
    param([string]$Value)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))
        return ([BitConverter]::ToString($hash).Replace("-", ""))
    }
    finally {
        $sha.Dispose()
    }
}

function Get-DomainCaseById {
    param($CaseSet, [string]$Id)
    $matches = @($CaseSet.cases | Where-Object { [string]$_.id -ceq $Id })
    Assert-DomainEqual 1 $matches.Count ("DOMAIN_CASE_ID_INVALID:{0}" -f $Id)
    return $matches[0]
}

function Get-DomainScenarioById {
    param($Fixtures, [string]$Id)
    $matches = @($Fixtures.domain_scenarios | Where-Object { [string]$_.fixture_id -ceq $Id })
    Assert-DomainEqual 1 $matches.Count ("DOMAIN_SCENARIO_ID_INVALID:{0}" -f $Id)
    return $matches[0]
}

function Assert-DomainSourceText {
    param($Case, [string]$ExpectedBase64, [string]$Code)
    Assert-DomainTrue ($Case.source_text -is [string]) ("{0}:type" -f $Code)
    $actual = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$Case.source_text))
    Assert-DomainEqual $ExpectedBase64 $actual $Code
}

function Assert-DomainCaseCommon {
    param($Case, [string]$Id, [string[]]$RequirementIds, [string]$SourceBase64, [string]$ScenarioId)
    Assert-DomainExactProperties $Case @("id", "requirement_ids", "stage", "source_text", "setup", "oracle", "forbidden") ("DOMAIN_CASE_SHAPE_INVALID:{0}" -f $Id)
    Assert-DomainEqual $Id ([string]$Case.id) ("DOMAIN_CASE_ID_VALUE_INVALID:{0}" -f $Id)
    Assert-DomainExactStringArray $RequirementIds $Case.requirement_ids ("DOMAIN_CASE_REQUIREMENTS_INVALID:{0}" -f $Id)
    Assert-DomainEqual "PRODUCT-0.1" ([string]$Case.stage) ("DOMAIN_CASE_STAGE_INVALID:{0}" -f $Id)
    Assert-DomainSourceText $Case $SourceBase64 ("DOMAIN_CASE_SOURCE_INVALID:{0}" -f $Id)
    Assert-DomainExactProperties $Case.setup @("environment_fixture", "goals_fixture", "query_view_fixture", "domain_scenario_fixture", "prior_context") ("DOMAIN_CASE_SETUP_INVALID:{0}" -f $Id)
    Assert-DomainEqual "env-zh-cn-20260811" ([string]$Case.setup.environment_fixture) ("DOMAIN_CASE_ENVIRONMENT_INVALID:{0}" -f $Id)
    Assert-DomainEqual $ScenarioId ([string]$Case.setup.domain_scenario_fixture) ("DOMAIN_CASE_SCENARIO_REF_INVALID:{0}" -f $Id)
    Assert-DomainTrue ($Case.setup.prior_context -is [System.Array]) ("DOMAIN_CASE_PRIOR_CONTEXT_INVALID:{0}" -f $Id)
    Assert-DomainEqual 0 @($Case.setup.prior_context).Count ("DOMAIN_CASE_PRIOR_CONTEXT_INVALID:{0}" -f $Id)
}

function Assert-DomainFaultScenario {
    param($Scenario, [string]$Id, [string]$Type, [string]$Point, [string]$PreVector, [string]$PreHash, [string]$ErrorCode, [string]$Rollback, [string]$PostVector, [string]$PostHash)
    Assert-DomainExactProperties $Scenario @(
        "fixture_id", "scenario_type", "failure_injection_point", "pre_state_vector", "pre_state_hash",
        "expected_error_code", "should_rollback", "post_state_vector", "post_state_hash",
        "state_after_restart", "same_key_retry_result", "official_business_data_diff"
    ) ("DOMAIN_SCENARIO_SHAPE_INVALID:{0}" -f $Id)
    Assert-DomainEqual $Id ([string]$Scenario.fixture_id) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:fixture_id" -f $Id)
    Assert-DomainEqual $Type ([string]$Scenario.scenario_type) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:scenario_type" -f $Id)
    Assert-DomainEqual $Point ([string]$Scenario.failure_injection_point) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:failure_injection_point" -f $Id)
    Assert-DomainEqual $PreVector ([string]$Scenario.pre_state_vector) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:pre_state_vector" -f $Id)
    Assert-DomainEqual $PreHash ([string]$Scenario.pre_state_hash) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:pre_state_hash" -f $Id)
    Assert-DomainEqual $PreHash (Get-DomainSha256 $PreVector) ("DOMAIN_SCENARIO_HASH_INVALID:{0}:pre" -f $Id)
    Assert-DomainEqual $ErrorCode ([string]$Scenario.expected_error_code) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:expected_error_code" -f $Id)
    Assert-DomainEqual $Rollback ([string]$Scenario.should_rollback) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:should_rollback" -f $Id)
    Assert-DomainEqual $PostVector ([string]$Scenario.post_state_vector) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:post_state_vector" -f $Id)
    Assert-DomainEqual $PostHash ([string]$Scenario.post_state_hash) ("DOMAIN_SCENARIO_VALUE_INVALID:{0}:post_state_hash" -f $Id)
    Assert-DomainEqual $PostHash (Get-DomainSha256 $PostVector) ("DOMAIN_SCENARIO_HASH_INVALID:{0}:post" -f $Id)
}

function Assert-DomainScenarioFixtures {
    param($Fixtures)

    $purchase = Get-DomainScenarioById $Fixtures "domain-purchase-milk-2x12x250-v1"
    Assert-DomainExactProperties $purchase @("fixture_id", "scenario_type", "product", "package") "DOMAIN_SCENARIO_SHAPE_INVALID:purchase"
    Assert-DomainEqual "purchase_package" ([string]$purchase.scenario_type) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:type"
    Assert-DomainExactProperties $purchase.product @("product_id", "normalized_name", "variant") "DOMAIN_SCENARIO_SHAPE_INVALID:purchase:product"
    Assert-DomainEqual "fixture-product-milk-whole-250" ([string]$purchase.product.product_id) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:product_id"
    Assert-DomainEqual "milk" ([string]$purchase.product.normalized_name) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:name"
    Assert-DomainEqual "whole_milk_250ml" ([string]$purchase.product.variant) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:variant"
    Assert-DomainExactProperties $purchase.package @("outer_count", "outer_unit", "inner_per_outer", "inner_unit", "capacity_per_inner", "capacity_unit", "total_inner", "total_capacity", "formula", "expiry_date") "DOMAIN_SCENARIO_SHAPE_INVALID:purchase:package"
    Assert-DomainEqual 2 $purchase.package.outer_count "DOMAIN_SCENARIO_VALUE_INVALID:purchase:outer_count"
    Assert-DomainEqual "box" ([string]$purchase.package.outer_unit) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:outer_unit"
    Assert-DomainEqual 12 $purchase.package.inner_per_outer "DOMAIN_SCENARIO_VALUE_INVALID:purchase:inner_per_outer"
    Assert-DomainEqual "carton" ([string]$purchase.package.inner_unit) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:inner_unit"
    Assert-DomainEqual 250 $purchase.package.capacity_per_inner "DOMAIN_SCENARIO_VALUE_INVALID:purchase:capacity"
    Assert-DomainEqual "ml" ([string]$purchase.package.capacity_unit) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:capacity_unit"
    Assert-DomainEqual 24 $purchase.package.total_inner "DOMAIN_SCENARIO_VALUE_INVALID:purchase:total_inner"
    Assert-DomainEqual 6000 $purchase.package.total_capacity "DOMAIN_SCENARIO_VALUE_INVALID:purchase:total_capacity"
    Assert-DomainEqual "2*12*250=6000" ([string]$purchase.package.formula) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:formula"
    Assert-DomainTrue ($null -eq $purchase.package.expiry_date) "DOMAIN_SCENARIO_VALUE_INVALID:purchase:expiry"

    $inventory = Get-DomainScenarioById $Fixtures "domain-inventory-multiple-products-v1"
    Assert-DomainExactProperties $inventory @("fixture_id", "scenario_type", "request", "candidates") "DOMAIN_SCENARIO_SHAPE_INVALID:inventory"
    Assert-DomainEqual "inventory_multiple_products" ([string]$inventory.scenario_type) "DOMAIN_SCENARIO_VALUE_INVALID:inventory:type"
    Assert-DomainExactProperties $inventory.request @("normalized_name", "quantity", "unit") "DOMAIN_SCENARIO_SHAPE_INVALID:inventory:request"
    Assert-DomainEqual "milk" ([string]$inventory.request.normalized_name) "DOMAIN_SCENARIO_VALUE_INVALID:inventory:name"
    Assert-DomainEqual 1 $inventory.request.quantity "DOMAIN_SCENARIO_VALUE_INVALID:inventory:quantity"
    Assert-DomainEqual "carton" ([string]$inventory.request.unit) "DOMAIN_SCENARIO_VALUE_INVALID:inventory:unit"
    $candidates = @($inventory.candidates)
    Assert-DomainEqual 2 $candidates.Count "DOMAIN_SCENARIO_VALUE_INVALID:inventory:candidate_count"
    Assert-DomainExactStringArray @("fixture-product-milk-whole-250", "fixture-product-milk-lowfat-250") @($candidates | ForEach-Object { [string]$_.product_id }) "DOMAIN_SCENARIO_VALUE_INVALID:inventory:candidate_ids"
    foreach ($candidate in $candidates) {
        Assert-DomainExactProperties $candidate @("product_id", "variant", "batch_id", "before_quantity", "after_quantity", "unit") "DOMAIN_SCENARIO_SHAPE_INVALID:inventory:candidate"
        Assert-DomainEqual $candidate.before_quantity $candidate.after_quantity "DOMAIN_SCENARIO_VALUE_INVALID:inventory:unchanged"
        Assert-DomainEqual "carton" ([string]$candidate.unit) "DOMAIN_SCENARIO_VALUE_INVALID:inventory:candidate_unit"
    }

    $nutrition = Get-DomainScenarioById $Fixtures "domain-nutrition-label-milk-v1"
    Assert-DomainExactProperties $nutrition @("fixture_id", "scenario_type", "product", "label") "DOMAIN_SCENARIO_SHAPE_INVALID:nutrition"
    Assert-DomainEqual "exact_product_label" ([string]$nutrition.scenario_type) "DOMAIN_SCENARIO_VALUE_INVALID:nutrition:type"
    Assert-DomainExactProperties $nutrition.label @("source_type", "source_ref", "profile_version", "applicable_product_id", "coverage", "raw_label", "parsed_values", "missing_fields") "DOMAIN_SCENARIO_SHAPE_INVALID:nutrition:label"
    Assert-DomainEqual "product_label" ([string]$nutrition.label.source_type) "DOMAIN_SCENARIO_VALUE_INVALID:nutrition:source_type"
    Assert-DomainEqual "partial" ([string]$nutrition.label.coverage) "DOMAIN_SCENARIO_VALUE_INVALID:nutrition:coverage"
    Assert-DomainExactStringArray @("fiber_g") $nutrition.label.missing_fields "DOMAIN_SCENARIO_VALUE_INVALID:nutrition:missing"
    Assert-DomainExactProperties $nutrition.label.parsed_values @("energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "sodium_mg") "DOMAIN_SCENARIO_SHAPE_INVALID:nutrition:parsed"

    $issue = Get-DomainScenarioById $Fixtures "domain-issue-amount-inventory-v1"
    Assert-DomainExactProperties $issue @("fixture_id", "scenario_type", "quantity_estimate", "inventory_candidates", "issue_codes") "DOMAIN_SCENARIO_SHAPE_INVALID:issue"
    Assert-DomainExactStringArray @("quantity_estimated", "inventory_multiple_candidates") $issue.issue_codes "DOMAIN_SCENARIO_VALUE_INVALID:issue:codes"

    $correction = Get-DomainScenarioById $Fixtures "domain-correction-eggs-2-to-3-v1"
    Assert-DomainExactProperties $correction @("fixture_id", "scenario_type", "original_meal", "original_inventory", "expected_delta") "DOMAIN_SCENARIO_SHAPE_INVALID:correction"
    Assert-DomainEqual 2 $correction.original_meal.quantity "DOMAIN_SCENARIO_VALUE_INVALID:correction:original"
    Assert-DomainEqual 3 $correction.expected_delta.effective_quantity "DOMAIN_SCENARIO_VALUE_INVALID:correction:effective"
    Assert-DomainEqual 1 $correction.expected_delta.quantity_delta "DOMAIN_SCENARIO_VALUE_INVALID:correction:delta"

    $mixed = Get-DomainScenarioById $Fixtures "domain-mixed-purchase-drink-v1"
    Assert-DomainExactProperties $mixed @("fixture_id", "scenario_type", "package", "pre_inventory", "expected") "DOMAIN_SCENARIO_SHAPE_INVALID:mixed"
    Assert-DomainExactStringArray @("purchase", "meal") @($mixed.expected.children | ForEach-Object { [string]$_.intent }) "DOMAIN_SCENARIO_VALUE_INVALID:mixed:order"
    Assert-DomainEqual 23 $mixed.expected.final_quantity "DOMAIN_SCENARIO_VALUE_INVALID:mixed:final"

    $effect1Pre = "meal_events=1|nutrition_snapshots=0|inventory_effects=0|issues=0|outbox=pending|envelope=fact_committed|receipt=0|daily_progress=0|terminal_idempotency=0"
    $effect1Post = "meal_events=1|nutrition_snapshots=0|inventory_effects=0|issues=0|outbox=retryable_failed|envelope=effects_pending|receipt=0|daily_progress=0|terminal_idempotency=0"
    Assert-DomainFaultScenario (Get-DomainScenarioById $Fixtures "domain-effect-nutrition-failure-v1") "domain-effect-nutrition-failure-v1" "effect_bundle_failure" "nutrition_snapshot_write" $effect1Pre "389EA70606C4DE90C1E7821FC614DAC037E38E58522310A75A65416DA44D823A" "nutrition_effect_write_failed" "effect_bundle_only" $effect1Post "6112F8CB61105FB25C41D0BE590A487CA514D673FE2C14BA9C6A2C4F70E6C47E"

    $effect3State = "meal_events=1|nutrition_snapshots=1|inventory_effects=1|issues=0|outbox=succeeded|envelope=effects_pending|receipt=0|daily_progress=0|terminal_idempotency=0|projection_energy=500"
    Assert-DomainFaultScenario (Get-DomainScenarioById $Fixtures "domain-finalizer-failure-concurrent-v1") "domain-finalizer-failure-concurrent-v1" "envelope_finalize_failure" "envelope_finalize_write" $effect3State "885388007517BA51211C12727DA556612A656C7E61587C7D9C0EE8D5F2EFD259" "envelope_finalize_write_failed" "envelope_finalize_only" $effect3State "885388007517BA51211C12727DA556612A656C7E61587C7D9C0EE8D5F2EFD259"

    $storage = Get-DomainScenarioById $Fixtures "domain-idempotency-conflict-v1"
    Assert-DomainExactProperties $storage @("fixture_id", "scenario_type", "original", "conflicts", "pre_state_vector", "pre_state_hash", "post_state_vector", "post_state_hash") "DOMAIN_SCENARIO_SHAPE_INVALID:storage"
    Assert-DomainExactProperties $storage.original @("key", "subject", "command", "digest", "result_ref") "DOMAIN_SCENARIO_SHAPE_INVALID:storage:original"
    Assert-DomainEqual "idem-fixed-001" ([string]$storage.original.key) "DOMAIN_SCENARIO_VALUE_INVALID:storage:key"
    Assert-DomainEqual "digest-apple-v1" ([string]$storage.original.digest) "DOMAIN_SCENARIO_VALUE_INVALID:storage:digest"
    Assert-DomainEqual 3 @($storage.conflicts).Count "DOMAIN_SCENARIO_VALUE_INVALID:storage:conflict_count"
    Assert-DomainExactStringArray @("changed_digest", "changed_subject", "changed_command") @($storage.conflicts | ForEach-Object { [string]$_.kind }) "DOMAIN_SCENARIO_VALUE_INVALID:storage:conflict_kinds"
    Assert-DomainEqual "8914D877E31D0575BE22673F17E1F978488148DC28684DE4C3B34FF68711BFD2" ([string]$storage.pre_state_hash) "DOMAIN_SCENARIO_VALUE_INVALID:storage:pre_hash"
    Assert-DomainEqual $storage.pre_state_vector $storage.post_state_vector "DOMAIN_SCENARIO_VALUE_INVALID:storage:state_changed"
    Assert-DomainEqual $storage.pre_state_hash $storage.post_state_hash "DOMAIN_SCENARIO_VALUE_INVALID:storage:hash_changed"
}

function Assert-DomainCases {
    param($CaseSet)

    $purchase = Get-DomainCaseById $CaseSet "CASE-PURCHASE-001"
    Assert-DomainCaseCommon $purchase "CASE-PURCHASE-001" @("REQ-PURCHASE-001") "5Lmw5LqG5Lik566x54mb5aW277yM5q+P566xMTLnm5LvvIzmr4/nm5IyNTBtbOOAgg==" "domain-purchase-milk-2x12x250-v1"
    Assert-DomainExactProperties $purchase.oracle @("fact_commit", "effect_bundle", "quantity_equation") "DOMAIN_CASE_ORACLE_INVALID:CASE-PURCHASE-001"
    Assert-DomainEqual 1 $purchase.oracle.fact_commit.purchase_event.event_count "DOMAIN_CASE_VALUE_INVALID:CASE-PURCHASE-001:purchase_event"
    Assert-DomainEqual 1 $purchase.oracle.effect_bundle.inventory_batch.batch_count "DOMAIN_CASE_VALUE_INVALID:CASE-PURCHASE-001:batch_count"
    Assert-DomainEqual "2*12*250=6000" ([string]$purchase.oracle.quantity_equation.formula) "DOMAIN_CASE_VALUE_INVALID:CASE-PURCHASE-001:formula"
    Assert-DomainEqual 6000 $purchase.oracle.quantity_equation.total_ml "DOMAIN_CASE_VALUE_INVALID:CASE-PURCHASE-001:total"

    $inventory = Get-DomainCaseById $CaseSet "CASE-INVENTORY-003"
    Assert-DomainCaseCommon $inventory "CASE-INVENTORY-003" @("REQ-PANTRY-002") "5pep6aSQ5Zad5LqG5LiA55uS54mb5aW244CC" "domain-inventory-multiple-products-v1"
    Assert-DomainExactProperties $inventory.oracle @("fact_commit", "effect_bundle") "DOMAIN_CASE_ORACLE_INVALID:CASE-INVENTORY-003"
    Assert-DomainEqual "committed" ([string]$inventory.oracle.fact_commit.meal_event.status) "DOMAIN_CASE_VALUE_INVALID:CASE-INVENTORY-003:fact"
    Assert-DomainEqual "skipped_ambiguous" ([string]$inventory.oracle.effect_bundle.inventory_match.status) "DOMAIN_CASE_VALUE_INVALID:CASE-INVENTORY-003:inventory"
    Assert-DomainEqual "inventory_multiple_candidates" ([string]$inventory.oracle.effect_bundle.issue.code) "DOMAIN_CASE_VALUE_INVALID:CASE-INVENTORY-003:issue"

    $nutrition = Get-DomainCaseById $CaseSet "CASE-NUTR-001"
    Assert-DomainCaseCommon $nutrition "CASE-NUTR-001" @("REQ-NUTR-001") "5Zad5LqG5LiA55uS6L+Z5Liq54mb5aW244CC" "domain-nutrition-label-milk-v1"
    Assert-DomainExactProperties $nutrition.oracle @("effect_bundle") "DOMAIN_CASE_ORACLE_INVALID:CASE-NUTR-001"
    Assert-DomainEqual "product_label" ([string]$nutrition.oracle.effect_bundle.nutrition_profile.source_type) "DOMAIN_CASE_VALUE_INVALID:CASE-NUTR-001:source_type"
    Assert-DomainEqual "exact_label_wins" ([string]$nutrition.oracle.effect_bundle.nutrition_profile.priority_rule) "DOMAIN_CASE_VALUE_INVALID:CASE-NUTR-001:priority"
    Assert-DomainEqual 1 $nutrition.oracle.effect_bundle.nutrition_snapshot.snapshot_count "DOMAIN_CASE_VALUE_INVALID:CASE-NUTR-001:snapshot"

    $issue = Get-DomainCaseById $CaseSet "CASE-ISSUE-001"
    Assert-DomainCaseCommon $issue "CASE-ISSUE-001" @("REQ-ISSUE-001") "5pep6aSQ5ZCD5LqG5aSn5qaC5LiA56KX6bqm54mH77yM55So55qE5piv5a626YeM55qE54mb5aW244CC" "domain-issue-amount-inventory-v1"
    Assert-DomainExactProperties $issue.oracle @("fact_commit", "effect_bundle", "presentation") "DOMAIN_CASE_ORACLE_INVALID:CASE-ISSUE-001"
    Assert-DomainEqual "committed_with_issues" ([string]$issue.oracle.fact_commit.meal_event.status) "DOMAIN_CASE_VALUE_INVALID:CASE-ISSUE-001:fact"
    Assert-DomainExactStringArray @("quantity_estimated", "inventory_multiple_candidates") @($issue.oracle.effect_bundle.issues | ForEach-Object { [string]$_.code }) "DOMAIN_CASE_VALUE_INVALID:CASE-ISSUE-001:issues"
    Assert-DomainEqual "skipped_ambiguous" ([string]$issue.oracle.effect_bundle.inventory_match.status) "DOMAIN_CASE_VALUE_INVALID:CASE-ISSUE-001:inventory"
    Assert-DomainEqual "consolidated_once" ([string]$issue.oracle.presentation.prompt_policy) "DOMAIN_CASE_VALUE_INVALID:CASE-ISSUE-001:presentation"

    $correction = Get-DomainCaseById $CaseSet "CASE-CORR-001"
    Assert-DomainCaseCommon $correction "CASE-CORR-001" @("REQ-CORR-001") "5Yia5omN6bih6JuL5LiN5pivMuS4qu+8jOaYrzPkuKrjgII=" "domain-correction-eggs-2-to-3-v1"
    Assert-DomainExactProperties $correction.oracle @("fact_commit", "effect_bundle", "finalization", "idempotency") "DOMAIN_CASE_ORACLE_INVALID:CASE-CORR-001"
    Assert-DomainEqual "change_amount" ([string]$correction.oracle.fact_commit.correction_event.operation) "DOMAIN_CASE_VALUE_INVALID:CASE-CORR-001:operation"
    Assert-DomainEqual "append_only" ([string]$correction.oracle.fact_commit.correction_event.write_policy) "DOMAIN_CASE_VALUE_INVALID:CASE-CORR-001:write_policy"
    Assert-DomainEqual 1 $correction.oracle.effect_bundle.nutrition_delta.egg_quantity_delta "DOMAIN_CASE_VALUE_INVALID:CASE-CORR-001:nutrition"
    Assert-DomainEqual 1 $correction.oracle.effect_bundle.inventory_effect.additional_egg_count "DOMAIN_CASE_VALUE_INVALID:CASE-CORR-001:inventory"
    Assert-DomainExactStringArray @("2026-08-11") $correction.oracle.finalization.affected_dates "DOMAIN_CASE_VALUE_INVALID:CASE-CORR-001:dates"
    Assert-DomainEqual 1 $correction.oracle.idempotency.max_correction_events "DOMAIN_CASE_VALUE_INVALID:CASE-CORR-001:idempotency"

    $mixed = Get-DomainCaseById $CaseSet "CASE-MIXED-001"
    Assert-DomainCaseCommon $mixed "CASE-MIXED-001" @("REQ-MIXED-001") "5Lmw5LqG5LiA566x54mb5aW277yM5Y+I5Zad5LqG5LiA55uS44CC" "domain-mixed-purchase-drink-v1"
    Assert-DomainExactProperties $mixed.oracle @("mixed", "effect_bundle", "finalization") "DOMAIN_CASE_ORACLE_INVALID:CASE-MIXED-001"
    Assert-DomainExactStringArray @("purchase", "meal") @($mixed.oracle.mixed.operation_results | ForEach-Object { [string]$_.intent }) "DOMAIN_CASE_VALUE_INVALID:CASE-MIXED-001:order"
    Assert-DomainExactStringArray @("0", "24", "23") @($mixed.oracle.effect_bundle.inventory_sequence | ForEach-Object { [string]$_ }) "DOMAIN_CASE_VALUE_INVALID:CASE-MIXED-001:inventory"
    Assert-DomainEqual 1 $mixed.oracle.finalization.envelope_finalize_count "DOMAIN_CASE_VALUE_INVALID:CASE-MIXED-001:finalization"
    Assert-DomainEqual $false $mixed.oracle.finalization.later_child_failure_rolls_back_purchase "DOMAIN_CASE_VALUE_INVALID:CASE-MIXED-001:isolation"

    $effect1 = Get-DomainCaseById $CaseSet "CASE-EFFECT-001"
    Assert-DomainCaseCommon $effect1 "CASE-EFFECT-001" @("REQ-SAFE-002") "5pep6aSQ5ZCD5LqG5LiA5Liq6Iu55p6c44CC" "domain-effect-nutrition-failure-v1"
    Assert-DomainExactProperties $effect1.oracle @("failure", "state_after_restart", "same_key_retry") "DOMAIN_CASE_ORACLE_INVALID:CASE-EFFECT-001"
    Assert-DomainEqual "nutrition_effect_write_failed" ([string]$effect1.oracle.failure.expected_error_code) "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-001:error"
    Assert-DomainEqual $true $effect1.oracle.failure.fact_commit_preserved "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-001:fact"
    Assert-DomainEqual 0 $effect1.oracle.failure.effect_bundle_business_write_count "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-001:writes"
    Assert-DomainEqual $false $effect1.oracle.failure.success_receipt_visible "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-001:receipt"
    Assert-DomainEqual "retry_missing_effect_only" ([string]$effect1.oracle.same_key_retry.action) "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-001:retry"

    $effect3 = Get-DomainCaseById $CaseSet "CASE-EFFECT-003"
    Assert-DomainCaseCommon $effect3 "CASE-EFFECT-003" @("REQ-SAFE-003") "5pep6aSQ5ZCD5LqG5LiA5Liq6Iu55p6c44CC" "domain-finalizer-failure-concurrent-v1"
    Assert-DomainExactProperties $effect3.oracle @("failure", "state_after_restart", "same_key_retry") "DOMAIN_CASE_ORACLE_INVALID:CASE-EFFECT-003"
    Assert-DomainEqual "envelope_finalize_write_failed" ([string]$effect3.oracle.failure.expected_error_code) "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-003:error"
    Assert-DomainEqual $false $effect3.oracle.failure.success_receipt_visible "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-003:receipt"
    Assert-DomainEqual 100 $effect3.oracle.same_key_retry.current_turn_increments.energy_kcal "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-003:increment"
    Assert-DomainEqual 650 $effect3.oracle.same_key_retry.committed_totals.energy_kcal "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-003:total"

    $storage = Get-DomainCaseById $CaseSet "CASE-STORAGE-007"
    Assert-DomainCaseCommon $storage "CASE-STORAGE-007" @("REQ-SAFE-003") "5pep6aSQ5ZCD5LqG5LiA5Liq6Iu55p6c44CC" "domain-idempotency-conflict-v1"
    Assert-DomainExactProperties $storage.oracle @("idempotency") "DOMAIN_CASE_ORACLE_INVALID:CASE-STORAGE-007"
    Assert-DomainEqual 3 @($storage.oracle.idempotency.conflicts).Count "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-007:conflicts"
    foreach ($conflict in @($storage.oracle.idempotency.conflicts)) {
        Assert-DomainEqual "failed" ([string]$conflict.status) "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-007:status"
        Assert-DomainEqual "idempotency_conflict" ([string]$conflict.error_code) "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-007:error"
        Assert-DomainEqual 0 $conflict.business_write_count "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-007:writes"
        Assert-DomainEqual $false $conflict.returned_original_result "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-007:result"
    }

    $retry = Get-DomainCaseById $CaseSet "CASE-STORAGE-001"
    Assert-DomainCaseCommon $retry "CASE-STORAGE-001" @("REQ-CORE-003", "REQ-SAFE-003") "5pep6aSQ5ZCD5LqG5LiA5Liq6Iu55p6c44CC572R57uc5ZON5bqU5Lii5aSx5ZCO77yM55So5ZCM5LiA5bmC562J6ZSu5ZKM55u45ZCM6L6T5YWl6YeN6K+V44CC" "domain-idempotency-conflict-v1"
    Assert-DomainExactProperties $retry.oracle @("idempotency") "DOMAIN_CASE_ORACLE_INVALID:CASE-STORAGE-001"
    Assert-DomainExactProperties $retry.oracle.idempotency @("original_key", "first_execution", "same_key_same_input") "DOMAIN_CASE_ORACLE_INVALID:CASE-STORAGE-001:idempotency"
    Assert-DomainEqual "idem-fixed-001" ([string]$retry.oracle.idempotency.original_key) "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:key"
    Assert-DomainEqual 1 $retry.oracle.idempotency.first_execution.meal_event_count "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:first_event"
    Assert-DomainEqual 1 $retry.oracle.idempotency.first_execution.inventory_effect_count "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:first_inventory"
    Assert-DomainEqual 1 $retry.oracle.idempotency.first_execution.product_template_count "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:first_template"
    Assert-DomainEqual $true $retry.oracle.idempotency.same_key_same_input.returned_exact_original_result "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:result"
    Assert-DomainEqual 0 $retry.oracle.idempotency.same_key_same_input.business_write_count "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:writes"
    Assert-DomainEqual 0 $retry.oracle.idempotency.same_key_same_input.meal_event_count_delta "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:event_delta"
    Assert-DomainEqual 0 $retry.oracle.idempotency.same_key_same_input.inventory_effect_count_delta "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:inventory_delta"
    Assert-DomainEqual 0 $retry.oracle.idempotency.same_key_same_input.product_template_count_delta "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:template_delta"
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
    Assert-DomainEqual "1.4.0" ([string]$CaseSet.version) "DOMAIN_CASE_SET_VERSION_INVALID"
    Assert-DomainExactProperties $CaseSet.package_invariants @(
        "adapters_may_rewrite_oracle", "technical_log", "technical_log_counts_as_record",
        "fact_commit_failure_business_write_count", "fact_commit_failure_forbidden_artifacts"
    ) "DOMAIN_CASE_PACKAGE_INVARIANTS_INVALID"
    Assert-DomainEqual $false $CaseSet.package_invariants.adapters_may_rewrite_oracle "DOMAIN_CASE_ORACLE_AUTHORITY_INVALID"
    Assert-DomainEqual "allowed_separate_redacted_only" ([string]$CaseSet.package_invariants.technical_log) "DOMAIN_CASE_TECHNICAL_LOG_INVALID"
    Assert-DomainEqual $false $CaseSet.package_invariants.technical_log_counts_as_record "DOMAIN_CASE_TECHNICAL_LOG_RECORD_INVALID"
    Assert-DomainEqual 0 $CaseSet.package_invariants.fact_commit_failure_business_write_count "DOMAIN_CASE_FAILED_FACT_WRITE_INVALID"
    Assert-DomainExactStringArray @(
        "meal_or_water_fact", "inventory_change", "nutrition_snapshot", "issue", "business_outbox",
        "daily_progress", "success_receipt", "terminal_idempotency_result"
    ) $CaseSet.package_invariants.fact_commit_failure_forbidden_artifacts "DOMAIN_CASE_FAILED_FACT_ARTIFACTS_INVALID"

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
        "domain_scenarios",
        "ops_security_scenarios"
    ) "DOMAIN_CASE_FIXTURE_SHAPE_INVALID:root"
    Assert-DomainEqual "diet-manager/core-fixtures-v1" ([string]$Fixtures.fixture_catalog_id) "DOMAIN_CASE_FIXTURE_ID_INVALID"
    Assert-DomainEqual "1.2.0" ([string]$Fixtures.version) "DOMAIN_CASE_FIXTURE_VERSION_INVALID"
    $scenarioIds = @($Fixtures.domain_scenarios | ForEach-Object { [string]$_.fixture_id })
    Assert-DomainExactStringArray $ExpectedDomainScenarioIds $scenarioIds "DOMAIN_CASE_SCENARIO_IDS_INVALID"
    Assert-DomainScenarioFixtures $Fixtures
    Assert-DomainCases $CaseSet
}

function Invoke-DomainMutation {
    param([string]$Name, [scriptblock]$Mutator, [string]$ExpectedPrefix, $CaseSet, $Fixtures)
    $caseCandidate = Copy-DomainJson $CaseSet
    $fixtureCandidate = Copy-DomainJson $Fixtures
    & $Mutator $caseCandidate $fixtureCandidate
    $rejected = $false
    try {
        Test-DomainCaseCandidate $caseCandidate $fixtureCandidate
    }
    catch {
        $message = [string]$_.Exception.Message
        if (-not $message.StartsWith($ExpectedPrefix, [StringComparison]::Ordinal)) {
            throw ("DOMAIN_MUTATION_WRONG_ERROR:{0}:expected={1}:actual={2}" -f $Name, $ExpectedPrefix, $message)
        }
        $rejected = $true
    }
    Assert-DomainTrue $rejected ("DOMAIN_MUTATION_SURVIVED:{0}" -f $Name)
    "{0}|PASS" -f $Name
}

$caseSet = Read-DomainJson $CasesPath "DOMAIN_CASE_SET_FILE_MISSING" "DOMAIN_CASE_SET_JSON_INVALID"
$fixtures = Read-DomainJson $FixturesPath "DOMAIN_CASE_FIXTURE_FILE_MISSING" "DOMAIN_CASE_FIXTURE_JSON_INVALID"
Test-DomainCaseCandidate $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-DROP-REQUIRED-CASE" {
    param($casesCandidate, $fixturesCandidate)
    $casesCandidate.cases = @($casesCandidate.cases | Where-Object { [string]$_.id -cne "CASE-PURCHASE-001" })
} "DOMAIN_CASE_IDS_INVALID" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-COLLAPSE-PACKAGE-QUANTITIES" {
    param($casesCandidate, $fixturesCandidate)
    $scenario = @($fixturesCandidate.domain_scenarios | Where-Object { [string]$_.fixture_id -ceq "domain-purchase-milk-2x12x250-v1" })[0]
    $scenario.package.total_inner = 1
} "DOMAIN_SCENARIO_VALUE_INVALID:purchase:total_inner" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-AUTOSELECT-INVENTORY" {
    param($casesCandidate, $fixturesCandidate)
    $scenario = @($fixturesCandidate.domain_scenarios | Where-Object { [string]$_.fixture_id -ceq "domain-inventory-multiple-products-v1" })[0]
    $scenario.candidates[0].after_quantity = 5
} "DOMAIN_SCENARIO_VALUE_INVALID:inventory:unchanged" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-OVERRIDE-EXACT-LABEL" {
    param($casesCandidate, $fixturesCandidate)
    $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-NUTR-001" })[0]
    $case.oracle.effect_bundle.nutrition_profile.priority_rule = "public_source_wins"
} "DOMAIN_CASE_VALUE_INVALID:CASE-NUTR-001:priority" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-SERIALIZE-ISSUES" {
    param($casesCandidate, $fixturesCandidate)
    $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-ISSUE-001" })[0]
    $case.oracle.presentation.prompt_policy = "serial_questionnaire"
} "DOMAIN_CASE_VALUE_INVALID:CASE-ISSUE-001:presentation" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-OVERWRITE-CORRECTION-TARGET" {
    param($casesCandidate, $fixturesCandidate)
    $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-CORR-001" })[0]
    $case.oracle.fact_commit.correction_event.write_policy = "overwrite_original"
} "DOMAIN_CASE_VALUE_INVALID:CASE-CORR-001:write_policy" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-REORDER-MIXED-CHILDREN" {
    param($casesCandidate, $fixturesCandidate)
    $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-MIXED-001" })[0]
    $case.oracle.mixed.operation_results = @($case.oracle.mixed.operation_results[1], $case.oracle.mixed.operation_results[0])
} "DOMAIN_CASE_VALUE_INVALID:CASE-MIXED-001:order" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-ROLLBACK-FACT-ON-EFFECT-FAILURE" {
    param($casesCandidate, $fixturesCandidate)
    $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-EFFECT-001" })[0]
    $case.oracle.failure.fact_commit_preserved = $false
} "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-001:fact" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-EXPOSE-FINALIZER-SUCCESS" {
    param($casesCandidate, $fixturesCandidate)
    $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-EFFECT-003" })[0]
    $case.oracle.failure.success_receipt_visible = $true
} "DOMAIN_CASE_VALUE_INVALID:CASE-EFFECT-003:receipt" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-REUSE-IDEMPOTENCY-RESULT" {
    param($casesCandidate, $fixturesCandidate)
    $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-STORAGE-007" })[0]
    $case.oracle.idempotency.conflicts[0].returned_original_result = $true
} "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-007:result" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-REEXECUTE-SAME-IDEMPOTENCY-KEY" {
    param($casesCandidate, $fixturesCandidate)
    $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-STORAGE-001" })[0]
    $case.oracle.idempotency.same_key_same_input.business_write_count = 1
} "DOMAIN_CASE_VALUE_INVALID:CASE-STORAGE-001:writes" $caseSet $fixtures

Invoke-DomainMutation "MUT-DOMAIN-ALLOW-FAILED-FACT-BUSINESS-WRITE" {
    param($casesCandidate, $fixturesCandidate)
    $casesCandidate.package_invariants.fact_commit_failure_business_write_count = 1
} "DOMAIN_CASE_FAILED_FACT_WRITE_INVALID" $caseSet $fixtures

"DOMAIN_ACCEPTANCE_CASES|PASS|version=1.4.0|cases=10|scenarios=9|mutations=12"
