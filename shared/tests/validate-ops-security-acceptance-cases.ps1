[CmdletBinding()]
param(
    [string]$CasesPath,
    [string]$FixturesPath,
    [switch]$SkipMutations,
    [switch]$LibraryOnly
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
    "CASE-EXPORT-004"
)

$ExpectedOpsCaseIds = @(
    "CASE-PRIV-001",
    "CASE-FOUNDATION-002",
    "CASE-OPS-001",
    "CASE-OPS-003",
    "CASE-OPS-010",
    "CASE-EXPORT-004"
)

$ExpectedOpsScenarioIds = @(
    "ops-privacy-public-nutrition-v1",
    "ops-foundation-zero-diff-v1",
    "ops-clean-install-b-v1",
    "ops-migration-interrupted-v1",
    "ops-candidate-byte-drift-v1",
    "ops-minimal-export-restore-reject-v1"
)

function Assert-OpsTrue {
    param([bool]$Condition, [string]$Code)
    if (-not $Condition) {
        throw $Code
    }
}

function Assert-OpsEqual {
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

function Assert-OpsPlainObject {
    param($Value, [string]$Code)
    Assert-OpsTrue ($null -ne $Value) $Code
    Assert-OpsTrue (-not ($Value -is [System.Array])) $Code
    Assert-OpsTrue (-not ($Value -is [string])) $Code
    Assert-OpsTrue ($Value -is [psobject]) $Code
}

function Assert-OpsExactProperties {
    param($Value, [string[]]$Expected, [string]$Code)
    Assert-OpsPlainObject $Value $Code
    $actual = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-OpsEqual $Expected.Count $actual.Count ("{0}:property_count" -f $Code)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-OpsEqual $Expected[$index] $actual[$index] ("{0}:property_{1}" -f $Code, $index)
        Assert-OpsEqual "NoteProperty" ([string]$Value.PSObject.Properties[$actual[$index]].MemberType) ("{0}:member_type_{1}" -f $Code, $index)
    }
}

function Assert-OpsExactStringArray {
    param([string[]]$Expected, $Actual, [string]$Code)
    Assert-OpsTrue ($Actual -is [System.Array]) ("{0}:array" -f $Code)
    $values = @($Actual)
    Assert-OpsEqual $Expected.Count $values.Count ("{0}:count" -f $Code)
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-OpsTrue ($values[$index] -is [string]) ("{0}:type_{1}" -f $Code, $index)
        Assert-OpsEqual $Expected[$index] ([string]$values[$index]) ("{0}:value_{1}" -f $Code, $index)
    }
}

function Read-OpsJson {
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

function Copy-OpsJson {
    param($Value)
    return ($Value | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json)
}

function Get-OpsSha256 {
    param([byte[]]$Bytes)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($Bytes)
        return ([BitConverter]::ToString($hash).Replace("-", ""))
    }
    finally {
        $sha.Dispose()
    }
}

function Get-OpsCaseById {
    param($CaseSet, [string]$Id)
    $matches = @($CaseSet.cases | Where-Object { [string]$_.id -ceq $Id })
    Assert-OpsEqual 1 $matches.Count ("OPS_SECURITY_CASE_ID_INVALID:{0}" -f $Id)
    return $matches[0]
}

function Get-OpsScenarioById {
    param($Fixtures, [string]$Id)
    $matches = @($Fixtures.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq $Id })
    Assert-OpsEqual 1 $matches.Count ("OPS_SECURITY_SCENARIO_ID_INVALID:{0}" -f $Id)
    return $matches[0]
}

function Assert-OpsFileRecord {
    param(
        $Record,
        [string]$ExpectedPath,
        [string]$ExpectedBase64,
        [int]$ExpectedLength,
        [string]$ExpectedSha256,
        [string]$ExpectedLastWriteUtc,
        [string]$Code
    )

    Assert-OpsExactProperties $Record @("logical_path", "bytes_base64", "length", "sha256", "last_write_utc") ("{0}:shape" -f $Code)
    Assert-OpsEqual $ExpectedPath ([string]$Record.logical_path) ("{0}:path" -f $Code)
    Assert-OpsEqual $ExpectedBase64 ([string]$Record.bytes_base64) ("{0}:base64" -f $Code)
    Assert-OpsEqual $ExpectedLength ([int]$Record.length) ("{0}:length" -f $Code)
    Assert-OpsEqual $ExpectedSha256 ([string]$Record.sha256) ("{0}:sha256" -f $Code)
    Assert-OpsEqual $ExpectedLastWriteUtc ([string]$Record.last_write_utc) ("{0}:last_write" -f $Code)
    $bytes = $null
    try {
        $bytes = [Convert]::FromBase64String([string]$Record.bytes_base64)
    }
    catch {
        throw ("{0}:base64_invalid" -f $Code)
    }
    Assert-OpsEqual $ExpectedLength $bytes.Length ("{0}:decoded_length" -f $Code)
    Assert-OpsEqual $ExpectedSha256 (Get-OpsSha256 $bytes) ("{0}:decoded_sha256" -f $Code)
}

function Assert-OpsScenarioCommon {
    param($Scenario, [string]$ExpectedId, [string]$ExpectedType, [string[]]$ExpectedProperties, [string]$Code)

    Assert-OpsExactProperties $Scenario $ExpectedProperties ("{0}:shape" -f $Code)
    Assert-OpsEqual $ExpectedId ([string]$Scenario.fixture_id) ("{0}:id" -f $Code)
    Assert-OpsEqual $ExpectedType ([string]$Scenario.scenario_type) ("{0}:type" -f $Code)
}

function Assert-OpsPrivacyScenario {
    param($Scenario)

    Assert-OpsScenarioCommon $Scenario "ops-privacy-public-nutrition-v1" "privacy_external_allowlist" @(
        "fixture_id", "scenario_type", "allowed_external_fields", "outbound_request", "forbidden_context",
        "ordinary_log", "credential_state", "fallback", "business_write_count"
    ) "OPS_SECURITY_SCENARIO_INVALID:privacy"
    Assert-OpsExactStringArray @(
        "normalized_name", "brand", "variant", "specification", "preparation_state", "region"
    ) $Scenario.allowed_external_fields "OPS_SECURITY_PRIVACY_ALLOWLIST_INVALID"
    Assert-OpsExactProperties $Scenario.outbound_request @(
        "normalized_name", "brand", "variant", "specification", "preparation_state", "region"
    ) "OPS_SECURITY_PRIVACY_OUTBOUND_INVALID"
    Assert-OpsEqual "milk" ([string]$Scenario.outbound_request.normalized_name) "OPS_SECURITY_PRIVACY_OUTBOUND_INVALID:name"
    Assert-OpsEqual "fixture-brand" ([string]$Scenario.outbound_request.brand) "OPS_SECURITY_PRIVACY_OUTBOUND_INVALID:brand"
    Assert-OpsEqual "whole_milk" ([string]$Scenario.outbound_request.variant) "OPS_SECURITY_PRIVACY_OUTBOUND_INVALID:variant"
    Assert-OpsEqual "250ml_carton" ([string]$Scenario.outbound_request.specification) "OPS_SECURITY_PRIVACY_OUTBOUND_INVALID:specification"
    Assert-OpsEqual "ready_to_drink" ([string]$Scenario.outbound_request.preparation_state) "OPS_SECURITY_PRIVACY_OUTBOUND_INVALID:preparation"
    Assert-OpsEqual "CN" ([string]$Scenario.outbound_request.region) "OPS_SECURITY_PRIVACY_OUTBOUND_INVALID:region"
    Assert-OpsExactProperties $Scenario.forbidden_context @(
        "user_name", "raw_chat", "meal_history", "inventory_summary", "goals", "api_token"
    ) "OPS_SECURITY_PRIVACY_CONTEXT_INVALID"
    Assert-OpsEqual "fixture-user-secret" ([string]$Scenario.forbidden_context.user_name) "OPS_SECURITY_PRIVACY_CONTEXT_INVALID:user"
    Assert-OpsEqual "fixture-raw-chat-secret" ([string]$Scenario.forbidden_context.raw_chat) "OPS_SECURITY_PRIVACY_CONTEXT_INVALID:chat"
    Assert-OpsEqual "fixture-meal-history-secret" ([string]$Scenario.forbidden_context.meal_history) "OPS_SECURITY_PRIVACY_CONTEXT_INVALID:history"
    Assert-OpsEqual "fixture-inventory-secret" ([string]$Scenario.forbidden_context.inventory_summary) "OPS_SECURITY_PRIVACY_CONTEXT_INVALID:inventory"
    Assert-OpsEqual "fixture-goals-secret" ([string]$Scenario.forbidden_context.goals) "OPS_SECURITY_PRIVACY_CONTEXT_INVALID:goals"
    Assert-OpsEqual "fixture-api-token-secret" ([string]$Scenario.forbidden_context.api_token) "OPS_SECURITY_PRIVACY_CONTEXT_INVALID:token"
    Assert-OpsExactProperties $Scenario.ordinary_log @(
        "operation", "status", "source_type", "duration_ms", "error_code", "object_count",
        "raw_context_present", "secret_present"
    ) "OPS_SECURITY_PRIVACY_LOG_INVALID"
    Assert-OpsEqual "nutrition_lookup" ([string]$Scenario.ordinary_log.operation) "OPS_SECURITY_PRIVACY_LOG_INVALID:operation"
    Assert-OpsEqual "degraded" ([string]$Scenario.ordinary_log.status) "OPS_SECURITY_PRIVACY_LOG_INVALID:status"
    Assert-OpsEqual "public" ([string]$Scenario.ordinary_log.source_type) "OPS_SECURITY_PRIVACY_LOG_INVALID:source"
    Assert-OpsEqual 12 ([int]$Scenario.ordinary_log.duration_ms) "OPS_SECURITY_PRIVACY_LOG_INVALID:duration"
    Assert-OpsEqual "credential_missing" ([string]$Scenario.ordinary_log.error_code) "OPS_SECURITY_PRIVACY_LOG_INVALID:error"
    Assert-OpsEqual 1 ([int]$Scenario.ordinary_log.object_count) "OPS_SECURITY_PRIVACY_LOG_INVALID:objects"
    Assert-OpsEqual $false $Scenario.ordinary_log.raw_context_present "OPS_SECURITY_PRIVACY_LOG_INVALID:raw"
    Assert-OpsEqual $false $Scenario.ordinary_log.secret_present "OPS_SECURITY_PRIVACY_LOG_INVALID:secret"
    Assert-OpsEqual "missing" ([string]$Scenario.credential_state) "OPS_SECURITY_PRIVACY_CREDENTIAL_INVALID"
    Assert-OpsExactProperties $Scenario.fallback @("strategy", "invented_nutrition_values") "OPS_SECURITY_PRIVACY_FALLBACK_INVALID"
    Assert-OpsEqual "cache_template_unknown" ([string]$Scenario.fallback.strategy) "OPS_SECURITY_PRIVACY_FALLBACK_INVALID:strategy"
    Assert-OpsEqual $false $Scenario.fallback.invented_nutrition_values "OPS_SECURITY_PRIVACY_FALLBACK_INVALID:invented"
    Assert-OpsEqual 0 ([int]$Scenario.business_write_count) "OPS_SECURITY_PRIVACY_WRITE_INVALID"
}

function Assert-OpsFoundationScenario {
    param($Scenario)

    Assert-OpsScenarioCommon $Scenario "ops-foundation-zero-diff-v1" "foundation_zero_official_diff" @(
        "fixture_id", "scenario_type", "official_files_before", "official_files_after", "failure_stage",
        "after_scan_completed", "differences", "temporary_roots", "cleanup", "technical_log_channel",
        "business_write_count"
    ) "OPS_SECURITY_SCENARIO_INVALID:foundation"
    $before = @($Scenario.official_files_before)
    $after = @($Scenario.official_files_after)
    Assert-OpsEqual 2 $before.Count "OPS_SECURITY_FOUNDATION_MANIFEST_INVALID:before_count"
    Assert-OpsEqual 2 $after.Count "OPS_SECURITY_FOUNDATION_MANIFEST_INVALID:after_count"
    $db = @("@OFFICIAL/diet.sqlite", "eyJzY2hlbWFfdmVyc2lvbiI6MSwicmVjb3JkX2NvdW50IjoyfQo=", 38, "DA14671BE3FDB61573D783AA68B054360B49B2BF62BCAAA849E0D734F63D22A3", "2026-08-11T00:00:00Z")
    $wal = @("@OFFICIAL/diet.sqlite-wal", "d2FsLWZpeHR1cmUtdjEK", 15, "9528413EE4DB283FF0E565813A4243F216A4F5B97909ADBB7C6A9B919E7A5D55", "2026-08-11T00:00:01Z")
    Assert-OpsFileRecord $before[0] $db[0] $db[1] $db[2] $db[3] $db[4] "OPS_SECURITY_FOUNDATION_MANIFEST_INVALID:before_db"
    Assert-OpsFileRecord $before[1] $wal[0] $wal[1] $wal[2] $wal[3] $wal[4] "OPS_SECURITY_FOUNDATION_MANIFEST_INVALID:before_wal"
    Assert-OpsFileRecord $after[0] $db[0] $db[1] $db[2] $db[3] $db[4] "OPS_SECURITY_FOUNDATION_MANIFEST_INVALID:after_db"
    Assert-OpsFileRecord $after[1] $wal[0] $wal[1] $wal[2] $wal[3] $wal[4] "OPS_SECURITY_FOUNDATION_MANIFEST_INVALID:after_wal"
    Assert-OpsEqual "plugin_validation" ([string]$Scenario.failure_stage) "OPS_SECURITY_FOUNDATION_FAILURE_INVALID:stage"
    Assert-OpsEqual $true $Scenario.after_scan_completed "OPS_SECURITY_FOUNDATION_FAILURE_INVALID:after_scan"
    Assert-OpsExactProperties $Scenario.differences @("added", "modified", "deleted", "path_escape_count") "OPS_SECURITY_FOUNDATION_DIFF_INVALID"
    Assert-OpsExactStringArray @() $Scenario.differences.added "OPS_SECURITY_FOUNDATION_DIFF_INVALID:added"
    Assert-OpsExactStringArray @() $Scenario.differences.modified "OPS_SECURITY_FOUNDATION_DIFF_INVALID:modified"
    Assert-OpsExactStringArray @() $Scenario.differences.deleted "OPS_SECURITY_FOUNDATION_DIFF_INVALID:deleted"
    Assert-OpsEqual 0 ([int]$Scenario.differences.path_escape_count) "OPS_SECURITY_FOUNDATION_DIFF_INVALID:path_escape"
    Assert-OpsExactStringArray @("@VALIDATION/run-001", "@OPENCLAW/run-001") $Scenario.temporary_roots "OPS_SECURITY_FOUNDATION_ROOTS_INVALID"
    Assert-OpsExactProperties $Scenario.cleanup @("attempted", "succeeded", "residual_count") "OPS_SECURITY_FOUNDATION_CLEANUP_INVALID"
    Assert-OpsEqual $true $Scenario.cleanup.attempted "OPS_SECURITY_FOUNDATION_CLEANUP_INVALID:attempted"
    Assert-OpsEqual $true $Scenario.cleanup.succeeded "OPS_SECURITY_FOUNDATION_CLEANUP_INVALID:succeeded"
    Assert-OpsEqual 0 ([int]$Scenario.cleanup.residual_count) "OPS_SECURITY_FOUNDATION_CLEANUP_INVALID:residual"
    Assert-OpsExactProperties $Scenario.technical_log_channel @(
        "logical_path", "redacted", "counts_as_record", "raw_context_present", "secret_present"
    ) "OPS_SECURITY_FOUNDATION_LOG_INVALID"
    Assert-OpsEqual "@EVIDENCE/foundation-failure.json" ([string]$Scenario.technical_log_channel.logical_path) "OPS_SECURITY_FOUNDATION_LOG_INVALID:path"
    Assert-OpsEqual $true $Scenario.technical_log_channel.redacted "OPS_SECURITY_FOUNDATION_LOG_INVALID:redacted"
    Assert-OpsEqual $false $Scenario.technical_log_channel.counts_as_record "OPS_SECURITY_FOUNDATION_LOG_INVALID:record"
    Assert-OpsEqual $false $Scenario.technical_log_channel.raw_context_present "OPS_SECURITY_FOUNDATION_LOG_INVALID:raw"
    Assert-OpsEqual $false $Scenario.technical_log_channel.secret_present "OPS_SECURITY_FOUNDATION_LOG_INVALID:secret"
    Assert-OpsEqual 0 ([int]$Scenario.business_write_count) "OPS_SECURITY_FOUNDATION_WRITE_INVALID"
}

function Assert-OpsInstallScenario {
    param($Scenario)

    Assert-OpsScenarioCommon $Scenario "ops-clean-install-b-v1" "clean_install" @(
        "fixture_id", "scenario_type", "package_manifest", "supported_environment", "preflight", "staging",
        "initialized_schema", "isolated_smoke", "promotion", "receipt"
    ) "OPS_SECURITY_SCENARIO_INVALID:install"
    Assert-OpsExactProperties $Scenario.package_manifest @(
        "product_version", "route", "contract_version", "schema_version", "supported_environment",
        "package_files", "installer_version", "release_evidence_id"
    ) "OPS_SECURITY_INSTALL_MANIFEST_INVALID"
    Assert-OpsEqual "0.1.0" ([string]$Scenario.package_manifest.product_version) "OPS_SECURITY_INSTALL_MANIFEST_INVALID:product"
    Assert-OpsEqual "B" ([string]$Scenario.package_manifest.route) "OPS_SECURITY_INSTALL_MANIFEST_INVALID:route"
    Assert-OpsEqual 2 ([int]$Scenario.package_manifest.contract_version) "OPS_SECURITY_INSTALL_MANIFEST_INVALID:contract"
    Assert-OpsEqual 1 ([int]$Scenario.package_manifest.schema_version) "OPS_SECURITY_INSTALL_MANIFEST_INVALID:schema"
    Assert-OpsEqual "win-x64-fixture" ([string]$Scenario.package_manifest.supported_environment) "OPS_SECURITY_INSTALL_MANIFEST_INVALID:environment"
    $packageFiles = @($Scenario.package_manifest.package_files)
    Assert-OpsEqual 2 $packageFiles.Count "OPS_SECURITY_INSTALL_MANIFEST_INVALID:file_count"
    Assert-OpsFileRecord $packageFiles[0] "@PACKAGE/plugin.bundle" "cGx1Z2luLWJ1bmRsZS12MQo=" 17 "D5398DAC86B1524329C270934140657EF6DDDF7DE5653529C80810EF5F449922" "2026-08-11T01:00:00Z" "OPS_SECURITY_INSTALL_MANIFEST_INVALID:plugin"
    Assert-OpsFileRecord $packageFiles[1] "@PACKAGE/skill.bundle" "c2tpbGwtYnVuZGxlLXYxCg==" 16 "7ED6128AC045C5B01F2999B862B891F556F1A3AAD461372207D10D3187991B1D" "2026-08-11T01:00:01Z" "OPS_SECURITY_INSTALL_MANIFEST_INVALID:skill"
    Assert-OpsEqual "1.0.0" ([string]$Scenario.package_manifest.installer_version) "OPS_SECURITY_INSTALL_MANIFEST_INVALID:installer"
    Assert-OpsEqual "EV-FIXTURE-RELEASE-001" ([string]$Scenario.package_manifest.release_evidence_id) "OPS_SECURITY_INSTALL_MANIFEST_INVALID:evidence"
    Assert-OpsExactProperties $Scenario.supported_environment @("os", "architecture", "powershell", "node", "openclaw") "OPS_SECURITY_INSTALL_ENVIRONMENT_INVALID"
    Assert-OpsEqual "windows" ([string]$Scenario.supported_environment.os) "OPS_SECURITY_INSTALL_ENVIRONMENT_INVALID:os"
    Assert-OpsEqual "x64" ([string]$Scenario.supported_environment.architecture) "OPS_SECURITY_INSTALL_ENVIRONMENT_INVALID:arch"
    Assert-OpsEqual "5.1" ([string]$Scenario.supported_environment.powershell) "OPS_SECURITY_INSTALL_ENVIRONMENT_INVALID:powershell"
    Assert-OpsEqual "24.x" ([string]$Scenario.supported_environment.node) "OPS_SECURITY_INSTALL_ENVIRONMENT_INVALID:node"
    Assert-OpsEqual "fixture-supported" ([string]$Scenario.supported_environment.openclaw) "OPS_SECURITY_INSTALL_ENVIRONMENT_INVALID:openclaw"
    Assert-OpsExactProperties $Scenario.preflight @("read_only", "compatible", "created_count", "migrated_count", "incompatible_items") "OPS_SECURITY_INSTALL_PREFLIGHT_INVALID"
    Assert-OpsEqual $true $Scenario.preflight.read_only "OPS_SECURITY_INSTALL_PREFLIGHT_INVALID:read_only"
    Assert-OpsEqual $true $Scenario.preflight.compatible "OPS_SECURITY_INSTALL_PREFLIGHT_INVALID:compatible"
    Assert-OpsEqual 0 ([int]$Scenario.preflight.created_count) "OPS_SECURITY_INSTALL_PREFLIGHT_INVALID:created"
    Assert-OpsEqual 0 ([int]$Scenario.preflight.migrated_count) "OPS_SECURITY_INSTALL_PREFLIGHT_INVALID:migrated"
    Assert-OpsExactStringArray @() $Scenario.preflight.incompatible_items "OPS_SECURITY_INSTALL_PREFLIGHT_INVALID:items"
    Assert-OpsExactProperties $Scenario.staging @("logical_root", "package_verified", "partial_final_file_count") "OPS_SECURITY_INSTALL_STAGING_INVALID"
    Assert-OpsEqual "@BUILD/install-staging-001" ([string]$Scenario.staging.logical_root) "OPS_SECURITY_INSTALL_STAGING_INVALID:root"
    Assert-OpsEqual $true $Scenario.staging.package_verified "OPS_SECURITY_INSTALL_STAGING_INVALID:verified"
    Assert-OpsEqual 0 ([int]$Scenario.staging.partial_final_file_count) "OPS_SECURITY_INSTALL_STAGING_INVALID:partial"
    Assert-OpsExactProperties $Scenario.initialized_schema @("storage", "schema_version", "business_record_count", "formal_jsonl_count") "OPS_SECURITY_INSTALL_SCHEMA_INVALID"
    Assert-OpsEqual "sqlite" ([string]$Scenario.initialized_schema.storage) "OPS_SECURITY_INSTALL_SCHEMA_INVALID:storage"
    Assert-OpsEqual 1 ([int]$Scenario.initialized_schema.schema_version) "OPS_SECURITY_INSTALL_SCHEMA_INVALID:version"
    Assert-OpsEqual 0 ([int]$Scenario.initialized_schema.business_record_count) "OPS_SECURITY_INSTALL_SCHEMA_INVALID:records"
    Assert-OpsEqual 0 ([int]$Scenario.initialized_schema.formal_jsonl_count) "OPS_SECURITY_INSTALL_SCHEMA_INVALID:jsonl"
    Assert-OpsExactProperties $Scenario.isolated_smoke @("logical_root", "operations", "official_write_count", "cleanup_succeeded", "residual_count") "OPS_SECURITY_INSTALL_SMOKE_INVALID"
    Assert-OpsEqual "@ISOLATED/smoke-001" ([string]$Scenario.isolated_smoke.logical_root) "OPS_SECURITY_INSTALL_SMOKE_INVALID:root"
    Assert-OpsExactStringArray @("load", "empty_query", "synthetic_meal", "synthetic_inventory", "idempotency_retry") $Scenario.isolated_smoke.operations "OPS_SECURITY_INSTALL_SMOKE_INVALID:operations"
    Assert-OpsEqual 0 ([int]$Scenario.isolated_smoke.official_write_count) "OPS_SECURITY_INSTALL_SMOKE_INVALID:writes"
    Assert-OpsEqual $true $Scenario.isolated_smoke.cleanup_succeeded "OPS_SECURITY_INSTALL_SMOKE_INVALID:cleanup"
    Assert-OpsEqual 0 ([int]$Scenario.isolated_smoke.residual_count) "OPS_SECURITY_INSTALL_SMOKE_INVALID:residual"
    Assert-OpsExactProperties $Scenario.promotion @("method", "activated", "rebuild_after_verification") "OPS_SECURITY_INSTALL_PROMOTION_INVALID"
    Assert-OpsEqual "atomic_switch" ([string]$Scenario.promotion.method) "OPS_SECURITY_INSTALL_PROMOTION_INVALID:method"
    Assert-OpsEqual $true $Scenario.promotion.activated "OPS_SECURITY_INSTALL_PROMOTION_INVALID:activated"
    Assert-OpsEqual $false $Scenario.promotion.rebuild_after_verification "OPS_SECURITY_INSTALL_PROMOTION_INVALID:rebuild"
    Assert-OpsExactProperties $Scenario.receipt @("product_version", "route", "business_record_count", "official_data_impact_count", "foundation_presented_as_product") "OPS_SECURITY_INSTALL_RECEIPT_INVALID"
    Assert-OpsEqual "0.1.0" ([string]$Scenario.receipt.product_version) "OPS_SECURITY_INSTALL_RECEIPT_INVALID:product"
    Assert-OpsEqual "B" ([string]$Scenario.receipt.route) "OPS_SECURITY_INSTALL_RECEIPT_INVALID:route"
    Assert-OpsEqual 0 ([int]$Scenario.receipt.business_record_count) "OPS_SECURITY_INSTALL_RECEIPT_INVALID:records"
    Assert-OpsEqual 0 ([int]$Scenario.receipt.official_data_impact_count) "OPS_SECURITY_INSTALL_RECEIPT_INVALID:impact"
    Assert-OpsEqual $false $Scenario.receipt.foundation_presented_as_product "OPS_SECURITY_INSTALL_RECEIPT_INVALID:foundation"
}

function Assert-OpsMigrationScenario {
    param($Scenario)

    Assert-OpsScenarioCommon $Scenario "ops-migration-interrupted-v1" "migration_interrupted" @(
        "fixture_id", "scenario_type", "source_state", "verified_backup", "rehearsal", "failure",
        "target_state", "old_state_after_failure", "retry_policy"
    ) "OPS_SECURITY_SCENARIO_INVALID:migration"
    Assert-OpsExactProperties $Scenario.source_state @("product_version", "schema_version", "record_count", "readable", "data_file") "OPS_SECURITY_MIGRATION_SOURCE_INVALID"
    Assert-OpsEqual "0.1.0" ([string]$Scenario.source_state.product_version) "OPS_SECURITY_MIGRATION_SOURCE_INVALID:product"
    Assert-OpsEqual 1 ([int]$Scenario.source_state.schema_version) "OPS_SECURITY_MIGRATION_SOURCE_INVALID:schema"
    Assert-OpsEqual 2 ([int]$Scenario.source_state.record_count) "OPS_SECURITY_MIGRATION_SOURCE_INVALID:records"
    Assert-OpsEqual $true $Scenario.source_state.readable "OPS_SECURITY_MIGRATION_SOURCE_INVALID:readable"
    Assert-OpsFileRecord $Scenario.source_state.data_file "@OFFICIAL/diet.sqlite" "c3FsaXRlLWZpeHR1cmUtc2NoZW1hLTEtcmVjb3Jkcy0yCg==" 34 "08702B13E91E51044B189EC5874E30549D5EBF5481E1E301D927A5F2AEA6B95F" "2026-08-11T02:00:00Z" "OPS_SECURITY_MIGRATION_SOURCE_INVALID:file"
    Assert-OpsExactProperties $Scenario.verified_backup @("backup_id", "verified", "restore_tested", "data_file") "OPS_SECURITY_MIGRATION_BACKUP_INVALID"
    Assert-OpsEqual "backup-fixture-001" ([string]$Scenario.verified_backup.backup_id) "OPS_SECURITY_MIGRATION_BACKUP_INVALID:id"
    Assert-OpsEqual $true $Scenario.verified_backup.verified "OPS_SECURITY_MIGRATION_BACKUP_INVALID:verified"
    Assert-OpsEqual $true $Scenario.verified_backup.restore_tested "OPS_SECURITY_MIGRATION_BACKUP_INVALID:restore"
    Assert-OpsFileRecord $Scenario.verified_backup.data_file "@BACKUP/backup-fixture-001/diet.sqlite" "c3FsaXRlLWZpeHR1cmUtc2NoZW1hLTEtcmVjb3Jkcy0yCg==" 34 "08702B13E91E51044B189EC5874E30549D5EBF5481E1E301D927A5F2AEA6B95F" "2026-08-11T02:00:00Z" "OPS_SECURITY_MIGRATION_BACKUP_INVALID:file"
    Assert-OpsExactProperties $Scenario.rehearsal @("completed", "integrity_valid", "record_count") "OPS_SECURITY_MIGRATION_REHEARSAL_INVALID"
    Assert-OpsEqual $true $Scenario.rehearsal.completed "OPS_SECURITY_MIGRATION_REHEARSAL_INVALID:completed"
    Assert-OpsEqual $true $Scenario.rehearsal.integrity_valid "OPS_SECURITY_MIGRATION_REHEARSAL_INVALID:integrity"
    Assert-OpsEqual 2 ([int]$Scenario.rehearsal.record_count) "OPS_SECURITY_MIGRATION_REHEARSAL_INVALID:records"
    Assert-OpsExactProperties $Scenario.failure @("injection_point", "error_code", "candidate_activated", "success_receipt_visible") "OPS_SECURITY_MIGRATION_FAILURE_INVALID"
    Assert-OpsEqual "formal_migration_after_begin" ([string]$Scenario.failure.injection_point) "OPS_SECURITY_MIGRATION_FAILURE_INVALID:point"
    Assert-OpsEqual "migration_interrupted" ([string]$Scenario.failure.error_code) "OPS_SECURITY_MIGRATION_FAILURE_INVALID:error"
    Assert-OpsEqual $false $Scenario.failure.candidate_activated "OPS_SECURITY_MIGRATION_FAILURE_INVALID:activated"
    Assert-OpsEqual $false $Scenario.failure.success_receipt_visible "OPS_SECURITY_MIGRATION_FAILURE_INVALID:receipt"
    Assert-OpsExactProperties $Scenario.target_state @("visible", "partial_file_count", "schema_version_active", "product_version_active") "OPS_SECURITY_MIGRATION_TARGET_INVALID"
    Assert-OpsEqual $false $Scenario.target_state.visible "OPS_SECURITY_MIGRATION_TARGET_INVALID:visible"
    Assert-OpsEqual 0 ([int]$Scenario.target_state.partial_file_count) "OPS_SECURITY_MIGRATION_TARGET_INVALID:partial"
    Assert-OpsEqual $false $Scenario.target_state.schema_version_active "OPS_SECURITY_MIGRATION_TARGET_INVALID:schema"
    Assert-OpsEqual $false $Scenario.target_state.product_version_active "OPS_SECURITY_MIGRATION_TARGET_INVALID:product"
    Assert-OpsExactProperties $Scenario.old_state_after_failure @("product_version", "schema_version", "record_count", "readable", "data_file") "OPS_SECURITY_MIGRATION_OLD_STATE_INVALID"
    Assert-OpsEqual "0.1.0" ([string]$Scenario.old_state_after_failure.product_version) "OPS_SECURITY_MIGRATION_OLD_STATE_INVALID:product"
    Assert-OpsEqual 1 ([int]$Scenario.old_state_after_failure.schema_version) "OPS_SECURITY_MIGRATION_OLD_STATE_INVALID:schema"
    Assert-OpsEqual 2 ([int]$Scenario.old_state_after_failure.record_count) "OPS_SECURITY_MIGRATION_OLD_STATE_INVALID:records"
    Assert-OpsEqual $true $Scenario.old_state_after_failure.readable "OPS_SECURITY_MIGRATION_OLD_STATE_INVALID:readable"
    Assert-OpsFileRecord $Scenario.old_state_after_failure.data_file "@OFFICIAL/diet.sqlite" "c3FsaXRlLWZpeHR1cmUtc2NoZW1hLTEtcmVjb3Jkcy0yCg==" 34 "08702B13E91E51044B189EC5874E30549D5EBF5481E1E301D927A5F2AEA6B95F" "2026-08-11T02:00:00Z" "OPS_SECURITY_MIGRATION_OLD_STATE_INVALID:file"
    Assert-OpsExactProperties $Scenario.retry_policy @("fresh_attempt_required", "resume_partial_allowed") "OPS_SECURITY_MIGRATION_RETRY_INVALID"
    Assert-OpsEqual $true $Scenario.retry_policy.fresh_attempt_required "OPS_SECURITY_MIGRATION_RETRY_INVALID:fresh"
    Assert-OpsEqual $false $Scenario.retry_policy.resume_partial_allowed "OPS_SECURITY_MIGRATION_RETRY_INVALID:resume"
}

function Assert-OpsCandidateScenario {
    param($Scenario)

    Assert-OpsScenarioCommon $Scenario "ops-candidate-byte-drift-v1" "candidate_byte_drift" @(
        "fixture_id", "scenario_type", "frozen_candidate", "changed_file", "invalidation", "evidence_state", "promotion"
    ) "OPS_SECURITY_SCENARIO_INVALID:candidate"
    Assert-OpsExactProperties $Scenario.frozen_candidate @("candidate_id", "status", "files", "gates_status", "evidence_id") "OPS_SECURITY_CANDIDATE_FROZEN_INVALID"
    Assert-OpsEqual "candidate-fixture-001" ([string]$Scenario.frozen_candidate.candidate_id) "OPS_SECURITY_CANDIDATE_FROZEN_INVALID:id"
    Assert-OpsEqual "frozen" ([string]$Scenario.frozen_candidate.status) "OPS_SECURITY_CANDIDATE_FROZEN_INVALID:status"
    $files = @($Scenario.frozen_candidate.files)
    Assert-OpsEqual 1 $files.Count "OPS_SECURITY_CANDIDATE_FROZEN_INVALID:files"
    Assert-OpsFileRecord $files[0] "@CANDIDATE/plugin.bundle" "cGx1Z2luLWNhbmRpZGF0ZS12MQo=" 20 "A1F76240BECC09AA5DA27649576AD7826FBA9CCB013C3F862C5E30E78447B5B6" "2026-08-11T03:00:00Z" "OPS_SECURITY_CANDIDATE_FROZEN_INVALID:file"
    Assert-OpsEqual "passed" ([string]$Scenario.frozen_candidate.gates_status) "OPS_SECURITY_CANDIDATE_FROZEN_INVALID:gates"
    Assert-OpsEqual "EV-FIXTURE-G3-001" ([string]$Scenario.frozen_candidate.evidence_id) "OPS_SECURITY_CANDIDATE_FROZEN_INVALID:evidence"
    Assert-OpsFileRecord $Scenario.changed_file "@CANDIDATE/plugin.bundle" "cGx1Z2luLWNhbmRpZGF0ZS12MS1ob3RmaXgK" 27 "1502B0E6A925440961349C5A7FED919B96B8D64FD4B56EBB179BBB076EAA90EC" "2026-08-11T03:01:00Z" "OPS_SECURITY_CANDIDATE_CHANGED_INVALID"
    Assert-OpsTrue (([string]$files[0].sha256) -cne ([string]$Scenario.changed_file.sha256)) "OPS_SECURITY_CANDIDATE_DRIFT_MISSING"
    Assert-OpsExactProperties $Scenario.invalidation @("candidate_status", "reason", "new_manifest_required", "affected_gates_rerun") "OPS_SECURITY_CANDIDATE_INVALIDATION_INVALID"
    Assert-OpsEqual "invalidated" ([string]$Scenario.invalidation.candidate_status) "OPS_SECURITY_CANDIDATE_INVALIDATION_INVALID:status"
    Assert-OpsEqual "byte_changed_after_freeze" ([string]$Scenario.invalidation.reason) "OPS_SECURITY_CANDIDATE_INVALIDATION_INVALID:reason"
    Assert-OpsEqual $true $Scenario.invalidation.new_manifest_required "OPS_SECURITY_CANDIDATE_INVALIDATION_INVALID:manifest"
    Assert-OpsEqual $true $Scenario.invalidation.affected_gates_rerun "OPS_SECURITY_CANDIDATE_INVALIDATION_INVALID:gates"
    Assert-OpsExactProperties $Scenario.evidence_state @("previous_evidence_authorizes_promotion") "OPS_SECURITY_CANDIDATE_EVIDENCE_INVALID"
    Assert-OpsEqual $false $Scenario.evidence_state.previous_evidence_authorizes_promotion "OPS_SECURITY_CANDIDATE_EVIDENCE_INVALID:authorization"
    Assert-OpsExactProperties $Scenario.promotion @("allowed", "method", "rebuild_allowed", "patch_allowed", "substitution_allowed") "OPS_SECURITY_CANDIDATE_PROMOTION_INVALID"
    Assert-OpsEqual $false $Scenario.promotion.allowed "OPS_SECURITY_CANDIDATE_PROMOTION_INVALID:allowed"
    Assert-OpsEqual "none" ([string]$Scenario.promotion.method) "OPS_SECURITY_CANDIDATE_PROMOTION_INVALID:method"
    Assert-OpsEqual $false $Scenario.promotion.rebuild_allowed "OPS_SECURITY_CANDIDATE_PROMOTION_INVALID:rebuild"
    Assert-OpsEqual $false $Scenario.promotion.patch_allowed "OPS_SECURITY_CANDIDATE_PROMOTION_INVALID:patch"
    Assert-OpsEqual $false $Scenario.promotion.substitution_allowed "OPS_SECURITY_CANDIDATE_PROMOTION_INVALID:substitution"
}

function Assert-OpsExportScenario {
    param($Scenario)

    Assert-OpsScenarioCommon $Scenario "ops-minimal-export-restore-reject-v1" "minimal_export_restore_rejected" @(
        "fixture_id", "scenario_type", "export_manifest", "missing_backup_capabilities", "restore_attempt",
        "official_state_before", "official_state_after"
    ) "OPS_SECURITY_SCENARIO_INVALID:export"
    Assert-OpsExactProperties $Scenario.export_manifest @("artifact_type", "export_version", "timezone", "record_count", "file", "restorable") "OPS_SECURITY_EXPORT_MANIFEST_INVALID"
    Assert-OpsEqual "minimal_user_export" ([string]$Scenario.export_manifest.artifact_type) "OPS_SECURITY_EXPORT_MANIFEST_INVALID:type"
    Assert-OpsEqual 1 ([int]$Scenario.export_manifest.export_version) "OPS_SECURITY_EXPORT_MANIFEST_INVALID:version"
    Assert-OpsEqual "Asia/Shanghai" ([string]$Scenario.export_manifest.timezone) "OPS_SECURITY_EXPORT_MANIFEST_INVALID:timezone"
    Assert-OpsEqual 0 ([int]$Scenario.export_manifest.record_count) "OPS_SECURITY_EXPORT_MANIFEST_INVALID:records"
    Assert-OpsFileRecord $Scenario.export_manifest.file "@EXPORT/minimal-user-export.json" "eyJleHBvcnRfdmVyc2lvbiI6MSwicmVjb3JkcyI6W119Cg==" 34 "775BEA8868EAC71F342C28CDE982C817401616E58EBCE387DFA80CD136400462" "2026-08-11T04:00:00Z" "OPS_SECURITY_EXPORT_MANIFEST_INVALID:file"
    Assert-OpsEqual $false $Scenario.export_manifest.restorable "OPS_SECURITY_EXPORT_MANIFEST_INVALID:restorable"
    Assert-OpsExactStringArray @("backup_manifest", "complete_schema", "idempotency_state", "integrity_check") $Scenario.missing_backup_capabilities "OPS_SECURITY_EXPORT_CAPABILITIES_INVALID"
    Assert-OpsExactProperties $Scenario.restore_attempt @(
        "status", "error_code", "replacement_count", "deletion_count", "migration_count", "version_changed"
    ) "OPS_SECURITY_EXPORT_RESTORE_INVALID"
    Assert-OpsEqual "rejected" ([string]$Scenario.restore_attempt.status) "OPS_SECURITY_EXPORT_RESTORE_INVALID:status"
    Assert-OpsEqual "not_restorable_backup" ([string]$Scenario.restore_attempt.error_code) "OPS_SECURITY_EXPORT_RESTORE_INVALID:error"
    Assert-OpsEqual 0 ([int]$Scenario.restore_attempt.replacement_count) "OPS_SECURITY_EXPORT_RESTORE_INVALID:replacement"
    Assert-OpsEqual 0 ([int]$Scenario.restore_attempt.deletion_count) "OPS_SECURITY_EXPORT_RESTORE_INVALID:deletion"
    Assert-OpsEqual 0 ([int]$Scenario.restore_attempt.migration_count) "OPS_SECURITY_EXPORT_RESTORE_INVALID:migration"
    Assert-OpsEqual $false $Scenario.restore_attempt.version_changed "OPS_SECURITY_EXPORT_RESTORE_INVALID:version"
    foreach ($stateName in @("official_state_before", "official_state_after")) {
        $state = $Scenario.$stateName
        Assert-OpsExactProperties $state @("product_version", "schema_version", "record_count", "data_file") ("OPS_SECURITY_EXPORT_OFFICIAL_STATE_INVALID:{0}" -f $stateName)
        Assert-OpsEqual "0.1.0" ([string]$state.product_version) ("OPS_SECURITY_EXPORT_OFFICIAL_STATE_INVALID:{0}:product" -f $stateName)
        Assert-OpsEqual 1 ([int]$state.schema_version) ("OPS_SECURITY_EXPORT_OFFICIAL_STATE_INVALID:{0}:schema" -f $stateName)
        Assert-OpsEqual 2 ([int]$state.record_count) ("OPS_SECURITY_EXPORT_OFFICIAL_STATE_INVALID:{0}:records" -f $stateName)
        Assert-OpsFileRecord $state.data_file "@OFFICIAL/diet.sqlite" "eyJzY2hlbWFfdmVyc2lvbiI6MSwicmVjb3JkX2NvdW50IjoyfQo=" 38 "DA14671BE3FDB61573D783AA68B054360B49B2BF62BCAAA849E0D734F63D22A3" "2026-08-11T00:00:00Z" ("OPS_SECURITY_EXPORT_OFFICIAL_STATE_INVALID:{0}:file" -f $stateName)
    }
}

function Assert-OpsScenarioFixtures {
    param($Fixtures)

    Assert-OpsPrivacyScenario (Get-OpsScenarioById $Fixtures "ops-privacy-public-nutrition-v1")
    Assert-OpsFoundationScenario (Get-OpsScenarioById $Fixtures "ops-foundation-zero-diff-v1")
    Assert-OpsInstallScenario (Get-OpsScenarioById $Fixtures "ops-clean-install-b-v1")
    Assert-OpsMigrationScenario (Get-OpsScenarioById $Fixtures "ops-migration-interrupted-v1")
    Assert-OpsCandidateScenario (Get-OpsScenarioById $Fixtures "ops-candidate-byte-drift-v1")
    Assert-OpsExportScenario (Get-OpsScenarioById $Fixtures "ops-minimal-export-restore-reject-v1")
}

function Test-OpsSecurityCasesCandidate {
    param($CaseSet)

    Assert-OpsExactProperties $CaseSet @(
        "case_set_id", "version", "contract", "fixture_catalog", "package_invariants", "cases"
    ) "OPS_SECURITY_CASE_SET_SHAPE_INVALID:root"
    Assert-OpsEqual "diet-manager/core-acceptance-cases-v1" ([string]$CaseSet.case_set_id) "OPS_SECURITY_CASE_SET_ID_INVALID"
    Assert-OpsEqual "1.2.0" ([string]$CaseSet.version) "OPS_SECURITY_CASE_SET_VERSION_INVALID"
    Assert-OpsExactProperties $CaseSet.contract @("contract_id", "contract_version") "OPS_SECURITY_CONTRACT_SHAPE_INVALID"
    Assert-OpsEqual "diet-manager/contract-v2" ([string]$CaseSet.contract.contract_id) "OPS_SECURITY_CONTRACT_ID_INVALID"
    Assert-OpsEqual 2 ([int]$CaseSet.contract.contract_version) "OPS_SECURITY_CONTRACT_VERSION_INVALID"
    Assert-OpsEqual "shared/acceptance-cases/fixtures/core-v1.json" ([string]$CaseSet.fixture_catalog) "OPS_SECURITY_FIXTURE_PATH_INVALID"
    Assert-OpsExactProperties $CaseSet.package_invariants @(
        "adapters_may_rewrite_oracle",
        "technical_log",
        "technical_log_counts_as_record",
        "fact_commit_failure_business_write_count",
        "fact_commit_failure_forbidden_artifacts"
    ) "OPS_SECURITY_PACKAGE_INVARIANTS_INVALID"
    Assert-OpsEqual $false $CaseSet.package_invariants.adapters_may_rewrite_oracle "OPS_SECURITY_ORACLE_AUTHORITY_INVALID"
    Assert-OpsEqual "allowed_separate_redacted_only" ([string]$CaseSet.package_invariants.technical_log) "OPS_SECURITY_TECHNICAL_LOG_INVALID"
    Assert-OpsEqual $false $CaseSet.package_invariants.technical_log_counts_as_record "OPS_SECURITY_TECHNICAL_LOG_RECORD_INVALID"
    Assert-OpsEqual 0 $CaseSet.package_invariants.fact_commit_failure_business_write_count "OPS_SECURITY_FAILED_FACT_WRITE_INVALID"
    Assert-OpsExactStringArray @(
        "meal_or_water_fact", "inventory_change", "nutrition_snapshot", "issue", "business_outbox",
        "daily_progress", "success_receipt", "terminal_idempotency_result"
    ) $CaseSet.package_invariants.fact_commit_failure_forbidden_artifacts "OPS_SECURITY_FAILED_FACT_ARTIFACTS_INVALID"

    Assert-OpsTrue ($CaseSet.cases -is [System.Array]) "OPS_SECURITY_CASE_SET_SHAPE_INVALID:cases"
    $caseIds = @($CaseSet.cases | ForEach-Object { [string]$_.id })
    Assert-OpsExactStringArray $ExpectedCumulativeCaseIds $caseIds "OPS_SECURITY_CASE_IDS_INVALID"
    Assert-OpsEqual $caseIds.Count @($caseIds | Select-Object -Unique).Count "OPS_SECURITY_CASE_IDS_DUPLICATE"
    foreach ($id in $ExpectedOpsCaseIds) {
        [void](Get-OpsCaseById $CaseSet $id)
    }
}

function Test-OpsSecurityFixtureCandidate {
    param($Fixtures)

    Assert-OpsExactProperties $Fixtures @(
        "fixture_catalog_id", "version", "environments", "goals", "query_views",
        "domain_scenarios", "ops_security_scenarios"
    ) "OPS_SECURITY_FIXTURE_SHAPE_INVALID:root"
    Assert-OpsEqual "diet-manager/core-fixtures-v1" ([string]$Fixtures.fixture_catalog_id) "OPS_SECURITY_FIXTURE_ID_INVALID"
    Assert-OpsEqual "1.2.0" ([string]$Fixtures.version) "OPS_SECURITY_FIXTURE_VERSION_INVALID"
    Assert-OpsTrue ($Fixtures.ops_security_scenarios -is [System.Array]) "OPS_SECURITY_SCENARIOS_SHAPE_INVALID"
    $scenarioIds = @($Fixtures.ops_security_scenarios | ForEach-Object { [string]$_.fixture_id })
    Assert-OpsExactStringArray $ExpectedOpsScenarioIds $scenarioIds "OPS_SECURITY_SCENARIO_IDS_INVALID"
    Assert-OpsEqual $scenarioIds.Count @($scenarioIds | Select-Object -Unique).Count "OPS_SECURITY_SCENARIO_IDS_DUPLICATE"
    foreach ($id in $ExpectedOpsScenarioIds) {
        [void](Get-OpsScenarioById $Fixtures $id)
    }
    Assert-OpsScenarioFixtures $Fixtures
}

function Test-OpsSecurityCandidate {
    param($CaseSet, $Fixtures)

    Test-OpsSecurityCasesCandidate $CaseSet
    Test-OpsSecurityFixtureCandidate $Fixtures
    for ($index = 0; $index -lt $ExpectedOpsCaseIds.Count; $index++) {
        $case = Get-OpsCaseById $CaseSet $ExpectedOpsCaseIds[$index]
        Assert-OpsTrue ($null -ne $case.setup) ("OPS_SECURITY_CASE_SETUP_INVALID:{0}" -f $ExpectedOpsCaseIds[$index])
        Assert-OpsEqual $ExpectedOpsScenarioIds[$index] ([string]$case.setup.ops_security_fixture) ("OPS_SECURITY_CASE_FIXTURE_REF_INVALID:{0}" -f $ExpectedOpsCaseIds[$index])
    }
}

function Invoke-OpsMutation {
    param([string]$Name, [scriptblock]$Mutator, [string]$ExpectedPrefix, $CaseSet, $Fixtures)

    $caseCandidate = Copy-OpsJson $CaseSet
    $fixtureCandidate = Copy-OpsJson $Fixtures
    & $Mutator $caseCandidate $fixtureCandidate
    $rejected = $false
    try {
        Test-OpsSecurityCandidate $caseCandidate $fixtureCandidate
    }
    catch {
        $message = [string]$_.Exception.Message
        if (-not $message.StartsWith($ExpectedPrefix, [StringComparison]::Ordinal)) {
            throw ("OPS_SECURITY_MUTATION_WRONG_ERROR:{0}:expected={1}:actual={2}" -f $Name, $ExpectedPrefix, $message)
        }
        $rejected = $true
    }
    Assert-OpsTrue $rejected ("OPS_SECURITY_MUTATION_SURVIVED:{0}" -f $Name)
    "{0}|PASS" -f $Name
}

if (-not $LibraryOnly) {
    $caseSet = Read-OpsJson $CasesPath "OPS_SECURITY_CASE_SET_FILE_MISSING" "OPS_SECURITY_CASE_SET_JSON_INVALID"
    $fixtures = Read-OpsJson $FixturesPath "OPS_SECURITY_FIXTURE_FILE_MISSING" "OPS_SECURITY_FIXTURE_JSON_INVALID"
    Test-OpsSecurityCandidate $caseSet $fixtures
    $mutationCount = 0
    if (-not $SkipMutations) {
        $mutationCount = 0
    }
    "OPS_SECURITY_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=6|scenarios=6|mutations={0}" -f $mutationCount
}
