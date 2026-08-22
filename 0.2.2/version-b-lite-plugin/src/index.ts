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

export type { SemanticMealCandidateV1 } from "./semantic/candidate.js";

export { backupDietDatabase, restoreDietDatabase } from "./storage/backup.js";
export type { DietDatabaseBackupResult } from "./storage/backup.js";

export { createPortableBackup, restorePortableBackup } from "./storage/portable-backup.js";
export type {
  CreatePortableBackupInput,
  PortableBackupResult,
  RestorePortableBackupInput,
} from "./storage/portable-backup.js";

export {
  CORE_RUNTIME_SECRET_FILENAME,
  createCoreRuntime,
} from "./application/runtime.js";
export type {
  CoreRuntime,
  CreateCoreRuntimeOptions,
} from "./application/runtime.js";

export {
  AGENT_COMMAND_SCHEMA_VERSION,
  cloneAgentCommandV1,
} from "./public/agent-command.js";
export type {
  AgentCommandV1,
  HostExecutionContextV1,
} from "./public/agent-command.js";
export { executeAgentCommand } from "./public/execute.js";
