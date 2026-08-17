export { default, dietManagerParameters } from "./openclaw/plugin.js";

export type {
  CorrectionOutcomeView,
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

export { backupDietDatabase, restoreDietDatabase } from "./storage/backup.js";
export type { DietDatabaseBackupResult } from "./storage/backup.js";

export { createPortableBackup, restorePortableBackup } from "./storage/portable-backup.js";
export type {
  CreatePortableBackupInput,
  PortableBackupResult,
  RestorePortableBackupInput,
} from "./storage/portable-backup.js";
