# EV-20260819-041 — 0.2.0 candidate-010 离线营养数据集构建与字节校验（DEC-032）

## Identity and scope

- `evidence_id`: `EV-20260819-041`
- `evidence_type`: `E-CANDIDATE-BUILD`
- `recorded_at`: `2026-08-19`
- `result`: `PASS`（构建 + 字节校验）；真实 Gateway 离线验收**延后**，随 DEC-032 O-5 全量回归 + 重建 candidate-010 一并归档。
- `product_version`: `0.2.0`
- `plugin_version`: `0.2.0`
- `contract_version`: `3`（`diet-manager/contract-v3`）
- `domain_schema_version`: `domain/v2`（业务事实 schema 未变）
- `source_commit`: `9292579e11513738784a0d061fee20cd07e337b3`
- `archive_path`: `artifacts/diet-manager-b-0.2.0.zip`
- `archive_bytes`: `315296`
- `archive_sha256`: `762027A2B3CE57F9BC6F3A79A2E939D59CCD0383E0313104039C89C4FA9F2315`
- `archive_entries`: `84`；`source_modules`: `76`
- `node_version`: `v24.15.0`
- `openclaw_version`: `OpenClaw 2026.7.1 (2d2ddc4)`
- `secret_value_count`: `0`

本证据记录 DEC-032（离线营养数据集）的候选构建字节与门禁：将 USDA FDC 权威值按闭合 12 项餐食词表离线打包（`public.usda_fooddata_central_bundled`，权威层 rank 4），离线解析链无条件接线，网络 FDC 降级为可选增强（配置+启用时才在同等 rank 下先于离线 bundle 运行，离线 bundle 仍是无网络时的兜底权威）。不构成阶段收口、不授权 releases 晋级或 tag。

## 全量回归

`vitest run --no-file-parallelism` 通过：**60 files / 1115 tests**，退出码 0。较 candidate-009（59 files / 1110 tests）新增离线切片 `nutrition-offline.test.ts`（5 例），`nutrition-application.test.ts` 的 `chicken_breast`→`chicken` 词表修正同步到位。

## 构建门禁

`build-release.ps1 -CandidateNumber 10 -TargetVersion 0.2.0 -ContractVersion 3` 运行：

- `pnpm install --frozen-lockfile` → `Already up to date`（退出码 0）。
- `tsc -p tsconfig.json`（build）→ 退出码 0。
- `openclaw plugins validate --root . --entry ./dist/index.js` → `Plugin diet-manager-b is valid.`（退出码 0）。

输出：`BUILD_RELEASE|PASS|candidate=candidate-010|zip_sha256=762027A2B3CE57F9BC6F3A79A2E939D59CCD0383E0313104039C89C4FA9F2315|entries=84`。

## 字节校验

`validate-release.ps1 -CandidateRoot .tmp/release-candidate/0.2.0/candidate-010 -SkipInstallLifecycle` 通过：

- `FILES.SHA256` 覆盖、升序、逐字节一致；
- `MANIFEST.json` schema / archive 字节数与 SHA 与真实压缩包一致；
- 展开压缩包逐条目 CRC 与解压长度校验；
- `dist/*.js` 与 `MANIFEST.source_modules` 一一对应；
- 文件名 + 文本秘密扫描 clean。

输出：`VALIDATE_RELEASE|PASS|files=5|archive_entries=84|source_modules=76|secret_scan=clean`。

## 范围与边界

- 新增源模块随 0.2.0 进入候选：`src/nutrition/offline-usda.ts`（对应 84−83 的 1 个新 dist 条目）。词表键 `chicken`（非 `chicken_breast`）与 `src/parser/meal.ts` 闭合 12 项 LEXICON 对齐。
- 离线 bundle 覆盖 10 项 USDA SR Legacy 记录（milk/egg/apple/banana/bread/rice/chicken/coffee/tea/soy_milk），`soup`/`fried_rice` 归 `local.versioned_common_dish_template` 泛化模板层（rank 6），`rice` 因 fiber 缺失落 `partial` 覆盖，与 HTTP 路径同构。
- 真实 Gateway 离线验收（断网 / 无 `FDC_API_KEY` / 无超时三态）**未执行**：留待 DEC-032 O-5 之后的真实环境执行器跑批，产出 online/offline/timeout 证据；本证据不代跑。
- 不触及 `releases/`、0.1.1 ledger、`accepted_candidate`。`shared/acceptance-cases` 与 `fixtures/core-v1.json` 中的 `chicken_breast` 属冻结 PRODUCT-0.1 制品，本证据范围外，未改。
