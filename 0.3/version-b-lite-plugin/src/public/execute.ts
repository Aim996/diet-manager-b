import { handleCoreRequestAsync } from "../application/command-handler.js";
import type { CoreRuntime } from "../application/runtime.js";
import { assertDietManagerOutcome, type DietManagerOutcome } from "../contracts.js";
import {
  cloneAgentCommand,
  cloneHostExecutionContextV1,
  type AgentCommand,
  type HostExecutionContextV1,
} from "./agent-command.js";

export async function executeAgentCommand(
  runtime: CoreRuntime,
  commandValue: AgentCommand,
  contextValue: HostExecutionContextV1,
): Promise<DietManagerOutcome> {
  const command = cloneAgentCommand(commandValue);
  const context = cloneHostExecutionContextV1(contextValue);
  return assertDietManagerOutcome(await handleCoreRequestAsync(runtime, {
    action: command.action,
    source_text: command.source_text,
    received_at: context.received_at,
    timezone: context.timezone,
    operation_id: context.operation_id,
    source_message_id: context.source_message_id,
    conversation_id: context.conversation_id,
    prior_context: [],
    ...(command.schema_version === "diet-manager/agent-command/v1" &&
      command.semantic_candidate !== undefined
      ? { semantic_candidate: command.semantic_candidate }
      : {}),
    ...(command.schema_version === "diet-manager/agent-command/v2" &&
      command.semantic_proposal !== undefined
      ? { semantic_proposal: command.semantic_proposal }
      : {}),
  }));
}
