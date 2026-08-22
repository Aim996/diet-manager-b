[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runnerPath = Join-Path $PSScriptRoot 'validate-domain-schema.mjs'
$fixturePath = Join-Path $projectRoot 'shared\schemas\fixtures\domain-cases.json'
$businessExtensions = @('.jsonl', '.sqlite', '.sqlite3', '.db')
$fallbackNode = 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$trustedNodePath = 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$trustedNodeSha256 = '63C259C81E5D472B5F11C8D506070130CB04A1ECF84B80377A34ED6EC9048088'

function Get-BusinessDataSnapshot {
    param([Parameter(Mandatory = $true)][string]$Root)

    $snapshot = [ordered]@{}
    Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction Stop |
        Where-Object { $businessExtensions -contains $_.Extension.ToLowerInvariant() } |
        Sort-Object FullName |
        ForEach-Object {
            $resolved = [System.IO.Path]::GetFullPath($_.FullName)
            $hash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
            $snapshot[$resolved] = [ordered]@{
                length = [int64]$_.Length
                sha256 = $hash
                mtime_utc = $_.LastWriteTimeUtc.ToString('o')
            }
        }
    return $snapshot
}

function Compare-BusinessDataSnapshot {
    param(
        [Parameter(Mandatory = $true)]$Before,
        [Parameter(Mandatory = $true)]$After
    )

    $changes = [System.Collections.Generic.List[string]]::new()
    $paths = @($Before.Keys + $After.Keys | Sort-Object -Unique)
    foreach ($path in $paths) {
        if (-not $Before.Contains($path)) {
            $changes.Add("created:$path")
            continue
        }
        if (-not $After.Contains($path)) {
            $changes.Add("deleted:$path")
            continue
        }
        $beforeValue = $Before[$path]
        $afterValue = $After[$path]
        if ($beforeValue.length -ne $afterValue.length -or
            $beforeValue.sha256 -ne $afterValue.sha256 -or
            $beforeValue.mtime_utc -ne $afterValue.mtime_utc) {
            $changes.Add("modified:$path")
        }
    }
    return $changes
}

function Get-DependencyTreeRoot {
    param([Parameter(Mandatory = $true)][string]$EntryPath)

    $fullPath = [System.IO.Path]::GetFullPath($EntryPath)
    $pnpmMarker = [System.IO.Path]::DirectorySeparatorChar + 'node_modules' + [System.IO.Path]::DirectorySeparatorChar + '.pnpm' + [System.IO.Path]::DirectorySeparatorChar
    $pnpmIndex = $fullPath.IndexOf($pnpmMarker, [System.StringComparison]::OrdinalIgnoreCase)
    if ($pnpmIndex -ge 0) {
        return $fullPath.Substring(0, $pnpmIndex + $pnpmMarker.Length - 1)
    }
    $nodeModulesMarker = [System.IO.Path]::DirectorySeparatorChar + 'node_modules' + [System.IO.Path]::DirectorySeparatorChar
    $nodeModulesIndex = $fullPath.LastIndexOf($nodeModulesMarker, [System.StringComparison]::OrdinalIgnoreCase)
    if ($nodeModulesIndex -ge 0) {
        return $fullPath.Substring(0, $nodeModulesIndex + $nodeModulesMarker.Length - 1)
    }
    return Split-Path -Parent $fullPath
}

function Find-AjvRuntimePair {
    param(
        [string]$ExplicitAjv,
        [string]$ExplicitFormats,
        [Parameter(Mandatory = $true)][string]$Root
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitAjv) -and -not (Test-Path -LiteralPath $ExplicitAjv -PathType Leaf)) {
        throw "AJV_2020_NOT_FOUND:$ExplicitAjv"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExplicitFormats) -and -not (Test-Path -LiteralPath $ExplicitFormats -PathType Leaf)) {
        throw "AJV_FORMATS_NOT_FOUND:$ExplicitFormats"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExplicitAjv) -and -not [string]::IsNullOrWhiteSpace($ExplicitFormats)) {
        $ajvTree = Get-DependencyTreeRoot -EntryPath $ExplicitAjv
        $formatsTree = Get-DependencyTreeRoot -EntryPath $ExplicitFormats
        if ($ajvTree -ne $formatsTree) {
            throw "AJV_DEPENDENCY_TREE_MISMATCH:ajv=$ajvTree formats=$formatsTree"
        }
        return [pscustomobject]@{
            AjvPath = [System.IO.Path]::GetFullPath($ExplicitAjv)
            FormatsPath = [System.IO.Path]::GetFullPath($ExplicitFormats)
            Source = 'explicit'
            Rank = -1
        }
    }

    $candidates = [System.Collections.Generic.List[object]]::new()
    $searchRoots = [System.Collections.Generic.List[object]]::new()
    $searchRoots.Add([pscustomobject]@{ Path = $Root; DirectRank = 0; PnpmRank = 1 })
    Get-ChildItem -LiteralPath $Root -Directory -ErrorAction Stop |
        Where-Object { $_.Name -like 'version-*' } |
        Sort-Object FullName |
        ForEach-Object {
            $searchRoots.Add([pscustomobject]@{ Path = $_.FullName; DirectRank = 2; PnpmRank = 3 })
        }

    foreach ($searchRoot in $searchRoots) {
        $directAjv = Join-Path $searchRoot.Path 'node_modules\ajv\dist\2020.js'
        $directFormats = Join-Path $searchRoot.Path 'node_modules\ajv-formats\dist\index.js'
        if ((Test-Path -LiteralPath $directAjv -PathType Leaf) -and (Test-Path -LiteralPath $directFormats -PathType Leaf)) {
            $candidates.Add([pscustomobject]@{
                AjvPath = [System.IO.Path]::GetFullPath($directAjv)
                FormatsPath = [System.IO.Path]::GetFullPath($directFormats)
                Source = 'discovered_direct'
                Rank = $searchRoot.DirectRank
            })
        }

        $pnpmRoot = Join-Path $searchRoot.Path 'node_modules\.pnpm'
        if (Test-Path -LiteralPath $pnpmRoot -PathType Container) {
            $ajvEntries = @(Get-ChildItem -LiteralPath $pnpmRoot -Directory -ErrorAction Stop |
                Where-Object { $_.Name -match '^ajv@' } |
                ForEach-Object { Join-Path $_.FullName 'node_modules\ajv\dist\2020.js' } |
                Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
            $formatEntries = @(Get-ChildItem -LiteralPath $pnpmRoot -Directory -ErrorAction Stop |
                Where-Object { $_.Name -match '^ajv-formats@' } |
                ForEach-Object { Join-Path $_.FullName 'node_modules\ajv-formats\dist\index.js' } |
                Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
            foreach ($ajvEntry in $ajvEntries) {
                foreach ($formatEntry in $formatEntries) {
                    $candidates.Add([pscustomobject]@{
                        AjvPath = [System.IO.Path]::GetFullPath($ajvEntry)
                        FormatsPath = [System.IO.Path]::GetFullPath($formatEntry)
                        Source = 'discovered_pnpm'
                        Rank = $searchRoot.PnpmRank
                    })
                }
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($ExplicitAjv)) {
        $explicitFull = [System.IO.Path]::GetFullPath($ExplicitAjv)
        $candidates = @($candidates | Where-Object { $_.AjvPath -eq $explicitFull })
    }
    if (-not [string]::IsNullOrWhiteSpace($ExplicitFormats)) {
        $explicitFull = [System.IO.Path]::GetFullPath($ExplicitFormats)
        $candidates = @($candidates | Where-Object { $_.FormatsPath -eq $explicitFull })
    }
    if ($candidates.Count -eq 0) {
        throw 'AJV_RUNTIME_PAIR_NOT_FOUND'
    }

    $annotated = @($candidates | ForEach-Object {
        $ajvHash = (Get-FileHash -LiteralPath $_.AjvPath -Algorithm SHA256).Hash
        $formatsHash = (Get-FileHash -LiteralPath $_.FormatsPath -Algorithm SHA256).Hash
        [pscustomobject]@{
            AjvPath = $_.AjvPath
            FormatsPath = $_.FormatsPath
            Source = $_.Source
            Rank = $_.Rank
            Signature = "$ajvHash|$formatsHash"
        }
    })
    $signatures = @($annotated | Select-Object -ExpandProperty Signature -Unique)
    if ($signatures.Count -ne 1) {
        throw "AJV_AMBIGUOUS:distinct_hash_pairs=$($signatures.Count)"
    }
    return $annotated | Sort-Object Rank, AjvPath, FormatsPath | Select-Object -First 1
}

$savedNode = $env:DIET_MANAGER_NODE
$savedAjv = $env:DIET_MANAGER_AJV_2020
$savedAjvFormats = $env:DIET_MANAGER_AJV_FORMATS
$before = Get-BusinessDataSnapshot -Root $projectRoot
$nodeExitCode = 2
$runnerOutput = @()
$caughtError = $null

try {
    if ([string]::IsNullOrWhiteSpace($env:DIET_MANAGER_NODE)) {
        if (Test-Path -LiteralPath $fallbackNode -PathType Leaf) {
            $env:DIET_MANAGER_NODE = $fallbackNode
        } else {
            $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
            if ($null -eq $nodeCommand) {
                throw 'NODE_NOT_FOUND'
            }
            $env:DIET_MANAGER_NODE = $nodeCommand.Source
        }
    }
    $runtimePair = Find-AjvRuntimePair -ExplicitAjv $env:DIET_MANAGER_AJV_2020 -ExplicitFormats $env:DIET_MANAGER_AJV_FORMATS -Root $projectRoot
    $env:DIET_MANAGER_AJV_2020 = $runtimePair.AjvPath
    $env:DIET_MANAGER_AJV_FORMATS = $runtimePair.FormatsPath
    if (-not (Test-Path -LiteralPath $env:DIET_MANAGER_NODE -PathType Leaf)) {
        throw "NODE_NOT_FOUND:$($env:DIET_MANAGER_NODE)"
    }
    if (-not (Test-Path -LiteralPath $env:DIET_MANAGER_AJV_2020 -PathType Leaf)) {
        throw "AJV_2020_NOT_FOUND:$($env:DIET_MANAGER_AJV_2020)"
    }
    if (-not (Test-Path -LiteralPath $env:DIET_MANAGER_AJV_FORMATS -PathType Leaf)) {
        throw "AJV_FORMATS_NOT_FOUND:$($env:DIET_MANAGER_AJV_FORMATS)"
    }

    $resolvedNodePath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $env:DIET_MANAGER_NODE -ErrorAction Stop).ProviderPath)
    $resolvedTrustedNodePath = [System.IO.Path]::GetFullPath($trustedNodePath)
    $nodeHash = (Get-FileHash -LiteralPath $resolvedNodePath -Algorithm SHA256).Hash
    if ($resolvedNodePath -ine $resolvedTrustedNodePath -or $nodeHash -ne $trustedNodeSha256) {
        throw "NODE_RUNTIME_UNTRUSTED:path=$resolvedNodePath sha256=$nodeHash expected_path=$resolvedTrustedNodePath expected_sha256=$trustedNodeSha256"
    }
    $env:DIET_MANAGER_NODE = $resolvedNodePath

    if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
        throw "FIXTURES_NOT_FOUND:$fixturePath"
    }
    $fixtureDocument = Get-Content -LiteralPath $fixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $fixtureDocument.cases -or -not ($fixtureDocument.cases -is [System.Array]) -or $fixtureDocument.cases.Count -lt 1) {
        throw 'FIXTURES_INVALID_SHAPE:cases must be a non-empty array'
    }
    $fixtureCases = @($fixtureDocument.cases)
    $nonBooleanCases = @($fixtureCases | Where-Object { -not ($_.valid -is [System.Boolean]) })
    if ($nonBooleanCases.Count -ne 0) {
        throw "FIXTURES_INVALID_SHAPE:valid must be boolean count=$($nonBooleanCases.Count)"
    }
    $expectedCaseTotal = $fixtureCases.Count
    $expectedValidTotal = @($fixtureCases | Where-Object { $_.valid -eq $true }).Count
    $expectedInvalidTotal = @($fixtureCases | Where-Object { $_.valid -eq $false }).Count

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $nodeVersionOutput = @(& $env:DIET_MANAGER_NODE --version 2>&1)
        $nodeVersionExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($nodeVersionExitCode -ne 0) {
        throw "NODE_VERSION_FAILED:exit=$nodeVersionExitCode output=$($nodeVersionOutput -join ' ')"
    }
    $nodeVersion = ($nodeVersionOutput -join ' ').Trim()
    if ($nodeVersion -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') {
        throw "NODE_VERSION_INVALID:output=$nodeVersion"
    }
    $ajvHash = (Get-FileHash -LiteralPath $env:DIET_MANAGER_AJV_2020 -Algorithm SHA256).Hash
    $ajvFormatsHash = (Get-FileHash -LiteralPath $env:DIET_MANAGER_AJV_FORMATS -Algorithm SHA256).Hash
    "NODE_PATH=$($env:DIET_MANAGER_NODE)"
    "NODE_SHA256=$nodeHash"
    'NODE_RUNTIME_TRUST=trusted'
    "NODE_VERSION=$nodeVersion"
    "AJV_2020_PATH=$($env:DIET_MANAGER_AJV_2020)"
    "AJV_2020_SHA256=$ajvHash"
    "AJV_FORMATS_PATH=$($env:DIET_MANAGER_AJV_FORMATS)"
    "AJV_FORMATS_SHA256=$ajvFormatsHash"
    "AJV_RUNTIME_SOURCE=$($runtimePair.Source)"

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $runnerOutput = @(& $env:DIET_MANAGER_NODE $runnerPath 2>&1)
        $nodeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    $runnerLines = @($runnerOutput | ForEach-Object { "$_" })
    if (@($runnerLines | Where-Object { $_ -match '^VERDICT=' }).Count -ne 0) {
        throw 'RUNNER_PROTOCOL_INVALID:runner must not emit wrapper VERDICT'
    }
    $requiredRunnerFields = @('SCHEMA_COMPILE', 'CASE_TOTAL', 'VALID_PASS', 'INVALID_PASS', 'CASE_FAILURE_COUNT', 'RUNNER_VERDICT')
    foreach ($field in $requiredRunnerFields) {
        $matches = @($runnerLines | Where-Object { $_ -match "^$field=" })
        if ($matches.Count -ne 1) {
            throw "RUNNER_PROTOCOL_INVALID:field=$field count=$($matches.Count) exit=$nodeExitCode"
        }
    }
    $runnerVerdict = ($runnerLines | Where-Object { $_ -match '^RUNNER_VERDICT=' }) -replace '^RUNNER_VERDICT=', ''
    if (($nodeExitCode -eq 0 -and $runnerVerdict -ne 'PASS') -or
        ($nodeExitCode -ne 0 -and $runnerVerdict -ne 'FAIL')) {
        throw "RUNNER_PROTOCOL_INVALID:verdict=$runnerVerdict exit=$nodeExitCode"
    }
    if ($nodeExitCode -eq 0) {
        $expectedRunnerValues = [ordered]@{
            SCHEMA_COMPILE = 'PASS'
            CASE_TOTAL = "$expectedCaseTotal"
            VALID_PASS = "$expectedValidTotal/$expectedValidTotal"
            INVALID_PASS = "$expectedInvalidTotal/$expectedInvalidTotal"
            CASE_FAILURE_COUNT = '0'
            RUNNER_VERDICT = 'PASS'
        }
        foreach ($field in $expectedRunnerValues.Keys) {
            $actualValue = (($runnerLines | Where-Object { $_ -match "^$field=" }) -replace "^$field=", '')
            if ($actualValue -cne $expectedRunnerValues[$field]) {
                throw "RUNNER_PROTOCOL_INVALID:field=$field actual=$actualValue expected=$($expectedRunnerValues[$field]) exit=$nodeExitCode"
            }
        }
    }
    $runnerLines | ForEach-Object { $_ }
} catch {
    $caughtError = $_.Exception.Message
    "RUNNER_ERROR=$caughtError"
} finally {
    if ($null -eq $savedNode) {
        Remove-Item Env:DIET_MANAGER_NODE -ErrorAction SilentlyContinue
    } else {
        $env:DIET_MANAGER_NODE = $savedNode
    }
    if ($null -eq $savedAjv) {
        Remove-Item Env:DIET_MANAGER_AJV_2020 -ErrorAction SilentlyContinue
    } else {
        $env:DIET_MANAGER_AJV_2020 = $savedAjv
    }
    if ($null -eq $savedAjvFormats) {
        Remove-Item Env:DIET_MANAGER_AJV_FORMATS -ErrorAction SilentlyContinue
    } else {
        $env:DIET_MANAGER_AJV_FORMATS = $savedAjvFormats
    }
}

$after = Get-BusinessDataSnapshot -Root $projectRoot
$changes = @(Compare-BusinessDataSnapshot -Before $before -After $after)
"BUSINESS_BEFORE_COUNT=$($before.Count)"
"BUSINESS_AFTER_COUNT=$($after.Count)"
"BUSINESS_DATA_CHANGED=$($changes.Count)"
$changes | ForEach-Object { "BUSINESS_CHANGE=$_" }
"RUNNER_EXIT_CODE=$nodeExitCode"

if ($changes.Count -ne 0) {
    'VERDICT=FAIL'
    exit 3
}
if ($null -ne $caughtError) {
    'VERDICT=FAIL'
    exit 2
}
if ($nodeExitCode -ne 0) {
    'VERDICT=FAIL'
    exit $nodeExitCode
}
'VERDICT=PASS'
exit 0
