export { default, dietManagerParameters } from "./openclaw/plugin.js";

export type {
  DietManagerAction,
  DietManagerItem,
  DietManagerOutcome,
  DietManagerRequest,
  DietManagerStatus,
  InventoryView,
  MealHistoryView,
  NonWritingOutcome,
  NutritionOutcomeAmountRange,
  NutritionOutcomeItem,
} from "./contracts.js";

export {
  assertDietManagerOutcome,
  dietManagerContract,
  dietManagerStatuses,
} from "./contracts.js";
