[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$SchemaPath = Join-Path $ProjectRoot 'shared\schemas\nutrition-progress.schema.json'
$FixturePath = Join-Path $ProjectRoot 'shared\tests\fixtures\nutrition-progress-cases.json'
$ExpectedSchemaId = 'https://diet-manager.local/schemas/nutrition-progress/v1'
$ExpectedFixtureSetId = 'diet-manager/nutrition-progress-cases/v1'
$ExpectedVersion = '1.1.0'
$CompatibleModelVersions = @('1.0.0', '1.1.0')
$ExpectedSchemaSha256 = 'D172E4B3282F6FC5EC884BEFA40A17536F5B773B5A54CEB27011AF493F5671D8'
$ExpectedFixtureSha256 = '0A944537D8A5E5D0C29EFFF9701559DB1371D2D8E65ED25C40212BC699BFDC27'
$ExpectedCaseIds = @(
    'NUTR-PROFILE-COMPLETE-VALID',
    'NUTR-PROFILE-PARTIAL-VALID',
    'NUTR-PROFILE-V2-SUPERSEDES-VALID',
    'NUTR-PROFILE-JSON-NUMBER-INVALID',
    'NUTR-PROFILE-UNKNOWN-ZERO-INVALID',
    'NUTR-PROFILE-ESTIMATED-COVERAGE-INVALID',
    'NUTR-PROFILE-GENERIC-STATUS-INVALID',
    'NUTR-PROFILE-EXTRA-PROPERTY-INVALID',
    'NUTR-SNAPSHOT-COMPLETE-VALID',
    'NUTR-SNAPSHOT-PARTIAL-VALID',
    'NUTR-SNAPSHOT-UNKNOWN-VALID',
    'NUTR-SNAPSHOT-V11-KNOWN-AMOUNT-NULL-INVALID',
    'NUTR-SNAPSHOT-KNOWN-MISSING-OVERLAP-INVALID',
    'NUTR-SNAPSHOT-KNOWN-NULL-INVALID',
    'NUTR-SNAPSHOT-MISSING-NONNULL-INVALID',
    'NUTR-SNAPSHOT-COMPLETE-MISSING-INVALID',
    'NUTR-SNAPSHOT-PROFILE-VERSION-INVALID',
    'NUTR-SNAPSHOT-JSON-NUMBER-INVALID',
    'NUTR-SNAPSHOT-GENERIC-STATUS-INVALID',
    'NUTR-GOAL-SIX-METRICS-VALID',
    'NUTR-GOAL-PARTIAL-CONFIG-VALID',
    'NUTR-GOAL-NO-CONFIRMATION-INVALID',
    'NUTR-GOAL-ALL-UNCONFIGURED-INVALID',
    'NUTR-GOAL-NEGATIVE-INVALID',
    'NUTR-GOAL-EFFECTIVE-RANGE-INVALID',
    'NUTR-GOAL-JSON-NUMBER-INVALID',
    'NUTR-GOAL-EXTRA-METRIC-INVALID',
    'NUTR-PROGRESS-SINGLE-DAY-VALID',
    'NUTR-PROGRESS-CROSS-DAY-CORRECTION-VALID',
    'NUTR-PROGRESS-DIRECT-QUERY-VALID',
    'NUTR-PROGRESS-UNKNOWN-FIBER-VALID',
    'NUTR-PROGRESS-WATER-LOWER-BOUND-VALID',
    'NUTR-PROGRESS-WRONG-ORDER-INVALID',
    'NUTR-PROGRESS-NEGATIVE-TOTAL-INVALID',
    'NUTR-PROGRESS-UNKNOWN-ZERO-INVALID',
    'NUTR-PROGRESS-DIRECT-INCREMENT-INVALID',
    'NUTR-PROGRESS-SINGLE-ALIAS-MISSING-INVALID',
    'NUTR-PROGRESS-SINGLE-ALIAS-MISMATCH-INVALID',
    'NUTR-PROGRESS-MULTI-ALIAS-INVALID',
    'NUTR-PROGRESS-DATE-ORDER-INVALID',
    'NUTR-PROGRESS-DUPLICATE-DATE-INVALID',
    'NUTR-PROGRESS-JSON-NUMBER-INVALID',
    'NUTR-PROGRESS-GENERIC-STATUS-INVALID'
)

function Fail([string]$Code, [string]$Detail) {
    throw "$Code`:$Detail"
}

function Has-Property($Object, [string]$Name) {
    return $null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]
}

function Get-Value($Object, [string]$Name) {
    if (-not (Has-Property $Object $Name)) { return $null }
    return $Object.PSObject.Properties[$Name].Value
}

function Get-RawValue($Object, [string]$Name) {
    if (-not (Has-Property $Object $Name)) { return $null }
    Write-Output -NoEnumerate ($Object.PSObject.Properties[$Name].Value)
}

function Read-JsonStrict([string]$Path) {
    try {
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        return ([IO.File]::ReadAllText($Path, $utf8) | ConvertFrom-Json -DateKind String)
    } catch {
        Fail 'NUTRITION_PROGRESS_JSON_INVALID' ("$Path $($_.Exception.Message)")
    }
}

function Assert-RequiredProperties($Object, [string[]]$Names, [string]$Label) {
    foreach ($name in $Names) {
        if (-not (Has-Property $Object $name)) {
            Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label missing property $name"
        }
    }
}

function Assert-ExactProperties($Object, [string[]]$Names, [string]$Label) {
    Assert-RequiredProperties $Object $Names $Label
    $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($name in $Names) { [void]$allowed.Add($name) }
    foreach ($property in @($Object.PSObject.Properties)) {
        if (-not $allowed.Contains([string]$property.Name)) {
            Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label unexpected property $([string]$property.Name)"
        }
    }
}

function Assert-NonEmptyString($Value, [string]$Label) {
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label empty"
    }
}

function Assert-Timestamp($Value, [string]$Label) {
    Assert-NonEmptyString $Value $Label
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)) {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label invalid timestamp"
    }
}

function Convert-Date([string]$Value, [string]$Label) {
    $parsed = [DateTime]::MinValue
    if (-not [DateTime]::TryParseExact($Value, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)) {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label invalid date"
    }
    return $parsed
}

function Test-CanonicalDecimalString($Value) {
    if ($Value -isnot [string]) { return $false }
    if (-not [regex]::IsMatch([string]$Value, '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$', [Text.RegularExpressions.RegexOptions]::CultureInvariant)) { return $false }
    if ([string]$Value -match '^-0(?:\.0+)?$') { return $false }
    return $true
}

function Convert-Decimal([string]$Value) {
    return [decimal]::Parse($Value, [Globalization.NumberStyles]::AllowLeadingSign -bor [Globalization.NumberStyles]::AllowDecimalPoint, [Globalization.CultureInfo]::InvariantCulture)
}

function Assert-Decimal($Value, [string]$Label, [bool]$AllowNegative, [bool]$AllowNull) {
    if ($null -eq $Value) {
        if ($AllowNull) { return }
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label decimal required"
    }
    if (-not (Test-CanonicalDecimalString $Value)) {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label decimal"
    }
    if (-not $AllowNegative -and (Convert-Decimal ([string]$Value)) -lt 0) {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label negative"
    }
}

function Resolve-TemplateNode($Value, $Templates) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [string] -or $Value -is [ValueType]) { return $Value }
    if ($Value -is [Collections.IList]) {
        $items = New-Object Collections.ArrayList
        foreach ($item in @($Value)) { [void]$items.Add((Resolve-TemplateNode $item $Templates)) }
        return ,([object[]]$items.ToArray())
    }
    if (Has-Property $Value '$template') {
        $templateId = [string](Get-Value $Value '$template')
        if (-not (Has-Property $Templates $templateId)) {
            Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' "unknown template $templateId"
        }
        $resolved = Resolve-TemplateNode (Get-Value $Templates $templateId) $Templates
        if (Has-Property $Value '$set') {
            $set = Get-Value $Value '$set'
            foreach ($property in @($set.PSObject.Properties)) {
                $nextValue = Resolve-TemplateNode $property.Value $Templates
                if (Has-Property $resolved $property.Name) {
                    $resolved.PSObject.Properties[$property.Name].Value = $nextValue
                } else {
                    $resolved | Add-Member -MemberType NoteProperty -Name $property.Name -Value $nextValue
                }
            }
        }
        return $resolved
    }
    $copy = [ordered]@{}
    foreach ($property in @($Value.PSObject.Properties)) {
        $copy[$property.Name] = Resolve-TemplateNode $property.Value $Templates
    }
    return [pscustomobject]$copy
}

function Apply-FixtureMutation($Root, $Mutation, $Templates) {
    $operation = [string](Get-Value $Mutation 'op')
    $path = [string](Get-Value $Mutation 'path')
    if ($operation -notin @('set', 'remove') -or -not $path.StartsWith('/')) {
        Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' "mutation $operation $path"
    }
    $segments = @($path.TrimStart('/').Split('/') | ForEach-Object { $_.Replace('~1', '/').Replace('~0', '~') })
    $current = $Root
    for ($index = 0; $index -lt ($segments.Count - 1); $index++) {
        $segment = $segments[$index]
        if ($current -is [Array]) {
            $current = $current[[int]$segment]
        } else {
            if (-not (Has-Property $current $segment)) {
                Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' "missing mutation parent $path"
            }
            $current = $current.PSObject.Properties[$segment].Value
        }
        if ($null -eq $current) {
            Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' "null mutation parent $path"
        }
    }
    $leaf = $segments[-1]
    if ($current -is [Array]) {
        if ($operation -eq 'remove') { Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' 'array removal unsupported' }
        $current[[int]$leaf] = Resolve-TemplateNode (Get-Value $Mutation 'value') $Templates
        return
    }
    if ($operation -eq 'remove') {
        if (-not (Has-Property $current $leaf)) { Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' "missing mutation leaf $path" }
        $current.PSObject.Properties.Remove($leaf)
        return
    }
    $nextValue = Resolve-TemplateNode (Get-Value $Mutation 'value') $Templates
    $current | Add-Member -MemberType NoteProperty -Name $leaf -Value $nextValue -Force
}

$NutrientFields = @('energy_kcal', 'protein_g', 'fat_g', 'carbohydrate_g', 'fiber_g', 'energy_kj', 'sodium_mg', 'sugar_g', 'saturated_fat_g', 'water_ml')
$CoreNutrientFields = @('energy_kcal', 'protein_g', 'fat_g', 'carbohydrate_g', 'fiber_g')
$MetricFields = @('energy_kcal', 'protein_g', 'fat_g', 'carbohydrate_g', 'fiber_g', 'water_ml')
$CoverageValues = @('complete', 'partial', 'unknown', 'not_applicable')
$SourceTypes = @('product_label', 'confirmed_same_product_history', 'authoritative_public_database', 'trusted_public_web', 'personal_template', 'generic_template', 'generic_estimate', 'unknown')

function Assert-Coverage($Value, [string]$Label) {
    if ($Value -isnot [string] -or [string]$Value -notin $CoverageValues) {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label coverage status"
    }
}

function Assert-StringSet($Value, [string[]]$Allowed, [string]$Label) {
    if ($null -eq $Value -or $Value -isnot [Collections.IList]) {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label array"
    }
    $allowedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($item in $Allowed) { [void]$allowedSet.Add($item) }
    $result = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($item in @($Value)) {
        if ($item -isnot [string] -or -not $allowedSet.Contains([string]$item)) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label value $item" }
        if (-not $result.Add([string]$item)) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label duplicate $item" }
    }
    return ,$result
}

function Assert-NutrientValues($Value, [string]$Label) {
    Assert-ExactProperties $Value $NutrientFields $Label
    foreach ($field in $NutrientFields) {
        Assert-Decimal (Get-Value $Value $field) "$Label $field" $false $true
    }
}

function Assert-NutrientCoverage($Values, [string]$Coverage, [string]$Label) {
    Assert-Coverage $Coverage $Label
    $knownCount = 0
    foreach ($field in $NutrientFields) { if ($null -ne (Get-Value $Values $field)) { $knownCount++ } }
    $missingCore = @($CoreNutrientFields | Where-Object { $null -eq (Get-Value $Values $_) })
    switch ($Coverage) {
        'complete' {
            if ($missingCore.Count -ne 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label complete core field missing $($missingCore[0])" }
        }
        'partial' {
            if ($knownCount -eq 0 -or $missingCore.Count -eq 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label partial coverage mismatch" }
        }
        'unknown' {
            if ($knownCount -ne 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label unknown contains known nutrient" }
        }
        'not_applicable' {
            if ($knownCount -ne 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label not_applicable contains nutrient" }
        }
    }
}

function Assert-FieldEvidence($Value, [string]$Label) {
    $properties = @('field_name', 'evidence_kind', 'source_ref', 'estimated', 'rule_version')
    Assert-ExactProperties $Value $properties $Label
    if ([string](Get-Value $Value 'field_name') -notin $NutrientFields) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label field_name" }
    if ([string](Get-Value $Value 'evidence_kind') -notin @('explicit_user', 'product_label', 'confirmed_history', 'authoritative_database', 'trusted_web', 'personal_template', 'generic_template', 'deterministic_conversion', 'bounded_estimate', 'unknown')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label evidence_kind" }
    if ((Get-Value $Value 'estimated') -isnot [bool]) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label estimated boolean" }
}

function Assert-Profile($Value) {
    $properties = @('nutrition_profile_id', 'schema_version', 'subject_type', 'subject_id', 'applicable_variant', 'profile_version', 'source_type', 'source_name', 'source_ref', 'source_version', 'retrieved_at', 'basis_kind', 'basis_amount', 'basis_unit', 'serving_name', 'serving_size', 'servings_per_package', 'nutrient_values', 'raw_label_values', 'parsed_fields', 'field_evidence', 'coverage_status', 'issues', 'created_at', 'supersedes_profile_id')
    Assert-ExactProperties $Value $properties 'profile'
    foreach ($name in @('nutrition_profile_id', 'subject_id', 'profile_version', 'source_name', 'source_ref', 'source_version')) { Assert-NonEmptyString (Get-Value $Value $name) "profile $name" }
    if ([string](Get-Value $Value 'schema_version') -notin $CompatibleModelVersions) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile schema_version' }
    if ([string](Get-Value $Value 'subject_type') -notin @('food', 'product')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile subject_type' }
    if ([string](Get-Value $Value 'source_type') -notin $SourceTypes) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile source_type' }
    if ([string](Get-Value $Value 'basis_kind') -notin @('per_100g', 'per_100ml', 'per_serving', 'per_item', 'per_package', 'custom_recipe')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile basis_kind' }
    if ([string](Get-Value $Value 'basis_unit') -notin @('g', 'ml', 'serving', 'item', 'package', 'recipe')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile basis_unit' }
    Assert-Decimal (Get-Value $Value 'basis_amount') 'profile basis_amount' $false $false
    if ((Convert-Decimal ([string](Get-Value $Value 'basis_amount'))) -le 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile basis_amount positive' }
    Assert-Decimal (Get-Value $Value 'serving_size') 'profile serving_size' $false $true
    Assert-Decimal (Get-Value $Value 'servings_per_package') 'profile servings_per_package' $false $true
    Assert-Timestamp (Get-Value $Value 'retrieved_at') 'profile retrieved_at'
    Assert-Timestamp (Get-Value $Value 'created_at') 'profile created_at'
    $nutrients = Get-Value $Value 'nutrient_values'
    Assert-NutrientValues $nutrients 'profile nutrient'
    Assert-NutrientCoverage $nutrients ([string](Get-Value $Value 'coverage_status')) 'profile'
    $nonnull = @($NutrientFields | Where-Object { $null -ne (Get-Value $nutrients $_) })
    $parsed = Assert-StringSet (Get-RawValue $Value 'parsed_fields') $NutrientFields 'profile parsed_fields'
    if ($parsed.Count -ne $nonnull.Count) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile parsed_fields coverage' }
    foreach ($field in $nonnull) { if (-not $parsed.Contains($field)) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "profile parsed_fields missing $field" } }
    $evidence = Get-RawValue $Value 'field_evidence'
    if ($evidence -isnot [Collections.IList] -or @($evidence).Count -eq 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile field_evidence empty' }
    foreach ($item in @($evidence)) { Assert-FieldEvidence $item 'profile field_evidence' }
    $supersedes = Get-Value $Value 'supersedes_profile_id'
    if ($null -ne $supersedes) {
        Assert-NonEmptyString $supersedes 'profile supersedes_profile_id'
        if ([string]$supersedes -eq [string](Get-Value $Value 'nutrition_profile_id')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile supersedes self' }
    }
}

function Assert-Snapshot($Value) {
    $properties = @('snapshot_id', 'schema_version', 'meal_event_id', 'intake_item_id', 'nutrition_profile_id', 'profile_version', 'source_type', 'source_ref', 'basis_amount', 'basis_unit', 'consumed_amount', 'consumed_unit', 'nutrient_values', 'formula', 'rounding_rule', 'estimated_fields', 'uncertainty', 'known_fields', 'missing_fields', 'coverage_status', 'created_at')
    Assert-ExactProperties $Value $properties 'snapshot'
    foreach ($name in @('snapshot_id', 'meal_event_id', 'intake_item_id', 'nutrition_profile_id', 'profile_version', 'source_ref', 'formula')) { Assert-NonEmptyString (Get-Value $Value $name) "snapshot $name" }
    $snapshotVersion = [string](Get-Value $Value 'schema_version')
    if ($snapshotVersion -notin $CompatibleModelVersions) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot schema_version' }
    if ([string](Get-Value $Value 'source_type') -notin $SourceTypes) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot source_type' }
    if ([string](Get-Value $Value 'basis_unit') -notin @('g', 'ml', 'serving', 'item', 'package', 'recipe')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot basis_unit' }
    Assert-Decimal (Get-Value $Value 'basis_amount') 'snapshot basis_amount' $false $false
    $consumedAmount = Get-Value $Value 'consumed_amount'
    $consumedUnit = Get-Value $Value 'consumed_unit'
    if ($null -eq $consumedAmount) {
        if ($snapshotVersion -ne '1.1.0' -or $null -ne $consumedUnit -or
            [string](Get-Value $Value 'source_type') -ne 'unknown' -or
            [string](Get-Value $Value 'coverage_status') -ne 'unknown') {
            Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot known source amount required'
        }
    } else {
        Assert-NonEmptyString $consumedUnit 'snapshot consumed_unit'
        Assert-Decimal $consumedAmount 'snapshot consumed_amount' $false $false
        if ((Convert-Decimal ([string]$consumedAmount)) -le 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot amount positive' }
    }
    if ((Convert-Decimal ([string](Get-Value $Value 'basis_amount'))) -le 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot amount positive' }
    if ([string](Get-Value $Value 'rounding_rule') -ne 'stable_decimal_then_display_half_up') { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot rounding_rule' }
    if ([string](Get-Value $Value 'uncertainty') -notin @('none', 'bounded', 'unbounded', 'unknown')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot uncertainty' }
    Assert-Timestamp (Get-Value $Value 'created_at') 'snapshot created_at'
    $nutrients = Get-Value $Value 'nutrient_values'
    Assert-NutrientValues $nutrients 'snapshot nutrient'
    $known = Assert-StringSet (Get-RawValue $Value 'known_fields') $NutrientFields 'snapshot known_fields'
    $missing = Assert-StringSet (Get-RawValue $Value 'missing_fields') $NutrientFields 'snapshot missing_fields'
    [void](Assert-StringSet (Get-RawValue $Value 'estimated_fields') $NutrientFields 'snapshot estimated_fields')
    foreach ($field in $NutrientFields) {
        if ($known.Contains($field) -and $missing.Contains($field)) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "snapshot known missing overlap $field" }
        if (-not $known.Contains($field) -and -not $missing.Contains($field)) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "snapshot field unclassified $field" }
        $fieldValue = Get-Value $nutrients $field
        if ($known.Contains($field) -and $null -eq $fieldValue) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "snapshot known field null $field" }
        if ($missing.Contains($field) -and $null -ne $fieldValue) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "snapshot missing field nonnull $field" }
    }
    if ($null -eq $consumedAmount -and $known.Count -ne 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'snapshot unknown amount known fields' }
    Assert-NutrientCoverage $nutrients ([string](Get-Value $Value 'coverage_status')) 'snapshot'
}

function Assert-MetricValues($Value, [string]$Label, [bool]$AllowNegative) {
    Assert-ExactProperties $Value $MetricFields $Label
    $knownCount = 0
    foreach ($field in $MetricFields) {
        $fieldValue = Get-Value $Value $field
        if ($null -ne $fieldValue -and -not (Test-CanonicalDecimalString $fieldValue)) {
            Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label decimal $field"
        }
        if (-not $AllowNegative -and $null -ne $fieldValue -and (Convert-Decimal ([string]$fieldValue)) -lt 0) {
            Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$Label negative $field"
        }
        if ($null -ne $fieldValue) { $knownCount++ }
    }
    return $knownCount
}

function Assert-Goal($Value) {
    $properties = @('goal_version_id', 'schema_version', 'user_id', 'timezone', 'effective_from', 'effective_to', 'confirmed_by_source_message_id', 'created_at', 'goals')
    Assert-ExactProperties $Value $properties 'goal'
    foreach ($name in @('goal_version_id', 'user_id', 'timezone')) { Assert-NonEmptyString (Get-Value $Value $name) "goal $name" }
    Assert-NonEmptyString (Get-Value $Value 'confirmed_by_source_message_id') 'goal confirmation'
    if ([string](Get-Value $Value 'schema_version') -ne '1.0.0') { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'goal schema_version' }
    $from = Convert-Date ([string](Get-Value $Value 'effective_from')) 'goal effective_from'
    $toValue = Get-Value $Value 'effective_to'
    if ($null -ne $toValue) {
        $to = Convert-Date ([string]$toValue) 'goal effective_to'
        if ($to -le $from) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'goal effective range' }
    }
    Assert-Timestamp (Get-Value $Value 'created_at') 'goal created_at'
    $known = Assert-MetricValues (Get-Value $Value 'goals') 'goal' $false
    if ($known -eq 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'goal all goals unconfigured' }
}

function Assert-MetricCoverage($Value, [string]$Label) {
    Assert-ExactProperties $Value $MetricFields $Label
    foreach ($field in $MetricFields) { Assert-Coverage (Get-Value $Value $field) "$Label $field" }
}

function Assert-Daily($Value, [string]$ResultKind) {
    $properties = @('date', 'timezone', 'goal_version_id', 'metric_order', 'committed_totals', 'configured_goals', 'current_turn_increments', 'metric_coverage', 'coverage_status', 'unknown_item_ids', 'water_known_min_ml', 'idempotency_result_id', 'generated_at')
    Assert-ExactProperties $Value $properties 'daily'
    [void](Convert-Date ([string](Get-Value $Value 'date')) 'daily date')
    Assert-NonEmptyString (Get-Value $Value 'timezone') 'daily timezone'
    $order = Get-RawValue $Value 'metric_order'
    if ($order -isnot [Collections.IList] -or @($order).Count -ne $MetricFields.Count) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'daily metric order' }
    for ($index = 0; $index -lt $MetricFields.Count; $index++) { if ([string]$order[$index] -ne $MetricFields[$index]) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'daily metric order' } }
    $totals = Get-Value $Value 'committed_totals'
    $goals = Get-Value $Value 'configured_goals'
    [void](Assert-MetricValues $totals 'daily total' $false)
    $goalCount = Assert-MetricValues $goals 'daily goal' $false
    $increments = Get-Value $Value 'current_turn_increments'
    if ($null -ne $increments) { [void](Assert-MetricValues $increments 'daily increment' $true) }
    $metricCoverage = Get-Value $Value 'metric_coverage'
    Assert-MetricCoverage $metricCoverage 'daily coverage'
    Assert-Coverage (Get-Value $Value 'coverage_status') 'daily'
    foreach ($field in $MetricFields) {
        $fieldValue = Get-Value $totals $field
        $fieldCoverage = [string](Get-Value $metricCoverage $field)
        if ($fieldCoverage -in @('unknown', 'not_applicable') -and $null -ne $fieldValue) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "daily unknown metric has value $field" }
        if ($fieldCoverage -eq 'complete' -and $null -eq $fieldValue) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "daily complete metric missing $field" }
    }
    if ($goalCount -gt 0) { Assert-NonEmptyString (Get-Value $Value 'goal_version_id') 'daily goal_version_id' }
    $waterTotal = Get-Value $totals 'water_ml'
    $waterLower = Get-Value $Value 'water_known_min_ml'
    Assert-Decimal $waterLower 'daily water_known_min_ml' $false $true
    if ($null -ne $waterLower) {
        if ($null -ne $waterTotal -or [string](Get-Value $metricCoverage 'water_ml') -ne 'partial') { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'daily water lower bound coherence' }
    } elseif ($null -eq $waterTotal -and [string](Get-Value $metricCoverage 'water_ml') -eq 'partial') {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'daily water lower bound missing'
    }
    $unknownIds = Get-RawValue $Value 'unknown_item_ids'
    if ($unknownIds -isnot [Collections.IList]) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'daily unknown_item_ids array' }
    $seenIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($id in @($unknownIds)) { Assert-NonEmptyString $id 'daily unknown item'; if (-not $seenIds.Add([string]$id)) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "daily duplicate unknown item $id" } }
    Assert-Timestamp (Get-Value $Value 'generated_at') 'daily generated_at'
    if ($ResultKind -eq 'direct_query') {
        if ($null -ne $increments) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'daily direct query increments' }
        if ($null -ne (Get-Value $Value 'idempotency_result_id')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'daily direct query idempotency' }
    } else {
        if ($null -eq $increments) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'daily finalized increments missing' }
        Assert-NonEmptyString (Get-Value $Value 'idempotency_result_id') 'daily idempotency_result_id'
    }
}

function Get-CanonicalJson($Value) {
    return ($Value | ConvertTo-Json -Depth 64 -Compress)
}

function Assert-ProgressResult($Value) {
    $allowed = @('result_id', 'schema_version', 'result_status', 'result_kind', 'daily_progress_by_date', 'daily_progress')
    Assert-RequiredProperties $Value @('result_id', 'schema_version', 'result_status', 'result_kind', 'daily_progress_by_date') 'result'
    foreach ($property in @($Value.PSObject.Properties)) { if ([string]$property.Name -notin $allowed) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "result unexpected property $([string]$property.Name)" } }
    Assert-NonEmptyString (Get-Value $Value 'result_id') 'result result_id'
    if ([string](Get-Value $Value 'schema_version') -ne '1.0.0') { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'result schema_version' }
    if ([string](Get-Value $Value 'result_status') -ne 'committed') { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'result status must be committed' }
    $kind = [string](Get-Value $Value 'result_kind')
    if ($kind -notin @('write_finalized', 'direct_query')) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'result kind' }
    $items = Get-RawValue $Value 'daily_progress_by_date'
    if ($items -isnot [Collections.IList] -or @($items).Count -eq 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'result dates empty' }
    $previous = $null
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($item in @($items)) {
        Assert-Daily $item $kind
        $date = [string](Get-Value $item 'date')
        if (-not $seen.Add($date)) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "result duplicate date $date" }
        if ($null -ne $previous -and [StringComparer]::Ordinal.Compare($previous, $date) -ge 0) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'result date order' }
        $previous = $date
    }
    $hasAlias = Has-Property $Value 'daily_progress'
    if (@($items).Count -eq 1) {
        if (-not $hasAlias) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'result single day alias missing' }
        Assert-Daily (Get-Value $Value 'daily_progress') $kind
        if ((Get-CanonicalJson $items[0]) -cne (Get-CanonicalJson (Get-Value $Value 'daily_progress'))) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'result single day alias mismatch' }
    } elseif ($hasAlias) {
        Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'result multi day alias forbidden'
    }
}

function Assert-Candidate($Value, [string]$Target) {
    switch ($Target) {
        'NutritionProfile' { Assert-Profile $Value; return }
        'NutritionSnapshot' { Assert-Snapshot $Value; return }
        'GoalVersion' { Assert-Goal $Value; return }
        'DailyProgressResult' { Assert-ProgressResult $Value; return }
        default { Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' "unknown target $Target" }
    }
}

function Assert-SchemaIdentity($Schema, [string]$RawText, [string]$Hash) {
    if ([string](Get-Value $Schema '$schema') -ne 'https://json-schema.org/draft/2020-12/schema' -or [string](Get-Value $Schema '$id') -ne $ExpectedSchemaId -or [string](Get-Value $Schema 'x-schema-version') -ne $ExpectedVersion) {
        Fail 'NUTRITION_PROGRESS_SCHEMA_IDENTITY_INVALID' 'schema identity'
    }
    if ($Hash -ne $ExpectedSchemaSha256) { Fail 'NUTRITION_PROGRESS_SCHEMA_HASH_INVALID' "schema $Hash" }
    $defs = Get-Value $Schema '$defs'
    $expectedDefs = @('CoverageStatus', 'NutrientValues', 'MetricValues', 'MetricCoverage', 'NutritionFieldEvidence', 'NutritionProfile', 'NutritionSnapshot', 'GoalVersion', 'DailyProgress', 'DailyProgressResult')
    try { Assert-ExactProperties $defs $expectedDefs 'schema defs' } catch { Fail 'NUTRITION_PROGRESS_SCHEMA_SHAPE_INVALID' $_.Exception.Message }
    $coverageEnum = Get-RawValue (Get-Value $defs 'CoverageStatus') 'enum'
    if ($coverageEnum -isnot [Collections.IList] -or @($coverageEnum).Count -ne 4) { Fail 'NUTRITION_PROGRESS_SCHEMA_SHAPE_INVALID' 'coverage enum count' }
    for ($index = 0; $index -lt 4; $index++) { if ([string]$coverageEnum[$index] -ne $CoverageValues[$index]) { Fail 'NUTRITION_PROGRESS_SCHEMA_SHAPE_INVALID' 'coverage enum order' } }
    $absoluteRef = 'https://diet-manager.local/schemas/event-and-amount/v1#/$defs/DecimalString'
    if (-not $RawText.Contains($absoluteRef) -or $RawText.Contains('../event-and-amount')) { Fail 'NUTRITION_PROGRESS_SCHEMA_SHAPE_INVALID' 'decimal reference' }
}

function Assert-FixtureCoverage($Fixture) {
    if ([string](Get-Value $Fixture 'fixture_set_id') -ne $ExpectedFixtureSetId -or [string](Get-Value $Fixture 'schema_version') -ne $ExpectedVersion) {
        Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' 'fixture identity'
    }
    $cases = Get-RawValue $Fixture 'cases'
    if ($cases -isnot [Collections.IList] -or @($cases).Count -ne $ExpectedCaseIds.Count) { Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' 'case count' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    for ($index = 0; $index -lt $ExpectedCaseIds.Count; $index++) {
        $caseId = [string](Get-Value $cases[$index] 'case_id')
        if ($caseId -ne $ExpectedCaseIds[$index] -or -not $seen.Add($caseId)) { Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' "case id $index $caseId" }
    }
}

function Expect-Rejection([scriptblock]$Action, [string]$Label) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (-not $rejected) { Fail 'NUTRITION_PROGRESS_MUTATION_NOT_REJECTED' $Label }
}

if (-not [IO.File]::Exists($SchemaPath)) {
    Fail 'NUTRITION_PROGRESS_SCHEMA_FILE_MISSING' $SchemaPath
}
if (-not [IO.File]::Exists($FixturePath)) {
    Fail 'NUTRITION_PROGRESS_FIXTURE_FILE_MISSING' $FixturePath
}

$utf8 = New-Object Text.UTF8Encoding($false, $true)
$schemaRaw = [IO.File]::ReadAllText($SchemaPath, $utf8)
$fixtureRaw = [IO.File]::ReadAllText($FixturePath, $utf8)
$schema = Read-JsonStrict $SchemaPath
$fixture = Read-JsonStrict $FixturePath
$schemaHash = (Get-FileHash -LiteralPath $SchemaPath -Algorithm SHA256).Hash
$fixtureHash = (Get-FileHash -LiteralPath $FixturePath -Algorithm SHA256).Hash

Assert-SchemaIdentity $schema $schemaRaw $schemaHash
if ($fixtureHash -ne $ExpectedFixtureSha256) { Fail 'NUTRITION_PROGRESS_SCHEMA_HASH_INVALID' "fixture $fixtureHash" }
Assert-FixtureCoverage $fixture

$templates = Get-Value $fixture 'templates'
foreach ($case in @(Get-Value $fixture 'cases')) {
    $caseId = [string](Get-Value $case 'case_id')
    $templateId = [string](Get-Value $case 'template_id')
    if (-not (Has-Property $templates $templateId)) { Fail 'NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID' "$caseId template $templateId" }
    $candidate = Resolve-TemplateNode (Get-Value $templates $templateId) $templates
    foreach ($mutation in @(Get-Value $case 'mutations')) { Apply-FixtureMutation $candidate $mutation $templates }
    $errorText = $null
    try { Assert-Candidate $candidate ([string](Get-Value $case 'target')) } catch { $errorText = $_.Exception.Message }
    $expectedValid = [bool](Get-Value $case 'expected_valid')
    if ($expectedValid -and $null -ne $errorText) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$caseId expected valid error=$errorText" }
    if (-not $expectedValid -and $null -eq $errorText) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$caseId expected invalid" }
    if (-not $expectedValid) {
        $fragment = [string](Get-Value $case 'expected_error_contains')
        if ([string]::IsNullOrWhiteSpace($fragment) -or -not $errorText.Contains($fragment)) { Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' "$caseId wrong error=$errorText" }
    }
}

$profileV2 = Resolve-TemplateNode (Get-Value $templates 'profile_v2') $templates
$snapshotV1 = Resolve-TemplateNode (Get-Value $templates 'snapshot_complete_v1') $templates
if ([string](Get-Value $profileV2 'supersedes_profile_id') -ne 'profile-milk-v1' -or [string](Get-Value $snapshotV1 'nutrition_profile_id') -ne 'profile-milk-v1' -or [string](Get-Value $snapshotV1 'profile_version') -ne 'v1') {
    Fail 'NUTRITION_PROGRESS_CASE_RESULT_INVALID' 'profile history snapshot changed'
}

$schemaMutation = Resolve-TemplateNode $schema ([pscustomobject]@{})
$schemaMutation.PSObject.Properties['$id'].Value = 'https://diet-manager.local/schemas/nutrition-progress/changed'
Expect-Rejection { Assert-SchemaIdentity $schemaMutation $schemaRaw $schemaHash } 'schema identity'

$numberMutation = Resolve-TemplateNode (Get-Value $templates 'profile_complete') $templates
$numberMutation.PSObject.Properties['basis_amount'].Value = 100
Expect-Rejection { Assert-Profile $numberMutation } 'json number'

$coverageMutation = Resolve-TemplateNode (Get-Value $templates 'profile_partial') $templates
$coverageMutation.PSObject.Properties['coverage_status'].Value = 'estimated'
Expect-Rejection { Assert-Profile $coverageMutation } 'coverage enum'

$shortCases = @((Get-Value $fixture 'cases') | Select-Object -First 41)
$coverageFixture = [pscustomobject][ordered]@{ fixture_set_id = $ExpectedFixtureSetId; schema_version = $ExpectedVersion; cases = $shortCases }
Expect-Rejection { Assert-FixtureCoverage $coverageFixture } 'fixture coverage'

Write-Output ('NUTRITION_PROGRESS_SCHEMAS|PASS|version={0}|cases={1}|definitions=10|mutations=4' -f $ExpectedVersion, $ExpectedCaseIds.Count)
