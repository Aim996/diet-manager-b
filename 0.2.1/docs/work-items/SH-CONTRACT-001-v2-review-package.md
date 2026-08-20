# SH-CONTRACT-001 CONTRACT-v2 独立复核包

## 复核对象

- 候选：`shared/business-contract.md`
- 候选 SHA-256：`632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E`
- 验证器：`shared/tests/validate-business-contract-v2.ps1`
- 验证器 SHA-256：`2395D4B0A5806CDCE5FE1C313BE814CF473ABF65B3810E72DBC2BFFD20790589`
- 规范来源：`总功能开发计划0.3.md`
- 规范来源 SHA-256：`94766B7BF1D100CCBAE5B2885A2C7986E98DD3141EECA95E2AB87C06327D58F3`
- 实施简报：`docs/work-items/SH-CONTRACT-001-v2-brief.md`
- 实施报告：`docs/work-items/SH-CONTRACT-001-v2-report.md`
- 复核输出：`docs/work-items/SH-CONTRACT-001-v2-review.md`

无 `-v2` 后缀的 brief/report/review-package/review 属于 CONTRACT-v1 历史，不是本轮证据。

## 复核边界

- 只读候选、验证器、总计划0.3、v2 brief/report/review-package。
- 禁止读取、哈希、编辑或执行简明计划列出的五个受保护 lease 文件。
- 不修改候选、验证器、总计划、实现路线或证据台账。
- 只允许创建或更新 `SH-CONTRACT-001-v2-review.md`。
- 不创建任何业务数据文件。

## 必查内容

1. CONTRACT-v2 是否只允许 B 拥有产品写入，且 Skill/OpenClaw/MCP 只是共同后端的适配面。
2. 五种业务结果是否与 `committed` 一致，开发状态是否未混入业务终态。
3. FactCommit 失败是否确实禁止事实、库存、营养、Issue、业务 outbox、进度、成功回执和终态幂等结果，同时只允许独立技术日志。
4. EffectBundle 与 EnvelopeFinalize 的失败、重试和事实保留边界是否明确且无矛盾。
5. 幂等身份、终态/非终态重试和冲突零新写入是否完整。
6. 服务端预览绑定和调用方状态不可信是否可供 B 后端实现。
7. 77 个任务范围 REQ ID 是否逐语义满足，而不只是出现；规范强度是否正确。
8. 十项 `legacy_rule_guards` 是否与正文和 §12 superseded 审计一致，旧规则是否在现行规范复活。
9. §11 companion contract 边界是否削弱正文已经冻结的共同语义。
10. 是否引入未经决定的新产品能力、数据库字段或适配器专属业务逻辑。
11. 第一轮 FAIL 所指出的生命周期、位置/到期/营养优先级、`data_revision`、规范强度、共食未知量、PRODUCT-0.2 部分扣减和单日进度别名是否均已按计划修复，且无近义枚举或静默扩域。

## 独立验证要求

- 独立运行 CONTRACT-v2 验证器并记录退出码与完整摘要。
- 独立计算候选和验证器哈希。
- 独立构造 77 个期望 ID，检查缺失、额外和追踪表单例性。
- 独立扫描现行规范的十类旧规则，不得直接复用实施方数组或结果。
- 独立扫描业务数据候选前后计数。

## 输出格式

复核报告第一行必须是 `PASS` 或 `FAIL`。

若为 FAIL，每项发现必须提供严重度、精确位置、受影响 REQ/DEC/CHG、正确语义、当前问题和最小修复。若为 PASS，必须提供逐语义结论、验证命令摘要、候选哈希、业务数据计数及是否存在非阻断建议。

在独立 PASS 和主协调者登记新鲜 `EV-*` 之前，`SH-CONTRACT-001` 必须保持 `进行中`。
