# 饮食管家 0.2.1 迭代记录 01：档案与目标自然语言

- 日期：2026-08-20（Asia/Shanghai）
- 范围：P0 自然语言路由的第一组切片，仅处理 profile 与 goal
- 工作区：`0.2.1/version-b-lite-plugin`、`0.2.1/shared`、`0.2.1/docs`
- 基线：从根级主线建立独立副本；根级源码、shared 和既有用户改动未被修改

## 本轮完成

1. 建立 0.2.1 独立源码、测试、shared 与测试所需 docs 契约副本。
2. profile parser 新增有界表达：
   - `想开始减脂了，我28岁女生，175高，65公斤。`
   - `我的身高是175，体重差不多65公斤。`
   - `175高。`、`65公斤。` 保持在 profile 澄清分支。
   - `吃了175克米饭和65克鸡蛋。` 仍是 `record_meal`。
3. goal parser 新增有界表达：
   - `以后每天热量按1900大卡算就行。`
   - `每天喝水先按1200毫升算。`
   - `蛋白质这一栏暂时不用给我定。`
   - 同一维度同时清除和设置时返回 `goal_incomplete`，不静默选择其中一项。
4. application + SQLite 验证：真实档案、热量设置和蛋白质清除均 `committed=true`，生成正确的 `user_profiles` 与连续 `goal_versions`，没有 `ACTION_CONFLICT`。

## TDD 证据

### RED

修改生产代码前运行：

```powershell
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run tests/acceptance/natural-language-regressions-0.2.1.test.ts tests/acceptance/core-profile-parser.test.ts tests/acceptance/core-goal-parser.test.ts
```

结果：16 项原有断言通过，23 项失败；本轮新增的 profile/goal 用例均因专用 parser 未识别、回退或同维度清除/设置未 fail-closed 而失败。测试文件可加载，没有编译或测试语法错误。

### GREEN：目标切片

```powershell
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/typescript/bin/tsc -p tsconfig.json
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run tests/acceptance/core-profile-parser.test.ts tests/acceptance/core-goal-parser.test.ts tests/acceptance/set-profile-application.test.ts tests/acceptance/set-goal-application.test.ts
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run tests/acceptance/natural-language-regressions-0.2.1.test.ts -t "profile|goal"
```

结果：

- TypeScript build：PASS，退出码 0。
- parser/application：4 个测试文件、26 项测试全部通过。
- 真实原话 profile/goal 子集：9 项通过，9 项按迭代边界跳过。

### GREEN：portable 候选集

排除尚未分组的 Windows 专用文件，以及作为后续迭代红灯保留的自然语言总草稿：

```powershell
$files = rg --files tests -g '*.test.ts' | Where-Object {
  $_ -notmatch 'natural-language-regressions-0\.2\.1|install-lifecycle|release-scripts|pantry-catalog|openclaw-core'
}
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run $files
```

结果：56 个测试文件、1077 项测试全部通过，退出码 0。

首次 portable 运行曾出现 1 项 `nutrition-contract` 失败，严格原因是独立副本缺少 `0.2.1/docs/work-items/SEL-NUTR-001-brief.md`；补入测试依赖的 docs 契约后，该项单测及完整候选集均重新通过。该失败不是业务回归。

## 有意保留的红灯

完整运行 `natural-language-regressions-0.2.1.test.ts` 的结果为 11 项通过、7 项失败。失败范围与下一轮完全一致：

- subject/water ingestion：4 项；
- correction/undo：2 项；
- purchase/inventory：1 项。

本轮没有为追求全绿而修改这些动作，也没有删除 `ACTION_CONFLICT` 守卫。

## 环境说明

`pnpm install --frozen-lockfile` 已把 341 个锁定依赖从本机受信 store 链接到 0.2.1，但 pnpm 的供应链策略因忽略第三方构建脚本返回退出码 1。TypeScript、Vitest 和 SQLite application 测试均能正常运行；本轮使用 Codex 工作区提供的 Node 24 可执行文件直接运行本地 `tsc` 与 `vitest`，没有放宽全局构建脚本策略。

## 提交

- `7b95ac9` `chore: establish 0.2.1 isolated baseline`
- `b1aa9a3` `test: characterize 0.2.1 profile and goal language gaps`
- `ee81902` `fix: parse bounded natural profile phrases`
- `1208662` `fix: parse bounded natural goal phrases`
- `889d171` `test: verify natural profile and goal database writes`

## 下一轮

1. subject/predicate-frame：`刚才`、`这会儿`、`我这会儿`、`是我自己喝的`，同时保持孩子、同事和家人反例零写入。
2. correction：只在同一权威 conversation 唯一 active 候选下支持 `取消/去掉`。
3. purchase：支持 `带回来 + 明确商品数量 + 放进库存`。
4. 随后处理真实验收 setup 假绿和回复/工具/数据库一致性。
