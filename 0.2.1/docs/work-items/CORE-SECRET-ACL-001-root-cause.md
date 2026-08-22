# CORE-SECRET-ACL-001 根因调查与修复

## 状态

- 调查结论：根因已确认（两层，见下）。
- TDD：已添加最小回归测试并观察到方向正确的 RED，随后修复到 GREEN。
- 修复：已完成并全量验证。
- 外部边界：未连接真实 OpenClaw 实例，未访问正式数据根、配置或密钥。测试仅使用隔离的 `tmpdir()` 根。

## 真实症状

在 **pwsh 7** 下运行全量 vitest，曾出现 45 例失败（同样的命令在 Windows PowerShell 5.1 下全绿）。典型失败：

```text
tests/acceptance/pantry-application.test.ts
> rejects a tampered child purchase fact on finalized replay without another write
AssertionError: expected false to be true
```

追到真实错误码 `CORE_RUNTIME_SECRET_INVALID`，子进程 stderr：

```text
Set-Acl : 在模块"Microsoft.PowerShell.Security"中找不到 Set-Acl 命令，且无法加载该模块。
FullyQualifiedErrorId : CouldNotAutoloadMatchingModule
```

**用户可见影响**：从 pwsh 7 终端启动饮食管家，第一次写入（设置 authority secret 的 ACL）即失败，产品完全不可用。而项目自身的验证器 `validate-product-0.1.ps1` 强制要求 pwsh ≥ 7，因此本缺陷不修，阶段 0 门禁永远出不了门。

## 设计期望

`src/application/core-runtime.ts` 的 `powershell()` 会 spawn Windows PowerShell 5.1，去给 authority secret 文件设置并审计严格 ACL（owner=当前用户、ACL protected、恰好 3 条 FullControl 规则：当前用户 / `S-1-5-18` / `S-1-5-32-544`）。这个审计**必须独立于调用者的 shell**——即不得依赖父进程的 `PSModulePath`，否则从 pwsh 7 启动时 `Get-Acl`/`Set-Acl` 会在子 shell 里消失。

## 根因（两层，缺一不可）

### 第 1 层：PSModulePath 继承污染

`powershell()` 原实现：

```ts
env: { ...process.env, DIET_SECRET_PATH: path },
```

整份继承了父进程环境。父进程是 pwsh 7 时，`PSModulePath` 首位是 pwsh 7 的 **Core-only** `Microsoft.PowerShell.Security`。Windows PowerShell 5.1 命中该首个条目，拒绝加载（`CompatiblePSEditions = @('Core')`），`Get-Acl`/`Set-Acl` 因此从子 shell 消失。

### 第 2 层：Windows 环境变量名大小写陷阱

`{ ...process.env, KEY: value }` 展开得到**大小写敏感**的 JS 对象。若进程已持有大写键 `PSMODULEPATH`（git-bash → node 环境下如此），覆盖会产生**第二个**键，Windows 子进程解析到的是旧的大写键。实测：

```text
ENVKEYS = [["PSMODULEPATH", "<poison>;…"],   ← 原有键，大写
           ["PSModulePath", "<pinned>"]]     ← 覆盖成了第二个键
CHILD_PSMP = <poison>…                        ← 大写那个生效
```

所以仅把 `PSModulePath` 写成钉住值是不够的，必须先按大小写无关剔除同名键。

## TDD RED

新增 `tests/runtime-secret-acl-module-path.test.ts`，构造一个自建的 Core-only `Microsoft.PowerShell.Security.psd1`（`CompatiblePSEditions = @('Core')`）前置到 `PSModulePath`，精确复现"父进程是 pwsh 7"这一条件，且**与机器无关**（在 PS 5.1 下也能红，不依赖本机装了 pwsh 7）。

RED 观察：`Received "CORE_RUNTIME_SECRET_INVALID"`，`expect(outcome).toMatchObject({ committed: true })` 失败——这是行为失败，不是编译/导入/环境错误。

## 生产修复

1. `src/application/core-runtime.ts`
   - 新增 `childEnvironment(overrides)`：先按大小写无关剔除同名键，再套用覆盖值。
   - `powershell()` 改用 `childEnvironment({ PSModulePath: join(shellHome, "Modules"), DIET_SECRET_PATH: path })`，把模块搜索路径钉到 Windows PowerShell 自己的系统模块目录。
   - 为什么"钉住"而非"删除"：删除会让 PS 从注册表重建（也能工作），钉住是确定性的，并顺带阻止用户可写模块目录劫持该审计所依赖的 cmdlet。
2. `tests/acceptance/core-application.test.ts`
   - 该文件的测试辅助函数 `powershell()`（用于独立审计 ACL）有**同一个** `env: { ...process.env, DIET_SECRET_PATH: path }` 缺陷。它是 pwsh 7 下仍剩 3 例失败（`rejects an existing Windows secret granting Everyone read...` 等）的原因。同步修复为 `childEnvironment` + 钉住 `PSModulePath`。

## TDD GREEN 与最终验证

| 项 | 结果 |
|---|---|
| 定向回归 `runtime-secret-acl-module-path.test.ts` | 1 passed |
| 邻接回归（6 文件：authority-round2 / toctou / server-authority / core-application / backup-restore / pantry-application） | 123 passed |
| `core-application.test.ts`（pwsh 7） | 56 passed |
| **全量 vitest（pwsh 7）** | **32 文件 / 960 例 passed**（历史 45 失败） |
| `tsc --noEmit` | exit 0 |

## 工作树约束核对

- 本任务新增：`tests/runtime-secret-acl-module-path.test.ts`、`docs/work-items/CORE-SECRET-ACL-001-root-cause.md`
- 本任务修改：`src/application/core-runtime.ts`、`tests/acceptance/core-application.test.ts`
- 未运行 build、未编辑 dist、未访问正式数据根/密钥。

## 教训

把失败归因给"环境问题"之前，先拿到真实错误码和子进程 stderr。本缺陷一度被误判为"疑似 pwsh 7 环境问题、建议排查 locale"（见 `饮食管家-Codex开发交付说明-v1.0.md` §3.4），实际上它是真实产品缺陷，会让从 pwsh 7 启动的用户完全不可用。
