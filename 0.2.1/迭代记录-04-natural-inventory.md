# 饮食管家 0.2.1 迭代记录 04：带回家并放入库存

- 日期：2026-08-20（Asia/Shanghai）
- 范围：P0 自然语言路由的第四组切片，仅处理一条真实自然入库表达及其数量安全边界
- 工作区：`0.2.1/version-b-lite-plugin`
- 产品语义：`带回来 + 明确外包装数量 + 放进库存` 可入库；只保存明确证据，不从“一盒”虚构盒内鸡蛋数量

## 本轮完成

1. 新增受限自然入库表达：
   - `今天带回来一盒鸡蛋，先放进库存。`
2. 复用既有 purchase item 解析和 application 映射，没有建立第二套库存写入路径。
3. parser 产出 egg 商品和一盒 carton 外包装证据。
4. application 实际提交一条 inventory stock、一个 egg 商品和一个批次。
5. 由于没有说明盒内鸡蛋数，批次数量状态保持 `unknown`、数量保持 null；外包装的一盒证据保存在 pantry evidence 中。
6. `今天带回来鸡蛋，先放进库存。` 因缺少数量返回 `amount_ambiguous` 澄清，不写入库存。

## 根因

既有 purchase parser 的入口只接受 `买了` 前缀。真实表达虽然具有完整的入库意图和外包装数量，但没有进入 purchase parser，随后被餐食解析保守忽略。数据库和库存提交链路本身没有缺陷。

## TDD 证据

### RED

生产代码修改前运行 parser、自然语言总表和真实 application 用例：3 个测试文件中 4 项失败。明确数量和缺少数量的 parser 用例均未进入 add_inventory；application 因 action conflict 失败。

### GREEN：目标切片

首次 GREEN 中 parser 和自然语言用例通过，application 已真实提交；唯一失败来自测试错误地把未知盒内数量预期为 `committed_with_issues`。核对既有库存契约后，将断言修正为 `committed`，并继续直接验证数据库中的 `quantity_status=unknown` 与 null 数量，没有修改生产提交语义。

```powershell
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/typescript/bin/tsc -p tsconfig.json
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run tests/acceptance/core-parser.test.ts tests/acceptance/pantry-application.test.ts tests/acceptance/natural-inventory-application.test.ts tests/acceptance/natural-language-regressions-0.2.1.test.ts --maxWorkers=1 --minWorkers=1
```

结果：TypeScript build 退出码 0；4 个测试文件、272 项全部通过。

### GREEN：portable 候选集

继续排除 Windows 专用文件和自然语言总文件：59 个测试文件、1087 项全部通过，退出码 0。

### 自然语言总表

`natural-language-regressions-0.2.1.test.ts` 的 22 项现在全部通过，先前保留的 profile/goal、subject、undo 和 inventory 红灯已经清零。

## 下一步

1. 把 0.2.1 安装到隔离 Agent 测试实例。
2. 用真实对话验证默认本人、明确他人零写入、口语撤销的唯一候选保护和自然入库。
3. 核对回复内容、工具结果与数据库记录一致后，再决定正式上线。
