# Security Policy

## Supported versions

当前没有正式受支持的 PRODUCT 版本。`foundation_development_only` 只用于开发、测试和安全复核，不应存放真实饮食或健康数据。

| Version | Supported |
|---|---|
| PRODUCT-0.1 | 尚未发布 |
| Foundation development builds | 仅接受开发阶段安全报告，不提供生产支持承诺 |

## Reporting a vulnerability

请使用 GitHub 仓库的 **GitHub Security Advisory** / private vulnerability reporting 提交安全问题，不要创建公开 issue。

报告应包含：

- 受影响 commit 和环境版本；
- 最小复现步骤；
- 预期与实际结果；
- 是否涉及路径越界、凭据、伪提交、业务数据、安装/清理或依赖供应链；
- 已采取的隔离措施。

不要附带真实 Gateway/GitHub 令牌、用户饮食记录、原始聊天、完整数据库或其他人的个人数据。可使用合成 fixture、哈希、计数和脱敏路径证明问题。

## Security boundary

- 当前所有写动作必须保持 `committed=false`。
- 技术日志不属于业务记录。
- 任何 FactCommit 失败都必须保持业务数据零写入。
- 插件和 Skill 只能操作明确授权的项目/测试路径。
- 仓库公开前必须完成许可证、密钥历史、隐私数据、大文件、依赖和 release 资产复核。
