# SH-CASE-002 独立复核记录

> 日期：2026-08-11
> 最终结论：PASS（P0=0，P1=0）

## 复核身份

- reviewer：OpenClaw 独立领域/故障案例复核
- Round 2 review ZIP：`sh-case-002-review-round2-fa8ec437c23643aaa2b2d76473e93f21.zip`
- ZIP bytes：`177207`
- ZIP SHA-256：`46B42F0BAF786549CA779E78FD5262707F6C26601D37090A618958CCD0472C24`
- ZIP files：`15`
- 受保护 lease 文件命中：`0`
- SQLite/DB/WAL/SHM/JSONL 业务载荷：`0`

复核端在隔离临时目录中解压并核验 ZIP 身份、文件集合和 review package 声明的候选哈希。期望值来自 brief、design、冻结业务契约和总计划，不使用候选 validator 的 PASS 输出生成预期。

## Round 1：发现并修复 P1

第一轮独立 checker 通过原 5 案保留检查、9 个领域/故障场景和 11/11 独立 mutation，但发现一个会阻塞正确 B 实现的 token 漂移：

- 候选的两个库存影响状态使用 `skipped_multiple_candidates`；
- 冻结契约要求 `skipped_ambiguous`；
- 匹配结果语义仍为 `multiple`；
- Issue 代码 `inventory_multiple_candidates` 本身正确。

第一轮因此给出：

```text
SH-CASE-002-INDEPENDENT-REVIEW|FAIL|p0=0|p1=1|cases=9|scenarios=9|mutations=11
```

本地先把 validator 的期望改为 `skipped_ambiguous`，旧数据稳定 RED：

```text
DOMAIN_CASE_VALUE_INVALID:CASE-INVENTORY-003:inventory:expected=skipped_ambiguous:actual=skipped_multiple_candidates
```

随后只修正 `CASE-INVENTORY-003`、`CASE-ISSUE-001` 及其字面断言和说明文档，Issue 代码保持不变。

## Round 2：最终独立检查

- ZIP 身份、15 个文件和 6 个声明候选哈希全部匹配。
- 累计案例顺序为原 5 案加精确 9 案后缀，共 14 案；9 个 `domain_scenarios` 唯一且引用完整。
- 两个受影响 Oracle 的 `inventory_match.status` 均为 `skipped_ambiguous`，目录中没有遗留 `skipped_multiple_candidates`。
- design、brief 和 domain validator 对 `multiple`、`skipped_ambiguous`、`inventory_multiple_candidates` 的职责区分一致。
- 原 core fixtures、原 5 案与原 8 个 mutation 的哈希/行为没有回归。
- 3 组冻结状态向量的 SHA-256 独立重算吻合。
- 独立 checker baseline PASS；11 项独立 mutation 全部被捕获，`executed=11|caught=11|not_caught=0`。

最终 verdict：

```text
SH-CASE-002-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=9|scenarios=9|mutations=11
```

## 边界

本复核只证明共享 Oracle/fixture 足以约束本任务的 9 个领域和故障案例。它不声明 SQLite、repository、outbox worker、B runtime adapter、OpenClaw/MCP 生产集成、安装或 G1/G2/G3 已完成。
