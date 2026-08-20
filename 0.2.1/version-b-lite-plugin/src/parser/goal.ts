import type {
  CoreGoalCommandCandidate,
  CoreParseInput,
  CoreParseResult,
} from "./types.js";

const PARSER_VERSION = "diet-manager/core-parser-v1" as const;

// 有界六项目标语法：<维度>目标<数值>、每天<维度>按<数值>算，或
// 清除/取消/删除/重置<维度>目标，任意子集可并写。
// null（清除）以清除标记识别；数值为 1–6 位整数或最多两位小数（正数，越界交由领域校验）。
// 同一维度同时出现设置和清除时 fail-closed；维度已点名但既无数值也无清除标记时，
// 返回 goal_incomplete 澄清而非静默丢弃。普通饮食中的营养词不会单独触发目标解析。

const CLEAR_MARKER = "清除|取消|删除|重置";
const GOAL_NUMBER = String.raw`(\d{1,6}(?:\.\d{1,2})?)`;

type GoalField =
  | "energy_kcal"
  | "protein_g"
  | "fat_g"
  | "carbohydrate_g"
  | "fiber_g"
  | "water_ml";

interface GoalDimensionSpec {
  readonly field: GoalField;
  readonly keywords: readonly string[];
}

const GOAL_DIMENSIONS: readonly GoalDimensionSpec[] = [
  { field: "energy_kcal", keywords: ["热量", "卡路里"] },
  { field: "protein_g", keywords: ["蛋白质", "蛋白"] },
  { field: "fat_g", keywords: ["脂肪"] },
  { field: "carbohydrate_g", keywords: ["碳水化合物", "碳水"] },
  { field: "fiber_g", keywords: ["膳食纤维", "纤维"] },
  { field: "water_ml", keywords: ["饮水", "喝水", "水"] },
];

function escapeRegex(keyword: string): string {
  return keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

type GoalExtraction = { readonly value: number | null } | "incomplete" | null;

function extractGoal(source: string, spec: GoalDimensionSpec): GoalExtraction {
  const keywords = spec.keywords.map(escapeRegex).join("|");
  const clearBefore = new RegExp(`(?:${CLEAR_MARKER})\\s*(?:${keywords})\\s*目标`, "u");
  const clearAfter = new RegExp(`(?:${keywords})\\s*目标\\s*(?:${CLEAR_MARKER})`, "u");
  const setAfter = new RegExp(`(?:${keywords})\\s*目标\\s*${GOAL_NUMBER}`, "u");
  const dailySet = new RegExp(
    `每天\\s*(?:${keywords})\\s*(?:先\\s*)?按\\s*${GOAL_NUMBER}\\s*(?:大卡|千卡|毫升|ml|ML)?\\s*(?:算|定)`,
    "u",
  );
  const naturalClearAfter = new RegExp(
    `(?:${keywords})(?:\\s*这一栏)?\\s*(?:暂时|先)?\\s*(?:(?:不用|不需要|不要|不)(?:\\s*给我)?\\s*(?:设|定)|(?:去掉|清掉|取消))`,
    "u",
  );
  const naturalClearBefore = new RegExp(
    `(?:去掉|清掉|取消)\\s*(?:${keywords})(?:\\s*目标)?`,
    "u",
  );
  const incomplete = new RegExp(`(?:${keywords})\\s*目标`, "u");

  const clearMatched = clearBefore.test(source) || clearAfter.test(source) ||
    naturalClearAfter.test(source) || naturalClearBefore.test(source);
  const setMatch = setAfter.exec(source) ?? dailySet.exec(source);
  const setValue = setMatch?.[1] === undefined ? null : Number(setMatch[1]);

  if (clearMatched && setValue !== null) return "incomplete";
  if (clearMatched) return { value: null };
  if (setValue !== null) return { value: setValue };
  if (incomplete.test(source)) return "incomplete";
  return null;
}

function frozenRecord<const T extends object>(entries: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), entries)) as Readonly<T>;
}

/**
 * 解析有界六项目标命令。只有规范目标、每日设定或有界清除形式才介入；
 * 无任何目标操作证据则返回 undefined，交由既有解析器判定。
 */
export function parseGoalCommand(
  input: Readonly<CoreParseInput>,
): CoreParseResult | undefined {
  const source = input.source_text.trim();

  const overrides: Record<string, number | null> = Object.create(null);
  let incomplete = false;
  let recognized = false;

  for (const spec of GOAL_DIMENSIONS) {
    const extraction = extractGoal(source, spec);
    if (extraction === null) continue;
    recognized = true;
    if (extraction === "incomplete") {
      incomplete = true;
      continue;
    }
    overrides[spec.field] = extraction.value;
  }

  if (!recognized) return undefined;
  if (incomplete || Object.keys(overrides).length === 0) {
    return frozenRecord({
      disposition: "needs_clarification",
      action: "set_goal",
      reason_code: "goal_incomplete",
      question: "请说明要设置或清除的目标维度和数值。",
    });
  }

  const command: CoreGoalCommandCandidate = {
    action: "set_goal",
    operation_id: input.operation_id,
    source_text: input.source_text,
    parser_version: PARSER_VERSION,
    goals: overrides as CoreGoalCommandCandidate["goals"],
  };
  return frozenRecord({ disposition: "candidate", command: frozenRecord(command) });
}
