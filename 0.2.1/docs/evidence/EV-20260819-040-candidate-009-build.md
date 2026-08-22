# EV-20260819-040 — 0.2.0 candidate-009 不可变候选构建与字节校验

## Identity and scope

- `evidence_id`: `EV-20260819-040`
- `evidence_type`: `E-CANDIDATE-BUILD`
- `recorded_at`: `2026-08-19`
- `result`: `PASS`（构建 + 字节校验）；真实 Gateway/USDA 验收**延后**，待用户提供 `FDC_API_KEY`。
- `product_version`: `0.2.0`（与已冻结/待签收的 0.1.1 candidate-008 互不影响）
- `plugin_version`: `0.2.0`
- `contract_version`: `3`（`diet-manager/contract-v3`）
- `domain_schema_version`: `domain/v2`（业务事实 schema 未变）
- `source_commit`: `523ba93b48bf3867aad1598e00f67ebb594358c1`
- `archive_path`: `artifacts/diet-manager-b-0.2.0.zip`
- `archive_bytes`: `312451`
- `archive_sha256`: `7404F5DA3C9D5FE8CFB1F3BD31D94C34EC5F9D5B17D6A1F3C5FD5950897F6F83`
- `archive_entries`: `83`；`source_modules`: `75`
- `node_version`: `v24.15.0`
- `openclaw_version`: `OpenClaw 2026.7.1 (2d2ddc4)`
- `secret_value_count`: `0`

本证据仅记录 0.2.0 首个增量（DEC-030 个人档案/六项目标/进度条 + DEC-031 restore_record）的候选构建字节与门禁。0.2.0 的台账 / 治理 / 发布闭环尚未建立（留待后续），本证据不构成阶段收口、不授权 releases 晋级或 tag。

## 全量回归

`vitest run --no-file-parallelism` 通过：**59 files / 1110 tests**，退出码 0。新增 0.2.0 相关切片（set_profile / set_goal / query_daily_summary 进度条 / restore_record / goal-derivation）均在列。

## 构建门禁（版本无关，不含 0.1.1 governance）

`build-release.ps1 -CandidateNumber 9 -TargetVersion 0.2.0 -ContractVersion 3` 运行：

- `pnpm install --frozen-lockfile` → `Already up to date`（退出码 0）。
- `tsc -p tsconfig.json`（build）→ 退出码 0。
- `openclaw plugins validate --root . --entry ./dist/index.js` → `Plugin diet-manager-b is valid.`（退出码 0）。

输出：`BUILD_RELEASE|PASS|candidate=candidate-009|zip_sha256=7404F5DA3C9D5FE8CFB1F3BD31D94C34EC5F9D5B17D6A1F3C5FD5950897F6F83|entries=83`。

## 字节校验

`validate-release.ps1 -CandidateRoot .tmp/release-candidate/0.2.0/candidate-009 -SkipInstallLifecycle` 通过：

- `FILES.SHA256` 覆盖、升序、逐字节一致；
- `MANIFEST.json` schema / archive 字节数与 SHA 与真实压缩包一致；
- 展开压缩包逐条目 CRC 与解压长度校验；
- `dist/*.js` 与 `MANIFEST.source_modules` 一一对应；
- 文件名 + 文本秘密扫描 clean。

输出：`VALIDATE_RELEASE|PASS|files=5|archive_entries=83|source_modules=75|secret_scan=clean`。

## 范围与边界

- 新增源模块随 0.2.0 进入候选：`src/parser/profile.ts`、`src/parser/goal.ts`、`src/domain/goal-derivation.ts`（对应 83−80 的 3 个新 dist 条目）。
- 真实 Gateway/USDA 验收（DEC-030 §6 C-6 的第三段）**未执行**：依赖用户注入 `FDC_API_KEY`（只进网关进程环境，不进仓库/日志/发布包）。待 key 就位后补跑多网关 + 普通人视角 + 身高体重状态进度条场景，产出 online/offline/timeout 三份证据。
- 不触及 `releases/`、0.1.1 ledger、`accepted_candidate`。
