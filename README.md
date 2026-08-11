# 饮食管家 B

饮食管家 B 是一个以 Skill 为智能体入口、SQLite 为唯一业务后端的饮食记录项目。OpenClaw、MCP 和其他智能体平台只提供薄适配层，不复制业务逻辑。

> 当前状态：开发中，尚不是可用于真实饮食数据的生产版本。SQLite bootstrap/migration 候选已经实现；业务 repository 和完整写入闭环尚未交付。

## 当前路线

- 只开发 B 路线。
- Skill 负责理解意图和选择动作。
- B 后端负责事实提交、效果处理、幂等、查询和回执。
- `FactCommit` 失败时，允许产生独立、脱敏的技术日志，但饮食记录、库存、营养、Issue、业务 outbox 和进度必须保持零写入。
- OpenClaw/MCP 仅转发同一套 B 能力。

当前执行计划见 [总功能开发计划0.3.md](./总功能开发计划0.3.md)，简明进度见 [docs/开发进度.md](./docs/开发进度.md)。

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

## 下一步

1. 完成 `B-MERGE-C-001`：把服务端权威 preview/state、陈旧/伪造状态拒绝和 migration guard 并入 B。
2. 实现 `B-STOR-002` 原子 repository，并验证写入失败时技术日志可有、业务数据严格为零。
3. 完成记录、查询、更正、撤销的真实纵向闭环。
4. 部署到专用 OpenClaw 环境；业务稳定后再增加 MCP 薄适配器。
