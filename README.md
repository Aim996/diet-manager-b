# 饮食管家 B

饮食管家 B 是一个以 Skill 为智能体入口、SQLite 为唯一业务后端的饮食记录项目。OpenClaw、MCP 和其他智能体平台只提供薄适配层，不复制业务逻辑。

> 当前状态：v1.0 的 0.1.0 主链已完成构建与 OpenClaw 插件校验；该版工程快照冻结于 `releases/v0.1`（只读）。当前目标版本是 0.1.1：按批准的分段计划补齐撤销、纠正、多商品采购、加密灾备与安装升级闭环。早先"进入用户真实环境验收"的表述属于历史结论；阶段 1 的撤销能力未关闭前，0.1.1 不得发布。

## 当前路线

- 只开发 B 路线。
- Skill 负责理解意图和选择动作。
- B 后端负责事实提交、效果处理、幂等、查询和回执。
- `FactCommit` 失败时，允许产生独立、脱敏的技术日志，但饮食记录、库存、营养、Issue、业务 outbox 和进度必须保持零写入。
- OpenClaw/MCP 仅转发同一套 B 能力。

当前唯一产品权威见 [饮食管家-开发约束与需求-v1.0.md](./饮食管家-开发约束与需求-v1.0.md)；0.1.1 交付按 [批准设计](./docs/superpowers/specs/2026-08-15-complete-0.1x-staged-development-design.md) 与 [分段实施计划](./docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md) 推进，阶段状态见 [PRODUCT-0.1.1-ledger.json](./docs/work-items/PRODUCT-0.1.1-ledger.json)。本轮开发报告见 [PRODUCT-v1.0-report.md](./docs/work-items/PRODUCT-v1.0-report.md)。旧 0.2/0.3/0.4 计划已归档至 `docs/archive/legacy-plans/`，仅保留为历史参考，不再覆盖 v1.0。

`B-STOR-002` 的实现报告、独立复核和证据分别见 [实现报告](./docs/work-items/B-STOR-002-report.md)、[复核报告](./docs/work-items/B-STOR-002-review.md) 与 [EV-20260812-029](./docs/evidence/EV-20260812-029-b-stor-002.md)。当前公开草稿 PR 为 [#8](https://github.com/Aim996/diet-manager-b/pull/8)。

`X-GATE-001` 的门报告、复核和证据见 [门报告](./docs/work-items/X-GATE-001-report.md)、[复核报告](./docs/work-items/X-GATE-001-review.md) 与 [EV-20260812-030](./docs/evidence/EV-20260812-030-x-gate-001.md)；草稿 PR 为 [#9](https://github.com/Aim996/diet-manager-b/pull/9)。

## 从 GitHub 下载

仓库为公开开源仓库，可直接使用 GitHub CLI：

```powershell
gh repo clone Aim996/diet-manager-b
```

也可以使用 HTTPS：

```powershell
git clone https://github.com/Aim996/diet-manager-b.git
```

不要把访问令牌写入 clone URL、配置文件或日志。

## 目录

- `version-b-lite-plugin/skills/diet-manager-b/`：可移植 Skill。
- `version-b-lite-plugin/src/`：B 路线 TypeScript/SQLite 实现基础。
- `version-b-lite-plugin/tests/`：B 路线测试。
- `shared/contracts/`：当前伴随契约。
- `shared/tests/`：契约与必要安全门验证器。
- `docs/work-items/`：任务 brief、报告和复核包。
- `docs/superpowers/plans/`：当前实施计划。

本地受保护租约、业务数据库、饮食记录、环境密钥、raw evidence、依赖目录和临时日志不会上传到 GitHub。

## 当前可运行验证

Windows PowerShell 5.1：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\shared\tests\validate-business-contract-v2.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\shared\tests\validate-receipt-and-date-contract-v2.ps1
```

B 包要求 Node `>=24.15.0 <25`（与当前 OpenClaw 2026.7.1 的宿主门一致）：

```powershell
cd .\version-b-lite-plugin
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
```

当前依赖安装采用 `--ignore-scripts`，不会要求用户盲目批准第三方构建脚本；本仓库的测试、TypeScript 构建和 OpenClaw 插件校验均已在该安装策略下通过。不要对来源不明的依赖运行 `pnpm approve-builds`。

## 本地安装

```powershell
cd E:\codx\skill\饮食管家\version-b-lite-plugin
pnpm install --frozen-lockfile --ignore-scripts
npm run install:local
```

该命令构建、校验并使用 OpenClaw 官方 `plugins install --link` 注册当前插件目录。它不会替你设置私有数据根或 USDA key，也不会强制覆盖已有安装。

## 产品安装、升级与卸载

事务式安装 / 升级 / 卸载入口是 `scripts/install-diet-manager.ps1`（要求 PowerShell 7）。所有预检都是只读的，在全部通过之前不会 `New-Item`、装依赖、改插件或改配置；升级失败会回滚旧程序、旧配置与数据库备份，卸载默认保留数据库、authority secret 和备份。

```powershell
cd E:\codx\skill\饮食管家\version-b-lite-plugin
npm run build   # 先构建 dist 产物（安装/升级会把 dist 与 skills 复制到版本目录）

# 全新安装：初始化官方数据根（空 schema + authority secret + 零业务行），再链接、配置、启用并重启网关
pwsh -NoProfile -File scripts/install-diet-manager.ps1 -Action Install -OfficialDataRoot <root> -BackupRoot <root>

# 升级：先做并校验备份，再暂存新版本、重链接并切换 current.json；任何失败自动回滚
pwsh -NoProfile -File scripts/install-diet-manager.ps1 -Action Upgrade -OfficialDataRoot <root> -BackupRoot <root>

# 卸载（保留数据）：只禁用并移除插件，数据库、authority secret 与备份均保留
pwsh -NoProfile -File scripts/install-diet-manager.ps1 -Action Uninstall -OfficialDataRoot <root>

# 卸载并删除数据：必须 -DeleteData 且 -ConfirmDataRoot 与官方数据根逐字符一致，另有二次确认
pwsh -NoProfile -File scripts/install-diet-manager.ps1 -Action Uninstall -OfficialDataRoot <root> -DeleteData -ConfirmDataRoot <root>
```

`ProgramRoot` 默认 `$env:LOCALAPPDATA\DietManager`；安装版本落于 `ProgramRoot\versions\0.1.1`，`current.json` 原子记录当前版本路径与数据根。authority secret 只存在于官方数据根，安装 / 升级 / 卸载过程不会把它写入日志、Git 或发布包。

## 备份与灾备

同根备份（日常）：`backup` 把数据库连同已提交 WAL 快照成一个带 SHA-256 校验的独立文件，`restore` 在同一数据根内恢复，失败自动回滚。适合误删单次记录前的定期快照。

```powershell
cd E:\codx\skill\饮食管家\version-b-lite-plugin
npm run build
node dist/admin/cli.js backup  <private-root> <backup-file>
node dist/admin/cli.js restore <private-root> <backup-file> <SHA256>
```

跨机加密备份（换机/灾备）：`backup-portable` 用 scrypt + AES-256-GCM 把数据库和 authority secret 一起加密打包，`restore-portable` 在**离线**的新数据根恢复，校验通过后才落库，任何一步失败都回滚到原状。口令只从真实终端逐键读取（不回显、不接受命令行/环境变量/管道），长度 12–1024 字节。

```powershell
node dist/admin/cli.js backup-portable  <private-root> <backup-file> 0.1.1
node dist/admin/cli.js restore-portable <private-root> <backup-file> <SHA256> [--replace-existing]
```

恢复是离线的：目标根必须已停用、无活动 WAL 连接；恢复会写入与备份一致的 authority secret，不会复用目标旧口令。**用户必须同时保管备份文件和口令**——口令即数据，遗失口令则备份不可恢复，程序不做后门。

## 下一步

1. 用户安装插件并在专用测试数据根验收餐食、库存、营养、查询和回执主链。
2. 使用真实 `FDC_API_KEY` 验证 USDA 联网命中与断网降级为 `unknown`。
3. 根据体验记录集中修复真实问题，不重复扩展等价测试矩阵。
4. 后续按 v1.0 继续跨机器加密灾备和 0.1 增量。
