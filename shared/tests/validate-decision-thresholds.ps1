[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$PolicyPath = Join-Path $ProjectRoot 'shared\policies\decision-thresholds.json'
$FixturePath = Join-Path $ProjectRoot 'shared\tests\fixtures\decision-threshold-cases.json'
$ExpectedPolicySha256 = '8B15BAF36474B10E0F4FD6CA925B3E30A85FC1058E5A870E6E9EBF2585DDBCC7'
$ExpectedFixtureSha256 = 'CA3D867CBF58C6D4B4B4A42AB90C77234DC0059E1E07E44D6D81603C28ABD5EF'

$ExpectedCaseIds = @(
    'POL-CAND-0',
    'POL-CAND-1',
    'POL-CAND-2',
    'POL-CAND-SIMILARITY-2',
    'POL-CAND-SIMILARITY-1',
    'POL-CAND-CONFLICT-1',
    'POL-QUICK-1',
    'POL-QUICK-2',
    'POL-QUICK-4',
    'POL-QUICK-5',
    'POL-QUICK-STALE',
    'POL-QUICK-INCOMPLETE',
    'POL-QUICK-NO-EXIT',
    'POL-EXP-NEGATIVE',
    'POL-EXP-ZERO',
    'POL-EXP-JUST-IN',
    'POL-EXP-AT',
    'POL-EXP-ABOVE',
    'POL-EXP-MISSING-RULE',
    'POL-EXP-MISSING-DATE',
    'POL-EXP-PREP-UNOPEN-AT',
    'POL-EXP-PREP-UNOPEN-ABOVE',
    'POL-EXP-PERISH-OPEN-AT',
    'POL-EXP-PERISH-OPEN-ABOVE',
    'POL-EXP-PERISH-UNOPEN-AT',
    'POL-EXP-PERISH-UNOPEN-ABOVE',
    'POL-EXP-FROZEN-OPEN-AT',
    'POL-EXP-FROZEN-OPEN-ABOVE',
    'POL-EXP-FROZEN-UNOPEN-AT',
    'POL-EXP-FROZEN-UNOPEN-ABOVE',
    'POL-EXP-SHELF-OPEN-AT',
    'POL-EXP-SHELF-OPEN-ABOVE',
    'POL-EXP-SHELF-UNOPEN-AT',
    'POL-EXP-SHELF-UNOPEN-ABOVE',
    'POL-TPL-ABS-AT',
    'POL-TPL-ABS-ABOVE',
    'POL-TPL-REL-AT',
    'POL-TPL-REL-ABOVE',
    'POL-TPL-MAJOR-ADDED',
    'POL-TPL-UNRESOLVED',
    'POL-TPL-CONF-1',
    'POL-TPL-CONF-2',
    'POL-TPL-CONF-3',
    'POL-TPL-SYSTEM-ONLY',
    'POL-ROUND-Q-DOWN',
    'POL-ROUND-Q-HALF',
    'POL-ROUND-PCT-HALF',
    'POL-ROUND-GRID-LOW',
    'POL-ROUND-GRID-HALF',
    'POL-G1-PASS',
    'POL-G1-RETURN',
    'POL-G2-BIND',
    'POL-G2-RETURN-HASH',
    'POL-G2-RETURN-SCORES'
)

function Fail {
    param([string]$Code, [string]$Detail)
    throw ($Code + ':' + $Detail)
}

function Assert-True {
    param([bool]$Condition, [string]$Code, [string]$Detail)
    if (-not $Condition) {
        Fail -Code $Code -Detail $Detail
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Code, [string]$Detail)
    if ([string]$Expected -cne [string]$Actual) {
        Fail -Code $Code -Detail ($Detail + ';expected=[' + [string]$Expected + '];actual=[' + [string]$Actual + ']')
    }
}

function Assert-ExactProperties {
    param($Value, [string[]]$Expected, [string]$Label)
    if ($null -eq $Value) {
        Fail -Code 'POLICY_IDENTITY_INVALID' -Detail ($Label + ':null')
    }
    $actual = @($Value.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    Assert-Equal -Expected ($wanted -join ',') -Actual ($actual -join ',') -Code 'POLICY_IDENTITY_INVALID' -Detail ($Label + ':properties')
}

function Assert-ExactArray {
    param($Actual, [string[]]$Expected, [string]$Label)
    $items = @($Actual | ForEach-Object { [string]$_ })
    Assert-Equal -Expected ($Expected -join '|') -Actual ($items -join '|') -Code 'POLICY_IDENTITY_INVALID' -Detail $Label
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Assert-AsciiFile {
    param([string]$Path, [string]$Label)
    $bytes = [IO.File]::ReadAllBytes($Path)
    foreach ($b in $bytes) {
        if ($b -gt 127) {
            Fail -Code 'POLICY_JSON_INVALID' -Detail ($Label + ':non_ascii')
        }
    }
}

function Assert-PolicyHash {
    param([string]$Actual, [string]$Expected)
    if ($Expected -notmatch '^[0-9A-F]{64}$' -or $Actual -cne $Expected) {
        Fail -Code 'POLICY_HASH_MISMATCH' -Detail 'decision_thresholds'
    }
}

function Assert-PolicyVersion {
    param([string]$Value)
    if ($Value -cne '1.0.0') {
        Fail -Code 'POLICY_VERSION_INVALID' -Detail 'policy_version'
    }
}

function Assert-FixtureCoverage {
    param([string[]]$Required, [string[]]$Actual)
    $requiredUnique = @($Required | Sort-Object -Unique)
    $actualUnique = @($Actual | Sort-Object -Unique)
    if ($requiredUnique.Count -ne $Required.Count -or $actualUnique.Count -ne $Actual.Count) {
        Fail -Code 'POLICY_FIXTURE_COVERAGE_INVALID' -Detail 'duplicate_case_id'
    }
    if (($requiredUnique -join '|') -cne ($actualUnique -join '|')) {
        Fail -Code 'POLICY_FIXTURE_COVERAGE_INVALID' -Detail 'case_set'
    }
}

function Assert-NoLegacyScoreKeys {
    param($Value)
    $forbidden = @('score', 'scores', 'weight', 'weights', 'winner', 'route_scores', 'a_score', 'b_score', 'c_score')
    foreach ($property in @($Value.PSObject.Properties)) {
        if ($forbidden -ccontains $property.Name) {
            Fail -Code 'POLICY_LEGACY_SCORE_INVALID' -Detail $property.Name
        }
        $child = $property.Value
        if ($null -eq $child -or $child -is [string] -or $child -is [ValueType]) {
            continue
        }
        if ($child -is [Collections.IEnumerable]) {
            foreach ($item in @($child)) {
                if ($null -ne $item -and $item -isnot [string] -and $item -isnot [ValueType]) {
                    Assert-NoLegacyScoreKeys -Value $item
                }
            }
        }
        else {
            Assert-NoLegacyScoreKeys -Value $child
        }
    }
}

function Convert-ToInvariantDecimalString {
    param([decimal]$Value)
    return $Value.ToString('0.############################', [Globalization.CultureInfo]::InvariantCulture)
}

function Round-HalfUp {
    param([decimal]$Value, [int]$Places)
    $factor = [decimal]1
    for ($i = 0; $i -lt $Places; $i++) {
        $factor *= [decimal]10
    }
    if ($Value -ge 0) {
        return [decimal]([Math]::Floor($Value * $factor + [decimal]0.5) / $factor)
    }
    return [decimal]([Math]::Ceiling($Value * $factor - [decimal]0.5) / $factor)
}

function Test-AllConditions {
    param($InputObject, [string[]]$Required)
    foreach ($name in $Required) {
        $property = $InputObject.PSObject.Properties[$name]
        if ($null -eq $property -or [bool]$property.Value -ne $true) {
            return $false
        }
    }
    return $true
}

function Evaluate-PolicyCase {
    param($Policy, $Case)

    switch ([string]$Case.rule) {
        'unique_reliable_product' {
            $count = [int]$Case.input.remaining_count
            if (-not [bool]$Case.input.hard_conflicts_resolved) { return [string]$Policy.candidate_rules.unresolved_hard_conflict_result }
            if ([bool]$Case.input.similarity_only) { return [string]$Policy.candidate_rules.similarity_only_result }
            if ($count -eq [int]$Policy.candidate_rules.unique_remaining_count) { return 'unique' }
            if ($count -eq 0) { return 'none' }
            return 'multiple'
        }
        'quick_option_candidate' {
            $count = [int]$Case.input.option_count
            $valid = $count -ge [int]$Policy.quick_option_rules.min_options -and
                $count -le [int]$Policy.quick_option_rules.max_options -and
                [bool]$Case.input.complete_safe_actions -and
                [bool]$Case.input.live_target_revision -and
                [bool]$Case.input.safe_exit
            if ($valid) { return 'shown' }
            return 'hidden'
        }
        'near_expiry' {
            if (-not [bool]$Case.input.effective_expiration_known) { return 'unknown' }
            $remaining = [decimal]([string]$Case.input.remaining_hours)
            if ($remaining -le 0) { return 'expired' }
            $rule = @($Policy.expiry_policy.near_expiry_rules | Where-Object { $_.rule_id -ceq [string]$Case.input.rule_id })
            if ($rule.Count -ne 1) { return 'unknown' }
            if ($remaining -le [decimal]$rule[0].threshold_hours) { return 'near_expiry' }
            return 'normal'
        }
        'template_consistent' {
            if ([string]$Case.input.mode -ceq 'confirmation') {
                if (-not [bool]$Case.input.explicit) { return 'no_evidence' }
                $state = @($Policy.template_policy.confirmation_states | Where-Object { [int]$_.explicit_confirmation_count -eq [int]$Case.input.count })
                if ($state.Count -eq 1) { return [string]$state[0].status }
                return 'no_evidence'
            }
            if (-not [bool]$Case.input.same_major_components) { return 'materially_different' }
            if (-not [bool]$Case.input.no_unresolved_issues) { return 'cannot_learn' }
            $baseline = [decimal]([string]$Case.input.baseline_grams)
            $candidate = [decimal]([string]$Case.input.candidate_grams)
            $difference = [Math]::Abs($candidate - $baseline)
            $relative = $baseline * [decimal]([string]$Policy.template_policy.relative_tolerance_ratio)
            $limit = [Math]::Max([decimal]$Policy.template_policy.absolute_tolerance_grams, $relative)
            if ($difference -le $limit) { return 'consistent' }
            return 'materially_different'
        }
        'rounding' {
            $value = [decimal]([string]$Case.input.value)
            switch ([string]$Case.input.mode) {
                'display_quantity' {
                    return Convert-ToInvariantDecimalString (Round-HalfUp -Value $value -Places ([int]$Policy.rounding_policy.display_quantity_decimal_places))
                }
                'percentage' {
                    return Convert-ToInvariantDecimalString (Round-HalfUp -Value $value -Places ([int]$Policy.rounding_policy.percentage_decimal_places))
                }
                'ten_grid' {
                    $filled = Round-HalfUp -Value ($value / [decimal]10) -Places 0
                    if ($filled -lt 0) { $filled = 0 }
                    if ($filled -gt [decimal]$Policy.rounding_policy.ten_grid_segments) { $filled = [decimal]$Policy.rounding_policy.ten_grid_segments }
                    return Convert-ToInvariantDecimalString $filled
                }
                default { Fail -Code 'POLICY_CASE_RESULT_INVALID' -Detail ([string]$Case.case_id + ':rounding_mode') }
            }
        }
        'x_gate_001' {
            $gate = $Policy.b_only_gates.x_gate_001
            if ([bool]$Case.input.legacy_scores_present) { return [string]$gate.return_outcome }
            if (Test-AllConditions -InputObject $Case.input.conditions -Required @($gate.required_conditions)) { return [string]$gate.pass_outcome }
            return [string]$gate.return_outcome
        }
        'x_gate_002' {
            $gate = $Policy.b_only_gates.x_gate_002
            if ([bool]$Case.input.legacy_scores_present) { return [string]$gate.return_outcome }
            if (Test-AllConditions -InputObject $Case.input.conditions -Required @($gate.required_conditions)) { return [string]$gate.pass_outcome }
            return [string]$gate.return_outcome
        }
        default {
            Fail -Code 'POLICY_CASE_RESULT_INVALID' -Detail ([string]$Case.case_id + ':unknown_rule')
        }
    }
}

function Assert-StableFailure {
    param([scriptblock]$Action, [string]$ExpectedCode)
    $observed = $null
    try {
        & $Action
    }
    catch {
        $observed = [string]$_.Exception.Message
    }
    if ([string]::IsNullOrWhiteSpace($observed) -or -not $observed.StartsWith($ExpectedCode + ':', [StringComparison]::Ordinal)) {
        Fail -Code 'POLICY_CASE_RESULT_INVALID' -Detail ('mutation_expected_' + $ExpectedCode)
    }
}

if (-not [IO.File]::Exists($PolicyPath)) {
    Fail -Code 'POLICY_FILE_MISSING' -Detail $PolicyPath
}
if (-not [IO.File]::Exists($FixturePath)) {
    Fail -Code 'POLICY_FIXTURE_COVERAGE_INVALID' -Detail 'fixture_file_missing'
}

Assert-AsciiFile -Path $PolicyPath -Label 'policy'
Assert-AsciiFile -Path $FixturePath -Label 'fixtures'
Assert-PolicyHash -Actual (Get-Sha256 $PolicyPath) -Expected $ExpectedPolicySha256
Assert-Equal -Expected $ExpectedFixtureSha256 -Actual (Get-Sha256 $FixturePath) -Code 'POLICY_HASH_MISMATCH' -Detail 'decision_threshold_fixtures'

try {
    $policy = Get-Content -LiteralPath $PolicyPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $fixtures = Get-Content -LiteralPath $FixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
}
catch {
    Fail -Code 'POLICY_JSON_INVALID' -Detail $_.Exception.Message
}

Assert-ExactProperties -Value $policy -Expected @(
    'policy_id','policy_version','change_level','product_write_route','route_selection_mode','score_based_selection',
    'candidate_rules','quick_option_rules','expiry_policy','template_policy','rounding_policy','b_only_gates','required_fixture_ids'
) -Label 'policy'
Assert-Equal -Expected 'diet-manager/decision-thresholds/v1' -Actual $policy.policy_id -Code 'POLICY_IDENTITY_INVALID' -Detail 'policy_id'
Assert-PolicyVersion -Value ([string]$policy.policy_version)
Assert-Equal -Expected 'L3' -Actual $policy.change_level -Code 'POLICY_IDENTITY_INVALID' -Detail 'change_level'
Assert-Equal -Expected 'B' -Actual $policy.product_write_route -Code 'POLICY_IDENTITY_INVALID' -Detail 'product_write_route'
Assert-Equal -Expected 'fixed_b_only' -Actual $policy.route_selection_mode -Code 'POLICY_IDENTITY_INVALID' -Detail 'route_selection_mode'
Assert-True -Condition ([bool]$policy.score_based_selection -eq $false) -Code 'POLICY_LEGACY_SCORE_INVALID' -Detail 'score_based_selection'

Assert-ExactProperties -Value $policy.candidate_rules -Expected @('hard_conflict_fields','unique_remaining_count','similarity_rank_may_select','confirmed_alias_allowed','similarity_only_result','unresolved_hard_conflict_result') -Label 'candidate_rules'
Assert-ExactArray -Actual $policy.candidate_rules.hard_conflict_fields -Expected @('brand','variant','specification','food_form','confirmed_alias') -Label 'hard_conflict_fields'
Assert-Equal -Expected 1 -Actual $policy.candidate_rules.unique_remaining_count -Code 'POLICY_IDENTITY_INVALID' -Detail 'unique_remaining_count'
Assert-True -Condition ([bool]$policy.candidate_rules.similarity_rank_may_select -eq $false) -Code 'POLICY_IDENTITY_INVALID' -Detail 'similarity_rank_may_select'
Assert-True -Condition ([bool]$policy.candidate_rules.confirmed_alias_allowed -eq $true) -Code 'POLICY_IDENTITY_INVALID' -Detail 'confirmed_alias_allowed'
Assert-Equal -Expected 'needs_confirmation' -Actual $policy.candidate_rules.similarity_only_result -Code 'POLICY_IDENTITY_INVALID' -Detail 'similarity_only_result'
Assert-Equal -Expected 'needs_confirmation' -Actual $policy.candidate_rules.unresolved_hard_conflict_result -Code 'POLICY_IDENTITY_INVALID' -Detail 'unresolved_hard_conflict_result'

Assert-ExactProperties -Value $policy.quick_option_rules -Expected @('min_options','max_options','requires_complete_safe_action','requires_live_target_revision','requires_safe_exit','hidden_when_outside_range') -Label 'quick_option_rules'
Assert-Equal -Expected 2 -Actual $policy.quick_option_rules.min_options -Code 'POLICY_IDENTITY_INVALID' -Detail 'quick_min'
Assert-Equal -Expected 4 -Actual $policy.quick_option_rules.max_options -Code 'POLICY_IDENTITY_INVALID' -Detail 'quick_max'
Assert-True -Condition (
    [bool]$policy.quick_option_rules.requires_complete_safe_action -eq $true -and
    [bool]$policy.quick_option_rules.requires_live_target_revision -eq $true -and
    [bool]$policy.quick_option_rules.requires_safe_exit -eq $true -and
    [bool]$policy.quick_option_rules.hidden_when_outside_range -eq $true
) -Code 'POLICY_IDENTITY_INVALID' -Detail 'quick_option_flags'

Assert-ExactProperties -Value $policy.expiry_policy -Expected @('reliable_source_rank','opened_shelf_life_source_rank','category_derived_expiration_enabled','effective_expiration_rule','near_expiry_operator','threshold_unit','missing_rule_result','safety_semantics','near_expiry_rules') -Label 'expiry_policy'
Assert-ExactArray -Actual $policy.expiry_policy.reliable_source_rank -Expected @('user_explicit_expiration','product_label_expiration','production_plus_explicit_shelf_life','manufacturer_product_rule','confirmed_same_product_rule') -Label 'reliable_source_rank'
Assert-ExactArray -Actual $policy.expiry_policy.opened_shelf_life_source_rank -Expected @('user_explicit','product_label','manufacturer_product_rule','confirmed_same_product_rule') -Label 'opened_source_rank'
Assert-True -Condition ([bool]$policy.expiry_policy.category_derived_expiration_enabled -eq $false) -Code 'POLICY_IDENTITY_INVALID' -Detail 'category_derived_expiration_enabled'
Assert-Equal -Expected 'min(package_expiration, opened_at_plus_explicit_opened_shelf_life)' -Actual $policy.expiry_policy.effective_expiration_rule -Code 'POLICY_IDENTITY_INVALID' -Detail 'effective_expiration_rule'
Assert-Equal -Expected '0 < remaining_hours <= threshold_hours' -Actual $policy.expiry_policy.near_expiry_operator -Code 'POLICY_IDENTITY_INVALID' -Detail 'near_expiry_operator'
Assert-Equal -Expected 'hours' -Actual $policy.expiry_policy.threshold_unit -Code 'POLICY_IDENTITY_INVALID' -Detail 'threshold_unit'
Assert-Equal -Expected 'unknown' -Actual $policy.expiry_policy.missing_rule_result -Code 'POLICY_IDENTITY_INVALID' -Detail 'missing_rule_result'
Assert-Equal -Expected 'reminder_only_not_edibility_or_safety' -Actual $policy.expiry_policy.safety_semantics -Code 'POLICY_IDENTITY_INVALID' -Detail 'safety_semantics'
Assert-Equal -Expected 8 -Actual @($policy.expiry_policy.near_expiry_rules).Count -Code 'POLICY_IDENTITY_INVALID' -Detail 'near_expiry_rule_count'
$expiryTuples = @($policy.expiry_policy.near_expiry_rules | ForEach-Object {
    [string]$_.rule_id + ':' + [string]$_.category + ':' + [string]$_.storage_location + ':' + [string]$_.seal_status + ':' + [string]$_.threshold_hours
})
Assert-ExactArray -Actual $expiryTuples -Expected @(
    'prepared_refrigerated_opened:prepared_food:refrigerated:opened:24',
    'prepared_refrigerated_unopened:prepared_food:refrigerated:unopened:48',
    'perishable_refrigerated_opened:refrigerated_perishable:refrigerated:opened:24',
    'perishable_refrigerated_unopened:refrigerated_perishable:refrigerated:unopened:72',
    'frozen_opened:frozen_food:frozen:opened:168',
    'frozen_unopened:frozen_food:frozen:unopened:168',
    'shelf_stable_opened:shelf_stable:ambient:opened:168',
    'shelf_stable_unopened:shelf_stable:ambient:unopened:336'
) -Label 'near_expiry_rule_tuples'
foreach ($rule in @($policy.expiry_policy.near_expiry_rules)) {
    Assert-ExactProperties -Value $rule -Expected @('rule_id','category','storage_location','seal_status','threshold_hours') -Label ('expiry_rule_' + [string]$rule.rule_id)
    Assert-True -Condition ([decimal]$rule.threshold_hours -gt 0) -Code 'POLICY_IDENTITY_INVALID' -Detail ('expiry_threshold_' + [string]$rule.rule_id)
}

Assert-ExactProperties -Value $policy.template_policy -Expected @('major_component_set_must_match','absolute_tolerance_grams','relative_tolerance_ratio','amount_tolerance_operator','minor_component_categories','system_estimates_count_as_confirmation','confirmation_states') -Label 'template_policy'
Assert-True -Condition ([bool]$policy.template_policy.major_component_set_must_match -eq $true) -Code 'POLICY_IDENTITY_INVALID' -Detail 'major_component_set_must_match'
Assert-Equal -Expected 10 -Actual $policy.template_policy.absolute_tolerance_grams -Code 'POLICY_IDENTITY_INVALID' -Detail 'absolute_tolerance_grams'
Assert-Equal -Expected '0.10' -Actual $policy.template_policy.relative_tolerance_ratio -Code 'POLICY_IDENTITY_INVALID' -Detail 'relative_tolerance_ratio'
Assert-Equal -Expected 'difference <= max(absolute_tolerance_grams, baseline_grams * relative_tolerance_ratio)' -Actual $policy.template_policy.amount_tolerance_operator -Code 'POLICY_IDENTITY_INVALID' -Detail 'amount_tolerance_operator'
Assert-True -Condition ([bool]$policy.template_policy.system_estimates_count_as_confirmation -eq $false) -Code 'POLICY_IDENTITY_INVALID' -Detail 'system_estimates_count_as_confirmation'
Assert-ExactProperties -Value $policy.template_policy.minor_component_categories -Expected @('strict_composition','seasoning_tolerant') -Label 'minor_component_categories'
Assert-ExactArray -Actual $policy.template_policy.minor_component_categories.strict_composition -Expected @() -Label 'strict_composition'
Assert-ExactArray -Actual $policy.template_policy.minor_component_categories.seasoning_tolerant -Expected @('minor_seasoning') -Label 'seasoning_tolerant'
foreach ($state in @($policy.template_policy.confirmation_states)) {
    Assert-ExactProperties -Value $state -Expected @('explicit_confirmation_count','status') -Label ('confirmation_' + [string]$state.explicit_confirmation_count)
}
Assert-Equal -Expected '1:candidate|2:active|3:stable' -Actual ((@($policy.template_policy.confirmation_states | ForEach-Object { [string]$_.explicit_confirmation_count + ':' + [string]$_.status })) -join '|') -Code 'POLICY_IDENTITY_INVALID' -Detail 'confirmation_states'

Assert-ExactProperties -Value $policy.rounding_policy -Expected @('internal_rounding','display_quantity_decimal_places','display_quantity_mode','percentage_decimal_places','percentage_mode','ten_grid_segments','ten_grid_mode','decimal_separator') -Label 'rounding_policy'
Assert-Equal -Expected 'none' -Actual $policy.rounding_policy.internal_rounding -Code 'POLICY_IDENTITY_INVALID' -Detail 'internal_rounding'
Assert-Equal -Expected 1 -Actual $policy.rounding_policy.display_quantity_decimal_places -Code 'POLICY_IDENTITY_INVALID' -Detail 'quantity_places'
Assert-Equal -Expected 'round_half_up' -Actual $policy.rounding_policy.display_quantity_mode -Code 'POLICY_IDENTITY_INVALID' -Detail 'quantity_mode'
Assert-Equal -Expected 'round_half_up' -Actual $policy.rounding_policy.percentage_mode -Code 'POLICY_IDENTITY_INVALID' -Detail 'percentage_mode'
Assert-Equal -Expected 0 -Actual $policy.rounding_policy.percentage_decimal_places -Code 'POLICY_IDENTITY_INVALID' -Detail 'percentage_places'
Assert-Equal -Expected 10 -Actual $policy.rounding_policy.ten_grid_segments -Code 'POLICY_IDENTITY_INVALID' -Detail 'ten_grid_segments'
Assert-Equal -Expected 'round_half_up_percentage_divided_by_10_clamped' -Actual $policy.rounding_policy.ten_grid_mode -Code 'POLICY_IDENTITY_INVALID' -Detail 'ten_grid_mode'
Assert-Equal -Expected '.' -Actual $policy.rounding_policy.decimal_separator -Code 'POLICY_IDENTITY_INVALID' -Detail 'decimal_separator'

Assert-ExactProperties -Value $policy.b_only_gates -Expected @('x_gate_001','x_gate_002') -Label 'b_only_gates'
$g1 = $policy.b_only_gates.x_gate_001
$g2 = $policy.b_only_gates.x_gate_002
Assert-ExactProperties -Value $g1 -Expected @('allowed_outcomes','pass_outcome','return_outcome','required_conditions','score_fields_allowed') -Label 'x_gate_001'
Assert-ExactProperties -Value $g2 -Expected @('allowed_outcomes','pass_outcome','return_outcome','required_conditions','score_fields_allowed','map_creation_outcome') -Label 'x_gate_002'
Assert-ExactArray -Actual $g1.allowed_outcomes -Expected @('pass_b_safety','return_to_b_storage') -Label 'g1_outcomes'
Assert-ExactArray -Actual $g2.allowed_outcomes -Expected @('bind_b_ready','return_to_b_slice') -Label 'g2_outcomes'
Assert-Equal -Expected 'pass_b_safety' -Actual $g1.pass_outcome -Code 'POLICY_IDENTITY_INVALID' -Detail 'g1_pass'
Assert-Equal -Expected 'return_to_b_storage' -Actual $g1.return_outcome -Code 'POLICY_IDENTITY_INVALID' -Detail 'g1_return'
Assert-Equal -Expected 'bind_b_ready' -Actual $g2.pass_outcome -Code 'POLICY_IDENTITY_INVALID' -Detail 'g2_pass'
Assert-Equal -Expected 'return_to_b_slice' -Actual $g2.return_outcome -Code 'POLICY_IDENTITY_INVALID' -Detail 'g2_return'
Assert-Equal -Expected 'bind_b_ready' -Actual $g2.map_creation_outcome -Code 'POLICY_IDENTITY_INVALID' -Detail 'map_creation_outcome'
Assert-ExactArray -Actual $g1.required_conditions -Expected @(
    'shared_models_frozen',
    'b_merge_c_controls_passed',
    'b_storage_driver_compatible',
    'b_migrations_and_constraints_passed',
    'b_fault_matrix_passed',
    'official_roots_unchanged',
    'fresh_evidence_present'
) -Label 'g1_required_conditions'
Assert-ExactArray -Actual $g2.required_conditions -Expected @(
    'x_gate_001_pass_b_safety',
    'b_slice_evidence_fresh',
    'b_fault_evidence_fresh',
    'contract_ids_and_hashes_frozen',
    'absolute_paths_complete',
    'selected_route_map_absent',
    'no_legacy_route_scores'
) -Label 'g2_required_conditions'
Assert-True -Condition ([bool]$g1.score_fields_allowed -eq $false -and [bool]$g2.score_fields_allowed -eq $false) -Code 'POLICY_LEGACY_SCORE_INVALID' -Detail 'gate_score_fields'
Assert-NoLegacyScoreKeys -Value $policy

Assert-ExactProperties -Value $fixtures -Expected @('fixture_id','fixture_version','policy_id','policy_version','cases') -Label 'fixtures'
Assert-Equal -Expected 'diet-manager/decision-threshold-fixtures/v1' -Actual $fixtures.fixture_id -Code 'POLICY_IDENTITY_INVALID' -Detail 'fixture_id'
Assert-Equal -Expected 'diet-manager/decision-thresholds/v1' -Actual $fixtures.policy_id -Code 'POLICY_IDENTITY_INVALID' -Detail 'fixture_policy_id'
Assert-PolicyVersion -Value ([string]$fixtures.policy_version)

$policyCaseIds = @($policy.required_fixture_ids | ForEach-Object { [string]$_ })
$fixtureCaseIds = @($fixtures.cases | ForEach-Object { [string]$_.case_id })
Assert-ExactArray -Actual $policyCaseIds -Expected $ExpectedCaseIds -Label 'required_fixture_ids_order'
Assert-FixtureCoverage -Required $ExpectedCaseIds -Actual $fixtureCaseIds

foreach ($case in @($fixtures.cases)) {
    Assert-ExactProperties -Value $case -Expected @('case_id','rule','input','expected') -Label ('case_' + [string]$case.case_id)
    $actual = Evaluate-PolicyCase -Policy $policy -Case $case
    Assert-Equal -Expected $case.expected -Actual $actual -Code 'POLICY_CASE_RESULT_INVALID' -Detail ([string]$case.case_id)
}

Assert-StableFailure -ExpectedCode 'POLICY_VERSION_INVALID' -Action { Assert-PolicyVersion -Value '0.0.0' }
Assert-StableFailure -ExpectedCode 'POLICY_HASH_MISMATCH' -Action { Assert-PolicyHash -Actual ('0' * 64) -Expected $ExpectedPolicySha256 }
Assert-StableFailure -ExpectedCode 'POLICY_FIXTURE_COVERAGE_INVALID' -Action { Assert-FixtureCoverage -Required $ExpectedCaseIds -Actual @($fixtureCaseIds | Select-Object -Skip 1) }
$legacyMutation = $policy | ConvertTo-Json -Depth 32 | ConvertFrom-Json
$legacyMutation | Add-Member -NotePropertyName route_scores -NotePropertyValue @{}
Assert-StableFailure -ExpectedCode 'POLICY_LEGACY_SCORE_INVALID' -Action { Assert-NoLegacyScoreKeys -Value $legacyMutation }

$output = 'DECISION_THRESHOLDS|PASS|id=' + [string]$policy.policy_id +
    '|version=' + [string]$policy.policy_version +
    '|cases=' + [string]@($fixtures.cases).Count +
    '|expiry_rules=' + [string]@($policy.expiry_policy.near_expiry_rules).Count +
    '|gates=2|mutations=4'
Write-Output $output
