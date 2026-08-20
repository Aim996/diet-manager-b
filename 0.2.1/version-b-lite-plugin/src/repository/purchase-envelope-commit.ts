import type { DatabaseSync } from "node:sqlite";

import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import {
  appendPreparedOperationFactInOpenTransaction,
  sealPreparedEnvelopeFactsInOpenTransaction,
  type EnvelopeFactsResult,
  type PreparedEnvelopeOperation,
  type PreparedEnvelopeSeal,
} from "./fact-commit.js";
import { processInventoryEffectInOpenTransaction } from "./inventory-effects.js";

export interface PreparedPurchaseEnvelopeCommit {
  readonly operations: readonly PreparedEnvelopeOperation[];
  readonly seal: PreparedEnvelopeSeal;
  readonly effect_times: readonly string[];
}

export type PurchaseEnvelopeFault =
  | "after_operation_fact"
  | "after_operation_effect"
  | "before_seal"
  | "before_commit"
  | "after_commit_before_reply";

export interface PurchaseEnvelopeCommitOptions {
  fault?: PurchaseEnvelopeFault;
  faultSequence?: number;
}

interface FrozenPurchaseEnvelopeCommit {
  database: DatabaseSync;
  operations: readonly PreparedEnvelopeOperation[];
  seal: PreparedEnvelopeSeal;
  effect_times: readonly string[];
}

interface FrozenPurchaseEnvelopeCommitOptions {
  fault?: PurchaseEnvelopeFault;
  faultSequence: number;
}

function invalid(reason: string): never {
  throw new TypeError(`PURCHASE_ENVELOPE_REQUEST_INVALID:${reason}`);
}

function exactDataProperties(
  value: unknown,
  fields: readonly string[],
): Record<string, PropertyDescriptor & { value: unknown }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("shape");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\u0000") !== [...fields].sort().join("\u0000")
  ) {
    return invalid("shape");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return invalid("descriptor");
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid("prototype");
  return descriptors as Record<string, PropertyDescriptor & { value: unknown }>;
}

function freezeCommit(value: PreparedPurchaseEnvelopeCommit): FrozenPurchaseEnvelopeCommit {
  const fields = exactDataProperties(value, ["operations", "seal", "effect_times"]);
  if (!Array.isArray(fields.operations.value) || fields.operations.value.length === 0) {
    return invalid("operations");
  }
  const operations = fields.operations.value as unknown[];
  const seal = fields.seal.value;
  if (typeof seal !== "object" || seal === null || Array.isArray(seal)) {
    return invalid("seal");
  }
  const database = (seal as PreparedEnvelopeSeal).database;
  if (typeof database !== "object" || database === null) {
    return invalid("database");
  }
  if (!Array.isArray(fields.effect_times.value)) {
    return invalid("effect_times");
  }
  const effectTimes = fields.effect_times.value as unknown[];
  if (effectTimes.length !== operations.length) {
    return invalid("effect_times_count");
  }
  for (const operation of operations) {
    if (typeof operation !== "object" || operation === null || Array.isArray(operation)) {
      return invalid("operation");
    }
  }
  for (const effectTime of effectTimes) {
    if (typeof effectTime !== "string" || effectTime.length === 0) {
      return invalid("effect_time");
    }
  }
  return Object.freeze({
    database: database as DatabaseSync,
    operations: Object.freeze([...operations]) as readonly PreparedEnvelopeOperation[],
    seal: seal as PreparedEnvelopeSeal,
    effect_times: Object.freeze([...effectTimes]) as readonly string[],
  });
}

function exactCommitOptions(
  value: PurchaseEnvelopeCommitOptions | undefined,
): FrozenPurchaseEnvelopeCommitOptions {
  if (value === undefined) return Object.freeze({ faultSequence: 0 });
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("options");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).some((key) => key !== "fault" && key !== "faultSequence")
  ) {
    return invalid("options");
  }
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return invalid("options");
    }
  }
  const fault = descriptors.fault?.value;
  if (
    fault !== undefined &&
    ![
      "after_operation_fact",
      "after_operation_effect",
      "before_seal",
      "before_commit",
      "after_commit_before_reply",
    ].includes(String(fault))
  ) {
    return invalid("fault");
  }
  const faultSequence = descriptors.faultSequence?.value ?? 0;
  if (!Number.isSafeInteger(faultSequence) || (faultSequence as number) < 0) {
    return invalid("fault_sequence");
  }
  return Object.freeze({
    ...(fault === undefined ? {} : { fault: fault as PurchaseEnvelopeFault }),
    faultSequence: faultSequence as number,
  });
}

export function commitPreparedPurchaseEnvelope(
  input: PreparedPurchaseEnvelopeCommit,
  options?: PurchaseEnvelopeCommitOptions,
): EnvelopeFactsResult {
  const frozen = freezeCommit(input);
  const frozenOptions = exactCommitOptions(options);
  let transactionOpen = false;
  try {
    frozen.database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertCurrentMigrationAuthority(frozen.database);
    frozen.operations.forEach((operation, index) => {
      appendPreparedOperationFactInOpenTransaction(operation);
      if (frozenOptions.fault === "after_operation_fact" && frozenOptions.faultSequence === index) {
        throw new Error("FACT_COMMIT_FAILED:after_operation_fact");
      }
      const effect = operation.effects[0];
      if (!effect) return invalid("effect_missing");
      processInventoryEffectInOpenTransaction(
        {
          database: frozen.database,
          outboxId: effect.outboxId,
          now: frozen.effect_times[index]!,
        },
        {
          deferEnvelopeStability: true,
          ...(frozenOptions.fault === "after_operation_effect" &&
            frozenOptions.faultSequence === index
            ? { fault: "after_business_writes" as const }
            : {}),
        },
      );
    });
    if (frozenOptions.fault === "before_seal") {
      throw new Error("PURCHASE_ENVELOPE_FAILED:before_seal");
    }
    const result = sealPreparedEnvelopeFactsInOpenTransaction(frozen.seal);
    if (frozenOptions.fault === "before_commit") {
      throw new Error("PURCHASE_ENVELOPE_FAILED:before_commit");
    }
    frozen.database.exec("COMMIT");
    transactionOpen = false;
    if (frozenOptions.fault === "after_commit_before_reply") {
      throw new Error("PURCHASE_ENVELOPE_RESPONSE_LOST:after_commit_before_reply");
    }
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        frozen.database.exec("ROLLBACK");
      } catch {
        // Preserve the primary envelope failure.
      }
    }
    throw error;
  }
}
