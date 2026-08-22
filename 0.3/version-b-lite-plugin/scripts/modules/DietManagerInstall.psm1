# DietManagerInstall.psm1
# 饮食管家 B 事务式安装 / 升级 / 回滚 / 卸载。所有写操作都在预检（只读）全部通过之后才发生；
# 升级失败会回滚旧程序、旧配置和数据库备份，卸载默认保留数据库、authority secret 与备份。
#
# 错误约定：所有失败都抛出以 `DIET_INSTALL_*` 开头的干净错误码，
# 由入口脚本捕获后写入 stderr 并以非零退出。

Set-StrictMode -Version Latest

$script:ProductVersion = '0.3.0'
$script:VersionDirName = '0.3.0'

function Invoke-OpenClawCommand {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $oc = $script:OpenClawExecutable
    if ($oc -like '*.ps1') {
        # 测试用的 .ps1 假实现：经 -Command 显式传参，避免 -File 吞掉以 '-' 开头的参数。
        $quoted = $Arguments | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }
        $cmd = "& '" + ($oc -replace "'", "''") + "' " + ($quoted -join ' ')
        $output = & pwsh -NoProfile -NonInteractive -Command $cmd 2>&1
    }
    else {
        $output = & $oc @Arguments 2>&1
    }
    $exit = $LASTEXITCODE
    if ($exit -ne 0) {
        throw "${FailureCode}:exit_$exit"
    }
    return ($output | Out-String)
}

function Invoke-NodeCommand {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $output = & $script:NodeExecutable @Arguments 2>&1
    $exit = $LASTEXITCODE
    if ($exit -ne 0) {
        $detail = ($output | Out-String).Trim()
        if ($detail -match '^[A-Z0-9_]+(?::[A-Za-z0-9_:-]+)?$') {
            throw "${FailureCode}:$detail"
        }
        throw "${FailureCode}:exit_$exit"
    }
    return ($output | Out-String).Trim()
}

function Resolve-ToolPath {
    param(
        [string]$Explicit,
        [string]$CommandName,
        [string]$LocalFallback,
        [string]$MissingCode
    )
    if ($Explicit) {
        if (-not (Test-Path -LiteralPath $Explicit -PathType Leaf)) {
            throw "${MissingCode}:path_not_found"
        }
        return (Resolve-Path -LiteralPath $Explicit).Path
    }
    $cmd = Get-Command $CommandName -CommandType Application -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if ($LocalFallback -and (Test-Path -LiteralPath $LocalFallback -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $LocalFallback).Path
    }
    throw "${MissingCode}:not_on_path"
}

function Resolve-DedicatedPath {
    param(
        [string]$Value,
        [string]$Code
    )
    if (-not $Value) { throw "${Code}:missing" }
    $resolved = [System.IO.Path]::GetFullPath($Value)
    if ($resolved -match '\*|\?') { throw "${Code}:glob" }
    # 拒绝驱动器根、用户主目录、仓库根（按 DeleteData 的语义在此处也一并收紧）。
    $rejected = @(
        [System.IO.Path]::GetPathRoot($resolved).TrimEnd('\'),
        $HOME.TrimEnd('\'),
        $env:USERPROFILE.TrimEnd('\')
    )
    foreach ($r in $rejected) {
        if ($r -and $resolved.TrimEnd('\') -eq $r) { throw "${Code}:reserved_path" }
    }
    # 拒绝符号链接 / 重解析点（junction 等）。
    if (Test-Path -LiteralPath $resolved) {
        $item = Get-Item -LiteralPath $resolved -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw "${Code}:reparse_point"
        }
        if ($item.PSIsContainer -eq $false) { throw "${Code}:is_file" }
    }
    return $resolved
}

function Assert-MinimumNode {
    param([string]$NodePath)
    $raw = (Invoke-NodeCommand @('--version') 'DIET_INSTALL_NODE_VERSION') 2>$null
    $raw = $raw.Trim()
    if ($raw -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { throw "DIET_INSTALL_NODE_VERSION:unparseable:$raw" }
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]
    if ($major -ne 24 -or $minor -lt 15) { throw "DIET_INSTALL_NODE_VERSION:$raw" }
}

function Assert-MinimumOpenClaw {
    $raw = (Invoke-OpenClawCommand @('--version') 'DIET_INSTALL_OPENCLAW_VERSION').Trim()
    if ($raw -notmatch '(\d+)\.(\d+)\.(\d+)') { throw "DIET_INSTALL_OPENCLAW_VERSION:unparseable:$raw" }
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]; $patch = [int]$Matches[3]
    if ($major -lt 2026 -or ($major -eq 2026 -and $minor -lt 7) -or ($major -eq 2026 -and $minor -eq 7 -and $patch -lt 1)) {
        throw "DIET_INSTALL_OPENCLAW_VERSION:$raw"
    }
}

function Assert-FreeSpace {
    param([string]$Path)
    try {
        $root = [System.IO.Path]::GetPathRoot($Path)
        $drive = [System.IO.DriveInfo]::new($root)
        if ($drive.AvailableFreeSpace -lt 1GB) {
            throw "DIET_INSTALL_NO_SPACE:$root"
        }
    }
    catch {
        # 无法取得驱动器信息时不做硬阻断（网络/特殊卷），避免误伤合法安装。
    }
}

function Get-CurrentVersionPath {
    $currentJson = Join-Path $script:ProgramRoot 'current.json'
    if (Test-Path -LiteralPath $currentJson -PathType Leaf) {
        $current = Get-Content -Raw -LiteralPath $currentJson | ConvertFrom-Json
        return [string]$current.installed_version_path
    }
    return $null
}

function Initialize-OfficialDataRoot {
    param([string]$PayloadRoot, [string]$OfficialDataRoot)
    if (-not (Test-Path -LiteralPath $OfficialDataRoot)) {
        New-Item -ItemType Directory -Force -Path $OfficialDataRoot | Out-Null
    }
    $cli = Join-Path $PayloadRoot 'dist\admin\cli.js'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
        throw "DIET_INSTALL_INIT_MISSING:$cli"
    }
    $json = Invoke-NodeCommand @($cli, 'init-root', $OfficialDataRoot) 'DIET_INSTALL_INIT_FAILED'
    $result = $json | ConvertFrom-Json
    if ([int]$result.business_rows -ne 0) { throw 'DIET_INSTALL_INIT_NON_EMPTY' }
    return $result
}

function Backup-OfficialDatabase {
    param([string]$PayloadRoot, [string]$OfficialDataRoot, [string]$BackupRoot)
    if (-not (Test-Path -LiteralPath $BackupRoot)) {
        New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    }
    $cli = Join-Path $PayloadRoot 'dist\admin\cli.js'
    $backupPath = Join-Path $BackupRoot "diet-manager-b-pre-$($script:ProductVersion)-$([guid]::NewGuid().ToString('N')).sqlite3"
    $json = Invoke-NodeCommand @($cli, 'backup-upgrade', $OfficialDataRoot, $backupPath) 'DIET_INSTALL_BACKUP_FAILED'
    $result = $json | ConvertFrom-Json
    if ([int]$result.source_user_version -notin @(1, 2)) {
        throw 'DIET_INSTALL_BACKUP_FAILED:source_version'
    }
    return $result
}

function Restore-OfficialDatabase {
    param([string]$PayloadRoot, [string]$OfficialDataRoot, [string]$BackupPath, [string]$Sha256)
    $cli = Join-Path $PayloadRoot 'dist\admin\cli.js'
    Invoke-NodeCommand @($cli, 'restore-upgrade', $OfficialDataRoot, $BackupPath, $Sha256) 'DIET_INSTALL_RESTORE_FAILED' | Out-Null
}

function Upgrade-OfficialDataRoot {
    param([string]$PayloadRoot, [string]$OfficialDataRoot)
    $cli = Join-Path $PayloadRoot 'dist\admin\cli.js'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
        throw "DIET_INSTALL_MIGRATION_MISSING:$cli"
    }
    $json = Invoke-NodeCommand @($cli, 'upgrade-root', $OfficialDataRoot) 'DIET_INSTALL_MIGRATION_FAILED'
    $result = $json | ConvertFrom-Json
    if ([int]$result.sqlite_user_version -ne 2) {
        throw 'DIET_INSTALL_MIGRATION_FAILED:user_version'
    }
    return $result
}

function Copy-Payload {
    param([string]$Source, [string]$Destination)
    $names = @('package.json', 'pnpm-lock.yaml', 'openclaw.plugin.json', 'README.md')
    foreach ($name in $names) {
        $src = Join-Path $Source $name
        if (Test-Path -LiteralPath $src -PathType Leaf) {
            Copy-Item -LiteralPath $src -Destination $Destination -Force
        }
    }
    foreach ($dir in @('dist', 'skills', 'scripts')) {
        $src = Join-Path $Source $dir
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination $Destination -Recurse -Force
        }
    }
}

function Invoke-DependencyInstall {
    param([string]$PayloadRoot)
    if ($script:SkipDependencyInstall) { return }
    $pnpm = $script:PnpmExecutable
    Push-Location -LiteralPath $PayloadRoot
    try {
        $joined = "`"$pnpm`" install --prod --frozen-lockfile"
        $output = & cmd.exe /d /s /c $joined 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "DIET_INSTALL_DEPENDENCIES_FAILED:exit_$LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Write-Receipt {
    param([hashtable]$Fields)
    $receipt = [ordered]@{
        schema_version = 'diet-manager/installation-receipt/v1'
        product_version = $script:ProductVersion
    }
    foreach ($key in $Fields.Keys) {
        $receipt[$key] = $Fields[$key]
    }
    return $receipt
}

function Invoke-Install {
    # 1) 创建程序根与版本目录
    $versionsRoot = Join-Path $script:ProgramRoot 'versions'
    $versionPath = Join-Path $versionsRoot $script:VersionDirName
    if (-not (Test-Path -LiteralPath $versionsRoot)) {
        New-Item -ItemType Directory -Force -Path $versionsRoot | Out-Null
    }
    if (Test-Path -LiteralPath $versionPath) {
        throw "DIET_INSTALL_ALREADY_INSTALLED:$versionPath"
    }

    # 2) 暂存并原子改名到 versions\0.3.0
    $staging = Join-Path $versionsRoot ".staging-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    try {
        Copy-Payload -Source $script:SourcePayload -Destination $staging
        Invoke-DependencyInstall -PayloadRoot $staging
        $entry = Join-Path $staging 'dist\index.js'
        if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
            throw "DIET_INSTALL_PAYLOAD_INVALID:$entry"
        }
        Move-Item -LiteralPath $staging -Destination $versionPath
    }
    catch {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        }
        throw
    }

    # 3) 通过后端存储代码初始化官方数据根（空 schema + authority secret + 零业务行）
    $init = Initialize-OfficialDataRoot -PayloadRoot $versionPath -OfficialDataRoot $script:OfficialDataRoot

    # 4) 链接、配置、启用、重启、健康检查
    Invoke-OpenClawCommand @('plugins', 'install', '--link', $versionPath) 'DIET_INSTALL_LINK_FAILED' | Out-Null
    Invoke-OpenClawCommand @('plugins', 'enable', 'diet-manager-b') 'DIET_INSTALL_ENABLE_FAILED' | Out-Null
    $configJson = @{ plugins = @{ entries = @{ 'diet-manager-b' = @{ config = @{ official_data_root = $script:OfficialDataRoot } } } } } | ConvertTo-Json -Depth 8 -Compress
    Invoke-OpenClawCommand @('config', 'set', '--strict-json', $configJson) 'DIET_INSTALL_CONFIG_FAILED' | Out-Null
    Invoke-OpenClawCommand @('gateway', 'restart') 'DIET_INSTALL_GATEWAY_FAILED' | Out-Null
    Invoke-OpenClawCommand @('gateway', 'status') 'DIET_INSTALL_GATEWAY_FAILED' | Out-Null
    Invoke-OpenClawCommand @('gateway', 'health') 'DIET_INSTALL_GATEWAY_FAILED' | Out-Null

    # 5) 原子写入 current.json
    $currentJson = @{
        schema_version = 'diet-manager/current/v1'
        product_version = $script:ProductVersion
        installed_version_path = $versionPath
        official_data_root = $script:OfficialDataRoot
    }
    $currentPath = Join-Path $script:ProgramRoot 'current.json'
    $tmpCurrent = "$currentPath.tmp-$([guid]::NewGuid().ToString('N'))"
    $currentJson | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $tmpCurrent -Encoding utf8
    Move-Item -LiteralPath $tmpCurrent -Destination $currentPath -Force

    return (Write-Receipt @{
        action = 'install'
        program_root = $script:ProgramRoot
        official_data_root = $script:OfficialDataRoot
        installed_version_path = $versionPath
        business_rows = [int]$init.business_rows
    })
}

function Invoke-Upgrade {
    # 只接受计划确认的 0.2.2 -> 0.3.0 原地升级；预检阶段不写文件。
    $versionsRoot = Join-Path $script:ProgramRoot 'versions'
    $versionPath = Join-Path $versionsRoot $script:VersionDirName
    $currentPath = Join-Path $script:ProgramRoot 'current.json'
    if (-not (Test-Path -LiteralPath $currentPath -PathType Leaf)) {
        throw 'DIET_INSTALL_NOT_INSTALLED:current'
    }
    $current = Get-Content -Raw -LiteralPath $currentPath | ConvertFrom-Json
    if ([string]$current.schema_version -ne 'diet-manager/current/v1' -or
        [string]$current.product_version -ne '0.2.2') {
        throw 'DIET_INSTALL_UPGRADE_SOURCE_UNSUPPORTED'
    }
    $oldVersionPath = [System.IO.Path]::GetFullPath([string]$current.installed_version_path)
    $expectedOldVersionPath = [System.IO.Path]::GetFullPath((Join-Path $versionsRoot '0.2.2'))
    if ($oldVersionPath -ne $expectedOldVersionPath -or
        -not (Test-Path -LiteralPath (Join-Path $oldVersionPath 'dist\index.js') -PathType Leaf)) {
        throw 'DIET_INSTALL_UPGRADE_SOURCE_INVALID'
    }
    if ([System.IO.Path]::GetFullPath([string]$current.official_data_root) -ne $script:OfficialDataRoot) {
        throw 'DIET_INSTALL_UPGRADE_DATA_ROOT_MISMATCH'
    }
    if (Test-Path -LiteralPath $versionPath) {
        throw "DIET_INSTALL_ALREADY_INSTALLED:$versionPath"
    }
    if (-not $script:BackupRoot) {
        throw 'DIET_INSTALL_BACKUP_REQUIRED'
    }

    # 1) 迁移前先保存 user_version 1/2 原始备份并校验摘要。
    $backup = Backup-OfficialDatabase -PayloadRoot $script:SourcePayload -OfficialDataRoot $script:OfficialDataRoot -BackupRoot $script:BackupRoot
    $oldCurrent = [System.IO.File]::ReadAllText($currentPath)

    # 2) 新程序先进入独立暂存目录；旧 0.2.2 目录始终原地保留。
    $staging = Join-Path $versionsRoot ".staging-$([guid]::NewGuid().ToString('N'))"
    $newVersionCreated = $false
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    try {
        Copy-Payload -Source $script:SourcePayload -Destination $staging
        Invoke-DependencyInstall -PayloadRoot $staging
        $entry = Join-Path $staging 'dist\index.js'
        if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
            throw "DIET_INSTALL_PAYLOAD_INVALID:$entry"
        }

        # 3) 只在备份完成后执行 v1 -> v2 迁移并核验六类业务行。
        $migration = Upgrade-OfficialDataRoot -PayloadRoot $staging -OfficialDataRoot $script:OfficialDataRoot
        Move-Item -LiteralPath $staging -Destination $versionPath
        $newVersionCreated = $true

        # 4) 链接正式 0.3.0 路径，健康检查通过后才切 current.json。
        Invoke-OpenClawCommand @('plugins', 'install', '--link', $versionPath) 'DIET_INSTALL_LINK_FAILED' | Out-Null
        Invoke-OpenClawCommand @('plugins', 'enable', 'diet-manager-b') 'DIET_INSTALL_ENABLE_FAILED' | Out-Null
        $configJson = @{ plugins = @{ entries = @{ 'diet-manager-b' = @{ config = @{ official_data_root = $script:OfficialDataRoot } } } } } | ConvertTo-Json -Depth 8 -Compress
        Invoke-OpenClawCommand @('config', 'set', '--strict-json', $configJson) 'DIET_INSTALL_CONFIG_FAILED' | Out-Null
        Invoke-OpenClawCommand @('gateway', 'restart') 'DIET_INSTALL_GATEWAY_FAILED' | Out-Null
        Invoke-OpenClawCommand @('gateway', 'status') 'DIET_INSTALL_GATEWAY_FAILED' | Out-Null
        Invoke-OpenClawCommand @('gateway', 'health') 'DIET_INSTALL_GATEWAY_FAILED' | Out-Null

        $currentJson = @{
            schema_version = 'diet-manager/current/v1'
            product_version = $script:ProductVersion
            installed_version_path = $versionPath
            official_data_root = $script:OfficialDataRoot
        }
        $tmpCurrent = "$currentPath.tmp-$([guid]::NewGuid().ToString('N'))"
        $currentJson | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $tmpCurrent -Encoding utf8
        Move-Item -LiteralPath $tmpCurrent -Destination $currentPath -Force
    }
    catch {
        $upgradeError = $_
        # 失败回滚：旧程序重链接、旧 current 原样恢复、原始 v1/v2 数据库恢复。
        try {
            Invoke-OpenClawCommand @('plugins', 'install', '--link', $oldVersionPath) 'DIET_INSTALL_ROLLBACK_FAILED' | Out-Null
            [System.IO.File]::WriteAllText($currentPath, $oldCurrent)
            Restore-OfficialDatabase -PayloadRoot $script:SourcePayload -OfficialDataRoot $script:OfficialDataRoot -BackupPath $backup.backup_path -Sha256 $backup.sha256
            Invoke-OpenClawCommand @('gateway', 'restart') 'DIET_INSTALL_ROLLBACK_FAILED' | Out-Null
            if ($newVersionCreated -and (Test-Path -LiteralPath $versionPath)) {
                Remove-Item -LiteralPath $versionPath -Recurse -Force
            }
        }
        catch {
            throw 'DIET_INSTALL_ROLLBACK_FAILED'
        }
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        }
        throw $upgradeError
    }

    return (Write-Receipt @{
        action = 'upgrade'
        program_root = $script:ProgramRoot
        official_data_root = $script:OfficialDataRoot
        installed_version_path = $versionPath
        previous_version = '0.2.2'
        backup_path = $backup.backup_path
        backup_sha256 = $backup.sha256
        backup_source_user_version = [int]$backup.source_user_version
        sqlite_user_version = [int]$migration.sqlite_user_version
    })
}

function Invoke-Uninstall {
    # 卸载默认只移除插件与可重建缓存，保留数据库、secret、备份。
    if ($script:DeleteData) {
        if (-not $script:ConfirmDataRoot) {
            throw 'DIET_INSTALL_DELETE_CONFIRM_MISSING'
        }
        $confirmResolved = [System.IO.Path]::GetFullPath($script:ConfirmDataRoot)
        if ($confirmResolved.TrimEnd('\') -ne $script:OfficialDataRoot.TrimEnd('\')) {
            throw 'DIET_INSTALL_DELETE_CONFIRM_MISMATCH'
        }
        # 数据删除需要额外的交互确认（非交互环境下绝不删除）。
        if ($env:DIET_INSTALL_CONFIRM_DELETE -ne 'yes') {
            throw 'DIET_INSTALL_DELETE_REQUIRES_CONFIRMATION'
        }
    }

    Invoke-OpenClawCommand @('plugins', 'disable', 'diet-manager-b') 'DIET_INSTALL_DISABLE_FAILED' | Out-Null
    Invoke-OpenClawCommand @('plugins', 'remove', 'diet-manager-b') 'DIET_INSTALL_REMOVE_FAILED' | Out-Null

    $receiptFields = @{
        action = 'uninstall'
        program_root = $script:ProgramRoot
        official_data_root = $script:OfficialDataRoot
        data_preserved = $true
    }
    if ($script:DeleteData) {
        # 数据删除：校验通过后删除官方数据根下的数据库与 secret（备份保留在 BackupRoot 之外）。
        $dbPath = Join-Path $script:OfficialDataRoot 'diet-manager-b.sqlite3'
        $secretPath = Join-Path $script:OfficialDataRoot '.diet-manager-b.authority-secret'
        if (Test-Path -LiteralPath $dbPath -PathType Leaf) { Remove-Item -LiteralPath $dbPath -Force }
        if (Test-Path -LiteralPath $secretPath -PathType Leaf) { Remove-Item -LiteralPath $secretPath -Force }
        $receiptFields['data_preserved'] = $false
        $receiptFields['data_deleted'] = $true
    }

    return (Write-Receipt $receiptFields)
}

function Invoke-DietManagerInstall {
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

    $script:PluginRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
    $script:SourcePayload = if ($SourcePayload) { (Resolve-Path -LiteralPath $SourcePayload).Path } else { $script:PluginRoot }
    $script:ProgramRoot = if ($ProgramRoot) { [System.IO.Path]::GetFullPath($ProgramRoot) } else { Join-Path $env:LOCALAPPDATA 'DietManager' }
    $script:OfficialDataRoot = Resolve-DedicatedPath -Value $OfficialDataRoot -Code 'DIET_INSTALL_PATH_INVALID'
    $script:BackupRoot = if ($BackupRoot) { Resolve-DedicatedPath -Value $BackupRoot -Code 'DIET_INSTALL_BACKUP_PATH_INVALID' } else { $null }
    $script:DeleteData = [bool]$DeleteData
    $script:ConfirmDataRoot = $ConfirmDataRoot
    $script:SkipDependencyInstall = [bool]$SkipDependencyInstall

    $script:NodeExecutable = Resolve-ToolPath -Explicit $NodePath -CommandName 'node' -LocalFallback '' -MissingCode 'DIET_INSTALL_NODE_MISSING'
    $script:OpenClawExecutable = Resolve-ToolPath -Explicit $OpenClawPath -CommandName 'openclaw' -LocalFallback (Join-Path $script:PluginRoot 'node_modules\.bin\openclaw.CMD') -MissingCode 'DIET_INSTALL_OPENCLAW_MISSING'
    $script:PnpmExecutable = if (-not $script:SkipDependencyInstall) {
        Resolve-ToolPath -Explicit $PnpmPath -CommandName 'pnpm' -LocalFallback '' -MissingCode 'DIET_INSTALL_PNPM_MISSING'
    }
    else { $null }

    # ---------- 预检（只读，全部通过前不做任何 New-Item / 安装 / 配置） ----------
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
        throw 'DIET_INSTALL_UNSUPPORTED_PLATFORM'
    }
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        throw 'DIET_INSTALL_POWERSHELL_TOO_OLD'
    }
    Assert-MinimumNode -NodePath $script:NodeExecutable
    Assert-MinimumOpenClaw
    if (-not $script:SkipDependencyInstall) {
        $null = & $script:PnpmExecutable --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw "DIET_INSTALL_PNPM_MISSING:exit_$LASTEXITCODE" }
    }
    Assert-FreeSpace -Path $script:ProgramRoot
    if ($Action -eq 'Upgrade') {
        if (-not (Test-Path -LiteralPath (Join-Path $script:ProgramRoot 'current.json') -PathType Leaf)) {
            throw 'DIET_INSTALL_NOT_INSTALLED'
        }
    }

    if ($ValidateOnly) {
        return (Write-Receipt @{ action = 'validate'; program_root = $script:ProgramRoot; official_data_root = $script:OfficialDataRoot })
    }

    switch ($Action) {
        'Install'   { return (Invoke-Install) }
        'Upgrade'   { return (Invoke-Upgrade) }
        'Uninstall' { return (Invoke-Uninstall) }
    }
}

Export-ModuleMember -Function Invoke-DietManagerInstall
