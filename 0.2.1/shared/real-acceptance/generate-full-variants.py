#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate natural-language variants for the 0.2.0 full acceptance catalog.

The business oracle stays frozen: scenario ids, categories, expected statuses,
and database assertions are copied as JSON values. Only setup/input dialogue
changes between gateways.
"""
import copy
import json
import os
import sys


HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "scenarios-0.2.0.json")


# Keep seven variants for compatibility. The current five-gateway run uses 0..4.
NATURAL_DIALOGUES = {
    "REAL-0.2.0-profile-set": [
        {"input": "我最近想减脂，男，30岁，身高180，体重70公斤。"},
        {"input": "想开始减脂了，我28岁女生，175高，65公斤。"},
        {"input": "我35岁，男，身高170体重80公斤，最近准备增肌。"},
        {"input": "我25岁女生，165厘米、55公斤，想减点脂。"},
        {"input": "我40岁男，182高75公斤，这阵子主要想增肌。"},
        {"input": "我32岁女生，168厘米60公斤，最近在减脂。"},
        {"input": "我38岁男，178高72公斤，接下来想减脂。"},
    ],
    "REAL-0.2.0-profile-default-state": [
        {"input": "先记下我的基础情况吧，我165高，55公斤。"},
        {"input": "我的身高是175，体重差不多65公斤。"},
        {"input": "我170厘米，最近称是80公斤。"},
        {"input": "我身高160，体重52公斤左右。"},
        {"input": "基础数据补一下，我182高，75公斤。"},
        {"input": "我168厘米，体重60公斤。"},
        {"input": "先把身高体重填上，我178高72公斤。"},
    ],
    "REAL-0.2.0-goal-set-calorie": [
        {"input": "我一天大概控制在1800大卡吧。"},
        {"input": "以后每天热量按1900大卡算就行。"},
        {"input": "我想把每天吃的量控制在2100千卡左右。"},
        {"input": "先按一天2000大卡来安排吧。"},
        {"input": "每天给我按2300千卡来算。"},
        {"input": "我每天想控制在2200大卡上下。"},
        {"input": "接下来一天就按2400千卡吧。"},
    ],
    "REAL-0.2.0-goal-clear-protein": [
        {"setup": ["先把我的情况补上，我180高70公斤。"], "input": "蛋白质那项先别设了，帮我去掉吧。"},
        {"setup": ["我175厘米，体重65公斤。"], "input": "蛋白质这一栏暂时不用给我定。"},
        {"setup": ["我的身高170，体重80公斤。"], "input": "先把蛋白质那一项取消掉。"},
        {"setup": ["我165高，55公斤。"], "input": "蛋白质先留空吧，其他照旧。"},
        {"setup": ["我182厘米75公斤。"], "input": "暂时别给我算蛋白质那项了。"},
        {"setup": ["我168高60公斤。"], "input": "蛋白质这一项先去掉就好。"},
        {"setup": ["我178厘米，72公斤。"], "input": "其他不用动，蛋白质先不设。"},
    ],
    "REAL-0.2.0-query-progress-bar": [
        {"setup": ["我每天水大概想喝1000毫升。", "我刚喝了500毫升白水。"], "input": "我今天水喝到什么程度了？"},
        {"setup": ["每天喝水先按1200毫升算。", "这会儿喝了600毫升矿泉水。"], "input": "今天离喝够水还差多少？"},
        {"setup": ["我一天想喝900毫升水。", "刚喝下450毫升白水。"], "input": "帮我看看今天完成到哪儿了。"},
        {"setup": ["每天水按1100毫升吧。", "我刚才喝了550毫升纯净水。"], "input": "今天喝水进展怎么样？"},
        {"setup": ["我每天尽量喝1300毫升水。", "现在已经喝了650毫升白水。"], "input": "我今天的进度到一半了吗？"},
        {"setup": ["每天先喝够800毫升。", "刚喝了400毫升矿泉水。"], "input": "今天还剩多少没完成？"},
        {"setup": ["我每天想喝1400毫升水。", "这会儿喝了700毫升白水。"], "input": "看下今天喝得怎么样了。"},
    ],
    "REAL-0.2.0-restore-record": [
        {"setup": ["我刚吃了一个苹果。", "等等，前面那个先不算。"], "input": "算了，苹果那条还是给我保留吧。"},
        {"setup": ["我刚吃了一个鸡蛋。", "刚才鸡蛋那条先取消。"], "input": "我又确认了一下，鸡蛋那条还是算上。"},
        {"setup": ["这会儿吃了一个香蕉。", "先别算刚才那个香蕉。"], "input": "还是算进去吧，香蕉确实吃了。"},
        {"setup": ["我刚吃了一个苹果。", "那个苹果先去掉。"], "input": "不用去掉了，刚才苹果那条留着。"},
        {"setup": ["刚吃了一个鸡蛋。", "先取消刚才那次。"], "input": "想了下还是要算，鸡蛋确实吃了。"},
        {"setup": ["我刚刚吃了一个香蕉。", "香蕉那条先不算。"], "input": "还是放回来吧，我确实吃了。"},
        {"setup": ["这会儿吃了一个苹果。", "先把刚才苹果那条去掉。"], "input": "别去掉了，那条还是有效的。"},
    ],
    "REAL-0.2.0-restore-already-active": [
        {"setup": ["我刚吃了一个苹果。"], "input": "刚才那个苹果还是算上吧。"},
        {"setup": ["我刚吃了一个鸡蛋。"], "input": "鸡蛋那条就继续保留着。"},
        {"setup": ["这会儿吃了一个香蕉。"], "input": "香蕉那个不用改，照常算。"},
        {"setup": ["刚刚吃了一个苹果。"], "input": "苹果那条还是有效的。"},
        {"setup": ["我刚吃了一个鸡蛋。"], "input": "刚才鸡蛋那次还是算进去。"},
        {"setup": ["这会儿吃了一个香蕉。"], "input": "香蕉那条继续留着就好。"},
        {"setup": ["我刚吃了一个苹果。"], "input": "前面那个苹果照旧算上。"},
    ],
    "REAL-0.2.0-nutrition-hit": [
        {"input": "我刚喝了200毫升牛奶。"},
        {"input": "刚才喝了250毫升牛奶。"},
        {"input": "这会儿喝了300毫升豆浆。"},
        {"input": "我刚喝完350毫升豆浆。"},
        {"input": "刚才喝了400毫升牛奶。"},
        {"input": "我这会儿喝了450毫升牛奶。"},
        {"input": "刚喝完500毫升豆浆。"},
    ],
    "REAL-0.2.0-nutrition-banana": [
        {"input": "下午有点饿，我刚吃了两个香蕉。"},
        {"input": "我刚才吃了一个香蕉。"},
        {"input": "这会儿一共吃了三个香蕉。"},
        {"input": "我下午刚吃了两个香蕉。"},
        {"input": "刚刚吃掉一个香蕉。"},
        {"input": "我这会儿吃了三个香蕉。"},
        {"input": "刚才随手吃了两个香蕉。"},
    ],
    "REAL-0.2.0-nutrition-missing-key": [
        {"input": "我刚喝了210毫升牛奶。"}, {"input": "这会儿喝了260毫升牛奶。"},
        {"input": "刚才喝了310毫升豆浆。"}, {"input": "我刚喝完360毫升豆浆。"},
        {"input": "这会儿喝了410毫升牛奶。"}, {"input": "我刚才喝了460毫升牛奶。"},
        {"input": "刚喝了510毫升豆浆。"},
    ],
    "REAL-0.2.0-nutrition-offline": [
        {"input": "刚才那杯牛奶大概220毫升，我喝完了。"}, {"input": "我这会儿喝了270毫升牛奶。"},
        {"input": "刚喝下320毫升豆浆。"}, {"input": "我刚把370毫升豆浆喝完。"},
        {"input": "这会儿喝了420毫升牛奶。"}, {"input": "刚才喝了470毫升牛奶。"},
        {"input": "我刚喝完520毫升豆浆。"},
    ],
    "REAL-0.2.0-nutrition-timeout": [
        {"input": "我刚刚喝了230毫升牛奶。"}, {"input": "刚才喝掉280毫升牛奶。"},
        {"input": "这会儿喝了330毫升豆浆。"}, {"input": "我刚喝完380毫升豆浆。"},
        {"input": "刚刚喝了430毫升牛奶。"}, {"input": "我这会儿喝了480毫升牛奶。"},
        {"input": "刚才喝完530毫升豆浆。"},
    ],
    "REAL-0.2.0-meal-single": [
        {"input": "早上随手吃了一个苹果。"}, {"input": "我早餐刚吃了一个鸡蛋。"},
        {"input": "今天早上吃了一个香蕉。"}, {"input": "我早餐吃了一个苹果。"},
        {"input": "早上刚吃了一个鸡蛋。"}, {"input": "我今天早餐吃了一个香蕉。"},
        {"input": "早饭的时候吃了一个苹果。"},
    ],
    "REAL-0.2.0-inventory-unique": [
        {"input": "我刚买回一瓶牛奶，放家里了。"}, {"input": "今天带回来一盒鸡蛋，先放进库存。"},
        {"input": "我刚买了一袋香蕉放在家里。"}, {"input": "刚带回来一袋苹果，家里现在有了。"},
        {"input": "我今天买了一盒鸡蛋放冰箱。"}, {"input": "刚买回一袋香蕉，先记在家里的东西里。"},
        {"input": "我带回来一袋苹果，已经放好了。"},
    ],
    "REAL-0.2.0-zero-write-plan": [
        {"input": "我想着明天早餐吃个苹果。"}, {"input": "明天早上可能会吃一个鸡蛋。"},
        {"input": "我打算明天早餐吃根香蕉。"}, {"input": "明早我准备吃一个苹果。"},
        {"input": "我计划明天早上吃个鸡蛋。"}, {"input": "明天早餐想吃一个香蕉。"},
        {"input": "我明早大概会吃一个苹果。"},
    ],
    "REAL-0.2.0-correction-undo": [
        {"setup": ["我早上吃了一个苹果。"], "input": "刚才早餐那条不对，先取消掉。"},
        {"setup": ["我早餐刚吃了一个鸡蛋。"], "input": "前面鸡蛋那次算错了，帮我去掉。"},
        {"setup": ["今天早上吃了一个香蕉。"], "input": "刚才香蕉那条先别算了。"},
        {"setup": ["我早餐吃了一个苹果。"], "input": "前面那次苹果不算，麻烦取消。"},
        {"setup": ["早上刚吃了一个鸡蛋。"], "input": "刚才鸡蛋那条有问题，先去掉。"},
        {"setup": ["我今天早餐吃了一个香蕉。"], "input": "香蕉那次先别记了。"},
        {"setup": ["早饭的时候吃了一个苹果。"], "input": "刚才苹果那条不对，帮我取消。"},
    ],
}


def validate_base(base):
    scenarios = base.get("scenarios", [])
    ids = {scenario.get("id") for scenario in scenarios}
    configured = set(NATURAL_DIALOGUES)
    if len(scenarios) != 16:
        raise ValueError("EXPECT_16_GOT_%d" % len(scenarios))
    missing = sorted(ids - configured)
    extra = sorted(configured - ids)
    if missing:
        raise ValueError("UNVARIED_SCENARIO:%s" % ",".join(missing))
    if extra:
        raise ValueError("MISSING_SCENARIO:%s" % ",".join(extra))
    for scenario_id, variants in NATURAL_DIALOGUES.items():
        if len(variants) != 7:
            raise ValueError("EXPECT_7_VARIANTS:%s" % scenario_id)


def build_variant(base, index):
    validate_base(base)
    if index < 0 or index >= 7:
        raise IndexError("GATEWAY_INDEX_OUT_OF_RANGE")
    out = copy.deepcopy(base)
    gateway = "0%d" % (index + 1)
    out["description"] = (
        "饮食管家 B 0.2.0 全量 16 场景自然对话验收（网关 %s）。"
        "业务预期与数据库断言保持不变，仅使用贴近日常使用的多轮口语变体。" % gateway
    )
    for scenario in out["scenarios"]:
        dialogue = NATURAL_DIALOGUES[scenario["id"]][index]
        scenario.pop("setup", None)
        scenario.update(copy.deepcopy(dialogue))
    return out


def main():
    with open(BASE, "r", encoding="utf-8") as handle:
        base = json.load(handle)
    try:
        validate_base(base)
    except ValueError as error:
        sys.stderr.write(str(error) + "\n")
        return 1
    for index in range(7):
        gateway = "0%d" % (index + 1)
        out = build_variant(base, index)
        path = os.path.join(HERE, "scenarios-0.2.0-full-gw%s.json" % gateway)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(out, handle, ensure_ascii=False, indent=2)
        print("WROTE %s" % os.path.basename(path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
