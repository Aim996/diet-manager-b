const PARSER_VERSION = "diet-manager/core-parser-v1";
// 有界个人档案语法：从自然语言抽取 身高(厘米) + 体重(公斤) + 可选 性别/年龄/目标状态。
// 身高单位可省略（缺省厘米），体重单位必须出现（公斤/千克/kg）；性别男/女、年龄数字+岁、
// 状态减脂/增肌/维持。段序不限，但数值落在保守有界区间内（身高 50–300cm、体重 20–500kg、
// 年龄 1–120 整数），超出即按档案不完整要求澄清，而非静默落错数据。
const HEIGHT_PATTERN = /身高\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:厘米|公分|cm|CM|Cm)?/u;
const WEIGHT_PATTERN = /体重\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:公斤|千克|kg|KG|Kg)/u;
const SEX_PATTERN = /(男|女)/u;
const AGE_PATTERN = /(\d{1,3})\s*岁/u;
const STATE_PATTERN = /(减脂|增肌|维持)/u;
const SEX_MAP = {
    男: "male",
    女: "female",
};
const STATE_MAP = {
    减脂: "cut",
    增肌: "bulk",
    维持: "maintain",
};
function frozenRecord(entries) {
    return Object.freeze(Object.assign(Object.create(null), entries));
}
function parseHeight(source) {
    const match = HEIGHT_PATTERN.exec(source);
    if (match === null || match[1] === undefined)
        return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 50 || value > 300)
        return null;
    return value;
}
function parseWeight(source) {
    const match = WEIGHT_PATTERN.exec(source);
    if (match === null || match[1] === undefined)
        return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 20 || value > 500)
        return null;
    return value;
}
function parseAge(source) {
    const match = AGE_PATTERN.exec(source);
    if (match === null || match[1] === undefined)
        return null;
    const value = Number(match[1]);
    if (!Number.isInteger(value) || value < 1 || value > 120)
        return null;
    return value;
}
/**
 * 解析有界个人档案命令。只识别同时给出「身高 + 体重」的完整档案，二者缺一
 * （或数值越界）即返回 needs_clarification；不含身高/体重则返回 undefined，
 * 交由既有解析器判定。
 */
export function parseProfileCommand(input) {
    const source = input.source_text.trim();
    if (!/身高|体重/u.test(source))
        return undefined;
    const height = parseHeight(source);
    const weight = parseWeight(source);
    const age = parseAge(source);
    const sexMatch = SEX_PATTERN.exec(source);
    const sex = sexMatch === null || sexMatch[1] === undefined
        ? null
        : (SEX_MAP[sexMatch[1]] ?? null);
    const stateMatch = STATE_PATTERN.exec(source);
    const goalState = stateMatch === null || stateMatch[1] === undefined
        ? null
        : (STATE_MAP[stateMatch[1]] ?? null);
    if (height === null || weight === null) {
        return frozenRecord({
            disposition: "needs_clarification",
            action: "set_profile",
            reason_code: "profile_incomplete",
            question: "请补充完整个人档案：身高（厘米）和体重（公斤）缺一不可。",
        });
    }
    const command = {
        action: "set_profile",
        operation_id: input.operation_id,
        source_text: input.source_text,
        parser_version: PARSER_VERSION,
        height_cm: height,
        weight_kg: weight,
        sex,
        age,
        goal_state: goalState,
    };
    return frozenRecord({ disposition: "candidate", command: frozenRecord(command) });
}
