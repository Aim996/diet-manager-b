# EV-20260820-043 — 0.2.0 全量 16 场景真实验收（7 网关 × 内容变体）

## Identity and scope

- `evidence_id`: `EV-20260820-043`
- `evidence_type`: `E-REAL-ACCEPTANCE`（多网关 · 全量目录）
- `recorded_at`: `2026-08-20`
- `result`: `PASS`（16 场景 × 7 网关 = 112/112 全绿；gw03 首轮 1 处 LLM 抖动，隔离复跑即绿）
- `product_version`: `0.2.0`
- `candidate_zip_sha256`: `762027A2B3CE57F9BC6F3A79A2E939D59CCD0383E0313104039C89C4FA9F2315`（candidate-010）
- `source_commit`: `9292579e11513738784a0d061fee20cd07e337b3`（DEC-032 离线营养）
- `contract_version`: `3`（`diet-manager/contract-v3`）
- `node_version`: `v24.16.0`（容器内）
- `openclaw_version`: `OpenClaw 2026.7.1`
- `gateways`: `openclaw-gateway-01..07`（镜像 `ghcr.io/openclaw/openclaw:2026.7.1-2`，宿主机 `bome`）

本证据记录 0.2.0 首个增量（DEC-030 个人档案/六项目标/进度条 + DEC-031 restore_record + DEC-032 离线营养）在 **7 台独立 OpenClaw 网关**上的**全量 16 场景**真实验收。它是 EV-20260820-042（8 场景冒烟子集）之上的全目录回归，覆盖新增的 8 个冒烟外场景（缺省状态、清除单目标、恢复幂等、香蕉、离线三态、撤销回归）。不构成阶段收口、不授权 releases 晋级或 tag。

## 方法

- 场景基座 `scenarios-0.2.0.json`（全量 16 场景目录），按网关生成内容变体 `scenarios-0.2.0-full-gw0X.json`（生成器 `generate-full-variants.py`）。
- **公式不变**：每个场景的 `id`/`category`/`expected_outcome_status`/`database_assertions`（表 + where + expect_delta）7 台完全一致。
- **内容变**：档案（身高/体重/性别/年龄/状态）、热量（1800–2400）、饮水（800–1400ml）、饮品（牛奶/豆浆 200–500ml）、食物（苹果/鸡蛋/香蕉）、香蕉数量逐台不同；`inventory-unique`（回归基线）保持固定。
- 执行器 `run-real-acceptance-docker.py` 在宿主机跑，每台 `--reset` 建全新空库后逐场景独立会话回放 setup + input，对官方数据根 SQLite 做只读白名单断言（`expect_delta` 为相对 input 前净增量）。
- 7 台**错峰启动**（间隔 6s），规避 EV-042 中「7 并发 `--reset` 同时打 Docker 宿主机触发 gw03 网关重启」的抖动根因。

### 内容变体表（公式不变、内容变；冒烟 8 场景沿用 EV-042，新增 8 场景如下）

| 网关 | 缺省档案（default-state） | 清除目标 setup（clear-protein） | 香蕉数量（banana） | 离线三态饮品（missing-key/offline/timeout） | 恢复/撤销食物 |
|---|---|---|---|---|---|
| gw01 | 我身高165体重55公斤 | 身高180体重70公斤 | 两个 | 200毫升牛奶 | 苹果 |
| gw02 | 我身高175体重65公斤 | 身高175体重65公斤 | 一个 | 250毫升牛奶 | 鸡蛋 |
| gw03 | 我身高170体重80公斤 | 身高170体重80公斤 | 三个 | 300毫升豆浆 | 香蕉 |
| gw04 | 我身高160体重52公斤 | 身高165体重55公斤 | 两个 | 350毫升豆浆 | 苹果 |
| gw05 | 我身高182体重75公斤 | 身高182体重75公斤 | 一个 | 400毫升牛奶 | 鸡蛋 |
| gw06 | 我身高168体重60公斤 | 身高168体重60公斤 | 三个 | 450毫升牛奶 | 香蕉 |
| gw07 | 我身高178体重72公斤 | 身高178体重72公斤 | 两个 | 500毫升豆浆 | 苹果 |

## 结果矩阵（16 场景 × 7 网关 = 112 场景运行）

| 场景（公式） | gw01 | gw02 | gw03 | gw04 | gw05 | gw06 | gw07 |
|---|---|---|---|---|---|---|---|
| profile-set（档案+六目标派生） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| profile-default-state（缺省维持） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| goal-set-calorie（覆盖热量） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| goal-clear-protein（清除单目标） | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | ✅ |
| query-progress-bar（进度条零写） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| restore-record（撤销后恢复） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| restore-already-active（恢复幂等忽略） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| nutrition-hit（离线权威命中·牛奶） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| nutrition-banana（香蕉离线命中） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| nutrition-missing-key（无 key 离线命中） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| nutrition-offline（断网离线命中） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| nutrition-timeout（无超时离线命中） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| meal-single（单食物餐食回归） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| inventory-unique（单商品采购回归） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| zero-write-plan（计划零写回归） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| correction-undo（撤销餐食回归） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

`✅*`：gw03 首轮 `goal-clear-protein` 曾 FAIL（见下「gw03 抖动调查」），隔离干净重置复跑后 16/16 全绿。

## gw03 goal-clear-protein 抖动调查（首轮 1/16 FAIL → 隔离复跑全绿）

首轮 `diet-manager-real-0.2.0-full` 跑批中，gw03 `goal-clear-protein`（input「清除蛋白质目标」）`observed=ignored` 而 `expected=committed`，`goal_versions` delta 0。逐层取证：

1. **gw01 同场景 PASS**：LLM 正确调用 `diet_manager`，`set_goal` 解析「清除蛋白质目标」→ `committed`，`goal_versions` delta 1（`before_count 4 → after_count 5`）。
2. **gw03 的失败形态**：LLM 未调用工具，直接以「饮食管家目前只支持"设置目标"，不支持清除/删除目标，所以这次没有做任何写入」拒绝，导致 `ignored`，`goal_versions` delta 0（`before_count 3 → after_count 3`）。
3. **文档与断言均正确**：`SKILL.md` 第 46 行明确「设置或更新六项目标（**可单独清除某项目标**）」；场景断言 `goal_versions delta 1` 与产品行为（gw01 实证）一致，不存在「改测试适配错误行为」。
4. **隔离干净重置复跑**（`diet-manager-real-0.2.0-full-r2`，`--reset`，其余 6 台已停）gw03 16/16 全绿，`goal-clear-protein` `observed=committed`，回执「已更新目标：蛋白质目标已清除」。

结论：gw03 首轮 `goal-clear-protein` 失败为**LLM 智能体非确定性（幻觉「不支持清除」而拒绝调工具）**，非产品回归。与既有债务项 #7（`conversation_id`/`received_at` 跨轮 LLM 偶发不一致）及 EV-042 gw03 冒烟抖动同属 LLM/环境非确定性，已登记。

## 离线营养证明（DEC-032 核心：零 key 零网络零代理命中）

- 本证据覆盖 **5 个营养场景 × 7 网关 = 35 场景运行**：`nutrition-hit` / `nutrition-banana` / `nutrition-missing-key` / `nutrition-offline` / `nutrition-timeout`，全部断言 `nutrition_snapshots.source_type = authoritative_public_database` 且 `expect_delta = 1`，全部通过。
- **香蕉首次真实验收**：`nutrition-banana` 7/7 全绿，证明香蕉（fdcId `173944`）在词表 + USDA 离线 bundle 内命中（此前「香蕉无结果→unknown」路径在 DEC-032 中闭环）。
- **gw01–06（`fdc_api_key_present = false`）**：无 `FDC_API_KEY`，在线 FDC 适配器不可运行，权威命中只能来自离线 bundle `public.usda_fooddata_central_bundled`；missing-key/offline/timeout 三态语义由离线无条件接线（rank 4，始终启用）覆盖。
- **gw07（`fdc_api_key_present = true`）**：容器残留 `FDC_API_KEY`（0.1.1 验收遗留），营养经在线 FDC 命中，`source_type` 同为 `authoritative_public_database`。属环境残留，不影响 gw01–06 的离线证明，仅作一致性补充记录。

## 断言口径（前序 EV-042 已修订，本证据沿用）

- `nutrition-*` 断言收紧为 `source_type = authoritative_public_database`（delta 1），精确命中 DEC-032 离线权威路径，规避 `nutrition_snapshots` 双写（领域投影 `public_fixture` + 营养来源真实来源）下旧断言 delta 恒 2 的误报（债务项 #9）。
- `query-progress-bar` 移除 `snapshot_equality`（LLM 非确定文本逐字比对），保留 `event_records expect_delta 0` 的「无副作用」真值检查。

## 范围与边界

- 本证据覆盖 0.2.0 全量 16 场景目录，为 DEC-030/031/032 的全量回归验收。
- 不触及 `releases/`、0.1.1 ledger、`accepted_candidate`。`secret_value_count` 全 7 台为 0（不含容器内 `OPENCLAW_GATEWAY_TOKEN`/`FDC_API_KEY` 凭据值）。
- gw07 残留 `FDC_API_KEY` 为环境清理项，非本证据范围（不改动凭据）。
- **发布（逐字节晋级 releases/v0.2.0 + tag）仍需用户签收**，本证据不授权。
