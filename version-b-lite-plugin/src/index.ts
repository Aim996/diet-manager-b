export { default, dietManagerParameters } from "./openclaw/plugin.js";

export type {
  DietManagerAction,
  DietManagerItem,
  DietManagerOutcome,
  DietManagerRequest,
  DietManagerStatus,
  NonWritingOutcome,
} from "./contracts.js";

export {
  assertDietManagerOutcome,
  dietManagerContract,
  dietManagerStatuses,
} from "./contracts.js";
