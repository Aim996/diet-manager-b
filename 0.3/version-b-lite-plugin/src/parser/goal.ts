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
const NEXT_GOAL_DIMENSION = String.raw`(?:热量|卡路里|蛋白质|蛋白|脂肪|碳水化合物|碳水|膳食纤维|纤维|饮水|喝水|水)\s*目标`;
const GOAL_TOKEN_END = String.raw`(?=$|[，,。；;、！？!?]|(?:然后|并且|以及)?\s*${NEXT_GOAL_DIMENSION}|(?:吧|呀|啊|呢|哦|就行|即可|算|定|其他不变))`;

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
  readonly unitPattern: string;
}

const GOAL_DIMENSIONS: readonly GoalDimensionSpec[] = [
  { field: "energy_kcal", keywords: ["热量", "卡路里"], unitPattern: String.raw`(大卡|千卡|kcal)?` },
  { field: "protein_g", keywords: ["蛋白质", "蛋白"], unitPattern: String.raw`(克|g)?` },
  { field: "fat_g", keywords: ["脂肪"], unitPattern: String.raw`(克|g)?` },
  { field: "carbohydrate_g", keywords: ["碳水化合物", "碳水"], unitPattern: String.raw`(克|g)?` },
  { field: "fiber_g", keywords: ["膳食纤维", "纤维"], unitPattern: String.raw`(克|g)?` },
  { field: "water_ml", keywords: ["饮水", "喝水", "水"], unitPattern: String.raw`(毫升|ml|升|l)?` },
];

function escapeRegex(keyword: string): string {
  return keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

type GoalExtraction = { readonly value: number | null } | "incomplete" | null;

function normalizedGoalValue(spec: GoalDimensionSpec, raw: string, unit: string | undefined): number {
  const value = Number(raw);
  if (spec.field === "water_ml" && unit !== undefined && /^(?:升|l)$/iu.test(unit)) {
    return value * 1000;
  }
  return value;
}

function extractGoal(
  source: string,
  spec: GoalDimensionSpec,
  allowBareSet: boolean,
): GoalExtraction {
  const keywords = spec.keywords
    .map((keyword) => keyword === "水" ? "(?<!碳)水" : escapeRegex(keyword))
    .join("|");
  const clearBefore = new RegExp(`(?:${CLEAR_MARKER})\\s*(?:${keywords})\\s*目标`, "u");
  const clearAfter = new RegExp(`(?:${keywords})\\s*目标\\s*(?:${CLEAR_MARKER})`, "u");
  const setAfter = new RegExp(
    `(?:${keywords})\\s*目标\\s*(?:(?:改成|调整为)\\s*)?(?:以后\\s*)?(?:每天\\s*)?${GOAL_NUMBER}\\s*${spec.unitPattern}${GOAL_TOKEN_END}`,
    "iu",
  );
  const dailySet = new RegExp(
    `(?:以后\\s*)?每天\\s*(?:${keywords})\\s*(?:先\\s*)?按\\s*${GOAL_NUMBER}\\s*${spec.unitPattern}${GOAL_TOKEN_END}\\s*(?:算|定)`,
    "iu",
  );
  const keywordDailySet = new RegExp(
    `(?:${keywords})\\s*(?:目标\\s*)?(?:就\\s*)?(?:按|改成|调整为)\\s*(?:以后\\s*)?每天\\s*${GOAL_NUMBER}\\s*${spec.unitPattern}${GOAL_TOKEN_END}`,
    "iu",
  );
  const bareSet = allowBareSet
    ? new RegExp(`(?:${keywords})\\s*${GOAL_NUMBER}\\s*${spec.unitPattern}${GOAL_TOKEN_END}`, "iu")
    : null;
  const naturalClearAfter = new RegExp(
    `(?:${keywords})(?:\\s*这一栏)?\\s*(?:暂时|先)?\\s*(?:(?:不用|不需要|不要|不)(?:\\s*给我)?\\s*(?:设|定)|(?:去掉|清掉|取消))`,
    "u",
  );
  const naturalClearBefore = new RegExp(
    `(?:去掉|清掉|取消)\\s*(?:${keywords})(?:\\s*目标)?`,
    "u",
  );
  const incomplete = new RegExp(`(?:${keywords})\\s*目标`, "u");
  const invalidBareSet = allowBareSet
    ? new RegExp(`(?:${keywords})\\s*\\d`, "iu")
    : null;

  const clearMatched = clearBefore.test(source) || clearAfter.test(source) ||
    naturalClearAfter.test(source) || naturalClearBefore.test(source);
  const setMatch = setAfter.exec(source) ?? dailySet.exec(source) ?? keywordDailySet.exec(source) ??
    bareSet?.exec(source) ?? null;
  const setValue = setMatch?.[1] === undefined
    ? null
    : normalizedGoalValue(spec, setMatch[1], setMatch[2]);

  if (clearMatched && setValue !== null) return "incomplete";
  if (clearMatched) return { value: null };
  if (setValue !== null) return { value: setValue };
  if (incomplete.test(source) || invalidBareSet?.test(source)) return "incomplete";
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
  const allowBareSet = /(?:目标|按\s*每天|每天[^，。；]*(?:按|定)|改成|调整为|其他不变)/u.test(source);

  for (const spec of GOAL_DIMENSIONS) {
    const extraction = extractGoal(source, spec, allowBareSet);
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
