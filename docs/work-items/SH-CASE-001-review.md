# SH-CASE-001 独立复核记录

> 日期：2026-08-11  
> 结论：PASS（P0=0，P1=0）

## 复核身份

- reviewer：OpenClaw 独立产品案例复核
- review ZIP：`sh-case-001-review-06b280bd480e49adbc6e922e53b77d4f.zip`
- ZIP bytes：`151068`
- ZIP SHA-256：`B189753659E588940C3CCB6933A107D20252598BAF433B777218796019FC1F8E`
- ZIP entries：`12`
- 受保护 lease 文件命中：`0`
- SQLite/DB/WAL/SHM/JSONL 业务载荷：`0`

复核端在自己的隔离临时目录解压，逐项核验 ZIP 身份、条目集合和 review package 中声明的 10 个文件哈希。复核没有执行候选 PowerShell validator 来产生期望值，而是依据 brief、design、CONTRACT-v2、回执/日期契约和 DOC-0.3 编写独立 checker。

## 独立检查结果

- 精确 5 个正式 CASE-ID，顺序和唯一性正确；精确 3 个 fixture 对象。
- 环境固定为 `2026-08-11T08:30:00+08:00`、`Asia/Shanghai`、`zh-CN`、`monday`。
- Oracle 为测试拥有的字面量，且 `adapters_may_rewrite_oracle=false`。
- 多项餐与单项餐统一使用有序 `items[]` 和 `meal_id`。
- 牛奶属于 meal，不计入白水；明确 500 ml 白水不估算、不重复计入 meal。
- 回执由同一信封 finalizer 产生，块顺序为 `title,item_lines,progress`，进度块最后；黄金文本仍留给 `SH-CASE-004`。
- “今天”查询使用半开自然日区间、只返回 active 记录、按发生时间排序、时间可读且业务写入为 0。
- FactCommit 失败时八类业务对象全部零新增；独立脱敏技术日志允许存在，但不算饮食记录或成功证据。
- fixture 引用完整，查询数据同时包含 active、superseded 和 voided 行，能够阻止“返回全部记录”的弱实现。

## 独立 mutation

独立 checker 执行 20 项 mutation，20/20 被拒绝。它覆盖要求的 11 类：缺少案例、重复 ID、错误 requirement、允许适配器改写、牛奶当白水、单项替代形状、明确水量标为估算、回执重排、查询可写、返回 voided 数据、FactCommit 失败仍写 meal；并额外执行 9 项加强变异。

```text
SH-CASE-001-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=5|fixtures=3|mutations=20
```

## 非阻塞 P2

1. 案例 Oracle 使用 `nutritious_drink`，冻结 Schema 的 `item_type` 枚举使用 `nutrition_drink`。未来 `SH-HARNESS-001` 必须显式、单向地定义该适配映射，不能让适配器重写 Oracle。
2. `CASE-MEAL-021` 自身的 forbidden 集合未重复列出 `internal_id_in_receipt`；该不变量已由 `CASE-RECEIPT-001` 覆盖。后续 harness 可把公共输出禁项集中校验，当前不扩张五案的职责边界。

两项均不允许被解释为已完成 B adapter、数据库、harness、OpenClaw/MCP 生产集成或产品可安装性。
