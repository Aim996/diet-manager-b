[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$EventSchemaPath = Join-Path $ProjectRoot 'shared\schemas\event-and-amount.schema.json'
$InventorySchemaPath = Join-Path $ProjectRoot 'shared\schemas\product-inventory.schema.json'
$FixturePath = Join-Path $ProjectRoot 'shared\tests\fixtures\core-model-cases.json'
$ExpectedEventSchemaSha256 = 'FD5F2B44C5AC1B8295F54774AA3425DD2DB4BA16915111A3E1B241104CEE47CA'
$ExpectedInventorySchemaSha256 = '681551FA18759AE3F993B0951C3A650FA8ABE16B28D7A9E7223E24F5E9B6613F'
$ExpectedFixtureSha256 = '3FF78E234D063E86294143BD2D91765E96E6569D53704EECEE4A83F29945AA39'

$ExpectedCaseIds = @(
    'MODEL-TIME-EXACT-VALID',
    'MODEL-TIME-RANGE-VALID',
    'MODEL-TIME-APPROXIMATE-VALID',
    'MODEL-TIME-NONEXACT-POINT-INVALID',
    'MODEL-AMOUNT-EXACT-VALID',
    'MODEL-AMOUNT-RANGE-VALID',
    'MODEL-AMOUNT-MISSING-VALID',
    'MODEL-AMOUNT-VAGUE-VALID',
    'MODEL-AMOUNT-FLOAT-INVALID',
    'MODEL-AMOUNT-DEFAULT-INVALID',
    'MODEL-MEAL-FOUR-AMOUNTS-VALID',
    'MODEL-MEAL-AMOUNTS-MISSING-INVALID',
    'MODEL-MEAL-GENERIC-STATUS-INVALID',
    'MODEL-MEAL-PLANNED-INVALID',
    'MODEL-PRODUCT-CONFIRMED-ALIAS-VALID',
    'MODEL-PRODUCT-ALIAS-NO-EVIDENCE-INVALID',
    'MODEL-PRODUCT-EXTRA-PROPERTY-INVALID',
    'MODEL-PRODUCT-PROVENANCE-EMPTY-INVALID',
    'MODEL-BATCH-IMMUTABLE-VALID',
    'MODEL-BATCH-MUTABLE-INVALID',
    'MODEL-BATCH-BAG-UNKNOWN-INNER-VALID',
    'MODEL-PROJECTION-UNKNOWN-VALID',
    'MODEL-PROJECTION-UNKNOWN-ZERO-INVALID',
    'MODEL-TX-STOCKED-VALID',
    'MODEL-TX-GIFT-IN-VALID',
    'MODEL-TX-GIFT-OUT-VALID',
    'MODEL-TX-OPENED-VALID',
    'MODEL-TX-ADJUSTMENT-OUT-VALID',
    'MODEL-TX-CORRECTION-IN-VALID',
    'MODEL-TX-SIGN-INVALID',
    'MODEL-TX-ARITHMETIC-INVALID',
    'MODEL-TX-NEGATIVE-AFTER-INVALID',
    'MODEL-TX-GIFT-REASON-INVALID',
    'MODEL-TX-LIFECYCLE-INVALID',
    'MODEL-TX-RESULT-INVALID',
    'MODEL-TX-FAILED-RESULT-INVALID',
    'MODEL-TX-PARTIAL-AUTH-VALID',
    'MODEL-TX-PARTIAL-NO-AUTH-INVALID',
    'MODEL-TX-PARTIAL-WRONG-MESSAGE-INVALID',
    'MODEL-TX-GENERIC-STATUS-INVALID',
    'MODEL-TIME-SEPARATION-VALID'
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

function Copy-FixtureValue($Value) {
    return ($Value | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json)
}

function Apply-FixtureMutation($Root, $Mutation) {
    $operation = [string](Get-Value $Mutation 'op')
    $path = [string](Get-Value $Mutation 'path')
    if ($operation -notin @('set','remove') -or -not $path.StartsWith('/')) { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' "mutation $operation $path" }
    $segments = @($path.TrimStart('/').Split('/') | ForEach-Object { $_.Replace('~1','/').Replace('~0','~') })
    if ($segments.Count -eq 0) { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' 'empty mutation path' }
    $current = $Root
    for ($index = 0; $index -lt ($segments.Count - 1); $index++) {
        $segment = $segments[$index]
        if ($current -is [System.Collections.IList]) {
            $current = $current[[int]$segment]
        } else {
            if (-not (Has-Property $current $segment)) { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' "missing mutation parent $path" }
            $current = $current.PSObject.Properties[$segment].Value
        }
    }
    $leaf = $segments[-1]
    if ($current -is [System.Collections.IList]) {
        $leafIndex = [int]$leaf
        if ($operation -eq 'remove') { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' 'array removal is not supported' }
        $current[$leafIndex] = Copy-FixtureValue (Get-Value $Mutation 'value')
        return
    }
    if ($operation -eq 'remove') {
        if (-not (Has-Property $current $leaf)) { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' "missing mutation leaf $path" }
        $current.PSObject.Properties.Remove($leaf)
        return
    }
    $rawMutationValue = $Mutation.PSObject.Properties['value'].Value
    if ($rawMutationValue -is [Array] -and $rawMutationValue.Count -eq 0) {
        if (Has-Property $current $leaf) {
            $current.PSObject.Properties[$leaf].Value = [object[]]@()
        } else {
            $current | Add-Member -MemberType NoteProperty -Name $leaf -Value ([object[]]@())
        }
        return
    }
    $mutationValue = Copy-FixtureValue $rawMutationValue
    if (Has-Property $current $leaf) {
        $current.PSObject.Properties[$leaf].Value = $mutationValue
    } else {
        $current | Add-Member -MemberType NoteProperty -Name $leaf -Value $mutationValue
    }
}

function Assert-RequiredProperties($Object, [string[]]$Names, [string]$Label) {
    foreach ($name in $Names) {
        if (-not (Has-Property $Object $name)) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label missing $name" }
    }
}

function Assert-ExactProperties($Object, [string[]]$AllowedNames, [string]$Label) {
    $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($name in $AllowedNames) { [void]$allowed.Add($name) }
    foreach ($property in @($Object.PSObject.Properties)) {
        if (-not $allowed.Contains([string]$property.Name)) {
            Fail 'MODEL_CASE_RESULT_INVALID' "$Label unexpected property $([string]$property.Name)"
        }
    }
}

function Assert-NoGenericStatus($Object, [string]$Label) {
    if (Has-Property $Object 'status') { Fail 'MODEL_CASE_RESULT_INVALID' "$Label generic status is forbidden" }
}

function Test-CanonicalDecimalString($Value, [bool]$AllowNegative) {
    if ($Value -isnot [string]) { return $false }
    $pattern = if ($AllowNegative) { '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' } else { '^(0|[1-9][0-9]*)(\.[0-9]+)?$' }
    return [regex]::IsMatch([string]$Value, $pattern, [Text.RegularExpressions.RegexOptions]::CultureInvariant)
}

function Convert-Decimal([string]$Value) {
    return [decimal]::Parse($Value, [Globalization.NumberStyles]::AllowLeadingSign -bor [Globalization.NumberStyles]::AllowDecimalPoint, [Globalization.CultureInfo]::InvariantCulture)
}

function Assert-TimestampOrNull($Value, [string]$Label, [bool]$AllowNull) {
    if ($null -eq $Value) {
        if ($AllowNull) { return }
        Fail 'MODEL_CASE_RESULT_INVALID' "$Label must be timestamp"
    }
    if ($Value -isnot [string]) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label must be timestamp string" }
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)) {
        Fail 'MODEL_CASE_RESULT_INVALID' "$Label invalid timestamp"
    }
}

function Assert-OccurredTime($Value, [string]$Label) {
    $required = @('raw_text','resolved_start','resolved_end','precision','timezone','resolution_basis','resolution_anchor','resolver_version')
    Assert-RequiredProperties $Value $required $Label
    Assert-ExactProperties $Value @($required + 'resolved_occurred_at') $Label
    $precision = [string](Get-Value $Value 'precision')
    if ($precision -notin @('exact','date','meal_period','approximate','unknown')) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label precision" }
    $start = Get-Value $Value 'resolved_start'
    $end = Get-Value $Value 'resolved_end'
    Assert-TimestampOrNull $start "$Label.resolved_start" ($precision -eq 'unknown')
    Assert-TimestampOrNull $end "$Label.resolved_end" ($precision -eq 'unknown')
    $hasPoint = Has-Property $Value 'resolved_occurred_at'
    $point = Get-Value $Value 'resolved_occurred_at'
    if ($precision -eq 'exact') {
        if (-not $hasPoint -or $null -eq $point) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label exact point missing" }
        Assert-TimestampOrNull $point "$Label.resolved_occurred_at" $false
        if ([string]$start -ne [string]$end -or [string]$start -ne [string]$point) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label exact point mismatch" }
    } elseif ($hasPoint -and $null -ne $point) {
        Fail 'MODEL_CASE_RESULT_INVALID' "$Label non-exact point forbidden"
    }
}

function Assert-Amount($Value, [string]$Label) {
    $required = @('raw_text','kind','value','min_value','max_value','unit_raw','unit_normalized','qualifier','conversion_basis','conversion_formula','conversion_source','evidence_kind')
    Assert-RequiredProperties $Value $required $Label
    Assert-ExactProperties $Value $required $Label
    $kind = [string](Get-Value $Value 'kind')
    if ($kind -notin @('exact','approximate','range','vague','missing')) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label kind" }
    $valueNumber = Get-Value $Value 'value'
    $minNumber = Get-Value $Value 'min_value'
    $maxNumber = Get-Value $Value 'max_value'
    if ($kind -in @('exact','approximate')) {
        if (-not (Test-CanonicalDecimalString $valueNumber $false) -or $null -ne $minNumber -or $null -ne $maxNumber) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label scalar shape" }
    } elseif ($kind -eq 'range') {
        if ($null -ne $valueNumber -or -not (Test-CanonicalDecimalString $minNumber $false) -or -not (Test-CanonicalDecimalString $maxNumber $false)) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label range shape" }
        if ((Convert-Decimal $minNumber) -gt (Convert-Decimal $maxNumber)) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label range order" }
    } else {
        if ($null -ne $valueNumber -or $null -ne $minNumber -or $null -ne $maxNumber) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label unknown numeric default" }
    }
}

function Assert-EventEnvelope($Value, [string]$Label) {
    $required = @('event_id','schema_version','event_type','fact_kind','source_text','source_message_id','conversation_id','received_at','committed_at','occurred_at_text','occurred_time','result_status','lifecycle_status','provenance_refs')
    Assert-RequiredProperties $Value $required $Label
    Assert-NoGenericStatus $Value $Label
    if ([string](Get-Value $Value 'fact_kind') -ne 'completed') { Fail 'MODEL_CASE_RESULT_INVALID' "$Label fact kind" }
    if ([string](Get-Value $Value 'result_status') -ne 'committed') { Fail 'MODEL_CASE_RESULT_INVALID' "$Label result status" }
    if ([string](Get-Value $Value 'lifecycle_status') -notin @('active','superseded','voided')) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label lifecycle" }
    Assert-TimestampOrNull (Get-Value $Value 'received_at') "$Label.received_at" $false
    Assert-TimestampOrNull (Get-Value $Value 'committed_at') "$Label.committed_at" $false
    Assert-OccurredTime (Get-Value $Value 'occurred_time') "$Label.occurred_time"
}

function Assert-MealEvent($Value) {
    Assert-EventEnvelope $Value 'meal'
    $mealProperties = @('event_id','schema_version','event_type','fact_kind','source_text','source_message_id','conversation_id','received_at','committed_at','occurred_at_text','occurred_time','result_status','lifecycle_status','provenance_refs','meal_id','meal_slot','meal_slot_source','context','items')
    Assert-RequiredProperties $Value @('meal_id','meal_slot','meal_slot_source','context','items') 'meal'
    Assert-ExactProperties $Value $mealProperties 'meal'
    if ([string](Get-Value $Value 'event_type') -ne 'diet_meal') { Fail 'MODEL_CASE_RESULT_INVALID' 'meal event_type' }
    $items = @((Get-Value $Value 'items'))
    if ($items.Count -lt 1) { Fail 'MODEL_CASE_RESULT_INVALID' 'meal items empty' }
    $expectedOrder = 0
    foreach ($item in $items) {
        Assert-RequiredProperties $item @('item_id','item_order','raw_name','normalized_name','item_type','stated_amount','nutrition_amount','inventory_amount','package_amount','inventory_effect_intent','nutrition_effect_intent','quality_flags') 'meal item'
        Assert-ExactProperties $item @('item_id','item_order','raw_name','normalized_name','item_type','stated_amount','nutrition_amount','inventory_amount','package_amount','inventory_effect_intent','nutrition_effect_intent','quality_flags') 'meal item'
        Assert-NoGenericStatus $item 'meal item'
        if ([int](Get-Value $item 'item_order') -ne $expectedOrder) { Fail 'MODEL_CASE_RESULT_INVALID' 'meal item order' }
        Assert-Amount (Get-Value $item 'stated_amount') 'meal item stated_amount'
        foreach ($amountName in @('nutrition_amount','inventory_amount','package_amount')) {
            $amount = Get-Value $item $amountName
            if ($null -ne $amount) { Assert-Amount $amount "meal item $amountName" }
        }
        $expectedOrder++
    }
}

function Assert-ProductIdentity($Value) {
    $productProperties = @('product_id','raw_names','normalized_name','product_type','brand','manufacturer','variant_or_flavor','product_form','confirmed_aliases','barcode','sku','known_package_specs','nutrition_profile_ids','default_storage_rule','default_shelf_life_rule','source_refs','field_provenance','schema_version')
    Assert-RequiredProperties $Value $productProperties 'product'
    Assert-ExactProperties $Value $productProperties 'product'
    Assert-NoGenericStatus $Value 'product'
    if (@((Get-Value $Value 'raw_names')).Count -lt 1) { Fail 'MODEL_CASE_RESULT_INVALID' 'product raw names' }
    foreach ($alias in @((Get-Value $Value 'confirmed_aliases'))) {
        Assert-RequiredProperties $alias @('alias','confirmation_kind','source_message_id','confirmed_at') 'confirmed alias'
        Assert-ExactProperties $alias @('alias','confirmation_kind','source_message_id','confirmed_at') 'confirmed alias'
        if ([string](Get-Value $alias 'confirmation_kind') -ne 'explicit_user') { Fail 'MODEL_CASE_RESULT_INVALID' 'alias confirmation' }
        if ([string]::IsNullOrWhiteSpace([string](Get-Value $alias 'source_message_id'))) { Fail 'MODEL_CASE_RESULT_INVALID' 'alias source evidence' }
        Assert-TimestampOrNull (Get-Value $alias 'confirmed_at') 'alias.confirmed_at' $false
    }
    $fieldProvenance = @($Value.PSObject.Properties['field_provenance'].Value)
    if ($fieldProvenance.Count -lt 1) { Fail 'MODEL_CASE_RESULT_INVALID' 'product field provenance empty' }
    foreach ($provenance in $fieldProvenance) { Assert-FieldProvenance $provenance 'product field provenance' }
}

function Assert-FieldProvenance($Value, [string]$Label) {
    Assert-RequiredProperties $Value @('source_kind','source_message_id','source_ref','parser_version','normalization_rule_version','conversion_rule_version','derived_fields') $Label
    Assert-ExactProperties $Value @('source_kind','source_message_id','source_ref','parser_version','normalization_rule_version','conversion_rule_version','derived_fields') $Label
    if ([string](Get-Value $Value 'source_kind') -notin @('explicit_user','product_label','manufacturer','confirmed_rule','deterministic_rule','model_with_evidence','unknown')) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label source kind" }
    if ([string]::IsNullOrWhiteSpace([string](Get-Value $Value 'parser_version')) -or [string]::IsNullOrWhiteSpace([string](Get-Value $Value 'normalization_rule_version'))) { Fail 'MODEL_CASE_RESULT_INVALID' "$Label versions" }
}

function Assert-InventoryBatch($Value) {
    $required = @('batch_id','product_id','stock_event_id','source_text','occurred_at_text','purchased_at','produced_at','stocked_at','received_at','committed_at','original_quantity','quantity_unit','package_spec','purchase_location','production_date','explicit_expiration_at','shelf_life_text','shelf_life_basis','data_quality','schema_version','provenance_refs','field_provenance')
    Assert-RequiredProperties $Value $required 'batch'
    Assert-NoGenericStatus $Value 'batch'
    foreach ($forbidden in @('remaining_quantity','current_storage_location','opened_at','seal_status','expiry_status','effective_status','lifecycle_status','effective_expiration_at')) {
        if (Has-Property $Value $forbidden) { Fail 'MODEL_CASE_RESULT_INVALID' "batch mutable $forbidden" }
    }
    Assert-ExactProperties $Value $required 'batch'
    Assert-Amount (Get-Value $Value 'original_quantity') 'batch.original_quantity'
    foreach ($timeName in @('purchased_at','produced_at','stocked_at','received_at','committed_at','explicit_expiration_at')) {
        Assert-TimestampOrNull (Get-Value $Value $timeName) "batch.$timeName" ($timeName -in @('purchased_at','produced_at','explicit_expiration_at'))
    }
    $fieldProvenance = @($Value.PSObject.Properties['field_provenance'].Value)
    if ($fieldProvenance.Count -lt 1) { Fail 'MODEL_CASE_RESULT_INVALID' 'batch field provenance empty' }
    foreach ($provenance in $fieldProvenance) { Assert-FieldProvenance $provenance 'batch field provenance' }
}

function Assert-InventoryBatchProjection($Value) {
    $required = @('batch_id','remaining_quantity','current_storage_location','current_storage_location_source','opened_at','opened_at_source','effective_expiration_at','quantity_status','seal_status','expiry_status','effective_status','open_issue_ids','last_event_id','last_changed_at','last_verified_at')
    Assert-RequiredProperties $Value $required 'projection'
    Assert-ExactProperties $Value $required 'projection'
    Assert-NoGenericStatus $Value 'projection'
    Assert-Amount (Get-Value $Value 'remaining_quantity') 'projection.remaining_quantity'
    Assert-TimestampOrNull (Get-Value $Value 'opened_at') 'projection.opened_at' $true
    Assert-TimestampOrNull (Get-Value $Value 'effective_expiration_at') 'projection.effective_expiration_at' $true
}

function Assert-InventoryTransaction($Value) {
    Assert-EventEnvelope $Value 'transaction'
    $required = @('transaction_id','product_id','batch_id','direction','quantity_delta','quantity_before','quantity_after','unit','conversion_basis','reason_code','authorization_kind','authorization_source_message_id','related_event_id','related_transaction_id','idempotency_key','partial_deduction','provenance_refs')
    Assert-RequiredProperties $Value $required 'transaction'
    Assert-ExactProperties $Value @('event_id','schema_version','event_type','fact_kind','source_text','source_message_id','conversation_id','received_at','committed_at','occurred_at_text','occurred_time','result_status','lifecycle_status','provenance_refs','transaction_id','product_id','batch_id','direction','quantity_delta','quantity_before','quantity_after','unit','conversion_basis','reason_code','authorization_kind','authorization_source_message_id','related_event_id','related_transaction_id','idempotency_key','partial_deduction') 'transaction'
    $eventType = [string](Get-Value $Value 'event_type')
    $direction = [string](Get-Value $Value 'direction')
    $reason = [string](Get-Value $Value 'reason_code')
    $deltaText = Get-Value $Value 'quantity_delta'
    $beforeText = Get-Value $Value 'quantity_before'
    $afterText = Get-Value $Value 'quantity_after'
    if (-not (Test-CanonicalDecimalString $deltaText $true) -or -not (Test-CanonicalDecimalString $beforeText $false) -or -not (Test-CanonicalDecimalString $afterText $false)) { Fail 'MODEL_CASE_RESULT_INVALID' 'transaction decimal strings' }
    $delta = Convert-Decimal $deltaText
    $before = Convert-Decimal $beforeText
    $after = Convert-Decimal $afterText
    if ($after -lt 0 -or ($before + $delta) -ne $after) { Fail 'MODEL_CASE_RESULT_INVALID' 'transaction arithmetic' }
    if (($direction -eq 'in' -and $delta -le 0) -or ($direction -eq 'out' -and $delta -ge 0) -or ($direction -eq 'neutral' -and $delta -ne 0)) { Fail 'MODEL_CASE_RESULT_INVALID' 'transaction direction sign' }
    $map = @{
        inventory_stocked = @('in','purchase_stocked')
        inventory_gift_received = @('in','gift_received')
        inventory_opened = @('neutral','package_opened')
        inventory_consumed = @('out','consumed')
        inventory_returned_to_stock = @('in','returned_to_stock')
        inventory_returned_to_vendor = @('out','returned_to_vendor')
        inventory_gifted_out = @('out','gifted_out')
        inventory_discarded = @('out','discarded')
        inventory_depleted = @('neutral','depleted')
    }
    if ($eventType -eq 'inventory_adjusted') {
        if ($reason -ne 'adjustment') { Fail 'MODEL_CASE_RESULT_INVALID' 'transaction event coherence' }
    } elseif ($eventType -eq 'inventory_voided') {
        if ($reason -ne 'correction_compensation') { Fail 'MODEL_CASE_RESULT_INVALID' 'transaction event coherence' }
    } else {
        if (-not $map.ContainsKey($eventType)) { Fail 'MODEL_CASE_RESULT_INVALID' 'transaction event type' }
        if ($direction -ne $map[$eventType][0] -or $reason -ne $map[$eventType][1]) { Fail 'MODEL_CASE_RESULT_INVALID' 'transaction event coherence' }
    }
    if ([bool](Get-Value $Value 'partial_deduction')) {
        if ([string](Get-Value $Value 'authorization_kind') -ne 'explicit_user' -or [string](Get-Value $Value 'authorization_source_message_id') -ne [string](Get-Value $Value 'source_message_id') -or [string]::IsNullOrWhiteSpace([string](Get-Value $Value 'related_event_id'))) {
            Fail 'MODEL_CASE_RESULT_INVALID' 'transaction partial authorization'
        }
    }
}

function Invoke-Case($Case) {
    try {
        $target = [string](Get-Value $Case 'target')
        $input = Get-Value $Case 'input'
        switch ($target) {
            'OccurredTime' { Assert-OccurredTime $input 'occurred_time' }
            'Amount' { Assert-Amount $input 'amount' }
            'MealEvent' { Assert-MealEvent $input }
            'ProductIdentity' { Assert-ProductIdentity $input }
            'InventoryBatch' { Assert-InventoryBatch $input }
            'InventoryBatchProjection' { Assert-InventoryBatchProjection $input }
            'InventoryTransaction' { Assert-InventoryTransaction $input }
            default { Fail 'MODEL_CASE_RESULT_INVALID' "unknown target $target" }
        }
        return [pscustomobject]@{ valid = $true; error = $null }
    } catch {
        return [pscustomobject]@{ valid = $false; error = [string]$_.Exception.Message }
    }
}

function Assert-SchemaIdentity($EventSchema, $InventorySchema) {
    if ([string](Get-Value $EventSchema '$schema') -ne 'https://json-schema.org/draft/2020-12/schema' -or [string](Get-Value $InventorySchema '$schema') -ne 'https://json-schema.org/draft/2020-12/schema') { Fail 'MODEL_SCHEMA_IDENTITY_INVALID' 'draft' }
    if ([string](Get-Value $EventSchema '$id') -ne 'https://diet-manager.local/schemas/event-and-amount/v1') { Fail 'MODEL_SCHEMA_IDENTITY_INVALID' 'event id' }
    if ([string](Get-Value $InventorySchema '$id') -ne 'https://diet-manager.local/schemas/product-inventory/v1') { Fail 'MODEL_SCHEMA_IDENTITY_INVALID' 'inventory id' }
    if ([string](Get-Value $EventSchema 'x-schema-version') -ne '1.0.0' -or [string](Get-Value $InventorySchema 'x-schema-version') -ne '1.0.0') { Fail 'MODEL_SCHEMA_IDENTITY_INVALID' 'version' }
}

function Assert-SchemaShape($EventSchema, $InventorySchema) {
    $eventDefs = Get-Value $EventSchema '$defs'
    $inventoryDefs = Get-Value $InventorySchema '$defs'
    foreach ($name in @('DecimalString','OccurredTime','Amount','EventEnvelope','MealItem','MealEvent')) {
        if (-not (Has-Property $eventDefs $name)) { Fail 'MODEL_SCHEMA_SHAPE_INVALID' "event def $name" }
    }
    foreach ($name in @('ConfirmedAlias','FieldProvenance','ProductIdentity','InventoryBatch','InventoryBatchProjection','InventoryTransaction')) {
        if (-not (Has-Property $inventoryDefs $name)) { Fail 'MODEL_SCHEMA_SHAPE_INVALID' "inventory def $name" }
    }
    $decimalDef = Get-Value $eventDefs 'DecimalString'
    if ([string](Get-Value $decimalDef 'type') -ne 'string' -or [string](Get-Value $decimalDef 'pattern') -ne '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$') { Fail 'MODEL_SCHEMA_SHAPE_INVALID' 'decimal string' }
    foreach ($def in @((Get-Value $eventDefs 'Amount'),(Get-Value $eventDefs 'MealItem'),(Get-Value $inventoryDefs 'ProductIdentity'),(Get-Value $inventoryDefs 'InventoryBatch'),(Get-Value $inventoryDefs 'InventoryBatchProjection'))) {
        $props = Get-Value $def 'properties'
        if (Has-Property $props 'status') { Fail 'MODEL_SCHEMA_SHAPE_INVALID' 'generic status property' }
        if ((Get-Value $def 'additionalProperties') -ne $false) { Fail 'MODEL_SCHEMA_SHAPE_INVALID' 'additionalProperties must be false' }
    }
    $eventEnvelope = Get-Value $eventDefs 'EventEnvelope'
    if (Has-Property (Get-Value $eventEnvelope 'properties') 'status') { Fail 'MODEL_SCHEMA_SHAPE_INVALID' 'event generic status property' }
    if ([string](Get-Value (Get-Value (Get-Value $eventEnvelope 'properties') 'result_status') 'const') -ne 'committed') { Fail 'MODEL_SCHEMA_SHAPE_INVALID' 'event result_status must be committed' }
    foreach ($composedName in @('MealEvent')) {
        $composed = Get-Value $eventDefs $composedName
        if ((Get-Value $composed 'unevaluatedProperties') -ne $false) { Fail 'MODEL_SCHEMA_SHAPE_INVALID' "$composedName unevaluatedProperties" }
    }
    $inventoryTransaction = Get-Value $inventoryDefs 'InventoryTransaction'
    if ((Get-Value $inventoryTransaction 'unevaluatedProperties') -ne $false) { Fail 'MODEL_SCHEMA_SHAPE_INVALID' 'InventoryTransaction unevaluatedProperties' }
    $batchProps = Get-Value (Get-Value $inventoryDefs 'InventoryBatch') 'properties'
    foreach ($forbidden in @('remaining_quantity','current_storage_location','opened_at','seal_status','expiry_status','effective_status','lifecycle_status','effective_expiration_at')) {
        if (Has-Property $batchProps $forbidden) { Fail 'MODEL_SCHEMA_SHAPE_INVALID' "batch mutable $forbidden" }
    }
}

foreach ($requiredFile in @($EventSchemaPath,$InventorySchemaPath)) {
    if (-not [IO.File]::Exists($requiredFile)) { Fail 'MODEL_SCHEMA_FILE_MISSING' $requiredFile }
}
if (-not [IO.File]::Exists($FixturePath)) { Fail 'MODEL_FIXTURE_FILE_MISSING' $FixturePath }

try {
    $eventSchema = [IO.File]::ReadAllText($EventSchemaPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    $inventorySchema = [IO.File]::ReadAllText($InventorySchemaPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    $fixture = [IO.File]::ReadAllText($FixturePath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
} catch {
    Fail 'MODEL_JSON_INVALID' $_.Exception.Message
}

Assert-SchemaIdentity $eventSchema $inventorySchema
Assert-SchemaShape $eventSchema $inventorySchema

$eventHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $EventSchemaPath).Hash
$inventoryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $InventorySchemaPath).Hash
$fixtureHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $FixturePath).Hash
if ($ExpectedEventSchemaSha256 -eq '__PENDING__' -or $eventHash -ne $ExpectedEventSchemaSha256) { Fail 'MODEL_SCHEMA_HASH_INVALID' 'event schema' }
if ($ExpectedInventorySchemaSha256 -eq '__PENDING__' -or $inventoryHash -ne $ExpectedInventorySchemaSha256) { Fail 'MODEL_SCHEMA_HASH_INVALID' 'inventory schema' }
if ($ExpectedFixtureSha256 -eq '__PENDING__' -or $fixtureHash -ne $ExpectedFixtureSha256) { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' 'fixture hash' }

if ([string](Get-Value $fixture 'fixture_set_id') -ne 'diet-manager/core-model-cases/v1' -or [string](Get-Value $fixture 'schema_version') -ne '1.0.0') { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' 'fixture identity' }
$templates = Get-Value $fixture 'templates'
$cases = @((Get-Value $fixture 'cases'))
$caseIds = @($cases | ForEach-Object { [string](Get-Value $_ 'case_id') })
if ($caseIds.Count -ne $ExpectedCaseIds.Count -or [string]::Join('|',$caseIds) -ne [string]::Join('|',$ExpectedCaseIds) -or @($caseIds | Sort-Object -Unique).Count -ne $caseIds.Count) { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' 'case ids/order/unique' }

$passed = 0
foreach ($case in $cases) {
    Assert-RequiredProperties $case @('case_id','target','template_id','mutations','expected_valid','expected_error_contains') 'case'
    $templateId = [string](Get-Value $case 'template_id')
    if (-not (Has-Property $templates $templateId)) { Fail 'MODEL_FIXTURE_COVERAGE_INVALID' "template $templateId" }
    $caseInput = Copy-FixtureValue (Get-Value $templates $templateId)
    foreach ($mutation in @((Get-Value $case 'mutations'))) { Apply-FixtureMutation $caseInput $mutation }
    $actual = Invoke-Case ([pscustomobject]@{ target = Get-Value $case 'target'; input = $caseInput })
    $expectedValid = [bool](Get-Value $case 'expected_valid')
    if ($actual.valid -ne $expectedValid) { Fail 'MODEL_CASE_RESULT_INVALID' "$([string](Get-Value $case 'case_id')) expected=$expectedValid actual=$($actual.valid) error=$($actual.error)" }
    $expectedError = [string](Get-Value $case 'expected_error_contains')
    if (-not $expectedValid -and -not [string]::IsNullOrEmpty($expectedError) -and $actual.error -notlike "*$expectedError*") { Fail 'MODEL_CASE_RESULT_INVALID' "$([string](Get-Value $case 'case_id')) error=$($actual.error)" }
    $passed++
}

$mutationFailures = 0
$originalEventId = [string](Get-Value $eventSchema '$id')
$eventSchema.PSObject.Properties['$id'].Value = 'https://invalid.example/schema'
try { Assert-SchemaIdentity $eventSchema $inventorySchema } catch { if ($_.Exception.Message -like 'MODEL_SCHEMA_IDENTITY_INVALID:*') { $mutationFailures++ } }
$eventSchema.PSObject.Properties['$id'].Value = $originalEventId

$floatMutation = [pscustomobject]@{ target='Amount'; input=[pscustomobject]@{raw_text='1.5';kind='exact';value=1.5;min_value=$null;max_value=$null;unit_raw='g';unit_normalized='g';qualifier=$null;conversion_basis=$null;conversion_formula=$null;conversion_source=$null;evidence_kind='explicit_user'} }
if (-not (Invoke-Case $floatMutation).valid) { $mutationFailures++ }

$statusMutationInput = Copy-FixtureValue (Get-Value $templates 'product_valid')
$statusMutationInput | Add-Member -MemberType NoteProperty -Name 'status' -Value 'active'
$statusMutation = [pscustomobject]@{ target='ProductIdentity'; input=$statusMutationInput }
if (-not (Invoke-Case $statusMutation).valid) { $mutationFailures++ }

$coverageMutation = @($caseIds | Select-Object -Skip 1)
if ([string]::Join('|',$coverageMutation) -ne [string]::Join('|',$ExpectedCaseIds)) { $mutationFailures++ }
if ($mutationFailures -ne 4) { Fail 'MODEL_MUTATION_NOT_REJECTED' "expected=4 actual=$mutationFailures" }

Write-Output "CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=$passed|event_defs=6|inventory_defs=6|mutations=$mutationFailures"
