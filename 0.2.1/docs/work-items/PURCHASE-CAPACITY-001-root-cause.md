# PURCHASE-CAPACITY-001 根因记录

## 症状与精确复现

公开运行时收到 `add_inventory` 请求（完整元数据）且原文为
`买了2盒牛奶，每盒250ml` 时，返回
`DIET_DOMAIN_REQUEST_INVALID`，没有提交库存批次。相邻原文
`买了1盒鸡蛋，每盒12个` 可以提交。

## 组件边界证据

解析器正确产出包装证据：`total_capacity: 500`、`capacity_unit: "ml"`、
`total_inner: null`。映射层 `purchaseAmount()` 只处理了已知 `total_inner`
和已开封瓶装；因此向领域层传递了 `unit: "unknown"`、数量 `null`。
领域层正确拒绝这一矛盾：库存证据已断言非空容量，但入库金额未知。

## 根因与修复

根因是 `src/application/mapping.ts::purchaseAmount()` 缺少单层容量分支，不是
解析器、领域验证或语法问题。修复在保持 `total_inner` 优先级和已开封瓶装行为不变的
前提下，针对非空 `total_capacity` 与 `capacity_unit` 映射显式数量：容量总量乘以
`1_000_000` microunit，并保留容量单位。

## 覆盖缺口

原有 Task 7 测试只验证单层容量购买能被解析；没有通过
`handleCoreRequest` 验证提交边界，也没有经公开 `query_inventory` 读取已提交批次。
新的真实 SQLite 接受测试覆盖该路径，并独立断言一个活动 milk 批次为
`quantity_microunits: 500000000`、`unit: "ml"`。

## RED → GREEN

RED：

```powershell
& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/purchase-capacity.test.ts --maxWorkers=1 --minWorkers=1
```

结果：1 个测试失败；写入结果为 `committed: false`、
`error_code: "DIET_DOMAIN_REQUEST_INVALID"`，符合缺失容量映射分支的预期。

GREEN 使用同一命令；结果：1 个测试通过，写入已提交，公开库存读取返回单个活动
milk 批次，数量 `500000000` microunits，单位 `ml`。

## 范围

未修改解析器、领域验证或语法；未增加依赖、未生成 `dist`/tgz、未触及
`releases/v0.1`。相邻回归、TypeScript、差异检查和发布树检查记录在任务报告中。
