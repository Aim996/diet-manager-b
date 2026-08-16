const PARSER_VERSION = "diet-manager/core-parser-v1";
// 有界撤销语法：只识别两种已测试形态。事件 ID 必须落在 I-6 的标识符规则内
// （首字符 [A-Za-z0-9]，其后 0-127 个 [A-Za-z0-9._:-]），超出即拒绝。
const LATEST_MEAL_UNDO = /^撤销\s*(?:刚才那条|刚才这条|上一条|刚刚那条|刚刚这条)\s*饮食记录[。.]?$/u;
const EVENT_ID_UNDO = /^撤销\s*记录\s*([A-Za-z0-9][A-Za-z0-9._:-]{0,127})[。.]?$/u;
// 指示词指向某条记录、但未绑定到"刚才那条"或具体编号 —— 目标不唯一，需澄清。
const DEICTIC_UNBOUNDED_UNDO = /^撤销\s*(?:那条|这条|那一条|这一条)\s*(?:饮食)?记录[。.]?$/u;
function frozenRecord(entries) {
    return Object.freeze(Object.assign(Object.create(null), entries));
}
/**
 * 解析有界撤销命令。仅在输入以"撤销"开头且命中上述三种有界语法时产出结果，
 * 其余一律返回 undefined，交由 meal/water 等既有解析器继续判定。
 */
export function parseCorrectionCommand(input) {
    const source = input.source_text.trim();
    if (!source.startsWith("撤销"))
        return undefined;
    if (LATEST_MEAL_UNDO.test(source)) {
        return frozenRecord({
            disposition: "candidate",
            command: frozenRecord({
                action: "undo_record",
                operation_id: input.operation_id,
                source_text: input.source_text,
                parser_version: PARSER_VERSION,
                target: frozenRecord({ kind: "latest_meal_in_conversation" }),
            }),
        });
    }
    const eventId = EVENT_ID_UNDO.exec(source);
    if (eventId !== null && eventId[1] !== undefined) {
        return frozenRecord({
            disposition: "candidate",
            command: frozenRecord({
                action: "undo_record",
                operation_id: input.operation_id,
                source_text: input.source_text,
                parser_version: PARSER_VERSION,
                target: frozenRecord({ kind: "event_id", event_id: eventId[1] }),
            }),
        });
    }
    if (DEICTIC_UNBOUNDED_UNDO.test(source)) {
        return frozenRecord({
            disposition: "needs_clarification",
            action: "undo_record",
            reason_code: "target_ambiguous",
            question: "要撤销哪一条饮食记录？请说“刚才那条”或提供记录编号。",
        });
    }
    return undefined;
}
