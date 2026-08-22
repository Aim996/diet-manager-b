# 饮食管家 0.2.1 迭代记录 02：私人 Agent 主体默认

- 日期：2026-08-20（Asia/Shanghai）
- 范围：P0 自然语言路由的第二组切片，仅处理本人主体、饮水词和显式本人确认
- 工作区：`0.2.1/version-b-lite-plugin`
- 产品语义：典型饮食表达未明确提到他人时默认当前用户；明确提到孩子、同事、家人或第三人称时保持零写入；真正歧义继续澄清

## 本轮完成

1. 省略主语的 `刚才`、`这会儿` 纳入当前用户的有界摄入框架：
   - `刚才吃了一个苹果。`
   - `这会儿吃了一个苹果。`
   - `这会儿喝了600毫升矿泉水。`
2. 显式本人确认支持 `我这会儿`、`是我自己`、`是我本人` 等受限形式。
3. 饮水词补入 `矿泉水`，仍通过既有白水记录路径落库。
4. 支持 `是我自己喝的，250毫升牛奶。` 这种逗号后的受限数量加已知食物续接；没有把任意逗号文本开放为食物。
5. 明确他人继续拒绝：孩子、同事、家人和 `她` 均不归到当前用户。
6. application + SQLite 验证：省略主语矿泉水和显式本人牛奶都实际写入一条事件；同事表达返回 `non_self_subject`，运行目录保持空。

## 根因

这不是模型把“刚才”理解成了同事，而是确定性解析器的安全白名单过窄：

1. subject 的省略主语前缀只收录 `刚刚`、`刚`，漏掉 `刚才`、`这会儿`。
2. water 的白水词只收录 `水`、`白水`，漏掉 `矿泉水`。
3. meal 只从谓词对象内部提取食物，没有处理显式本人确认后由逗号引出的受限食物对象。

因此旧实现把这些正常私人表达落入“非本人或无法确认”的保守分支。

## TDD 证据

### RED

修改生产代码前，主体用例中 6 个本人正例失败，4 个明确他人反例通过。这个结果同时证明缺口在“本人表达覆盖”，而不是他人隔离规则失效。

### GREEN：目标切片

```powershell
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/typescript/bin/tsc -p tsconfig.json
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run tests/acceptance/core-completion-subject.test.ts tests/acceptance/core-parser.test.ts tests/acceptance/core-water.test.ts tests/acceptance/subject-default-application.test.ts --maxWorkers=1 --minWorkers=1
```

结果：

- TypeScript build：PASS，退出码 0。
- 4 个测试文件、282 项测试全部通过。
- 自然语言主体子集：10 项全部通过，其中 6 个本人正例和 4 个明确他人反例。

### GREEN：portable 候选集

继续排除 Windows 专用文件和用于保留后续迭代红灯的自然语言总文件，结果为 57 个测试文件、1080 项测试全部通过，退出码 0。

## 有意保留的红灯

完整运行 `natural-language-regressions-0.2.1.test.ts`：22 项中 19 项通过、3 项失败。剩余失败严格限定为下一轮：

- natural undo：2 项；
- purchase/inventory：1 项。

本轮没有为了全绿而放宽撤销或库存动作，也没有把明确他人的摄入写入当前用户。

## 下一轮

1. correction/undo：只在同一权威 conversation 存在唯一 active 候选时支持 `取消/去掉`，否则澄清或拒绝。
2. purchase：支持 `带回来 + 明确商品数量 + 放进库存`，保持批次和数量证据可审计。
3. 随后处理真实验收 setup 假绿和回复、工具、数据库一致性。
