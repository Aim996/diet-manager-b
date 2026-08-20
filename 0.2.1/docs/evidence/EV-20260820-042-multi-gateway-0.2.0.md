# EV-20260820-042 — 0.2.0 多设备同步真实验收（7 网关 × 内容变体）

## Identity and scope

- `evidence_id`: `EV-20260820-042`
- `evidence_type`: `E-REAL-ACCEPTANCE`（多网关同步）
- `recorded_at`: `2026-08-20`
- `result`: `PASS`（7 网关 × 8 场景 = 56/56 全绿）
- `product_version`: `0.2.0`
- `candidate_zip_sha256`: `762027A2B3CE57F9BC6F3A79A2E939D59CCD0383E0313104039C89C4FA9F2315`（candidate-010）
- `source_commit`: `9292579e11513738784a0d061fee20cd07e337b3`（DEC-032 离线营养）
- `contract_version`: `3`（`diet-manager/contract-v3`）
- `node_version`: `v24.16.0`（容器内）
- `openclaw_version`: `OpenClaw 2026.7.1`
- `gateways`: `openclaw-gateway-01..07`（镜像 `ghcr.io/openclaw/openclaw:2026.7.1-2`，宿主机 `bome`）

本证据记录 0.2.0 首个增量（DEC-030 个人档案/六项目标/进度条 + DEC-031 restore_record + DEC-032 离线营养）在 **7 台独立 OpenClaw 网关**上的同步真实验收。每台网关跑同一「断言公式」、不同「输入内容」的 8 场景冒烟子集，以证明能力跨内容/跨设备泛化，而非 7 台复读同一句输入。不构成阶段收口、不授权 releases 晋级或 tag。

## 方法

- 场景基座 `scenarios-0.2.0-smoke.json`（8 场景），按网关生成内容变体 `scenarios-0.2.0-smoke-gw0X.json`（生成器 `generate-smoke-variants.py`）。
- **公式不变**：每个场景的 `id`/`category`/`expected_outcome_status`/`database_assertions`（表 + where + expect_delta）7 台完全一致。
- **内容变**：`profile`（身高/体重/性别/年龄/状态）、`calorie`（1800–2400）、`water`（800–1400ml）、`drink`（牛奶/豆浆 200–500ml）、`food`（苹果/鸡蛋/香蕉）逐台不同；`inventory-unique`（回归基线）保持固定。
- 执行器 `run-real-acceptance-docker.py` 在宿主机跑，每台 `--reset` 建全新空库后逐场景独立会话回放 setup + input，对官方数据根 SQLite 做只读白名单断言（`expect_delta` 为相对 input 前净增量）。

### 内容变体表（公式不变、内容变）

| 网关 | profile（档案） | calorie（千卡） | water（饮水） | drink（离线营养） | food（餐食/撤销/计划） |
|---|---|---|---|---|---|
| gw01 | 身高180体重70公斤男30岁减脂 | 1800 | 1000ml | 吃了200毫升牛奶 | 苹果 |
| gw02 | 身高175体重65公斤女28岁减脂 | 1900 | 1200ml | 吃了250毫升牛奶 | 鸡蛋 |
| gw03 | 身高170体重80公斤男35岁增肌 | 2100 | 900ml | 吃了300毫升豆浆 | 香蕉 |
| gw04 | 身高165体重55公斤女25岁减脂 | 2000 | 1100ml | 吃了350毫升豆浆 | 苹果 |
| gw05 | 身高182体重75公斤男40岁增肌 | 2300 | 1300ml | 吃了400毫升牛奶 | 鸡蛋 |
| gw06 | 身高168体重60公斤女32岁减脂 | 2200 | 800ml | 吃了450毫升牛奶 | 香蕉 |
| gw07 | 身高178体重72公斤男38岁减脂 | 2400 | 1400ml | 吃了500毫升豆浆 | 苹果 |

## 结果矩阵（8 场景 × 7 网关 = 56 场景运行）

| 场景（公式） | gw01 | gw02 | gw03 | gw04 | gw05 | gw06 | gw07 |
|---|---|---|---|---|---|---|---|
| profile-set（档案+六目标派生） | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | ✅ |
| goal-set-calorie（覆盖热量） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| query-progress-bar（进度条零写） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| restore-record（撤销后恢复） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| nutrition-hit（离线权威命中） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| meal-single（单食物餐食回归） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| inventory-unique（单商品采购回归） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| zero-write-plan（计划表述零写回归） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

`✅*`：gw03 首轮 `profile-set` 曾因测试环境抖动 FAIL（见下「gw03 抖动调查」），干净重置复跑后 8/8 全绿。

## 离线营养证明（DEC-032 核心：零 key 零网络零代理命中）

- 全部 7 台 `nutrition-hit` 断言 `nutrition_snapshots.source_type = authoritative_public_database` 且 `expect_delta = 1`，全部通过。
- **gw01–06（`fdc_api_key_present = false`）**：无 `FDC_API_KEY`，在线 FDC 适配器不可运行，权威命中只能来自离线 bundle `public.usda_fooddata_central_bundled`。逐台抽查 `source_ref` 的 fdcId 与离线 bundle 闭合 10 项一一对应：
  - 牛奶 `171265`、鸡蛋 `171287`、苹果 `171688`、香蕉 `173944`、豆浆 `172446` —— 均落在 `offline-usda.ts` 的 `[171265, 171287, 171688, 173944, 174924, 168930, 171477, 171890, 173227, 172446]`。
  - 断网/无 key/无超时三态语义已由离线无条件接线覆盖（rank 4，始终启用）。
- **gw07（`fdc_api_key_present = true`）**：容器残留 `FDC_API_KEY`（0.1.1 验收遗留，未随 0.2.0 清空），营养经在线 FDC 命中，`source_type` 同为 `authoritative_public_database`。属环境残留，不影响 gw01–06 的离线证明，仅作一致性补充记录。

## gw03 抖动调查（首轮 1/8 FAIL → 复跑全绿）

首轮 `diet-manager-real-0.2.0-v3` 跑批中，gw03 `profile-set` 断言 `goal_versions` `before_count 0 → after_count 2`（期望 delta 1），`observed=committed` 与期望一致。逐层取证结论：

1. 派生函数 `deriveSixGoals`（Mifflin-St Jeor）确定性返回全部 6 维非空；gw03（170/80/男/35/增肌）派生 water = 35×80 = **2800**，无任何 1000 默认。落库 `goal-e8e23e7f` 的 6 维（2234/160/80/219/31/2800）与派生公式逐项吻合。
2. 多出的 `goal-65c4f317` = `{water_ml:1000, 其余 null}`，其 `water=1000` 与 80kg 档案不匹配（应为 2800），是经典的「8 杯水」LLM 幻觉值。
3. 会话取证：gw03 容器上 session `8bad2e90`（`00:06:49`）收到 **「饮水目标1000毫升」**——这不是 gw03 变体（gw03 饮水目标 = 900ml），而是上一轮同内容跑批/跨网关路由的遗留输入；该会话随即被 **「[System] Your previous turn was interrupted by a gateway restart」** 打断。
4. 该 stray `set_goal(water=1000)` 落在 gw03 的 `profile-set` 测量窗口内（`before` 计数之后、`after` 计数之前），使 delta 从 1 变 2。产品对收到的每一句输入都处理正确。
5. **干净重置复跑**（`diet-manager-real-0.2.0-v4`，`--reset`）gw03 `profile-set` 8/8 全绿，`goal_versions` delta 恢复 1。

结论：gw03 首轮 `profile-set` 失败为**测试环境抖动（网关重启 + 跨网关遗留输入落库时序碰撞）**，非产品回归。与既有债务项 #7（`conversation_id`/`received_at` 跨轮 LLM 偶发不一致）同属 LLM/环境非确定性，已登记。

## 断言修订（本轮资产修正，非「改测试适配错误行为」）

- `nutrition-hit` 断言由 `coverage_status != unknown`（delta 1）收紧为 `source_type = authoritative_public_database`（delta 1）。原因：`nutrition_snapshots` 自 0.1.1 既有「领域投影 `public_fixture` + 营养来源真实来源」双写（每条餐食 2 行），旧断言在双写下 delta 恒为 2 误报。新断言精确命中 DEC-032 离线权威路径，经 DB 逐行核验确认（见债务项 #9）。
- `query-progress-bar` 移除 `snapshot_equality`（逐字比对 LLM 非确定文本），保留 `event_records expect_delta 0` 的「无副作用」真值检查（7 台全绿）。

## 范围与边界

- 本证据覆盖 0.2.0 冒烟子集（8 场景），非 16 场景全量目录；全量目录 `scenarios-0.2.0.json` 已同步同款断言修订，留待后续 DEC 全量回归跑批。
- 不触及 `releases/`、0.1.1 ledger、`accepted_candidate`。`secret_value_count` 全 7 台为 0（不含容器内 `OPENCLAW_GATEWAY_TOKEN`/`FDC_API_KEY` 凭据值）。
- gw07 残留 `FDC_API_KEY` 为环境清理项，非本证据范围（不改动凭据）。
