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

function Assert-CaseTrue {
    param([bool]$Condition, [string]$Code)
    if (-not $Condition) {
        throw $Code
    }
}

function Assert-CaseEqual {
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

function Assert-PlainObject {
    param($Value, [string]$Code)
    Assert-CaseTrue ($null -ne $Value) $Code
    Assert-CaseTrue (-not ($Value -is [System.Array])) $Code
    Assert-CaseTrue (-not ($Value -is [string])) $Code
    Assert-CaseTrue ($Value -is [psobject]) $Code
}

function Assert-ExactProperties {
    param($Value, [string[]]$Expected, [string]$Code)
    Assert-PlainObject $Value $Code
    $actual = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-CaseEqual $Expected.Count $actual.Count ("{0}:property_count" -f $Code)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-CaseEqual $Expected[$index] $actual[$index] ("{0}:property_{1}" -f $Code, $index)
        Assert-CaseEqual "NoteProperty" ([string]$Value.PSObject.Properties[$actual[$index]].MemberType) ("{0}:member_type_{1}" -f $Code, $index)
    }
}

function Assert-ExactStringArray {
    param([string[]]$Expected, $Actual, [string]$Code)
    Assert-CaseTrue ($Actual -is [System.Array]) ("{0}:array" -f $Code)
    $values = @($Actual)
    Assert-CaseEqual $Expected.Count $values.Count ("{0}:count" -f $Code)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-CaseTrue ($values[$index] -is [string]) ("{0}:type_{1}" -f $Code, $index)
        Assert-CaseEqual $Expected[$index] ([string]$values[$index]) ("{0}:value_{1}" -f $Code, $index)
    }
}

function Assert-NullValue {
    param($Value, [string]$Code)
    Assert-CaseTrue ($null -eq $Value) $Code
}

function Read-CaseJson {
    param([string]$Path, [string]$MissingCode, [string]$InvalidCode)
    Assert-CaseTrue ([IO.File]::Exists($Path)) $MissingCode
    try {
        $text = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
        return ($text | ConvertFrom-Json)
    }
    catch {
        throw ("{0}:{1}" -f $InvalidCode, $_.Exception.GetType().Name)
    }
}

function Get-Utf8Base64 {
    param([string]$Value)
    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
}

function Copy-CaseJson {
    param($Value)
    return (($Value | ConvertTo-Json -Depth 64 -Compress) | ConvertFrom-Json)
}

function Get-CaseById {
    param($CaseSet, [string]$Id)
    $rows = @($CaseSet.cases | Where-Object { [string]$_.id -eq $Id })
    Assert-CaseEqual 1 $rows.Count ("CORE_CASE_ID_INVALID:{0}" -f $Id)
    return $rows[0]
}

function Assert-CommonCase {
    param($Case, [string]$Id, [string[]]$RequirementIds, [string]$SourceBase64)
    Assert-ExactProperties $Case @("id", "requirement_ids", "stage", "source_text", "setup", "oracle", "forbidden") ("CORE_CASE_SHAPE_INVALID:{0}" -f $Id)
    Assert-CaseEqual $Id ([string]$Case.id) ("CORE_CASE_ID_INVALID:{0}" -f $Id)
    Assert-ExactStringArray $RequirementIds $Case.requirement_ids ("CORE_CASE_REQUIREMENTS_INVALID:{0}" -f $Id)
    Assert-CaseEqual "PRODUCT-0.1" ([string]$Case.stage) ("CORE_CASE_STAGE_INVALID:{0}" -f $Id)
    Assert-CaseEqual $SourceBase64 (Get-Utf8Base64 ([string]$Case.source_text)) ("CORE_CASE_SOURCE_INVALID:{0}" -f $Id)
    Assert-ExactProperties $Case.setup @("environment_fixture", "goals_fixture", "query_view_fixture", "prior_context") ("CORE_CASE_SETUP_INVALID:{0}" -f $Id)
    Assert-CaseEqual "env-zh-cn-20260811" ([string]$Case.setup.environment_fixture) ("CORE_CASE_ENVIRONMENT_INVALID:{0}" -f $Id)
    Assert-CaseTrue ($Case.setup.prior_context -is [System.Array]) ("CORE_CASE_CONTEXT_INVALID:{0}" -f $Id)
    Assert-CaseEqual 0 @($Case.setup.prior_context).Count ("CORE_CASE_CONTEXT_INVALID:{0}" -f $Id)
    Assert-CaseTrue ($Case.forbidden -is [System.Array]) ("CORE_CASE_FORBIDDEN_INVALID:{0}" -f $Id)
}

function Assert-Command {
    param($Command, [string]$Intent, [string]$Id)
    Assert-ExactProperties $Command @("intent", "status") ("CORE_CASE_COMMAND_INVALID:{0}" -f $Id)
    Assert-CaseEqual $Intent ([string]$Command.intent) ("CORE_CASE_INTENT_INVALID:{0}" -f $Id)
    Assert-CaseEqual "committed" ([string]$Command.status) ("CORE_CASE_STATUS_INVALID:{0}" -f $Id)
}

function Assert-MealItem {
    param($Item, [int]$Order, [string]$Kind, [string]$Name, [int]$Quantity, [string]$Unit, [bool]$Estimated, [string]$Id)
    Assert-ExactProperties $Item @("order", "kind", "normalized_name", "quantity", "unit", "estimated") ("CORE_CASE_ITEM_SHAPE_INVALID:{0}:{1}" -f $Id, $Order)
    Assert-CaseEqual $Order ([int]$Item.order) ("CORE_CASE_ITEM_ORDER_INVALID:{0}:{1}" -f $Id, $Order)
    Assert-CaseEqual $Kind ([string]$Item.kind) ("CORE_CASE_ITEM_KIND_INVALID:{0}:{1}" -f $Id, $Order)
    Assert-CaseEqual $Name ([string]$Item.normalized_name) ("CORE_CASE_ITEM_NAME_INVALID:{0}:{1}" -f $Id, $Order)
    Assert-CaseEqual $Quantity ([int]$Item.quantity) ("CORE_CASE_ITEM_QUANTITY_INVALID:{0}:{1}" -f $Id, $Order)
    Assert-CaseEqual $Unit ([string]$Item.unit) ("CORE_CASE_ITEM_UNIT_INVALID:{0}:{1}" -f $Id, $Order)
    Assert-CaseEqual $Estimated ([bool]$Item.estimated) ("CORE_CASE_ITEM_EVIDENCE_INVALID:{0}:{1}" -f $Id, $Order)
}

function Assert-DailyProgressAuthority {
    param($Progress, [string]$Id)
    Assert-ExactProperties $Progress @("authority", "count") ("CORE_CASE_PROGRESS_INVALID:{0}" -f $Id)
    Assert-CaseEqual "same_envelope_finalize" ([string]$Progress.authority) ("CORE_CASE_PROGRESS_AUTHORITY_INVALID:{0}" -f $Id)
    Assert-CaseEqual 1 ([int]$Progress.count) ("CORE_CASE_PROGRESS_COUNT_INVALID:{0}" -f $Id)
}

function Assert-CaseSetRoot {
    param($CaseSet)
    Assert-ExactProperties $CaseSet @("case_set_id", "version", "contract", "fixture_catalog", "package_invariants", "cases") "CORE_CASE_SET_SHAPE_INVALID:root"
}

function Test-CaseSetCandidate {
    param($CaseSet, $Fixtures)

    Assert-CaseSetRoot $CaseSet
    Assert-CaseEqual "diet-manager/core-acceptance-cases-v1" ([string]$CaseSet.case_set_id) "CORE_CASE_SET_ID_INVALID"
    Assert-CaseEqual "1.0.0" ([string]$CaseSet.version) "CORE_CASE_SET_VERSION_INVALID"
    Assert-ExactProperties $CaseSet.contract @("contract_id", "contract_version") "CORE_CASE_CONTRACT_INVALID"
    Assert-CaseEqual "diet-manager/contract-v2" ([string]$CaseSet.contract.contract_id) "CORE_CASE_CONTRACT_ID_INVALID"
    Assert-CaseEqual 2 ([int]$CaseSet.contract.contract_version) "CORE_CASE_CONTRACT_VERSION_INVALID"
    Assert-CaseEqual "shared/acceptance-cases/fixtures/core-v1.json" ([string]$CaseSet.fixture_catalog) "CORE_CASE_FIXTURE_PATH_INVALID"

    Assert-ExactProperties $CaseSet.package_invariants @(
        "adapters_may_rewrite_oracle",
        "technical_log",
        "technical_log_counts_as_record",
        "fact_commit_failure_business_write_count",
        "fact_commit_failure_forbidden_artifacts"
    ) "CORE_CASE_PACKAGE_INVARIANTS_INVALID"
    Assert-CaseEqual $false ([bool]$CaseSet.package_invariants.adapters_may_rewrite_oracle) "CORE_CASE_ORACLE_AUTHORITY_INVALID"
    Assert-CaseEqual "allowed_separate_redacted_only" ([string]$CaseSet.package_invariants.technical_log) "CORE_CASE_TECHNICAL_LOG_INVALID"
    Assert-CaseEqual $false ([bool]$CaseSet.package_invariants.technical_log_counts_as_record) "CORE_CASE_TECHNICAL_LOG_RECORD_INVALID"
    Assert-CaseEqual 0 ([int]$CaseSet.package_invariants.fact_commit_failure_business_write_count) "CORE_CASE_FAILED_FACT_WRITE_INVALID"
    Assert-ExactStringArray @(
        "meal_or_water_fact",
        "inventory_change",
        "nutrition_snapshot",
        "issue",
        "business_outbox",
        "daily_progress",
        "success_receipt",
        "terminal_idempotency_result"
    ) $CaseSet.package_invariants.fact_commit_failure_forbidden_artifacts "CORE_CASE_FAILED_FACT_ARTIFACTS_INVALID"

    Assert-CaseTrue ($CaseSet.cases -is [System.Array]) "CORE_CASE_SET_SHAPE_INVALID:cases"
    $expectedIds = @("CASE-MEAL-001", "CASE-MEAL-021", "CASE-WATER-001", "CASE-RECEIPT-001", "CASE-QUERY-001")
    $actualIds = @($CaseSet.cases | ForEach-Object { [string]$_.id })
    Assert-ExactStringArray $expectedIds $actualIds "CORE_CASE_IDS_INVALID"
    Assert-CaseEqual $actualIds.Count @($actualIds | Select-Object -Unique).Count "CORE_CASE_IDS_DUPLICATE"

    $meal = Get-CaseById $CaseSet "CASE-MEAL-001"
    Assert-CommonCase $meal "CASE-MEAL-001" @("REQ-MEAL-001", "REQ-TIME-001", "REQ-RECEIPT-001") "5pep6aSQ5ZCD5LqG5Lik5Liq6bih6JuL44CB5Lik54mH6Z2i5YyF77yM5Zad5LqGMjUwbWzniZvlpbbjgII="
    Assert-CaseEqual "goals-six-metric-v1" ([string]$meal.setup.goals_fixture) "CORE_CASE_GOALS_INVALID:CASE-MEAL-001"
    Assert-NullValue $meal.setup.query_view_fixture "CORE_CASE_QUERY_FIXTURE_INVALID:CASE-MEAL-001"
    Assert-ExactProperties $meal.oracle @("command", "parsing", "fact_commit", "finalization") "CORE_CASE_ORACLE_INVALID:CASE-MEAL-001"
    Assert-Command $meal.oracle.command "record_meal" "CASE-MEAL-001"
    Assert-ExactProperties $meal.oracle.parsing @("items") "CORE_CASE_PARSING_INVALID:CASE-MEAL-001"
    $mealItems = @($meal.oracle.parsing.items)
    Assert-CaseEqual 3 $mealItems.Count "CORE_CASE_ITEM_COUNT_INVALID:CASE-MEAL-001"
    Assert-MealItem $mealItems[0] 0 "food" "egg" 2 "piece" $false "CASE-MEAL-001"
    Assert-MealItem $mealItems[1] 1 "food" "bread" 2 "slice" $false "CASE-MEAL-001"
    Assert-MealItem $mealItems[2] 2 "nutritious_drink" "milk" 250 "ml" $false "CASE-MEAL-001"
    Assert-ExactProperties $meal.oracle.fact_commit @("meal_event") "CORE_CASE_FACT_INVALID:CASE-MEAL-001"
    Assert-ExactProperties $meal.oracle.fact_commit.meal_event @("event_count", "meal_id_required", "water_event_count") "CORE_CASE_MEAL_EVENT_INVALID:CASE-MEAL-001"
    Assert-CaseEqual 1 ([int]$meal.oracle.fact_commit.meal_event.event_count) "CORE_CASE_MEAL_EVENT_COUNT_INVALID:CASE-MEAL-001"
    Assert-CaseEqual $true ([bool]$meal.oracle.fact_commit.meal_event.meal_id_required) "CORE_CASE_MEAL_ID_INVALID:CASE-MEAL-001"
    Assert-CaseEqual 0 ([int]$meal.oracle.fact_commit.meal_event.water_event_count) "CORE_CASE_MILK_CLASSIFICATION_INVALID"
    Assert-ExactProperties $meal.oracle.finalization @("daily_progress") "CORE_CASE_FINALIZATION_INVALID:CASE-MEAL-001"
    Assert-DailyProgressAuthority $meal.oracle.finalization.daily_progress "CASE-MEAL-001"
    Assert-ExactStringArray @("milk_as_plain_water_event", "alternate_single_item_schema", "invented_user_fact", "internal_id_in_receipt", "progress_from_extra_query") $meal.forbidden "CORE_CASE_FORBIDDEN_INVALID:CASE-MEAL-001"

    $single = Get-CaseById $CaseSet "CASE-MEAL-021"
    Assert-CommonCase $single "CASE-MEAL-021" @("REQ-MEAL-001") "5ZCD5LqG5LiA5Liq6Iu55p6c44CC"
    Assert-CaseEqual "goals-six-metric-v1" ([string]$single.setup.goals_fixture) "CORE_CASE_GOALS_INVALID:CASE-MEAL-021"
    Assert-NullValue $single.setup.query_view_fixture "CORE_CASE_QUERY_FIXTURE_INVALID:CASE-MEAL-021"
    Assert-ExactProperties $single.oracle @("command", "parsing", "fact_commit", "finalization") "CORE_CASE_ORACLE_INVALID:CASE-MEAL-021"
    Assert-Command $single.oracle.command "record_meal" "CASE-MEAL-021"
    Assert-ExactProperties $single.oracle.parsing @("items") "CORE_CASE_PARSING_INVALID:CASE-MEAL-021"
    $singleItems = @($single.oracle.parsing.items)
    Assert-CaseEqual 1 $singleItems.Count "CORE_CASE_ITEM_COUNT_INVALID:CASE-MEAL-021"
    Assert-MealItem $singleItems[0] 0 "food" "apple" 1 "piece" $false "CASE-MEAL-021"
    Assert-ExactProperties $single.oracle.fact_commit @("meal_event") "CORE_CASE_FACT_INVALID:CASE-MEAL-021"
    Assert-ExactProperties $single.oracle.fact_commit.meal_event @("event_count", "meal_id_required", "water_event_count") "CORE_CASE_MEAL_EVENT_INVALID:CASE-MEAL-021"
    Assert-CaseEqual 1 ([int]$single.oracle.fact_commit.meal_event.event_count) "CORE_CASE_MEAL_EVENT_COUNT_INVALID:CASE-MEAL-021"
    Assert-CaseEqual $true ([bool]$single.oracle.fact_commit.meal_event.meal_id_required) "CORE_CASE_MEAL_ID_INVALID:CASE-MEAL-021"
    Assert-CaseEqual 0 ([int]$single.oracle.fact_commit.meal_event.water_event_count) "CORE_CASE_WATER_EVENT_INVALID:CASE-MEAL-021"
    Assert-ExactProperties $single.oracle.finalization @("daily_progress") "CORE_CASE_FINALIZATION_INVALID:CASE-MEAL-021"
    Assert-DailyProgressAuthority $single.oracle.finalization.daily_progress "CASE-MEAL-021"
    Assert-ExactStringArray @("alternate_single_item_schema", "missing_meal_id", "invented_user_fact") $single.forbidden "CORE_CASE_FORBIDDEN_INVALID:CASE-MEAL-021"

    $water = Get-CaseById $CaseSet "CASE-WATER-001"
    Assert-CommonCase $water "CASE-WATER-001" @("REQ-WATER-001", "REQ-TIME-001") "5Zad5LqGNTAwbWznmb3msLTjgII="
    Assert-CaseEqual "goals-six-metric-v1" ([string]$water.setup.goals_fixture) "CORE_CASE_GOALS_INVALID:CASE-WATER-001"
    Assert-NullValue $water.setup.query_view_fixture "CORE_CASE_QUERY_FIXTURE_INVALID:CASE-WATER-001"
    Assert-ExactProperties $water.oracle @("command", "fact_commit", "finalization") "CORE_CASE_ORACLE_INVALID:CASE-WATER-001"
    Assert-Command $water.oracle.command "record_water" "CASE-WATER-001"
    Assert-ExactProperties $water.oracle.fact_commit @("water_event") "CORE_CASE_FACT_INVALID:CASE-WATER-001"
    Assert-ExactProperties $water.oracle.fact_commit.water_event @("event_count", "plain_water_ml", "estimated", "meal_event_count") "CORE_CASE_WATER_EVENT_INVALID:CASE-WATER-001"
    Assert-CaseEqual 1 ([int]$water.oracle.fact_commit.water_event.event_count) "CORE_CASE_WATER_EVENT_COUNT_INVALID"
    Assert-CaseEqual 500 ([int]$water.oracle.fact_commit.water_event.plain_water_ml) "CORE_CASE_WATER_AMOUNT_INVALID"
    Assert-CaseEqual $false ([bool]$water.oracle.fact_commit.water_event.estimated) "CORE_CASE_WATER_EVIDENCE_INVALID"
    Assert-CaseEqual 0 ([int]$water.oracle.fact_commit.water_event.meal_event_count) "CORE_CASE_WATER_CLASSIFICATION_INVALID"
    Assert-ExactProperties $water.oracle.finalization @("daily_progress") "CORE_CASE_FINALIZATION_INVALID:CASE-WATER-001"
    Assert-DailyProgressAuthority $water.oracle.finalization.daily_progress "CASE-WATER-001"
    Assert-ExactStringArray @("water_as_meal_event", "estimated_explicit_amount", "duplicate_hydration_contribution", "internal_id_in_receipt") $water.forbidden "CORE_CASE_FORBIDDEN_INVALID:CASE-WATER-001"

    $receipt = Get-CaseById $CaseSet "CASE-RECEIPT-001"
    Assert-CommonCase $receipt "CASE-RECEIPT-001" @("REQ-RECEIPT-001", "REQ-TIME-001", "REQ-MEAL-001") "5pep6aSQ5ZCD5LqG5Lik5Liq6bih6JuL44CB5Lik54mH6Z2i5YyF77yM5Zad5LqGMjUwbWzniZvlpbbjgII="
    Assert-CaseEqual "goals-six-metric-v1" ([string]$receipt.setup.goals_fixture) "CORE_CASE_GOALS_INVALID:CASE-RECEIPT-001"
    Assert-NullValue $receipt.setup.query_view_fixture "CORE_CASE_QUERY_FIXTURE_INVALID:CASE-RECEIPT-001"
    Assert-ExactProperties $receipt.oracle @("receipt") "CORE_CASE_ORACLE_INVALID:CASE-RECEIPT-001"
    Assert-ExactProperties $receipt.oracle.receipt @("authority", "blocks", "title_single_line", "item_line_policy", "dish_components_same_line", "progress_last") "CORE_CASE_RECEIPT_INVALID"
    Assert-CaseEqual "same_envelope_finalize" ([string]$receipt.oracle.receipt.authority) "CORE_CASE_RECEIPT_AUTHORITY_INVALID"
    Assert-ExactStringArray @("title", "item_lines", "progress") $receipt.oracle.receipt.blocks "CORE_CASE_RECEIPT_BLOCKS_INVALID"
    Assert-CaseEqual $true ([bool]$receipt.oracle.receipt.title_single_line) "CORE_CASE_RECEIPT_TITLE_INVALID"
    Assert-CaseEqual "one_line_per_dish_food_or_drink" ([string]$receipt.oracle.receipt.item_line_policy) "CORE_CASE_RECEIPT_ITEM_POLICY_INVALID"
    Assert-CaseEqual $true ([bool]$receipt.oracle.receipt.dish_components_same_line) "CORE_CASE_RECEIPT_COMPONENT_POLICY_INVALID"
    Assert-CaseEqual $true ([bool]$receipt.oracle.receipt.progress_last) "CORE_CASE_RECEIPT_PROGRESS_ORDER_INVALID"
    Assert-ExactStringArray @("internal_id_in_receipt", "progress_not_last", "component_split_across_lines", "progress_from_extra_query", "success_from_nonterminal_state") $receipt.forbidden "CORE_CASE_FORBIDDEN_INVALID:CASE-RECEIPT-001"

    $query = Get-CaseById $CaseSet "CASE-QUERY-001"
    Assert-CommonCase $query "CASE-QUERY-001" @("REQ-QUERY-001", "REQ-TIME-001") "5LuK5aSp5ZCD5LqG5LuA5LmI77yf"
    Assert-NullValue $query.setup.goals_fixture "CORE_CASE_GOALS_INVALID:CASE-QUERY-001"
    Assert-CaseEqual "query-current-day-meals-v1" ([string]$query.setup.query_view_fixture) "CORE_CASE_QUERY_FIXTURE_INVALID:CASE-QUERY-001"
    Assert-ExactProperties $query.oracle @("query") "CORE_CASE_ORACLE_INVALID:CASE-QUERY-001"
    Assert-ExactProperties $query.oracle.query @("date_range", "record_filter", "result_order", "expected_fixture_record_ids", "display_times", "business_write_count") "CORE_CASE_QUERY_INVALID"
    Assert-ExactProperties $query.oracle.query.date_range @("start", "end", "timezone") "CORE_CASE_QUERY_RANGE_INVALID"
    Assert-CaseEqual "2026-08-11T00:00:00+08:00" ([string]$query.oracle.query.date_range.start) "CORE_CASE_QUERY_START_INVALID"
    Assert-CaseEqual "2026-08-12T00:00:00+08:00" ([string]$query.oracle.query.date_range.end) "CORE_CASE_QUERY_END_INVALID"
    Assert-CaseEqual "Asia/Shanghai" ([string]$query.oracle.query.date_range.timezone) "CORE_CASE_QUERY_TIMEZONE_INVALID"
    Assert-CaseEqual "active_only" ([string]$query.oracle.query.record_filter) "CORE_CASE_QUERY_FILTER_INVALID"
    Assert-CaseEqual "occurred_at_ascending" ([string]$query.oracle.query.result_order) "CORE_CASE_QUERY_ORDER_INVALID"
    Assert-ExactStringArray @("fixture-meal-active-breakfast", "fixture-meal-active-apple") $query.oracle.query.expected_fixture_record_ids "CORE_CASE_QUERY_RESULTS_INVALID"
    Assert-ExactStringArray @("07:30", "08:10") $query.oracle.query.display_times "CORE_CASE_QUERY_DISPLAY_INVALID"
    Assert-CaseEqual 0 ([int]$query.oracle.query.business_write_count) "CORE_CASE_QUERY_WRITE_INVALID"
    Assert-ExactStringArray @("business_write", "superseded_record_returned", "voided_record_returned", "internal_id_in_output", "invented_example_data") $query.forbidden "CORE_CASE_FORBIDDEN_INVALID:CASE-QUERY-001"

    Assert-ExactProperties $Fixtures @("fixture_catalog_id", "version", "environments", "goals", "query_views") "CORE_CASE_FIXTURE_SHAPE_INVALID:root"
    Assert-CaseEqual "diet-manager/core-fixtures-v1" ([string]$Fixtures.fixture_catalog_id) "CORE_CASE_FIXTURE_ID_INVALID"
    Assert-CaseEqual "1.0.0" ([string]$Fixtures.version) "CORE_CASE_FIXTURE_VERSION_INVALID"
    Assert-CaseEqual 1 @($Fixtures.environments).Count "CORE_CASE_ENVIRONMENT_COUNT_INVALID"
    Assert-CaseEqual 1 @($Fixtures.goals).Count "CORE_CASE_GOALS_COUNT_INVALID"
    Assert-CaseEqual 1 @($Fixtures.query_views).Count "CORE_CASE_QUERY_VIEW_COUNT_INVALID"

    $environment = @($Fixtures.environments)[0]
    Assert-ExactProperties $environment @("fixture_id", "clock", "timezone", "locale", "week_start") "CORE_CASE_ENVIRONMENT_SHAPE_INVALID"
    Assert-CaseEqual "env-zh-cn-20260811" ([string]$environment.fixture_id) "CORE_CASE_ENVIRONMENT_ID_INVALID"
    Assert-CaseEqual "2026-08-11T08:30:00+08:00" ([string]$environment.clock) "CORE_CASE_CLOCK_INVALID"
    Assert-CaseEqual "Asia/Shanghai" ([string]$environment.timezone) "CORE_CASE_TIMEZONE_INVALID"
    Assert-CaseEqual "zh-CN" ([string]$environment.locale) "CORE_CASE_LOCALE_INVALID"
    Assert-CaseEqual "monday" ([string]$environment.week_start) "CORE_CASE_WEEK_START_INVALID"

    $goals = @($Fixtures.goals)[0]
    Assert-ExactProperties $goals @("fixture_id", "version", "timezone", "metrics") "CORE_CASE_GOALS_SHAPE_INVALID"
    Assert-CaseEqual "goals-six-metric-v1" ([string]$goals.fixture_id) "CORE_CASE_GOALS_ID_INVALID"
    Assert-CaseEqual 1 ([int]$goals.version) "CORE_CASE_GOALS_VERSION_INVALID"
    Assert-CaseEqual "Asia/Shanghai" ([string]$goals.timezone) "CORE_CASE_GOALS_TIMEZONE_INVALID"
    $expectedMetrics = @(
        @("energy_kcal", 2000, "kcal"),
        @("protein_g", 75, "g"),
        @("fat_g", 60, "g"),
        @("carbohydrate_g", 250, "g"),
        @("fiber_g", 25, "g"),
        @("water_ml", 2500, "ml")
    )
    $metrics = @($goals.metrics)
    Assert-CaseEqual 6 $metrics.Count "CORE_CASE_GOAL_METRIC_COUNT_INVALID"
    for ($index = 0; $index -lt $expectedMetrics.Count; $index++) {
        Assert-ExactProperties $metrics[$index] @("metric", "target", "unit") ("CORE_CASE_GOAL_METRIC_SHAPE_INVALID:{0}" -f $index)
        Assert-CaseEqual $expectedMetrics[$index][0] ([string]$metrics[$index].metric) ("CORE_CASE_GOAL_METRIC_INVALID:{0}" -f $index)
        Assert-CaseEqual $expectedMetrics[$index][1] ([int]$metrics[$index].target) ("CORE_CASE_GOAL_TARGET_INVALID:{0}" -f $index)
        Assert-CaseEqual $expectedMetrics[$index][2] ([string]$metrics[$index].unit) ("CORE_CASE_GOAL_UNIT_INVALID:{0}" -f $index)
    }

    $view = @($Fixtures.query_views)[0]
    Assert-ExactProperties $view @("fixture_id", "date", "timezone", "records") "CORE_CASE_QUERY_VIEW_SHAPE_INVALID"
    Assert-CaseEqual "query-current-day-meals-v1" ([string]$view.fixture_id) "CORE_CASE_QUERY_VIEW_ID_INVALID"
    Assert-CaseEqual "2026-08-11" ([string]$view.date) "CORE_CASE_QUERY_VIEW_DATE_INVALID"
    Assert-CaseEqual "Asia/Shanghai" ([string]$view.timezone) "CORE_CASE_QUERY_VIEW_TIMEZONE_INVALID"
    $records = @($view.records)
    Assert-CaseEqual 4 $records.Count "CORE_CASE_QUERY_RECORD_COUNT_INVALID"
    $expectedRecords = @(
        @("fixture-meal-active-breakfast", "active", "2026-08-11T07:30:00+08:00", "07:30", "MDc6MzAg6bih6JuL5ZKM6Z2i5YyF"),
        @("fixture-meal-active-apple", "active", "2026-08-11T08:10:00+08:00", "08:10", "MDg6MTAg6Iu55p6c"),
        @("fixture-meal-superseded", "superseded", "2026-08-11T06:50:00+08:00", "06:50", "c3VwZXJzZWRlZA=="),
        @("fixture-meal-voided", "voided", "2026-08-11T08:20:00+08:00", "08:20", "dm9pZGVk")
    )
    for ($index = 0; $index -lt $expectedRecords.Count; $index++) {
        Assert-ExactProperties $records[$index] @("fixture_record_id", "lifecycle", "occurred_at", "display_time", "summary") ("CORE_CASE_QUERY_RECORD_SHAPE_INVALID:{0}" -f $index)
        Assert-CaseEqual $expectedRecords[$index][0] ([string]$records[$index].fixture_record_id) ("CORE_CASE_QUERY_RECORD_ID_INVALID:{0}" -f $index)
        Assert-CaseEqual $expectedRecords[$index][1] ([string]$records[$index].lifecycle) ("CORE_CASE_QUERY_RECORD_LIFECYCLE_INVALID:{0}" -f $index)
        Assert-CaseEqual $expectedRecords[$index][2] ([string]$records[$index].occurred_at) ("CORE_CASE_QUERY_RECORD_TIME_INVALID:{0}" -f $index)
        Assert-CaseEqual $expectedRecords[$index][3] ([string]$records[$index].display_time) ("CORE_CASE_QUERY_RECORD_DISPLAY_INVALID:{0}" -f $index)
        Assert-CaseEqual $expectedRecords[$index][4] (Get-Utf8Base64 ([string]$records[$index].summary)) ("CORE_CASE_QUERY_RECORD_SUMMARY_INVALID:{0}" -f $index)
    }
}

function Invoke-CaseMutation {
    param(
        [string]$Name,
        [scriptblock]$Mutate,
        [string]$ExpectedErrorPrefix,
        $CaseSet,
        $Fixtures
    )

    $candidate = Copy-CaseJson $CaseSet
    & $Mutate $candidate
    $notRejected = "{0}:NOT_REJECTED" -f $Name
    try {
        Test-CaseSetCandidate $candidate $Fixtures
        throw $notRejected
    }
    catch {
        $message = [string]$_.Exception.Message
        if ($message -eq $notRejected) {
            throw $message
        }
        if (-not $message.StartsWith($ExpectedErrorPrefix, [StringComparison]::Ordinal)) {
            throw ("{0}:WRONG_ERROR:{1}" -f $Name, $message)
        }
    }
    "{0}|PASS" -f $Name
}

$caseSet = Read-CaseJson $CasesPath "CORE_CASE_SET_FILE_MISSING" "CORE_CASE_SET_JSON_INVALID"
Assert-CaseSetRoot $caseSet
$fixtures = Read-CaseJson $FixturesPath "CORE_CASE_FIXTURE_FILE_MISSING" "CORE_CASE_FIXTURE_JSON_INVALID"
Test-CaseSetCandidate $caseSet $fixtures

Invoke-CaseMutation "MUT-CASE-DROP-REQUIRED-CASE" {
    param($candidate)
    $candidate.cases = @($candidate.cases | Where-Object { [string]$_.id -ne "CASE-MEAL-021" })
} "CORE_CASE_IDS_INVALID" $caseSet $fixtures

Invoke-CaseMutation "MUT-CASE-ALLOW-ADAPTER-ORACLE-REWRITE" {
    param($candidate)
    $candidate.package_invariants.adapters_may_rewrite_oracle = $true
} "CORE_CASE_ORACLE_AUTHORITY_INVALID" $caseSet $fixtures

Invoke-CaseMutation "MUT-CASE-MILK-AS-WATER" {
    param($candidate)
    $row = @($candidate.cases | Where-Object { [string]$_.id -eq "CASE-MEAL-001" })[0]
    $row.oracle.fact_commit.meal_event.water_event_count = 1
} "CORE_CASE_MILK_CLASSIFICATION_INVALID" $caseSet $fixtures

Invoke-CaseMutation "MUT-CASE-SINGLE-ITEM-ALT-SHAPE" {
    param($candidate)
    $row = @($candidate.cases | Where-Object { [string]$_.id -eq "CASE-MEAL-021" })[0]
    $row.oracle.parsing = [pscustomobject][ordered]@{
        single_item = $row.oracle.parsing.items[0]
    }
} "CORE_CASE_PARSING_INVALID:CASE-MEAL-021" $caseSet $fixtures

Invoke-CaseMutation "MUT-CASE-EXPLICIT-WATER-ESTIMATED" {
    param($candidate)
    $row = @($candidate.cases | Where-Object { [string]$_.id -eq "CASE-WATER-001" })[0]
    $row.oracle.fact_commit.water_event.estimated = $true
} "CORE_CASE_WATER_EVIDENCE_INVALID" $caseSet $fixtures

Invoke-CaseMutation "MUT-CASE-RECEIPT-PROGRESS-NOT-LAST" {
    param($candidate)
    $row = @($candidate.cases | Where-Object { [string]$_.id -eq "CASE-RECEIPT-001" })[0]
    $row.oracle.receipt.blocks = @("title", "progress", "item_lines")
} "CORE_CASE_RECEIPT_BLOCKS_INVALID" $caseSet $fixtures

Invoke-CaseMutation "MUT-CASE-QUERY-ALLOWS-WRITE" {
    param($candidate)
    $row = @($candidate.cases | Where-Object { [string]$_.id -eq "CASE-QUERY-001" })[0]
    $row.oracle.query.business_write_count = 1
} "CORE_CASE_QUERY_WRITE_INVALID" $caseSet $fixtures

Invoke-CaseMutation "MUT-CASE-FAILED-FACT-ALLOWS-MEAL" {
    param($candidate)
    $candidate.package_invariants.fact_commit_failure_forbidden_artifacts = @(
        "inventory_change",
        "nutrition_snapshot",
        "issue",
        "business_outbox",
        "daily_progress",
        "success_receipt",
        "terminal_idempotency_result"
    )
} "CORE_CASE_FAILED_FACT_ARTIFACTS_INVALID" $caseSet $fixtures

"CORE_ACCEPTANCE_CASES|PASS|version=1.0.0|cases=5|fixtures=3|mutations=8"
