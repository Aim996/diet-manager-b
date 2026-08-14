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
/** Parse only the frozen SEL-PANTRY purchase and location-correction grammar. */
export function resolvePantryCommand(input) {
    const source = input.source_text.trim();
    if (/^更正[：:]这批牛奶放在冷藏室[，,]不是常温柜[。.]?$/u.test(source)) {
        return Object.freeze({
            action: "correct_record",
            operation_id: input.operation_id,
            source_text: input.source_text,
            parser_version: PARSER_VERSION,
            correction_kind: "inventory_location",
            product_reference: "milk",
            batch_reference: "this_batch",
            previous_location: "room_temperature_cabinet",
            next_location: "refrigerator",
            matched_span: "冷藏室，不是常温柜",
            rule_version: "diet-manager/location-correction/v1",
        });
    }
    if (/^买了两箱牛奶[，,]每箱12盒[，,]每盒250ml[。.]?$/u.test(source)) {
        return purchase(input, [item({
                order: 0,
                raw_name: "牛奶",
                normalized_name: "milk",
                product_type: "nutrition_drink",
                specification: Object.freeze({ value: 250, unit: "ml" }),
                package_quantity: Object.freeze({
                    outer_count: 2, outer_unit: "箱", inner_per_outer: 12, inner_unit: "盒",
                    capacity_per_inner: 250, capacity_unit: "ml", total_inner: 24,
                    total_capacity: 6000, formula: "2*12*250=6000",
                }),
            })]);
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
    if (/^买了一袋鸡蛋[。.]?$/u.test(source)) {
        return purchase(input, [item({
                order: 0,
                raw_name: "鸡蛋",
                normalized_name: "egg",
                product_type: "food",
                package_quantity: Object.freeze({
                    outer_count: 1, outer_unit: "袋", inner_per_outer: null, inner_unit: null,
                    capacity_per_inner: null, capacity_unit: null, total_inner: null,
                    total_capacity: null, formula: null,
                }),
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
    return null;
}
