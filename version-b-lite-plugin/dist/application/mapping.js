import { createHash } from "node:crypto";
import { canonicalJson } from "../authority/canonical-json.js";
function identity(request) {
    return createHash("sha256")
        .update("diet-manager/application-envelope/v1\n", "ascii")
        .update(request.operation_id, "utf8").update("\0", "ascii")
        .update(request.source_message_id, "utf8").update("\0", "ascii")
        .update(request.conversation_id, "utf8").digest("hex").toUpperCase();
}
function mealSlot(sourceText) {
    for (const token of ["早餐", "午餐", "晚餐", "加餐", "夜宵"]) {
        if (sourceText.includes(token))
            return token;
    }
    return "unknown";
}
function location(command) {
    return command.context?.scene === "outside" || command.context?.scene === "company"
        ? "outside" : "home";
}
function operation(command) {
    if (command.action === "record_water")
        return {
            kind: "record_water", operation_id: command.operation_id,
            occurred_time: command.occurred_time, source_text: command.source_text,
            plain_water_ml_milli: command.plain_water_ml_milli,
            amount_evidence: command.amount_evidence,
        };
    if (command.action !== "record_meal" || command.occurred_time.resolved_start === null) {
        throw new Error("CORE_APPLICATION_MAPPING_INVALID:command");
    }
    return {
        kind: "record_meal", operation_id: command.operation_id,
        occurred_at: new Date(command.occurred_time.resolved_start).toISOString(),
        meal_slot: mealSlot(command.source_text), location: location(command),
        items: command.items.map((item) => ({
            normalized_name: item.normalized_name,
            item_type: item.kind === "food" ? "food" : "nutrition_drink",
            amount: {
                unit: item.unit ?? "unknown",
                observed_microunits: item.quantity === null ? null : item.quantity * 1_000_000,
                nutrition_adoption_microunits: null, inventory_deduction_microunits: null,
                template_reference_microunits: null,
                evidence: item.quantity === null ? "unknown"
                    : item.estimated === false ? "explicit" : "estimated_upper_bound",
            },
            nutrition_sources: [],
        })),
        source_text: command.source_text, occurred_time: command.occurred_time,
        subject: command.subject,
        ...(command.context === undefined ? {} : { context: command.context }),
    };
}
function deepFreeze(value) {
    if (typeof value !== "object" || value === null || Object.isFrozen(value))
        return;
    for (const child of Object.values(value))
        deepFreeze(child);
    Object.freeze(value);
}
export function mapCoreCandidateToEnvelope(request, command) {
    const digest = identity(request);
    const envelope = JSON.parse(canonicalJson({
        envelope_id: `envelope-${digest.slice(0, 32).toLowerCase()}`,
        idempotency_key: `core-${digest}`, command_type: request.action,
        subject_scope: "user:self", source_message_id: request.source_message_id,
        conversation_id: request.conversation_id, received_at: request.received_at,
        timezone: "Asia/Shanghai", operations: [operation(command)],
    }));
    deepFreeze(envelope);
    return envelope;
}
