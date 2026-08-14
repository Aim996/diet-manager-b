import { isProxy } from "node:util/types";
import { defineToolPlugin, } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import { handleCoreRequestAsync } from "../application/command-handler.js";
import { failedOutcome } from "../application/outcome.js";
import { createCoreRuntime } from "../application/runtime.js";
import { assertPrivateRuntimeRoot } from "../storage/database.js";
import { cloneNutritionRuntimeConfig } from "../nutrition/config.js";
import { FoodDataCentralAdapter } from "../nutrition/adapters/fooddata-central.js";
import { FoodDataCentralHttpTransport } from "../nutrition/adapters/fooddata-central-http.js";
import { assertDietManagerOutcome, dietManagerActions, dietManagerContract, } from "../contracts.js";
const actionSchema = Type.Union([
    Type.Literal("record_meal"),
    Type.Literal("record_water"),
    Type.Literal("add_inventory"),
    Type.Literal("query_inventory"),
    Type.Literal("query_meals"),
    Type.Literal("query_daily_summary"),
    Type.Literal("correct_record"),
    Type.Literal("undo_record"),
]);
const legacyItemSchema = Type.Object({
    name: Type.String(),
    quantity: Type.Optional(Type.Number()),
    unit: Type.Optional(Type.String()),
    per_item_amount: Type.Optional(Type.Number()),
    per_item_unit: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const dietManagerParameters = Type.Object({
    action: actionSchema,
    operation_id: Type.Optional(Type.String({
        description: "Operational calls require this field: use one stable identifier for the current attempted operation.",
    })),
    source_text: Type.Optional(Type.String({
        description: "Operational calls require this field: copy the user's current message verbatim; never normalize or invent food facts.",
    })),
    occurred_at_text: Type.Optional(Type.String({
        description: "Legacy compatibility evidence; never substitutes for received_at.",
    })),
    items: Type.Optional(Type.Array(legacyItemSchema, {
        description: "Legacy compatibility evidence; the core parses source_text authoritatively.",
    })),
    received_at: Type.Optional(Type.String({
        description: "Operational calls require this field: use the current inbound OpenClaw message timestamp as an ISO offset timestamp.",
    })),
    timezone: Type.Optional(Type.Literal("Asia/Shanghai", {
        description: "Operational calls require this field; use Asia/Shanghai.",
    })),
    source_message_id: Type.Optional(Type.String({
        description: "Operational calls require this field: use the stable identifier of the current inbound OpenClaw message.",
    })),
    conversation_id: Type.Optional(Type.String({
        description: "Operational calls require this field: use the current OpenClaw session or conversation identifier.",
    })),
}, {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
});
const nutritionSourceConfigSchema = Type.Object({
    source_id: Type.Literal("public.usda_fooddata_central"),
    enabled: Type.Boolean(),
    backend_id: Type.Literal("fooddata-central"),
    backend_version: Type.Literal("api-v1"),
}, { additionalProperties: false });
const nutritionConfigSchema = Type.Object({
    policy_version: Type.String(),
    resolution_deadline_ms: Type.Optional(Type.Integer({ minimum: 500, maximum: 5000 })),
    sources: Type.Array(nutritionSourceConfigSchema, { maxItems: 32 }),
    credential_refs: Type.Optional(Type.Object({
        "public.usda_fooddata_central": Type.Optional(Type.Literal("env:FDC_API_KEY", {
            description: "Private backend reference. The API key is read only from the FDC_API_KEY environment variable.",
        })),
    }, { additionalProperties: false })),
}, { additionalProperties: false });
const coreConfigSchema = Type.Object({
    official_data_root: Type.String({
        description: "Absolute existing runtime root owned and configured only by the Diet Manager backend.",
        "x-diet-manager-root-semantics": "backend_owned_existing_absolute_runtime_root",
    }),
    nutrition: Type.Optional(nutritionConfigSchema),
}, {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
});
const PARAMETER_FIELDS = Object.freeze([
    "action",
    "operation_id",
    "source_text",
    "occurred_at_text",
    "items",
    "received_at",
    "timezone",
    "source_message_id",
    "conversation_id",
]);
const CORE_REQUEST_FIELDS = Object.freeze([
    "action",
    "source_text",
    "received_at",
    "timezone",
    "operation_id",
    "source_message_id",
    "conversation_id",
]);
const FDC_CREDENTIAL_REFERENCE = "env:FDC_API_KEY";
function configuredNutritionAdapters(nutrition) {
    const entry = nutrition.sources.find((candidate) => candidate.source_id === "public.usda_fooddata_central" && candidate.enabled);
    if (entry === undefined)
        return Object.freeze([]);
    if (entry.backend_id !== "fooddata-central" || entry.backend_version !== "api-v1" ||
        entry.credential_ref !== FDC_CREDENTIAL_REFERENCE) {
        throw new TypeError("OPENCLAW_AUTHORITY_INVALID:nutrition_source");
    }
    return Object.freeze([
        new FoodDataCentralAdapter(new FoodDataCentralHttpTransport(), FDC_CREDENTIAL_REFERENCE),
    ]);
}
const environmentNutritionCredential = (reference) => {
    if (reference !== FDC_CREDENTIAL_REFERENCE)
        return undefined;
    const value = process.env.FDC_API_KEY;
    if (value === undefined || value.length === 0 || value.length > 128 || /[^A-Za-z0-9_-]/u.test(value)) {
        return undefined;
    }
    return Object.freeze({ value: new TextEncoder().encode(value) });
};
const pluginRuntimeStates = new WeakMap();
const pluginRuntimeOwners = new WeakMap();
function isOrdinaryObject(value) {
    return typeof value === "object" && value !== null && !isProxy(value) &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function dataDescriptors(value, allowedFields, requiredFields = allowedFields) {
    if (!isOrdinaryObject(value))
        throw new TypeError("OPENCLAW_AUTHORITY_INVALID:shape");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowedFields.includes(key)) ||
        requiredFields.some((key) => !keys.includes(key))) {
        throw new TypeError("OPENCLAW_AUTHORITY_INVALID:keys");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of keys) {
        const descriptor = descriptors[field];
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value") ||
            descriptor.enumerable !== true) {
            throw new TypeError(`OPENCLAW_AUTHORITY_INVALID:${field}:descriptor`);
        }
    }
    return descriptors;
}
function cloneToolRequest(value) {
    const descriptors = dataDescriptors(value, PARAMETER_FIELDS, ["action"]);
    if (CORE_REQUEST_FIELDS.some((field) => descriptors[field] === undefined))
        return undefined;
    return {
        action: descriptors.action?.value,
        source_text: descriptors.source_text?.value,
        received_at: descriptors.received_at?.value,
        timezone: descriptors.timezone?.value,
        operation_id: descriptors.operation_id?.value,
        source_message_id: descriptors.source_message_id?.value,
        conversation_id: descriptors.conversation_id?.value,
        // PRODUCT-0.1 core exposes no caller-authored context/revision authority.
        prior_context: [],
    };
}
function clonePluginConfig(value) {
    const descriptors = dataDescriptors(value, ["official_data_root", "nutrition"], ["official_data_root"]);
    const root = descriptors.official_data_root?.value;
    if (typeof root !== "string")
        throw new TypeError("OPENCLAW_AUTHORITY_INVALID:config_root");
    return Object.freeze({
        root,
        nutrition: cloneNutritionRuntimeConfig(descriptors.nutrition?.value),
    });
}
function safeRequestIdentity(value) {
    try {
        if (!isOrdinaryObject(value))
            return { action: "record_meal" };
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const actionValue = descriptors.action;
        const operationValue = descriptors.operation_id;
        const action = actionValue !== undefined && Object.hasOwn(actionValue, "value") &&
            typeof actionValue.value === "string" &&
            dietManagerActions.includes(actionValue.value)
            ? actionValue.value
            : "record_meal";
        const operationId = operationValue !== undefined && Object.hasOwn(operationValue, "value") &&
            typeof operationValue.value === "string"
            ? operationValue.value
            : undefined;
        return operationId === undefined ? { action } : { action, operationId };
    }
    catch {
        return { action: "record_meal" };
    }
}
function validatedJsonOutcome(value) {
    const outcome = assertDietManagerOutcome(value);
    JSON.parse(JSON.stringify(outcome));
    return outcome;
}
function samePhysicalRoot(left, right) {
    return process.platform === "win32"
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
}
function releasePluginRuntime(runtime, api) {
    const owners = pluginRuntimeOwners.get(runtime);
    if (owners === undefined || !owners.delete(api))
        return;
    if (owners.size !== 0)
        return;
    pluginRuntimeOwners.delete(runtime);
    runtime.close();
}
function acquirePluginRuntime(root, nutrition, context) {
    const physicalRoot = assertPrivateRuntimeRoot(root);
    let state = pluginRuntimeStates.get(context.api);
    if (state === undefined) {
        state = { lifecycleRegistered: false };
        pluginRuntimeStates.set(context.api, state);
    }
    if (state.physicalRoot !== undefined &&
        !samePhysicalRoot(state.physicalRoot, physicalRoot)) {
        throw new Error("PLUGIN_CONFIG_CONFLICT");
    }
    if (state.sourceConfigDigest !== undefined && state.sourceConfigDigest !== nutrition.source_config_digest) {
        throw new Error("PLUGIN_CONFIG_CONFLICT");
    }
    const candidate = createCoreRuntime({
        officialDataRoot: physicalRoot,
        now: () => new Date().toISOString(),
        nutritionConfig: nutrition,
        nutritionAdapters: configuredNutritionAdapters(nutrition),
        nutritionCredential: environmentNutritionCredential,
    });
    if (state.runtime === undefined) {
        state.runtime = candidate;
        state.physicalRoot = physicalRoot;
        state.sourceConfigDigest = nutrition.source_config_digest;
        let owners = pluginRuntimeOwners.get(candidate);
        if (owners === undefined) {
            owners = new Set();
            pluginRuntimeOwners.set(candidate, owners);
        }
        owners.add(context.api);
    }
    else if (state.runtime !== candidate) {
        throw new Error("PLUGIN_CONFIG_CONFLICT");
    }
    if (!state.lifecycleRegistered) {
        const ownedState = state;
        try {
            context.api.lifecycle.registerRuntimeLifecycle({
                id: "diet-manager-b-runtime",
                description: "Close the Diet Manager SQLite runtime on plugin cleanup.",
                cleanup() {
                    if (ownedState.runtime !== undefined) {
                        releasePluginRuntime(ownedState.runtime, context.api);
                    }
                    ownedState.runtime = undefined;
                    ownedState.physicalRoot = undefined;
                    ownedState.sourceConfigDigest = undefined;
                    pluginRuntimeStates.delete(context.api);
                },
            });
            state.lifecycleRegistered = true;
        }
        catch (error) {
            releasePluginRuntime(state.runtime, context.api);
            state.runtime = undefined;
            state.physicalRoot = undefined;
            state.sourceConfigDigest = undefined;
            pluginRuntimeStates.delete(context.api);
            throw error;
        }
    }
    return state.runtime;
}
async function executeDietManager(value, configValue, context) {
    const identity = safeRequestIdentity(value);
    let request;
    try {
        request = cloneToolRequest(value);
    }
    catch {
        return validatedJsonOutcome(failedOutcome(identity.action, identity.operationId, "INVALID_REQUEST"));
    }
    if (request === undefined) {
        return validatedJsonOutcome(failedOutcome(identity.action, identity.operationId, "APPLICATION_AUTHORITY_REQUIRED"));
    }
    let pluginConfig;
    try {
        pluginConfig = clonePluginConfig(configValue);
    }
    catch {
        return validatedJsonOutcome(failedOutcome(request.action, request.operation_id, "PLUGIN_CONFIG_INVALID"));
    }
    try {
        const runtime = acquirePluginRuntime(pluginConfig.root, pluginConfig.nutrition, context);
        return validatedJsonOutcome(await handleCoreRequestAsync(runtime, request));
    }
    catch (error) {
        const errorCode = error instanceof Error && error.message === "PLUGIN_CONFIG_CONFLICT"
            ? "PLUGIN_CONFIG_CONFLICT"
            : "PLUGIN_RUNTIME_UNAVAILABLE";
        return validatedJsonOutcome(failedOutcome(request.action, request.operation_id, errorCode));
    }
}
export default defineToolPlugin({
    id: "diet-manager-b",
    name: "Diet Manager B",
    description: "A deterministic meal and plain-water recording tool.",
    activation: { onStartup: true },
    configSchema: coreConfigSchema,
    tools: (tool) => [
        tool({
            name: "diet_manager",
            description: "Record/query Diet Manager facts. For every operational call, send all seven fields: action, exact source_text, received_at, timezone, operation_id, source_message_id, and conversation_id. Take timing and identifiers from current OpenClaw message/session metadata; do not omit them. Call diet_manager at most once for one inbound message. After a non-committed write result, do not retry, inspect files, run commands, use memory, or switch to another tool; report the result and ask only the returned clarification. When committed=false, the first sentence must say the request was not recorded. Never say recorded, noted, saved, or updated when committed=false. For an explicit future plan or negative statement, make no tool call, say it was not recorded, and only create a reminder when the user explicitly asks. For read_only_result, answer only from the returned data without claiming a write; do not write a note, memory, or fallback record. Keep the reply to the result and one necessary clarification. Do not add encouragement, onboarding, capability offers, or reminder suggestions. Use only returned nutrition data and never estimate nutrition values yourself.",
            parameters: dietManagerParameters,
            execute: executeDietManager,
        }),
    ],
});
