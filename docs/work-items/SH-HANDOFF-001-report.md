# SH-HANDOFF-001 GitHub → OpenClaw 开发交接报告

> 日期：2026-08-11
> 状态：PASS
> 产品状态：`foundation_development_only`
> 被验证提交：`186a3f7cde3c0f00d8f2f2a053a1d6ca078814c6`

## 结论

同一 Git 提交已在 OpenClaw 02、03、04 三套独立测试环境完成私有 GitHub 只读拉取、冻结依赖安装、交接门、18 项测试、TypeScript 构建、插件校验和实际 OpenClaw 安装验证。

这次验证证明的是“开发交接可复现”，不是产品已经可正式记录饮食。八个公开动作仍必须返回 `foundation_not_implemented` 和 `committed=false`，正式 SQLite repository、业务纵向切片和 PRODUCT-0.1 发布门仍未实现。

## 共同环境

三套环境均使用：

- Node.js `24.16.0`
- pnpm `11.2.2`
- OpenClaw `2026.7.1`
- Git `2.39.5`
- 同一提交 `186a3f7cde3c0f00d8f2f2a053a1d6ca078814c6`

三套环境的 SSH 22 端口均受网络策略阻断，按预案改用 GitHub 官方 `ssh.github.com:443`。GitHub host key 来自官方 metadata，严格校验；测试只使用临时只读 deploy key。

## OpenClaw 02：完整交接门

- 私有 GitHub clone：PASS
- `pnpm install --frozen-lockfile`：PASS；只允许五个冻结依赖执行构建脚本
- `pnpm handoff:validate`：PASS
- Vitest：18/18 PASS
- TypeScript build：PASS
- OpenClaw plugin validate：PASS
- plugin：`diet-manager-b`
- tool：`diet_manager`
- Skill：`diet-manager-b`，Ready
- 业务文件：前后均为 0 个实际记录文件
- 清理：plugin、Skill、临时仓库、私钥和测试提示文件均已删除；完整 Gateway 重启后工具注册消失

## OpenClaw 03：八动作真实工具冒烟

Gateway 激活后，通过真实注册的 `diet_manager` 工具执行全部八个动作，没有直接导入源码绕过 OpenClaw：

| action | status | committed | record_id |
|---|---|---:|---|
| `record_meal` | `foundation_not_implemented` | `false` | 无 |
| `record_water` | `foundation_not_implemented` | `false` | 无 |
| `add_inventory` | `foundation_not_implemented` | `false` | 无 |
| `query_inventory` | `foundation_not_implemented` | `false` | 无 |
| `query_meals` | `foundation_not_implemented` | `false` | 无 |
| `query_daily_summary` | `foundation_not_implemented` | `false` | 无 |
| `correct_record` | `foundation_not_implemented` | `false` | 无 |
| `undo_record` | `foundation_not_implemented` | `false` | 无 |

调用前后业务目录都只含空的 `.gitkeep`，数量、SHA-256 和修改时间不变，没有生成 SQLite、DB、JSONL 或半条饮食记录。

磁盘插件、配置注册、Skill、临时仓库和私钥已清理。该实例的 in-process 热重载不会卸载已加载的工具对象，因此旧工具对象会保留到下一次完整 Gateway 进程重启；它已没有磁盘或配置加载源。这一运行时行为已记录为安装/卸载文档注意事项，不继续消耗测试环境模型做重复验证。

## OpenClaw 04：幂等、零写入和卸载

- 首次安装：plugin 与 workspace Skill 各一份
- 重复安装：plugin 返回 already exists，Skill 返回 already exists；均为安全拒绝，无重复注册、无文件变化
- 真实工具调用：`record_meal` 返回 `foundation_not_implemented`、`committed=false`，无 `record_id`
- 业务数据：调用前后只含 `.gitkeep`；`*.sqlite`、`*.db`、`*.jsonl` 为 0
- plugin dry-run：精确命中本次 config entry、install record 和扩展目录
- uninstall：插件总数回到安装前基线，活动配置和扩展目录无残留
- Skill：只删除 source-origin 已核对的本次 workspace 叶
- 完整 Gateway 重启：tool 和 Skill 均不再发现
- 清理：临时仓库和私钥已删除；仅保留平台自身脱敏审计日志

## 发现的问题与处理

| 发现 | 结论 | 处理 |
|---|---|---|
| 干净环境没有 `gh` 或系统 `ssh` | 私有仓库凭据和 SSH 客户端属于外部前置条件 | 文档继续 fail-closed 为 `GITHUB_AUTH_REQUIRED`；本轮由管理员提供临时只读 key，SSH 走官方 443 |
| 已运行 Gateway 安装插件后可能暂时没有新工具 | 工具注册需要新会话或 Gateway 激活 | 交接文档新增激活与显式核验步骤 |
| 重复安装不会静默覆盖 | OpenClaw 以 already exists 安全拒绝 | 作为可接受的幂等结果，但必须复核注册和数据无变化 |
| in-process 热重载不保证卸载旧工具对象 | 磁盘清理和运行时清理是两层 | 卸载文档要求完整 Gateway 进程重启后再核 tool 消失 |

## 安全收尾

- 三套环境的测试仓库和私钥均已删除。
- 02/03/04 的临时 GitHub deploy key 均已撤销。
- GitHub 仓库最终显示无 deploy key。
- 没有把 Gateway token、私钥、公钥、deploy-key fingerprint 或用户数据写入仓库。
- 没有使用 OpenClaw 05/06/07；它们保留给未来必要的真实环境验收。

## 下一步

本任务完成后回到《总功能开发计划 0.3》的顺序：启动 `SH-CASE-003`，先设计隐私、foundation、迁移、安装、恢复和删除 Oracle。不得把本次开发交接 PASS 误写成正式产品安装门或真实业务可用。
