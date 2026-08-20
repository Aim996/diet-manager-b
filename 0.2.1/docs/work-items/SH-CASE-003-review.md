# SH-CASE-003 独立复核记录

> 日期：2026-08-11
> 最终结论：PASS（P0=0，P1=0，P2=2）

## 复核身份

- reviewer：OpenClaw 02 独立运维/安全案例复核
- GitHub repository：`Aim996/diet-manager-b`（public）
- branch：`agent/sh-case-003-ops-security-oracles`
- reviewed HEAD：`1139dd59a590e9fb78a49efd471c52e4bba8a958`
- draft PR：`#2`
- base：`33e51b773be66b78581e7a3d13fdd95e86c8f6a4`
- review mode：只读 HTTPS partial clone、单分支、sparse checkout
- protected lease files read/hash/execute count：`0`
- product runtime / Node / OpenClaw plugin execution count：`0`

## 获取与清理

仓库最初为 private。OpenClaw 02 没有 SSH transport，因此第一次只读获取被安全阻断；临时只读 deploy key 随后已从 GitHub 撤销，第一次临时根也已精确清理，残留为 `0`。

用户选择公开仓库后，复核端通过无凭据 HTTPS 拉取 reviewed HEAD。五个受保护路径被 sparse 规则明确排除，并确认它们在 base 与 reviewed HEAD 中都不存在，因此没有获取、读取、哈希或执行这些文件。复核结束后，精确临时根 `/tmp/sh-case-003-public-review-2i84807d` 经普通目录、非链接、非挂载点和内容归属检查后删除：

```text
SH_CASE_003_PUBLIC_REVIEW_CLEANUP|PASS|residual=0
```

## 独立检查

复核端没有使用候选 PASS 文本或候选声明哈希生成预期，而是从总功能开发计划 0.3、brief、plan 和 base 独立建立三组 checker：

1. 数据与 Oracle checker：验证 20 个累计 CASE-ID 的精确顺序、6 个新增 fixture、case/requirement 映射、14 个旧 case 和旧 fixture 的字节保持、14 个类文件 fixture 的 Base64/长度/SHA-256、逻辑路径、隐私白名单、foundation 零差异、安装、迁移、候选漂移和无效导出恢复规则。
2. mutation checker：独立证明 12 个 mutation 都是单一预期变化，并由真实 `Test-OpsSecurityCandidate` 以冻结错误前缀拒绝；没有从候选输入生成期望。
3. hygiene checker：验证严格 JSON、无重复键、PowerShell ASCII/CR/NUL、括号平衡、`git diff --check`、受保护路径零变化、业务数据库/JSONL/日志/二进制候选为零、临时残留为零。

同时确认：core/domain validator 只增加累计版本、6 个 ID 后缀和 fixture root 后缀；原有 5 个 core case、9 个 domain case 及 8/11 个 mutation 仍由原验证器逐值拥有。

## 复核结论

```text
SH_CASE_003_REVIEW|PASS|P0=0|P1=0|P2=2
```

P0/P1 均为零，因此 `SH-CASE-003` 可以按静态 Oracle/fixture 范围关闭。

## P2 记录与处置

### P2-1：旧案例缺少第二层摘要表

新 ops/security validator 没有再内嵌一份旧 14 case/旧 fixture 的固定摘要表。当前没有实际弱化：旧值继续由 core/domain validator 逐值拥有，本次独立 base comparison 也证明字节保持。为避免建立第二套 Oracle，本任务不立即复制摘要表；把“是否增加独立 preservation digest”记录为后续 validator defense-in-depth 优化。

### P2-2：公开前曾有本机路径文字

实现候选早期 brief 曾包含两个工作区绝对路径。公开前的 open-source hygiene commit 已改为仓库相对路径，最终 10 个变更文件中无本机路径、密钥或 OpenClaw 地址。原 candidate report 未记录这次修正；本次收尾已补入 report 的“Discovered and corrected”。

## 完成边界

本复核只证明共享静态 Oracle/fixture 与反弱化验证足以约束 `SH-CASE-003`。它不声明 installer、migration runner、backup/restore、uninstall/delete、SQLite repository、B adapter、OpenClaw/MCP 生产集成或产品发布已经实现。
