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
    "CASE-EXPORT-004",
    "CASE-RECEIPT-002",
    "CASE-RECEIPT-004",
    "CASE-RECEIPT-005",
    "CASE-RECEIPT-006",
    "CASE-PROGRESS-006",
    "CASE-STORAGE-006"
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

function Assert-OpsSourceText {
    param($Case, [string]$ExpectedBase64, [string]$Code)

    Assert-OpsTrue ($Case.source_text -is [string]) ("{0}:type" -f $Code)
    $actual = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$Case.source_text))
    Assert-OpsEqual $ExpectedBase64 $actual $Code
}

function Assert-OpsCaseCommon {
    param(
        $Case,
        [string]$ExpectedId,
        [string[]]$ExpectedRequirements,
        [string]$ExpectedSourceBase64,
        [string]$ExpectedFixture,
        [string[]]$ExpectedOracleProperties,
        [string[]]$ExpectedForbidden
    )

    Assert-OpsExactProperties $Case @("id", "requirement_ids", "stage", "source_text", "setup", "oracle", "forbidden") ("OPS_SECURITY_CASE_SHAPE_INVALID:{0}" -f $ExpectedId)
    Assert-OpsEqual $ExpectedId ([string]$Case.id) ("OPS_SECURITY_CASE_VALUE_INVALID:{0}:id" -f $ExpectedId)
    Assert-OpsExactStringArray $ExpectedRequirements $Case.requirement_ids ("OPS_SECURITY_CASE_VALUE_INVALID:{0}:requirements" -f $ExpectedId)
    Assert-OpsEqual "PRODUCT-0.1" ([string]$Case.stage) ("OPS_SECURITY_CASE_VALUE_INVALID:{0}:stage" -f $ExpectedId)
    Assert-OpsSourceText $Case $ExpectedSourceBase64 ("OPS_SECURITY_CASE_VALUE_INVALID:{0}:source" -f $ExpectedId)
    Assert-OpsExactProperties $Case.setup @(
        "environment_fixture", "goals_fixture", "query_view_fixture", "ops_security_fixture", "prior_context"
    ) ("OPS_SECURITY_CASE_SETUP_INVALID:{0}" -f $ExpectedId)
    Assert-OpsEqual "env-zh-cn-20260811" ([string]$Case.setup.environment_fixture) ("OPS_SECURITY_CASE_SETUP_INVALID:{0}:environment" -f $ExpectedId)
    Assert-OpsTrue ($null -eq $Case.setup.goals_fixture) ("OPS_SECURITY_CASE_SETUP_INVALID:{0}:goals" -f $ExpectedId)
    Assert-OpsTrue ($null -eq $Case.setup.query_view_fixture) ("OPS_SECURITY_CASE_SETUP_INVALID:{0}:query" -f $ExpectedId)
    Assert-OpsEqual $ExpectedFixture ([string]$Case.setup.ops_security_fixture) ("OPS_SECURITY_CASE_SETUP_INVALID:{0}:fixture" -f $ExpectedId)
    Assert-OpsTrue ($Case.setup.prior_context -is [System.Array]) ("OPS_SECURITY_CASE_SETUP_INVALID:{0}:prior_context_array" -f $ExpectedId)
    Assert-OpsEqual 0 @($Case.setup.prior_context).Count ("OPS_SECURITY_CASE_SETUP_INVALID:{0}:prior_context_count" -f $ExpectedId)
    Assert-OpsExactProperties $Case.oracle $ExpectedOracleProperties ("OPS_SECURITY_CASE_ORACLE_INVALID:{0}" -f $ExpectedId)
    Assert-OpsExactStringArray $ExpectedForbidden $Case.forbidden ("OPS_SECURITY_CASE_FORBIDDEN_INVALID:{0}" -f $ExpectedId)
}

function Assert-OpsPrivacyCase {
    param($Case)

    Assert-OpsCaseCommon $Case "CASE-PRIV-001" @("REQ-PRIV-001") "5p+l6K+i6L+Z5Liq54mb5aW255qE5YWs5YWx6JCl5YW75L+h5oGv44CC" "ops-privacy-public-nutrition-v1" @("privacy", "fallback") @(
        "user_identity_disclosed", "raw_chat_disclosed", "history_disclosed", "inventory_disclosed",
        "goals_disclosed", "secret_disclosed", "business_write", "unknown_nutrition_filled_with_zero"
    )
    Assert-OpsExactProperties $Case.oracle.privacy @(
        "allowed_external_fields", "forbidden_external_fields", "ordinary_log_redacted", "secret_isolated", "business_write_count"
    ) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:privacy"
    Assert-OpsExactStringArray @(
        "normalized_name", "brand", "variant", "specification", "preparation_state", "region"
    ) $Case.oracle.privacy.allowed_external_fields "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:allowlist"
    Assert-OpsExactStringArray @(
        "user_name", "raw_chat", "meal_history", "inventory_summary", "goals", "api_token"
    ) $Case.oracle.privacy.forbidden_external_fields "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:forbidden_fields"
    Assert-OpsEqual $true $Case.oracle.privacy.ordinary_log_redacted "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:log"
    Assert-OpsEqual $true $Case.oracle.privacy.secret_isolated "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:secret"
    Assert-OpsEqual 0 ([int]$Case.oracle.privacy.business_write_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:writes"
    Assert-OpsExactProperties $Case.oracle.fallback @("credential_missing_strategy", "invented_nutrition_values") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:fallback"
    Assert-OpsEqual "cache_template_unknown" ([string]$Case.oracle.fallback.credential_missing_strategy) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:fallback_strategy"
    Assert-OpsEqual $false $Case.oracle.fallback.invented_nutrition_values "OPS_SECURITY_CASE_VALUE_INVALID:CASE-PRIV-001:invented"
}

function Assert-OpsFoundationCase {
    param($Case)

    Assert-OpsCaseCommon $Case "CASE-FOUNDATION-002" @("REQ-SAFE-004") "6L+Q6KGMZm91bmRhdGlvbumqjOivgeW5tuavlOi+g+WJjeWQjuato+W8j+S4muWKoeaVsOaNruOAgg==" "ops-foundation-zero-diff-v1" @("official_manifest", "validation_failure", "cleanup") @(
        "official_file_added", "official_file_modified", "official_file_deleted", "sidecar_omitted",
        "after_scan_skipped_on_failure", "path_escape", "temporary_residual", "technical_log_counted_as_record"
    )
    Assert-OpsExactProperties $Case.oracle.official_manifest @(
        "after_scan_on_failure", "added_count", "modified_count", "deleted_count", "sidecar_count", "path_escape_count"
    ) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:manifest"
    Assert-OpsEqual $true $Case.oracle.official_manifest.after_scan_on_failure "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:after_scan"
    Assert-OpsEqual 0 ([int]$Case.oracle.official_manifest.added_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:added"
    Assert-OpsEqual 0 ([int]$Case.oracle.official_manifest.modified_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:modified"
    Assert-OpsEqual 0 ([int]$Case.oracle.official_manifest.deleted_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:deleted"
    Assert-OpsEqual 1 ([int]$Case.oracle.official_manifest.sidecar_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:sidecar"
    Assert-OpsEqual 0 ([int]$Case.oracle.official_manifest.path_escape_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:path_escape"
    Assert-OpsExactProperties $Case.oracle.validation_failure @("failure_stage", "technical_log_allowed", "technical_log_counts_as_record") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:failure"
    Assert-OpsEqual "plugin_validation" ([string]$Case.oracle.validation_failure.failure_stage) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:failure_stage"
    Assert-OpsEqual $true $Case.oracle.validation_failure.technical_log_allowed "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:log_allowed"
    Assert-OpsEqual $false $Case.oracle.validation_failure.technical_log_counts_as_record "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:log_record"
    Assert-OpsExactProperties $Case.oracle.cleanup @("attempted", "succeeded", "residual_count") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:cleanup"
    Assert-OpsEqual $true $Case.oracle.cleanup.attempted "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:cleanup_attempted"
    Assert-OpsEqual $true $Case.oracle.cleanup.succeeded "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:cleanup_succeeded"
    Assert-OpsEqual 0 ([int]$Case.oracle.cleanup.residual_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-FOUNDATION-002:cleanup_residual"
}

function Assert-OpsInstallCase {
    param($Case)

    Assert-OpsCaseCommon $Case "CASE-OPS-001" @("REQ-OPS-001", "REQ-SAFE-004") "5a6J6KOFUFJPRFVDVC0wLjHjgII=" "ops-clean-install-b-v1" @("preflight", "package_verification", "installation", "isolated_smoke", "receipt") @(
        "preflight_write", "package_hash_mismatch_accepted", "partial_installation_promoted", "formal_jsonl_created",
        "sample_business_record_created", "smoke_wrote_official_data", "smoke_residual", "foundation_claimed_as_product"
    )
    Assert-OpsExactProperties $Case.oracle.preflight @("read_only", "compatible", "official_create_count") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:preflight"
    Assert-OpsEqual $true $Case.oracle.preflight.read_only "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:preflight_read_only"
    Assert-OpsEqual $true $Case.oracle.preflight.compatible "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:compatible"
    Assert-OpsEqual 0 ([int]$Case.oracle.preflight.official_create_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:preflight_create"
    Assert-OpsExactProperties $Case.oracle.package_verification @("hash_match", "verified_before_staging") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:package"
    Assert-OpsEqual $true $Case.oracle.package_verification.hash_match "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:hash"
    Assert-OpsEqual $true $Case.oracle.package_verification.verified_before_staging "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:verify_order"
    Assert-OpsExactProperties $Case.oracle.installation @(
        "route", "storage", "schema_version", "business_record_count", "formal_jsonl_count", "atomic_promotion"
    ) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:installation"
    Assert-OpsEqual "B" ([string]$Case.oracle.installation.route) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:route"
    Assert-OpsEqual "sqlite" ([string]$Case.oracle.installation.storage) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:storage"
    Assert-OpsEqual 1 ([int]$Case.oracle.installation.schema_version) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:schema"
    Assert-OpsEqual 0 ([int]$Case.oracle.installation.business_record_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:records"
    Assert-OpsEqual 0 ([int]$Case.oracle.installation.formal_jsonl_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:jsonl"
    Assert-OpsEqual $true $Case.oracle.installation.atomic_promotion "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:atomic"
    Assert-OpsExactProperties $Case.oracle.isolated_smoke @("official_write_count", "cleanup_succeeded", "residual_count") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:smoke"
    Assert-OpsEqual 0 ([int]$Case.oracle.isolated_smoke.official_write_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:smoke_write"
    Assert-OpsEqual $true $Case.oracle.isolated_smoke.cleanup_succeeded "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:smoke_cleanup"
    Assert-OpsEqual 0 ([int]$Case.oracle.isolated_smoke.residual_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:smoke_residual"
    Assert-OpsExactProperties $Case.oracle.receipt @("product_version", "foundation_presented_as_product", "official_data_impact_count") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:receipt"
    Assert-OpsEqual "0.1.0" ([string]$Case.oracle.receipt.product_version) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:product"
    Assert-OpsEqual $false $Case.oracle.receipt.foundation_presented_as_product "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:foundation"
    Assert-OpsEqual 0 ([int]$Case.oracle.receipt.official_data_impact_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-001:impact"
}

function Assert-OpsMigrationCase {
    param($Case)

    Assert-OpsCaseCommon $Case "CASE-OPS-003" @("REQ-OPS-002") "5oqK546w5pyJ5pWw5o2u5Y2H57qn5Yiw5paw54mI5pys44CC" "ops-migration-interrupted-v1" @("migration_failure", "old_state_after_failure", "retry") @(
        "migration_without_verified_backup", "candidate_activated_after_failure", "schema_version_advanced_after_failure",
        "product_version_advanced_after_failure", "old_data_unreadable", "partial_target_visible", "success_receipt_visible", "partial_resume"
    )
    Assert-OpsExactProperties $Case.oracle.migration_failure @(
        "error_code", "candidate_activated", "success_receipt_visible", "schema_version_after", "product_version_after"
    ) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:failure"
    Assert-OpsEqual "migration_interrupted" ([string]$Case.oracle.migration_failure.error_code) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:error"
    Assert-OpsEqual $false $Case.oracle.migration_failure.candidate_activated "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:activated"
    Assert-OpsEqual $false $Case.oracle.migration_failure.success_receipt_visible "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:receipt"
    Assert-OpsEqual 1 ([int]$Case.oracle.migration_failure.schema_version_after) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:schema"
    Assert-OpsEqual "0.1.0" ([string]$Case.oracle.migration_failure.product_version_after) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:product"
    Assert-OpsExactProperties $Case.oracle.old_state_after_failure @("readable", "record_count", "bytes_unchanged", "partial_target_visible") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:old_state"
    Assert-OpsEqual $true $Case.oracle.old_state_after_failure.readable "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:readable"
    Assert-OpsEqual 2 ([int]$Case.oracle.old_state_after_failure.record_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:records"
    Assert-OpsEqual $true $Case.oracle.old_state_after_failure.bytes_unchanged "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:bytes"
    Assert-OpsEqual $false $Case.oracle.old_state_after_failure.partial_target_visible "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:partial"
    Assert-OpsExactProperties $Case.oracle.retry @("fresh_attempt_required", "resume_partial_allowed") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:retry"
    Assert-OpsEqual $true $Case.oracle.retry.fresh_attempt_required "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:fresh"
    Assert-OpsEqual $false $Case.oracle.retry.resume_partial_allowed "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:resume"
}

function Assert-OpsCandidateCase {
    param($Case)

    Assert-OpsCaseCommon $Case "CASE-OPS-010" @("REQ-OPS-004") "5pmL57qn5bey57uP6YCa6L+H5YWo6YOo6Zeo55qE5YCZ6YCJ44CC" "ops-candidate-byte-drift-v1" @("candidate_integrity", "invalidation", "release") @(
        "changed_bytes_accepted", "old_manifest_reused", "old_evidence_reused", "candidate_promoted",
        "release_rebuilt", "release_patched", "dependency_substituted", "affected_gates_skipped"
    )
    Assert-OpsExactProperties $Case.oracle.candidate_integrity @("original_sha256", "changed_sha256", "bytes_identical") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:integrity"
    Assert-OpsEqual "A1F76240BECC09AA5DA27649576AD7826FBA9CCB013C3F862C5E30E78447B5B6" ([string]$Case.oracle.candidate_integrity.original_sha256) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:original_sha"
    Assert-OpsEqual "1502B0E6A925440961349C5A7FED919B96B8D64FD4B56EBB179BBB076EAA90EC" ([string]$Case.oracle.candidate_integrity.changed_sha256) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:changed_sha"
    Assert-OpsEqual $false $Case.oracle.candidate_integrity.bytes_identical "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:identical"
    Assert-OpsExactProperties $Case.oracle.invalidation @("candidate_status", "previous_evidence_valid", "new_manifest_required", "affected_gates_rerun") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:invalidation"
    Assert-OpsEqual "invalidated" ([string]$Case.oracle.invalidation.candidate_status) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:status"
    Assert-OpsEqual $false $Case.oracle.invalidation.previous_evidence_valid "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:evidence"
    Assert-OpsEqual $true $Case.oracle.invalidation.new_manifest_required "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:manifest"
    Assert-OpsEqual $true $Case.oracle.invalidation.affected_gates_rerun "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:gates"
    Assert-OpsExactProperties $Case.oracle.release @("promotion_allowed", "rebuild_allowed", "patch_allowed", "substitution_allowed") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:release"
    Assert-OpsEqual $false $Case.oracle.release.promotion_allowed "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:promotion"
    Assert-OpsEqual $false $Case.oracle.release.rebuild_allowed "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:rebuild"
    Assert-OpsEqual $false $Case.oracle.release.patch_allowed "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:patch"
    Assert-OpsEqual $false $Case.oracle.release.substitution_allowed "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:substitution"
}

function Assert-OpsExportCase {
    param($Case)

    Assert-OpsCaseCommon $Case "CASE-EXPORT-004" @("REQ-EXPORT-BASE-001", "REQ-OPS-002", "REQ-OPS-003") "55So6L+Z5Liq5pyA5bCP55So5oi35a+85Ye65oGi5aSN5YWo6YOo5pWw5o2u44CC" "ops-minimal-export-restore-reject-v1" @("export", "restore_rejection", "official_state") @(
        "minimal_export_labeled_as_backup", "minimal_export_restored", "official_data_replaced_before_validation",
        "official_data_deleted_before_validation", "schema_migrated_before_validation", "version_changed", "success_receipt_visible"
    )
    Assert-OpsExactProperties $Case.oracle.export @("artifact_type", "readable", "restorable") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:export"
    Assert-OpsEqual "minimal_user_export" ([string]$Case.oracle.export.artifact_type) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:type"
    Assert-OpsEqual $true $Case.oracle.export.readable "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:readable"
    Assert-OpsEqual $false $Case.oracle.export.restorable "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:restorable"
    Assert-OpsExactProperties $Case.oracle.restore_rejection @("status", "error_code", "missing_backup_capabilities") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:rejection"
    Assert-OpsEqual "rejected" ([string]$Case.oracle.restore_rejection.status) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:status"
    Assert-OpsEqual "not_restorable_backup" ([string]$Case.oracle.restore_rejection.error_code) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:error"
    Assert-OpsExactStringArray @("backup_manifest", "complete_schema", "idempotency_state", "integrity_check") $Case.oracle.restore_rejection.missing_backup_capabilities "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:capabilities"
    Assert-OpsExactProperties $Case.oracle.official_state @("replacement_count", "deletion_count", "migration_count", "version_unchanged") "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:official"
    Assert-OpsEqual 0 ([int]$Case.oracle.official_state.replacement_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:replacement"
    Assert-OpsEqual 0 ([int]$Case.oracle.official_state.deletion_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:deletion"
    Assert-OpsEqual 0 ([int]$Case.oracle.official_state.migration_count) "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:migration"
    Assert-OpsEqual $true $Case.oracle.official_state.version_unchanged "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:version"
}

function Assert-OpsCases {
    param($CaseSet)

    Assert-OpsPrivacyCase (Get-OpsCaseById $CaseSet "CASE-PRIV-001")
    Assert-OpsFoundationCase (Get-OpsCaseById $CaseSet "CASE-FOUNDATION-002")
    Assert-OpsInstallCase (Get-OpsCaseById $CaseSet "CASE-OPS-001")
    Assert-OpsMigrationCase (Get-OpsCaseById $CaseSet "CASE-OPS-003")
    Assert-OpsCandidateCase (Get-OpsCaseById $CaseSet "CASE-OPS-010")
    Assert-OpsExportCase (Get-OpsCaseById $CaseSet "CASE-EXPORT-004")
}

function Test-OpsSecurityCasesCandidate {
    param($CaseSet)

    Assert-OpsExactProperties $CaseSet @(
        "case_set_id", "version", "contract", "fixture_catalog", "package_invariants", "cases"
    ) "OPS_SECURITY_CASE_SET_SHAPE_INVALID:root"
    Assert-OpsEqual "diet-manager/core-acceptance-cases-v1" ([string]$CaseSet.case_set_id) "OPS_SECURITY_CASE_SET_ID_INVALID"
    Assert-OpsEqual "1.3.0" ([string]$CaseSet.version) "OPS_SECURITY_CASE_SET_VERSION_INVALID"
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
    Assert-OpsCases $CaseSet
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
        Invoke-OpsMutation "MUT-OPS-DROP-REQUIRED-CASE" {
            param($casesCandidate, $fixturesCandidate)
            $casesCandidate.cases = @($casesCandidate.cases | Where-Object { [string]$_.id -cne "CASE-PRIV-001" })
        } "OPS_SECURITY_CASE_IDS_INVALID" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-LEAK-RAW-CONTEXT" {
            param($casesCandidate, $fixturesCandidate)
            $scenario = @($fixturesCandidate.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq "ops-privacy-public-nutrition-v1" })[0]
            $scenario.outbound_request | Add-Member -NotePropertyName "raw_chat" -NotePropertyValue "fixture-raw-chat-secret"
        } "OPS_SECURITY_PRIVACY_OUTBOUND_INVALID" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-LEAK-SECRET-TO-LOG" {
            param($casesCandidate, $fixturesCandidate)
            $scenario = @($fixturesCandidate.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq "ops-privacy-public-nutrition-v1" })[0]
            $scenario.ordinary_log.secret_present = $true
        } "OPS_SECURITY_PRIVACY_LOG_INVALID:secret" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-HIDE-OFFICIAL-SIDECAR-DIFF" {
            param($casesCandidate, $fixturesCandidate)
            $scenario = @($fixturesCandidate.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq "ops-foundation-zero-diff-v1" })[0]
            $scenario.official_files_after = @($scenario.official_files_after[0])
        } "OPS_SECURITY_FOUNDATION_MANIFEST_INVALID:after_count" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-SKIP-AFTER-SCAN-ON-FAILURE" {
            param($casesCandidate, $fixturesCandidate)
            $scenario = @($fixturesCandidate.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq "ops-foundation-zero-diff-v1" })[0]
            $scenario.after_scan_completed = $false
        } "OPS_SECURITY_FOUNDATION_FAILURE_INVALID:after_scan" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-INSTALL-SAMPLE-BUSINESS-RECORD" {
            param($casesCandidate, $fixturesCandidate)
            $scenario = @($fixturesCandidate.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq "ops-clean-install-b-v1" })[0]
            $scenario.initialized_schema.business_record_count = 1
        } "OPS_SECURITY_INSTALL_SCHEMA_INVALID:records" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-ACCEPT-PACKAGE-HASH-MISMATCH" {
            param($casesCandidate, $fixturesCandidate)
            $scenario = @($fixturesCandidate.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq "ops-clean-install-b-v1" })[0]
            $scenario.package_manifest.package_files[0].sha256 = "0000000000000000000000000000000000000000000000000000000000000000"
        } "OPS_SECURITY_INSTALL_MANIFEST_INVALID:plugin:sha256" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-ADVANCE-VERSION-ON-MIGRATION-FAILURE" {
            param($casesCandidate, $fixturesCandidate)
            $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-OPS-003" })[0]
            $case.oracle.migration_failure.schema_version_after = 2
        } "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-003:schema" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-LOSE-OLD-STATE-ON-MIGRATION-FAILURE" {
            param($casesCandidate, $fixturesCandidate)
            $scenario = @($fixturesCandidate.ops_security_scenarios | Where-Object { [string]$_.fixture_id -ceq "ops-migration-interrupted-v1" })[0]
            $scenario.old_state_after_failure.readable = $false
        } "OPS_SECURITY_MIGRATION_OLD_STATE_INVALID:readable" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-PROMOTE-CHANGED-CANDIDATE" {
            param($casesCandidate, $fixturesCandidate)
            $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-OPS-010" })[0]
            $case.oracle.release.promotion_allowed = $true
        } "OPS_SECURITY_CASE_VALUE_INVALID:CASE-OPS-010:promotion" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-TREAT-EXPORT-AS-BACKUP" {
            param($casesCandidate, $fixturesCandidate)
            $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-EXPORT-004" })[0]
            $case.oracle.export.restorable = $true
        } "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:restorable" $caseSet $fixtures

        Invoke-OpsMutation "MUT-OPS-DELETE-BEFORE-RESTORE-REJECTION" {
            param($casesCandidate, $fixturesCandidate)
            $case = @($casesCandidate.cases | Where-Object { [string]$_.id -ceq "CASE-EXPORT-004" })[0]
            $case.oracle.official_state.deletion_count = 1
        } "OPS_SECURITY_CASE_VALUE_INVALID:CASE-EXPORT-004:deletion" $caseSet $fixtures

        $mutationCount = 12
    }
    "OPS_SECURITY_ACCEPTANCE_CASES|PASS|version=1.3.0|cases=6|scenarios=6|mutations={0}" -f $mutationCount
}
