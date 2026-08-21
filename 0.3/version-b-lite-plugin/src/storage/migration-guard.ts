import type { DatabaseSync } from "node:sqlite";

import {
  assertDietDatabaseIdentity,
  DIET_DATABASE_APPLICATION_ID,
  DIET_DATABASE_USER_VERSION,
} from "./database.js";
import {
  MIGRATION_V1_ID,
  MIGRATION_V1_MAPPING_SHA256,
} from "./migration-v1.js";

export type MigrationScenario =
  | "fresh_install"
  | "upgrade_success"
  | "upgrade_failure"
  | "recovery";

export interface MigrationTransitionPlan {
  scenario: MigrationScenario;
  userVersionBefore: number;
  userVersionAfter: number;
  backupVerified: boolean;
  outcome: "commit" | "rollback" | "preserve";
}

const PLAN_FIELDS = [
  "backupVerified",
  "outcome",
  "scenario",
  "userVersionAfter",
  "userVersionBefore",
] as const;

function illegal(reason: string, cause?: unknown): never {
  throw new Error(`ILLEGAL_MIGRATION:${reason}`, cause === undefined ? undefined : { cause });
}

function scalar(database: DatabaseSync, sql: string): number | string {
  const row = database.prepare(sql).get() as Record<string, number | string> | undefined;
  if (!row) return illegal("identity");
  return Object.values(row)[0];
}

export function assertCurrentMigrationAuthority(database: DatabaseSync): void {
  if (scalar(database, "PRAGMA application_id") !== DIET_DATABASE_APPLICATION_ID) {
    return illegal("application_id");
  }
  if (scalar(database, "PRAGMA user_version") !== DIET_DATABASE_USER_VERSION) {
    return illegal("user_version");
  }

  let rows: Array<{ version: number; migration_id: string; checksum: string }>;
  try {
    rows = database
      .prepare(
        "SELECT version, migration_id, checksum FROM schema_migrations ORDER BY version",
      )
      .all() as Array<{ version: number; migration_id: string; checksum: string }>;
  } catch (error) {
    return illegal("history", error);
  }
  if (
    rows.length !== 1 ||
    rows[0].version !== DIET_DATABASE_USER_VERSION ||
    rows[0].migration_id !== MIGRATION_V1_ID ||
    rows[0].checksum !== MIGRATION_V1_MAPPING_SHA256
  ) {
    return illegal("history");
  }

  try {
    assertDietDatabaseIdentity(database);
  } catch (error) {
    return illegal("schema", error);
  }
}

function freezePlan(value: MigrationTransitionPlan): MigrationTransitionPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return illegal("shape");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\u0000") !== PLAN_FIELDS.join("\u0000")
  ) {
    return illegal("shape");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of PLAN_FIELDS) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return illegal("shape");
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return illegal("shape");

  const scenario = descriptors.scenario.value;
  if (
    scenario !== "fresh_install" &&
    scenario !== "upgrade_success" &&
    scenario !== "upgrade_failure" &&
    scenario !== "recovery"
  ) {
    return illegal("scenario");
  }
  const beforeValue = descriptors.userVersionBefore.value;
  const afterValue = descriptors.userVersionAfter.value;
  if (
    typeof beforeValue !== "number" ||
    !Number.isSafeInteger(beforeValue) ||
    beforeValue < 0 ||
    typeof afterValue !== "number" ||
    !Number.isSafeInteger(afterValue) ||
    afterValue < 0
  ) {
    return illegal("transition");
  }
  const before = beforeValue;
  const after = afterValue;
  const backupVerified = descriptors.backupVerified.value;
  if (typeof backupVerified !== "boolean") return illegal("backup");
  const outcome = descriptors.outcome.value;
  if (outcome !== "commit" && outcome !== "rollback" && outcome !== "preserve") {
    return illegal("transition");
  }

  return Object.freeze({
    scenario,
    userVersionBefore: before,
    userVersionAfter: after,
    backupVerified,
    outcome,
  });
}

export function assertMigrationTransition(plan: MigrationTransitionPlan): void {
  const frozen = freezePlan(plan);
  if (
    (frozen.scenario === "upgrade_success" ||
      frozen.scenario === "upgrade_failure" ||
      frozen.scenario === "recovery") &&
    !frozen.backupVerified
  ) {
    return illegal("backup");
  }

  const legal =
    (frozen.scenario === "fresh_install" &&
      frozen.userVersionBefore === 0 &&
      frozen.userVersionAfter === 1 &&
      frozen.backupVerified === false &&
      frozen.outcome === "commit") ||
    (frozen.scenario === "upgrade_success" &&
      frozen.userVersionBefore === 0 &&
      frozen.userVersionAfter === 1 &&
      frozen.backupVerified === true &&
      frozen.outcome === "commit") ||
    (frozen.scenario === "upgrade_failure" &&
      frozen.userVersionBefore === 0 &&
      frozen.userVersionAfter === 0 &&
      frozen.backupVerified === true &&
      frozen.outcome === "rollback") ||
    (frozen.scenario === "recovery" &&
      frozen.userVersionBefore === 1 &&
      frozen.userVersionAfter === 1 &&
      frozen.backupVerified === true &&
      frozen.outcome === "preserve");

  if (!legal) return illegal("transition");
}
