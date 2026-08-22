# 饮食管家 B：AI 协作开发手册

> 写给后续接手本仓库的 AI 会话（Claude Code / Codex 等）。目标：新会话读完本文即可安全开工，不重蹈已付过学费的坑。
> 需求权威：仓库根《饮食管家-开发约束与需求-v1.0.md》。执行主干：`docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md`。

## 1. 开工前 5 分钟

1. 读 `START-HERE.md` → 确认当前目标版本与权威链。
2. 读 `docs/work-items/PRODUCT-0.1.1-ledger.json` → 确认哪个阶段 `IN_PROGRESS`（**必须恰好一个**）。
3. `git status --short` → 工作树必须干净才能开新任务；不干净先弄清楚是谁留下的、该提交还是该报告用户。
4. `git log --oneline -5` → 了解最近发生了什么。
5. 找到当前阶段在主干计划中的任务条目，**只注入那一个任务的上下文**，不要试图一次理解全部 19 个任务。

## 2. 本机环境约定（2026-08-16 起）

工具不在系统 PATH 里，每个 shell 会话先执行：

```powershell
$nodeDir = 'C:/Users/10481/AppData/Local/Temp/diet-manager-validation-node-24.15.0/node-v24.15.0-win-x64'
$env:Path = "$nodeDir;C:\Program Files\Git\cmd;$env:Path"
# node 24.15.0 + corepack pnpm 均来自 $nodeDir；git 2.55 已装；
# pwsh 7.6 在 <用户目录>\AppData\Local\Microsoft\WindowsApps\pwsh.exe（MSIX shim）
```

注意：
- **不要**把临时 Node 路径写进任何仓库脚本或用户级 PATH——脚本必须只依赖"PATH 中有工具"，缺失时报 `ENVIRONMENT_BLOCKED:*`。
- 默认 shell 是 Windows PowerShell 5.1：没有 `&&`/`||`，三元运算符不可用，中文路径传给 git 时优先 `git add -A` 或先 `Set-Location` 再用相对路径（曾因逐个传中文路径静默漏提交）。
- 调用 pnpm/vitest 等批处理 shim 时，从 PS 传数组参数可能被拆坏；稳妥方式是 `cmd /d /s /c "pnpm exec ..."` 单字符串。

## 3. 标准命令

```powershell
Set-Location 'E:\codx\skill\饮食管家\version-b-lite-plugin'
pnpm exec vitest run <files> --maxWorkers=1 --minWorkers=1 --no-file-parallelism   # 定向测试
pnpm exec vitest run --maxWorkers=1 --minWorkers=1                                  # 全量（约 3 分钟，959+ 例）
pnpm exec tsc -p tsconfig.json --noEmit                                             # 类型门
pnpm run build                                                                      # 再生 dist（只在任务要求时）
pnpm run plugin:validate                                                            # OpenClaw 插件校验
pnpm run product:validate                                                           # 全产品门禁（阶段出口用）
node ..\shared\tests\validate-product-0.1.1-governance.mjs                          # 治理门
```

## 4. 每个任务的固定节奏（TDD 红绿）

1. **先写失败测试**（RED）。跑它，**确认失败原因是行为缺失**，不是编译/导入/环境错误——错误的 RED 什么都证明不了。
2. 写**最小实现**到 GREEN。禁止顺手重构、顺手修别的。
3. 跑：定向测试 → 邻接回归（主干计划每个任务列了清单）→ `tsc --noEmit` → `git diff --check`。
4. 只 `git add` 任务列出的文件（用相对路径），commit 信息用主干计划给定的格式。
5. 阶段最后一个任务：跑 `product:validate` 产出证据 JSON 到 `docs/evidence/product-0.1.1/`，更新台账（当前阶段 DONE、下一阶段 IN_PROGRESS），一起提交。

## 5. DoD 自查（提交前 8 问）

1. 涉及 REQ 的 G/W/T 都变成测试且绿了吗？
2. 涉及不变式 I-1..I-8 的断言绿了吗？
3. commit SHA 可定位吗（已提交、范围恰好是任务清单）？
4. 证据指向真实产物（测试输出/commit）而不是复述"已通过"吗？
5. 台账仍然恰好一个 IN_PROGRESS 吗？
6. 新增了债务吗？登记了吗？
7. 相关 RISK 复核了吗？
8. 是否动了不该动的文档？

## 6. 改动禁区（红线）

| 禁区 | 规则 |
|---|---|
| `releases/` | 只读。任何测试/构建/验收不得写入 |
| `docs/archive/` | 只读，且不得被新任务引用为依据 |
| `shared/contracts/` 契约文件 | 改动 = 契约变更，必须先有 DEC，同步 SKILL.md 哈希 |
| 测试改成适配错误行为 | 绝对禁止。测试失败 → 修实现或报告用户 |
| 营养数值 | 永不由 AI 生成；只能 unknown 或白名单来源引用 |
| secret（authority secret、FDC_API_KEY、Gateway 凭据、备份口令）| 不进参数列表、环境清单、日志、Git、任何输出 |
| 用户真实饮食数据 | 测试只用隔离测试根（`.tmp/`），不碰正式数据根 |
| 运行时依赖 | 不新增。需要时先 DEC |

## 7. 证据（EV）书写规范

- 位置：`docs/evidence/EV-YYYYMMDD-NNN-<slug>.md` 或阶段证据 `docs/evidence/product-0.1.1/*.json`。
- 必须指向**不可变产物**：commit SHA、测试输出的精确数字（文件数/用例数/exit code）、文件 SHA-256。
- 禁止只写"已通过"；禁止指向可编辑文本作为证据。
- ID 一旦分配永不重命名、永不复用。

## 8. 已付学费的坑（按踩坑成本排序）

1. **解析边界吞事实**（MIXED-LIQUID-001）："识别到"和"可提交"是两个状态；实体识别到但证据不完整时必须显式保留证据并 fail-closed，否则下游永远无法发现遗漏。改 parser 必看 `docs/work-items/MIXED-LIQUID-001-root-cause.md`。
2. **`Number(null) === 0`**：所有 nullable 数量显式分支；unknown 必须保持 null 直到展示层写"未知"。
3. **重放零写入的证明**：对全部业务表做规范快照 SHA 比较；行数统计抓不到 UPDATE/DELETE。
4. **假并发**：并发测试必须真 worker threads + 独立 SQLite 连接 + 启动屏障。
5. **JS 日期自动滚动**：2 月 31 日会被 `Date` 悄悄变成 3 月；先做 roundtrip 校验再用。
6. **中文进 ASCII 幂等键**：中文名称用规范摘要（SHA-256）派生内部 ID。
7. **PS 5.1 中文路径逐个传 git**：会静默失败；用 `git add -A` + status 复核，或相对路径。
8. **fixture 与生产权威不一致**：测试数据源冲突时修 fixture，绝不放宽生产校验。
9. **`committed_with_issues` ≠ 可重试**：事实已提交，Skill/测试不得重复提交同一事实。
10. **dist 与 src 漂移**：改了 src 而任务要求交付产物时，必须由正式 build 再生 dist；不要手改 dist。

## 9. 与用户的协作边界

- 需要用户参与的节点：真实环境验收（FDC_API_KEY、Gateway）、发布签收、push 到 GitHub、任何改系统环境的操作。
- 状态汇报用事实：测试数字、commit SHA、证据路径。不确定就说不确定。
- 发现"计划说 X 但代码/现实是 Y"的矛盾时：停下来报告，不要自作主张选一边。
- 上下文即将耗尽时：提交已完成的最小闭环，更新台账，把"下一步"写进台账或报告，让续接会话零损失。
