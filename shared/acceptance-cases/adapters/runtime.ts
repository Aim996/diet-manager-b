import { isProxy } from "node:util/types";

import type {
  CaseExecutionInput,
  ContractHash,
  DriverObservation,
  JsonValue,
} from "./types.ts";

function fail(label: string, detail: string): never {
  throw new Error(`${label}:${detail}`);
}

function assertNonProxy(value: object, label: string): void {
  if (isProxy(value)) {
    fail(label, "proxy");
  }
}

function ownDataDescriptors(
  value: object,
  label: string,
): Record<string, PropertyDescriptor> {
  assertNonProxy(value, label);
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length !== 0) {
    fail(label, "symbol_property");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) {
      fail(label, `dynamic_property:${name}`);
    }
  }
  return descriptors;
}

function exactObjectDescriptors(
  value: unknown,
  expectedNames: readonly string[],
  label: string,
): Record<string, PropertyDescriptor> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(label, "object");
  }
  assertNonProxy(value, label);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(label, "prototype");
  }
  const descriptors = ownDataDescriptors(value, label);
  const actualNames = Object.keys(descriptors).sort();
  const sortedExpected = [...expectedNames].sort();
  if (
    actualNames.length !== sortedExpected.length ||
    actualNames.some((name, index) => name !== sortedExpected[index])
  ) {
    fail(label, `properties:${actualNames.join(",")}`);
  }
  return descriptors;
}

function cloneJsonValue(
  value: unknown,
  label: string,
  ancestors: Set<object>,
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(label, "finite_number");
    }
    return value;
  }
  if (typeof value !== "object") {
    fail(label, "json_value");
  }
  assertNonProxy(value, label);
  if (ancestors.has(value)) {
    fail(label, "cycle");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const symbols = Object.getOwnPropertySymbols(value);
      if (symbols.length !== 0) {
        fail(label, "symbol_property");
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (name === "length") {
          if (!("value" in descriptor) || descriptor.value !== value.length) {
            fail(label, "array_length_descriptor");
          }
        } else if (!("value" in descriptor) || !descriptor.enumerable) {
          fail(label, `dynamic_property:${name}`);
        }
      }
      const names = Object.keys(descriptors).filter((name) => name !== "length");
      if (
        names.length !== value.length ||
        names.some((name, index) => name !== String(index))
      ) {
        fail(label, "dense_array");
      }
      return Object.freeze(
        names.map((name) =>
          cloneJsonValue(descriptors[name].value, `${label}[${name}]`, ancestors),
        ),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(label, "prototype");
    }
    const descriptors = ownDataDescriptors(value, label);
    const clone: Record<string, JsonValue> = {};
    for (const name of Object.keys(descriptors)) {
      Object.defineProperty(clone, name, {
        value: cloneJsonValue(
          descriptors[name].value,
          `${label}.${name}`,
          ancestors,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return Object.freeze(clone);
  } finally {
    ancestors.delete(value);
  }
}

export function clonePlainJson(value: unknown, label: string): JsonValue {
  return cloneJsonValue(value, label, new Set<object>());
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(label, "nonempty_string");
  }
  return value;
}

function cloneContractHash(value: unknown, index: number): ContractHash {
  const label = `HARNESS_INPUT_INVALID:contract_hashes[${index}]`;
  const descriptors = exactObjectDescriptors(
    value,
    ["contract_id", "sha256"],
    label,
  );
  const contractId = requiredString(descriptors.contract_id.value, `${label}.contract_id`);
  const sha256 = requiredString(descriptors.sha256.value, `${label}.sha256`);
  if (!/^[0-9A-F]{64}$/.test(sha256)) {
    fail(`${label}.sha256`, "uppercase_sha256");
  }
  return Object.freeze({ contract_id: contractId, sha256 });
}

export function cloneCaseExecutionInput(value: unknown): CaseExecutionInput {
  const label = "HARNESS_INPUT_INVALID";
  const descriptors = exactObjectDescriptors(
    value,
    [
      "case_id",
      "requirement_ids",
      "stage",
      "source_text",
      "setup",
      "contract_hashes",
    ],
    label,
  );
  const requirementValue = descriptors.requirement_ids.value;
  if (!Array.isArray(requirementValue) || isProxy(requirementValue)) {
    fail(`${label}:requirement_ids`, "array");
  }
  const requirementIds = requirementValue.map((entry, index) =>
    requiredString(entry, `${label}:requirement_ids[${index}]`),
  );
  if (new Set(requirementIds).size !== requirementIds.length) {
    fail(`${label}:requirement_ids`, "unique");
  }
  const contractValue = descriptors.contract_hashes.value;
  if (!Array.isArray(contractValue) || isProxy(contractValue)) {
    fail(`${label}:contract_hashes`, "array");
  }
  const contractHashes = contractValue.map(cloneContractHash);
  if (new Set(contractHashes.map((entry) => entry.contract_id)).size !== contractHashes.length) {
    fail(`${label}:contract_hashes`, "unique_contract_id");
  }
  return Object.freeze({
    case_id: requiredString(descriptors.case_id.value, `${label}:case_id`),
    requirement_ids: Object.freeze(requirementIds),
    stage: requiredString(descriptors.stage.value, `${label}:stage`),
    source_text: requiredString(descriptors.source_text.value, `${label}:source_text`),
    setup: clonePlainJson(descriptors.setup.value, `${label}:setup`),
    contract_hashes: Object.freeze(contractHashes),
  });
}

export function cloneDriverObservation(value: unknown): DriverObservation {
  const label = "HARNESS_DRIVER_OBSERVATION_INVALID";
  const descriptors = exactObjectDescriptors(
    value,
    ["outcome_status", "reason_code", "business_writes", "observation"],
    label,
  );
  const outcomeStatus = descriptors.outcome_status.value;
  if (outcomeStatus !== "succeeded" && outcomeStatus !== "failed") {
    fail(`${label}:outcome_status`, "value");
  }
  const reasonCode = descriptors.reason_code.value;
  if (reasonCode !== null && (typeof reasonCode !== "string" || reasonCode.length === 0)) {
    fail(`${label}:reason_code`, "nullable_nonempty_string");
  }
  if (outcomeStatus === "succeeded" && reasonCode !== null) {
    fail(`${label}:reason_code`, "success_requires_null");
  }
  if (outcomeStatus === "failed" && reasonCode === null) {
    fail(`${label}:reason_code`, "failure_requires_code");
  }
  const businessWrites = descriptors.business_writes.value;
  if (!Number.isSafeInteger(businessWrites) || (businessWrites as number) < 0) {
    fail(`${label}:business_writes`, "nonnegative_safe_integer");
  }
  if (outcomeStatus === "failed" && businessWrites !== 0) {
    fail(`${label}:business_writes`, "failure_requires_zero");
  }
  return Object.freeze({
    outcome_status: outcomeStatus,
    reason_code: reasonCode,
    business_writes: businessWrites as number,
    observation: clonePlainJson(descriptors.observation.value, `${label}:observation`),
  });
}
