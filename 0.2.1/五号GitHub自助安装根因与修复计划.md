# 五号 GitHub 自助安装根因与修复计划

- 记录时间：2026-08-20 12:38:38 +08:00（Asia/Shanghai）
- 调查对象：`openclaw-gateway-05`
- 调查方式：本地仓库静态复核、五号安装会话日志复核、五号容器只读检查
- 边界：未修改产品代码，未重启五号，未移动或删除五号现有插件与数据，未回显凭据或 token

## 一、结论

五号最终不是“GitHub 完全不可访问”或“插件代码无法在 Linux 运行”，而是多项问题串联：

1. OpenClaw 的 `web_fetch` 因网络安全策略拒绝 GitHub 页面，但容器内 `git clone` 当时成功，当前 `curl` 访问 GitHub 页面和 raw 内容也均返回 HTTP 200。
2. 自助安装代理选择了开发用 `openclaw plugins install --link`，并把源目录链接到 `/tmp`。随后移动源目录，OpenClaw 保存的旧链接立即失效。
3. 配置失效后，`openclaw doctor --fix` 不能越过 `plugins.load.paths` 的启动前校验完成修复；最终只能精确编辑配置并重新注册稳定路径。
4. 插件后来迁移到 `/home/node/.openclaw/plugins/...`，该路径位于宿主机 bind mount，当前来源稳定且插件已启用。
5. `official_data_root` 却配置成 `/home/node/.local/share/diet-manager`。该路径位于容器 overlay，而不在五号两个持久化挂载中；容器重建会丢失数据库和 authority secret。
6. `pnpm test` 的 12 个测试失败和 2 个测试文件加载失败主要来自 Windows 专用测试混入 Linux 通用测试，并非这次 Linux 插件构建失败。TypeScript 构建、OpenClaw build/check/validate 均成功。
7. 整个对话从会话创建到最后一个空 assistant 记录约 600 秒，正好命中五号 `agents.defaults.timeoutSeconds=600`。代理在超时前执行了两次完整测试、安装、迁移和多轮诊断，未能发送最终答复，因此用户只看到超时。

发布前应同时修复安装通道、数据持久化和测试分层；仅把五号当前配置改到“能加载”不足以证明 GitHub 自助安装可靠。

## 二、失败链路与责任分类

### 1. 直接 GitHub 页面访问受阻

**现场证据**

- 首次 `web_fetch` 返回：目标解析到 private/internal/special-use 地址，因此被策略阻止。
- 同一会话随后的 `git clone --depth 1 https://github.com/Aim996/diet-manager-b.git` 成功。
- 本次只读复测中，容器内 GitHub 页面和 raw README 均返回 HTTP 200。

**分类：环境限制，不是 GitHub 仓库故障。**

`web_fetch` 走的是 OpenClaw 工具的受保护解析/抓取通道；`git`、`curl` 走容器网络。两个通道的网络策略不同。现有 README 只列 `gh` 和 `git clone`，没有告诉自动安装器在网页抓取受限时如何安全降级，也没有提供机器可读的“当前可安装候选”入口。

**修复方向**

- 文档明确：网页抓取失败不能等价为 GitHub 不可达；按 `raw → git clone → 已知候选包` 的顺序降级。
- 下载必须校验冻结候选的 SHA-256；禁止把 token 拼进 clone URL。
- 为自动化提供固定、短小、机器可读的安装清单，避免代理遍历整个仓库后自行猜版本。

### 2. 开发用 `--link` 指向临时目录

**现场证据**

- 自助代理执行了 `openclaw plugins install --link /tmp/diet-manager-b/version-b-lite-plugin`。
- OpenClaw 将源路径记录到 `plugins.load.paths`；插件起初能加载。
- 代理随后把仓库移动到稳定目录，旧 `/tmp/...` 消失，配置立即报 `plugin path not found`。
- `--link --force` 不受支持；这是 OpenClaw CLI 的明确行为。

**分类：文档/安装器缺陷 + OpenClaw 链接语义。**

OpenClaw 的 `--link` 是开发模式：运行时直接依赖源路径，移动或清理源目录必然失效。仓库根 README 把 `npm run install:local` 放在醒目的“本地安装”章节，并说明它使用 `--link`，但没有为 Linux/Docker 普通用户给出同等清晰的非链接安装流程。五号代理因此选错入口。

产品安装模块也有同类风险：升级流程先把插件链接到 `.staging-*`，成功后再把 staging 改名成正式版本目录；这会让 OpenClaw 保存的链接指向已经被移动的 staging 路径。

**修复方向**

- 普通用户从冻结 zip 使用非 `--link` 安装，让 OpenClaw 复制到稳定的全局插件目录。
- `--link` 只保留为明确标记的开发命令，并拒绝 `/tmp`、系统临时目录和容器非持久层，除非显式传入开发确认开关。
- 如果产品安装器继续采用版本目录链接，必须先把 staging 原子改名到最终稳定路径，再执行一次且只执行一次 `plugins install --link <final-path>`。

### 3. `doctor` 无法恢复失效链接

**现场证据**

- 路径失效后，多条 `openclaw config` 命令因启动前配置校验而拒绝执行。
- CLI 建议运行 `openclaw doctor --fix`。
- 实际 `doctor --fix` 先进入其他配置诊断，最后仍因旧插件路径不存在而退出，没有修复该路径。
- 手工精确替换旧路径后，`openclaw config validate` 才恢复成功。

**分类：OpenClaw 行为/诊断恢复缺口；安装器不得依赖 doctor 自愈。**

**修复方向**

- 安装器在改插件路径前先保存脱敏配置快照，并用自己的事务步骤更新 `plugins.load.paths`；失败时恢复快照。
- 安装器启动时先检测所有 link 来源是否存在，并给出专用错误码与恢复命令。
- 文档不要把 `doctor --fix` 描述成失效插件路径的可靠恢复方法；它只能作为诊断辅助。
- 可向 OpenClaw 上游提交最小复现：无效 `plugins.load.paths` 阻断 config patch，同时 doctor 也不能修复该字段。

### 4. 稳定迁移后的插件来源

**当前状态**

- 当前配置的加载路径是 `/home/node/.openclaw/plugins/diet-manager-b/version-b-lite-plugin`。
- 五号把 `/home/node/.openclaw` bind mount 到宿主机 `/mnt/docker/openclaw-05/data/config`，因此插件来源可跨容器重启和重建保留。
- `openclaw plugins list` 显示 Diet Manager B 0.2.0 已启用，来源为上述稳定路径。
- 当前 `plugins.installs.diet-manager-b` 为空，来源主要由 `plugins.load.paths` 维持；它仍是开发链接语义，而不是不可变发布安装回执。

**分类：当前已恢复运行，但分发完整性仍是文档/安装器缺陷。**

现有路径比 `/tmp` 稳定，但内容来自完整 Git clone，包含开发树和依赖，且没有由安装器保存候选哈希、来源 URL、安装版本路径和时间的统一回执。下一次自助安装不应复制这条人工迁移过程。

### 5. `official_data_root` 位于非持久化容器层

**现场证据**

- 当前值：`/home/node/.local/share/diet-manager`。
- `findmnt` 显示该目录位于容器 `/` 的 overlay 文件系统。
- 五号仅持久化挂载 `/home/node/.openclaw` 和 `/home/node/.config/openclaw`；`.local/share` 不在挂载中。

**分类：文档/安装器缺陷，环境拓扑使其后果变为数据丢失风险。**

容器普通重启通常仍保留 writable layer，但删除并重建容器会丢失该根。饮食数据库和 authority secret 都在其中，风险等级应视为 P0 数据持久化问题。

**修复方向**

- Docker/OpenClaw 默认建议使用 `/home/node/.openclaw/diet-manager-data`，或要求显式选择另一个已经验证的 bind/volume 路径。
- 安装前读取容器 mount 表，验证 `official_data_root` 的最长挂载前缀；若落在 overlay，则拒绝安装或要求明确的高风险确认。
- 五号后续实际迁移必须走“停止写入 → 备份 → 初始化持久根 → 校验恢复 → 更新配置 → 重启健康检查 → 保留旧根回退”的事务流程。本报告不执行该迁移。

### 6. Linux 下 12 项测试失败

**现场结果**

- `pnpm test`：60 个测试文件中 4 个失败、55 个通过、1 个跳过。
- 1101 项测试中 12 个失败、1086 个通过、3 个跳过。
- 另有 `install-lifecycle.test.ts` 和 `release-scripts.test.ts` 在加载阶段因找不到 PowerShell 7 失败，未计入 12 个具体 test case。
- `pnpm build` 成功；OpenClaw plugin build、build check、validate 均成功。

**分类：测试跨平台缺陷，不能笼统表述为“核心业务全部通过”。**

具体问题：

1. `tests/acceptance/openclaw-core.test.ts` 在 Linux 仍执行“Windows 路径仅大小写变化应视为同一物理根”，把真实 Linux 路径转为大写后当然变成另一条路径。
2. `tests/acceptance/pantry-catalog.test.ts` 写死开发机 Windows Node 路径，并使用 Windows PowerShell 检查子进程。
3. `shared/tests/validate-sel-pantry-roots.mjs` 直接依赖 PowerShell、Kernel32 和 `ReadDirectoryChangesW`，代码明确拒绝非 `win32` 平台；相关用例却没有在 Linux 跳过或分组。
4. `tests/install-lifecycle.test.ts`、`tests/release-scripts.test.ts` 在缺少 `pwsh` 时直接抛错，并带有特定 Windows 用户目录 fallback。
5. `package.json` 的默认 `pnpm test` 混合了平台无关业务测试和 Windows 专用门禁，导致 Linux 用户无法从汇总中分辨产品回归失败与平台门禁未适用。

**修复方向**

- 将 Windows 专用门禁显式分组为 `test:windows`，只在 Windows CI 运行；Linux 默认运行 `test:portable`。
- 对真正应跨平台的逻辑提供 POSIX 实现/测试，不以“跳过”永久替代功能。
- 所有运行时路径从 `process.execPath`、命令探测或测试参数取得，删除开发者个人绝对路径。
- Windows 大小写测试仅在 `win32` 运行；Linux 增加“大小写不同路径是不同根”的对照测试。
- 汇总报告分别列出 portable pass、Windows-only skipped、真实 failed，禁止把 12 项环境失败吞成全绿。

### 7. 用户最终只看到超时

**现场证据**

- 会话开始于 04:13:43Z，最后记录于 04:23:43Z，约 600 秒。
- 五号配置的 agent timeout 为 600 秒。
- 最后一条 assistant 记录没有正文；稳定路径重新注册成功后，代理没有机会发送用户可见总结。
- 会话内重复跑了两遍完整测试，并做了多次被无效配置阻断的 config/doctor 尝试。

**分类：OpenClaw 会话超时行为 + 自助安装流程缺乏时间预算和阶段回执。**

这不是 Diet Manager 工具调用的业务超时。代理完成了大部分安装工作，但在硬会话截止点被终止，用户无法知道成功到哪一步、残留风险是什么。

**修复方向**

- 默认安装只做候选哈希、依赖/运行时预检、插件校验、安装、持久化检查和一条冒烟；完整 1101 项测试改为显式 `--full-verify`。
- 每个阶段设置独立超时并保留安装状态文件；重入时从安全阶段恢复，而不是从头再跑。
- 代理/文档要求在长测试前先返回阶段状态；接近总预算时优先输出当前结论和回滚信息。
- Shell 命令不得用 `command | tail; echo exit=$?` 判断前置命令成功，因为取得的是管道末端状态；使用 `pipefail` 或先保存真实退出码。

## 三、需要修改的具体仓库文件

| 优先级 | 文件 | 问题 | 计划修改 |
|---|---|---|---|
| P0 | `README.md` | 普通安装和开发 `--link` 混在一起；无 Linux/Docker 持久化流程；版本说明滞后 | 拆成“最终用户安装”和“开发链接”；首选 candidate zip 非链接安装；增加 SHA 校验、配置/初始化顺序、持久卷检查、失败恢复和 Linux/Docker 示例。 |
| P0 | `0.2.0/README.md`（0.2.1 发布时同步到新版本 README） | 只告诉用户候选包在哪里，没有端到端安装步骤 | 增加机器可读候选信息及一条安全安装流程；说明 0.2.0 尚未正式晋级时的风险。 |
| P0 | `version-b-lite-plugin/scripts/modules/DietManagerInstall.psm1` | 硬编码 0.1.1；依赖 `cmd.exe`；升级先链接 staging 后移动；使用 `--link`；未验证容器持久卷 | 从 manifest/plugin JSON 派生版本；移除 `cmd.exe`；先切换最终路径再注册；支持 zip 复制安装；增加持久化根检测、配置快照、原子回滚和真实退出码。 |
| P0 | `version-b-lite-plugin/scripts/install-diet-manager.ps1` | 对 Linux/Docker 可用性表达不清，参数不足以约束持久路径 | 明确支持矩阵；新增候选包/哈希输入、非链接安装模式、持久化确认和阶段超时参数；失败输出可恢复阶段。 |
| P0 | 新增 `version-b-lite-plugin/scripts/install-diet-manager.mjs`（推荐）或等价 POSIX 入口 | Linux 容器没有受支持的一键安装器 | 使用 Node 24 实现跨平台下载/校验/初始化/配置/安装编排；复用 admin CLI，不复制业务逻辑。若不新增，则必须证明 PowerShell 7 + 模块在 Linux 全通过并移除 Windows API 依赖。 |
| P1 | `version-b-lite-plugin/scripts/install-local.ps1` | 开发命令容易被普通用户/代理误用；允许临时路径 | 输出醒目开发警告；默认拒绝系统临时目录；仅显式 `-AllowEphemeralLink` 时允许；不再作为 README 的普通安装入口。 |
| P1 | `version-b-lite-plugin/package.json` | `install:local` 命名含糊；默认 test 混合平台门禁 | 重命名/新增 `install:dev-link`、`install:product`、`test:portable`、`test:windows`、`test:full`；保留兼容别名时给弃用提示。 |
| P1 | `version-b-lite-plugin/tests/install-lifecycle.test.ts` | 缺 pwsh 即加载失败；含个人 Windows fallback | 删除个人路径；基于能力检测进行明确 skip，或移入 Windows job；新增 Linux/Node 安装器生命周期测试。 |
| P1 | `version-b-lite-plugin/tests/release-scripts.test.ts` | 同上 | 同上，并让发布脚本测试在支持的平台必须执行、在不支持的平台明确报告 skipped。 |
| P1 | `version-b-lite-plugin/tests/acceptance/pantry-catalog.test.ts` | 写死 Windows Node/PowerShell；Windows native 用例在 Linux 执行 | 用 `process.execPath`；Windows native 组使用 `describe.runIf(process.platform === "win32")`；为平台无关的目录身份逻辑增加 POSIX 测试。 |
| P1 | `shared/tests/validate-sel-pantry-roots.mjs` | 直接依赖 Kernel32/PowerShell，非 Windows 必然拒绝 | 将 Windows native guard 拆为独立 backend；主验证器显式选择平台实现。若 0.2.1 不实现 POSIX backend，则返回清晰 `SKIPPED_WINDOWS_ONLY`，不能伪装成产品失败。 |
| P1 | `version-b-lite-plugin/tests/acceptance/openclaw-core.test.ts` | Windows 路径大小写用例在 Linux 错跑 | Windows 条件运行；增加 Linux 大小写敏感对照。 |
| P1 | 新增 `.github/workflows/ci.yml` | 当前缺少可见的 Windows/Linux 矩阵门禁 | Linux 跑 portable/build/plugin validate；Windows 跑 portable + Windows native + install/release 生命周期；两类结果分别汇报。 |
| P2 | `docs/evidence/EV-20260820-045-github-link-install.md` | 结论容易被理解成所有实例都可直接自助安装；未覆盖 05 的 web_fetch、临时 link、overlay 数据根 | 追加适用边界或新增替代证据：区分“raw zip 手工编排已验证”与“代理自助安装尚未闭环”。保留原证据不可变时，以新证据 supersede，不改历史事实。 |

## 四、推荐的 0.2.1 安装流程

1. 获取小型安装清单，确定 candidate URL、版本、字节数和 SHA-256。
2. 下载到临时文件并校验哈希；不从临时目录做 `--link`。
3. 检测 OpenClaw/Node 版本、插件冲突、可用磁盘和持久挂载。
4. 选择位于持久挂载内的程序根、数据根、备份根；容器 overlay 默认拒绝。
5. 解包到 staging，校验插件清单和 dist；用 admin CLI 初始化或备份/恢复数据根。
6. 先把程序 staging 原子切到最终版本目录，再执行非链接安装，或仅在最终目录执行稳定 link。
7. 写入 `official_data_root`、启用插件、重启并检查 health/plugin inspect。
8. 删除下载临时文件，确认删掉后插件仍能加载；重启容器后再次确认。
9. 只跑有界的安装冒烟。完整测试由显式全量验证开关触发，并按平台分组。
10. 输出安装回执：版本、候选哈希、稳定来源、持久数据根、验证结果和回滚位置；不含任何凭据。

## 五、修复验收标准

- 在一个与五号相同挂载拓扑的全新 Linux 容器中，仅凭 GitHub 仓库 URL 可以完成安装，不需要人工编辑 `openclaw.json`。
- 模拟 `web_fetch` 被阻止时，安装器能使用 git/raw 安全降级并完成 SHA 校验。
- 安装过程中不存在指向 `/tmp` 或 staging 的最终插件路径。
- 删除下载目录、重启网关、删除并重建容器后，插件仍加载，数据与 authority secret 仍存在于持久卷。
- `doctor` 不是安装成功的必要恢复步骤；人为制造旧 link 时，安装器能给出确定性恢复或回滚。
- Linux portable 测试零真实失败；Windows-only 测试明确跳过并在 Windows CI 单独全绿。
- 安装默认路径在 600 秒总会话预算内完成并返回最终回执；全量测试不会阻塞安装结果回报。

## 六、五号当前处置建议

五号当前插件来源已经位于持久挂载，容器也处于 healthy，可暂时保持不动。下一步真正修复应先为 overlay 数据根制作可验证备份，再迁移到 `/home/node/.openclaw` 下的专用持久目录。由于该操作涉及数据库与 authority secret，本调查未执行；应在安装器修复或专用迁移脚本经过测试后单独实施。
