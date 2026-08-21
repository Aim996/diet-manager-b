import { handleCoreRequestAsync } from "../application/command-handler.js";
import type { CoreRuntime } from "../application/runtime.js";
import { assertDietManagerOutcome, type DietManagerOutcome } from "../contracts.js";
import {
  cloneAgentCommandV1,
  cloneHostExecutionContextV1,
  type AgentCommandV1,
  type HostExecutionContextV1,
} from "./agent-command.js";

export async function executeAgentCommand(
  runtime: CoreRuntime,
  commandValue: AgentCommandV1,
  contextValue: HostExecutionContextV1,
): Promise<DietManagerOutcome> {
  const command = cloneAgentCommandV1(commandValue);
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
    ...(command.semantic_candidate === undefined
      ? {}
      : { semantic_candidate: command.semantic_candidate }),
  }));
}
