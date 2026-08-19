# 0.2.0 交接归档（含代码）

本文件夹是 **0.2.0（记录与回顾助手首个增量）** 的完整交接归档——**文档 + 源码 + 冻结候选包**三样齐备，后来者无需翻仓库其它地方即可接手。

## 文件夹结构

```
0.2.0/
├── README.md               ← 本文件（导航）
├── 交接文档.md             ← 核心交接文档（开发/维护/测试思路 + 问题清单 + 约束 + 续跑步骤）
├── source/                 ← 源码快照（git archive HEAD，含 version-b-lite-plugin + shared，共 324 文件）
│   ├── version-b-lite-plugin/   （src / tests / skills / scripts / dist / 配置）
│   └── shared/                  （contracts / tests / real-acceptance / 营养来源注册表）
└── candidate-010/          ← 冻结候选产物（真正要发布的 skill 包）
    ├── diet-manager-b-0.2.0.zip   （84 文件：dist + skills/diet-manager-b/SKILL.md + 安装脚本）
    ├── MANIFEST.json / SBOM.json / FILES.SHA256 / CHANGELOG.md / README.md
    └── artifacts/diet-manager-b-0.2.0.zip
```

## 来源溯源

| 内容 | 来源 | 校验 |
|---|---|---|
| `交接文档.md` / `README.md` | 本次（2026-08-20）编写 | commit `637bf28` |
| `source/` | `git archive HEAD @ 637bf28`，只含已跟踪文件 | 产品代码与 candidate-010 的 source_commit `9292579` 一致；`shared/real-acceptance/` 含 candidate 之后新增的验收资产 |
| `candidate-010/` | 冻结候选构建产物 | zip SHA-256 `762027A2B3CE57F9BC6F3A79A2E939D59CCD0383E0313104039C89C4FA9F2315`，与台账 `PRODUCT-0.2.0-ledger.json` 逐字一致 |

> 快照与候选包**均不含任何 secret**（已扫描无 `.env`/`.pem`/`.key`/`.p12`/`.pfx`；候选 zip 内无 secret 文件）。

## 一句话当前状态（2026-08-20）

0.2.0 首个增量（个人档案 + 六项目标 + 进度条 + 撤销恢复 + 离线营养）**开发已完成并归档**：三个 DEC 全部切片 DONE，candidate-010 通过构建+字节校验，7 网关 × 8 场景真实验收 **56/56 全绿**。**尚未发布**——全量 16 场景验收与「晋级 releases/v0.2.0 + tag」都停在等用户签收状态。

## 从哪看起

- 想了解全貌 → 读 `交接文档.md` §1「当前状态速览」。
- 想接手开发 → 读 `交接文档.md` §9「下一个 AI 的开工步骤」；代码在 `source/`。
- 想要可安装的 skill 包 → `candidate-010/artifacts/diet-manager-b-0.2.0.zip`。
- 权威需求仍是仓库根 `../饮食管家-开发约束与需求-v1.0.md`，机器台账是 `../docs/work-items/PRODUCT-0.2.0-ledger.json`。
