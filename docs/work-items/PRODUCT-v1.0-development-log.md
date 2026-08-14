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
