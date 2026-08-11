[CmdletBinding()]
param(
    [string]$ContractPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ContractPath)) {
    $ContractPath = Join-Path (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) "contracts\issue-correction-contract.md"
}

function Assert-IcTrue {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-IcEqual {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw ("{0}; expected=[{1}] actual=[{2}]" -f $Message, $Expected, $Actual)
    }
}

function Assert-IcArray {
    param([string[]]$Expected, $Actual, [string]$Message)
    $values = @($Actual)
    Assert-IcEqual $Expected.Count $values.Count ("{0} count" -f $Message)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-IcEqual $Expected[$index] ([string]$values[$index]) ("{0} index {1}" -f $Message, $index)
    }
}

function Assert-IcPropertyNames {
    param([string[]]$Expected, $Actual, [string]$Message)
    Assert-IcTrue ($null -ne $Actual) ("{0} is missing" -f $Message)
    $actualNames = @($Actual.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
    $expectedNames = @($Expected | Sort-Object)
    Assert-IcArray $expectedNames $actualNames ("{0} properties" -f $Message)
}

function Assert-IcFalse {
    param($Actual, [string]$Message)
    Assert-IcTrue ($Actual -is [bool]) ("{0} is not Boolean" -f $Message)
    Assert-IcTrue (-not [bool]$Actual) $Message
}

Assert-IcTrue (Test-Path -LiteralPath $ContractPath -PathType Leaf) "Issue/correction contract is missing"
$text = [IO.File]::ReadAllText($ContractPath, [Text.Encoding]::UTF8)
$pattern = '(?s)<!-- BEGIN ISSUE-CORRECTION-V2-MACHINE -->\s*```json\s*(?<json>\{.*?\})\s*```\s*<!-- END ISSUE-CORRECTION-V2-MACHINE -->'
$match = [regex]::Match($text, $pattern)
Assert-IcTrue $match.Success "ISSUE-CORRECTION-CONTRACT-v2 machine block is missing"
$contract = $match.Groups['json'].Value | ConvertFrom-Json

Assert-IcPropertyNames @(
    'contract_id',
    'contract_version',
    'upstream_contract',
    'receipt_date_contract',
    'product_write_route',
    'adapter_surface',
    'issue',
    'resolution',
    'quick_prompt',
    'correction',
    'transaction',
    'inventory_insufficient',
    'cross_day',
    'bulk_correction',
    'mixed',
    'trace_ids',
    'legacy_rule_guards'
) $contract 'Contract'

Assert-IcEqual 'diet-manager/issue-correction-contract-v2' ([string]$contract.contract_id) 'Contract identity'
Assert-IcEqual 2 ([int]$contract.contract_version) 'Contract version'
Assert-IcEqual 'diet-manager/contract-v2' ([string]$contract.upstream_contract) 'Upstream contract'
Assert-IcEqual 'diet-manager/receipt-date-contract-v2' ([string]$contract.receipt_date_contract) 'Receipt/date contract'
Assert-IcEqual 'B' ([string]$contract.product_write_route) 'Product write route'
Assert-IcEqual 'thin' ([string]$contract.adapter_surface) 'Adapter surface'

Assert-IcPropertyNames @(
    'statuses',
    'types',
    'priorities',
    'codes',
    'required_fields',
    'resolution_reasons',
    'resolution_sources',
    'presentation_mode',
    'defer_transition',
    'queryable_unresolved',
    'coverage_impact_preserved'
) $contract.issue 'Issue'
Assert-IcArray @('open','awaiting_user','resolved','dismissed') $contract.issue.statuses 'Issue statuses'
Assert-IcArray @('blocking_fact','non_blocking_business','non_blocking_technical','optional') $contract.issue.types 'Issue types'
Assert-IcArray @('critical','high','normal','low') $contract.issue.priorities 'Issue priorities'
Assert-IcArray @(
    'reference_ambiguous',
    'consumption_state_ambiguous',
    'negation_scope_conflict',
    'food_identity_unrecognized',
    'quantity_missing',
    'quantity_estimated',
    'quantity_vague_unresolved',
    'composition_unknown',
    'nutrition_missing',
    'nutrition_estimated',
    'missing_package_content',
    'inventory_no_match',
    'inventory_multiple_candidates',
    'inventory_insufficient',
    'inventory_unit_unconvertible',
    'inventory_batch_uncertain',
    'occurred_time_defaulted',
    'meal_slot_inferred',
    'storage_location_uncertain',
    'shelf_life_unknown',
    'possible_duplicate',
    'effect_processing_failed',
    'progress_projection_pending'
) $contract.issue.codes 'Issue codes'
Assert-IcArray @(
    'issue_id',
    'issue_code',
    'issue_type',
    'priority',
    'entity_type',
    'entity_id',
    'field_path',
    'detected_at',
    'source_message_id',
    'source_text',
    'known_facts',
    'missing_or_conflicting_facts',
    'impact',
    'candidate_values',
    'candidate_actions',
    'status',
    'revision',
    'last_presented_at',
    'resolved_at',
    'resolution_source',
    'resolution_reason',
    'resolution_event_id'
) $contract.issue.required_fields 'Issue required fields'
Assert-IcArray @(
    'user_supplied',
    'user_confirmed',
    'reliable_evidence_resolved',
    'kept_estimate',
    'deferred_by_user',
    'dismissed_by_user',
    'event_superseded',
    'effect_retry_succeeded'
) $contract.issue.resolution_reasons 'Resolution reasons'
Assert-IcArray @('user','reliable_context','system_retry','event_lifecycle') $contract.issue.resolution_sources 'Resolution sources'
Assert-IcEqual 'consolidated_after_fact_commit' ([string]$contract.issue.presentation_mode) 'Issue presentation mode'
Assert-IcEqual 'awaiting_user_to_open' ([string]$contract.issue.defer_transition) 'Issue defer transition'
Assert-IcTrue ([bool]$contract.issue.queryable_unresolved) 'Unresolved Issues are not queryable'
Assert-IcTrue ([bool]$contract.issue.coverage_impact_preserved) 'Issue coverage impact is not preserved'

Assert-IcPropertyNames @('application_outcomes','rejection_reasons','persist_technical_failure_outcome') $contract.resolution 'Resolution'
Assert-IcArray @('applied','no_change','rejected') $contract.resolution.application_outcomes 'Application outcomes'
Assert-IcArray @(
    'stale_revision',
    'expired_prompt',
    'conflicting_selection',
    'prompt_target_revision_stale',
    'business_validation_failed'
) $contract.resolution.rejection_reasons 'Rejection reasons'
Assert-IcFalse $contract.resolution.persist_technical_failure_outcome 'Technical failure became a persisted resolution outcome'

Assert-IcPropertyNames @(
    'required_fields',
    'min_options',
    'max_options',
    'natural_language_equivalent',
    'stale_choice_application_outcome',
    'stale_choice_rejection_reason',
    'conflicting_choice_application_outcome',
    'conflicting_choice_rejection_reason',
    'safe_exit_required',
    'free_text_line'
) $contract.quick_prompt 'Quick prompt'
Assert-IcArray @('prompt_id','issue_id','option_ids','generated_from_revision','generated_at','expires_at') $contract.quick_prompt.required_fields 'Quick prompt fields'
Assert-IcEqual 2 ([int]$contract.quick_prompt.min_options) 'Quick prompt minimum options'
Assert-IcEqual 4 ([int]$contract.quick_prompt.max_options) 'Quick prompt maximum options'
Assert-IcEqual 'same_business_operation' ([string]$contract.quick_prompt.natural_language_equivalent) 'Natural language option behavior'
Assert-IcEqual 'rejected' ([string]$contract.quick_prompt.stale_choice_application_outcome) 'Stale quick choice outcome'
Assert-IcEqual 'expired_prompt' ([string]$contract.quick_prompt.stale_choice_rejection_reason) 'Stale quick choice reason'
Assert-IcEqual 'rejected' ([string]$contract.quick_prompt.conflicting_choice_application_outcome) 'Conflicting quick choice outcome'
Assert-IcEqual 'conflicting_selection' ([string]$contract.quick_prompt.conflicting_choice_rejection_reason) 'Conflicting quick choice reason'
Assert-IcTrue ([bool]$contract.quick_prompt.safe_exit_required) 'Quick prompt has no safe exit requirement'
$freeTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$contract.quick_prompt.free_text_line))
Assert-IcEqual '5Lmf5Y+v5Lul55u05o6l6K+05piO5a6e6ZmF5oOF5Ya177yM5LiN5b+F6YCJ5oup5Lul5LiK6YCJ6aG544CC' $freeTextBase64 'Quick prompt exact free-text line'

Assert-IcPropertyNames @(
    'operations',
    'required_fields',
    'append_only',
    'overwrite_original_event',
    'physical_delete_original_event',
    'ambiguous_target',
    'stale_base_revision',
    'no_change',
    'concurrent_conflict'
) $contract.correction 'Correction'
Assert-IcArray @(
    'change_amount',
    'change_unit',
    'change_time',
    'change_meal_slot',
    'change_item_name',
    'change_food_type',
    'change_components',
    'add_item',
    'remove_item',
    'change_inventory_link',
    'change_nutrition_source',
    'void_event',
    'restore_event'
) $contract.correction.operations 'Correction operations'
Assert-IcArray @(
    'correction_id',
    'target_event_id',
    'base_revision',
    'request_id',
    'source_text',
    'operation',
    'before_snapshot',
    'change_set',
    'after_snapshot',
    'nutrition_delta',
    'inventory_effects',
    'affected_dates',
    'created_at',
    'timezone'
) $contract.correction.required_fields 'Correction required fields'
Assert-IcTrue ([bool]$contract.correction.append_only) 'Correction is not append-only'
Assert-IcFalse $contract.correction.overwrite_original_event 'Correction may overwrite the original event'
Assert-IcFalse $contract.correction.physical_delete_original_event 'Correction may physically delete the original event'
Assert-IcEqual 'needs_clarification_zero_writes' ([string]$contract.correction.ambiguous_target) 'Ambiguous correction target behavior'
Assert-IcEqual 'rejected_stale_revision_zero_effects' ([string]$contract.correction.stale_base_revision) 'Stale correction behavior'
Assert-IcEqual 'no_change_no_new_version' ([string]$contract.correction.no_change) 'No-change correction behavior'
Assert-IcEqual 'needs_clarification_current_view_zero_effects' ([string]$contract.correction.concurrent_conflict) 'Concurrent correction behavior'

Assert-IcPropertyNames @(
    'stages',
    'envelope_states',
    'outbox_states',
    'fact_commit_failure_business_writes',
    'fact_commit_technical_log',
    'effect_bundle_failure',
    'finalizer_failure',
    'correction_fact_commit',
    'correction_effect_bundle',
    'correction_envelope_finalize'
) $contract.transaction 'Transaction'
Assert-IcArray @('FactCommit','EffectBundle','EnvelopeFinalize') $contract.transaction.stages 'Transaction stages'
Assert-IcArray @('received','fact_committed','effects_pending','terminal','failed_fact') $contract.transaction.envelope_states 'Envelope states'
Assert-IcArray @('pending','processing','succeeded','retryable_failed','permanent_business_skip') $contract.transaction.outbox_states 'Outbox states'
Assert-IcEqual 0 ([int]$contract.transaction.fact_commit_failure_business_writes) 'FactCommit failure business writes'
Assert-IcEqual 'allowed_separate_redacted_only' ([string]$contract.transaction.fact_commit_technical_log) 'FactCommit technical log boundary'
Assert-IcEqual 'keep_fact_retry_effect' ([string]$contract.transaction.effect_bundle_failure) 'EffectBundle failure behavior'
Assert-IcEqual 'keep_effects_pending_no_success_receipt' ([string]$contract.transaction.finalizer_failure) 'EnvelopeFinalize failure behavior'
Assert-IcEqual 'CorrectionEvent_idempotency_child_key_effect_outbox' ([string]$contract.transaction.correction_fact_commit) 'Correction FactCommit contents'
Assert-IcEqual 'nutrition_inventory_issue_projection_contribution' ([string]$contract.transaction.correction_effect_bundle) 'Correction EffectBundle contents'
Assert-IcEqual 'daily_progress_receipt_terminal_result' ([string]$contract.transaction.correction_envelope_finalize) 'Correction EnvelopeFinalize contents'

Assert-IcPropertyNames @(
    'command_status',
    'corrected_fact_committed',
    'nutrition_recalculated',
    'preserve_prior_real_deduction',
    'unsafe_delta',
    'issue_code',
    'negative_inventory',
    'receipt_authority'
) $contract.inventory_insufficient 'Inventory insufficient'
Assert-IcEqual 'committed_with_issues' ([string]$contract.inventory_insufficient.command_status) 'Inventory insufficient command status'
Assert-IcTrue ([bool]$contract.inventory_insufficient.corrected_fact_committed) 'Corrected fact was not committed'
Assert-IcTrue ([bool]$contract.inventory_insufficient.nutrition_recalculated) 'Nutrition was not recalculated'
Assert-IcTrue ([bool]$contract.inventory_insufficient.preserve_prior_real_deduction) 'Prior real deduction was not preserved'
Assert-IcEqual 'skipped_insufficient' ([string]$contract.inventory_insufficient.unsafe_delta) 'Unsafe inventory delta behavior'
Assert-IcEqual 'inventory_insufficient' ([string]$contract.inventory_insufficient.issue_code) 'Inventory insufficiency Issue code'
Assert-IcFalse $contract.inventory_insufficient.negative_inventory 'Inventory insufficiency may create negative stock'
Assert-IcEqual 'successful_EnvelopeFinalize_only' ([string]$contract.inventory_insufficient.receipt_authority) 'Inventory insufficiency receipt authority'

Assert-IcPropertyNames @('canonical_collection','multiple_dates_single_alias','authority') $contract.cross_day 'Cross-day correction'
Assert-IcEqual 'daily_progress_by_date' ([string]$contract.cross_day.canonical_collection) 'Cross-day progress collection'
Assert-IcFalse $contract.cross_day.multiple_dates_single_alias 'Cross-day correction emitted a single-date alias'
Assert-IcEqual 'EnvelopeFinalize' ([string]$contract.cross_day.authority) 'Cross-day progress authority'

Assert-IcPropertyNames @(
    'product_version',
    'preview_required',
    'preview_fields',
    'confirmation_fields',
    'preview_business_writes',
    'per_target_append_only',
    'cancel_or_stale_business_writes',
    'finalizer'
) $contract.bulk_correction 'Bulk correction'
Assert-IcEqual 'PRODUCT-0.2' ([string]$contract.bulk_correction.product_version) 'Bulk correction product version'
Assert-IcTrue ([bool]$contract.bulk_correction.preview_required) 'Bulk correction does not require preview'
Assert-IcArray @(
    'date_scope',
    'match_count',
    'current_effective_content',
    'planned_corrections_or_voids',
    'inventory_compensation',
    'affected_dates'
) $contract.bulk_correction.preview_fields 'Bulk correction preview fields'
Assert-IcArray @('preview_revision','target_revisions') $contract.bulk_correction.confirmation_fields 'Bulk correction confirmation fields'
Assert-IcEqual 0 ([int]$contract.bulk_correction.preview_business_writes) 'Bulk preview business writes'
Assert-IcTrue ([bool]$contract.bulk_correction.per_target_append_only) 'Bulk correction is not append-only per target'
Assert-IcEqual 0 ([int]$contract.bulk_correction.cancel_or_stale_business_writes) 'Bulk cancel/stale business writes'
Assert-IcEqual 'single_EnvelopeFinalize' ([string]$contract.bulk_correction.finalizer) 'Bulk correction finalizer'

Assert-IcPropertyNames @('ordered','per_event_idempotent','command_statuses','later_failure_rolls_back_earlier') $contract.mixed 'Mixed input'
Assert-IcTrue ([bool]$contract.mixed.ordered) 'Mixed input is not ordered'
Assert-IcTrue ([bool]$contract.mixed.per_event_idempotent) 'Mixed input is not per-event idempotent'
Assert-IcArray @('committed','committed_with_issues','needs_clarification','ignored','failed') $contract.mixed.command_statuses 'Mixed command statuses'
Assert-IcFalse $contract.mixed.later_failure_rolls_back_earlier 'A later mixed failure may roll back an earlier fact'

$expectedIds = @('REQ-ISSUE-001','REQ-ISSUE-002','REQ-QUICK-001','REQ-CORR-001','REQ-CORR-002','REQ-CORR-003')
Assert-IcArray $expectedIds $contract.trace_ids 'Trace IDs'
$traceMatch = [regex]::Match($text, '(?m)^## 10\. Current 6-ID task trace table\s*$')
Assert-IcTrue $traceMatch.Success 'Current trace table is missing'
$traceText = $text.Substring($traceMatch.Index)
foreach ($id in $expectedIds) {
    Assert-IcEqual 1 @([regex]::Matches($traceText, [regex]::Escape($id))).Count ("Trace singleton {0}" -f $id)
}
Assert-IcEqual 0 @([regex]::Matches($traceText, 'REQ-(ISSUE|QUICK|CORR)-00[4-9]|REQ-(ISSUE|QUICK|CORR)-0[1-9][0-9]')).Count 'Legacy trace IDs'

Assert-IcPropertyNames @(
    'issue_offered_status',
    'issue_deferred_status',
    'issue_invalidated_status',
    'issue_kind_axis',
    'twelve_correction_operations',
    'change_item_type_operation',
    'overwrite_original_event',
    'physical_delete_original_event',
    'single_big_transaction',
    'rollback_fact_on_effect_failure',
    'persisted_failed_resolution',
    'mixed_legacy_statuses'
) $contract.legacy_rule_guards 'Legacy rule guards'
foreach ($property in $contract.legacy_rule_guards.PSObject.Properties) {
    Assert-IcFalse $property.Value ("Legacy rule revived: {0}" -f $property.Name)
}

foreach ($anchor in @(
    'ISSUE-FOUR-STATUS',
    'RESOLUTION-OUTCOME-TRIAD',
    'QUICK-STALE-REJECT',
    'CORRECTION-FACT-FIRST',
    'CORRECTION-INVENTORY-INSUFFICIENT',
    'CROSS-DAY-FINALIZED',
    'BULK-CORRECTION-PREVIEW',
    'OUTBOX-LAYERED',
    'MIXED-ORDERED',
    'FACT-COMMIT-FAILURE-ZERO-BUSINESS'
)) {
    Assert-IcTrue $text.Contains($anchor) ("Body anchor missing: {0}" -f $anchor)
}

$fenceCount = @([regex]::Matches($text, '(?m)^```')).Count
Assert-IcEqual 0 ($fenceCount % 2) 'Markdown fence parity'

Write-Output "ISSUE_CORRECTION_V2|PASS|id=$($contract.contract_id)|statuses=$(@($contract.issue.statuses).Count)|codes=$(@($contract.issue.codes).Count)|operations=$(@($contract.correction.operations).Count)|trace=$($expectedIds.Count)|legacy_guards=$(@($contract.legacy_rule_guards.PSObject.Properties).Count)"
