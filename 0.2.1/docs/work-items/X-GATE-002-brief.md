# X-GATE-002 Brief

## 范围

本门只验证B纵向切片、故障闭环、冻结CONTRACT-v2、`official_data_root`和后续任务路径绑定。仓库跟踪相对模板；本机绝对map必须保持Git忽略，且只在八项有界预检全部通过后以原子no-replace方式生成。

case_assertion_paths:
  CASE-POLICY-001:
    - shared/tests/validate-x-gate-002.mjs
    - docs/work-items/X-GATE-002-matrix.json
  CASE-POLICY-002:
    - shared/tests/validate-x-gate-002-review.mjs
    - shared/selected-route-map.template.json
  CASE-EFFECT-001:
    - docs/evidence/EV-20260812-031-b-slice-001.md
    - docs/evidence/EV-20260812-032-b-fault-001.md
  CASE-EFFECT-003:
    - docs/evidence/EV-20260812-031-b-slice-001.md
    - docs/evidence/EV-20260812-032-b-fault-001.md
  CASE-STORAGE-006:
    - docs/evidence/EV-20260812-030-x-gate-001.md
    - docs/evidence/EV-20260812-032-b-fault-001.md
  CASE-STORAGE-007:
    - docs/evidence/EV-20260812-030-x-gate-001.md
    - docs/evidence/EV-20260812-032-b-fault-001.md

## 完成条件

- CONTRACT-v2、B路线、四项前置、21任务/43路径和正式build回执逐字段绑定。
- 八项实际检查全部`exit 0`；失败、碰撞或reparse都不得留下新的有效map。
- 两名独立复核者均给出P0/P1/P2=0、Ready=YES。
- 结果最多只授权`SEL-CORE-001`，不得声称产品可用、可安装、可发布或远程OpenClaw已验收。
