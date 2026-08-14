# 饮食管家 v1.0 开发记录

本记录用于按批次保存开发依据、实际改动、代表性测试和未验证项。开发阶段只运行最小测试；0.1.0 五步闭环完成后统一运行完整测试。

## Batch V1-A：默认营养安全收敛

- 日期：2026-08-14
- 权威：仓库根目录 `饮食管家-开发约束与需求-v1.0.md`
- 权威文件 SHA-256：`B1EC9E1CD8F4D6AE48AA572919CE9582433EE3F3129EAAA2F1A59E5BE9110B16`
- 目标：没有明确配置的可信营养来源时，保存餐食事实，但营养值必须为 `unknown/null`。

### 生产改动

- 默认 `NutritionRuntimeConfig.sources` 从内置常见菜模板和通用估算改为空列表。
- 默认 `CoreRuntime` 不再自动注入内置营养适配器。
- 内置适配器代码暂时保留为冻结兼容代码；生产默认路径不可达，本批不删除。
- 显式传入的营养配置和适配器接口未改；其 v1.0 白名单约束在 Batch V1-B 实施。

### TDD 记录

RED：

- 命令：`vitest run tests/acceptance/nutrition-application.test.ts -t "stores unknown nutrition" --maxWorkers=1 --minWorkers=1`
- 结果：1 failed；旧实现返回 `250 ml`、`field_inference`、`partial`，证明默认通用估算仍在生效。

GREEN：

- 同一命令：1 passed，4 skipped。
- `tsc -p tsconfig.json --noEmit`：exit 0。
- `git diff --check`：exit 0。

### 本批未声明

- 未运行完整 Vitest；按开发约束留到 0.1.0 统一门禁。
- 未执行 build、dist emit、网络请求、安装或远端操作。
- 尚未连接真实营养数据库；因此生产默认行为是安全的 `unknown`，不是“营养查询已完成”。

### 下一步

Batch V1-B：在营养 evidence 进入 FactCommit 前实施 v1.0 来源白名单，拒绝通用估算、常见菜模板和其他未授权数值来源。

## Batch V1-B：营养来源白名单

- 日期：2026-08-14
- 目标：任何数值 evidence 在进入应用映射和 FactCommit 前，必须先通过 v1.0 来源白名单。

### 生产改动

- 新增 `assertV1NutritionSource(sourceId, sourceType)`，以稳定错误 `NUTRITION_SOURCE_NOT_ALLOWED:<source_id>` 拒绝越权来源。
- 配置加载时即拒绝未授权 source ID；运行适配器前再次检查 capability，适配器返回后再检查 evidence 类型与 source ID 的固定映射。
- 当前允许映射：
  - `public.usda_fooddata_central` / `public.china_cdc_phscience_food_composition` → 权威公共数据库；
  - `local.personal_template` → 用户自建库接口；
  - `local.current_exact_label` → 已确认的当前包装标签接口；
  - `terminal.unknown` → 无数值终端降级。
- 制造商查询、历史复用、普通网页、常见菜模板和通用估算均不在 0.1.0 白名单内。

### TDD 记录

RED：

- 命令：`vitest run tests/acceptance/nutrition-source.test.ts -t "rejects a generic numeric source" --maxWorkers=1 --minWorkers=1`
- 结果：1 failed；旧实现接受 `local.generic_estimate` 并返回完整数值 evidence。

GREEN：

- 完整 `nutrition-source.test.ts`：4 passed。
- 拒绝测试同时断言适配器调用次数为 0，证明拒绝发生在来源调用和 FactCommit 之前。
- `tsc -p tsconfig.json --noEmit`：exit 0。
- `git diff --check`：exit 0。

### 本批未声明

- 尚未实现 USDA/CFCT 的真实网络适配器与凭据接线；允许的是接口身份，不代表数据源已经可用。
- 未运行完整 Vitest；统一门禁仍留在 Batch V1-F。

### 下一步

Batch V1-C：核实现有餐食事实与库存扣减事务边界，并用一个技术故障测试证明“唯一库存扣减失败时，餐食事实和扣减一起回滚”。

## Batch V1-C：餐食事实与唯一库存扣减原子提交

- 日期：2026-08-14
- 目标：满足 I-7；安全且唯一的库存扣减是餐食事实的必要效果，二者必须同事务成功或回滚。

### 生产改动

- FactCommit 新增内部 `beforeCommit` 必要效果钩子；它在事件、餐食项和 outbox 写入后、checkpoint 计算与 SQLite commit 前执行。
- 0.1.0 的普通 `record_meal` 路径在该钩子中只执行已冻结 `inventory_plan` 的库存分配。
- 库存事务支持严格幂等 readback：后续 EffectBundle 读取并核对同一库存流水，不重复扣减。
- 营养快照、问题投影和当日进度仍由后续 EffectBundle 处理，不被升级为 FactCommit 的必要部分。
- 冻结的“购买+餐食”混合路径未改，不计入 0.1.0 声明。

### TDD 记录

RED：

- 命令：`vitest run tests/acceptance/pantry-inventory.test.ts -t "rolls back every staged allocation" --maxWorkers=1 --minWorkers=1`
- 结果：1 failed；库存投影与流水已回滚，但 `event_records` 从 2 增为 3，证明餐食事实曾被单独提交。

GREEN：

- 同一故障测试：1 passed，21 skipped；故障后事件数量、库存投影和扣减流水均保持原样，健康重试只扣一次。
- 歧义业务降级测试：1 passed，21 skipped；两个商品身份时提交餐食事实，库存扣减 0，问题码为 `inventory_multiple_candidates`。
- `tsc -p tsconfig.json --noEmit`：exit 0。
- `git diff --check`：exit 0。

### 本批未声明

- 没有把营养或进度加入必要事务；它们失败时仍允许餐食事实存在。
- 未运行完整 Vitest；统一门禁仍留在 Batch V1-F。

### 下一步

Batch V1-D：从已提交并读回的事实、营养状态与库存效果构建 0.1.0 回执，不在展示层重算业务数据。

## Batch V1-D：公开餐食回执

- 日期：2026-08-14
- 目标：SLICE-4；餐食提交后返回“原话 + 解析结果 + 附加效果状态”。

### 生产改动

- `CommittedOutcome` 新增仅用于 `record_meal` 的可选 `receipt`。
- 回执逐项返回：稳定 item ID、规范名称、解析数量/单位、是否推导、营养覆盖状态/来源标签、库存效果状态。
- 原话从已提交 `event_records.payload_json.source_text` 读取。
- 数量与库存状态从已提交 `envelope_finalizations.payload_json` 的 receipt block 读取。
- 营养状态与来源从已持久化并校验的 Nutrition Profile/Snapshot readback 读取。
- 公开 contract 对回执做 exact-key、枚举、数量配对和 action/status 校验；outcome 对所有嵌套对象递归冻结。

### TDD 记录

RED：

- 命令：`vitest run tests/acceptance/nutrition-application.test.ts -t "stores unknown nutrition" --maxWorkers=1 --minWorkers=1`
- 结果：餐食与 unknown 营养均成功，但公开 outcome 不含 `receipt`。
- Windows 运行说明：该测试依赖私钥 ACL helper，命令需保留系统 Windows PowerShell module path；未设置时会稳定 fail-closed 为 `CORE_RUNTIME_SECRET_INVALID`，不是产品断言结果。

GREEN：

- 同一测试：1 passed，4 skipped。
- 精确场景：原话 `喝了250ml牛奶。`；解析为 `250 ml`、非推导；营养 `unknown`；库存 `skipped_insufficient`。
- `assertDietManagerOutcome(outcome)` 通过，嵌套 nutrition block 已冻结。
- `tsc -p tsconfig.json --noEmit`：exit 0。
- `git diff --check`：exit 0。

### 本批未声明

- 回执只公开餐食 0.1.0 主链；购买、纠正等冻结功能未扩展同一 public receipt。
- 未运行完整 Vitest；统一门禁仍留在 Batch V1-F。

### 下一步

Batch V1-E：将只读 `query_daily_summary` 接到现有事实/效果 read model，返回当日餐食、营养和库存处理进度且保证零写入。

## Batch V1-E：六域只读日进度

- 日期：2026-08-14
- 目标：REQ-PROGRESS-001/002；按上海自然日返回餐次、白水、营养、库存、购买和纠正汇总，查询不写业务数据。

### 生产改动

- `query_daily_summary` 进入 public application read path，不经过写命令 parser/preview/FactCommit。
- 返回沿用五状态 contract：`status: ignored`、`committed: false`、`reason_code: read_only_result`，并附带严格校验的 `daily_progress`；没有伪装成业务提交。
- 六域结构：
  - `meals.count`；
  - `water.count` 与 `plain_water_ml_milli`；
  - `nutrition.coverage_status` 与六项营养向量；
  - `inventory.deduction_count`；
  - `purchases.count`；
  - `corrections.count`。
- 餐食、白水、营养与当前库存先走既有 authenticated read model；事件/流水只做时间窗计数。
- 所有返回对象递归冻结，并由 `assertDietManagerOutcome` 校验 exact shape、非负安全整数和 nullable 营养字段。

### TDD 记录

RED：

- 命令：`vitest run tests/acceptance/core-application.test.ts -t "returns a six-area daily progress view" --maxWorkers=1 --minWorkers=1`
- 结果：1 failed；旧 application 返回 `ACTION_NOT_IMPLEMENTED`。

GREEN：

- 同一测试：1 passed，55 skipped。
- 场景先记录 1 餐，再查询同一上海自然日：餐次 1、其他事实类计数 0、营养为 partial/null。
- 查询前后完整 SQLite 业务快照字符串完全相同。
- `assertDietManagerOutcome(outcome)` 通过，嵌套 nutrient vector 已冻结。
- `tsc -p tsconfig.json --noEmit`：exit 0。
- `git diff --check`：exit 0。

### 本批未声明

- 当前购买/纠正计数来自已存在事实表的只读时间窗；0.1.0 不新增其业务能力。
- `query_meals` 和 `query_inventory` 的 public adapter 仍保持冻结未实现；本批只交付 v1.0 要求的日进度入口。
- 未运行完整 Vitest；下一批统一执行一次。

### 下一步

Batch V1-F：只进行一次统一 focused/full/noEmit/OpenClaw 元数据验证；修复真实回归后生成 0.1.0 报告，不再增加功能。

## Batch V1-F：一次性统一基线与兼容收口

- 日期：2026-08-14
- 策略：按用户要求改为大批量开发；完整套件只运行一次作为基线，后续由用户体验测试驱动修复。

### 唯一完整基线

- 命令：`vitest run --maxWorkers=1 --minWorkers=1`
- 结果：30 files；941 passed、2 failed，共 943 tests，163.97s。
- 两个失败均为旧验收预期：
  - 营养补全夹具仍配置 v1.0 已禁止的 `local.generic_estimate`；
  - 库存故障夹具仍预期餐食事实提交后等待 EffectBundle 才扣减，和 Batch V1-C 的同事务扣减语义冲突。

### 集中兼容修正

- 营养补全夹具改用白名单 `public.usda_fooddata_central` / `authoritative_public_database`；测试 transport 仍为本地 fixture，不访问网络。
- 餐食库存故障场景改为断言 FactCommit 成功后库存已从 24 降至 23；后续同键效果恢复不得再次扣减。
- 定向复验：2 files / 70 tests PASS。
- `tsc -p tsconfig.json --noEmit`：exit 0。

### 说明

- 未重复执行完整套件；上述两个失败的直接覆盖均已通过。
- 0.1.0 主链已经具备代码路径，但默认无已配置权威营养源时仍按 v1.0 返回 `unknown`。
- 真实 FDC 网络 transport 与私有 credential resolver 尚未成为默认插件能力；这仍是“至少接入一个权威库”的部署缺口，不能因 fixture adapter 通过而宣称真实联网完成。

## Batch V1-G：USDA FoodData Central 可部署接线

- 日期：2026-08-14
- 目标：关闭 §9“至少接入一个权威库”的代码与插件接线缺口。

### 生产改动

- 新增固定源 `https://api.nal.usda.gov/fdc/v1/foods/search` 的只读 HTTP transport。
- 请求只发送规范食品名、固定数据类型筛选和分页；API key 仅放入 `X-Api-Key` header。
- 禁止重定向；只接受 JSON；单响应上限 512 KiB；所有外部值只映射到固定营养字段。
- 只采用 Foundation、FNDDS 与 SR Legacy 的每 100g 权威记录；无结果、缺 key、超时或异常均稳定降级为 `unknown`。
- 插件配置只开放 `public.usda_fooddata_central` + `fooddata-central` + `api-v1`；私有引用固定为 `env:FDC_API_KEY`。
- OpenClaw runtime 从服务进程环境读取 key，模型参数、URL、body、公开 outcome、SQLite、日志和 config digest 都不含 key。

### 小门验证

- `nutrition-source.test.ts`：5/5 PASS；fixture 响应映射、固定 URL、header credential、公开字段冻结。
- `openclaw-core.test.ts`：21/21 PASS；真实注册工具经配置 FDC 路径提交餐食并返回 `public_reference`。
- 两文件合计 26/26 PASS。
- `tsc -p tsconfig.json --noEmit`：exit 0。
- `openclaw.plugin.json` JSON parse：PASS。

### 本批未声明

- 测试没有请求真实 USDA 服务，也没有读取用户真实 key；真实联网由部署者/用户验收。
- 没有生成 dist，没有再次运行完整 Vitest。
