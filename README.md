# 饮食管家 B

饮食管家 B 是一个以 Skill 为智能体入口、以确定性 B 后端为唯一业务实现的饮食记录项目。OpenClaw、MCP 和其他智能体平台只提供薄适配层，不复制业务状态机。

## 当前状态

| 项目 | 当前结论 |
|---|---|
| 产品路线 | 只开发 B |
| 交付状态 | `foundation_development_only` |
| 正式可用 | 否，PRODUCT-0.1 尚未完成 |
| 真实业务写入 | 禁止；当前插件不创建饮食或库存数据 |
| 写动作预期 | `status=foundation_not_implemented`、`committed=false` |
| GitHub 可见性 | 当前私有，未来计划开源 |
| 开源许可证 | 尚未选择，公开前必须由项目所有者确认 |

当前插件提供 `diet_manager` 工具和 8 个动作的稳定边界，但尚未连接真实 SQLite repository。只有工具返回 `committed=true` 才能告诉用户“已记录”；当前任何写入请求都不得伪称成功。

## 从 GitHub 获取开发包

仓库当前为私有仓库，需要已授权的 GitHub 身份：

```powershell
gh auth status
gh repo clone Aim996/diet-manager-b
Set-Location .\diet-manager-b
```

也可以在凭据管理器已经配置的情况下使用 HTTPS：

```powershell
git clone https://github.com/Aim996/diet-manager-b.git
```

不要把 GitHub 令牌写进 clone URL、仓库文件、终端历史或日志。

## 开发验证快速入口

要求：

- Node.js `>=24.15.0 <25`；Node 24.14.0 会被 OpenClaw 2026.7.1 拒绝。
- pnpm `>=11 <12`。
- OpenClaw `>=2026.5.17`。

```powershell
Set-Location .\version-b-lite-plugin
pnpm install --frozen-lockfile
pnpm handoff:validate
pnpm test
pnpm build
pnpm plugin:validate
```

机器交接门成功时输出：

```text
HANDOFF|PASS|status=foundation_development_only|business_writes=false
```

从仓库根目录执行开发安装：

```powershell
openclaw plugins install ./version-b-lite-plugin
openclaw skills install ./version-b-lite-plugin/skills/diet-manager-b --as diet-manager-b
```

完整步骤、行为矩阵、安全检查和清理方式见 [OpenClaw 开发交接](./docs/OPENCLAW-DEVELOPMENT-HANDOFF.md)。

## 核心业务边界

- Skill 负责理解意图、选择动作和解释确定性结果。
- B 后端未来负责事实提交、效果处理、幂等、查询和回执。
- `FactCommit` 失败可以产生独立、脱敏的技术日志，但饮食记录、库存、营养、Issue、业务 outbox 和进度必须保持零写入。
- OpenClaw/MCP 只调用同一套 B 能力，不形成第二套数据库或业务规则。

## 目录入口

- `version-b-lite-plugin/skills/diet-manager-b/`：可移植 Skill。
- `version-b-lite-plugin/src/`：B 插件和 SQLite 兼容运行时基础。
- `version-b-lite-plugin/tests/`：B 包测试和交接契约。
- `delivery/openclaw-development-handoff.json`：机器可读交接清单。
- `scripts/validate-openclaw-development-handoff.mjs`：只读交接验证器。
- `docs/OPENCLAW-DEVELOPMENT-HANDOFF.md`：GitHub → OpenClaw 完整开发交接。
- `总功能开发计划0.3.md`：唯一总功能计划。
- `docs/开发进度.md`：详细进度快照。

## GitHub 与未来开源

开发采用 feature branch → 测试 → pull request → 审查 → 合并流程。贡献规则见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题见 [SECURITY.md](./SECURITY.md)。

仓库当前没有开源许可证，因此目前不能称为开源软件。未来公开前必须先由项目所有者选择许可证，并完成密钥、隐私数据、历史大文件和发布资产复核。
