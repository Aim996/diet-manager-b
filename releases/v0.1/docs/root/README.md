# 饮食管家 B

饮食管家 B 是一个以 Skill 为智能体入口、SQLite 为唯一业务后端的饮食记录项目。OpenClaw、MCP 和其他智能体平台只提供薄适配层，不复制业务逻辑。

> 当前状态：v1.0 的 0.1.0 主链已完成构建与 OpenClaw 插件校验，进入用户真实环境验收。当前适合本地链接安装和受控数据测试；跨机器加密灾备与后续 0.1 增量仍未完成。

## 当前路线

- 只开发 B 路线。
- Skill 负责理解意图和选择动作。
- B 后端负责事实提交、效果处理、幂等、查询和回执。
- `FactCommit` 失败时，允许产生独立、脱敏的技术日志，但饮食记录、库存、营养、Issue、业务 outbox 和进度必须保持零写入。
- OpenClaw/MCP 仅转发同一套 B 能力。

当前唯一产品权威见 [饮食管家-开发约束与需求-v1.0.md](./饮食管家-开发约束与需求-v1.0.md)，本轮开发报告见 [PRODUCT-v1.0-report.md](./docs/work-items/PRODUCT-v1.0-report.md)。旧 0.3/0.4 文档仅保留为历史参考，不再覆盖 v1.0。

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

## 下一步

1. 用户安装插件并在专用测试数据根验收餐食、库存、营养、查询和回执主链。
2. 使用真实 `FDC_API_KEY` 验证 USDA 联网命中与断网降级为 `unknown`。
3. 根据体验记录集中修复真实问题，不重复扩展等价测试矩阵。
4. 后续按 v1.0 继续跨机器加密灾备和 0.1 增量。
