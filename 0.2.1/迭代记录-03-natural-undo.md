# 饮食管家 0.2.1 迭代记录 03：口语化安全撤销

- 日期：2026-08-20（Asia/Shanghai）
- 范围：P0 自然语言路由的第三组切片，仅处理两条真实口语撤销表达
- 工作区：`0.2.1/version-b-lite-plugin`
- 安全语义：口语撤销只允许命中同一会话中唯一的 active 餐食；跨会话记录不参与；同会话多条 active 记录时必须澄清并零写入

## 本轮完成

1. 新增两种受限口语撤销：
   - `刚才鸡蛋那条先取消。`
   - `前面鸡蛋那次算错了，帮我去掉。`
2. 新增独立目标 `sole_active_meal_in_conversation`，没有改变既有显式 `撤销刚才那条饮食记录` 的兼容语义。
3. repository 会读取同一会话内餐食的有效状态，只在 active 候选恰好一条时返回目标。
4. 同会话存在两条 active 餐食时，application 返回 `target_ambiguous` 澄清，`correction_events` 保持零行。
5. 另一个会话即使存在更新的 active 餐食，也不会影响当前会话的唯一目标。

## 根因

1. correction parser 只处理以 `撤销` 开头的固定句式，所以两条真实口语表达直接落入 ignored。
2. 既有 `latest_meal_in_conversation` 目标只按时间选择最新记录，无法表达产品要求的“仅有唯一有效记录才撤销”。
3. 因此修复不能只扩一个正则；必须给口语表达独立的安全目标，并在数据库权威状态上做唯一性判断。

## TDD 证据

### RED

生产代码修改前运行口语撤销 parser、application 和自然语言用例：3 个测试文件中 6 项失败。parser 和自然语言用例均得到 ignored；application 得到 `ACTION_CONFLICT`。失败原因与缺失的解析分支一致，不是测试加载或环境错误。

### GREEN：目标切片

```powershell
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/typescript/bin/tsc -p tsconfig.json
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run tests/acceptance/core-correction-parser.test.ts tests/acceptance/natural-undo-application.test.ts tests/acceptance/natural-language-regressions-0.2.1.test.ts -t undo --maxWorkers=1 --minWorkers=1
```

结果：TypeScript build 退出码 0；3 个测试文件的 8 项目标测试通过，33 项非目标测试跳过。

扩大到 correction target、完整 correction parser、完整 core application 和真实 application 安全用例：4 个测试文件、82 项全部通过。

### GREEN：portable 候选集

继续排除 Windows 专用文件和用于保留后续红灯的自然语言总文件：58 个测试文件、1084 项全部通过，退出码 0。

## 有意保留的红灯

完整运行 `natural-language-regressions-0.2.1.test.ts`：22 项中 21 项通过、1 项失败。唯一剩余失败是：

- `今天带回来一盒鸡蛋，先放进库存。`

本轮没有混入 purchase/inventory 解析修改。

## 下一轮

1. 支持 `带回来 + 明确商品数量 + 放进库存` 的自然入库表达。
2. 通过真实 application 和数据库验证商品、数量、批次与库存投影。
3. 所有自然语言红灯清零后，再做隔离 Agent 的端到端冒烟测试。
