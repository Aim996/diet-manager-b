# 饮食管家 v0.1

这是饮食管家当前最新版本的完整、可追溯快照。它保留 0.3 的基础业务目标，并包含 0.4 阶段已经实际开发的增强内容。

## 目录入口

- 安装包：`artifacts/diet-manager-b-v0.1.zip`
- 插件源码、构建产物、Skill 和测试：`source/version-b-lite-plugin`
- 共享案例及验证资料：`source/shared`
- 原始需求、0.3/0.4 计划、设计与开发记录：`docs`
- 版本变化：`CHANGELOG.md`
- 机器清单：`MANIFEST.json`
- 安装包校验：`SHA256SUMS.txt`

## 版本身份

- 版本：`v0.1`
- 源码提交：`e46ebccbb741bab3ac3b324bdb5531bd6032a01f`
- 构建提交：`a723c25f3c28a45f842aea0ed6c29240c503aa51`
- 快照提交：`19b375a6efa247f784f2fb59d6449aff3a7582c1`

## 安装说明

1. 先用 `SHA256SUMS.txt` 核对 ZIP。
2. 将 `artifacts/diet-manager-b-v0.1.zip` 放到目标 OpenClaw 实例可访问的目录。
3. 使用目标实例已配置的 OpenClaw CLI 执行 `plugins install <安装包绝对路径>`。
4. 重启 Gateway，再用日常口语执行餐食、饮水、采购和查询代表场景。

安装需要由目标 OpenClaw 实例提供可信的 `official_data_root`。不要把 Gateway 密钥、数据库、私钥或正式数据根写入模型消息或版本目录。

源码快照没有复制开发工作区的 `node_modules`。安装 ZIP 内保留了离线安装所需的有限运行时依赖；它们属于冻结安装制品，不是开发依赖目录。

## 使用边界

本目录是冻结快照，不是日常开发工作区。后续修改继续在项目根目录的 `version-b-lite-plugin` 进行；形成下一稳定版本时再创建新的版本目录。

请同时阅读 `CHANGELOG.md` 的未完成功能。返回未实现、冲突或需要澄清的操作，不应被表述为已记录成功。
