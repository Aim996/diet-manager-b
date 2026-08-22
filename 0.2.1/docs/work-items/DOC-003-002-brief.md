# DOC-003-002 实施简报：用户批准与计划入口切换

## 1. 任务身份

- `task_id`: `DOC-003-002`
- `product_scope`: `DOC-0.3`
- `milestone`: `M1`
- `task_kind`: `approval`
- `route`: `shared`
- `objective`: 固化用户对《总功能开发计划0.3》的明确批准，将其切换为当前计划入口，并记录“首要交付物是供智能体使用的饮食管家 Skill；插件、存储和服务只作为该 Skill 的确定性执行后端”的约束。
- `requirement_ids`: `[]`
- `case_ids`: `[]`
- `case_assertion_paths`: `{}`
- `full_case_set`: `none`
- `NA`: `user_approval`
- `dependencies`: [`DOC-003-001`]
- `owner`: 用户
- `executor`: Codex 协作实现者
- `reviewer`: 独立文档复核者
- `status_at_start`: `未开始`

## 2. 用户授权依据

当前会话中，用户在确认本项目“主要是设计一个给智能体使用的 Skill”后，明确表示：

> 是的，现在你已经有了一份非常完善的总功能开发计划0.3.md。现在你基于计划去逐步去开发功能。

这同时构成：

1. 对 DOC-0.3 的明确批准；
2. 对依赖该批准的开发任务按计划启动的授权；
3. 对交付形态的绑定解释：智能体 Skill 是面向使用者和智能体的主交付物，B/C 插件、存储和领域服务不是脱离 Skill 的独立应用，而是候选执行后端。

该解释不改变既有 71 条需求、144 个案例或 A/B/C 路线比较，只澄清各路线都必须保留可被智能体加载和执行的 Skill 层。

## 3. 交付物

1. `docs/work-items/DOC-003-002-approval.md`：保存批准原文、范围和边界；
2. `START-HERE.md`：把 DOC-0.3 设为首要入口，并明确 Skill-first 交付形态；
3. `总功能开发计划0.3.md`：
   - 顶部状态改为已批准并生效；
   - 在产品/路线关系中明确 Skill-first，插件和存储是支持后端；
   - 在既有 `DEC-018` 中固化该澄清，不新增平行状态体系；
   - `DOC-003-002` 只在证据完成后改为`已完成`并引用新鲜 EV；
   - `CHG-20260809-001` 在批准证据完成后改为`已验证`；
   - 派生控制台与唯一任务台账一致；
4. 附录 A 增加第45轮稳定来源行，现行会话覆盖视图统一为45/45；
5. `docs/evidence/raw/validate-skill-first-foundations.ps1`：PowerShell 5.1 兼容、ASCII、只读的三路线 Skill 静态校验器；
6. 新鲜 `EV-*` 由主协调者在独立复核后统一登记，本候选不预创建 EV。

## 4. 验证命令

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\docs\evidence\raw\validate-plan-0.3.ps1
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\docs\evidence\raw\validate-skill-first-foundations.ps1
```

```powershell
rg -n "智能体.*Skill|Skill.*智能体|DOC-003-002|CHG-20260809-001|当前WIP|下一安全动作" E:\codx\skill\饮食管家\总功能开发计划0.3.md E:\codx\skill\饮食管家\START-HERE.md E:\codx\skill\饮食管家\docs\work-items\DOC-003-002-approval.md
```

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath E:\codx\skill\饮食管家\总功能开发计划0.3.md,E:\codx\skill\饮食管家\START-HERE.md,E:\codx\skill\饮食管家\docs\work-items\DOC-003-002-approval.md
```

必须在同一验证包装中执行项目根业务文件与 sidecar 的前后 manifest；扩展名集合引用计划 §21.12，新增、修改、删除必须全部为 0。

## 5. 验收 Oracle

- 批准记录逐字保留用户批准语句，不扩大为“产品已经完成”或“现在可安装”；
- DOC-0.3 成为唯一计划入口，旧 0.1/0.2 仅为历史输入；
- 计划明确最终用户/智能体接触的是 Skill；A 为纯 Skill 路线，B/C 为 Skill 加确定性插件后端路线；
- 不把插件工具本身描述为独立产品，也不提前选择 A/B/C；
- 现有 71 REQ、144 CASE、58 TASK、26 DEC 和发布选择器保持自洽；
- `DOC-003-002` 的完成只由用户批准与新鲜 E-DOC 证据支撑；
- PRODUCT-0.1/0.2 仍标记为未开发完成、不可安装；
- 正式业务类与 sidecar 文件前后新增/修改/删除均为 0；
- 独立复核确认批准边界、Skill-first 语义和台账状态一致。
- 附录 A 精确包含45/45轮，第45轮稳定标识为`20260809-DOC-003-002-user-approval`并指向批准原话；
- 静态 Skill 校验器确认三路线均有合法 Skill/metadata，A 为纯 Skill，B/C 的 Skill 与唯一插件工具一一对应，输出文件 SHA-256、3/3计数、失败数与 verdict；全程不调用 Node/npm、不写业务文件。

## 6. 治理、根与边界

- `required_evidence_types`: [`E-DOC`]
- `actual_evidence_ids_at_start`: `[]`
- `risk_ids`: [`RISK-001`, `RISK-015`]
- `decision_ids`: [`DEC-002`, `DEC-018`, `DEC-026`]
- `change_ids`: [`CHG-20260809-001`]
- `official_data_roots`: 产品正式根尚未建立；整个项目根只读扫描，不写业务数据。
- `isolated_test_roots`: `C:\Users\10481\AppData\Local\Temp\diet-manager-doc\DOC-003-002\0afb6ca030734865a6cbe3b57ac6d4e7`
- `validation_root`: 同上唯一临时根；验证结束后清理。
- `evidence_root`: `E:\codx\skill\饮食管家\docs\evidence`
- `blocker`: 无；用户已在当前会话明确批准。
- `next_action`: 完成候选静态校验后交主协调者进行独立复核，并由主协调者登记同一新鲜 E-DOC；本候选不创建 EV。
- `reopen_condition`: 用户撤回批准、改变 Skill-first 交付边界，或计划需求/决定/任务结构发生变化。

## 7. 明确禁止

- 不得声称任何饮食业务功能已实现；
- 不得创建、迁移或修改 JSONL/SQLite 正式业务数据；
- 不得借批准证据关闭 `SH-SAFE-BASE-001` 或任一 PRODUCT 任务；
- 不得新增独立 App 作为主交付形态；
- 不得在没有新鲜验证和独立复核前提前把任务标为已完成。
