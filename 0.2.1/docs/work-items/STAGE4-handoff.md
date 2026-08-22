# 阶段 4 真机验收交接文档（2026-08-18）

## 当前状态

七个已部署网关已完成 `0.1.0` 热修复包的脱敏验收。验收包绑定 `50d264a55dc3d5c0879e05c0c4ea0c53349fdeba`，并包含以下已验证修复：

- 契约修复：`6f24e83352fdb8d151e0a7442806152b3bf8060e`。
- 采购容量修复：`3c89be965efb4f977fb29f004efab5293b3c275a`。
- 活动 `dist/application/mapping.js` 在本机及全部七个网关的 SHA-256：`db9a4af356f8f482edd27013cbe154206e0e266d7fe7d0665be4a74df3cb086b`。

本机门禁记录为 Node `24.15.0`、Vitest `41 files / 1001 tests`、TypeScript no-emit/build、diff 检查、archive audit 与两次打包字节一致性，均通过。完整的脱敏结果矩阵在 `docs/evidence/EV-20260818-039-stage4-hotfix-gateway-rollout.md`。

## 真机结果边界

- gateway-01 已通过八动作序列，包括提交、`correct_record(change_amount)`、查询、冻结短语撤销、饮水、单层库存入库、库存查询和日汇总查询。
- gateways 02–07 均通过提交 → `correct_record(change_amount)` → 查询的烟雾路径。
- 冻结接受的撤销短语为：`撤销刚才那条饮食记录`。
- 部署传输文件已清理；已安装 npm 项目和数据根保留。

此记录只说明中间热修复验收通过；它不是 Task 18 候选验收、不是阶段完成，也不授权发布、tag、状态台账变更或启动 Task 13。

## 首次安装前置条件

新环境发现：缺少插件配置项时，安装命令在 schema 验证阶段失败；仅补齐配置后，官方运行根不存在仍会使工具返回 `PLUGIN_RUNTIME_UNAVAILABLE`。以运行时用户创建权限安全的专用官方运行根后，原烟雾路径通过。

这是当前中间人工环境流程的前置条件，不是未来公开安装接口。Task 15 必须实现受支持的安装器 preflight、创建专用安全运行根、经受支持 OpenClaw 接口写入配置、初始化零业务行、重启并证明工具烟雾、失败时事务式回滚。细节及回归要求见 `docs/work-items/INSTALL-FIRST-RUN-001.md`。

## 后续限制

- 继续遵守台账 WIP=1，且不在本交接中改变任何阶段状态。
- `releases/v0.1` 只读。
- 不记录或重放私有路径、凭据、令牌、请求头、端点、事件或操作标识、authority-secret 内容，或非合成饮食数据。
- Task 18 仍需要其独立的不可变候选、真实环境验收前置条件和签收；不能由本热修复记录替代。
