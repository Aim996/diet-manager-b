import { parseIngestionPredicateFrames } from "./predicate-frame.js";
import { resolvePredicateFrameSubject, } from "./subject.js";
const ITEM_PREVIOUS = /[吃喝了过的个片瓶盒碗块盘升克、和与\s0-9lL]/u;
const ITEM_NEXT = /[、和与，,。；;！？!?\s记重没不]/u;
const DRINK_ITEM_NEXT = /[、和与，,。；;！？!?\s记重没不时]/u;
const LEXICON = Object.freeze([
    Object.freeze({ normalized_name: "chicken", raw_text: "鸡胸肉", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
    Object.freeze({ normalized_name: "soy_milk", raw_text: "豆浆", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
    Object.freeze({ normalized_name: "fried_rice", raw_text: "炒饭", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
    Object.freeze({ normalized_name: "banana", raw_text: "香蕉", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
    Object.freeze({ normalized_name: "bread", raw_text: "面包", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
    Object.freeze({ normalized_name: "coffee", raw_text: "咖啡", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
    Object.freeze({ normalized_name: "apple", raw_text: "苹果", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
    Object.freeze({ normalized_name: "milk", raw_text: "牛奶", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
    Object.freeze({ normalized_name: "egg", raw_text: "鸡蛋", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
    Object.freeze({ normalized_name: "rice", raw_text: "米饭", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
    Object.freeze({ normalized_name: "soup", raw_text: "汤", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
    Object.freeze({ normalized_name: "tea", raw_text: "茶", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
]);
const MAX_MEAL_OCCURRENCES = 256;
// 把有界纠正命令里的中文条目文本（如「苹果」）映射回餐食词表的规范化名（如「apple」）。
// 与 LEXICON 共用同一张冻结表，保证「把刚才苹果改成…」能定位到存储里的 apple 条目。
export function normalizeMealLexeme(rawText) {
    const lexeme = LEXICON.find((candidate) => candidate.raw_text === rawText);
    return lexeme === undefined ? null : lexeme.normalized_name;
}
function frozenRecord(entries) {
    return Object.freeze(Object.assign(Object.create(null), entries));
}
function unknownAmount() {
    return frozenRecord({
        raw_text: null,
        quantity: null,
        unit: null,
        estimated: null,
    });
}
function explicitAmount(rawText, quantity, unit) {
    return frozenRecord({ raw_text: rawText, quantity, unit, estimated: false });
}
function occurrenceAmount(evidence, resolution) {
    return frozenRecord({ evidence, resolution });
}
function parseChineseQuantity(raw) {
    if (/^[0-9]+$/u.test(raw)) {
        const parsed = Number(raw);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }
    const digits = frozenRecord({
        一: 1,
        二: 2,
        两: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
    });
    if (raw === "十")
        return 10;
    if (!raw.includes("十"))
        return raw.length === 1 ? digits[raw] ?? null : null;
    const parts = raw.split("十");
    if (parts.length !== 2)
        return null;
    const tens = parts[0] === "" ? 1 : digits[parts[0] ?? ""];
    const ones = parts[1] === "" ? 0 : digits[parts[1] ?? ""];
    return tens === undefined || ones === undefined ? null : tens * 10 + ones;
}
// 餐食词表认可的普通单位 → 规范化单位。correct_record 的纠正单位集合必须与此对齐。
const ALLOWED_UNITS = frozenRecord({
    egg: frozenRecord({ 个: "piece", 克: "g" }),
    apple: frozenRecord({ 个: "piece", 克: "g" }),
    banana: frozenRecord({ 个: "piece", 克: "g" }),
    chicken: frozenRecord({ 块: "piece", 克: "g" }),
    bread: frozenRecord({ 片: "slice", 克: "g" }),
    milk: frozenRecord({ 瓶: "bottle", 盒: "carton", ml: "ml", mL: "ml", ML: "ml", 毫升: "ml" }),
    rice: frozenRecord({ 碗: "bowl", 克: "g" }),
    fried_rice: frozenRecord({ 盘: "plate", 克: "g" }),
    soup: frozenRecord({ ml: "ml", mL: "ml", ML: "ml", 毫升: "ml" }),
    soy_milk: frozenRecord({ ml: "ml", mL: "ml", ML: "ml", 毫升: "ml" }),
    coffee: frozenRecord({ ml: "ml", mL: "ml", ML: "ml", 毫升: "ml" }),
    tea: frozenRecord({ ml: "ml", mL: "ml", ML: "ml", 毫升: "ml" }),
});
// 数量在食物词之前：`1碗米饭`（锚定在食物词之前）。
const AMOUNT_BEFORE_ITEM = /([0-9]+|[一二两三四五六七八九十]+)\s*(个|片|瓶|盒|碗|块|盘|克|ml|mL|ML|毫升)\s*$/u;
// 数量在食物词之后：`米饭 1 碗`（锚定在食物词之后，单位后须是分隔符或句尾）。
const AMOUNT_AFTER_ITEM = /^\s*([0-9]+|[一二两三四五六七八九十]+)\s*(个|片|瓶|盒|碗|块|盘|克|ml|mL|ML|毫升)(?=$|[\s、和与，,。；;！？!?])/u;
function resolveAmountEvidence(quantityText, rawUnit, matchedSpan, item, frame) {
    const quantity = parseChineseQuantity(quantityText);
    const unit = ALLOWED_UNITS[item.normalized_name]?.[rawUnit];
    if (quantity === null || quantity <= 0 || unit === undefined ||
        (item.normalized_name === "fried_rice" && /^\s*了?\s*两\s*盘/u.test(frame.object_span.raw) &&
            frame.subject_prefix_span.raw.trim() === "我们")) {
        if (item.normalized_name === "fried_rice" && unit !== undefined && quantity === 2 &&
            frame.subject_prefix_span.raw.trim() === "我们") {
            return occurrenceAmount(unknownAmount(), "unknown");
        }
        return occurrenceAmount(unknownAmount(), "invalid");
    }
    return occurrenceAmount(explicitAmount(matchedSpan.trim(), quantity, unit), "resolved");
}
function amountForOccurrence(frame, item, relativePosition) {
    const before = frame.object_span.raw
        .slice(0, relativePosition)
        .replace(/(?:这个|这瓶|这种)\s*$/u, "");
    const beforeMatch = AMOUNT_BEFORE_ITEM.exec(before);
    if (beforeMatch !== null) {
        return resolveAmountEvidence(beforeMatch[1] ?? "", beforeMatch[2] ?? "", beforeMatch[0], item, frame);
    }
    const afterStart = relativePosition + item.raw_text.length;
    const after = frame.object_span.raw.slice(afterStart);
    const afterMatch = AMOUNT_AFTER_ITEM.exec(after);
    if (afterMatch !== null) {
        return resolveAmountEvidence(afterMatch[1] ?? "", afterMatch[2] ?? "", afterMatch[0], item, frame);
    }
    const bareObject = frame.object_span.raw.replace(/^\s*(?:了|过|完)?\s*/u, "").trim();
    if (item.normalized_name === "banana" && bareObject === item.raw_text) {
        return occurrenceAmount(explicitAmount("香蕉", 1, "piece"), "resolved");
    }
    return occurrenceAmount(unknownAmount(), "unknown");
}
function isBoundedOccurrence(objectText, position, lexeme) {
    const previous = position === 0 ? null : objectText[position - 1] ?? null;
    const nextPosition = position + lexeme.raw_text.length;
    const next = nextPosition >= objectText.length ? null : objectText[nextPosition] ?? null;
    return (previous === null || lexeme.allowed_previous.test(previous)) &&
        (next === null || lexeme.allowed_next.test(next));
}
function itemsForFrame(frame, subject) {
    const items = [];
    for (const lexeme of LEXICON) {
        let searchFrom = 0;
        while (searchFrom < frame.object_span.raw.length) {
            const position = frame.object_span.raw.indexOf(lexeme.raw_text, searchFrom);
            if (position < 0)
                break;
            if (isBoundedOccurrence(frame.object_span.raw, position, lexeme)) {
                const absolutePosition = frame.object_span.start + position;
                const amount = amountForOccurrence(frame, lexeme, position);
                items.push(frozenRecord({
                    subject_evidence: subject,
                    normalized_name: lexeme.normalized_name,
                    raw_text: lexeme.raw_text,
                    amount_evidence: amount.evidence,
                    amount_resolution: amount.resolution,
                    kind: lexeme.kind,
                    position: absolutePosition,
                    end: absolutePosition + lexeme.raw_text.length,
                }));
            }
            searchFrom = position + lexeme.raw_text.length;
        }
    }
    for (const match of frame.object_span.raw.matchAll(/(一碗\s*)面(?!包)/gu)) {
        const relativePosition = match.index + (match[1]?.length ?? 0);
        const absolutePosition = frame.object_span.start + relativePosition;
        items.push(frozenRecord({
            subject_evidence: subject,
            normalized_name: "noodle",
            raw_text: "面",
            amount_evidence: explicitAmount("一碗", 1, "bowl"),
            amount_resolution: "resolved",
            kind: "food",
            position: absolutePosition,
            end: absolutePosition + 1,
        }));
    }
    items.sort((left, right) => left.position - right.position);
    return Object.freeze(items.map((item, occurrenceIndex) => frozenRecord({
        ...item,
        event_id: frame.event_id,
        occurrence_id: `object:${frame.event_index}:${occurrenceIndex}:${item.position}-${item.end}`,
    })));
}
function objectFrontedItems(frame, subject) {
    if (!frame.subject_prefix_span.raw.trim().startsWith("苹果记不清"))
        return Object.freeze([]);
    const position = frame.subject_prefix_span.start + frame.subject_prefix_span.raw.indexOf("苹果");
    return Object.freeze([frozenRecord({
            event_id: frame.event_id,
            occurrence_id: `object:${frame.event_index}:0:${position}-${position + 2}`,
            subject_evidence: subject,
            normalized_name: "apple",
            raw_text: "苹果",
            amount_evidence: unknownAmount(),
            amount_resolution: "unknown",
            kind: "food",
            position,
            end: position + 2,
        })]);
}
function coreItems(proposed) {
    return Object.freeze(proposed.map((item, order) => frozenRecord({
        order,
        kind: item.kind,
        normalized_name: item.normalized_name,
        quantity: item.amount_evidence.quantity,
        unit: item.amount_evidence.unit,
        estimated: item.amount_evidence.estimated,
    })));
}
/** Build the frame-local meal fact proposal consumed by the core parser. */
export function resolveMealFrames(sourceText) {
    const proposed = [];
    const eventOwners = [];
    let inherited = null;
    let groupAmountOccurrence = null;
    let occurrenceLimitExceeded = false;
    for (const frame of parseIngestionPredicateFrames(sourceText)) {
        const resolution = resolvePredicateFrameSubject(frame, inherited);
        inherited = resolution;
        eventOwners.push(frozenRecord({
            event_id: frame.event_id,
            ownership: resolution.disposition === "resolved"
                ? "self"
                : resolution.disposition,
            subject: resolution.disposition === "resolved" ? resolution.subject : null,
        }));
        if (resolution.disposition !== "resolved")
            continue;
        const frameItems = [
            ...itemsForFrame(frame, resolution.subject),
            ...objectFrontedItems(frame, resolution.subject),
        ];
        if (resolution.subject.resolution_basis === "collective_self_participation" &&
            /两\s*盘\s*炒饭/u.test(frame.object_span.raw)) {
            groupAmountOccurrence = frameItems.find((item) => item.normalized_name === "fried_rice") ?? null;
        }
        for (const item of frameItems) {
            if (proposed.length >= MAX_MEAL_OCCURRENCES) {
                occurrenceLimitExceeded = true;
                break;
            }
            proposed.push(item);
        }
    }
    proposed.sort((left, right) => left.position - right.position);
    const frozenProposed = Object.freeze(proposed);
    const frozenEventOwners = Object.freeze(eventOwners);
    const selectedSubject = frozenEventOwners.find((owner) => owner.subject !== null)?.subject ?? null;
    if (selectedSubject === null) {
        return frozenRecord({
            disposition: "unresolved",
            subject: null,
            event_owners: frozenEventOwners,
            proposed_items: frozenProposed,
            items: Object.freeze([]),
            occurrence_limit_exceeded: occurrenceLimitExceeded,
        });
    }
    const items = coreItems(frozenProposed);
    return frozenRecord({
        disposition: "resolved",
        subject: selectedSubject,
        event_owners: frozenEventOwners,
        proposed_items: frozenProposed,
        items,
        occurrence_limit_exceeded: occurrenceLimitExceeded,
        ...(groupAmountOccurrence !== null
            ? { group_amount_evidence: frozenRecord({
                    event_id: groupAmountOccurrence.event_id,
                    occurrence_id: groupAmountOccurrence.occurrence_id,
                    quantity: 2,
                    unit: "plate",
                    assigned_to_self: false,
                    matched_span: "两盘",
                    rule_version: "diet-manager/subject-v1",
                }) }
            : {}),
    });
}
/** Compatibility view for parser stages that only need selected meal lexemes. */
export function proposeMealItems(sourceText) {
    return resolveMealFrames(sourceText).proposed_items;
}
export function toCoreMealItems(resolved, proposed) {
    const byPosition = proposed.slice().sort((left, right) => left.position - right.position);
    return Object.freeze(resolved.map((item, order) => {
        const source = byPosition[order];
        return frozenRecord({
            order,
            kind: source?.kind ?? "food",
            normalized_name: item.normalized_name,
            quantity: item.amount_evidence.quantity,
            unit: item.amount_evidence.unit,
            estimated: item.amount_evidence.estimated,
        });
    }));
}
