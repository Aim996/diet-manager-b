const PARSER_VERSION = "diet-manager/core-parser-v1";
// 有界六项目标语法：<维度>目标<数值> 或 清除/取消/删除/重置<维度>目标，任意子集可并写。
// null（清除）以清除标记识别；数值为 1–6 位整数或最多两位小数（正数，越界交由领域校验）。
// 仅当「目标」与某目标维度关键词同时出现才介入；维度已点名但既无数值也无清除标记时，
// 返回 goal_incomplete 澄清而非静默丢弃。
const CLEAR_MARKER = "清除|取消|删除|重置";
const GOAL_NUMBER = String.raw `(\d{1,6}(?:\.\d{1,2})?)`;
const GOAL_DIMENSIONS = [
    { field: "energy_kcal", keywords: ["热量", "卡路里"] },
    { field: "protein_g", keywords: ["蛋白质", "蛋白"] },
    { field: "fat_g", keywords: ["脂肪"] },
    { field: "carbohydrate_g", keywords: ["碳水化合物", "碳水"] },
    { field: "fiber_g", keywords: ["膳食纤维", "纤维"] },
    { field: "water_ml", keywords: ["饮水", "水"] },
];
function escapeRegex(keyword) {
    return keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function extractGoal(source, spec) {
    const keywords = spec.keywords.map(escapeRegex).join("|");
    const clearBefore = new RegExp(`(?:${CLEAR_MARKER})\\s*(?:${keywords})\\s*目标`, "u");
    const clearAfter = new RegExp(`(?:${keywords})\\s*目标\\s*(?:${CLEAR_MARKER})`, "u");
    const setAfter = new RegExp(`(?:${keywords})\\s*目标\\s*${GOAL_NUMBER}`, "u");
    const incomplete = new RegExp(`(?:${keywords})\\s*目标`, "u");
    if (clearBefore.test(source) || clearAfter.test(source))
        return { value: null };
    const setMatch = setAfter.exec(source);
    if (setMatch !== null && setMatch[1] !== undefined)
        return { value: Number(setMatch[1]) };
    if (incomplete.test(source))
        return "incomplete";
    return null;
}
function frozenRecord(entries) {
    return Object.freeze(Object.assign(Object.create(null), entries));
}
/**
 * 解析有界六项目标命令。仅当「目标」与目标维度关键词同时出现时介入；
 * 无任何目标维度关键词则返回 undefined，交由既有解析器判定。
 */
export function parseGoalCommand(input) {
    const source = input.source_text.trim();
    if (!/目标/u.test(source))
        return undefined;
    const overrides = Object.create(null);
    let incomplete = false;
    let recognized = false;
    for (const spec of GOAL_DIMENSIONS) {
        const extraction = extractGoal(source, spec);
        if (extraction === null)
            continue;
        recognized = true;
        if (extraction === "incomplete") {
            incomplete = true;
            continue;
        }
        overrides[spec.field] = extraction.value;
    }
    if (!recognized)
        return undefined;
    if (incomplete || Object.keys(overrides).length === 0) {
        return frozenRecord({
            disposition: "needs_clarification",
            action: "set_goal",
            reason_code: "goal_incomplete",
            question: "请说明要设置或清除的目标维度和数值。",
        });
    }
    const command = {
        action: "set_goal",
        operation_id: input.operation_id,
        source_text: input.source_text,
        parser_version: PARSER_VERSION,
        goals: overrides,
    };
    return frozenRecord({ disposition: "candidate", command: frozenRecord(command) });
}
