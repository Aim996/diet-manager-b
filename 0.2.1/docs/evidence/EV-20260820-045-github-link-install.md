# EV-20260820-045 — 0.2.0 GitHub 链接安装（第二支线 · 分发通道验证）

## Identity and scope

- `evidence_id`: `EV-20260820-045`
- `evidence_type`: `E-INSTALL-CHANNEL`（GitHub 链接自主安装 · 分发通道）
- `recorded_at`: `2026-08-20`
- `result`: `PASS`
- `product_version`: `0.2.0`（candidate-010）
- `candidate_zip_sha256`: `762027A2B3CE57F9BC6F3A79A2E939D59CCD0383E0313104039C89C4FA9F2315`
- `source_commit`: `f3e98f1`（`main`，与 `origin/main` 同步）
- `target_gateway`: `openclaw-gateway-03`（`192.168.100.1`，iStoreOS，干净实例）
- `model`: `deepseek-v4-flash`

## 目的

验证「最新 skill 已上传 GitHub → 新小龙虾自主通过链接安装」的分发通道：**不再手工 `docker cp` 本地构建产物**，而是让干净网关仅凭 GitHub 链接完成下载、安装、配置、初始化与验证。对应其余待命小龙虾（gateway-03/04/05）的可复制安装路径。

## 前置确认

- 最新 skill 即 candidate-010 冻结包，已 git 追踪于 `0.2.0/candidate-010/artifacts/diet-manager-b-0.2.0.zip`，仓库为公开仓库。
- raw 链接可达（HTTP 200）：
  `https://raw.githubusercontent.com/Aim996/diet-manager-b/main/0.2.0/candidate-010/artifacts/diet-manager-b-0.2.0.zip`

## 执行步骤与结果

| 步骤 | 命令 / 动作 | 结果 |
|---|---|---|
| 1. 下载 | 容器内 `curl -sL -o /tmp/diet-manager-b-0.2.0.zip <raw>` | 315296 字节，`sha256=762027a2…f2315` **与候选一致** |
| 2. 安装 | `openclaw plugins install /tmp/diet-manager-b-0.2.0.zip` | 解包到 `global:diet-manager-b`；peer dep `openclaw -> /app` 链接；首启因缺 `official_data_root` 校验失败（预期） |
| 3. 配置 | `openclaw config set plugins.entries.diet-manager-b.config.official_data_root /home/node/.openclaw/diet-manager-data` + `.enabled true` | 已写入 `openclaw.json` |
| 4. 初始化 | `mkdir -p …/diet-manager-data` + `node dist/admin/cli.js init-root …` | `business_rows=0, sqlite_user_version=1`；authority secret + sqlite3 就位 |
| 5. 重启 | `docker restart openclaw-gateway-03` | 恢复 healthy |
| 6. 验证 | `openclaw plugins list` | `Diet Manager B` → `enabled`，`global:diet-manager-b/dist/index.js`，`0.2.0` |
| 7. 冒烟 | agent `set_profile`（档案 175/70/男/30/减脂） | `档案已保存 ✅`（event-e330d9824e30525a63a4175082a5f19f） |

## 结论

GitHub 链接安装通道 **成立**：干净网关仅凭公开 raw 链接即可端到端完成安装并跑通 `diet_manager` 工具（含 `official_data_root` 配置与数据根初始化）。该路径可复制到其余待命小龙虾（gateway-04/05）。

**注意**：`openclaw plugins install` 首启会因缺 `official_data_root` 校验失败，属预期两步安装（先装包、后 `config set` + `init-root`）；若后续要做「一条命令自助安装」，需把该顺序固化进安装脚本或 install-lifecycle 场景，属改进项，不在本证据范围。
