$ErrorActionPreference = 'Stop'

$validator = Join-Path $PSScriptRoot '..\validate-product-0.1.ps1'
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'PRODUCT_VALIDATOR_MISSING' }
$result = & $validator -PreflightOnly | ConvertFrom-Json
if ($result.schema_version -cne 'diet-manager/product-validation/v1') { throw 'PRODUCT_VALIDATOR_SCHEMA' }
if ($result.node_major -ne 24) { throw 'ENVIRONMENT_BLOCKED:node' }
if (-not $result.powershell_security_module) { throw 'ENVIRONMENT_BLOCKED:powershell_security' }
if ($result.secret_value_count -ne 0) { throw 'PRODUCT_VALIDATOR_SECRET_OUTPUT' }

$fixture = Join-Path $PSScriptRoot 'fixtures\product-validation\expected-gates.json'
if (-not (Test-Path -LiteralPath $fixture -PathType Leaf)) { throw 'PRODUCT_VALIDATOR_GATES_FIXTURE_MISSING' }
$expected = Get-Content -Raw -LiteralPath $fixture | ConvertFrom-Json
if ($expected.schema_version -cne 'diet-manager/product-validation-gates/v1') { throw 'PRODUCT_VALIDATOR_GATES_SCHEMA' }
if ($expected.min_test_files -lt 31) { throw 'PRODUCT_VALIDATOR_BASELINE_FILES' }
if ($expected.min_tests -lt 959) { throw 'PRODUCT_VALIDATOR_BASELINE_TESTS' }
$expectedGateIds = @($expected.gates)
if ($expectedGateIds.Count -lt 6) { throw 'PRODUCT_VALIDATOR_GATES_COUNT' }

$badEvidence = Join-Path $PSScriptRoot 'outside-evidence.json'
& $validator -PreflightOnly -EvidencePath $badEvidence *>$null
if ($LASTEXITCODE -eq 0) { throw 'PRODUCT_VALIDATOR_EVIDENCE_PATH_UNBOUNDED' }
if (Test-Path -LiteralPath $badEvidence) { throw 'PRODUCT_VALIDATOR_EVIDENCE_PATH_WROTE_OUTSIDE' }

Write-Output 'PRODUCT_VALIDATOR_CONTRACT_OK'
exit 0
