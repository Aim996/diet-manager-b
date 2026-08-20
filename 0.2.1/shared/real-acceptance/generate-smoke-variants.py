#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
饮食管家 B 0.2.0 多设备同步验收：按网关生成「内容变体」冒烟场景集。

设计原则（用户 2026-08-20 指示）：并行多设备测试里，场景结构（断言「公式」）保持
不变，但每台网关的输入内容（「数值/食物」）必须各不相同——如数学题「公式不变、数字变」，
以证明能力跨内容泛化，而非 7 台设备复读同一句输入。

基座 = scenarios-0.2.0-smoke.json（已修正断言：
  - nutrition-hit 断言收紧为 source_type=authoritative_public_database；
  - query-progress-bar 移除 snapshot_equality 文本等值断言）。
对每个网关 g ∈ 1..7 生成 scenarios-0.2.0-smoke-gw0g.json，仅替换 content 键，
其余（id/category/expected_outcome_status/database_assertions）原样保留。

内容变体覆盖 7 类（离线 USDA bundle 内的食物，保证 source_type 恒为
authoritative_public_database，不引入网络/key/代理）：
  profile / calorie / water / nutrition-drink / meal-food / restore-food / plan-food
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "scenarios-0.2.0-smoke.json")

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
CALORIES = [
    "热量目标1800千卡", "热量目标1900千卡", "热量目标2100千卡",
    "热量目标2000千卡", "热量目标2300千卡", "热量目标2200千卡", "热量目标2400千卡",
]
WATER_GOAL = [1000, 1200, 900, 1100, 1300, 800, 1400]
NUTRITION_DRINK = [
    "吃了200毫升牛奶。", "吃了250毫升牛奶。", "吃了300毫升豆浆。",
    "吃了350毫升豆浆。", "吃了400毫升牛奶。", "吃了450毫升牛奶。", "吃了500毫升豆浆。",
]
FOODS = ["苹果", "鸡蛋", "香蕉", "苹果", "鸡蛋", "香蕉", "苹果"]

# 每个 scenario id 的内容替换函数：输入 (scenario dict, variant idx) -> 就地修改。
def apply_profile(sc, i):
    sc["input"] = PROFILES[i]

def apply_calorie(sc, i):
    sc["input"] = CALORIES[i]

def apply_water(sc, i):
    w = WATER_GOAL[i]
    sc["setup"] = ["饮水目标%d毫升" % w, "喝了%dml白水" % (w // 2)]

def apply_nutrition_drink(sc, i):
    sc["input"] = NUTRITION_DRINK[i]

def apply_restore_food(sc, i):
    sc["setup"] = ["吃了一个%s。" % FOODS[i], "撤销刚才那条饮食记录。"]

def apply_meal_food(sc, i):
    sc["input"] = "早餐吃了一个%s。" % FOODS[i]

def apply_plan_food(sc, i):
    sc["input"] = "我计划明天早餐吃一个%s。" % FOODS[i]

VARIANT = {
    "REAL-0.2.0-profile-set": apply_profile,
    "REAL-0.2.0-goal-set-calorie": apply_calorie,
    "REAL-0.2.0-query-progress-bar": apply_water,
    "REAL-0.2.0-restore-record": apply_restore_food,
    "REAL-0.2.0-nutrition-hit": apply_nutrition_drink,
    "REAL-0.2.0-meal-single": apply_meal_food,
    "REAL-0.2.0-zero-write-plan": apply_plan_food,
    # REAL-0.2.0-inventory-unique：回归基线，内容固定（"买了一瓶牛奶。"），不随网关变化。
}


def main():
    with open(BASE, "r", encoding="utf-8") as f:
        base = json.load(f)
    scenarios = base["scenarios"]
    by_id = {sc["id"]: sc for sc in scenarios}
    missing = [k for k in VARIANT if k not in by_id]
    if missing:
        sys.stderr.write("MISSING_SCENARIO:%s\n" % ",".join(missing))
        sys.exit(1)
    for i in range(7):
        gw = "0%d" % (i + 1)
        out = copy.deepcopy(base)
        out["description"] = (
            "饮食管家 B 0.2.0 多设备同步验收冒烟子集（网关 %s 内容变体）。"
            "断言「公式」与基座完全一致，仅输入「数值/食物」按网关变化。"
            "离线营养零 key 零网络零代理命中。gw01..gw07 各跑一份。" % gw
        )
        for sc in out["scenarios"]:
            fn = VARIANT.get(sc["id"])
            if fn is not None:
                fn(sc, i)
        path = os.path.join(HERE, "scenarios-0.2.0-smoke-gw%s.json" % gw)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print("WROTE %s" % os.path.basename(path))


if __name__ == "__main__":
    main()
