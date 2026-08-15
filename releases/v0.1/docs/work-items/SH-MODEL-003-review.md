# SH-MODEL-003 独立复核记录

> 状态：第二轮独立复核 PASS；P0=0、P1=0。
>
> 日期：2026-08-11

## 第一轮结论

```text
SH-MODEL-003-INDEPENDENT-REVIEW|FAIL|p0=0|p1=3|p2=3|cases=52/58|schema_mutations=3/4
```

复核使用两套与本地 PowerShell validator 独立的实现：Ajv 8.20.0 + ajv-formats，以及符合本次 draft 2020-12 `prefixItems + items:false` 官方语义用例的 `@hyperjump/json-schema`。复核器独立解析 `$template/$set/$remove`，逐项核对 58 个 case ID，没有从本地 validator 生成期望。

字节哈希未由 OpenClaw 侧复验：审查输入经过聊天渲染归一化，无法保持原文件空白字节；本地冻结哈希仍由 validator 校验，最终还必须由 GitHub 独立 clone 复验。

## P1 发现

### P1-1 CorrectionEvent 的结构层/语义层边界未声明

第一版 Schema 放行了以下三个端到端反例：

- `ICM-CORRECTION-DATE-ORDER-INVALID`
- `ICM-CORRECTION-NO-CHANGE-EVENT-INVALID`
- `ICM-CORRECTION-STALE-WRITE-INVALID`

日期升序、两个摘要不等、两个整数/身份字段相等或递增不能由标准 JSON Schema 2020-12 完整表达。第一版 validator 能拒绝，但文档和 fixture 把它们错误描述成 Schema 单层责任。可表达的 void/restore lifecycle 也尚未进入 Schema。

### P1-2 MixedCommitResult 的顺序/身份约束属于语义层

第一版 Schema 放行：

- `ICM-MIXED-SEQUENCE-DUPLICATE-INVALID`
- `ICM-MIXED-SEQUENCE-GAP-INVALID`

`sequence == array index` 以及子项 `operation_id/idempotency_key` 的跨数组唯一性必须由语义层检查。第一版报告把四个 mutation 都写成 Schema 可拒绝，造成错误的完成声明。

### P1-3 DailyProgressResult 别名责任未分层

第一版上游 `DailyProgressResult` 只描述字段形状，不能表达单日 alias 与数组首项逐字段相等。SH-MODEL-003 又没有在引用位置补充可表达的“单日必须存在、多日必须缺失”，使 `ICM-FINALIZE-SINGLE-ALIAS-MISSING-INVALID` 被标准 Schema 放行。

## 已完成处置

1. Schema 增加 `x-semantic-contract`，冻结 10 项必须由语义 validator 和未来 B 后端执行的不变量。
2. Schema 增加 void/restore lifecycle 的 `if/then` 规则。
3. EnvelopeFinalize 的 progress 引用增加 alias cardinality：单日必须有 alias，多日不得有 alias；alias 与唯一日期对象相等仍由语义层负责。
4. fixture 增加 `semantic_only_case_ids`，分开 Schema 结果与端到端语义结果。
5. fixture 从 58 例扩展为 65 例，补充 void/restore 错误 lifecycle、目标/版本关系、mixed 双身份唯一性和 alias 不相等反例。
6. validator 固定 65 个 case、10 个 semantic-only ID、10 个语义不变量和新的 Schema 结构门。
7. 本地分层候选重新达到 `65/65 PASS`；随后由第二轮独立复核重新实现并验证结构层与语义层。

## 第二轮结论

```text
SH-MODEL-003-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=65|semantic_only=10|mutations=4
```

第二轮在 OpenClaw 的隔离 `/tmp/sh-model-003-r2` 目录中运行，不调用项目 PowerShell validator 生成期望。第一次长会话独立建立 reviewer 并完成所有检查，但在输出最终答复前达到上下文上限；因此另开精简会话，只读审计并重新执行同一 reviewer，得到上面的正式机器结论。

复核证据：

- reviewer 主脚本为 `/tmp/sh-model-003-r2/review.cjs`，重新执行 exit 0，输出与上一轮临时 `review.out` 逐行一致；
- Ajv 8.20.0 使用 2020-12 入口；Hyperjump 1.17.8 以 `$id` 注册三份 Schema，并为 12 个定义创建独立包装 `$ref`；两者对 65 个解析实例交叉一致；
- 65 个 case ID、10 个 `semantic_only_case_ids` 和 10 个 `x-semantic-contract` invariant 名称分别精确、唯一并完整覆盖；
- 10 个 semantic-only 反例全部表现为 Schema-valid、semantic-invalid；没有额外结构/语义 mismatch；
- 前三个 mutation 被结构层和语义层共同拒绝，mixed reorder 被独立语义层拒绝；
- 25 个结构门全部通过，包括第一轮发现的 void/restore、单日/跨日别名和分层声明；
- reviewer 未使用 `child_process`、`exec` 或 `spawn` 调用项目验证器，未修改项目文件，也未读取受保护 lease。

OpenClaw 聊天输入会归一化空白，因此第二轮仍不把聊天转录的字节哈希作为身份依据。候选文件的精确 SHA-256 由本地冻结验证器、GitHub 对象和独立 clone 共同核验。

## Ajv 兼容性观察

第一轮 Ajv 8.20.0 在复核器的加载方式下对官方 draft 2020-12 `prefixItems + items:false` 语义用例出现 9/40 不一致，并误拒使用该构造的营养进度对象。Hyperjump 在该官方语义上表现正确，因此第一轮以 Hyperjump 作为判定引擎，Ajv 结果仅作兼容性观察。不得为了迁就错误加载/引擎行为而改坏上游 Nutrition Schema。

## 第二轮完成门

- Schema 层：65 个 case 中，普通 case 与 `expected_valid` 一致，10 个 semantic-only case允许结构通过但不得出现额外 mismatch；
- 语义层：独立实现 10 个 invariants 后 65/65 与 `expected_valid` 一致；
- 四个 mutation：前三个结构层和语义层都拒绝，mixed reorder 至少由独立语义层拒绝；
- P0=0、P1=0；
- 最终机器结论必须为：

```text
SH-MODEL-003-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=65|semantic_only=10|mutations=4
```
