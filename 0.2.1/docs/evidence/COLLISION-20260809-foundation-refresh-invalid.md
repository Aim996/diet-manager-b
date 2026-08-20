# 失效碰撞记录：原 foundation 重验曾错误占用 EV-20260809-008

> **状态：INVALID / 不得作为任务完成证据。** 本文件原先错误声明为
> `EV-20260809-008`，随后同名原始输出被真正的
> `EV-20260809-008`（`SH-CONTRACT-004`历史契约验证）覆盖。为保留审计历史，
> 本文件未删除，只移出`EV-*.md`有效证据命名空间。foundation 已在当前文件
> 版本上重新执行，并由独立路径的`EV-20260809-009`替代。

## DOC-0.3 结构化元数据补充

```yaml
evidence_schema_version: EV-v2
invalid_original_evidence_id: EV-20260809-008
started_at: 2026-08-09T15:43:00+08:00
finished_at: 2026-08-09T15:52:00+08:00
timezone: Asia/Shanghai
task_ids:
  - A-FND-001
  - B-FND-001
  - C-FND-001
  - SH-FND-001
  - SH-FND-REFRESH-001
case_ids:
  - CASE-FOUNDATION-001
  - CASE-FOUNDATION-002
requirement_ids:
  - REQ-SCOPE-003
  - REQ-SAFE-004
risk_ids: []
change_ids: []
contract_versions:
  business_contract: CONTRACT-v1@CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D
official_data_roots: []
scanned_roots:
  - E:\codx\skill\饮食管家
isolated_test_roots:
  - "%TEMP%\\diet-manager-openclaw-<guid>"
business_impact: zero
verdict: PASS
executor: Codex
independent_reviewer: foundation_reality_audit
independent_reviewed_at: 2026-08-09T16:00:00+08:00
```

`task_ids[]`中的五项不是借用证据：同一次总验证实际逐路运行A结构、B测试/构建/插件验证、C测试/构建/插件验证，并运行共享状态隔离与业务文件扫描，所以分别支撑三条foundation任务、共享验证器历史任务和本次重验任务。它不支撑任何PRODUCT业务任务。

### 逐命令结果

| command_id | 工作目录/命令 | exit_code | route_result |
|---|---|---:|---|
| `foundation-all` | 项目根；`shared/validate-foundations.ps1`，显式Node 24.15.0/OpenClaw入口 | 0 | A结构PASS；B 7/7/build/plugin PASS；C 7/7/build/plugin PASS |
| `state-isolation` | 项目根；`shared/tests/validate-foundations-state-isolation.ps1` | 0 | 环境恢复与临时状态清理PASS |
| `post-scan` | 项目根；JSONL/SQLite/DB及WAL/SHM/journal/temp sidecar只读扫描 | 0 | 业务类和辅助文件0；OpenClaw临时残留0 |

前后manifest在空业务数据基线上均为空集，因此新增、修改、删除清单均为`[]`。当时没有配置或放置用户正式数据根，不能把空基线等同于“预置正式数据未改”；该缺口继续由`SH-SAFE-BASE-001`关闭。

## 元数据

- 执行时间：2026-08-09 15:43—15:52（Asia/Shanghai）
- 执行者：Codex
- 任务：`SH-FND-REFRESH-001`
- 环境：Windows PowerShell 5.1
- Node：24.15.0（隔离便携运行时）
- Node 官方压缩包 SHA-256：`cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62`
- pnpm：11.16.0，仅用于修复失效的 `node_modules` 链接；未生成锁文件
- Vitest：2.1.9
- TypeScript：5.9.3
- OpenClaw：2026.7.1
- 原始输出：`docs/evidence/raw/EV-20260809-008-validation-output.txt`

## 实际命令

```powershell
$env:DIET_MANAGER_NODE='<isolated-node-24.15.0>\node.exe'
$env:DIET_MANAGER_TOOL_MODULES='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules'
$env:DIET_MANAGER_OPENCLAW_ENTRY='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\openclaw\openclaw.mjs'
powershell -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\validate-foundations.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-foundations-state-isolation.ps1
```

## 结果

| 检查 | 结果 |
|---|---|
| A 结构验证 | 通过 |
| B Vitest | 7/7 通过 |
| B TypeScript 构建 | 通过 |
| B OpenClaw 插件验证 | 通过 |
| C Vitest | 7/7 通过 |
| C TypeScript 构建 | 通过 |
| C OpenClaw 插件验证 | 通过 |
| 状态隔离回归 | 退出码 0 |
| 调用者状态恢复与临时目录清理 | 通过 |
| 项目内业务类文件执行前 | 0 |
| 项目内业务类文件执行后 | 0 |
| 业务类路径/哈希差异 | 0 |
| OpenClaw 临时目录残留 | 0 |

因此，本轮 foundation 验证没有创建 JSONL、SQLite、SQLite3 或 DB 业务数据，也没有留下 WAL、SHM、journal 或 JSONL 临时/日志辅助文件。

## 关键文件 SHA-256

| 文件 | SHA-256 |
|---|---|
| `shared/validate-foundations.ps1` | `47EAB29BE03D1BA83A20BEA5A00CE860D8E9D26EDB15B026AD7FF3C57F0DBDEB` |
| `shared/tests/validate-foundations-state-isolation.ps1` | `A9EF8248DF8AF4588B83F375D7194C077EF9373F13F60D6F3BD82F261EA87D6D` |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` |
| `shared/acceptance-cases/cases.json` | `C489E6A12F331B5438BEFF11864E80BCA4435891D42C367C1A4AECADF3441399` |
| `version-b-lite-plugin/package.json` | `94F6BF5D304E654B86BE3D09FD5EB3AABFCB3F26271FEFBBB4A58E8AB165318C` |
| `version-c-strict-plugin/package.json` | `07793D2D2A8ED476E8A2FD04394BED59B23921B0F68BADC145AAEBD9850629F6` |

## 诊断与修复

1. 本机起初没有 PATH 中可用的 npm；Codex 自带 Node 24.14.0 又低于 OpenClaw 2026.7.1 要求的 24.15.0。
2. B/C 的部分 `node_modules` junction 指向旧工作区，真实 Vitest 首次报缺少 `@vitest/utils`。
3. 使用 pnpm 11.16.0 重建 B/C 依赖链接，并使用校验过 SHA-256 的隔离 Node 24.15.0 重验。
4. 验证后删除临时 Node、压缩包和运行时映射；未留下验证工具目录。

## 证据边界

本证据只证明当前 foundation 在“项目内业务类文件集合为空”的基线上通过，并证明本轮未创建这些文件。它不证明完整饮食业务已经实现，也不关闭以下验证器缺口：

- 尚未预置正式 JSONL/SQLite 后验证前后内容哈希不变；
- 当前共享脚本的污染扫描仍位于成功路径末尾，前置命令失败时不会自行执行；
- 当前脚本尚未在删除 OpenClaw 临时状态前审计该目录；
- 当前脚本仍会在源码树内重建 `dist`；
- 当前脚本本身尚未扫描全部 WAL/SHM/journal/临时扩展名。

这些缺口由 `SH-SAFE-BASE-001` 负责，必须在 G1 前关闭；本证据不得用于宣称 PRODUCT-0.1 可安装或可发布。
