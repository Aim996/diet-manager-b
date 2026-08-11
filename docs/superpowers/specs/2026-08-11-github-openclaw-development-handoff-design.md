# GitHub 与 OpenClaw 开发交接设计

## 目标

把当前 B 路线整理成一份可由陌生智能体从私有 GitHub 仓库独立拉取、检查、构建、验证和加载的开发交接包，同时明确它还不是可写真实饮食数据的 PRODUCT-0.1。

## 边界

- GitHub 用于持续版本管理和可复现交接，不等于正式产品发布。
- 当前允许安装和验证 foundation 开发包；所有写动作仍必须返回 `foundation_not_implemented`、`committed=false`。
- 当前不得创建正式 SQLite 业务表、饮食记录、库存、营养、Issue、业务 outbox 或进度数据。
- 正式一键安装器、迁移、备份、恢复和卸载仍属于总计划 0.3 的 M7，不在本任务提前实现。
- 三个 OpenClaw Gateway 令牌只在当前会话中使用，不写入仓库、日志、命令示例或证据。
- 五个受保护租约文件继续保持不读取、不哈希、不修改、不跟踪、不执行。

## 交付结构

1. `README.md`：项目首页，只保留 B 唯一路线、当前能力、GitHub 拉取和开发验证入口。
2. `START-HERE.md`：新智能体的最短入口，指向交接文档、总计划和进度，不再介绍 A/B/C 并行开发。
3. `docs/OPENCLAW-DEVELOPMENT-HANDOFF.md`：人工可读的环境预检、克隆、依赖安装、测试、构建、插件/Skill 安装、冒烟、安全预期和清理步骤。
4. `delivery/openclaw-development-handoff.json`：机器可读的仓库、版本、路径、命令和安全边界。
5. `scripts/validate-openclaw-development-handoff.mjs`：跨平台只读验证器，验证交接清单、文档锚点、受控命令和 foundation 零写入声明。
6. `version-b-lite-plugin/tests/handoff-contract.test.ts`：对交接清单和验证器的 TDD 契约测试。
7. `docs/开发进度.md`：重写为当前单一进度快照，详细列出已开发、正在开发、待开发、发现问题、待优化和后续优化。
8. `docs/work-items/SH-HANDOFF-001-brief.md`：登记本次开发交接任务，避免与 M7 正式安装任务混淆。
9. `CONTRIBUTING.md`、`SECURITY.md` 和 `.github/pull_request_template.md`：建立符合 GitHub 协作习惯的分支、PR、测试、数据与安全报告规范；当前不开源且不擅自选择许可证。

## 环境与安装契约

- Node.js：`>=24.15.0 <25`。当前 `24.14.0` 不满足 OpenClaw 2026.7.1 的最低要求，必须在交接门中拒绝。
- pnpm：使用 lockfile 执行 `pnpm install --frozen-lockfile`。
- OpenClaw：插件 peer 版本保持 `>=2026.5.17`；实际验证使用 Gateway 当前版本。
- 插件验证：`pnpm plugin:validate`。
- 插件安装：`openclaw plugins install ./version-b-lite-plugin`。
- Skill 安装：`openclaw skills install ./version-b-lite-plugin/skills/diet-manager-b --as diet-manager-b`。
- 安装前后必须证明没有新增 `.sqlite`、`.sqlite3`、`.db`、`.jsonl` 业务数据。

## 三环境职责

| 环境 | 职责 | 通过条件 |
|---|---|---|
| OpenClaw 02 | GitHub 独立拉取与按文档安装 | 只依据仓库文档完成 clone、preflight、依赖安装、测试、构建、插件与 Skill 加载 |
| OpenClaw 03 | Skill/插件行为冒烟 | 8 个动作可发现；写动作返回 `foundation_not_implemented`、`committed=false`；查询动作也不伪造数据 |
| OpenClaw 04 | 安全与清理复核 | 失败可有脱敏技术日志，但业务数据新增为 0；卸载/清理不越界且外部文件不变 |

## GitHub 流程

1. 在 `agent/github-openclaw-development-handoff` 分支开发。
2. 本地 RED→GREEN、构建、插件校验和 Git 泄漏检查通过后提交并推送。
3. 02/03/04 从该分支独立拉取验证。
4. 修复验证发现的问题并重复相应用例。
5. 三环境全部通过后再合并到 `main`；不创建 PRODUCT 标签，不声称正式可用。

## 完成定义

- 陌生智能体无需聊天上下文即可判断当前状态、安装开发包并运行验证。
- 人工文档与机器清单使用同一命令、路径和版本边界。
- 交接验证器和插件测试全部通过。
- OpenClaw 02/03/04 各自职责通过，且仓库、日志和证据中没有令牌或真实饮食数据。
- GitHub `main` 最终只接收经过上述验证的相同字节。
- 机器清单必须声明当前仓库私有、未来计划开源、许可证仍需用户选择；没有 `LICENSE` 前不得把仓库称为开源软件。
