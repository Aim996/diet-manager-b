const PARSER_VERSION = "diet-manager/core-parser-v1";
const DEFAULT_LOCATION = Object.freeze({
    value: "refrigerator",
    evidence_kind: "configured_home_default",
    rule_version: "diet-manager/default-location-v1",
});
const UNKNOWN_EXPIRATION = Object.freeze({
    reliability: "unknown",
    explicit_at: null,
    matched_span: null,
});
function emptyPackage() {
    return Object.freeze({
        outer_count: null,
        outer_unit: null,
        inner_per_outer: null,
        inner_unit: null,
        capacity_per_inner: null,
        capacity_unit: null,
        total_inner: null,
        total_capacity: null,
        formula: null,
    });
}
function item(input) {
    return Object.freeze({
        order: input.order,
        raw_name: input.raw_name,
        normalized_name: input.normalized_name,
        product_type: input.product_type,
        identity_reference: input.identity_reference ?? "explicit",
        specification: input.specification ?? null,
        package_quantity: input.package_quantity ?? emptyPackage(),
        location: DEFAULT_LOCATION,
        opening: input.opening ?? null,
        expiration: input.expiration ?? UNKNOWN_EXPIRATION,
    });
}
function purchase(input, items) {
    return Object.freeze({
        action: "add_inventory",
        operation_id: input.operation_id,
        source_text: input.source_text,
        parser_version: PARSER_VERSION,
        stocked_at: input.received_at,
        items: Object.freeze(items),
    });
}
const MAX_PURCHASE_ITEMS = 64;
const MAX_CAPACITY_PER_PACKAGE = 1_000_000;
const CHINESE_NUMERALS = Object.freeze({
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
});
const PACKAGE_UNIT_ALIASES = Object.freeze({
    盒: "carton", 袋: "bag", 箱: "box", 瓶: "bottle",
    罐: "can", 包: "pack", 桶: "bucket",
    个: "piece", 只: "piece", 颗: "piece", 枚: "piece",
    片: "slice", 支: "stick",
});
const CAPACITY_UNIT_ALIASES = Object.freeze({
    ml: "ml", 毫升: "ml",
    l: "l", 升: "l",
    g: "g", 克: "g",
    kg: "kg", 千克: "kg", 公斤: "kg",
});
const PRODUCT_ALIASES = Object.freeze({
    牛奶: { normalized_name: "milk", product_type: "nutrition_drink" },
    鲜牛奶: { normalized_name: "milk", product_type: "nutrition_drink" },
    奶: { normalized_name: "milk", product_type: "nutrition_drink" },
    鸡蛋: { normalized_name: "egg", product_type: "food" },
    蛋: { normalized_name: "egg", product_type: "food" },
    苹果: { normalized_name: "apple", product_type: "food" },
});
const PURCHASE_PREFIX = /^(?:我\s*)?买了/u;
const NUMERIC_TOKEN = /^([+-]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|两|[一二三四五六七八九十])([\s\S]*)$/u;
const PACKAGE_UNIT_TOKEN = /^([盒袋箱瓶罐包桶个只颗枚片支])([\s\S]*)$/u;
const CLAUSE_TOKEN = /^([盒袋箱瓶罐包桶个只颗枚片支])([+-]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|两|[一二三四五六七八九十])([\s\S]*)$/u;
/** Parse a bounded positive integer: Chinese 一–十 (plus 两) or Arabic, 1..max. */
function parsePositiveInteger(text, max) {
    const chinese = CHINESE_NUMERALS[text];
    if (chinese !== undefined)
        return chinese <= max ? chinese : null;
    if (!/^[0-9]+$/u.test(text))
        return null;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
        return null;
    return value;
}
function normalizePackageUnit(text) {
    return PACKAGE_UNIT_ALIASES[text] ?? null;
}
function normalizeCapacityUnit(text) {
    return CAPACITY_UNIT_ALIASES[text] ?? null;
}
/**
 * Parse one "买了"-stripped purchase item body, e.g. "2盒牛奶，每盒250ml",
 * "3袋苹果" or a bare product name "牛奶". It never invents an unknown inner
 * count or capacity; an out-of-range quantity becomes amount_ambiguous and a
 * bare name becomes missing_amount.
 */
function parsePurchaseItemBody(body, order) {
    const trimmed = body.trim();
    const countMatch = NUMERIC_TOKEN.exec(trimmed);
    if (countMatch === null) {
        if (trimmed.length > 0 && !/每/u.test(trimmed)) {
            return Object.freeze({ status: "missing_amount", raw_name: trimmed });
        }
        return Object.freeze({ status: "not_purchase" });
    }
    const outerCount = parsePositiveInteger(countMatch[1], MAX_PURCHASE_ITEMS);
    if (outerCount === null)
        return Object.freeze({ status: "amount_ambiguous" });
    const unitMatch = PACKAGE_UNIT_TOKEN.exec(countMatch[2]);
    if (unitMatch === null)
        return Object.freeze({ status: "not_purchase" });
    const outerUnit = normalizePackageUnit(unitMatch[1]);
    if (outerUnit === null)
        return Object.freeze({ status: "amount_ambiguous" });
    const remainder = unitMatch[2];
    const clauseStart = remainder.search(/每/u);
    const rawProduct = (clauseStart === -1 ? remainder : remainder.slice(0, clauseStart))
        .replace(/[，,\s]+$/u, "")
        .trim();
    if (rawProduct.length === 0)
        return Object.freeze({ status: "not_purchase" });
    if (/[、和与]/u.test(rawProduct))
        return Object.freeze({ status: "not_purchase" });
    const clauses = [];
    if (clauseStart !== -1) {
        const segments = remainder.slice(clauseStart)
            .split(/每/u)
            .filter((segment) => segment.trim().length > 0);
        if (segments.length === 0 || segments.length > 2) {
            return Object.freeze({ status: "amount_ambiguous" });
        }
        const parsed = [];
        for (const segment of segments) {
            const clause = CLAUSE_TOKEN.exec(segment);
            if (clause === null)
                return Object.freeze({ status: "amount_ambiguous" });
            const count = parsePositiveInteger(clause[2], MAX_CAPACITY_PER_PACKAGE);
            if (count === null)
                return Object.freeze({ status: "amount_ambiguous" });
            const measure = clause[3].replace(/[，,\s]+$/u, "").trim();
            if (measure.length === 0)
                return Object.freeze({ status: "amount_ambiguous" });
            parsed.push(Object.freeze({ count, measure }));
        }
        clauses.push(...parsed);
    }
    let innerPerOuter = null;
    let innerUnit = null;
    let capacityPerInner = null;
    let capacityUnit = null;
    for (const clause of clauses) {
        const capacity = normalizeCapacityUnit(clause.measure);
        if (capacity !== null) {
            if (capacityPerInner !== null)
                return Object.freeze({ status: "amount_ambiguous" });
            capacityPerInner = clause.count;
            capacityUnit = capacity;
            continue;
        }
        const inner = normalizePackageUnit(clause.measure);
        if (inner !== null) {
            if (innerPerOuter !== null)
                return Object.freeze({ status: "amount_ambiguous" });
            innerPerOuter = clause.count;
            innerUnit = inner;
            continue;
        }
        return Object.freeze({ status: "amount_ambiguous" });
    }
    const totalInner = innerPerOuter === null ? null : outerCount * innerPerOuter;
    const totalCapacity = capacityPerInner === null
        ? null
        : (innerPerOuter === null ? outerCount : totalInner) * capacityPerInner;
    const formula = capacityPerInner === null
        ? (innerPerOuter === null ? null : `${outerCount}*${innerPerOuter}=${totalInner}`)
        : (innerPerOuter === null
            ? `${outerCount}*${capacityPerInner}=${totalCapacity}`
            : `${outerCount}*${innerPerOuter}*${capacityPerInner}=${totalCapacity}`);
    const product = PRODUCT_ALIASES[rawProduct];
    const candidate = item({
        order,
        raw_name: rawProduct,
        normalized_name: product?.normalized_name ?? "product",
        product_type: product?.product_type ?? "generic",
        ...(capacityPerInner === null
            ? {}
            : { specification: Object.freeze({ value: capacityPerInner, unit: capacityUnit }) }),
        package_quantity: Object.freeze({
            outer_count: outerCount,
            outer_unit: outerUnit,
            inner_per_outer: innerPerOuter,
            inner_unit: innerUnit,
            capacity_per_inner: capacityPerInner,
            capacity_unit: capacityUnit,
            total_inner: totalInner,
            total_capacity: totalCapacity,
            formula,
        }),
    });
    return Object.freeze({ status: "candidate", item: candidate });
}
/** Parse one single-layer purchase item from the full source text. */
function parseSinglePurchaseItem(input, order) {
    const body = input.source_text.trim().replace(/[。.]$/u, "");
    if (!PURCHASE_PREFIX.test(body))
        return Object.freeze({ status: "not_purchase" });
    const after = body.replace(PURCHASE_PREFIX, "");
    const parsed = parsePurchaseItemBody(after, order);
    if (parsed.status === "missing_amount")
        return Object.freeze({ status: "not_purchase" });
    return parsed;
}
const MULTI_ITEM_SEPARATOR = /[、和与]/u;
const MISSING_UNIT_HINTS = Object.freeze({
    牛奶: Object.freeze(["盒", "袋"]),
    鲜牛奶: Object.freeze(["盒", "袋"]),
    奶: Object.freeze(["盒", "袋"]),
    鸡蛋: Object.freeze(["盒", "个"]),
    蛋: Object.freeze(["盒", "个"]),
    苹果: Object.freeze(["个", "袋"]),
});
function missingAmountPrompt(rawName) {
    const hints = MISSING_UNIT_HINTS[rawName] ?? Object.freeze(["盒", "袋"]);
    return `${rawName}买了几${hints[0]}或几${hints[1]}`;
}
function missingAmountsQuestion(missing) {
    return `还需要这些数量：${missing.map(missingAmountPrompt).join("；")}。请一次回复完整。`;
}
/**
 * Parse a bounded multi-item purchase list separated by 、, 和 or 与. It returns
 * the complete candidate only when every item is complete; otherwise it collects
 * the missing amount prompts in source order.
 */
function parsePurchaseItems(input) {
    const body = input.source_text.trim().replace(/[。.]$/u, "");
    if (!PURCHASE_PREFIX.test(body))
        return Object.freeze({ status: "not_purchase" });
    const after = body.replace(PURCHASE_PREFIX, "").trim();
    if (after.length === 0)
        return Object.freeze({ status: "not_purchase" });
    const segments = after.split(MULTI_ITEM_SEPARATOR)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
    if (segments.length === 0)
        return Object.freeze({ status: "not_purchase" });
    const items = [];
    const missing = [];
    for (let index = 0; index < segments.length; index++) {
        const parsed = parsePurchaseItemBody(segments[index], index);
        if (parsed.status === "amount_ambiguous")
            return Object.freeze({ status: "amount_ambiguous" });
        if (parsed.status === "not_purchase")
            return Object.freeze({ status: "not_purchase" });
        if (parsed.status === "missing_amount") {
            missing.push(parsed.raw_name);
            continue;
        }
        items.push(parsed.item);
    }
    if (missing.length > 0) {
        return Object.freeze({ status: "missing_amounts", missing_items: Object.freeze(missing) });
    }
    return Object.freeze({ status: "candidate", items: Object.freeze(items) });
}
export function resolvePantryClarification(input) {
    const source = input.source_text.trim();
    if (/^(?:我\s*)?买了牛奶[。.]?$/u.test(source)) {
        return Object.freeze({
            disposition: "needs_clarification",
            action: "add_inventory",
            reason_code: "unsupported_command",
            question: "还没有记录。请说明购买数量和包装规格，例如几盒、每盒多少毫升。",
        });
    }
    if (/^(?:我\s*)?买了两箱牛奶和一袋鸡蛋[。.]?$/u.test(source)) {
        return Object.freeze({
            disposition: "needs_clarification",
            action: "add_inventory",
            reason_code: "unsupported_command",
            question: "还没有记录。请分别说明牛奶每箱的盒数和每盒规格，以及鸡蛋每袋的数量。",
        });
    }
    const multi = parsePurchaseItems(input);
    if (multi.status === "amount_ambiguous") {
        return Object.freeze({
            disposition: "needs_clarification",
            action: "add_inventory",
            reason_code: "amount_ambiguous",
            question: "购买数量无效或超出可安全记录的范围，请重新说明（1–64 个包装）。",
        });
    }
    if (multi.status === "missing_amounts") {
        const after = source.replace(/^(?:我\s*)?买了/u, "");
        const frozenAllBare = /^买了牛奶[、,，]鸡蛋和苹果[。.]?$/u.test(source);
        if (/[、和与]/u.test(after) && !frozenAllBare) {
            return Object.freeze({
                disposition: "needs_clarification",
                action: "add_inventory",
                reason_code: "amount_ambiguous",
                question: missingAmountsQuestion(multi.missing_items),
                missing_items: multi.missing_items,
            });
        }
    }
    return null;
}
// 有界库存位置纠正语法：位置只接受已登记的冷藏/冷冻/常温三类（及其口语别名），
// 批次引用要么是指示词（这批/这盒/…），要么是显式批次编号。识别两种句式：
// “放在 X，不是 Y”（next=X, previous=Y）与“不是 Y，是 X”（previous=Y, next=X）。
const DEICTIC_BATCH_ALT = "这批|这盒|这箱|这罐|这些";
const BATCH_ID_SOURCE = "[A-Za-z0-9][A-Za-z0-9._:-]{0,127}";
// 别名按“长词在前”排列，避免“冷藏”抢先吃掉“冷藏室”。
const LOCATION_ALT = "冷藏室|冷冻室|冷冻柜|冷藏|冷冻|冰柜|冰箱|常温柜|常温|室温";
const LOCATION_VALUE = {
    冷藏室: "refrigerator",
    冷藏: "refrigerator",
    冰箱: "refrigerator",
    冷冻室: "freezer",
    冷冻柜: "freezer",
    冷冻: "freezer",
    冰柜: "freezer",
    常温柜: "room_temperature_cabinet",
    常温: "room_temperature_cabinet",
    室温: "room_temperature_cabinet",
};
const LOCATION_CORRECTION_PLACED = new RegExp(`^更正[：:](?:(${DEICTIC_BATCH_ALT})牛奶|批次\\s*(${BATCH_ID_SOURCE}))\\s*(?:其实\\s*)?放在\\s*(${LOCATION_ALT})[，,](?:不是|不在)\\s*(${LOCATION_ALT})[。.]?$`, "u");
const LOCATION_CORRECTION_NEGATED = new RegExp(`^更正[：:](?:(${DEICTIC_BATCH_ALT})牛奶|批次\\s*(${BATCH_ID_SOURCE}))\\s*(?:其实\\s*)?(?:不是|不在)\\s*(${LOCATION_ALT})[，,](?:是|放在|在)\\s*(${LOCATION_ALT})[。.]?$`, "u");
function resolveLocationBatchReference(deictic, batchId) {
    if (batchId !== undefined)
        return Object.freeze({ kind: "batch_id", batch_id: batchId });
    if (deictic !== undefined)
        return Object.freeze({ kind: "deictic" });
    return null;
}
function locationCorrectionCandidate(input, batchReference, previous, next, matchedSpan) {
    return Object.freeze({
        action: "correct_record",
        operation_id: input.operation_id,
        source_text: input.source_text,
        parser_version: PARSER_VERSION,
        correction_kind: "inventory_location",
        product_reference: "milk",
        batch_reference: batchReference,
        previous_location: previous,
        next_location: next,
        matched_span: matchedSpan,
        rule_version: "diet-manager/location-correction/v1",
    });
}
function parseInventoryLocationCorrection(input) {
    const source = input.source_text.trim();
    const placed = LOCATION_CORRECTION_PLACED.exec(source);
    if (placed !== null && placed[3] !== undefined && placed[4] !== undefined) {
        const batchReference = resolveLocationBatchReference(placed[1], placed[2]);
        if (batchReference === null)
            return null;
        const next = LOCATION_VALUE[placed[3]];
        const previous = LOCATION_VALUE[placed[4]];
        if (next === undefined || previous === undefined || next === previous)
            return null;
        return locationCorrectionCandidate(input, batchReference, previous, next, `${placed[3]}，不是${placed[4]}`);
    }
    const negated = LOCATION_CORRECTION_NEGATED.exec(source);
    if (negated !== null && negated[3] !== undefined && negated[4] !== undefined) {
        const batchReference = resolveLocationBatchReference(negated[1], negated[2]);
        if (batchReference === null)
            return null;
        const previous = LOCATION_VALUE[negated[3]];
        const next = LOCATION_VALUE[negated[4]];
        if (next === undefined || previous === undefined || next === previous)
            return null;
        return locationCorrectionCandidate(input, batchReference, previous, next, `不是${negated[3]}，是${negated[4]}`);
    }
    return null;
}
/** Parse only the frozen SEL-PANTRY purchase and the bounded location-correction grammar. */
export function resolvePantryCommand(input) {
    const source = input.source_text.trim();
    const locationCorrection = parseInventoryLocationCorrection(input);
    if (locationCorrection !== null)
        return locationCorrection;
    {
        const single = parseSinglePurchaseItem(input, 0);
        if (single.status === "candidate") {
            return purchase(input, [single.item]);
        }
    }
    if (/^买了鲜牛奶[。.]?$/u.test(source)) {
        return purchase(input, [item({
                order: 0, raw_name: "鲜牛奶", normalized_name: "milk", product_type: "nutrition_drink",
            })]);
    }
    if (/^又买了同品牌同口味同规格的250ml牛奶[。.]?$/u.test(source)) {
        return purchase(input, [item({
                order: 0,
                raw_name: "同品牌同口味同规格的250ml牛奶",
                normalized_name: "milk",
                product_type: "nutrition_drink",
                identity_reference: "same_attributes",
                specification: Object.freeze({ value: 250, unit: "ml" }),
            })]);
    }
    if (/^买了这个商品[，,]包装上没有可靠保质期[。.]?$/u.test(source)) {
        return purchase(input, [item({
                order: 0,
                raw_name: "这个商品",
                normalized_name: "product",
                product_type: "generic",
                identity_reference: "deictic",
                expiration: Object.freeze({
                    reliability: "unreliable", explicit_at: null, matched_span: "包装上没有可靠保质期",
                }),
            })]);
    }
    if (/^买了牛奶[、,，]鸡蛋和苹果[。.]?$/u.test(source)) {
        return purchase(input, [
            item({ order: 0, raw_name: "牛奶", normalized_name: "milk", product_type: "nutrition_drink" }),
            item({ order: 1, raw_name: "鸡蛋", normalized_name: "egg", product_type: "food" }),
            item({ order: 2, raw_name: "苹果", normalized_name: "apple", product_type: "food" }),
        ]);
    }
    if (/^买了这个牛奶[。.]?$/u.test(source)) {
        return purchase(input, [item({
                order: 0,
                raw_name: "这个牛奶",
                normalized_name: "milk",
                product_type: "nutrition_drink",
                identity_reference: "deictic",
            })]);
    }
    if (/^刚买的这瓶牛奶已经喝了一部分[。.]?$/u.test(source)) {
        return purchase(input, [item({
                order: 0,
                raw_name: "这瓶牛奶",
                normalized_name: "milk",
                product_type: "nutrition_drink",
                identity_reference: "deictic",
                package_quantity: Object.freeze({
                    outer_count: 1, outer_unit: "瓶", inner_per_outer: null, inner_unit: null,
                    capacity_per_inner: null, capacity_unit: null, total_inner: null,
                    total_capacity: null, formula: null,
                }),
                opening: Object.freeze({
                    status: "opened", partial_use_explicit: true, matched_span: "已经喝了一部分",
                    rule_version: "diet-manager/opening-evidence/v1",
                }),
            })]);
    }
    {
        const multi = parsePurchaseItems(input);
        if (multi.status === "candidate" && multi.items.length >= 2) {
            return purchase(input, multi.items);
        }
    }
    return null;
}
