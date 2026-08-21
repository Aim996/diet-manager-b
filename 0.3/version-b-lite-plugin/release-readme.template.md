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

通用 Agent 安装使用 npm tarball 中的 Skill、JSON CLI 和公开 Node.js API，不要求 OpenClaw。OpenClaw 安装、升级、卸载仍可由 `scripts/install-diet-manager.ps1` 以事务方式完成（预检 → 备份 → 切换 → 失败回滚）。详情见仓库内 `docs/` 与 `shared/` 下的安装/验收文档。
