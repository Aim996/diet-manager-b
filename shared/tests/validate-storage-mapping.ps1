[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$MappingPath = Join-Path $ProjectRoot 'shared\contracts\storage-mapping.md'

$ExpectedSources = [ordered]@{
    'https://diet-manager.local/schemas/event-and-amount/v1' = [ordered]@{ path = 'shared/schemas/event-and-amount.schema.json'; sha256 = 'FD5F2B44C5AC1B8295F54774AA3425DD2DB4BA16915111A3E1B241104CEE47CA' }
    'https://diet-manager.local/schemas/product-inventory/v1' = [ordered]@{ path = 'shared/schemas/product-inventory.schema.json'; sha256 = '681551FA18759AE3F993B0951C3A650FA8ABE16B28D7A9E7223E24F5E9B6613F' }
    'https://diet-manager.local/schemas/nutrition-progress/v1' = [ordered]@{ path = 'shared/schemas/nutrition-progress.schema.json'; sha256 = 'E8F0C95006529D5D6F9C388E657EA1F834C567D975577C5903B2B28D79C26DE8' }
    'https://diet-manager.local/schemas/issue-correction-mixed/v1' = [ordered]@{ path = 'shared/schemas/issue-correction-mixed.schema.json'; sha256 = 'EDBB15A38543431DD66564B696F7EA956F725E241E628D8EF36E1B9B0D3B511F' }
}

$ExpectedTables = @(
    'schema_migrations', 'command_envelopes', 'idempotency_records',
    'event_records', 'meal_items', 'products', 'inventory_batches',
    'inventory_batch_projections', 'inventory_transactions',
    'nutrition_profiles', 'nutrition_snapshots', 'goal_versions', 'user_profiles',
    'daily_progress_snapshots', 'issues', 'issue_resolution_events',
    'correction_events', 'effect_outbox', 'effect_bundle_commits',
    'envelope_finalizations', 'mixed_item_results'
)

$ExpectedIndexes = @(
    'ux_idempotency_identity', 'ux_event_source_message', 'ix_event_occurred',
    'ux_meal_item_event_order',
    'ux_effect_outbox_effect', 'ix_effect_outbox_state',
    'ux_inventory_transaction_idempotency', 'ix_inventory_transaction_batch_time',
    'ux_nutrition_profile_version', 'ix_nutrition_snapshot_meal_item',
    'ux_goal_version_effective', 'ux_user_profile_effective', 'ux_daily_progress_date_generation',
    'ix_issue_status_priority', 'ux_issue_resolution_request',
    'ux_correction_request', 'ux_envelope_idempotency_terminal',
    'ux_mixed_item_operation', 'ux_mixed_item_idempotency'
)
$ExpectedTransactionTables = [ordered]@{
    fact_commit = [ordered]@{
        allowed = @('command_envelopes','idempotency_records','event_records','meal_items','correction_events','effect_outbox')
        forbidden = @('schema_migrations','products','inventory_batches','inventory_batch_projections','inventory_transactions','nutrition_profiles','nutrition_snapshots','goal_versions','user_profiles','daily_progress_snapshots','issues','issue_resolution_events','effect_bundle_commits','envelope_finalizations','mixed_item_results')
    }
    effect_bundle = [ordered]@{
        allowed = @('command_envelopes','products','inventory_batches','inventory_batch_projections','inventory_transactions','nutrition_profiles','nutrition_snapshots','issues','issue_resolution_events','effect_outbox','effect_bundle_commits')
        forbidden = @('schema_migrations','idempotency_records','event_records','meal_items','correction_events','goal_versions','user_profiles','daily_progress_snapshots','envelope_finalizations','mixed_item_results')
    }
    envelope_finalize = [ordered]@{
        allowed = @('command_envelopes','idempotency_records','daily_progress_snapshots','envelope_finalizations','mixed_item_results')
        forbidden = @('schema_migrations','event_records','meal_items','products','inventory_batches','inventory_batch_projections','inventory_transactions','nutrition_profiles','nutrition_snapshots','goal_versions','user_profiles','issues','issue_resolution_events','correction_events','effect_outbox','effect_bundle_commits')
    }
    migration = [ordered]@{
        allowed = @('schema_migrations','command_envelopes','idempotency_records','event_records','meal_items','products','inventory_batches','inventory_batch_projections','inventory_transactions','nutrition_profiles','nutrition_snapshots','goal_versions','user_profiles','daily_progress_snapshots','issues','issue_resolution_events','correction_events','effect_outbox','effect_bundle_commits','envelope_finalizations','mixed_item_results')
        forbidden = @()
    }
}
$ExpectedPhysicalContractSha256 = '8AD6AA9A252D42129648F94F9083EFF112E1AC55B206C9C2A583BED38273C39B'
$ExpectedScalarStorageConstraints = @(
    [pscustomobject]@{ table = 'inventory_transactions'; column = 'direction'; type = 'TEXT'; required_check = "direction IN ('in','out','neutral')"; forbidden_check = "direction IN ('increase','decrease','no_change')" }
    [pscustomobject]@{ table = 'nutrition_profiles'; column = 'profile_version'; type = 'TEXT'; required_check = $null; forbidden_check = 'profile_version >= 1' }
    [pscustomobject]@{ table = 'nutrition_snapshots'; column = 'profile_version'; type = 'TEXT'; required_check = $null; forbidden_check = 'profile_version >= 1' }
    [pscustomobject]@{ table = 'issues'; column = 'status'; type = 'TEXT'; required_check = "status IN ('open','awaiting_user','resolved','dismissed')"; forbidden_check = "status IN ('open','deferred','resolved','dismissed')" }
    [pscustomobject]@{ table = 'correction_events'; column = 'operation'; type = 'TEXT'; required_check = "operation IN ('change_amount','change_unit','change_time','change_meal_slot','change_item_name','change_food_type','change_components','add_item','remove_item','change_inventory_link','change_nutrition_source','void_event','restore_event')"; forbidden_check = "operation IN ('correct','void','restore')" }
    [pscustomobject]@{ table = 'effect_bundle_commits'; column = 'stage'; type = 'TEXT'; required_check = "stage = 'EffectBundle'"; forbidden_check = "stage = 'effect_bundle'" }
    [pscustomobject]@{ table = 'envelope_finalizations'; column = 'stage'; type = 'TEXT'; required_check = "stage = 'EnvelopeFinalize'"; forbidden_check = "stage = 'envelope_finalize'" }
)

function Fail([string]$Code, [string]$Detail) {
    throw "$Code`:$Detail"
}

function Read-JsonStrict([string]$Path) {
    try {
        return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        Fail 'STORAGE_MAPPING_JSON_INVALID' $Path
    }
}

function Get-PropertyNames($Value) {
    if ($null -eq $Value) { return @() }
    return @($Value.PSObject.Properties.Name)
}

function Assert-ExactProperties($Value, [string[]]$Expected, [string]$Label) {
    if ($null -eq $Value) { Fail 'STORAGE_MAPPING_SHAPE_INVALID' "$Label null" }
    $actual = @(Get-PropertyNames $Value | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if (($actual -join '|') -cne ($wanted -join '|')) {
        Fail 'STORAGE_MAPPING_SHAPE_INVALID' "$Label expected=$($wanted -join ',') actual=$($actual -join ',')"
    }
}

function Assert-StringArray($Value, [string]$Label) {
    if ($null -eq $Value -or $Value -is [string] -or $Value -isnot [Collections.IEnumerable]) {
        Fail 'STORAGE_MAPPING_SHAPE_INVALID' "$Label array"
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($entry in @($Value)) {
        if ($entry -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$entry) -or -not $seen.Add([string]$entry)) {
            Fail 'STORAGE_MAPPING_SHAPE_INVALID' "$Label value"
        }
    }
    return @($Value)
}

function Resolve-Reference([string]$Reference, [string]$BaseId) {
    $schemaId = $BaseId
    $fragment = $Reference
    if (-not $Reference.StartsWith('#', [StringComparison]::Ordinal)) {
        $separator = $Reference.IndexOf('#')
        if ($separator -lt 0) {
            $schemaId = $Reference
            $fragment = '#'
        } else {
            $schemaId = $Reference.Substring(0, $separator)
            $fragment = $Reference.Substring($separator)
        }
    }
    if (-not $fragment.StartsWith('#/$defs/', [StringComparison]::Ordinal)) {
        Fail 'STORAGE_MAPPING_SCHEMA_REFERENCE_INVALID' $Reference
    }
    return [pscustomobject]@{ schema_id = $schemaId; definition = $fragment.Substring(8) }
}

function Add-ResolvedProperties($Node, [string]$BaseId, $Schemas, $Target, $Seen) {
    if ($null -eq $Node) { return }
    $refProperty = $Node.PSObject.Properties['$ref']
    if ($null -ne $refProperty) {
        $resolved = Resolve-Reference ([string]$refProperty.Value) $BaseId
        $key = $resolved.schema_id + '#/$defs/' + $resolved.definition
        if (-not $Seen.Add($key)) { return }
        $schema = $Schemas[$resolved.schema_id]
        if ($null -eq $schema) { Fail 'STORAGE_MAPPING_SCHEMA_REFERENCE_INVALID' $key }
        $definitionProperty = $schema.'$defs'.PSObject.Properties[$resolved.definition]
        if ($null -eq $definitionProperty) { Fail 'STORAGE_MAPPING_SCHEMA_REFERENCE_INVALID' $key }
        Add-ResolvedProperties $definitionProperty.Value $resolved.schema_id $Schemas $Target $Seen
    }
    $propertiesProperty = $Node.PSObject.Properties['properties']
    if ($null -ne $propertiesProperty) {
        foreach ($name in @($propertiesProperty.Value.PSObject.Properties.Name)) { [void]$Target.Add([string]$name) }
    }
    $allOfProperty = $Node.PSObject.Properties['allOf']
    if ($null -ne $allOfProperty) {
        foreach ($part in @($allOfProperty.Value)) { Add-ResolvedProperties $part $BaseId $Schemas $Target $Seen }
    }
}

function Get-DefinitionInventory {
    $schemas = @{}
    foreach ($schemaId in $ExpectedSources.Keys) {
        $source = $ExpectedSources[$schemaId]
        $path = Join-Path $ProjectRoot ([string]$source.path).Replace('/', '\')
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash -cne [string]$source.sha256) {
            Fail 'STORAGE_MAPPING_UPSTREAM_HASH_INVALID' $source.path
        }
        $schema = Read-JsonStrict $path
        if ([string]$schema.'$id' -cne [string]$schemaId) { Fail 'STORAGE_MAPPING_UPSTREAM_ID_INVALID' $source.path }
        $schemas[$schemaId] = $schema
    }
    $inventory = [ordered]@{}
    foreach ($schemaId in $ExpectedSources.Keys) {
        $schema = $schemas[$schemaId]
        foreach ($definition in $schema.'$defs'.PSObject.Properties) {
            $target = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            [void]$seen.Add($schemaId + '#/$defs/' + $definition.Name)
            Add-ResolvedProperties $definition.Value $schemaId $schemas $target $seen
            $inventory[$schemaId + '#/$defs/' + $definition.Name] = @($target | Sort-Object)
        }
    }
    return $inventory
}

function Read-MappingDocument {
    if (-not [IO.File]::Exists($MappingPath)) { Fail 'STORAGE_MAPPING_FILE_MISSING' $MappingPath }
    $text = Get-Content -LiteralPath $MappingPath -Raw -Encoding UTF8
    $matches = [regex]::Matches($text, '(?s)```json storage-mapping/v1\r?\n(?<json>.*?)\r?\n```')
    if ($matches.Count -ne 1) { Fail 'STORAGE_MAPPING_MACHINE_BLOCK_INVALID' "count=$($matches.Count)" }
    try { return ($matches[0].Groups['json'].Value | ConvertFrom-Json) }
    catch { Fail 'STORAGE_MAPPING_MACHINE_BLOCK_INVALID' 'json' }
}

function Assert-Set([string[]]$Actual, [string[]]$Expected, [string]$Label) {
    if ((@($Actual | Sort-Object) -join '|') -cne (@($Expected | Sort-Object) -join '|')) {
        Fail 'STORAGE_MAPPING_SET_INVALID' $Label
    }
}

function Get-TableColumnNames($Table, [string]$Label) {
    $names = @()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($column in @($Table.columns)) {
        Assert-ExactProperties $column @('name','type','not_null','default') "$Label column"
        $name = [string]$column.name
        if ([string]::IsNullOrWhiteSpace($name) -or -not $seen.Add($name)) { Fail 'STORAGE_MAPPING_TABLE_INVALID' "$Label column name" }
        if ([string]$column.type -notin @('TEXT','INTEGER','REAL','BLOB')) { Fail 'STORAGE_MAPPING_TABLE_INVALID' "$Label column type $name" }
        if ($column.not_null -isnot [bool]) { Fail 'STORAGE_MAPPING_TABLE_INVALID' "$Label column nullability $name" }
        if ($null -ne $column.default -and $column.default -isnot [string]) { Fail 'STORAGE_MAPPING_TABLE_INVALID' "$Label column default $name" }
        $names += $name
    }
    return $names
}

function Assert-ScalarStorageConstraints($TablesByName) {
    foreach ($expected in $ExpectedScalarStorageConstraints) {
        $tableName = [string]$expected.table
        $columnName = [string]$expected.column
        if (-not $TablesByName.ContainsKey($tableName)) {
            Fail 'STORAGE_MAPPING_SCHEMA_CONSTRAINT_INVALID' "$tableName missing"
        }
        $columns = @($TablesByName[$tableName].columns | Where-Object { [string]$_.name -ceq $columnName })
        if ($columns.Count -ne 1 -or [string]$columns[0].type -cne [string]$expected.type) {
            Fail 'STORAGE_MAPPING_SCHEMA_CONSTRAINT_INVALID' "$tableName.$columnName type"
        }
        $checks = @($TablesByName[$tableName].checks)
        if ($null -ne $expected.required_check -and [string]$expected.required_check -cnotin $checks) {
            Fail 'STORAGE_MAPPING_SCHEMA_CONSTRAINT_INVALID' "$tableName.$columnName check"
        }
        if ($null -ne $expected.forbidden_check -and [string]$expected.forbidden_check -cin $checks) {
            Fail 'STORAGE_MAPPING_SCHEMA_CONSTRAINT_INVALID' "$tableName.$columnName obsolete_check"
        }
    }
}

function Assert-Mapping($Mapping, $Inventory) {
    Assert-ExactProperties $Mapping @('mapping_id','version','database','route_policy','schema_sources','object_mappings','tables','indexes','transaction_boundaries','migrations','recovery','control_merge_points','technical_log_policy','invariants') 'root'
    if ([string]$Mapping.mapping_id -cne 'diet-manager/b-sqlite-mapping/v1' -or [string]$Mapping.version -cne '1.0.0') { Fail 'STORAGE_MAPPING_IDENTITY_INVALID' 'root' }

    Assert-ExactProperties $Mapping.database @('filename','driver','sqlite_user_version','journal_mode','foreign_keys','busy_timeout_ms','path_authority') 'database'
    if ([string]$Mapping.database.filename -cne 'diet-manager-b.sqlite3' -or [string]$Mapping.database.driver -cne 'node:sqlite' -or [int]$Mapping.database.sqlite_user_version -ne 1 -or [string]$Mapping.database.journal_mode -cne 'WAL' -or $Mapping.database.foreign_keys -isnot [bool] -or -not [bool]$Mapping.database.foreign_keys -or [int]$Mapping.database.busy_timeout_ms -ne 5000 -or [string]$Mapping.database.path_authority -cne 'private_b_runtime_root') { Fail 'STORAGE_MAPPING_DATABASE_INVALID' 'database' }

    Assert-ExactProperties $Mapping.route_policy @('selected_route','a_mode','c_mode','c_controls_target','selected_route_map_created') 'route_policy'
    if ([string]$Mapping.route_policy.selected_route -cne 'B' -or [string]$Mapping.route_policy.a_mode -cne 'read_only_no_writer' -or [string]$Mapping.route_policy.c_mode -cne 'no_independent_storage' -or [string]$Mapping.route_policy.c_controls_target -cne 'B-MERGE-C-001' -or $Mapping.route_policy.selected_route_map_created -isnot [bool] -or [bool]$Mapping.route_policy.selected_route_map_created) { Fail 'STORAGE_MAPPING_ROUTE_POLICY_INVALID' 'route_policy' }

    $sourceIds = @()
    foreach ($source in @($Mapping.schema_sources)) {
        Assert-ExactProperties $source @('schema_id','path','sha256','definition_count') 'schema_source'
        $schemaId = [string]$source.schema_id
        if (-not $ExpectedSources.Contains($schemaId)) { Fail 'STORAGE_MAPPING_SOURCE_INVALID' $schemaId }
        $expected = $ExpectedSources[$schemaId]
        if ([string]$source.path -cne [string]$expected.path -or [string]$source.sha256 -cne [string]$expected.sha256) { Fail 'STORAGE_MAPPING_SOURCE_INVALID' $schemaId }
        $expectedCount = @($Inventory.Keys | Where-Object { $_.StartsWith("$schemaId#", [StringComparison]::Ordinal) }).Count
        if ([int]$source.definition_count -ne $expectedCount) { Fail 'STORAGE_MAPPING_SOURCE_INVALID' "$schemaId count" }
        $sourceIds += $schemaId
    }
    Assert-Set $sourceIds @($ExpectedSources.Keys) 'schema_sources'

    $mappingRefs = @()
    foreach ($objectMapping in @($Mapping.object_mappings)) {
        Assert-ExactProperties $objectMapping @('schema_ref','mode','table','field_groups') 'object_mapping'
        $schemaRef = [string]$objectMapping.schema_ref
        if (-not $Inventory.Contains($schemaRef)) { Fail 'STORAGE_MAPPING_OBJECT_INVALID' $schemaRef }
        Assert-ExactProperties $objectMapping.field_groups @('columns','json','child_tables','response_only') "field_groups $schemaRef"
        $assigned = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($groupName in @('columns','json','child_tables','response_only')) {
            foreach ($field in @(Assert-StringArray $objectMapping.field_groups.$groupName "$schemaRef $groupName")) {
                if (-not $assigned.Add([string]$field)) { Fail 'STORAGE_MAPPING_FIELD_DUPLICATE' "$schemaRef $field" }
            }
        }
        Assert-Set @($assigned) @($Inventory[$schemaRef]) "fields $schemaRef"
        $mode = [string]$objectMapping.mode
        if ($mode -notin @('scalar','embedded','table','response_only')) { Fail 'STORAGE_MAPPING_OBJECT_INVALID' "$schemaRef mode" }
        if ($mode -eq 'table' -and ([string]::IsNullOrWhiteSpace([string]$objectMapping.table) -or @($objectMapping.field_groups.response_only).Count -ne 0)) { Fail 'STORAGE_MAPPING_OBJECT_INVALID' "$schemaRef table" }
        if ($mode -ne 'table' -and $null -ne $objectMapping.table) { Fail 'STORAGE_MAPPING_OBJECT_INVALID' "$schemaRef table null" }
        if ($mode -eq 'response_only' -and (@($objectMapping.field_groups.response_only).Count -ne @($Inventory[$schemaRef]).Count)) { Fail 'STORAGE_MAPPING_OBJECT_INVALID' "$schemaRef response" }
        $mappingRefs += $schemaRef
    }
    Assert-Set $mappingRefs @($Inventory.Keys) 'object_mappings'

    $tableNames = @()
    $tablesByName = @{}
    foreach ($table in @($Mapping.tables)) {
        Assert-ExactProperties $table @('name','purpose','primary_key','columns','checks','foreign_keys') 'table'
        $name = [string]$table.name
        $columns = @(Get-TableColumnNames $table "$name columns")
        if ($columns.Count -eq 0) { Fail 'STORAGE_MAPPING_TABLE_INVALID' "$name columns empty" }
        $primaryKey = @(Assert-StringArray $table.primary_key "$name primary_key")
        if ($primaryKey.Count -eq 0) { Fail 'STORAGE_MAPPING_TABLE_INVALID' "$name primary_key empty" }
        foreach ($key in $primaryKey) { if ($key -notin $columns) { Fail 'STORAGE_MAPPING_TABLE_INVALID' "$name primary_key" } }
        [void](Assert-StringArray $table.checks "$name checks")
        [void](Assert-StringArray $table.foreign_keys "$name foreign_keys")
        if ($tablesByName.ContainsKey($name)) { Fail 'STORAGE_MAPPING_TABLE_INVALID' "$name duplicate" }
        $tablesByName[$name] = $table
        $tableNames += $name
    }
    Assert-Set $tableNames $ExpectedTables 'tables'
    Assert-ScalarStorageConstraints $tablesByName

    foreach ($objectMapping in @($Mapping.object_mappings | Where-Object { $_.mode -ceq 'table' })) {
        $table = $tablesByName[[string]$objectMapping.table]
        if ($null -eq $table) { Fail 'STORAGE_MAPPING_OBJECT_INVALID' "$($objectMapping.schema_ref) missing table" }
        $columnNames = @(Get-TableColumnNames $table ([string]$table.name))
        foreach ($field in @($objectMapping.field_groups.columns)) { if ($field -notin $columnNames) { Fail 'STORAGE_MAPPING_COLUMN_INVALID' "$($objectMapping.schema_ref) $field" } }
        if (@($objectMapping.field_groups.json).Count -gt 0 -and 'payload_json' -notin $columnNames) { Fail 'STORAGE_MAPPING_COLUMN_INVALID' "$($objectMapping.schema_ref) payload_json" }
    }

    $indexNames = @()
    foreach ($index in @($Mapping.indexes)) {
        Assert-ExactProperties $index @('name','table','columns','unique','where') 'index'
        if (-not $tablesByName.ContainsKey([string]$index.table)) { Fail 'STORAGE_MAPPING_INDEX_INVALID' $index.name }
        $tableColumnNames = @(Get-TableColumnNames $tablesByName[[string]$index.table] ([string]$index.table))
        foreach ($column in @(Assert-StringArray $index.columns "$($index.name) columns")) { if ($column -notin $tableColumnNames) { Fail 'STORAGE_MAPPING_INDEX_INVALID' "$($index.name) column" } }
        if ($index.unique -isnot [bool]) { Fail 'STORAGE_MAPPING_INDEX_INVALID' "$($index.name) unique" }
        $indexNames += [string]$index.name
    }
    Assert-Set $indexNames $ExpectedIndexes 'indexes'

    $uniqueParentColumns = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($table in @($Mapping.tables)) {
        if (@($table.primary_key).Count -eq 1) { [void]$uniqueParentColumns.Add(([string]$table.name) + '|' + ([string]$table.primary_key[0])) }
    }
    foreach ($index in @($Mapping.indexes | Where-Object { [bool]$_.unique -and @($_.columns).Count -eq 1 })) {
        [void]$uniqueParentColumns.Add(([string]$index.table) + '|' + ([string]$index.columns[0]))
    }
    foreach ($table in @($Mapping.tables)) {
        $childColumns = @(Get-TableColumnNames $table ([string]$table.name))
        foreach ($foreignKey in @($table.foreign_keys)) {
            $match = [regex]::Match([string]$foreignKey, '^(?<child>[a-z][a-z0-9_]*) -> (?<parent>[a-z][a-z0-9_]*)\((?<column>[a-z][a-z0-9_]*)\) ON UPDATE RESTRICT ON DELETE RESTRICT$')
            if (-not $match.Success) { Fail 'STORAGE_MAPPING_FOREIGN_KEY_INVALID' ([string]$table.name) }
            if ($match.Groups['child'].Value -notin $childColumns) { Fail 'STORAGE_MAPPING_FOREIGN_KEY_INVALID' "$($table.name) child" }
            $parentName = $match.Groups['parent'].Value
            if (-not $tablesByName.ContainsKey($parentName)) { Fail 'STORAGE_MAPPING_FOREIGN_KEY_INVALID' "$($table.name) parent" }
            $parentColumn = $match.Groups['column'].Value
            if ($parentColumn -notin @(Get-TableColumnNames $tablesByName[$parentName] $parentName)) { Fail 'STORAGE_MAPPING_FOREIGN_KEY_INVALID' "$($table.name) parent column" }
            if (-not $uniqueParentColumns.Contains($parentName + '|' + $parentColumn)) { Fail 'STORAGE_MAPPING_FOREIGN_KEY_INVALID' "$($table.name) parent not unique" }
        }
    }

    $transactionIds = @()
    foreach ($boundary in @($Mapping.transaction_boundaries)) {
        Assert-ExactProperties $boundary @('id','begin_mode','allowed_tables','forbidden_tables','success_state','failure_state') 'transaction_boundary'
        $boundaryId = [string]$boundary.id
        $allowedTables = @(Assert-StringArray $boundary.allowed_tables "$boundaryId allowed")
        $forbiddenTables = @(Assert-StringArray $boundary.forbidden_tables "$boundaryId forbidden")
        if (-not $ExpectedTransactionTables.Contains($boundaryId)) { Fail 'STORAGE_MAPPING_TRANSACTION_INVALID' "$boundaryId unknown" }
        Assert-Set $allowedTables @($ExpectedTransactionTables[$boundaryId].allowed) "$boundaryId allowed"
        Assert-Set $forbiddenTables @($ExpectedTransactionTables[$boundaryId].forbidden) "$boundaryId forbidden"
        Assert-Set @($allowedTables + $forbiddenTables) $ExpectedTables "$boundaryId partition"
        $transactionIds += $boundaryId
    }
    Assert-Set $transactionIds @('fact_commit','effect_bundle','envelope_finalize','migration') 'transaction_boundaries'
    $fact = @($Mapping.transaction_boundaries | Where-Object { $_.id -ceq 'fact_commit' })[0]
    foreach ($forbidden in @('nutrition_snapshots','inventory_transactions','issues','daily_progress_snapshots','envelope_finalizations','mixed_item_results')) {
        if ($forbidden -notin @($fact.forbidden_tables) -or $forbidden -in @($fact.allowed_tables)) { Fail 'STORAGE_MAPPING_TRANSACTION_INVALID' "fact_commit $forbidden" }
    }
    if ([string]$fact.failure_state -cne 'failed_fact_zero_business_rows') { Fail 'STORAGE_MAPPING_TRANSACTION_INVALID' 'fact_commit failure' }

    $migrationScenarios = @()
    foreach ($migration in @($Mapping.migrations)) {
        Assert-ExactProperties $migration @('scenario','transaction','backup_required','user_version_before','user_version_after','on_failure') 'migration'
        $migrationScenarios += [string]$migration.scenario
    }
    Assert-Set $migrationScenarios @('fresh_install','upgrade_success','upgrade_failure','recovery') 'migrations'
    $upgradeFailure = @($Mapping.migrations | Where-Object { $_.scenario -ceq 'upgrade_failure' })[0]
    if ([int]$upgradeFailure.user_version_after -ne [int]$upgradeFailure.user_version_before -or [string]$upgradeFailure.on_failure -cne 'rollback_preserve_original') { Fail 'STORAGE_MAPPING_MIGRATION_INVALID' 'upgrade_failure' }

    $recoveryIds = @()
    foreach ($item in @($Mapping.recovery)) {
        Assert-ExactProperties $item @('id','trigger','required_checks','outcome') 'recovery'
        [void](Assert-StringArray $item.required_checks "$($item.id) checks")
        $recoveryIds += [string]$item.id
    }
    Assert-Set $recoveryIds @('normal_open','wal_recovery','integrity_failure','restore_candidate') 'recovery'

    $controlIds = @()
    foreach ($control in @($Mapping.control_merge_points)) {
        Assert-ExactProperties $control @('id','owner','storage_target','enforced_before_write') 'control_merge_point'
        if ([string]$control.owner -cne 'B-MERGE-C-001' -or $control.enforced_before_write -isnot [bool] -or -not [bool]$control.enforced_before_write) { Fail 'STORAGE_MAPPING_CONTROL_INVALID' $control.id }
        $controlIds += [string]$control.id
    }
    Assert-Set $controlIds @('preview_authority','data_revision','transition_guard','idempotency_guard','migration_guard') 'control_merge_points'

    Assert-ExactProperties $Mapping.technical_log_policy @('sink','inside_business_database','contains_dietary_payload','participates_in_business_queries','changes_transaction_outcome') 'technical_log_policy'
    if ([string]$Mapping.technical_log_policy.sink -cne 'separate_redacted_non_business' -or [bool]$Mapping.technical_log_policy.inside_business_database -or [bool]$Mapping.technical_log_policy.contains_dietary_payload -or [bool]$Mapping.technical_log_policy.participates_in_business_queries -or [bool]$Mapping.technical_log_policy.changes_transaction_outcome) { Fail 'STORAGE_MAPPING_TECHNICAL_LOG_INVALID' 'technical_log_policy' }

    $invariants = @(Assert-StringArray $Mapping.invariants 'invariants')
    Assert-Set $invariants @('all_fields_mapped_once','b_only_writer','a_read_only','c_no_independent_database','fact_commit_zero_business_rows_on_failure','effect_bundle_no_final_receipt','envelope_finalize_atomic','technical_log_outside_business_database','idempotency_conflict_zero_write','migration_version_changes_only_on_commit') 'invariants'
    $physicalContractSha256 = Get-PhysicalContractSha256 $Mapping
    if ($physicalContractSha256 -cne $ExpectedPhysicalContractSha256) {
        Fail 'STORAGE_MAPPING_PHYSICAL_CONTRACT_INVALID' "expected=$ExpectedPhysicalContractSha256 actual=$physicalContractSha256"
    }
}

function Clone-Value($Value) {
    return ($Value | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json)
}

function Get-PhysicalContractSha256($Mapping) {
    $physical = [ordered]@{
        database = $Mapping.database
        route_policy = $Mapping.route_policy
        tables = $Mapping.tables
        indexes = $Mapping.indexes
        transaction_boundaries = $Mapping.transaction_boundaries
        migrations = $Mapping.migrations
        recovery = $Mapping.recovery
        control_merge_points = $Mapping.control_merge_points
        technical_log_policy = $Mapping.technical_log_policy
        invariants = $Mapping.invariants
    }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($physical | ConvertTo-Json -Depth 64 -Compress))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('X2') }) -join '') }
    finally { $sha.Dispose() }
}

$inventory = Get-DefinitionInventory
$mapping = Read-MappingDocument
Assert-Mapping $mapping $inventory

$mutations = @(
    [pscustomobject]@{ id = 'MUT-MAP-DROP-FIELD'; apply = { param($m) $issue = @($m.object_mappings | Where-Object { $_.schema_ref -like '*issue-correction-mixed/v1#/$defs/Issue' })[0]; $issue.field_groups.json = @($issue.field_groups.json | Select-Object -Skip 1) } },
    [pscustomobject]@{ id = 'MUT-MAP-A-WRITER'; apply = { param($m) $m.route_policy.a_mode = 'sqlite_writer' } },
    [pscustomobject]@{ id = 'MUT-MAP-LOG-IN-BUSINESS-DB'; apply = { param($m) $m.technical_log_policy.inside_business_database = $true } },
    [pscustomobject]@{ id = 'MUT-MAP-FACT-WRITES-FINAL'; apply = { param($m) $fact = @($m.transaction_boundaries | Where-Object { $_.id -ceq 'fact_commit' })[0]; $fact.allowed_tables = @($fact.allowed_tables) + 'envelope_finalizations' } },
    [pscustomobject]@{ id = 'MUT-MAP-DROP-IDEMPOTENCY-INDEX'; apply = { param($m) $m.indexes = @($m.indexes | Where-Object { $_.name -cne 'ux_idempotency_identity' }) } },
    [pscustomobject]@{ id = 'MUT-MAP-FAILED-MIGRATION-ADVANCES'; apply = { param($m) $failure = @($m.migrations | Where-Object { $_.scenario -ceq 'upgrade_failure' })[0]; $failure.user_version_after = 1 } },
    [pscustomobject]@{ id = 'MUT-MAP-WEAKEN-COLUMN-TYPE'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'event_records' })[0]; $column = @($table.columns | Where-Object { $_.name -ceq 'event_id' })[0]; $column.type = 'BLOB' } },
    [pscustomobject]@{ id = 'MUT-MAP-WEAKEN-NULLABILITY'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'meal_items' })[0]; $column = @($table.columns | Where-Object { $_.name -ceq 'event_id' })[0]; $column.not_null = $false } },
    [pscustomobject]@{ id = 'MUT-MAP-REDIRECT-FOREIGN-KEY'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'event_records' })[0]; $table.foreign_keys[0] = 'operation_id -> command_envelopes(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT' } }
    [pscustomobject]@{ id = 'MUT-MAP-INVENTORY-DIRECTION-ENUM'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'inventory_transactions' })[0]; $table.checks[0] = "direction IN ('increase','decrease','no_change')" } }
    [pscustomobject]@{ id = 'MUT-MAP-NUTRITION-PROFILE-VERSION-TYPE'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'nutrition_profiles' })[0]; $column = @($table.columns | Where-Object { $_.name -ceq 'profile_version' })[0]; $column.type = 'INTEGER' } }
    [pscustomobject]@{ id = 'MUT-MAP-NUTRITION-SNAPSHOT-VERSION-TYPE'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'nutrition_snapshots' })[0]; $column = @($table.columns | Where-Object { $_.name -ceq 'profile_version' })[0]; $column.type = 'INTEGER' } }
    [pscustomobject]@{ id = 'MUT-MAP-ISSUE-STATUS-ENUM'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'issues' })[0]; $table.checks[0] = "status IN ('open','deferred','resolved','dismissed')" } }
    [pscustomobject]@{ id = 'MUT-MAP-CORRECTION-OPERATION-ENUM'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'correction_events' })[0]; $table.checks[1] = "operation IN ('correct','void','restore')" } }
    [pscustomobject]@{ id = 'MUT-MAP-EFFECT-STAGE-CONST'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'effect_bundle_commits' })[0]; $table.checks[0] = "stage = 'effect_bundle'" } }
    [pscustomobject]@{ id = 'MUT-MAP-FINALIZE-STAGE-CONST'; apply = { param($m) $table = @($m.tables | Where-Object { $_.name -ceq 'envelope_finalizations' })[0]; $table.checks[1] = "stage = 'envelope_finalize'" } }
    [pscustomobject]@{ id = 'MUT-MAP-EFFECT-ENVELOPE-UNCLASSIFIED'; apply = { param($m) $boundary = @($m.transaction_boundaries | Where-Object { $_.id -ceq 'effect_bundle' })[0]; $boundary.allowed_tables = @($boundary.allowed_tables | Where-Object { $_ -cne 'command_envelopes' }) } }
    [pscustomobject]@{ id = 'MUT-MAP-EFFECT-IDEMPOTENCY-WRITABLE'; apply = { param($m) $boundary = @($m.transaction_boundaries | Where-Object { $_.id -ceq 'effect_bundle' })[0]; $boundary.forbidden_tables = @($boundary.forbidden_tables | Where-Object { $_ -cne 'idempotency_records' }); $boundary.allowed_tables = @($boundary.allowed_tables) + 'idempotency_records' } }
)

foreach ($mutation in $mutations) {
    $candidate = Clone-Value $mapping
    & $mutation.apply $candidate
    $rejected = $false
    try { Assert-Mapping $candidate $inventory } catch { $rejected = $true }
    if (-not $rejected) { Fail 'STORAGE_MAPPING_MUTATION_NOT_REJECTED' $mutation.id }
    Write-Output "$($mutation.id)|PASS"
}

Write-Output "STORAGE_MAPPING|PASS|version=1.0.0|sources=$($ExpectedSources.Count)|definitions=$($inventory.Count)|tables=$($ExpectedTables.Count)|indexes=$($ExpectedIndexes.Count)|mutations=$($mutations.Count)"
