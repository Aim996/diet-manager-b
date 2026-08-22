import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  defineToolPlugin,
  type ToolPluginFactoryContext,
} from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";

import { failedOutcome } from "../application/outcome.js";
import { createCoreRuntime, type CoreRuntime } from "../application/runtime.js";
import {
  AGENT_COMMAND_SCHEMA_VERSION,
  cloneAgentCommandV1,
  type AgentCommandV1,
  type HostExecutionContextV1,
} from "../public/agent-command.js";
import { executeAgentCommand } from "../public/execute.js";
import { assertPrivateRuntimeRoot } from "../storage/database.js";
import { BoundedInsertionCache } from "./bounded-insertion-cache.js";
import { cloneNutritionRuntimeConfig } from "../nutrition/config.js";
import { createCommonDishTemplateAdapters } from "../nutrition/builtin.js";
import { OfflineUsdaAdapter } from "../nutrition/offline-usda.js";
import { FoodDataCentralAdapter } from "../nutrition/adapters/fooddata-central.js";
import { FoodDataCentralHttpTransport } from "../nutrition/adapters/fooddata-central-http.js";
import type { NutritionRuntimeConfig, NutritionSourceAdapter, SourceContext } from "../nutrition/types.js";
import { cloneSemanticCandidate } from "../semantic/candidate.js";
import {
  assertDietManagerOutcome,
  dietManagerActions,
  dietManagerContract,
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
  Type.Literal("set_profile"),
  Type.Literal("set_goal"),
  Type.Literal("restore_record"),
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

const exactAmountSchema = Type.Object(
  {
    kind: Type.Literal("exact"),
    value: Type.Number({ exclusiveMinimum: 0 }),
    unit: Type.String({ minLength: 1, maxLength: 64 }),
    evidence_span: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

const unknownAmountSchema = Type.Object(
  { kind: Type.Literal("unknown") },
  { additionalProperties: false },
);

const semanticMealCandidateSchema = Type.Object(
  {
    schema_version: Type.Literal("diet-manager/semantic-candidate/v1"),
    intent: Type.Literal("record_meal"),
    source_text: Type.String({ minLength: 1, maxLength: 4096 }),
    subject: Type.Object(
      {
        kind: Type.Literal("self"),
        basis: Type.Union([
          Type.Literal("explicit"),
          Type.Literal("private_agent_default"),
        ]),
        evidence_span: Type.Union([
          Type.String({ minLength: 1, maxLength: 256 }),
          Type.Null(),
        ]),
        explicit_other_spans: Type.Array(
          Type.String({ minLength: 1, maxLength: 256 }),
          { minItems: 0, maxItems: 64 },
        ),
      },
      { additionalProperties: false },
    ),
    items: Type.Array(
      Type.Object(
        {
          raw_name: Type.String({ minLength: 1, maxLength: 256 }),
          normalized_hint: Type.String({ minLength: 1, maxLength: 256 }),
          amount: Type.Union([exactAmountSchema, unknownAmountSchema]),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
    time: Type.Object(
      {
        kind: Type.Union([
          Type.Literal("source_text"),
          Type.Literal("unspecified"),
        ]),
        evidence_span: Type.Union([
          Type.String({ minLength: 1, maxLength: 256 }),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const dietManagerParameters = Type.Object(
  {
    action: actionSchema,
    source_text: Type.Optional(Type.String({
      description:
        "Copy the user's current message verbatim; never normalize or invent food facts.",
    })),
    occurred_at_text: Type.Optional(Type.String({
      description: "Legacy compatibility evidence; never substitutes for received_at.",
    })),
    items: Type.Optional(Type.Array(legacyItemSchema, {
      description: "Legacy compatibility evidence; the core parses source_text authoritatively.",
    })),
    semantic_candidate: Type.Optional(semanticMealCandidateSchema),
  },
  {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
  },
);

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
  "source_text",
  "occurred_at_text",
  "items",
  "semantic_candidate",
] as const);

interface PluginRuntimeState {
  runtime?: CoreRuntime;
  physicalRoot?: string;
  sourceConfigDigest?: string;
  executionContexts?: BoundedInsertionCache<string, Readonly<HostExecutionContextV1>>;
  lifecycleRegistered: boolean;
}

const FDC_CREDENTIAL_REFERENCE = "env:FDC_API_KEY";
const EXECUTION_CONTEXT_CACHE_CAPACITY = 1024;

function configuredNutritionAdapters(
  nutrition: Readonly<NutritionRuntimeConfig>,
): readonly NutritionSourceAdapter[] {
  const adapters: NutritionSourceAdapter[] = [
    new OfflineUsdaAdapter(),
    ...createCommonDishTemplateAdapters(),
  ];
  const entry = nutrition.sources.find((candidate) =>
    candidate.source_id === "public.usda_fooddata_central" && candidate.enabled);
  if (entry !== undefined) {
    if (entry.backend_id !== "fooddata-central" || entry.backend_version !== "api-v1" ||
        entry.credential_ref !== FDC_CREDENTIAL_REFERENCE) {
      throw new TypeError("OPENCLAW_AUTHORITY_INVALID:nutrition_source");
    }
    adapters.push(new FoodDataCentralAdapter(new FoodDataCentralHttpTransport(), FDC_CREDENTIAL_REFERENCE));
  }
  return Object.freeze(adapters);
}

const environmentNutritionCredential: SourceContext["credential"] = (reference) => {
  if (reference !== FDC_CREDENTIAL_REFERENCE) return undefined;
  const value = process.env.FDC_API_KEY;
  if (value === undefined || value.length === 0 || value.length > 128 || /[^A-Za-z0-9_-]/u.test(value)) {
    return undefined;
  }
  return Object.freeze({ value: new TextEncoder().encode(value) });
};

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

function cloneToolRequest(value: unknown): Readonly<AgentCommandV1> {
  const descriptors = dataDescriptors(value, PARAMETER_FIELDS, ["action", "source_text"]);
  return cloneAgentCommandV1({
    schema_version: AGENT_COMMAND_SCHEMA_VERSION,
    action: descriptors.action?.value,
    source_text: descriptors.source_text?.value,
    ...(descriptors.semantic_candidate === undefined
      ? {}
      : { semantic_candidate: cloneSemanticCandidate(descriptors.semantic_candidate.value) }),
  });
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
} {
  try {
    if (!isOrdinaryObject(value)) return { action: "record_meal" };
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actionValue = descriptors.action;
    const action = actionValue !== undefined && Object.hasOwn(actionValue, "value") &&
      typeof actionValue.value === "string" &&
      dietManagerActions.includes(actionValue.value as DietManagerAction)
      ? actionValue.value as DietManagerAction
      : "record_meal";
    return { action };
  } catch {
    return { action: "record_meal" };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function trustedExecutionContext(
  api: object,
  toolCallId: string,
  conversationDomain: string,
): Readonly<HostExecutionContextV1> {
  const state = pluginRuntimeStates.get(api);
  if (state?.physicalRoot === undefined) throw new Error("PLUGIN_CONTEXT_UNAVAILABLE");
  const contexts = state.executionContexts ??
    new BoundedInsertionCache<string, Readonly<HostExecutionContextV1>>(
      EXECUTION_CONTEXT_CACHE_CAPACITY,
    );
  state.executionContexts = contexts;
  const conversationDigest = sha256(conversationDomain);
  const contextKey = `${conversationDigest}:${toolCallId}`;
  const existing = contexts.get(contextKey);
  if (existing !== undefined) return existing;
  const toolCallDigest = sha256(`${conversationDomain}\0${toolCallId}`);
  const generated = Object.freeze({
    received_at: new Date().toISOString(),
    timezone: "Asia/Shanghai" as const,
    operation_id: `openclaw-operation-${toolCallDigest}`,
    source_message_id: `openclaw-message-${toolCallDigest}`,
    conversation_id: `openclaw-conversation-${conversationDigest}`,
  });
  contexts.set(contextKey, generated);
  return generated;
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
  api: ToolPluginFactoryContext<unknown>["api"],
): CoreRuntime {
  const physicalRoot = assertPrivateRuntimeRoot(root);
  let state = pluginRuntimeStates.get(api);
  if (state === undefined) {
    state = { lifecycleRegistered: false };
    pluginRuntimeStates.set(api, state);
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
      owners = new Set<object>();
      pluginRuntimeOwners.set(candidate, owners);
    }
    owners.add(api);
  } else if (state.runtime !== candidate) {
    throw new Error("PLUGIN_CONFIG_CONFLICT");
  }
  if (!state.lifecycleRegistered) {
    const ownedState = state;
    try {
      api.lifecycle.registerRuntimeLifecycle({
        id: "diet-manager-b-runtime",
        description: "Close the Diet Manager SQLite runtime on plugin cleanup.",
        cleanup(): void {
          if (ownedState.runtime !== undefined) {
            releasePluginRuntime(ownedState.runtime, api);
          }
          ownedState.runtime = undefined;
          ownedState.physicalRoot = undefined;
          ownedState.sourceConfigDigest = undefined;
          ownedState.executionContexts = undefined;
          pluginRuntimeStates.delete(api);
        },
      });
      state.lifecycleRegistered = true;
    } catch (error) {
      releasePluginRuntime(state.runtime, api);
      state.runtime = undefined;
      state.physicalRoot = undefined;
      state.sourceConfigDigest = undefined;
      pluginRuntimeStates.delete(api);
      throw error;
    }
  }
  return state.runtime;
}

async function executeDietManager(
  value: unknown,
  configValue: unknown,
  factoryContext: ToolPluginFactoryContext<unknown>,
  toolCallId: string,
): Promise<DietManagerOutcome> {
  const identity = safeRequestIdentity(value);
  const conversationDomain = factoryContext.toolContext.sessionKey ??
    factoryContext.toolContext.sessionId;
  if (conversationDomain === undefined || conversationDomain.length === 0) {
    return validatedJsonOutcome(failedOutcome(
      identity.action,
      undefined,
      "APPLICATION_AUTHORITY_REQUIRED",
    ));
  }
  let request: Readonly<AgentCommandV1>;
  try {
    request = cloneToolRequest(value);
  } catch {
    return validatedJsonOutcome(failedOutcome(
      identity.action,
      undefined,
      "INVALID_REQUEST",
    ));
  }
  let pluginConfig: ReturnType<typeof clonePluginConfig>;
  try {
    pluginConfig = clonePluginConfig(configValue);
  } catch {
    return validatedJsonOutcome(failedOutcome(
      request.action,
      undefined,
      "PLUGIN_CONFIG_INVALID",
    ));
  }
  try {
    const runtime = acquirePluginRuntime(
      pluginConfig.root,
      pluginConfig.nutrition,
      factoryContext.api,
    );
    return validatedJsonOutcome(await executeAgentCommand(
      runtime,
      request,
      trustedExecutionContext(factoryContext.api, toolCallId, conversationDomain),
    ));
  } catch (error) {
    const invalidRequest = error instanceof TypeError &&
      error.message.startsWith("DIET_AGENT_COMMAND_INVALID:");
    const errorCode = invalidRequest
      ? "INVALID_REQUEST"
      : error instanceof Error && error.message === "PLUGIN_CONFIG_CONFLICT"
        ? "PLUGIN_CONFIG_CONFLICT"
        : "PLUGIN_RUNTIME_UNAVAILABLE";
    return validatedJsonOutcome(failedOutcome(
      invalidRequest ? identity.action : request.action,
      undefined,
      errorCode,
    ));
  }
}

const DIET_MANAGER_DESCRIPTION =
  "Record/query Diet Manager facts. Send action and the exact source_text only; OpenClaw supplies trusted timing, operation, message, and conversation authority outside model parameters. For record_meal, when the user's natural wording is not safely represented by the legacy parser, send semantic_candidate with the exact same source_text, explicit evidence spans, and unknown amounts left unknown. Never invent amounts, units, times, people, or normalized food names. An explicit other person overrides private-agent default self. Follow committed/status/reason_code/error_code exactly in the final reply. Call diet_manager at most once for one inbound message. After a non-committed write result, do not retry, inspect files, run commands, use memory, or switch to another tool; report the result and ask only the returned clarification. When committed=false, the first sentence must say the request was not recorded. Never say recorded, noted, saved, or updated when committed=false. Never advise the user to repeat the same unchanged request after a failed, conflicting, or unimplemented result; ask only for a genuinely missing quantity, specification, or time. For an explicit future plan or negative statement, make no tool call, say it was not recorded, and only create a reminder when the user explicitly asks. For read_only_result, answer only from the returned data without claiming a write; do not write a note, memory, or fallback record. Keep the reply to the result and one necessary clarification. Do not add encouragement, onboarding, capability offers, or reminder suggestions. Use only returned nutrition data and never estimate nutrition values yourself.";

export default defineToolPlugin({
  id: "diet-manager-b",
  name: "Diet Manager B",
  description: "A deterministic meal and plain-water recording tool.",
  activation: { onStartup: true },
  configSchema: coreConfigSchema,
  tools: (tool) => [
    tool({
      name: "diet_manager",
      description: DIET_MANAGER_DESCRIPTION,
      parameters: dietManagerParameters,
      factory: (factoryContext) => ({
        name: "diet_manager",
        label: "diet_manager",
        description: DIET_MANAGER_DESCRIPTION,
        parameters: dietManagerParameters,
        async execute(toolCallId, params) {
          const outcome = await executeDietManager(
            params,
            factoryContext.config,
            factoryContext,
            toolCallId,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(outcome) }],
            details: outcome,
          };
        },
      }),
    }),
  ],
});
