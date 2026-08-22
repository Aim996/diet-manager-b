# Diet Manager B {{product_version}} — 通用 Agent Skill

饮食管家 B 是一个确定性的通用 Agent Skill：Agent 可通过跨平台 `diet-manager` JSON CLI 或公开 Node.js API 调用同一 SQLite 核心；OpenClaw 作为可选 OpenClaw 适配器保留。所有入口共享餐食、白水、库存、营养、撤销、纠正、查询与回执的唯一业务权威。

- **产品版本**：`{{product_version}}`
- **构建源码提交**：`{{source_commit}}`
- **构建工具链**：Node `{{node_version}}`；可选 OpenClaw 适配器验证版本 `{{openclaw_version}}`
- **冻结业务契约**：`diet-manager/contract-v3`

## 完整性校验

本目录内的 `FILES.SHA256` 记录了除其自身外每个候选根文件的 SHA-256（大写十六进制，斜杠相对路径，字典序）。跨平台 npm 包名为 `diet-manager-b-{{product_version}}.tgz`；原有 OpenClaw 发布路径的 ZIP 位于 `artifacts/diet-manager-b-{{product_version}}.zip`，其字节数与 SHA-256 记录于 `MANIFEST.json` 的 `archive` 字段。

安装前请先核对：

```powershell
# 在候选根目录下核对全部文件哈希
Get-FileHash -Algorithm SHA256 .\artifacts\diet-manager-b-{{product_version}}.zip
# 其 Hash 应与 MANIFEST.json 中 archive.sha256 完全一致
```

## 安装与升级

通用 Agent 安装使用 npm tarball 中的 Skill、JSON CLI 和公开 Node.js API，不要求 OpenClaw。OpenClaw 安装、升级、卸载仍由 `scripts/install-diet-manager.ps1` 执行。

只支持从 `0.2.2` 原地升级到 `0.3.0`。升级器先创建并校验迁移前 SQLite 备份，随后执行 v1 → v2 迁移；餐食、库存、营养、目标、更正和幂等结果必须保持可读。程序链接、配置或网关健康检查任一失败时，升级器会重新链接原 `0.2.2` 路径、逐字恢复旧 `current.json`，并用已校验备份恢复迁移前数据库。备份文件不会自动删除，人工清理前请保留其路径与 SHA-256。

在源码候选根构建发布包前运行：

```powershell
node .\scripts\validate-0.3.mjs (Resolve-Path .)
```

校验必须返回 `diet-manager/release-validation/v1` 文件哈希清单；任一必需 Skill/reference、旧契约、迁移文件缺失，版本不一致或包含数据库、密钥、`.env`、测试产物时均失败闭合。
