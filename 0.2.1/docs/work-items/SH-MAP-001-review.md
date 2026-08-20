# SH-MAP-001 独立复核记录

> 状态：第三轮独立复核 PASS；P0=0、P1=0。
>
> 日期：2026-08-11

## 第一轮

```text
SH-MAP-001-INDEPENDENT-REVIEW|FAIL|p0=0|p1=7|definitions=34|tables=20|indexes=18
```

第一轮独立对照四份冻结 Schema，发现库存方向、两处营养版本类型、Issue 状态、纠正操作、EffectBundle stage 和 EnvelopeFinalize stage 共 7 项物理约束与上游模型冲突。本地逐项验证后，先让增强验证器对旧映射产生 RED，再修正映射并为每项增加独立回归 mutation。

## 第二轮

```text
SH-MAP-001-INDEPENDENT-REVIEW|FAIL|p0=0|p1=1|definitions=34|tables=20|indexes=18|mutations=28
```

第二轮先精确验证 34906 字节 ZIP、SHA-256、10 个条目、全部 CRC 与 0 个受保护文件命中，再用自写 Python checker 独立递归解析 `$ref/allOf`，没有执行候选 PowerShell validator。34 个定义、20 张表、18 个索引、22 条外键、7 项第一轮修复和 28/28 独立变异均通过。

剩余 P1 是 `effect_bundle` 未分类 `command_envelopes` 与 `idempotency_records`，导致 `effects_pending -> effects_stable` 没有合法信封写入点；另记录 `envelope_finalize` 未分类 `goal_versions` 为 P2。

## 已完成处置

1. 四个事务边界现在都把 20 张表精确、互斥地分成 writable/forbidden 两组。
2. `effect_bundle` 可写 `command_envelopes`，用于推进到 `effects_stable`。
3. `effect_bundle` 明确禁止写 `idempotency_records`。
4. `envelope_finalize` 明确禁止写 `goal_versions`。
5. validator 新增精确边界集合和两个 EffectBundle 回归 mutation，总 mutation 数为 18。
6. 物理契约摘要更新为 `4D18C9EC30F6768930637B375C8F7F90F6299A3E399313B4F1B528DBE6D964B6`。

## 第三轮

第三轮通过 5 个分块传入 4 个当前候选文件。复核端逐块校验 SHA，再校验 gzip 长度/哈希、payload 长度/哈希、格式和四文件哈希；随后与第二轮已验证的四份 Schema、design、brief 组成完整候选树。

复核器继续独立解析映射、复刻 PowerShell 5.1 物理摘要，并把第二轮 28 个变异扩展为 33 个，其中新增 5 个边界回归变异。结果：

```text
SH-MAP-001-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|definitions=34|tables=20|indexes=18|mutations=33
```

独立复核确认：

- 34 个定义和解析字段无缺失、无重复；
- 20 张表、18 个索引、22 条外键有效，外键指向主键或唯一父键；
- 四边界分别为 `6+14`、`11+9`、`5+15`、`20+0`，每组 union=20、overlap=0；
- 7 项第一轮约束无回归，物理摘要与 validator 锚定值一致；
- 33/33 独立变异全部被语义检查或物理 canary 拒绝；
- 候选不含受保护文件、SQLite/JSONL 业务文件，也没有执行候选验证器生成期望。

## 非阻塞待优化

独立复核把更多枚举列和 `idempotency_records.state` 的 SQLite `CHECK` 列为 P2 加固建议。它们与当前 Schema 没有矛盾，不阻塞 SH-MAP-001；在真正 DDL/migration 任务中应结合查询与迁移兼容性统一补充，不能反向扩大当前映射完成范围。
