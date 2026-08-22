# 饮食管家通用 Agent Skill 第一版设计

**日期：** 2026-08-21  
**状态：** 用户已确认（方案 A）  
**目标版本：** 0.2.2 后续开发批次  
**已选方向：** 方案 A——通用 Skill + 跨平台 JSON CLI + SQLite 核心

## 1. 目标

把饮食管家恢复为最初定义的 Skill-first 产品：Skill 是智能体入口，现有 SQLite 核心是唯一业务权威，OpenClaw、MCP 和其他智能体平台只提供薄适配层。

第一版完成后，不加载 OpenClaw 的 Agent 也能通过统一 JSON 协议调用饮食管家。Windows、Linux、macOS 使用同一套 Node.js 构建产物和同一份 Skill；平台适配器不得复制解析、校验、营养、库存、事务或 SQLite 逻辑。

## 2. “兼容所有 Agent”的可验证定义

“所有 Agent”按宿主能力分三层，而不是承诺每个聊天界面都原生支持同一种插件格式：

1. 能执行本地命令并交换 JSON 的 Agent，直接调用跨平台 `diet-manager` CLI。
2. 能加载 Node.js 模块的宿主，调用公开执行 API。
3. 只能使用平台工具协议的宿主，通过薄适配器调用同一公开执行 API；0.2.2 保留 OpenClaw 适配器，MCP 适配器属于后续独立批次。

第一版验收至少覆盖第 1、2 层以及现有 OpenClaw 第 3 层。没有命令、模块或工具调用能力的纯聊天界面不在可执行兼容范围内。

## 3. 架构

```text
通用 SKILL.md
      |
      +--> JSON CLI --------------+
      |                            |
      +--> OpenClaw 薄适配器 ------+--> 公共执行边界 --> 现有 CoreRuntime --> SQLite
      |                            |
      `--> 后续 MCP 薄适配器 -------+
```

公共执行边界只负责：

- 严格校验 Agent 命令；
- 将可信宿主上下文与不可信业务命令分离；
- 构造现有 `CoreApplicationRequest`；
- 调用现有 `handleCoreRequestAsync`；
- 使用 `assertDietManagerOutcome` 验证结果。

它不重新实现自然语言解析、语义候选验证、营养解析、库存联动、事务、审计或持久化。

## 4. 公共命令协议

新增冻结协议 `diet-manager/agent-command/v1`。CLI 标准输入每次只接受一个 UTF-8 JSON 对象，标准输出只产生一个 `DietManagerOutcome` JSON 对象和换行。

最小请求示例：

```json
{
  "schema_version": "diet-manager/agent-command/v1",
  "action": "record_meal",
  "source_text": "我吃了两个鸡蛋"
}
```

`record_meal` 可额外携带现有 `semantic_candidate`。第一版支持当前 `dietManagerActions` 中的全部动作：

- `record_meal`
- `record_water`
- `add_inventory`
- `query_inventory`
- `query_meals`
- `query_daily_summary`
- `correct_record`
- `undo_record`
- `set_profile`
- `set_goal`
- `restore_record`

命令协议不接受 `official_data_root`、authority secret、数据库路径、`prior_context`、`received_at`、`operation_id`、`source_message_id` 或 `conversation_id`。出现未知字段时拒绝请求，不能静默忽略。

## 5. 可信上下文

Agent 提供的内容属于不可信业务输入；宿主或 CLI 生成的内容属于调用上下文。两者使用不同类型，不允许一个 JSON 对象混装。

CLI 负责生成：

- `received_at`：执行时的真实时钟；
- `operation_id`：随机 UUID；
- `source_message_id`：本次 CLI 调用的随机 UUID；
- `timezone`：部署配置，第一版只允许 `Asia/Shanghai`；
- `conversation_id`：部署配置中的稳定会话域；未配置时使用该数据根的独立 standalone 会话域；
- `prior_context`：第一版固定为空数组。

OpenClaw 适配器继续使用 OpenClaw 提供的真实消息、调用和会话标识。后续 MCP 适配器使用 MCP 宿主上下文。任何适配器都不能让模型把这些字段伪装成食物、数量、时间或人物证据。

CLI 直接模式每次生成新的消息和操作标识，因此只保证单次调用原子性；具备真实消息 ID 的宿主适配器继续提供跨重试幂等能力。Skill 仍要求每条入站消息至多调用一次。

## 6. 数据根与安全边界

业务 JSON 永远不能指定数据根。CLI 从管理员设置的进程环境或安装配置读取唯一官方数据根，并复用现有根授权、authority secret、SQLite、迁移和 TOCTOU 防护。

第一版配置优先级固定为：显式的管理员进程环境配置优先于安装配置；两者均缺失时启动失败，不在当前目录或 Skill 目录偷偷创建数据库。

标准输出不得包含日志、绝对数据路径、secret、token 或堆栈。配置/协议无法启动时，CLI 在标准错误输出稳定错误码并以非零状态退出；只要成功产生一个结构合法的 `DietManagerOutcome`，CLI 就以 0 退出，业务是否写入由 `committed` 与 `status` 表达。

## 7. Skill 结构

保留一个 Agent 中立的 `skills/diet-manager-b/`：

```text
skills/diet-manager-b/
|-- SKILL.md
|-- agents/openai.yaml
`-- references/
    `-- agent-command-v1.md
```

`SKILL.md` 只描述意图识别、一次调用、原文保真、非事件边界和结果回执规则，不再写死“当前 OpenClaw 入站消息”“OpenClaw 工具调用”或 `diet_manager` 私有工具名。

协议字段、CLI 调用方式、动作表和结果码放入按需读取的 reference。`agents/openai.yaml` 只保留 UI 元数据和默认调用提示，不声明某个平台私有依赖。

Skill 不写 SQLite、不写 JSONL 业务账本、不把记忆或便签当作后备存储。只有核心返回 `committed=true` 才能声称记录成功。

## 8. 代码与包边界

第一版不拆仓库、不重写核心，采用最小边界调整：

- 公开导出 Agent 命令类型、校验器和执行函数；
- 公开导出已有 `createCoreRuntime`、同步/异步处理器以及结果校验器；
- 增加独立 CLI 入口并在 `package.json` 声明 `bin`；
- 将 OpenClaw 默认入口移到明确的 `./openclaw` 子路径或等价独立入口；
- 根包入口不再默认等同于 OpenClaw 插件；
- OpenClaw manifest 继续指向 OpenClaw 入口，避免破坏现有安装；
- 包通过 `exports` 明确区分公共核心、CLI 与 OpenClaw 适配器。

`openclaw` 不能继续作为核心运行所需的 peer dependency；它只属于 OpenClaw 适配器的构建/开发边界。若 npm 的 peer dependency 表达无法在同一包中做到可选，则第一版将其标为 optional peer，并用测试证明无 OpenClaw 安装时核心与 CLI 可以加载。

## 9. 跨平台交付

发布产物包含：

- 编译后的公共核心；
- `diet-manager` CLI；
- 通用 Skill 文件夹；
- OpenClaw 薄适配器；
- 冻结协议说明；
- 不含 `node_modules`、测试数据库、secret 或本机路径的 npm tarball/ZIP。

构建和验证入口使用 Node.js，不以 PowerShell 作为唯一发布条件。现有 Windows OpenClaw 安装器可以继续存在，但不再代表通用 Skill 的唯一安装方式。

第一版运行时继续遵守当前 Node.js `>=24.15.0 <25` 约束；如果后续要降低 Node 版本，应作为 SQLite 兼容性独立批次处理。

## 10. 错误处理

- 非 JSON、超大输入、数组顶层、重复/未知字段或错误 schema：不调用核心，不写数据库，返回稳定协议错误。
- 缺少数据根或数据根安全校验失败：不调用核心，不创建回退数据库。
- 核心返回 `needs_clarification`、`ignored` 或 `failed`：原样输出结构化结果，不重试、不改用其他存储。
- 输出结果未通过 `assertDietManagerOutcome`：视为内部协议故障，不得声称成功。
- 标准输出写入失败或进程被中断：不得用第二次业务提交补偿。

## 11. 第一版验收

必须以 TDD 覆盖：

1. 在未安装 OpenClaw 的环境中导入公共核心成功。
2. CLI 从标准输入接收 `record_meal`，输出一个合法 JSON 结果，并在临时官方根产生一次 SQLite 写入。
3. CLI 可执行只读查询、饮水、库存、更正、撤销、恢复、档案和目标等现有动作。
4. 计划、否定、他人事件、非法语义候选和协议错误均为零业务写入。
5. 请求携带数据根、secret、宿主元数据或未知字段时被拒绝。
6. 标准输出严格只有一条 JSON；诊断走标准错误且不泄露路径或 secret。
7. 相同数据库重启后仍能查询先前提交的记录。
8. Windows 与 Linux 各执行一次真实 CLI 冒烟；macOS 用平台无关测试和 CI 构建约束覆盖，具备环境时补真实冒烟。
9. 现有 OpenClaw 适配器测试保持通过，并证明它调用公共执行边界而非复制业务逻辑。
10. Skill 先做无 Skill 基线行为测试，再做加载 Skill 后的前向测试；至少覆盖写入成功、非事件零调用、失败不兜底三个场景。
11. TypeScript、聚焦测试、相邻测试、发布校验和完整测试套件全部通过。

## 12. 第一版非目标

- 不在本批次实现 MCP server；MCP 是公共执行边界稳定后的下一个薄适配器。
- 不重写现有自然语言解析器、营养系统、库存系统或 SQLite schema。
- 不承诺没有任何工具执行能力的纯聊天界面可以持久化数据。
- 不降低 Node.js 版本要求。
- 不删除现有 Windows/OpenClaw 安装器，只解除它对通用交付的垄断。
- 不把 0.2.2 升级成一次性覆盖全部平台安装器的大型重构。

## 13. 完成定义

在一个没有 OpenClaw 依赖的干净 Linux 或 Windows 测试环境中，Agent 能读取同一份 `diet-manager-b` Skill，通过 `diet-manager` JSON CLI 完成真实记录与查询；结果写入现有 SQLite 核心，进程重启后仍可读取。与此同时，现有 OpenClaw 路径继续工作，且两条路径在相同输入上产生相同的核心结果形状和写入安全边界。
