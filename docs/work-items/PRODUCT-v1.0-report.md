# 饮食管家 v1.0 / 0.1.0 开发报告

日期：2026-08-14  
权威需求：仓库根 `饮食管家-开发约束与需求-v1.0.md`  
状态：0.1.0 主链已实现，等待用户真实环境验收；完整 0.1 尚未全部交付。

## 已实现

1. 餐食原话解析并追加不可变事实；计划、否定、非本人场景不误写。
2. 营养只接受 v1.0 白名单；未配置或未命中时逐字段 `unknown`，无默认估算数值。
3. 已接入 USDA FoodData Central 生产 HTTP transport：固定 HTTPS origin、固定字段、响应大小限制、来源 URL/ID/version 可追溯。
4. 唯一库存候选与餐食事实同事务扣减；多候选/无候选提交事实但不猜测扣减。
5. 餐食提交回执返回原话、解析数量、营养状态/来源及库存处理状态，全部来自提交后读回。
6. `query_daily_summary` 返回餐食、白水、营养、库存扣减、购买、纠正六域只读进度，不写事实。
7. `query_meals` 与 `query_inventory` 已公开只读接线，结果来自认证 read model 且查询零写入。
8. 既有白水、购买、位置纠正功能保持可用。
9. 支持在线 SQLite 备份与同一私有根恢复；备份有 SHA-256，恢复失败自动回滚旧数据库。

## 用户测试 FDC

先在启动 OpenClaw 的服务进程中设置环境变量：

```powershell
$env:FDC_API_KEY = "你的 USDA / data.gov API key"
```

插件配置使用：

```json
{
  "official_data_root": "E:\\你的私有数据目录",
  "nutrition": {
    "policy_version": "2026-08-14.1",
    "resolution_deadline_ms": 2000,
    "sources": [
      {
        "source_id": "public.usda_fooddata_central",
        "enabled": true,
        "backend_id": "fooddata-central",
        "backend_version": "api-v1"
      }
    ],
    "credential_refs": {
      "public.usda_fooddata_central": "env:FDC_API_KEY"
    }
  }
}
```

API key 不要写入聊天、插件 JSON 或仓库。没有 key 或 USDA 不可用时，餐食仍会提交，营养返回 `unknown`。

## 用户测试备份/恢复

先停止插件 runtime 再执行恢复。备份可以在 runtime 工作时创建。

```powershell
node dist/admin/cli.js backup "E:\你的私有数据目录" "E:\备份\diet-manager.sqlite3"
node dist/admin/cli.js restore "E:\你的私有数据目录" "E:\备份\diet-manager.sqlite3" "上一条输出的SHA256"
```

恢复只适用于原私有根，必须保留其中的 `.diet-manager-b.authority-secret`；它不会把裸 secret 复制到普通备份文件。

## 验证记录

- v1 主链 focused：4 files / 87 tests PASS。
- 唯一完整基线：30 files / 943 tests；941 PASS、2 个旧预期失败。
- 两个旧预期修正后直接覆盖：2 files / 70 tests PASS；未重复跑完整套件。
- FDC + OpenClaw focused：2 files / 26 tests PASS。
- 最新 TypeScript `--noEmit`：PASS。
- 餐食/库存公开查询 smoke：1/1 PASS。
- 备份/恢复 smoke：1/1 PASS。

## 尚未完成

- 用户真实 USDA key/网络环境的在线验收。
- 一键安装与跨机器加密灾备；当前恢复限定同一私有根。
- 最终 dist 构建与安装包验证。本轮按约束没有 emit/build。

## 测试策略

后续按用户指定采用“大批量开发 + 少量关键 smoke + 用户统一体验测试”。不再为每个等价异常分支重复跑全量；问题通过本开发日志定位到对应批次后集中修复。
