import { canonicalJson } from "../authority/canonical-json.js";
import { deriveDomainId } from "./identity.js";
const FREE_TEXT_LINE = "也可以直接说明实际情况，不必选择以上选项。";
function invalid(reason) {
    throw new TypeError(`RECEIPT_DATA_INVALID:${reason}`);
}
function timestamp(value, field) {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        return invalid(field);
    }
    return value;
}
function safeText(value, field, maxLength) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > maxLength ||
        /[\u0000-\u001F\u007F]/.test(value))
        return invalid(field);
    return value;
}
function exactRecord(value, fields, reason) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalid(reason);
    const record = value;
    if (Object.keys(record).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        return invalid(reason);
    }
    return record;
}
function freezeProgress(value) {
    return Object.freeze({
        date: value.date,
        timezone: value.timezone,
        coverage_status: value.coverage_status,
        nutrients: Object.freeze({ ...value.nutrients }),
    });
}
export function buildQuickPrompt(input) {
    const issueId = safeText(input.issue_id, "issue_id", 128);
    if (!/^issue-[a-f0-9]{32}$/.test(issueId))
        return invalid("issue_id");
    if (!Number.isSafeInteger(input.revision) || input.revision < 1)
        return invalid("revision");
    const generatedAt = timestamp(input.generated_at, "generated_at");
    const expiresAt = timestamp(input.expires_at, "expires_at");
    if (Date.parse(expiresAt) <= Date.parse(generatedAt))
        return invalid("expires_at");
    const allowedCodes = new Set([
        "inventory_multiple_candidates",
        "inventory_insufficient",
        "inventory_unit_incompatible",
        "inventory_amount_unknown",
    ]);
    if (!allowedCodes.has(input.issue_code))
        return invalid("issue_code");
    const options = Object.freeze([
        Object.freeze({
            option_id: "keep_original",
            kind: "safe_exit",
            label: "保持当前记录，不修改库存",
        }),
        Object.freeze({
            option_id: "defer",
            kind: "defer",
            label: "稍后处理",
        }),
        Object.freeze({
            option_id: "free_text",
            kind: "free_text",
            label: FREE_TEXT_LINE,
        }),
    ]);
    return Object.freeze({
        authority_kind: "diet-manager/quick-prompt/v1",
        prompt_id: deriveDomainId("prompt", issueId, input.revision),
        issue_id: issueId,
        issue_code: input.issue_code,
        option_ids: Object.freeze([
            "keep_original", "defer", "free_text",
        ]),
        options,
        generated_from_revision: input.revision,
        generated_at: generatedAt,
        expires_at: expiresAt,
        safe_exit_required: true,
        accepts_combinations: true,
        accepts_natural_language: true,
        free_text_line: FREE_TEXT_LINE,
    });
}
export function freezeQuickPrompt(value) {
    const record = exactRecord(value, [
        "accepts_combinations",
        "accepts_natural_language",
        "authority_kind",
        "expires_at",
        "free_text_line",
        "generated_at",
        "generated_from_revision",
        "issue_code",
        "issue_id",
        "option_ids",
        "options",
        "prompt_id",
        "safe_exit_required",
    ], "quick_prompt");
    const expected = buildQuickPrompt({
        issue_id: String(record.issue_id),
        issue_code: record.issue_code,
        revision: Number(record.generated_from_revision),
        generated_at: String(record.generated_at),
        expires_at: String(record.expires_at),
    });
    if (canonicalJson(record) !== canonicalJson(expected))
        return invalid("quick_prompt");
    return expected;
}
export function buildReceiptData(input) {
    const date = safeText(input.date, "date", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return invalid("date");
    const mealSlot = safeText(input.meal_slot, "meal_slot", 64);
    if (input.status === "effects_pending") {
        return Object.freeze({
            authority_kind: "diet-manager/receipt-data/v1",
            status: "pending",
            blocks: Object.freeze([
                Object.freeze({ kind: "pending", code: "effects_pending" }),
            ]),
        });
    }
    if (input.daily_progress === null)
        return invalid("daily_progress");
    if (input.items.length === 0 || input.items.length > 256)
        return invalid("items");
    const blocks = [Object.freeze({
            kind: "title",
            date,
            meal_slot: mealSlot,
        })];
    for (let index = 0; index < input.items.length; index += 1) {
        const item = input.items[index];
        if (item.item_order !== index)
            return invalid("item_order");
        if (item.observed_microunits !== null &&
            (!Number.isSafeInteger(item.observed_microunits) || item.observed_microunits < 0)) {
            return invalid("observed_microunits");
        }
        if ((item.observed_microunits === null) !== (item.amount_evidence === "unknown")) {
            return invalid("amount_evidence");
        }
        const estimatedFields = Object.freeze([...item.estimated_fields]);
        blocks.push(Object.freeze({
            kind: "item",
            item_order: item.item_order,
            name: safeText(item.normalized_name, "normalized_name", 256),
            amount: Object.freeze({
                observed_microunits: item.observed_microunits,
                unit: safeText(item.unit, "unit", 32),
                evidence: item.amount_evidence === "unknown"
                    ? "unknown"
                    : estimatedFields.includes("observed_microunits")
                        ? "estimated"
                        : "explicit",
            }),
            estimated_fields: estimatedFields,
            inventory_effect: Object.freeze({ status: item.inventory_match }),
            issue_codes: Object.freeze([...item.issue_codes]),
        }));
    }
    if (input.quick_prompts.length > 0) {
        blocks.push(Object.freeze({
            kind: "issues",
            prompts: Object.freeze(input.quick_prompts.map((prompt) => Object.freeze({
                issue_code: prompt.issue_code,
                options: Object.freeze(prompt.options.map((option) => Object.freeze({ ...option }))),
                accepts_combinations: true,
                accepts_natural_language: true,
                free_text_line: FREE_TEXT_LINE,
            }))),
        }));
    }
    blocks.push(Object.freeze({
        kind: "progress",
        daily_progress: freezeProgress(input.daily_progress),
    }));
    return Object.freeze({
        authority_kind: "diet-manager/receipt-data/v1",
        status: "success",
        blocks: Object.freeze(blocks),
    });
}
export function rebaseReceiptProgress(receipt, dailyProgress) {
    if (receipt.authority_kind !== "diet-manager/receipt-data/v1" ||
        receipt.status !== "success" ||
        receipt.blocks.length < 2 ||
        receipt.blocks.at(-1)?.kind !== "progress" ||
        receipt.blocks.slice(0, -1).some((block) => block.kind === "progress"))
        return invalid("progress_block");
    return Object.freeze({
        authority_kind: "diet-manager/receipt-data/v1",
        status: "success",
        blocks: Object.freeze([
            ...receipt.blocks.slice(0, -1),
            Object.freeze({
                kind: "progress",
                daily_progress: freezeProgress(dailyProgress),
            }),
        ]),
    });
}
