export const dietManagerContract = Object.freeze({
    id: "diet-manager/contract-v2",
    version: 2,
    sha256: "632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E",
});
export const dietManagerActions = [
    "record_meal",
    "record_water",
    "add_inventory",
    "query_inventory",
    "query_meals",
    "query_daily_summary",
    "correct_record",
    "undo_record",
];
export const dietManagerStatuses = [
    "committed",
    "committed_with_issues",
    "needs_clarification",
    "ignored",
    "failed",
];
function invalidOutcome(reason) {
    throw new TypeError(`DIET_MANAGER_OUTCOME_INVALID:${reason}`);
}
function exactOutcomeKeys(candidate, required, optional) {
    const keys = Object.keys(candidate).sort();
    const expected = [...required, ...optional.filter((key) => Object.hasOwn(candidate, key))].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        return invalidOutcome("keys");
    }
}
function assertClarification(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalidOutcome("clarification");
    }
    const candidate = value;
    if (Object.keys(candidate).sort().join("\0") !== "free_text_allowed\0kind\0options" ||
        candidate.kind !== "product_identity" || candidate.free_text_allowed !== true ||
        !Array.isArray(candidate.options) || candidate.options.length < 2 || candidate.options.length > 4) {
        return invalidOutcome("clarification");
    }
    const keys = ["A", "B", "C", "D"];
    for (const [index, option] of candidate.options.entries()) {
        if (typeof option !== "object" || option === null || Array.isArray(option)) {
            return invalidOutcome("clarification_option");
        }
        const record = option;
        if (Object.keys(record).sort().join("\0") !== "key\0label" || record.key !== keys[index] ||
            typeof record.label !== "string" || record.label.length === 0 || record.label.length > 128 ||
            /[\u0000-\u001F\u007F]/u.test(record.label)) {
            return invalidOutcome("clarification_option");
        }
    }
}
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
function isCanonicalFiniteDecimal(value) {
    return typeof value === "string" && value.length <= 32 && CANONICAL_DECIMAL.test(value) &&
        Number.isFinite(Number(value));
}
const NUTRITION_FIELD_NAMES = new Set([
    "energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g",
    "energy_kj", "sodium_mg", "sugar_g", "saturated_fat_g", "water_ml",
    "adopted_amount",
]);
function assertExactStringSet(value, label) {
    if (!Array.isArray(value) || value.length > 16 || new Set(value).size !== value.length ||
        value.some((item) => typeof item !== "string" || !NUTRITION_FIELD_NAMES.has(item))) {
        return invalidOutcome(label);
    }
}
function assertNutritionItem(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalidOutcome("nutrition_item");
    const item = value;
    const keys = [
        "adopted_amount", "adopted_unit", "amount_range", "coverage_status", "estimated_fields",
        "item_id", "known_fields", "missing_fields", "name", "quantity_evidence", "source_label",
    ];
    if (Object.keys(item).sort().join("\0") !== keys.join("\0") ||
        typeof item.item_id !== "string" || item.item_id.length === 0 || item.item_id.length > 128 ||
        typeof item.name !== "string" || item.name.length === 0 || item.name.length > 256 ||
        !["explicit", "field_inference", "unknown"].includes(item.quantity_evidence) ||
        !["explicit", "confirmed_history", "personal_template", "public_reference", "field_inference", "unknown"].includes(item.source_label) ||
        !["complete", "partial", "unknown"].includes(item.coverage_status)) {
        return invalidOutcome("nutrition_item");
    }
    if (item.adopted_amount === null || item.adopted_unit === null) {
        if (item.adopted_amount !== null || item.adopted_unit !== null || item.quantity_evidence !== "unknown" || item.amount_range !== null) {
            return invalidOutcome("nutrition_amount");
        }
    }
    else if (!isCanonicalFiniteDecimal(item.adopted_amount) ||
        typeof item.adopted_unit !== "string" || item.adopted_unit.length === 0 || item.adopted_unit.length > 32) {
        return invalidOutcome("nutrition_amount");
    }
    if (item.amount_range !== null) {
        if (typeof item.amount_range !== "object" || Array.isArray(item.amount_range))
            return invalidOutcome("nutrition_amount_range");
        const range = item.amount_range;
        if (Object.keys(range).sort().join("\0") !== "adopted\0max\0min\0rule_version\0unit" ||
            !isCanonicalFiniteDecimal(range.min) ||
            !isCanonicalFiniteDecimal(range.max) ||
            !isCanonicalFiniteDecimal(range.adopted) ||
            typeof range.unit !== "string" || range.unit.length === 0 || range.unit !== item.adopted_unit ||
            typeof range.rule_version !== "string" || range.rule_version.length === 0 ||
            Number(range.min) > Number(range.adopted) || Number(range.adopted) > Number(range.max) ||
            range.adopted !== item.adopted_amount || item.quantity_evidence !== "field_inference") {
            return invalidOutcome("nutrition_amount_range");
        }
    }
    const knownFields = item.known_fields;
    const missingFields = item.missing_fields;
    const estimatedFields = item.estimated_fields;
    assertExactStringSet(knownFields, "nutrition_known_fields");
    assertExactStringSet(missingFields, "nutrition_missing_fields");
    assertExactStringSet(estimatedFields, "nutrition_estimated_fields");
    if (knownFields.some((field) => missingFields.includes(field)))
        return invalidOutcome("nutrition_field_overlap");
}
function assertMealReceipt(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalidOutcome("receipt");
    const receipt = value;
    if (Object.keys(receipt).sort().join("\0") !== "items\0raw_text" ||
        typeof receipt.raw_text !== "string" || receipt.raw_text.length === 0 || receipt.raw_text.length > 4_096 ||
        !Array.isArray(receipt.items) || receipt.items.length === 0 || receipt.items.length > 64) {
        return invalidOutcome("receipt");
    }
    const inventoryStatuses = [
        "matched", "skipped_outside", "skipped_by_user", "skipped_ambiguous",
        "skipped_insufficient", "skipped_unit_incompatible", "skipped_amount_unknown",
    ];
    for (const value of receipt.items) {
        if (typeof value !== "object" || value === null || Array.isArray(value))
            return invalidOutcome("receipt_item");
        const item = value;
        if (Object.keys(item).sort().join("\0") !== "derived\0inventory\0item_id\0name\0nutrition\0quantity\0unit" ||
            typeof item.item_id !== "string" || item.item_id.length === 0 ||
            typeof item.name !== "string" || item.name.length === 0 ||
            typeof item.derived !== "boolean" ||
            (item.quantity !== null && (!Number.isFinite(item.quantity) || Number(item.quantity) <= 0)) ||
            (item.unit !== null && (typeof item.unit !== "string" || item.unit.length === 0)) ||
            (item.quantity === null) !== (item.unit === null))
            return invalidOutcome("receipt_item");
        const nutrition = item.nutrition;
        const inventory = item.inventory;
        if (typeof nutrition !== "object" || nutrition === null || Array.isArray(nutrition) ||
            Object.keys(nutrition).sort().join("\0") !== "source\0status" ||
            !["complete", "partial", "unknown"].includes(String(nutrition.status)) ||
            !["explicit", "confirmed_history", "personal_template", "public_reference", "field_inference", "unknown"]
                .includes(String(nutrition.source)) ||
            typeof inventory !== "object" || inventory === null || Array.isArray(inventory) ||
            Object.keys(inventory).join("\0") !== "status" || !inventoryStatuses.includes(String(inventory.status))) {
            return invalidOutcome("receipt_item_effects");
        }
    }
}
function assertDailyProgress(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalidOutcome("daily_progress");
    const progress = value;
    if (Object.keys(progress).sort().join("\0") !==
        "corrections\0date\0inventory\0meals\0nutrition\0purchases\0timezone\0water" ||
        typeof progress.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(progress.date) ||
        progress.timezone !== "Asia/Shanghai")
        return invalidOutcome("daily_progress");
    const exactCount = (entry, key) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
            return invalidOutcome("daily_progress_count");
        const record = entry;
        if (Object.keys(record).join("\0") !== key || !Number.isSafeInteger(record[key]) || Number(record[key]) < 0) {
            return invalidOutcome("daily_progress_count");
        }
        return Number(record[key]);
    };
    exactCount(progress.meals, "count");
    exactCount(progress.purchases, "count");
    exactCount(progress.corrections, "count");
    exactCount(progress.inventory, "deduction_count");
    if (typeof progress.water !== "object" || progress.water === null || Array.isArray(progress.water)) {
        return invalidOutcome("daily_progress_water");
    }
    const water = progress.water;
    if (Object.keys(water).sort().join("\0") !== "count\0plain_water_ml_milli" ||
        !Number.isSafeInteger(water.count) || Number(water.count) < 0 ||
        !Number.isSafeInteger(water.plain_water_ml_milli) || Number(water.plain_water_ml_milli) < 0) {
        return invalidOutcome("daily_progress_water");
    }
    if (typeof progress.nutrition !== "object" || progress.nutrition === null || Array.isArray(progress.nutrition)) {
        return invalidOutcome("daily_progress_nutrition");
    }
    const nutrition = progress.nutrition;
    if (Object.keys(nutrition).sort().join("\0") !== "coverage_status\0nutrients" ||
        !["complete", "partial", "unknown"].includes(String(nutrition.coverage_status)) ||
        typeof nutrition.nutrients !== "object" || nutrition.nutrients === null || Array.isArray(nutrition.nutrients)) {
        return invalidOutcome("daily_progress_nutrition");
    }
    const nutrients = nutrition.nutrients;
    const fields = ["carbohydrate_mg", "energy_kcal_milli", "fat_mg", "fiber_mg", "protein_mg", "water_ml_milli"];
    if (Object.keys(nutrients).sort().join("\0") !== fields.join("\0") ||
        fields.some((field) => nutrients[field] !== null &&
            (!Number.isSafeInteger(nutrients[field]) || Number(nutrients[field]) < 0))) {
        return invalidOutcome("daily_progress_nutrients");
    }
}
function boundedText(value, reason, max = 512) {
    if (typeof value !== "string" || value.length === 0 || value.length > max ||
        /[\u0000-\u001F\u007F]/u.test(value))
        return invalidOutcome(reason);
    return value;
}
function assertMealHistory(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalidOutcome("meal_history");
    const view = value;
    if (Object.keys(view).sort().join("\0") !== "date\0meals\0timezone" ||
        typeof view.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(view.date) ||
        view.timezone !== "Asia/Shanghai" || !Array.isArray(view.meals) || view.meals.length > 512) {
        return invalidOutcome("meal_history");
    }
    for (const mealValue of view.meals) {
        if (typeof mealValue !== "object" || mealValue === null || Array.isArray(mealValue)) {
            return invalidOutcome("meal_history_meal");
        }
        const meal = mealValue;
        if (Object.keys(meal).sort().join("\0") !== "items\0location\0meal_slot\0occurred_at" ||
            !Number.isFinite(Date.parse(String(meal.occurred_at))) ||
            !["home", "outside"].includes(String(meal.location)) ||
            !Array.isArray(meal.items) || meal.items.length > 64)
            return invalidOutcome("meal_history_meal");
        boundedText(meal.meal_slot, "meal_history_slot", 64);
        for (const [index, itemValue] of meal.items.entries()) {
            if (typeof itemValue !== "object" || itemValue === null || Array.isArray(itemValue)) {
                return invalidOutcome("meal_history_item");
            }
            const item = itemValue;
            if (Object.keys(item).sort().join("\0") !==
                "item_order\0item_type\0name\0quantity_evidence\0quantity_microunits\0unit" ||
                item.item_order !== index ||
                (item.quantity_microunits !== null &&
                    (!Number.isSafeInteger(item.quantity_microunits) || Number(item.quantity_microunits) <= 0)) ||
                !["explicit", "estimated_upper_bound", "unknown"].includes(String(item.quantity_evidence)) ||
                (item.quantity_microunits === null) !== (item.quantity_evidence === "unknown")) {
                return invalidOutcome("meal_history_item");
            }
            boundedText(item.item_type, "meal_history_item_type", 64);
            boundedText(item.name, "meal_history_item_name", 256);
            boundedText(item.unit, "meal_history_item_unit", 64);
        }
    }
}
function assertInventoryView(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalidOutcome("inventory_view");
    const view = value;
    if (Object.keys(view).join("\0") !== "batches" || !Array.isArray(view.batches) || view.batches.length > 2_048) {
        return invalidOutcome("inventory_view");
    }
    for (const batchValue of view.batches) {
        if (typeof batchValue !== "object" || batchValue === null || Array.isArray(batchValue)) {
            return invalidOutcome("inventory_batch");
        }
        const batch = batchValue;
        if (Object.keys(batch).sort().join("\0") !==
            "batch_id\0effective_status\0expiration_at\0location\0name\0product_id\0product_type\0quantity_microunits\0quantity_status\0unit" ||
            (batch.quantity_microunits !== null &&
                (!Number.isSafeInteger(batch.quantity_microunits) || Number(batch.quantity_microunits) < 0)) ||
            !["available", "empty", "unknown"].includes(String(batch.quantity_status)) ||
            !["active", "empty"].includes(String(batch.effective_status)) ||
            (batch.expiration_at !== null && !Number.isFinite(Date.parse(String(batch.expiration_at))))) {
            return invalidOutcome("inventory_batch");
        }
        boundedText(batch.batch_id, "inventory_batch_id", 128);
        boundedText(batch.product_id, "inventory_product_id", 128);
        boundedText(batch.name, "inventory_name", 256);
        boundedText(batch.product_type, "inventory_product_type", 64);
        boundedText(batch.unit, "inventory_unit", 64);
        boundedText(batch.location, "inventory_location", 128);
    }
}
function assertCorrection(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalidOutcome("correction");
    }
    const candidate = value;
    if (Object.keys(candidate).sort().join("\0") !==
        "compensation_transaction_id\0correction_id\0current_active\0operation\0revision\0target_event_id") {
        return invalidOutcome("correction");
    }
    boundedText(candidate.correction_id, "correction_id", 128);
    boundedText(candidate.target_event_id, "correction_target_event_id", 128);
    if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 1) {
        return invalidOutcome("correction_revision");
    }
    if (!["void_event", "change_amount", "change_time", "change_water_classification"]
        .includes(candidate.operation)) {
        return invalidOutcome("correction_operation");
    }
    if (typeof candidate.current_active !== "boolean")
        return invalidOutcome("correction_active");
    if (candidate.compensation_transaction_id !== null) {
        boundedText(candidate.compensation_transaction_id, "correction_compensation", 128);
    }
}
export function assertDietManagerOutcome(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalidOutcome("shape");
    }
    const candidate = value;
    if (typeof candidate.action !== "string" ||
        !dietManagerActions.includes(candidate.action)) {
        return invalidOutcome("action");
    }
    if (typeof candidate.status !== "string" ||
        !dietManagerStatuses.includes(candidate.status)) {
        return invalidOutcome("status");
    }
    if (typeof candidate.committed !== "boolean") {
        return invalidOutcome("committed");
    }
    const hasCommittedStatus = candidate.status === "committed" ||
        candidate.status === "committed_with_issues";
    if (candidate.committed !== hasCommittedStatus) {
        return invalidOutcome("commit_status");
    }
    if (!candidate.committed && candidate.record_id !== undefined) {
        return invalidOutcome("failed_record_id");
    }
    if ((candidate.status === "needs_clarification" ||
        candidate.status === "ignored") &&
        (typeof candidate.reason_code !== "string" ||
            candidate.reason_code.trim().length === 0)) {
        return invalidOutcome("reason_code");
    }
    if (candidate.status === "failed" &&
        (typeof candidate.error_code !== "string" ||
            candidate.error_code.trim().length === 0)) {
        return invalidOutcome("error_code");
    }
    if (hasCommittedStatus &&
        (typeof candidate.operation_id !== "string" ||
            candidate.operation_id.trim().length === 0 ||
            typeof candidate.record_id !== "string" ||
            candidate.record_id.trim().length === 0)) {
        return invalidOutcome("committed_identity");
    }
    if (candidate.status === "failed") {
        exactOutcomeKeys(candidate, ["action", "status", "committed", "error_code"], ["operation_id"]);
    }
    else if (candidate.status === "needs_clarification" || candidate.status === "ignored") {
        exactOutcomeKeys(candidate, ["action", "status", "committed", "reason_code"], ["operation_id", "question", "clarification", "daily_progress", "meal_history", "inventory_view", "correction"]);
    }
    else {
        exactOutcomeKeys(candidate, ["action", "status", "committed", "operation_id", "record_id"], ["record_ids", "nutrition_items", "receipt", "correction"]);
    }
    if (candidate.clarification !== undefined) {
        if (candidate.status !== "needs_clarification")
            return invalidOutcome("clarification_status");
        assertClarification(candidate.clarification);
    }
    if (candidate.question !== undefined) {
        if (candidate.status !== "needs_clarification")
            return invalidOutcome("question_status");
        boundedText(candidate.question, "question", 512);
    }
    if (candidate.record_ids !== undefined) {
        if (!hasCommittedStatus || !Array.isArray(candidate.record_ids) || candidate.record_ids.length < 2 ||
            candidate.record_ids.length > 64 || candidate.record_ids[0] !== candidate.record_id ||
            new Set(candidate.record_ids).size !== candidate.record_ids.length ||
            candidate.record_ids.some((id) => typeof id !== "string" || id.length === 0)) {
            return invalidOutcome("record_ids");
        }
    }
    if (candidate.nutrition_items !== undefined) {
        if (!hasCommittedStatus || !Array.isArray(candidate.nutrition_items) || candidate.nutrition_items.length < 1 ||
            candidate.nutrition_items.length > 64)
            return invalidOutcome("nutrition_items");
        for (const item of candidate.nutrition_items)
            assertNutritionItem(item);
        if (new Set(candidate.nutrition_items.map((item) => item.item_id)).size !== candidate.nutrition_items.length) {
            return invalidOutcome("nutrition_items_duplicate");
        }
    }
    if (candidate.receipt !== undefined) {
        if (!hasCommittedStatus || candidate.action !== "record_meal")
            return invalidOutcome("receipt_status");
        assertMealReceipt(candidate.receipt);
    }
    if (candidate.daily_progress !== undefined) {
        if (candidate.action !== "query_daily_summary" || candidate.status !== "ignored" ||
            candidate.reason_code !== "read_only_result")
            return invalidOutcome("daily_progress_status");
        assertDailyProgress(candidate.daily_progress);
    }
    if (candidate.meal_history !== undefined) {
        if (candidate.action !== "query_meals" || candidate.status !== "ignored" ||
            candidate.reason_code !== "read_only_result" || candidate.inventory_view !== undefined ||
            candidate.daily_progress !== undefined)
            return invalidOutcome("meal_history_status");
        assertMealHistory(candidate.meal_history);
    }
    if (candidate.inventory_view !== undefined) {
        if (candidate.action !== "query_inventory" || candidate.status !== "ignored" ||
            candidate.reason_code !== "read_only_result" || candidate.meal_history !== undefined ||
            candidate.daily_progress !== undefined)
            return invalidOutcome("inventory_view_status");
        assertInventoryView(candidate.inventory_view);
    }
    if (candidate.correction !== undefined) {
        if (candidate.action !== "undo_record")
            return invalidOutcome("correction_action");
        assertCorrection(candidate.correction);
    }
    return candidate;
}
