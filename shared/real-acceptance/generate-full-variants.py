#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
饮食管家 B 0.2.0 全量 16 场景验收：按网关生成「内容变体」场景集。

设计原则（用户 2026-08-20 指示）：并行多设备测试里，场景结构（断言「公式」）保持
不变，但每台网关的输入内容（「数值/食物」）必须各不相同——如数学题「公式不变、数字变」，
以证明能力跨内容泛化，而非 7 台设备复读同一句输入。

基座 = scenarios-0.2.0.json（全量 16 场景目录，已修正断言：
  - nutrition-* 断言收紧为 source_type=authoritative_public_database；
  - query-progress-bar 移除 snapshot_equality 文本等值断言）。
对每个网关 g ∈ 1..7 生成 scenarios-0.2.0-full-gw0g.json，仅替换 content 键，
其余（id/category/expected_outcome_status/database_assertions）原样保留。

相对 generate-smoke-variants.py 的差异：覆盖全量 16 场景（新增 8 个冒烟外的场景）：
  profile-default-state（缺省维持，身高/体重变）/ goal-clear-protein（清除维度，setup 档案变）
  / restore-already-active（幂等忽略，食物变）/ nutrition-banana（香蕉，数量变）
  / nutrition-missing-key|offline|timeout（离线三态，饮品变）/ correction-undo（撤销回归，食物变）。
内容全部落在离线 USDA bundle 内，保证 source_type 恒为 authoritative_public_database。
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "scenarios-0.2.0.json")

# 每项 7 个变体，索引 0..6 对应 gw01..gw07。
PROFILES = [
    "身高180体重70公斤男30岁减脂",
    "身高175体重65公斤女28岁减脂",
    "身高170体重80公斤男35岁增肌",
    "身高165体重55公斤女25岁减脂",
    "身高182体重75公斤男40岁增肌",
    "身高168体重60公斤女32岁减脂",
    "身高178体重72公斤男38岁减脂",
]
# 缺省状态档案：只给身高/体重，无性别/年龄/减脂增肌状态 → 派生默认 maintain。
DEFAULT_PROFILES = [
    "我身高165体重55公斤",
    "我身高175体重65公斤",
    "我身高170体重80公斤",
    "我身高160体重52公斤",
    "我身高182体重75公斤",
    "我身高168体重60公斤",
    "我身高178体重72公斤",
]
CALORIES = [
    "热量目标1800千卡", "热量目标1900千卡", "热量目标2100千卡",
    "热量目标2000千卡", "热量目标2300千卡", "热量目标2200千卡", "热量目标2400千卡",
]
# 清除单项目标维度的 setup 档案（无「我」、无状态，仅身高/体重 → 派生六目标后清蛋白）。
GOAL_CLEAR_SETUP = [
    "身高180体重70公斤",
    "身高175体重65公斤",
    "身高170体重80公斤",
    "身高165体重55公斤",
    "身高182体重75公斤",
    "身高168体重60公斤",
    "身高178体重72公斤",
]
WATER_GOAL = [1000, 1200, 900, 1100, 1300, 800, 1400]
NUTRITION_DRINK = [
    "吃了200毫升牛奶。", "吃了250毫升牛奶。", "吃了300毫升豆浆。",
    "吃了350毫升豆浆。", "吃了400毫升牛奶。", "吃了450毫升牛奶。", "吃了500毫升豆浆。",
]
# 香蕉离线命中：固定食物（香蕉，DEC-032 核心断言项），仅数量变。
BANANA_QTYS = [
    "吃了两个香蕉。", "吃了一个香蕉。", "吃了三个香蕉。",
    "吃了两个香蕉。", "吃了一个香蕉。", "吃了三个香蕉。", "吃了两个香蕉。",
]
FOODS = ["苹果", "鸡蛋", "香蕉", "苹果", "鸡蛋", "香蕉", "苹果"]


def apply_profile(sc, i):
    sc["input"] = PROFILES[i]


def apply_default_profile(sc, i):
    sc["input"] = DEFAULT_PROFILES[i]


def apply_calorie(sc, i):
    sc["input"] = CALORIES[i]


def apply_goal_clear(sc, i):
    sc["setup"] = [GOAL_CLEAR_SETUP[i]]


def apply_water(sc, i):
    w = WATER_GOAL[i]
    sc["setup"] = ["饮水目标%d毫升" % w, "喝了%dml白水" % (w // 2)]


def apply_nutrition_drink(sc, i):
    sc["input"] = NUTRITION_DRINK[i]


def apply_banana_qty(sc, i):
    sc["input"] = BANANA_QTYS[i]


def apply_restore_food(sc, i):
    sc["setup"] = ["吃了一个%s。" % FOODS[i], "撤销刚才那条饮食记录。"]


def apply_restore_idempotent(sc, i):
    sc["setup"] = ["吃了一个%s。" % FOODS[i]]


def apply_meal_food(sc, i):
    sc["input"] = "早餐吃了一个%s。" % FOODS[i]


def apply_plan_food(sc, i):
    sc["input"] = "我计划明天早餐吃一个%s。" % FOODS[i]


def apply_correction_undo(sc, i):
    sc["setup"] = ["早餐吃了一个%s。" % FOODS[i]]


VARIANT = {
    "REAL-0.2.0-profile-set": apply_profile,
    "REAL-0.2.0-profile-default-state": apply_default_profile,
    "REAL-0.2.0-goal-set-calorie": apply_calorie,
    "REAL-0.2.0-goal-clear-protein": apply_goal_clear,
    "REAL-0.2.0-query-progress-bar": apply_water,
    "REAL-0.2.0-restore-record": apply_restore_food,
    "REAL-0.2.0-restore-already-active": apply_restore_idempotent,
    "REAL-0.2.0-nutrition-hit": apply_nutrition_drink,
    "REAL-0.2.0-nutrition-banana": apply_banana_qty,
    "REAL-0.2.0-nutrition-missing-key": apply_nutrition_drink,
    "REAL-0.2.0-nutrition-offline": apply_nutrition_drink,
    "REAL-0.2.0-nutrition-timeout": apply_nutrition_drink,
    "REAL-0.2.0-meal-single": apply_meal_food,
    "REAL-0.2.0-zero-write-plan": apply_plan_food,
    "REAL-0.2.0-correction-undo": apply_correction_undo,
    # REAL-0.2.0-inventory-unique：回归基线，内容固定（"买了一瓶牛奶。"），不随网关变化。
}


def main():
    with open(BASE, "r", encoding="utf-8") as f:
        base = json.load(f)
    scenarios = base["scenarios"]
    by_id = {sc["id"]: sc for sc in scenarios}
    # 校验：基座 16 场景全部命中 VARIANT 或固定项；VARIANT 无遗漏。
    all_ids = set(by_id)
    fixed = {"REAL-0.2.0-inventory-unique"}
    covered = set(VARIANT) | fixed
    missing = [k for k in VARIANT if k not in by_id]
    uncovered = sorted(all_ids - covered)
    if missing:
        sys.stderr.write("MISSING_SCENARIO:%s\n" % ",".join(missing))
        sys.exit(1)
    if uncovered:
        sys.stderr.write("UNVARIED_SCENARIO:%s\n" % ",".join(uncovered))
        sys.exit(1)
    if len(all_ids) != 16:
        sys.stderr.write("EXPECT_16_GOT_%d\n" % len(all_ids))
        sys.exit(1)
    for i in range(7):
        gw = "0%d" % (i + 1)
        out = copy.deepcopy(base)
        out["description"] = (
            "饮食管家 B 0.2.0 全量 16 场景验收（网关 %s 内容变体）。"
            "断言「公式」与基座 scenarios-0.2.0.json 完全一致，仅输入「数值/食物」按网关变化。"
            "离线营养零 key 零网络零代理命中。gw01..gw07 各跑一份。" % gw
        )
        for sc in out["scenarios"]:
            fn = VARIANT.get(sc["id"])
            if fn is not None:
                fn(sc, i)
        path = os.path.join(HERE, "scenarios-0.2.0-full-gw%s.json" % gw)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print("WROTE %s" % os.path.basename(path))


if __name__ == "__main__":
    main()
