# Contributing to 饮食管家 B

感谢参与。当前仓库仍为私有开发仓库，未来计划开源，但尚未选择许可证；在许可证确认前，外部使用和再分发不获得开源授权。

## GitHub 工作流

1. 从最新 `main` 创建短生命周期 feature branch，例如 `feature/case-ops-oracle` 或 `fix/handoff-node-floor`。
2. 每个分支只解决一个有明确验收条件的问题。
3. 先写失败测试，再写最小实现，最后运行相关完整验证。
4. 推送分支并创建 pull request；不得直接把未验证代码推入 `main`。
5. pull request 必须说明范围、非目标、验证命令、数据影响和回退方式。
6. 审查意见修复后重新运行受影响验证；不要通过删除断言或放宽失败条件取得绿色结果。

## 数据和安全规则

- 不得提交真实饮食数据、库存、健康信息、原始聊天、SQLite/DB/JSONL、导出、备份或用户配置。
- 不得提交 GitHub/OpenClaw 令牌、API key、cookie、`.env`、私钥或带凭据的 URL。
- 不得提交 `node_modules`、临时日志、raw evidence 或本地测试根。
- 五个受保护租约文件保持本地排除，不读取、不修改、不跟踪、不执行。
- A/C 是停止路线，不得恢复为并行产品实现。
- 失败技术日志不得被解释为饮食记录成功。

## 必要验证

在 `version-b-lite-plugin` 下至少运行：

```powershell
pnpm install --frozen-lockfile
pnpm handoff:validate
pnpm test
pnpm build
pnpm plugin:validate
```

改动共享契约、案例、安全门或发布设施时，还必须运行对应 work-item brief 指定的验证。

## 提交和 PR

- 提交信息使用简短动词前缀，例如 `feat:`、`fix:`、`test:`、`docs:`、`chore:`。
- 不要把无关格式化、生成物和功能修改混在一个提交中。
- PR 标题描述用户可观察的结果，不写“misc changes”。
- 合并前保证 `git diff --check` 通过、工作区无意外文件、PR checklist 完整。

安全漏洞不要在普通 issue 或公开讨论中披露，按 [SECURITY.md](./SECURITY.md) 处理。
