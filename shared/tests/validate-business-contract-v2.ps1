[CmdletBinding()]
param(
    [string]$ContractPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ContractPath)) {
    $ContractPath = Join-Path (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) "business-contract.md"
}

function Assert-ContractTrue {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-ContractEqual {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw ("{0}; expected=[{1}] actual=[{2}]" -f $Message, $Expected, $Actual)
    }
}

function Assert-ContractArray {
    param([string[]]$Expected, $Actual, [string]$Message)
    $actualArray = @($Actual)
    Assert-ContractEqual $Expected.Count $actualArray.Count ("{0} count" -f $Message)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-ContractEqual $Expected[$index] ([string]$actualArray[$index]) ("{0} index {1}" -f $Message, $index)
    }
}

Assert-ContractTrue (Test-Path -LiteralPath $ContractPath -PathType Leaf) "Business contract is missing"
$text = [System.IO.File]::ReadAllText($ContractPath, [System.Text.Encoding]::UTF8)
$pattern = '(?s)<!-- BEGIN CONTRACT-V3-MACHINE -->\s*```json\s*(?<json>\{.*?\})\s*```\s*<!-- END CONTRACT-V3-MACHINE -->'
$match = [System.Text.RegularExpressions.Regex]::Match($text, $pattern)
Assert-ContractTrue $match.Success "CONTRACT-v3 machine block is missing"

$contract = $match.Groups["json"].Value | ConvertFrom-Json
Assert-ContractEqual "diet-manager/contract-v3" ([string]$contract.contract_id) "Contract identity"
Assert-ContractEqual 3 ([int]$contract.contract_version) "Contract version"
Assert-ContractEqual "B" ([string]$contract.product_write_route) "Only B may own product writes"
Assert-ContractEqual "portable" ([string]$contract.skill_surface) "Skill surface"

Assert-ContractArray @("committed", "committed_with_issues", "needs_clarification", "ignored", "failed") $contract.command_statuses "Command statuses"
Assert-ContractArray @("active", "superseded", "voided") $contract.record_lifecycle "Record lifecycle"
Assert-ContractArray @("received", "fact_committed", "effects_pending", "terminal", "failed_fact") $contract.envelope_states "Envelope states"
Assert-ContractArray @("pending", "processing", "succeeded", "retryable_failed", "permanent_business_skip") $contract.outbox_states "Outbox states"
Assert-ContractArray @("FactCommit", "EffectBundle", "EnvelopeFinalize") @($contract.protocol | ForEach-Object { $_.stage }) "Protocol stages"

$fact = @($contract.protocol | Where-Object { $_.stage -eq "FactCommit" })
Assert-ContractEqual 1 $fact.Count "FactCommit row count"
Assert-ContractEqual "rollback_all_business_rows" ([string]$fact[0].technical_failure) "FactCommit failure behavior"
Assert-ContractEqual "allowed_separate_only" ([string]$fact[0].technical_log) "FactCommit technical log boundary"

$effect = @($contract.protocol | Where-Object { $_.stage -eq "EffectBundle" })
Assert-ContractEqual 1 $effect.Count "EffectBundle row count"
Assert-ContractEqual "keep_fact_and_retry_effect" ([string]$effect[0].technical_failure) "EffectBundle failure behavior"

$finalize = @($contract.protocol | Where-Object { $_.stage -eq "EnvelopeFinalize" })
Assert-ContractEqual 1 $finalize.Count "EnvelopeFinalize row count"
Assert-ContractEqual "rollback_finalizer_keep_effects_pending" ([string]$finalize[0].technical_failure) "EnvelopeFinalize failure behavior"

Assert-ContractTrue (-not [bool]$contract.technical_log.business_visible) "Technical log became business-visible"
Assert-ContractTrue (-not [bool]$contract.technical_log.counts_as_record) "Technical log became a dietary record"
Assert-ContractArray @(
    "meal_or_water_fact",
    "inventory_change",
    "nutrition_snapshot",
    "issue",
    "business_outbox",
    "daily_progress",
    "success_receipt",
    "terminal_idempotency_result"
) $contract.fact_commit_failure_forbids "FactCommit failure forbidden artifacts"

Assert-ContractArray @("idempotency_key", "input_digest", "subject_scope", "command_type") $contract.idempotency.identity_fields "Idempotency identity"
Assert-ContractEqual "return_frozen_terminal" ([string]$contract.idempotency.same_terminal) "Terminal retry behavior"
Assert-ContractEqual "resume_pending_effects_or_finalizer" ([string]$contract.idempotency.same_nonterminal) "Nonterminal retry behavior"
Assert-ContractEqual "idempotency_conflict" ([string]$contract.idempotency.different_input_error) "Conflict error code"
Assert-ContractEqual "zero_new_business_writes" ([string]$contract.idempotency.different_input_write_effect) "Conflict write behavior"

Assert-ContractArray @("MixedCommitResult", "ReceiptData", "daily_progress_by_date", "daily_progress", "terminal_idempotency_result") $contract.finalizer_atomic_outputs "Finalizer outputs"
Assert-ContractArray @("input_digest", "subject_scope", "command_type", "data_revision") $contract.preview_binding "Server preview binding"
Assert-ContractTrue (-not [bool]$contract.caller_state_trusted) "Caller state must not be trusted"

Assert-ContractArray @(
    "user_explicit",
    "package_or_manufacturer_storage_condition",
    "confirmed_same_product_rule",
    "product_type_default_rule",
    "evidence_based_model_inference",
    "unknown"
) $contract.location_evidence_priority "Location evidence priority"

Assert-ContractArray @(
    "user_explicit_expiration",
    "label_expiration",
    "production_date_plus_shelf_life",
    "manufacturer_product_data",
    "confirmed_same_product_rule",
    "purchase_time_plus_reliable_rule",
    "stocked_time_plus_default_rule",
    "unknown"
) $contract.expiration_anchor_priority "Expiration anchor priority"

Assert-ContractArray @(
    "current_exact_label",
    "current_package_or_barcode_data",
    "manufacturer_exact_product_data",
    "confirmed_same_product_history",
    "authoritative_public_food_database",
    "configured_trusted_internet_data",
    "active_personal_recipe_template",
    "generic_recipe_template",
    "bounded_reasonable_estimate",
    "unknown"
) $contract.nutrition_source_priority "Nutrition source priority"

Assert-ContractEqual "should_write_separate_redacted" ([string]$contract.fact_commit_technical_log_requirement) "FactCommit technical log requirement"
Assert-ContractEqual "received_at_with_default_received_at" ([string]$contract.missing_time_default) "Missing time default"
Assert-ContractEqual "reference_database_not_estimated" ([string]$contract.public_database_explicit_amount_display) "Public database display rule"
Assert-ContractEqual "record_participation_keep_amount_unknown_or_ask" ([string]$contract.shared_meal_unknown_personal_amount) "Shared meal unknown amount rule"

Assert-ContractEqual "partially_deducted" ([string]$contract.partial_deduction.status) "Partial deduction status"
Assert-ContractEqual "PRODUCT-0.2" ([string]$contract.partial_deduction.enabled_from) "Partial deduction version"
Assert-ContractEqual "per_event_explicit_user" ([string]$contract.partial_deduction.authorization) "Partial deduction authorization"
Assert-ContractTrue (-not [bool]$contract.partial_deduction.enabled_in_product_0_1) "Partial deduction became enabled in PRODUCT-0.1"

Assert-ContractTrue ([bool]$contract.single_day_progress_alias.required_for_one_date) "Single-day progress alias is not required"
Assert-ContractEqual "field_equal_to_only_array_item" ([string]$contract.single_day_progress_alias.equality) "Single-day progress alias equality"
Assert-ContractTrue (-not [bool]$contract.single_day_progress_alias.present_for_multiple_dates) "Single-day alias appeared for multiple dates"

$legacyProperty = $contract.PSObject.Properties["legacy_rule_guards"]
Assert-ContractTrue ($null -ne $legacyProperty) "Legacy rule guards are missing"
$legacy = $legacyProperty.Value
Assert-ContractTrue (-not [bool]$legacy.inventory_requires_explicit_home) "Legacy inventory home gate revived"
Assert-ContractTrue ([bool]$legacy.water_in_scope) "Water was removed from product scope"
Assert-ContractTrue ([bool]$legacy.correction_supported) "Correction support was removed"
Assert-ContractTrue (-not [bool]$legacy.vague_quantity_forces_preview) "Vague quantity preview gate revived"
Assert-ContractTrue (-not [bool]$legacy.inventory_problem_blocks_fact) "Inventory problem may not block the fact"
Assert-ContractTrue ([bool]$legacy.trusted_external_nutrition_allowed) "Trusted external nutrition was disabled"
Assert-ContractTrue ([bool]$legacy.bounded_estimate_allowed) "Bounded nutrition estimate was disabled"
Assert-ContractEqual "ordered_registry" ([string]$legacy.nutrition_source_model) "Nutrition source model"
Assert-ContractTrue (-not [bool]$legacy.same_product_multi_batch_is_ambiguity) "Same-product batches became ambiguity"
Assert-ContractTrue (-not [bool]$legacy.nutrition_amount_drives_inventory) "Nutrition amount may not drive inventory"

Write-Output "CONTRACT_V3|PASS|id=$($contract.contract_id)|statuses=$(@($contract.command_statuses).Count)|protocol=$(@($contract.protocol).Count)|legacy_guards=10"
