# GitHub → OpenClaw 开发交接

## 1. 交接身份

- 交接 Schema：`diet-manager-openclaw-development-handoff/v1`
- 产品状态：`foundation_development_only`
- 正式业务写入：`false`
- 写动作预期：`foundation_not_implemented`、`committed=false`
- GitHub：当前私有，未来计划开源
- 许可证：`license_status=user_selection_required`

本交接只证明陌生智能体可以独立拉取、构建、验证和加载开发包，不证明 PRODUCT-0.1 已完成。

## 2. 三套专用环境职责

| 环境 | 任务 | 必须返回的证据 |
|---|---|---|
| OpenClaw 02 | GitHub 拉取和按文档安装 | commit、版本、交接门、测试、构建、插件校验、安装发现、业务文件前后数量 |
| OpenClaw 03 | Skill/插件行为冒烟 | 八动作逐项结果、工具和 Skill 可发现、无伪提交 |
| OpenClaw 04 | 安全、失败和清理 | 失败零业务写入、外部路径不变、插件卸载预检与清理结果 |

三套环境必须使用同一个 Git commit。Gateway 令牌只能通过浏览器 URL fragment 或平台安全配置传入，禁止写入提示词、终端、仓库或证据。

## 3. 环境预检

```powershell
node --version
pnpm --version
openclaw --version
git --version
gh auth status
```

硬要求：

- Node.js `>=24.15.0 <25`。
- pnpm `>=11 <12`。
- OpenClaw `>=2026.5.17`。
- GitHub 身份对私有仓库 `Aim996/diet-manager-b` 至少有只读权限。

Node 24.14.0 不满足当前 OpenClaw 2026.7.1 的要求，必须在克隆或安装前停止，而不是忽略警告继续运行。

## 4. 从私有 GitHub 克隆

GitHub CLI：

```powershell
gh repo clone Aim996/diet-manager-b
Set-Location .\diet-manager-b
git status --short --branch
git rev-parse HEAD
```

验证交付分支时，明确切换分支并再次记录 commit：

```powershell
git fetch origin agent/github-openclaw-development-handoff
git switch --track origin/agent/github-openclaw-development-handoff
git rev-parse HEAD
```

不要把访问令牌拼进 HTTPS URL。若环境未获 GitHub 授权，应把它报告为 `GITHUB_AUTH_REQUIRED`，不得改成下载来源不明的压缩包。

## 5. 冻结零业务数据基线

业务数据目录当前只允许跟踪 `.gitkeep`。安装前记录：

PowerShell：

```powershell
Get-ChildItem -LiteralPath .\version-b-lite-plugin\data -File -Force |
  Where-Object Name -ne '.gitkeep' |
  Select-Object FullName,Length
```

POSIX shell：

```sh
find version-b-lite-plugin/data -type f ! -name .gitkeep -print
```

预期输出为空。

## 6. 安装依赖并验证开发包

```powershell
Set-Location .\version-b-lite-plugin
pnpm install --frozen-lockfile
pnpm handoff:validate
pnpm test
pnpm build
pnpm plugin:validate
Set-Location ..
```

`pnpm-workspace.yaml` 只允许五个已审计依赖执行构建脚本；不得使用 `pnpm approve-builds --all` 扩大范围。

交接验证器的最终成功行必须是：

```text
HANDOFF|PASS|status=foundation_development_only|business_writes=false
```

## 7. 安装插件和 Skill

从仓库根目录执行：

```powershell
openclaw plugins install ./version-b-lite-plugin
openclaw skills install ./version-b-lite-plugin/skills/diet-manager-b --as diet-manager-b
openclaw plugins list --json
openclaw skills info diet-manager-b
```

要求：

- 插件 ID 是 `diet-manager-b`。
- 工具名是 `diet_manager`。
- Skill 名是 `diet-manager-b`。
- 不允许出现第二套 A/C 工具或同名冲突插件。

如果 Gateway 在安装前已经运行，安装完成不代表当前进程已经注册新工具。必须新开一个测试会话，或安全重启本专用 Gateway，然后再次核对：

- plugin 状态为 loaded/enabled；
- `diet_manager` 出现在运行时工具集中；
- Skill 状态为 Ready。

重复执行安装时，OpenClaw 2026.7.1 可能以 `plugin already exists` 或 `Skill already exists` 安全拒绝。只有在插件/Skill 仍各一份、配置未重复、业务文件前后不变时，才把该结果判为幂等；不得使用 `--force` 掩盖冲突。

## 8. 八动作冒烟

依次验证：

1. `record_meal`
2. `record_water`
3. `add_inventory`
4. `query_inventory`
5. `query_meals`
6. `query_daily_summary`
7. `correct_record`
8. `undo_record`

当前每个动作都必须保留输入的 `action`，并返回：

```json
{
  "status": "foundation_not_implemented",
  "committed": false
}
```

不得返回 `record_id`，不得告诉用户“已记录”，不得用聊天记忆、便签、JSONL 或其他数据库补写。

## 9. 零业务写入复核

重复第 5 节的扫描，并额外确认 checkout 内没有新增：

```text
*.sqlite
*.sqlite3
*.db
*.jsonl
```

技术错误可以写入平台自己的脱敏诊断日志，但该日志不得位于饮食业务目录、不得进入业务查询，也不得包含 Gateway/GitHub 令牌或用户饮食原文。

## 10. 插件清理

先做不改变状态的预检：

```powershell
openclaw plugins uninstall --dry-run diet-manager-b
```

只在确认目标精确为本次测试安装后执行：

```powershell
openclaw plugins uninstall diet-manager-b
```

OpenClaw 2026.7.1 没有通用 `skills uninstall` 命令。因此 Skill 只安装到本次专用测试 agent/workspace，不使用 `--global`；测试结束时通过平台删除该精确测试 workspace。不得递归删除共享 Skill 根、用户主目录或无关 OpenClaw 配置。

卸载完成后还必须完整重启本专用 Gateway 进程，并复核 `diet-manager-b`、`diet_manager` 和 Skill 都不再发现。仅发送 in-process 热重载信号并不足以证明已加载的工具对象从内存卸载；磁盘/配置已清理但旧工具仍可调用时，必须明确报告为运行时残留，不能宣称清理完全成功。

## 11. 失败判定

以下任一情况都表示交接失败：

- 文档缺少实际前置条件，陌生智能体必须依靠聊天提示才能完成。
- GitHub 私有仓库授权失败。
- Node/pnpm/OpenClaw 版本不满足却继续安装。
- `pnpm handoff:validate`、测试、构建或插件校验非零退出。
- 八动作出现伪造成功或产生业务数据。
- 安装/清理修改测试目录之外的文件。
- 三环境使用了不同 commit。

修复必须进入 feature branch，重跑本地门和受影响的 OpenClaw 环境，再通过 pull request 合并；不得直接修改已经验证过的发布字节。
