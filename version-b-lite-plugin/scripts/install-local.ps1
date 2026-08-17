# install-local.ps1
# 开发入口：构建 + 元数据校验 + 开发链接（直接链接工作目录，不复制、不建版本目录、不初始化数据根）。
# 产品级事务式安装 / 升级 / 回滚 / 卸载见 install-diet-manager.ps1（要求 PowerShell 7）。
[CmdletBinding()]
param(
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$FailureCode
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureCode`:exit_$LASTEXITCODE"
    }
}

$pluginRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$entryPath = Join-Path $pluginRoot 'dist\index.js'
$typescriptPath = Join-Path $pluginRoot 'node_modules\typescript\bin\tsc'

$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop
$openClawCommand = Get-Command openclaw -ErrorAction SilentlyContinue
$localOpenClaw = Join-Path $pluginRoot 'node_modules\.bin\openclaw.cmd'

if ($null -eq $openClawCommand) {
    if (-not (Test-Path -LiteralPath $localOpenClaw -PathType Leaf)) {
        throw 'DIET_INSTALL_OPENCLAW_MISSING:install_openclaw_cli'
    }
    $openClawExecutable = $localOpenClaw
}
else {
    $openClawExecutable = $openClawCommand.Source
}

if (-not (Test-Path -LiteralPath $typescriptPath -PathType Leaf)) {
    throw 'DIET_INSTALL_DEPENDENCIES_MISSING:run_pnpm_install'
}

Push-Location -LiteralPath $pluginRoot
try {
    Write-Host '[1/5] Building diet-manager-b...'
    Invoke-CheckedCommand -Executable $nodeCommand.Source -Arguments @(
        $typescriptPath,
        '-p',
        (Join-Path $pluginRoot 'tsconfig.json')
    ) -FailureCode 'DIET_INSTALL_BUILD_FAILED'

    Write-Host '[2/5] Generating OpenClaw metadata...'
    Invoke-CheckedCommand -Executable $openClawExecutable -Arguments @(
        'plugins', 'build',
        '--root', $pluginRoot,
        '--entry', $entryPath
    ) -FailureCode 'DIET_INSTALL_METADATA_BUILD_FAILED'

    Write-Host '[3/5] Checking OpenClaw metadata...'
    Invoke-CheckedCommand -Executable $openClawExecutable -Arguments @(
        'plugins', 'build', '--check',
        '--root', $pluginRoot,
        '--entry', $entryPath
    ) -FailureCode 'DIET_INSTALL_METADATA_CHECK_FAILED'

    Write-Host '[4/5] Validating OpenClaw plugin...'
    Invoke-CheckedCommand -Executable $openClawExecutable -Arguments @(
        'plugins', 'validate',
        '--root', $pluginRoot,
        '--entry', $entryPath
    ) -FailureCode 'DIET_INSTALL_PLUGIN_INVALID'

    if ($ValidateOnly) {
        Write-Host '[5/5] Validation complete; installation skipped.'
        exit 0
    }

    Write-Host '[5/5] Linking and enabling diet-manager-b...'
    Invoke-CheckedCommand -Executable $openClawExecutable -Arguments @(
        'plugins', 'install', '--link', $pluginRoot
    ) -FailureCode 'DIET_INSTALL_LINK_FAILED'

    Write-Host 'diet-manager-b is built, validated, linked, and enabled.'
    Write-Host 'Configure official_data_root before recording real data.'
}
finally {
    Pop-Location
}
