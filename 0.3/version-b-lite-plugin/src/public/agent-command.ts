import { isProxy } from "node:util/types";

import {
  dietManagerActions,
  type DietManagerAction,
} from "../contracts/actions.js";
import {
  AGENT_COMMAND_V1_SCHEMA_VERSION,
  AGENT_COMMAND_V2_SCHEMA_VERSION,
  agentCommandParametersSchema,
  agentCommandV1Schema,
  agentCommandV2Schema,
  cloneAgentCommandV2,
  type AgentCommandV2,
} from "../contracts/agent-command-v2.js";
import {
  cloneSemanticCandidate,
  type SemanticMealCandidateV1,
} from "../semantic/candidate.js";

export const AGENT_COMMAND_SCHEMA_VERSION = AGENT_COMMAND_V1_SCHEMA_VERSION;
export {
  AGENT_COMMAND_V2_SCHEMA_VERSION,
  agentCommandParametersSchema,
  agentCommandV1Schema,
  agentCommandV2Schema,
  cloneAgentCommandV2,
};
export type { AgentCommandV2 };

export interface AgentCommandV1 {
  readonly schema_version: typeof AGENT_COMMAND_SCHEMA_VERSION;
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly semantic_candidate?: SemanticMealCandidateV1;
}
export type AgentCommand = AgentCommandV1 | AgentCommandV2;

export interface HostExecutionContextV1 {
  readonly received_at: string;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
}

type OrdinaryRecord = Record<string, unknown>;

function invalid(reason: string): never {
  throw new TypeError(`DIET_AGENT_COMMAND_INVALID:${reason}`);
}

function exactOrdinaryRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): OrdinaryRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return invalid("shape");
  }
  const keys = Reflect.ownKeys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    requiredKeys.some((key) => !keys.includes(key))
  ) return invalid("keys");
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      return invalid(`${key}:descriptor`);
    }
  }
  return value as OrdinaryRecord;
}

function data(source: OrdinaryRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
    return invalid(`${key}:descriptor`);
  }
  return descriptor.value;
}

function optionalData(source: OrdinaryRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) return undefined;
  if (!Object.hasOwn(descriptor, "value")) return invalid(`${key}:descriptor`);
  return descriptor.value;
}

export function cloneAgentCommandV1(value: unknown): Readonly<AgentCommandV1> {
  const source = exactOrdinaryRecord(
    value,
    ["schema_version", "action", "source_text"],
    ["semantic_candidate"],
  );
  const schemaVersion = data(source, "schema_version");
  const action = data(source, "action");
  const sourceText = data(source, "source_text");
  if (schemaVersion !== AGENT_COMMAND_SCHEMA_VERSION) invalid("schema_version");
  if (typeof action !== "string" || !dietManagerActions.includes(action as DietManagerAction)) {
    invalid("action");
  }
  if (typeof sourceText !== "string" || sourceText.length < 1 || sourceText.length > 4096) {
    invalid("source_text");
  }
  const rawCandidate = optionalData(source, "semantic_candidate");
  if (rawCandidate === undefined) {
    return Object.freeze({
      schema_version: AGENT_COMMAND_SCHEMA_VERSION,
      action: action as DietManagerAction,
      source_text: sourceText,
    });
  }
  if (action !== "record_meal") invalid("semantic_candidate_action");
  const candidate = cloneSemanticCandidate(rawCandidate);
  if (candidate.source_text !== sourceText) invalid("semantic_candidate_source_text");
  return Object.freeze({
    schema_version: AGENT_COMMAND_SCHEMA_VERSION,
    action: action as DietManagerAction,
    source_text: sourceText,
    semantic_candidate: candidate,
  });
}

export function cloneAgentCommand(value: unknown): Readonly<AgentCommand> {
  if (typeof value !== "object" || value === null || isProxy(value)) invalid("shape");
  const descriptor = Object.getOwnPropertyDescriptor(value, "schema_version");
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
    return invalid("schema_version:descriptor");
  }
  if (descriptor.value === AGENT_COMMAND_V1_SCHEMA_VERSION) return cloneAgentCommandV1(value);
  if (descriptor.value === AGENT_COMMAND_V2_SCHEMA_VERSION) return cloneAgentCommandV2(value);
  return invalid("schema_version");
}

export function cloneHostExecutionContextV1(value: unknown): Readonly<HostExecutionContextV1> {
  const source = exactOrdinaryRecord(value, [
    "received_at",
    "timezone",
    "operation_id",
    "source_message_id",
    "conversation_id",
  ]);
  const receivedAt = data(source, "received_at");
  const timezone = data(source, "timezone");
  const operationId = data(source, "operation_id");
  const sourceMessageId = data(source, "source_message_id");
  const conversationId = data(source, "conversation_id");
  if (typeof receivedAt !== "string") invalid("received_at");
  if (timezone !== "Asia/Shanghai") invalid("timezone");
  if (typeof operationId !== "string") invalid("operation_id");
  if (typeof sourceMessageId !== "string") invalid("source_message_id");
  if (typeof conversationId !== "string") invalid("conversation_id");
  return Object.freeze({
    received_at: receivedAt,
    timezone,
    operation_id: operationId,
    source_message_id: sourceMessageId,
    conversation_id: conversationId,
  });
}
