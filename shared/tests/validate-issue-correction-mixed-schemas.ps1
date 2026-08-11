[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$SchemaPath = Join-Path $ProjectRoot 'shared\schemas\issue-correction-mixed.schema.json'
$FixturePath = Join-Path $ProjectRoot 'shared\tests\fixtures\issue-correction-mixed-cases.json'
$ExpectedSchemaId = 'https://diet-manager.local/schemas/issue-correction-mixed/v1'
$ExpectedFixtureSetId = 'diet-manager/issue-correction-mixed-cases/v1'
$ExpectedVersion = '1.0.0'
$ExpectedSchemaSha256 = 'AD4F13E1A937CB3A0C9334F906F06DC3C87D6B551BB216676231EC0F572251D8'
$ExpectedFixtureSha256 = '87D264AD2928584592B2C1CD4A702777B2D6D720F5A7CA34832B17D094BB84F3'
$ExpectedDefinitionNames = @(
    'Issue',
    'IssueResolutionEvent',
    'QuickPrompt',
    'CorrectionSnapshot',
    'CorrectionEvent',
    'EffectOutboxEntry',
    'FactCommitResult',
    'EffectBundleResult',
    'ReceiptData',
    'EnvelopeFinalizeResult',
    'MixedItemResult',
    'MixedCommitResult'
)
$ExpectedCaseIds = @(
    'ICM-ISSUE-OPEN-VALID',
    'ICM-ISSUE-AWAITING-USER-VALID',
    'ICM-ISSUE-RESOLVED-VALID',
    'ICM-ISSUE-DISMISSED-VALID',
    'ICM-ISSUE-LEGACY-STATUS-INVALID',
    'ICM-ISSUE-OPEN-CLOSURE-FIELDS-INVALID',
    'ICM-ISSUE-RESOLVED-MISSING-EVENT-INVALID',
    'ICM-ISSUE-CODE-INVALID',
    'ICM-RESOLUTION-APPLIED-VALID',
    'ICM-RESOLUTION-NO-CHANGE-VALID',
    'ICM-RESOLUTION-REJECTED-VALID',
    'ICM-RESOLUTION-REJECTED-MISSING-REASON-INVALID',
    'ICM-RESOLUTION-TECHNICAL-FAILED-PERSISTED-INVALID',
    'ICM-QUICK-PROMPT-VALID',
    'ICM-QUICK-PROMPT-TOO-FEW-OPTIONS-INVALID',
    'ICM-QUICK-PROMPT-EXPIRED-APPLICATION-VALID',
    'ICM-CORRECTION-CHANGE-AMOUNT-VALID',
    'ICM-CORRECTION-VOID-VALID',
    'ICM-CORRECTION-RESTORE-VALID',
    'ICM-CORRECTION-CROSS-DAY-VALID',
    'ICM-CORRECTION-LEGACY-OPERATION-INVALID',
    'ICM-CORRECTION-MISSING-SNAPSHOT-INVALID',
    'ICM-CORRECTION-DATE-ORDER-INVALID',
    'ICM-CORRECTION-DUPLICATE-DATE-INVALID',
    'ICM-CORRECTION-NO-CHANGE-EVENT-INVALID',
    'ICM-CORRECTION-STALE-WRITE-INVALID',
    'ICM-OUTBOX-PENDING-VALID',
    'ICM-OUTBOX-RETRYABLE-FAILED-VALID',
    'ICM-OUTBOX-PERMANENT-SKIP-VALID',
    'ICM-OUTBOX-TERMINAL-REOPEN-INVALID',
    'ICM-OUTBOX-RETRYABLE-MISSING-REASON-INVALID',
    'ICM-OUTBOX-NEGATIVE-ATTEMPT-INVALID',
    'ICM-FACT-COMMIT-SUCCESS-VALID',
    'ICM-FACT-COMMIT-FAILED-VALID',
    'ICM-FACT-COMMIT-FAILED-BUSINESS-ID-INVALID',
    'ICM-FACT-COMMIT-FAILED-OUTBOX-INVALID',
    'ICM-FACT-COMMIT-SUCCESS-NO-OUTBOX-INVALID',
    'ICM-EFFECT-SUCCEEDED-VALID',
    'ICM-EFFECT-PENDING-VALID',
    'ICM-EFFECT-PERMANENT-SKIP-VALID',
    'ICM-EFFECT-PENDING-RECEIPT-INVALID',
    'ICM-EFFECT-INVENTORY-INSUFFICIENT-VALID',
    'ICM-FINALIZE-COMMITTED-VALID',
    'ICM-FINALIZE-COMMITTED-WITH-ISSUES-VALID',
    'ICM-FINALIZE-EFFECTS-PENDING-VALID',
    'ICM-FINALIZE-PENDING-RECEIPT-INVALID',
    'ICM-FINALIZE-CROSS-DAY-VALID',
    'ICM-FINALIZE-CROSS-DAY-ALIAS-INVALID',
    'ICM-FINALIZE-SINGLE-ALIAS-MISSING-INVALID',
    'ICM-MIXED-ORDERED-VALID',
    'ICM-MIXED-LATER-FAILURE-VALID',
    'ICM-MIXED-SEQUENCE-DUPLICATE-INVALID',
    'ICM-MIXED-SEQUENCE-GAP-INVALID',
    'ICM-MIXED-FAILED-BUSINESS-REF-INVALID',
    'ICM-IDEMPOTENCY-TERMINAL-RETRY-VALID',
    'ICM-IDEMPOTENCY-PENDING-RESUME-VALID',
    'ICM-IDEMPOTENCY-CONFLICT-ZERO-WRITE-VALID',
    'ICM-IDEMPOTENCY-CONFLICT-BUSINESS-WRITE-INVALID'
)

function Fail([string]$Code, [string]$Detail) {
    throw "$Code`:$Detail"
}

function Has-Property($Object, [string]$Name) {
    return $null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]
}

function Get-Value($Object, [string]$Name) {
    if (-not (Has-Property $Object $Name)) { return $null }
    Write-Output -NoEnumerate $Object.PSObject.Properties[$Name].Value
}

function Get-RawValue($Object, [string]$Name) {
    if (-not (Has-Property $Object $Name)) { return $null }
    Write-Output -NoEnumerate $Object.PSObject.Properties[$Name].Value
}

function Read-JsonStrict([string]$Path) {
    try {
        $bytes = [IO.File]::ReadAllBytes($Path)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            Fail 'ISSUE_CORRECTION_MIXED_JSON_INVALID' "$Path has UTF-8 BOM"
        }
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        return ($utf8.GetString($bytes) | ConvertFrom-Json)
    } catch {
        if ($_.Exception.Message.StartsWith('ISSUE_CORRECTION_MIXED_JSON_INVALID:')) { throw }
        Fail 'ISSUE_CORRECTION_MIXED_JSON_INVALID' "$Path $($_.Exception.Message)"
    }
}

function Assert-ExactProperties($Object, [string[]]$Names, [string]$Label) {
    if ($null -eq $Object -or $Object -is [string] -or $Object -is [ValueType] -or $Object -is [Collections.IList]) {
        Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label object"
    }
    $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($name in $Names) {
        [void]$allowed.Add($name)
        if (-not (Has-Property $Object $name)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label missing $name" }
    }
    foreach ($property in @($Object.PSObject.Properties)) {
        if (-not $allowed.Contains([string]$property.Name)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label unexpected $($property.Name)" }
    }
}

function Assert-NonEmptyString($Value, [string]$Label, [bool]$AllowNull = $false) {
    if ($null -eq $Value -and $AllowNull) { return }
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$Value)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label empty" }
}

function Assert-Timestamp($Value, [string]$Label, [bool]$AllowNull = $false) {
    if ($null -eq $Value -and $AllowNull) { return }
    Assert-NonEmptyString $Value $Label
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)) {
        Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label timestamp"
    }
}

function Assert-Digest($Value, [string]$Label) {
    if ($Value -isnot [string] -or -not [regex]::IsMatch([string]$Value, '^[A-F0-9]{64}$', [Text.RegularExpressions.RegexOptions]::CultureInvariant)) {
        Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label digest"
    }
}

function Assert-Enum($Value, [string[]]$Allowed, [string]$Label) {
    if ($Value -isnot [string] -or [string]$Value -notin $Allowed) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label value" }
}

function Assert-Array($Value, [string]$Label, [int]$Minimum = 0) {
    if ($null -eq $Value -or $Value -isnot [Collections.IList] -or @($Value).Count -lt $Minimum) {
        Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label array"
    }
}

function Assert-UniqueStrings($Value, [string]$Label, [int]$Minimum = 0) {
    Assert-Array $Value $Label $Minimum
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($item in @($Value)) {
        Assert-NonEmptyString $item "$Label item"
        if (-not $seen.Add([string]$item)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label duplicate" }
    }
}

function Assert-SortedDates($Value, [string]$Label) {
    Assert-UniqueStrings $Value $Label 1
    $previous = $null
    foreach ($date in @($Value)) {
        $parsed = [DateTime]::MinValue
        if (-not [DateTime]::TryParseExact([string]$date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)) {
            Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label date"
        }
        if ($null -ne $previous -and [string]::CompareOrdinal([string]$previous, [string]$date) -ge 0) {
            Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label order"
        }
        $previous = [string]$date
    }
}

function Assert-CanonicalDecimal($Value, [string]$Label) {
    if ($Value -isnot [string] -or -not [regex]::IsMatch([string]$Value, '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$', [Text.RegularExpressions.RegexOptions]::CultureInvariant) -or [string]$Value -match '^-0(?:\.0+)?$') {
        Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label decimal"
    }
}

function Resolve-TemplateNode($Value, $Templates, [Collections.Generic.HashSet[string]]$Stack) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [string] -or $Value -is [ValueType]) { return $Value }
    if ($Value -is [Collections.IList]) {
        $items = New-Object Collections.ArrayList
        foreach ($item in @($Value)) { [void]$items.Add((Resolve-TemplateNode $item $Templates $Stack)) }
        return ,([object[]]$items.ToArray())
    }
    if (Has-Property $Value '$template') {
        $templateId = [string](Get-Value $Value '$template')
        if (-not (Has-Property $Templates $templateId)) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "unknown template $templateId" }
        if (-not $Stack.Add($templateId)) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "template cycle $templateId" }
        $resolved = Resolve-TemplateNode (Get-Value $Templates $templateId) $Templates $Stack
        [void]$Stack.Remove($templateId)
        if (Has-Property $Value '$remove') {
            foreach ($name in (Get-Value $Value '$remove')) {
                Assert-NonEmptyString $name 'template remove'
                if (-not (Has-Property $resolved ([string]$name))) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "template remove missing $name" }
                $resolved.PSObject.Properties.Remove([string]$name)
            }
        }
        if (Has-Property $Value '$set') {
            foreach ($property in @((Get-Value $Value '$set').PSObject.Properties)) {
                $nextValue = Resolve-TemplateNode $property.Value $Templates $Stack
                if (Has-Property $resolved $property.Name) { $resolved.PSObject.Properties[$property.Name].Value = $nextValue }
                else { $resolved | Add-Member -MemberType NoteProperty -Name $property.Name -Value $nextValue }
            }
        }
        return $resolved
    }
    $copy = [ordered]@{}
    foreach ($property in @($Value.PSObject.Properties)) { $copy[$property.Name] = Resolve-TemplateNode $property.Value $Templates $Stack }
    return [pscustomobject]$copy
}

function Resolve-Template([string]$TemplateId, $Templates) {
    if (-not (Has-Property $Templates $TemplateId)) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "unknown template $TemplateId" }
    $stack = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    [void]$stack.Add($TemplateId)
    return Resolve-TemplateNode (Get-Value $Templates $TemplateId) $Templates $stack
}

function Apply-FixtureMutation($Root, $Mutation, $Templates) {
    $operation = [string](Get-Value $Mutation 'op')
    $path = [string](Get-Value $Mutation 'path')
    if ($operation -eq 'remove') { Assert-ExactProperties $Mutation @('op', 'path') 'mutation' }
    else { Assert-ExactProperties $Mutation @('op', 'path', 'value') 'mutation' }
    if ($operation -notin @('set', 'remove') -or -not $path.StartsWith('/')) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "mutation $operation $path" }
    $segments = @($path.TrimStart('/').Split('/') | ForEach-Object { $_.Replace('~1', '/').Replace('~0', '~') })
    $current = $Root
    for ($index = 0; $index -lt ($segments.Count - 1); $index++) {
        $segment = $segments[$index]
        if ($current -is [Collections.IList]) { $current = $current[[int]$segment] }
        else {
            if (-not (Has-Property $current $segment)) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "mutation parent $path" }
            $current = Get-RawValue $current $segment
        }
        if ($null -eq $current) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "null mutation parent $path" }
    }
    $leaf = $segments[-1]
    if ($current -is [Collections.IList]) {
        if ($operation -eq 'remove') { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' 'array removal unsupported' }
        $current[[int]$leaf] = Resolve-TemplateNode (Get-Value $Mutation 'value') $Templates ([Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal))
        return
    }
    if ($operation -eq 'remove') {
        if (-not (Has-Property $current $leaf)) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "mutation leaf $path" }
        $current.PSObject.Properties.Remove($leaf)
        return
    }
    $nextValue = Resolve-TemplateNode (Get-Value $Mutation 'value') $Templates ([Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal))
    if (Has-Property $current $leaf) { $current.PSObject.Properties[$leaf].Value = $nextValue }
    else { $current | Add-Member -MemberType NoteProperty -Name $leaf -Value $nextValue }
}

$IssueCodes = @('reference_ambiguous','consumption_state_ambiguous','negation_scope_conflict','food_identity_unrecognized','quantity_missing','quantity_estimated','quantity_vague_unresolved','composition_unknown','nutrition_missing','nutrition_estimated','missing_package_content','inventory_no_match','inventory_multiple_candidates','inventory_insufficient','inventory_unit_unconvertible','inventory_batch_uncertain','occurred_time_defaulted','meal_slot_inferred','storage_location_uncertain','shelf_life_unknown','possible_duplicate','effect_processing_failed','progress_projection_pending')
$CorrectionOperations = @('change_amount','change_unit','change_time','change_meal_slot','change_item_name','change_food_type','change_components','add_item','remove_item','change_inventory_link','change_nutrition_source','void_event','restore_event')
$ResultStatuses = @('committed','committed_with_issues','needs_clarification','ignored','failed')

function Assert-Issue($Value) {
    $names = @('issue_id','issue_code','issue_type','priority','entity_type','entity_id','field_path','detected_at','source_message_id','source_text','known_facts','missing_or_conflicting_facts','impact','candidate_values','candidate_actions','status','revision','last_presented_at','resolved_at','resolution_source','resolution_reason','resolution_event_id')
    Assert-ExactProperties $Value $names 'Issue'
    Assert-NonEmptyString (Get-Value $Value 'issue_id') 'Issue issue_id'
    Assert-Enum (Get-Value $Value 'issue_code') $IssueCodes 'Issue issue_code'
    Assert-Enum (Get-Value $Value 'issue_type') @('blocking_fact','non_blocking_business','non_blocking_technical','optional') 'Issue issue_type'
    Assert-Enum (Get-Value $Value 'priority') @('critical','high','normal','low') 'Issue priority'
    Assert-Timestamp (Get-Value $Value 'detected_at') 'Issue detected_at'
    Assert-Array (Get-Value $Value 'known_facts') 'Issue known_facts'
    Assert-UniqueStrings (Get-Value $Value 'missing_or_conflicting_facts') 'Issue missing_or_conflicting_facts'
    Assert-Array (Get-Value $Value 'candidate_values') 'Issue candidate_values'
    $actions = Get-Value $Value 'candidate_actions'; Assert-Array $actions 'Issue candidate_actions' 1
    $safeExit = $false
    foreach ($action in @($actions)) {
        Assert-ExactProperties $action @('action_id','label','operation','safe_exit') 'Issue candidate action'
        if ((Get-Value $action 'safe_exit') -isnot [bool]) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'Issue safe_exit boolean' }
        if ([bool](Get-Value $action 'safe_exit')) { $safeExit = $true }
    }
    if (-not $safeExit) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'Issue candidate_actions safe exit' }
    $status = [string](Get-Value $Value 'status'); Assert-Enum $status @('open','awaiting_user','resolved','dismissed') 'Issue status'
    if ((Get-Value $Value 'revision') -isnot [int] -or [int](Get-Value $Value 'revision') -lt 1) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'Issue revision' }
    if ($status -in @('open','awaiting_user')) {
        foreach ($field in @('resolved_at','resolution_source','resolution_event_id')) { if ($null -ne (Get-Value $Value $field)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "Issue closure $field" } }
        $reason = Get-Value $Value 'resolution_reason'
        if ($null -ne $reason -and -not ($status -eq 'open' -and $reason -eq 'deferred_by_user')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'Issue closure resolution_reason' }
    } else {
        Assert-Timestamp (Get-Value $Value 'resolved_at') 'Issue resolved_at'
        Assert-NonEmptyString (Get-Value $Value 'resolution_source') 'Issue resolution_source'
        Assert-NonEmptyString (Get-Value $Value 'resolution_event_id') 'Issue resolution_event_id'
        if ($status -eq 'dismissed') {
            if ((Get-Value $Value 'resolution_reason') -ne 'dismissed_by_user' -or (Get-Value $Value 'resolution_source') -ne 'user') { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'Issue dismissed closure' }
        } elseif ((Get-Value $Value 'resolution_reason') -notin @('user_supplied','user_confirmed','reliable_evidence_resolved','kept_estimate','event_superseded','effect_retry_succeeded')) {
            Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'Issue resolved reason'
        }
    }
}

function Assert-IssueResolutionEvent($Value) {
    Assert-ExactProperties $Value @('event_id','issue_id','request_id','expected_revision','application_outcome','resolution_reason','rejection_reason','resolution_source','created_at') 'IssueResolutionEvent'
    foreach ($field in @('event_id','issue_id','request_id')) { Assert-NonEmptyString (Get-Value $Value $field) "IssueResolutionEvent $field" }
    if ((Get-Value $Value 'expected_revision') -isnot [int] -or [int](Get-Value $Value 'expected_revision') -lt 1) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'IssueResolutionEvent expected_revision' }
    $outcome = [string](Get-Value $Value 'application_outcome'); Assert-Enum $outcome @('applied','no_change','rejected') 'IssueResolutionEvent application_outcome'
    if ($outcome -eq 'rejected') {
        Assert-Enum (Get-Value $Value 'rejection_reason') @('stale_revision','expired_prompt','conflicting_selection','prompt_target_revision_stale','business_validation_failed') 'IssueResolutionEvent rejection_reason'
        if ($null -ne (Get-Value $Value 'resolution_reason') -or $null -ne (Get-Value $Value 'resolution_source')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'IssueResolutionEvent rejected resolution fields' }
    } else {
        if ($null -ne (Get-Value $Value 'rejection_reason')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'IssueResolutionEvent rejection_reason' }
        Assert-NonEmptyString (Get-Value $Value 'resolution_reason') 'IssueResolutionEvent resolution_reason'
        Assert-NonEmptyString (Get-Value $Value 'resolution_source') 'IssueResolutionEvent resolution_source'
    }
    Assert-Timestamp (Get-Value $Value 'created_at') 'IssueResolutionEvent created_at'
}

function Assert-QuickPrompt($Value) {
    Assert-ExactProperties $Value @('prompt_id','issue_id','option_ids','safe_exit_option_id','generated_from_revision','generated_at','expires_at') 'QuickPrompt'
    $options = Get-Value $Value 'option_ids'; Assert-UniqueStrings $options 'QuickPrompt option_ids' 2
    if (@($options).Count -gt 4) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'QuickPrompt option_ids max' }
    $safe = [string](Get-Value $Value 'safe_exit_option_id')
    if ($safe -notin @($options)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'QuickPrompt safe exit' }
    Assert-Timestamp (Get-Value $Value 'generated_at') 'QuickPrompt generated_at'; Assert-Timestamp (Get-Value $Value 'expires_at') 'QuickPrompt expires_at'
    if ([DateTimeOffset]::Parse([string](Get-Value $Value 'expires_at')) -le [DateTimeOffset]::Parse([string](Get-Value $Value 'generated_at'))) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'QuickPrompt expiry' }
}

function Assert-CorrectionSnapshot($Value, [string]$Label) {
    Assert-ExactProperties $Value @('event_id','lifecycle','revision','occurred_time_ref','item_refs','content_digest') $Label
    Assert-Enum (Get-Value $Value 'lifecycle') @('active','superseded','voided') "$Label lifecycle"
    if ((Get-Value $Value 'revision') -isnot [int] -or [int](Get-Value $Value 'revision') -lt 1) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "$Label revision" }
    Assert-Timestamp (Get-Value $Value 'occurred_time_ref') "$Label occurred_time_ref"; Assert-UniqueStrings (Get-Value $Value 'item_refs') "$Label item_refs"; Assert-Digest (Get-Value $Value 'content_digest') "$Label content_digest"
}

function Assert-CorrectionEvent($Value) {
    Assert-ExactProperties $Value @('correction_id','target_event_id','base_revision','request_id','source_text','operation','before_snapshot','change_set','after_snapshot','nutrition_delta','inventory_effects','affected_dates','created_at','timezone') 'CorrectionEvent'
    Assert-Enum (Get-Value $Value 'operation') $CorrectionOperations 'CorrectionEvent operation'
    $before = Get-Value $Value 'before_snapshot'; $after = Get-Value $Value 'after_snapshot'
    Assert-CorrectionSnapshot $before 'CorrectionEvent before_snapshot'; Assert-CorrectionSnapshot $after 'CorrectionEvent after_snapshot'
    if ((Get-Value $Value 'target_event_id') -ne (Get-Value $before 'event_id') -or (Get-Value $Value 'target_event_id') -ne (Get-Value $after 'event_id')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'CorrectionEvent target_event_id' }
    if ([int](Get-Value $Value 'base_revision') -ne [int](Get-Value $before 'revision')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'CorrectionEvent base_revision' }
    if ([int](Get-Value $after 'revision') -ne ([int](Get-Value $before 'revision') + 1)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'CorrectionEvent revision increment' }
    if ((Get-Value $before 'content_digest') -eq (Get-Value $after 'content_digest')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'CorrectionEvent snapshot change' }
    Assert-Array (Get-Value $Value 'change_set') 'CorrectionEvent change_set' 1
    $delta = Get-Value $Value 'nutrition_delta'; Assert-ExactProperties $delta @('energy_kcal','protein_g','fat_g','carbohydrate_g','fiber_g') 'CorrectionEvent nutrition_delta'
    foreach ($field in @('energy_kcal','protein_g','fat_g','carbohydrate_g','fiber_g')) { Assert-CanonicalDecimal (Get-Value $delta $field) "CorrectionEvent nutrition_delta $field" }
    Assert-SortedDates (Get-Value $Value 'affected_dates') 'CorrectionEvent affected_dates'
    $operation = [string](Get-Value $Value 'operation')
    if ($operation -eq 'void_event' -and (Get-Value $after 'lifecycle') -ne 'voided') { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'CorrectionEvent void lifecycle' }
    if ($operation -eq 'restore_event' -and ((Get-Value $before 'lifecycle') -ne 'voided' -or (Get-Value $after 'lifecycle') -ne 'active')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'CorrectionEvent restore lifecycle' }
}

function Assert-EffectOutboxEntry($Value) {
    Assert-ExactProperties $Value @('outbox_id','envelope_id','operation_id','effect_id','effect_kind','previous_state','state','attempt_count','reason','created_at','updated_at') 'EffectOutboxEntry'
    Assert-Enum (Get-Value $Value 'effect_kind') @('nutrition','inventory','issue','projection') 'EffectOutboxEntry effect_kind'
    $previous = Get-Value $Value 'previous_state'; $state = [string](Get-Value $Value 'state'); $attempt = Get-Value $Value 'attempt_count'
    if ($attempt -isnot [int] -or [int]$attempt -lt 0) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectOutboxEntry attempt_count' }
    $transition = if ($null -eq $previous) { "null->$state" } else { "$previous->$state" }
    $allowed = @('null->pending','pending->processing','processing->succeeded','processing->retryable_failed','processing->permanent_business_skip','retryable_failed->processing')
    if ($transition -notin $allowed) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectOutboxEntry transition' }
    if ($transition -eq 'null->pending' -and [int]$attempt -ne 0) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectOutboxEntry attempt_count' }
    if ($state -in @('retryable_failed','permanent_business_skip')) { Assert-NonEmptyString (Get-Value $Value 'reason') 'EffectOutboxEntry reason' }
    elseif ($null -ne (Get-Value $Value 'reason')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectOutboxEntry reason' }
}

function Assert-FactCommitResult($Value) {
    $names = @('stage','envelope_id','operation_id','idempotency_key','input_digest','envelope_state','result_status','business_writes','committed_event_ids','correction_event_ids','outbox_ids','issue_ids','nutrition_snapshot_ids','inventory_transaction_ids','progress_result','receipt_data','terminal_idempotency_result','committed_at','error_code')
    Assert-ExactProperties $Value $names 'FactCommitResult'
    if ((Get-Value $Value 'stage') -ne 'FactCommit') { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'FactCommitResult stage' }
    Assert-Digest (Get-Value $Value 'input_digest') 'FactCommitResult input_digest'
    $state = [string](Get-Value $Value 'envelope_state'); $writes = Get-Value $Value 'business_writes'
    foreach ($field in @('committed_event_ids','correction_event_ids','outbox_ids','issue_ids','nutrition_snapshot_ids','inventory_transaction_ids')) { Assert-UniqueStrings (Get-Value $Value $field) "FactCommitResult $field" }
    foreach ($field in @('progress_result','receipt_data','terminal_idempotency_result')) { if ($null -ne (Get-Value $Value $field)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "FactCommitResult $field" } }
    if ($state -eq 'failed_fact') {
        if ((Get-Value $Value 'result_status') -ne 'failed' -or $writes -isnot [int] -or [int]$writes -ne 0 -or $null -ne (Get-Value $Value 'committed_at') -or [string]::IsNullOrWhiteSpace([string](Get-Value $Value 'error_code'))) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'FactCommitResult zero business data' }
        foreach ($field in @('committed_event_ids','correction_event_ids','outbox_ids','issue_ids','nutrition_snapshot_ids','inventory_transaction_ids')) { if ((Get-Value $Value $field).Count -ne 0) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'FactCommitResult zero business data' } }
    } elseif ($state -eq 'fact_committed') {
        if ((Get-Value $Value 'result_status') -notin @('committed','committed_with_issues') -or $writes -isnot [int] -or [int]$writes -lt 1) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'FactCommitResult success writes' }
        if ((Get-Value $Value 'outbox_ids').Count -lt 1) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'FactCommitResult outbox_ids' }
        if (((Get-Value $Value 'committed_event_ids').Count + (Get-Value $Value 'correction_event_ids').Count) -lt 1) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'FactCommitResult fact refs' }
        if ($null -ne (Get-Value $Value 'error_code')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'FactCommitResult error_code' }
    } else { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'FactCommitResult envelope_state' }
}

function Assert-EffectBundleResult($Value) {
    $names = @('stage','envelope_id','operation_id','effect_state','result_status','effect_writes','nutrition_snapshot_ids','inventory_transaction_ids','issue_ids','projection_refs','retry_after','reason','progress_result','receipt_data','terminal_idempotency_result','completed_at')
    Assert-ExactProperties $Value $names 'EffectBundleResult'
    if ((Get-Value $Value 'stage') -ne 'EffectBundle') { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectBundleResult stage' }
    foreach ($field in @('progress_result','receipt_data','terminal_idempotency_result')) { if ($null -ne (Get-Value $Value $field)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "EffectBundleResult $field" } }
    foreach ($field in @('nutrition_snapshot_ids','inventory_transaction_ids','issue_ids','projection_refs')) { Assert-UniqueStrings (Get-Value $Value $field) "EffectBundleResult $field" }
    $state = [string](Get-Value $Value 'effect_state'); $writes = Get-Value $Value 'effect_writes'
    if ($state -eq 'retryable_failed') {
        if ((Get-Value $Value 'result_status') -ne 'failed' -or [int]$writes -ne 0) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectBundleResult pending writes' }
        foreach ($field in @('nutrition_snapshot_ids','inventory_transaction_ids','issue_ids','projection_refs')) { if ((Get-Value $Value $field).Count -ne 0) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectBundleResult pending refs' } }
        Assert-Timestamp (Get-Value $Value 'retry_after') 'EffectBundleResult retry_after'; Assert-NonEmptyString (Get-Value $Value 'reason') 'EffectBundleResult reason'
    } elseif ($state -eq 'permanent_business_skip') {
        if ((Get-Value $Value 'result_status') -ne 'committed_with_issues' -or [int]$writes -lt 1 -or (Get-Value $Value 'issue_ids').Count -lt 1) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectBundleResult permanent skip' }
    } elseif ($state -eq 'succeeded') {
        if ((Get-Value $Value 'result_status') -notin @('committed','committed_with_issues') -or [int]$writes -lt 1) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectBundleResult succeeded' }
    } else { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EffectBundleResult effect_state' }
}

function Assert-ReceiptData($Value) {
    Assert-ExactProperties $Value @('receipt_id','envelope_id','result_status','committed_event_ids','correction_event_ids','actual_inventory_effect_ids','issue_ids','affected_dates','finalized_at') 'ReceiptData'
    Assert-Enum (Get-Value $Value 'result_status') @('committed','committed_with_issues') 'ReceiptData result_status'
    foreach ($field in @('committed_event_ids','correction_event_ids','actual_inventory_effect_ids','issue_ids')) { Assert-UniqueStrings (Get-Value $Value $field) "ReceiptData $field" }
    Assert-SortedDates (Get-Value $Value 'affected_dates') 'ReceiptData affected_dates'; Assert-Timestamp (Get-Value $Value 'finalized_at') 'ReceiptData finalized_at'
}

function Assert-MixedItemResult($Value) {
    Assert-ExactProperties $Value @('sequence','operation_id','idempotency_key','command_type','status','committed_fact_ids','correction_event_ids','issue_ids','error_code') 'MixedItemResult'
    Assert-Enum (Get-Value $Value 'status') $ResultStatuses 'MixedItemResult status'
    foreach ($field in @('committed_fact_ids','correction_event_ids','issue_ids')) { Assert-UniqueStrings (Get-Value $Value $field) "MixedItemResult $field" }
    $status = [string](Get-Value $Value 'status')
    if ($status -in @('needs_clarification','ignored','failed')) {
        if (((Get-Value $Value 'committed_fact_ids').Count + (Get-Value $Value 'correction_event_ids').Count) -ne 0) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'MixedItemResult business refs' }
        Assert-NonEmptyString (Get-Value $Value 'error_code') 'MixedItemResult error_code'
    } elseif ($null -ne (Get-Value $Value 'error_code')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'MixedItemResult error_code' }
}

function Assert-MixedCommitResult($Value) {
    Assert-ExactProperties $Value @('envelope_id','idempotency_key','input_digest','items','frozen_at') 'MixedCommitResult'
    Assert-Digest (Get-Value $Value 'input_digest') 'MixedCommitResult input_digest'
    $items = Get-Value $Value 'items'; Assert-Array $items 'MixedCommitResult items' 1
    $operations = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal); $keys = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    for ($index = 0; $index -lt @($items).Count; $index++) {
        $item = @($items)[$index]; Assert-MixedItemResult $item
        if ((Get-Value $item 'sequence') -isnot [int] -or [int](Get-Value $item 'sequence') -ne $index) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'MixedCommitResult sequence' }
        if (-not $operations.Add([string](Get-Value $item 'operation_id')) -or -not $keys.Add([string](Get-Value $item 'idempotency_key'))) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'MixedCommitResult duplicate identity' }
    }
    Assert-Timestamp (Get-Value $Value 'frozen_at') 'MixedCommitResult frozen_at'
}

function Assert-DailyProgressResult($Value) {
    if ($null -eq $Value) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EnvelopeFinalizeResult progress_result' }
    foreach ($field in @('result_id','schema_version','result_status','result_kind','daily_progress_by_date')) { if (-not (Has-Property $Value $field)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' "progress_result missing $field" } }
    if ((Get-Value $Value 'schema_version') -ne '1.0.0' -or (Get-Value $Value 'result_status') -ne 'committed') { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'progress_result identity' }
    $days = Get-Value $Value 'daily_progress_by_date'; Assert-Array $days 'progress_result daily_progress_by_date' 1
    $dates = @(); foreach ($day in @($days)) { Assert-NonEmptyString (Get-Value $day 'date') 'progress date'; $dates += [string](Get-Value $day 'date') }
    Assert-SortedDates $dates 'progress dates'
    if (@($days).Count -eq 1) {
        if (-not (Has-Property $Value 'daily_progress')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'daily_progress alias missing' }
        $left = (Get-Value $Value 'daily_progress') | ConvertTo-Json -Depth 32 -Compress
        $right = @($days)[0] | ConvertTo-Json -Depth 32 -Compress
        if ($left -cne $right) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'daily_progress alias mismatch' }
    } elseif (Has-Property $Value 'daily_progress') { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'daily_progress alias cross day' }
}

function Assert-EnvelopeFinalizeResult($Value) {
    Assert-ExactProperties $Value @('stage','envelope_id','idempotency_key','input_digest','envelope_state','result_status','mixed_result','receipt_data','progress_result','terminal_idempotency_result','error_code','finalized_at') 'EnvelopeFinalizeResult'
    if ((Get-Value $Value 'stage') -ne 'EnvelopeFinalize') { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EnvelopeFinalizeResult stage' }
    Assert-Digest (Get-Value $Value 'input_digest') 'EnvelopeFinalizeResult input_digest'
    $state = [string](Get-Value $Value 'envelope_state')
    if ($state -eq 'terminal') {
        Assert-Enum (Get-Value $Value 'result_status') @('committed','committed_with_issues') 'EnvelopeFinalizeResult result_status'
        Assert-MixedCommitResult (Get-Value $Value 'mixed_result'); Assert-ReceiptData (Get-Value $Value 'receipt_data'); Assert-DailyProgressResult (Get-Value $Value 'progress_result')
        if ($null -eq (Get-Value $Value 'terminal_idempotency_result') -or $null -ne (Get-Value $Value 'error_code')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EnvelopeFinalizeResult terminal outputs' }
        if ((Get-Value (Get-Value $Value 'receipt_data') 'result_status') -ne (Get-Value $Value 'result_status')) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EnvelopeFinalizeResult receipt status' }
    } elseif ($state -eq 'effects_pending') {
        if ((Get-Value $Value 'result_status') -ne 'failed') { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EnvelopeFinalizeResult pending status' }
        foreach ($field in @('mixed_result','receipt_data','progress_result','terminal_idempotency_result','finalized_at')) { if ($null -ne (Get-Value $Value $field)) { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EnvelopeFinalizeResult terminal outputs' } }
        Assert-NonEmptyString (Get-Value $Value 'error_code') 'EnvelopeFinalizeResult error_code'
    } else { Fail 'ISSUE_CORRECTION_MIXED_CASE_RESULT_INVALID' 'EnvelopeFinalizeResult envelope_state' }
}

function Assert-Target($Value, [string]$Target) {
    switch ($Target) {
        'Issue' { Assert-Issue $Value; break }
        'IssueResolutionEvent' { Assert-IssueResolutionEvent $Value; break }
        'QuickPrompt' { Assert-QuickPrompt $Value; break }
        'CorrectionSnapshot' { Assert-CorrectionSnapshot $Value 'CorrectionSnapshot'; break }
        'CorrectionEvent' { Assert-CorrectionEvent $Value; break }
        'EffectOutboxEntry' { Assert-EffectOutboxEntry $Value; break }
        'FactCommitResult' { Assert-FactCommitResult $Value; break }
        'EffectBundleResult' { Assert-EffectBundleResult $Value; break }
        'ReceiptData' { Assert-ReceiptData $Value; break }
        'EnvelopeFinalizeResult' { Assert-EnvelopeFinalizeResult $Value; break }
        'MixedItemResult' { Assert-MixedItemResult $Value; break }
        'MixedCommitResult' { Assert-MixedCommitResult $Value; break }
        default { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "unknown target $Target" }
    }
}

if (-not [IO.File]::Exists($SchemaPath)) { Fail 'ISSUE_CORRECTION_MIXED_SCHEMA_FILE_MISSING' $SchemaPath }
if (-not [IO.File]::Exists($FixturePath)) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_FILE_MISSING' $FixturePath }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $SchemaPath).Hash -cne $ExpectedSchemaSha256) { Fail 'ISSUE_CORRECTION_MIXED_SCHEMA_HASH_INVALID' $SchemaPath }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $FixturePath).Hash -cne $ExpectedFixtureSha256) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_HASH_INVALID' $FixturePath }

$schema = Read-JsonStrict $SchemaPath
$fixture = Read-JsonStrict $FixturePath
if ((Get-Value $schema '$id') -cne $ExpectedSchemaId -or (Get-Value $schema 'x-schema-version') -cne $ExpectedVersion) { Fail 'ISSUE_CORRECTION_MIXED_SCHEMA_IDENTITY_INVALID' 'schema identity' }
$definitions = Get-Value $schema '$defs'
$actualDefinitions = @($definitions.PSObject.Properties.Name | Sort-Object)
$expectedDefinitions = @($ExpectedDefinitionNames | Sort-Object)
if (($actualDefinitions -join '|') -cne ($expectedDefinitions -join '|')) { Fail 'ISSUE_CORRECTION_MIXED_SCHEMA_DEFINITIONS_INVALID' ($actualDefinitions -join ',') }
if ((Get-Value $schema 'oneOf').Count -ne $ExpectedDefinitionNames.Count) { Fail 'ISSUE_CORRECTION_MIXED_SCHEMA_DEFINITIONS_INVALID' 'oneOf count' }
if ((Get-Value $fixture 'fixture_set_id') -cne $ExpectedFixtureSetId -or (Get-Value $fixture 'schema_version') -cne $ExpectedVersion) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_IDENTITY_INVALID' 'fixture identity' }
Assert-ExactProperties $fixture @('fixture_set_id','schema_version','templates','cases') 'fixture root'
$templates = Get-Value $fixture 'templates'; $cases = Get-Value $fixture 'cases'
if ($cases.Count -ne $ExpectedCaseIds.Count) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' "case count $($cases.Count)" }
$actualIds = @($cases.case_id); if (@($actualIds | Sort-Object -Unique).Count -ne $actualIds.Count -or (@($actualIds | Sort-Object) -join '|') -cne (@($ExpectedCaseIds | Sort-Object) -join '|')) { Fail 'ISSUE_CORRECTION_MIXED_FIXTURE_COVERAGE_INVALID' 'case ids' }

$resolvedCases = [ordered]@{}
$passed = 0
foreach ($case in $cases) {
    Assert-ExactProperties $case @('case_id','target','template_id','mutations','expected_valid','expected_error_contains') 'fixture case'
    $caseId = [string](Get-Value $case 'case_id'); $target = [string](Get-Value $case 'target')
    $value = Resolve-Template ([string](Get-Value $case 'template_id')) $templates
    foreach ($mutation in (Get-Value $case 'mutations')) { Apply-FixtureMutation $value $mutation $templates }
    $valid = $true; $errorText = $null
    try { Assert-Target $value $target } catch { $valid = $false; $errorText = $_.Exception.Message }
    $expectedValid = Get-Value $case 'expected_valid'
    if ($expectedValid -isnot [bool] -or $valid -ne [bool]$expectedValid) { Fail 'ISSUE_CORRECTION_MIXED_CASE_EXPECTATION_FAILED' "$caseId expected=$expectedValid actual=$valid error=$errorText" }
    if (-not $valid) {
        $needle = [string](Get-Value $case 'expected_error_contains')
        if ([string]::IsNullOrWhiteSpace($needle) -or $errorText.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) { Fail 'ISSUE_CORRECTION_MIXED_CASE_EXPECTATION_FAILED' "$caseId error=$errorText expected_contains=$needle" }
    }
    $resolvedCases[$caseId] = [pscustomobject]@{ target = $target; value = $value; expected_valid = [bool]$expectedValid }
    $passed++
    Write-Output "$caseId|PASS"
}

$mutationChecks = [ordered]@{
    'MUT-FAILED-FACT-ALLOW-BUSINESS' = 'ICM-FACT-COMMIT-FAILED-BUSINESS-ID-INVALID'
    'MUT-OUTBOX-ALLOW-TERMINAL-REOPEN' = 'ICM-OUTBOX-TERMINAL-REOPEN-INVALID'
    'MUT-PENDING-ALLOW-RECEIPT' = 'ICM-FINALIZE-PENDING-RECEIPT-INVALID'
    'MUT-MIXED-ALLOW-REORDER' = 'ICM-MIXED-SEQUENCE-DUPLICATE-INVALID'
}
foreach ($mutationName in $mutationChecks.Keys) {
    $mutationCaseId = [string]$mutationChecks[$mutationName]
    $entry = $resolvedCases[$mutationCaseId]
    $rejected = $false
    try { Assert-Target $entry.value $entry.target } catch { $rejected = $true }
    if (-not $rejected) { Fail 'ISSUE_CORRECTION_MIXED_MUTATION_NOT_REJECTED' $mutationName }
    Write-Output "$mutationName|PASS|rejected_case=$mutationCaseId"
}

Write-Output "ISSUE_CORRECTION_MIXED_SCHEMAS|PASS|version=$ExpectedVersion|cases=$passed|definitions=$($ExpectedDefinitionNames.Count)|mutations=4"
