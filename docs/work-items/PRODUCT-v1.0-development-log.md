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
