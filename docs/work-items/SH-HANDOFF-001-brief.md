# SH-HANDOFF-001：GitHub 与 OpenClaw 开发交接

- Status: `in_progress`
- Product status: `foundation_development_only`
- Branch: `agent/github-openclaw-development-handoff`
- Plan: `docs/superpowers/plans/2026-08-11-github-openclaw-development-handoff.md`
- Design: `docs/superpowers/specs/2026-08-11-github-openclaw-development-handoff-design.md`

## 目标

让陌生智能体能够从私有 GitHub 仓库独立拉取 B 路线，依据仓库内资料完成环境预检、依赖安装、测试、构建、插件校验、Skill/插件开发安装和零业务写入冒烟。

## 当前产品边界

- 当前是 foundation 开发交接，不是 PRODUCT-0.1 正式安装器。
- `diet_manager` 的八个动作都必须返回 `foundation_not_implemented`、`committed=false`。
- 允许产生独立、脱敏的技术日志；不得产生饮食记录、库存、营养、Issue、业务 outbox、进度或其他业务数据。
- 正式安装、迁移、备份、恢复、卸载和发布仍由总功能开发计划 0.3 的 M7 任务负责。

## 本地通过条件

1. handoff contract 测试通过。
2. `pnpm install --frozen-lockfile` 在显式依赖构建白名单下通过。
3. `pnpm handoff:validate`、`pnpm test`、`pnpm build`、`pnpm plugin:validate` 全部退出 0。
4. Git diff 无格式错误；仓库不跟踪令牌、密钥、业务数据库、JSONL、依赖目录或 A/C 实现。

## 外部通过条件

- OpenClaw 02：从 GitHub 独立拉取并只依赖仓库资料完成安装验证。
- OpenClaw 03：八动作与 Skill/插件发现冒烟通过。
- OpenClaw 04：失败零业务数据、清理不越界、外部 sentinel 不变。
- 三套环境必须验证同一 Git commit。

## 明确非目标

- 不实现真实 SQLite 业务表或 repository。
- 不创建 PRODUCT 版本、正式 release 或 tag。
- 不公开仓库；未来开源许可证须由用户另行确认。
- 不把 OpenClaw Gateway 令牌、GitHub 凭据或原始私有日志写入任何项目文件。
