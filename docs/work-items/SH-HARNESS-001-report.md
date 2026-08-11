# SH-HARNESS-001 Candidate Report

> 状态：independent_review_passed；P0=0/P1=0，两个P2已在closure delta关闭。  
> 日期：2026-08-12  
> 分支：`agent/sh-harness-001-shared-runner`  
> implementation candidate：`6601db6320078c264dfa4c481cc66d82fe360f4b`  
> draft PR：<https://github.com/Aim996/diet-manager-b/pull/4>

## 1. 本轮到底开发了什么

本轮完成的是共享验收运行协议，不是 SQLite 业务后端：

- A adapter 只返回 `read_only_no_plugin`、`not_executed`、零业务写入；
- B adapter 没有 driver 时诚实返回 `backend_pending`，不得冒充产品 PASS；
- B driver 存在时只能收到公共输入、已解析 fixture 和合同哈希，收不到 `oracle` 或 `forbidden`；
- shared runner 在 adapter 外部完成 exact comparison；
- C 不创建独立 adapter，其安全控制继续由 B 主线承担；
- 默认报告确定性、无 Oracle 内容、无失配字段路径、无绝对机器路径、无业务记录。

因此当前结论是：

```text
harness protocol ready
B backend pending
SQLite / repository / installable Skill not implemented
```

## 2. 计划差异与处理

manifest 的第一个 RED 为：

```text
HARNESS_REQUIRED_CASE_MISSING:CASE-STORAGE-001
```

总计划把 `CASE-STORAGE-001` 列为本任务必需案例，但 `1.3.0` 累计目录只有 26 案且没有该 ID。处理方式是：

- 原 26 案保持值与顺序不变；
- 不新增或修改 fixture，复用 `domain-idempotency-conflict-v1`；
- 只追加 `CASE-STORAGE-001`，目录升级到 `1.4.0 / 27`；
- 新 Oracle 固定同幂等键、同输入重试必须返回原结果，meal/inventory/template 和总 business write 均零增量；
- domain validator 新增 `MUT-DOMAIN-REEXECUTE-SAME-IDEMPOTENCY-KEY`。

这只是补齐计划必需 Oracle，不代表幂等 repository 已经实现。

## 3. 协议与安全边界

### 3.1 输入隔离

`CaseExecutionInput` 恰含：

- `case_id`
- `requirement_ids`
- `stage`
- `source_text`
- resolved `setup`
- `contract_hashes`

plain DTO 冻结器先检查 Proxy、prototype、symbol、accessor 和 exact property set，再读取值；递归 clone 后 freeze。测试证明动态 getter 命中数为 0，driver 对嵌套输入的改写被拒绝且原目录不变。

### 3.2 写失败原子性

B driver observation 必须显式给出 `outcome_status`、安全 `reason_code`、`business_writes` 和 observation。`failed` 时任何非零 business write 都在 adapter 边界拒绝。技术日志以后可以单独存在，但既不进入饮食对象，也不计为记录成功。

### 3.3 Oracle 权威

adapter 不读取、生成、修复或比较 Oracle。runner 对 plain JSON 做 exact recursive comparison：对象属性集合精确、数组长度与顺序精确、标量按类型和值精确。公开报告只保留 matched/mismatched 状态，不回显 expected、actual 或失配字段路径。

## 4. TDD 证据

| RED | GREEN |
|---|---|
| manifest 缺失 | 创建六输入哈希 manifest |
| `CASE-STORAGE-001` 缺失 | 单案追加为 `1.4.0 / 27`，旧26案不变 |
| `run-all.ts` 模块缺失 | dependency-free Node 24 runner |
| array `length` 被误判为动态字段 | 专用 dense-array descriptor 校验 |
| Markdown 合同被错误按 JSON 解析 | hash-only 与 JSON parse 路径分离 |
| Oracle accessor 输入 | 读取前拒绝，getter hits=0 |
| failed observation 带业务写入 | `failure_requires_zero` |
| driver reason 可能携带机器路径 | 只允许稳定小写 token |
| 报告可能公开失配路径 | public row 删除 mismatch path |

## 5. 验证结果

### 5.1 Harness

```text
Node.js v24.14.0
15 tests / 15 pass / 0 fail
default protocol_status=passed
default product_status=backend_pending
case_count=27
A degraded=27 / writes=0
B backend_pending=27 / writes=0
C independent adapters=0
Oracle/path/mismatch-path leak=false
```

### 5.2 十二项串行回归

```text
CONTRACT_V2|PASS
RECEIPT_DATE_V2|PASS
ISSUE_CORRECTION_V2|PASS
DECISION_THRESHOLDS|PASS
CORE_MODEL_SCHEMAS|PASS
NUTRITION_PROGRESS_SCHEMAS|PASS
ISSUE_CORRECTION_MIXED_SCHEMAS|PASS
STORAGE_MAPPING|PASS
CORE_ACCEPTANCE_CASES|PASS|version=1.4.0|cases=5|fixtures=3|mutations=8
DOMAIN_ACCEPTANCE_CASES|PASS|version=1.4.0|cases=10|scenarios=9|mutations=12
OPS_SECURITY_ACCEPTANCE_CASES|PASS|version=1.4.0|cases=6|scenarios=6|mutations=12
GOLDEN_RECEIPTS|PASS|case_version=1.4.0|cases=8|assets=8
```

### 5.3 边界

- 没有创建 SQLite、JSONL、WAL、journal 或饮食业务记录；
- 没有 `adapters/c.ts`；
- 没有 OpenClaw/MCP production adapter；
- 五个受保护 lease 路径未读、未哈希、未执行、未改；
- `git diff --check` 通过；
- GitHub branch 与 implementation candidate 相等后发起独立复核。

## 6. 主要实现文件

| 文件 | SHA-256 |
|---|---|
| `shared/acceptance-cases/harness-manifest.json` | `83A91721491CB3D26B8E08496F3A7F8E2A9D61C763E4A1C3828DD12B48057753` |
| `shared/acceptance-cases/adapters/a.ts` | `BACF419CFFEB7E1BA3554D3E8DB6C18976D9A276D278D4C4E9C2FD0D91240FF3` |
| `shared/acceptance-cases/adapters/b.ts` | `4245ECAA81505DF21681706595A359839EB6B9FBDE707B3D1F07AD9655BB0868` |
| `shared/acceptance-cases/adapters/runtime.ts` | `95A6926193276461BAE1E68179240AF0F11828563E3740F8B6B72DCC00A3948C` |
| `shared/acceptance-cases/adapters/types.ts` | `DEA58A94800D08457AAE6F5BD3157C54E953B92629CF08FFC01076ACD1F09B9F` |
| `shared/acceptance-cases/run-all.ts` | `3A3437C01B666E185DBCA78AA2418604FD674968CEA070E1F99756A037E93972` |
| `shared/acceptance-cases/tests/harness.test.ts` | `B960DC2433B6882776DA649CD60A289048848620D421FE2A66FBA2D1957765D1` |
| `shared/acceptance-cases/cases.json` | `4A59E83E0CF07B69AE67C394B89F5633A9CE93D32D65B472E3B429151E65E041` |

## 7. 未完成

- B SQLite driver/repository；
- 真实 meal/inventory/nutrition/Issue/outbox 执行；
- trace 镜像与零孤儿治理；
- Skill 安装与 OpenClaw 薄适配器；
- 产品级 27/27 backend execution PASS。

这些不得被本报告的 harness PASS 替代。

## 8. 独立复核

```text
SH_HARNESS_001_REVIEW|PASS|P0=0|P1=0|P2=2|sha=6601db6320078c264dfa4c481cc66d82fe360f4b|cleanup=1
```

P2-1 的 Proxy 显式回归和 P2-2 的报告文档均已在 closure delta 补齐；review target 后未修改 production harness 代码。
