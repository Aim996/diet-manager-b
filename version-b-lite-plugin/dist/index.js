import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
const actionSchema = Type.Union([
    Type.Literal("record_meal"),
    Type.Literal("add_inventory"),
    Type.Literal("query_inventory"),
    Type.Literal("query_meals"),
]);
const itemSchema = Type.Object({
    name: Type.String(),
    quantity: Type.Optional(Type.Number()),
    unit: Type.Optional(Type.String()),
    per_item_amount: Type.Optional(Type.Number()),
    per_item_unit: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const dietManagerParameters = Type.Object({
    action: actionSchema,
    source_text: Type.Optional(Type.String()),
    occurred_at_text: Type.Optional(Type.String()),
    items: Type.Optional(Type.Array(itemSchema)),
}, { additionalProperties: false });
const foundationConfigSchema = Type.Object({}, { additionalProperties: false });
export async function handleFoundationAction(request) {
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
            description: "Accept one meal, inventory, or query action and return the non-writing foundation outcome.",
            parameters: dietManagerParameters,
            execute: (params) => handleFoundationAction(params),
        }),
    ],
});
