import copy
import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = ROOT / "real-acceptance" / "generate-full-variants.py"
BASE_PATH = ROOT / "real-acceptance" / "scenarios-0.2.0.json"


def load_generator():
    spec = importlib.util.spec_from_file_location("generate_full_variants", GENERATOR_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def dialogue_text(scenario):
    turns = [*scenario.get("setup", []), scenario["input"]]
    return "\n".join(turns)


class NaturalFullVariantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generator = load_generator()
        cls.base = json.loads(BASE_PATH.read_text(encoding="utf-8"))

    def build(self, index):
        return self.generator.build_variant(copy.deepcopy(self.base), index)

    def test_only_dialogue_content_and_description_change(self):
        variant = self.build(0)
        self.assertEqual(len(variant["scenarios"]), 16)
        for baseline, changed in zip(self.base["scenarios"], variant["scenarios"]):
            baseline_fixed = {k: v for k, v in baseline.items() if k not in {"input", "setup"}}
            changed_fixed = {k: v for k, v in changed.items() if k not in {"input", "setup"}}
            self.assertEqual(baseline_fixed, changed_fixed, baseline["id"])

    def test_first_five_gateways_use_distinct_dialogue_for_every_scenario(self):
        variants = [self.build(i) for i in range(5)]
        for scenario_index in range(16):
            texts = {dialogue_text(v["scenarios"][scenario_index]) for v in variants}
            self.assertEqual(len(texts), 5, variants[0]["scenarios"][scenario_index]["id"])

    def test_dialogue_avoids_test_harness_and_directive_shorthand(self):
        banned = {
            "diet_manager",
            "record_meal",
            "query_daily_summary",
            "热量目标",
            "查询今天进度",
            "清除蛋白质目标",
            "撤销刚才那条饮食记录",
            "恢复刚才那条饮食记录",
        }
        for index in range(5):
            for scenario in self.build(index)["scenarios"]:
                text = dialogue_text(scenario)
                for phrase in banned:
                    self.assertNotIn(phrase, text, f"{scenario['id']} contains {phrase}")

    def test_dialogue_has_daily_conversation_markers(self):
        markers = ("我", "刚", "今天", "明天", "这会儿", "其实", "麻烦", "好像", "先")
        for index in range(5):
            marked = sum(
                any(marker in dialogue_text(scenario) for marker in markers)
                for scenario in self.build(index)["scenarios"]
            )
            self.assertGreaterEqual(marked, 14)


if __name__ == "__main__":
    unittest.main()
