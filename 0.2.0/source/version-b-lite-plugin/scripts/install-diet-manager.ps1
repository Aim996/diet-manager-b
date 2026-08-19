# install-diet-manager.ps1
# 饮食管家 B 事务式安装 / 升级 / 卸载入口。
# 用法（均通过 -Action 分派）：
#   pwsh -File install-diet-manager.ps1 -Action Install   -OfficialDataRoot <root> -BackupRoot <root> [-ProgramRoot <root>] [-ValidateOnly]
#   pwsh -File install-diet-manager.ps1 -Action Upgrade   -OfficialDataRoot <root> -BackupRoot <root> [-ProgramRoot <root>]
#   pwsh -File install-diet-manager.ps1 -Action Uninstall -OfficialDataRoot <root> [-DeleteData -ConfirmDataRoot <root>]
#
# 成功时向 stdout 输出 InstallationReceiptV1 JSON；失败时向 stderr 输出 `DIET_INSTALL_*` 错误码并以非零退出。
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Install', 'Upgrade', 'Uninstall')][string]$Action,
    [Parameter(Mandatory = $true)][string]$OfficialDataRoot,
    [string]$BackupRoot,
    [string]$ProgramRoot,
    [switch]$ValidateOnly,
    [switch]$DeleteData,
    [string]$ConfirmDataRoot,
    [string]$OpenClawPath,
    [string]$NodePath,
    [string]$PnpmPath,
    [string]$SourcePayload,
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'modules\DietManagerInstall.psm1') -Force

try {
    $receipt = Invoke-DietManagerInstall @PSBoundParameters
    $receipt | ConvertTo-Json -Depth 8
    exit 0
}
catch {
    $message = $_.Exception.Message
    $code = if ($message -match '^[A-Z0-9_]+(?::[A-Za-z0-9_:-]+)?$') { $message } else { 'DIET_INSTALL_FAILED' }
    [Console]::Error.WriteLine($code)
    exit 1
}
