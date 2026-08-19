param(
    [switch]$LibraryOnly
)

$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:Results = New-Object System.Collections.ArrayList
$script:ClockTick = 0
$script:Scenario = $null
$script:TestSystemTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\", "/")
$script:LogPath = Join-Path ([System.IO.Path]::GetTempPath()) ("sh-safe-base-red-" + [guid]::NewGuid().ToString("N") + ".log")

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$corePath = Join-Path $projectRoot "shared\private\foundation-validation-core.ps1"
$powershellPath = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$scopeManifestPath = Join-Path $projectRoot "docs\evidence\raw\SH-SAFE-BASE-001-protected-source-authoritative-20260809T202357+0800.txt"
$scopeManifestSha256 = "A0DAE4030F49B8B76348B74EBBFCC73BDDCAB87D19D5102DD4CB2A51A7676343"
$frozenBriefPath = Join-Path $projectRoot "docs\work-items\SH-SAFE-BASE-001-brief.md"
$frozenBriefSha256 = "C25EEA39A4A778AC98F9BCDE17BED136D0BE3645153EBA7E1151205F10FE4441"
$frozenPolicySha256 = "C0C0E478D19C2D3473D165318EEAB689DF0C34E69D8784A8C6B3D0119319D25D"
$frozenPolicyLineCount = 1065
$frozenPolicyLength = 43267

$commonCleanRoomNames = @(
    "APPDATA", "ComSpec", "HOME", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA",
    "NODE_DISABLE_COMPILE_CACHE", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT",
    "PROCESSOR_ARCHITECTURE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "USERNAME",
    "USERPROFILE", "WINDIR"
)
$pluginOnlyCleanRoomNames = @("JITI_FS_CACHE", "OPENCLAW_CONFIG_PATH", "OPENCLAW_HOME", "OPENCLAW_STATE_DIR")
$pluginCleanRoomNames = @($commonCleanRoomNames + $pluginOnlyCleanRoomNames)
$externalLeasePaths = @(
    "shared\contracts\data-model.md",
    "shared\schemas\domain.schema.json",
    "shared\schemas\fixtures\domain-cases.json",
    "shared\tests\validate-domain-schema.mjs",
    "shared\tests\validate-domain-schema.ps1"
)
$authorizedImplementationPaths = @(
    "shared\validate-foundations.ps1",
    "shared\private\foundation-validation-core.ps1",
    "shared\tests\validate-data-manifests.ps1",
    "shared\tests\validate-foundations-state-isolation.ps1"
)
$protectedSourceExpectedCount = 27
$nodePoisonNames = @(
    "NODE_OPTIONS", "NODE_V8_COVERAGE", "NODE_REDIRECT_WARNINGS", "NODE_PATH",
    "NODE_COMPILE_CACHE", "NODE_COMPILE_CACHE_PORTABLE", "OPENSSL_CONF", "VITEST",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "JITI_NATIVE_MODULES", "ESBUILD_BINARY_PATH",
    "NODE_FUTURE_WRITE_PATH", "UNLISTED_WRITE_PATH"
)
$openClawPoisonNames = @(
    "OPENCLAW_DIAGNOSTICS", "OPENCLAW_DIAGNOSTICS_TIMELINE_PATH",
    "OPENCLAW_RAW_STREAM_PATH", "OPENCLAW_TEST_FILE_LOG",
    "OPENCLAW_FUTURE_WRITE_PATH", "JITI_FUTURE_WRITE_PATH"
)

$testCases = @(
    [pscustomobject]@{ id = "RED-ROOT-001"; injection = "fixed_project_layout"; expected = "three absolute non-nested data roots and source fixed_project_layout" },
    [pscustomobject]@{ id = "RED-ROOT-002"; injection = "dot_dot_traversal"; expected = "PATH_TRAVERSAL_REJECTED, zero external writes, after scan and JSON" },
    [pscustomobject]@{ id = "RED-ROOT-003"; injection = "absolute_external_path"; expected = "PATH_OUTSIDE_ALLOWED_ROOT and zero external writes" },
    [pscustomobject]@{ id = "RED-ROOT-004"; injection = "prefix_collision"; expected = "data-evil containment false" },
    [pscustomobject]@{ id = "RED-ROOT-005"; injection = "reparse_ancestor"; expected = "PATH_REPARSE_POINT_REJECTED and zero target writes" },
    [pscustomobject]@{ id = "RED-ROOT-006"; injection = "forged_official_root_environment"; expected = "environment root ignored and exactly three fixed roots" },
    [pscustomobject]@{ id = "RED-MANIFEST-001"; injection = "all_extensions_and_dist"; expected = "all business and sidecar extensions scanned case-insensitively including dist" },
    [pscustomobject]@{ id = "RED-MANIFEST-002"; injection = "success_with_seeded_data"; expected = "path length hash and mtime unchanged; empty diff" },
    [pscustomobject]@{ id = "RED-MANIFEST-003"; injection = "modify_jsonl"; expected = "modified exact target, failed verdict, after manifest" },
    [pscustomobject]@{ id = "RED-MANIFEST-004"; injection = "add_sqlite_wal"; expected = "added exact sidecar and failed verdict" },
    [pscustomobject]@{ id = "RED-MANIFEST-005"; injection = "delete_db_journal"; expected = "deleted exact sidecar and failed verdict" },
    [pscustomobject]@{ id = "RED-MANIFEST-006"; injection = "manifest_provider_scope_throw"; expected = "manifest_failed while remaining finally work continues" },
    [pscustomobject]@{ id = "RED-FAIL-001"; injection = "A.structure=41"; expected = "raw stderr, exit 41, after manifest, restore, cleanup, unchanged seeds" },
    [pscustomobject]@{ id = "RED-FAIL-002"; injection = "B.test=42"; expected = "exit 42 and later commands skipped" },
    [pscustomobject]@{ id = "RED-FAIL-003"; injection = "B.build=43"; expected = "exit 43 and source dist diff empty" },
    [pscustomobject]@{ id = "RED-FAIL-004"; injection = "B.plugin_build_check=44"; expected = "exit 44 and OpenClaw pre-delete audit" },
    [pscustomobject]@{ id = "RED-FAIL-005"; injection = "B.plugin_validate=45"; expected = "exit 45 and C commands skipped" },
    [pscustomobject]@{ id = "RED-FAIL-006"; injection = "C.test=46"; expected = "exit 46 with full failure-path evidence" },
    [pscustomobject]@{ id = "RED-FAIL-007"; injection = "C.build=47"; expected = "exit 47 and source dist diff empty" },
    [pscustomobject]@{ id = "RED-FAIL-008"; injection = "C.plugin_build_check=48"; expected = "exit 48 and OpenClaw audit and cleanup" },
    [pscustomobject]@{ id = "RED-FAIL-009"; injection = "C.plugin_validate=49"; expected = "exit 49 and all nine command objects" },
    [pscustomobject]@{ id = "RED-BUILD-001"; injection = "snapshot_permission_profiles_and_build_output"; expected = "A exact argv; eight snapshot specs; build profiles and attestation strictly inside build roots" },
    [pscustomobject]@{ id = "RED-BUILD-002"; injection = "build_or_plugin_failure"; expected = "build and OpenClaw audit and cleanup; source dist unchanged" },
    [pscustomobject]@{ id = "RED-STAGING-001"; injection = "construct_plugin_staging"; expected = "strict allowlist and ordinary frozen typebox tree; no package manager or network" },
    [pscustomobject]@{ id = "RED-STAGING-002"; injection = "invalid_typebox_dependency"; expected = "RUNTIME_IDENTITY_INVALID before plugin execution; direct staging STAGING_DEPENDENCY_INVALID; final evidence" },
    [pscustomobject]@{ id = "RED-CACHE-001"; injection = "inspect_policy_bootstrap_and_all_command_specs"; expected = "exact 1065-line policy bytes, ESM import prefix, hooks, SQLite, child and addon policy DTO" },
    [pscustomobject]@{ id = "RED-CACHE-002"; injection = "three_external_cache_sentinels"; expected = "three full-file guard diffs empty and no guard cleanup" },
    [pscustomobject]@{ id = "RED-CACHE-003"; injection = "plugin_writes_external_guard"; expected = "guard added exact file, failed, no repair deletion" },
    [pscustomobject]@{ id = "RED-CACHE-VITEST-001"; injection = "inspect_B_C_test_specs_and_fake_policy_journals"; expected = "Vitest 28 to 24 to 26 to 24 environment evidence, IPC fd3, one-shot child policy and exact journals" },
    [pscustomobject]@{ id = "RED-CACHE-VITEST-002"; injection = "vitest_cache_guard_change"; expected = "B and C cache guard diffs empty or failed without cleanup" },
    [pscustomobject]@{ id = "RED-ENV-NODE-001"; injection = "poison_parent_and_role_specific_child_environments"; expected = "exact command profiles; fork and helper NODE_OPTIONS absent; only esbuild source-derived NODE_OPTIONS; caller unchanged" },
    [pscustomobject]@{ id = "RED-ENV-OPENCLAW-001"; injection = "poison_known_and_future_OpenClaw_environment"; expected = "all four plugin children remain exact 23 keys; only four frozen OpenClaw/JITI keys; guards and caller unchanged" },
    [pscustomobject]@{ id = "RED-OPENCLAW-001"; injection = "unexpected_cache_sqlite_wal_then_fail"; expected = "pre-delete business candidate, failed, root cleaned, after manifest" },
    [pscustomobject]@{ id = "RED-OPENCLAW-002"; injection = "openclaw_cleanup_failure"; expected = "primary error retained, cleanup error appended, residual positive, restored" },
    [pscustomobject]@{ id = "RED-OPENCLAW-003"; injection = "allowlisted_openclaw_2026_7_1_state"; expected = "internal tool state not business, pre-delete hashes, cleanup residual zero" },
    [pscustomobject]@{ id = "RED-OPENCLAW-004"; injection = "non_allowlisted_openclaw_business_files"; expected = "business candidates retained in audit and failed after cleanup" },
    [pscustomobject]@{ id = "RED-TEMP-001"; injection = "each_of_four_cleanup_failures"; expected = "each isolated validation build and OpenClaw residual independently fails" },
    [pscustomobject]@{ id = "RED-ENV-001"; injection = "OPENCLAW_STATE_DIR_present"; expected = "caller value never changes; child sees controlled value; mutation_attempted false, caller_unchanged and restored true" },
    [pscustomobject]@{ id = "RED-ENV-002"; injection = "OPENCLAW_STATE_DIR_absent"; expected = "caller item remains absent while plugin child receives controlled value" },
    [pscustomobject]@{ id = "RED-ENV-003"; injection = "after_environment_snapshot_failure"; expected = "verification failed, caller_unchanged and restored null, environment_snapshot_failed, remaining finally work" },
    [pscustomobject]@{ id = "RED-REPORT-001"; injection = "success_report"; expected = "PS5.1 JSON parse and nine complete command objects" },
    [pscustomobject]@{ id = "RED-REPORT-002"; injection = "complex_stderr"; expected = "raw bytes and hash retained with exception and primary precedence" },
    [pscustomobject]@{ id = "RED-REPORT-003"; injection = "command_and_cleanup_failure"; expected = "ordered command then cleanup errors and nonzero exit" },
    [pscustomobject]@{ id = "RED-REPORT-004"; injection = "report_publisher_failure"; expected = "in-memory report_publish_failed and no false published claim" },
    [pscustomobject]@{ id = "RED-REPORT-005"; injection = "deep_report"; expected = "Depth 32 roundtrip, report path but no self hash, out-of-band hash" },
    [pscustomobject]@{ id = "RED-PROCESS-001"; injection = "argv_roundtrip"; expected = "empty space quote and backslash arguments preserved; Process.ExitCode" },
    [pscustomobject]@{ id = "RED-PROCESS-002"; injection = "dual_stream_over_1MiB"; expected = "concurrent complete capture without deadlock and verifiable hashes" },
    [pscustomobject]@{ id = "RED-PROCESS-003"; injection = "process_tree_timeout"; expected = "recorded PID tree only terminated; PROCESS_TIMEOUT and taskkill evidence" }
)

function Write-TestResult {
    param(
        [string]$Id,
        [bool]$Passed,
        [string]$Detail
    )

    $status = if ($Passed) { "PASS" } else { "FAIL" }
    $safeDetail = ($Detail -replace "[\r\n]+", " ").Trim()
    $line = "$Id|$status|$safeDetail"
    [System.IO.File]::AppendAllText($script:LogPath, $line + [Environment]::NewLine, $script:Utf8NoBom)
    [void]$script:Results.Add([pscustomobject]@{ id = $Id; passed = $Passed; detail = $safeDetail })
    Write-Output $line
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message; expected=[$Expected] actual=[$Actual]"
    }
}

function Assert-ExactPropertySet {
    param($Object, [string[]]$ExpectedNames, [string]$Message)
    Assert-True ($null -ne $Object) "$Message object missing"
    $actualNames = @($Object.PSObject.Properties | ForEach-Object { [string]$_.Name })
    Assert-Equal $ExpectedNames.Count $actualNames.Count "$Message property count"
    foreach ($expectedName in $ExpectedNames) {
        Assert-True ($actualNames -ccontains $expectedName) "$Message property missing or wrong case: $expectedName"
    }
}

function Assert-ExactErrorCodeCount {
    param($Errors, [string]$Code, [int]$ExpectedCount, [string]$Message)
    $matches = @($Errors | Where-Object { $null -ne $_ -and [string]$_.code -ceq $Code })
    Assert-Equal $ExpectedCount $matches.Count $Message
}

function New-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        [void](New-Item -ItemType Directory -Path $Path)
    }
}

function Write-StableFile {
    param([string]$Path, [string]$Text)
    New-Directory (Split-Path -Parent $Path)
    [System.IO.File]::WriteAllText($Path, $Text, $script:Utf8NoBom)
    [System.IO.File]::SetLastWriteTimeUtc($Path, [datetime]::Parse("2024-01-02T03:04:05Z").ToUniversalTime())
}

function New-StructuralV1TypeboxOracle {
    return [pscustomobject][ordered]@{
        files = @(
            [pscustomobject][ordered]@{ relative_path = "package.json"; bytes_base64 = "eyJuYW1lIjoidHlwZWJveCIsInZlcnNpb24iOiIxLjMuMTEiLCJ0eXBlIjoibW9kdWxlIn0="; length = 53; sha256 = "0CF7424D7E6A9E9F83510CDAFB44E9A24C20450CE13759BC10D44355042B44C2" },
            [pscustomobject][ordered]@{ relative_path = "index.js"; bytes_base64 = "ZXhwb3J0ICogZnJvbSAiLi9idWlsZC9lc20vaW5kZXguanMiOw=="; length = 37; sha256 = "31FBA54BA076CD567A0F0F60A31B54475C4CF2882C60074EF09E8E6E4356A91B" },
            [pscustomobject][ordered]@{ relative_path = "index.d.ts"; bytes_base64 = "ZXhwb3J0ICogZnJvbSAiLi9idWlsZC9lc20vaW5kZXguanMiOw=="; length = 37; sha256 = "31FBA54BA076CD567A0F0F60A31B54475C4CF2882C60074EF09E8E6E4356A91B" },
            [pscustomobject][ordered]@{ relative_path = "LICENSE"; bytes_base64 = "TUlUIGZpeHR1cmUgbGljZW5zZQo="; length = 20; sha256 = "BE21558A891A4BFECB04FE90AB671D8593550761EB3D9D014F43D1ED7663178D" },
            [pscustomobject][ordered]@{ relative_path = "build\cjs\index.js"; bytes_base64 = "InVzZSBzdHJpY3QiOyBleHBvcnRzLlR5cGUgPSBPYmplY3QuZnJlZXplKHt9KTs="; length = 47; sha256 = "AFD75AB3085B64C6BA5C0A140C2A8576903E4C6E05F04315BE568529ABFE2754" },
            [pscustomobject][ordered]@{ relative_path = "build\cjs\index.d.ts"; bytes_base64 = "ZXhwb3J0IGRlY2xhcmUgY29uc3QgVHlwZTogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgbmV2ZXI+Pjs="; length = 59; sha256 = "21B4E76669EC11E6B6AD34A344075F868B3F01FB1CB5DC940DC85C6C7FF5B209" },
            [pscustomobject][ordered]@{ relative_path = "build\esm\index.js"; bytes_base64 = "ZXhwb3J0IGNvbnN0IFR5cGUgPSBPYmplY3QuZnJlZXplKHt9KTs="; length = 38; sha256 = "E43325CB7E5EC30E9556E8BFB70ED8B360EAD1CF8F073BDE87535247EADB5557" },
            [pscustomobject][ordered]@{ relative_path = "build\esm\index.d.ts"; bytes_base64 = "ZXhwb3J0IGRlY2xhcmUgY29uc3QgVHlwZTogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgbmV2ZXI+Pjs="; length = 59; sha256 = "21B4E76669EC11E6B6AD34A344075F868B3F01FB1CB5DC940DC85C6C7FF5B209" },
            [pscustomobject][ordered]@{ relative_path = "src\type\object\object.js"; bytes_base64 = "ZXhwb3J0IGNvbnN0IE9iamVjdFR5cGUgPSAocHJvcGVydGllcykgPT4gKHsgcHJvcGVydGllcyB9KTs="; length = 59; sha256 = "AA934350DFFDF5D5C10C626F3F56085BCF24546331B80702E70E97DB4482145C" },
            [pscustomobject][ordered]@{ relative_path = "src\type\object\object.d.ts"; bytes_base64 = "ZXhwb3J0IGRlY2xhcmUgY29uc3QgT2JqZWN0VHlwZTogKHByb3BlcnRpZXM6IHVua25vd24pID0+IHVua25vd247"; length = 66; sha256 = "77CD6F1951EC2AE5AFCDEB74AA27EC0D83852AC7D48B969D3345B50E472116C4" },
            [pscustomobject][ordered]@{ relative_path = "src\value\check\check.js"; bytes_base64 = "ZXhwb3J0IGNvbnN0IENoZWNrID0gKF9zY2hlbWEsIHZhbHVlKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkOw=="; length = 61; sha256 = "2FCA2CE9FCFD4668355D71E5EDD0DEB04A915CD47C3C497A69AD19E5F540E75E" },
            [pscustomobject][ordered]@{ relative_path = "metadata\empty.bin"; bytes_base64 = ""; length = 0; sha256 = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" }
        )
        aggregate = [pscustomobject][ordered]@{
            file_count = 12
            total_bytes = 536
            tree_sha256 = "75BB04FB6D9DB4FDC665B2DFAB09C5EA1FDD8BD60EB82523AD97884761369FAA"
            package_sha256 = "0CF7424D7E6A9E9F83510CDAFB44E9A24C20450CE13759BC10D44355042B44C2"
        }
    }
}

function New-TestTypeboxContract {
    param(
        [ValidateSet("production_exact", "structural_v1")][string]$Profile,
        [string]$Path
    )
    if ($Profile -ceq "structural_v1") {
        return [pscustomobject][ordered]@{
            path = $Path
            file_count = 12
            total_bytes = 536
            tree_sha256 = "75BB04FB6D9DB4FDC665B2DFAB09C5EA1FDD8BD60EB82523AD97884761369FAA"
            package_sha256 = "0CF7424D7E6A9E9F83510CDAFB44E9A24C20450CE13759BC10D44355042B44C2"
        }
    }
    return [pscustomobject][ordered]@{
        path = $Path
        file_count = 1367
        total_bytes = 1468384
        tree_sha256 = "BC1E4E174A7B9DC9AB176ACA0039F96ED9F47F9A722BAF7B8A0D927897A0B7FE"
        package_sha256 = "1E10166E4B3DD7718186CD458EEED35FA674752E51E87663100CA9068DB89E63"
    }
}

function Write-StructuralV1TypeboxFixture {
    param([string]$FixtureRoute)
    $target = Join-Path $FixtureRoute "node_modules\.pnpm\typebox@1.3.11\node_modules\typebox"
    $oracle = New-StructuralV1TypeboxOracle
    foreach ($entry in @($oracle.files)) {
        $path = Join-Path $target ([string]$entry.relative_path)
        New-Directory (Split-Path -Parent $path)
        [System.IO.File]::WriteAllBytes($path, [Convert]::FromBase64String([string]$entry.bytes_base64))
        [System.IO.File]::SetLastWriteTimeUtc($path, [datetime]::Parse("2024-01-02T03:04:05Z").ToUniversalTime())
    }
    $link = Join-Path $FixtureRoute "node_modules\typebox"
    [void](New-Item -ItemType Junction -Path $link -Target $target)
}

function Copy-FrozenTypeboxFixture {
    param([string]$RouteName, [string]$FixtureRoute)
    $source = Join-Path $projectRoot "$RouteName\node_modules\.pnpm\typebox@1.3.11\node_modules\typebox"
    Assert-True (Test-Path -LiteralPath $source -PathType Container) "Frozen typebox source missing for $RouteName"
    $sourceItem = Get-Item -LiteralPath $source -Force
    Assert-True (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Frozen typebox source is a reparse point for $RouteName"
    $reparseDescendants = @(Get-ChildItem -LiteralPath $source -Recurse -Force | Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 })
    Assert-Equal 0 $reparseDescendants.Count "Frozen typebox source reparse descendant count for $RouteName"

    $target = Join-Path $FixtureRoute "node_modules\.pnpm\typebox@1.3.11\node_modules\typebox"
    New-Directory (Split-Path -Parent $target)
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
    $link = Join-Path $FixtureRoute "node_modules\typebox"
    [void](New-Item -ItemType Junction -Path $link -Target $target)
}

function Get-TestFixtureTreeIdentity {
    param([string]$Root)
    $safeRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\", "/")
    Assert-True (Test-Path -LiteralPath $safeRoot -PathType Container) "Fixture identity root is missing: $safeRoot"
    $rootItem = Get-Item -LiteralPath $safeRoot -Force
    Assert-True (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Fixture identity root is a reparse point: $safeRoot"
    $rows = New-Object 'System.Collections.Generic.List[string]'
    [long]$totalBytes = 0
    $fileCount = 0
    $reparseCount = 0
    $prefixLength = $safeRoot.Length + 1
    foreach ($item in @(Get-ChildItem -LiteralPath $safeRoot -Recurse -Force)) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            $reparseCount++
            throw "Fixture identity source contains an unexpected reparse point: $($item.FullName)"
        }
        if (-not $item.PSIsContainer) {
            $relative = $item.FullName.Substring($prefixLength).Replace("/", "\")
            $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
            $rows.Add("F|$relative|$($item.Length)|$hash")
            $fileCount++
            $totalBytes += [long]$item.Length
        }
    }
    $rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return [pscustomobject][ordered]@{
        root = $safeRoot
        file_count = $fileCount
        reparse_count = $reparseCount
        total_bytes = $totalBytes
        canonical_line_count = $rows.Count
        tree_sha256 = Get-TextSha256 (@($rows) -join "`n")
    }
}

function New-TestFixtureRuntime {
    param(
        [string]$Base,
        [string]$TemporaryParent,
        [hashtable]$Routes,
        $ProtectedPaths,
        [ValidateSet("production_exact", "structural_v1")][string]$TypeboxFixtureProfile
    )

    $nodeRoot = Join-Path $Base "runtime-source\node"
    $nodePath = Join-Path $nodeRoot "node-v24.15.0-win-x64\node.exe"
    Write-StableFile $nodePath "fixture snapshot node"

    $toolModulesRoot = Join-Path $Routes.C "node_modules"
    $pnpmRoot = Join-Path $toolModulesRoot ".pnpm"
    $toolDefinitions = @(
        [pscustomobject]@{ name = "vitest"; version = "2.1.9"; package_leaf = "vitest@2.1.9_@types+node@26.2.0\node_modules\vitest"; entry = "vitest.mjs"; content = "fixture vitest entry" },
        [pscustomobject]@{ name = "typescript"; version = "5.9.3"; package_leaf = "typescript@5.9.3\node_modules\typescript"; entry = "bin\tsc"; content = "fixture typescript entry" },
        [pscustomobject]@{ name = "openclaw"; version = "2026.7.1"; package_leaf = "openclaw@2026.7.1\node_modules\openclaw"; entry = "openclaw.mjs"; content = "fixture openclaw entry" }
    )
    $tools = [ordered]@{}
    foreach ($definition in $toolDefinitions) {
        $target = Join-Path $pnpmRoot $definition.package_leaf
        $entry = Join-Path $target $definition.entry
        Write-StableFile $entry $definition.content
        Write-StableFile (Join-Path $target "package.json") ("{{`"name`":`"{0}`",`"version`":`"{1}`"}}" -f $definition.name, $definition.version)
        $configuredTarget = Join-Path $toolModulesRoot $definition.name
        Assert-True (-not (Test-Path -LiteralPath $configuredTarget)) "Fixture tool link already exists: $configuredTarget"
        [void](New-Item -ItemType Junction -Path $configuredTarget -Target $target)
        $configuredEntry = Join-Path $configuredTarget $definition.entry
        $tree = Get-TestFixtureTreeIdentity $target
        $tools[$definition.name] = [pscustomobject][ordered]@{
            version = $definition.version
            configured_target_path = $configuredTarget
            configured_entry_path = $configuredEntry
            physical_target_path = $target
            physical_entry_path = $entry
            entry_length = (Get-Item -LiteralPath $entry).Length
            entry_sha256 = (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash
            tree = $tree
        }
    }

    $tinypoolEntry = Join-Path $pnpmRoot "tinypool@1.1.1\node_modules\tinypool\dist\entry\process.js"
    $rollupAddon = Join-Path $pnpmRoot "@rollup+rollup-win32-x64-msvc@4.62.4\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node"
    $esbuildExe = Join-Path $pnpmRoot "@esbuild+win32-x64@0.21.5\node_modules\@esbuild\win32-x64\esbuild.exe"
    Write-StableFile $tinypoolEntry "fixture tinypool fork entry"
    Write-StableFile $rollupAddon "fixture rollup addon"
    Write-StableFile $esbuildExe "fixture esbuild executable"

    $nodeTree = Get-TestFixtureTreeIdentity $nodeRoot
    $pnpmTree = Get-TestFixtureTreeIdentity $pnpmRoot
    $policyContract = Get-FrozenPolicyContract
    $nodeEntryIdentity = [pscustomobject][ordered]@{ path = $nodePath; length = (Get-Item -LiteralPath $nodePath).Length; sha256 = (Get-FileHash -LiteralPath $nodePath -Algorithm SHA256).Hash }
    $rollupIdentity = [pscustomobject][ordered]@{ path = $rollupAddon; length = (Get-Item -LiteralPath $rollupAddon).Length; sha256 = (Get-FileHash -LiteralPath $rollupAddon -Algorithm SHA256).Hash }
    $esbuildIdentity = [pscustomobject][ordered]@{ path = $esbuildExe; length = (Get-Item -LiteralPath $esbuildExe).Length; sha256 = (Get-FileHash -LiteralPath $esbuildExe -Algorithm SHA256).Hash }
    $typeboxPath = Join-Path $pnpmRoot "typebox@1.3.11\node_modules\typebox"
    $stagingTypeboxContract = New-TestTypeboxContract $TypeboxFixtureProfile $typeboxPath
    $identityExpectations = [pscustomobject][ordered]@{
        a_structure = [pscustomobject][ordered]@{
            executable_path = $powershellPath
            script_path = Join-Path $Routes.A "tests\validate-foundation.ps1"
            length = 454656
            sha256 = "7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5"
            file_version = "10.0.26100.8875"
            product_version = "10.0.26100.8875"
        }
        source_trees = [pscustomobject][ordered]@{ node = $nodeTree; pnpm = $pnpmTree }
        snapshot_trees = [pscustomobject][ordered]@{ node = $nodeTree; pnpm = $pnpmTree }
        tools = [pscustomobject]$tools
        module_closure = [pscustomobject][ordered]@{
            vitest = [pscustomobject][ordered]@{ required_gap_count = 0; c_top_edge_count = 0; missing_optional_peer_count = 0 }
            typescript = [pscustomobject][ordered]@{ required_gap_count = 0; c_top_edge_count = 0; missing_optional_peer_count = 0 }
            openclaw = [pscustomobject][ordered]@{ required_gap_count = 0; c_top_edge_count = 0; missing_optional_peer_count = 0 }
            staging_typebox = $stagingTypeboxContract
        }
        native_execution_allowlist = [pscustomobject][ordered]@{
            snapshot_node_executable = $nodeEntryIdentity
            vitest_fork = [pscustomobject][ordered]@{ path = $tinypoolEntry; length = (Get-Item -LiteralPath $tinypoolEntry).Length; sha256 = (Get-FileHash -LiteralPath $tinypoolEntry -Algorithm SHA256).Hash }
            vitest_addon = $rollupIdentity
            vitest_child = $esbuildIdentity
        }
        policy_bootstrap = [pscustomobject][ordered]@{ schema_version = "foundation-trusted-policy/v2"; line_count = $policyContract.line_count; length = $policyContract.length; sha256 = $policyContract.sha256; ascii_only = $true }
    }

    return [pscustomobject][ordered]@{
        temporary_parent = $TemporaryParent
        node_path = $nodePath
        tool_modules_path = $toolModulesRoot
        vitest_path = [string]$tools.vitest.configured_entry_path
        typescript_path = [string]$tools.typescript.configured_entry_path
        openclaw_path = [string]$tools.openclaw.configured_entry_path
        dependency_source_roots = [pscustomobject][ordered]@{
            node_root = $nodeRoot
            tool_modules_root = $toolModulesRoot
            pnpm_root = $pnpmRoot
            typebox_root = $typeboxPath
        }
        protected_external_paths = [pscustomobject][ordered]@{
            jiti_openclaw_cache_guard = $ProtectedPaths.jiti_openclaw_cache_guard
            node_compile_cache_guard = $ProtectedPaths.node_compile_cache_guard
            inherited_openclaw_temp_guard = $ProtectedPaths.inherited_openclaw_temp_guard
            vitest_b_cache_guard = $ProtectedPaths.vitest_b_cache_guard
            vitest_c_cache_guard = $ProtectedPaths.vitest_c_cache_guard
        }
        identity_expectations = $identityExpectations
    }
}

function New-TestFixture {
    param(
        [ValidateSet("production_exact", "structural_v1")][string]$TypeboxFixtureProfile = "structural_v1"
    )
    $base = Join-Path $script:TestSystemTempRoot ("sh-safe-fixture-" + [guid]::NewGuid().ToString("N"))
    $project = Join-Path $base "project"
    $evidence = Join-Path $project "docs\evidence"
    $external = Join-Path $base "external"
    $temporaryParent = Join-Path $base "diet-manager-shared"
    $guardParent = Join-Path $base "guard-parent"
    New-Directory $project
    New-Directory $evidence
    New-Directory $external
    New-Directory $temporaryParent
    New-Directory $guardParent

    $routes = @{
        A = Join-Path $project "version-a-skill-only"
        B = Join-Path $project "version-b-lite-plugin"
        C = Join-Path $project "version-c-strict-plugin"
    }
    foreach ($route in @($routes.A, $routes.B, $routes.C)) {
        New-Directory $route
        New-Directory (Join-Path $route "data")
        New-Directory (Join-Path $route "dist")
        New-Directory (Join-Path $route "skills\diet-manager")
        Write-StableFile (Join-Path $route "package.json") "{`"name`":`"fixture`"}"
        Write-StableFile (Join-Path $route "openclaw.plugin.json") "{`"id`":`"fixture`"}"
        Write-StableFile (Join-Path $route "skills\diet-manager\SKILL.md") "fixture skill"
    }
    New-Directory (Join-Path $routes.A "tests")
    Write-StableFile (Join-Path $routes.A "tests\validate-foundation.ps1") "Write-Output 'fixture'"
    foreach ($routeName in @("B", "C")) {
        $routeRoot = [string]$routes[$routeName]
        New-Directory (Join-Path $routeRoot "src")
        New-Directory (Join-Path $routeRoot "tests")
        Write-StableFile (Join-Path $routeRoot "src\foundation-fixture.ts") 'export const foundationFixture = "ordinary-source";'
        Write-StableFile (Join-Path $routeRoot "tests\foundation-fixture.test.ts") 'export const foundationFixtureTest = "ordinary-test";'
        Write-StableFile (Join-Path $routeRoot "tsconfig.json") "{}"
    }
    if ($TypeboxFixtureProfile -ceq "structural_v1") {
        Write-StructuralV1TypeboxFixture $routes.B
        Write-StructuralV1TypeboxFixture $routes.C
    }
    else {
        Copy-FrozenTypeboxFixture "version-b-lite-plugin" $routes.B
        Copy-FrozenTypeboxFixture "version-c-strict-plugin" $routes.C
    }

    $officialSeedRelative = @(
        "version-a-skill-only\data\events.JSONL",
        "version-a-skill-only\data\events.jsonl.tmp",
        "version-a-skill-only\data\events.jsonl.journal",
        "version-b-lite-plugin\data\state.SQLITE",
        "version-b-lite-plugin\data\state.sqlite3",
        "version-b-lite-plugin\data\state.sqlite-wal",
        "version-b-lite-plugin\data\state.sqlite-shm",
        "version-b-lite-plugin\data\state.sqlite-journal",
        "version-b-lite-plugin\data\state.sqlite3-wal",
        "version-b-lite-plugin\data\state.sqlite3-shm",
        "version-b-lite-plugin\data\state.sqlite3-journal",
        "version-c-strict-plugin\data\records.DB",
        "version-c-strict-plugin\data\records.db-wal",
        "version-c-strict-plugin\data\records.db-shm",
        "version-c-strict-plugin\data\records.db-journal"
    )
    $projectNonofficialCandidateRelative = @(
        "version-c-strict-plugin\dist\must-scan.SQLITE-WAL"
    )
    $seedRelative = @($officialSeedRelative) + @($projectNonofficialCandidateRelative)
    $index = 0
    foreach ($relative in $seedRelative) {
        $index++
        Write-StableFile (Join-Path $project $relative) ("stable-seed-{0:D2}" -f $index)
    }
    Write-StableFile (Join-Path $project "version-b-lite-plugin\node_modules\ignored.sqlite") "must be excluded"

    $protectedPaths = [ordered]@{
        jiti_openclaw_cache_guard = Join-Path $guardParent "jiti-openclaw"
        node_compile_cache_guard = Join-Path $guardParent "node-compile-openclaw"
        inherited_openclaw_temp_guard = Join-Path $guardParent "openclaw"
        vitest_b_cache_guard = Join-Path $routes.B "node_modules\.vite\vitest"
        vitest_c_cache_guard = Join-Path $routes.C "node_modules\.vite\vitest"
    }
    $guardPaths = @()
    foreach ($guardId in $protectedPaths.Keys) {
        $path = Join-Path ([string]$protectedPaths[$guardId]) "sentinel.txt"
        Write-StableFile $path ("guard-sentinel-" + $guardId)
        $guardPaths += $path
    }
    $runtime = New-TestFixtureRuntime $base $temporaryParent $routes $protectedPaths $TypeboxFixtureProfile

    return [pscustomobject]@{
        typebox_fixture_profile = $TypeboxFixtureProfile
        base = $base
        project = $project
        evidence = $evidence
        external = $external
        temporary_parent = $temporaryParent
        guard_parent = $guardParent
        routes = $routes
        runtime = $runtime
        seed_relative = @($seedRelative)
        seed_paths = @($seedRelative | ForEach-Object { Join-Path $project $_ })
        official_seed_relative = @($officialSeedRelative)
        official_seed_paths = @($officialSeedRelative | ForEach-Object { Join-Path $project $_ })
        project_nonofficial_candidate_relative = @($projectNonofficialCandidateRelative)
        project_nonofficial_candidate_paths = @($projectNonofficialCandidateRelative | ForEach-Object { Join-Path $project $_ })
        guard_paths = @($guardPaths)
    }
}

function Remove-TestFixture {
    param($Fixture)
    if ($null -eq $Fixture) { return }
    $full = [System.IO.Path]::GetFullPath($Fixture.base)
    $temp = $script:TestSystemTempRoot
    if (-not $temp.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $temp += [System.IO.Path]::DirectorySeparatorChar
    }
    if (-not $full.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Fixture cleanup target is outside the system temporary directory: $full"
    }
    $leaf = Split-Path -Leaf $full
    if ($leaf -notmatch '^sh-safe-fixture-[0-9a-f]{32}$') {
        throw "Fixture cleanup leaf is not an exact test-owned name: $leaf"
    }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction SilentlyContinue
    if ($null -ne $item -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Fixture cleanup root is a reparse point: $full"
    }
    if ($null -eq $item) { return }
    if (-not [System.IO.Path]::IsPathRooted($full) -or $full -notmatch '^[A-Za-z]:\\') {
        throw "Fixture cleanup target is not an absolute local-drive path: $full"
    }

    $knownJunctions = @(
        [pscustomobject]@{ link = "project\version-b-lite-plugin\node_modules\typebox"; target = "project\version-b-lite-plugin\node_modules\.pnpm\typebox@1.3.11\node_modules\typebox" },
        [pscustomobject]@{ link = "project\version-c-strict-plugin\node_modules\typebox"; target = "project\version-c-strict-plugin\node_modules\.pnpm\typebox@1.3.11\node_modules\typebox" },
        [pscustomobject]@{ link = "project\version-c-strict-plugin\node_modules\vitest"; target = "project\version-c-strict-plugin\node_modules\.pnpm\vitest@2.1.9_@types+node@26.2.0\node_modules\vitest" },
        [pscustomobject]@{ link = "project\version-c-strict-plugin\node_modules\typescript"; target = "project\version-c-strict-plugin\node_modules\.pnpm\typescript@5.9.3\node_modules\typescript" },
        [pscustomobject]@{ link = "project\version-c-strict-plugin\node_modules\openclaw"; target = "project\version-c-strict-plugin\node_modules\.pnpm\openclaw@2026.7.1\node_modules\openclaw" },
        [pscustomobject]@{ link = "project\version-c-strict-plugin\node_modules\.pnpm\typebox@1.3.11\node_modules\typebox"; target = "external\wrong-typebox" },
        [pscustomobject]@{ link = "project\version-a-skill-only\data"; target = "external\official-data-target" },
        [pscustomobject]@{ link = "project\version-a-skill-only\data\path-helper-parent\linked"; target = "external\path-helper-junction-target" },
        [pscustomobject]@{ link = "trusted-parent-ancestor-link"; target = "external\trusted-parent-ancestor-target" }
    )
    foreach ($pair in $knownJunctions) {
        $junctionPath = [System.IO.Path]::GetFullPath((Join-Path $full $pair.link))
        $junctionItem = Get-Item -LiteralPath $junctionPath -Force -ErrorAction SilentlyContinue
        if ($null -ne $junctionItem -and ($junctionItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            $expectedTarget = [System.IO.Path]::GetFullPath((Join-Path $full $pair.target))
            Remove-TestOwnedJunctionLeaf $Fixture $junctionPath $expectedTarget
        }
    }

    $extendedFull = "\\?\" + $full
    $pending = New-Object 'System.Collections.Generic.Queue[string]'
    $pending.Enqueue($extendedFull)
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($directory)) {
            $attributes = [System.IO.File]::GetAttributes($entry)
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                $displayPath = if ($entry.StartsWith("\\?\", [System.StringComparison]::Ordinal)) { $entry.Substring(4) } else { $entry }
                throw "Fixture cleanup remaining tree contains a reparse point: $displayPath"
            }
            if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
                $pending.Enqueue($entry)
            }
        }
    }
    [System.IO.Directory]::Delete($extendedFull, $true)
    if ([System.IO.Directory]::Exists($extendedFull) -or (Test-Path -LiteralPath $full)) {
        throw "Fixture cleanup target remained after exact deletion: $full"
    }
}

function Get-FileSnapshot {
    param([string[]]$Paths)
    $items = New-Object System.Collections.ArrayList
    foreach ($path in @($Paths | Sort-Object)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            [void]$items.Add([pscustomobject]@{ full_path = $path; exists = $false; length = $null; sha256 = $null; last_write_time_utc = $null })
            continue
        }
        $item = Get-Item -LiteralPath $path
        [void]$items.Add([pscustomobject]@{
            full_path = $item.FullName
            exists = $true
            length = $item.Length
            sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
            last_write_time_utc = $item.LastWriteTimeUtc.ToString("o")
        })
    }
    return @($items)
}

function Get-SnapshotDigest {
    param($Snapshot)
    $lines = @($Snapshot | ForEach-Object { "$($_.full_path)|$($_.exists)|$($_.length)|$($_.sha256)|$($_.last_write_time_utc)" })
    $bytes = $script:Utf8NoBom.GetBytes(($lines -join "`n"))
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
    }
    finally {
        $sha.Dispose()
    }
}

function Get-TextSha256 {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($script:Utf8NoBom.GetBytes($Text)))).Replace("-", "")
    }
    finally {
        $sha.Dispose()
    }
}

function Get-BytesSha256 {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "")
    }
    finally {
        $sha.Dispose()
    }
}

function Get-FrozenPolicyContract {
    Assert-True (Test-Path -LiteralPath $frozenBriefPath -PathType Leaf) "Frozen SH-SAFE brief is missing"
    Assert-Equal $frozenBriefSha256 (Get-FileHash -LiteralPath $frozenBriefPath -Algorithm SHA256).Hash "Frozen SH-SAFE brief SHA-256"

    $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $briefBytes = [System.IO.File]::ReadAllBytes($frozenBriefPath)
    $briefText = $strictUtf8.GetString($briefBytes)
    $firstLine = "import { createRequire, syncBuiltinESMExports } from 'node:module';"
    $openFence = '```javascript' + "`n"
    $openMarker = $openFence + $firstLine
    $openIndex = $briefText.IndexOf($openMarker, [System.StringComparison]::Ordinal)
    Assert-True ($openIndex -ge 0) "Frozen policy opening marker is missing"
    Assert-Equal -1 ($briefText.IndexOf($openMarker, $openIndex + 1, [System.StringComparison]::Ordinal)) "Frozen policy opening marker is ambiguous"
    $contentStart = $openIndex + $openFence.Length
    $closeMarker = "`n" + '```'
    $closeIndex = $briefText.IndexOf($closeMarker, $contentStart, [System.StringComparison]::Ordinal)
    Assert-True ($closeIndex -gt $contentStart) "Frozen policy closing marker is missing"
    $policyText = $briefText.Substring($contentStart, $closeIndex - $contentStart)
    $policyBytes = $strictUtf8.GetBytes($policyText)

    Assert-Equal $frozenPolicyLength $policyBytes.Length "Frozen policy byte length"
    Assert-Equal $frozenPolicyLineCount $policyText.Split([char]10).Count "Frozen policy line count"
    Assert-Equal $frozenPolicySha256 (Get-BytesSha256 $policyBytes) "Frozen policy SHA-256"
    Assert-True (-not $policyText.EndsWith("`n", [System.StringComparison]::Ordinal)) "Frozen policy has a trailing LF"
    Assert-True ($policyText.IndexOf("`r", [System.StringComparison]::Ordinal) -lt 0) "Frozen policy contains CR"
    foreach ($byte in $policyBytes) {
        Assert-True ($byte -le 127) "Frozen policy contains a non-ASCII byte"
    }

    return [pscustomobject][ordered]@{
        text = $policyText
        bytes = $policyBytes
        line_count = $frozenPolicyLineCount
        length = $frozenPolicyLength
        sha256 = $frozenPolicySha256
    }
}

function Assert-SnapshotsEqual {
    param($Before, $After, [string]$Label)
    Assert-Equal (Get-SnapshotDigest $Before) (Get-SnapshotDigest $After) "$Label snapshot changed"
}

function Assert-Null {
    param($Actual, [string]$Message)
    if ($null -ne $Actual) {
        throw "$Message; expected=[null] actual=[$Actual]"
    }
}

function Assert-EmptyDiff {
    param($Diff, [string]$Label)
    Assert-True ($null -ne $Diff) "$Label diff missing"
    Assert-Equal 0 @($Diff.added).Count "$Label added diff"
    Assert-Equal 0 @($Diff.modified).Count "$Label modified diff"
    Assert-Equal 0 @($Diff.deleted).Count "$Label deleted diff"
}

function Assert-TestCanonicalDigestField {
    param([string]$Value, [string]$Label, [bool]$AllowEmpty)
    if (-not $AllowEmpty) {
        Assert-True (-not [string]::IsNullOrEmpty($Value)) "$Label is empty"
    }
    Assert-True ($Value.IndexOf("|") -lt 0) "$Label contains a pipe"
    Assert-True ($Value.IndexOf("`r") -lt 0) "$Label contains CR"
    Assert-True ($Value.IndexOf("`n") -lt 0) "$Label contains LF"
}

function Get-TestOfficialObservationDigest {
    param($Observation)
    Assert-True ($null -ne $Observation) "Official observation is missing"
    Assert-Equal "official-state-observation/v1" ([string]$Observation.schema_version) "Official observation schema"
    Assert-True ([bool]$Observation.completed) "Official observation is not completed"

    $routeOrder = @("A", "B", "C")
    $rootRows = @($Observation.roots)
    Assert-Equal 3 $rootRows.Count "Official observation root count"
    $rootByRoute = @{}
    $records = New-Object 'System.Collections.Generic.List[string]'
    $records.Add("V|official-state-observation/v1")

    for ($rootIndex = 0; $rootIndex -lt $routeOrder.Count; $rootIndex++) {
        $expectedRoute = $routeOrder[$rootIndex]
        $rootRow = $rootRows[$rootIndex]
        foreach ($field in @("route", "path", "exists", "scan_status", "error_code")) {
            Assert-True ($null -ne $rootRow.PSObject.Properties[$field]) "Official root field missing: $expectedRoute/$field"
        }
        $route = [string]$rootRow.route
        Assert-True ($route -ceq $expectedRoute) "Official root order or case mismatch: $expectedRoute"
        $rootPath = [System.IO.Path]::GetFullPath([string]$rootRow.path).TrimEnd("\", "/")
        Assert-Equal $rootPath ([string]$rootRow.path).TrimEnd("\", "/") "Official root path is not normalized: $route"
        $scanStatus = [string]$rootRow.scan_status
        Assert-True (@("scanned", "missing", "blocked", "unobserved") -ccontains $scanStatus) "Official root scan status: $route"

        $existsToken = "null"
        if ($null -ne $rootRow.exists) {
            Assert-True ($rootRow.exists -is [bool]) "Official root exists is not Boolean or null: $route"
            if ([bool]$rootRow.exists) { $existsToken = "true" } else { $existsToken = "false" }
        }
        $errorCode = ""
        if ($scanStatus -in @("scanned", "missing")) {
            Assert-Null $rootRow.error_code "Official safe root error code: $route"
        }
        else {
            $errorCode = [string]$rootRow.error_code
            Assert-True (-not [string]::IsNullOrWhiteSpace($errorCode)) "Official blocked/unobserved root error code: $route"
        }
        Assert-TestCanonicalDigestField $route "Official root route" $false
        Assert-TestCanonicalDigestField $rootPath "Official root path: $route" $false
        Assert-TestCanonicalDigestField $scanStatus "Official root scan status: $route" $false
        Assert-TestCanonicalDigestField $errorCode "Official root error code: $route" $true
        $records.Add("R|$route|$rootPath|$existsToken|$scanStatus|$errorCode")
        $rootByRoute[$route] = [pscustomobject]@{ row = $rootRow; path = $rootPath }
    }

    $entryLinesByRoute = @{}
    foreach ($route in $routeOrder) {
        $entryLinesByRoute[$route] = New-Object 'System.Collections.Generic.List[string]'
    }
    $seenEntryKeys = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($Observation.entries)) {
        foreach ($field in @("route", "full_path", "relative_path", "root_labels", "length", "sha256", "last_write_time_utc")) {
            Assert-True ($null -ne $entry.PSObject.Properties[$field]) "Official entry field missing: $field"
        }
        $route = [string]$entry.route
        Assert-True ($routeOrder -ccontains $route) "Official entry route: $route"
        Assert-Equal "scanned" ([string]$rootByRoute[$route].row.scan_status) "Official entry belongs to a non-scanned route: $route"
        $relativePath = [string]$entry.relative_path
        Assert-TestCanonicalDigestField $relativePath "Official entry relative path: $route" $false
        Assert-True (-not [System.IO.Path]::IsPathRooted($relativePath)) "Official entry relative path is rooted: $route/$relativePath"
        Assert-True (-not $relativePath.StartsWith("\")) "Official entry relative path has a leading separator: $route/$relativePath"
        Assert-True ($relativePath.IndexOf("/") -lt 0) "Official entry relative path contains a forward slash: $route/$relativePath"
        foreach ($segment in @($relativePath -split '\\')) {
            Assert-True (-not [string]::IsNullOrEmpty($segment) -and $segment -ne "." -and $segment -ne "..") "Official entry relative path segment: $route/$relativePath"
        }

        $entryKey = "$route|$relativePath"
        Assert-True ($seenEntryKeys.Add($entryKey)) "Duplicate official route/relative path: $entryKey"
        $expectedFullPath = [System.IO.Path]::GetFullPath((Join-Path ([string]$rootByRoute[$route].path) $relativePath))
        $actualFullPath = [System.IO.Path]::GetFullPath([string]$entry.full_path)
        Assert-Equal $expectedFullPath $actualFullPath "Official entry full path: $entryKey"
        Assert-TestCanonicalDigestField $actualFullPath "Official entry full path: $entryKey" $false
        Assert-True (-not ($entry.root_labels -is [string])) "Official entry root_labels was stringified: $entryKey"
        Assert-True (@($entry.root_labels).Count -ge 1) "Official entry root_labels is empty: $entryKey"

        $length = [long]$entry.length
        Assert-True ($length -ge 0) "Official entry length is negative: $entryKey"
        $lengthText = $length.ToString([System.Globalization.CultureInfo]::InvariantCulture)
        $sha256 = [string]$entry.sha256
        Assert-True ($sha256 -cmatch '^[A-F0-9]{64}$') "Official entry SHA-256 is not uppercase canonical: $entryKey"
        $mtime = [string]$entry.last_write_time_utc
        Assert-True ($mtime -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}(?:Z|\+00:00)$') "Official entry mtime is not UTC round-trip: $entryKey"
        $parsedMtime = [datetimeoffset]::ParseExact($mtime, "o", [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
        Assert-Equal ([timespan]::Zero) $parsedMtime.Offset "Official entry mtime offset: $entryKey"
        Assert-TestCanonicalDigestField $sha256 "Official entry SHA-256: $entryKey" $false
        Assert-TestCanonicalDigestField $mtime "Official entry mtime: $entryKey" $false
        $entryLinesByRoute[$route].Add("F|$route|$relativePath|$lengthText|$sha256|$mtime")
    }

    foreach ($route in $routeOrder) {
        $entryLinesByRoute[$route].Sort([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($line in $entryLinesByRoute[$route]) { $records.Add($line) }
    }
    return Get-TextSha256 (@($records) -join "`n")
}

function Assert-OfficialObservationAndGetCanonicalDigest {
    param($Observation, [string]$ExpectedScopeId, $Fixture, [string]$Label)

    Assert-True ($null -ne $Observation) "$Label observation is missing"
    foreach ($field in @("schema_version", "scope_id", "completed", "coverage_complete", "state_digest", "roots", "entries")) {
        Assert-True ($null -ne $Observation.PSObject.Properties[$field]) "$Label observation field missing: $field"
    }
    Assert-Equal "official-state-observation/v1" ([string]$Observation.schema_version) "$Label schema"
    Assert-Equal $ExpectedScopeId ([string]$Observation.scope_id) "$Label scope"
    Assert-True ($Observation.completed -is [bool] -and [bool]$Observation.completed) "$Label completed"
    Assert-True ($Observation.coverage_complete -is [bool]) "$Label coverage type"
    Assert-True (-not ($Observation.roots -is [string])) "$Label roots were stringified"
    Assert-True (-not ($Observation.entries -is [string])) "$Label entries were stringified"

    $routeOrder = @("A", "B", "C")
    $rootRows = @($Observation.roots)
    Assert-Equal 3 $rootRows.Count "$Label root count"
    $expectedCoverage = $true
    for ($rootIndex = 0; $rootIndex -lt $routeOrder.Count; $rootIndex++) {
        $route = $routeOrder[$rootIndex]
        $row = $rootRows[$rootIndex]
        Assert-True ([string]$row.route -ceq $route) "$Label root order: $route"
        $expectedPath = [System.IO.Path]::GetFullPath((Join-Path $Fixture.routes[$route] "data")).TrimEnd("\", "/")
        $actualPath = [System.IO.Path]::GetFullPath([string]$row.path).TrimEnd("\", "/")
        Assert-Equal $expectedPath $actualPath "$Label root path: $route"
        if ([string]$row.scan_status -notin @("scanned", "missing")) {
            $expectedCoverage = $false
        }
    }
    Assert-Equal $expectedCoverage ([bool]$Observation.coverage_complete) "$Label coverage"

    $canonicalDigest = Get-TestOfficialObservationDigest $Observation
    Assert-True ([string]$Observation.state_digest -cmatch '^[A-F0-9]{64}$') "$Label state digest format"
    Assert-Equal $canonicalDigest ([string]$Observation.state_digest) "$Label state digest"
    return $canonicalDigest
}

function Get-TestBusinessCandidateKind {
    param([string]$Path)

    $leaf = [System.IO.Path]::GetFileName($Path)
    foreach ($suffix in @(
        ".sqlite3-journal", ".sqlite3-wal", ".sqlite3-shm",
        ".sqlite-journal", ".sqlite-wal", ".sqlite-shm",
        ".db-journal", ".db-wal", ".db-shm",
        ".jsonl.journal", ".jsonl.tmp"
    )) {
        if ($leaf.EndsWith($suffix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return "sidecar"
        }
    }
    foreach ($suffix in @(".sqlite3", ".sqlite", ".jsonl", ".db")) {
        if ($leaf.EndsWith($suffix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return "business"
        }
    }
    throw "Project manifest entry is not a frozen business candidate: $Path"
}

function Assert-ProjectBusinessCandidateObservation {
    param($Observation, [string]$ExpectedScopeId, $Fixture, [string]$Label)

    Assert-True ($null -ne $Observation) "$Label observation is missing"
    foreach ($field in @("scope_id", "completed", "roots", "entries")) {
        Assert-True ($null -ne $Observation.PSObject.Properties[$field]) "$Label observation field missing: $field"
    }
    Assert-Equal $ExpectedScopeId ([string]$Observation.scope_id) "$Label scope"
    Assert-True ($Observation.completed -is [bool]) "$Label completed type"
    Assert-True (-not ($Observation.roots -is [string])) "$Label roots were stringified"
    Assert-True (-not ($Observation.entries -is [string])) "$Label entries were stringified"

    $expectedRoots = @(
        [pscustomobject]@{ root_id = "project_root"; path = [System.IO.Path]::GetFullPath($Fixture.project).TrimEnd("\", "/") },
        [pscustomobject]@{ root_id = "route_A"; path = [System.IO.Path]::GetFullPath($Fixture.routes.A).TrimEnd("\", "/") },
        [pscustomobject]@{ root_id = "route_B"; path = [System.IO.Path]::GetFullPath($Fixture.routes.B).TrimEnd("\", "/") },
        [pscustomobject]@{ root_id = "route_C"; path = [System.IO.Path]::GetFullPath($Fixture.routes.C).TrimEnd("\", "/") }
    )
    $rootRows = @($Observation.roots)
    Assert-Equal 4 $rootRows.Count "$Label root count"
    $rootById = @{}
    $allRootsSafe = $true
    foreach ($expectedRoot in $expectedRoots) {
        $matches = @($rootRows | Where-Object { [string]$_.root_id -ceq [string]$expectedRoot.root_id })
        Assert-Equal 1 $matches.Count "$Label root row: $($expectedRoot.root_id)"
        $row = $matches[0]
        foreach ($field in @("root_id", "path", "exists", "scan_status", "error_code")) {
            Assert-True ($null -ne $row.PSObject.Properties[$field]) "$Label root field missing: $($expectedRoot.root_id)/$field"
        }
        $actualRootPath = [System.IO.Path]::GetFullPath([string]$row.path).TrimEnd("\", "/")
        Assert-Equal ([string]$expectedRoot.path) $actualRootPath "$Label root path: $($expectedRoot.root_id)"
        Assert-True ($null -eq $row.exists -or $row.exists -is [bool]) "$Label root exists type: $($expectedRoot.root_id)"
        $scanStatus = [string]$row.scan_status
        Assert-True (@("scanned", "missing", "blocked", "unobserved") -ccontains $scanStatus) "$Label root status: $($expectedRoot.root_id)"
        if ($scanStatus -in @("scanned", "missing")) {
            Assert-Null $row.error_code "$Label safe root error: $($expectedRoot.root_id)"
        }
        else {
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$row.error_code)) "$Label unsafe root error: $($expectedRoot.root_id)"
            $allRootsSafe = $false
        }
        $rootById[[string]$expectedRoot.root_id] = [pscustomobject]@{ row = $row; path = $actualRootPath }
    }
    Assert-Equal $allRootsSafe ([bool]$Observation.completed) "$Label completed value"

    $projectRoot = [System.IO.Path]::GetFullPath($Fixture.project).TrimEnd("\", "/")
    $projectPrefix = $projectRoot + [System.IO.Path]::DirectorySeparatorChar
    $seenPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($Observation.entries)) {
        foreach ($field in @("full_path", "relative_path", "root_labels", "length", "sha256", "last_write_time_utc", "classification", "candidate_kind")) {
            Assert-True ($null -ne $entry.PSObject.Properties[$field]) "$Label entry field missing: $field"
        }
        $fullPath = [System.IO.Path]::GetFullPath([string]$entry.full_path)
        Assert-Equal $fullPath ([string]$entry.full_path) "$Label entry path is not normalized"
        Assert-True ($fullPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) "$Label entry escaped project root: $fullPath"
        Assert-True ($seenPaths.Add($fullPath)) "$Label duplicate entry path: $fullPath"
        $expectedRelativePath = $fullPath.Substring($projectPrefix.Length)
        $relativePath = [string]$entry.relative_path
        Assert-Equal $expectedRelativePath $relativePath "$Label entry relative path: $fullPath"
        Assert-True (-not [System.IO.Path]::IsPathRooted($relativePath) -and -not $relativePath.StartsWith("\") -and $relativePath.IndexOf("/") -lt 0) "$Label entry relative path form: $fullPath"
        foreach ($segment in @($relativePath -split '\\')) {
            Assert-True (-not [string]::IsNullOrEmpty($segment) -and $segment -ne "." -and $segment -ne "..") "$Label entry relative segment: $fullPath"
        }
        Assert-Equal "business_candidate" ([string]$entry.classification) "$Label entry classification: $fullPath"
        Assert-Equal (Get-TestBusinessCandidateKind $fullPath) ([string]$entry.candidate_kind) "$Label entry candidate kind: $fullPath"
        Assert-True ([long]$entry.length -ge 0) "$Label entry length: $fullPath"
        Assert-True ([string]$entry.sha256 -cmatch '^[A-F0-9]{64}$') "$Label entry SHA-256: $fullPath"
        $mtime = [string]$entry.last_write_time_utc
        Assert-True ($mtime -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}(?:Z|\+00:00)$') "$Label entry mtime: $fullPath"
        $parsedMtime = [datetimeoffset]::ParseExact($mtime, "o", [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
        Assert-Equal ([timespan]::Zero) $parsedMtime.Offset "$Label entry mtime offset: $fullPath"

        Assert-True (-not ($entry.root_labels -is [string])) "$Label entry root labels were stringified: $fullPath"
        $actualLabels = @($entry.root_labels | ForEach-Object { [string]$_ })
        Assert-True ($actualLabels.Count -ge 1) "$Label entry root labels are empty: $fullPath"
        $sortedActualLabels = New-Object 'System.Collections.Generic.List[string]'
        foreach ($rootLabel in $actualLabels) { $sortedActualLabels.Add($rootLabel) }
        $sortedActualLabels.Sort([System.StringComparer]::OrdinalIgnoreCase)
        Assert-Equal (@($sortedActualLabels) -join "|") ($actualLabels -join "|") "$Label entry root label order: $fullPath"
        Assert-Equal $actualLabels.Count @($actualLabels | Sort-Object -Unique).Count "$Label duplicate root label: $fullPath"

        $expectedLabels = New-Object 'System.Collections.Generic.List[string]'
        foreach ($expectedRoot in $expectedRoots) {
            $rootState = $rootById[[string]$expectedRoot.root_id]
            if ([string]$rootState.row.scan_status -ne "scanned") { continue }
            $rootPath = [string]$rootState.path
            $rootPrefix = $rootPath + [System.IO.Path]::DirectorySeparatorChar
            if ($fullPath.Equals($rootPath, [System.StringComparison]::OrdinalIgnoreCase) -or $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $expectedLabels.Add([string]$expectedRoot.root_id)
            }
        }
        $expectedLabels.Sort([System.StringComparer]::OrdinalIgnoreCase)
        Assert-Equal (@($expectedLabels) -join "|") ($actualLabels -join "|") "$Label entry root labels: $fullPath"
    }
}

function Assert-ProjectBusinessCandidatePair {
    param($Report, $Fixture, [string]$Label)

    Assert-True ($null -ne $Report.manifests.project_business_candidates) "$Label project candidate manifest is missing"
    $projectManifest = $Report.manifests.project_business_candidates
    foreach ($field in @("before", "after", "diff")) {
        Assert-True ($null -ne $projectManifest.PSObject.Properties[$field]) "$Label project candidate field missing: $field"
        Assert-True ($null -ne $projectManifest.$field) "$Label project candidate value missing: $field"
    }
    Assert-True (-not [object]::ReferenceEquals($projectManifest.before, $projectManifest.after)) "$Label project candidate after reused before"
    foreach ($projectObservation in @($projectManifest.before, $projectManifest.after)) {
        foreach ($officialObservation in @($Report.manifests.official.before, $Report.manifests.official.after)) {
            Assert-True (-not [object]::ReferenceEquals($projectObservation, $officialObservation)) "$Label project candidate observation reused official observation"
        }
    }
    Assert-ProjectBusinessCandidateObservation $projectManifest.before "project_business_candidates_before" $Fixture "$Label project before"
    Assert-ProjectBusinessCandidateObservation $projectManifest.after "project_business_candidates_after" $Fixture "$Label project after"

    $diff = $projectManifest.diff
    foreach ($field in @("added", "modified", "deleted")) {
        Assert-True ($null -ne $diff.PSObject.Properties[$field]) "$Label project diff field missing: $field"
        Assert-True (-not ($diff.$field -is [string])) "$Label project diff was stringified: $field"
    }
    $beforeEntries = @($projectManifest.before.entries)
    $afterEntries = @($projectManifest.after.entries)
    $seenDiffPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $errorCodes = @($Report.errors | ForEach-Object { [string]$_.code })
    foreach ($change in @(
        [pscustomobject]@{ name = "added"; code = "PROJECT_BUSINESS_CANDIDATE_ADDED" },
        [pscustomobject]@{ name = "modified"; code = "PROJECT_BUSINESS_CANDIDATE_MODIFIED" },
        [pscustomobject]@{ name = "deleted"; code = "PROJECT_BUSINESS_CANDIDATE_DELETED" }
    )) {
        $items = @($diff.([string]$change.name))
        if ($items.Count -gt 0) {
            Assert-Equal 1 @($errorCodes | Where-Object { $_ -ceq [string]$change.code }).Count "$Label project diff error code: $($change.code)"
        }
        foreach ($item in $items) {
            Assert-True ($null -ne $item.PSObject.Properties["full_path"]) "$Label project diff path missing: $($change.name)"
            $fullPath = [System.IO.Path]::GetFullPath([string]$item.full_path)
            Assert-Equal $fullPath ([string]$item.full_path) "$Label project diff path is not normalized: $($change.name)"
            Assert-True ($seenDiffPaths.Add($fullPath)) "$Label duplicate project diff path: $fullPath"
            $beforeMatches = @($beforeEntries | Where-Object { ([string]$_.full_path).Equals($fullPath, [System.StringComparison]::OrdinalIgnoreCase) })
            $afterMatches = @($afterEntries | Where-Object { ([string]$_.full_path).Equals($fullPath, [System.StringComparison]::OrdinalIgnoreCase) })
            if ([string]$change.name -eq "added") {
                Assert-Equal 0 $beforeMatches.Count "$Label project added path existed before: $fullPath"
                Assert-Equal 1 $afterMatches.Count "$Label project added path missing after: $fullPath"
            }
            elseif ([string]$change.name -eq "deleted") {
                Assert-Equal 1 $beforeMatches.Count "$Label project deleted path missing before: $fullPath"
                Assert-Equal 0 $afterMatches.Count "$Label project deleted path remained after: $fullPath"
            }
            else {
                Assert-Equal 1 $beforeMatches.Count "$Label project modified path missing before: $fullPath"
                Assert-Equal 1 $afterMatches.Count "$Label project modified path missing after: $fullPath"
                Assert-True ($null -ne $item.PSObject.Properties["before"] -and $null -ne $item.before) "$Label project modified before object missing: $fullPath"
                Assert-True ($null -ne $item.PSObject.Properties["after"] -and $null -ne $item.after) "$Label project modified after object missing: $fullPath"
                Assert-Equal $fullPath ([System.IO.Path]::GetFullPath([string]$item.before.full_path)) "$Label project modified before path: $fullPath"
                Assert-Equal $fullPath ([System.IO.Path]::GetFullPath([string]$item.after.full_path)) "$Label project modified after path: $fullPath"
                $sameContent = [long]$item.before.length -eq [long]$item.after.length -and
                    [string]$item.before.sha256 -eq [string]$item.after.sha256 -and
                    [string]$item.before.last_write_time_utc -eq [string]$item.after.last_write_time_utc
                Assert-True (-not $sameContent) "$Label project modified entry did not change: $fullPath"
            }
        }
    }

    Assert-True ($null -ne $Report.business_impact) "$Label business impact is missing"
    $impactMap = @{
        added = "project_candidate_added"
        modified = "project_candidate_modified"
        deleted = "project_candidate_deleted"
    }
    foreach ($changeName in @("added", "modified", "deleted")) {
        $impactField = [string]$impactMap[$changeName]
        Assert-True ($null -ne $Report.business_impact.PSObject.Properties[$impactField]) "$Label business impact field missing: $impactField"
        Assert-Equal @($diff.$changeName).Count ([int]$Report.business_impact.$impactField) "$Label business impact count: $impactField"
    }

    if ($null -ne $Report.fault) {
        Assert-True (-not [object]::ReferenceEquals($Report.fault.official_business_data_diff, $diff)) "$Label fault official diff reused project diff"
        foreach ($changeName in @("added", "modified", "deleted")) {
            $officialItems = @($Report.manifests.official.diff.$changeName)
            $faultItems = @($Report.fault.official_business_data_diff.$changeName)
            Assert-Equal $officialItems.Count $faultItems.Count "$Label fault official diff count: $changeName"
            Assert-Equal (Get-OrdinalIgnoreCaseSignature @($officialItems | ForEach-Object { [string]$_.full_path })) (Get-OrdinalIgnoreCaseSignature @($faultItems | ForEach-Object { [string]$_.full_path })) "$Label fault official diff paths: $changeName"
        }
    }
}

function Assert-OfficialObservationPair {
    param($Report, $Fixture, [string]$Label)

    Assert-True ($null -ne $Report) "$Label report is missing"
    Assert-True ($null -ne $Report.manifests) "$Label manifests are missing"
    Assert-True ($null -ne $Report.manifests.official) "$Label official manifests are missing"
    $beforeObservation = $Report.manifests.official.before
    $afterObservation = $Report.manifests.official.after
    Assert-True (-not [object]::ReferenceEquals($beforeObservation, $afterObservation)) "$Label after observation reused before object"
    $preStateHash = Assert-OfficialObservationAndGetCanonicalDigest $beforeObservation "official_before" $Fixture "$Label before"
    $postStateHash = Assert-OfficialObservationAndGetCanonicalDigest $afterObservation "official_after" $Fixture "$Label after"
    Assert-ProjectBusinessCandidatePair $Report $Fixture $Label
    return [pscustomobject]@{
        pre_state_hash = $preStateHash
        post_state_hash = $postStateHash
    }
}

function Throw-TestHarnessPathOutsideFixture {
    param([string]$Detail)
    throw "TEST_HARNESS_PATH_OUTSIDE_FIXTURE|$Detail"
}

function Resolve-TestHarnessPathWithinFixture {
    param([string]$FixtureBase, [string]$CandidatePath)
    try {
        if ([string]::IsNullOrWhiteSpace($FixtureBase) -or [string]::IsNullOrWhiteSpace($CandidatePath)) {
            Throw-TestHarnessPathOutsideFixture "empty fixture or candidate path"
        }
        $baseFull = [System.IO.Path]::GetFullPath($FixtureBase).TrimEnd("\", "/")
        $candidateFull = [System.IO.Path]::GetFullPath($CandidatePath).TrimEnd("\", "/")
    }
    catch {
        if ($_.Exception.Message -like "TEST_HARNESS_PATH_OUTSIDE_FIXTURE*") { throw }
        Throw-TestHarnessPathOutsideFixture $_.Exception.Message
    }

    $prefix = $baseFull + [System.IO.Path]::DirectorySeparatorChar
    if ($candidateFull.Equals($baseFull, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Throw-TestHarnessPathOutsideFixture "candidate is not a strict descendant of fixture base"
    }

    $probe = $candidateFull
    while (-not (Test-Path -LiteralPath $probe) -and -not $probe.Equals($baseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $parent = Split-Path -Parent $probe
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $probe) {
            Throw-TestHarnessPathOutsideFixture "candidate has no contained existing ancestor"
        }
        $probe = $parent
    }
    while ($probe.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $probe) {
            $item = Get-Item -LiteralPath $probe -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                Throw-TestHarnessPathOutsideFixture "candidate traverses a reparse point"
            }
        }
        $parent = Split-Path -Parent $probe
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $probe) { break }
        $probe = $parent
    }
    return $candidateFull
}

function Get-TestPhysicalTreeDigest {
    param($Fixture, [string]$Root)
    $safeRoot = Resolve-TestHarnessPathWithinFixture $Fixture.base $Root
    Assert-True (Test-Path -LiteralPath $safeRoot -PathType Container) "Physical tree root missing: $safeRoot"
    $metadataWarmup = @(Get-ChildItem -LiteralPath $safeRoot -Recurse -Force)
    foreach ($warmupItem in $metadataWarmup) {
        Assert-True (($warmupItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Physical tree warmup contains a reparse point: $($warmupItem.FullName)"
    }
    $rootItem = Get-Item -LiteralPath $safeRoot -Force
    Assert-True (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Physical tree root is a reparse point: $safeRoot"
    $prefixLength = $safeRoot.TrimEnd("\", "/").Length + 1
    $rows = New-Object System.Collections.Generic.List[string]
    $rows.Add("R||$($rootItem.LastWriteTimeUtc.ToString('o'))")
    foreach ($item in @(Get-ChildItem -LiteralPath $safeRoot -Recurse -Force)) {
        Assert-True (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Physical tree contains a reparse point: $($item.FullName)"
        $relative = $item.FullName.Substring($prefixLength).Replace("/", "\")
        if ($item.PSIsContainer) {
            $rows.Add("D|$relative|$($item.LastWriteTimeUtc.ToString('o'))")
        }
        else {
            $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
            $rows.Add("F|$relative|$($item.Length)|$hash|$($item.LastWriteTimeUtc.ToString('o'))")
        }
    }
    $rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return Get-TextSha256 (@($rows) -join "`n")
}

function Remove-TestOwnedJunctionLeaf {
    param($Fixture, [string]$JunctionPath, [string]$ExpectedTarget)
    $fixtureBase = [System.IO.Path]::GetFullPath([string]$Fixture.base).TrimEnd("\", "/")
    $candidateParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $JunctionPath)).TrimEnd("\", "/")
    if ($candidateParent.Equals($fixtureBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        $baseItem = Get-Item -LiteralPath $fixtureBase -Force
        Assert-True (($baseItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Test-owned junction parent fixture base is a reparse point"
        $safeParent = $fixtureBase
    }
    else {
        $safeParent = Resolve-TestHarnessPathWithinFixture $Fixture.base $candidateParent
    }
    $expectedLink = [System.IO.Path]::GetFullPath((Join-Path $safeParent (Split-Path -Leaf $JunctionPath)))
    $actualLink = [System.IO.Path]::GetFullPath($JunctionPath)
    Assert-Equal $expectedLink $actualLink "Test-owned junction exact leaf"
    $item = Get-Item -LiteralPath $actualLink -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) { return }
    Assert-True (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) "Test-owned junction leaf is not a reparse point"
    $targets = @($item.Target)
    Assert-Equal 1 $targets.Count "Test-owned junction target count"
    Assert-Equal ([System.IO.Path]::GetFullPath($ExpectedTarget)) ([System.IO.Path]::GetFullPath([string]$targets[0])) "Test-owned junction target"
    [System.IO.Directory]::Delete($actualLink)
    Assert-True (-not (Test-Path -LiteralPath $actualLink)) "Test-owned junction leaf remained"
}

function Assert-TestHarnessExactRunRoot {
    param($Scenario, [string]$RootId, [string]$CandidatePath)
    if ($null -eq $Scenario -or -not $Scenario.allowed_run_roots.ContainsKey($RootId)) {
        Throw-TestHarnessPathOutsideFixture "unregistered run root id: $RootId"
    }
    $candidateFull = Resolve-TestHarnessPathWithinFixture $Scenario.fixture.base $CandidatePath
    $expectedFull = Resolve-TestHarnessPathWithinFixture $Scenario.fixture.base ([string]$Scenario.allowed_run_roots[$RootId])
    if (-not $candidateFull.Equals($expectedFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Throw-TestHarnessPathOutsideFixture "candidate does not equal preregistered run root: $RootId"
    }
    return $candidateFull
}

function Throw-TestHarnessReparsePointRejected {
    param([string]$Detail)
    throw "TEST_HARNESS_REPARSE_POINT_REJECTED|$Detail"
}

function ConvertTo-TestHarnessExtendedLocalPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        Throw-TestHarnessPathOutsideFixture "empty local-drive path"
    }
    try {
        $full = [System.IO.Path]::GetFullPath($Path).TrimEnd("\", "/")
        $driveRoot = [System.IO.Path]::GetPathRoot($full)
    }
    catch {
        if ($_.Exception.Message -like "TEST_HARNESS_PATH_OUTSIDE_FIXTURE*") { throw }
        Throw-TestHarnessPathOutsideFixture $_.Exception.Message
    }
    if (-not [System.IO.Path]::IsPathRooted($full) -or
        $full -notmatch '^[A-Za-z]:\\' -or
        [string]::IsNullOrWhiteSpace($driveRoot) -or
        $driveRoot -notmatch '^[A-Za-z]:\\$') {
        Throw-TestHarnessPathOutsideFixture "path is not an absolute local-drive path"
    }
    return "\\?\" + $full
}

function Copy-TestHarnessImmediateOrdinaryFilesExtended {
    param([string]$SourceRoot, [string]$DestinationRoot)

    $extendedSourceRoot = ConvertTo-TestHarnessExtendedLocalPath $SourceRoot
    $extendedDestinationRoot = ConvertTo-TestHarnessExtendedLocalPath $DestinationRoot
    Assert-True ([System.IO.Directory]::Exists($extendedSourceRoot)) "Extended copy source root missing: $SourceRoot"
    Assert-True ([System.IO.Directory]::Exists($extendedDestinationRoot)) "Extended copy destination root missing: $DestinationRoot"

    foreach ($root in @(
        [pscustomobject]@{ label = "source"; path = $extendedSourceRoot },
        [pscustomobject]@{ label = "destination"; path = $extendedDestinationRoot }
    )) {
        $attributes = [System.IO.File]::GetAttributes([string]$root.path)
        Assert-True (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) "Extended copy $($root.label) root is not a directory"
        Assert-True (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Extended copy $($root.label) root is a reparse point"
        Assert-True (($attributes -band [System.IO.FileAttributes]::Device) -eq 0) "Extended copy $($root.label) root is a device"
    }

    $existingDestinationEntries = @([System.IO.Directory]::EnumerateFileSystemEntries($extendedDestinationRoot))
    Assert-Equal 0 $existingDestinationEntries.Count "Extended copy destination must start empty"
    $sourceEntries = @([System.IO.Directory]::EnumerateFileSystemEntries($extendedSourceRoot))
    Assert-True ($sourceEntries.Count -gt 0) "Extended copy source contains no immediate journal files"
    $seenLeaves = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $copied = New-Object System.Collections.ArrayList
    foreach ($sourceEntry in $sourceEntries) {
        $sourceAttributes = [System.IO.File]::GetAttributes([string]$sourceEntry)
        Assert-True (($sourceAttributes -band [System.IO.FileAttributes]::Directory) -eq 0) "Extended copy source contains an immediate directory: $sourceEntry"
        Assert-True (($sourceAttributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Extended copy source contains an immediate reparse point: $sourceEntry"
        Assert-True (($sourceAttributes -band [System.IO.FileAttributes]::Device) -eq 0) "Extended copy source contains an immediate device: $sourceEntry"

        $leaf = [System.IO.Path]::GetFileName([string]$sourceEntry)
        $singleSegment = -not [string]::IsNullOrWhiteSpace($leaf) -and
            $leaf -cne "." -and $leaf -cne ".." -and
            -not [System.IO.Path]::IsPathRooted($leaf) -and
            $leaf.IndexOf([char]'\') -lt 0 -and $leaf.IndexOf([char]'/') -lt 0 -and
            [string]::Equals($leaf, [System.IO.Path]::GetFileName($leaf), [System.StringComparison]::Ordinal)
        Assert-True $singleSegment "Extended copy source leaf is not one strict segment: $leaf"
        Assert-True ($seenLeaves.Add($leaf)) "Extended copy source leaf is not OrdinalIgnoreCase-unique: $leaf"

        $destinationEntry = [System.IO.Path]::Combine($extendedDestinationRoot, $leaf)
        Assert-True ([string]::Equals([System.IO.Path]::GetDirectoryName($destinationEntry).TrimEnd("\", "/"), $extendedDestinationRoot.TrimEnd("\", "/"), [System.StringComparison]::OrdinalIgnoreCase)) "Extended copy destination escaped its root: $leaf"
        Assert-True (-not [System.IO.File]::Exists($destinationEntry) -and -not [System.IO.Directory]::Exists($destinationEntry)) "Extended copy destination already exists: $leaf"

        $sourceBefore = [System.IO.File]::ReadAllBytes([string]$sourceEntry)
        $sourceLength = [long]$sourceBefore.LongLength
        $sourceSha256 = Get-BytesSha256 $sourceBefore
        [System.IO.File]::Copy([string]$sourceEntry, $destinationEntry, $false)
        $sourceAfter = [System.IO.File]::ReadAllBytes([string]$sourceEntry)
        $destinationBytes = [System.IO.File]::ReadAllBytes($destinationEntry)
        Assert-Equal ([Convert]::ToBase64String($sourceBefore)) ([Convert]::ToBase64String($sourceAfter)) "Extended copy source bytes changed: $leaf"
        Assert-Equal $sourceLength ([long]$destinationBytes.LongLength) "Extended copy destination length: $leaf"
        Assert-Equal $sourceSha256 (Get-BytesSha256 $destinationBytes) "Extended copy destination SHA-256: $leaf"
        Assert-Equal ([Convert]::ToBase64String($sourceBefore)) ([Convert]::ToBase64String($destinationBytes)) "Extended copy destination bytes: $leaf"
        [void]$copied.Add([pscustomobject][ordered]@{ leaf = $leaf; length = $sourceLength; sha256 = $sourceSha256 })
    }

    $destinationEntries = @([System.IO.Directory]::EnumerateFileSystemEntries($extendedDestinationRoot))
    Assert-Equal $sourceEntries.Count $destinationEntries.Count "Extended copy destination immediate entry count"
    Assert-Equal $sourceEntries.Count $copied.Count "Extended copy verified file count"
    return @($copied)
}

function Remove-TestHarnessRegisteredRunRoot {
    param($Scenario, [string]$RootId, [string]$CandidatePath)

    $safeRoot = Assert-TestHarnessExactRunRoot $Scenario $RootId $CandidatePath
    $extendedRoot = ConvertTo-TestHarnessExtendedLocalPath $safeRoot
    if (-not [System.IO.Directory]::Exists($extendedRoot)) {
        if ([System.IO.File]::Exists($extendedRoot)) {
            throw "TEST_HARNESS_CLEANUP_ROOT_INVALID|registered run root is not a directory: $safeRoot"
        }
        return
    }

    $rootAttributes = [System.IO.File]::GetAttributes($extendedRoot)
    if (($rootAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Throw-TestHarnessReparsePointRejected $safeRoot
    }
    if (($rootAttributes -band [System.IO.FileAttributes]::Directory) -eq 0) {
        throw "TEST_HARNESS_CLEANUP_ROOT_INVALID|registered run root is not a directory: $safeRoot"
    }

    $pending = New-Object 'System.Collections.Generic.Queue[string]'
    $directories = New-Object 'System.Collections.Generic.List[string]'
    $files = New-Object 'System.Collections.Generic.List[string]'
    $pending.Enqueue($extendedRoot)
    $directories.Add($extendedRoot)
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($directory)) {
            $attributes = [System.IO.File]::GetAttributes($entry)
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                $displayPath = if ($entry.StartsWith("\\?\", [System.StringComparison]::Ordinal)) { $entry.Substring(4) } else { $entry }
                Throw-TestHarnessReparsePointRejected $displayPath
            }
            if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
                $directories.Add($entry)
                $pending.Enqueue($entry)
            }
            else {
                $files.Add($entry)
            }
        }
    }

    foreach ($file in $files) {
        $attributes = [System.IO.File]::GetAttributes($file)
        if (($attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
            [System.IO.File]::SetAttributes($file, ($attributes -band (-bnot [System.IO.FileAttributes]::ReadOnly)))
        }
        [System.IO.File]::Delete($file)
    }
    for ($index = $directories.Count - 1; $index -ge 0; $index--) {
        $directory = $directories[$index]
        $attributes = [System.IO.File]::GetAttributes($directory)
        if (($attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
            [System.IO.File]::SetAttributes($directory, ($attributes -band (-bnot [System.IO.FileAttributes]::ReadOnly)))
        }
        [System.IO.Directory]::Delete($directory, $false)
    }
    if ([System.IO.Directory]::Exists($extendedRoot) -or [System.IO.File]::Exists($extendedRoot)) {
        throw "TEST_HARNESS_CLEANUP_RESIDUAL|registered run root remained: $safeRoot"
    }
}

function Resolve-TestHarnessPathUnderRunRoot {
    param($Scenario, [string]$RootId, [string]$CandidatePath)
    $candidateFull = Resolve-TestHarnessPathWithinFixture $Scenario.fixture.base $CandidatePath
    $rootFull = Resolve-TestHarnessPathWithinFixture $Scenario.fixture.base ([string]$Scenario.allowed_run_roots[$RootId])
    $prefix = $rootFull.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidateFull.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Throw-TestHarnessPathOutsideFixture "candidate is outside preregistered run root: $RootId"
    }
    return $candidateFull
}

function Write-TestDoubleStableFile {
    param($Scenario, [string]$Path, [string]$Text)
    $safePath = Resolve-TestHarnessPathWithinFixture $Scenario.fixture.base $Path
    Write-StableFile $safePath $Text
}

function Remove-TestDoubleFile {
    param($Scenario, [string]$Path)
    $safePath = Resolve-TestHarnessPathWithinFixture $Scenario.fixture.base $Path
    if (Test-Path -LiteralPath $safePath -PathType Leaf) {
        Remove-Item -LiteralPath $safePath -Force
    }
}

function Assert-TestTypeboxContractEqual {
    param($Expected, $Actual, [string]$Label)
    $propertyNames = @("path", "file_count", "total_bytes", "tree_sha256", "package_sha256")
    Assert-ExactPropertySet $Expected $propertyNames "$Label expected contract"
    Assert-ExactPropertySet $Actual $propertyNames "$Label actual contract"
    Assert-Equal ([System.IO.Path]::GetFullPath([string]$Expected.path)) ([System.IO.Path]::GetFullPath([string]$Actual.path)) "$Label path"
    Assert-Equal ([int]$Expected.file_count) ([int]$Actual.file_count) "$Label file count"
    Assert-Equal ([long]$Expected.total_bytes) ([long]$Actual.total_bytes) "$Label total bytes"
    Assert-Equal ([string]$Expected.tree_sha256) ([string]$Actual.tree_sha256) "$Label tree SHA-256"
    Assert-Equal ([string]$Expected.package_sha256) ([string]$Actual.package_sha256) "$Label package SHA-256"
}

function Assert-StructuralV1TypeboxTree {
    param([string]$Root, [string]$Label)
    $safeRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\", "/")
    $oracle = New-StructuralV1TypeboxOracle
    Assert-ExactPropertySet $oracle @("files", "aggregate") "$Label oracle"
    Assert-ExactPropertySet $oracle.aggregate @("file_count", "total_bytes", "tree_sha256", "package_sha256") "$Label aggregate oracle"
    Assert-Equal 12 @($oracle.files).Count "$Label literal oracle file count"
    Assert-Equal 12 ([int]$oracle.aggregate.file_count) "$Label aggregate literal file count"
    Assert-Equal 536 ([long]$oracle.aggregate.total_bytes) "$Label aggregate literal total bytes"
    Assert-Equal "75BB04FB6D9DB4FDC665B2DFAB09C5EA1FDD8BD60EB82523AD97884761369FAA" ([string]$oracle.aggregate.tree_sha256) "$Label aggregate literal tree SHA-256"
    Assert-Equal "0CF7424D7E6A9E9F83510CDAFB44E9A24C20450CE13759BC10D44355042B44C2" ([string]$oracle.aggregate.package_sha256) "$Label aggregate literal package SHA-256"

    $rootItem = Get-Item -LiteralPath $safeRoot -Force
    Assert-True $rootItem.PSIsContainer "$Label root is not a directory"
    Assert-True (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "$Label root is a reparse point"
    $descendants = @(Get-ChildItem -LiteralPath $safeRoot -Recurse -Force)
    Assert-Equal 0 @($descendants | Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 }).Count "$Label reparse descendant count"
    $files = @($descendants | Where-Object { -not $_.PSIsContainer })
    Assert-Equal 12 $files.Count "$Label scanned file count"

    $prefixLength = $safeRoot.Length + 1
    $actualRelativePaths = @($files | ForEach-Object { $_.FullName.Substring($prefixLength).Replace("/", "\") })
    $expectedRelativePaths = @($oracle.files | ForEach-Object { [string]$_.relative_path })
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedRelativePaths) (Get-OrdinalIgnoreCaseSignature $actualRelativePaths) "$Label exact relative path set"
    $rows = New-Object 'System.Collections.Generic.List[string]'
    [long]$totalBytes = 0
    foreach ($expectedFile in @($oracle.files)) {
        Assert-ExactPropertySet $expectedFile @("relative_path", "bytes_base64", "length", "sha256") "$Label file oracle"
        $relativePath = [string]$expectedFile.relative_path
        Assert-True (-not [System.IO.Path]::IsPathRooted($relativePath)) "$Label oracle path is absolute: $relativePath"
        Assert-True ($relativePath -notmatch '(^|[\\/])\.\.?(?:[\\/]|$)|[:|\r\n]') "$Label oracle path is invalid: $relativePath"
        Assert-Equal 1 @($actualRelativePaths | Where-Object { [string]$_ -ceq $relativePath }).Count "$Label exact-case relative path: $relativePath"
        $filePath = Join-Path $safeRoot $relativePath
        $fileItem = Get-Item -LiteralPath $filePath -Force
        Assert-True (-not $fileItem.PSIsContainer) "$Label expected ordinary file is a directory: $relativePath"
        Assert-True (($fileItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "$Label expected file is a reparse point: $relativePath"
        $actualBytes = [System.IO.File]::ReadAllBytes($filePath)
        $actualBase64 = [Convert]::ToBase64String($actualBytes)
        $actualSha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToUpperInvariant()
        Assert-Equal ([string]$expectedFile.bytes_base64) $actualBase64 "$Label literal bytes: $relativePath"
        Assert-Equal ([long]$expectedFile.length) ([long]$fileItem.Length) "$Label literal length: $relativePath"
        Assert-Equal ([string]$expectedFile.sha256) $actualSha256 "$Label literal SHA-256: $relativePath"
        $rows.Add("$relativePath|$($fileItem.Length)|$actualSha256")
        $totalBytes += [long]$fileItem.Length
    }
    $rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    Assert-Equal ([long]$oracle.aggregate.total_bytes) $totalBytes "$Label scanned total bytes"
    Assert-Equal ([string]$oracle.aggregate.tree_sha256) (Get-TextSha256 (@($rows) -join "`n")) "$Label scanned tree SHA-256"
    Assert-Equal ([string]$oracle.aggregate.package_sha256) ((Get-FileHash -LiteralPath (Join-Path $safeRoot "package.json") -Algorithm SHA256).Hash.ToUpperInvariant()) "$Label scanned package SHA-256"
}

function Assert-ScenarioTypeboxEvidence {
    param($Fixture, $Scenario, $Report, [int]$ExpectedAuditCount, [string]$Label)
    Assert-Equal ([string]$Fixture.typebox_fixture_profile) ([string]$Scenario.typebox_fixture_profile) "$Label fixture profile"
    Assert-True (-not [object]::ReferenceEquals($Scenario.expected_typebox_contract, $Fixture.runtime.identity_expectations.module_closure.staging_typebox)) "$Label Scenario oracle object independence"
    Assert-TestTypeboxContractEqual $Scenario.expected_typebox_contract $Fixture.runtime.identity_expectations.module_closure.staging_typebox "$Label Runtime contract"
    if ([string]$Scenario.typebox_fixture_profile -ceq "structural_v1") {
        Assert-StructuralV1TypeboxTree ([string]$Fixture.runtime.dependency_source_roots.typebox_root) "$Label authoritative source"
    }

    $contract = $Scenario.expected_typebox_contract
    $reportText = Get-ReportText $Report
    foreach ($needle in @(
        ([string]$contract.tree_sha256),
        ([string]$contract.package_sha256),
        ('"file_count":' + [int]$contract.file_count),
        ('"total_bytes":' + [long]$contract.total_bytes)
    )) {
        Assert-True ($reportText -match [regex]::Escape($needle)) "$Label report contract value missing: $needle"
    }
    Assert-True ($reportText -notmatch 'typebox_fixture_profile|structural_v1|production_exact') "$Label leaked test-only profile into report"

    $audits = @($Scenario.staging_audits)
    Assert-Equal $ExpectedAuditCount $audits.Count "$Label staging audit count"
    foreach ($audit in $audits) {
        Assert-Equal ([int]$contract.file_count) ([int]$audit.typebox_file_count) "$Label staged TypeBox file count: $($audit.command_id)"
        Assert-Equal ([long]$contract.total_bytes) ([long]$audit.typebox_total_bytes) "$Label staged TypeBox total bytes: $($audit.command_id)"
        Assert-Equal ([string]$contract.tree_sha256) ([string]$audit.typebox_tree_sha256) "$Label staged TypeBox tree SHA-256: $($audit.command_id)"
        Assert-Equal ([string]$contract.package_sha256) ([string]$audit.typebox_package_sha256) "$Label staged TypeBox package SHA-256: $($audit.command_id)"
    }
}

function Test-FixtureHarness {
    param($Fixture)
    Assert-True ([System.IO.Path]::IsPathRooted($Fixture.project)) "Fixture project root is not absolute"
    Assert-True ([string]$Fixture.typebox_fixture_profile -cin @("production_exact", "structural_v1")) "Fixture TypeBox profile"
    Assert-ExactPropertySet $Fixture.runtime @("temporary_parent", "node_path", "tool_modules_path", "vitest_path", "typescript_path", "openclaw_path", "dependency_source_roots", "protected_external_paths", "identity_expectations") "Fixture Runtime top level"
    Assert-ExactPropertySet $Fixture.runtime.identity_expectations.a_structure @("executable_path", "script_path", "length", "sha256", "file_version", "product_version") "Fixture A structure identity"
    Assert-Equal $powershellPath ([string]$Fixture.runtime.identity_expectations.a_structure.executable_path) "Fixture A structure executable path"
    Assert-Equal 454656 ([long]$Fixture.runtime.identity_expectations.a_structure.length) "Fixture A structure executable length"
    Assert-Equal "7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5" ([string]$Fixture.runtime.identity_expectations.a_structure.sha256) "Fixture A structure executable SHA-256"
    Assert-Equal "10.0.26100.8875" ([string]$Fixture.runtime.identity_expectations.a_structure.file_version) "Fixture A structure file version"
    Assert-Equal "10.0.26100.8875" ([string]$Fixture.runtime.identity_expectations.a_structure.product_version) "Fixture A structure product version"

    $actualPowerShell = Get-Item -LiteralPath $powershellPath -Force
    $actualFileVersion = "{0}.{1}.{2}.{3}" -f $actualPowerShell.VersionInfo.FileMajorPart, $actualPowerShell.VersionInfo.FileMinorPart, $actualPowerShell.VersionInfo.FileBuildPart, $actualPowerShell.VersionInfo.FilePrivatePart
    Assert-Equal 454656 ([long]$actualPowerShell.Length) "Test host fixed PowerShell executable length"
    Assert-Equal "7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5" ((Get-FileHash -LiteralPath $powershellPath -Algorithm SHA256).Hash.ToUpperInvariant()) "Test host fixed PowerShell executable SHA-256"
    Assert-Equal "10.0.26100.8875" $actualFileVersion "Test host fixed PowerShell executable file version"
    Assert-Equal "10.0.26100.8875" ([string]$actualPowerShell.VersionInfo.ProductVersion) "Test host fixed PowerShell executable product version"
    Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path $Fixture.project "docs\evidence"))) ([System.IO.Path]::GetFullPath([string]$Fixture.evidence)) "Fixture evidence fixed layout"
    foreach ($sibling in @($Fixture.project, $Fixture.temporary_parent, $Fixture.guard_parent, $Fixture.runtime.dependency_source_roots.node_root)) {
        [void](Resolve-TestHarnessPathWithinFixture $Fixture.base ([string]$sibling))
    }
    Assert-True (-not ([System.IO.Path]::GetFullPath([string]$Fixture.temporary_parent)).Equals([System.IO.Path]::GetFullPath([string]$Fixture.guard_parent), [System.StringComparison]::OrdinalIgnoreCase)) "Fixture temporary and guard parents overlap"
    Assert-ExactPropertySet $Fixture.runtime.dependency_source_roots @("node_root", "tool_modules_root", "pnpm_root", "typebox_root") "Fixture Runtime dependency roots"
    Assert-ExactPropertySet $Fixture.runtime.protected_external_paths @("jiti_openclaw_cache_guard", "node_compile_cache_guard", "inherited_openclaw_temp_guard", "vitest_b_cache_guard", "vitest_c_cache_guard") "Fixture Runtime protected paths"
    foreach ($pathProperty in @($Fixture.runtime.dependency_source_roots.PSObject.Properties)) {
        [void](Resolve-TestHarnessPathWithinFixture $Fixture.base ([string]$pathProperty.Value))
    }
    foreach ($pathProperty in @($Fixture.runtime.protected_external_paths.PSObject.Properties)) {
        [void](Resolve-TestHarnessPathWithinFixture $Fixture.base ([string]$pathProperty.Value))
    }
    $expectedTypeboxPath = Join-Path $Fixture.routes.C "node_modules\.pnpm\typebox@1.3.11\node_modules\typebox"
    $expectedTypeboxContract = New-TestTypeboxContract ([string]$Fixture.typebox_fixture_profile) $expectedTypeboxPath
    $runtimeTypeboxContract = $Fixture.runtime.identity_expectations.module_closure.staging_typebox
    Assert-TestTypeboxContractEqual $expectedTypeboxContract $runtimeTypeboxContract "Fixture Runtime TypeBox static contract"
    Assert-Equal ([System.IO.Path]::GetFullPath($expectedTypeboxPath)) ([System.IO.Path]::GetFullPath([string]$Fixture.runtime.dependency_source_roots.typebox_root)) "Fixture authoritative TypeBox root"
    if ([string]$Fixture.typebox_fixture_profile -ceq "structural_v1") {
        Assert-StructuralV1TypeboxTree (Join-Path $Fixture.routes.B "node_modules\.pnpm\typebox@1.3.11\node_modules\typebox") "Fixture structural TypeBox B"
        Assert-StructuralV1TypeboxTree (Join-Path $Fixture.routes.C "node_modules\.pnpm\typebox@1.3.11\node_modules\typebox") "Fixture structural TypeBox C"
    }
    Assert-Equal 16 $Fixture.seed_paths.Count "Fixture seed count"
    Assert-Equal 15 $Fixture.official_seed_paths.Count "Fixture official seed count"
    Assert-Equal 1 $Fixture.project_nonofficial_candidate_paths.Count "Fixture nonofficial project candidate count"
    $partitionedSeeds = @($Fixture.official_seed_paths) + @($Fixture.project_nonofficial_candidate_paths)
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $Fixture.seed_paths) (Get-OrdinalIgnoreCaseSignature $partitionedSeeds) "Fixture seed partition"
    Assert-Equal 0 @($Fixture.official_seed_paths | Where-Object { $Fixture.project_nonofficial_candidate_paths -contains $_ }).Count "Fixture seed partition overlap"
    foreach ($path in $Fixture.seed_paths) {
        Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "Fixture seed missing: $path"
    }
    $snapshot = Get-FileSnapshot $Fixture.seed_paths
    Assert-Equal 16 $snapshot.Count "Fixture snapshot count"
    Assert-True (-not [string]::IsNullOrWhiteSpace((Get-SnapshotDigest $snapshot))) "Fixture snapshot digest missing"
    Assert-Equal 5 $Fixture.guard_paths.Count "Fixture guard sentinel count"
    foreach ($path in $Fixture.guard_paths) {
        Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "Fixture guard sentinel missing: $path"
    }
    foreach ($routeName in @("B", "C")) {
        $routeRoot = [string]$Fixture.routes[$routeName]
        foreach ($relativeDirectory in @("src", "tests")) {
            $directoryPath = Join-Path $routeRoot $relativeDirectory
            $directoryItem = Get-Item -LiteralPath $directoryPath -Force
            Assert-True ($directoryItem.PSIsContainer) "Fixture staging input directory missing: $routeName/$relativeDirectory"
            Assert-True (($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Fixture staging input directory is a reparse point: $routeName/$relativeDirectory"
        }
        foreach ($sample in @(
            [pscustomobject]@{ relative_path = "src\foundation-fixture.ts"; text = 'export const foundationFixture = "ordinary-source";' },
            [pscustomobject]@{ relative_path = "tests\foundation-fixture.test.ts"; text = 'export const foundationFixtureTest = "ordinary-test";' }
        )) {
            $samplePath = Join-Path $routeRoot ([string]$sample.relative_path)
            $sampleItem = Get-Item -LiteralPath $samplePath -Force
            Assert-True (-not $sampleItem.PSIsContainer) "Fixture staging input sample missing: $routeName/$($sample.relative_path)"
            Assert-True (($sampleItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Fixture staging input sample is a reparse point: $routeName/$($sample.relative_path)"
            Assert-Equal ([string]$sample.text) ([System.IO.File]::ReadAllText($samplePath, [System.Text.Encoding]::UTF8)) "Fixture staging input sample bytes: $routeName/$($sample.relative_path)"
        }
    }
}

function Test-FrozenScopeBoundary {
    Assert-Equal 48 $testCases.Count "RED matrix case count"
    $uniqueIds = @($testCases.id | Sort-Object -Unique)
    Assert-Equal 48 $uniqueIds.Count "RED matrix unique ID count"
    foreach ($case in $testCases) {
        Assert-True ($case.id -match '^RED-[A-Z]+(?:-[A-Z]+)?-[0-9]{3}$') "Invalid RED test ID: $($case.id)"
    }

    Assert-Equal 5 $externalLeasePaths.Count "Exact external lease count"
    Assert-Equal 5 @($externalLeasePaths | Sort-Object -Unique).Count "Unique external lease count"
    foreach ($path in $externalLeasePaths) {
        Assert-True (-not [System.IO.Path]::IsPathRooted($path)) "External lease must be a relative file path: $path"
        Assert-True ($path -notmatch '[*?]') "External lease must not contain a wildcard: $path"
        Assert-True ([System.IO.Path]::GetExtension($path).Length -gt 0) "External lease must name an exact file: $path"
    }

    Assert-True (Test-Path -LiteralPath $scopeManifestPath -PathType Leaf) "Authoritative protected-source manifest is missing"
    Assert-Equal $scopeManifestSha256 (Get-FileHash -LiteralPath $scopeManifestPath -Algorithm SHA256).Hash "Authoritative protected-source manifest SHA-256"
    $scopeLines = @([System.IO.File]::ReadAllLines($scopeManifestPath, [System.Text.Encoding]::UTF8))
    $entryLines = @($scopeLines | Where-Object { $_ -like 'ENTRY=*' })
    $leaseLines = @($scopeLines | Where-Object { $_ -like 'CONCURRENT_EXTERNAL_LEASE_PATH=*' })
    Assert-Equal $protectedSourceExpectedCount $entryLines.Count "Protected source entry count"
    Assert-Equal 5 $leaseLines.Count "Protected manifest lease count"
    Assert-True ($scopeLines -contains "ENTRY_COUNT=$protectedSourceExpectedCount") "Protected manifest ENTRY_COUNT marker"
    Assert-True ($scopeLines -contains "CONCURRENT_EXTERNAL_LEASE_PATH_COUNT=5") "Protected manifest lease count marker"
    Assert-True ($scopeLines -contains "LEASE_RULE=exact-relative-files-only;OrdinalIgnoreCase;no-directory;no-glob;no-descendants;not-authorized-to-SH-SAFE-BASE-001") "Protected manifest exact lease rule"

    $manifestLeasePaths = @($leaseLines | ForEach-Object { $_.Substring('CONCURRENT_EXTERNAL_LEASE_PATH='.Length) })
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $externalLeasePaths) (Get-OrdinalIgnoreCaseSignature $manifestLeasePaths) "Protected manifest exact lease set"
    foreach ($line in $entryLines) {
        $relative = ($line.Substring('ENTRY='.Length) -split '\|', 2)[0]
        Assert-True ($externalLeasePaths -notcontains $relative) "External lease leaked into protected entries: $relative"
        Assert-True ($authorizedImplementationPaths -notcontains $relative) "Authorized implementation path leaked into protected entries: $relative"
    }
}

function Get-TestSpecParentEnvironmentEntries {
    param($Spec)
    if ($null -ne $Spec.environment_policy -and $null -ne $Spec.environment_policy.parent_environment) {
        return @($Spec.environment_policy.parent_environment.exact_key_values)
    }
    if ($null -ne $Spec.environment_policy -and $null -ne $Spec.environment_policy.PSObject.Properties["exact_key_values"]) {
        return @($Spec.environment_policy.exact_key_values)
    }
    return @()
}

function Get-OpenClawRootFromSpec {
    param($Spec)
    foreach ($entry in @(Get-TestSpecParentEnvironmentEntries $Spec)) {
        if ($entry.name -eq "OPENCLAW_STATE_DIR") {
            return [string]$entry.value
        }
    }
    return $null
}

function Get-TestEnvironmentMap {
    param($Entries)
    $map = [ordered]@{}
    foreach ($entry in @($Entries | Sort-Object @{ Expression = { ([string]$_.name).ToUpperInvariant() } }, @{ Expression = { [string]$_.name } })) {
        $name = [string]$entry.name
        Assert-True (-not $map.Contains($name)) "Duplicate fake environment entry: $name"
        $map[$name] = [string]$entry.value
    }
    return $map
}

function Get-TestEnvironmentLayer {
    param($Environment, [string]$EvidenceKind, [bool]$Observed, [bool]$SourceDerived, $NodeOptions, $Stdio, $IpcFd)
    $names = @($Environment.Keys | Sort-Object { ([string]$_).ToUpperInvariant() }, { [string]$_ })
    $lines = @($names | ForEach-Object { [string]$_ + [char]0 + [string]$Environment[$_] })
    $layer = [ordered]@{
        evidence_kind = $EvidenceKind
        observed = $Observed
        source_derived = $SourceDerived
        key_names = @($names)
        sha256 = Get-TextSha256 (@($lines) -join "`n")
        node_options = $NodeOptions
    }
    if ($null -ne $Stdio) { $layer["stdio"] = @($Stdio) }
    if ($null -ne $IpcFd) { $layer["ipc_fd"] = [string]$IpcFd }
    return [pscustomobject]$layer
}

function Copy-TestEnvironmentMap {
    param($Environment)
    $copy = [ordered]@{}
    foreach ($name in $Environment.Keys) { $copy[[string]$name] = [string]$Environment[$name] }
    return $copy
}

function Add-TestEnvironmentValues {
    param($Environment, $Values)
    foreach ($name in $Values.Keys) {
        Assert-True (-not $Environment.Contains($name)) "Fake environment value already exists: $name"
        $Environment[[string]$name] = [string]$Values[$name]
    }
}

function New-TestFakePolicyEvidence {
    param($Spec, $Scenario, [int]$ParentPid)
    $parentEnvironment = Get-TestEnvironmentMap (Get-TestSpecParentEnvironmentEntries $Spec)
    $policyPath = [string]$Spec.node_runtime.policy_module_path
    $networkHooks = Get-ExpectedNetworkHookSet
    $directAttestation = [pscustomobject][ordered]@{
        schema_version = "foundation-policy-attestation/v2"
        status = "ready"
        pid = $ParentPid
        ppid = 1
        role = "direct_parent"
        executable_path = [string]$Spec.executable
        exec_argv = @($Spec.node_runtime.derived_node_prefix)
        argv = @($Spec.executable) + @($Spec.arguments[@($Spec.node_runtime.derived_node_prefix).Count..(@($Spec.arguments).Count - 1)])
        derived_node_prefix = @($Spec.node_runtime.derived_node_prefix)
        bootstrap_visible_env = Get-TestEnvironmentLayer $parentEnvironment "q_bootstrap_observed" $true $false $null $null $null
        policy_path = $policyPath
        policy_module_url = [string]$Spec.node_runtime.policy_module_url
        policy_sha256 = $frozenPolicySha256
        network_hook_set = @($networkHooks)
        network_not_present = @("globalThis.EventSource")
        sqlite_cjs_esm_self_test = $true
        child_policy_installed = $true
        addon_policy_installed = $true
    }
    if ([string]$Spec.id -in @("B.plugin_build_check", "B.plugin_validate", "C.plugin_build_check", "C.plugin_validate")) {
        $directAttestationClone = ([string]($directAttestation | ConvertTo-Json -Depth 32 -Compress)) | ConvertFrom-Json
        [void]$Scenario.policy_attestation_inputs.Add([pscustomobject][ordered]@{
            command_id = [string]$Spec.id
            pid = $ParentPid
            value = $directAttestationClone
        })
    }
    $policyReady = New-Object System.Collections.ArrayList
    [void]$policyReady.Add($directAttestation)
    $spawnIntents = New-Object System.Collections.ArrayList
    $spawnResults = New-Object System.Collections.ArrayList
    $addonLoads = New-Object System.Collections.ArrayList
    $addonIntents = New-Object System.Collections.ArrayList
    $addonResults = New-Object System.Collections.ArrayList

    if ([string]$Spec.stage -ceq "test") {
        $bookkeeping = [ordered]@{ TEST = "true"; VITEST = "true"; NODE_ENV = "test"; VITEST_MODE = "RUN"; TINYPOOL_WORKER_ID = "1" }
        $viteValues = [ordered]@{ BASE_URL = "/"; MODE = "test"; DEV = "1"; PROD = "" }
        $qSupplied = Copy-TestEnvironmentMap $parentEnvironment
        Add-TestEnvironmentValues $qSupplied $bookkeeping
        $incoming = Copy-TestEnvironmentMap $qSupplied
        Add-TestEnvironmentValues $incoming $viteValues
        $sourceDerived = Copy-TestEnvironmentMap $qSupplied
        Add-TestEnvironmentValues $sourceDerived ([ordered]@{ NODE_CHANNEL_FD = "3"; NODE_CHANNEL_SERIALIZATION_MODE = "json" })
        Assert-Equal 28 $incoming.Count "Fake Vitest incoming environment count"
        Assert-Equal 24 $qSupplied.Count "Fake Vitest Q-supplied environment count"
        Assert-Equal 26 $sourceDerived.Count "Fake Vitest source-derived environment count"

        $snapshot = [string]$Spec.runtime_snapshot_root
        $snapshotNode = Join-Path $snapshot "node\node-v24.15.0-win-x64\node.exe"
        $forkEntry = Join-Path $snapshot "pnpm\tinypool@1.1.1\node_modules\tinypool\dist\entry\process.js"
        $forkPid = $ParentPid + 1
        $forkId = "$ParentPid-0001"
        $forkIntent = [pscustomobject][ordered]@{
            schema_version = "foundation-spawn-intent/v1"; id = $forkId; parent_pid = $ParentPid; api = "fork"; role = "vitest_single_fork"
            executable_path = $snapshotNode; executable_sha256 = [string]$Scenario.fixture.runtime.identity_expectations.native_execution_allowlist.snapshot_node_executable.sha256
            argv = @($Spec.node_runtime.derived_node_prefix) + @($forkEntry); cwd = [string]$Spec.cwd
            incoming_request_env = Get-TestEnvironmentLayer $incoming "q_observed_normalized_request" $true $false $null $null $null
            q_supplied_env = Get-TestEnvironmentLayer $qSupplied "q_constructed_supplied" $false $false $null $null $null
            source_derived_createprocess_env = Get-TestEnvironmentLayer $sourceDerived "node24-fork-ipc-environment-source-derived" $false $true $null @("pipe", "pipe", "pipe", "ipc") "3"
            bootstrap_visible_env = Get-TestEnvironmentLayer $qSupplied "expected_then_child_policy_ready_observed" $false $false $null $null $null
            derived_node_prefix = @($Spec.node_runtime.derived_node_prefix)
        }
        [void]$spawnIntents.Add($forkIntent)
        [void]$spawnResults.Add([pscustomobject][ordered]@{ schema_version = "foundation-spawn-result/v1"; id = $forkId; parent_pid = $ParentPid; success = $true; pid = $forkPid })
        [void]$policyReady.Add([pscustomobject][ordered]@{
            schema_version = "foundation-policy-attestation/v2"; status = "ready"; pid = $forkPid; ppid = $ParentPid; role = "vitest_single_fork"
            executable_path = $snapshotNode; exec_argv = @($Spec.node_runtime.derived_node_prefix); argv = @($snapshotNode, $forkEntry)
            derived_node_prefix = @($Spec.node_runtime.derived_node_prefix); bootstrap_visible_env = Get-TestEnvironmentLayer $qSupplied "q_bootstrap_observed" $true $false $null $null $null
            policy_path = $policyPath; policy_module_url = [string]$Spec.node_runtime.policy_module_url; policy_sha256 = $frozenPolicySha256
            network_hook_set = @($networkHooks); network_not_present = @("globalThis.EventSource"); sqlite_cjs_esm_self_test = $true; child_policy_installed = $true; addon_policy_installed = $true
        })

        $rollupPid = $ParentPid + 2
        $rollupId = "$ParentPid-0002"
        [void]$spawnIntents.Add([pscustomobject][ordered]@{
            schema_version = "foundation-spawn-intent/v1"; id = $rollupId; parent_pid = $ParentPid; api = "spawnSync"; role = "snapshot_node_helper"
            executable_path = $snapshotNode; executable_sha256 = [string]$Scenario.fixture.runtime.identity_expectations.native_execution_allowlist.snapshot_node_executable.sha256
            argv = @($Spec.node_runtime.derived_node_prefix) + @("-p", "const r=require('node:process').report;r.excludeNetwork=true;console.log(JSON.stringify(r.getReport().header));"); cwd = [string]$Spec.cwd
            incoming_request_env = $null; q_supplied_env = Get-TestEnvironmentLayer $parentEnvironment "q_constructed_supplied" $false $false $null $null $null
            source_derived_createprocess_env = Get-TestEnvironmentLayer $parentEnvironment "argv-contains-permission-no-node-options-injection" $false $true $null $null $null
            bootstrap_visible_env = Get-TestEnvironmentLayer $parentEnvironment "expected_then_child_policy_ready_observed" $false $false $null $null $null
            derived_node_prefix = @($Spec.node_runtime.derived_node_prefix)
        })
        [void]$spawnResults.Add([pscustomobject][ordered]@{ schema_version = "foundation-spawn-result/v1"; id = $rollupId; parent_pid = $ParentPid; success = $true; pid = $rollupPid })
        $rollupTail = @("-p", "const r=require('node:process').report;r.excludeNetwork=true;console.log(JSON.stringify(r.getReport().header));")
        [void]$policyReady.Add([pscustomobject][ordered]@{
            schema_version = "foundation-policy-attestation/v2"; status = "ready"; pid = $rollupPid; ppid = $ParentPid; role = "snapshot_node_helper"
            executable_path = $snapshotNode; exec_argv = @($Spec.node_runtime.derived_node_prefix) + @($rollupTail); argv = @($snapshotNode)
            derived_node_prefix = @($Spec.node_runtime.derived_node_prefix); bootstrap_visible_env = Get-TestEnvironmentLayer $parentEnvironment "q_bootstrap_observed" $true $false $null $null $null
            policy_path = $policyPath; policy_module_url = [string]$Spec.node_runtime.policy_module_url; policy_sha256 = $frozenPolicySha256
            network_hook_set = @($networkHooks); network_not_present = @("globalThis.EventSource"); sqlite_cjs_esm_self_test = $true; child_policy_installed = $true; addon_policy_installed = $true
        })

        $esbuildPid = $ParentPid + 3
        $esbuildId = "$ParentPid-0003"
        $esbuildEnvironment = Copy-TestEnvironmentMap $parentEnvironment
        $nativeNodeOptions = @($Spec.permission_model.argument_vector) -join " "
        $esbuildSource = Copy-TestEnvironmentMap $esbuildEnvironment
        Add-TestEnvironmentValues $esbuildSource ([ordered]@{ NODE_OPTIONS = $nativeNodeOptions })
        [void]$spawnIntents.Add([pscustomobject][ordered]@{
            schema_version = "foundation-spawn-intent/v1"; id = $esbuildId; parent_pid = $ParentPid; api = "spawn"; role = "esbuild"
            executable_path = Join-Path $snapshot "pnpm\@esbuild+win32-x64@0.21.5\node_modules\@esbuild\win32-x64\esbuild.exe"; executable_sha256 = [string]$Scenario.fixture.runtime.identity_expectations.native_execution_allowlist.vitest_child.sha256
            argv = @("--service=0.21.5", "--ping"); cwd = [string]$Spec.cwd; incoming_request_env = $null
            q_supplied_env = Get-TestEnvironmentLayer $esbuildEnvironment "q_constructed_supplied" $false $false $null $null $null
            source_derived_createprocess_env = Get-TestEnvironmentLayer $esbuildSource "node24-permission-node-options-source-derived" $false $true $nativeNodeOptions @("pipe", "pipe", "inherit") $null
            bootstrap_visible_env = $null; derived_node_prefix = @($Spec.node_runtime.derived_node_prefix)
        })
        [void]$spawnResults.Add([pscustomobject][ordered]@{ schema_version = "foundation-spawn-result/v1"; id = $esbuildId; parent_pid = $ParentPid; success = $true; pid = $esbuildPid })
        $addonId = "$ParentPid-0004"
        $addonPath = Join-Path $snapshot "pnpm\@rollup+rollup-win32-x64-msvc@4.62.4\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node"
        $addonSha256 = "397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49"
        [void]$addonIntents.Add([pscustomobject][ordered]@{
            schema_version = "foundation-addon-intent/v1"; id = $addonId; pid = $ParentPid; path = $addonPath
            path_kind = "ordinary_drive"; length = 2623488; sha256 = $addonSha256
        })
        [void]$addonResults.Add([pscustomobject][ordered]@{
            schema_version = "foundation-addon-result/v1"; id = $addonId; pid = $ParentPid; success = $true; path = $addonPath
            path_kind = "ordinary_drive"; sha256 = $addonSha256
        })
        [void]$addonLoads.Add([pscustomobject][ordered]@{
            pid = $ParentPid; path = $addonPath; path_kind = "ordinary_drive"; length = 2623488; sha256 = $addonSha256; success = $true
        })
    }

    $journalRoot = [string]$Spec.execution_topology.policy_attestation_root
    $rootId = if ([string]$Spec.stage -ceq "test") { "validation_root" } elseif ([string]$Spec.stage -ceq "build") { "build_root" } else { "openclaw_state_root" }
    $safeJournalRoot = Resolve-TestHarnessPathUnderRunRoot $Scenario $rootId $journalRoot
    Assert-True (Test-Path -LiteralPath $safeJournalRoot -PathType Container) "Policy attestation root was not precreated for $($Spec.id)"
    $journalRows = @()
    foreach ($row in @($policyReady)) { $journalRows += [pscustomobject]@{ name = "policy-ready-$($row.pid).json"; value = $row } }
    foreach ($row in @($spawnIntents)) { $journalRows += [pscustomobject]@{ name = "spawn-$($row.id)-intent.json"; value = $row } }
    foreach ($row in @($spawnResults)) { $journalRows += [pscustomobject]@{ name = "spawn-$($row.id)-result.json"; value = $row } }
    foreach ($row in @($addonIntents)) { $journalRows += [pscustomobject]@{ name = "addon-$($row.id)-intent.json"; value = $row } }
    foreach ($row in @($addonResults)) { $journalRows += [pscustomobject]@{ name = "addon-$($row.id)-result.json"; value = $row } }
    foreach ($row in $journalRows) {
        $path = Resolve-TestHarnessPathUnderRunRoot $Scenario $rootId (Join-Path $safeJournalRoot $row.name)
        Assert-True (-not (Test-Path -LiteralPath $path)) "Fake policy journal already exists: $path"
        [System.IO.File]::WriteAllText($path, ([string]($row.value | ConvertTo-Json -Depth 32 -Compress)), $script:Utf8NoBom)
        [System.IO.File]::SetLastWriteTimeUtc($path, [datetime]::Parse("2024-01-02T03:04:05Z").ToUniversalTime())
        [void]$Scenario.policy_journal_paths.Add($path)
    }
    $successfulPids = @($spawnResults | Where-Object { [bool]$_.success } | ForEach-Object { [int]$_.pid })
    $allPids = @($ParentPid) + @($successfulPids)
    return [pscustomobject][ordered]@{
        policy_attestations = @($policyReady)
        spawn_intents = @($spawnIntents)
        spawn_results = @($spawnResults)
        addon_loads = @($addonLoads)
        job_control = [pscustomobject][ordered]@{
            completion_telemetry = [pscustomobject][ordered]@{ best_effort = $true; messages = @(); unique_new_pids = @($allPids); identity_failures = @(); active_zero_observed = $true }
            accounting = [pscustomobject][ordered]@{ total_processes = $allPids.Count; active_processes = 0; expected_total_processes = $allPids.Count; matched = $true }
            spawn_journal = [pscustomobject][ordered]@{ intents = @($spawnIntents); results = @($spawnResults); matched = $true }
        }
    }
}

function Get-TestOpenClawPolicyAttestationEntries {
    param(
        $Scenario,
        [string[]]$ExpectedCommandIds,
        [string]$Label
    )
    $fixedCommands = @(
        [pscustomobject][ordered]@{ command_id = "B.plugin_build_check"; pid = 41030 },
        [pscustomobject][ordered]@{ command_id = "B.plugin_validate"; pid = 41040 },
        [pscustomobject][ordered]@{ command_id = "C.plugin_build_check"; pid = 41070 },
        [pscustomobject][ordered]@{ command_id = "C.plugin_validate"; pid = 41080 }
    )
    $selectedCommands = @($fixedCommands | Where-Object { $ExpectedCommandIds -ccontains [string]$_.command_id })
    Assert-Equal $ExpectedCommandIds.Count @($ExpectedCommandIds | Sort-Object -Unique).Count "$Label expected command IDs are unique"
    Assert-Equal ($ExpectedCommandIds -join "|") (@($selectedCommands | ForEach-Object { [string]$_.command_id }) -join "|") "$Label fixed command table selection"

    $inputs = @($Scenario.policy_attestation_inputs)
    Assert-Equal $ExpectedCommandIds.Count $inputs.Count "$Label policy attestation input count"
    Assert-Equal $inputs.Count @($inputs | ForEach-Object { [string]$_.command_id } | Sort-Object -Unique).Count "$Label policy attestation input command uniqueness"
    $entries = New-Object System.Collections.ArrayList
    foreach ($expectedCommand in $selectedCommands) {
        $commandId = [string]$expectedCommand.command_id
        $expectedPid = [int]$expectedCommand.pid
        $matches = @($inputs | Where-Object { [string]$_.command_id -ceq $commandId })
        Assert-Equal 1 $matches.Count "$Label policy attestation input: $commandId"
        $inputRecord = $matches[0]
        Assert-ExactPropertySet $inputRecord @("command_id", "pid", "value") "$Label policy attestation input shape: $commandId"
        Assert-Equal $commandId ([string]$inputRecord.command_id) "$Label policy attestation command ID: $commandId"
        Assert-Equal $expectedPid ([int]$inputRecord.pid) "$Label policy attestation input PID: $commandId"
        Assert-True ($null -ne $inputRecord.value -and -not ($inputRecord.value -is [string])) "$Label policy attestation direct value: $commandId"
        Assert-Equal $expectedPid ([int]$inputRecord.value.pid) "$Label policy attestation direct PID: $commandId"
        Assert-Equal "direct_parent" ([string]$inputRecord.value.role) "$Label policy attestation direct role: $commandId"

        $directJson = [string]($inputRecord.value | ConvertTo-Json -Depth 32 -Compress)
        $directBytes = [byte[]]$script:Utf8NoBom.GetBytes($directJson)
        Assert-True ($directBytes.LongLength -gt 0) "$Label policy attestation direct bytes: $commandId"
        Assert-Equal $directJson ([string]$script:Utf8NoBom.GetString($directBytes)) "$Label policy attestation direct UTF-8 round trip: $commandId"
        [void]$entries.Add([pscustomobject][ordered]@{
            relative_path = "environment\$commandId\temp\foundation-policy-attestations\policy-ready-$expectedPid.json"
            classification = "other"
            sha256 = Get-BytesSha256 $directBytes
            length = [long]$directBytes.LongLength
            last_write_time_utc = "2024-01-02T03:04:05Z"
            creation_stage = $commandId
        })
    }
    return @($entries)
}

$fakeCommandRunner = {
    param($Spec)

    $specSnapshot = ([string]($Spec | ConvertTo-Json -Depth 32 -Compress)) | ConvertFrom-Json
    [void]$script:Scenario.observed_specs.Add($specSnapshot)
    if ([string]$Spec.route -in @("B", "C") -and $null -ne $Spec.node_runtime) {
        $expectedPolicyPath = Join-Path ([string]$script:Scenario.allowed_run_roots.validation_root) "runtime-snapshot\policy\foundation-node-policy.mjs"
        $safePolicyPath = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "validation_root" ([string]$Spec.node_runtime.policy_module_path)
        Assert-Equal ([System.IO.Path]::GetFullPath($expectedPolicyPath)) ([System.IO.Path]::GetFullPath($safePolicyPath)) "Runtime policy path for $($Spec.id)"
        $policyItem = Get-Item -LiteralPath $safePolicyPath -Force
        Assert-True (-not $policyItem.PSIsContainer) "Runtime policy input missing for $($Spec.id)"
        Assert-True (($policyItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Runtime policy input is a reparse point for $($Spec.id)"
        $policyBytes = [System.IO.File]::ReadAllBytes($safePolicyPath)
        [void]$script:Scenario.policy_file_captures.Add([pscustomobject][ordered]@{
            command_id = [string]$Spec.id
            path = $safePolicyPath
            length = [long]$policyBytes.LongLength
            sha256 = Get-BytesSha256 $policyBytes
            base64 = [Convert]::ToBase64String($policyBytes)
        })
    }
    $parentPid = [int]$script:Scenario.fake_process_pid
    $script:Scenario.fake_process_pid = $parentPid + 10
    $stdout = "fake stdout for $($Spec.id)"
    $stderr = ""
    $exitCode = 0
    $exceptionType = $null
    $exceptionText = $null

    if ($script:Scenario.fail_command -eq $Spec.id) {
        $exitCode = [int]$script:Scenario.fail_exit
        $stderr = $script:Scenario.stderr
        $exceptionType = $script:Scenario.command_exception_type
        $exceptionText = $script:Scenario.command_exception_text
    }

    if ($Spec.id -eq "B.test") {
        if ($script:Scenario.mutation -eq "modify") {
            $safeMutation = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base $script:Scenario.mutation_path
            [System.IO.File]::AppendAllText($safeMutation, "changed", $script:Utf8NoBom)
        }
        elseif ($script:Scenario.mutation -eq "add") {
            Write-TestDoubleStableFile $script:Scenario $script:Scenario.mutation_path "added sidecar"
        }
        elseif ($script:Scenario.mutation -eq "delete") {
            Remove-TestDoubleFile $script:Scenario $script:Scenario.mutation_path
        }
    }

    if ($script:Scenario.mutation -eq "guard_add" -and $script:Scenario.guard_mutation_paths.ContainsKey([string]$Spec.id)) {
        Write-TestDoubleStableFile $script:Scenario ([string]$script:Scenario.guard_mutation_paths[[string]$Spec.id]) "unexpected guard write"
    }

    if ($Spec.id -eq "A.structure" -and $script:Scenario.runtime_candidate_mode) {
        $candidates = @(
            [pscustomobject]@{ root_id = "isolated_test_root"; relative_path = "candidate.jsonl"; text = "isolated candidate" },
            [pscustomobject]@{ root_id = "validation_root"; relative_path = "candidate.sqlite"; text = "validation candidate" },
            [pscustomobject]@{ root_id = "build_root"; relative_path = "candidate.db-wal"; text = "build candidate" }
        )
        foreach ($candidate in $candidates) {
            $path = Resolve-TestHarnessPathUnderRunRoot $script:Scenario $candidate.root_id (Join-Path ([string]$script:Scenario.allowed_run_roots[$candidate.root_id]) $candidate.relative_path)
            Write-TestDoubleStableFile $script:Scenario $path $candidate.text
            [void]$script:Scenario.runtime_candidate_records.Add([pscustomobject]@{
                root_id = $candidate.root_id
                relative_path = $candidate.relative_path
                full_path = $path
                sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
            })
        }
    }

    if ($Spec.stage -eq "build") {
        $arguments = @($Spec.arguments)
        $outIndex = [array]::IndexOf($arguments, "--outDir")
        if ($outIndex -ge 0 -and ($outIndex + 1) -lt $arguments.Count) {
            $safeOutDir = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "build_root" ([string]$arguments[$outIndex + 1])
            $output = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "build_root" (Join-Path $safeOutDir "index.js")
            Write-TestDoubleStableFile $script:Scenario $output "external build artifact"
            [void]$script:Scenario.build_outputs.Add($output)
            [void]$script:Scenario.build_output_records.Add([pscustomobject]@{
                command_id = [string]$Spec.id
                cwd = [string]$Spec.cwd
                out_dir = $safeOutDir
                path = $output
                length = (Get-Item -LiteralPath $output).Length
                sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
            })
        }
    }

    if ($Spec.stage -like "plugin*") {
        $openclawRoot = Get-OpenClawRootFromSpec $Spec
        if ([string]::IsNullOrWhiteSpace($openclawRoot)) {
            Throw-TestHarnessPathOutsideFixture "plugin spec omitted OPENCLAW_STATE_DIR"
        }
        else {
            $safeOpenClawRoot = Assert-TestHarnessExactRunRoot $script:Scenario "openclaw_state_root" $openclawRoot
            $stagingAudit = Get-TestStagingAudit $script:Scenario $Spec
            [void]$script:Scenario.staging_audits.Add($stagingAudit)
            [void]$script:Scenario.plugin_state_values.Add($safeOpenClawRoot)
            if ($script:Scenario.openclaw_mode -eq "unexpected" -and $Spec.id -eq "B.plugin_validate") {
                Write-TestDoubleStableFile $script:Scenario (Join-Path $safeOpenClawRoot "cache.sqlite-wal") "unexpected business candidate"
            }
            elseif ($script:Scenario.openclaw_mode -in @("allowlisted", "business", "internal_cleanup_failure") -and $Spec.id -eq "B.plugin_build_check") {
                Write-TestDoubleStableFile $script:Scenario (Join-Path $safeOpenClawRoot "state\openclaw.sqlite") "internal"
                if ($script:Scenario.openclaw_mode -eq "business") {
                    Write-TestDoubleStableFile $script:Scenario (Join-Path $safeOpenClawRoot "diet.sqlite") "business"
                }
                elseif ($script:Scenario.openclaw_mode -eq "internal_cleanup_failure") {
                    $lockedPath = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "openclaw_state_root" (Join-Path $safeOpenClawRoot "state\openclaw.sqlite")
                    $lockedStream = [System.IO.File]::Open($lockedPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
                    [void]$script:Scenario.openclaw_locked_streams.Add($lockedStream)
                }
            }
            elseif ($script:Scenario.openclaw_mode -in @("allowlisted", "business", "internal_cleanup_failure") -and $Spec.id -eq "B.plugin_validate") {
                Write-TestDoubleStableFile $script:Scenario (Join-Path $safeOpenClawRoot "state\openclaw.sqlite-wal") "internal wal"
                Write-TestDoubleStableFile $script:Scenario (Join-Path $safeOpenClawRoot "logs\openclaw.log") "ordinary log"
                if ($script:Scenario.openclaw_mode -eq "business") {
                    Write-TestDoubleStableFile $script:Scenario (Join-Path $safeOpenClawRoot "records.jsonl") "business"
                    Write-TestDoubleStableFile $script:Scenario (Join-Path $safeOpenClawRoot "cache.sqlite-wal") "business"
                }
            }
            elseif ($script:Scenario.openclaw_mode -in @("allowlisted", "business") -and $Spec.id -eq "C.plugin_validate") {
                Write-TestDoubleStableFile $script:Scenario (Join-Path $safeOpenClawRoot "state\openclaw.sqlite") "internal"
            }
            elseif ($script:Scenario.openclaw_mode -eq "external_guard" -and $Spec.id -eq "B.plugin_validate") {
                Write-TestDoubleStableFile $script:Scenario $script:Scenario.guard_mutation_path "unexpected external cache write"
            }
        }
    }

    $environmentEntries = @(Get-TestSpecParentEnvironmentEntries $Spec)
    $policyEvidence = $null
    if ([string]$Spec.route -in @("B", "C") -and $null -ne $Spec.node_runtime) {
        $policyEvidence = New-TestFakePolicyEvidence $Spec $script:Scenario $parentPid
    }
    if ($null -eq $policyEvidence) {
        $policyEvidence = [pscustomobject][ordered]@{
            policy_attestations = @()
            spawn_intents = @()
            spawn_results = @()
            addon_loads = @()
            job_control = [pscustomobject][ordered]@{
                completion_telemetry = [pscustomobject][ordered]@{ best_effort = $true; messages = @(); unique_new_pids = @($parentPid); identity_failures = @(); active_zero_observed = $true }
                accounting = [pscustomobject][ordered]@{ total_processes = 1; active_processes = 0; expected_total_processes = 1; matched = $true }
                spawn_journal = [pscustomobject][ordered]@{ intents = @(); results = @(); matched = $true }
            }
        }
    }
    return [pscustomobject]@{
        started_at = [datetimeoffset]::Parse("2026-08-09T20:00:00+08:00")
        finished_at = [datetimeoffset]::Parse("2026-08-09T20:00:01+08:00")
        status = if ($exitCode -eq 0) { "passed" } else { "failed" }
        exit_code = $exitCode
        stdout = $stdout
        stderr = $stderr
        environment_key_names = @($environmentEntries | ForEach-Object { $_.name })
        environment_value_sources = @($environmentEntries | ForEach-Object { $_.source })
        process_identity = [pscustomobject][ordered]@{ pid = $parentPid; start_time_filetime_utc = 133000000000000000 + $parentPid; executable_path = [string]$Spec.executable; length = $null; sha256 = $null }
        job_control = $policyEvidence.job_control
        policy_attestations = @($policyEvidence.policy_attestations)
        spawn_intents = @($policyEvidence.spawn_intents)
        spawn_results = @($policyEvidence.spawn_results)
        addon_loads = @($policyEvidence.addon_loads)
        exception_type = $exceptionType
        exception_text = $exceptionText
        error_code = $null
        stream_capture = [pscustomobject]@{ stdout_completed = $true; stderr_completed = $true; deadline_exceeded = $false }
        taskkill = [pscustomobject]@{ attempted = $false; path = $null; arguments = @(); exit_code = $null; timed_out = $false; stdout = $null; stderr = $null; error_type = $null; error_text = $null }
        termination_errors = @()
    }
}

$fakeCleanupRunner = {
    param($Spec)

    [void]$script:Scenario.cleanup_specs.Add($Spec)
    if ($null -eq $Spec -or [string]$Spec.task_id -ne "SH-SAFE-BASE-001" -or [string]$Spec.run_id -ne [string]$script:Scenario.run_id) {
        Throw-TestHarnessPathOutsideFixture "cleanup task or run identity mismatch"
    }
    $rootId = [string]$Spec.root_id
    $path = Assert-TestHarnessExactRunRoot $script:Scenario $rootId ([string]$Spec.path)
    $trustedParent = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$Spec.trusted_parent)
    $reconstructed = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $trustedParent ([string]$Spec.task_id)) ([string]$Spec.run_id))).TrimEnd("\", "/")
    if (-not $path.Equals($reconstructed, [System.StringComparison]::OrdinalIgnoreCase)) {
        Throw-TestHarnessPathOutsideFixture "cleanup trusted parent does not reconstruct preregistered run root"
    }

    if ($script:Scenario.cleanup_failure -eq $Spec.root_id) {
        return [pscustomobject]@{
            attempted = $true
            succeeded = $false
            residual_count = [int]$script:Scenario.cleanup_failure_adapter_residual_count
            error_type = "TEST_CLEANUP_FAILURE"
            error_text = "Injected cleanup failure for $($Spec.root_id)"
        }
    }
    Remove-TestHarnessRegisteredRunRoot $script:Scenario $rootId $path
    return [pscustomobject]@{ attempted = $true; succeeded = $true; residual_count = 0; error_type = $null; error_text = $null }
}

$fakeEnvironmentAdapter = {
    param($Request)

    [void]$script:Scenario.environment_specs.Add($Request)
    $script:Scenario.environment_snapshot_calls++
    if ($Request.operation -ne "snapshot" -or $Request.scope -ne "process") {
        return [pscustomobject]@{ success = $false; entries = @(); error_type = "ENVIRONMENT_WRITE_FORBIDDEN"; error_text = "Only process snapshots are allowed" }
    }
    if ($script:Scenario.after_snapshot_failure -and $script:Scenario.environment_snapshot_calls -ge 2) {
        return [pscustomobject]@{ success = $false; entries = @(); error_type = "environment_snapshot_failed"; error_text = "Injected after snapshot failure" }
    }
    $entries = New-Object System.Collections.ArrayList
    $variables = [Environment]::GetEnvironmentVariables("Process")
    foreach ($name in @($variables.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
        [void]$entries.Add([pscustomobject]@{ name = $name; value = [string]$variables[$name] })
    }
    return [pscustomobject]@{ success = $true; entries = @($entries); error_type = $null; error_text = $null }
}

$fakeClock = {
    $script:ClockTick++
    return [datetimeoffset]::Parse("2026-08-09T20:00:00+08:00").AddSeconds($script:ClockTick)
}

function Get-TestHarnessRunRoots {
    param($Fixture, [string]$RunId)
    $parent = [string]$Fixture.temporary_parent
    return @{
        isolated_test_root = Join-Path $parent "isolated-test\SH-SAFE-BASE-001\$RunId"
        validation_root = Join-Path $parent "validation\SH-SAFE-BASE-001\$RunId"
        build_root = Join-Path $parent "build\SH-SAFE-BASE-001\$RunId"
        openclaw_state_root = Join-Path $parent "openclaw\SH-SAFE-BASE-001\$RunId"
    }
}

$fakeRunIdProvider = {
    return [string]$script:Scenario.run_id
}

function New-ScenarioState {
    param([string]$Id, $Fixture)
    $runId = "red" + [guid]::NewGuid().ToString("N")
    $typeboxFixtureProfile = [string]$Fixture.typebox_fixture_profile
    $typeboxOraclePath = Join-Path $Fixture.routes.C "node_modules\.pnpm\typebox@1.3.11\node_modules\typebox"
    $expectedTypeboxContract = New-TestTypeboxContract $typeboxFixtureProfile $typeboxOraclePath
    return [pscustomobject]@{
        id = $Id
        fixture = $Fixture
        typebox_fixture_profile = $typeboxFixtureProfile
        expected_typebox_contract = $expectedTypeboxContract
        run_id = $runId
        allowed_run_roots = Get-TestHarnessRunRoots $Fixture $runId
        fail_command = $null
        fail_exit = 0
        stderr = ""
        command_exception_type = $null
        command_exception_text = $null
        mutation = $null
        mutation_path = $null
        guard_mutation_path = $null
        guard_mutation_paths = @{}
        cleanup_failure = $null
        cleanup_failure_adapter_residual_count = 1
        cleanup_junction_path = $null
        cleanup_junction_target = $null
        cleanup_junction_created = $false
        after_snapshot_failure = $false
        environment_snapshot_calls = 0
        openclaw_mode = $null
        runtime_candidate_mode = $false
        observed_specs = New-Object System.Collections.ArrayList
        cleanup_specs = New-Object System.Collections.ArrayList
        environment_specs = New-Object System.Collections.ArrayList
        build_outputs = New-Object System.Collections.ArrayList
        build_output_records = New-Object System.Collections.ArrayList
        plugin_state_values = New-Object System.Collections.ArrayList
        staging_audits = New-Object System.Collections.ArrayList
        manifest_requests = New-Object System.Collections.ArrayList
        runtime_candidate_records = New-Object System.Collections.ArrayList
        publisher_requests = New-Object System.Collections.ArrayList
        publisher_report_snapshots = New-Object System.Collections.ArrayList
        publisher_written_records = New-Object System.Collections.ArrayList
        openclaw_locked_streams = New-Object System.Collections.ArrayList
        policy_journal_paths = New-Object System.Collections.ArrayList
        policy_file_captures = New-Object System.Collections.ArrayList
        policy_attestation_inputs = New-Object System.Collections.ArrayList
        fake_process_pid = 41000
        vitest_env_poison_paths = New-Object System.Collections.ArrayList
    }
}

function Set-ScenarioInjection {
    param([string]$Id, $Scenario)

    $failures = @{
        "RED-FAIL-001" = @("A.structure", 41)
        "RED-FAIL-002" = @("B.test", 42)
        "RED-FAIL-003" = @("B.build", 43)
        "RED-FAIL-004" = @("B.plugin_build_check", 44)
        "RED-FAIL-005" = @("B.plugin_validate", 45)
        "RED-FAIL-006" = @("C.test", 46)
        "RED-FAIL-007" = @("C.build", 47)
        "RED-FAIL-008" = @("C.plugin_build_check", 48)
        "RED-FAIL-009" = @("C.plugin_validate", 49)
    }
    if ($failures.ContainsKey($Id)) {
        $Scenario.fail_command = $failures[$Id][0]
        $Scenario.fail_exit = $failures[$Id][1]
        $Scenario.stderr = "injected stderr for $($Scenario.fail_command)"
    }
    if ($Id -eq "RED-MANIFEST-003") {
        $Scenario.mutation = "modify"
        $Scenario.mutation_path = Join-Path $Scenario.fixture.project "version-a-skill-only\data\events.JSONL"
    }
    elseif ($Id -eq "RED-MANIFEST-001") {
        $Scenario.runtime_candidate_mode = $true
    }
    elseif ($Id -eq "RED-MANIFEST-004") {
        $Scenario.mutation = "add"
        $Scenario.mutation_path = Join-Path $Scenario.fixture.project "version-b-lite-plugin\data\new.sqlite-wal"
    }
    elseif ($Id -eq "RED-MANIFEST-005") {
        $Scenario.mutation = "delete"
        $Scenario.mutation_path = Join-Path $Scenario.fixture.project "version-c-strict-plugin\data\records.db-journal"
    }
    elseif ($Id -eq "RED-BUILD-002") {
        $Scenario.fail_command = "B.build"
        $Scenario.fail_exit = 43
        $Scenario.stderr = "injected build failure"
    }
    elseif ($Id -eq "RED-CACHE-003") {
        $Scenario.openclaw_mode = "external_guard"
        $Scenario.guard_mutation_path = Join-Path ([string]$Scenario.fixture.runtime.protected_external_paths.jiti_openclaw_cache_guard) "unexpected-cache.mjs"
    }
    elseif ($Id -eq "RED-CACHE-VITEST-002") {
        $Scenario.mutation = "guard_add"
        $Scenario.guard_mutation_paths["B.test"] = Join-Path $Scenario.fixture.project "version-b-lite-plugin\node_modules\.vite\vitest\unexpected-cache.json"
        $Scenario.guard_mutation_paths["C.test"] = Join-Path $Scenario.fixture.project "version-c-strict-plugin\node_modules\.vite\vitest\unexpected-cache.json"
    }
    elseif ($Id -eq "RED-OPENCLAW-001") {
        $Scenario.openclaw_mode = "unexpected"
        $Scenario.fail_command = "B.plugin_validate"
        $Scenario.fail_exit = 45
        $Scenario.stderr = "plugin failed after unexpected state write"
    }
    elseif ($Id -eq "RED-OPENCLAW-002") {
        $Scenario.fail_command = "A.structure"
        $Scenario.fail_exit = 41
        $Scenario.stderr = "primary command failure"
        $Scenario.cleanup_failure = "openclaw_state_root"
    }
    elseif ($Id -eq "RED-OPENCLAW-003") {
        $Scenario.openclaw_mode = "allowlisted"
    }
    elseif ($Id -eq "RED-OPENCLAW-004") {
        $Scenario.openclaw_mode = "business"
    }
    elseif ($Id -eq "RED-ENV-003") {
        $Scenario.after_snapshot_failure = $true
    }
    elseif ($Id -eq "RED-REPORT-002") {
        $Scenario.fail_command = "A.structure"
        $Scenario.fail_exit = 41
        $Scenario.stderr = "quote `" line1`r`nline2 " + [char]0x4E2D
        $Scenario.command_exception_type = "Fixture.CommandException"
        $Scenario.command_exception_text = "exception `" line1`r`nline2 " + [char]0x4E2D
    }
    elseif ($Id -eq "RED-REPORT-003") {
        $Scenario.fail_command = "A.structure"
        $Scenario.fail_exit = 41
        $Scenario.stderr = "primary command failure"
        $Scenario.cleanup_failure = "build_root"
    }
}

function Test-TestDoublePathSafety {
    param($Fixture)
    $outside = $Fixture.base + "-prefix-collision"
    $sentinel = Join-Path $outside "sentinel.txt"
    $previousScenario = $script:Scenario
    try {
        New-Directory $outside
        Write-StableFile $sentinel "outside sentinel"
        $scenario = New-ScenarioState "HARNESS-PATH-SAFETY" $Fixture
        $script:Scenario = $scenario

        $cleanupSpec = [pscustomobject]@{
            root_id = "build_root"
            path = $outside
            trusted_parent = Split-Path -Parent $outside
            task_id = "SH-SAFE-BASE-001"
            run_id = $scenario.run_id
        }
        $cleanupRejected = $false
        try { & $fakeCleanupRunner $cleanupSpec } catch { $cleanupRejected = $_.Exception.Message -like "TEST_HARNESS_PATH_OUTSIDE_FIXTURE*" }
        Assert-True $cleanupRejected "Unsafe fake cleanup path was not rejected with the stable harness error"
        Assert-True (Test-Path -LiteralPath $sentinel -PathType Leaf) "Unsafe fake cleanup deleted the outside sentinel"

        $buildSpec = [pscustomobject]@{
            id = "B.build"
            route = "B"
            stage = "build"
            cwd = $Fixture.routes.B
            executable = $powershellPath
            arguments = @("--outDir", $outside)
            environment_policy = [pscustomobject]@{ inherit_environment = $false; exact_key_values = @() }
        }
        $buildRejected = $false
        try { & $fakeCommandRunner $buildSpec } catch { $buildRejected = $_.Exception.Message -like "TEST_HARNESS_PATH_OUTSIDE_FIXTURE*" }
        Assert-True $buildRejected "Unsafe fake build output was not rejected with the stable harness error"
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $outside "index.js"))) "Unsafe fake build wrote outside the fixture"

        $scenario.openclaw_mode = "allowlisted"
        $pluginSpec = [pscustomobject]@{
            id = "B.plugin_validate"
            route = "B"
            stage = "plugin_validate"
            cwd = $Fixture.routes.B
            executable = $powershellPath
            arguments = @()
            environment_policy = [pscustomobject]@{
                inherit_environment = $false
                exact_key_values = @([pscustomobject]@{ name = "OPENCLAW_STATE_DIR"; value = $outside; source = "malicious_test_spec" })
            }
        }
        $pluginRejected = $false
        try { & $fakeCommandRunner $pluginSpec } catch { $pluginRejected = $_.Exception.Message -like "TEST_HARNESS_PATH_OUTSIDE_FIXTURE*" }
        Assert-True $pluginRejected "Unsafe fake OpenClaw root was not rejected with the stable harness error"
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $outside "state\openclaw.sqlite"))) "Unsafe fake plugin wrote outside the fixture"
        Assert-True (Test-Path -LiteralPath $sentinel -PathType Leaf) "Outside sentinel changed during test-double rejection"
    }
    finally {
        $script:Scenario = $previousScenario
        if (Test-Path -LiteralPath $outside) {
            $tempPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
            $outsideFull = [System.IO.Path]::GetFullPath($outside)
            if (-not $outsideFull.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
                -not $outsideFull.Equals(([System.IO.Path]::GetFullPath($Fixture.base) + "-prefix-collision"), [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Unsafe harness sibling cleanup target: $outsideFull"
            }
            Remove-Item -LiteralPath $outsideFull -Recurse -Force
        }
    }
}

function Test-TestDoubleCleanupLongPathSafety {
    param($Fixture)
    $previousScenario = $script:Scenario
    try {
        $scenario = New-ScenarioState "HARNESS-CLEANUP-LONG-PATH" $Fixture
        $script:Scenario = $scenario
        $runRoot = [System.IO.Path]::GetFullPath([string]$scenario.allowed_run_roots.build_root)
        $extendedRunRoot = "\\?\" + $runRoot
        [void][System.IO.Directory]::CreateDirectory($extendedRunRoot)
        [System.IO.File]::WriteAllText([System.IO.Path]::Combine($extendedRunRoot, "ordinary-root-leaf.txt"), "ordinary root leaf", $script:Utf8NoBom)

        $deepDirectory = $extendedRunRoot
        foreach ($index in 1..7) {
            $deepDirectory = [System.IO.Path]::Combine($deepDirectory, (("segment-{0:D2}-" -f $index) + ("x" * 32)))
            [void][System.IO.Directory]::CreateDirectory($deepDirectory)
        }
        $longLeaf = [System.IO.Path]::Combine($deepDirectory, "ordinary-deep-leaf.txt")
        [System.IO.File]::WriteAllText($longLeaf, "ordinary deep leaf", $script:Utf8NoBom)
        Assert-True (($longLeaf.Substring(4)).Length -gt 260) "Fake cleanup long-path fixture did not exceed MAX_PATH"

        $externalSentinel = Join-Path $Fixture.external "cleanup-long-path-sentinel.txt"
        Write-StableFile $externalSentinel "cleanup long-path external sentinel"
        $externalBefore = Get-SnapshotDigest (Get-FileSnapshot @($externalSentinel))
        $cleanupSpec = [pscustomobject]@{
            root_id = "build_root"
            path = $runRoot
            trusted_parent = Split-Path -Parent (Split-Path -Parent $runRoot)
            task_id = "SH-SAFE-BASE-001"
            run_id = $scenario.run_id
        }

        $result = & $fakeCleanupRunner $cleanupSpec
        Assert-Equal 1 $scenario.cleanup_specs.Count "Long-path fake cleanup spec count"
        Assert-True ([bool]$result.succeeded) "Long-path fake cleanup did not report success"
        Assert-Equal 0 ([int]$result.residual_count) "Long-path fake cleanup residual count"
        Assert-True (-not [System.IO.Directory]::Exists($extendedRunRoot)) "Long-path fake cleanup root remained"
        Assert-Equal $externalBefore (Get-SnapshotDigest (Get-FileSnapshot @($externalSentinel))) "Long-path fake cleanup changed the external sentinel"
    }
    finally {
        $script:Scenario = $previousScenario
    }
}

function Test-TestDoubleCleanupReparseSafety {
    param($Fixture)
    $previousScenario = $script:Scenario
    $junctionPath = $null
    $junctionTarget = $null
    try {
        $scenario = New-ScenarioState "HARNESS-CLEANUP-REPARSE" $Fixture
        $script:Scenario = $scenario
        $runRoot = [System.IO.Path]::GetFullPath([string]$scenario.allowed_run_roots.validation_root)
        [void][System.IO.Directory]::CreateDirectory($runRoot)
        $ordinaryPath = Join-Path $runRoot "ordinary.txt"
        Write-StableFile $ordinaryPath "ordinary run-root leaf"
        $ordinaryBeforeBytes = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($ordinaryPath))
        $ordinaryBeforeSnapshot = @(Get-FileSnapshot @($ordinaryPath))[0]

        $junctionTarget = Join-Path $Fixture.external "cleanup-reparse-target"
        New-Directory $junctionTarget
        $externalSentinel = Join-Path $junctionTarget "sentinel.txt"
        Write-StableFile $externalSentinel "cleanup reparse external sentinel"
        $externalBefore = Get-SnapshotDigest (Get-FileSnapshot @($externalSentinel))
        $junctionPath = Join-Path $runRoot "unknown-reparse"
        [void](New-Item -ItemType Junction -Path $junctionPath -Target $junctionTarget)

        $cleanupSpec = [pscustomobject]@{
            root_id = "validation_root"
            path = $runRoot
            trusted_parent = Split-Path -Parent (Split-Path -Parent $runRoot)
            task_id = "SH-SAFE-BASE-001"
            run_id = $scenario.run_id
        }
        $reparseRejected = $false
        try {
            & $fakeCleanupRunner $cleanupSpec | Out-Null
        }
        catch {
            $reparseRejected = $_.Exception.Message -like "TEST_HARNESS_REPARSE_POINT_REJECTED*"
        }

        Assert-True $reparseRejected "Fake cleanup did not fail closed on an unknown reparse point"
        Assert-Equal 1 $scenario.cleanup_specs.Count "Reparse fake cleanup spec count"
        Assert-True (Test-Path -LiteralPath $runRoot -PathType Container) "Reparse fake cleanup changed the run root before rejecting it"
        Assert-True (Test-Path -LiteralPath $ordinaryPath -PathType Leaf) "Reparse fake cleanup deleted the ordinary leaf before rejecting the unknown reparse point"
        $ordinaryAfterSnapshot = @(Get-FileSnapshot @($ordinaryPath))[0]
        Assert-Equal $ordinaryBeforeBytes ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($ordinaryPath))) "Reparse fake cleanup changed the ordinary leaf bytes before rejecting the unknown reparse point"
        Assert-Equal ([long]$ordinaryBeforeSnapshot.length) ([long]$ordinaryAfterSnapshot.length) "Reparse fake cleanup changed the ordinary leaf length before rejecting the unknown reparse point"
        Assert-Equal ([string]$ordinaryBeforeSnapshot.sha256) ([string]$ordinaryAfterSnapshot.sha256) "Reparse fake cleanup changed the ordinary leaf SHA-256 before rejecting the unknown reparse point"
        Assert-Equal ([string]$ordinaryBeforeSnapshot.last_write_time_utc) ([string]$ordinaryAfterSnapshot.last_write_time_utc) "Reparse fake cleanup changed the ordinary leaf mtime before rejecting the unknown reparse point"
        Assert-True (Test-Path -LiteralPath $junctionPath) "Reparse fake cleanup deleted the unknown reparse point before rejecting it"
        Assert-Equal $externalBefore (Get-SnapshotDigest (Get-FileSnapshot @($externalSentinel))) "Reparse fake cleanup changed the external sentinel"
    }
    finally {
        if (-not [string]::IsNullOrWhiteSpace($junctionPath) -and -not [string]::IsNullOrWhiteSpace($junctionTarget)) {
            $junctionItem = Get-Item -LiteralPath $junctionPath -Force -ErrorAction SilentlyContinue
            if ($null -ne $junctionItem -and ($junctionItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                Remove-TestOwnedJunctionLeaf $Fixture $junctionPath $junctionTarget
            }
        }
        $script:Scenario = $previousScenario
    }
}

function Invoke-CoreForScenario {
    param($Fixture, $Scenario, $ManifestProvider, $ReportPublisher, $CommandRunner, $CleanupRunner, $PathPhaseObserver)
    $script:Scenario = $Scenario
    $selectedCommandRunner = if ($null -eq $CommandRunner) { $fakeCommandRunner } else { $CommandRunner }
    $selectedCleanupRunner = if ($null -eq $CleanupRunner) { $fakeCleanupRunner } else { $CleanupRunner }
    return Invoke-FoundationValidationCore -ProjectRoot $Fixture.project -EvidenceRoot $Fixture.evidence -Runtime $Fixture.runtime -CommandRunner $selectedCommandRunner -CleanupRunner $selectedCleanupRunner -EnvironmentAdapter $fakeEnvironmentAdapter -ManifestProvider $ManifestProvider -ReportPublisher $ReportPublisher -Clock $fakeClock -RunIdProvider $fakeRunIdProvider -PathPhaseObserver $PathPhaseObserver
}

function Invoke-PathPhaseObserverCoverageVariant {
    $variantFixture = $null
    $previousScenario = $script:Scenario
    try {
        $variantFixture = New-TestFixture -TypeboxFixtureProfile "structural_v1"
        Test-FixtureHarness $variantFixture
        $variantScenario = New-ScenarioState "RED-REPORT-005" $variantFixture
        $observations = New-Object System.Collections.ArrayList
        $observer = {
            param($Request)
            Assert-ExactPropertySet $Request @("phase", "operation_id", "pinned_paths", "target_path") "Path observer request"
            Assert-True ([string]$Request.phase -cin @("root_after_pin_before_create", "staging_after_source_pin_before_copy", "runtime_snapshot_after_input_pin_before_launch", "evidence_after_temp_write_before_rename", "cleanup_after_entry_pin_before_dispose")) "Path observer phase"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$Request.operation_id)) "Path observer operation ID"
            Assert-True ([System.IO.Path]::IsPathRooted([string]$Request.target_path)) "Path observer target"
            $pins = @($Request.pinned_paths)
            Assert-True ($pins.Count -gt 0) "Path observer pins"
            foreach ($pin in $pins) {
                Assert-ExactPropertySet $pin @("path", "volume_serial", "file_id", "attributes", "share_write", "share_delete") "Path observer pin"
                Assert-True (-not [bool]$pin.share_delete) "Path observer delete share"
            }
            [void]$observations.Add(($Request | ConvertTo-Json -Depth 8 -Compress | ConvertFrom-Json))
        }
        $variantReport = Invoke-CoreForScenario -Fixture $variantFixture -Scenario $variantScenario -ManifestProvider $null -ReportPublisher $null -CommandRunner $null -CleanupRunner $null -PathPhaseObserver $observer
        Assert-Equal "passed" ([string]$variantReport.verdict) "Path observer coverage verdict"
        Assert-True ([bool]$variantReport.test_seams.path_phase_observer_active) "Path observer coverage seam state"
        Assert-PathSecurityReport $variantReport "Path observer coverage"
        foreach ($phase in @("root_after_pin_before_create", "staging_after_source_pin_before_copy", "runtime_snapshot_after_input_pin_before_launch", "evidence_after_temp_write_before_rename", "cleanup_after_entry_pin_before_dispose")) {
            Assert-True (@($observations | Where-Object { [string]$_.phase -ceq $phase }).Count -gt 0) "Path observer phase not reached: $phase"
        }
        $knownOperationIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        foreach ($operation in @($variantReport.path_security.operations)) { [void]$knownOperationIds.Add([string]$operation.operation_id) }
        foreach ($observation in @($observations)) {
            Assert-True ($knownOperationIds.Contains([string]$observation.operation_id)) "Path observer operation was not reported: $($observation.operation_id)"
        }
        $observerFailureNormalized = $false
        try {
            $sample = @($observations)[0]
            Invoke-FoundationPathPhaseObserver -Observer { param($Request); throw "TEST_PATH_PHASE_OBSERVER_FAILURE" } -Phase ([string]$sample.phase) -OperationId "test-observer-normalization" -PinnedPaths @($sample.pinned_paths) -TargetPath ([string]$sample.target_path)
        }
        catch {
            $observerFailureNormalized = $_.Exception.Message -like "PATH_OPERATION_FAILED:*TEST_PATH_PHASE_OBSERVER_FAILURE*"
        }
        Assert-True $observerFailureNormalized "Path observer exception was not normalized"
    }
    finally {
        $script:Scenario = $previousScenario
        if ($null -ne $variantFixture) { Remove-TestFixture $variantFixture }
    }
}

function Invoke-PhysicalPolicyJournalAuthorityVariant {
    param($Fixture)
    $previousScenario = $script:Scenario
    try {
        $variantScenario = New-ScenarioState "RED-CACHE-001" $Fixture
        $journalAuthorityRunner = {
            param($Spec)
            $result = & $fakeCommandRunner $Spec
            if ([string]$Spec.id -ceq "B.test") {
                $helper = @($result.policy_attestations | Where-Object { [string]$_.role -ceq "snapshot_node_helper" })[0]
                $journalPath = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "validation_root" (Join-Path ([string]$Spec.execution_topology.policy_attestation_root) ("policy-ready-" + [int]$helper.pid + ".json"))
                Assert-True (Test-Path -LiteralPath $journalPath -PathType Leaf) "Physical policy journal authority setup missing helper attestation"
                Remove-TestDoubleFile $script:Scenario $journalPath
            }
            return $result
        }
        $before = Get-FileSnapshot $Fixture.seed_paths
        $report = Invoke-CoreForScenario $Fixture $variantScenario $null $null $journalAuthorityRunner
        $after = Get-FileSnapshot $Fixture.seed_paths
        Assert-SnapshotsEqual $before $after "Physical policy journal authority official fixture"
        Assert-Equal "failed" ([string]$report.verdict) "Physical policy journal authority verdict"
        Assert-True ((Get-ReportText $report) -match "TRUSTED_POLICY_[A-Z_]+_INVALID") "Physical policy journal authority error code"
    }
    finally {
        $script:Scenario = $previousScenario
    }
}

function Invoke-PhysicalPolicyJournalReparseVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    $previousScenario = $script:Scenario
    $reparseState = [pscustomobject]@{ junction_leaf = $null; target = $null; target_before = $null; b_test_reached = $false; core_returned = $false; phase = "not_started" }
    try {
        $variantFixture = New-TestFixture -TypeboxFixtureProfile "structural_v1"
        $reparseState.phase = "fixture_created"
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $reparseState.phase = "temp_redirected"
        Test-FixtureHarness $variantFixture
        $reparseState.phase = "fixture_verified"
        $variantScenario = New-ScenarioState "RED-CACHE-001" $variantFixture
        $reparseState.phase = "scenario_created"
        $journalAuthorityRunner = {
            param($Spec)
            $isBTest = [string]$Spec.id -ceq "B.test"
            if ($isBTest) {
                $reparseState.b_test_reached = $true
                $reparseState.phase = "b_test_entry"
            }
            $result = & $fakeCommandRunner $Spec
            if ($isBTest) {
                $reparseState.phase = "b_test_fake_runner_returned"
                $helper = @($result.policy_attestations | Where-Object { [string]$_.role -ceq "snapshot_node_helper" })[0]
                $reparseState.phase = "helper_attestation_selected"
                $journalRoot = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "validation_root" ([string]$Spec.execution_topology.policy_attestation_root)
                $journalPath = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "validation_root" (Join-Path $journalRoot ("policy-ready-" + [int]$helper.pid + ".json"))
                Assert-True (Test-Path -LiteralPath $journalPath -PathType Leaf) "Physical policy journal reparse setup missing helper attestation"
                $reparseState.phase = "journal_path_verified"
                $originalRoot = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "validation_root" ($journalRoot + "-original")
                $extendedJournalRoot = ConvertTo-TestHarnessExtendedLocalPath $journalRoot
                $extendedOriginalRoot = ConvertTo-TestHarnessExtendedLocalPath $originalRoot
                Assert-True ([System.IO.Directory]::Exists($extendedJournalRoot)) "Physical policy journal reparse journal root missing"
                $journalRootAttributes = [System.IO.File]::GetAttributes($extendedJournalRoot)
                Assert-True (($journalRootAttributes -band [System.IO.FileAttributes]::Directory) -ne 0) "Physical policy journal reparse journal root is not a directory"
                Assert-True (($journalRootAttributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Physical policy journal reparse journal root is a reparse point before setup"
                Assert-True (($journalRootAttributes -band [System.IO.FileAttributes]::Device) -eq 0) "Physical policy journal reparse journal root is a device"
                Assert-True (-not [System.IO.Directory]::Exists($extendedOriginalRoot) -and -not [System.IO.File]::Exists($extendedOriginalRoot)) "Physical policy journal reparse original root already exists"
                [System.IO.Directory]::Move($extendedJournalRoot, $extendedOriginalRoot)
                Assert-True (-not [System.IO.Directory]::Exists($extendedJournalRoot) -and -not [System.IO.File]::Exists($extendedJournalRoot)) "Physical policy journal reparse journal root remained after move"
                Assert-True ([System.IO.Directory]::Exists($extendedOriginalRoot)) "Physical policy journal reparse original root missing after move"
                $originalRootAttributes = [System.IO.File]::GetAttributes($extendedOriginalRoot)
                Assert-True (($originalRootAttributes -band [System.IO.FileAttributes]::Directory) -ne 0) "Physical policy journal reparse original root is not a directory"
                Assert-True (($originalRootAttributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Physical policy journal reparse original root is a reparse point"
                Assert-True (($originalRootAttributes -band [System.IO.FileAttributes]::Device) -eq 0) "Physical policy journal reparse original root is a device"
                $reparseState.phase = "journal_root_moved"
                $target = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base (Join-Path $script:Scenario.fixture.external "policy-journal-reparse-target")
                New-Directory $target
                $reparseState.phase = "external_target_created"
                $copiedJournals = @(Copy-TestHarnessImmediateOrdinaryFilesExtended $originalRoot $target)
                Assert-True ($copiedJournals.Count -gt 0) "Physical policy journal reparse copied no journal files"
                $reparseState.phase = "journals_copied"
                $reparseState.target = $target
                $reparseState.target_before = Get-TestPhysicalTreeDigest $script:Scenario.fixture $target
                $reparseState.phase = "external_target_snapshotted"
                [void](New-Item -ItemType Junction -Path $journalRoot -Target $target)
                $reparseState.junction_leaf = $journalRoot
                $reparseState.phase = "junction_installed"
            }
            return $result
        }
        $before = Get-FileSnapshot $variantFixture.seed_paths
        $reparseState.phase = "core_invocation_started"
        $report = Invoke-CoreForScenario $variantFixture $variantScenario $null $null $journalAuthorityRunner
        $reparseState.core_returned = $true
        $after = Get-FileSnapshot $variantFixture.seed_paths
        Assert-SnapshotsEqual $before $after "Physical policy journal reparse official fixture"
        Assert-True ($null -ne $reparseState.junction_leaf) "Physical policy journal reparse junction was not installed; b_test_reached=$($reparseState.b_test_reached); core_returned=$($reparseState.core_returned); phase=$($reparseState.phase)"
        Assert-Equal $reparseState.target_before (Get-TestPhysicalTreeDigest $variantFixture $reparseState.target) "Physical policy journal reparse external target"
        Assert-Equal "failed" ([string]$report.verdict) "Physical policy journal reparse verdict"
        Assert-True ((Get-ReportText $report) -match "TRUSTED_POLICY_[A-Z_]+_INVALID|PATH_REPARSE_POINT_REJECTED") "Physical policy journal reparse error code"
    }
    finally {
        try {
            Restore-ProcessEnvironmentState $tempState
        }
        finally {
            $script:Scenario = $previousScenario
            try {
                if ($null -ne $variantFixture -and $null -ne $reparseState.junction_leaf) {
                    Remove-TestOwnedJunctionLeaf $variantFixture $reparseState.junction_leaf $reparseState.target
                }
            }
            finally {
                Remove-TestFixture $variantFixture
            }
        }
    }
}

function Invoke-StructuralTypeboxClosureMutationVariant {
    param($Fixture)
    Assert-Equal "structural_v1" ([string]$Fixture.typebox_fixture_profile) "TypeBox closure mutation fixture profile"
    $previousScenario = $script:Scenario
    $originalRuntime = $Fixture.runtime
    $sourceRoot = Resolve-TestHarnessPathWithinFixture $Fixture.base ([string]$Fixture.runtime.dependency_source_roots.typebox_root)
    $mutationRelativePath = "src\value\check\check.js"
    $mutationPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $sourceRoot $mutationRelativePath)
    $originalBytes = [System.IO.File]::ReadAllBytes($mutationPath)
    $originalLastWriteTimeUtc = [System.IO.File]::GetLastWriteTimeUtc($mutationPath)
    $originalPackageHash = (Get-FileHash -LiteralPath (Join-Path $sourceRoot "package.json") -Algorithm SHA256).Hash.ToUpperInvariant()
    try {
        [System.IO.File]::AppendAllText($mutationPath, "structural-v1-non-package-mutation", $script:Utf8NoBom)
        Assert-True ([Convert]::ToBase64String($originalBytes) -cne [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($mutationPath))) "TypeBox closure mutation did not change the selected leaf"
        Assert-Equal $originalPackageHash ((Get-FileHash -LiteralPath (Join-Path $sourceRoot "package.json") -Algorithm SHA256).Hash.ToUpperInvariant()) "TypeBox closure mutation changed package.json"

        $variantRuntime = (($originalRuntime | ConvertTo-Json -Depth 32 -Compress) | ConvertFrom-Json)
        $tamperedPnpmTree = Get-TestFixtureTreeIdentity ([string]$variantRuntime.dependency_source_roots.pnpm_root)
        $variantRuntime.identity_expectations.source_trees.pnpm = $tamperedPnpmTree
        $variantRuntime.identity_expectations.snapshot_trees.pnpm = (($tamperedPnpmTree | ConvertTo-Json -Depth 8 -Compress) | ConvertFrom-Json)
        $Fixture.runtime = $variantRuntime

        $variantScenario = New-ScenarioState "RED-CACHE-001-TYPEBOX-CLOSURE-MUTATION" $Fixture
        Assert-TestTypeboxContractEqual $variantScenario.expected_typebox_contract $variantRuntime.identity_expectations.module_closure.staging_typebox "TypeBox mutation frozen closure contract"
        $officialBefore = Get-FileSnapshot $Fixture.seed_paths
        $report = Invoke-CoreForScenario $Fixture $variantScenario $null $null
        $officialAfter = Get-FileSnapshot $Fixture.seed_paths
        Assert-SnapshotsEqual $officialBefore $officialAfter "TypeBox closure mutation official fixture"
        Assert-Equal "failed" ([string]$report.verdict) "TypeBox closure mutation verdict"
        Assert-True ((Get-ReportText $report) -match [regex]::Escape("RUNTIME_MODULE_CLOSURE_INVALID:snapshot_ready:typebox_tree")) "TypeBox closure mutation was not rejected by the frozen module closure"
        Assert-Equal 0 @($variantScenario.observed_specs).Count "TypeBox closure mutation executed a command"
    }
    finally {
        $Fixture.runtime = $originalRuntime
        [System.IO.File]::WriteAllBytes($mutationPath, $originalBytes)
        [System.IO.File]::SetLastWriteTimeUtc($mutationPath, $originalLastWriteTimeUtc)
        Assert-StructuralV1TypeboxTree $sourceRoot "TypeBox closure mutation restored source"
        $script:Scenario = $previousScenario
    }
}

function Invoke-AdditionalInvalidStagingVariant {
    param([string]$Variant)
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture -TypeboxFixtureProfile "production_exact"
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $typeboxSource = Resolve-TestHarnessPathWithinFixture $variantFixture.base ([string]$variantFixture.runtime.dependency_source_roots.typebox_root)
        $expectedSource = Resolve-TestHarnessPathWithinFixture $variantFixture.base (Join-Path $variantFixture.routes.C "node_modules\.pnpm\typebox@1.3.11\node_modules\typebox")
        Assert-Equal $expectedSource $typeboxSource "Invalid staging variant authoritative C TypeBox source"
        $sourceItem = Get-Item -LiteralPath $typeboxSource -Force
        Assert-True (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Invalid staging variant C TypeBox source is a reparse point"
        $sourceBackup = Resolve-TestHarnessPathWithinFixture $variantFixture.base (Join-Path $variantFixture.external ("typebox-source-backup-" + $Variant))
        Assert-True (-not (Test-Path -LiteralPath $sourceBackup)) "Invalid staging variant source backup already exists"
        [System.IO.Directory]::Move($typeboxSource, $sourceBackup)
        if ($Variant -eq "missing") {
            Assert-True (-not (Test-Path -LiteralPath $typeboxSource)) "Invalid staging missing source remained"
        }
        elseif ($Variant -eq "wrong_junction_target") {
            $wrongTarget = Resolve-TestHarnessPathWithinFixture $variantFixture.base (Join-Path $variantFixture.external "wrong-typebox")
            New-Directory $wrongTarget
            Write-StableFile (Join-Path $wrongTarget "package.json") "wrong target"
            [void](New-Item -ItemType Junction -Path $typeboxSource -Target $wrongTarget)
            $wrongSourceItem = Get-Item -LiteralPath $typeboxSource -Force
            Assert-True (($wrongSourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) "Invalid staging wrong target source was not a junction"
        }
        else {
            throw "Unknown invalid staging variant: $Variant"
        }
        $variantScenario = New-ScenarioState "RED-STAGING-002-$Variant" $variantFixture
        Invoke-DirectInvalidPluginStagingOracle $variantFixture "C" $Variant
        $officialBefore = Get-FileSnapshot $variantFixture.seed_paths
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $null $null
        $observationDigests = Assert-OfficialObservationPair $variantReport $variantFixture "Invalid staging variant $Variant"
        $officialAfter = Get-FileSnapshot $variantFixture.seed_paths
        Assert-SnapshotsEqual $officialBefore $officialAfter "Invalid staging variant $Variant physical official fixture"
        Assert-BasicReport $variantReport
        Assert-Equal "failed" $variantReport.verdict "Invalid staging variant verdict: $Variant"
        Assert-FaultFieldShape $variantReport
        Assert-ConcreteFaultFields $variantReport "lifecycle" "RUNTIME_IDENTITY_INVALID" $observationDigests.pre_state_hash $observationDigests.post_state_hash 0 0 0
        Assert-True ((Get-ReportText $variantReport) -match "RUNTIME_IDENTITY_INVALID") "Stable runtime identity error missing for invalid staging variant: $Variant"
        Assert-Equal 0 @($variantScenario.observed_specs | Where-Object { $_.stage -like "plugin*" }).Count "Plugin stage executed for invalid staging variant: $Variant"
        Assert-Equal 4 @($variantScenario.cleanup_specs).Count "Cleanup count for invalid staging variant: $Variant"
        Assert-True ($null -ne $variantReport.manifests.official.after) "After manifest missing for invalid staging variant: $Variant"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-DirectInvalidPluginStagingOracle {
    param($Fixture, [string]$Route, [string]$Label)
    $destination = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.external ("direct-invalid-staging-" + $Label))
    Assert-True (-not (Test-Path -LiteralPath $destination)) "Direct invalid staging destination already exists: $Label"
    $threw = $false
    $errorMessage = $null
    try {
        [void](New-FoundationPluginStaging -Route $Route -RouteRoot ([string]$Fixture.routes[$Route]) -StagingRoot $destination -Runtime $Fixture.runtime)
    }
    catch {
        $threw = $true
        $errorMessage = [string]$_.Exception.Message
    }
    Assert-True $threw "Direct invalid staging did not reject dependency: $Label"
    Assert-True ($errorMessage -like "STAGING_DEPENDENCY_INVALID*") "Direct invalid staging error prefix: $Label; observed=$errorMessage"
    Assert-True (-not (Test-Path -LiteralPath $destination)) "Direct invalid staging wrote destination after dependency rejection: $Label"
}

function Add-TestVitestStagingEnvironmentPoison {
    param(
        $Scenario,
        [ValidateSet("B", "C")][string]$Route
    )
    $stagingRoot = Resolve-TestHarnessPathUnderRunRoot $Scenario "build_root" (Join-Path ([string]$Scenario.allowed_run_roots.build_root) (Join-Path $Route "staging"))
    $paths = New-Object System.Collections.ArrayList
    foreach ($leaf in @(".env", ".env.local", ".env.production")) {
        $path = Resolve-TestHarnessPathUnderRunRoot $Scenario "build_root" (Join-Path $stagingRoot $leaf)
        Write-TestDoubleStableFile $Scenario $path "VITEST_FORBIDDEN_ENV=1"
        Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "Vitest .env poison setup missing: $Route/$leaf"
        [void]$Scenario.vitest_env_poison_paths.Add($path)
        [void]$paths.Add($path)
    }
    return @($paths)
}

function Invoke-VitestStagingEnvironmentPoisonVariant {
    param([ValidateSet("B", "C")][string]$Route)
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    $previousScenario = $script:Scenario
    try {
        $variantFixture = New-TestFixture -TypeboxFixtureProfile "structural_v1"
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        Test-FixtureHarness $variantFixture
        $variantScenario = New-ScenarioState ("RED-CACHE-VITEST-001-" + $Route + "-STAGING-ENV") $variantFixture
        $poisonPaths = @(Add-TestVitestStagingEnvironmentPoison $variantScenario $Route)
        Assert-Equal 3 $poisonPaths.Count "Vitest $Route-only poison path count"
        Assert-Equal 3 @($variantScenario.vitest_env_poison_paths).Count "Vitest $Route-only Scenario poison count"

        $officialBefore = Get-FileSnapshot $variantFixture.seed_paths
        $guardBefore = Get-FileSnapshot $variantFixture.guard_paths
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $null $null
        $observationDigests = Assert-OfficialObservationPair $variantReport $variantFixture "Vitest $Route-only staging environment poison"
        $officialAfter = Get-FileSnapshot $variantFixture.seed_paths
        $guardAfter = Get-FileSnapshot $variantFixture.guard_paths

        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "Vitest $Route-only poison verdict"
        Assert-ConcreteFaultFields $variantReport ("before_command:" + $Route + ".test") "RUNTIME_IDENTITY_INVALID" $observationDigests.pre_state_hash $observationDigests.post_state_hash 0 0 0
        Assert-True ((Get-ReportText $variantReport.errors) -match "staging_environment_file") "Vitest $Route-only poison stable staging error missing"
        Assert-True ((Get-ReportText $variantReport.errors) -match "RUNTIME_IDENTITY_INVALID") "Vitest $Route-only poison runtime identity error missing"
        Assert-Equal 0 @($variantScenario.observed_specs | Where-Object { [string]$_.id -ceq ($Route + ".test") }).Count "Vitest $Route-only poison reached the related runner"
        $testRows = @($variantReport.commands | Where-Object { [string]$_.id -ceq ($Route + ".test") })
        Assert-Equal 1 $testRows.Count "Vitest $Route-only poison command row count"
        Assert-Equal "skipped" ([string]$testRows[0].status) "Vitest $Route-only poison command status"
        foreach ($path in $poisonPaths) {
            Assert-True (-not (Test-Path -LiteralPath $path)) "Vitest $Route-only poison remained after cleanup: $path"
        }
        foreach ($temporaryRoot in @($variantReport.temporary_roots)) {
            Assert-True ([bool]$temporaryRoot.cleanup.attempted) "Vitest $Route-only cleanup was not attempted: $($temporaryRoot.root_id)"
            Assert-True ([bool]$temporaryRoot.cleanup.succeeded) "Vitest $Route-only cleanup failed: $($temporaryRoot.root_id)"
            Assert-Equal 0 ([int]$temporaryRoot.physical_residual_count) "Vitest $Route-only physical residual: $($temporaryRoot.root_id)"
        }
        Assert-SnapshotsEqual $officialBefore $officialAfter "Vitest $Route-only poison official fixture"
        Assert-SnapshotsEqual $guardBefore $guardAfter "Vitest $Route-only poison guards"
        Assert-ExternalGuardReport $variantReport $variantFixture $variantScenario $true
        Assert-SourceDistReportEmpty $variantReport $variantFixture "Vitest $Route-only poison"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        $script:Scenario = $previousScenario
        Remove-TestFixture $variantFixture
    }
}

function Get-TestAuthoritativePolicyJournalAuditEntries {
    param($Report)
    $entries = New-Object System.Collections.ArrayList
    foreach ($temporaryRoot in @($Report.temporary_roots)) {
        if ($null -eq $temporaryRoot) { continue }
        $auditProperty = $temporaryRoot.PSObject.Properties["pre_delete_audit"]
        if ($null -eq $auditProperty -or $null -eq $auditProperty.Value) { continue }
        $entriesProperty = $auditProperty.Value.PSObject.Properties["entries"]
        if ($null -eq $entriesProperty) { continue }
        foreach ($entry in @($entriesProperty.Value)) {
            if ($null -ne $entry -and -not [string]::IsNullOrWhiteSpace([string]$entry.full_path)) {
                [void]$entries.Add($entry)
            }
        }
    }
    if ($null -ne $Report.openclaw_state -and $null -ne $Report.openclaw_state.pre_delete_audit) {
        foreach ($entry in @($Report.openclaw_state.pre_delete_audit.entries)) {
            if ($null -ne $entry -and -not [string]::IsNullOrWhiteSpace([string]$entry.full_path)) {
                [void]$entries.Add($entry)
            }
        }
    }
    return @($entries)
}

function Invoke-TemporaryResidualJunctionVariant {
    $variantFixture = $null
    $variantScenario = $null
    $junctionPath = $null
    $junctionTarget = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    $previousScenario = $script:Scenario
    try {
        $variantFixture = New-TestFixture -TypeboxFixtureProfile "structural_v1"
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        Test-FixtureHarness $variantFixture
        $variantScenario = New-ScenarioState "RED-TEMP-001-VALIDATION-JUNCTION" $variantFixture
        $variantScenario.cleanup_failure = "validation_root"
        $variantScenario.cleanup_failure_adapter_residual_count = 0

        $junctionTarget = Resolve-TestHarnessPathWithinFixture $variantFixture.base (Join-Path $variantFixture.external "validation-residual-junction-target")
        New-Directory $junctionTarget
        $externalSentinel = Resolve-TestHarnessPathWithinFixture $variantFixture.base (Join-Path $junctionTarget "sentinel.txt")
        Write-StableFile $externalSentinel "validation residual junction target"
        $targetBefore = Get-TestPhysicalTreeDigest $variantFixture $junctionTarget
        $junctionPath = Resolve-TestHarnessPathUnderRunRoot $variantScenario "validation_root" (Join-Path ([string]$variantScenario.allowed_run_roots.validation_root) "adapter-residual-junction")
        $variantScenario.cleanup_junction_path = $junctionPath
        $variantScenario.cleanup_junction_target = $junctionTarget

        $junctionCleanupRunner = {
            param($Spec)
            if ([string]$Spec.root_id -ceq "validation_root") {
                $safeRoot = Assert-TestHarnessExactRunRoot $script:Scenario "validation_root" ([string]$Spec.path)
                $safeJunction = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "validation_root" ([string]$script:Scenario.cleanup_junction_path)
                Assert-Equal ([System.IO.Path]::GetFullPath($safeRoot)) ([System.IO.Path]::GetFullPath((Split-Path -Parent $safeJunction))) "Residual junction exact validation parent"
                Assert-True (-not (Test-Path -LiteralPath $safeJunction)) "Residual junction leaf already exists"
                [void](New-Item -ItemType Junction -Path $safeJunction -Target ([string]$script:Scenario.cleanup_junction_target))
                $junctionItem = Get-Item -LiteralPath $safeJunction -Force
                Assert-True (($junctionItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) "Residual junction setup did not create a reparse leaf"
                $script:Scenario.cleanup_junction_created = $true
            }
            return & $fakeCleanupRunner $Spec
        }

        $officialBefore = Get-FileSnapshot $variantFixture.seed_paths
        $variantReport = Invoke-CoreForScenario -Fixture $variantFixture -Scenario $variantScenario -ManifestProvider $null -ReportPublisher $null -CommandRunner $null -CleanupRunner $junctionCleanupRunner
        $observationDigests = Assert-OfficialObservationPair $variantReport $variantFixture "RED-TEMP-001 validation junction"
        $officialAfter = Get-FileSnapshot $variantFixture.seed_paths

        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "Validation junction residual verdict"
        Assert-ConcreteFaultFields $variantReport "cleanup:validation_root" "TEMP_ROOT_CLEANUP_FAILED" $observationDigests.pre_state_hash $observationDigests.post_state_hash 0 0 0
        Assert-ExactErrorCodeCount $variantReport.errors "TEMP_ROOT_CLEANUP_FAILED" 1 "Validation junction cleanup stable error count"
        Assert-True ([bool]$variantScenario.cleanup_junction_created) "Validation cleanup runner did not create the junction"
        Assert-Equal 4 @($variantScenario.cleanup_specs).Count "Validation junction cleanup attempt count"
        $validationRows = @($variantReport.temporary_roots | Where-Object { [string]$_.root_id -ceq "validation_root" })
        Assert-Equal 1 $validationRows.Count "Validation junction temporary root row"
        $validationRow = $validationRows[0]
        Assert-True ([bool]$validationRow.cleanup.attempted) "Validation junction adapter cleanup was not attempted"
        Assert-Equal 0 ([int]$validationRow.cleanup.residual_count) "Validation junction adapter lie-zero residual"
        Assert-True (-not [bool]$validationRow.cleanup.succeeded) "Validation junction adapter unexpectedly succeeded"
        Assert-True ([int]$validationRow.physical_residual_count -gt 0) "Validation junction physical residual count"
        Assert-Equal @($validationRow.physical_residual_entries).Count ([int]$validationRow.physical_residual_count) "Validation junction physical residual entry count"
        $junctionEntries = @($validationRow.physical_residual_entries | Where-Object { ([System.IO.Path]::GetFullPath([string]$_.path)).Equals([System.IO.Path]::GetFullPath($junctionPath), [System.StringComparison]::OrdinalIgnoreCase) })
        Assert-Equal 1 $junctionEntries.Count "Validation junction physical residual leaf"
        Assert-Equal "reparse_leaf" ([string]$junctionEntries[0].entry_kind) "Validation junction physical residual kind"
        $targetFull = [System.IO.Path]::GetFullPath($junctionTarget).TrimEnd("\", "/")
        $targetPrefix = $targetFull + [System.IO.Path]::DirectorySeparatorChar
        $followedTargetEntries = @($validationRow.physical_residual_entries | Where-Object {
            $entryPath = [System.IO.Path]::GetFullPath([string]$_.path)
            $entryPath.Equals($targetFull, [System.StringComparison]::OrdinalIgnoreCase) -or $entryPath.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase)
        })
        Assert-Equal 0 $followedTargetEntries.Count "Validation physical residual scan followed the junction target"
        Assert-Equal $targetBefore (Get-TestPhysicalTreeDigest $variantFixture $junctionTarget) "Validation junction external target"
        foreach ($otherRoot in @($variantReport.temporary_roots | Where-Object { [string]$_.root_id -cne "validation_root" })) {
            Assert-Equal 0 ([int]$otherRoot.physical_residual_count) "Validation junction affected another root: $($otherRoot.root_id)"
        }
        Assert-SnapshotsEqual $officialBefore $officialAfter "Validation junction official fixture"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        $script:Scenario = $previousScenario
        if ($null -ne $variantFixture -and -not [string]::IsNullOrWhiteSpace($junctionPath) -and -not [string]::IsNullOrWhiteSpace($junctionTarget)) {
            $junctionItem = Get-Item -LiteralPath $junctionPath -Force -ErrorAction SilentlyContinue
            if ($null -ne $junctionItem) {
                Assert-True (($junctionItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) "Validation residual cleanup leaf is not a junction"
                Remove-TestOwnedJunctionLeaf $variantFixture $junctionPath $junctionTarget
            }
        }
        Remove-TestFixture $variantFixture
    }
}

function Assert-PublicationArtifactSet {
    param($Report, $Fixture, $Request, $Scenario, [string]$ExpectedStatus, [string]$Label)
    Assert-ExactPropertySet $Request @("json_record", "raw_records") "$Label publisher request"
    Assert-ExactPropertySet $Request.json_record @("artifact_id", "artifact_kind", "temporary_path", "requested_path", "expected_sha256", "bytes") "$Label publisher JSON record"
    Assert-Equal "machine_json" ([string]$Request.json_record.artifact_id) "$Label publisher JSON artifact ID"
    Assert-Equal "machine_json" ([string]$Request.json_record.artifact_kind) "$Label publisher JSON artifact kind"
    Assert-True ($Request.json_record.bytes -is [byte[]]) "$Label publisher JSON bytes type"
    Assert-Equal (Get-BytesSha256 ([byte[]]$Request.json_record.bytes)) ([string]$Request.json_record.expected_sha256) "$Label publisher JSON frozen SHA-256"
    Assert-Equal 1 @($Scenario.publisher_report_snapshots).Count "$Label publisher JSON snapshot count"
    Assert-Equal ([string]@($Scenario.publisher_report_snapshots)[0]) ([Convert]::ToBase64String([byte[]]$Request.json_record.bytes)) "$Label publisher JSON bytes changed after adapter return"

    $rawRecords = @($Request.raw_records)
    Assert-True (-not ($Request.raw_records -is [string])) "$Label raw records were stringified"
    Assert-Equal 27 $rawRecords.Count "$Label preregistered raw artifact count"
    foreach ($record in $rawRecords) {
        Assert-ExactPropertySet $record @("artifact_id", "artifact_kind", "temporary_path", "requested_path", "expected_sha256", "bytes") "$Label publisher raw record $($record.artifact_id)"
        Assert-True ($record.bytes -is [byte[]]) "$Label publisher raw bytes type: $($record.artifact_id)"
        Assert-Equal (Get-BytesSha256 ([byte[]]$record.bytes)) ([string]$record.expected_sha256) "$Label publisher raw frozen SHA-256: $($record.artifact_id)"
    }

    $machineText = [string]$script:Utf8NoBom.GetString([byte[]]$Request.json_record.bytes)
    $machineReport = $machineText | ConvertFrom-Json
    Assert-True ($null -eq $machineReport.PSObject.Properties["publication"]) "$Label machine report contained final publication"
    Assert-True ($null -eq $machineReport.PSObject.Properties["json_sha256"]) "$Label machine report contained its own JSON SHA-256"
    $expectedCommandIds = @("A.structure", "B.test", "B.build", "B.plugin_build_check", "B.plugin_validate", "C.test", "C.build", "C.plugin_build_check", "C.plugin_validate")
    $machineCommands = @($machineReport.commands)
    Assert-Equal 9 $machineCommands.Count "$Label frozen machine command count"
    Assert-Equal ($expectedCommandIds -join "|") (@($machineCommands | ForEach-Object { [string]$_.id }) -join "|") "$Label frozen machine command order"
    Assert-Equal $rawRecords.Count @($rawRecords | ForEach-Object { [string]$_.artifact_id } | Sort-Object -Unique).Count "$Label raw record artifact ID uniqueness"
    Assert-Equal $rawRecords.Count @($rawRecords | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.requested_path) } | Sort-Object -Unique).Count "$Label raw record path uniqueness"
    $expectedRawPathsList = New-Object System.Collections.Generic.List[string]
    $expectedRawHashesList = New-Object System.Collections.Generic.List[string]
    $channelSpecs = @(
        [pscustomobject]@{ name = "stdout"; path_field = "stdout_raw_path"; hash_field = "stdout_sha256"; text_field = "stdout"; artifact_kind = "stdout_raw" },
        [pscustomobject]@{ name = "stderr"; path_field = "stderr_raw_path"; hash_field = "stderr_sha256"; text_field = "stderr"; artifact_kind = "stderr_raw" },
        [pscustomobject]@{ name = "exception"; path_field = "exception_raw_path"; hash_field = "exception_sha256"; text_field = "exception_text"; artifact_kind = "exception_raw" }
    )
    foreach ($commandId in $expectedCommandIds) {
        $commandMatches = @($machineCommands | Where-Object { [string]$_.id -ceq $commandId })
        Assert-Equal 1 $commandMatches.Count "$Label frozen machine command identity: $commandId"
        $command = $commandMatches[0]
        foreach ($channel in $channelSpecs) {
            $expectedPath = [System.IO.Path]::GetFullPath([string]$command.PSObject.Properties[$channel.path_field].Value)
            $expectedBytes = [byte[]]$script:Utf8NoBom.GetBytes([string]$command.PSObject.Properties[$channel.text_field].Value)
            $expectedHash = Get-BytesSha256 $expectedBytes
            Assert-Equal $expectedHash ([string]$command.PSObject.Properties[$channel.hash_field].Value) "$Label frozen machine $($channel.name) SHA-256: $commandId"
            $recordMatches = @($rawRecords | Where-Object { ([System.IO.Path]::GetFullPath([string]$_.requested_path)).Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase) })
            Assert-Equal 1 $recordMatches.Count "$Label preregistered raw mapping: $commandId/$($channel.name)"
            Assert-Equal ([string]$channel.artifact_kind) ([string]$recordMatches[0].artifact_kind) "$Label preregistered raw kind: $commandId/$($channel.name)"
            Assert-Equal ([Convert]::ToBase64String($expectedBytes)) ([Convert]::ToBase64String([byte[]]$recordMatches[0].bytes)) "$Label preregistered raw bytes: $commandId/$($channel.name)"
            Assert-Equal $expectedHash ([string]$recordMatches[0].expected_sha256) "$Label preregistered raw hash: $commandId/$($channel.name)"
            [void]$expectedRawPathsList.Add($expectedPath)
            [void]$expectedRawHashesList.Add($expectedHash)
        }
    }
    $expectedRawPaths = @($expectedRawPathsList)
    $expectedRawHashes = @($expectedRawHashesList)
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedRawPaths) (Get-OrdinalIgnoreCaseSignature @($rawRecords | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.requested_path) })) "$Label independent raw path set"
    $machineRawPaths = @($machineReport.raw_paths | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
    $machineRawHashes = @($machineReport.raw_sha256 | ForEach-Object { [string]$_ })
    Assert-Equal 27 $machineRawPaths.Count "$Label frozen machine raw path count"
    Assert-Equal 27 $machineRawHashes.Count "$Label frozen machine raw SHA-256 count"
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedRawPaths) (Get-OrdinalIgnoreCaseSignature $machineRawPaths) "$Label frozen machine raw path set"
    for ($machineRawIndex = 0; $machineRawIndex -lt $machineRawPaths.Count; $machineRawIndex++) {
        $expectedIndexes = @(0..($expectedRawPaths.Count - 1) | Where-Object { $expectedRawPaths[$_].Equals($machineRawPaths[$machineRawIndex], [System.StringComparison]::OrdinalIgnoreCase) })
        Assert-Equal 1 $expectedIndexes.Count "$Label frozen machine raw path mapping: $($machineRawPaths[$machineRawIndex])"
        Assert-Equal ([string]$expectedRawHashes[$expectedIndexes[0]]) ([string]$machineRawHashes[$machineRawIndex]) "$Label frozen machine raw path/hash index alignment: $($machineRawPaths[$machineRawIndex])"
    }
    Assert-Equal ([System.IO.Path]::GetFullPath([string]$Request.json_record.requested_path)) ([System.IO.Path]::GetFullPath([string]$machineReport.report_path)) "$Label frozen machine report path"

    Assert-ExactPropertySet $machineReport.artifact_plan @("json_record", "raw_records") "$Label machine artifact plan"
    Assert-ExactPropertySet $machineReport.artifact_plan.json_record @("artifact_id", "artifact_kind", "temporary_path", "requested_path", "expected_sha256") "$Label machine artifact plan JSON"
    Assert-Null $machineReport.artifact_plan.json_record.expected_sha256 "$Label machine artifact plan JSON self hash sentinel"
    foreach ($field in @("artifact_id", "artifact_kind", "temporary_path", "requested_path")) {
        Assert-Equal ([string]$machineReport.artifact_plan.json_record.$field) ([string]$Request.json_record.$field) "$Label machine/request JSON plan field: $field"
    }
    $planRawRecords = @($machineReport.artifact_plan.raw_records)
    Assert-Equal 27 $planRawRecords.Count "$Label machine artifact plan raw count"
    foreach ($planRecord in $planRawRecords) {
        Assert-ExactPropertySet $planRecord @("artifact_id", "artifact_kind", "temporary_path", "requested_path", "expected_sha256") "$Label machine artifact plan raw $($planRecord.artifact_id)"
        $requestMatches = @($rawRecords | Where-Object { [string]$_.artifact_id -ceq [string]$planRecord.artifact_id })
        Assert-Equal 1 $requestMatches.Count "$Label machine/request raw plan mapping: $($planRecord.artifact_id)"
        foreach ($field in @("artifact_kind", "temporary_path", "requested_path", "expected_sha256")) {
            Assert-Equal ([string]$planRecord.$field) ([string]$requestMatches[0].$field) "$Label machine/request raw plan field: $($planRecord.artifact_id)/$field"
        }
    }

    Assert-ExactPropertySet $Report.publication @("status", "artifacts", "temporary_artifacts", "evidence_residual_count") "$Label publication"
    Assert-Equal $ExpectedStatus ([string]$Report.publication.status) "$Label publication status"
    Assert-Equal 0 ([int]$Report.publication.evidence_residual_count) "$Label publication evidence residual count"
    Assert-True (-not ($Report.publication.artifacts -is [string])) "$Label publication artifacts were stringified"
    $artifacts = @($Report.publication.artifacts)
    Assert-Equal 28 $artifacts.Count "$Label publication artifact count"
    Assert-Equal $artifacts.Count @($artifacts | ForEach-Object { [string]$_.artifact_id } | Sort-Object -Unique).Count "$Label publication artifact ID uniqueness"
    Assert-Equal $artifacts.Count @($artifacts | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.requested_path) } | Sort-Object -Unique).Count "$Label publication requested path uniqueness"
    $expectedArtifactPaths = @($expectedRawPaths) + @([System.IO.Path]::GetFullPath([string]$Request.json_record.requested_path))
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedArtifactPaths) (Get-OrdinalIgnoreCaseSignature @($artifacts | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.requested_path) })) "$Label independent publication path set"
    $evidenceRoot = [System.IO.Path]::GetFullPath($Fixture.evidence).TrimEnd("\", "/")
    $evidencePrefix = $evidenceRoot + [System.IO.Path]::DirectorySeparatorChar
    $allRequestRecords = @($rawRecords) + @($Request.json_record)
    Assert-Equal 28 @($allRequestRecords | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.temporary_path) } | Sort-Object -Unique).Count "$Label temporary path uniqueness"
    foreach ($record in $allRequestRecords) {
        $temporary = [System.IO.Path]::GetFullPath([string]$record.temporary_path)
        $requested = [System.IO.Path]::GetFullPath([string]$record.requested_path)
        Assert-True ($temporary.StartsWith($evidencePrefix, [System.StringComparison]::OrdinalIgnoreCase)) "$Label temporary path escaped evidence root: $($record.artifact_id)"
        Assert-True ($requested.StartsWith($evidencePrefix, [System.StringComparison]::OrdinalIgnoreCase)) "$Label requested path escaped evidence root: $($record.artifact_id)"
        Assert-True (-not $temporary.Equals($requested, [System.StringComparison]::OrdinalIgnoreCase)) "$Label temporary path equals requested path: $($record.artifact_id)"
        Assert-True ([string]$record.temporary_path -match [regex]::Escape([string]$Scenario.run_id)) "$Label temporary path omitted run ID: $($record.artifact_id)"
        Assert-True ([string]$record.requested_path -match [regex]::Escape([string]$Scenario.run_id)) "$Label requested path omitted run ID: $($record.artifact_id)"
    }
    foreach ($artifact in $artifacts) {
        $keys = @($artifact.PSObject.Properties | ForEach-Object { [string]$_.Name })
        Assert-Equal (Get-OrdinalIgnoreCaseSignature @("artifact_id", "artifact_kind", "requested_path", "published_path", "status", "sha256", "error_type", "error_text")) (Get-OrdinalIgnoreCaseSignature $keys) "$Label artifact exact keys: $($artifact.artifact_id)"
        Assert-ExactPropertySet $artifact @("artifact_id", "artifact_kind", "requested_path", "published_path", "status", "sha256", "error_type", "error_text") "$Label artifact $($artifact.artifact_id)"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$artifact.artifact_id)) "$Label artifact ID missing"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$artifact.artifact_kind)) "$Label artifact kind missing: $($artifact.artifact_id)"
        $requested = [System.IO.Path]::GetFullPath([string]$artifact.requested_path)
        Assert-True ($requested.StartsWith($evidencePrefix, [System.StringComparison]::OrdinalIgnoreCase)) "$Label artifact path escaped evidence root: $($artifact.artifact_id)"
        Assert-True ([string]$artifact.status -cin @("published", "partial_unconfirmed", "not_published")) "$Label artifact status invalid: $($artifact.artifact_id)"
    }
    foreach ($rawRecord in $rawRecords) {
        $matches = @($artifacts | Where-Object { [string]$_.artifact_id -ceq [string]$rawRecord.artifact_id })
        Assert-Equal 1 $matches.Count "$Label raw artifact mapping: $($rawRecord.artifact_id)"
        Assert-Equal ([string]$rawRecord.artifact_kind) ([string]$matches[0].artifact_kind) "$Label raw artifact kind: $($rawRecord.artifact_id)"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$rawRecord.requested_path)) ([System.IO.Path]::GetFullPath([string]$matches[0].requested_path)) "$Label raw artifact requested path: $($rawRecord.artifact_id)"
    }
    $jsonArtifacts = @($artifacts | Where-Object { [string]$_.artifact_kind -ceq "machine_json" })
    Assert-Equal 1 $jsonArtifacts.Count "$Label machine JSON artifact count"
    Assert-Equal ([System.IO.Path]::GetFullPath([string]$Request.json_record.requested_path)) ([System.IO.Path]::GetFullPath([string]$jsonArtifacts[0].requested_path)) "$Label machine JSON requested path"

    $temporaryArtifacts = @($Report.publication.temporary_artifacts)
    Assert-Equal 28 $temporaryArtifacts.Count "$Label temporary artifact count"
    foreach ($temporaryArtifact in $temporaryArtifacts) {
        Assert-ExactPropertySet $temporaryArtifact @("artifact_id", "temp_path", "cleanup") "$Label temporary artifact $($temporaryArtifact.artifact_id)"
        Assert-ExactPropertySet $temporaryArtifact.cleanup @("attempted", "succeeded", "residual_count", "error_type", "error_text") "$Label temporary cleanup $($temporaryArtifact.artifact_id)"
        $requestMatches = @($allRequestRecords | Where-Object { [string]$_.artifact_id -ceq [string]$temporaryArtifact.artifact_id })
        Assert-Equal 1 $requestMatches.Count "$Label temporary artifact mapping: $($temporaryArtifact.artifact_id)"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$requestMatches[0].temporary_path)) ([System.IO.Path]::GetFullPath([string]$temporaryArtifact.temp_path)) "$Label temporary artifact path: $($temporaryArtifact.artifact_id)"
        Assert-Equal 0 ([int]$temporaryArtifact.cleanup.residual_count) "$Label temporary artifact residual: $($temporaryArtifact.artifact_id)"
        Assert-True ([bool]$temporaryArtifact.cleanup.succeeded) "$Label temporary artifact cleanup: $($temporaryArtifact.artifact_id)"
        Assert-True (-not (Test-Path -LiteralPath ([string]$temporaryArtifact.temp_path))) "$Label temporary artifact exists: $($temporaryArtifact.artifact_id)"
    }
    return $artifacts
}

function Assert-ZeroPublicationFailure {
    param($Report, $Fixture, $Scenario, [string]$Label)
    Assert-Equal 1 @($Scenario.publisher_requests).Count "$Label publisher request count"
    $request = @($Scenario.publisher_requests)[0]
    $artifacts = Assert-PublicationArtifactSet $Report $Fixture $request $Scenario "failed" $Label
    foreach ($artifact in $artifacts) {
        Assert-Equal "not_published" ([string]$artifact.status) "$Label zero-product status: $($artifact.artifact_id)"
        Assert-Null $artifact.published_path "$Label zero-product published path: $($artifact.artifact_id)"
        Assert-Null $artifact.sha256 "$Label zero-product SHA-256: $($artifact.artifact_id)"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$artifact.error_type)) "$Label zero-product error type: $($artifact.artifact_id)"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$artifact.error_text)) "$Label zero-product error text: $($artifact.artifact_id)"
        Assert-True (-not (Test-Path -LiteralPath ([string]$artifact.requested_path))) "$Label zero-product artifact exists: $($artifact.artifact_id)"
    }
    Assert-Equal 0 @($Report.raw_paths).Count "$Label raw path count"
    Assert-Equal 0 @($Report.raw_sha256).Count "$Label raw SHA count"
    Assert-Null $Report.report_path "$Label report path"
    Assert-True ($null -ne $Report.PSObject.Properties["json_sha256"]) "$Label top-level JSON SHA field missing"
    Assert-Null $Report.json_sha256 "$Label top-level JSON SHA"
}

function Invoke-ThrowingPublisherVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-REPORT-004-throw" $variantFixture
        $throwingPublisher = {
            param($Request)
            [void]$script:Scenario.publisher_requests.Add($Request)
            [void]$script:Scenario.publisher_report_snapshots.Add([Convert]::ToBase64String([byte[]]$Request.json_record.bytes))
            throw "injected publisher exception"
        }
        $officialBefore = Get-FileSnapshot $variantFixture.seed_paths
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $null $throwingPublisher
        $observationDigests = Assert-OfficialObservationPair $variantReport $variantFixture "Throwing publisher variant"
        $officialAfter = Get-FileSnapshot $variantFixture.seed_paths
        Assert-SnapshotsEqual $officialBefore $officialAfter "Throwing publisher physical official fixture"
        Assert-BasicReport $variantReport
        Assert-Equal "failed" $variantReport.verdict "Throwing publisher verdict"
        Assert-FaultFieldShape $variantReport
        Assert-ConcreteFaultFields $variantReport "report_publisher_throw" "report_publish_failed" $observationDigests.pre_state_hash $observationDigests.post_state_hash 0 0 0
        Assert-True ((Get-ReportText $variantReport.errors) -match "report_publish_failed") "Throwing publisher stable error missing"
        Assert-True ((Get-ReportText $variantReport.errors) -match "injected publisher exception") "Throwing publisher original exception missing"
        Assert-ZeroPublicationFailure $variantReport $variantFixture $variantScenario "Throwing publisher"
        Assert-Equal 4 @($variantScenario.cleanup_specs).Count "Throwing publisher cleanup count"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-PartialPublisherVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-REPORT-004-partial" $variantFixture
        $variantScenario.fail_command = "A.structure"
        $variantScenario.fail_exit = 41
        $variantScenario.stderr = "primary command failure before partial publisher"
        $partialPublisher = {
            param($Request)
            [void]$script:Scenario.publisher_requests.Add($Request)
            [void]$script:Scenario.publisher_report_snapshots.Add([Convert]::ToBase64String([byte[]]$Request.json_record.bytes))
            $rawRecords = @($Request.raw_records)
            if ($rawRecords.Count -lt 1) { throw "PARTIAL_PUBLISHER_RAW_RECORDS_MISSING" }
            $record = $rawRecords[0]
            if (-not ($record.bytes -is [byte[]])) { throw "PARTIAL_PUBLISHER_BYTES_INVALID" }
            $safeTempPath = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$record.temporary_path)
            $safePath = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$record.requested_path)
            $evidenceRoot = [System.IO.Path]::GetFullPath([string]$script:Scenario.fixture.evidence).TrimEnd("\", "/")
            $evidencePrefix = $evidenceRoot + [System.IO.Path]::DirectorySeparatorChar
            if (-not $safePath.StartsWith($evidencePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PARTIAL_PUBLISHER_PATH_OUTSIDE_EVIDENCE" }
            if ([string]$record.requested_path -notmatch [regex]::Escape([string]$script:Scenario.run_id)) { throw "PARTIAL_PUBLISHER_RUN_ID_MISSING" }
            if (Test-Path -LiteralPath $safeTempPath) { throw "PARTIAL_PUBLISHER_TEMP_EXISTS" }
            if (Test-Path -LiteralPath $safePath) { throw "PARTIAL_PUBLISHER_TARGET_EXISTS" }
            New-Directory (Split-Path -Parent $safeTempPath)
            New-Directory (Split-Path -Parent $safePath)
            [System.IO.File]::WriteAllBytes($safeTempPath, [byte[]]$record.bytes)
            [System.IO.File]::Move($safeTempPath, $safePath)
            $sha256 = (Get-FileHash -LiteralPath $safePath -Algorithm SHA256).Hash
            if ([string]$record.expected_sha256 -cne $sha256) { throw "PARTIAL_PUBLISHER_EXPECTED_HASH_MISMATCH" }
            [void]$script:Scenario.publisher_written_records.Add([pscustomobject]@{
                artifact_id = [string]$record.artifact_id
                artifact_kind = [string]$record.artifact_kind
                temporary_path = $safeTempPath
                requested_path = $safePath
                bytes = [byte[]]$record.bytes
                sha256 = $sha256
            })
            return [pscustomobject]@{
                success = $false
                json_path = $null
                json_sha256 = $null
                artifact_results = @([pscustomobject]@{
                    artifact_id = [string]$record.artifact_id
                    artifact_kind = [string]$record.artifact_kind
                    requested_path = $safePath
                    published_path = $safePath
                    status = "published"
                    sha256 = $sha256
                    error_type = $null
                    error_text = $null
                })
            }
        }
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $null $partialPublisher
        $observationDigests = Assert-OfficialObservationPair $variantReport $variantFixture "Partial publisher variant"
        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "Partial publisher verdict"
        Assert-FaultFields $variantReport "A.structure" "41" $observationDigests.pre_state_hash $observationDigests.post_state_hash
        Assert-Equal 1 @($variantScenario.publisher_requests).Count "Partial publisher request count"
        Assert-Equal 1 @($variantScenario.publisher_written_records).Count "Partial publisher written record count"
        $request = @($variantScenario.publisher_requests)[0]
        $written = @($variantScenario.publisher_written_records)[0]
        $artifacts = Assert-PublicationArtifactSet $variantReport $variantFixture $request $variantScenario "partial" "Partial publisher"
        $writtenMatches = @($artifacts | Where-Object { [string]$_.artifact_id -ceq [string]$written.artifact_id })
        Assert-Equal 1 $writtenMatches.Count "Partial publisher written artifact mapping"
        Assert-Equal "published" ([string]$writtenMatches[0].status) "Partial publisher written artifact status"
        Assert-Null $writtenMatches[0].error_type "Partial publisher confirmed raw error type"
        Assert-Null $writtenMatches[0].error_text "Partial publisher confirmed raw error text"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$written.requested_path)) ([System.IO.Path]::GetFullPath([string]$writtenMatches[0].published_path)) "Partial publisher written artifact path"
        Assert-Equal ([string]$written.sha256) ([string]$writtenMatches[0].sha256) "Partial publisher written artifact SHA-256"
        Assert-True (Test-Path -LiteralPath $written.requested_path -PathType Leaf) "Partial publisher raw artifact missing"
        Assert-Equal ([Convert]::ToBase64String([byte[]]$written.bytes)) ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes([string]$written.requested_path))) "Partial publisher raw artifact bytes"
        foreach ($artifact in @($artifacts | Where-Object { [string]$_.artifact_id -cne [string]$written.artifact_id })) {
            Assert-Equal "not_published" ([string]$artifact.status) "Partial publisher unwritten artifact status: $($artifact.artifact_id)"
            Assert-Null $artifact.published_path "Partial publisher unwritten artifact path: $($artifact.artifact_id)"
            Assert-Null $artifact.sha256 "Partial publisher unwritten artifact SHA-256: $($artifact.artifact_id)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$artifact.error_type)) "Partial publisher unwritten artifact error type: $($artifact.artifact_id)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$artifact.error_text)) "Partial publisher unwritten artifact error text: $($artifact.artifact_id)"
            Assert-True (-not (Test-Path -LiteralPath ([string]$artifact.requested_path))) "Partial publisher unwritten artifact exists: $($artifact.artifact_id)"
        }
        Assert-Equal 1 @($variantReport.raw_paths).Count "Partial publisher compatibility raw path count"
        Assert-Equal 1 @($variantReport.raw_sha256).Count "Partial publisher compatibility raw SHA count"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$written.requested_path)) ([System.IO.Path]::GetFullPath([string]@($variantReport.raw_paths)[0])) "Partial publisher compatibility raw path"
        Assert-Equal ([string]$written.sha256) ([string]@($variantReport.raw_sha256)[0]) "Partial publisher compatibility raw SHA"
        Assert-Null $variantReport.report_path "Partial publisher report path"
        Assert-Null $variantReport.json_sha256 "Partial publisher JSON SHA"
        $errors = @($variantReport.errors)
        Assert-True ($errors.Count -ge 2) "Partial publisher error aggregation"
        Assert-True ((Get-ReportText $errors[0]) -match [regex]::Escape($variantScenario.stderr)) "Partial publisher primary command error order"
        Assert-Equal "report_publish_failed" ([string]$errors[-1].code) "Partial publisher final report error"
        Assert-Equal 4 @($variantScenario.cleanup_specs).Count "Partial publisher cleanup count"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-WriteThenThrowPublisherVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-REPORT-004-write-then-throw" $variantFixture
        $variantScenario.fail_command = "A.structure"
        $variantScenario.fail_exit = 41
        $variantScenario.stderr = "primary command failure before throwing publisher"
        $writeThenThrowPublisher = {
            param($Request)
            [void]$script:Scenario.publisher_requests.Add($Request)
            [void]$script:Scenario.publisher_report_snapshots.Add([Convert]::ToBase64String([byte[]]$Request.json_record.bytes))
            $rawRecords = @($Request.raw_records)
            if ($rawRecords.Count -lt 1) { throw "WRITE_THROW_RAW_RECORDS_MISSING" }
            $record = $rawRecords[0]
            if (-not ($record.bytes -is [byte[]])) { throw "WRITE_THROW_BYTES_INVALID" }
            $safeTempPath = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$record.temporary_path)
            $safePath = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$record.requested_path)
            $evidenceRoot = [System.IO.Path]::GetFullPath([string]$script:Scenario.fixture.evidence).TrimEnd("\", "/")
            $evidencePrefix = $evidenceRoot + [System.IO.Path]::DirectorySeparatorChar
            if (-not $safePath.StartsWith($evidencePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "WRITE_THROW_PATH_OUTSIDE_EVIDENCE" }
            if ([string]$record.requested_path -notmatch [regex]::Escape([string]$script:Scenario.run_id)) { throw "WRITE_THROW_RUN_ID_MISSING" }
            if (Test-Path -LiteralPath $safeTempPath) { throw "WRITE_THROW_TEMP_EXISTS" }
            if (Test-Path -LiteralPath $safePath) { throw "WRITE_THROW_TARGET_EXISTS" }
            New-Directory (Split-Path -Parent $safeTempPath)
            New-Directory (Split-Path -Parent $safePath)
            [System.IO.File]::WriteAllBytes($safeTempPath, [byte[]]$record.bytes)
            [System.IO.File]::Move($safeTempPath, $safePath)
            $sha256 = (Get-FileHash -LiteralPath $safePath -Algorithm SHA256).Hash
            if ([string]$record.expected_sha256 -cne $sha256) { throw "WRITE_THROW_EXPECTED_HASH_MISMATCH" }
            [void]$script:Scenario.publisher_written_records.Add([pscustomobject]@{
                artifact_id = [string]$record.artifact_id
                artifact_kind = [string]$record.artifact_kind
                temporary_path = $safeTempPath
                requested_path = $safePath
                bytes = [byte[]]$record.bytes
                sha256 = $sha256
            })
            throw "injected publisher exception after one raw artifact"
        }
        $officialBefore = Get-FileSnapshot $variantFixture.seed_paths
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $null $writeThenThrowPublisher
        $observationDigests = Assert-OfficialObservationPair $variantReport $variantFixture "Write-then-throw publisher variant"
        $officialAfter = Get-FileSnapshot $variantFixture.seed_paths
        Assert-SnapshotsEqual $officialBefore $officialAfter "Write-then-throw publisher physical official fixture"
        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "Write-then-throw publisher verdict"
        Assert-FaultFields $variantReport "A.structure" "41" $observationDigests.pre_state_hash $observationDigests.post_state_hash
        Assert-Equal 1 @($variantScenario.publisher_requests).Count "Write-then-throw publisher request count"
        Assert-Equal 1 @($variantScenario.publisher_written_records).Count "Write-then-throw publisher written record count"
        $request = @($variantScenario.publisher_requests)[0]
        $written = @($variantScenario.publisher_written_records)[0]
        $artifacts = Assert-PublicationArtifactSet $variantReport $variantFixture $request $variantScenario "partial" "Write-then-throw publisher"
        $writtenMatches = @($artifacts | Where-Object { [string]$_.artifact_id -ceq [string]$written.artifact_id })
        Assert-Equal 1 $writtenMatches.Count "Write-then-throw written artifact mapping"
        Assert-Equal "partial_unconfirmed" ([string]$writtenMatches[0].status) "Write-then-throw written artifact status"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$written.requested_path)) ([System.IO.Path]::GetFullPath([string]$writtenMatches[0].published_path)) "Write-then-throw written artifact path"
        Assert-Equal ([string]$written.sha256) ([string]$writtenMatches[0].sha256) "Write-then-throw written artifact SHA-256"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$writtenMatches[0].error_type)) "Write-then-throw written artifact error type"
        Assert-True ([string]$writtenMatches[0].error_text -match [regex]::Escape("injected publisher exception after one raw artifact")) "Write-then-throw written artifact original error"
        Assert-True (Test-Path -LiteralPath $written.requested_path -PathType Leaf) "Write-then-throw raw artifact missing"
        Assert-Equal ([Convert]::ToBase64String([byte[]]$written.bytes)) ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes([string]$written.requested_path))) "Write-then-throw raw artifact bytes"
        foreach ($artifact in @($artifacts | Where-Object { [string]$_.artifact_id -cne [string]$written.artifact_id })) {
            Assert-Equal "not_published" ([string]$artifact.status) "Write-then-throw unwritten artifact status: $($artifact.artifact_id)"
            Assert-Null $artifact.published_path "Write-then-throw unwritten artifact path: $($artifact.artifact_id)"
            Assert-Null $artifact.sha256 "Write-then-throw unwritten artifact SHA-256: $($artifact.artifact_id)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$artifact.error_type)) "Write-then-throw unwritten artifact error type: $($artifact.artifact_id)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$artifact.error_text)) "Write-then-throw unwritten artifact error text: $($artifact.artifact_id)"
            Assert-True (-not (Test-Path -LiteralPath ([string]$artifact.requested_path))) "Write-then-throw unwritten artifact exists: $($artifact.artifact_id)"
        }
        Assert-Equal 1 @($variantReport.raw_paths).Count "Write-then-throw compatibility raw path count"
        Assert-Equal 1 @($variantReport.raw_sha256).Count "Write-then-throw compatibility raw SHA count"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$written.requested_path)) ([System.IO.Path]::GetFullPath([string]@($variantReport.raw_paths)[0])) "Write-then-throw compatibility raw path"
        Assert-Equal ([string]$written.sha256) ([string]@($variantReport.raw_sha256)[0]) "Write-then-throw compatibility raw SHA"
        Assert-Null $variantReport.report_path "Write-then-throw report path"
        Assert-Null $variantReport.json_sha256 "Write-then-throw JSON SHA"
        $errors = @($variantReport.errors)
        Assert-True ($errors.Count -ge 2) "Write-then-throw error aggregation"
        Assert-True ((Get-ReportText $errors[0]) -match [regex]::Escape($variantScenario.stderr)) "Write-then-throw primary command error order"
        Assert-Equal "report_publish_failed" ([string]$errors[-1].code) "Write-then-throw final report error"
        Assert-True ([string]$errors[-1].message -match [regex]::Escape("injected publisher exception after one raw artifact")) "Write-then-throw final original error"
        Assert-Equal 4 @($variantScenario.cleanup_specs).Count "Write-then-throw cleanup count"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-DefaultPublisherArtifactVariant {
    param($Fixture)
    $tokens = $null
    $parseErrors = $null
    $coreAst = [System.Management.Automation.Language.Parser]::ParseFile($corePath, [ref]$tokens, [ref]$parseErrors)
    Assert-Equal 0 $parseErrors.Count "Default publisher core parser errors"
    $publisherFunctions = @($coreAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq "Invoke-FoundationDefaultReportPublisher" }, $true))
    Assert-Equal 1 $publisherFunctions.Count "Default publisher function count"
    $publisherText = [string]$publisherFunctions[0].Extent.Text
    Assert-True ($publisherText -cmatch '\$Request\.raw_records') "Default publisher does not consume preregistered raw records"
    Assert-True ($publisherText -cmatch '\$Request\.json_record') "Default publisher does not consume preregistered JSON record"
    Assert-True ($publisherText -cmatch 'artifact_results') "Default publisher does not return per-artifact results"
    Assert-True ($publisherText -cnotmatch 'ConvertTo-Json|MoveFileEx|\$Request\.report|\$Request\.json_path|\$Request\.raw_directory') "Default publisher retained obsolete serialization or request fields"

    $variantRoot = Resolve-TestHarnessPathWithinFixture $Fixture.base $Fixture.evidence
    Assert-True (Test-Path -LiteralPath $variantRoot -PathType Container) "Default publisher evidence parent missing"
    $variantRootItem = Get-Item -LiteralPath $variantRoot -Force
    Assert-True ($variantRootItem.PSIsContainer) "Default publisher evidence parent is not a directory"
    Assert-True (($variantRootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Default publisher evidence parent is a reparse point"
    $rawDirectory = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $variantRoot "raw")
    $runId = "defaultpublisher" + [guid]::NewGuid().ToString("N")
    $jsonPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $variantRoot ("SH-SAFE-BASE-001-$runId.json"))
    $jsonTempPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $variantRoot ("SH-SAFE-BASE-001-$runId.json.tmp"))
    $probeReport = [pscustomobject]@{
        schema_version = "publisher-probe/v1"
        task_id = "SH-SAFE-BASE-001"
        run_id = $runId
        report_path = $jsonPath
    }
    $expectedJsonText = [string]($probeReport | ConvertTo-Json -Depth 32 -Compress)
    $expectedJsonBytes = [byte[]]$script:Utf8NoBom.GetBytes($expectedJsonText)
    $expectedJsonSha = Get-BytesSha256 $expectedJsonBytes
    $rawRecords = @(
        [pscustomobject]@{ artifact_id = "default.stdout"; artifact_kind = "stdout_raw"; temporary_path = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $rawDirectory ("SH-SAFE-BASE-001-$runId-stdout.txt.tmp")); requested_path = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $rawDirectory ("SH-SAFE-BASE-001-$runId-stdout.txt")); expected_sha256 = $null; bytes = [byte[]]$script:Utf8NoBom.GetBytes("default stdout") },
        [pscustomobject]@{ artifact_id = "default.stderr"; artifact_kind = "stderr_raw"; temporary_path = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $rawDirectory ("SH-SAFE-BASE-001-$runId-stderr.txt.tmp")); requested_path = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $rawDirectory ("SH-SAFE-BASE-001-$runId-stderr.txt")); expected_sha256 = $null; bytes = [byte[]]$script:Utf8NoBom.GetBytes("default stderr") }
    )
    foreach ($record in $rawRecords) { $record.expected_sha256 = Get-BytesSha256 ([byte[]]$record.bytes) }
    $request = [pscustomobject]@{
        json_record = [pscustomobject]@{ artifact_id = "machine_json"; artifact_kind = "machine_json"; temporary_path = $jsonTempPath; requested_path = $jsonPath; expected_sha256 = $expectedJsonSha; bytes = $expectedJsonBytes }
        raw_records = @($rawRecords)
    }
    $result = Invoke-FoundationDefaultReportPublisher $request
    Assert-ExactPropertySet $result @("success", "json_path", "json_sha256", "artifact_results") "Default publisher result"
    Assert-True ([bool]$result.success) "Default publisher success"
    Assert-Equal $jsonPath ([System.IO.Path]::GetFullPath([string]$result.json_path)) "Default publisher JSON path"
    Assert-True (Test-Path -LiteralPath $jsonPath -PathType Leaf) "Default publisher JSON missing"
    Assert-Equal (Get-FileHash -LiteralPath $jsonPath -Algorithm SHA256).Hash ([string]$result.json_sha256) "Default publisher JSON SHA-256"
    Assert-Equal $expectedJsonSha ([string]$result.json_sha256) "Default publisher frozen JSON SHA-256"
    Assert-Equal ([Convert]::ToBase64String($expectedJsonBytes)) ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($jsonPath))) "Default publisher frozen JSON bytes"
    $artifactResults = @($result.artifact_results)
    Assert-Equal 3 $artifactResults.Count "Default publisher artifact result count"
    foreach ($artifactResult in $artifactResults) {
        Assert-Equal (Get-OrdinalIgnoreCaseSignature @("artifact_id", "artifact_kind", "requested_path", "published_path", "status", "sha256", "error_type", "error_text")) (Get-OrdinalIgnoreCaseSignature @($artifactResult.PSObject.Properties.Name)) "Default publisher artifact exact keys: $($artifactResult.artifact_id)"
        Assert-ExactPropertySet $artifactResult @("artifact_id", "artifact_kind", "requested_path", "published_path", "status", "sha256", "error_type", "error_text") "Default publisher artifact $($artifactResult.artifact_id)"
        Assert-Equal "published" ([string]$artifactResult.status) "Default publisher artifact status: $($artifactResult.artifact_id)"
        Assert-Null $artifactResult.error_type "Default publisher artifact error type: $($artifactResult.artifact_id)"
        Assert-Null $artifactResult.error_text "Default publisher artifact error text: $($artifactResult.artifact_id)"
    }
    foreach ($record in $rawRecords) {
        $matches = @($artifactResults | Where-Object { [string]$_.artifact_id -ceq [string]$record.artifact_id })
        Assert-Equal 1 $matches.Count "Default publisher raw result: $($record.artifact_id)"
        Assert-Equal "published" ([string]$matches[0].status) "Default publisher raw status: $($record.artifact_id)"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$record.requested_path)) ([System.IO.Path]::GetFullPath([string]$matches[0].published_path)) "Default publisher raw path: $($record.artifact_id)"
        Assert-True (Test-Path -LiteralPath $record.requested_path -PathType Leaf) "Default publisher raw missing: $($record.artifact_id)"
        Assert-Equal ([Convert]::ToBase64String([byte[]]$record.bytes)) ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes([string]$record.requested_path))) "Default publisher raw bytes: $($record.artifact_id)"
        Assert-Equal (Get-FileHash -LiteralPath $record.requested_path -Algorithm SHA256).Hash ([string]$matches[0].sha256) "Default publisher raw SHA-256: $($record.artifact_id)"
        Assert-Equal ([string]$record.expected_sha256) ([string]$matches[0].sha256) "Default publisher raw expected SHA-256: $($record.artifact_id)"
        Assert-True (-not (Test-Path -LiteralPath ([string]$record.temporary_path))) "Default publisher raw temporary artifact remained: $($record.artifact_id)"
    }
    $jsonResults = @($artifactResults | Where-Object { [string]$_.artifact_kind -ceq "machine_json" })
    Assert-Equal 1 $jsonResults.Count "Default publisher machine JSON artifact count"
    Assert-Equal ([System.IO.Path]::GetFullPath($jsonPath)) ([System.IO.Path]::GetFullPath([string]$jsonResults[0].requested_path)) "Default publisher machine JSON requested path"
    Assert-Equal ([System.IO.Path]::GetFullPath($jsonPath)) ([System.IO.Path]::GetFullPath([string]$jsonResults[0].published_path)) "Default publisher machine JSON published path"
    Assert-Equal $expectedJsonSha ([string]$jsonResults[0].sha256) "Default publisher machine JSON artifact SHA-256"
    Assert-True (-not (Test-Path -LiteralPath $jsonTempPath)) "Default publisher JSON temporary artifact remained"

}

function Invoke-AdversarialPublisherTrustVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-REPORT-004-adversarial" $variantFixture
        $variantScenario.fail_command = "A.structure"
        $variantScenario.fail_exit = 41
        $variantScenario.stderr = "primary command failure before adversarial publisher"
        $externalSentinel = Resolve-TestHarnessPathWithinFixture $variantFixture.base (Join-Path $variantFixture.external "publisher-return-sentinel.txt")
        Write-StableFile $externalSentinel "external sentinel"
        $externalBefore = Get-FileSnapshot @($externalSentinel)
        $variantScenario | Add-Member -NotePropertyName publisher_external_sentinel -NotePropertyValue $externalSentinel
        $adversarialPublisher = {
            param($Request)
            [void]$script:Scenario.publisher_requests.Add($Request)
            [void]$script:Scenario.publisher_report_snapshots.Add([Convert]::ToBase64String([byte[]]$Request.json_record.bytes))
            $rawRecords = @($Request.raw_records)
            if ($rawRecords.Count -ne 27) { throw "ADVERSARIAL_PUBLISHER_EXPECTED_27_RAW_RECORDS" }
            $writtenRecords = New-Object System.Collections.ArrayList
            foreach ($record in @($rawRecords[0..2])) {
                if (-not ($record.bytes -is [byte[]])) { throw "ADVERSARIAL_PUBLISHER_BYTES_INVALID" }
                $safeTempPath = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$record.temporary_path)
                $safePath = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$record.requested_path)
                $evidenceRoot = [System.IO.Path]::GetFullPath([string]$script:Scenario.fixture.evidence).TrimEnd("\", "/")
                $evidencePrefix = $evidenceRoot + [System.IO.Path]::DirectorySeparatorChar
                if (-not $safePath.StartsWith($evidencePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "ADVERSARIAL_PUBLISHER_RAW_OUTSIDE_EVIDENCE" }
                New-Directory (Split-Path -Parent $safeTempPath)
                New-Directory (Split-Path -Parent $safePath)
                [System.IO.File]::WriteAllBytes($safeTempPath, [byte[]]$record.bytes)
                [System.IO.File]::Move($safeTempPath, $safePath)
                $written = [pscustomobject]@{
                    artifact_id = [string]$record.artifact_id
                    artifact_kind = [string]$record.artifact_kind
                    temporary_path = $safeTempPath
                    requested_path = $safePath
                    bytes = [byte[]]$record.bytes
                    sha256 = (Get-FileHash -LiteralPath $safePath -Algorithm SHA256).Hash
                }
                [void]$writtenRecords.Add($written)
                [void]$script:Scenario.publisher_written_records.Add($written)
            }

            $safeJsonTempPath = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$Request.json_record.temporary_path)
            $safeJsonPath = Resolve-TestHarnessPathWithinFixture $script:Scenario.fixture.base ([string]$Request.json_record.requested_path)
            $jsonBytes = [byte[]]$Request.json_record.bytes
            New-Directory (Split-Path -Parent $safeJsonTempPath)
            New-Directory (Split-Path -Parent $safeJsonPath)
            [System.IO.File]::WriteAllBytes($safeJsonTempPath, $jsonBytes)
            [System.IO.File]::Move($safeJsonTempPath, $safeJsonPath)
            [void]$script:Scenario.publisher_written_records.Add([pscustomobject]@{
                artifact_id = [string]$Request.json_record.artifact_id
                artifact_kind = "machine_json"
                temporary_path = $safeJsonTempPath
                requested_path = $safeJsonPath
                bytes = $jsonBytes
                sha256 = (Get-FileHash -LiteralPath $safeJsonPath -Algorithm SHA256).Hash
            })

            $first = $writtenRecords[0]
            $second = $writtenRecords[1]
            $third = $writtenRecords[2]
            $artifactResults = @(
                [pscustomobject]@{ artifact_id = $first.artifact_id; artifact_kind = $first.artifact_kind; requested_path = $first.requested_path; published_path = [string]$script:Scenario.publisher_external_sentinel; status = "published"; sha256 = $first.sha256; error_type = $null; error_text = $null },
                [pscustomobject]@{ artifact_id = $second.artifact_id; artifact_kind = $second.artifact_kind; requested_path = $second.requested_path; published_path = $second.requested_path; status = "published"; sha256 = ("0" * 64); error_type = $null; error_text = $null },
                [pscustomobject]@{ artifact_id = $third.artifact_id; artifact_kind = $third.artifact_kind; requested_path = $third.requested_path; published_path = $third.requested_path; status = "published"; sha256 = $third.sha256; error_type = $null; error_text = $null },
                [pscustomobject]@{ artifact_id = $third.artifact_id; artifact_kind = $third.artifact_kind; requested_path = $third.requested_path; published_path = $third.requested_path; status = "published"; sha256 = $third.sha256; error_type = $null; error_text = $null }
            )
            return [pscustomobject]@{
                success = $false
                json_path = $safeJsonPath
                json_sha256 = (Get-FileHash -LiteralPath $safeJsonPath -Algorithm SHA256).Hash
                artifact_results = $artifactResults
            }
        }

        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $null $adversarialPublisher
        $observationDigests = Assert-OfficialObservationPair $variantReport $variantFixture "Adversarial publisher trust variant"
        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "Adversarial publisher verdict"
        Assert-FaultFields $variantReport "A.structure" "41" $observationDigests.pre_state_hash $observationDigests.post_state_hash
        Assert-Equal 1 @($variantScenario.publisher_requests).Count "Adversarial publisher request count"
        Assert-Equal 4 @($variantScenario.publisher_written_records).Count "Adversarial publisher physical artifact count"
        $request = @($variantScenario.publisher_requests)[0]
        $artifacts = Assert-PublicationArtifactSet $variantReport $variantFixture $request $variantScenario "partial" "Adversarial publisher"
        $rawWritten = @($variantScenario.publisher_written_records | Where-Object { [string]$_.artifact_kind -cne "machine_json" })
        Assert-Equal 3 $rawWritten.Count "Adversarial publisher written raw count"
        foreach ($written in $rawWritten) {
            $matches = @($artifacts | Where-Object { ([System.IO.Path]::GetFullPath([string]$_.requested_path)).Equals([System.IO.Path]::GetFullPath([string]$written.requested_path), [System.StringComparison]::OrdinalIgnoreCase) })
            Assert-Equal 1 $matches.Count "Adversarial publisher raw artifact mapping: $($written.artifact_id)"
            Assert-Equal "partial_unconfirmed" ([string]$matches[0].status) "Adversarial publisher untrusted raw status: $($written.artifact_id)"
            Assert-Equal ([System.IO.Path]::GetFullPath([string]$written.requested_path)) ([System.IO.Path]::GetFullPath([string]$matches[0].published_path)) "Adversarial publisher canonical raw path: $($written.artifact_id)"
            Assert-Equal ([string]$written.sha256) ([string]$matches[0].sha256) "Adversarial publisher physical raw SHA-256: $($written.artifact_id)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$matches[0].error_type)) "Adversarial publisher raw error type: $($written.artifact_id)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$matches[0].error_text)) "Adversarial publisher raw error text: $($written.artifact_id)"
        }
        $jsonWritten = @($variantScenario.publisher_written_records | Where-Object { [string]$_.artifact_kind -ceq "machine_json" })[0]
        $jsonArtifacts = @($artifacts | Where-Object { [string]$_.artifact_kind -ceq "machine_json" })
        Assert-Equal 1 $jsonArtifacts.Count "Adversarial publisher JSON artifact count"
        Assert-Equal "partial_unconfirmed" ([string]$jsonArtifacts[0].status) "Adversarial publisher failed-overall JSON status"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$jsonWritten.requested_path)) ([System.IO.Path]::GetFullPath([string]$jsonArtifacts[0].published_path)) "Adversarial publisher canonical JSON path"
        Assert-Equal ([string]$jsonWritten.sha256) ([string]$jsonArtifacts[0].sha256) "Adversarial publisher physical JSON SHA-256"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$jsonArtifacts[0].error_type)) "Adversarial publisher JSON error type"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$jsonArtifacts[0].error_text)) "Adversarial publisher JSON error text"

        $actualPaths = @($rawWritten | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.requested_path) })
        foreach ($artifact in @($artifacts | Where-Object { [string]$_.artifact_kind -cne "machine_json" -and $actualPaths -notcontains [System.IO.Path]::GetFullPath([string]$_.requested_path) })) {
            Assert-Equal "not_published" ([string]$artifact.status) "Adversarial publisher absent raw status: $($artifact.artifact_id)"
            Assert-Null $artifact.published_path "Adversarial publisher absent raw path: $($artifact.artifact_id)"
            Assert-Null $artifact.sha256 "Adversarial publisher absent raw SHA-256: $($artifact.artifact_id)"
        }
        $actualRawPaths = @($variantReport.raw_paths | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
        $actualRawHashes = @($variantReport.raw_sha256 | ForEach-Object { [string]$_ })
        $expectedWrittenPaths = @($rawWritten | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.requested_path) })
        Assert-Equal 3 $actualRawPaths.Count "Adversarial publisher compatibility raw path count"
        Assert-Equal $actualRawPaths.Count $actualRawHashes.Count "Adversarial publisher compatibility raw path/hash count alignment"
        Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedWrittenPaths) (Get-OrdinalIgnoreCaseSignature $actualRawPaths) "Adversarial publisher compatibility raw path set"
        for ($actualRawIndex = 0; $actualRawIndex -lt $actualRawPaths.Count; $actualRawIndex++) {
            $writtenMatches = @($rawWritten | Where-Object { ([System.IO.Path]::GetFullPath([string]$_.requested_path)).Equals($actualRawPaths[$actualRawIndex], [System.StringComparison]::OrdinalIgnoreCase) })
            Assert-Equal 1 $writtenMatches.Count "Adversarial publisher compatibility raw mapping: $($actualRawPaths[$actualRawIndex])"
            Assert-Equal ([string]$writtenMatches[0].sha256) ([string]$actualRawHashes[$actualRawIndex]) "Adversarial publisher compatibility raw path/hash index alignment: $($actualRawPaths[$actualRawIndex])"
        }
        Assert-Null $variantReport.report_path "Adversarial publisher top-level report path"
        Assert-Null $variantReport.json_sha256 "Adversarial publisher top-level JSON SHA-256"
        Assert-SnapshotsEqual $externalBefore (Get-FileSnapshot @($externalSentinel)) "Adversarial publisher external sentinel"
        Assert-Equal 0 @($artifacts | Where-Object { $null -ne $_.published_path -and ([System.IO.Path]::GetFullPath([string]$_.published_path)).Equals([System.IO.Path]::GetFullPath($externalSentinel), [System.StringComparison]::OrdinalIgnoreCase) }).Count "Adversarial publisher trusted external returned path"
        $errors = @($variantReport.errors)
        Assert-True ($errors.Count -ge 2) "Adversarial publisher error aggregation"
        Assert-True ((Get-ReportText $errors[0]) -match [regex]::Escape($variantScenario.stderr)) "Adversarial publisher primary error order"
        Assert-Equal "report_publish_failed" ([string]$errors[-1].code) "Adversarial publisher final error code"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-ReportPublisherReviewVariants {
    param($Fixture)
    $failures = New-Object System.Collections.ArrayList
    foreach ($variant in @("confirmed_partial", "write_then_throw", "zero_throw", "adversarial", "default")) {
        try {
            if ($variant -eq "confirmed_partial") { Invoke-PartialPublisherVariant }
            elseif ($variant -eq "write_then_throw") { Invoke-WriteThenThrowPublisherVariant }
            elseif ($variant -eq "zero_throw") { Invoke-ThrowingPublisherVariant }
            elseif ($variant -eq "adversarial") { Invoke-AdversarialPublisherTrustVariant }
            else { Invoke-DefaultPublisherArtifactVariant $Fixture }
        }
        catch {
            [void]$failures.Add("${variant}:$($_.Exception.Message)")
        }
    }
    if ($failures.Count -gt 0) {
        throw ("Report publisher review subvariants failed: " + (@($failures) -join " || "))
    }
}

function Invoke-ProjectOnlyCandidateVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-MANIFEST-004-project-only" $variantFixture
        $variantScenario.mutation = "add"
        $variantScenario.mutation_path = Join-Path $variantFixture.routes.C "dist\project-only.sqlite-wal"
        $officialPhysicalBefore = Get-FileSnapshot $variantFixture.official_seed_paths
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $null $null
        $observationDigests = Assert-OfficialObservationPair $variantReport $variantFixture "Project-only candidate variant"
        $officialPhysicalAfter = Get-FileSnapshot $variantFixture.official_seed_paths

        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "Project-only candidate verdict"
        Assert-SnapshotsEqual $officialPhysicalBefore $officialPhysicalAfter "Project-only variant physical official fixture"
        Assert-EmptyDiff $variantReport.manifests.official.diff "Project-only variant official diff"
        Assert-FaultFieldShape $variantReport
        Assert-Equal "project_only_dist_sidecar_add" ([string]$variantReport.fault.failure_injection_point) "Project-only fault injection"
        Assert-Equal "PROJECT_BUSINESS_CANDIDATE_ADDED" ([string]$variantReport.fault.expected_error_code) "Project-only fault expected code"
        Assert-Equal "PROJECT_BUSINESS_CANDIDATE_ADDED" ([string]$variantReport.fault.observed_error_code) "Project-only fault observed code"
        Assert-Equal ([string]$observationDigests.pre_state_hash) ([string]$variantReport.fault.pre_state_hash) "Project-only fault pre-state hash"
        Assert-Equal ([string]$observationDigests.post_state_hash) ([string]$variantReport.fault.post_state_hash) "Project-only fault post-state hash"
        Assert-True ([bool]$variantReport.fault.after_manifest_generated) "Project-only fault after-manifest flag"
        Assert-EmptyDiff $variantReport.fault.official_business_data_diff "Project-only fault official diff"
        Assert-True (-not [object]::ReferenceEquals($variantReport.fault.official_business_data_diff, $variantReport.manifests.project_business_candidates.diff)) "Project-only fault reused project diff"

        $projectDiff = $variantReport.manifests.project_business_candidates.diff
        Assert-Equal 1 @($projectDiff.added).Count "Project-only added count"
        Assert-Equal 0 @($projectDiff.modified).Count "Project-only modified count"
        Assert-Equal 0 @($projectDiff.deleted).Count "Project-only deleted count"
        $projectAdded = @($projectDiff.added)[0]
        Assert-Equal ([System.IO.Path]::GetFullPath($variantScenario.mutation_path)) ([System.IO.Path]::GetFullPath([string]$projectAdded.full_path)) "Project-only added path"
        Assert-Equal "business_candidate" ([string]$projectAdded.classification) "Project-only added classification"
        Assert-Equal "sidecar" ([string]$projectAdded.candidate_kind) "Project-only added kind"
        Assert-Equal "PROJECT_ROOT|ROUTE_C" (Get-OrdinalIgnoreCaseSignature @($projectAdded.root_labels)) "Project-only added root labels"
        Assert-Equal 1 @($variantReport.errors | Where-Object { [string]$_.code -ceq "PROJECT_BUSINESS_CANDIDATE_ADDED" }).Count "Project-only stable error count"

        $sourceDist = $variantReport.manifests.source_dist
        Assert-True (-not ($sourceDist -is [System.Array])) "Project-only source dist must be a keyed object"
        Assert-Equal "B|C" (Get-OrdinalIgnoreCaseSignature @($sourceDist.PSObject.Properties.Name)) "Project-only source dist route keys"
        $sourceDistC = $sourceDist.C
        Assert-True ($null -ne $sourceDistC) "Project-only C source dist report missing"
        Assert-Equal 1 @($sourceDistC.diff.added).Count "Project-only C source dist added count"
        $sourceDistAdded = @($sourceDistC.diff.added)[0]
        Assert-Equal ([System.IO.Path]::GetFullPath($variantScenario.mutation_path)) ([System.IO.Path]::GetFullPath([string]$sourceDistAdded.full_path)) "Project-only C source dist added path"
        Assert-Equal 1 @($variantReport.errors | Where-Object { [string]$_.code -ceq "SOURCE_DIST_CHANGED" }).Count "Project-only source dist error count"
        Assert-Equal 9 @($variantScenario.observed_specs).Count "Project-only command count"
        Assert-Equal 4 @($variantScenario.cleanup_specs).Count "Project-only cleanup count"
        Assert-True (Test-Path -LiteralPath $variantScenario.mutation_path -PathType Leaf) "Validator deleted project-only candidate"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-OpenClawAuditFailureVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-OPENCLAW-004-audit-failure" $variantFixture
        $variantScenario.openclaw_mode = "allowlisted"
        $failingProvider = {
            param($Request)
            [void]$script:Scenario.manifest_requests.Add($Request)
            if ([string]$Request.scope_id -ceq "openclaw_pre_delete_audit") { throw "injected OpenClaw audit failure" }
            return Invoke-FoundationDefaultManifestProvider $Request
        }
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $failingProvider $null
        $policyEntries = @(Get-TestOpenClawPolicyAttestationEntries -Scenario $variantScenario -ExpectedCommandIds @("B.plugin_build_check", "B.plugin_validate", "C.plugin_build_check", "C.plugin_validate") -Label "OpenClaw audit failure variant")
        Assert-Equal 4 $policyEntries.Count "OpenClaw audit failure policy Oracle count"
        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "OpenClaw audit failure verdict"
        $audit = $variantReport.openclaw_state.pre_delete_audit
        Assert-True ($audit.completed -is [bool] -and -not [bool]$audit.completed) "Failed OpenClaw audit was marked completed"
        $auditKeys = @($audit.PSObject.Properties | ForEach-Object { [string]$_.Name })
        $expectedAuditKeys = @("completed", "entries", "business_entries", "internal_state_entries", "other_entries", "business_candidate_count", "openclaw_internal_tool_state_count", "other_count", "error_type", "error_text")
        Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedAuditKeys) (Get-OrdinalIgnoreCaseSignature $auditKeys) "Failed OpenClaw audit exact keys"
        foreach ($field in @("entries", "business_entries", "internal_state_entries", "other_entries")) {
            Assert-Equal 0 @($audit.PSObject.Properties[$field].Value).Count "Failed OpenClaw audit partial group: $field"
        }
        Assert-Equal 0 ([int]$audit.business_candidate_count) "Failed OpenClaw audit business count"
        Assert-Equal 0 ([int]$audit.openclaw_internal_tool_state_count) "Failed OpenClaw audit internal count"
        Assert-Equal 0 ([int]$audit.other_count) "Failed OpenClaw audit other count"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$audit.error_type)) "Failed OpenClaw audit error type missing"
        Assert-True ([string]$audit.error_text -match [regex]::Escape("injected OpenClaw audit failure")) "Failed OpenClaw audit original error missing"

        $auditRequests = @($variantScenario.manifest_requests | Where-Object { [string]$_.scope_id -ceq "openclaw_pre_delete_audit" })
        Assert-Equal 1 $auditRequests.Count "OpenClaw audit request count"
        Assert-True ($auditRequests[0].all_files -is [bool] -and [bool]$auditRequests[0].all_files) "OpenClaw audit request did not use all_files=true"
        $auditRoots = @($auditRequests[0].roots)
        Assert-Equal 1 $auditRoots.Count "OpenClaw audit request root count"
        Assert-Equal "openclaw_state_root" ([string]$auditRoots[0].root_id) "OpenClaw audit request root ID"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$variantScenario.allowed_run_roots.openclaw_state_root)) ([System.IO.Path]::GetFullPath([string]$auditRoots[0].path)) "OpenClaw audit request root path"

        $auditErrors = @($variantReport.errors | Where-Object { [string]$_.code -ceq "manifest_failed" -and [string]$_.scope_id -ceq "openclaw_pre_delete_audit" })
        Assert-Equal 1 $auditErrors.Count "OpenClaw audit structured error count"
        Assert-Equal "audit" ([string]$auditErrors[0].category) "OpenClaw audit structured error category"
        Assert-True ([string]$auditErrors[0].message -match [regex]::Escape("injected OpenClaw audit failure")) "OpenClaw audit structured original error"
        Assert-Equal 4 @($variantReport.temporary_roots).Count "OpenClaw audit failure temporary root count"
        foreach ($temporaryRoot in @($variantReport.temporary_roots)) {
            Assert-True ([bool]$temporaryRoot.cleanup.attempted) "OpenClaw audit failure cleanup not attempted: $($temporaryRoot.root_id)"
            Assert-True ([bool]$temporaryRoot.cleanup.succeeded) "OpenClaw audit failure cleanup failed: $($temporaryRoot.root_id)"
            Assert-Equal 0 ([int]$temporaryRoot.physical_residual_count) "OpenClaw audit failure physical residual: $($temporaryRoot.root_id)"
            if ([string]$temporaryRoot.root_id -cne "openclaw_state_root") {
                Assert-True ([bool]$temporaryRoot.pre_delete_audit.completed) "OpenClaw audit failure stopped another audit: $($temporaryRoot.root_id)"
            }
        }
        Assert-True (-not (Test-Path -LiteralPath ([string]$variantScenario.allowed_run_roots.openclaw_state_root))) "OpenClaw audit failure left its run root"
        $openclawRows = @($variantReport.temporary_roots | Where-Object { [string]$_.root_id -ceq "openclaw_state_root" })
        Assert-Equal 1 $openclawRows.Count "OpenClaw audit failure temporary summary row count"
        $summary = $openclawRows[0].pre_delete_audit
        Assert-Equal (Get-OrdinalIgnoreCaseSignature @("completed", "audit_ref", "business_candidate_count", "openclaw_internal_tool_state_count", "other_count")) (Get-OrdinalIgnoreCaseSignature @($summary.PSObject.Properties.Name)) "OpenClaw audit failure temporary summary exact keys"
        Assert-True (-not [object]::ReferenceEquals($audit, $summary)) "OpenClaw audit failure temporary summary reused authoritative object"
        Assert-True ($summary.completed -is [bool] -and -not [bool]$summary.completed) "OpenClaw audit failure temporary summary completion"
        Assert-Equal "/openclaw_state/pre_delete_audit" ([string]$summary.audit_ref) "OpenClaw audit failure temporary summary reference"
        foreach ($countName in @("business_candidate_count", "openclaw_internal_tool_state_count", "other_count")) {
            Assert-Equal 0 ([int]$summary.PSObject.Properties[$countName].Value) "OpenClaw audit failure temporary summary count: $countName"
        }
        [void](Assert-OfficialObservationPair $variantReport $variantFixture "OpenClaw audit failure variant")
        Assert-SourceDistReportEmpty $variantReport $variantFixture "OpenClaw audit failure variant"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-OpenClawUnknownStageVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-OPENCLAW-003-unknown-stage" $variantFixture
        $variantScenario.openclaw_mode = "allowlisted"
        $lateRelativePath = "late\unattributed.log"
        $lateText = "late unattributed"
        $lateProvider = {
            param($Request)
            [void]$script:Scenario.manifest_requests.Add($Request)
            if ([string]$Request.scope_id -ceq "openclaw_pre_delete_audit") {
                $latePath = Resolve-TestHarnessPathUnderRunRoot $script:Scenario "openclaw_state_root" (Join-Path ([string]$script:Scenario.allowed_run_roots.openclaw_state_root) "late\unattributed.log")
                Write-TestDoubleStableFile $script:Scenario $latePath "late unattributed"
            }
            return Invoke-FoundationDefaultManifestProvider $Request
        }
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $lateProvider $null
        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "OpenClaw unknown-stage verdict"
        $policyEntries = @(Get-TestOpenClawPolicyAttestationEntries -Scenario $variantScenario -ExpectedCommandIds @("B.plugin_build_check", "B.plugin_validate", "C.plugin_build_check", "C.plugin_validate") -Label "OpenClaw unknown-stage variant")
        $expected = @(
            [pscustomobject]@{ relative_path = "state\openclaw.sqlite"; classification = "openclaw_internal_tool_state"; sha256 = (Get-TextSha256 "internal"); length = 8; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_build_check" },
            [pscustomobject]@{ relative_path = "state\openclaw.sqlite-wal"; classification = "openclaw_internal_tool_state"; sha256 = (Get-TextSha256 "internal wal"); length = 12; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" },
            [pscustomobject]@{ relative_path = "logs\openclaw.log"; classification = "other"; sha256 = (Get-TextSha256 "ordinary log"); length = 12; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" },
            [pscustomobject]@{ relative_path = $lateRelativePath; classification = "other"; sha256 = (Get-TextSha256 $lateText); length = $lateText.Length; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "post_command_unattributed" }
        ) + @($policyEntries)
        Assert-OpenClawAuditEntries $variantReport $variantScenario $expected $true 2
        $stageErrors = @($variantReport.errors | Where-Object { [string]$_.code -ceq "OPENCLAW_CREATION_STAGE_UNKNOWN" })
        Assert-Equal 1 $stageErrors.Count "OpenClaw unknown-stage structured error count"
        Assert-True (-not (Test-Path -LiteralPath ([string]$variantScenario.allowed_run_roots.openclaw_state_root))) "OpenClaw unknown-stage root remained"
        [void](Assert-OfficialObservationPair $variantReport $variantFixture "OpenClaw unknown-stage variant")
        Assert-SourceDistReportEmpty $variantReport $variantFixture "OpenClaw unknown-stage variant"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-OpenClawInternalCleanupFailureVariant {
    $variantFixture = $null
    $variantScenario = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-OPENCLAW-003-internal-cleanup-failure" $variantFixture
        $variantScenario.openclaw_mode = "internal_cleanup_failure"
        $recordingProvider = {
            param($Request)
            [void]$script:Scenario.manifest_requests.Add($Request)
            return Invoke-FoundationDefaultManifestProvider $Request
        }
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $recordingProvider $null
        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "OpenClaw internal cleanup failure verdict"
        $policyEntries = @(Get-TestOpenClawPolicyAttestationEntries -Scenario $variantScenario -ExpectedCommandIds @("B.plugin_build_check", "B.plugin_validate", "C.plugin_build_check", "C.plugin_validate") -Label "OpenClaw internal cleanup failure variant")
        $expected = @(
            [pscustomobject]@{ relative_path = "state\openclaw.sqlite"; classification = "openclaw_internal_tool_state"; sha256 = (Get-TextSha256 "internal"); length = 8; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_build_check" },
            [pscustomobject]@{ relative_path = "state\openclaw.sqlite-wal"; classification = "openclaw_internal_tool_state"; sha256 = (Get-TextSha256 "internal wal"); length = 12; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" },
            [pscustomobject]@{ relative_path = "logs\openclaw.log"; classification = "other"; sha256 = (Get-TextSha256 "ordinary log"); length = 12; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" }
        ) + @($policyEntries)
        Assert-OpenClawAuditEntries -Report $variantReport -Scenario $variantScenario -Expected $expected -AssertProviderAuthority $true -MinimumCreationStageCount 2 -AssertInternalCleanupSucceeded $false
        $audit = $variantReport.openclaw_state.pre_delete_audit
        Assert-True ($audit.completed -is [bool] -and [bool]$audit.completed) "OpenClaw internal cleanup failure audit completion"
        $internalEntries = @($audit.internal_state_entries)
        Assert-Equal 2 $internalEntries.Count "OpenClaw internal cleanup failure internal entry count"
        $lockedEntries = @($internalEntries | Where-Object { ([string]$_.relative_path).Replace("/", "\") -ceq "state\openclaw.sqlite" })
        Assert-Equal 1 $lockedEntries.Count "OpenClaw internal cleanup failure locked entry mapping"
        $lockedEntry = $lockedEntries[0]
        Assert-Equal "B.plugin_build_check" ([string]$lockedEntry.creation_stage) "OpenClaw internal cleanup failure locked creation stage"
        Assert-Equal (Get-TextSha256 "internal") ([string]$lockedEntry.sha256) "OpenClaw internal cleanup failure locked SHA-256"
        Assert-Equal 8 ([long]$lockedEntry.length) "OpenClaw internal cleanup failure locked length"
        Assert-True (Test-Path -LiteralPath ([string]$lockedEntry.full_path) -PathType Leaf) "OpenClaw internal cleanup failure locked file was removed"
        Assert-ExactPropertySet $lockedEntry.cleanup_result @("attempted", "succeeded", "residual_count", "error_type", "error_text") "OpenClaw internal cleanup failure per-file result"
        Assert-True ($lockedEntry.cleanup_result.attempted -is [bool] -and [bool]$lockedEntry.cleanup_result.attempted) "OpenClaw internal cleanup failure attempted"
        Assert-True ($lockedEntry.cleanup_result.succeeded -is [bool] -and -not [bool]$lockedEntry.cleanup_result.succeeded) "OpenClaw internal cleanup failure succeeded flag"
        Assert-Equal 1 ([int]$lockedEntry.cleanup_result.residual_count) "OpenClaw internal cleanup failure residual"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$lockedEntry.cleanup_result.error_type)) "OpenClaw internal cleanup failure error type"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$lockedEntry.cleanup_result.error_text)) "OpenClaw internal cleanup failure error text"
        Assert-True ($variantReport.openclaw_state.cleanup.attempted -is [bool] -and [bool]$variantReport.openclaw_state.cleanup.attempted) "OpenClaw internal cleanup failure root attempted"
        Assert-True ($variantReport.openclaw_state.cleanup.succeeded -is [bool] -and -not [bool]$variantReport.openclaw_state.cleanup.succeeded) "OpenClaw internal cleanup failure root succeeded flag"
        Assert-Equal 1 ([int]$variantReport.openclaw_state.cleanup.residual_count) "OpenClaw internal cleanup failure root residual"
        Assert-Equal 1 @($variantScenario.manifest_requests | Where-Object { [string]$_.scope_id -ceq "openclaw_pre_delete_audit" }).Count "OpenClaw internal cleanup failure authoritative audit count"
    }
    finally {
        if ($null -ne $variantScenario) {
            foreach ($lockedStream in @($variantScenario.openclaw_locked_streams)) {
                if ($null -ne $lockedStream) { $lockedStream.Dispose() }
            }
        }
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-OpenClawReviewVariants {
    $failures = New-Object System.Collections.ArrayList
    foreach ($variant in @("audit_failure", "unknown_stage", "internal_cleanup_failure")) {
        try {
            if ($variant -eq "audit_failure") { Invoke-OpenClawAuditFailureVariant }
            elseif ($variant -eq "unknown_stage") { Invoke-OpenClawUnknownStageVariant }
            else { Invoke-OpenClawInternalCleanupFailureVariant }
        }
        catch {
            [void]$failures.Add("${variant}:$($_.Exception.Message)")
        }
    }
    if ($failures.Count -gt 0) {
        throw ("OpenClaw review subvariants failed: " + (@($failures) -join " || "))
    }
}

function Invoke-InvalidManifestProviderVariant {
    param([string]$Variant)
    Assert-True ($Variant -in @("wrong_scope_id", "wrong_root_set", "wrong_root_id", "wrong_root_path", "wrong_exists", "dynamic_top", "dynamic_root", "reuse_top_object", "reuse_roots_container", "reuse_entries_container", "reuse_nested_root")) "Unknown invalid manifest provider variant: $Variant"
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-MANIFEST-006-$Variant" $variantFixture
        $variantScenario | Add-Member -NotePropertyName manifest_variant -NotePropertyValue $Variant
        $variantScenario | Add-Member -NotePropertyName manifest_reused_object -NotePropertyValue $null
        $variantScenario | Add-Member -NotePropertyName manifest_dynamic_getter_hits -NotePropertyValue 0
        $invalidProvider = {
            param($Request)
            [void]$script:Scenario.manifest_requests.Add($Request)
            $result = Invoke-FoundationDefaultManifestProvider $Request
            $scopeId = [string]$Request.scope_id
            if ($scopeId -ceq "source_dist_B_before") {
                if ([string]$script:Scenario.manifest_variant -ceq "wrong_scope_id") {
                    $result.scope_id = "source_dist_C_before"
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "wrong_root_set") {
                    $result.roots = @()
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "wrong_root_id") {
                    $result.roots[0].root_id = "unexpected_root_id"
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "wrong_root_path") {
                    $result.roots[0].path = [string]$script:Scenario.fixture.external
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "wrong_exists") {
                    $result.roots[0].exists = -not [bool]$result.roots[0].exists
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "dynamic_top") {
                    $scopeValue = [string]$result.scope_id
                    $result.PSObject.Properties.Remove("scope_id")
                    $result | Add-Member -MemberType ScriptProperty -Name scope_id -Value {
                        $script:Scenario.manifest_dynamic_getter_hits++
                        return $scopeValue
                    }
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "dynamic_root") {
                    $rootValue = [string]$result.roots[0].root_id
                    $result.roots[0].PSObject.Properties.Remove("root_id")
                    $result.roots[0] | Add-Member -MemberType ScriptProperty -Name root_id -Value {
                        $script:Scenario.manifest_dynamic_getter_hits++
                        return $rootValue
                    }
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "reuse_top_object") {
                    $script:Scenario.manifest_reused_object = $result
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "reuse_nested_root") {
                    $script:Scenario.manifest_reused_object = $result.roots[0]
                }
            }
            elseif ($scopeId -ceq "source_dist_C_before") {
                if ([string]$script:Scenario.manifest_variant -ceq "reuse_top_object") {
                    $shared = $script:Scenario.manifest_reused_object
                    Assert-True ($null -ne $shared) "Cross-layer provider top object was not initialized"
                    $shared.scope_id = $result.scope_id
                    $shared.roots = $result.roots
                    $shared.entries = $result.entries
                    return $shared
                }
                elseif ([string]$script:Scenario.manifest_variant -ceq "reuse_nested_root") {
                    $sharedRoot = $script:Scenario.manifest_reused_object
                    Assert-True ($null -ne $sharedRoot) "Cross-layer provider nested root was not initialized"
                    $sharedRoot.root_id = [string]$result.roots[0].root_id
                    $sharedRoot.path = [string]$result.roots[0].path
                    $sharedRoot.exists = [bool]$result.roots[0].exists
                    $result.roots[0] = $sharedRoot
                }
                elseif ([string]$script:Scenario.manifest_variant -in @("reuse_roots_container", "reuse_entries_container")) {
                    $script:Scenario.manifest_reused_object = $result
                }
            }
            elseif ($scopeId -ceq "source_dist_C_after" -and [string]$script:Scenario.manifest_variant -in @("reuse_roots_container", "reuse_entries_container")) {
                $shared = $script:Scenario.manifest_reused_object
                Assert-True ($null -ne $shared) "Cross-layer provider container was not initialized"
                if ([string]$script:Scenario.manifest_variant -ceq "reuse_roots_container") {
                    $result.roots = $shared.roots
                }
                else {
                    $result.entries = $shared.entries
                }
            }
            return $result
        }

        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $invalidProvider $null
        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "Invalid manifest provider verdict: $Variant"
        $expectedFailedScope = if ($Variant -in @("reuse_top_object", "reuse_nested_root")) { "source_dist_C_before" } elseif ($Variant -in @("reuse_roots_container", "reuse_entries_container")) { "source_dist_C_after" } else { "source_dist_B_before" }
        $manifestErrors = @($variantReport.errors | Where-Object { [string]$_.code -ceq "manifest_failed" -and [string]$_.scope_id -ceq $expectedFailedScope })
        Assert-Equal 1 $manifestErrors.Count "Invalid manifest provider structured error: $Variant"
        Assert-Equal "manifest" ([string]$manifestErrors[0].category) "Invalid manifest provider error category: $Variant"
        $expectedIdentityError = if ($Variant -like "dynamic_*") { "MANIFEST_PROVIDER_DYNAMIC_MEMBER" } elseif ($Variant -like "reuse_*") { "MANIFEST_RESULT_IDENTITY_REUSED" } else { "MANIFEST_RESULT_IDENTITY_INVALID" }
        Assert-True ([string]$manifestErrors[0].message -cmatch [regex]::Escape($expectedIdentityError)) "Invalid manifest provider stable identity error missing: $Variant"
        Assert-Equal 0 ([int]$variantScenario.manifest_dynamic_getter_hits) "Invalid manifest provider executed dynamic getter: $Variant"

        $scopeIds = @($variantScenario.manifest_requests | ForEach-Object { [string]$_.scope_id })
        foreach ($scopeId in @("official_before", "project_business_candidates_before", "source_dist_B_before", "source_dist_C_before", "openclaw_pre_delete_audit", "official_after", "project_business_candidates_after", "source_dist_B_after", "source_dist_C_after")) {
            Assert-Equal 1 @($scopeIds | Where-Object { $_ -ceq $scopeId }).Count "Invalid manifest provider finally scope: $Variant/$scopeId"
        }
        Assert-True ([bool]$variantReport.environment.restored) "Invalid manifest provider environment not restored: $Variant"
        Assert-True ([bool]$variantReport.openclaw_state.pre_delete_audit.completed) "Invalid manifest provider stopped OpenClaw audit: $Variant"
        Assert-Equal 4 @($variantReport.temporary_roots).Count "Invalid manifest provider temporary root count: $Variant"
        foreach ($temporaryRoot in @($variantReport.temporary_roots)) {
            Assert-True ([bool]$temporaryRoot.pre_delete_audit.completed) "Invalid manifest provider stopped temporary audit: $Variant/$($temporaryRoot.root_id)"
            Assert-True ([bool]$temporaryRoot.cleanup.attempted) "Invalid manifest provider stopped cleanup: $Variant/$($temporaryRoot.root_id)"
        }
        [void](Assert-OfficialObservationPair $variantReport $variantFixture "Invalid manifest provider variant $Variant")
        Assert-SourceDistReportEmpty $variantReport $variantFixture "Invalid manifest provider variant $Variant" $expectedFailedScope
        Assert-ManifestLayerObjectFreshness $variantReport "Invalid manifest provider variant $Variant"
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-InvalidManifestProviderVariants {
    $failures = New-Object System.Collections.ArrayList
    foreach ($variant in @("wrong_scope_id", "wrong_root_set", "wrong_root_id", "wrong_root_path", "wrong_exists", "dynamic_top", "dynamic_root", "reuse_top_object", "reuse_roots_container", "reuse_entries_container", "reuse_nested_root")) {
        try {
            Invoke-InvalidManifestProviderVariant $variant
        }
        catch {
            [void]$failures.Add("${variant}:$($_.Exception.Message)")
        }
    }
    if ($failures.Count -gt 0) {
        throw ("Invalid manifest provider subvariants failed: " + (@($failures) -join " || "))
    }
}

function Assert-RawTextArtifact {
    param([string]$Path, [string]$Sha256, [string]$ExpectedText, [string]$Label)
    Assert-True (-not [string]::IsNullOrWhiteSpace($Path)) "$Label raw path missing"
    Assert-True (Test-Path -LiteralPath $Path -PathType Leaf) "$Label raw file missing"
    Assert-Equal (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash $Sha256 "$Label raw SHA-256"
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $expectedBytes = $script:Utf8NoBom.GetBytes($ExpectedText)
    Assert-Equal ([Convert]::ToBase64String($expectedBytes)) ([Convert]::ToBase64String($bytes)) "$Label raw bytes"
}

function Get-ReportText {
    param($Report)
    return ($Report | ConvertTo-Json -Depth 32 -Compress)
}

function Assert-BasicReport {
    param($Report)
    Assert-True ($null -ne $Report) "Core returned no report"
    Assert-Equal "foundation-safety-report/v1" $Report.schema_version "Report schema"
    Assert-Equal "SH-SAFE-BASE-001" $Report.task_id "Report task"
    Assert-Equal 9 @($Report.commands).Count "Report command count"
    $expectedCommandIds = @("A.structure", "B.test", "B.build", "B.plugin_build_check", "B.plugin_validate", "C.test", "C.build", "C.plugin_build_check", "C.plugin_validate")
    Assert-Equal ($expectedCommandIds -join "|") (@($Report.commands | ForEach-Object { [string]$_.id }) -join "|") "Report command ID order"
    Assert-True ($null -ne $Report.manifests.official.after) "After manifest missing"
    Assert-True ($null -ne $Report.environment) "Environment result missing"
    Assert-Equal 4 @($Report.temporary_roots).Count "Temporary root count"
}

function Assert-PathSecurityReport {
    param($Report, [string]$Label)
    Assert-True ($null -ne $Report.PSObject.Properties["path_security"]) "$Label path security missing"
    $pathSecurity = $Report.path_security
    Assert-ExactPropertySet $pathSecurity @("schema_version", "immutable_input_share_mode", "writable_parent_share_mode", "share_write_for_immutable_inputs", "share_delete_for_all_pins", "operations") "$Label path security"
    Assert-Equal "windows-handle-pin/v1" ([string]$pathSecurity.schema_version) "$Label path security schema"
    Assert-ExactOrderedStringArray @("FILE_SHARE_READ") $pathSecurity.immutable_input_share_mode "$Label immutable share mode"
    Assert-ExactOrderedStringArray @("FILE_SHARE_READ", "FILE_SHARE_WRITE") $pathSecurity.writable_parent_share_mode "$Label writable parent share mode"
    Assert-True ($pathSecurity.share_write_for_immutable_inputs -is [bool] -and -not [bool]$pathSecurity.share_write_for_immutable_inputs) "$Label immutable inputs shared for write"
    Assert-True ($pathSecurity.share_delete_for_all_pins -is [bool] -and -not [bool]$pathSecurity.share_delete_for_all_pins) "$Label delete sharing enabled"
    $operations = @($pathSecurity.operations)
    Assert-True ($operations.Count -gt 0) "$Label path operations missing"
    $allowedKinds = @("runtime_source_read", "runtime_snapshot_create", "runtime_snapshot_read", "manifest_read", "root_create", "staging_copy", "command_launch", "evidence_publish", "cleanup_dispose", "residual_scan")
    $allowedPhases = @("pin", "use", "complete")
    $operationIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($operation in $operations) {
        Assert-ExactPropertySet $operation @("operation_id", "operation_kind", "phase", "pinned_paths", "immutable_input_count", "share_write", "share_delete", "handle_bound", "succeeded", "error_code") "$Label path operation"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$operation.operation_id) -and $operationIds.Add([string]$operation.operation_id)) "$Label path operation ID reused"
        Assert-True ([string]$operation.operation_kind -cin $allowedKinds) "$Label path operation kind: $($operation.operation_kind)"
        Assert-True ([string]$operation.phase -cin $allowedPhases) "$Label path operation phase: $($operation.phase)"
        Assert-True ($operation.share_write -is [bool]) "$Label path operation share_write type"
        Assert-True ($operation.share_delete -is [bool] -and -not [bool]$operation.share_delete) "$Label path operation delete sharing"
        Assert-True ($operation.handle_bound -is [bool] -and [bool]$operation.handle_bound) "$Label path operation was not handle-bound"
        Assert-True ($operation.succeeded -is [bool] -and [bool]$operation.succeeded) "$Label path operation failed: $($operation.operation_id)"
        Assert-Null $operation.error_code "$Label successful path operation error: $($operation.operation_id)"
        $pins = @($operation.pinned_paths)
        Assert-True ($pins.Count -gt 0) "$Label path operation pins missing: $($operation.operation_id)"
        Assert-True ([int]$operation.immutable_input_count -ge 0 -and [int]$operation.immutable_input_count -le $pins.Count) "$Label immutable pin count: $($operation.operation_id)"
        foreach ($pin in $pins) {
            Assert-ExactPropertySet $pin @("path", "volume_serial", "file_id", "attributes", "share_write", "share_delete") "$Label path pin $($operation.operation_id)"
            Assert-True ([System.IO.Path]::IsPathRooted([string]$pin.path)) "$Label path pin is not absolute: $($operation.operation_id)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$pin.volume_serial)) "$Label path pin volume missing: $($operation.operation_id)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$pin.file_id)) "$Label path pin file ID missing: $($operation.operation_id)"
            Assert-True ($pin.share_write -is [bool]) "$Label path pin share_write type: $($operation.operation_id)"
            Assert-True ($pin.share_delete -is [bool] -and -not [bool]$pin.share_delete) "$Label path pin delete sharing: $($operation.operation_id)"
        }
    }
    $observedKinds = New-Object System.Collections.ArrayList
    foreach ($requiredKind in $allowedKinds) {
        if (@($operations | Where-Object { [string]$_.operation_kind -ceq $requiredKind }).Count -gt 0) { [void]$observedKinds.Add($requiredKind) }
    }
    Assert-Equal ($allowedKinds -join "|") (@($observedKinds) -join "|") "$Label required path operation kinds"
    foreach ($command in @($Report.commands)) {
        Assert-True ($null -ne $command.PSObject.Properties["path_operation_ids"]) "$Label command path operation IDs missing: $($command.id)"
        $ids = @($command.path_operation_ids)
        Assert-True ($ids.Count -gt 0) "$Label command path operation IDs empty: $($command.id)"
        Assert-Equal $ids.Count @($ids | Sort-Object -Unique).Count "$Label command path operation IDs reused: $($command.id)"
        foreach ($operationId in $ids) { Assert-True ($operationIds.Contains([string]$operationId)) "$Label dangling command path operation ID: $($command.id)/$operationId" }
    }
}

function Assert-FaultFields {
    param($Report, [string]$Injection, [string]$ExpectedCode, [string]$PreHash, [string]$PostHash)
    Assert-FaultFieldShape $Report
    $fault = $Report.fault
    Assert-Equal $Injection ([string]$fault.failure_injection_point) "Fault injection point"
    Assert-Equal $ExpectedCode ([string]$fault.expected_error_code) "Fault expected error code"
    Assert-Equal $ExpectedCode ([string]$fault.observed_error_code) "Fault observed error code"
    Assert-Equal $PreHash ([string]$fault.pre_state_hash) "Fault pre-state hash"
    Assert-Equal $PostHash ([string]$fault.post_state_hash) "Fault post-state hash"
    Assert-True ([bool]$fault.after_manifest_generated) "Fault after-manifest flag"
    Assert-EmptyDiff $fault.official_business_data_diff "Fault official business data"
}

function Assert-FaultFieldShape {
    param($Report)
    $expectedKeys = @("failure_injection_point", "pre_state_hash", "expected_error_code", "should_rollback", "post_state_hash", "state_after_restart", "same_key_retry_result", "official_business_data_diff", "observed_error_code", "after_manifest_generated", "field_na_reasons")
    Assert-True ($null -ne $Report.fault) "Failed report fault object missing"
    $actualKeys = @($Report.fault.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-Equal 11 $actualKeys.Count "Fault object key count"
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedKeys) (Get-OrdinalIgnoreCaseSignature $actualKeys) "Fault object exact keyset"
    foreach ($name in @("should_rollback", "state_after_restart", "same_key_retry_result")) {
        Assert-Equal "NA" ([string]$Report.fault.$name) "Fault NA field: $name"
    }
    $reasonKeys = @($Report.fault.field_na_reasons.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-Equal (Get-OrdinalIgnoreCaseSignature @("should_rollback", "state_after_restart", "same_key_retry_result")) (Get-OrdinalIgnoreCaseSignature $reasonKeys) "Fault NA reason keyset"
    foreach ($name in $reasonKeys) {
        Assert-Equal "not_business_transaction_or_restart_or_idempotency_test" ([string]$Report.fault.field_na_reasons.$name) "Fault NA reason: $name"
    }
}

function Assert-ConcreteFaultFields {
    param(
        $Report,
        [string]$Injection,
        [string]$ExpectedCode,
        [string]$PreHash,
        [string]$PostHash,
        [int]$ExpectedAdded,
        [int]$ExpectedModified,
        [int]$ExpectedDeleted
    )
    Assert-FaultFieldShape $Report
    $fault = $Report.fault
    Assert-Equal $Injection ([string]$fault.failure_injection_point) "Concrete fault injection point"
    Assert-Equal $ExpectedCode ([string]$fault.expected_error_code) "Concrete fault expected error code"
    Assert-Equal $ExpectedCode ([string]$fault.observed_error_code) "Concrete fault observed error code"
    Assert-Equal $PreHash ([string]$fault.pre_state_hash) "Concrete fault pre-state hash"
    Assert-Equal $PostHash ([string]$fault.post_state_hash) "Concrete fault post-state hash"
    Assert-True ([bool]$fault.after_manifest_generated) "Concrete fault after-manifest flag"
    Assert-Equal $ExpectedAdded @($fault.official_business_data_diff.added).Count "Concrete fault added diff count"
    Assert-Equal $ExpectedModified @($fault.official_business_data_diff.modified).Count "Concrete fault modified diff count"
    Assert-Equal $ExpectedDeleted @($fault.official_business_data_diff.deleted).Count "Concrete fault deleted diff count"
}

function Get-NonCommandFaultExpectation {
    param([string]$Id)
    $map = @{
        "RED-MANIFEST-001" = @("runtime_business_candidates", "TEMPORARY_BUSINESS_CANDIDATE", 0, 0, 0)
        "RED-MANIFEST-003" = @("modify_jsonl", "OFFICIAL_DATA_MODIFIED", 0, 1, 0)
        "RED-MANIFEST-004" = @("add_sqlite_wal", "OFFICIAL_DATA_ADDED", 1, 0, 0)
        "RED-MANIFEST-005" = @("delete_db_journal", "OFFICIAL_DATA_DELETED", 0, 0, 1)
        "RED-MANIFEST-006" = @("manifest_provider_scope_throw", "manifest_failed", 0, 0, 0)
        "RED-STAGING-002" = @("lifecycle", "RUNTIME_IDENTITY_INVALID", 0, 0, 0)
        "RED-CACHE-003" = @("plugin_writes_external_guard", "EXTERNAL_GUARD_CHANGED", 0, 0, 0)
        "RED-CACHE-VITEST-002" = @("vitest_cache_guard_change", "EXTERNAL_GUARD_CHANGED", 0, 0, 0)
        "RED-OPENCLAW-004" = @("non_allowlisted_openclaw_business_files", "OPENCLAW_BUSINESS_CANDIDATE", 0, 0, 0)
        "RED-ENV-003" = @("after_environment_snapshot_failure", "environment_snapshot_failed", 0, 0, 0)
        "RED-REPORT-004" = @("report_publisher_failure", "report_publish_failed", 0, 0, 0)
    }
    if ($map.ContainsKey($Id)) {
        return [pscustomobject]@{
            injection = $map[$Id][0]
            code = $map[$Id][1]
            added = [int]$map[$Id][2]
            modified = [int]$map[$Id][3]
            deleted = [int]$map[$Id][4]
        }
    }
    return $null
}

function Invoke-PathTest {
    param([string]$Id, $Fixture)
    $trusted = Join-Path $Fixture.routes.A "data"
    if ($Id -eq "RED-ROOT-002") {
        $result = Resolve-FoundationChildPath -TrustedParent $trusted -CandidateRelativePath "..\outside\escape.db" -ExpectedLeaf ""
        Assert-True (-not $result.allowed) "Traversal was allowed"
        Assert-Equal "PATH_TRAVERSAL_REJECTED" $result.error_code "Traversal error code"
    }
    elseif ($Id -eq "RED-ROOT-003") {
        $result = Resolve-FoundationChildPath -TrustedParent $trusted -CandidateRelativePath $Fixture.external -ExpectedLeaf ""
        Assert-True (-not $result.allowed) "Absolute external path was allowed"
        Assert-Equal "PATH_OUTSIDE_ALLOWED_ROOT" $result.error_code "External path error code"
    }
    elseif ($Id -eq "RED-ROOT-004") {
        New-Directory (Join-Path $Fixture.routes.A "data-evil")
        $result = Resolve-FoundationChildPath -TrustedParent $trusted -CandidateRelativePath "..\data-evil" -ExpectedLeaf ""
        Assert-True (-not $result.allowed) "Prefix collision was allowed"
    }
    elseif ($Id -eq "RED-ROOT-005") {
        $target = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.external "path-helper-junction-target")
        $linkParent = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $trusted "path-helper-parent")
        $link = [System.IO.Path]::GetFullPath((Join-Path $linkParent "linked"))
        New-Directory $target
        New-Directory $linkParent
        try {
            [void](New-Item -ItemType Junction -Path $link -Target $target)
            $result = Resolve-FoundationChildPath -TrustedParent $trusted -CandidateRelativePath "path-helper-parent\linked\escape.db" -ExpectedLeaf ""
            Assert-True (-not $result.allowed) "Reparse path was allowed"
            Assert-Equal "PATH_REPARSE_POINT_REJECTED" $result.error_code "Reparse error code"
        }
        finally {
            $linkItem = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
            if ($null -ne $linkItem) {
                Assert-True (($linkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) "Path helper cleanup leaf is not a junction"
                [System.IO.Directory]::Delete($link)
            }
        }
    }
    Assert-Equal 0 @(Get-ChildItem -LiteralPath $Fixture.external -Recurse -File -ErrorAction SilentlyContinue).Count "External write count"
}

function Invoke-AncestorJunctionSafetyVariant {
    param($Fixture, $OriginalScenario)
    $physicalTarget = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.external "trusted-parent-ancestor-target")
    $junctionPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "trusted-parent-ancestor-link")
    $resolverParentPhysical = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $physicalTarget "resolver-parent")
    $cleanupParentPhysical = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $physicalTarget "cleanup-parent")
    $cleanupRunId = "ancestorcleanup" + [guid]::NewGuid().ToString("N")
    $cleanupTaskId = "SH-SAFE-BASE-001"
    $cleanupRunPhysical = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path (Join-Path $cleanupParentPhysical $cleanupTaskId) $cleanupRunId)
    $cleanupSentinel = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $cleanupRunPhysical "sentinel.txt")
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    $originalRuntimeTemporaryParent = [string]$Fixture.runtime.temporary_parent
    $failures = New-Object System.Collections.ArrayList
    $linkCreated = $false
    try {
        New-Directory $physicalTarget
        New-Directory $resolverParentPhysical
        Write-StableFile $cleanupSentinel "ancestor cleanup sentinel"
        $physicalBeforeLink = Get-TestPhysicalTreeDigest $Fixture $physicalTarget
        [void](New-Item -ItemType Junction -Path $junctionPath -Target $physicalTarget)
        $linkCreated = $true

        try {
            $resolverTrustedParent = Join-Path $junctionPath "resolver-parent"
            $resolverResult = Resolve-FoundationChildPath -TrustedParent $resolverTrustedParent -CandidateRelativePath (Join-Path $cleanupTaskId $cleanupRunId) -ExpectedLeaf $cleanupRunId
            Assert-True (-not [bool]$resolverResult.allowed) "Ancestor junction child resolver was allowed"
            Assert-Equal "PATH_REPARSE_POINT_REJECTED" ([string]$resolverResult.error_code) "Ancestor junction child resolver error"
            Assert-Equal $physicalBeforeLink (Get-TestPhysicalTreeDigest $Fixture $physicalTarget) "Ancestor junction child resolver physical target"
        }
        catch {
            [void]$failures.Add("child_resolver:$($_.Exception.Message)")
        }

        try {
            $cleanupBefore = Get-TestPhysicalTreeDigest $Fixture $physicalTarget
            $cleanupSpec = [pscustomobject]@{
                root_id = "isolated_test_root"
                path = Join-Path (Join-Path (Join-Path $junctionPath "cleanup-parent") $cleanupTaskId) $cleanupRunId
                trusted_parent = Join-Path $junctionPath "cleanup-parent"
                task_id = $cleanupTaskId
                run_id = $cleanupRunId
            }
            $cleanupResult = Invoke-FoundationDefaultCleanup $cleanupSpec
            Assert-True ([bool]$cleanupResult.attempted) "Ancestor junction default cleanup was not attempted"
            Assert-True (-not [bool]$cleanupResult.succeeded) "Ancestor junction default cleanup was allowed"
            Assert-Equal 1 ([int]$cleanupResult.residual_count) "Ancestor junction default cleanup residual"
            Assert-True ([string]$cleanupResult.error_text -match "PATH_REPARSE_POINT_REJECTED") "Ancestor junction default cleanup stable rejection missing"
            Assert-True (Test-Path -LiteralPath $cleanupSentinel -PathType Leaf) "Ancestor junction default cleanup deleted the physical sentinel"
            Assert-Equal $cleanupBefore (Get-TestPhysicalTreeDigest $Fixture $physicalTarget) "Ancestor junction default cleanup physical target"
        }
        catch {
            [void]$failures.Add("default_cleanup:$($_.Exception.Message)")
        }

        try {
            $coreLogicalTemp = $junctionPath
            $corePhysicalSentinel = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $physicalTarget "isolated-test")
            Assert-True (-not (Test-Path -LiteralPath $corePhysicalSentinel)) "Ancestor junction core physical sentinel was not initially absent"
            foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $coreLogicalTemp, "Process") }
            $Fixture.runtime.temporary_parent = $coreLogicalTemp
            $systemGuardParent = Resolve-TestHarnessPathWithinFixture $Fixture.base ([string]$Fixture.guard_parent)
            $fixtureOwner = [System.IO.Path]::GetFullPath([string]$Fixture.base).TrimEnd("\", "/")
            $temporaryParentOwner = Split-Path -Parent ([System.IO.Path]::GetFullPath([string]$Fixture.runtime.temporary_parent))
            $systemGuardParentOwner = Split-Path -Parent ([System.IO.Path]::GetFullPath($systemGuardParent))
            Assert-Equal ([System.IO.Path]::GetFullPath($fixtureOwner)) ([System.IO.Path]::GetFullPath($temporaryParentOwner)) "Ancestor junction temporary parent escaped fixture owner"
            Assert-Equal ([System.IO.Path]::GetFullPath($fixtureOwner)) ([System.IO.Path]::GetFullPath($systemGuardParentOwner)) "Ancestor junction system guard parent escaped fixture owner"
            Assert-Equal ([System.IO.Path]::GetFullPath($temporaryParentOwner)) ([System.IO.Path]::GetFullPath($systemGuardParentOwner)) "Ancestor junction temporary and system guard parents have different owners"
            Assert-True (-not ([System.IO.Path]::GetFullPath([string]$Fixture.runtime.temporary_parent)).Equals([System.IO.Path]::GetFullPath($systemGuardParent), [System.StringComparison]::OrdinalIgnoreCase)) "Ancestor junction temporary and system guard parents are not distinct siblings"
            $variantScenario = New-ScenarioState "RED-ROOT-005-trusted-parent-ancestor" $Fixture
            $runParent = $coreLogicalTemp
            $variantScenario.allowed_run_roots = @{
                isolated_test_root = Join-Path $runParent "isolated-test\SH-SAFE-BASE-001\$($variantScenario.run_id)"
                validation_root = Join-Path $runParent "validation\SH-SAFE-BASE-001\$($variantScenario.run_id)"
                build_root = Join-Path $runParent "build\SH-SAFE-BASE-001\$($variantScenario.run_id)"
                openclaw_state_root = Join-Path $runParent "openclaw\SH-SAFE-BASE-001\$($variantScenario.run_id)"
            }
            $coreBefore = Get-TestPhysicalTreeDigest $Fixture $physicalTarget
            $variantReport = Invoke-CoreForScenario $Fixture $variantScenario $null $null
            Assert-BasicReport $variantReport
            Assert-Equal "failed" ([string]$variantReport.verdict) "Ancestor junction core verdict"
            Assert-Equal 0 @($variantScenario.observed_specs).Count "Ancestor junction core executed a physical command"
            Assert-True (-not (Test-Path -LiteralPath $corePhysicalSentinel)) "Ancestor junction core created the physical sentinel through the junction"
            Assert-Equal $coreBefore (Get-TestPhysicalTreeDigest $Fixture $physicalTarget) "Ancestor junction core physical target"
            $pathErrors = @($variantReport.errors | Where-Object { [string]$_.code -ceq "PATH_REPARSE_POINT_REJECTED" })
            Assert-True ($pathErrors.Count -gt 0) "Ancestor junction core stable rejection missing"
        }
        catch {
            [void]$failures.Add("core_precreate:$($_.Exception.Message)")
        }
    }
    finally {
        $Fixture.runtime.temporary_parent = $originalRuntimeTemporaryParent
        Restore-ProcessEnvironmentState $tempState
        $script:Scenario = $OriginalScenario
        if ($linkCreated) {
            Remove-TestOwnedJunctionLeaf $Fixture $junctionPath $physicalTarget
        }
    }
    if ($failures.Count -gt 0) {
        throw ("Ancestor junction safety subvariants failed: " + (@($failures) -join " || "))
    }
}

function Get-OrdinalIgnoreCaseSignature {
    param([string[]]$Values)
    $copy = New-Object System.Collections.Generic.List[string]
    foreach ($value in @($Values)) {
        $copy.Add([string]$value)
    }
    $copy.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return (@($copy) -join "|").ToUpperInvariant()
}

function Get-TestStagingAudit {
    param($Scenario, $Spec)
    $safeCwd = Resolve-TestHarnessPathUnderRunRoot $Scenario "build_root" ([string]$Spec.cwd)
    $expectedCwd = Resolve-TestHarnessPathUnderRunRoot $Scenario "build_root" (Join-Path ([string]$Scenario.allowed_run_roots.build_root) (Join-Path ([string]$Spec.route) "staging"))
    if (-not $safeCwd.Equals($expectedCwd, [System.StringComparison]::OrdinalIgnoreCase)) {
        Throw-TestHarnessPathOutsideFixture "plugin cwd is not the exact route staging root"
    }
    Assert-True (Test-Path -LiteralPath $safeCwd -PathType Container) "Plugin staging root missing: $safeCwd"

    $arguments = @($Spec.arguments)
    $rootIndexes = @()
    $entryIndexes = @()
    for ($index = 0; $index -lt $arguments.Count; $index++) {
        if ($arguments[$index] -eq "--root") { $rootIndexes += $index }
        if ($arguments[$index] -eq "--entry") { $entryIndexes += $index }
    }
    Assert-Equal 1 $rootIndexes.Count "OpenClaw --root occurrence count for $($Spec.id)"
    Assert-Equal 1 $entryIndexes.Count "OpenClaw --entry occurrence count for $($Spec.id)"
    Assert-True (($rootIndexes[0] + 1) -lt $arguments.Count) "OpenClaw --root value missing for $($Spec.id)"
    Assert-True (($entryIndexes[0] + 1) -lt $arguments.Count) "OpenClaw --entry value missing for $($Spec.id)"
    Assert-Equal $safeCwd ([System.IO.Path]::GetFullPath([string]$arguments[$rootIndexes[0] + 1])) "OpenClaw --root staging path for $($Spec.id)"
    Assert-Equal ".\dist\index.js" ([string]$arguments[$entryIndexes[0] + 1]).Replace("/", "\") "OpenClaw --entry staging path for $($Spec.id)"
    $expectedSnapshotNode = Join-Path ([string]$Spec.runtime_snapshot_root) "node\node-v24.15.0-win-x64\node.exe"
    Assert-Equal ([System.IO.Path]::GetFullPath($expectedSnapshotNode)) ([System.IO.Path]::GetFullPath([string]$Spec.executable)) "Plugin snapshot executable for $($Spec.id)"
    $expectedPrefix = @($Spec.node_runtime.derived_node_prefix)
    $expectedOpenClawEntry = Join-Path ([string]$Spec.runtime_snapshot_root) "pnpm\openclaw@2026.7.1\node_modules\openclaw\openclaw.mjs"
    $pluginVerb = if ([string]$Spec.stage -ceq "plugin_build_check") { "build" } elseif ([string]$Spec.stage -ceq "plugin_validate") { "validate" } else { throw "Unexpected plugin stage in staging audit: $($Spec.stage)" }
    $expectedToolTail = @("plugins", $pluginVerb, "--root", $safeCwd, "--entry", "./dist/index.js")
    Assert-Equal ($expectedPrefix.Count + 1 + $expectedToolTail.Count) $arguments.Count "Plugin exact argument count for $($Spec.id)"
    for ($prefixIndex = 0; $prefixIndex -lt $expectedPrefix.Count; $prefixIndex++) {
        Assert-True ([string]$expectedPrefix[$prefixIndex] -ceq [string]$arguments[$prefixIndex]) "Plugin Node prefix mismatch for $($Spec.id) at $prefixIndex"
    }
    Assert-Equal ([System.IO.Path]::GetFullPath($expectedOpenClawEntry)) ([System.IO.Path]::GetFullPath([string]$arguments[$expectedPrefix.Count])) "Plugin snapshot OpenClaw entry for $($Spec.id)"
    $actualToolTail = @($arguments[($expectedPrefix.Count + 1)..($arguments.Count - 1)])
    Assert-ExactOrderedStringArray $expectedToolTail $actualToolTail "Plugin frozen tool arguments for $($Spec.id)"
    foreach ($argumentToken in @($arguments)) {
        $token = [string]$argumentToken
        Assert-True ($token -notmatch '^(?i:https?://)') "Plugin spec used a network URL token: $token"
        foreach ($forbiddenToken in @("npm", "npx", "corepack", "pnpm", "yarn")) {
            Assert-True (-not [string]::Equals($token, $forbiddenToken, [System.StringComparison]::OrdinalIgnoreCase)) "Plugin spec used a package manager token: $token"
        }
    }

    $expectedTopLevel = @("dist", "node_modules", "openclaw.plugin.json", "package.json", "skills", "src", "tests", "tsconfig.json")
    $actualTopLevel = @(Get-ChildItem -LiteralPath $safeCwd -Force | ForEach-Object { $_.Name })
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedTopLevel) (Get-OrdinalIgnoreCaseSignature $actualTopLevel) "Plugin staging top-level allowlist for $($Spec.id)"
    foreach ($name in @("package.json", "openclaw.plugin.json", "tsconfig.json")) {
        $leafPath = Join-Path $safeCwd $name
        $leafItem = Get-Item -LiteralPath $leafPath -Force
        Assert-True (-not $leafItem.PSIsContainer) "Staged file missing: $name"
        Assert-True (($leafItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Staged file is a reparse point: $name"
    }
    foreach ($name in @("skills", "dist", "node_modules", "src", "tests")) {
        $directoryPath = Join-Path $safeCwd $name
        $directoryItem = Get-Item -LiteralPath $directoryPath -Force
        Assert-True ($directoryItem.PSIsContainer) "Staged directory missing: $name"
        Assert-True (($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Staged directory is a reparse point: $name"
    }
    foreach ($sample in @(
        [pscustomobject]@{ relative_path = "src\foundation-fixture.ts"; text = 'export const foundationFixture = "ordinary-source";' },
        [pscustomobject]@{ relative_path = "tests\foundation-fixture.test.ts"; text = 'export const foundationFixtureTest = "ordinary-test";' }
    )) {
        $samplePath = Join-Path $safeCwd ([string]$sample.relative_path)
        $sampleItem = Get-Item -LiteralPath $samplePath -Force
        Assert-True (-not $sampleItem.PSIsContainer) "Staged sample missing: $($sample.relative_path)"
        Assert-True (($sampleItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Staged sample is a reparse point: $($sample.relative_path)"
        Assert-Equal ([string]$sample.text) ([System.IO.File]::ReadAllText($samplePath, [System.Text.Encoding]::UTF8)) "Staged sample bytes: $($sample.relative_path)"
    }
    $nodeModulesChildren = @(Get-ChildItem -LiteralPath (Join-Path $safeCwd "node_modules") -Force | ForEach-Object { $_.Name })
    Assert-Equal "TYPEBOX" (Get-OrdinalIgnoreCaseSignature $nodeModulesChildren) "Staging node_modules allowlist for $($Spec.id)"

    $typeboxRoot = Join-Path $safeCwd "node_modules\typebox"
    $typeboxItem = Get-Item -LiteralPath $typeboxRoot -Force
    Assert-True (($typeboxItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "Staged typebox root is a reparse point"
    $reparseItems = @(Get-ChildItem -LiteralPath $typeboxRoot -Recurse -Force | Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 })
    Assert-Equal 0 $reparseItems.Count "Staged typebox reparse descendant count"

    $rows = New-Object System.Collections.Generic.List[string]
    $fileCount = 0
    [long]$totalBytes = 0
    $prefixLength = $typeboxRoot.TrimEnd("\", "/").Length + 1
    foreach ($file in @(Get-ChildItem -LiteralPath $typeboxRoot -Recurse -File -Force)) {
        $relative = $file.FullName.Substring($prefixLength).Replace("/", "\")
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
        $rows.Add("$relative|$($file.Length)|$hash")
        $fileCount++
        $totalBytes += [long]$file.Length
    }
    $rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    $treeHash = Get-TextSha256 (@($rows) -join "`n")
    $packageHash = (Get-FileHash -LiteralPath (Join-Path $typeboxRoot "package.json") -Algorithm SHA256).Hash
    return [pscustomobject]@{
        command_id = [string]$Spec.id
        route = [string]$Spec.route
        staging_root = $safeCwd
        top_level_names = @($actualTopLevel)
        node_modules_names = @($nodeModulesChildren)
        typebox_is_reparse = $false
        typebox_file_count = $fileCount
        typebox_total_bytes = $totalBytes
        typebox_tree_sha256 = $treeHash
        typebox_package_sha256 = $packageHash
        openclaw_root_argument = [string]$arguments[$rootIndexes[0] + 1]
        openclaw_entry_argument = [string]$arguments[$entryIndexes[0] + 1]
    }
}

function Assert-ExactCleanRoomPolicy {
    param($Spec, [bool]$Plugin)
    Assert-True ($null -ne $Spec.environment_policy) "Environment policy missing for $($Spec.id)"
    Assert-ExactPropertySet $Spec.environment_policy @("inherit_environment", "profile", "parent_environment", "derived_child_environment") "Environment policy for $($Spec.id)"
    Assert-True (-not [bool]$Spec.environment_policy.inherit_environment) "Environment inheritance enabled for $($Spec.id)"
    Assert-ExactPropertySet $Spec.environment_policy.profile @("root", "home", "appdata", "localappdata", "temp") "Environment profile for $($Spec.id)"
    Assert-ExactPropertySet $Spec.environment_policy.parent_environment @("exact_key_values") "Parent environment for $($Spec.id)"
    Assert-ExactPropertySet $Spec.environment_policy.derived_child_environment @("authority", "caller_values_allowed", "incoming_request_env", "q_supplied_env", "source_derived_createprocess_env", "bootstrap_visible_env", "observations") "Derived child environment for $($Spec.id)"
    Assert-Equal "policy_module" ([string]$Spec.environment_policy.derived_child_environment.authority) "Derived child environment authority for $($Spec.id)"
    Assert-True (-not [bool]$Spec.environment_policy.derived_child_environment.caller_values_allowed) "Caller child environment values were allowed for $($Spec.id)"
    $entries = @($Spec.environment_policy.parent_environment.exact_key_values)
    $expectedNames = if ($Plugin) { $pluginCleanRoomNames } else { $commonCleanRoomNames }
    Assert-Equal $expectedNames.Count $entries.Count "Exact environment key count for $($Spec.id)"
    $actualNames = @($entries | ForEach-Object { [string]$_.name })
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedNames) (Get-OrdinalIgnoreCaseSignature $actualNames) "Exact environment keyset for $($Spec.id)"
    $uniqueNames = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $actualNames) {
        Assert-True ($uniqueNames.Add($name)) "Duplicate environment key for $($Spec.id): $name"
    }
    $expectedSources = @{
        APPDATA = "command_profile_literal"; HOME = "command_profile_literal"; LOCALAPPDATA = "command_profile_literal"
        TEMP = "command_profile_literal"; TMP = "command_profile_literal"; TMPDIR = "command_profile_literal"; USERPROFILE = "command_profile_literal"
        HOMEDRIVE = "command_profile_derived"; HOMEPATH = "command_profile_derived"
        NODE_DISABLE_COMPILE_CACHE = "contract_literal"; PATH = "contract_literal"
        ComSpec = "validated_system_literal"; SystemRoot = "validated_system_literal"; WINDIR = "validated_system_literal"; OS = "validated_system_literal"; PATHEXT = "validated_system_literal"
        NUMBER_OF_PROCESSORS = "validated_host_scalar"; PROCESSOR_ARCHITECTURE = "validated_host_scalar"; USERNAME = "validated_host_scalar"
    }
    foreach ($entry in $entries) {
        $entryName = [string]$entry.name
        Assert-ExactPropertySet $entry @("name", "value", "source") "Environment entry for $($Spec.id)/$entryName"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$entry.source)) "Environment value source missing for $($Spec.id): $entryName"
        if ($expectedSources.ContainsKey($entryName)) {
            Assert-Equal ([string]$expectedSources[$entryName]) ([string]$entry.source) "Environment value source for $($Spec.id): $entryName"
        }
    }
    $disable = @($entries | Where-Object { $_.name -eq "NODE_DISABLE_COMPILE_CACHE" })
    Assert-Equal 1 $disable.Count "NODE_DISABLE_COMPILE_CACHE count for $($Spec.id)"
    Assert-Equal "1" ([string]$disable[0].value) "NODE_DISABLE_COMPILE_CACHE value for $($Spec.id)"
    foreach ($forbidden in @("NODE_COMPILE_CACHE", "NODE_COMPILE_CACHE_PORTABLE", "NODE_OPTIONS", "NODE_PATH", "OPENSSL_CONF", "VITEST", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "JITI_NATIVE_MODULES")) {
        Assert-True ($actualNames -notcontains $forbidden) "Forbidden child key present for $($Spec.id): $forbidden"
    }
    $pathEntry = @($entries | Where-Object { $_.name -eq "PATH" })[0]
    Assert-Equal "C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0" ([string]$pathEntry.value) "Controlled PATH for $($Spec.id)"
    Assert-True (([string]$pathEntry.value) -notmatch '(?i)node|npm|npx|corepack') "Controlled PATH contains a forbidden tool for $($Spec.id)"
    if ($Plugin) {
        Assert-Equal "false" ([string]@($entries | Where-Object { $_.name -eq "JITI_FS_CACHE" })[0].value) "JITI_FS_CACHE value for $($Spec.id)"
        foreach ($name in @("OPENCLAW_CONFIG_PATH", "OPENCLAW_HOME", "OPENCLAW_STATE_DIR")) {
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]@($entries | Where-Object { $_.name -eq $name })[0].value)) "Controlled plugin value missing for $($Spec.id): $name"
        }
    }
    else {
        foreach ($name in $pluginOnlyCleanRoomNames) {
            Assert-True ($actualNames -notcontains $name) "Plugin-only key leaked into non-plugin command $($Spec.id): $name"
        }
    }
}

function Assert-ControlledEnvironmentPaths {
    param($Spec, $Scenario, [bool]$Plugin)
    Assert-ExactCleanRoomPolicy $Spec $Plugin
    $entries = @($Spec.environment_policy.parent_environment.exact_key_values)
    $values = @{}
    $sources = @{}
    foreach ($entry in $entries) {
        $values[[string]$entry.name] = [string]$entry.value
        $sources[[string]$entry.name] = [string]$entry.source
    }
    $rootId = if ($Plugin) { "openclaw_state_root" } elseif ([string]$Spec.stage -ceq "build") { "build_root" } else { "validation_root" }
    $expectedRoot = [System.IO.Path]::GetFullPath([string]$Scenario.allowed_run_roots[$rootId]).TrimEnd("\", "/")
    $writeRoot = if ($Plugin) { $expectedRoot } else { Join-Path $expectedRoot ([string]$Spec.route) }
    $profileRoot = Join-Path $writeRoot ("environment\" + [string]$Spec.id)
    $profile = $Spec.environment_policy.profile
    Assert-Equal ([System.IO.Path]::GetFullPath($profileRoot)) ([System.IO.Path]::GetFullPath([string]$profile.root)) "Profile root for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path $profileRoot "home"))) ([System.IO.Path]::GetFullPath([string]$profile.home)) "Profile home for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path $profileRoot "appdata\roaming"))) ([System.IO.Path]::GetFullPath([string]$profile.appdata)) "Profile roaming appdata for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path $profileRoot "appdata\local"))) ([System.IO.Path]::GetFullPath([string]$profile.localappdata)) "Profile local appdata for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path $profileRoot "temp"))) ([System.IO.Path]::GetFullPath([string]$profile.temp)) "Profile temp for $($Spec.id)"
    foreach ($name in @("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR")) {
        [void](Resolve-TestHarnessPathUnderRunRoot $Scenario $rootId $values[$name])
        Assert-True (-not [string]::IsNullOrWhiteSpace($sources[$name])) "Controlled path source missing for $($Spec.id): $name"
    }
    Assert-Equal ([string]$profile.home) $values.HOME "HOME profile mapping for $($Spec.id)"
    Assert-Equal ([string]$profile.home) $values.USERPROFILE "USERPROFILE profile mapping for $($Spec.id)"
    Assert-Equal ([string]$profile.appdata) $values.APPDATA "APPDATA profile mapping for $($Spec.id)"
    Assert-Equal ([string]$profile.localappdata) $values.LOCALAPPDATA "LOCALAPPDATA profile mapping for $($Spec.id)"
    Assert-Equal ([string]$profile.temp) $values.TEMP "TEMP profile mapping for $($Spec.id)"
    Assert-Equal $values.HOME $values.USERPROFILE "HOME and USERPROFILE for $($Spec.id)"
    Assert-Equal $values.TEMP $values.TMP "TEMP and TMP for $($Spec.id)"
    Assert-Equal $values.TEMP $values.TMPDIR "TEMP and TMPDIR for $($Spec.id)"
    $reconstructedHome = [System.IO.Path]::GetFullPath($values.HOMEDRIVE + $values.HOMEPATH).TrimEnd("\", "/")
    Assert-Equal ([System.IO.Path]::GetFullPath($values.HOME).TrimEnd("\", "/")) $reconstructedHome "HOMEDRIVE and HOMEPATH for $($Spec.id)"
    if ($Plugin) {
        Assert-Equal $expectedRoot ([System.IO.Path]::GetFullPath($values.OPENCLAW_STATE_DIR).TrimEnd("\", "/")) "OPENCLAW_STATE_DIR for $($Spec.id)"
        Assert-Equal $expectedRoot ([System.IO.Path]::GetFullPath($values.OPENCLAW_HOME).TrimEnd("\", "/")) "OPENCLAW_HOME for $($Spec.id)"
        Assert-Equal (Join-Path $expectedRoot "openclaw.json") ([System.IO.Path]::GetFullPath($values.OPENCLAW_CONFIG_PATH)) "OPENCLAW_CONFIG_PATH for $($Spec.id)"
        Assert-Equal "false" $values.JITI_FS_CACHE "JITI_FS_CACHE for $($Spec.id)"
    }
    Assert-Equal 1 @($Spec.permission_model.fs_write_roots).Count "Permission write root count for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath($writeRoot)) ([System.IO.Path]::GetFullPath([string]@($Spec.permission_model.fs_write_roots)[0])) "Permission write root for $($Spec.id)"
}

function Assert-ExactOrderedStringArray {
    param([string[]]$Expected, $Actual, [string]$Label)
    Assert-True (-not ($Actual -is [string])) "$Label was stringified"
    $actualItems = @($Actual)
    Assert-Equal $Expected.Count $actualItems.Count "$Label count"
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-True ([string]$Expected[$index] -ceq [string]$actualItems[$index]) "$Label item $index; expected=[$($Expected[$index])] actual=[$($actualItems[$index])]"
    }
}

function Get-ExpectedNetworkHookSet {
    $hooks = New-Object 'System.Collections.Generic.List[string]'
    foreach ($group in @(
        [pscustomobject]@{ prefix = "node:net"; names = @("connect", "createConnection", "createServer") },
        [pscustomobject]@{ prefix = "node:http"; names = @("request", "get", "createServer") },
        [pscustomobject]@{ prefix = "node:https"; names = @("request", "get", "createServer") },
        [pscustomobject]@{ prefix = "node:http2"; names = @("connect", "createServer", "createSecureServer", "performServerHandshake") },
        [pscustomobject]@{ prefix = "node:tls"; names = @("connect", "createServer") },
        [pscustomobject]@{ prefix = "node:dgram"; names = @("createSocket") }
    )) {
        foreach ($name in $group.names) { $hooks.Add($group.prefix + "." + $name) }
    }
    $dnsNames = @("lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse", "setServers")
    foreach ($name in $dnsNames) {
        $hooks.Add("node:dns." + $name)
        $hooks.Add("node:dns/promises." + $name)
    }
    foreach ($value in @(
        "node:net.Socket.prototype.connect", "node:net.Server.prototype.listen",
        "node:http.Agent.prototype.createConnection", "node:https.Agent.prototype.createConnection",
        "node:tls.TLSSocket.prototype.connect", "node:dgram.Socket.prototype.bind",
        "node:dgram.Socket.prototype.connect", "node:dgram.Socket.prototype.send"
    )) { $hooks.Add($value) }
    $resolverNames = @("cancel", "getServers", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse", "setLocalAddress", "setServers")
    foreach ($name in $resolverNames) {
        $hooks.Add("node:dns.Resolver.prototype." + $name)
        $hooks.Add("node:dns/promises.Resolver.prototype." + $name)
    }
    $hooks.Add("globalThis.fetch")
    $hooks.Add("globalThis.WebSocket")
    Assert-Equal 100 $hooks.Count "Frozen network hook oracle count"
    return @($hooks)
}

function Assert-FrozenPolicyBootstrap {
    param($Report, $Scenario, [string]$Label)
    Assert-True ($null -ne $Report.runtime_identity) "$Label runtime_identity missing"
    $policy = $Report.runtime_identity.policy_bootstrap
    Assert-ExactPropertySet $policy @("schema_version", "path", "module_url", "line_count", "length", "sha256", "ascii_only", "derived_node_prefixes", "network_hook_set", "network_not_present", "network_self_tests_passed", "sqlite_controls", "child_invocation_policy", "addon_policy", "policy_ready", "spawn_intents", "spawn_results", "addon_loads", "installed_fail_closed") "$Label policy bootstrap"
    Assert-Equal "foundation-trusted-policy/v2" ([string]$policy.schema_version) "$Label policy schema"
    Assert-Equal $frozenPolicyLineCount ([int]$policy.line_count) "$Label policy line count"
    Assert-Equal $frozenPolicyLength ([int]$policy.length) "$Label policy length"
    Assert-Equal $frozenPolicySha256 ([string]$policy.sha256) "$Label policy SHA-256"
    Assert-True ($policy.ascii_only -is [bool] -and [bool]$policy.ascii_only) "$Label policy ASCII flag"
    Assert-True ($policy.installed_fail_closed -is [bool] -and [bool]$policy.installed_fail_closed) "$Label policy fail-closed flag"
    $expectedPolicyPath = Join-Path ([string]$Scenario.allowed_run_roots.validation_root) "runtime-snapshot\policy\foundation-node-policy.mjs"
    Assert-Equal ([System.IO.Path]::GetFullPath($expectedPolicyPath)) ([System.IO.Path]::GetFullPath([string]$policy.path)) "$Label policy path"
    Assert-True ([string]$policy.path -cmatch '\.mjs$') "$Label policy extension"
    Assert-True ([string]$policy.module_url -cmatch '^file:///') "$Label policy canonical file URL"
    $contract = Get-FrozenPolicyContract
    $expectedBase64 = [Convert]::ToBase64String($contract.bytes)
    $captures = @($Scenario.policy_file_captures)
    Assert-Equal 8 $captures.Count "$Label runtime policy capture count"
    Assert-ExactOrderedStringArray @("B.test", "B.build", "B.plugin_build_check", "B.plugin_validate", "C.test", "C.build", "C.plugin_build_check", "C.plugin_validate") @($captures | ForEach-Object { [string]$_.command_id }) "$Label runtime policy capture commands"
    foreach ($capture in $captures) {
        Assert-ExactPropertySet $capture @("command_id", "path", "length", "sha256", "base64") "$Label runtime policy capture $($capture.command_id)"
        Assert-Equal ([System.IO.Path]::GetFullPath($expectedPolicyPath)) ([System.IO.Path]::GetFullPath([string]$capture.path)) "$Label runtime policy capture path $($capture.command_id)"
        Assert-Equal $frozenPolicyLength ([long]$capture.length) "$Label runtime policy capture length $($capture.command_id)"
        Assert-Equal $frozenPolicySha256 ([string]$capture.sha256) "$Label runtime policy capture SHA-256 $($capture.command_id)"
        Assert-Equal $expectedBase64 ([string]$capture.base64) "$Label runtime policy capture exact bytes $($capture.command_id)"
    }
    Assert-ExactOrderedStringArray (Get-ExpectedNetworkHookSet) $policy.network_hook_set "$Label network hooks"
    Assert-ExactOrderedStringArray @("globalThis.EventSource") $policy.network_not_present "$Label absent network globals"
    Assert-True ($policy.network_self_tests_passed -is [bool] -and [bool]$policy.network_self_tests_passed) "$Label network self-tests"

    $sqlite = $policy.sqlite_controls
    Assert-ExactPropertySet $sqlite @("cjs_esm_exports_synchronized", "native_constructor_private", "public_prototype_constructor_guarded", "native_prototype_constructor_guarded", "allow_extension", "defensive", "attach_limit", "authorizer_attach_denied", "backup_denied", "sql_guarded_entry_points", "self_tests_passed") "$Label SQLite controls"
    foreach ($name in @("cjs_esm_exports_synchronized", "native_constructor_private", "public_prototype_constructor_guarded", "native_prototype_constructor_guarded", "defensive", "authorizer_attach_denied", "backup_denied", "self_tests_passed")) {
        Assert-True ($sqlite.$name -is [bool] -and [bool]$sqlite.$name) "$Label SQLite control: $name"
    }
    Assert-True ($sqlite.allow_extension -is [bool] -and -not [bool]$sqlite.allow_extension) "$Label SQLite extension setting"
    Assert-Equal 0 ([int]$sqlite.attach_limit) "$Label SQLite attach limit"
    Assert-ExactOrderedStringArray @("exec", "prepare") $sqlite.sql_guarded_entry_points "$Label SQLite guarded entry points"

    $child = $policy.child_invocation_policy
    Assert-ExactPropertySet $child @("roles", "prototype_spawn_one_shot", "vitest_staging_env_files", "vite_user_env", "vitest_config_env", "fork_environment_layers", "fork_ipc_derivation", "source_derived_node_options_by_role", "sync_esbuild_forbidden") "$Label child invocation policy"
    Assert-ExactOrderedStringArray @("vitest_single_fork", "snapshot_node_helper", "esbuild") $child.roles "$Label child roles"
    Assert-True ([bool]$child.prototype_spawn_one_shot) "$Label ChildProcess prototype one-shot"
    Assert-Equal 0 ([int]$child.vitest_staging_env_files) "$Label Vitest staging env file count"
    Assert-Equal 0 @($child.vite_user_env.PSObject.Properties).Count "$Label Vite userEnv"
    Assert-Equal 0 @($child.vitest_config_env.PSObject.Properties).Count "$Label Vitest config env"
    Assert-True ([bool]$child.sync_esbuild_forbidden) "$Label synchronous esbuild rejection"
    Assert-ExactPropertySet $child.fork_ipc_derivation @("effective_stdio", "fd", "serialization", "observed") "$Label fork IPC derivation"
    Assert-ExactOrderedStringArray @("pipe", "pipe", "pipe", "ipc") $child.fork_ipc_derivation.effective_stdio "$Label fork effective stdio"
    Assert-Equal "3" ([string]$child.fork_ipc_derivation.fd) "$Label fork IPC fd"
    Assert-Equal "json" ([string]$child.fork_ipc_derivation.serialization) "$Label fork serialization"
    Assert-True (-not [bool]$child.fork_ipc_derivation.observed) "$Label source-derived IPC marked observed"

    $addon = $policy.addon_policy
    Assert-ExactPropertySet $addon @("exact_two_argument_dlopen", "accepted_path_kinds", "native_original_path_passthrough", "allowed", "actual_loaded") "$Label addon policy"
    Assert-True ([bool]$addon.exact_two_argument_dlopen) "$Label exact two-argument dlopen"
    Assert-True ([bool]$addon.native_original_path_passthrough) "$Label native original addon path passthrough"
    Assert-ExactOrderedStringArray @("ordinary_drive", "namespaced_drive") $addon.accepted_path_kinds "$Label addon path kinds"
    Assert-Equal 1 @($addon.allowed).Count "$Label allowed addon count"
    $allowedAddon = @($addon.allowed)[0]
    Assert-Equal "pnpm\@rollup+rollup-win32-x64-msvc@4.62.4\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node" ([string]$allowedAddon.relative_path) "$Label allowed addon path"
    Assert-Equal 2623488 ([long]$allowedAddon.length) "$Label allowed addon length"
    Assert-Equal "397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49" ([string]$allowedAddon.sha256) "$Label allowed addon SHA-256"
}

function Assert-ExactNodeCommandSpec {
    param($Spec, $Scenario)
    Assert-ExactPropertySet $Spec @("id", "route", "stage", "cwd", "executable", "arguments", "staging_root", "runtime_snapshot_root", "module_resolution_roots", "permission_model", "node_runtime", "execution_topology", "environment_policy") "Node command spec $($Spec.id)"
    Assert-True ([string]$Spec.route -cin @("B", "C")) "Node command route for $($Spec.id)"
    $route = [string]$Spec.route
    $stage = [string]$Spec.stage
    $validationRoute = Join-Path ([string]$Scenario.allowed_run_roots.validation_root) $route
    $buildRoute = Join-Path ([string]$Scenario.allowed_run_roots.build_root) $route
    $staging = Join-Path $buildRoute "staging"
    $snapshot = Join-Path ([string]$Scenario.allowed_run_roots.validation_root) "runtime-snapshot"
    $pnpm = Join-Path $snapshot "pnpm"
    $typebox = Join-Path $staging "node_modules\typebox"
    Assert-Equal ([System.IO.Path]::GetFullPath($staging)) ([System.IO.Path]::GetFullPath([string]$Spec.staging_root)) "Staging root for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath($staging)) ([System.IO.Path]::GetFullPath([string]$Spec.cwd)) "Staging cwd for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath($snapshot)) ([System.IO.Path]::GetFullPath([string]$Spec.runtime_snapshot_root)) "Runtime snapshot root for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path $snapshot "node\node-v24.15.0-win-x64\node.exe"))) ([System.IO.Path]::GetFullPath([string]$Spec.executable)) "Snapshot Node for $($Spec.id)"
    Assert-ExactOrderedStringArray @($staging, $typebox, $pnpm) $Spec.module_resolution_roots "Module roots for $($Spec.id)"

    Assert-ExactPropertySet $Spec.permission_model @("enabled", "argument_vector", "fs_read_roots", "fs_write_roots", "allow_worker", "allow_child_process", "allow_addons", "allow_wasi") "Permission model for $($Spec.id)"
    Assert-True ([bool]$Spec.permission_model.enabled) "Permission model disabled for $($Spec.id)"
    Assert-True (-not [bool]$Spec.permission_model.allow_worker) "Worker allowed for $($Spec.id)"
    Assert-True (-not [bool]$Spec.permission_model.allow_wasi) "WASI allowed for $($Spec.id)"
    $expectedReadRoots = if ($stage -ceq "test") { @($staging, $snapshot, $validationRoute) } elseif ($stage -ceq "build") { @($staging, $snapshot, $validationRoute, $buildRoute) } else { @($staging, $snapshot, [string]$Scenario.allowed_run_roots.openclaw_state_root) }
    $expectedWriteRoot = if ($stage -ceq "test") { $validationRoute } elseif ($stage -ceq "build") { $buildRoute } else { [string]$Scenario.allowed_run_roots.openclaw_state_root }
    Assert-ExactOrderedStringArray $expectedReadRoots $Spec.permission_model.fs_read_roots "Permission read roots for $($Spec.id)"
    Assert-ExactOrderedStringArray @($expectedWriteRoot) $Spec.permission_model.fs_write_roots "Permission write roots for $($Spec.id)"
    $testCapability = $stage -ceq "test"
    Assert-Equal $testCapability ([bool]$Spec.permission_model.allow_child_process) "Child capability for $($Spec.id)"
    Assert-Equal $testCapability ([bool]$Spec.permission_model.allow_addons) "Addon capability for $($Spec.id)"

    Assert-ExactPropertySet $Spec.node_runtime @("argument_vector", "derived_node_prefix", "no_global_search_paths", "policy_module_path", "policy_module_url", "policy_module_sha256") "Node runtime for $($Spec.id)"
    $policyPath = Join-Path $snapshot "policy\foundation-node-policy.mjs"
    Assert-Equal ([System.IO.Path]::GetFullPath($policyPath)) ([System.IO.Path]::GetFullPath([string]$Spec.node_runtime.policy_module_path)) "Policy path for $($Spec.id)"
    Assert-Equal $frozenPolicySha256 ([string]$Spec.node_runtime.policy_module_sha256) "Policy SHA-256 for $($Spec.id)"
    Assert-True ([bool]$Spec.node_runtime.no_global_search_paths) "Global module search was enabled for $($Spec.id)"
    $expectedRuntimeArgs = @("--no-global-search-paths", ("--import=" + [string]$Spec.node_runtime.policy_module_url))
    if ($stage -like "plugin*") { $expectedRuntimeArgs += "--stack-size=8192" }
    Assert-ExactOrderedStringArray $expectedRuntimeArgs $Spec.node_runtime.argument_vector "Node runtime arguments for $($Spec.id)"
    $expectedPrefix = @($Spec.permission_model.argument_vector) + @($Spec.node_runtime.argument_vector)
    Assert-ExactOrderedStringArray $expectedPrefix $Spec.node_runtime.derived_node_prefix "Derived Node prefix for $($Spec.id)"
    Assert-True (@($expectedPrefix).Count -gt 0 -and [string]$expectedPrefix[0] -ceq "--permission") "Permission prefix order for $($Spec.id)"
    Assert-Equal 1 @($expectedPrefix | Where-Object { [string]$_ -ceq ("--import=" + [string]$Spec.node_runtime.policy_module_url) }).Count "Policy import occurrence for $($Spec.id)"
    Assert-Equal 0 @($expectedPrefix | Where-Object { [string]$_ -ceq "--require" -or [string]$_ -like "--require=*" -or [string]$_ -ceq "-r" }).Count "Forbidden CommonJS preload for $($Spec.id)"

    $toolEntry = if ($stage -ceq "test") { Join-Path $pnpm "vitest@2.1.9_@types+node@26.2.0\node_modules\vitest\vitest.mjs" } elseif ($stage -ceq "build") { Join-Path $pnpm "typescript@5.9.3\node_modules\typescript\bin\tsc" } else { Join-Path $pnpm "openclaw@2026.7.1\node_modules\openclaw\openclaw.mjs" }
    $arguments = @($Spec.arguments)
    Assert-True ($arguments.Count -gt $expectedPrefix.Count) "Tool entry missing for $($Spec.id)"
    for ($index = 0; $index -lt $expectedPrefix.Count; $index++) {
        Assert-True ([string]$arguments[$index] -ceq [string]$expectedPrefix[$index]) "Top-level prefix mismatch for $($Spec.id) at $index"
    }
    Assert-Equal ([System.IO.Path]::GetFullPath($toolEntry)) ([System.IO.Path]::GetFullPath([string]$arguments[$expectedPrefix.Count])) "Snapshot tool entry for $($Spec.id)"
    if ($stage -ceq "test") {
        Assert-ExactOrderedStringArray @("run", "--no-cache", "--pool=forks", "--poolOptions.forks.singleFork", "--no-file-parallelism") @($arguments[($expectedPrefix.Count + 1)..($expectedPrefix.Count + 5)]) "Vitest frozen argument prefix for $($Spec.id)"
    }
    Assert-ExactPropertySet $Spec.execution_topology @("pool", "single_fork", "file_parallelism", "allowed_descendant_executables", "policy_attestation_root", "completion_telemetry_best_effort", "job_accounting_required") "Execution topology for $($Spec.id)"
    Assert-True ([bool]$Spec.execution_topology.completion_telemetry_best_effort) "Completion telemetry contract for $($Spec.id)"
    Assert-True ([bool]$Spec.execution_topology.job_accounting_required) "Job accounting contract for $($Spec.id)"
    Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path ([string]$Spec.environment_policy.profile.temp) "foundation-policy-attestations"))) ([System.IO.Path]::GetFullPath([string]$Spec.execution_topology.policy_attestation_root)) "Policy attestation root for $($Spec.id)"
    if ($testCapability) {
        Assert-Equal "forks" ([string]$Spec.execution_topology.pool) "Vitest pool for $($Spec.id)"
        Assert-True ([bool]$Spec.execution_topology.single_fork) "Vitest single fork for $($Spec.id)"
        Assert-True (-not [bool]$Spec.execution_topology.file_parallelism) "Vitest file parallelism for $($Spec.id)"
    }
    Assert-ControlledEnvironmentPaths $Spec $Scenario ($stage -like "plugin*")
    $specText = Get-ReportText $Spec
    foreach ($sourcePath in @($Scenario.fixture.runtime.node_path, $Scenario.fixture.runtime.vitest_path, $Scenario.fixture.runtime.typescript_path, $Scenario.fixture.runtime.openclaw_path)) {
        Assert-True ($specText.IndexOf([string]$sourcePath, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) "Live source runtime path leaked into $($Spec.id): $sourcePath"
    }
}

function Assert-ExactAStructureSpec {
    param($Spec, $Scenario)
    Assert-ExactPropertySet $Spec @("id", "route", "stage", "cwd", "executable", "arguments", "staging_root", "runtime_snapshot_root", "module_resolution_roots", "permission_model", "node_runtime", "execution_topology", "environment_policy") "A.structure command spec"
    Assert-True ([string]$Spec.id -ceq "A.structure") "A.structure command ID"
    Assert-True ([string]$Spec.route -ceq "A") "A.structure route"
    Assert-True ([string]$Spec.stage -ceq "structure") "A.structure stage"
    $expectedCwd = Join-Path ([string]$Scenario.allowed_run_roots.validation_root) "A"
    Assert-Equal ([System.IO.Path]::GetFullPath($expectedCwd)) ([System.IO.Path]::GetFullPath([string]$Spec.cwd)) "A.structure cwd"
    Assert-Equal $powershellPath ([string]$Spec.executable) "A.structure executable"
    $expectedScript = Join-Path $Scenario.fixture.routes.A "tests\validate-foundation.ps1"
    Assert-ExactOrderedStringArray @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $expectedScript) $Spec.arguments "A.structure arguments"
    Assert-Null $Spec.staging_root "A.structure staging root"
    Assert-Null $Spec.runtime_snapshot_root "A.structure runtime snapshot root"
    Assert-Equal 0 @($Spec.module_resolution_roots).Count "A.structure module roots"
    Assert-ExactPropertySet $Spec.permission_model @("enabled", "argument_vector", "fs_read_roots", "fs_write_roots", "allow_worker", "allow_child_process", "allow_addons", "allow_wasi") "A.structure permission model"
    Assert-True (-not [bool]$Spec.permission_model.enabled) "A.structure permission enabled"
    foreach ($field in @("argument_vector", "fs_read_roots", "fs_write_roots")) { Assert-Equal 0 @($Spec.permission_model.$field).Count "A.structure permission $field" }
    foreach ($field in @("allow_worker", "allow_child_process", "allow_addons", "allow_wasi")) { Assert-True (-not [bool]$Spec.permission_model.$field) "A.structure permission $field" }
    Assert-True ($null -eq $Spec.node_runtime -or (@($Spec.node_runtime.argument_vector).Count -eq 0 -and @($Spec.node_runtime.derived_node_prefix).Count -eq 0)) "A.structure exposed Node runtime flags"
    Assert-True ($null -eq $Spec.execution_topology -or @($Spec.execution_topology.allowed_descendant_executables).Count -eq 0) "A.structure exposed Node descendants"
    Assert-True ($null -ne $Spec.environment_policy) "A.structure environment policy missing"
    Assert-True (-not [bool]$Spec.environment_policy.inherit_environment) "A.structure environment inheritance"
    $entries = @(Get-TestSpecParentEnvironmentEntries $Spec)
    Assert-Equal 19 $entries.Count "A.structure environment key count"
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $commonCleanRoomNames) (Get-OrdinalIgnoreCaseSignature @($entries | ForEach-Object { [string]$_.name })) "A.structure environment keyset"
    $profile = $Spec.environment_policy.profile
    Assert-Equal ([System.IO.Path]::GetFullPath($expectedCwd)) ([System.IO.Path]::GetFullPath([string]$profile.root)) "A.structure profile root"
    foreach ($entry in $entries) {
        if ([string]$entry.name -in @("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR")) {
            [void](Resolve-TestHarnessPathUnderRunRoot $Scenario "validation_root" ([string]$entry.value))
        }
    }
}

function Assert-TestEnvironmentLayer {
    param($Actual, $ExpectedEnvironment, [string]$EvidenceKind, [bool]$Observed, [bool]$SourceDerived, $NodeOptions, $Stdio, $IpcFd, [string]$Label)
    $expectedNames = @("evidence_kind", "observed", "source_derived", "key_names", "sha256", "node_options")
    if ($null -ne $Stdio) { $expectedNames += "stdio" }
    if ($null -ne $IpcFd) { $expectedNames += "ipc_fd" }
    Assert-ExactPropertySet $Actual $expectedNames $Label
    $expected = Get-TestEnvironmentLayer $ExpectedEnvironment $EvidenceKind $Observed $SourceDerived $NodeOptions $Stdio $IpcFd
    Assert-Equal $EvidenceKind ([string]$Actual.evidence_kind) "$Label evidence kind"
    Assert-Equal $Observed ([bool]$Actual.observed) "$Label observed"
    Assert-Equal $SourceDerived ([bool]$Actual.source_derived) "$Label source-derived"
    Assert-ExactOrderedStringArray @($expected.key_names) $Actual.key_names "$Label key names"
    Assert-Equal ([string]$expected.sha256) ([string]$Actual.sha256) "$Label digest"
    if ($null -eq $NodeOptions) { Assert-Null $Actual.node_options "$Label NODE_OPTIONS" } else { Assert-Equal ([string]$NodeOptions) ([string]$Actual.node_options) "$Label NODE_OPTIONS" }
    if ($null -ne $Stdio) { Assert-ExactOrderedStringArray @($Stdio) $Actual.stdio "$Label stdio" }
    if ($null -ne $IpcFd) { Assert-Equal ([string]$IpcFd) ([string]$Actual.ipc_fd) "$Label IPC fd" }
}

function Assert-VitestPolicyJournal {
    param($Command, $Spec, [string]$Label)
    Assert-True ($null -ne $Command) "$Label command report missing"
    foreach ($oldName in @("requested_environment", "effective_environment", "requested_env", "effective_env")) {
        Assert-True ($null -eq $Command.PSObject.Properties[$oldName]) "$Label retained obsolete environment field: $oldName"
    }
    $parentEnvironment = Get-TestEnvironmentMap (Get-TestSpecParentEnvironmentEntries $Spec)
    $bookkeeping = [ordered]@{ TEST = "true"; VITEST = "true"; NODE_ENV = "test"; VITEST_MODE = "RUN"; TINYPOOL_WORKER_ID = "1" }
    $viteValues = [ordered]@{ BASE_URL = "/"; MODE = "test"; DEV = "1"; PROD = "" }
    $qSupplied = Copy-TestEnvironmentMap $parentEnvironment
    Add-TestEnvironmentValues $qSupplied $bookkeeping
    $incoming = Copy-TestEnvironmentMap $qSupplied
    Add-TestEnvironmentValues $incoming $viteValues
    $sourceDerived = Copy-TestEnvironmentMap $qSupplied
    Add-TestEnvironmentValues $sourceDerived ([ordered]@{ NODE_CHANNEL_FD = "3"; NODE_CHANNEL_SERIALIZATION_MODE = "json" })

    $intents = @($Command.spawn_intents)
    $results = @($Command.spawn_results)
    $attestations = @($Command.policy_attestations)
    $forks = @($intents | Where-Object { [string]$_.role -ceq "vitest_single_fork" })
    $helpers = @($intents | Where-Object { [string]$_.role -ceq "snapshot_node_helper" })
    $esbuilds = @($intents | Where-Object { [string]$_.role -ceq "esbuild" })
    Assert-Equal 1 $forks.Count "$Label Vitest fork intent count"
    Assert-Equal 1 $helpers.Count "$Label Rollup helper intent count"
    Assert-Equal 1 $esbuilds.Count "$Label esbuild intent count"
    Assert-Equal 3 $intents.Count "$Label exact controlled spawn intent count"
    Assert-Equal 3 $results.Count "$Label exact controlled spawn result count"
    Assert-Equal 3 $attestations.Count "$Label exact policy-ready count"
    $fork = $forks[0]
    Assert-ExactPropertySet $fork @("schema_version", "id", "parent_pid", "api", "role", "executable_path", "executable_sha256", "argv", "cwd", "incoming_request_env", "q_supplied_env", "source_derived_createprocess_env", "bootstrap_visible_env", "derived_node_prefix") "$Label Vitest fork intent"
    Assert-Equal "foundation-spawn-intent/v1" ([string]$fork.schema_version) "$Label Vitest intent schema"
    Assert-Equal "fork" ([string]$fork.api) "$Label Vitest API"
    Assert-TestEnvironmentLayer $fork.incoming_request_env $incoming "q_observed_normalized_request" $true $false $null $null $null "$Label incoming 28"
    Assert-TestEnvironmentLayer $fork.q_supplied_env $qSupplied "q_constructed_supplied" $false $false $null $null $null "$Label Q supplied 24"
    Assert-TestEnvironmentLayer $fork.source_derived_createprocess_env $sourceDerived "node24-fork-ipc-environment-source-derived" $false $true $null @("pipe", "pipe", "pipe", "ipc") "3" "$Label source-derived 26"
    Assert-TestEnvironmentLayer $fork.bootstrap_visible_env $qSupplied "expected_then_child_policy_ready_observed" $false $false $null $null $null "$Label expected bootstrap 24"
    Assert-Equal 28 @($fork.incoming_request_env.key_names).Count "$Label incoming key count"
    Assert-Equal 24 @($fork.q_supplied_env.key_names).Count "$Label Q supplied key count"
    Assert-Equal 26 @($fork.source_derived_createprocess_env.key_names).Count "$Label CreateProcess key count"
    Assert-Equal 24 @($fork.bootstrap_visible_env.key_names).Count "$Label expected bootstrap key count"
    Assert-True (@($fork.bootstrap_visible_env.key_names) -notcontains "NODE_CHANNEL_FD") "$Label bootstrap leaked NODE_CHANNEL_FD"
    Assert-True (@($fork.bootstrap_visible_env.key_names) -notcontains "NODE_CHANNEL_SERIALIZATION_MODE") "$Label bootstrap leaked serialization key"
    Assert-ExactOrderedStringArray @($Spec.node_runtime.derived_node_prefix) $fork.derived_node_prefix "$Label fork derived prefix"
    $forkResults = @($results | Where-Object { [string]$_.id -ceq [string]$fork.id })
    Assert-Equal 1 $forkResults.Count "$Label fork spawn result count"
    $forkAttestations = @($attestations | Where-Object { [string]$_.role -ceq "vitest_single_fork" -and [int]$_.pid -eq [int]$forkResults[0].pid })
    Assert-Equal 1 $forkAttestations.Count "$Label fork policy-ready count"
    Assert-ExactOrderedStringArray @($Spec.executable, (Join-Path ([string]$Spec.runtime_snapshot_root) "pnpm\tinypool@1.1.1\node_modules\tinypool\dist\entry\process.js")) $forkAttestations[0].argv "$Label fork policy-ready argv"
    Assert-TestEnvironmentLayer $forkAttestations[0].bootstrap_visible_env $qSupplied "q_bootstrap_observed" $true $false $null $null $null "$Label actual bootstrap 24"

    $helper = $helpers[0]
    Assert-Null $helper.incoming_request_env "$Label helper incoming environment"
    Assert-TestEnvironmentLayer $helper.q_supplied_env $parentEnvironment "q_constructed_supplied" $false $false $null $null $null "$Label helper Q supplied"
    Assert-TestEnvironmentLayer $helper.source_derived_createprocess_env $parentEnvironment "argv-contains-permission-no-node-options-injection" $false $true $null $null $null "$Label helper source-derived"
    Assert-TestEnvironmentLayer $helper.bootstrap_visible_env $parentEnvironment "expected_then_child_policy_ready_observed" $false $false $null $null $null "$Label helper bootstrap"
    $helperResult = @($results | Where-Object { [string]$_.id -ceq [string]$helper.id })
    Assert-Equal 1 $helperResult.Count "$Label helper spawn result count"
    Assert-True ([int]$helperResult[0].pid -gt 0) "$Label helper spawn PID"
    $helperAttestations = @($attestations | Where-Object { [string]$_.role -ceq "snapshot_node_helper" -and [int]$_.pid -eq [int]$helperResult[0].pid })
    Assert-Equal 1 $helperAttestations.Count "$Label helper policy-ready count"
    $helperAttestation = $helperAttestations[0]
    $rollupTail = @("-p", "const r=require('node:process').report;r.excludeNetwork=true;console.log(JSON.stringify(r.getReport().header));")
    Assert-ExactOrderedStringArray (@($Spec.node_runtime.derived_node_prefix) + @($rollupTail)) $helper.argv "$Label helper effective spawn argv"
    Assert-ExactOrderedStringArray (@($Spec.node_runtime.derived_node_prefix) + @($rollupTail)) $helperAttestation.exec_argv "$Label helper policy-ready exec argv"
    Assert-ExactOrderedStringArray @($Spec.executable) $helperAttestation.argv "$Label helper policy-ready process argv"
    Assert-ExactOrderedStringArray @($Spec.node_runtime.derived_node_prefix) $helperAttestation.derived_node_prefix "$Label helper policy-ready derived prefix"
    Assert-TestEnvironmentLayer $helperAttestation.bootstrap_visible_env $parentEnvironment "q_bootstrap_observed" $true $false $null $null $null "$Label helper actual bootstrap"

    $esbuild = $esbuilds[0]
    Assert-Null $esbuild.incoming_request_env "$Label esbuild incoming environment"
    Assert-Null $esbuild.bootstrap_visible_env "$Label esbuild bootstrap environment"
    Assert-TestEnvironmentLayer $esbuild.q_supplied_env $parentEnvironment "q_constructed_supplied" $false $false $null $null $null "$Label esbuild Q supplied"
    $nativeNodeOptions = @($Spec.permission_model.argument_vector) -join " "
    $esbuildSource = Copy-TestEnvironmentMap $parentEnvironment
    Add-TestEnvironmentValues $esbuildSource ([ordered]@{ NODE_OPTIONS = $nativeNodeOptions })
    Assert-TestEnvironmentLayer $esbuild.source_derived_createprocess_env $esbuildSource "node24-permission-node-options-source-derived" $false $true $nativeNodeOptions @("pipe", "pipe", "inherit") $null "$Label esbuild source-derived"
    Assert-True (@($esbuild.q_supplied_env.key_names) -notcontains "NODE_OPTIONS") "$Label esbuild Q supplied leaked NODE_OPTIONS"

    Assert-True ($null -ne $Command.job_control) "$Label job control missing"
    Assert-True ([bool]$Command.job_control.completion_telemetry.best_effort) "$Label completion telemetry is not best effort"
    Assert-True ([bool]$Command.job_control.completion_telemetry.active_zero_observed) "$Label active zero was not observed"
    Assert-Equal 0 ([int]$Command.job_control.accounting.active_processes) "$Label active process count"
    Assert-True ([bool]$Command.job_control.accounting.matched) "$Label job accounting mismatch"
    Assert-Equal (1 + @($results | Where-Object { [bool]$_.success } | Select-Object -ExpandProperty pid -Unique).Count) ([int]$Command.job_control.accounting.expected_total_processes) "$Label expected Job total"
    Assert-Equal ([int]$Command.job_control.accounting.expected_total_processes) ([int]$Command.job_control.accounting.total_processes) "$Label actual Job total"
    Assert-True ([bool]$Command.job_control.spawn_journal.matched) "$Label spawn journal mismatch"

    $addons = @($Command.addon_loads)
    Assert-Equal 1 $addons.Count "$Label actual addon load count"
    $directAttestations = @($attestations | Where-Object { [string]$_.role -ceq "direct_parent" })
    Assert-Equal 1 $directAttestations.Count "$Label direct-parent policy-ready count"
    Assert-Equal ([int]$directAttestations[0].pid) ([int]$addons[0].pid) "$Label addon direct-parent PID"
    Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path ([string]$Spec.runtime_snapshot_root) "pnpm\@rollup+rollup-win32-x64-msvc@4.62.4\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node"))) ([System.IO.Path]::GetFullPath([string]$addons[0].path)) "$Label addon canonical path"
    Assert-Equal "ordinary_drive" ([string]$addons[0].path_kind) "$Label addon path kind"
    Assert-Equal 2623488 ([long]$addons[0].length) "$Label addon length"
    Assert-Equal "397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49" ([string]$addons[0].sha256) "$Label addon SHA-256"
    Assert-True ([bool]$addons[0].success) "$Label addon load result"
    $parentPid = [int]$directAttestations[0].pid
    $expectedJournalLeaves = @(
        "policy-ready-$parentPid.json", "policy-ready-$($forkAttestations[0].pid).json", "policy-ready-$($helperAttestation.pid).json",
        "spawn-$($fork.id)-intent.json", "spawn-$($fork.id)-result.json", "spawn-$($helper.id)-intent.json", "spawn-$($helper.id)-result.json",
        "spawn-$($esbuild.id)-intent.json", "spawn-$($esbuild.id)-result.json", "addon-$parentPid-0004-intent.json", "addon-$parentPid-0004-result.json"
    )
    foreach ($leaf in $expectedJournalLeaves) {
        Assert-Equal 1 @($script:Scenario.policy_journal_paths | Where-Object { (Split-Path -Leaf ([string]$_)) -ceq $leaf }).Count "$Label policy journal file: $leaf"
    }
}

function Assert-ExternalGuardReport {
    param($Report, $Fixture, $Scenario, [bool]$ExpectAllDiffsEmpty)
    $guards = @($Report.external_guards)
    Assert-Equal 5 $guards.Count "External guard report count"
    $expectedPaths = @{
        jiti_openclaw_cache_guard = [string]$Fixture.runtime.protected_external_paths.jiti_openclaw_cache_guard
        node_compile_cache_guard = [string]$Fixture.runtime.protected_external_paths.node_compile_cache_guard
        inherited_openclaw_temp_guard = [string]$Fixture.runtime.protected_external_paths.inherited_openclaw_temp_guard
        vitest_b_cache_guard = [string]$Fixture.runtime.protected_external_paths.vitest_b_cache_guard
        vitest_c_cache_guard = [string]$Fixture.runtime.protected_external_paths.vitest_c_cache_guard
    }
    Assert-Equal (Get-OrdinalIgnoreCaseSignature @($expectedPaths.Keys)) (Get-OrdinalIgnoreCaseSignature @($guards | ForEach-Object { [string]$_.guard_id })) "External guard IDs"
    foreach ($guard in $guards) {
        $guardId = [string]$guard.guard_id
        Assert-True ($expectedPaths.ContainsKey($guardId)) "Unexpected external guard ID: $guardId"
        Assert-Equal ([System.IO.Path]::GetFullPath($expectedPaths[$guardId])) ([System.IO.Path]::GetFullPath([string]$guard.path)) "External guard path: $guardId"
        Assert-True ($null -ne $guard.before) "External guard before manifest missing: $guardId"
        Assert-True ($null -ne $guard.after) "External guard after manifest missing: $guardId"
        Assert-True ($null -ne $guard.diff) "External guard diff missing: $guardId"
        Assert-True ($null -eq $guard.PSObject.Properties["cleanup"]) "External guard exposed a cleanup field: $guardId"
        if ($ExpectAllDiffsEmpty) {
            Assert-EmptyDiff $guard.diff "External guard $guardId"
        }
    }
    foreach ($cleanupSpec in @($Scenario.cleanup_specs)) {
        foreach ($path in $expectedPaths.Values) {
            Assert-True (-not ([System.IO.Path]::GetFullPath([string]$cleanupSpec.path)).Equals([System.IO.Path]::GetFullPath([string]$path), [System.StringComparison]::OrdinalIgnoreCase)) "External guard entered cleanup specs"
        }
    }
}

function Assert-SourceDistReportEmpty {
    param($Report, $Fixture, [string]$Label, [string]$ExpectedIncompleteScope)
    $sourceDist = $Report.manifests.source_dist
    Assert-True ($null -ne $sourceDist) "$Label source dist object missing"
    Assert-True (-not ($sourceDist -is [string])) "$Label source dist was stringified"
    Assert-True (-not ($sourceDist -is [System.Array])) "$Label source dist must be a B/C keyed object, not an array"
    $routeKeys = @($sourceDist.PSObject.Properties | ForEach-Object { [string]$_.Name })
    Assert-Equal 2 $routeKeys.Count "$Label source dist route count"
    Assert-True (($routeKeys -ccontains "B") -and ($routeKeys -ccontains "C")) "$Label source dist route keys must be exact B/C"
    $expectedPaths = @{
        B = Join-Path $Fixture.routes.B "dist"
        C = Join-Path $Fixture.routes.C "dist"
    }
    $observations = New-Object System.Collections.ArrayList
    foreach ($route in @("B", "C")) {
        Assert-True ($null -ne $sourceDist.PSObject.Properties[$route]) "$Label source dist route missing: $route"
        $routeReport = $sourceDist.PSObject.Properties[$route].Value
        Assert-True ($null -ne $routeReport) "$Label source dist route object missing: $route"
        Assert-True (-not ($routeReport -is [System.Array])) "$Label source dist route was an array: $route"
        Assert-Equal ([System.IO.Path]::GetFullPath($expectedPaths[$route])) ([System.IO.Path]::GetFullPath([string]$routeReport.path)) "$Label source dist path: $route"
        Assert-True ($null -ne $routeReport.before) "$Label source dist before missing: $route"
        Assert-True ($null -ne $routeReport.after) "$Label source dist after missing: $route"
        Assert-True (-not [object]::ReferenceEquals($routeReport.before, $routeReport.after)) "$Label source dist after reused before: $route"
        foreach ($phase in @("before", "after")) {
            $observation = $routeReport.$phase
            [void]$observations.Add([pscustomobject]@{ label = "$route/$phase"; value = $observation })
            Assert-True ($null -ne $observation.PSObject.Properties["scope_id"]) "$Label source dist scope field missing: $route/$phase"
            $expectedScope = "source_dist_{0}_{1}" -f $route, $phase
            Assert-Equal $expectedScope ([string]$observation.scope_id) "$Label source dist scope: $route/$phase"
            if ([string]$expectedScope -ceq $ExpectedIncompleteScope) {
                Assert-True ($observation.completed -is [bool] -and -not [bool]$observation.completed) "$Label failed source dist scope was marked completed: $route/$phase"
                Assert-Equal 0 @($observation.entries).Count "$Label failed source dist scope reused entries: $route/$phase"
            }
            else {
                Assert-True ($observation.completed -is [bool] -and [bool]$observation.completed) "$Label source dist scope was not completed: $route/$phase"
            }
            $rootRows = @($observation.roots)
            Assert-Equal 1 $rootRows.Count "$Label source dist root count: $route/$phase"
            Assert-Equal "source_dist_$route" ([string]$rootRows[0].root_id) "$Label source dist root ID: $route/$phase"
            Assert-Equal ([System.IO.Path]::GetFullPath($expectedPaths[$route])) ([System.IO.Path]::GetFullPath([string]$rootRows[0].path)) "$Label source dist root path: $route/$phase"
            Assert-True ($null -ne $observation.PSObject.Properties["entries"]) "$Label source dist entries field missing: $route/$phase"
            Assert-True (-not ($observation.entries -is [string])) "$Label source dist entries were stringified: $route/$phase"
        }
        $diffKeys = @($routeReport.diff.PSObject.Properties | ForEach-Object { $_.Name })
        Assert-Equal "ADDED|DELETED|MODIFIED" (Get-OrdinalIgnoreCaseSignature $diffKeys) "$Label source dist diff keys: $route"
        foreach ($changeName in @("added", "modified", "deleted")) {
            Assert-True (-not ($routeReport.diff.$changeName -is [string])) "$Label source dist diff was stringified: $route/$changeName"
        }
        Assert-EmptyDiff $routeReport.diff "$Label source dist $route"
    }
    for ($left = 0; $left -lt $observations.Count; $left++) {
        for ($right = $left + 1; $right -lt $observations.Count; $right++) {
            Assert-True (-not [object]::ReferenceEquals($observations[$left].value, $observations[$right].value)) "$Label source dist observation reused: $($observations[$left].label)/$($observations[$right].label)"
        }
    }
}

function Assert-ManifestLayerObjectFreshness {
    param($Report, [string]$Label)
    $sourceDist = $Report.manifests.source_dist
    Assert-True ($null -ne $sourceDist.PSObject.Properties["B"] -and $null -ne $sourceDist.PSObject.Properties["C"]) "$Label source dist B/C objects missing"
    Assert-True (-not [object]::ReferenceEquals($sourceDist.B, $sourceDist.C)) "$Label source dist B/C route object reused"
    $objects = @(
        [pscustomobject]@{ label = "official_before"; value = $Report.manifests.official.before },
        [pscustomobject]@{ label = "official_after"; value = $Report.manifests.official.after },
        [pscustomobject]@{ label = "project_before"; value = $Report.manifests.project_business_candidates.before },
        [pscustomobject]@{ label = "project_after"; value = $Report.manifests.project_business_candidates.after },
        [pscustomobject]@{ label = "source_dist_B_before"; value = $sourceDist.B.before },
        [pscustomobject]@{ label = "source_dist_B_after"; value = $sourceDist.B.after },
        [pscustomobject]@{ label = "source_dist_C_before"; value = $sourceDist.C.before },
        [pscustomobject]@{ label = "source_dist_C_after"; value = $sourceDist.C.after }
    )
    foreach ($item in $objects) {
        Assert-True ($null -ne $item.value) "$Label manifest object missing: $($item.label)"
    }
    for ($left = 0; $left -lt $objects.Count; $left++) {
        for ($right = $left + 1; $right -lt $objects.Count; $right++) {
            Assert-True (-not [object]::ReferenceEquals($objects[$left].value, $objects[$right].value)) "$Label manifest object reused: $($objects[$left].label)/$($objects[$right].label)"
        }
    }
}

function Assert-ExactCaseAssertionPaths {
    param($CaseAssertionPaths, [string]$Label)
    Assert-True ($null -ne $CaseAssertionPaths) "$Label case assertion paths missing"
    $keys = @($CaseAssertionPaths.PSObject.Properties | ForEach-Object { [string]$_.Name })
    Assert-Equal 2 $keys.Count "$Label case assertion path case count"
    Assert-True (($keys -ccontains "CASE-STORAGE-004") -and ($keys -ccontains "CASE-FOUNDATION-002")) "$Label case assertion path case keys must be exact"
    $expectedStorage = @(
        "/oracle/path_safety/official_roots_source",
        "/oracle/path_safety/traversal_rejected",
        "/oracle/path_safety/absolute_external_path_rejected",
        "/oracle/path_safety/prefix_collision_rejected",
        "/oracle/path_safety/reparse_point_escape_rejected",
        "/oracle/path_safety/out_of_root_write_count"
    )
    $expectedFoundation = @(
        "/oracle/official_manifest/diff/added",
        "/oracle/official_manifest/diff/modified",
        "/oracle/official_manifest/diff/deleted",
        "/oracle/project_business_candidates/diff/added",
        "/oracle/project_business_candidates/diff/modified",
        "/oracle/project_business_candidates/diff/deleted",
        "/oracle/failure_path/after_manifest_generated",
        "/oracle/environment/restored",
        "/oracle/openclaw_state/pre_delete_audit",
        "/oracle/temporary_roots/residual_count",
        "/oracle/source_dist/diff"
    )
    $actualStorage = @($CaseAssertionPaths.PSObject.Properties["CASE-STORAGE-004"].Value)
    $actualFoundation = @($CaseAssertionPaths.PSObject.Properties["CASE-FOUNDATION-002"].Value)
    Assert-Equal 6 $actualStorage.Count "$Label CASE-STORAGE-004 path count"
    Assert-Equal 11 $actualFoundation.Count "$Label CASE-FOUNDATION-002 path count"
    Assert-True (($expectedStorage -join "|") -ceq (@($actualStorage | ForEach-Object { [string]$_ }) -join "|")) "$Label CASE-STORAGE-004 exact paths"
    Assert-True (($expectedFoundation -join "|") -ceq (@($actualFoundation | ForEach-Object { [string]$_ }) -join "|")) "$Label CASE-FOUNDATION-002 exact paths"
}

function Assert-ManifestEntriesRoundTrip {
    param($MemoryEntries, $DiskEntries, [string]$Label)

    Assert-True (-not ($DiskEntries -is [string])) "$Label disk entries were stringified"
    $memoryItems = @($MemoryEntries)
    $diskItems = @($DiskEntries)
    Assert-Equal $memoryItems.Count $diskItems.Count "$Label disk entry count"
    foreach ($memoryEntry in $memoryItems) {
        $diskMatches = @($diskItems | Where-Object { ([string]$_.full_path).Equals([string]$memoryEntry.full_path, [System.StringComparison]::OrdinalIgnoreCase) })
        Assert-Equal 1 $diskMatches.Count "$Label disk entry path: $($memoryEntry.full_path)"
        $diskEntry = $diskMatches[0]
        foreach ($field in @("full_path", "relative_path", "root_labels", "length", "sha256", "last_write_time_utc", "classification", "candidate_kind")) {
            Assert-True ($null -ne $diskEntry.PSObject.Properties[$field]) "$Label disk entry field missing: $field/$($memoryEntry.full_path)"
        }
        foreach ($field in @("full_path", "relative_path", "sha256", "last_write_time_utc", "classification")) {
            Assert-Equal ([string]$memoryEntry.$field) ([string]$diskEntry.$field) "$Label disk entry value: $field/$($memoryEntry.full_path)"
        }
        Assert-True (-not ($diskEntry.length -is [string])) "$Label disk entry length was stringified: $($memoryEntry.full_path)"
        Assert-Equal ([long]$memoryEntry.length) ([long]$diskEntry.length) "$Label disk entry length: $($memoryEntry.full_path)"
        if ($null -eq $memoryEntry.candidate_kind) {
            Assert-Null $diskEntry.candidate_kind "$Label disk entry candidate kind: $($memoryEntry.full_path)"
        }
        else {
            Assert-Equal ([string]$memoryEntry.candidate_kind) ([string]$diskEntry.candidate_kind) "$Label disk entry candidate kind: $($memoryEntry.full_path)"
        }
        Assert-True (-not ($diskEntry.root_labels -is [string])) "$Label disk root labels were stringified: $($memoryEntry.full_path)"
        Assert-Equal (@($memoryEntry.root_labels) -join "|") (@($diskEntry.root_labels) -join "|") "$Label disk root labels: $($memoryEntry.full_path)"
    }
}

function Assert-EnvironmentReadOnlyAudit {
    param($Report, $Scenario, [bool]$Verified)
    Assert-Equal 2 @($Scenario.environment_specs).Count "Environment snapshot request count"
    foreach ($request in @($Scenario.environment_specs)) {
        Assert-Equal "snapshot" ([string]$request.operation) "Environment adapter operation"
        Assert-Equal "process" ([string]$request.scope) "Environment adapter scope"
    }
    Assert-True (-not [bool]$Report.environment.mutation_attempted) "Caller environment mutation was attempted"
    if ($Verified) {
        Assert-Equal "verified" ([string]$Report.environment.verification_status) "Environment verification status"
        Assert-True ([bool]$Report.environment.caller_unchanged) "Caller environment changed"
        Assert-True ([bool]$Report.environment.restored) "Compatibility restored field"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$Report.environment.before_fingerprint)) "Environment before fingerprint missing"
        Assert-Equal ([string]$Report.environment.before_fingerprint) ([string]$Report.environment.after_fingerprint) "Environment fingerprints"
    }
    else {
        Assert-Equal "failed" ([string]$Report.environment.verification_status) "Failed environment verification status"
        Assert-Null $Report.environment.caller_unchanged "Failed caller_unchanged"
        Assert-Null $Report.environment.restored "Failed restored"
    }
}

function Assert-OpenClawAuditEntries {
    param(
        $Report,
        $Scenario,
        [object[]]$Expected,
        [bool]$AssertProviderAuthority = $false,
        [int]$MinimumCreationStageCount = 1,
        [bool]$AssertInternalCleanupSucceeded = $true
    )
    $audit = $Report.openclaw_state.pre_delete_audit
    $auditKeys = @($audit.PSObject.Properties | ForEach-Object { [string]$_.Name })
    $expectedAuditKeys = @("completed", "entries", "business_entries", "internal_state_entries", "other_entries", "business_candidate_count", "openclaw_internal_tool_state_count", "other_count", "error_type", "error_text")
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedAuditKeys) (Get-OrdinalIgnoreCaseSignature $auditKeys) "OpenClaw pre-delete audit exact keys"
    Assert-True ([bool]$audit.completed) "OpenClaw pre-delete audit was not completed"
    Assert-Null $audit.error_type "Completed OpenClaw audit error type"
    Assert-Null $audit.error_text "Completed OpenClaw audit error text"
    $entries = @($audit.entries)
    Assert-True (-not ($audit.entries -is [string])) "OpenClaw all-files entries were stringified"
    Assert-Equal $Expected.Count $entries.Count "OpenClaw audit entry count"
    $expectedBusiness = @($Expected | Where-Object { $_.classification -eq "business_candidate" }).Count
    $expectedInternal = @($Expected | Where-Object { $_.classification -eq "openclaw_internal_tool_state" }).Count
    $expectedOther = @($Expected | Where-Object { $_.classification -eq "other" }).Count
    Assert-Equal $expectedBusiness ([int]$audit.business_candidate_count) "OpenClaw business candidate count"
    Assert-Equal $expectedInternal ([int]$audit.openclaw_internal_tool_state_count) "OpenClaw internal tool state count"
    Assert-Equal $expectedOther ([int]$audit.other_count) "OpenClaw other count"
    $groups = @(
        [pscustomobject]@{ property = "business_entries"; classification = "business_candidate"; expected_count = $expectedBusiness },
        [pscustomobject]@{ property = "internal_state_entries"; classification = "openclaw_internal_tool_state"; expected_count = $expectedInternal },
        [pscustomobject]@{ property = "other_entries"; classification = "other"; expected_count = $expectedOther }
    )
    $groupedPaths = New-Object System.Collections.ArrayList
    foreach ($group in $groups) {
        $groupEntries = @($audit.PSObject.Properties[$group.property].Value)
        Assert-True (-not ($audit.PSObject.Properties[$group.property].Value -is [string])) "OpenClaw group was stringified: $($group.property)"
        Assert-Equal ([int]$group.expected_count) $groupEntries.Count "OpenClaw group count: $($group.property)"
        foreach ($groupEntry in $groupEntries) {
            Assert-Equal ([string]$group.classification) ([string]$groupEntry.classification) "OpenClaw group classification: $($group.property)/$($groupEntry.relative_path)"
            $groupFullPath = [System.IO.Path]::GetFullPath([string]$groupEntry.full_path)
            [void]$groupedPaths.Add($groupFullPath)
            $masterMatches = @($entries | Where-Object { ([System.IO.Path]::GetFullPath([string]$_.full_path)).Equals($groupFullPath, [System.StringComparison]::OrdinalIgnoreCase) })
            Assert-Equal 1 $masterMatches.Count "OpenClaw grouped entry master mapping: $($group.property)/$($groupEntry.relative_path)"
            foreach ($masterProperty in @($masterMatches[0].PSObject.Properties)) {
                Assert-True ($null -ne $groupEntry.PSObject.Properties[[string]$masterProperty.Name]) "OpenClaw grouped entry omitted master field: $($group.property)/$($groupEntry.relative_path)/$($masterProperty.Name)"
                $masterValue = [string]($masterProperty.Value | ConvertTo-Json -Depth 32 -Compress)
                $groupValue = [string]($groupEntry.PSObject.Properties[[string]$masterProperty.Name].Value | ConvertTo-Json -Depth 32 -Compress)
                Assert-Equal $masterValue $groupValue "OpenClaw grouped entry changed master field: $($group.property)/$($groupEntry.relative_path)/$($masterProperty.Name)"
            }
        }
    }
    $entryPaths = @($entries | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.full_path) })
    Assert-Equal $entries.Count @($entryPaths | Sort-Object -Unique).Count "OpenClaw all-files entries were not path-unique"
    Assert-Equal $entries.Count @($groupedPaths).Count "OpenClaw classification groups were not complete"
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $entryPaths) (Get-OrdinalIgnoreCaseSignature @($groupedPaths)) "OpenClaw classification groups did not partition all files"
    foreach ($item in $Expected) {
        $matches = @($entries | Where-Object { ([string]$_.relative_path).Replace("/", "\").Equals([string]$item.relative_path, [System.StringComparison]::OrdinalIgnoreCase) })
        Assert-Equal 1 $matches.Count "OpenClaw audit relative path: $($item.relative_path)"
        Assert-Equal ([string]$item.classification) ([string]$matches[0].classification) "OpenClaw classification: $($item.relative_path)"
        Assert-Equal ([string]$item.sha256) ([string]$matches[0].sha256) "OpenClaw SHA-256: $($item.relative_path)"
        if ($null -ne $item.PSObject.Properties["length"]) {
            Assert-Equal ([long]$item.length) ([long]$matches[0].length) "OpenClaw length: $($item.relative_path)"
        }
        if ($null -ne $item.PSObject.Properties["last_write_time_utc"]) {
            Assert-Equal ([datetime]$item.last_write_time_utc).ToUniversalTime().ToString("o") ([datetime]$matches[0].last_write_time_utc).ToUniversalTime().ToString("o") "OpenClaw mtime: $($item.relative_path)"
        }
        if ($null -ne $item.PSObject.Properties["creation_stage"]) {
            Assert-Equal ([string]$item.creation_stage) ([string]$matches[0].creation_stage) "OpenClaw creation stage: $($item.relative_path)"
        }
        $expectedFullPath = [System.IO.Path]::GetFullPath((Join-Path ([string]$Scenario.allowed_run_roots.openclaw_state_root) ([string]$item.relative_path)))
        $actualFullPath = [System.IO.Path]::GetFullPath([string]$matches[0].full_path)
        Assert-Equal $expectedFullPath $actualFullPath "OpenClaw full path: $($item.relative_path)"
    }
    $actualCreationStages = @($entries | ForEach-Object { [string]$_.creation_stage } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
    Assert-True ($actualCreationStages.Count -ge $MinimumCreationStageCount) "OpenClaw distinct creation stage count; expected at least $MinimumCreationStageCount actual $($actualCreationStages.Count)"
    if ($AssertInternalCleanupSucceeded) {
        foreach ($internalEntry in @($audit.internal_state_entries)) {
            Assert-True ($null -ne $internalEntry.PSObject.Properties["cleanup_result"]) "OpenClaw internal cleanup result missing: $($internalEntry.relative_path)"
            $cleanupResult = $internalEntry.cleanup_result
            $cleanupKeys = @($cleanupResult.PSObject.Properties | ForEach-Object { [string]$_.Name })
            Assert-Equal (Get-OrdinalIgnoreCaseSignature @("attempted", "succeeded", "residual_count", "error_type", "error_text")) (Get-OrdinalIgnoreCaseSignature $cleanupKeys) "OpenClaw internal cleanup result exact keys: $($internalEntry.relative_path)"
            Assert-True ($cleanupResult.attempted -is [bool] -and [bool]$cleanupResult.attempted) "OpenClaw internal cleanup was not attempted: $($internalEntry.relative_path)"
            Assert-True ($cleanupResult.succeeded -is [bool] -and [bool]$cleanupResult.succeeded) "OpenClaw internal cleanup did not succeed: $($internalEntry.relative_path)"
            Assert-Equal 0 ([int]$cleanupResult.residual_count) "OpenClaw internal cleanup residual: $($internalEntry.relative_path)"
            Assert-Null $cleanupResult.error_type "OpenClaw internal cleanup error type: $($internalEntry.relative_path)"
            Assert-Null $cleanupResult.error_text "OpenClaw internal cleanup error text: $($internalEntry.relative_path)"
            Assert-True (-not (Test-Path -LiteralPath ([string]$internalEntry.full_path))) "OpenClaw internal file remained after cleanup: $($internalEntry.relative_path)"
        }
    }

    if ($AssertProviderAuthority) {
        $auditRequests = @($Scenario.manifest_requests | Where-Object { [string]$_.scope_id -ceq "openclaw_pre_delete_audit" })
        Assert-Equal 1 $auditRequests.Count "OpenClaw authoritative pre-delete provider call count"
        Assert-True ($auditRequests[0].all_files -is [bool] -and [bool]$auditRequests[0].all_files) "OpenClaw authoritative pre-delete request all_files"
        $requestRoots = @($auditRequests[0].roots)
        Assert-Equal 1 $requestRoots.Count "OpenClaw authoritative pre-delete request root count"
        Assert-Equal "openclaw_state_root" ([string]$requestRoots[0].root_id) "OpenClaw authoritative pre-delete request root ID"
        Assert-Equal ([System.IO.Path]::GetFullPath([string]$Scenario.allowed_run_roots.openclaw_state_root)) ([System.IO.Path]::GetFullPath([string]$requestRoots[0].path)) "OpenClaw authoritative pre-delete request root path"
    }
    $openclawRows = @($Report.temporary_roots | Where-Object { [string]$_.root_id -ceq "openclaw_state_root" })
    Assert-Equal 1 $openclawRows.Count "OpenClaw temporary root row count"
    $summary = $openclawRows[0].pre_delete_audit
    $summaryKeys = @($summary.PSObject.Properties | ForEach-Object { [string]$_.Name })
    Assert-Equal (Get-OrdinalIgnoreCaseSignature @("completed", "audit_ref", "business_candidate_count", "openclaw_internal_tool_state_count", "other_count")) (Get-OrdinalIgnoreCaseSignature $summaryKeys) "OpenClaw temporary audit summary exact keys"
    Assert-True (-not [object]::ReferenceEquals($audit, $summary)) "OpenClaw temporary audit summary reused authoritative object"
    Assert-True ($summary.completed -is [bool] -and [bool]$summary.completed) "OpenClaw temporary audit summary completion"
    Assert-Equal "/openclaw_state/pre_delete_audit" ([string]$summary.audit_ref) "OpenClaw temporary audit summary reference"
    Assert-Equal $expectedBusiness ([int]$summary.business_candidate_count) "OpenClaw temporary audit summary business count"
    Assert-Equal $expectedInternal ([int]$summary.openclaw_internal_tool_state_count) "OpenClaw temporary audit summary internal count"
    Assert-Equal $expectedOther ([int]$summary.other_count) "OpenClaw temporary audit summary other count"
    Assert-Equal $expectedBusiness ([int]$Report.business_impact.openclaw_business_candidate_count) "OpenClaw business impact count"
    $ordinaryTemporaryBusiness = 0
    foreach ($temporaryRow in @($Report.temporary_roots | Where-Object { [string]$_.root_id -cne "openclaw_state_root" })) {
        $ordinaryTemporaryBusiness += [int]$temporaryRow.pre_delete_audit.business_candidate_count
    }
    Assert-Equal ($ordinaryTemporaryBusiness + $expectedBusiness) ([int]$Report.business_impact.temporary_business_candidate_count) "OpenClaw total temporary business count"
}

function New-TestCleanRoomPolicy {
    param([string]$Root, [bool]$Plugin)
    $cleanRoomHome = Join-Path $Root "home"
    $appData = Join-Path $Root "appdata"
    $localAppData = Join-Path $Root "localappdata"
    foreach ($path in @($Root, $cleanRoomHome, $appData, $localAppData)) { New-Directory $path }
    $drive = [System.IO.Path]::GetPathRoot($cleanRoomHome).TrimEnd("\")
    $homePath = $cleanRoomHome.Substring([System.IO.Path]::GetPathRoot($cleanRoomHome).Length - 1)
    $values = [ordered]@{
        APPDATA = $appData
        ComSpec = "C:\Windows\System32\cmd.exe"
        HOME = $cleanRoomHome
        HOMEDRIVE = $drive
        HOMEPATH = $homePath
        LOCALAPPDATA = $localAppData
        NODE_DISABLE_COMPILE_CACHE = "1"
        NUMBER_OF_PROCESSORS = "1"
        OS = "Windows_NT"
        PATH = "C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0"
        PATHEXT = ".COM;.EXE;.BAT;.CMD"
        PROCESSOR_ARCHITECTURE = "AMD64"
        SystemRoot = "C:\Windows"
        TEMP = $Root
        TMP = $Root
        TMPDIR = $Root
        USERNAME = "fixture-user"
        USERPROFILE = $cleanRoomHome
        WINDIR = "C:\Windows"
    }
    if ($Plugin) {
        $values["JITI_FS_CACHE"] = "false"
        $values["OPENCLAW_CONFIG_PATH"] = Join-Path $Root "openclaw.json"
        $values["OPENCLAW_HOME"] = $Root
        $values["OPENCLAW_STATE_DIR"] = $Root
    }
    $entries = New-Object System.Collections.ArrayList
    foreach ($name in $values.Keys) {
        [void]$entries.Add([pscustomobject]@{ name = [string]$name; value = [string]$values[$name]; source = "test_clean_room" })
    }
    return [pscustomobject]@{ inherit_environment = $false; exact_key_values = @($entries) }
}

function Get-ProcessEnvironmentState {
    param([string[]]$Names)
    $state = @{}
    foreach ($name in $Names) {
        $state[$name] = [pscustomobject]@{
            existed = $null -ne [Environment]::GetEnvironmentVariable($name, "Process")
            value = [Environment]::GetEnvironmentVariable($name, "Process")
        }
    }
    return $state
}

function Restore-ProcessEnvironmentState {
    param($State)
    foreach ($name in $State.Keys) {
        if ($State[$name].existed) {
            [Environment]::SetEnvironmentVariable([string]$name, [string]$State[$name].value, "Process")
        }
        else {
            [Environment]::SetEnvironmentVariable([string]$name, $null, "Process")
        }
    }
}

function Assert-ProcessEnvironmentStateEqual {
    param($Expected, [string[]]$Names, [string]$Label)
    foreach ($name in $Names) {
        $actualExists = $null -ne [Environment]::GetEnvironmentVariable($name, "Process")
        $actualValue = [Environment]::GetEnvironmentVariable($name, "Process")
        Assert-Equal ([bool]$Expected[$name].existed) $actualExists "$Label existence for $name"
        Assert-Equal ([string]$Expected[$name].value) ([string]$actualValue) "$Label value for $name"
    }
}

function Set-PoisonEnvironment {
    param([string[]]$Names, [string]$Root)
    foreach ($name in $Names) {
        $value = Join-Path $Root ([string]$name).ToLowerInvariant()
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function New-ProcessSpec {
    param([string]$Id, [string]$ScriptPath, [string[]]$Arguments)
    return [pscustomobject]@{
        id = $Id
        route = "TEST"
        stage = "process_test"
        cwd = Split-Path -Parent $ScriptPath
        executable = $powershellPath
        arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ScriptPath) + @($Arguments)
        environment_policy = New-TestCleanRoomPolicy (Join-Path (Split-Path -Parent $ScriptPath) "process-env") $false
    }
}

function Invoke-CleanRoomEnvironmentEchoTest {
    param($SourceSpec, $Fixture, [bool]$Plugin)
    $echoSpec = [pscustomobject]@{
        id = "environment.echo"
        route = "TEST"
        stage = "environment_echo"
        cwd = $Fixture.base
        executable = "C:\Windows\System32\cmd.exe"
        arguments = @("/d", "/c", "set")
        environment_policy = $SourceSpec.environment_policy
    }
    $result = Invoke-FoundationProcessCommand -CommandSpec $echoSpec -TimeoutMs 10000
    Assert-Equal 0 $result.exit_code "Environment echo exit"
    Assert-True (-not [bool]$result.timed_out) "Environment echo timed out"
    $actualNames = New-Object System.Collections.ArrayList
    $actualValues = @{}
    foreach ($line in @($result.stdout -split "`r?`n")) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=') {
            [void]$actualNames.Add($Matches[1])
            $separator = $line.IndexOf("=")
            $actualValues[$Matches[1]] = $line.Substring($separator + 1)
        }
    }
    $expectedNames = if ($Plugin) { $pluginCleanRoomNames } else { $commonCleanRoomNames }
    $unexpectedEchoNames = @($actualNames | Where-Object { $expectedNames -notcontains [string]$_ })
    Assert-Equal 1 $unexpectedEchoNames.Count "cmd.exe synthesized environment key count"
    Assert-Equal "PROMPT" (Get-OrdinalIgnoreCaseSignature $unexpectedEchoNames) "cmd.exe synthesized environment key"
    Assert-Equal '$P$G' ([string]$actualValues["PROMPT"]) "cmd.exe synthesized PROMPT value"
    $policyEchoNames = @($actualNames | Where-Object { $expectedNames -contains [string]$_ })
    Assert-Equal $expectedNames.Count $policyEchoNames.Count "Echoed clean-room policy key count"
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedNames) (Get-OrdinalIgnoreCaseSignature $policyEchoNames) "Echoed clean-room exact policy keyset"
    Assert-Equal $expectedNames.Count @($result.environment_key_names).Count "Process result environment key count"
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedNames) (Get-OrdinalIgnoreCaseSignature @($result.environment_key_names)) "Process result exact environment keyset"
    Assert-Equal (Get-OrdinalIgnoreCaseSignature $policyEchoNames) (Get-OrdinalIgnoreCaseSignature @($result.environment_key_names)) "Process result environment key names versus filtered child echo"
    $sourceEnvironmentEntries = @(Get-TestSpecParentEnvironmentEntries $SourceSpec)
    foreach ($entry in $sourceEnvironmentEntries) {
        Assert-True ($actualValues.ContainsKey([string]$entry.name)) "Child echo omitted configured key: $($entry.name)"
        Assert-Equal ([string]$entry.value) ([string]$actualValues[[string]$entry.name]) "Child echo configured value: $($entry.name)"
    }
    $expectedSources = @($sourceEnvironmentEntries | ForEach-Object { [string]$_.source })
    Assert-Equal $expectedSources.Count @($result.environment_value_sources).Count "Process result environment value source count"
    Assert-Equal (@($expectedSources) -join "|") (@($result.environment_value_sources) -join "|") "Process result environment value sources"
}

function Stop-TestProcessTreeByExactId {
    param([int]$ProcessId)
    if ($ProcessId -le 0 -or $null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "C:\Windows\System32\taskkill.exe"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.Arguments = "/PID $ProcessId /T /F"
    $process = $null
    try {
        $process = [System.Diagnostics.Process]::Start($psi)
        if (-not $process.WaitForExit(5000)) {
            $process.Kill()
            [void]$process.WaitForExit(1000)
        }
    }
    finally {
        if ($null -ne $process) { $process.Dispose() }
    }
}

function Invoke-TerminationErrorMappingVariant {
    $variantFixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempState = Get-ProcessEnvironmentState $tempNames
    try {
        $variantFixture = New-TestFixture
        foreach ($name in $tempNames) { [Environment]::SetEnvironmentVariable($name, $variantFixture.base, "Process") }
        $variantScenario = New-ScenarioState "RED-PROCESS-003-global-error-map" $variantFixture
        $mappingRunner = {
            param($Spec)
            $result = & $fakeCommandRunner $Spec
            if ([string]$Spec.id -ceq "A.structure") {
                $result.status = "failed"
                $result.exit_code = 124
                $result.stderr = "injected process timeout with taskkill exit 5"
                $result.exception_type = "PROCESS_TIMEOUT"
                $result.exception_text = "injected process timeout"
                $result.error_code = "PROCESS_TIMEOUT"
                $result.stream_capture = [pscustomobject]@{ stdout_completed = $false; stderr_completed = $false; deadline_exceeded = $true }
                $result.taskkill = [pscustomobject]@{
                    attempted = $true
                    path = "C:\Windows\System32\taskkill.exe"
                    arguments = @("/PID", "42420", "/T", "/F")
                    exit_code = 5
                    timed_out = $false
                    stdout = ""
                    stderr = "injected taskkill nonzero"
                    error_type = "NativeCommandExitCode"
                    error_text = "taskkill exit code 5; injected taskkill nonzero"
                }
                $result.termination_errors = @(
                    [pscustomobject]@{ category = "termination"; error_code = "PROCESS_TERMINATION_COMMAND_FAILED"; error_type = "NativeCommandExitCode"; error_text = "taskkill exit code 5; injected taskkill nonzero" },
                    [pscustomobject]@{ category = "termination"; error_code = "PROCESS_EXIT_GRACE_EXCEEDED"; error_type = "System.TimeoutException"; error_text = "parent exit grace exceeded 5000ms" },
                    [pscustomobject]@{ category = "termination"; error_code = "PROCESS_STREAM_DRAIN_TIMEOUT"; error_type = "System.TimeoutException"; error_text = "stream drain exceeded 5000ms" }
                )
            }
            return $result
        }
        $variantReport = Invoke-CoreForScenario $variantFixture $variantScenario $null $null $mappingRunner
        Assert-BasicReport $variantReport
        Assert-Equal "failed" ([string]$variantReport.verdict) "Termination error mapping verdict"
        $command = @($variantReport.commands | Where-Object { [string]$_.id -ceq "A.structure" })[0]
        Assert-True ($null -ne $command) "Termination error mapping command missing"
        Assert-Equal "PROCESS_TIMEOUT" ([string]$command.error_code) "Termination error mapping primary command code"
        $localErrors = @($command.termination_errors)
        Assert-Equal 3 $localErrors.Count "Termination error mapping local count"
        Assert-Equal "PROCESS_TERMINATION_COMMAND_FAILED|PROCESS_EXIT_GRACE_EXCEEDED|PROCESS_STREAM_DRAIN_TIMEOUT" (@($localErrors | ForEach-Object { [string]$_.error_code }) -join "|") "Termination error mapping local order"
        $local = $localErrors[0]
        Assert-Equal (Get-OrdinalIgnoreCaseSignature @("category", "error_code", "error_type", "error_text")) (Get-OrdinalIgnoreCaseSignature @($local.PSObject.Properties.Name)) "Termination error mapping local exact keys"
        Assert-Equal "termination" ([string]$local.category) "Termination error mapping local category"
        Assert-Equal "PROCESS_TERMINATION_COMMAND_FAILED" ([string]$local.error_code) "Termination error mapping local code"
        Assert-Equal "NativeCommandExitCode" ([string]$local.error_type) "Termination error mapping local type"
        Assert-Equal "taskkill exit code 5; injected taskkill nonzero" ([string]$local.error_text) "Termination error mapping local text"
        for ($localIndex = 0; $localIndex -lt $localErrors.Count; $localIndex++) {
            Assert-ExactPropertySet $localErrors[$localIndex] @("category", "error_code", "error_type", "error_text") "Termination error mapping local $localIndex"
            Assert-Equal "termination" ([string]$localErrors[$localIndex].category) "Termination error mapping local category $localIndex"
            $expectedLocalType = if ($localIndex -eq 0) { "NativeCommandExitCode" } else { "System.TimeoutException" }
            Assert-Equal $expectedLocalType ([string]$localErrors[$localIndex].error_type) "Termination error mapping local type $localIndex"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$localErrors[$localIndex].error_text)) "Termination error mapping local text $localIndex"
        }
        Assert-True (-not [bool]$command.stream_capture.stdout_completed) "Termination error mapping stdout unexpectedly completed"
        Assert-True (-not [bool]$command.stream_capture.stderr_completed) "Termination error mapping stderr unexpectedly completed"
        Assert-True ([bool]$command.stream_capture.deadline_exceeded) "Termination error mapping stream deadline"
        $globalErrors = @($variantReport.errors | Where-Object { [string]$_.category -ceq "termination" })
        Assert-Equal $localErrors.Count $globalErrors.Count "Termination error mapping global count"
        for ($index = 0; $index -lt $localErrors.Count; $index++) {
            Assert-ExactPropertySet $globalErrors[$index] @("code", "category", "command_id", "error_type", "message") "Termination error mapping global $index"
            Assert-Equal "A.structure" ([string]$globalErrors[$index].command_id) "Termination error mapping global command ID"
            Assert-Equal ([string]$localErrors[$index].error_code) ([string]$globalErrors[$index].code) "Termination error mapping global code"
            Assert-Equal ([string]$localErrors[$index].error_type) ([string]$globalErrors[$index].error_type) "Termination error mapping global type"
            Assert-Equal ([string]$localErrors[$index].error_text) ([string]$globalErrors[$index].message) "Termination error mapping global text"
        }
        $allErrors = @($variantReport.errors)
        $terminationIndex = [array]::IndexOf($allErrors, $globalErrors[0])
        Assert-True ($terminationIndex -gt 0) "Termination error replaced or preceded the primary command error"
        Assert-Equal 4 @($variantScenario.cleanup_specs).Count "Termination error mapping cleanup count"
        [void](Assert-OfficialObservationPair $variantReport $variantFixture "Termination error mapping variant")
    }
    finally {
        Restore-ProcessEnvironmentState $tempState
        Remove-TestFixture $variantFixture
        $script:Scenario = $null
    }
}

function Invoke-DescendantPipeDeadlineVariant {
    param($Fixture)
    $workerPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "pipe-parent.ps1")
    $childPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "pipe-child.ps1")
    $harnessPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "process-probe-harness.ps1")
    $specPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "process-probe-spec.json")
    $resultPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "process-probe-result.json")
    $errorPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "process-probe-error.txt")
    $childPidPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "pipe-child.pid")
    $childReadyPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "pipe-child.ready")
    $parentReadyPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "pipe-parent.ready")
    $childContent = @'
param([string]$PidPath,[string]$ReadyPath)
[IO.File]::WriteAllText($PidPath,[string]$PID)
[Console]::Out.Write("descendant-stdout-token")
[Console]::Error.Write("descendant-stderr-token")
[IO.File]::WriteAllText($ReadyPath,"ready")
Start-Sleep -Seconds 60
'@
    $workerContent = @'
param([string]$Child,[string]$ChildPid,[string]$ChildReady,[string]$ParentReady)
$p=Start-Process -FilePath "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$Child,$ChildPid,$ChildReady) -NoNewWindow -PassThru
$deadline=[DateTime]::UtcNow.AddSeconds(10)
while(-not [IO.File]::Exists($ChildReady)){
    if([DateTime]::UtcNow -gt $deadline){throw "child readiness timeout"}
    Start-Sleep -Milliseconds 25
}
[IO.File]::WriteAllText($ParentReady,"$PID|$($p.Id)")
exit 0
'@
    $harnessContent = @'
param([string]$Core,[string]$SpecPath,[string]$ResultPath,[string]$ErrorPath)
$ErrorActionPreference="Stop"
$utf8=New-Object Text.UTF8Encoding($false)
try {
    . $Core
    $spec=[IO.File]::ReadAllText($SpecPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
    $helperWatch=[Diagnostics.Stopwatch]::StartNew()
    $result=Invoke-FoundationProcessCommand -CommandSpec $spec -TimeoutMs 1000 -TerminationRunner $null
    $helperWatch.Stop()
    $payload=[pscustomobject]@{helper_elapsed_ms=[long]$helperWatch.ElapsedMilliseconds;result=$result}
    [IO.File]::WriteAllText($ResultPath,($payload|ConvertTo-Json -Depth 16 -Compress),$utf8)
    exit 0
}
catch {
    [IO.File]::WriteAllText($ErrorPath,$_.Exception.ToString(),$utf8)
    exit 91
}
'@
    [System.IO.File]::WriteAllText($childPath, $childContent, $script:Utf8NoBom)
    [System.IO.File]::WriteAllText($workerPath, $workerContent, $script:Utf8NoBom)
    [System.IO.File]::WriteAllText($harnessPath, $harnessContent, $script:Utf8NoBom)
    $spec = New-ProcessSpec "RED-PROCESS-003-descendant-pipe" $workerPath @($childPath, $childPidPath, $childReadyPath, $parentReadyPath)
    [System.IO.File]::WriteAllText($specPath, ($spec | ConvertTo-Json -Depth 12 -Compress), $script:Utf8NoBom)

    $outer = $null
    $sentinel = Start-Process -FilePath $powershellPath -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 60") -WindowStyle Hidden -PassThru
    $recordedPids = New-Object System.Collections.Generic.HashSet[int]
    try {
        $outer = Start-Process -FilePath $powershellPath -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $harnessPath, $corePath, $specPath, $resultPath, $errorPath) -WindowStyle Hidden -PassThru
        [void]$recordedPids.Add([int]$outer.Id)
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        while (-not $outer.HasExited -and $watch.ElapsedMilliseconds -lt 11000) {
            Start-Sleep -Milliseconds 25
            $outer.Refresh()
        }
        $returnedWithinWatchdog = $outer.HasExited
        $watch.Stop()
        if (Test-Path -LiteralPath $parentReadyPath -PathType Leaf) {
            foreach ($pidText in @([System.IO.File]::ReadAllText($parentReadyPath) -split '\|')) {
                if ($pidText -match '^\d+$') { [void]$recordedPids.Add([int]$pidText) }
            }
        }
        if (Test-Path -LiteralPath $childPidPath -PathType Leaf) {
            $pidText = [System.IO.File]::ReadAllText($childPidPath)
            if ($pidText -match '^\d+$') { [void]$recordedPids.Add([int]$pidText) }
        }
        Assert-True $returnedWithinWatchdog "Normal parent-exit stream drain exceeded TimeoutMs+5000ms plus the 5000ms outer watchdog"
        Assert-True ($watch.ElapsedMilliseconds -le 11000) "Normal parent-exit stream watchdog wall clock"
        if ([int]$outer.ExitCode -ne 0) {
            $probeError = if (Test-Path -LiteralPath $errorPath -PathType Leaf) { [System.IO.File]::ReadAllText($errorPath, [System.Text.Encoding]::UTF8) } else { "probe error file missing" }
            throw "Process helper probe failed with exit $([int]$outer.ExitCode): $probeError"
        }
        Assert-True (-not (Test-Path -LiteralPath $errorPath -PathType Leaf)) "Process helper probe threw before returning"
        Assert-True (Test-Path -LiteralPath $resultPath -PathType Leaf) "Process helper probe result missing"
        $probePayload = [System.IO.File]::ReadAllText($resultPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        Assert-True ([long]$probePayload.helper_elapsed_ms -le 6500) "Normal parent-exit helper exceeded TimeoutMs+5000ms plus 500ms scheduling tolerance"
        $result = $probePayload.result
        Assert-True (-not [bool]$result.timed_out) "Normal parent exit was misreported as a main timeout"
        Assert-Equal "failed" ([string]$result.status) "Descendant pipe status"
        Assert-Equal "PROCESS_STREAM_DRAIN_TIMEOUT" ([string]$result.error_code) "Descendant pipe primary error"
        Assert-Equal "PROCESS_STREAM_DRAIN_TIMEOUT" ([string]$result.exception_type) "Descendant pipe exception type"
        Assert-True ([string]$result.stdout -match "descendant-stdout-token") "Descendant pipe partial stdout missing"
        Assert-True ([string]$result.stderr -match "descendant-stderr-token") "Descendant pipe partial stderr missing"
        Assert-True ($null -ne $result.stream_capture) "Descendant pipe stream capture missing"
        Assert-ExactPropertySet $result.stream_capture @("stdout_completed", "stderr_completed", "deadline_exceeded") "Descendant pipe stream capture"
        Assert-True (-not [bool]$result.stream_capture.stdout_completed) "Descendant pipe stdout incorrectly complete"
        Assert-True (-not [bool]$result.stream_capture.stderr_completed) "Descendant pipe stderr incorrectly complete"
        Assert-True ([bool]$result.stream_capture.deadline_exceeded) "Descendant pipe stream deadline flag missing"
        Assert-True ($null -ne $result.taskkill) "Descendant pipe taskkill shape missing"
        Assert-ExactPropertySet $result.taskkill @("attempted", "path", "arguments", "exit_code", "timed_out", "stdout", "stderr", "error_type", "error_text") "Descendant pipe taskkill"
        Assert-True (-not [bool]$result.taskkill.attempted) "Descendant pipe attempted taskkill after the parent exited"
        Assert-Null $result.taskkill.path "Descendant pipe taskkill path"
        Assert-Equal 0 @($result.taskkill.arguments).Count "Descendant pipe taskkill arguments"
        Assert-Null $result.taskkill.exit_code "Descendant pipe taskkill exit code"
        Assert-True (-not [bool]$result.taskkill.timed_out) "Descendant pipe taskkill timeout flag"
        Assert-Null $result.taskkill.stdout "Descendant pipe taskkill stdout"
        Assert-Null $result.taskkill.stderr "Descendant pipe taskkill stderr"
        Assert-Null $result.taskkill.error_type "Descendant pipe taskkill error type"
        Assert-Null $result.taskkill.error_text "Descendant pipe taskkill error text"
        $terminationErrors = @($result.termination_errors)
        Assert-Equal 1 $terminationErrors.Count "Descendant pipe termination error count"
        $termination = $terminationErrors[0]
        Assert-Equal (Get-OrdinalIgnoreCaseSignature @("category", "error_code", "error_type", "error_text")) (Get-OrdinalIgnoreCaseSignature @($termination.PSObject.Properties.Name)) "Descendant pipe termination error exact keys"
        Assert-Equal "termination" ([string]$termination.category) "Descendant pipe termination category"
        Assert-Equal "PROCESS_STREAM_DRAIN_TIMEOUT" ([string]$termination.error_code) "Descendant pipe stream termination error"
        Assert-Equal "System.TimeoutException" ([string]$termination.error_type) "Descendant pipe stream termination type"
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$termination.error_text)) "Descendant pipe stream termination text"
        Assert-True ($null -ne (Get-Process -Id $sentinel.Id -ErrorAction SilentlyContinue)) "Descendant pipe probe terminated the unrelated sentinel"
    }
    finally {
        foreach ($recordedPid in @($recordedPids)) {
            if ($recordedPid -ne $sentinel.Id) { Stop-TestProcessTreeByExactId $recordedPid }
        }
        if ($null -ne (Get-Process -Id $sentinel.Id -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $sentinel.Id -Force -ErrorAction SilentlyContinue
        }
        if ($null -ne $outer) { $outer.Dispose() }
    }
}

function Invoke-TerminationRunnerFailureVariant {
    param($Fixture, [string]$Mode)
    Assert-True ($Mode -in @("nonzero", "timeout")) "Unknown termination runner variant: $Mode"
    $workerPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "termination-$Mode-parent.ps1")
    $harnessPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "termination-$Mode-harness.ps1")
    $specPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "termination-$Mode-spec.json")
    $resultPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "termination-$Mode-result.json")
    $errorPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "termination-$Mode-error.txt")
    $requestPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "termination-$Mode-request.json")
    $readyPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "termination-$Mode-parent.ready")
    $workerContent = @'
param([string]$ReadyPath)
[IO.File]::WriteAllText($ReadyPath,[string]$PID)
[Console]::Out.Write("termination-stdout-token")
[Console]::Error.Write("termination-stderr-token")
Start-Sleep -Seconds 60
'@
    $harnessContent = @'
param([string]$Core,[string]$SpecPath,[string]$ResultPath,[string]$ErrorPath,[string]$RequestPath,[string]$Mode)
$ErrorActionPreference="Stop"
$utf8=New-Object Text.UTF8Encoding($false)
try {
    . $Core
    $spec=[IO.File]::ReadAllText($SpecPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
    $runner={
        param($Request)
        [IO.File]::WriteAllText($RequestPath,($Request|ConvertTo-Json -Depth 8 -Compress),$utf8)
        if($Mode -eq "nonzero"){
            return [pscustomobject]@{attempted=$true;path=[string]$Request.path;arguments=@($Request.arguments);exit_code=5;timed_out=$false;stdout="";stderr="injected taskkill nonzero";error_type="NativeCommandExitCode";error_text="taskkill exit code 5; injected taskkill nonzero"}
        }
        return [pscustomobject]@{attempted=$true;path=[string]$Request.path;arguments=@($Request.arguments);exit_code=$null;timed_out=$true;stdout="";stderr="";error_type="System.TimeoutException";error_text="taskkill timeout after 5000ms"}
    }.GetNewClosure()
    $helperWatch=[Diagnostics.Stopwatch]::StartNew()
    $result=Invoke-FoundationProcessCommand -CommandSpec $spec -TimeoutMs 1000 -TerminationRunner $runner
    $helperWatch.Stop()
    $payload=[pscustomobject]@{helper_elapsed_ms=[long]$helperWatch.ElapsedMilliseconds;result=$result}
    [IO.File]::WriteAllText($ResultPath,($payload|ConvertTo-Json -Depth 16 -Compress),$utf8)
    exit 0
}
catch {
    [IO.File]::WriteAllText($ErrorPath,$_.Exception.ToString(),$utf8)
    exit 91
}
'@
    [System.IO.File]::WriteAllText($workerPath, $workerContent, $script:Utf8NoBom)
    [System.IO.File]::WriteAllText($harnessPath, $harnessContent, $script:Utf8NoBom)
    $spec = New-ProcessSpec "RED-PROCESS-003-termination-$Mode" $workerPath @($readyPath)
    [System.IO.File]::WriteAllText($specPath, ($spec | ConvertTo-Json -Depth 12 -Compress), $script:Utf8NoBom)

    $outer = $null
    $workerPid = 0
    $sentinel = Start-Process -FilePath $powershellPath -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 60") -WindowStyle Hidden -PassThru
    try {
        $outer = Start-Process -FilePath $powershellPath -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $harnessPath, $corePath, $specPath, $resultPath, $errorPath, $requestPath, $Mode) -WindowStyle Hidden -PassThru
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        while (-not $outer.HasExited -and $watch.ElapsedMilliseconds -lt 21000) {
            Start-Sleep -Milliseconds 25
            $outer.Refresh()
        }
        $returnedWithinWatchdog = $outer.HasExited
        $watch.Stop()
        if (Test-Path -LiteralPath $readyPath -PathType Leaf) {
            $pidText = [System.IO.File]::ReadAllText($readyPath)
            if ($pidText -match '^\d+$') { $workerPid = [int]$pidText }
        }
        Assert-True $returnedWithinWatchdog "Termination runner $Mode exceeded TimeoutMs+15000ms plus outer watchdog"
        if ([int]$outer.ExitCode -ne 0) {
            $probeError = if (Test-Path -LiteralPath $errorPath -PathType Leaf) { [System.IO.File]::ReadAllText($errorPath, [System.Text.Encoding]::UTF8) } else { "probe error file missing" }
            throw "Termination runner $Mode probe failed with exit $([int]$outer.ExitCode): $probeError"
        }
        Assert-True (-not (Test-Path -LiteralPath $errorPath -PathType Leaf)) "Termination runner $Mode probe threw"
        Assert-True (Test-Path -LiteralPath $resultPath -PathType Leaf) "Termination runner $Mode result missing"
        Assert-True (Test-Path -LiteralPath $requestPath -PathType Leaf) "Termination runner $Mode request missing"
        $probePayload = [System.IO.File]::ReadAllText($resultPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        Assert-True ([long]$probePayload.helper_elapsed_ms -le 16500) "Termination runner $Mode helper exceeded TimeoutMs+15000ms plus 500ms scheduling tolerance"
        $result = $probePayload.result
        $terminationRequest = [System.IO.File]::ReadAllText($requestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        Assert-True ([bool]$result.timed_out) "Termination runner $Mode main timeout flag"
        Assert-Equal "failed" ([string]$result.status) "Termination runner $Mode status"
        Assert-Equal "PROCESS_TIMEOUT" ([string]$result.error_code) "Termination runner $Mode primary error"
        Assert-Equal "PROCESS_TIMEOUT" ([string]$result.exception_type) "Termination runner $Mode exception type"
        Assert-Equal "termination-stdout-token" ([string]$result.stdout) "Termination runner $Mode worker stdout token"
        Assert-Equal "termination-stderr-token" ([string]$result.stderr) "Termination runner $Mode worker stderr token"
        Assert-True ($workerPid -gt 0) "Termination runner $Mode worker PID missing"
        Assert-Equal $workerPid ([int]$result.process_id) "Termination runner $Mode process ID"
        Assert-Equal "C:\Windows\System32\taskkill.exe" ([string]$terminationRequest.path) "Termination runner $Mode request path"
        Assert-Equal "/PID|$workerPid|/T|/F" (@($terminationRequest.arguments) -join "|") "Termination runner $Mode request arguments"
        Assert-Equal 5000 ([int]$terminationRequest.timeout_ms) "Termination runner $Mode request timeout"
        Assert-ExactPropertySet $result.taskkill @("attempted", "path", "arguments", "exit_code", "timed_out", "stdout", "stderr", "error_type", "error_text") "Termination runner $Mode taskkill"
        Assert-True ([bool]$result.taskkill.attempted) "Termination runner $Mode taskkill attempted"
        Assert-Equal ([string]$terminationRequest.path) ([string]$result.taskkill.path) "Termination runner $Mode taskkill path"
        Assert-Equal (@($terminationRequest.arguments) -join "|") (@($result.taskkill.arguments) -join "|") "Termination runner $Mode taskkill arguments"
        $expectedCode = if ($Mode -eq "nonzero") { "PROCESS_TERMINATION_COMMAND_FAILED" } else { "PROCESS_TERMINATION_TIMEOUT" }
        if ($Mode -eq "nonzero") {
            Assert-Equal 5 ([int]$result.taskkill.exit_code) "Termination runner nonzero exit"
            Assert-True (-not [bool]$result.taskkill.timed_out) "Termination runner nonzero timed_out"
            Assert-Equal "NativeCommandExitCode" ([string]$result.taskkill.error_type) "Termination runner nonzero error type"
            Assert-Equal "" ([string]$result.taskkill.stdout) "Termination runner nonzero taskkill stdout"
            Assert-Equal "injected taskkill nonzero" ([string]$result.taskkill.stderr) "Termination runner nonzero taskkill stderr"
            Assert-Equal "taskkill exit code 5; injected taskkill nonzero" ([string]$result.taskkill.error_text) "Termination runner nonzero taskkill error text"
        }
        else {
            Assert-Null $result.taskkill.exit_code "Termination runner timeout exit"
            Assert-True ([bool]$result.taskkill.timed_out) "Termination runner timeout flag"
            Assert-Equal "System.TimeoutException" ([string]$result.taskkill.error_type) "Termination runner timeout error type"
            Assert-Equal "" ([string]$result.taskkill.stdout) "Termination runner timeout taskkill stdout"
            Assert-Equal "" ([string]$result.taskkill.stderr) "Termination runner timeout taskkill stderr"
            Assert-Equal "taskkill timeout after 5000ms" ([string]$result.taskkill.error_text) "Termination runner timeout taskkill error text"
        }
        Assert-True ($null -ne $result.stream_capture) "Termination runner $Mode stream capture missing"
        Assert-ExactPropertySet $result.stream_capture @("stdout_completed", "stderr_completed", "deadline_exceeded") "Termination runner $Mode stream capture"
        Assert-True ([bool]$result.stream_capture.stdout_completed) "Termination runner $Mode stdout capture incomplete after Job fallback"
        Assert-True ([bool]$result.stream_capture.stderr_completed) "Termination runner $Mode stderr capture incomplete after Job fallback"
        Assert-True (-not [bool]$result.stream_capture.deadline_exceeded) "Termination runner $Mode stream deadline flag"
        $terminationErrors = @($result.termination_errors)
        $expectedCodes = @($expectedCode, "PROCESS_EXIT_GRACE_EXCEEDED")
        Assert-Equal 2 $terminationErrors.Count "Termination runner $Mode termination error count"
        Assert-Equal ($expectedCodes -join "|") (@($terminationErrors | ForEach-Object { [string]$_.error_code }) -join "|") "Termination runner $Mode termination error order"
        for ($terminationIndex = 0; $terminationIndex -lt $terminationErrors.Count; $terminationIndex++) {
            $termination = $terminationErrors[$terminationIndex]
            Assert-Equal (Get-OrdinalIgnoreCaseSignature @("category", "error_code", "error_type", "error_text")) (Get-OrdinalIgnoreCaseSignature @($termination.PSObject.Properties.Name)) "Termination runner $Mode termination exact keys: $($termination.error_code)"
            Assert-ExactPropertySet $termination @("category", "error_code", "error_type", "error_text") "Termination runner $Mode termination $terminationIndex"
            Assert-Equal "termination" ([string]$termination.category) "Termination runner $Mode termination category: $($termination.error_code)"
            $expectedType = if ([string]$termination.error_code -ceq "PROCESS_TERMINATION_COMMAND_FAILED") { "NativeCommandExitCode" } else { "System.TimeoutException" }
            Assert-Equal $expectedType ([string]$termination.error_type) "Termination runner $Mode termination type: $($termination.error_code)"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$termination.error_text)) "Termination runner $Mode termination text: $($termination.error_code)"
        }
        Assert-Equal ([string]$result.taskkill.error_text) ([string]$terminationErrors[0].error_text) "Termination runner $Mode first termination text equals taskkill error text"
        Assert-True ([string]$terminationErrors[0].error_text -match $(if ($Mode -eq "nonzero") { "exit code 5" } else { "taskkill.*5000" })) "Termination runner $Mode first termination text"
        Assert-True ([string]$terminationErrors[1].error_text -match "(?i)parent.*5000|5000.*parent") "Termination runner $Mode parent grace text"
        Assert-True ($null -eq (Get-Process -Id $workerPid -ErrorAction SilentlyContinue)) "Termination runner $Mode Job fallback left the worker alive"
        Assert-True ($null -ne (Get-Process -Id $sentinel.Id -ErrorAction SilentlyContinue)) "Termination runner $Mode terminated unrelated sentinel"
    }
    finally {
        if ($workerPid -gt 0) { Stop-TestProcessTreeByExactId $workerPid }
        if ($null -ne $outer -and $null -ne (Get-Process -Id $outer.Id -ErrorAction SilentlyContinue)) { Stop-TestProcessTreeByExactId $outer.Id }
        if ($null -ne (Get-Process -Id $sentinel.Id -ErrorAction SilentlyContinue)) { Stop-Process -Id $sentinel.Id -Force -ErrorAction SilentlyContinue }
        if ($null -ne $outer) { $outer.Dispose() }
    }
}

function Invoke-RealProcessTreeTimeoutVariant {
    param($Fixture)

    $childPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "timeout-child.ps1")
    $parentPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "timeout-parent.ps1")
    $harnessPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "timeout-tree-probe.ps1")
    $specPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "timeout-tree-spec.json")
    $resultPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "timeout-tree-result.json")
    $errorPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "timeout-tree-error.txt")
    $pidPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "child.pid")
    $childReadyPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "child.ready")
    $parentReadyPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "parent.ready")
    $stdoutToken = "tree-child-stdout-token"
    $stderrToken = "tree-child-stderr-token"

    $childContent = @'
param([string]$ReadyPath)
[Console]::Out.Write("tree-child-stdout-token")
[Console]::Error.Write("tree-child-stderr-token")
[IO.File]::WriteAllText($ReadyPath,[string]$PID)
Start-Sleep -Seconds 60
'@
    $parentContent = @'
param([string]$Child,[string]$PidPath,[string]$ChildReady,[string]$ParentReady)
$p=Start-Process -FilePath "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$Child,$ChildReady) -NoNewWindow -PassThru
$deadline=[DateTime]::UtcNow.AddSeconds(10)
while(-not [IO.File]::Exists($ChildReady)){
    if([DateTime]::UtcNow -gt $deadline){throw "child readiness timeout"}
    Start-Sleep -Milliseconds 25
}
[IO.File]::WriteAllText($PidPath,[string]$p.Id)
[IO.File]::WriteAllText($ParentReady,"$PID|$($p.Id)")
Start-Sleep -Seconds 60
'@
    $harnessContent = @'
param([string]$Core,[string]$SpecPath,[string]$ResultPath,[string]$ErrorPath)
$ErrorActionPreference="Stop"
$utf8=New-Object Text.UTF8Encoding($false)
try {
    . $Core
    $spec=[IO.File]::ReadAllText($SpecPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
    $helperWatch=[Diagnostics.Stopwatch]::StartNew()
    $result=Invoke-FoundationProcessCommand -CommandSpec $spec -TimeoutMs 5000 -TerminationRunner $null
    $helperWatch.Stop()
    $payload=[pscustomobject]@{helper_elapsed_ms=[long]$helperWatch.ElapsedMilliseconds;result=$result}
    [IO.File]::WriteAllText($ResultPath,($payload|ConvertTo-Json -Depth 16 -Compress),$utf8)
    exit 0
}
catch {
    [IO.File]::WriteAllText($ErrorPath,$_.Exception.ToString(),$utf8)
    exit 91
}
'@
    [System.IO.File]::WriteAllText($childPath, $childContent, $script:Utf8NoBom)
    [System.IO.File]::WriteAllText($parentPath, $parentContent, $script:Utf8NoBom)
    [System.IO.File]::WriteAllText($harnessPath, $harnessContent, $script:Utf8NoBom)
    $spec = New-ProcessSpec "RED-PROCESS-003-real-tree" $parentPath @($childPath, $pidPath, $childReadyPath, $parentReadyPath)
    [System.IO.File]::WriteAllText($specPath, ($spec | ConvertTo-Json -Depth 12 -Compress), $script:Utf8NoBom)

    $outer = $null
    $sentinel = Start-Process -FilePath $powershellPath -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 60") -WindowStyle Hidden -PassThru
    $recordedParentPid = 0
    $recordedChildPid = 0
    try {
        $outer = Start-Process -FilePath $powershellPath -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $harnessPath, $corePath, $specPath, $resultPath, $errorPath) -WindowStyle Hidden -PassThru
        $outerWatch = [System.Diagnostics.Stopwatch]::StartNew()
        while (-not $outer.HasExited -and $outerWatch.ElapsedMilliseconds -lt 25000) {
            Start-Sleep -Milliseconds 25
            $outer.Refresh()
        }
        $returnedWithinWatchdog = $outer.HasExited
        $outerWatch.Stop()
        Assert-True $returnedWithinWatchdog "Real process tree probe exceeded the hard 25000ms watchdog"
        if ([int]$outer.ExitCode -ne 0) {
            $probeError = if (Test-Path -LiteralPath $errorPath -PathType Leaf) { [System.IO.File]::ReadAllText($errorPath, [System.Text.Encoding]::UTF8) } else { "probe error file missing" }
            throw "Real process tree probe failed with exit $([int]$outer.ExitCode): $probeError"
        }
        Assert-True (-not (Test-Path -LiteralPath $errorPath -PathType Leaf)) "Real process tree probe threw"
        Assert-True (Test-Path -LiteralPath $resultPath -PathType Leaf) "Real process tree result missing"
        Assert-True (Test-Path -LiteralPath $childReadyPath -PathType Leaf) "Real process tree child readiness handshake missing"
        Assert-True (Test-Path -LiteralPath $parentReadyPath -PathType Leaf) "Real process tree parent readiness handshake missing"
        Assert-True (Test-Path -LiteralPath $pidPath -PathType Leaf) "Real process tree child PID file missing"

        $probePayload = [System.IO.File]::ReadAllText($resultPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        Assert-True ([long]$probePayload.helper_elapsed_ms -le 20500) "Real process tree helper exceeded TimeoutMs+15000ms plus 500ms scheduling tolerance"
        $result = $probePayload.result
        $recordedParentPid = [int]$result.process_id
        $recordedChildPid = [int]([System.IO.File]::ReadAllText($pidPath))
        $readyParts = @([System.IO.File]::ReadAllText($parentReadyPath) -split '\|')
        Assert-Equal 2 $readyParts.Count "Real process tree parent readiness PID field count"
        Assert-Equal $recordedParentPid ([int]$readyParts[0]) "Real process tree parent readiness PID"
        Assert-Equal $recordedChildPid ([int]$readyParts[1]) "Real process tree child readiness PID"
        Assert-Equal $recordedChildPid ([int]([System.IO.File]::ReadAllText($childReadyPath))) "Real process tree child self-reported PID"
        Assert-True ($recordedParentPid -gt 0 -and $recordedChildPid -gt 0 -and $recordedParentPid -ne $recordedChildPid) "Real process tree PID identities"

        Assert-True ([bool]$result.timed_out) "Real process tree timed-out flag"
        Assert-Equal "failed" ([string]$result.status) "Real process tree status"
        Assert-Equal "PROCESS_TIMEOUT" ([string]$result.error_code) "Real process tree primary error code"
        Assert-Equal "PROCESS_TIMEOUT" ([string]$result.exception_type) "Real process tree exception type"
        Assert-Equal $stdoutToken ([string]$result.stdout) "Real process tree inherited stdout token"
        Assert-Equal $stderrToken ([string]$result.stderr) "Real process tree inherited stderr token"
        Assert-True ($null -eq (Get-Process -Id $recordedChildPid -ErrorAction SilentlyContinue)) "Real process tree child still alive"
        Assert-True ($null -eq (Get-Process -Id $recordedParentPid -ErrorAction SilentlyContinue)) "Real process tree parent still alive"
        Assert-True ($null -ne (Get-Process -Id $sentinel.Id -ErrorAction SilentlyContinue)) "Real process tree terminated unrelated sentinel"

        Assert-ExactPropertySet $result.stream_capture @("stdout_completed", "stderr_completed", "deadline_exceeded") "Real process tree stream capture"
        Assert-True ([bool]$result.stream_capture.stdout_completed) "Real process tree stdout capture incomplete"
        Assert-True ([bool]$result.stream_capture.stderr_completed) "Real process tree stderr capture incomplete"
        Assert-True (-not [bool]$result.stream_capture.deadline_exceeded) "Real process tree stream deadline flag"
        Assert-ExactPropertySet $result.taskkill @("attempted", "path", "arguments", "exit_code", "timed_out", "stdout", "stderr", "error_type", "error_text") "Real process tree taskkill"
        Assert-True ([bool]$result.taskkill.attempted) "Real process tree taskkill attempted"
        Assert-Equal "C:\Windows\System32\taskkill.exe" ([string]$result.taskkill.path) "Real process tree taskkill path"
        Assert-Equal "/PID|$recordedParentPid|/T|/F" (@($result.taskkill.arguments) -join "|") "Real process tree taskkill arguments"
        Assert-Equal 0 ([int]$result.taskkill.exit_code) "Real process tree taskkill exit"
        Assert-True (-not [bool]$result.taskkill.timed_out) "Real process tree taskkill timed_out"
        Assert-True ($null -ne $result.taskkill.stdout) "Real process tree taskkill stdout missing"
        Assert-True ($null -ne $result.taskkill.stderr) "Real process tree taskkill stderr missing"
        Assert-Null $result.taskkill.error_type "Real process tree taskkill error type"
        Assert-Null $result.taskkill.error_text "Real process tree taskkill error text"
        Assert-Equal 0 @($result.termination_errors).Count "Real process tree termination errors"
        Assert-Equal $recordedParentPid ([int]$result.process_identity.pid) "Real process tree native parent identity PID"
        Assert-Equal 0 ([int]$result.job_control.accounting.active_processes) "Real process tree final Job active count"
        Assert-True ([bool]$result.job_control.completion_telemetry.active_zero_observed) "Real process tree Job active-zero observation"
        Assert-True ([int]$result.job_control.accounting.total_processes -ge 2) "Real process tree Job did not account for the descendant"
        $jobPids = @($result.job_control.completion_telemetry.unique_new_pids | ForEach-Object { [int]$_ } | Sort-Object -Unique)
        Assert-Equal "$recordedParentPid|$recordedChildPid" (($jobPids | Sort-Object) -join "|") "Real process tree completion PID set"
        $completionRows = @($result.job_control.completion_telemetry.messages)
        foreach ($expectedPid in @($recordedChildPid)) {
            $matches = @($completionRows | Where-Object { [int]$_.pid -eq [int]$expectedPid })
            Assert-Equal 1 $matches.Count "Real process tree completion row count: $expectedPid"
            Assert-True ([bool]$matches[0].exit_observed) "Real process tree exit observation: $expectedPid"
        }
    }
    finally {
        $cleanupPids = New-Object System.Collections.Generic.List[int]
        foreach ($handshakePath in @($parentReadyPath, $pidPath, $childReadyPath)) {
            if (Test-Path -LiteralPath $handshakePath -PathType Leaf) {
                $handshakeText = [System.IO.File]::ReadAllText($handshakePath)
                foreach ($pidToken in @($handshakeText -split '\|')) {
                    if ($pidToken -match '^\d+$') { [void]$cleanupPids.Add([int]$pidToken) }
                }
            }
        }
        foreach ($knownPid in @($recordedParentPid, $recordedChildPid)) {
            if ($knownPid -gt 0) { [void]$cleanupPids.Add([int]$knownPid) }
        }
        if ($null -ne $outer) { [void]$cleanupPids.Add([int]$outer.Id) }
        foreach ($cleanupPid in @($cleanupPids | Sort-Object -Unique)) {
            if ($cleanupPid -gt 0 -and $cleanupPid -ne $sentinel.Id) { Stop-TestProcessTreeByExactId $cleanupPid }
        }
        if ($null -ne (Get-Process -Id $sentinel.Id -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $sentinel.Id -Force -ErrorAction SilentlyContinue
        }
        if ($null -ne $outer) { $outer.Dispose() }
    }
}

function Invoke-ProcessTest {
    param([string]$Id, $Fixture)
    if ($Id -eq "RED-PROCESS-001") {
        $scriptPath = Join-Path $Fixture.base "argv-echo.ps1"
        $content = '$ErrorActionPreference="Stop"; $encoded=@($args|ForEach-Object{[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_))}); [Console]::Out.Write(($encoded|ConvertTo-Json -Compress)); exit 37'
        [System.IO.File]::WriteAllText($scriptPath, $content, $script:Utf8NoBom)
        $expected = @("", "two words", 'a"b', "a\\b", "trail\\")
        $result = Invoke-FoundationProcessCommand -CommandSpec (New-ProcessSpec $Id $scriptPath $expected) -TimeoutMs 10000
        Assert-Equal 37 $result.exit_code "Argv process exit from Process.ExitCode"
        Assert-Equal "failed" ([string]$result.status) "Argv nonzero status"
        Assert-ExactPropertySet $result.process_identity @("pid", "start_time_filetime_utc", "executable_path", "length", "sha256") "Argv native process identity"
        Assert-Equal ([int]$result.process_id) ([int]$result.process_identity.pid) "Argv native process identity PID"
        Assert-True ([long]$result.process_identity.start_time_filetime_utc -gt 0) "Argv native process start time"
        Assert-Equal ([System.IO.Path]::GetFullPath($powershellPath)) ([System.IO.Path]::GetFullPath([string]$result.process_identity.executable_path)) "Argv native process executable"
        $expectedExecutable = Get-Item -LiteralPath $powershellPath -Force -ErrorAction Stop
        Assert-Equal ([long]$expectedExecutable.Length) ([long]$result.process_identity.length) "Argv native process executable length"
        Assert-Equal ([string](Get-FileHash -LiteralPath $powershellPath -Algorithm SHA256).Hash) ([string]$result.process_identity.sha256) "Argv native process executable SHA-256"
        Assert-ExactPropertySet $result.job_control @("completion_telemetry", "accounting", "spawn_journal") "Argv native Job control"
        Assert-ExactPropertySet $result.job_control.completion_telemetry @("best_effort", "messages", "unique_new_pids", "identity_failures", "active_zero_observed") "Argv native completion telemetry"
        Assert-True ([bool]$result.job_control.completion_telemetry.best_effort) "Argv native completion telemetry best-effort flag"
        Assert-True ([bool]$result.job_control.completion_telemetry.active_zero_observed) "Argv native Job active-zero observation"
        Assert-Equal ([string]$result.process_id) ((@($result.job_control.completion_telemetry.unique_new_pids | ForEach-Object { [string]$_ }) | Sort-Object) -join "|") "Argv native completion PID set"
        Assert-Equal 0 @($result.job_control.completion_telemetry.identity_failures).Count "Argv native completion identity failures"
        $completionPaths = @($result.job_control.completion_telemetry.messages | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.executable_path) } | Sort-Object -Unique)
        Assert-Equal ([System.IO.Path]::GetFullPath($powershellPath)) ($completionPaths -join "|") "Argv native completion executable set (conhost must not enter the Job)"
        Assert-ExactPropertySet $result.job_control.accounting @("total_processes", "active_processes", "expected_total_processes", "matched") "Argv native Job accounting"
        Assert-Equal 1 ([int]$result.job_control.accounting.total_processes) "Argv native Job total"
        Assert-Equal 0 ([int]$result.job_control.accounting.active_processes) "Argv native Job active"
        Assert-Equal 1 ([int]$result.job_control.accounting.expected_total_processes) "Argv native Job expected total"
        Assert-True ([bool]$result.job_control.accounting.matched) "Argv native Job accounting match"
        Assert-Equal 0 @($result.job_control.spawn_journal.intents).Count "Argv native spawn intents"
        Assert-Equal 0 @($result.job_control.spawn_journal.results).Count "Argv native spawn results"
        Assert-True ([bool]$result.job_control.spawn_journal.matched) "Argv native spawn journal match"
        $parsedEncoded = $result.stdout | ConvertFrom-Json
        $actualEncoded = @($parsedEncoded)
        Assert-Equal $expected.Count $actualEncoded.Count "Argv count"
        for ($i = 0; $i -lt $expected.Count; $i++) {
            $actual = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($actualEncoded[$i]))
            Assert-Equal $expected[$i] $actual "Argv item $i"
        }
    }
    elseif ($Id -eq "RED-PROCESS-002") {
        $scriptPath = Join-Path $Fixture.base "dual-stream.ps1"
        $content = '$chunk="x"*4096; for($i=0;$i -lt 300;$i++){[Console]::Out.Write($chunk);[Console]::Error.Write($chunk)}'
        [System.IO.File]::WriteAllText($scriptPath, $content, $script:Utf8NoBom)
        $result = Invoke-FoundationProcessCommand -CommandSpec (New-ProcessSpec $Id $scriptPath @()) -TimeoutMs 20000
        Assert-Equal 0 $result.exit_code "Dual stream process exit"
        Assert-Equal 1228800 $result.stdout.Length "stdout byte-compatible character count"
        Assert-Equal 1228800 $result.stderr.Length "stderr byte-compatible character count"
        Assert-Equal "F8AAEE8BDE158679E6A44DD10B9E134CFDF3EFE959F3F9B19EF753E1D92953E4" (Get-TextSha256 $result.stdout) "stdout SHA-256"
        Assert-Equal "F8AAEE8BDE158679E6A44DD10B9E134CFDF3EFE959F3F9B19EF753E1D92953E4" (Get-TextSha256 $result.stderr) "stderr SHA-256"
    }
    elseif ($Id -eq "RED-PROCESS-003") {
        $processFailures = New-Object System.Collections.ArrayList
        try {
            Invoke-ProcessFaultInjectorVariants $Fixture
        }
        catch {
            [void]$processFailures.Add("fault_injector:$($_.Exception.Message)")
        }
        try {
            Invoke-DescendantPipeDeadlineVariant $Fixture
        }
        catch {
            [void]$processFailures.Add("descendant_pipe:$($_.Exception.Message)")
        }
        foreach ($terminationMode in @("nonzero", "timeout")) {
            try {
                Invoke-TerminationRunnerFailureVariant $Fixture $terminationMode
            }
            catch {
                [void]$processFailures.Add("termination_${terminationMode}:$($_.Exception.Message)")
            }
        }
        try {
            Invoke-TerminationErrorMappingVariant
        }
        catch {
            [void]$processFailures.Add("global_error_map:$($_.Exception.Message)")
        }

        try {
            Invoke-RealProcessTreeTimeoutVariant $Fixture
        }
        catch {
            [void]$processFailures.Add("normal_tree_timeout:$($_.Exception.Message)")
        }
        if ($processFailures.Count -gt 0) {
            throw ("PROCESS-003 subvariants failed: " + (@($processFailures) -join " || "))
        }
    }
}

function Invoke-ProcessFaultInjectorVariants {
    param($Fixture)
    $scriptPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "fault-injector-worker.ps1")
    [System.IO.File]::WriteAllText($scriptPath, 'param([string]$Marker);[IO.File]::WriteAllText($Marker,"resumed");exit 0', $script:Utf8NoBom)
    $phases = @("create_before_job", "job_setup", "job_completion_port", "job_assign", "pid_identity", "stream_stdout_fault", "stream_stderr_cancel", "job_completion_event", "job_accounting_query", "job_query", "job_close")
    $preResumePhases = @("create_before_job", "job_setup", "job_completion_port", "job_assign", "pid_identity")
    foreach ($phase in $phases) {
        $marker = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base ("fault-marker-" + $phase + ".txt"))
        $calls = New-Object System.Collections.ArrayList
        $injector = {
            param($Request)
            Assert-ExactPropertySet $Request @("phase", "command_id", "process_identity") "Process fault injector request $phase"
            Assert-Equal ("RED-PROCESS-003-fault-" + $phase) ([string]$Request.command_id) "Process fault injector command ID $phase"
            Assert-True ([string]$Request.phase -in $phases) "Process fault injector phase enum $phase"
            if ($null -ne $Request.process_identity) {
                Assert-ExactPropertySet $Request.process_identity @("pid", "start_time_filetime_utc", "executable_path", "length", "sha256") "Process fault injector identity $phase/$($Request.phase)"
                Assert-True ([int]$Request.process_identity.pid -gt 0) "Process fault injector PID $phase/$($Request.phase)"
            }
            [void]$calls.Add([string]$Request.phase)
            if ([string]$Request.phase -ceq $phase) {
                return [pscustomobject][ordered]@{ inject = $true; error_type = ("TEST_FAULT_" + $phase.ToUpperInvariant()); error_text = ("injected process fault at " + $phase) }
            }
            return [pscustomobject][ordered]@{ inject = $false; error_type = $null; error_text = $null }
        }.GetNewClosure()
        $spec = New-ProcessSpec ("RED-PROCESS-003-fault-" + $phase) $scriptPath @($marker)
        $result = Invoke-FoundationProcessCommand -CommandSpec $spec -TimeoutMs 10000 -ProcessFaultInjector $injector
        Assert-Equal "failed" ([string]$result.status) "Process fault injector status $phase"
        Assert-ExactPropertySet $result.fault_injection @("active", "phase", "injected", "error_type", "error_text") "Process fault injector result $phase"
        Assert-True ([bool]$result.fault_injection.active) "Process fault injector active flag $phase"
        Assert-True ([bool]$result.fault_injection.injected) "Process fault injector injected flag $phase"
        Assert-Equal $phase ([string]$result.fault_injection.phase) "Process fault injector selected phase $phase"
        Assert-Equal ("TEST_FAULT_" + $phase.ToUpperInvariant()) ([string]$result.fault_injection.error_type) "Process fault injector error type $phase"
        Assert-Equal ("injected process fault at " + $phase) ([string]$result.fault_injection.error_text) "Process fault injector error text $phase"
        $expectedCode = if ($phase -eq "create_before_job") { "PROCESS_START_FAILED" } elseif ($phase -in @("job_setup", "job_completion_port")) { "PROCESS_JOB_SETUP_FAILED" } elseif ($phase -eq "job_assign") { "PROCESS_JOB_ASSIGNMENT_FAILED" } elseif ($phase -eq "pid_identity") { "PROCESS_PID_IDENTITY_MISMATCH" } elseif ($phase -eq "job_completion_event") { "PROCESS_COMPLETION_TELEMETRY_INCOMPLETE" } elseif ($phase -eq "job_accounting_query") { "PROCESS_JOB_ACCOUNTING_MISMATCH" } else { "PROCESS_RUNTIME_FAILED" }
        Assert-Equal $expectedCode ([string]$result.error_code) "Process fault injector stable code $phase"
        Assert-Equal 1 @($calls | Where-Object { $_ -ceq $phase }).Count "Process fault injector target call count $phase"
        if ($phase -in $preResumePhases) {
            Assert-True (-not (Test-Path -LiteralPath $marker -PathType Leaf)) "Process fault injector resumed pre-resume payload $phase"
        }
        if ($null -ne $result.process_id) {
            Assert-True ($null -eq (Get-Process -Id ([int]$result.process_id) -ErrorAction SilentlyContinue)) "Process fault injector left parent alive $phase"
        }
    }
    $script:ProcessFaultDynamicGetterHits = 0
    $dynamicInjector = {
        param($Request)
        $value = [pscustomobject][ordered]@{ inject = $false; error_type = $null; error_text = $null }
        $value.PSObject.Properties.Remove("inject")
        $value | Add-Member -MemberType ScriptProperty -Name inject -Value { $script:ProcessFaultDynamicGetterHits++; return $true }
        return $value
    }
    $dynamicResult = Invoke-FoundationProcessCommand -CommandSpec (New-ProcessSpec "RED-PROCESS-003-fault-dynamic" $scriptPath @((Join-Path $Fixture.base "fault-dynamic-marker.txt"))) -TimeoutMs 10000 -ProcessFaultInjector $dynamicInjector
    Assert-Equal 0 $script:ProcessFaultDynamicGetterHits "Process fault injector executed dynamic getter"
    Assert-Equal "failed" ([string]$dynamicResult.status) "Process fault injector dynamic result status"
    Assert-True ([string]$dynamicResult.exception_text -match "PROCESS_FAULT_INJECTOR_INVALID") "Process fault injector dynamic result stable error"
    Assert-True ([bool]$dynamicResult.fault_injection.active) "Process fault injector dynamic active flag"
    Assert-True (-not [bool]$dynamicResult.fault_injection.injected) "Process fault injector dynamic injected flag"
}

function Invoke-RegisteredSnapshotManifestExclusionVariant {
    param($Fixture)
    $auditRoot = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.base "registered-snapshot-audit")
    $snapshotRoot = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $auditRoot "runtime-snapshot")
    $snapshotPnpm = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $snapshotRoot "pnpm")
    $externalTarget = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $Fixture.external "registered-snapshot-target")
    $registeredJunction = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $snapshotPnpm "zod")
    $unknownJunction = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $auditRoot "unexpected-reparse")
    $businessPath = Resolve-TestHarnessPathWithinFixture $Fixture.base (Join-Path $auditRoot "candidate.jsonl")
    New-Directory $snapshotPnpm
    New-Directory $externalTarget
    Write-StableFile (Join-Path $externalTarget "index.js") "registered snapshot target"
    Write-StableFile $businessPath '{"kind":"manifest-snapshot-exclusion"}'
    [void](New-Item -ItemType Junction -Path $registeredJunction -Target $externalTarget)
    $request = [pscustomobject]@{
        scope_id = "temporary_validation_root_pre_delete"
        roots = @([pscustomobject]@{ root_id = "validation_root"; path = $auditRoot })
        exclude_node_modules = $false
        include_dist = $true
        all_files = $false
    }
    try {
        Assert-ExactPropertySet $request @("scope_id", "roots", "exclude_node_modules", "include_dist", "all_files") "Registered runtime snapshot exclusion request"
        $audit = Invoke-FoundationDefaultManifestProvider $request -ExcludedSubtrees @($snapshotRoot)
        $entries = @($audit.entries)
        Assert-Equal 1 $entries.Count "Registered runtime snapshot exclusion business entry count"
        Assert-Equal ([System.IO.Path]::GetFullPath($businessPath)) ([System.IO.Path]::GetFullPath([string]$entries[0].full_path)) "Registered runtime snapshot exclusion business path"
        Assert-Equal "business_candidate" ([string]$entries[0].classification) "Registered runtime snapshot exclusion classification"
        [void](New-Item -ItemType Junction -Path $unknownJunction -Target $externalTarget)
        $rejected = $false
        try { [void](Invoke-FoundationDefaultManifestProvider $request -ExcludedSubtrees @($snapshotRoot)) }
        catch { $rejected = $_.Exception.Message -match 'PATH_REPARSE_POINT_REJECTED' }
        Assert-True $rejected "Unregistered temporary-root reparse point was not rejected"
    }
    finally {
        Remove-TestOwnedJunctionLeaf $Fixture $unknownJunction $externalTarget
        Remove-TestOwnedJunctionLeaf $Fixture $registeredJunction $externalTarget
    }
}

function Assert-DeliveryPowerShellSources {
    $paths = @(
        (Join-Path $projectRoot "shared\validate-foundations.ps1"),
        (Join-Path $projectRoot "shared\private\foundation-validation-core.ps1"),
        (Join-Path $projectRoot "shared\tests\validate-data-manifests.ps1"),
        (Join-Path $projectRoot "shared\tests\validate-foundations-state-isolation.ps1")
    )
    foreach ($path in $paths) {
        Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "PowerShell delivery file missing: $path"
        Test-AsciiSource $path
        $tokens = $null
        $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
        Assert-Equal 0 $parseErrors.Count "PowerShell delivery parser errors: $path"
    }
}

function Invoke-ProductionEntryContractTest {
    param($Fixture)
    $validatorPath = Join-Path $projectRoot "shared\validate-foundations.ps1"
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($validatorPath, [ref]$tokens, [ref]$parseErrors)
    Assert-Equal 0 $parseErrors.Count "Production entry parser errors"
    Assert-True ($null -ne $ast.ParamBlock) "Production entry must declare an explicit param block"
    $attributeNames = @($ast.ParamBlock.Attributes | ForEach-Object { $_.TypeName.FullName })
    Assert-True ($attributeNames -contains "CmdletBinding") "Production entry must use CmdletBinding so unknown root parameters are rejected"
    $publicParameterNames = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    foreach ($forbidden in @("ProjectRoot", "OfficialDataRoot", "EvidenceRoot", "Runtime", "CommandRunner", "CleanupRunner", "EnvironmentAdapter", "ManifestProvider", "ReportPublisher", "PathPhaseObserver", "ProcessFaultInjector", "Clock", "RunIdProvider")) {
        Assert-True ($publicParameterNames -notcontains $forbidden) "Production entry exposed forbidden public parameter: $forbidden"
    }

    $variables = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.VariableExpressionAst] }, $true) | ForEach-Object { $_.VariablePath.UserPath })
    Assert-True ($variables -contains "PSScriptRoot") "Production entry does not anchor paths at PSScriptRoot"
    Assert-Equal 0 @($variables | Where-Object { $_ -match '(?i)^env:.*official|^env:.*data.*root' }).Count "Production entry references a forbidden official-root environment variable"
    $commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true))
    $coreCommands = @($commands | Where-Object { $_.GetCommandName() -eq "Invoke-FoundationValidationCore" })
    Assert-Equal 1 $coreCommands.Count "Production entry must invoke Invoke-FoundationValidationCore exactly once"
    $coreParameterNames = @($coreCommands[0].CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.CommandParameterAst] } | ForEach-Object { [string]$_.ParameterName })
    foreach ($seamName in @("PathPhaseObserver", "ProcessFaultInjector")) {
        Assert-True ($coreParameterNames -notcontains $seamName) "Production entry forwarded forbidden test seam: $seamName"
    }
    foreach ($adapterName in @("ManifestProvider", "ReportPublisher")) {
        $elements = @($coreCommands[0].CommandElements)
        $parameterIndexes = @()
        for ($elementIndex = 0; $elementIndex -lt $elements.Count; $elementIndex++) {
            if ($elements[$elementIndex] -is [System.Management.Automation.Language.CommandParameterAst] -and [string]$elements[$elementIndex].ParameterName -ceq $adapterName) {
                $parameterIndexes += $elementIndex
            }
        }
        Assert-Equal 1 $parameterIndexes.Count "Production entry core adapter parameter count: $adapterName"
        $argumentIndex = $parameterIndexes[0] + 1
        Assert-True ($argumentIndex -lt $elements.Count) "Production entry core adapter argument missing: $adapterName"
        Assert-True ($elements[$argumentIndex] -is [System.Management.Automation.Language.VariableExpressionAst]) "Production entry core adapter argument is not a variable: $adapterName"
        Assert-Equal "null" ([string]$elements[$argumentIndex].VariablePath.UserPath) "Production entry core adapter must use null: $adapterName"
    }
    $stringValues = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) | ForEach-Object { $_.Value })
    Assert-Equal 0 @($stringValues | Where-Object { $_ -match '(?i)DIET_MANAGER_.*OFFICIAL|OFFICIAL_DATA_ROOT|OFFICIAL.*ROOT.*ENV' }).Count "Production entry references a forbidden official-root environment name"
    Assert-True (@($stringValues | Where-Object { $_ -match '(?i)foundation-validation-core\.ps1$' }).Count -ge 1) "Production entry fixed core path is missing"
    Assert-True (@($stringValues | Where-Object { $_ -match '(?i)docs[\\/]evidence$' }).Count -ge 1) "Production entry fixed evidence path is missing"

    $externalFilesBefore = @(Get-ChildItem -LiteralPath $Fixture.external -Recurse -File -Force -ErrorAction SilentlyContinue)
    Assert-Equal 0 $externalFilesBefore.Count "Production rejection external fixture was not empty"
    foreach ($parameterName in @("ProjectRoot", "OfficialDataRoot")) {
        $savedPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $output = & $powershellPath -NoProfile -ExecutionPolicy Bypass -File $validatorPath ("-" + $parameterName) $Fixture.external 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $savedPreference
        }
        Assert-True ($exitCode -ne 0) "Production entry accepted forbidden parameter: $parameterName"
        Assert-True (-not [string]::IsNullOrWhiteSpace($output)) "Production entry rejection output missing: $parameterName"
        Assert-Equal 0 @(Get-ChildItem -LiteralPath $Fixture.external -Recurse -File -Force -ErrorAction SilentlyContinue).Count "Production rejected parameter wrote outside: $parameterName"
    }
}

function Invoke-RegisteredTest {
    param($Case)

    $fixture = $null
    $tempNames = @("TEMP", "TMP", "TMPDIR")
    $tempRestoreState = Get-ProcessEnvironmentState $tempNames
    $poisonRestoreState = $null
    $poisonExpectedState = $null
    $poisonNames = @()
    $oldOfficial = [Environment]::GetEnvironmentVariable("DIET_MANAGER_OFFICIAL_DATA_ROOT", "Process")
    $oldStateExists = Test-Path Env:OPENCLAW_STATE_DIR
    $oldState = [Environment]::GetEnvironmentVariable("OPENCLAW_STATE_DIR", "Process")
    try {
        $typeboxFixtureProfile = if ([string]$Case.id -in @("RED-STAGING-001", "RED-STAGING-002")) { "production_exact" } else { "structural_v1" }
        $fixture = New-TestFixture -TypeboxFixtureProfile $typeboxFixtureProfile
        foreach ($name in $tempNames) {
            [Environment]::SetEnvironmentVariable($name, $fixture.base, "Process")
        }
        Test-FixtureHarness $fixture
        $scenario = New-ScenarioState $Case.id $fixture
        Assert-Equal $typeboxFixtureProfile ([string]$scenario.typebox_fixture_profile) "Scenario TypeBox fixture profile"
        Assert-True (-not [object]::ReferenceEquals($scenario.expected_typebox_contract, $fixture.runtime.identity_expectations.module_closure.staging_typebox)) "Scenario TypeBox oracle reused Runtime contract object"
        Set-ScenarioInjection $Case.id $scenario

        if ($Case.id -in @("RED-ROOT-002", "RED-ROOT-003", "RED-ROOT-004", "RED-ROOT-005")) {
            Invoke-PathTest $Case.id $fixture
            if ($Case.id -eq "RED-ROOT-002") {
                $report = Invoke-CoreForScenario $fixture $scenario $null $null
                [void](Assert-OfficialObservationPair $report $fixture "RED-ROOT-002")
                Assert-BasicReport $report
                Assert-True (Test-Path -LiteralPath $report.report_path -PathType Leaf) "Guard rejection follow-up JSON missing"
            }
            elseif ($Case.id -eq "RED-ROOT-005") {
                Invoke-AncestorJunctionSafetyVariant $fixture $scenario
                $dataRoot = Resolve-TestHarnessPathWithinFixture $fixture.base (Join-Path $fixture.routes.A "data")
                $junctionTarget = Resolve-TestHarnessPathWithinFixture $fixture.base (Join-Path $fixture.external "official-data-target")
                $bDataRoot = [System.IO.Path]::GetFullPath((Join-Path $fixture.routes.B "data")).TrimEnd("\", "/")
                $cDataRoot = [System.IO.Path]::GetFullPath((Join-Path $fixture.routes.C "data")).TrimEnd("\", "/")
                $bPrefix = $bDataRoot + [System.IO.Path]::DirectorySeparatorChar
                $cPrefix = $cDataRoot + [System.IO.Path]::DirectorySeparatorChar
                $bSeedPaths = @($fixture.seed_paths | Where-Object { ([System.IO.Path]::GetFullPath([string]$_)).StartsWith($bPrefix, [System.StringComparison]::OrdinalIgnoreCase) })
                $cSeedPaths = @($fixture.seed_paths | Where-Object { ([System.IO.Path]::GetFullPath([string]$_)).StartsWith($cPrefix, [System.StringComparison]::OrdinalIgnoreCase) })
                Assert-Equal 8 $bSeedPaths.Count "ROOT-005 B safe seed count"
                Assert-Equal 4 $cSeedPaths.Count "ROOT-005 C safe seed count"
                $bBefore = Get-FileSnapshot $bSeedPaths
                $cBefore = Get-FileSnapshot $cSeedPaths
                Assert-True (-not (Test-Path -LiteralPath $junctionTarget)) "ROOT-005 physical junction target already exists"
                Move-Item -LiteralPath $dataRoot -Destination $junctionTarget
                [void](New-Item -ItemType Junction -Path $dataRoot -Target $junctionTarget)
                $junctionLeaf = Get-Item -LiteralPath $dataRoot -Force
                Assert-True (($junctionLeaf.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) "ROOT-005 A data leaf is not a junction"
                $targetRootItem = Get-Item -LiteralPath $junctionTarget -Force
                Assert-True (($targetRootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "ROOT-005 physical target is a reparse point"
                $targetReparseDescendants = @(Get-ChildItem -LiteralPath $junctionTarget -Recurse -Force | Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 })
                Assert-Equal 0 $targetReparseDescendants.Count "ROOT-005 physical target reparse descendant count"
                $targetFiles = @(Get-ChildItem -LiteralPath $junctionTarget -Recurse -File -Force | ForEach-Object { $_.FullName })
                Assert-Equal 3 $targetFiles.Count "ROOT-005 physical target seed count"
                $targetBefore = Get-FileSnapshot $targetFiles
                $externalBeforeFiles = @(Get-ChildItem -LiteralPath $fixture.external -Recurse -File -Force | ForEach-Object { $_.FullName })
                $externalBefore = Get-FileSnapshot $externalBeforeFiles
                $report = Invoke-CoreForScenario $fixture $scenario $null $null
                $observationDigests = Assert-OfficialObservationPair $report $fixture "RED-ROOT-005"
                $junctionLeafAfter = Get-Item -LiteralPath $dataRoot -Force
                Assert-True (($junctionLeafAfter.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) "ROOT-005 A data leaf stopped being a junction"
                $targetAfterFiles = @(Get-ChildItem -LiteralPath $junctionTarget -Recurse -File -Force | ForEach-Object { $_.FullName })
                $targetAfter = Get-FileSnapshot $targetAfterFiles
                $externalAfterFiles = @(Get-ChildItem -LiteralPath $fixture.external -Recurse -File -Force | ForEach-Object { $_.FullName })
                $externalAfter = Get-FileSnapshot $externalAfterFiles
                $bAfter = Get-FileSnapshot $bSeedPaths
                $cAfter = Get-FileSnapshot $cSeedPaths
                Assert-BasicReport $report
                Assert-Equal "failed" $report.verdict "Official data reparse root verdict"
                Assert-ExactErrorCodeCount $report.errors "OFFICIAL_BASELINE_UNAVAILABLE" 1 "ROOT-005 official baseline unavailable error count"
                $beforeObservation = $report.manifests.official.before
                $afterObservation = $report.manifests.official.after
                Assert-Equal "official-state-observation/v1" ([string]$beforeObservation.schema_version) "ROOT-005 before schema"
                Assert-Equal "official-state-observation/v1" ([string]$afterObservation.schema_version) "ROOT-005 after schema"
                Assert-Equal "official_before" ([string]$beforeObservation.scope_id) "ROOT-005 before scope"
                Assert-Equal "official_after" ([string]$afterObservation.scope_id) "ROOT-005 after scope"
                Assert-True ($beforeObservation.completed -is [bool] -and [bool]$beforeObservation.completed) "ROOT-005 before completed"
                Assert-True ($afterObservation.completed -is [bool] -and [bool]$afterObservation.completed) "ROOT-005 after completed"
                Assert-True ($beforeObservation.coverage_complete -is [bool] -and -not [bool]$beforeObservation.coverage_complete) "ROOT-005 before coverage"
                Assert-True ($afterObservation.coverage_complete -is [bool] -and -not [bool]$afterObservation.coverage_complete) "ROOT-005 after coverage"
                Assert-True (-not [object]::ReferenceEquals($beforeObservation, $afterObservation)) "ROOT-005 after observation reused the before object"

                $expectedRootPaths = @{
                    A = [System.IO.Path]::GetFullPath($dataRoot).TrimEnd("\", "/")
                    B = $bDataRoot
                    C = $cDataRoot
                }
                foreach ($observation in @($beforeObservation, $afterObservation)) {
                    $rootRows = @($observation.roots)
                    Assert-Equal 3 $rootRows.Count "ROOT-005 observation root count"
                    for ($rootIndex = 0; $rootIndex -lt @("A", "B", "C").Count; $rootIndex++) {
                        $route = @("A", "B", "C")[$rootIndex]
                        $row = $rootRows[$rootIndex]
                        Assert-True ([string]$row.route -ceq $route) "ROOT-005 root order: $route"
                        Assert-Equal $expectedRootPaths[$route] ([System.IO.Path]::GetFullPath([string]$row.path).TrimEnd("\", "/")) "ROOT-005 root path: $route"
                        if ($route -eq "A") {
                            Assert-True ($row.exists -is [bool] -and [bool]$row.exists) "ROOT-005 A exists"
                            Assert-Equal "blocked" ([string]$row.scan_status) "ROOT-005 A scan status"
                            Assert-Equal "PATH_REPARSE_POINT_REJECTED" ([string]$row.error_code) "ROOT-005 A error code"
                        }
                        else {
                            Assert-True ($row.exists -is [bool] -and [bool]$row.exists) "ROOT-005 $route exists"
                            Assert-Equal "scanned" ([string]$row.scan_status) "ROOT-005 $route scan status"
                            Assert-Null $row.error_code "ROOT-005 $route error code"
                        }
                    }

                    $entries = @($observation.entries)
                    Assert-Equal 0 @($entries | Where-Object { [string]$_.route -eq "A" }).Count "ROOT-005 A blocked entry count"
                    Assert-Equal 8 @($entries | Where-Object { [string]$_.route -eq "B" }).Count "ROOT-005 B scanned entry count"
                    Assert-Equal 4 @($entries | Where-Object { [string]$_.route -eq "C" }).Count "ROOT-005 C scanned entry count"
                    Assert-Equal 12 $entries.Count "ROOT-005 total scanned entry count"
                    foreach ($routeCheck in @(
                        [pscustomobject]@{ route = "B"; snapshots = if ([string]$observation.scope_id -eq "official_before") { $bBefore } else { $bAfter } },
                        [pscustomobject]@{ route = "C"; snapshots = if ([string]$observation.scope_id -eq "official_before") { $cBefore } else { $cAfter } }
                    )) {
                        foreach ($snapshot in @($routeCheck.snapshots)) {
                            $matches = @($entries | Where-Object { [string]$_.route -eq [string]$routeCheck.route -and ([System.IO.Path]::GetFullPath([string]$_.full_path)).Equals([System.IO.Path]::GetFullPath([string]$snapshot.full_path), [System.StringComparison]::OrdinalIgnoreCase) })
                            Assert-Equal 1 $matches.Count "ROOT-005 safe scanned entry: $($snapshot.full_path)"
                            Assert-Equal ([long]$snapshot.length) ([long]$matches[0].length) "ROOT-005 safe scanned length: $($snapshot.full_path)"
                            Assert-Equal ([string]$snapshot.sha256) ([string]$matches[0].sha256) "ROOT-005 safe scanned SHA-256: $($snapshot.full_path)"
                            Assert-Equal ([string]$snapshot.last_write_time_utc) ([string]$matches[0].last_write_time_utc) "ROOT-005 safe scanned mtime: $($snapshot.full_path)"
                        }
                    }
                }

                $beforeDigest = [string]$observationDigests.pre_state_hash
                $afterDigest = [string]$observationDigests.post_state_hash
                Assert-True ([string]$beforeObservation.state_digest -cmatch '^[A-F0-9]{64}$') "ROOT-005 before state digest format"
                Assert-True ([string]$afterObservation.state_digest -cmatch '^[A-F0-9]{64}$') "ROOT-005 after state digest format"
                Assert-Equal $beforeDigest ([string]$beforeObservation.state_digest) "ROOT-005 before state digest"
                Assert-Equal $afterDigest ([string]$afterObservation.state_digest) "ROOT-005 after state digest"
                Assert-ConcreteFaultFields $report "official_data_reparse_root" "PATH_REPARSE_POINT_REJECTED" $beforeDigest $afterDigest 0 0 0
                Assert-True ([bool]$report.fault.after_manifest_generated) "ROOT-005 after manifest generated"
                Assert-EmptyDiff $report.manifests.official.diff "ROOT-005 comparable B/C official data"
                Assert-True ((Get-ReportText $report.errors) -match "PATH_REPARSE_POINT_REJECTED") "Official data reparse error missing"
                Assert-Equal 0 @($scenario.observed_specs).Count "Commands ran after official data reparse rejection"
                Assert-Equal 9 @($report.commands).Count "ROOT-005 command object count"
                foreach ($command in @($report.commands)) {
                    Assert-Equal "skipped" ([string]$command.status) "ROOT-005 command status: $($command.id)"
                    Assert-Null $command.exit_code "ROOT-005 command exit: $($command.id)"
                    Assert-True (-not [bool]$command.timed_out) "ROOT-005 command timed out: $($command.id)"
                }
                Assert-SnapshotsEqual $targetBefore $targetAfter "Official data junction target"
                Assert-SnapshotsEqual $externalBefore $externalAfter "ROOT-005 external physical directory"
                Assert-SnapshotsEqual $bBefore $bAfter "ROOT-005 B safe data"
                Assert-SnapshotsEqual $cBefore $cAfter "ROOT-005 C safe data"
            }
            return
        }
        if ($Case.id -like "RED-PROCESS-*") {
            Invoke-ProcessTest $Case.id $fixture
            return
        }

        if ($Case.id -eq "RED-ROOT-006") {
            [Environment]::SetEnvironmentVariable("DIET_MANAGER_OFFICIAL_DATA_ROOT", $fixture.external, "Process")
        }
        if ($Case.id -eq "RED-ENV-001") {
            [Environment]::SetEnvironmentVariable("OPENCLAW_STATE_DIR", "C:\forbidden\caller-state", "Process")
        }
        elseif ($Case.id -eq "RED-ENV-002") {
            Remove-Item Env:OPENCLAW_STATE_DIR -ErrorAction SilentlyContinue
        }
        elseif ($Case.id -eq "RED-ENV-NODE-001") {
            $poisonNames = @($nodePoisonNames)
            $poisonRestoreState = Get-ProcessEnvironmentState $poisonNames
            Set-PoisonEnvironment $poisonNames $fixture.external
            $poisonExpectedState = Get-ProcessEnvironmentState $poisonNames
        }
        elseif ($Case.id -eq "RED-ENV-OPENCLAW-001") {
            $poisonNames = @($openClawPoisonNames)
            $poisonRestoreState = Get-ProcessEnvironmentState $poisonNames
            Set-PoisonEnvironment $poisonNames $fixture.external
            $poisonExpectedState = Get-ProcessEnvironmentState $poisonNames
        }
        elseif ($Case.id -eq "RED-STAGING-002") {
            $typeboxPackage = Join-Path ([string]$fixture.runtime.dependency_source_roots.typebox_root) "package.json"
            Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path $fixture.routes.C "node_modules\.pnpm\typebox@1.3.11\node_modules\typebox\package.json"))) ([System.IO.Path]::GetFullPath($typeboxPackage)) "STAGING-002 authoritative C TypeBox package path"
            [System.IO.File]::AppendAllText($typeboxPackage, "tampered", $script:Utf8NoBom)
            Invoke-DirectInvalidPluginStagingOracle $fixture "C" "package_tamper"
        }

        $before = Get-FileSnapshot $fixture.seed_paths
        $guardBefore = Get-FileSnapshot $fixture.guard_paths
        $manifestProvider = $null
        $reportPublisher = $null
        if ($Case.id -eq "RED-MANIFEST-006") {
            $manifestProvider = {
                param($Request)
                [void]$script:Scenario.manifest_requests.Add($Request)
                if ([string]$Request.scope_id -ceq "project_business_candidates_before") { throw "injected manifest failure" }
                return Invoke-FoundationDefaultManifestProvider $Request
            }
        }
        elseif ($Case.id -in @("RED-OPENCLAW-003", "RED-OPENCLAW-004")) {
            $manifestProvider = {
                param($Request)
                [void]$script:Scenario.manifest_requests.Add($Request)
                return Invoke-FoundationDefaultManifestProvider $Request
            }
        }
        if ($Case.id -eq "RED-REPORT-004") {
            $reportPublisher = {
                param($Request)
                [void]$script:Scenario.publisher_requests.Add($Request)
                [void]$script:Scenario.publisher_report_snapshots.Add([Convert]::ToBase64String([byte[]]$Request.json_record.bytes))
                return [pscustomobject]@{ success = $false; json_path = $null; json_sha256 = $null; artifact_results = @() }
            }
        }
        $report = Invoke-CoreForScenario $fixture $scenario $manifestProvider $reportPublisher
        $observationDigests = Assert-OfficialObservationPair $report $fixture $Case.id
        $after = Get-FileSnapshot $fixture.seed_paths
        $guardAfter = Get-FileSnapshot $fixture.guard_paths
        $preHash = [string]$observationDigests.pre_state_hash
        $postHash = [string]$observationDigests.post_state_hash

        Assert-BasicReport $report
        if ($report.verdict -eq "failed") {
            Assert-FaultFieldShape $report
            $nonCommandFault = Get-NonCommandFaultExpectation $Case.id
            if ($null -ne $nonCommandFault) {
                Assert-ConcreteFaultFields $report $nonCommandFault.injection $nonCommandFault.code $preHash $postHash $nonCommandFault.added $nonCommandFault.modified $nonCommandFault.deleted
            }
        }
        if ($Case.id -eq "RED-ROOT-001") {
            $officialRoots = @($report.roots.official_data_roots)
            Assert-Equal 3 $officialRoots.Count "Official data root count"
            $expectedRoots = @{
                A = [System.IO.Path]::GetFullPath((Join-Path $fixture.project "version-a-skill-only\data"))
                B = [System.IO.Path]::GetFullPath((Join-Path $fixture.project "version-b-lite-plugin\data"))
                C = [System.IO.Path]::GetFullPath((Join-Path $fixture.project "version-c-strict-plugin\data"))
            }
            Assert-Equal "A|B|C" (Get-OrdinalIgnoreCaseSignature @($officialRoots | ForEach-Object { [string]$_.route })) "Official route IDs"
            foreach ($entry in $officialRoots) {
                $route = [string]$entry.route
                Assert-True ($expectedRoots.ContainsKey($route)) "Unexpected official route ID: $route"
                Assert-True ([System.IO.Path]::IsPathRooted([string]$entry.path)) "Official root is not absolute: $route"
                Assert-Equal $expectedRoots[$route] ([System.IO.Path]::GetFullPath([string]$entry.path)) "Official root path for $route"
                Assert-Equal "fixed_project_layout" ([string]$entry.source) "Official root source for $route"
            }
            for ($left = 0; $left -lt $officialRoots.Count; $left++) {
                for ($right = 0; $right -lt $officialRoots.Count; $right++) {
                    if ($left -eq $right) { continue }
                    $leftPath = [System.IO.Path]::GetFullPath([string]$officialRoots[$left].path).TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
                    $rightPath = [System.IO.Path]::GetFullPath([string]$officialRoots[$right].path).TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
                    Assert-True (-not $rightPath.StartsWith($leftPath, [System.StringComparison]::OrdinalIgnoreCase)) "Official roots are nested"
                }
            }
        }
        elseif ($Case.id -eq "RED-ROOT-006") {
            $text = Get-ReportText $report
            Assert-True ($text -notmatch [regex]::Escape($fixture.external)) "Forged official root was adopted"
            Invoke-ProductionEntryContractTest $fixture
        }
        elseif ($Case.id -eq "RED-MANIFEST-001") {
            Assert-Equal "failed" $report.verdict "Temporary business candidate verdict"
            Assert-True ([int]$report.exit_code -ne 0) "Temporary business candidate exit code"
            $ignoredNodeModulesPath = [System.IO.Path]::GetFullPath((Join-Path $fixture.project "version-b-lite-plugin\node_modules\ignored.sqlite"))
            $distPath = [System.IO.Path]::GetFullPath((Join-Path $fixture.project "version-c-strict-plugin\dist\must-scan.SQLITE-WAL"))
            foreach ($officialObservation in @($report.manifests.official.before, $report.manifests.official.after)) {
                $officialEntries = @($officialObservation.entries)
                Assert-Equal 15 $officialEntries.Count "Official manifest seeded entry count: $($officialObservation.scope_id)"
                foreach ($path in $fixture.official_seed_paths) {
                    $expectedPath = [System.IO.Path]::GetFullPath($path)
                    Assert-Equal 1 @($officialEntries | Where-Object { ([string]$_.full_path).Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase) }).Count "Official manifest seed: $($officialObservation.scope_id)/$path"
                }
                Assert-Equal 0 @($officialEntries | Where-Object { ([string]$_.full_path).Equals($distPath, [System.StringComparison]::OrdinalIgnoreCase) }).Count "Official manifest included dist: $($officialObservation.scope_id)"
                Assert-Equal 0 @($officialEntries | Where-Object { ([string]$_.full_path).Equals($ignoredNodeModulesPath, [System.StringComparison]::OrdinalIgnoreCase) }).Count "Official manifest included ordinary node_modules: $($officialObservation.scope_id)"
            }

            foreach ($projectObservation in @($report.manifests.project_business_candidates.before, $report.manifests.project_business_candidates.after)) {
                $projectEntries = @($projectObservation.entries)
                Assert-Equal 16 $projectEntries.Count "Project candidate seeded entry count: $($projectObservation.scope_id)"
                foreach ($path in $fixture.seed_paths) {
                    $expectedPath = [System.IO.Path]::GetFullPath($path)
                    Assert-Equal 1 @($projectEntries | Where-Object { ([string]$_.full_path).Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase) }).Count "Project candidate seed: $($projectObservation.scope_id)/$path"
                }
                Assert-Equal 0 @($projectEntries | Where-Object { ([string]$_.full_path).Equals($ignoredNodeModulesPath, [System.StringComparison]::OrdinalIgnoreCase) }).Count "Project candidate included ordinary node_modules: $($projectObservation.scope_id)"
                $distEntries = @($projectEntries | Where-Object { ([string]$_.full_path).Equals($distPath, [System.StringComparison]::OrdinalIgnoreCase) })
                Assert-Equal 1 $distEntries.Count "Project dist candidate count: $($projectObservation.scope_id)"
                Assert-Equal "business_candidate" ([string]$distEntries[0].classification) "Project dist classification: $($projectObservation.scope_id)"
                Assert-Equal "sidecar" ([string]$distEntries[0].candidate_kind) "Project dist candidate kind: $($projectObservation.scope_id)"
                Assert-Equal "PROJECT_ROOT|ROUTE_C" (Get-OrdinalIgnoreCaseSignature @($distEntries[0].root_labels)) "Project dist root labels: $($projectObservation.scope_id)"
            }

            $sourceDist = $report.manifests.source_dist
            Assert-True (-not ($sourceDist -is [System.Array])) "Manifest coverage source dist must be a keyed object"
            Assert-Equal "B|C" (Get-OrdinalIgnoreCaseSignature @($sourceDist.PSObject.Properties.Name)) "Manifest coverage source dist route keys"
            $sourceDistC = $sourceDist.C
            Assert-True ($null -ne $sourceDistC) "C source dist report missing"
            foreach ($sourceObservation in @($sourceDistC.before, $sourceDistC.after)) {
                $sourceDistEntries = @($sourceObservation.entries | Where-Object { ([string]$_.full_path).Equals($distPath, [System.StringComparison]::OrdinalIgnoreCase) })
                Assert-Equal 1 $sourceDistEntries.Count "C source dist candidate count: $($sourceObservation.scope_id)"
                Assert-Equal "business_candidate" ([string]$sourceDistEntries[0].classification) "C source dist classification: $($sourceObservation.scope_id)"
                Assert-Equal "sidecar" ([string]$sourceDistEntries[0].candidate_kind) "C source dist candidate kind: $($sourceObservation.scope_id)"
            }
            $layerObservations = @(
                [pscustomobject]@{ label = "official_before"; value = $report.manifests.official.before },
                [pscustomobject]@{ label = "official_after"; value = $report.manifests.official.after },
                [pscustomobject]@{ label = "project_before"; value = $report.manifests.project_business_candidates.before },
                [pscustomobject]@{ label = "project_after"; value = $report.manifests.project_business_candidates.after },
                [pscustomobject]@{ label = "source_dist_C_before"; value = $sourceDistC.before },
                [pscustomobject]@{ label = "source_dist_C_after"; value = $sourceDistC.after }
            )
            for ($leftIndex = 0; $leftIndex -lt $layerObservations.Count; $leftIndex++) {
                for ($rightIndex = $leftIndex + 1; $rightIndex -lt $layerObservations.Count; $rightIndex++) {
                    Assert-True (-not [object]::ReferenceEquals($layerObservations[$leftIndex].value, $layerObservations[$rightIndex].value)) "Manifest layer object reused: $($layerObservations[$leftIndex].label)/$($layerObservations[$rightIndex].label)"
                }
            }
            Assert-EmptyDiff $report.manifests.project_business_candidates.diff "Project candidate manifest"
            Assert-SourceDistReportEmpty $report $fixture "Manifest coverage"
            Assert-Equal 3 @($scenario.runtime_candidate_records).Count "Temporary business candidate fixture count"
            foreach ($record in @($scenario.runtime_candidate_records)) {
                $rootReport = @($report.temporary_roots | Where-Object { $_.root_id -eq $record.root_id })
                Assert-Equal 1 $rootReport.Count "Temporary root report for candidate: $($record.root_id)"
                $runtimeEntries = @($rootReport[0].pre_delete_audit.entries)
                $runtimeMatch = @($runtimeEntries | Where-Object { ([string]$_.full_path).Equals([string]$record.full_path, [System.StringComparison]::OrdinalIgnoreCase) })
                Assert-Equal 1 $runtimeMatch.Count "Temporary business candidate entry: $($record.root_id)"
                Assert-Equal "business_candidate" ([string]$runtimeMatch[0].classification) "Temporary business candidate classification: $($record.root_id)"
                Assert-Equal ([string]$record.sha256) ([string]$runtimeMatch[0].sha256) "Temporary business candidate SHA-256: $($record.root_id)"
                Assert-True (@($runtimeMatch[0].root_labels) -contains [string]$record.root_id) "Temporary business candidate root label: $($record.root_id)"
            }
            Invoke-RegisteredSnapshotManifestExclusionVariant $fixture
        }
        elseif ($Case.id -eq "RED-MANIFEST-002") {
            Assert-SnapshotsEqual $before $after "Successful physical seeded files"
            Assert-Equal "passed" $report.verdict "Successful verdict"
            Assert-EmptyDiff $report.manifests.official.diff "Successful official data"
            Assert-EmptyDiff $report.manifests.project_business_candidates.diff "Successful project candidates"
            Assert-SourceDistReportEmpty $report $fixture "Successful source dist"
        }
        elseif ($Case.id -eq "RED-MANIFEST-003") {
            Assert-Equal "failed" $report.verdict "Modified verdict"
            $modifiedEntries = @($report.manifests.official.diff.modified)
            Assert-Equal 1 $modifiedEntries.Count "Modified target count"
            Assert-Equal ([System.IO.Path]::GetFullPath($scenario.mutation_path)) ([System.IO.Path]::GetFullPath([string]$modifiedEntries[0].full_path)) "Modified target path"
            $projectModifiedEntries = @($report.manifests.project_business_candidates.diff.modified)
            Assert-Equal 1 $projectModifiedEntries.Count "Project modified target count"
            Assert-Equal ([System.IO.Path]::GetFullPath($scenario.mutation_path)) ([System.IO.Path]::GetFullPath([string]$projectModifiedEntries[0].full_path)) "Project modified target path"
            Assert-Equal "business" ([string]$projectModifiedEntries[0].after.candidate_kind) "Project modified target kind"
            Assert-True (-not [object]::ReferenceEquals($report.manifests.official.after, $report.manifests.project_business_candidates.after)) "Modified official after reused project after"
        }
        elseif ($Case.id -eq "RED-MANIFEST-004") {
            Assert-Equal "failed" $report.verdict "Added verdict"
            $addedEntries = @($report.manifests.official.diff.added)
            Assert-Equal 1 $addedEntries.Count "Added target count"
            Assert-Equal ([System.IO.Path]::GetFullPath($scenario.mutation_path)) ([System.IO.Path]::GetFullPath([string]$addedEntries[0].full_path)) "Added target path"
            $projectAddedEntries = @($report.manifests.project_business_candidates.diff.added)
            Assert-Equal 1 $projectAddedEntries.Count "Project added target count"
            Assert-Equal ([System.IO.Path]::GetFullPath($scenario.mutation_path)) ([System.IO.Path]::GetFullPath([string]$projectAddedEntries[0].full_path)) "Project added target path"
            Assert-Equal "sidecar" ([string]$projectAddedEntries[0].candidate_kind) "Project added target kind"
            Assert-Equal 1 @($report.errors | Where-Object { [string]$_.code -ceq "PROJECT_BUSINESS_CANDIDATE_ADDED" }).Count "Project added stable error count"
            Invoke-ProjectOnlyCandidateVariant
        }
        elseif ($Case.id -eq "RED-MANIFEST-005") {
            Assert-Equal "failed" $report.verdict "Deleted verdict"
            $deletedEntries = @($report.manifests.official.diff.deleted)
            Assert-Equal 1 $deletedEntries.Count "Deleted target count"
            Assert-Equal ([System.IO.Path]::GetFullPath($scenario.mutation_path)) ([System.IO.Path]::GetFullPath([string]$deletedEntries[0].full_path)) "Deleted target path"
            $projectDeletedEntries = @($report.manifests.project_business_candidates.diff.deleted)
            Assert-Equal 1 $projectDeletedEntries.Count "Project deleted target count"
            Assert-Equal ([System.IO.Path]::GetFullPath($scenario.mutation_path)) ([System.IO.Path]::GetFullPath([string]$projectDeletedEntries[0].full_path)) "Project deleted target path"
            Assert-Equal "sidecar" ([string]$projectDeletedEntries[0].candidate_kind) "Project deleted target kind"
            Assert-Equal 1 @($report.errors | Where-Object { [string]$_.code -ceq "PROJECT_BUSINESS_CANDIDATE_DELETED" }).Count "Project deleted stable error count"
        }
        elseif ($Case.id -eq "RED-MANIFEST-006") {
            Assert-Equal "failed" $report.verdict "Manifest failure verdict"
            $manifestErrors = @($report.errors | Where-Object { [string]$_.code -ceq "manifest_failed" })
            Assert-Equal 1 $manifestErrors.Count "Structured manifest failure count"
            Assert-Equal "project_business_candidates_before" ([string]$manifestErrors[0].scope_id) "Structured manifest failure scope"
            Assert-Equal "manifest" ([string]$manifestErrors[0].category) "Structured manifest failure category"
            Assert-True ([string]$manifestErrors[0].message).Contains("injected manifest failure") "Structured manifest failure original message"
            Invoke-InvalidManifestProviderVariants
            Assert-True ([bool]$report.environment.restored) "Environment was not restored after manifest failure"
            $scopeIds = @($scenario.manifest_requests | ForEach-Object { [string]$_.scope_id })
            Assert-Equal 1 @($scopeIds | Where-Object { $_ -ceq "project_business_candidates_before" }).Count "Injected project before request count"
            Assert-Equal 1 @($scopeIds | Where-Object { $_ -ceq "project_business_candidates_after" }).Count "Project after manifest did not continue"
            Assert-Equal 1 @($scopeIds | Where-Object { $_ -ceq "official_before" }).Count "Official before manifest did not continue"
            Assert-Equal 1 @($scopeIds | Where-Object { $_ -ceq "official_after" }).Count "Official after manifest did not continue"
            foreach ($route in @("B", "C")) {
                foreach ($phase in @("before", "after")) {
                    $scopeId = "source_dist_${route}_$phase"
                    Assert-Equal 1 @($scopeIds | Where-Object { $_ -ceq $scopeId }).Count "Source dist manifest did not continue: $scopeId"
                }
            }
            Assert-True (-not [bool]$report.manifests.project_business_candidates.before.completed) "Injected project before unexpectedly completed"
            Assert-True ([bool]$report.manifests.project_business_candidates.after.completed) "Project after manifest did not complete"
            Assert-EmptyDiff $report.manifests.project_business_candidates.diff "Unavailable project baseline"
            Assert-SourceDistReportEmpty $report $fixture "Manifest failure continuation"
            Assert-Equal 1 @($scopeIds | Where-Object { $_ -ceq "openclaw_pre_delete_audit" }).Count "OpenClaw pre-delete manifest did not continue"
            Assert-True ([bool]$report.openclaw_state.pre_delete_audit.completed) "OpenClaw pre-delete audit did not complete"
            Assert-Equal 4 @($report.temporary_roots).Count "Manifest failure temporary root count"
            foreach ($temporaryRoot in @($report.temporary_roots)) {
                $temporaryScope = "temporary_$($temporaryRoot.root_id)_pre_delete"
                if ([string]$temporaryRoot.root_id -ne "openclaw_state_root") {
                    Assert-Equal 1 @($scopeIds | Where-Object { $_ -ceq $temporaryScope }).Count "Temporary pre-delete manifest did not continue: $temporaryScope"
                }
                Assert-True ([bool]$temporaryRoot.pre_delete_audit.completed) "Temporary pre-delete audit did not complete: $($temporaryRoot.root_id)"
                Assert-True ([bool]$temporaryRoot.cleanup.attempted) "Temporary cleanup was not attempted: $($temporaryRoot.root_id)"
                Assert-True ([bool]$temporaryRoot.cleanup.succeeded) "Temporary cleanup did not succeed: $($temporaryRoot.root_id)"
                Assert-Equal 0 ([int]$temporaryRoot.physical_residual_count) "Temporary physical residual after manifest failure: $($temporaryRoot.root_id)"
            }
            Assert-Equal "verified" ([string]$report.environment.verification_status) "Manifest failure environment verification"
            Assert-True ([bool]$report.environment.caller_unchanged) "Manifest failure changed caller environment"
            Assert-True ([bool]$report.environment.restored) "Manifest failure compatibility restored field"
            Assert-Equal 4 @($scenario.cleanup_specs).Count "Four cleanup attempts did not continue after manifest failure"
        }
        elseif ($Case.id -like "RED-FAIL-*") {
            Assert-Equal "failed" $report.verdict "Injected command verdict"
            Assert-SnapshotsEqual $before $after "Failure-path official data"
            $command = @($report.commands | Where-Object { $_.id -eq $scenario.fail_command })[0]
            Assert-Equal $scenario.fail_exit $command.exit_code "Injected command exit"
            Assert-True ((Get-ReportText $command) -match [regex]::Escape($scenario.stderr)) "Raw stderr missing"
            $failedIndex = [array]::IndexOf(@($report.commands.id), $scenario.fail_command)
            for ($index = $failedIndex + 1; $index -lt @($report.commands).Count; $index++) {
                Assert-Equal "skipped" ([string]$report.commands[$index].status) "Post-failure command status for $($report.commands[$index].id)"
                Assert-Null $report.commands[$index].exit_code "Post-failure command exit for $($report.commands[$index].id)"
                Assert-Equal "prior_failure" ([string]$report.commands[$index].reason) "Post-failure command reason for $($report.commands[$index].id)"
            }
            Assert-True ([bool]$report.environment.caller_unchanged) "Caller environment changed on command failure"
            Assert-Equal 4 @($report.temporary_roots).Count "Failure cleanup result count"
            Assert-FaultFields $report $scenario.fail_command ([string]$scenario.fail_exit) $preHash $postHash
            if ($Case.id -in @("RED-FAIL-003", "RED-FAIL-007")) {
                Assert-SourceDistReportEmpty $report $fixture "Command failure"
            }
            if ($Case.id -in @("RED-FAIL-004", "RED-FAIL-008")) {
                Assert-True ([bool]$report.openclaw_state.pre_delete_audit.completed) "OpenClaw pre-delete audit was not completed on plugin failure"
            }
            if ($Case.id -eq "RED-FAIL-008") {
                Assert-True ($null -ne $report.openclaw_state.cleanup) "OpenClaw cleanup result missing on C plugin-build failure"
            }
            if ($Case.id -eq "RED-FAIL-009") {
                Assert-Equal 9 @($report.commands).Count "Final command failure lost command objects"
                Assert-Equal 0 @($report.commands | Where-Object { $_.status -eq "skipped" }).Count "Final command failure unexpectedly skipped a command"
            }
        }
        elseif ($Case.id -like "RED-BUILD-*") {
            $buildSpecs = @($scenario.observed_specs | Where-Object { $_.stage -eq "build" })
            if ($Case.id -eq "RED-BUILD-001") {
                $aSpecs = @($scenario.observed_specs | Where-Object { [string]$_.id -ceq "A.structure" })
                Assert-Equal 1 $aSpecs.Count "BUILD-001 A.structure spec count"
                Assert-ExactAStructureSpec $aSpecs[0] $scenario
                $nodeSpecs = @($scenario.observed_specs | Where-Object { [string]$_.route -in @("B", "C") })
                Assert-Equal 8 $nodeSpecs.Count "BUILD-001 Node command count"
                foreach ($nodeSpec in $nodeSpecs) { Assert-ExactNodeCommandSpec $nodeSpec $scenario }
                Assert-FrozenPolicyBootstrap $report $scenario "BUILD-001"
                Assert-Equal 2 $buildSpecs.Count "Successful build command spec count"
                Assert-Equal 2 @($scenario.build_outputs).Count "Successful external build output count"
                Assert-Equal "B|C" (Get-OrdinalIgnoreCaseSignature @($scenario.build_output_records | ForEach-Object { ([string]$_.command_id).Substring(0, 1) })) "Successful build output routes"
            }
            else {
                Assert-True ($buildSpecs.Count -ge 1) "Failure scenario did not execute a build spec"
                Assert-True (@($scenario.build_outputs).Count -ge 1) "Failure scenario did not create a partial external build output"
            }
            foreach ($spec in $buildSpecs) {
                $arguments = @($spec.arguments)
                $outIndexes = @()
                for ($argumentIndex = 0; $argumentIndex -lt $arguments.Count; $argumentIndex++) {
                    if ($arguments[$argumentIndex] -eq "--outDir") { $outIndexes += $argumentIndex }
                }
                Assert-Equal 1 $outIndexes.Count "--outDir occurrence count for $($spec.id)"
                Assert-True (($outIndexes[0] + 1) -lt $arguments.Count) "--outDir value missing for $($spec.id)"
                [void](Resolve-TestHarnessPathUnderRunRoot $scenario "build_root" ([string]$arguments[$outIndexes[0] + 1]))
            }
            foreach ($output in @($scenario.build_outputs)) {
                Assert-True (-not $output.StartsWith($fixture.project, [System.StringComparison]::OrdinalIgnoreCase)) "Build output entered source tree"
            }
            Assert-Equal @($scenario.build_outputs).Count @($scenario.build_output_records).Count "Captured build output record count"
            foreach ($record in @($scenario.build_output_records)) {
                Assert-Equal 23 ([long]$record.length) "Captured build output length for $($record.command_id)"
                Assert-Equal (Get-TextSha256 "external build artifact") ([string]$record.sha256) "Captured build output SHA-256 for $($record.command_id)"
                [void](Resolve-TestHarnessPathUnderRunRoot $scenario "build_root" ([string]$record.cwd))
                [void](Resolve-TestHarnessPathUnderRunRoot $scenario "build_root" ([string]$record.out_dir))
            }
            Assert-SourceDistReportEmpty $report $fixture "Build scenario"
            Assert-Equal 4 @($scenario.cleanup_specs).Count "Build failure cleanup result count"
            Assert-True ($null -ne $report.openclaw_state.pre_delete_audit) "Build failure OpenClaw audit missing"
            if ($Case.id -eq "RED-BUILD-002") {
                Assert-FaultFields $report "B.build" "43" $preHash $postHash
            }
        }
        elseif ($Case.id -like "RED-STAGING-*") {
            $text = Get-ReportText $report
            if ($Case.id -eq "RED-STAGING-001") {
                Assert-True ($text -match "BC1E4E174A7B9DC9AB176ACA0039F96ED9F47F9A722BAF7B8A0D927897A0B7FE") "Frozen typebox tree hash missing"
                Assert-True ($text -match '"file_count":1367') "Frozen typebox file count missing"
                Assert-True ($text -match '"total_bytes":1468384') "Frozen typebox byte count missing"
                Assert-Equal 4 @($scenario.observed_specs | Where-Object { $_.stage -like "plugin*" }).Count "Plugin stages did not execute with valid staging"
                Assert-Equal 4 @($scenario.staging_audits).Count "Independent staging audit count"
                Assert-Equal "B|B|C|C" (Get-OrdinalIgnoreCaseSignature @($scenario.staging_audits | ForEach-Object { [string]$_.route })) "Independent staging audit routes"
                foreach ($audit in @($scenario.staging_audits)) {
                    Assert-Equal "DIST|NODE_MODULES|OPENCLAW.PLUGIN.JSON|PACKAGE.JSON|SKILLS|SRC|TESTS|TSCONFIG.JSON" (Get-OrdinalIgnoreCaseSignature @($audit.top_level_names)) "Staging top-level allowlist for $($audit.command_id)"
                    Assert-Equal "TYPEBOX" (Get-OrdinalIgnoreCaseSignature @($audit.node_modules_names)) "Staging node_modules allowlist for $($audit.command_id)"
                    Assert-True (-not [bool]$audit.typebox_is_reparse) "Staged typebox was a reparse point"
                    Assert-Equal 1367 ([int]$audit.typebox_file_count) "Staged typebox file count"
                    Assert-Equal 1468384 ([long]$audit.typebox_total_bytes) "Staged typebox total bytes"
                    Assert-Equal "BC1E4E174A7B9DC9AB176ACA0039F96ED9F47F9A722BAF7B8A0D927897A0B7FE" ([string]$audit.typebox_tree_sha256) "Staged typebox tree SHA-256"
                    Assert-Equal "1E10166E4B3DD7718186CD458EEED35FA674752E51E87663100CA9068DB89E63" ([string]$audit.typebox_package_sha256) "Staged typebox package SHA-256"
                    Assert-Equal ".\dist\index.js" ([string]$audit.openclaw_entry_argument).Replace("/", "\") "Staged OpenClaw entry"
                }
            }
            else {
                Assert-Equal "failed" $report.verdict "Invalid staging verdict"
                Assert-True ($text -match "RUNTIME_IDENTITY_INVALID") "Stable runtime identity error missing"
                Assert-Equal 0 @($scenario.observed_specs | Where-Object { $_.stage -like "plugin*" }).Count "Plugin stage executed with invalid staging"
                Assert-Equal 4 @($scenario.cleanup_specs).Count "Invalid staging cleanup result count"
                Assert-True ($null -ne $report.manifests.official.after) "Invalid staging after manifest missing"
                Invoke-AdditionalInvalidStagingVariant "missing"
                Invoke-AdditionalInvalidStagingVariant "wrong_junction_target"
            }
        }
        elseif ($Case.id -eq "RED-CACHE-001") {
            Assert-ScenarioTypeboxEvidence $fixture $scenario $report 4 "CACHE-001"
            $aSpecs = @($scenario.observed_specs | Where-Object { [string]$_.id -ceq "A.structure" })
            Assert-Equal 1 $aSpecs.Count "CACHE-001 A.structure spec count"
            Assert-ExactAStructureSpec $aSpecs[0] $scenario
            $nodeSpecs = @($scenario.observed_specs | Where-Object { $_.route -in @("B", "C") })
            Assert-Equal 8 $nodeSpecs.Count "B/C Node command spec count"
            $pluginSpecs = @($nodeSpecs | Where-Object { $_.stage -like "plugin*" })
            $nonPluginSpecs = @($nodeSpecs | Where-Object { $_.stage -notlike "plugin*" })
            Assert-Equal 4 $pluginSpecs.Count "Plugin command spec count"
            Assert-Equal 4 $nonPluginSpecs.Count "Non-plugin Node command spec count"
            foreach ($spec in $nonPluginSpecs) {
                Assert-ExactNodeCommandSpec $spec $scenario
            }
            foreach ($spec in $pluginSpecs) {
                Assert-ExactNodeCommandSpec $spec $scenario
            }
            Assert-FrozenPolicyBootstrap $report $scenario "CACHE-001"
            foreach ($testSpec in @($nonPluginSpecs | Where-Object { [string]$_.stage -ceq "test" })) {
                $testCommand = @($report.commands | Where-Object { [string]$_.id -ceq [string]$testSpec.id })[0]
                Assert-VitestPolicyJournal $testCommand $testSpec "CACHE-001/$($testSpec.id)"
            }
            Invoke-StructuralTypeboxClosureMutationVariant $fixture
            Invoke-PhysicalPolicyJournalAuthorityVariant $fixture
            Invoke-PhysicalPolicyJournalReparseVariant
            Invoke-CleanRoomEnvironmentEchoTest $nonPluginSpecs[0] $fixture $false
            Invoke-CleanRoomEnvironmentEchoTest $pluginSpecs[0] $fixture $true
            Assert-SnapshotsEqual $guardBefore $guardAfter "Clean-room external guards"
            Assert-ExternalGuardReport $report $fixture $scenario $true
        }
        elseif ($Case.id -eq "RED-CACHE-002") {
            Assert-ExternalGuardReport $report $fixture $scenario $true
            Assert-SnapshotsEqual $guardBefore $guardAfter "Three external and two Vitest guard sentinels"
            Assert-Equal "passed" $report.verdict "Unchanged guard verdict"
        }
        elseif ($Case.id -eq "RED-CACHE-003") {
            Assert-ExternalGuardReport $report $fixture $scenario $false
            Assert-Equal "failed" $report.verdict "External guard mutation verdict"
            Assert-True (Test-Path -LiteralPath $scenario.guard_mutation_path -PathType Leaf) "Validator repaired or deleted the external guard mutation"
            $jitiGuard = @($report.external_guards | Where-Object { $_.guard_id -eq "jiti_openclaw_cache_guard" })[0]
            Assert-Equal 1 @($jitiGuard.diff.added).Count "JITI guard added count"
            Assert-Equal ([System.IO.Path]::GetFullPath($scenario.guard_mutation_path)) ([System.IO.Path]::GetFullPath([string]$jitiGuard.diff.added[0].full_path)) "JITI guard added path"
        }
        elseif ($Case.id -eq "RED-CACHE-VITEST-001") {
            Assert-Equal "passed" ([string]$report.verdict) "Vitest normal main scenario verdict"
            Assert-ExternalGuardReport $report $fixture $scenario $true
            Assert-SnapshotsEqual $guardBefore $guardAfter "Vitest normal main external guards"
            Assert-Equal 0 @($scenario.vitest_env_poison_paths).Count "Vitest normal main poison path count"
            Assert-ScenarioTypeboxEvidence $fixture $scenario $report 4 "CACHE-VITEST-001"
            $testSpecs = @($scenario.observed_specs | Where-Object { [string]$_.id -in @("B.test", "C.test") })
            Assert-Equal 2 $testSpecs.Count "Vitest normal main test spec count"
            Assert-Equal "B.test|C.test" (@($testSpecs | ForEach-Object { [string]$_.id }) -join "|") "Vitest normal main test spec order"
            foreach ($testSpec in $testSpecs) {
                Assert-ExactNodeCommandSpec $testSpec $scenario
                $testCommands = @($report.commands | Where-Object { [string]$_.id -ceq [string]$testSpec.id })
                Assert-Equal 1 $testCommands.Count "Vitest normal main command row: $($testSpec.id)"
                Assert-Equal "passed" ([string]$testCommands[0].status) "Vitest normal main command status: $($testSpec.id)"
                Assert-VitestPolicyJournal $testCommands[0] $testSpec "CACHE-VITEST-001/$($testSpec.id)"
            }
            Assert-FrozenPolicyBootstrap $report $scenario "CACHE-VITEST-001"
            Assert-Equal 4 @($scenario.cleanup_specs).Count "Vitest normal main cleanup attempt count"
            foreach ($temporaryRoot in @($report.temporary_roots)) {
                Assert-True ([bool]$temporaryRoot.cleanup.attempted) "Vitest normal main cleanup was not attempted: $($temporaryRoot.root_id)"
                Assert-True ([bool]$temporaryRoot.cleanup.succeeded) "Vitest normal main cleanup failed: $($temporaryRoot.root_id)"
                Assert-Equal 0 ([int]$temporaryRoot.physical_residual_count) "Vitest normal main physical residual: $($temporaryRoot.root_id)"
            }
            Invoke-VitestStagingEnvironmentPoisonVariant "B"
            Invoke-VitestStagingEnvironmentPoisonVariant "C"
        }
        elseif ($Case.id -eq "RED-CACHE-VITEST-002") {
            Assert-ExternalGuardReport $report $fixture $scenario $false
            Assert-Equal "failed" $report.verdict "Vitest cache guard mutation verdict"
            foreach ($route in @("B", "C")) {
                $mutationPath = [string]$scenario.guard_mutation_paths["$route.test"]
                Assert-True (Test-Path -LiteralPath $mutationPath -PathType Leaf) "Validator repaired or deleted the $route Vitest cache mutation"
                $guardId = "vitest_" + $route.ToLowerInvariant() + "_cache_guard"
                $vitestGuard = @($report.external_guards | Where-Object { $_.guard_id -eq $guardId })[0]
                Assert-Equal 1 @($vitestGuard.diff.added).Count "$route Vitest guard added count"
                Assert-Equal ([System.IO.Path]::GetFullPath($mutationPath)) ([System.IO.Path]::GetFullPath([string]$vitestGuard.diff.added[0].full_path)) "$route Vitest guard added path"
            }
        }
        elseif ($Case.id -eq "RED-ENV-NODE-001") {
            $nodeSpecs = @($scenario.observed_specs | Where-Object { $_.route -in @("B", "C") })
            Assert-Equal 8 $nodeSpecs.Count "Poisoned Node command spec count"
            foreach ($spec in $nodeSpecs) {
                Assert-ExactNodeCommandSpec $spec $scenario
                $childNames = @(Get-TestSpecParentEnvironmentEntries $spec | ForEach-Object { [string]$_.name })
                foreach ($name in $poisonNames) {
                    Assert-True ($childNames -notcontains $name) "Poisoned Node key leaked to child $($spec.id): $name"
                }
                if ([string]$spec.stage -ceq "test") {
                    $command = @($report.commands | Where-Object { [string]$_.id -ceq [string]$spec.id })[0]
                    Assert-VitestPolicyJournal $command $spec "ENV-NODE-001/$($spec.id)"
                }
            }
            $echoCommon = @($nodeSpecs | Where-Object { $_.stage -notlike "plugin*" })[0]
            $echoPlugin = @($nodeSpecs | Where-Object { $_.stage -like "plugin*" })[0]
            Invoke-CleanRoomEnvironmentEchoTest $echoCommon $fixture $false
            Invoke-CleanRoomEnvironmentEchoTest $echoPlugin $fixture $true
            Assert-FrozenPolicyBootstrap $report $scenario "ENV-NODE-001"
            Assert-ProcessEnvironmentStateEqual $poisonExpectedState $poisonNames "Poisoned Node caller environment"
            Assert-SnapshotsEqual $guardBefore $guardAfter "Poisoned Node external guards"
            Assert-ExternalGuardReport $report $fixture $scenario $true
        }
        elseif ($Case.id -eq "RED-ENV-OPENCLAW-001") {
            $pluginSpecs = @($scenario.observed_specs | Where-Object { $_.stage -like "plugin*" })
            Assert-Equal 4 $pluginSpecs.Count "Poisoned OpenClaw plugin spec count"
            foreach ($spec in $pluginSpecs) {
                Assert-ExactNodeCommandSpec $spec $scenario
                $childNames = @(Get-TestSpecParentEnvironmentEntries $spec | ForEach-Object { [string]$_.name })
                foreach ($name in $poisonNames) {
                    Assert-True ($childNames -notcontains $name) "Poisoned OpenClaw/JITI key leaked to child $($spec.id): $name"
                }
            }
            Invoke-CleanRoomEnvironmentEchoTest $pluginSpecs[0] $fixture $true
            Assert-FrozenPolicyBootstrap $report $scenario "ENV-OPENCLAW-001"
            Assert-ProcessEnvironmentStateEqual $poisonExpectedState $poisonNames "Poisoned OpenClaw caller environment"
            Assert-SnapshotsEqual $guardBefore $guardAfter "Poisoned OpenClaw external guards"
            Assert-ExternalGuardReport $report $fixture $scenario $true
        }
        elseif ($Case.id -like "RED-OPENCLAW-*") {
            $text = Get-ReportText $report.openclaw_state
            Assert-True ($text -match "pre_delete_audit") "OpenClaw pre-delete audit missing"
            if ($Case.id -eq "RED-OPENCLAW-003") {
                $policyEntries = @(Get-TestOpenClawPolicyAttestationEntries -Scenario $scenario -ExpectedCommandIds @("B.plugin_build_check", "B.plugin_validate", "C.plugin_build_check", "C.plugin_validate") -Label "RED-OPENCLAW-003")
                $expected = @(
                    [pscustomobject]@{ relative_path = "state\openclaw.sqlite"; classification = "openclaw_internal_tool_state"; sha256 = "3BED2CB3A3ACF7B6A8EF408420CC682D5520E26976D354254F528C965612054F"; length = 8; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_build_check" },
                    [pscustomobject]@{ relative_path = "state\openclaw.sqlite-wal"; classification = "openclaw_internal_tool_state"; sha256 = "D64BD5EA8ED66D699F80CA6F134144E377F1D03D6065B077927FB4819B913EF2"; length = 12; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" },
                    [pscustomobject]@{ relative_path = "logs\openclaw.log"; classification = "other"; sha256 = "DE28C97E992E70369FED2BA7AF4DA525F27FE29A632E5F1DDC7722C5A4201CA8"; length = 12; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" }
                ) + @($policyEntries)
                Assert-OpenClawAuditEntries $report $scenario $expected $true 2
                Assert-Equal "passed" $report.verdict "Allowlisted OpenClaw state verdict"
                Assert-Equal 0 ([int]$report.exit_code) "Allowlisted OpenClaw state exit code"
                Assert-Equal 0 ([int]$report.openclaw_state.cleanup.residual_count) "Allowlisted OpenClaw residual count"
                Assert-True ([bool]$report.openclaw_state.cleanup.succeeded) "Allowlisted OpenClaw cleanup did not succeed"
                Assert-True (-not (Test-Path -LiteralPath ([string]$scenario.allowed_run_roots.openclaw_state_root))) "Allowlisted OpenClaw root remained"
            }
            elseif ($Case.id -eq "RED-OPENCLAW-004") {
                $policyEntries = @(Get-TestOpenClawPolicyAttestationEntries -Scenario $scenario -ExpectedCommandIds @("B.plugin_build_check", "B.plugin_validate", "C.plugin_build_check", "C.plugin_validate") -Label "RED-OPENCLAW-004")
                $expected = @(
                    [pscustomobject]@{ relative_path = "state\openclaw.sqlite"; classification = "openclaw_internal_tool_state"; sha256 = "3BED2CB3A3ACF7B6A8EF408420CC682D5520E26976D354254F528C965612054F"; length = 8; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_build_check" },
                    [pscustomobject]@{ relative_path = "state\openclaw.sqlite-wal"; classification = "openclaw_internal_tool_state"; sha256 = "D64BD5EA8ED66D699F80CA6F134144E377F1D03D6065B077927FB4819B913EF2"; length = 12; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" },
                    [pscustomobject]@{ relative_path = "logs\openclaw.log"; classification = "other"; sha256 = "DE28C97E992E70369FED2BA7AF4DA525F27FE29A632E5F1DDC7722C5A4201CA8"; length = 12; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" },
                    [pscustomobject]@{ relative_path = "diet.sqlite"; classification = "business_candidate"; sha256 = "11D40417959631D3D2420E8CD8709893C11CD7A4DB737AF63E8D56CFA7866F85"; length = 8; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_build_check" },
                    [pscustomobject]@{ relative_path = "records.jsonl"; classification = "business_candidate"; sha256 = "11D40417959631D3D2420E8CD8709893C11CD7A4DB737AF63E8D56CFA7866F85"; length = 8; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" },
                    [pscustomobject]@{ relative_path = "cache.sqlite-wal"; classification = "business_candidate"; sha256 = "11D40417959631D3D2420E8CD8709893C11CD7A4DB737AF63E8D56CFA7866F85"; length = 8; last_write_time_utc = "2024-01-02T03:04:05Z"; creation_stage = "B.plugin_validate" }
                ) + @($policyEntries)
                Assert-OpenClawAuditEntries $report $scenario $expected $true 2
                Assert-Equal "failed" $report.verdict "Unexpected OpenClaw data verdict"
                foreach ($path in @($scenario.plugin_state_values)) {
                    Assert-True (-not (Test-Path -LiteralPath $path)) "OpenClaw run root was not cleaned: $path"
                }
                Invoke-OpenClawReviewVariants
            }
            elseif ($Case.id -eq "RED-OPENCLAW-001") {
                $policyEntries = @(Get-TestOpenClawPolicyAttestationEntries -Scenario $scenario -ExpectedCommandIds @("B.plugin_build_check", "B.plugin_validate") -Label "RED-OPENCLAW-001")
                $expected = @([pscustomobject]@{ relative_path = "cache.sqlite-wal"; classification = "business_candidate"; sha256 = "B25A8C59C81FD36A0CC6A89D4882BCBDBC39209C005033DA00F92BFAB51699D7"; creation_stage = "B.plugin_validate" }) + @($policyEntries)
                Assert-OpenClawAuditEntries $report $scenario $expected $false 1
                Assert-Equal "failed" $report.verdict "Unexpected OpenClaw data verdict"
                Assert-Equal 45 @($report.commands | Where-Object { $_.id -eq "B.plugin_validate" })[0].exit_code "OpenClaw injected command exit"
                Assert-FaultFields $report "B.plugin_validate" "45" $preHash $postHash
                Assert-True (-not (Test-Path -LiteralPath ([string]$scenario.allowed_run_roots.openclaw_state_root))) "Unexpected OpenClaw root remained"
            }
            elseif ($Case.id -eq "RED-OPENCLAW-002") {
                Assert-Equal "failed" $report.verdict "OpenClaw cleanup failure verdict"
                Assert-Equal 41 @($report.commands | Where-Object { $_.id -eq "A.structure" })[0].exit_code "Primary command exit was replaced"
                $cleanupResult = @($report.temporary_roots | Where-Object { $_.root_id -eq "openclaw_state_root" })[0]
                Assert-True ([int]$cleanupResult.cleanup.residual_count -gt 0) "OpenClaw cleanup failure cleanup residual missing"
                Assert-True ([int]$cleanupResult.physical_residual_count -gt 0) "OpenClaw cleanup failure physical residual missing"
                Assert-Equal @($cleanupResult.physical_residual_entries).Count ([int]$cleanupResult.physical_residual_count) "OpenClaw cleanup failure physical residual entry count"
                $errorsText = Get-ReportText $report.errors
                Assert-True ($errorsText -match "primary command failure") "Primary command error missing"
                Assert-True ($errorsText -match "TEST_CLEANUP_FAILURE") "OpenClaw cleanup error missing"
                Assert-True ([bool]$report.environment.caller_unchanged) "Caller environment changed on OpenClaw cleanup failure"
                Assert-EnvironmentReadOnlyAudit $report $scenario $true
                Assert-FaultFields $report "A.structure" "41" $preHash $postHash
            }
        }
        elseif ($Case.id -eq "RED-TEMP-001") {
            $expectedCleanupOrder = @("isolated_test_root", "validation_root", "build_root", "openclaw_state_root")
            foreach ($rootId in @("isolated_test_root", "validation_root", "build_root", "openclaw_state_root")) {
                $subFixture = New-TestFixture
                $subTempState = Get-ProcessEnvironmentState @("TEMP", "TMP", "TMPDIR")
                try {
                    foreach ($tempName in @("TEMP", "TMP", "TMPDIR")) { [Environment]::SetEnvironmentVariable($tempName, $subFixture.base, "Process") }
                    $subScenario = New-ScenarioState $Case.id $subFixture
                    $subScenario.cleanup_failure = $rootId
                    $subScenario.cleanup_failure_adapter_residual_count = 0
                    $subOfficialBefore = Get-FileSnapshot $subFixture.seed_paths
                    $subReport = Invoke-CoreForScenario $subFixture $subScenario $null $null
                    $subObservationDigests = Assert-OfficialObservationPair $subReport $subFixture "RED-TEMP-001 $rootId"
                    $subOfficialAfter = Get-FileSnapshot $subFixture.seed_paths
                    Assert-SnapshotsEqual $subOfficialBefore $subOfficialAfter "RED-TEMP-001 $rootId physical official fixture"
                    Assert-Equal "failed" $subReport.verdict "$rootId cleanup failure verdict"
                    Assert-FaultFieldShape $subReport
                    Assert-ConcreteFaultFields $subReport "cleanup:$rootId" "TEMP_ROOT_CLEANUP_FAILED" $subObservationDigests.pre_state_hash $subObservationDigests.post_state_hash 0 0 0
                    Assert-Equal 4 @($subScenario.cleanup_specs).Count "$rootId cleanup attempt count"
                    Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedCleanupOrder) (Get-OrdinalIgnoreCaseSignature @($subScenario.cleanup_specs | ForEach-Object { [string]$_.root_id })) "$rootId cleanup root set"
                    Assert-Equal ($expectedCleanupOrder -join "|") (@($subScenario.cleanup_specs | ForEach-Object { [string]$_.root_id }) -join "|") "$rootId cleanup order"
                    $rootResults = @($subReport.temporary_roots)
                    Assert-Equal 4 $rootResults.Count "$rootId temporary root result count"
                    $failedRoot = @($rootResults | Where-Object { $_.root_id -eq $rootId })
                    Assert-Equal 1 $failedRoot.Count "$rootId failed root result"
                    Assert-True ([bool]$failedRoot[0].cleanup.attempted) "$rootId cleanup was not attempted"
                    Assert-Equal 0 ([int]$failedRoot[0].cleanup.residual_count) "$rootId adapter lie-zero residual count"
                    Assert-True ([int]$failedRoot[0].physical_residual_count -gt 0) "$rootId physical residual count"
                    Assert-Equal @($failedRoot[0].physical_residual_entries).Count ([int]$failedRoot[0].physical_residual_count) "$rootId physical residual entry count"
                    Assert-True (-not [bool]$failedRoot[0].cleanup.succeeded) "$rootId cleanup unexpectedly succeeded"
                    Assert-ExactErrorCodeCount $subReport.errors "TEMP_ROOT_CLEANUP_FAILED" 1 "$rootId stable cleanup error count"
                    foreach ($otherRoot in @($rootResults | Where-Object { $_.root_id -ne $rootId })) {
                        Assert-True ([bool]$otherRoot.cleanup.attempted) "$rootId prevented cleanup attempt for $($otherRoot.root_id)"
                        Assert-Equal 0 ([int]$otherRoot.physical_residual_count) "$rootId caused physical residual in $($otherRoot.root_id)"
                    }
                }
                finally {
                    Restore-ProcessEnvironmentState $subTempState
                    Remove-TestFixture $subFixture
                }
            }
            Invoke-TemporaryResidualJunctionVariant
        }
        elseif ($Case.id -eq "RED-ENV-001") {
            Assert-Equal "C:\forbidden\caller-state" ([Environment]::GetEnvironmentVariable("OPENCLAW_STATE_DIR", "Process")) "Caller state value changed"
            foreach ($value in @($scenario.plugin_state_values)) {
                Assert-True ($value -ne "C:\forbidden\caller-state") "Plugin observed caller state"
            }
            Assert-True (-not [bool]$report.environment.mutation_attempted) "Core reported a caller environment mutation attempt"
            Assert-True ([bool]$report.environment.caller_unchanged) "Caller environment was not unchanged"
            Assert-True ([bool]$report.environment.restored) "Compatibility restored field was not true"
            Assert-EnvironmentReadOnlyAudit $report $scenario $true
            Assert-Equal 4 @($scenario.plugin_state_values).Count "Controlled plugin state value count"
            foreach ($value in @($scenario.plugin_state_values)) {
                Assert-Equal ([System.IO.Path]::GetFullPath([string]$scenario.allowed_run_roots.openclaw_state_root)) ([System.IO.Path]::GetFullPath([string]$value)) "Controlled plugin state value"
            }
        }
        elseif ($Case.id -eq "RED-ENV-002") {
            Assert-True (-not (Test-Path Env:OPENCLAW_STATE_DIR)) "Absent caller state variable was created"
            Assert-True (-not [bool]$report.environment.mutation_attempted) "Core reported a caller environment mutation attempt"
            Assert-True ([bool]$report.environment.caller_unchanged) "Absent caller environment item changed"
            Assert-True ([bool]$report.environment.restored) "Compatibility restored field was not true"
            Assert-Equal 4 @($scenario.plugin_state_values).Count "Plugin controlled state observation count"
            foreach ($value in @($scenario.plugin_state_values)) {
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$value)) "Plugin did not receive a controlled state root"
                Assert-Equal ([System.IO.Path]::GetFullPath([string]$scenario.allowed_run_roots.openclaw_state_root)) ([System.IO.Path]::GetFullPath([string]$value)) "Absent-case controlled plugin state value"
            }
            Assert-EnvironmentReadOnlyAudit $report $scenario $true
        }
        elseif ($Case.id -eq "RED-ENV-003") {
            Assert-Equal "failed" $report.verdict "Environment verification failure verdict"
            Assert-Equal "failed" ([string]$report.environment.verification_status) "Environment verification status"
            Assert-Null $report.environment.caller_unchanged "caller_unchanged must fail closed to null"
            Assert-Null $report.environment.restored "restored must fail closed to null"
            Assert-True (-not [bool]$report.environment.mutation_attempted) "Environment snapshot failure attempted a host write"
            Assert-True ((Get-ReportText $report.errors) -match "environment_snapshot_failed") "Environment snapshot error missing"
            Assert-True ($null -ne $report.manifests.official.after) "After manifest missing after environment snapshot failure"
            Assert-Equal 4 @($scenario.cleanup_specs).Count "Cleanup did not continue after environment snapshot failure"
            Assert-EnvironmentReadOnlyAudit $report $scenario $false
        }
        elseif ($Case.id -like "RED-REPORT-*") {
            $text = Get-ReportText $report
            if ($Case.id -eq "RED-REPORT-001" -or $Case.id -eq "RED-REPORT-005") {
                Assert-True (Test-Path -LiteralPath $report.report_path -PathType Leaf) "Machine JSON missing"
                $diskJsonText = [System.IO.File]::ReadAllText($report.report_path, [Text.Encoding]::UTF8)
                $parsed = $diskJsonText | ConvertFrom-Json
                Assert-Equal 9 @($parsed.commands).Count "Parsed command count"
                Assert-Equal 9 @($scenario.observed_specs).Count "Observed successful command spec count"
                foreach ($diskCommand in @($parsed.commands)) {
                    $sourceSpecs = @($scenario.observed_specs | Where-Object { [string]$_.id -eq [string]$diskCommand.id })
                    Assert-Equal 1 $sourceSpecs.Count "Observed command spec count: $($diskCommand.id)"
                    $sourceSpec = $sourceSpecs[0]
                    Assert-True ($null -ne $diskCommand.PSObject.Properties["executable"]) "Disk executable field missing: $($diskCommand.id)"
                    Assert-True ([System.IO.Path]::IsPathRooted([string]$diskCommand.executable)) "Disk executable is not absolute: $($diskCommand.id)"
                    Assert-Equal ([string]$sourceSpec.executable) ([string]$diskCommand.executable) "Disk executable: $($diskCommand.id)"
                    Assert-True ($null -ne $diskCommand.PSObject.Properties["arguments"]) "Disk arguments field missing: $($diskCommand.id)"
                    Assert-True (-not ($diskCommand.arguments -is [string])) "Disk arguments were stringified: $($diskCommand.id)"
                    $expectedArguments = @($sourceSpec.arguments)
                    $actualArguments = @($diskCommand.arguments)
                    Assert-Equal $expectedArguments.Count $actualArguments.Count "Disk argument count: $($diskCommand.id)"
                    for ($argumentIndex = 0; $argumentIndex -lt $expectedArguments.Count; $argumentIndex++) {
                        Assert-Equal ([string]$expectedArguments[$argumentIndex]) ([string]$actualArguments[$argumentIndex]) "Disk argument $argumentIndex`: $($diskCommand.id)"
                    }
                    Assert-True ($null -ne $diskCommand.PSObject.Properties["timeout_ms"]) "Disk timeout field missing: $($diskCommand.id)"
                    Assert-Equal 120000 ([int]$diskCommand.timeout_ms) "Disk timeout: $($diskCommand.id)"
                    Assert-True ($null -ne $diskCommand.PSObject.Properties["timed_out"]) "Disk timed_out field missing: $($diskCommand.id)"
                    Assert-True ($diskCommand.timed_out -is [bool]) "Disk timed_out was not Boolean: $($diskCommand.id)"
                    Assert-True (-not [bool]$diskCommand.timed_out) "Disk command unexpectedly timed out: $($diskCommand.id)"
                    Assert-ExactPropertySet $diskCommand.fault_injection @("active", "phase", "injected", "error_type", "error_text") "Disk fault injection state: $($diskCommand.id)"
                    Assert-True (-not [bool]$diskCommand.fault_injection.active) "Disk process fault injector unexpectedly active: $($diskCommand.id)"
                    Assert-True (-not [bool]$diskCommand.fault_injection.injected) "Disk process fault unexpectedly injected: $($diskCommand.id)"
                    Assert-Null $diskCommand.fault_injection.phase "Disk process fault phase: $($diskCommand.id)"
                }
                $parsedNode = @($parsed.commands | Where-Object { $_.route -in @("B", "C") })[0]
                Assert-True ($null -ne $parsedNode.environment_policy.parent_environment.exact_key_values) "Deep exact environment values missing"
                Assert-True ($null -ne $parsedNode.environment_key_names) "Deep environment key names missing"
                Assert-True ($null -ne $parsedNode.environment_value_sources) "Deep environment value sources missing"
                Assert-True ($null -ne $parsed.manifests.official.diff.added) "Deep official diff missing"
                Assert-True ($null -ne $parsed.openclaw_state.pre_delete_audit.entries) "Deep OpenClaw entries missing"
                Assert-True ($null -ne $parsed.errors) "Deep errors array missing"
                Assert-True ($diskJsonText -notmatch '"json_sha256"\s*:') "Disk report recursively contains its own hash"
                if ($Case.id -eq "RED-REPORT-001") {
                    Assert-Equal "passed" ([string]$parsed.verdict) "Disk success verdict"
                    Assert-Equal 0 ([int]$parsed.exit_code) "Disk success exit code"
                    foreach ($diskCommand in @($parsed.commands)) {
                        Assert-Equal "passed" ([string]$diskCommand.status) "Disk command status: $($diskCommand.id)"
                        Assert-Equal 0 ([int]$diskCommand.exit_code) "Disk command exit: $($diskCommand.id)"
                    }
                }
                if ($Case.id -eq "RED-REPORT-005") {
                    Assert-FrozenPolicyBootstrap $report $scenario "Memory REPORT-005"
                    Assert-FrozenPolicyBootstrap $parsed $scenario "Disk REPORT-005"
                    Assert-PathSecurityReport $report "Memory REPORT-005"
                    Assert-PathSecurityReport $parsed "Disk REPORT-005"
                    foreach ($reportView in @($report, $parsed)) {
                        Assert-True ($null -ne $reportView.manifests.PSObject.Properties["provider_dto"]) "REPORT-005 manifest provider DTO missing"
                        Assert-ExactPropertySet $reportView.manifests.provider_dto @("schema_version", "dynamic_members_rejected", "nested_reference_reuse_checked", "provider_objects_released") "REPORT-005 manifest provider DTO"
                        Assert-Equal "manifest-provider-dto/v1" ([string]$reportView.manifests.provider_dto.schema_version) "REPORT-005 manifest provider DTO schema"
                        Assert-True ($reportView.manifests.provider_dto.dynamic_members_rejected -is [bool] -and [bool]$reportView.manifests.provider_dto.dynamic_members_rejected) "REPORT-005 manifest provider dynamic-member boundary"
                        Assert-True ($reportView.manifests.provider_dto.nested_reference_reuse_checked -is [bool] -and [bool]$reportView.manifests.provider_dto.nested_reference_reuse_checked) "REPORT-005 manifest provider nested-reference boundary"
                        Assert-True ($reportView.manifests.provider_dto.provider_objects_released -is [bool] -and [bool]$reportView.manifests.provider_dto.provider_objects_released) "REPORT-005 manifest provider object release"
                        Assert-True ($null -ne $reportView.PSObject.Properties["test_seams"]) "REPORT-005 test seam state missing"
                        Assert-ExactPropertySet $reportView.test_seams @("process_fault_injector_active", "path_phase_observer_active") "REPORT-005 test seam state"
                        Assert-True ($reportView.test_seams.process_fault_injector_active -is [bool] -and -not [bool]$reportView.test_seams.process_fault_injector_active) "REPORT-005 process fault injector must be inactive"
                        Assert-True ($reportView.test_seams.path_phase_observer_active -is [bool] -and -not [bool]$reportView.test_seams.path_phase_observer_active) "REPORT-005 path phase observer must be inactive"
                    }
                    $commandProfiles = @($parsed.environment.command_profiles)
                    Assert-Equal 9 $commandProfiles.Count "Disk command profile count"
                    Assert-Equal 9 @($commandProfiles | ForEach-Object { [string]$_.command_id } | Sort-Object -Unique).Count "Disk command profile unique IDs"
                    foreach ($profileRow in $commandProfiles) {
                        Assert-ExactPropertySet $profileRow @("command_id", "route", "stage", "write_root", "root", "home", "appdata", "localappdata", "temp", "attestation_root", "audited_before_cleanup", "cleanup_root_id") "Disk command profile $($profileRow.command_id)"
                        $sourceSpec = @($scenario.observed_specs | Where-Object { [string]$_.id -ceq [string]$profileRow.command_id })[0]
                        Assert-True ($null -ne $sourceSpec) "Disk command profile source spec: $($profileRow.command_id)"
                        foreach ($mapping in @(
                            [pscustomobject]@{ row = "root"; spec = "root" }, [pscustomobject]@{ row = "home"; spec = "home" },
                            [pscustomobject]@{ row = "appdata"; spec = "appdata" }, [pscustomobject]@{ row = "localappdata"; spec = "localappdata" },
                            [pscustomobject]@{ row = "temp"; spec = "temp" }
                        )) {
                            Assert-Equal ([System.IO.Path]::GetFullPath([string]$sourceSpec.environment_policy.profile.($mapping.spec))) ([System.IO.Path]::GetFullPath([string]$profileRow.($mapping.row))) "Disk profile path $($profileRow.command_id)/$($mapping.row)"
                        }
                        Assert-Equal ([System.IO.Path]::GetFullPath((Join-Path ([string]$profileRow.temp) "foundation-policy-attestations"))) ([System.IO.Path]::GetFullPath([string]$profileRow.attestation_root)) "Disk profile attestation root $($profileRow.command_id)"
                        Assert-True ([bool]$profileRow.audited_before_cleanup) "Disk profile audit flag $($profileRow.command_id)"
                    }
                    $checkPhases = @($parsed.runtime_identity.checks | ForEach-Object { [string]$_.phase })
                    $finallyCheckIndex = [array]::IndexOf($checkPhases, "finally_before_cleanup")
                    $sourceFinalIndex = [array]::IndexOf($checkPhases, "source_final_after_cleanup")
                    Assert-True ($finallyCheckIndex -ge 0) "Disk finally-before-cleanup snapshot check missing"
                    Assert-True ($sourceFinalIndex -gt $finallyCheckIndex) "Disk final source check was not after finally snapshot check"
                    $authoritativePolicyJournalAuditEntries = @(Get-TestAuthoritativePolicyJournalAuditEntries $parsed)
                    foreach ($journalPath in @($scenario.policy_journal_paths)) {
                        $auditMatches = @($authoritativePolicyJournalAuditEntries | Where-Object { ([System.IO.Path]::GetFullPath([string]$_.full_path)).Equals([System.IO.Path]::GetFullPath([string]$journalPath), [System.StringComparison]::OrdinalIgnoreCase) })
                        Assert-Equal 1 $auditMatches.Count "Disk policy journal pre-delete audit: $journalPath"
                    }
                    foreach ($temporaryRoot in @($parsed.temporary_roots)) {
                        Assert-Equal 0 ([int]$temporaryRoot.physical_residual_count) "Disk temporary physical residual: $($temporaryRoot.root_id)"
                    }
                    Assert-Equal "none" ([string]$parsed.full_case_set) "Full case set boundary"
                    Assert-Equal "SH-SAFE-BASE-001" (Get-OrdinalIgnoreCaseSignature @($parsed.task_ids)) "Report task IDs"
                    Assert-Equal "CASE-FOUNDATION-002|CASE-STORAGE-004" (Get-OrdinalIgnoreCaseSignature @($parsed.case_ids)) "Report local case IDs"
                    Assert-Equal "REQ-SAFE-001|REQ-SAFE-004" (Get-OrdinalIgnoreCaseSignature @($parsed.requirement_ids)) "Report requirement IDs"
                    Assert-Equal "RISK-011" (Get-OrdinalIgnoreCaseSignature @($parsed.risk_ids)) "Report risk IDs"
                    Assert-Equal "DEC-026" (Get-OrdinalIgnoreCaseSignature @($parsed.decision_ids)) "Report decision IDs"
                    Assert-Equal "DEBT-001|DEBT-006" (Get-OrdinalIgnoreCaseSignature @($parsed.debt_ids)) "Report debt IDs"
                    Assert-ExactCaseAssertionPaths $report.case_assertion_paths "Memory report"
                    Assert-ExactCaseAssertionPaths $parsed.case_assertion_paths "Disk report"
                    Assert-ManifestLayerObjectFreshness $report "Memory report"
                    Assert-ManifestLayerObjectFreshness $parsed "Disk report"
                    Assert-True ([bool]$parsed.review_required) "review_required was not true"
                    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$parsed.executor)) "Report executor missing"
                    Assert-True ($null -eq $parsed.PSObject.Properties["independent_reviewer"]) "Independent reviewer was prefilled"
                    Assert-True ($null -eq $parsed.PSObject.Properties["independent_reviewed_at"]) "Independent review time was prefilled"

                    $artifactIds = @("validator", "core", "validate_data_manifests", "validate_foundations_state_isolation", "contract")
                    $artifacts = @($parsed.artifacts)
                    Assert-Equal 5 $artifacts.Count "Report artifact hash count"
                    Assert-Equal (Get-OrdinalIgnoreCaseSignature $artifactIds) (Get-OrdinalIgnoreCaseSignature @($artifacts | ForEach-Object { [string]$_.artifact_id })) "Report artifact hash IDs"
                    foreach ($artifact in $artifacts) {
                        Assert-True ([string]$artifact.sha256 -match '^[A-Fa-f0-9]{64}$') "Artifact SHA-256 invalid: $($artifact.artifact_id)"
                        Assert-True ([System.IO.Path]::IsPathRooted([string]$artifact.path)) "Artifact path is not absolute: $($artifact.artifact_id)"
                        Assert-True (Test-Path -LiteralPath $artifact.path -PathType Leaf) "Artifact path missing: $($artifact.artifact_id)"
                        Assert-Equal (Get-FileHash -LiteralPath $artifact.path -Algorithm SHA256).Hash ([string]$artifact.sha256) "Artifact SHA-256 mismatch: $($artifact.artifact_id)"
                    }

                    $expectedCommandIds = @("A.structure", "B.test", "B.build", "B.plugin_build_check", "B.plugin_validate", "C.test", "C.build", "C.plugin_build_check", "C.plugin_validate")
                    Assert-Equal ($expectedCommandIds -join "|") (@($parsed.commands | ForEach-Object { [string]$_.id }) -join "|") "Disk command ID order"
                    Assert-True (-not ($parsed.commands -is [string])) "Disk commands were stringified"
                    $diffKeys = @($parsed.manifests.official.diff.PSObject.Properties | ForEach-Object { $_.Name })
                    Assert-Equal "ADDED|DELETED|MODIFIED" (Get-OrdinalIgnoreCaseSignature $diffKeys) "Disk official diff exact keys"
                    Assert-EmptyDiff $parsed.manifests.official.diff "Disk official manifest"
                    Assert-True (-not ($parsed.manifests.official.diff.added -is [string])) "Disk added diff was stringified"
                    Assert-ProjectBusinessCandidatePair $parsed $fixture "Disk report"
                    foreach ($phase in @("before", "after")) {
                        $memoryProject = $report.manifests.project_business_candidates.$phase
                        $diskProject = $parsed.manifests.project_business_candidates.$phase
                        Assert-Equal ([string]$memoryProject.scope_id) ([string]$diskProject.scope_id) "Disk project scope: $phase"
                        Assert-True ($diskProject.completed -is [bool]) "Disk project completed was not Boolean: $phase"
                        Assert-Equal ([bool]$memoryProject.completed) ([bool]$diskProject.completed) "Disk project completed: $phase"
                        Assert-Equal 4 @($diskProject.roots).Count "Disk project root count: $phase"
                        foreach ($memoryRoot in @($memoryProject.roots)) {
                            $diskRoots = @($diskProject.roots | Where-Object { [string]$_.root_id -ceq [string]$memoryRoot.root_id })
                            Assert-Equal 1 $diskRoots.Count "Disk project root: $phase/$($memoryRoot.root_id)"
                            $diskRoot = $diskRoots[0]
                            Assert-Equal ([string]$memoryRoot.path) ([string]$diskRoot.path) "Disk project root path: $phase/$($memoryRoot.root_id)"
                            Assert-True ($diskRoot.exists -is [bool]) "Disk project root exists was not Boolean: $phase/$($memoryRoot.root_id)"
                            Assert-Equal ([bool]$memoryRoot.exists) ([bool]$diskRoot.exists) "Disk project root exists: $phase/$($memoryRoot.root_id)"
                            Assert-Equal ([string]$memoryRoot.scan_status) ([string]$diskRoot.scan_status) "Disk project root status: $phase/$($memoryRoot.root_id)"
                            if ($null -eq $memoryRoot.error_code) {
                                Assert-Null $diskRoot.error_code "Disk project root error: $phase/$($memoryRoot.root_id)"
                            }
                            else {
                                Assert-Equal ([string]$memoryRoot.error_code) ([string]$diskRoot.error_code) "Disk project root error: $phase/$($memoryRoot.root_id)"
                            }
                        }
                        Assert-ManifestEntriesRoundTrip $memoryProject.entries $diskProject.entries "Disk project $phase"
                    }
                    Assert-SourceDistReportEmpty $parsed $fixture "Disk report"
                    foreach ($route in @("B", "C")) {
                        $memorySource = $report.manifests.source_dist.PSObject.Properties[$route].Value
                        $diskSource = $parsed.manifests.source_dist.PSObject.Properties[$route].Value
                        Assert-True ($null -ne $memorySource) "Memory source dist route missing: $route"
                        Assert-True ($null -ne $diskSource) "Disk source dist route missing: $route"
                        Assert-Equal ([string]$memorySource.path) ([string]$diskSource.path) "Disk source dist path: $route"
                        foreach ($phase in @("before", "after")) {
                            Assert-Equal ([string]$memorySource.$phase.scope_id) ([string]$diskSource.$phase.scope_id) "Disk source dist scope: $route/$phase"
                            Assert-ManifestEntriesRoundTrip $memorySource.$phase.entries $diskSource.$phase.entries "Disk source dist $route/$phase"
                        }
                        Assert-EmptyDiff $diskSource.diff "Disk source dist diff: $route"
                    }
                    foreach ($impactField in @("project_candidate_added", "project_candidate_modified", "project_candidate_deleted")) {
                        Assert-True ($null -ne $parsed.business_impact.PSObject.Properties[$impactField]) "Disk project impact field missing: $impactField"
                        Assert-True ($parsed.business_impact.$impactField -is [int]) "Disk project impact was not Int32: $impactField"
                        Assert-Equal ([int]$report.business_impact.$impactField) ([int]$parsed.business_impact.$impactField) "Disk project impact: $impactField"
                        Assert-Equal 0 ([int]$parsed.business_impact.$impactField) "Disk project impact success value: $impactField"
                    }
                    Assert-True (-not ($parsed.openclaw_state.pre_delete_audit.entries -is [string])) "Disk OpenClaw entries were stringified"
                    Assert-Equal 0 ([int]$parsed.openclaw_state.pre_delete_audit.business_candidate_count) "Disk OpenClaw business candidate count"
                    Assert-Equal 0 ([int]$parsed.openclaw_state.pre_delete_audit.openclaw_internal_tool_state_count) "Disk OpenClaw internal state count"
                    Assert-Equal 0 @($parsed.errors).Count "Disk success errors count"
                    foreach ($diskCommand in @($parsed.commands)) {
                        if ($diskCommand.route -in @("B", "C")) {
                            $expectedCount = if ($diskCommand.stage -like "plugin*") { 23 } else { 19 }
                            Assert-Equal $expectedCount @($diskCommand.environment_policy.parent_environment.exact_key_values).Count "Disk environment policy count: $($diskCommand.id)"
                            Assert-Equal $expectedCount @($diskCommand.environment_key_names).Count "Disk environment key count: $($diskCommand.id)"
                            Assert-Equal $expectedCount @($diskCommand.environment_value_sources).Count "Disk environment source count: $($diskCommand.id)"
                            $expectedNames = if ($diskCommand.stage -like "plugin*") { $pluginCleanRoomNames } else { $commonCleanRoomNames }
                            $diskPolicyNames = @($diskCommand.environment_policy.parent_environment.exact_key_values | ForEach-Object { [string]$_.name })
                            Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedNames) (Get-OrdinalIgnoreCaseSignature $diskPolicyNames) "Disk environment policy keyset: $($diskCommand.id)"
                            Assert-Equal (Get-OrdinalIgnoreCaseSignature $expectedNames) (Get-OrdinalIgnoreCaseSignature @($diskCommand.environment_key_names)) "Disk environment observed keyset: $($diskCommand.id)"
                            $sourceSpec = @($scenario.observed_specs | Where-Object { $_.id -eq $diskCommand.id })[0]
                            foreach ($diskEntry in @($diskCommand.environment_policy.parent_environment.exact_key_values)) {
                                $sourceEntry = @($sourceSpec.environment_policy.parent_environment.exact_key_values | Where-Object { $_.name -eq $diskEntry.name })
                                Assert-Equal 1 $sourceEntry.Count "Disk environment source entry count: $($diskCommand.id)/$($diskEntry.name)"
                                Assert-Equal ([string]$sourceEntry[0].value) ([string]$diskEntry.value) "Disk environment value: $($diskCommand.id)/$($diskEntry.name)"
                                Assert-Equal ([string]$sourceEntry[0].source) ([string]$diskEntry.source) "Disk environment source: $($diskCommand.id)/$($diskEntry.name)"
                            }
                            Assert-Equal (@($sourceSpec.environment_policy.parent_environment.exact_key_values | ForEach-Object { [string]$_.source }) -join "|") (@($diskCommand.environment_value_sources) -join "|") "Disk environment source array: $($diskCommand.id)"
                            if ([string]$diskCommand.stage -ceq "test") {
                                Assert-VitestPolicyJournal $diskCommand $sourceSpec "Disk REPORT-005/$($diskCommand.id)"
                            }
                        }
                        Assert-RawTextArtifact ([string]$diskCommand.stdout_raw_path) ([string]$diskCommand.stdout_sha256) ([string]$diskCommand.stdout) "Disk command stdout $($diskCommand.id)"
                        Assert-RawTextArtifact ([string]$diskCommand.stderr_raw_path) ([string]$diskCommand.stderr_sha256) ([string]$diskCommand.stderr) "Disk command stderr $($diskCommand.id)"
                        Assert-RawTextArtifact ([string]$diskCommand.exception_raw_path) ([string]$diskCommand.exception_sha256) ([string]$diskCommand.exception_text) "Disk command exception $($diskCommand.id)"
                    }
                    Assert-True ($null -ne $report.publisher_result) "Out-of-band publisher result missing"
                    $computedJsonSha = (Get-FileHash -LiteralPath $report.report_path -Algorithm SHA256).Hash
                    Assert-Equal $computedJsonSha ([string]$report.publisher_result.json_sha256) "Out-of-band machine JSON SHA-256"
                    Assert-Equal ([System.IO.Path]::GetFullPath($report.report_path)) ([System.IO.Path]::GetFullPath([string]$parsed.report_path)) "Disk report self path"
                    Invoke-PathPhaseObserverCoverageVariant
                }
            }
            elseif ($Case.id -eq "RED-REPORT-004") {
                Assert-Equal "failed" $report.verdict "Publisher failure verdict"
                Assert-True ($text -match "report_publish_failed") "Publisher failure missing from memory report"
                Invoke-ReportPublisherReviewVariants $fixture
                Assert-ZeroPublicationFailure $report $fixture $scenario "Returned publisher failure"
            }
            elseif ($Case.id -eq "RED-REPORT-002") {
                Assert-Equal "failed" $report.verdict "Complex stderr report verdict"
                $command = @($report.commands | Where-Object { $_.id -eq "A.structure" })[0]
                Assert-True ([string]$command.stderr -match [regex]::Escape([string][char]0x4E2D)) "Runtime non-ASCII stderr token missing"
                Assert-Equal "Fixture.CommandException" ([string]$command.exception_type) "Exception type was not preserved"
                Assert-True ([string]$command.exception_text -match [regex]::Escape([string][char]0x4E2D)) "Exception text was not preserved"
                Assert-RawTextArtifact ([string]$command.stdout_raw_path) ([string]$command.stdout_sha256) "fake stdout for A.structure" "Command stdout"
                Assert-RawTextArtifact ([string]$command.stderr_raw_path) ([string]$command.stderr_sha256) ([string]$scenario.stderr) "Command stderr"
                Assert-RawTextArtifact ([string]$command.exception_raw_path) ([string]$command.exception_sha256) ([string]$scenario.command_exception_text) "Command exception"
                $diskReport = [System.IO.File]::ReadAllText($report.report_path, [Text.Encoding]::UTF8) | ConvertFrom-Json
                $diskCommand = @($diskReport.commands | Where-Object { $_.id -eq "A.structure" })[0]
                Assert-Equal ([string]$scenario.stderr) ([string]$diskCommand.stderr) "Disk JSON stderr text"
                Assert-Equal ([string]$scenario.command_exception_text) ([string]$diskCommand.exception_text) "Disk JSON exception text"
                Assert-FaultFields $report "A.structure" "41" $preHash $postHash
            }
            elseif ($Case.id -eq "RED-REPORT-003") {
                Assert-Equal "failed" $report.verdict "Combined failure report verdict"
                Assert-True (@($report.errors).Count -ge 2) "Combined failure errors were not aggregated"
                Assert-True ((Get-ReportText $report.errors[0]) -match "A.structure|primary command failure") "Primary command error was not first"
                Assert-True ((Get-ReportText @($report.errors)[-1]) -match "TEST_CLEANUP_FAILURE|build_root") "Cleanup error was not appended"
                Assert-True ([int]$report.exit_code -ne 0) "Combined failure exit code was zero"
                Assert-FaultFields $report "A.structure" "41" $preHash $postHash
            }
            else {
                Assert-Equal "failed" $report.verdict "Failure report verdict"
            }
        }
    }
    finally {
        if ($null -ne $poisonRestoreState) {
            Restore-ProcessEnvironmentState $poisonRestoreState
        }
        [Environment]::SetEnvironmentVariable("DIET_MANAGER_OFFICIAL_DATA_ROOT", $oldOfficial, "Process")
        if ($oldStateExists) {
            [Environment]::SetEnvironmentVariable("OPENCLAW_STATE_DIR", $oldState, "Process")
        }
        else {
            Remove-Item Env:OPENCLAW_STATE_DIR -ErrorAction SilentlyContinue
        }
        Restore-ProcessEnvironmentState $tempRestoreState
        Remove-TestFixture $fixture
        $script:Scenario = $null
    }
}

function Test-AsciiSource {
    param([string]$Path)
    foreach ($byte in [System.IO.File]::ReadAllBytes($Path)) {
        if ($byte -gt 127) {
            throw "Test source is not ASCII: $Path"
        }
    }
}

if ($LibraryOnly) {
    return
}

$fixtureCheck = $null
try {
    Test-AsciiSource $PSCommandPath
    Test-FrozenScopeBoundary
    $fixtureCheck = New-TestFixture
    Test-FixtureHarness $fixtureCheck
    Test-TestDoublePathSafety $fixtureCheck
    Test-TestDoubleCleanupLongPathSafety $fixtureCheck
    Test-TestDoubleCleanupReparseSafety $fixtureCheck
    Write-Output "HARNESS|PASS|ASCII source; 48 unique RED IDs; 27 protected entries; 5 exact external leases; stable seeded fixtures; independently contained fake writes and cleanup; no package runtime"
}
finally {
    Remove-TestFixture $fixtureCheck
}

$capabilityErrors = New-Object System.Collections.ArrayList
if (-not (Test-Path -LiteralPath $corePath -PathType Leaf)) {
    [void]$capabilityErrors.Add("PRODUCTION_CORE_MISSING:$corePath")
}
else {
    try {
        . $corePath
    }
    catch {
        [void]$capabilityErrors.Add("PRODUCTION_CORE_DOT_SOURCE_FAILED:$($_.Exception.GetType().FullName):$($_.Exception.Message)")
    }
    foreach ($name in @("Invoke-FoundationValidationCore", "Resolve-FoundationChildPath", "Invoke-FoundationProcessCommand")) {
        if (-not (Get-Command $name -CommandType Function -ErrorAction SilentlyContinue)) {
            [void]$capabilityErrors.Add("PRODUCTION_INTERFACE_MISSING:$name")
        }
    }
}

if ($capabilityErrors.Count -gt 0) {
    $reason = @($capabilityErrors) -join ";"
    foreach ($case in $testCases) {
        Write-TestResult $case.id $false ("PRODUCTION_CAPABILITY_MISSING|injection={0}|expected={1}|observed={2}" -f $case.injection, $case.expected, $reason)
    }
    Write-Output "SUMMARY|FAIL|passed=0|failed=$($testCases.Count)|reason=production safety core and frozen interfaces are absent|log=$script:LogPath"
    exit 1
}

Assert-DeliveryPowerShellSources

foreach ($case in $testCases) {
    try {
        Invoke-RegisteredTest $case
        Write-TestResult $case.id $true ("injection={0}|oracle={1}" -f $case.injection, $case.expected)
    }
    catch {
        Write-TestResult $case.id $false ("injection={0}|oracle={1}|observed={2}:{3}" -f $case.injection, $case.expected, $_.Exception.GetType().FullName, $_.Exception.Message)
    }
}

$passedCount = @($script:Results | Where-Object { $_.passed }).Count
$failedCount = @($script:Results | Where-Object { -not $_.passed }).Count
$status = if ($failedCount -eq 0) { "PASS" } else { "FAIL" }
Write-Output "SUMMARY|$status|passed=$passedCount|failed=$failedCount|log=$script:LogPath"
if ($failedCount -gt 0) {
    exit 1
}
exit 0
