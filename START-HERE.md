# 饮食管家 B：从这里开始

B 是唯一产品主线。A/C 只保留在历史计划和决策证据中，不参与当前实现、安装或发布。

## 如果你是第一次接手的智能体

按以下顺序阅读：

1. [README.md](./README.md)：当前能力、硬边界和快速验证。
2. [docs/OPENCLAW-DEVELOPMENT-HANDOFF.md](./docs/OPENCLAW-DEVELOPMENT-HANDOFF.md)：GitHub 拉取、安装、验证、行为冒烟和清理。
3. [docs/开发进度.md](./docs/开发进度.md)：已开发、待开发、发现问题和下一任务。
4. [总功能开发计划0.3.md](./总功能开发计划0.3.md)：唯一完整产品计划和任务台账。

## 当前不可误解的结论

- 当前交付状态是 `foundation_development_only`，不是 PRODUCT-0.1。
- 插件可以构建、验证和安装到专用测试环境，但真实业务 repository 尚未实现。
- 当前写动作必须返回 `foundation_not_implemented`、`committed=false`，不得产生饮食数据。
- GitHub 当前私有；未来计划开源，但许可证仍需项目所有者选择。

## 最短验证命令

```powershell
Set-Location .\version-b-lite-plugin
pnpm install --frozen-lockfile
pnpm handoff:validate
pnpm test
pnpm build
pnpm plugin:validate
```

不要跳过 `pnpm handoff:validate`，也不要把 foundation 安装成功解释成真实饮食记录产品已经完成。
