param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$thisScriptPath = $MyInvocation.MyCommand.Path
$libraryPath = Join-Path $PSScriptRoot "validate-data-manifests.ps1"
if (-not (Test-Path -LiteralPath $libraryPath -PathType Leaf)) {
    throw "RED harness library is missing: $libraryPath"
}

. $libraryPath -LibraryOnly
Test-AsciiSource $thisScriptPath
Test-FrozenScopeBoundary

$selectedIds = @(
    "RED-ENV-001",
    "RED-ENV-002",
    "RED-OPENCLAW-001",
    "RED-OPENCLAW-002"
)
$selectedCases = @($testCases | Where-Object { $_.id -in $selectedIds })
Assert-Equal 4 $selectedCases.Count "State-isolation RED case count"
Assert-Equal (Get-OrdinalIgnoreCaseSignature $selectedIds) (Get-OrdinalIgnoreCaseSignature @($selectedCases.id)) "State-isolation RED case set"

$fixtureCheck = $null
try {
    $fixtureCheck = New-TestFixture
    Test-FixtureHarness $fixtureCheck
    Test-TestDoublePathSafety $fixtureCheck
    Write-Output "HARNESS|PASS|state isolation reuses the frozen fixture, independently contained adapters, error codes, JSON fields, and exact scope boundary"
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
    foreach ($case in $selectedCases) {
        Write-TestResult $case.id $false ("PRODUCTION_CAPABILITY_MISSING|injection={0}|expected={1}|observed={2}" -f $case.injection, $case.expected, $reason)
    }
    Write-Output "SUMMARY|FAIL|passed=0|failed=4|reason=production safety core and frozen interfaces are absent|log=$script:LogPath"
    exit 1
}

foreach ($case in $selectedCases) {
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
