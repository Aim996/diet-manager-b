import { isProxy } from "node:util/types";
import {
  defineToolPlugin,
  type ToolPluginExecutionContext,
} from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";

import { handleCoreRequestAsync } from "../application/command-handler.js";
import { failedOutcome } from "../application/outcome.js";
import { createCoreRuntime, type CoreRuntime } from "../application/runtime.js";
import { assertPrivateRuntimeRoot } from "../storage/database.js";
import { cloneNutritionRuntimeConfig } from "../nutrition/config.js";
import type { NutritionRuntimeConfig } from "../nutrition/types.js";
import {
  assertDietManagerOutcome,
  dietManagerActions,
  dietManagerContract,
  type CoreApplicationRequest,
  type DietManagerAction,
  type DietManagerOutcome,
} from "../contracts.js";

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

const legacyItemSchema = Type.Object(
  {
    name: Type.String(),
    quantity: Type.Optional(Type.Number()),
    unit: Type.Optional(Type.String()),
    per_item_amount: Type.Optional(Type.Number()),
    per_item_unit: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const dietManagerParameters = Type.Object(
  {
    action: actionSchema,
    operation_id: Type.Optional(Type.String()),
    source_text: Type.Optional(Type.String()),
    occurred_at_text: Type.Optional(Type.String({
      description: "Legacy compatibility evidence; never substitutes for received_at.",
    })),
    items: Type.Optional(Type.Array(legacyItemSchema, {
      description: "Legacy compatibility evidence; the core parses source_text authoritatively.",
    })),
    received_at: Type.Optional(Type.String()),
    timezone: Type.Optional(Type.Literal("Asia/Shanghai")),
    source_message_id: Type.Optional(Type.String()),
    conversation_id: Type.Optional(Type.String()),
  },
  {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
  },
);

const nutritionSourceConfigSchema = Type.Object({
  source_id: Type.String(),
  enabled: Type.Boolean(),
  backend_id: Type.String(),
  backend_version: Type.String(),
}, { additionalProperties: false });

const nutritionConfigSchema = Type.Object({
  policy_version: Type.String(),
  resolution_deadline_ms: Type.Optional(Type.Integer({ minimum: 500, maximum: 5000 })),
  sources: Type.Array(nutritionSourceConfigSchema, { maxItems: 32 }),
  credential_refs: Type.Optional(Type.Record(Type.String(), Type.String())),
}, { additionalProperties: false });

const coreConfigSchema = Type.Object(
  {
    official_data_root: Type.String({
      description:
        "Absolute existing runtime root owned and configured only by the Diet Manager backend.",
      "x-diet-manager-root-semantics":
        "backend_owned_existing_absolute_runtime_root",
    }),
    nutrition: Type.Optional(nutritionConfigSchema),
  },
  {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
  },
);

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
] as const);

const CORE_REQUEST_FIELDS = Object.freeze([
  "action",
  "source_text",
  "received_at",
  "timezone",
  "operation_id",
  "source_message_id",
  "conversation_id",
] as const);

interface PluginRuntimeState {
  runtime?: CoreRuntime;
  physicalRoot?: string;
  sourceConfigDigest?: string;
  lifecycleRegistered: boolean;
}

const pluginRuntimeStates = new WeakMap<object, PluginRuntimeState>();
const pluginRuntimeOwners = new WeakMap<CoreRuntime, Set<object>>();

function isOrdinaryObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isProxy(value) &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function dataDescriptors(
  value: unknown,
  allowedFields: readonly string[],
  requiredFields: readonly string[] = allowedFields,
): Readonly<Record<string, PropertyDescriptor>> {
  if (!isOrdinaryObject(value)) throw new TypeError("OPENCLAW_AUTHORITY_INVALID:shape");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowedFields.includes(key)) ||
      requiredFields.some((key) => !keys.includes(key))) {
    throw new TypeError("OPENCLAW_AUTHORITY_INVALID:keys");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of keys as string[]) {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true) {
      throw new TypeError(`OPENCLAW_AUTHORITY_INVALID:${field}:descriptor`);
    }
  }
  return descriptors;
}

function cloneToolRequest(value: unknown): CoreApplicationRequest | undefined {
  const descriptors = dataDescriptors(value, PARAMETER_FIELDS, ["action"]);
  if (CORE_REQUEST_FIELDS.some((field) => descriptors[field] === undefined)) return undefined;
  return {
    action: descriptors.action?.value as DietManagerAction,
    source_text: descriptors.source_text?.value as string,
    received_at: descriptors.received_at?.value as string,
    timezone: descriptors.timezone?.value as "Asia/Shanghai",
    operation_id: descriptors.operation_id?.value as string,
    source_message_id: descriptors.source_message_id?.value as string,
    conversation_id: descriptors.conversation_id?.value as string,
    // PRODUCT-0.1 core exposes no caller-authored context/revision authority.
    prior_context: [],
  };
}

function clonePluginConfig(value: unknown): Readonly<{
  root: string;
  nutrition: Readonly<NutritionRuntimeConfig>;
}> {
  const descriptors = dataDescriptors(value, ["official_data_root", "nutrition"], ["official_data_root"]);
  const root = descriptors.official_data_root?.value;
  if (typeof root !== "string") throw new TypeError("OPENCLAW_AUTHORITY_INVALID:config_root");
  return Object.freeze({
    root,
    nutrition: cloneNutritionRuntimeConfig(descriptors.nutrition?.value),
  });
}

function safeRequestIdentity(value: unknown): {
  readonly action: DietManagerAction;
  readonly operationId?: string;
} {
  try {
    if (!isOrdinaryObject(value)) return { action: "record_meal" };
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actionValue = descriptors.action;
    const operationValue = descriptors.operation_id;
    const action = actionValue !== undefined && Object.hasOwn(actionValue, "value") &&
      typeof actionValue.value === "string" &&
      dietManagerActions.includes(actionValue.value as DietManagerAction)
      ? actionValue.value as DietManagerAction
      : "record_meal";
    const operationId = operationValue !== undefined && Object.hasOwn(operationValue, "value") &&
      typeof operationValue.value === "string"
      ? operationValue.value
      : undefined;
    return operationId === undefined ? { action } : { action, operationId };
  } catch {
    return { action: "record_meal" };
  }
}

function validatedJsonOutcome(value: DietManagerOutcome): DietManagerOutcome {
  const outcome = assertDietManagerOutcome(value);
  JSON.parse(JSON.stringify(outcome));
  return outcome;
}

function samePhysicalRoot(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function releasePluginRuntime(runtime: CoreRuntime, api: object): void {
  const owners = pluginRuntimeOwners.get(runtime);
  if (owners === undefined || !owners.delete(api)) return;
  if (owners.size !== 0) return;
  pluginRuntimeOwners.delete(runtime);
  runtime.close();
}

function acquirePluginRuntime(
  root: string,
  nutrition: Readonly<NutritionRuntimeConfig>,
  context: ToolPluginExecutionContext,
): CoreRuntime {
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
    nutritionAdapters: [],
  });
  if (state.runtime === undefined) {
    state.runtime = candidate;
    state.physicalRoot = physicalRoot;
    state.sourceConfigDigest = nutrition.source_config_digest;
    let owners = pluginRuntimeOwners.get(candidate);
    if (owners === undefined) {
      owners = new Set<object>();
      pluginRuntimeOwners.set(candidate, owners);
    }
    owners.add(context.api);
  } else if (state.runtime !== candidate) {
    throw new Error("PLUGIN_CONFIG_CONFLICT");
  }
  if (!state.lifecycleRegistered) {
    const ownedState = state;
    try {
      context.api.lifecycle.registerRuntimeLifecycle({
        id: "diet-manager-b-runtime",
        description: "Close the Diet Manager SQLite runtime on plugin cleanup.",
        cleanup(): void {
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
    } catch (error) {
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

async function executeDietManager(
  value: unknown,
  configValue: unknown,
  context: ToolPluginExecutionContext,
): Promise<DietManagerOutcome> {
  const identity = safeRequestIdentity(value);
  let request: CoreApplicationRequest | undefined;
  try {
    request = cloneToolRequest(value);
  } catch {
    return validatedJsonOutcome(failedOutcome(
      identity.action,
      identity.operationId,
      "INVALID_REQUEST",
    ));
  }
  if (request === undefined) {
    return validatedJsonOutcome(failedOutcome(
      identity.action,
      identity.operationId,
      "APPLICATION_AUTHORITY_REQUIRED",
    ));
  }
  let pluginConfig: ReturnType<typeof clonePluginConfig>;
  try {
    pluginConfig = clonePluginConfig(configValue);
  } catch {
    return validatedJsonOutcome(failedOutcome(
      request.action,
      request.operation_id,
      "PLUGIN_CONFIG_INVALID",
    ));
  }
  try {
    const runtime = acquirePluginRuntime(pluginConfig.root, pluginConfig.nutrition, context);
    return validatedJsonOutcome(await handleCoreRequestAsync(runtime, request));
  } catch (error) {
    const errorCode = error instanceof Error && error.message === "PLUGIN_CONFIG_CONFLICT"
      ? "PLUGIN_CONFIG_CONFLICT"
      : "PLUGIN_RUNTIME_UNAVAILABLE";
    return validatedJsonOutcome(failedOutcome(
      request.action,
      request.operation_id,
      errorCode,
    ));
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
      description:
        "Record completed current-user meals or plain water, or return a truthful non-writing outcome.",
      parameters: dietManagerParameters,
      execute: executeDietManager,
    }),
  ],
});
