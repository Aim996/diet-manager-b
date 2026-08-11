param(
    [string]$SharedRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ExpectedGoldenCaseIds = @(
    'CASE-RECEIPT-001',
    'CASE-RECEIPT-002',
    'CASE-RECEIPT-004',
    'CASE-RECEIPT-005',
    'CASE-RECEIPT-006',
    'CASE-PROGRESS-006',
    'CASE-STORAGE-006',
    'CASE-EFFECT-003'
)

$script:ExpectedGoldenFixtureIds = @(
    'golden-receipt-multi-dish-v1',
    'golden-receipt-evidence-quick-v1',
    'golden-receipt-normal-success-v1',
    'golden-receipt-requested-analysis-v1',
    'golden-receipt-single-item-v1',
    'golden-progress-same-finalizer-v1',
    'golden-receipt-cross-date-replay-v1',
    'golden-receipt-finalizer-pending-v1'
)

$script:ExpectedGoldenModes = @(
    'terminal_success',
    'terminal_success',
    'terminal_success',
    'terminal_success',
    'terminal_success',
    'terminal_success',
    'terminal_replay',
    'effects_pending'
)

$script:ExpectedGoldenAliases = @(
    'required_equal_single',
    'required_equal_single',
    'required_equal_single',
    'required_equal_single',
    'required_equal_single',
    'required_equal_single',
    'forbidden_multi',
    'forbidden_pending'
)

$script:GoldenRootProperties = @(
    'golden_catalog_id',
    'version',
    'encoding',
    'newline',
    'terminal_newline',
    'entries'
)

$script:GoldenEntryProperties = @(
    'fixture_id',
    'case_id',
    'mode',
    'final_result',
    'text_path',
    'utf8_length',
    'sha256',
    'line_count',
    'block_order',
    'progress_dates',
    'daily_progress_alias',
    'required_literals',
    'forbidden_literals'
)

function Assert-GoldenTrue {
    param(
        [bool]$Condition,
        [string]$Code
    )

    if (-not $Condition) {
        throw $Code
    }
}

function Read-GoldenJson {
    param(
        [string]$Path,
        [string]$MissingCode
    )

    Assert-GoldenTrue ([IO.File]::Exists($Path)) $MissingCode
    try {
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        return ($utf8.GetString([IO.File]::ReadAllBytes($Path)) | ConvertFrom-Json)
    }
    catch {
        throw ('GOLDEN_JSON_INVALID:{0}' -f $_.Exception.Message)
    }
}

function Assert-GoldenPlainObject {
    param(
        $Value,
        [string]$Code
    )

    Assert-GoldenTrue ($null -ne $Value) $Code
    Assert-GoldenTrue (-not ($Value -is [Array])) $Code
    Assert-GoldenTrue (-not ($Value -is [string])) $Code
    Assert-GoldenTrue (-not ($Value -is [ValueType])) $Code
    Assert-GoldenTrue ($Value -is [psobject]) $Code
}

function Assert-GoldenExactProperties {
    param(
        $Value,
        [string[]]$Expected,
        [string]$Code
    )

    Assert-GoldenPlainObject $Value $Code
    $actual = @($Value.PSObject.Properties.Name)
    Assert-GoldenTrue ($actual.Count -eq $Expected.Count) ("${Code}:property_count")
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-GoldenTrue ($actual[$index] -ceq $Expected[$index]) ("${Code}:property_${index}")
        Assert-GoldenTrue ($Value.PSObject.Properties[$actual[$index]].MemberType -eq 'NoteProperty') ("${Code}:member_${index}")
    }
}

function Assert-GoldenExactStringArray {
    param(
        [string[]]$Expected,
        $Actual,
        [string]$Code
    )

    Assert-GoldenTrue ($Actual -is [Array]) ("${Code}:array")
    $values = @($Actual)
    Assert-GoldenTrue ($values.Count -eq $Expected.Count) ("${Code}:count")
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-GoldenTrue ($values[$index] -is [string]) ("${Code}:type_${index}")
        Assert-GoldenTrue ([string]$values[$index] -ceq $Expected[$index]) ("${Code}:value_${index}")
    }
}

function Assert-GoldenStringArray {
    param(
        $Actual,
        [string]$Code,
        [bool]$AllowEmpty = $false
    )

    Assert-GoldenTrue ($Actual -is [Array]) ("${Code}:array")
    $values = @($Actual)
    if (-not $AllowEmpty) {
        Assert-GoldenTrue ($values.Count -gt 0) ("${Code}:empty")
    }

    $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    for ($index = 0; $index -lt $values.Count; $index++) {
        Assert-GoldenTrue ($values[$index] -is [string]) ("${Code}:type_${index}")
        Assert-GoldenTrue (-not [string]::IsNullOrWhiteSpace([string]$values[$index])) ("${Code}:blank_${index}")
        Assert-GoldenTrue ($seen.Add([string]$values[$index])) ("${Code}:duplicate_${index}")
    }
}

function Get-GoldenSha256 {
    param([byte[]]$Bytes)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '')
    }
    finally {
        $sha.Dispose()
    }
}

function Read-GoldenTextAsset {
    param(
        [string]$Path,
        $Entry
    )

    Assert-GoldenTrue ([IO.File]::Exists($Path)) ('GOLDEN_TEXT_MISSING:{0}' -f $Entry.case_id)
    $item = Get-Item -LiteralPath $Path -Force
    Assert-GoldenTrue (-not $item.PSIsContainer) ('GOLDEN_TEXT_NOT_FILE:{0}' -f $Entry.case_id)
    Assert-GoldenTrue (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) ('GOLDEN_TEXT_REPARSE:{0}' -f $Entry.case_id)

    $bytes = [IO.File]::ReadAllBytes($Path)
    Assert-GoldenTrue ($bytes.Count -gt 0) ('GOLDEN_TEXT_EMPTY:{0}' -f $Entry.case_id)
    Assert-GoldenTrue (-not ($bytes.Count -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)) ('GOLDEN_TEXT_BOM:{0}' -f $Entry.case_id)
    Assert-GoldenTrue (-not ($bytes -contains 13)) ('GOLDEN_TEXT_CR:{0}' -f $Entry.case_id)
    Assert-GoldenTrue (-not ($bytes -contains 0)) ('GOLDEN_TEXT_NUL:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ($bytes[$bytes.Count - 1] -eq 10) ('GOLDEN_TEXT_TERMINAL_LF:{0}' -f $Entry.case_id)
    if ($bytes.Count -gt 1) {
        Assert-GoldenTrue ($bytes[$bytes.Count - 2] -ne 10) ('GOLDEN_TEXT_EXTRA_TERMINAL_LF:{0}' -f $Entry.case_id)
    }

    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    try {
        $text = $utf8.GetString($bytes)
    }
    catch {
        throw ('GOLDEN_TEXT_UTF8:{0}' -f $Entry.case_id)
    }

    Assert-GoldenTrue ($bytes.Count -eq [int]$Entry.utf8_length) ('GOLDEN_TEXT_LENGTH:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ((Get-GoldenSha256 $bytes) -ceq [string]$Entry.sha256) ('GOLDEN_TEXT_SHA256:{0}' -f $Entry.case_id)

    $withoutTerminalLf = $text.Substring(0, $text.Length - 1)
    $lines = @($withoutTerminalLf -split "`n", -1)
    Assert-GoldenTrue ($lines.Count -eq [int]$Entry.line_count) ('GOLDEN_TEXT_LINE_COUNT:{0}' -f $Entry.case_id)

    foreach ($literal in @($Entry.required_literals)) {
        Assert-GoldenTrue ($text.Contains([string]$literal)) ('GOLDEN_TEXT_REQUIRED_LITERAL:{0}:{1}' -f $Entry.case_id, $literal)
    }
    foreach ($literal in @($Entry.forbidden_literals)) {
        Assert-GoldenTrue (-not $text.Contains([string]$literal)) ('GOLDEN_TEXT_FORBIDDEN_LITERAL:{0}:{1}' -f $Entry.case_id, $literal)
    }

    return [pscustomobject][ordered]@{
        bytes = $bytes
        text = $text
        lines = $lines
    }
}

function Resolve-GoldenTextPath {
    param(
        [string]$Root,
        [string]$RelativePath,
        [string]$CaseId
    )

    Assert-GoldenTrue (-not [string]::IsNullOrWhiteSpace($RelativePath)) ('GOLDEN_TEXT_PATH_EMPTY:{0}' -f $CaseId)
    Assert-GoldenTrue (-not [IO.Path]::IsPathRooted($RelativePath)) ('GOLDEN_TEXT_PATH_ROOTED:{0}' -f $CaseId)
    Assert-GoldenTrue ($RelativePath.IndexOf('\') -lt 0) ('GOLDEN_TEXT_PATH_SEPARATOR:{0}' -f $CaseId)
    Assert-GoldenTrue ($RelativePath -match '^shared/acceptance-cases/golden-receipts/[A-Z0-9-]+\.txt$') ('GOLDEN_TEXT_PATH_FORMAT:{0}' -f $CaseId)

    $segments = @($RelativePath.Split('/'))
    Assert-GoldenTrue (-not ($segments -contains '..')) ('GOLDEN_TEXT_PATH_TRAVERSAL:{0}' -f $CaseId)
    Assert-GoldenTrue (-not ($segments -contains '.')) ('GOLDEN_TEXT_PATH_TRAVERSAL:{0}' -f $CaseId)

    $sharedFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $repositoryRoot = [IO.Path]::GetFullPath((Split-Path -Parent $sharedFull)).TrimEnd('\')
    $goldenRoot = [IO.Path]::GetFullPath((Join-Path $sharedFull 'acceptance-cases\golden-receipts')).TrimEnd('\')
    $candidate = [IO.Path]::GetFullPath((Join-Path $repositoryRoot ($RelativePath.Replace('/', '\'))))
    $prefix = $goldenRoot + '\'
    Assert-GoldenTrue ($candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) ('GOLDEN_TEXT_PATH_ESCAPE:{0}' -f $CaseId)
    return $candidate
}

function Assert-GoldenCatalogCandidate {
    param(
        $Catalog,
        [string]$Root
    )

    Assert-GoldenExactProperties $Catalog $script:GoldenRootProperties 'GOLDEN_CATALOG_SHAPE'
    Assert-GoldenTrue ([string]$Catalog.golden_catalog_id -ceq 'diet-manager/golden-receipts-v1') 'GOLDEN_CATALOG_ID'
    Assert-GoldenTrue ([string]$Catalog.version -ceq '1.0.0') 'GOLDEN_CATALOG_VERSION'
    Assert-GoldenTrue ([string]$Catalog.encoding -ceq 'utf-8') 'GOLDEN_CATALOG_ENCODING'
    Assert-GoldenTrue ([string]$Catalog.newline -ceq 'lf') 'GOLDEN_CATALOG_NEWLINE'
    Assert-GoldenTrue ($Catalog.terminal_newline -is [bool]) 'GOLDEN_CATALOG_TERMINAL_NEWLINE_TYPE'
    Assert-GoldenTrue ([bool]$Catalog.terminal_newline) 'GOLDEN_CATALOG_TERMINAL_NEWLINE'
    Assert-GoldenTrue ($Catalog.entries -is [Array]) 'GOLDEN_CATALOG_ENTRIES_ARRAY'

    $entries = @($Catalog.entries)
    Assert-GoldenTrue ($entries.Count -eq $script:ExpectedGoldenCaseIds.Count) 'GOLDEN_CATALOG_ENTRY_COUNT'
    $fixtureIds = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $caseIds = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $paths = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)

    for ($index = 0; $index -lt $entries.Count; $index++) {
        $entry = $entries[$index]
        $entryCode = 'GOLDEN_ENTRY_SHAPE:{0}' -f $index
        Assert-GoldenExactProperties $entry $script:GoldenEntryProperties $entryCode

        Assert-GoldenTrue ($entry.fixture_id -is [string]) ('GOLDEN_FIXTURE_ID_TYPE:{0}' -f $index)
        Assert-GoldenTrue ([string]$entry.fixture_id -ceq $script:ExpectedGoldenFixtureIds[$index]) ('GOLDEN_FIXTURE_ID:{0}' -f $index)
        Assert-GoldenTrue ($fixtureIds.Add([string]$entry.fixture_id)) ('GOLDEN_FIXTURE_ID_DUPLICATE:{0}' -f $index)

        Assert-GoldenTrue ($entry.case_id -is [string]) ('GOLDEN_CASE_ID_TYPE:{0}' -f $index)
        Assert-GoldenTrue ([string]$entry.case_id -ceq $script:ExpectedGoldenCaseIds[$index]) ('GOLDEN_CASE_ID:{0}' -f $index)
        Assert-GoldenTrue ($caseIds.Add([string]$entry.case_id)) ('GOLDEN_CASE_ID_DUPLICATE:{0}' -f $index)

        Assert-GoldenTrue ($entry.mode -is [string]) ('GOLDEN_MODE_TYPE:{0}' -f $entry.case_id)
        Assert-GoldenTrue ([string]$entry.mode -ceq $script:ExpectedGoldenModes[$index]) ('GOLDEN_MODE:{0}' -f $entry.case_id)
        Assert-GoldenPlainObject $entry.final_result ('GOLDEN_FINAL_RESULT:{0}' -f $entry.case_id)

        Assert-GoldenTrue ($entry.text_path -is [string]) ('GOLDEN_TEXT_PATH_TYPE:{0}' -f $entry.case_id)
        Assert-GoldenTrue ($paths.Add([string]$entry.text_path)) ('GOLDEN_TEXT_PATH_DUPLICATE:{0}' -f $entry.case_id)
        Assert-GoldenTrue ([string]$entry.text_path -ceq ('shared/acceptance-cases/golden-receipts/{0}.txt' -f $entry.case_id)) ('GOLDEN_TEXT_PATH_CASE:{0}' -f $entry.case_id)

        Assert-GoldenTrue ($entry.utf8_length -is [int]) ('GOLDEN_TEXT_LENGTH_TYPE:{0}' -f $entry.case_id)
        Assert-GoldenTrue ([int]$entry.utf8_length -gt 0) ('GOLDEN_TEXT_LENGTH_VALUE:{0}' -f $entry.case_id)
        Assert-GoldenTrue ($entry.sha256 -is [string]) ('GOLDEN_TEXT_SHA256_TYPE:{0}' -f $entry.case_id)
        Assert-GoldenTrue ([string]$entry.sha256 -cmatch '^[0-9A-F]{64}$') ('GOLDEN_TEXT_SHA256_FORMAT:{0}' -f $entry.case_id)
        Assert-GoldenTrue ($entry.line_count -is [int]) ('GOLDEN_TEXT_LINE_COUNT_TYPE:{0}' -f $entry.case_id)
        Assert-GoldenTrue ([int]$entry.line_count -gt 0) ('GOLDEN_TEXT_LINE_COUNT_VALUE:{0}' -f $entry.case_id)

        Assert-GoldenStringArray $entry.block_order ('GOLDEN_BLOCK_ORDER:{0}' -f $entry.case_id)
        Assert-GoldenStringArray $entry.progress_dates ('GOLDEN_PROGRESS_DATES:{0}' -f $entry.case_id) ($entry.case_id -ceq 'CASE-EFFECT-003')
        foreach ($date in @($entry.progress_dates)) {
            Assert-GoldenTrue ([string]$date -cmatch '^\d{4}-\d{2}-\d{2}$') ('GOLDEN_PROGRESS_DATE_FORMAT:{0}:{1}' -f $entry.case_id, $date)
        }

        Assert-GoldenTrue ($entry.daily_progress_alias -is [string]) ('GOLDEN_ALIAS_TYPE:{0}' -f $entry.case_id)
        Assert-GoldenTrue ([string]$entry.daily_progress_alias -ceq $script:ExpectedGoldenAliases[$index]) ('GOLDEN_ALIAS:{0}' -f $entry.case_id)
        Assert-GoldenStringArray $entry.required_literals ('GOLDEN_REQUIRED_LITERALS:{0}' -f $entry.case_id)
        Assert-GoldenStringArray $entry.forbidden_literals ('GOLDEN_FORBIDDEN_LITERALS:{0}' -f $entry.case_id)

        $textPath = Resolve-GoldenTextPath $Root ([string]$entry.text_path) ([string]$entry.case_id)
        $null = Read-GoldenTextAsset $textPath $entry
    }

    Assert-GoldenExactStringArray $script:ExpectedGoldenCaseIds @($entries | ForEach-Object { [string]$_.case_id }) 'GOLDEN_CASE_ORDER'
    return $entries
}

function Test-GoldenAssetPackage {
    param(
        [string]$CatalogPath,
        [string]$Root
    )

    $catalog = Read-GoldenJson $CatalogPath 'GOLDEN_MANIFEST_MISSING'
    $entries = @(Assert-GoldenCatalogCandidate $catalog $Root)
    [pscustomobject][ordered]@{
        version = [string]$catalog.version
        entries = $entries
    }
}

if (-not $LibraryOnly) {
    $catalogPath = Join-Path $SharedRoot 'acceptance-cases\golden-receipts\manifest.json'
    $result = Test-GoldenAssetPackage $catalogPath $SharedRoot
    Write-Output ('GOLDEN_RECEIPT_ASSETS|PASS|version={0}|entries={1}' -f $result.version, @($result.entries).Count)
}
