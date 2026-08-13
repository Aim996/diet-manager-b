import { isProxy } from "node:util/types";

import {
  dietManagerActions,
  type CoreApplicationRequest,
  type DietManagerAction,
  type DietManagerOutcome,
} from "../contracts.js";
import { cloneCoreParseInput } from "../parser/input-authority.js";
import { parseCoreCommand } from "../parser/parse-command.js";
import type { CoreCommandCandidate } from "../parser/types.js";
import { mapCoreCandidateToEnvelope } from "./mapping.js";
import type { CoreRuntime } from "./runtime.js";
import { executeCoreEnvelope } from "./runtime-executor.js";
import { committedOutcome, failedOutcome, nonWritingOutcome } from "./outcome.js";

const REQUEST_FIELDS = Object.freeze([
  "action", "source_text", "received_at", "timezone", "operation_id",
  "source_message_id", "conversation_id", "prior_context",
] as const);

function invalid(reason: string): never {
  throw new TypeError(`CORE_APPLICATION_REQUEST_INVALID:${reason}`);
}

function cloneRequest(value: unknown): Readonly<CoreApplicationRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("shape");
  }
  if (isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return invalid("shape");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== REQUEST_FIELDS.length || keys.some((key) => typeof key !== "string") ||
    REQUEST_FIELDS.some((key) => !keys.includes(key))
  ) return invalid("keys");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of REQUEST_FIELDS) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      return invalid(`${key}:descriptor`);
    }
  }
  const action = descriptors.action.value;
  if (typeof action !== "string" || !dietManagerActions.includes(action as DietManagerAction)) {
    return invalid("action");
  }
  const parseInput = cloneCoreParseInput(Object.fromEntries(
    REQUEST_FIELDS.filter((key) => key !== "action")
      .map((key) => [key, descriptors[key].value]),
  ) as CoreApplicationRequest);
  const ordinaryParseInput = JSON.parse(JSON.stringify(parseInput)) as Omit<
    CoreApplicationRequest,
    "action"
  >;
  return Object.freeze({ action: action as DietManagerAction, ...ordinaryParseInput });
}

function commandAction(command: CoreCommandCandidate): DietManagerAction {
  return command.action;
}

function sanitizedCode(error: unknown): string {
  if (!(error instanceof Error)) return "CORE_APPLICATION_FAILED";
  if (error.message.startsWith("IDEMPOTENCY_CONFLICT:")) return "idempotency_conflict";
  const code = error.message.split(":", 1)[0];
  if (/^[A-Z][A-Z0-9_]*$/u.test(code)) return code;
  return "CORE_APPLICATION_FAILED";
}

export function handleCoreRequest(
  runtime: CoreRuntime,
  value: CoreApplicationRequest,
): DietManagerOutcome {
  let request: Readonly<CoreApplicationRequest>;
  try {
    request = cloneRequest(value);
  } catch {
    return failedOutcome("record_meal", undefined, "INVALID_REQUEST");
  }

  const unsupported = !["record_meal", "record_water", "add_inventory"].includes(request.action);
  if (unsupported) return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");

  let parsed;
  try {
    const { action: _action, ...parseInput } = request;
    parsed = parseCoreCommand(parseInput);
  } catch {
    return failedOutcome(request.action, request.operation_id, "INVALID_REQUEST");
  }
  if (parsed.disposition !== "candidate") {
    if (parsed.action !== request.action) {
      return failedOutcome(request.action, request.operation_id, "ACTION_CONFLICT");
    }
    return nonWritingOutcome(
      request.action,
      request.operation_id,
      parsed.disposition,
      parsed.reason_code,
    );
  }
  if (commandAction(parsed.command) !== request.action) {
    return failedOutcome(request.action, request.operation_id, "ACTION_CONFLICT");
  }
  if (parsed.command.action === "add_inventory") {
    return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");
  }

  const envelope = mapCoreCandidateToEnvelope(request, parsed.command);

  try {
    const result = executeCoreEnvelope(runtime, envelope);
    return committedOutcome(
      request.action,
      request.operation_id,
      result.status,
      result.record_id,
    );
  } catch (error) {
    return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
  }
}
