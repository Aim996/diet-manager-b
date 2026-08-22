# SEL-CORE-001 核心输入与白水事实设计

## 1. 目标与批准依据

本设计落实《总功能开发计划0.4》中的`SEL-CORE-001`：让B路线能够可靠处理当前用户本人的多项饮食、白水、时间、否定、计划、转折和短期上下文，并把明确发生的事实交给既有SQLite事务底座。

用户已经授权按0.4持续开发并在遇到问题时自主选择方案。本设计采用推荐方案：先冻结缺失的机器Oracle，再增加确定性中文规范化层、最小白水事务切片和OpenClaw运行时适配器。它不提前实现库存、营养来源、完整进度、Issue快捷项、安装或远程验收。

## 2. 当前事实

- X-GATE-002已以`bind_b_ready`关闭，只授权`SEL-CORE-001`。
- 计划任务精确绑定21个案例，但`shared/acceptance-cases/cases.json`当前只有其中4个完整机器Oracle；另外17个只有计划表摘要。
- `createDietDomainService()`已有服务端preview、幂等、FactCommit/EffectBundle/EnvelopeFinalize和SQLite恢复能力，但只接受预先规范化的结构化操作。
- OpenClaw公开工具仍返回`foundation_not_implemented`。
- `record_water`只存在于公开action枚举，领域操作和事实提交链尚无WaterEvent。
- 当前饮食操作只有单点`occurred_at`，不足以表达时间区间、精度、解析依据和默认接收时间来源。

## 3. 方案比较

### 方案A：确定性核心层 + 最小白水事务（采用）

先把16个摘要案例提升为唯一案例目录中的完整Oracle；再以纯函数解析/校验中文输入，输出明确的`candidate`、`ignored`或`needs_clarification`；最后通过应用层调用现有服务，并为白水增加最小事实与一次性水分贡献。

优点是可机械证明“不把孩子、计划或否定当本人事实”，保留原话和时间依据，同时复用现有事务底座。代价是比只接线多一个解析层和WaterEvent切片。

### 方案B：完全信任模型传入结构化参数（拒绝）

只扩展OpenClaw参数并把模型给出的items直接送入服务。开发较快，但无法在后端稳定拒绝“孩子吃了”“明天准备吃”“最后没吃”，也无法证明21案。

### 方案C：一次性实现完整PRODUCT-0.1（拒绝）

同时完成库存、营养、进度、Issue、安装和来源能力。它破坏任务依赖和唯一WIP规则，审查面过大，也会把尚未冻结的后继规则塞进核心层。

## 4. 权威案例

`shared/acceptance-cases/cases.json`继续是唯一业务案例源，版本从`1.4.0`升级到`1.5.0`。不得创建第二套SEL期望文件。

现有4案保持兼容：`CASE-MEAL-001`、`CASE-MEAL-021`、`CASE-WATER-001`、`CASE-RECEIPT-002`。补齐以下17案：

- 时间/锚点：`CASE-MEAL-002`、`012`、`013`、`014`、`CASE-PURCHASE-004`；
- 否定/转折/计划：`CASE-MEAL-009`、`010`、`015`、`016`；
- 本人边界：`CASE-MEAL-011`、`017`、`018`、`019`；
- 上下文：`CASE-MEAL-020`；
- 液体分类：`CASE-WATER-003`、`004`；
- 范围拒绝：`CASE-SCOPE-001`。

实施计划必须精确冻结这21个ID及顺序，并让追踪校验器拒绝删除、增加、重排或替换；不能通过删案凑数。每个新增案例必须有固定`source_text`、时钟/时区、必要prior context、结构化解析Oracle、命令Oracle、业务写入Oracle和`forbidden[]`。

## 5. 组件边界

### 5.1 `src/parser/`

纯函数、无数据库、无环境变量、可注入时钟：

- `types.ts`：`CoreParseInput`、`OccurredTimeEvidence`、`CoreMealItem`、`CoreCommandCandidate`和非写入结果。
- `completion.ts`：先判已发生、计划、明确否定、发生前取消和转折后的最终事实。
- `subject.ts`：省略主语默认本人；明确他人零写；共同进食只保留本人可确定部分，未知不填0。
- `time.ts`：输出`raw_text/resolved_start/resolved_end/precision/timezone/resolution_basis/resolution_anchor/resolver_version`；歧义返回`needs_clarification`，未说时间显式标`default_received_at`。
- `liquid.ts`：只有白水进入WaterEvent；牛奶、汤、豆浆、咖啡和茶是meal item。
- `context.ts`：只消费调用方提供且通过revision、会话和有效期校验的短期上下文；过期上下文不沿用；不建立长期聊天状态表。
- `parse-command.ts`：按完成状态→本人→时间→液体/食物→上下文的固定顺序组合结果。

解析器只覆盖冻结案例所需语法和明确的扩展接口，不宣称通用中文NLP。无法安全确定的字段保持`unknown`或请求最少澄清。

### 5.2 `src/application/`

- `command-handler.ts`把解析候选转换为版本化领域操作和`DomainEnvelopeInput`，生成稳定operation/envelope身份，调用preview/execute，并把冻结终态映射为公开结果。
- `runtime.ts`按`official_data_root`延迟打开数据库，创建或读取私有HMAC secret，复用连接并提供幂等关闭；模型参数不能指定数据根或secret。
- `outcome.ts`只在真实终态`committed=true`时返回“已记录”；`ignored/needs_clarification/failed`无`record_id`。

现有结构化`createDietDomainService`API保持可用，文本解析不得塞入`service.ts`。

### 5.3 饮食兼容扩展

`RecordMealOperation`增加可选、版本化的发生时间证据、原话、主体和上下文元数据。旧调用方未提供新字段时保持现有摘要、幂等和测试行为；新应用入口必须提供完整元数据。事实payload保存这些证据，单项仍使用有序`items[]`和稳定`meal_id`。

### 5.4 WaterEvent最小切片

新增`RecordWaterOperation`，只接受明确白水容量和时间证据。它在现有`event_records`中写`event_type=diet_water`、`meal_id=null`、`meal_slot=null`，payload保存容量、原话、OccurredTime和证据版本；不新增独立水表或本轮迁移。

WaterEvent使用同一preview、FactCommit、outbox、EffectBundle、EnvelopeFinalize和幂等边界。水分只贡献一次；明确500ml不得标估算。完整目标显示和跨来源水覆盖留给`SEL-PROGRESS-001`，但本轮必须保证查询可区分WaterEvent与meal中的营养饮品。

### 5.5 OpenClaw入口

`src/index.ts`保留工具名`diet_manager`和8个action。执行器接收插件解析后的只读配置，延迟取得应用runtime；`official_data_root`只来自插件配置。公开参数向后兼容，新增的时间、上下文和证据字段均为可选且严格拒绝额外属性。

工具描述从“non-writing foundation”改为真实的饮食管家边界，但只有核心任务已实现的action可提交；后继action若尚未完成必须返回稳定`failed/not_implemented`，不得伪成功。

## 6. 数据流

```text
OpenClaw tool params + frozen config
  -> exact input validation
  -> deterministic core parser
     -> ignored / needs_clarification (zero business writes)
     -> command candidate
  -> application envelope builder
  -> service.preview (server authority + data revision)
  -> service.execute (FactCommit -> EffectBundle -> EnvelopeFinalize)
  -> frozen public outcome
```

解析失败、范围拒绝、他人事实、计划和明确未发生必须在打开写事务前结束。技术日志可以保存脱敏阶段/错误码，但业务表、outbox、投影和成功结果必须零变化。

## 7. 错误与安全

- 描述符、prototype、getter、symbol和非普通数组在进入解析前失败关闭。
- 时间只接受`Asia/Shanghai`和可注入ISO时钟；日期歧义不猜。
- unknown不转0；共同份量不把总量全记本人。
- 原话只进入正式事实payload，不进入普通日志。
- secret采用私有文件的原子no-replace创建，拒绝reparse和宽权限；不得进入参数、回执或Git。
- 数据库打开、解析或提交失败均返回稳定错误码；只有SQLite提交和终态冻结成功才`committed=true`。
- 同token合法重试返回同一冻结结果；同键不同输入零写并返回`idempotency_conflict`。

## 8. 测试与证据

测试分六批：

1. Catalog：精确ID/顺序/REQ/fixture/Oracle/forbidden和删除、重排、篡改变异。
2. 基础事实：多项餐、单项schema、500ml白水。
3. 完成状态：否定作用域、转折、计划和最终未发生。
4. 本人边界：他人、省略主语、共同明确份量、共同未知份量。
5. 时间/证据：库存锚点、跨日、日期澄清、默认接收时间、字段证据标签。
6. 上下文/液体/范围：过期上下文、scene unknown、营养饮品不写WaterEvent、拒绝医疗/减重层。

每案同时断言解析结果、领域命令、SQLite写入或全业务表零差异、forbidden副作用、原话和规则版本。写入案例还必须覆盖响应丢失重试；零写案例必须用全表规范快照证明没有半条业务记录。

完成前运行focused、全插件测试、TypeScript noEmit、唯一正式build、source/dist parity、并发/崩溃、OpenClaw隔离build/validate、共享acceptance、trace和X-GATE回归。正式数据根和远程OpenClaw不在本任务测试范围。

## 9. 非目标和后继

- 库存匹配与保质：`SEL-PANTRY-001`。
- 营养来源、Profile与Doctor：`SEL-NUTR-001`。
- 完整进度与目标：`SEL-PROGRESS-001`。
- Issue快捷项：`SEL-ISSUE-001`。
- 安装、迁移、备份与远程OpenClaw验收：对应后续任务。

本任务完成只证明核心输入和事实切片可用，不得提前宣称PRODUCT-0.1整体可用。
