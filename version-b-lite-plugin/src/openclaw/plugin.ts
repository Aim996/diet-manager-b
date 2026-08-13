import { isProxy } from "node:util/types";
import {
  defineToolPlugin,
  type ToolPluginExecutionContext,
} from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";

import { handleCoreRequest } from "../application/command-handler.js";
import { failedOutcome } from "../application/outcome.js";
import { createCoreRuntime, type CoreRuntime } from "../application/runtime.js";
import { assertPrivateRuntimeRoot } from "../storage/database.js";
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

export const dietManagerParameters = Type.Object(
  {
    action: actionSchema,
    source_text: Type.String(),
    received_at: Type.String(),
    timezone: Type.Literal("Asia/Shanghai"),
    operation_id: Type.String(),
    source_message_id: Type.String(),
    conversation_id: Type.String(),
  },
  {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
  },
);

const coreConfigSchema = Type.Object(
  {
    official_data_root: Type.String({
      description:
        "Absolute existing runtime root owned and configured only by the Diet Manager backend.",
      "x-diet-manager-root-semantics":
        "backend_owned_existing_absolute_runtime_root",
    }),
  },
  {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
  },
);

const PARAMETER_FIELDS = Object.freeze([
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
  lifecycleRegistered: boolean;
}

const pluginRuntimeStates = new WeakMap<object, PluginRuntimeState>();
const pluginRuntimeOwners = new WeakMap<CoreRuntime, Set<object>>();

function isOrdinaryObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    !isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function dataDescriptors(
  value: unknown,
  expectedFields: readonly string[],
): Readonly<Record<string, PropertyDescriptor>> {
  if (!isOrdinaryObject(value)) throw new TypeError("OPENCLAW_AUTHORITY_INVALID:shape");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedFields.length || keys.some((key) => typeof key !== "string") ||
      expectedFields.some((key) => !keys.includes(key))) {
    throw new TypeError("OPENCLAW_AUTHORITY_INVALID:keys");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of expectedFields) {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true) {
      throw new TypeError(`OPENCLAW_AUTHORITY_INVALID:${field}:descriptor`);
    }
  }
  return descriptors;
}

function cloneToolRequest(value: unknown): CoreApplicationRequest {
  const descriptors = dataDescriptors(value, PARAMETER_FIELDS);
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

function clonePluginRoot(value: unknown): string {
  const descriptors = dataDescriptors(value, ["official_data_root"]);
  const root = descriptors.official_data_root?.value;
  if (typeof root !== "string") throw new TypeError("OPENCLAW_AUTHORITY_INVALID:config_root");
  return root;
}

function safeRequestIdentity(value: unknown): {
  readonly action: DietManagerAction;
  readonly operationId?: string;
} {
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
  const candidate = createCoreRuntime({
    officialDataRoot: physicalRoot,
    now: () => new Date().toISOString(),
  });
  if (state.runtime === undefined) {
    state.runtime = candidate;
    state.physicalRoot = physicalRoot;
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
          pluginRuntimeStates.delete(context.api);
        },
      });
      state.lifecycleRegistered = true;
    } catch (error) {
      releasePluginRuntime(state.runtime, context.api);
      state.runtime = undefined;
      state.physicalRoot = undefined;
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
  let request: CoreApplicationRequest;
  try {
    request = cloneToolRequest(value);
  } catch {
    return validatedJsonOutcome(failedOutcome(
      identity.action,
      identity.operationId,
      "INVALID_REQUEST",
    ));
  }
  let root: string;
  try {
    root = clonePluginRoot(configValue);
  } catch {
    return validatedJsonOutcome(failedOutcome(
      request.action,
      request.operation_id,
      "PLUGIN_CONFIG_INVALID",
    ));
  }
  try {
    const runtime = acquirePluginRuntime(root, context);
    return validatedJsonOutcome(handleCoreRequest(runtime, request));
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
