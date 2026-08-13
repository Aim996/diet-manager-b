import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import {
  dietManagerActions,
  type CoreApplicationRequest,
  type DietManagerAction,
  type DietManagerOutcome,
} from "../contracts.js";
import type {
  DomainEnvelopeInput,
  DomainOperation,
  RecordMealOperation,
  RecordWaterOperation,
} from "../domain/types.js";
import { cloneCoreParseInput } from "../parser/input-authority.js";
import { parseCoreCommand } from "../parser/parse-command.js";
import type { CoreCommandCandidate, CoreMealCommandCandidate } from "../parser/types.js";
import { acquireCoreRuntimeSession, type CoreRuntime } from "./runtime.js";
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

function operationIdentity(request: Readonly<CoreApplicationRequest>): string {
  const hash = createHash("sha256")
    .update("diet-manager/application-envelope/v1\n", "ascii")
    .update(request.operation_id, "utf8")
    .update("\0", "ascii")
    .update(request.source_message_id, "utf8")
    .update("\0", "ascii")
    .update(request.conversation_id, "utf8")
    .digest("hex");
  return hash.toUpperCase();
}

function mealSlot(sourceText: string): string {
  for (const token of ["早餐", "午餐", "晚餐", "加餐", "夜宵"] as const) {
    if (sourceText.includes(token)) return token;
  }
  return "unknown";
}

function mealLocation(command: CoreMealCommandCandidate): "home" | "outside" {
  const scene = command.context?.scene;
  return scene === "outside" || scene === "company" ? "outside" : "home";
}

function mapOperation(command: CoreCommandCandidate): DomainOperation {
  const detached = JSON.parse(JSON.stringify(command)) as CoreCommandCandidate;
  if (detached.action === "record_water") {
    return {
      kind: "record_water",
      operation_id: detached.operation_id,
      occurred_time: detached.occurred_time,
      source_text: detached.source_text,
      plain_water_ml_milli: detached.plain_water_ml_milli,
      amount_evidence: detached.amount_evidence,
    } satisfies RecordWaterOperation;
  }
  if (detached.action !== "record_meal") {
    throw new Error("ACTION_NOT_IMPLEMENTED");
  }
  if (detached.occurred_time.resolved_start === null) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:occurred_time");
  }
  const operation: RecordMealOperation = {
    kind: "record_meal",
    operation_id: detached.operation_id,
    occurred_at: new Date(detached.occurred_time.resolved_start).toISOString(),
    meal_slot: mealSlot(detached.source_text),
    location: mealLocation(detached),
    items: detached.items.map((item) => ({
      normalized_name: item.normalized_name,
      item_type: item.kind === "food" ? "food" : "nutrition_drink",
      amount: {
        unit: item.unit ?? "unknown",
        observed_microunits: item.quantity === null ? null : item.quantity * 1_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: item.quantity === null
          ? "unknown"
          : item.estimated === false
            ? "explicit"
            : "estimated_upper_bound",
      },
      nutrition_sources: [],
    })),
    source_text: detached.source_text,
    occurred_time: detached.occurred_time,
    subject: detached.subject,
    ...(detached.context === undefined ? {} : { context: detached.context }),
  };
  return operation;
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

function terminalRecordId(
  session: ReturnType<typeof acquireCoreRuntimeSession>,
  envelope: DomainEnvelopeInput,
  operation: DomainOperation,
): string {
  const rows = session.database.prepare(
    `SELECT event_id, event_type, fact_kind, operation_id
     FROM event_records WHERE envelope_id = ? AND operation_id = ?`,
  ).all(envelope.envelope_id, operation.operation_id) as Array<{
    event_id: string;
    event_type: string;
    fact_kind: string;
    operation_id: string;
  }>;
  const expected = operation.kind === "record_water"
    ? { event_type: "diet_water", fact_kind: "water" }
    : { event_type: "diet_meal", fact_kind: "meal" };
  if (
    rows.length !== 1 || rows[0]?.operation_id !== operation.operation_id ||
    rows[0]?.event_type !== expected.event_type || rows[0]?.fact_kind !== expected.fact_kind
  ) throw new Error("CORE_APPLICATION_RESULT_INVALID:event_identity");
  return rows[0].event_id;
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

  const identity = operationIdentity(request);
  const operation = mapOperation(parsed.command);
  const envelope: DomainEnvelopeInput = {
    envelope_id: `envelope-${identity.slice(0, 32).toLowerCase()}`,
    idempotency_key: `core-${identity}`,
    command_type: request.action,
    subject_scope: "user:self",
    source_message_id: request.source_message_id,
    conversation_id: request.conversation_id,
    received_at: new Date(request.received_at).toISOString(),
    timezone: "Asia/Shanghai",
    operations: [operation],
  };

  try {
    const session = acquireCoreRuntimeSession(runtime);
    const preview = session.service.preview(envelope);
    const result = session.service.execute({
      envelope,
      token: preview.token,
      input_digest: preview.input_digest,
      data_revision: preview.data_revision,
    });
    if (result.status !== "committed" && result.status !== "committed_with_issues") {
      return failedOutcome(request.action, request.operation_id, "NONTERMINAL_RESULT");
    }
    if (
      result.items.length !== 1 || result.items[0]?.operation_id !== operation.operation_id ||
      (result.items[0]?.status !== "committed" &&
        result.items[0]?.status !== "committed_with_issues")
    ) return failedOutcome(request.action, request.operation_id, "INVALID_RESULT");
    return committedOutcome(
      request.action,
      request.operation_id,
      result.items[0].status,
      terminalRecordId(session, envelope, operation),
    );
  } catch (error) {
    return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
  }
}
