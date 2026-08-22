# fake-openclaw.ps1
# 只用于 install-lifecycle 测试：模拟 OpenClaw CLI 的极小子集，
# 让安装/升级/卸载闭环在不触碰真实 Gateway 的情况下被验证。
# 状态通过 FAKE_OPENCLAW_STATE 指向的 JSON 文件持久化；FAKE_OPENCLAW_FAIL
# 若出现在合并后的参数中，则模拟该命令失败（exit 1）。
# 注意：不要用 [CmdletBinding()] / 命名参数——高级脚本会拒绝 --link、--version
# 这类未绑定位置参数；这里依赖普通脚本的 $args 自动收集全部参数。
$ErrorActionPreference = 'Stop'

$version = if ($env:FAKE_OPENCLAW_VERSION) { $env:FAKE_OPENCLAW_VERSION } else { '2026.7.1' }
$statePath = $env:FAKE_OPENCLAW_STATE

function Read-State {
    if ($statePath -and (Test-Path -LiteralPath $statePath)) {
        Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    }
    else {
        [pscustomobject]@{
            version = $version
            plugins = [pscustomobject]@{}
            config  = $null
            gateway = [pscustomobject]@{ restarts = 0; status = 'stopped' }
            last_command = @()
        }
    }
}

function Write-State([object]$state) {
    if ($statePath) {
        $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statePath -Encoding utf8
    }
}

# 失败注入：合并参数中包含 FAKE_OPENCLAW_FAIL 子串则失败。
if ($env:FAKE_OPENCLAW_FAIL) {
    $joined = ($args -join ' ')
    if ($joined -like "*$env:FAKE_OPENCLAW_FAIL*") {
        [Console]::Error.WriteLine('fake-openclaw injected failure')
        exit 1
    }
}

$state = Read-State

if ($args.Count -eq 0) {
    Write-Output $version
    exit 0
}

$verb = $args[0]
switch ($verb) {
    '--version' {
        Write-Output $version
    }
    'version' {
        Write-Output $version
    }
    'plugins' {
        $sub = if ($args.Count -ge 2) { $args[1] } else { '' }
        switch ($sub) {
            'install' {
                # plugins install --link <path>
                $linkIndex = [Array]::IndexOf([string[]]$args, '--link')
                if ($linkIndex -ge 0 -and $args.Count -gt ($linkIndex + 1)) {
                    $linkPath = $args[$linkIndex + 1]
                    $state.plugins | Add-Member -MemberType NoteProperty -Name 'diet-manager-b' -Value ([pscustomobject]@{
                        linked_path = $linkPath
                        enabled = $true
                    }) -Force
                }
                else {
                    Write-Output 'fake: plugins install'
                }
            }
            'enable' {
                $id = if ($args.Count -ge 3) { $args[2] } else { 'diet-manager-b' }
                if ($state.plugins.PSObject.Properties.Name -contains $id) {
                    $state.plugins.$id.enabled = $true
                }
            }
            'disable' {
                $id = if ($args.Count -ge 3) { $args[2] } else { 'diet-manager-b' }
                if ($state.plugins.PSObject.Properties.Name -contains $id) {
                    $state.plugins.$id.enabled = $false
                }
            }
            'remove' {
                $id = if ($args.Count -ge 3) { $args[2] } else { 'diet-manager-b' }
                if ($state.plugins.PSObject.Properties.Name -contains $id) {
                    $state.plugins.PSObject.Properties.Remove($id)
                }
            }
            'build' {
                # plugins build --check ... -> 只做元数据存在性校验的占位，成功
                Write-Output 'fake: build ok'
            }
            'validate' {
                Write-Output 'fake: validate ok'
            }
            'list' {
                Write-Output ($state.plugins | ConvertTo-Json -Compress)
            }
            default {
                Write-Output 'fake: plugins ok'
            }
        }
    }
    'config' {
        $sub = if ($args.Count -ge 2) { $args[1] } else { '' }
        switch ($sub) {
            'set' {
                # config set --strict-json <json>
                $jsonIndex = [Array]::IndexOf([string[]]$args, '--strict-json')
                if ($jsonIndex -ge 0 -and $args.Count -gt ($jsonIndex + 1)) {
                    $json = $args[$jsonIndex + 1]
                    $state.config = ($json | ConvertFrom-Json)
                }
                Write-Output 'fake: config set'
            }
            'get' {
                if ($null -ne $state.config) {
                    Write-Output ($state.config | ConvertTo-Json -Compress)
                }
                else {
                    Write-Output 'null'
                }
            }
            default {
                Write-Output 'fake: config ok'
            }
        }
    }
    'gateway' {
        $sub = if ($args.Count -ge 2) { $args[1] } else { '' }
        switch ($sub) {
            'restart' {
                $state.gateway.restarts = [int]$state.gateway.restarts + 1
                $state.gateway.status = 'running'
                Write-Output 'fake: gateway restarted'
            }
            'status' {
                Write-Output $state.gateway.status
            }
            'health' {
                Write-Output 'ok'
            }
            default {
                Write-Output 'fake: gateway ok'
            }
        }
    }
    default {
        Write-Output 'fake: ok'
    }
}

$state.last_command = @($args)
Write-State $state
exit 0
