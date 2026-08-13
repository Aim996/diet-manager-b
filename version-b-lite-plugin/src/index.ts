import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type, type Static } from "typebox";
import {
  assertDietManagerOutcome,
  dietManagerContract,
  type DietManagerRequest,
  type FoundationOutcome,
} from "./contracts.js";

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

const itemSchema = Type.Object(
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
    occurred_at_text: Type.Optional(Type.String()),
    items: Type.Optional(Type.Array(itemSchema)),
  },
  {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
  },
);

const foundationConfigSchema = Type.Object(
  {
    official_data_root: Type.String({
      description:
        "Absolute existing runtime root owned by the Diet Manager backend; gate validation does not open or create it.",
      "x-diet-manager-root-semantics":
        "backend_owned_existing_absolute_runtime_root",
    }),
  },
  {
    additionalProperties: false,
    "x-diet-manager-contract": dietManagerContract,
  },
);

export async function handleFoundationAction(
  request: DietManagerRequest,
): Promise<FoundationOutcome> {
  return {
    action: request.action,
    status: "foundation_not_implemented",
    committed: false,
  };
}

export default defineToolPlugin({
  id: "diet-manager-b",
  name: "Diet Manager B Foundation",
  description: "A non-writing Diet Manager B foundation tool boundary.",
  activation: { onStartup: true },
  configSchema: foundationConfigSchema,
  tools: (tool) => [
    tool({
      name: "diet_manager",
      description:
        "Accept one meal, inventory, or query action and return the non-writing foundation outcome.",
      parameters: dietManagerParameters,
      execute: (params: Static<typeof dietManagerParameters>) =>
        handleFoundationAction(params),
    }),
  ],
});

export type {
  DietManagerAction,
  DietManagerItem,
  DietManagerOutcome,
  DietManagerRequest,
  DietManagerStatus,
  FoundationOutcome,
  NonWritingOutcome,
} from "./contracts.js";

export {
  assertDietManagerOutcome,
  dietManagerContract,
  dietManagerStatuses,
} from "./contracts.js";
