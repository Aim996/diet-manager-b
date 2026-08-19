[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$frozenProjectRoot = "E:\codx\skill\" + [char]39278 + [char]39135 + [char]31649 + [char]23478
if (-not ([System.IO.Path]::GetFullPath($projectRoot)).Equals($frozenProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "RUNTIME_PRODUCTION_LAYOUT_INVALID:project_root"
}
$corePath = Join-Path $PSScriptRoot "private\foundation-validation-core.ps1"
$evidenceRoot = Join-Path $projectRoot "docs\evidence"

if (-not (Test-Path -LiteralPath $corePath -PathType Leaf)) {
    throw "Foundation validation core is missing: $corePath"
}
. $corePath

$expectedNode = "C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe"
$expectedToolModules = Join-Path $frozenProjectRoot "version-c-strict-plugin\node_modules"
$expectedOpenClawEntry = Join-Path $expectedToolModules "openclaw\openclaw.mjs"
$configuredNode = [Environment]::GetEnvironmentVariable("DIET_MANAGER_NODE", "Process")
$configuredToolModules = [Environment]::GetEnvironmentVariable("DIET_MANAGER_TOOL_MODULES", "Process")
$configuredOpenClawEntry = [Environment]::GetEnvironmentVariable("DIET_MANAGER_OPENCLAW_ENTRY", "Process")
if ($configuredNode -cne $expectedNode) { throw "RUNTIME_PRODUCTION_LAYOUT_INVALID:DIET_MANAGER_NODE" }
if ($configuredToolModules -cne $expectedToolModules) { throw "RUNTIME_PRODUCTION_LAYOUT_INVALID:DIET_MANAGER_TOOL_MODULES" }
if ($configuredOpenClawEntry -cne $expectedOpenClawEntry) { throw "RUNTIME_PRODUCTION_LAYOUT_INVALID:DIET_MANAGER_OPENCLAW_ENTRY" }

$pnpmRoot = Join-Path $expectedToolModules ".pnpm"
$vitestTarget = Join-Path $pnpmRoot "vitest@2.1.9_@types+node@26.2.0\node_modules\vitest"
$typescriptTarget = Join-Path $pnpmRoot "typescript@5.9.3\node_modules\typescript"
$openclawTarget = Join-Path $pnpmRoot "openclaw@2026.7.1\node_modules\openclaw"
$runtime = [pscustomobject][ordered]@{
    temporary_parent = "C:\Users\10481\AppData\Local\Temp\diet-manager-shared"
    node_path = $expectedNode
    tool_modules_path = $expectedToolModules
    vitest_path = Join-Path $expectedToolModules "vitest\vitest.mjs"
    typescript_path = Join-Path $expectedToolModules "typescript\bin\tsc"
    openclaw_path = $expectedOpenClawEntry
    dependency_source_roots = [pscustomobject][ordered]@{
        node_root = "C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0"
        tool_modules_root = $expectedToolModules
        pnpm_root = $pnpmRoot
        typebox_root = Join-Path $pnpmRoot "typebox@1.3.11\node_modules\typebox"
    }
    protected_external_paths = [pscustomobject][ordered]@{
        jiti_openclaw_cache_guard = "C:\Users\10481\AppData\Local\Temp\jiti\openclaw"
        node_compile_cache_guard = "C:\Users\10481\AppData\Local\Temp\node-compile-cache\openclaw"
        inherited_openclaw_temp_guard = "C:\Users\10481\AppData\Local\Temp\openclaw"
        vitest_b_cache_guard = Join-Path $frozenProjectRoot "version-b-lite-plugin\node_modules\.vite\vitest"
        vitest_c_cache_guard = Join-Path $frozenProjectRoot "version-c-strict-plugin\node_modules\.vite\vitest"
    }
    identity_expectations = [pscustomobject][ordered]@{
        a_structure = [pscustomobject][ordered]@{
            executable_path = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
            script_path = Join-Path $frozenProjectRoot "version-a-skill-only\tests\validate-foundation.ps1"
            length = 454656
            entry_sha256 = "7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5"
            file_version = "10.0.26100.8875"
            product_version = "10.0.26100.8875"
        }
        source_trees = [pscustomobject][ordered]@{
            node = [pscustomobject][ordered]@{ file_count = 1807; reparse_count = 0; total_bytes = 103552528; canonical_line_count = 1807; tree_sha256 = "AC34E5C8473600D6540763EBCC7AFCB6E59CE861122C59C1FD381C744CB29D61" }
            pnpm = [pscustomobject][ordered]@{ file_count = 34624; reparse_count = 942; total_bytes = 628929762; canonical_line_count = 35566; tree_sha256 = "7E85740744869D460D7B4B8F1E9B3C8811698B11DCBF1F8A89726644A1E94055" }
        }
        snapshot_trees = [pscustomobject][ordered]@{
            node = [pscustomobject][ordered]@{ file_count = 1807; reparse_count = 0; total_bytes = 103552528; canonical_line_count = 1807; tree_sha256 = "AC34E5C8473600D6540763EBCC7AFCB6E59CE861122C59C1FD381C744CB29D61" }
            pnpm = [pscustomobject][ordered]@{ file_count = 34624; reparse_count = 942; total_bytes = 628929762; canonical_line_count = 35566; tree_sha256 = "14E884759CD8BF088CE024809D53ACCA4DA256BE6E9E142B541798DEA05BB8BE" }
        }
        tools = [pscustomobject][ordered]@{
            vitest = [pscustomobject][ordered]@{
                version = "2.1.9"; configured_target_path = Join-Path $expectedToolModules "vitest"; configured_entry_path = Join-Path $expectedToolModules "vitest\vitest.mjs"
                physical_target_path = $vitestTarget; physical_entry_path = Join-Path $vitestTarget "vitest.mjs"; entry_length = 43; entry_sha256 = "39DB22F579ACF5639BBB17A261408DEBBDE03F4692C0C439E77E7F13AEBA74D6"
                tree = [pscustomobject][ordered]@{ file_count = 117; reparse_count = 0; total_bytes = 1661189; canonical_line_count = 117; tree_sha256 = "984D2C82CDCCBFEC623D3CD9F8B9F9F8272BCF49F95467D416B9F90E87F19B2D" }
            }
            typescript = [pscustomobject][ordered]@{
                version = "5.9.3"; configured_target_path = Join-Path $expectedToolModules "typescript"; configured_entry_path = Join-Path $expectedToolModules "typescript\bin\tsc"
                physical_target_path = $typescriptTarget; physical_entry_path = Join-Path $typescriptTarget "bin\tsc"; entry_length = 45; entry_sha256 = "8D5FA5BD883FEC0979FC2004F1FE1D99AEF40570155D550EADC0B03B55513BF0"
                tree = [pscustomobject][ordered]@{ file_count = 138; reparse_count = 0; total_bytes = 23633942; canonical_line_count = 138; tree_sha256 = "EC174E8071027E8828402C337BA0FA22AF7491B799DC3E935AB6811300CCBD4F" }
            }
            openclaw = [pscustomobject][ordered]@{
                version = "2026.7.1"; configured_target_path = Join-Path $expectedToolModules "openclaw"; configured_entry_path = $expectedOpenClawEntry
                physical_target_path = $openclawTarget; physical_entry_path = Join-Path $openclawTarget "openclaw.mjs"; entry_length = 23463; entry_sha256 = "F643B005D6DB233A0B45204E8D8E943256874CCC6897B8A6E0CF42A9B376A188"
                tree = [pscustomobject][ordered]@{ file_count = 8589; reparse_count = 0; total_bytes = 87743888; canonical_line_count = 8589; tree_sha256 = "1EE99B0F9B9E3AFA49CB555B0E0406D8617D0231E75006788B10AE66C6D5E10C" }
            }
        }
        module_closure = [pscustomobject][ordered]@{
            vitest = [pscustomobject][ordered]@{ reachable_packages = 93; manifest_edges = 127; required_gap_count = 0; c_top_edge_count = 0; missing_optional_peer_count = 13 }
            typescript = [pscustomobject][ordered]@{ reachable_packages = 1; manifest_edges = 0; required_gap_count = 0; c_top_edge_count = 0; missing_optional_peer_count = 0 }
            openclaw = [pscustomobject][ordered]@{ reachable_packages = 306; manifest_edges = 461; required_gap_count = 0; c_top_edge_count = 0; missing_optional_peer_count = 10 }
            staging_typebox = [pscustomobject][ordered]@{ path = Join-Path $pnpmRoot "typebox@1.3.11\node_modules\typebox"; reachable_packages = 1; manifest_edges = 0; required_gap_count = 0; c_top_edge_count = 0; missing_optional_peer_count = 0; file_count = 1367; total_bytes = 1468384; tree_sha256 = "BC1E4E174A7B9DC9AB176ACA0039F96ED9F47F9A722BAF7B8A0D927897A0B7FE"; package_sha256 = "1E10166E4B3DD7718186CD458EEED35FA674752E51E87663100CA9068DB89E63" }
        }
        native_execution_allowlist = [pscustomobject][ordered]@{
            snapshot_node_executable = [pscustomobject][ordered]@{ relative_path = "node\node-v24.15.0-win-x64\node.exe"; length = 91694408; sha256 = "3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5" }
            vitest_fork = [pscustomobject][ordered]@{ relative_path = "pnpm\tinypool@1.1.1\node_modules\tinypool\dist\entry\process.js"; length = 2048; sha256 = "A73D2103A366A3DFDBE65495EAA26DF058AF1E3AD12339FD4B0F679E7C70989F" }
            vitest_addon = [pscustomobject][ordered]@{ relative_path = "pnpm\@rollup+rollup-win32-x64-msvc@4.62.4\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node"; length = 2623488; sha256 = "397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49" }
            vitest_child = [pscustomobject][ordered]@{ relative_path = "pnpm\@esbuild+win32-x64@0.21.5\node_modules\@esbuild\win32-x64\esbuild.exe"; length = 9913856; sha256 = "B868C8D988FFE76006C03C91F856312C312E42E2F3932A6BB56D7F4A1790C8B3" }
            typescript_native_count = 0
            openclaw_plugin_native_count = 0
        }
        policy_bootstrap = [pscustomobject][ordered]@{ schema_version = "foundation-trusted-policy/v2"; line_count = 1065; length = 43267; sha256 = "C0C0E478D19C2D3473D165318EEAB689DF0C34E69D8784A8C6B3D0119319D25D"; ascii_only = $true }
    }
}

$commandRunner = {
    param($Spec)
    return Invoke-FoundationProcessCommand -CommandSpec $Spec -TimeoutMs 120000
}
$cleanupRunner = {
    param($Spec)
    return Invoke-FoundationDefaultCleanup $Spec
}
$environmentAdapter = {
    param($Request)
    return Invoke-FoundationDefaultEnvironmentAdapter $Request
}
$clock = { return [datetimeoffset]::Now }
$runIdProvider = { return [guid]::NewGuid().ToString("N") }

$report = Invoke-FoundationValidationCore -ProjectRoot $projectRoot -EvidenceRoot $evidenceRoot -Runtime $runtime -CommandRunner $commandRunner -CleanupRunner $cleanupRunner -EnvironmentAdapter $environmentAdapter -ManifestProvider $null -ReportPublisher $null -Clock $clock -RunIdProvider $runIdProvider

if (-not [string]::IsNullOrWhiteSpace([string]$report.report_path)) {
    Write-Output ("report_path=" + [string]$report.report_path)
}
if ($null -ne $report.publisher_result -and -not [string]::IsNullOrWhiteSpace([string]$report.publisher_result.json_sha256)) {
    Write-Output ("json_sha256=" + [string]$report.publisher_result.json_sha256)
}
Write-Output ("verdict=" + [string]$report.verdict + ";exit_code=" + [string]$report.exit_code)
exit ([int]$report.exit_code)
