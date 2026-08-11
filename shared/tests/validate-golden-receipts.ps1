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

$script:ExpectedGoldenCaseCatalogIds = @(
    'CASE-MEAL-001',
    'CASE-MEAL-021',
    'CASE-WATER-001',
    'CASE-RECEIPT-001',
    'CASE-QUERY-001',
    'CASE-PURCHASE-001',
    'CASE-INVENTORY-003',
    'CASE-NUTR-001',
    'CASE-ISSUE-001',
    'CASE-CORR-001',
    'CASE-MIXED-001',
    'CASE-EFFECT-001',
    'CASE-EFFECT-003',
    'CASE-STORAGE-007',
    'CASE-PRIV-001',
    'CASE-FOUNDATION-002',
    'CASE-OPS-001',
    'CASE-OPS-003',
    'CASE-OPS-010',
    'CASE-EXPORT-004',
    'CASE-RECEIPT-002',
    'CASE-RECEIPT-004',
    'CASE-RECEIPT-005',
    'CASE-RECEIPT-006',
    'CASE-PROGRESS-006',
    'CASE-STORAGE-006'
)

$script:PreviousGoldenCaseHashes = [ordered]@{
    'CASE-MEAL-001' = '167089A439136DA84BE755D6B4021774488749FD6B79F85DFE3AABCED1967BB2'
    'CASE-MEAL-021' = '9FA011C16709C126201A89810FDFA6A486703851DEAE7AA75C6A3B3CD8F04791'
    'CASE-WATER-001' = 'BAAF70EC57CB9F5F907E93BA53B3D3AB0D37E1D9BC42070F276D5BFAB25634F6'
    'CASE-RECEIPT-001' = '307CC2DA1CCE54FA892E815EE4976D699A165E7C24B4CCDE9A05EAE380BFB010'
    'CASE-QUERY-001' = '11CAE99D90524A065A8EDE3371A2C6B877B512F4047F96891988750F9762CC11'
    'CASE-PURCHASE-001' = '7B27F579074B84421B7FA2B60222BA59D19A5D95770DF1908502FB9F0B285E64'
    'CASE-INVENTORY-003' = 'E670546B4FC833CDF19AC703676D884760115B53D9CF1749BC7546B0DB6DEB77'
    'CASE-NUTR-001' = '4F096C6067C0F0CC5347D0672F5AC87248D9D6F6386D8B23428765D8ACF84F7E'
    'CASE-ISSUE-001' = '8F40AF700C939A9B0042C9F335A31F37C1CA0AA710FA9F822F38EEF6274F061A'
    'CASE-CORR-001' = '83E1978A1802CE34C60142DFE825D12FD9567291C38918BA1ECB862523A50A9D'
    'CASE-MIXED-001' = '5B33697E93ECA5907F0563AEED9FC16BCF259586BD6503C83067B3F55C079FB7'
    'CASE-EFFECT-001' = '18F6648B7B2DE2EBAE1264EF07E35DEF742C2940DB35E12CC27A52F3B953F1CE'
    'CASE-EFFECT-003' = '5F8ECF809129C12AF76F61B7FD77F2AAE4E85A2C753B713D133EA59938AFB81D'
    'CASE-STORAGE-007' = '702816E2245FCAAF43F293A4E09D773C0870FF2D086B74471F11345F2085414D'
    'CASE-PRIV-001' = '58A1D131CBE6F13E6002ABE2ACAD07CEB1973E35800E6F05EDA90CB9FAC9E4C6'
    'CASE-FOUNDATION-002' = '4D00E84EA1962BFEF3AC38EBBEA3E0779213BEB0E1DEF57AA68B878B5A5FD3E3'
    'CASE-OPS-001' = '798BCC8BA068030E2A08B6A22546962458511505CF7C16940D5CDBD1F165204F'
    'CASE-OPS-003' = '41B2B565CA09D20CFC3E617EE5E1DDA5C2D821AD1A5D18DBA8D15FB21505781C'
    'CASE-OPS-010' = '00C2CE40A474C47B4D0B52C5F3835767A5344024B2B8A5A87B72BD3EB6554599'
    'CASE-EXPORT-004' = '63309A60973B6A6BA7B2778902E3128CA9AA696E1AA5F182EF368F24D8A6FED5'
}

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

$script:GoldenMetricOrder = @('energy', 'protein', 'fat', 'carbohydrate', 'fiber', 'water')
$script:GoldenMetricUnits = @('kcal', 'g', 'g', 'g', 'g', 'ml')
$script:GoldenCaseProperties = @('id', 'requirement_ids', 'stage', 'source_text', 'setup', 'oracle', 'forbidden')
$script:GoldenSetupProperties = @('environment_fixture', 'goals_fixture', 'query_view_fixture', 'prior_context')

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

function Get-GoldenJsonValueSha256 {
    param($Value)

    $json = $Value | ConvertTo-Json -Depth 64 -Compress
    $utf8 = New-Object Text.UTF8Encoding($false)
    return Get-GoldenSha256 $utf8.GetBytes($json)
}

function Copy-GoldenJson {
    param($Value)

    return ($Value | ConvertTo-Json -Depth 64 -Compress | ConvertFrom-Json)
}

function Test-GoldenNumber {
    param($Value)

    return ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal])
}

function Convert-GoldenCodePointsToString {
    param([int[]]$CodePoints)

    $builder = New-Object Text.StringBuilder
    foreach ($codePoint in $CodePoints) {
        $null = $builder.Append([char]::ConvertFromUtf32($codePoint))
    }
    return $builder.ToString()
}

function Assert-GoldenCaseCatalogCandidate {
    param($CaseSet)

    Assert-GoldenExactProperties $CaseSet @('case_set_id', 'version', 'contract', 'fixture_catalog', 'package_invariants', 'cases') 'GOLDEN_CASE_SET_SHAPE_INVALID'
    Assert-GoldenTrue ([string]$CaseSet.case_set_id -ceq 'diet-manager/core-acceptance-cases-v1') 'GOLDEN_CASE_SET_ID_INVALID'
    Assert-GoldenTrue ([string]$CaseSet.version -ceq '1.3.0') 'GOLDEN_CASE_SET_VERSION_INVALID'
    Assert-GoldenTrue ($CaseSet.cases -is [Array]) 'GOLDEN_CASE_SET_CASES_INVALID'

    $cases = @($CaseSet.cases)
    Assert-GoldenTrue ($cases.Count -eq $script:ExpectedGoldenCaseCatalogIds.Count) 'GOLDEN_CASE_SET_COUNT_INVALID'
    Assert-GoldenExactStringArray $script:ExpectedGoldenCaseCatalogIds @($cases | ForEach-Object { [string]$_.id }) 'GOLDEN_CASE_SET_IDS_INVALID'

    for ($index = 0; $index -lt $script:PreviousGoldenCaseHashes.Count; $index++) {
        $caseId = [string]@($script:PreviousGoldenCaseHashes.Keys)[$index]
        Assert-GoldenTrue ([string]$cases[$index].id -ceq $caseId) ('GOLDEN_PREVIOUS_CASE_ORDER:{0}' -f $index)
        $actualHash = Get-GoldenJsonValueSha256 $cases[$index]
        Assert-GoldenTrue ($actualHash -ceq [string]$script:PreviousGoldenCaseHashes[$caseId]) ('GOLDEN_PREVIOUS_CASE_CHANGED:{0}' -f $caseId)
    }

    for ($index = 20; $index -lt $cases.Count; $index++) {
        $case = $cases[$index]
        $caseId = [string]$case.id
        Assert-GoldenExactProperties $case $script:GoldenCaseProperties ('GOLDEN_APPENDED_CASE_SHAPE:{0}' -f $caseId)
        Assert-GoldenTrue ([string]$case.stage -ceq 'PRODUCT-0.1') ('GOLDEN_APPENDED_CASE_STAGE:{0}' -f $caseId)
        Assert-GoldenTrue (-not [string]::IsNullOrWhiteSpace([string]$case.source_text)) ('GOLDEN_APPENDED_CASE_SOURCE:{0}' -f $caseId)
        Assert-GoldenExactProperties $case.setup $script:GoldenSetupProperties ('GOLDEN_APPENDED_CASE_SETUP:{0}' -f $caseId)
        Assert-GoldenTrue ([string]$case.setup.environment_fixture -ceq 'env-zh-cn-20260811') ('GOLDEN_APPENDED_CASE_ENV:{0}' -f $caseId)
        Assert-GoldenTrue ([string]$case.setup.goals_fixture -ceq 'goals-six-metric-v1') ('GOLDEN_APPENDED_CASE_GOALS:{0}' -f $caseId)
        Assert-GoldenTrue ($null -eq $case.setup.query_view_fixture) ('GOLDEN_APPENDED_CASE_QUERY:{0}' -f $caseId)
        Assert-GoldenTrue ($case.setup.prior_context -is [Array] -and @($case.setup.prior_context).Count -eq 0) ('GOLDEN_APPENDED_CASE_CONTEXT:{0}' -f $caseId)
        Assert-GoldenPlainObject $case.oracle ('GOLDEN_APPENDED_CASE_ORACLE:{0}' -f $caseId)
        Assert-GoldenStringArray $case.forbidden ('GOLDEN_APPENDED_CASE_FORBIDDEN:{0}' -f $caseId)

        $expectedRequirements = switch ($caseId) {
            'CASE-RECEIPT-002' { @('REQ-RECEIPT-002', 'REQ-CORE-002', 'REQ-QUICK-001'); break }
            'CASE-RECEIPT-004' { @('REQ-RECEIPT-002', 'REQ-RECEIPT-003'); break }
            'CASE-RECEIPT-005' { @('REQ-RECEIPT-003', 'REQ-SCOPE-002'); break }
            'CASE-RECEIPT-006' { @('REQ-RECEIPT-001'); break }
            'CASE-PROGRESS-006' { @('REQ-PROGRESS-002'); break }
            'CASE-STORAGE-006' { @('REQ-PROGRESS-002', 'REQ-PROGRESS-004', 'REQ-SAFE-003'); break }
            default { throw ('GOLDEN_APPENDED_CASE_UNKNOWN:{0}' -f $caseId) }
        }
        Assert-GoldenExactStringArray $expectedRequirements $case.requirement_ids ('GOLDEN_APPENDED_CASE_REQUIREMENTS:{0}' -f $caseId)
    }

    return $cases
}

function Assert-GoldenProgressBlock {
    param(
        $Progress,
        [string]$Code
    )

    Assert-GoldenExactProperties $Progress @('date', 'metrics') ("${Code}:shape")
    Assert-GoldenTrue ($Progress.date -is [string] -and [string]$Progress.date -cmatch '^\d{4}-\d{2}-\d{2}$') ("${Code}:date")
    Assert-GoldenTrue ($Progress.metrics -is [Array]) ("${Code}:metrics_array")
    $metrics = @($Progress.metrics)
    Assert-GoldenTrue ($metrics.Count -eq 6) ("${Code}:metrics_count")

    for ($index = 0; $index -lt $metrics.Count; $index++) {
        $metric = $metrics[$index]
        Assert-GoldenExactProperties $metric @('metric', 'current', 'target', 'increment', 'unit', 'percentage', 'filled', 'increment_percentage') ("${Code}:metric_${index}_shape")
        Assert-GoldenTrue ([string]$metric.metric -ceq $script:GoldenMetricOrder[$index]) ("${Code}:metric_${index}_order")
        Assert-GoldenTrue ([string]$metric.unit -ceq $script:GoldenMetricUnits[$index]) ("${Code}:metric_${index}_unit")
        Assert-GoldenTrue (Test-GoldenNumber $metric.current) ("${Code}:metric_${index}_current")
        Assert-GoldenTrue (Test-GoldenNumber $metric.target) ("${Code}:metric_${index}_target")
        Assert-GoldenTrue ([double]$metric.target -gt 0) ("${Code}:metric_${index}_target_value")
        Assert-GoldenTrue (Test-GoldenNumber $metric.percentage) ("${Code}:metric_${index}_percentage")
        Assert-GoldenTrue ([double]$metric.percentage -ge 0) ("${Code}:metric_${index}_percentage_value")
        Assert-GoldenTrue ($metric.filled -is [int] -and [int]$metric.filled -ge 0 -and [int]$metric.filled -le 10) ("${Code}:metric_${index}_filled")

        $incrementIsNull = $null -eq $metric.increment
        $incrementPercentageIsNull = $null -eq $metric.increment_percentage
        Assert-GoldenTrue ($incrementIsNull -eq $incrementPercentageIsNull) ("${Code}:metric_${index}_increment_pair")
        if (-not $incrementIsNull) {
            Assert-GoldenTrue (Test-GoldenNumber $metric.increment) ("${Code}:metric_${index}_increment")
            Assert-GoldenTrue (Test-GoldenNumber $metric.increment_percentage) ("${Code}:metric_${index}_increment_percentage")
            Assert-GoldenTrue ([double]$metric.increment -ge 0 -and [double]$metric.increment_percentage -ge 0) ("${Code}:metric_${index}_increment_value")
        }
    }
}

function Assert-GoldenQuickOptions {
    param(
        $Entry,
        [string[]]$Lines
    )

    $code = 'GOLDEN_QUICK_OPTIONS:{0}' -f $Entry.case_id
    $prompt = $Entry.final_result.receipt_data.issue_prompt
    Assert-GoldenExactProperties $prompt @('issue_code', 'status', 'option_count', 'safe_exit_option', 'free_text_line') ("${code}:prompt")
    Assert-GoldenTrue ([string]$prompt.issue_code -ceq 'quantity_estimated') ("${code}:issue_code")
    Assert-GoldenTrue ([string]$prompt.status -ceq 'awaiting_user') ("${code}:status")
    Assert-GoldenTrue ($prompt.option_count -is [int] -and [int]$prompt.option_count -ge 2 -and [int]$prompt.option_count -le 4) ("${code}:count")
    Assert-GoldenTrue ([string]$prompt.safe_exit_option -ceq 'D') ("${code}:safe_exit_option")

    $optionLines = @($Lines | Where-Object { $_ -cmatch '^[A-D]\. ' })
    Assert-GoldenTrue ($optionLines.Count -eq [int]$prompt.option_count) ("${code}:line_count")
    $firstOptionIndex = [Array]::IndexOf([string[]]$Lines, [string]$optionLines[0])
    $headingIndex = $firstOptionIndex - 1
    Assert-GoldenTrue ($headingIndex -ge 0 -and -not [string]::IsNullOrWhiteSpace($Lines[$headingIndex])) ("${code}:heading")
    for ($index = 0; $index -lt $optionLines.Count; $index++) {
        $expectedLetter = [char]([int][char]'A' + $index)
        Assert-GoldenTrue ($optionLines[$index].StartsWith(('{0}. ' -f $expectedLetter), [StringComparison]::Ordinal)) ("${code}:order_${index}")
    }

    $safeExit = '{0}. ' -f [string]$prompt.safe_exit_option
    Assert-GoldenTrue (@($optionLines | Where-Object { $_.StartsWith($safeExit, [StringComparison]::Ordinal) }).Count -eq 1) ("${code}:safe_exit")
    $freeTextIndex = [Array]::IndexOf([string[]]$Lines, [string]$prompt.free_text_line)
    Assert-GoldenTrue ($freeTextIndex -eq ($headingIndex + $optionLines.Count + 1)) ("${code}:free_text_position")
    Assert-GoldenTrue (@($Entry.required_literals | Where-Object { [string]$_ -ceq [string]$prompt.free_text_line }).Count -eq 1) ("${code}:free_text_value")
}

function Assert-GoldenSingleDayAlias {
    param($Entry)

    $code = 'GOLDEN_SINGLE_DAY_ALIAS:{0}' -f $Entry.case_id
    Assert-GoldenTrue ($Entry.final_result.daily_progress_by_date -is [Array]) ("${code}:collection")
    $progress = @($Entry.final_result.daily_progress_by_date)
    Assert-GoldenTrue ($progress.Count -eq 1) ("${code}:count")
    Assert-GoldenTrue ($null -ne $Entry.final_result.daily_progress) ("${code}:missing")
    Assert-GoldenTrue ((Get-GoldenJsonValueSha256 $progress[0]) -ceq (Get-GoldenJsonValueSha256 $Entry.final_result.daily_progress)) ("${code}:different")
}

function Assert-GoldenCrossDayResult {
    param(
        $Entry,
        [string[]]$Lines
    )

    $code = 'GOLDEN_CROSS_DAY:{0}' -f $Entry.case_id
    $original = $Entry.final_result.original_result
    Assert-GoldenExactProperties $original @('receipt_data', 'daily_progress_by_date') ("${code}:original_shape")
    Assert-GoldenTrue ($original.daily_progress_by_date -is [Array]) ("${code}:progress_array")
    $progress = @($original.daily_progress_by_date)
    Assert-GoldenTrue ($progress.Count -eq 2) ("${code}:progress_count")
    Assert-GoldenProgressBlock $progress[0] ("${code}:date_0")
    Assert-GoldenProgressBlock $progress[1] ("${code}:date_1")
    Assert-GoldenTrue ([string]$progress[0].date -ceq '2026-08-08') ("${code}:date_0_value")
    Assert-GoldenTrue ([string]$progress[1].date -ceq '2026-08-09') ("${code}:date_1_value")
    Assert-GoldenTrue ([string]$progress[0].date -clt [string]$progress[1].date) ("${code}:date_order")
    Assert-GoldenTrue ($original.PSObject.Properties['daily_progress'] -eq $null) ("${code}:alias_present")

    $headingSuffix = Convert-GoldenCodePointsToString @(0x53F7, 0x66F4, 0x65B0, 0x540E)
    $firstHeading = [Array]::IndexOf([string[]]$Lines, ('8' + $headingSuffix))
    $secondHeading = [Array]::IndexOf([string[]]$Lines, ('9' + $headingSuffix))
    Assert-GoldenTrue ($firstHeading -ge 0 -and $secondHeading -gt $firstHeading) ("${code}:text_date_order")
    Assert-GoldenTrue ($secondHeading + 13 -eq $Lines.Count) ("${code}:progress_not_last")
}

function Assert-GoldenPendingResult {
    param(
        $Entry,
        [string]$Text
    )

    $code = 'GOLDEN_PENDING:{0}' -f $Entry.case_id
    $result = $Entry.final_result
    Assert-GoldenExactProperties $result @('command_status', 'envelope_status', 'receipt_data', 'daily_progress_by_date', 'daily_progress', 'terminal_idempotency_result', 'pending_message') ("${code}:shape")
    Assert-GoldenTrue ([string]$result.command_status -ceq 'failed') ("${code}:command_status")
    Assert-GoldenTrue ([string]$result.envelope_status -ceq 'effects_pending') ("${code}:envelope_status")
    Assert-GoldenTrue ($null -eq $result.receipt_data) ("${code}:receipt")
    Assert-GoldenTrue ($null -eq $result.daily_progress_by_date) ("${code}:progress_collection")
    Assert-GoldenTrue ($null -eq $result.daily_progress) ("${code}:progress_alias")
    Assert-GoldenTrue ($null -eq $result.terminal_idempotency_result) ("${code}:terminal_result")
    Assert-GoldenTrue ([string]$result.pending_message -ceq $Text) ("${code}:message")
    $successPrefix = Convert-GoldenCodePointsToString @(0x5DF2, 0x8BB0, 0x5F55)
    Assert-GoldenTrue (-not $Text.Contains($successPrefix)) ("${code}:success_title")
    foreach ($emoji in @(0x1F525, 0x1F969, 0x1F9C8, 0x1F33E, 0x1F96C, 0x1F4A7)) {
        $emojiText = Convert-GoldenCodePointsToString @($emoji)
        Assert-GoldenTrue (-not $Text.Contains($emojiText)) ("${code}:progress")
    }
}

function Assert-GoldenReplayResult {
    param($Entry)

    $code = 'GOLDEN_REPLAY:{0}' -f $Entry.case_id
    $result = $Entry.final_result
    Assert-GoldenExactProperties $result @('command_status', 'envelope_status', 'original_result', 'later_unrelated_write', 'retry_expectation') ("${code}:shape")
    Assert-GoldenTrue ([string]$result.command_status -ceq 'committed') ("${code}:command_status")
    Assert-GoldenTrue ([string]$result.envelope_status -ceq 'terminal') ("${code}:envelope_status")
    Assert-GoldenExactProperties $result.later_unrelated_write @('date', 'latest_energy_kcal', 'latest_water_ml') ("${code}:later_write_shape")
    Assert-GoldenTrue ([string]$result.later_unrelated_write.date -ceq '2026-08-09') ("${code}:later_write_date")
    Assert-GoldenTrue ([string]$result.retry_expectation -ceq 'exact_original_result') ("${code}:retry_expectation")

    $originalDay = @($result.original_result.daily_progress_by_date | Where-Object { [string]$_.date -ceq '2026-08-09' })
    Assert-GoldenTrue ($originalDay.Count -eq 1) ("${code}:original_day")
    $originalEnergy = @($originalDay[0].metrics | Where-Object { [string]$_.metric -ceq 'energy' })
    Assert-GoldenTrue ($originalEnergy.Count -eq 1) ("${code}:original_energy")
    Assert-GoldenTrue ([double]$result.later_unrelated_write.latest_energy_kcal -ne [double]$originalEnergy[0].current) ("${code}:latest_not_distinct")
}

function Assert-GoldenEntrySemantics {
    param(
        $Entry,
        $Asset
    )

    $lines = [string[]]@($Asset.lines)
    $textWithoutLf = $Asset.text.Substring(0, $Asset.text.Length - 1)
    Assert-GoldenTrue ([string]$Entry.block_order[-1] -in @('progress_blocks', 'pending_status')) ('GOLDEN_BLOCK_ORDER_LAST:{0}' -f $Entry.case_id)

    if ([string]$Entry.mode -ceq 'effects_pending') {
        Assert-GoldenPendingResult $Entry $textWithoutLf
        return
    }

    if ([string]$Entry.mode -ceq 'terminal_replay') {
        Assert-GoldenReplayResult $Entry
        Assert-GoldenCrossDayResult $Entry $lines
        return
    }

    Assert-GoldenTrue ([string]$Entry.mode -ceq 'terminal_success') ('GOLDEN_ENTRY_MODE:{0}' -f $Entry.case_id)
    $result = $Entry.final_result
    Assert-GoldenExactProperties $result @('command_status', 'envelope_status', 'receipt_data', 'daily_progress_by_date', 'daily_progress', 'terminal_idempotency_result') ('GOLDEN_SUCCESS_RESULT_SHAPE:{0}' -f $Entry.case_id)
    $expectedCommandStatus = if ([string]$Entry.case_id -ceq 'CASE-RECEIPT-002') { 'committed_with_issues' } else { 'committed' }
    Assert-GoldenTrue ([string]$result.command_status -ceq $expectedCommandStatus) ('GOLDEN_SUCCESS_COMMAND_STATUS:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ([string]$result.envelope_status -ceq 'terminal') ('GOLDEN_SUCCESS_ENVELOPE_STATUS:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ([string]$result.terminal_idempotency_result -ceq 'frozen') ('GOLDEN_SUCCESS_TERMINAL_RESULT:{0}' -f $Entry.case_id)
    Assert-GoldenExactProperties $result.receipt_data @('title', 'item_lines', 'inventory_line', 'issue_prompt', 'analysis_line') ('GOLDEN_RECEIPT_DATA_SHAPE:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ([string]$result.receipt_data.title -ceq $lines[0]) ('GOLDEN_RECEIPT_TITLE:{0}' -f $Entry.case_id)
    $titlePrefix = Convert-GoldenCodePointsToString @(0x5DF2, 0x8BB0, 0x5F55, 0xFF1A)
    Assert-GoldenTrue (([string]$result.receipt_data.title).StartsWith($titlePrefix, [StringComparison]::Ordinal)) ('GOLDEN_RECEIPT_TITLE_FORMAT:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ($result.receipt_data.item_lines -is [Array]) ('GOLDEN_RECEIPT_ITEMS_ARRAY:{0}' -f $Entry.case_id)
    $itemLines = @($result.receipt_data.item_lines)
    Assert-GoldenTrue ($itemLines.Count -gt 0) ('GOLDEN_RECEIPT_ITEMS_EMPTY:{0}' -f $Entry.case_id)
    for ($index = 0; $index -lt $itemLines.Count; $index++) {
        Assert-GoldenTrue (-not [string]::IsNullOrWhiteSpace([string]$itemLines[$index])) ('GOLDEN_RECEIPT_ITEM_BLANK:{0}:{1}' -f $Entry.case_id, $index)
        Assert-GoldenTrue ([string]$itemLines[$index] -ceq $lines[$index + 1]) ('GOLDEN_RECEIPT_ITEM_LINE:{0}:{1}' -f $Entry.case_id, $index)
    }
    Assert-GoldenTrue ([string]$result.receipt_data.inventory_line -ceq $lines[$itemLines.Count + 1]) ('GOLDEN_RECEIPT_INVENTORY_LINE:{0}' -f $Entry.case_id)

    Assert-GoldenTrue ($result.daily_progress_by_date -is [Array]) ('GOLDEN_SUCCESS_PROGRESS_ARRAY:{0}' -f $Entry.case_id)
    foreach ($progress in @($result.daily_progress_by_date)) {
        Assert-GoldenProgressBlock $progress ('GOLDEN_PROGRESS:{0}:{1}' -f $Entry.case_id, $progress.date)
    }
    Assert-GoldenSingleDayAlias $Entry

    $progressStart = $lines.Count - 12
    $fireEmoji = Convert-GoldenCodePointsToString @(0x1F525)
    $waterEmoji = Convert-GoldenCodePointsToString @(0x1F4A7)
    Assert-GoldenTrue ($progressStart -ge 0 -and $lines[$progressStart].StartsWith(($fireEmoji + ' '), [StringComparison]::Ordinal)) ('GOLDEN_PROGRESS_START:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ($lines[$lines.Count - 1].StartsWith($waterEmoji, [StringComparison]::Ordinal)) ('GOLDEN_PROGRESS_NOT_LAST:{0}' -f $Entry.case_id)
    Assert-GoldenTrue ([string]$Entry.block_order[-1] -ceq 'progress_blocks') ('GOLDEN_PROGRESS_BLOCK_ORDER:{0}' -f $Entry.case_id)

    switch ([string]$Entry.case_id) {
        'CASE-RECEIPT-002' {
            $databaseText = Convert-GoldenCodePointsToString @(0x53C2, 0x8003, 0x6570, 0x636E, 0x5E93)
            $estimateText = Convert-GoldenCodePointsToString @(0x4F30, 0x7B97)
            Assert-GoldenTrue ($lines[1].Contains($databaseText) -and -not $lines[1].Contains($estimateText)) 'GOLDEN_EXPLICIT_FIELD_ESTIMATED:CASE-RECEIPT-002'
            Assert-GoldenTrue ($lines[2].Contains($estimateText)) 'GOLDEN_INFERRED_FIELD_UNLABELED:CASE-RECEIPT-002'
            Assert-GoldenQuickOptions $Entry $lines
            break
        }
        'CASE-RECEIPT-004' {
            Assert-GoldenTrue ($lines.Count -eq 16) 'GOLDEN_NORMAL_SUCCESS_EXTRA_BLOCK'
            break
        }
        'CASE-RECEIPT-005' {
            $analysis = [string]$result.receipt_data.analysis_line
            Assert-GoldenTrue (-not [string]::IsNullOrWhiteSpace($analysis)) 'GOLDEN_REQUESTED_ANALYSIS_MISSING'
            $analysisIndex = [Array]::IndexOf($lines, $analysis)
            Assert-GoldenTrue ($analysisIndex -ge 0 -and $analysisIndex -lt $progressStart) 'GOLDEN_REQUESTED_ANALYSIS_POSITION'
            $forbiddenAnalysis = @(
                (Convert-GoldenCodePointsToString @(0x8BCA, 0x65AD)),
                (Convert-GoldenCodePointsToString @(0x5EFA, 0x8BAE)),
                (Convert-GoldenCodePointsToString @(0x5E94, 0x8BE5)),
                (Convert-GoldenCodePointsToString @(0x4E0B, 0x4E00, 0x9910))
            )
            foreach ($forbidden in $forbiddenAnalysis) {
                Assert-GoldenTrue (-not $analysis.Contains($forbidden)) ('GOLDEN_REQUESTED_ANALYSIS_SCOPE:{0}' -f $forbidden)
            }
            break
        }
        'CASE-RECEIPT-006' {
            Assert-GoldenTrue ($itemLines.Count -eq 1) 'GOLDEN_SINGLE_ITEM_COUNT'
            break
        }
        'CASE-RECEIPT-001' {
            Assert-GoldenTrue ($itemLines.Count -eq 4) 'GOLDEN_MULTI_DISH_ITEM_COUNT'
            $componentSeparator = [char]0x3001
            Assert-GoldenTrue ($itemLines[0].Contains($componentSeparator) -and $itemLines[1].Contains($componentSeparator)) 'GOLDEN_COMPONENT_SPLIT'
            break
        }
    }
}

function Test-GoldenReceiptsCandidate {
    param(
        $CaseSet,
        $Catalog,
        [string]$Root
    )

    $cases = @(Assert-GoldenCaseCatalogCandidate $CaseSet)
    $entries = @(Assert-GoldenCatalogCandidate $Catalog $Root)
    $caseIds = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($case in $cases) {
        $null = $caseIds.Add([string]$case.id)
    }

    foreach ($entry in $entries) {
        Assert-GoldenTrue ($caseIds.Contains([string]$entry.case_id)) ('GOLDEN_CASE_LINK_MISSING:{0}' -f $entry.case_id)
        $path = Resolve-GoldenTextPath $Root ([string]$entry.text_path) ([string]$entry.case_id)
        $asset = Read-GoldenTextAsset $path $entry
        Assert-GoldenEntrySemantics $entry $asset
    }

    return [pscustomobject][ordered]@{
        case_version = [string]$CaseSet.version
        cases = $entries.Count
        assets = $entries.Count
    }
}

function Get-GoldenMutationEntry {
    param(
        $Context,
        [string]$CaseId
    )

    $entries = @($Context.Catalog.entries | Where-Object { [string]$_.case_id -ceq $CaseId })
    Assert-GoldenTrue ($entries.Count -eq 1) ('GOLDEN_MUTATION_ENTRY:{0}' -f $CaseId)
    return $entries[0]
}

function Get-GoldenMutationTextPath {
    param(
        $Context,
        [string]$CaseId
    )

    $entry = Get-GoldenMutationEntry $Context $CaseId
    return Resolve-GoldenTextPath ([string]$Context.SharedRoot) ([string]$entry.text_path) $CaseId
}

function Set-GoldenMutationText {
    param(
        $Context,
        [string]$CaseId,
        [string]$Text
    )

    Assert-GoldenTrue ($Text.Length -gt 0 -and $Text.EndsWith("`n", [StringComparison]::Ordinal)) ('GOLDEN_MUTATION_TEXT_TERMINAL:{0}' -f $CaseId)
    Assert-GoldenTrue (-not $Text.EndsWith("`n`n", [StringComparison]::Ordinal)) ('GOLDEN_MUTATION_TEXT_EXTRA_TERMINAL:{0}' -f $CaseId)
    $entry = Get-GoldenMutationEntry $Context $CaseId
    $path = Get-GoldenMutationTextPath $Context $CaseId
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $bytes = $utf8.GetBytes($Text)
    [IO.File]::WriteAllBytes($path, $bytes)
    $entry.utf8_length = $bytes.Count
    $entry.sha256 = Get-GoldenSha256 $bytes
    $entry.line_count = @($Text.Substring(0, $Text.Length - 1) -split "`n", -1).Count
}

function Invoke-GoldenMutation {
    param(
        [string]$Name,
        [string]$ExpectedPrefix,
        [scriptblock]$Mutator
    )

    Assert-GoldenTrue ($null -ne $script:GoldenMutationCaseSet) 'GOLDEN_MUTATION_BASELINE_MISSING'
    Assert-GoldenTrue ($null -ne $script:GoldenMutationCatalog) 'GOLDEN_MUTATION_CATALOG_MISSING'
    Assert-GoldenTrue (-not [string]::IsNullOrWhiteSpace($script:GoldenMutationSharedRoot)) 'GOLDEN_MUTATION_ROOT_MISSING'

    $leaf = 'sh-case-004-golden-' + [guid]::NewGuid().ToString('N')
    Assert-GoldenTrue ($leaf -cmatch '^sh-case-004-golden-[0-9a-f]{32}$') 'GOLDEN_MUTATION_TEMP_LEAF'
    $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    $testRoot = [IO.Path]::GetFullPath((Join-Path $systemTemp $leaf))
    Assert-GoldenTrue ((Split-Path -Parent $testRoot) -ceq $systemTemp) 'GOLDEN_MUTATION_TEMP_OWNER'
    $testSharedRoot = Join-Path $testRoot 'shared'
    $testGoldenRoot = Join-Path $testSharedRoot 'acceptance-cases\golden-receipts'

    try {
        $null = [IO.Directory]::CreateDirectory($testGoldenRoot)
        $sourceGoldenRoot = Join-Path $script:GoldenMutationSharedRoot 'acceptance-cases\golden-receipts'
        foreach ($sourcePath in [IO.Directory]::GetFiles($sourceGoldenRoot)) {
            $sourceItem = Get-Item -LiteralPath $sourcePath -Force
            Assert-GoldenTrue (-not $sourceItem.PSIsContainer -and ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'GOLDEN_MUTATION_SOURCE_INVALID'
            $destinationPath = Join-Path $testGoldenRoot ([IO.Path]::GetFileName($sourcePath))
            [IO.File]::Copy($sourcePath, $destinationPath, $false)
        }

        $context = [pscustomobject][ordered]@{
            CaseSet = Copy-GoldenJson $script:GoldenMutationCaseSet
            Catalog = Copy-GoldenJson $script:GoldenMutationCatalog
            SharedRoot = $testSharedRoot
        }
        & $Mutator $context

        $observed = $null
        try {
            $null = Test-GoldenReceiptsCandidate $context.CaseSet $context.Catalog $context.SharedRoot
        }
        catch {
            $observed = [string]$_.Exception.Message
        }

        if ($null -eq $observed) {
            throw ('MUTATION_SURVIVED:{0}' -f $Name)
        }
        if (-not $observed.StartsWith($ExpectedPrefix, [StringComparison]::Ordinal)) {
            throw ('MUTATION_WRONG_FAILURE:{0}:expected={1}:actual={2}' -f $Name, $ExpectedPrefix, $observed)
        }
        Write-Output ('{0}|PASS|rejected={1}' -f $Name, $observed)
    }
    finally {
        if ([IO.Directory]::Exists($testRoot)) {
            $item = Get-Item -LiteralPath $testRoot -Force
            Assert-GoldenTrue ($item.PSIsContainer -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'GOLDEN_MUTATION_TEMP_INVALID'
            [IO.Directory]::Delete($testRoot, $true)
        }
        Assert-GoldenTrue (-not [IO.Directory]::Exists($testRoot)) 'GOLDEN_MUTATION_TEMP_RESIDUAL'
    }
}

function Invoke-GoldenMutationSuite {
    param(
        $CaseSet,
        $Catalog,
        [string]$Root
    )

    $script:GoldenMutationCaseSet = $CaseSet
    $script:GoldenMutationCatalog = $Catalog
    $script:GoldenMutationSharedRoot = $Root
    try {
        Invoke-GoldenMutation 'MUT-GOLDEN-TEXT-BYTE' 'GOLDEN_TEXT_SHA256:CASE-EFFECT-003' {
            param($context)
            $path = Get-GoldenMutationTextPath $context 'CASE-EFFECT-003'
            $utf8 = New-Object Text.UTF8Encoding($false, $true)
            $text = $utf8.GetString([IO.File]::ReadAllBytes($path))
            $replacement = Convert-GoldenCodePointsToString @(0x98DF)
            [IO.File]::WriteAllBytes($path, $utf8.GetBytes($replacement + $text.Substring(1)))
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-CRLF' 'GOLDEN_TEXT_CR:CASE-EFFECT-003' {
            param($context)
            $path = Get-GoldenMutationTextPath $context 'CASE-EFFECT-003'
            $bytes = [IO.File]::ReadAllBytes($path)
            $mutated = New-Object byte[] ($bytes.Count + 1)
            [Array]::Copy($bytes, 0, $mutated, 0, $bytes.Count - 1)
            $mutated[$bytes.Count - 1] = 13
            $mutated[$bytes.Count] = 10
            [IO.File]::WriteAllBytes($path, $mutated)
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-COMPONENT-SPLIT' 'GOLDEN_MULTI_DISH_ITEM_COUNT' {
            param($context)
            $entry = Get-GoldenMutationEntry $context 'CASE-RECEIPT-001'
            $path = Get-GoldenMutationTextPath $context 'CASE-RECEIPT-001'
            $utf8 = New-Object Text.UTF8Encoding($false, $true)
            $text = $utf8.GetString([IO.File]::ReadAllBytes($path))
            $lines = @($text.Substring(0, $text.Length - 1) -split "`n", -1)
            $separator = [char]0x3001
            $splitIndex = $lines[1].IndexOf($separator)
            Assert-GoldenTrue ($splitIndex -gt 0) 'GOLDEN_MUTATION_COMPONENT_SEPARATOR'
            $left = $lines[1].Substring(0, $splitIndex)
            $right = $lines[1].Substring($splitIndex + 1)
            $newLines = @($lines[0], $left, $right) + @($lines[2..($lines.Count - 1)])
            $entry.final_result.receipt_data.item_lines = @($left, $right) + @($entry.final_result.receipt_data.item_lines[1..3])
            Set-GoldenMutationText $context 'CASE-RECEIPT-001' (($newLines -join "`n") + "`n")
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-EXPLICIT-ESTIMATED' 'GOLDEN_EXPLICIT_FIELD_ESTIMATED:CASE-RECEIPT-002' {
            param($context)
            $entry = Get-GoldenMutationEntry $context 'CASE-RECEIPT-002'
            $path = Get-GoldenMutationTextPath $context 'CASE-RECEIPT-002'
            $utf8 = New-Object Text.UTF8Encoding($false, $true)
            $text = $utf8.GetString([IO.File]::ReadAllBytes($path))
            $database = Convert-GoldenCodePointsToString @(0x53C2, 0x8003, 0x6570, 0x636E, 0x5E93)
            $estimate = Convert-GoldenCodePointsToString @(0x4F30, 0x7B97)
            $oldLine = [string]$entry.final_result.receipt_data.item_lines[0]
            $newLine = $oldLine.Replace($database, $estimate)
            $entry.final_result.receipt_data.item_lines[0] = $newLine
            $entry.required_literals[0] = $newLine
            Set-GoldenMutationText $context 'CASE-RECEIPT-002' $text.Replace($oldLine, $newLine)
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-PROGRESS-NOT-LAST' 'GOLDEN_PROGRESS_START:CASE-PROGRESS-006' {
            param($context)
            $path = Get-GoldenMutationTextPath $context 'CASE-PROGRESS-006'
            $utf8 = New-Object Text.UTF8Encoding($false, $true)
            $text = $utf8.GetString([IO.File]::ReadAllBytes($path))
            Set-GoldenMutationText $context 'CASE-PROGRESS-006' ($text + "unexpected-tail`n")
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-POST-PROGRESS-ADVICE' 'GOLDEN_TEXT_FORBIDDEN_LITERAL:CASE-RECEIPT-004' {
            param($context)
            $path = Get-GoldenMutationTextPath $context 'CASE-RECEIPT-004'
            $utf8 = New-Object Text.UTF8Encoding($false, $true)
            $text = $utf8.GetString([IO.File]::ReadAllBytes($path))
            $advice = Convert-GoldenCodePointsToString @(0x5EFA, 0x8BAE)
            Set-GoldenMutationText $context 'CASE-RECEIPT-004' ($text + $advice + "`n")
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-QUICK-SAFE-EXIT' 'GOLDEN_QUICK_OPTIONS:CASE-RECEIPT-002:safe_exit_option' {
            param($context)
            $entry = Get-GoldenMutationEntry $context 'CASE-RECEIPT-002'
            $entry.final_result.receipt_data.issue_prompt.safe_exit_option = 'C'
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-QUICK-FREE-TEXT-LINE' 'GOLDEN_QUICK_OPTIONS:CASE-RECEIPT-002:free_text_position' {
            param($context)
            $entry = Get-GoldenMutationEntry $context 'CASE-RECEIPT-002'
            $entry.final_result.receipt_data.issue_prompt.free_text_line = 'different-free-text-line'
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-REPLAY-USES-LATEST' 'GOLDEN_REPLAY:CASE-STORAGE-006:retry_expectation' {
            param($context)
            $entry = Get-GoldenMutationEntry $context 'CASE-STORAGE-006'
            $entry.final_result.retry_expectation = 'latest_totals'
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-MULTI-DATE-ALIAS' 'GOLDEN_CROSS_DAY:CASE-STORAGE-006:original_shape' {
            param($context)
            $entry = Get-GoldenMutationEntry $context 'CASE-STORAGE-006'
            $entry.final_result.original_result | Add-Member -NotePropertyName daily_progress -NotePropertyValue $entry.final_result.original_result.daily_progress_by_date[0]
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-CROSS-DATE-ORDER' 'GOLDEN_CROSS_DAY:CASE-STORAGE-006:date_0_value' {
            param($context)
            $entry = Get-GoldenMutationEntry $context 'CASE-STORAGE-006'
            $first = $entry.final_result.original_result.daily_progress_by_date[0]
            $second = $entry.final_result.original_result.daily_progress_by_date[1]
            $entry.final_result.original_result.daily_progress_by_date = @($second, $first)
        }

        Invoke-GoldenMutation 'MUT-GOLDEN-PENDING-SUCCESS' 'GOLDEN_PENDING:CASE-EFFECT-003:receipt' {
            param($context)
            $entry = Get-GoldenMutationEntry $context 'CASE-EFFECT-003'
            $entry.final_result.receipt_data = [pscustomobject][ordered]@{ title = 'success' }
        }
    }
    finally {
        $script:GoldenMutationCaseSet = $null
        $script:GoldenMutationCatalog = $null
        $script:GoldenMutationSharedRoot = $null
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
    $caseSetPath = Join-Path $SharedRoot 'acceptance-cases\cases.json'
    $catalog = Read-GoldenJson $catalogPath 'GOLDEN_MANIFEST_MISSING'
    $caseSet = Read-GoldenJson $caseSetPath 'GOLDEN_CASE_SET_MISSING'
    $result = Test-GoldenReceiptsCandidate $caseSet $catalog $SharedRoot
    Invoke-GoldenMutationSuite $caseSet $catalog $SharedRoot
    Write-Output ('GOLDEN_RECEIPTS|PASS|case_version={0}|cases={1}|assets={2}' -f $result.case_version, $result.cases, $result.assets)
}
