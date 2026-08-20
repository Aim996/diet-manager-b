# SH-CONTRACT-004 独立复核包

## 1. 冻结候选

| 项目 | 路径 | SHA-256 |
| --- | --- | --- |
| 任务简报 | `docs/work-items/SH-CONTRACT-004-brief.md` | `05BD4FD967C9CF57352B7E011A5DC0A1AB6BB99547DB6A06B8F0B5775F216A48` |
| 核心上游 | `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| 展示上游 | `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` |
| 候选契约 | `shared/contracts/issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` |
| 实施报告 | `docs/work-items/SH-CONTRACT-004-report.md` | `439AE4CDA608565C4D3EC1E7A16E6B9BB511435440EDBAA7465CE31B09B60C4D` |

任一冻结哈希变化即停止并报告 `candidate_changed`，不得审阅未冻结版本。

第 1 轮候选 `1F492CC141062B50E32EAB83797177B58677D0A3E5CDDFF4222ACC33A96AB325` 的结论为 FAIL。F-01（`ignored` 可误吞已提交事实的稍后/不关联）和 F-02（审计存储失败却要求追加失败事件）已修复；任务简报也同步纠正。上表为第 2 轮唯一冻结输入，复核必须保留第 1 轮历史、逐项确认两项关闭且完整重跑全部标准与场景。

## 2. PASS 标准

只有以下全部通过、且高/中严重度发现为 0，才可 PASS：

1. 文档身份、`status_source`、上游优先级和 companion contract 边界清楚，无动态状态或提前完成声明；
2. 32 条范围需求各且仅一次出现在规范性追踪表，无额外 ID，每个映射章节都有真实 MUST/MUST NOT 语义；
3. `preview/committed/ignored/failed` 与 `active/corrected/voided` 严格分离；库存/营养异常不把可识别已发生饮食降成 preview/failed；
4. Issue 恰有 3 kind、17 个当前稳定 code、6 status，状态转换、终态、新 Issue 重开策略、deferred 提示频率和 void/版本替代 invalidated 完整；
5. IssueResolutionEvent 字段、outcome、追加语义完整；改变事实时同事务追加 Correction，纯副作用失败不得 resolved；
6. 多 Issue 统一摘要但不合并身份；快捷提示有 2–4 高价值选项、真实后果/非后果、安全出口、字母/组合/顺序/自然语言；
7. 冲突组合在任何效果前拒绝；兼容组合有序逐事件原子；旧 prompt/option/Issue/库存/目标版本执行前重校验；
8. 固定自由文本末行逐字符正确且之后无同组建议；不与 RECEIPT-DATE-CONTRACT-v1 冲突；
9. Correction 固定 12 operation，字段完整，append-only，preview 不伪造 Correction，CAS/循环/重复补偿/重复 void/重复移除拒绝；
10. 默认查询只看 committed 最新有效视图；详情保留完整链；多候选目标展示人类日期/餐次/食品/数量且不暴露 ID；
11. 库存差量只基于真实已应用效果：增加、减少、改关联、单项 remove、整条 void 和跨日都无半补偿、虚假返还或错日进度；
12. 营养按新有效事实创建新快照，旧快照保留；进度来自同次最终事务结果，不做额外查询/旧快照复用/两报告相减；
13. 正常补扣与补扣不足黄金文本语义正确。补扣不足必须 committed 纠错事实、保留旧扣减、增量不扣、不负库存、`skipped_insufficient + insufficient_inventory(context=correction_increment)`；
14. 真实替代候选仅在存在时提供；无候选不编造；deferred 与不关联/dismissed 区分；自由文本执行等价；
15. 根命令、IssueResolution、Correction/void 的幂等、响应丢失和 possible_duplicate 语义完整，不重复事件/库存/营养/Issue/模板/进度；
16. 单事件原子边界包含事件、真实/跳过库存效果、营养、Issue/Resolution、幂等与最终进度；损坏尾部/事务/迁移/未知提交结果失败关闭；
17. mixed 是有序信封、每子事件独立幂等和 per-event atomic；后一失败不回滚前一；purchase 失败不丢后一可识别 meal；总结果逐项且不假装全成功；
18. 数据路径不受自然语言控制；数值与单位成组；unknown 不变 0/空串/默认份；十进制跨路线精确；
19. 全文不存在现行“所有歧义 preview”“库存异常令饮食失败”“禁止纠错”“静默覆盖/删除”“单项等于整餐 void”“mixed 全局回滚”“旧选项直接执行”“按钮唯一”“营养估算量补偿”等旧语义；
20. 复核前后 `.jsonl`、`.sqlite`、`.sqlite3`、`.db` 文件路径、大小、SHA-256、mtime 无新增/修改/删除。

## 3. 必做语义场景

复核者须逐场景用契约正文给出唯一结果：

- 已记录两个鸡蛋，纠正为三个，库存足量；
- 同样纠正但库存不足且无候选；
- 同样纠正且存在另一个真实候选；
- 已记录三项的一餐只删除牛奶；
- void 整餐，其中一项原先未扣库存；
- 把今天记录改到昨天；
- Issue 快捷回复 `A+C` 的效果冲突；
- 用户自由文本“先别扣库存，以后再说”；
- 旧 prompt 在库存版本变化后执行；
- 同一纠错幂等键重试和响应丢失；
- 两条相似内容但不同键；
- mixed 的 purchase 成功/meal 失败；
- mixed 的 purchase 失败/meal 是明确已发生事实。

如果契约对任一场景存在两种相互冲突的合法解释，必须 FAIL。

## 4. Q-004 边界

候选只冻结 Q-004 所需正常/不足文案与语义；`Q-004` 仍需后续正常、自由文本、陈旧候选和幂等 Oracle 证据，在当前任务后不应被提前标为已解决。复核者须检查候选没有越权宣称问题关闭。

## 5. 输出限制

复核者只创建或更新 `docs/work-items/SH-CONTRACT-004-review.md`，不得修改候选、实施报告、简报、计划、上游、案例、Schema 或其他文件。报告至少包含：

- 冻结哈希、业务数据前后快照；
- 32 条需求逐项 PASS/FAIL；
- 20 项标准和 13 个场景结论；
- 所有发现的编号、严重度、精确行号/章节、影响和最小修复；
- 枚举/追踪/黄金文本/旧语义/业务数据检查命令与结果；
- 总结论与剩余阻断数。

任一高/中发现、语义空映射、上游冲突、事实优先退化、半事务许可、负库存许可、重复副作用、候选哈希变化或业务数据变化必须 FAIL。
