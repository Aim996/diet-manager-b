# Diet Manager B {{product_version}}

饮食管家 B 是一个确定性的餐食与白水记录 OpenClaw 插件：把自然语言餐食/采购/纠正指令解析为带权威证明的事实并落库，具备库存、营养快照、撤销、纠正、查询与回执等完整闭环。

- **产品版本**：`{{product_version}}`
- **构建源码提交**：`{{source_commit}}`
- **构建工具链**：Node `{{node_version}}`，OpenClaw `{{openclaw_version}}`

## 完整性校验

本目录内的 `FILES.SHA256` 记录了除其自身外每个候选根文件的 SHA-256（大写十六进制，斜杠相对路径，字典序）。压缩包位于 `artifacts/diet-manager-b-0.1.1.zip`，其字节数与 SHA-256 记录于 `MANIFEST.json` 的 `archive` 字段。

安装前请先核对：

```powershell
# 在候选根目录下核对全部文件哈希
Get-FileHash -Algorithm SHA256 .\artifacts\diet-manager-b-0.1.1.zip
# 其 Hash 应与 MANIFEST.json 中 archive.sha256 完全一致
```

## 安装与升级

安装、升级、卸载由 `scripts/install-diet-manager.ps1` 以事务方式完成（预检 → 备份 → 切换 → 失败回滚）。详情见仓库内 `docs/` 与 `shared/` 下的安装/验收文档。
