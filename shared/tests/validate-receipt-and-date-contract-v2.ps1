[CmdletBinding()]
param(
    [string]$ContractPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ContractPath)) {
    $ContractPath = Join-Path (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) "contracts\receipt-and-date-contract.md"
}

function Assert-ReceiptTrue {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-ReceiptEqual {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) { throw ("{0}; expected=[{1}] actual=[{2}]" -f $Message, $Expected, $Actual) }
}

function Assert-ReceiptArray {
    param([string[]]$Expected, $Actual, [string]$Message)
    $values = @($Actual)
    Assert-ReceiptEqual $Expected.Count $values.Count ("{0} count" -f $Message)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-ReceiptEqual $Expected[$index] ([string]$values[$index]) ("{0} index {1}" -f $Message, $index)
    }
}

function Get-RoundHalfUp {
    param([decimal]$Value)
    if ($Value -lt 0) { throw 'Only nonnegative progress values are allowed' }
    return [decimal]::Floor($Value + [decimal]0.5)
}

Assert-ReceiptTrue (Test-Path -LiteralPath $ContractPath -PathType Leaf) "Receipt/date contract is missing"
$text = [IO.File]::ReadAllText($ContractPath, [Text.Encoding]::UTF8)
$pattern = '(?s)<!-- BEGIN RECEIPT-DATE-V2-MACHINE -->\s*```json\s*(?<json>\{.*?\})\s*```\s*<!-- END RECEIPT-DATE-V2-MACHINE -->'
$match = [regex]::Match($text, $pattern)
Assert-ReceiptTrue $match.Success "RECEIPT-DATE-CONTRACT-v2 machine block is missing"
$contract = $match.Groups['json'].Value | ConvertFrom-Json

Assert-ReceiptEqual 'diet-manager/receipt-date-contract-v2' ([string]$contract.contract_id) 'Contract identity'
Assert-ReceiptEqual 2 ([int]$contract.contract_version) 'Contract version'
Assert-ReceiptEqual 'diet-manager/contract-v2' ([string]$contract.upstream_contract) 'Upstream contract'
Assert-ReceiptEqual 'B' ([string]$contract.product_write_route) 'Product write route'
Assert-ReceiptEqual 'portable' ([string]$contract.render_surface) 'Render surface'

Assert-ReceiptArray @('raw_text','resolved_start','resolved_end','precision','timezone','resolution_basis','resolution_anchor','resolver_version') $contract.occurred_time.fields 'OccurredTime fields'
Assert-ReceiptArray @('exact','date','meal_period','approximate','unknown') $contract.occurred_time.precision_values 'OccurredTime precision'
Assert-ReceiptEqual 'exact_only' ([string]$contract.occurred_time.resolved_occurred_at_compatibility) 'Exact compatibility field'

Assert-ReceiptArray @('committed','committed_with_issues') $contract.success_receipt_statuses 'Success receipt statuses'
Assert-ReceiptEqual 'EnvelopeFinalize_frozen_result' ([string]$contract.success_receipt_authority) 'Receipt authority'
Assert-ReceiptArray @('effects_pending','failed_fact','failed') $contract.success_receipt_forbidden_states 'Forbidden success states'

Assert-ReceiptEqual 'daily_progress_by_date' ([string]$contract.progress.canonical_collection) 'Canonical progress collection'
Assert-ReceiptEqual 'required_field_equal_alias' ([string]$contract.progress.one_date_alias) 'One-date alias'
Assert-ReceiptEqual 'forbidden' ([string]$contract.progress.multiple_date_alias) 'Multi-date alias'
Assert-ReceiptEqual 'envelope_persisted_aggregate' ([string]$contract.progress.current_turn_increment_source) 'Increment source'
Assert-ReceiptTrue ([bool]$contract.progress.terminal_idempotency_frozen) 'Terminal progress is not frozen'
Assert-ReceiptArray @('energy','protein','fat','carbohydrate','fiber','water') $contract.progress.metrics 'Progress metrics'
Assert-ReceiptEqual 'decimal_round_half_up' ([string]$contract.progress.rounding) 'Progress rounding'
Assert-ReceiptEqual 10 ([int]$contract.progress.bar_cells) 'Progress bar cells'

$goldenProgress = @($contract.golden_progress)
Assert-ReceiptEqual 6 $goldenProgress.Count 'Golden progress row count'
foreach ($row in $goldenProgress) {
    $current = [decimal]$row.current
    $target = [decimal]$row.target
    $increment = [decimal]$row.increment
    Assert-ReceiptTrue ($target -gt 0) ("Golden target {0}" -f $row.metric)
    $percentage = [int](Get-RoundHalfUp (($current / $target) * 100))
    $filled = [int](Get-RoundHalfUp (($current / $target) * 10))
    if ($filled -gt 10) { $filled = 10 }
    $incrementPercentage = [int](Get-RoundHalfUp (($increment / $target) * 100))
    Assert-ReceiptEqual $percentage ([int]$row.percentage) ("Golden percentage {0}" -f $row.metric)
    Assert-ReceiptEqual $filled ([int]$row.filled) ("Golden filled {0}" -f $row.metric)
    Assert-ReceiptEqual $incrementPercentage ([int]$row.increment_percentage) ("Golden increment {0}" -f $row.metric)
}

Assert-ReceiptArray @('record_header','item_lines','actual_inventory_effect','issues_and_quick_options','progress_blocks') $contract.receipt.block_order 'Receipt block order'
Assert-ReceiptEqual 'last' ([string]$contract.receipt.progress_position) 'Progress block position'
Assert-ReceiptTrue (-not [bool]$contract.receipt.recompute_business_results) 'Renderer may not recompute business results'
Assert-ReceiptTrue (-not [bool]$contract.receipt.success_when_effects_pending) 'Pending effects produced a success receipt'

Assert-ReceiptArray @('personal_template','confirmed_historical_nutrition','reference_database','estimated') $contract.evidence_labels 'Evidence labels'
Assert-ReceiptEqual 'only_inferred_fields' ([string]$contract.estimate_label_scope) 'Estimate label scope'

Assert-ReceiptEqual 'current_month_day_only' ([string]$contract.date_display.current_month) 'Current-month date display'
Assert-ReceiptEqual 'same_year_month_day' ([string]$contract.date_display.same_year_other_month) 'Same-year date display'
Assert-ReceiptEqual 'full_date' ([string]$contract.date_display.other_year) 'Other-year date display'
Assert-ReceiptTrue (-not [bool]$contract.date_display.unknown_time_uses_midnight) 'Unknown time became midnight'

$legacy = $contract.legacy_rule_guards
Assert-ReceiptTrue (-not [bool]$legacy.all_dates_show_month) 'Legacy date display revived'
Assert-ReceiptTrue (-not [bool]$legacy.unknown_time_is_midnight) 'Legacy midnight default revived'
Assert-ReceiptTrue (-not [bool]$legacy.components_are_separate_lines) 'Legacy component lines revived'
Assert-ReceiptTrue (-not [bool]$legacy.explicit_values_are_estimated) 'Explicit values became estimated'
Assert-ReceiptTrue (-not [bool]$legacy.nutrition_amount_implies_inventory_deduction) 'Nutrition amount drove inventory deduction'
Assert-ReceiptTrue (-not [bool]$legacy.separate_turn_nutrition_section) 'Turn nutrition section revived'
Assert-ReceiptTrue (-not [bool]$legacy.progress_has_heading) 'Progress heading revived'
Assert-ReceiptTrue (-not [bool]$legacy.post_progress_advice) 'Post-progress advice revived'
Assert-ReceiptTrue (-not [bool]$legacy.rebuild_receipt_from_old_progress) 'Old progress receipt rebuild revived'
Assert-ReceiptTrue (-not [bool]$legacy.unknown_is_zero) 'Unknown became zero'

$expectedIds = @('REQ-TIME-001','REQ-TIME-002','REQ-TIME-003','REQ-QUICK-001','REQ-PROGRESS-001','REQ-PROGRESS-002','REQ-PROGRESS-003','REQ-PROGRESS-004','REQ-RECEIPT-001','REQ-RECEIPT-002','REQ-RECEIPT-003')
$traceMatch = [regex]::Match($text, '(?m)^## 9\. Current 11-ID task trace table\s*$')
Assert-ReceiptTrue $traceMatch.Success 'Current trace table is missing'
$traceText = $text.Substring($traceMatch.Index)
foreach ($id in $expectedIds) {
    Assert-ReceiptEqual 1 @([regex]::Matches($traceText, [regex]::Escape($id))).Count ("Trace singleton {0}" -f $id)
}
Assert-ReceiptEqual 0 @([regex]::Matches($traceText, 'REQ-UX-\d{3}')).Count 'Legacy REQ-UX trace IDs'

Assert-ReceiptTrue $text.Contains('DATE-GOLDEN-CURRENT-MONTH') 'Current-month golden date missing'
Assert-ReceiptTrue $text.Contains('DATE-GOLDEN-CROSS-MONTH') 'Cross-month golden date missing'
Assert-ReceiptTrue $text.Contains('DATE-GOLDEN-CROSS-YEAR') 'Cross-year golden date missing'
Assert-ReceiptTrue $text.Contains('FIELD-EVIDENCE-LABELS') 'Field-level evidence rule missing'
Assert-ReceiptTrue $text.Contains('CROSS-DAY-ARRAY-ONLY') 'Cross-day array rule missing'
Assert-ReceiptTrue $text.Contains('EFFECTS-PENDING-NO-SUCCESS') 'Pending effect receipt boundary missing'
Assert-ReceiptTrue $text.Contains('GOLDEN-SINGLE-DAY-ALIAS') 'Single-day alias golden rule missing'
Assert-ReceiptTrue $text.Contains('GOLDEN-CROSS-DAY-RECEIPT') 'Cross-day receipt golden rule missing'
Assert-ReceiptTrue $text.Contains('GOLDEN-FINALIZER-PENDING') 'Finalizer pending golden rule missing'

Write-Output "RECEIPT_DATE_V2|PASS|id=$($contract.contract_id)|metrics=$(@($contract.progress.metrics).Count)|trace=$($expectedIds.Count)|legacy_guards=10"
