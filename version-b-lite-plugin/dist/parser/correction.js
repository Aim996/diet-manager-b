const PARSER_VERSION = "diet-manager/core-parser-v1";
// 有界撤销语法：只识别两种已测试形态。事件 ID 必须落在 I-6 的标识符规则内
// （首字符 [A-Za-z0-9]，其后 0-127 个 [A-Za-z0-9._:-]），超出即拒绝。
const LATEST_MEAL_UNDO = /^撤销\s*(?:刚才那条|刚才这条|上一条|刚刚那条|刚刚这条)\s*饮食记录[。.]?$/u;
const EVENT_ID_UNDO = /^撤销\s*记录\s*([A-Za-z0-9][A-Za-z0-9._:-]{0,127})[。.]?$/u;
// 指示词指向某条记录、但未绑定到"刚才那条"或具体编号 —— 目标不唯一，需澄清。
const DEICTIC_UNBOUNDED_UNDO = /^撤销\s*(?:那条|这条|那一条|这一条)\s*(?:饮食)?记录[。.]?$/u;
// 有界餐食数量纠正：把刚才苹果改成200克。目标固定为 latest_meal，数量必须是
// 正数，单位严格对齐既有餐食解析器的普通单位集合（个/片/瓶/盒/碗/块/盘/克/
// ml/mL/ML/毫升），不接受餐食解析器无法产出的单位（如份/杯/斤/两）。
const MEAL_AMOUNT_CORRECTION = /^把\s*刚才(?:的)?\s*(.+?)\s*改成\s*(\d+(?:\.\d+)?)\s*(个|片|瓶|盒|碗|块|盘|克|ml|mL|ML|毫升)\s*[。.]?$/u;
// 有界餐食发生时间纠正：刚才那顿其实是昨天晚饭。目标固定为 latest_meal，
// 只接受"相对日 + 餐次"形态（不接具体钟点），餐次按口语别名映射到中文 token。
const MEAL_TIME_CORRECTION = /^刚才(?:那顿|这顿|那条|这条)?\s*(?:其实|应该)?\s*是\s*(今天|昨天|前天)?\s*(早饭|早餐|午饭|午餐|晚饭|晚餐|夜宵|宵夜|加餐)\s*[。.]?$/u;
// 有界白水分类纠正：刚才那杯不是白水，是牛奶。目标固定为 latest_water_in_conversation，
// 只接受把白水改判为已注册营养饮品（目前仅牛奶），名称映射到 builtin 词表。该句会被
// 既有 record_meal 词表（「牛奶」lexeme）误判，故必须在本文件（parseCorrectionCommand
// 优先于 meal 判定）短路。
const WATER_CLASSIFICATION_CORRECTION = /^刚才(?:那杯|这杯)\s*(?:其实\s*)?不是白水[，,]?\s*是\s*牛奶\s*[。.]?$/u;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const MEAL_SLOT_ALIASES = {
    早饭: "早餐",
    早餐: "早餐",
    午饭: "午餐",
    午餐: "午餐",
    晚饭: "晚餐",
    晚餐: "晚餐",
    夜宵: "夜宵",
    宵夜: "夜宵",
    加餐: "加餐",
};
// 餐次 → 上海时区整点（用于把"昨天晚饭"等无钟点短语落成确定性时间戳）。
const MEAL_SLOT_HOURS = {
    早餐: 8,
    午餐: 12,
    晚餐: 18,
    加餐: 15,
    夜宵: 22,
};
const DAY_OFFSETS = {
    今天: 0,
    昨天: -1,
    前天: -2,
};
function frozenRecord(entries) {
    return Object.freeze(Object.assign(Object.create(null), entries));
}
/**
 * 把"相对日 + 上海时区整点"换算成 UTC ISO 时间戳（如 昨天 18:00 上海 → 昨日 10:00 UTC）。
 * 与 parse-command.ts 的 shanghaiCalendarDate 采用同一昨日换算思路，但额外落一个
 * 确定性钟点（mealSlot→整点），保证跨日期进度替换有稳定的 before/after 边界。
 */
function mealTimeOccurredAt(receivedAt, dayDelta, hourShanghai) {
    const epoch = new Date(receivedAt).valueOf();
    if (!Number.isFinite(epoch))
        return null;
    const local = new Date(epoch + SHANGHAI_OFFSET_MS);
    const calendarEpoch = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + dayDelta * 86_400_000;
    const utcEpoch = calendarEpoch + (hourShanghai - 8) * 3_600_000;
    const shifted = new Date(utcEpoch);
    const year = shifted.getUTCFullYear();
    if (year < 1_000 || year > 9_999)
        return null;
    return shifted.toISOString();
}
/**
 * 解析有界纠正命令。除"撤销"外，还识别餐食数量纠正（把刚才…改成 N 单位）与
 * 餐食发生时间纠正（刚才那顿其实是…）。其余一律返回 undefined，交由既有解析器判定。
 */
export function parseCorrectionCommand(input) {
    const source = input.source_text.trim();
    if (source.startsWith("撤销")) {
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
    if (WATER_CLASSIFICATION_CORRECTION.test(source)) {
        return frozenRecord({
            disposition: "candidate",
            command: frozenRecord({
                action: "correct_record",
                operation_id: input.operation_id,
                source_text: input.source_text,
                parser_version: PARSER_VERSION,
                correction_kind: "water_classification",
                target: frozenRecord({ kind: "latest_water_in_conversation" }),
                replacement_kind: "nutritious_drink",
                replacement_name: "milk",
            }),
        });
    }
    const amount = MEAL_AMOUNT_CORRECTION.exec(source);
    if (amount !== null && amount[1] !== undefined && amount[2] !== undefined && amount[3] !== undefined) {
        const itemText = amount[1].trim();
        const quantity = Number(amount[2]);
        const microunits = Math.round(quantity * 1_000_000);
        if (itemText.length > 0 &&
            Number.isFinite(quantity) &&
            quantity > 0 &&
            Number.isSafeInteger(microunits)) {
            return frozenRecord({
                disposition: "candidate",
                command: frozenRecord({
                    action: "correct_record",
                    operation_id: input.operation_id,
                    source_text: input.source_text,
                    parser_version: PARSER_VERSION,
                    correction_kind: "meal_amount",
                    target: frozenRecord({ kind: "latest_meal_in_conversation" }),
                    target_item_text: itemText,
                    replacement_quantity: quantity,
                    replacement_unit: amount[3],
                }),
            });
        }
        return undefined;
    }
    const time = MEAL_TIME_CORRECTION.exec(source);
    if (time !== null && time[2] !== undefined) {
        const slot = MEAL_SLOT_ALIASES[time[2]];
        if (slot !== undefined) {
            const dayOffset = time[1] === undefined ? 0 : (DAY_OFFSETS[time[1]] ?? 0);
            const hour = MEAL_SLOT_HOURS[slot];
            const occurredAt = mealTimeOccurredAt(input.received_at, dayOffset, hour);
            if (occurredAt !== null) {
                return frozenRecord({
                    disposition: "candidate",
                    command: frozenRecord({
                        action: "correct_record",
                        operation_id: input.operation_id,
                        source_text: input.source_text,
                        parser_version: PARSER_VERSION,
                        correction_kind: "meal_time",
                        target: frozenRecord({ kind: "latest_meal_in_conversation" }),
                        replacement_time_text: time[2],
                        replacement_occurred_at: occurredAt,
                        replacement_meal_slot: slot,
                    }),
                });
            }
        }
        return undefined;
    }
    return undefined;
}
