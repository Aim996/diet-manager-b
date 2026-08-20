#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";

import {
  cloneAgentCommandV1,
  createCoreRuntime,
  executeAgentCommand,
} from "../index.js";
import { AgentRuntimeConfigError, loadAgentRuntimeConfig } from "./config.js";

const INPUT_MAX_BYTES = 65_536;

class InvalidInputError extends Error {}
class InputTooLargeError extends Error {}

function invalidInput(): never {
  throw new InvalidInputError();
}

async function readBoundedInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    if (length + chunk.length > INPUT_MAX_BYTES) throw new InputTooLargeError();
    chunks.push(chunk);
    length += chunk.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
  } catch {
    return invalidInput();
  }
}

function parseCommand(input: string) {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return invalidInput();
  }
  try {
    return cloneAgentCommandV1(value);
  } catch {
    return invalidInput();
  }
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 1 || args[0] !== "execute") invalidInput();
  const command = parseCommand(await readBoundedInput());
  const config = loadAgentRuntimeConfig();
  const dataRoot = config.officialDataRoot;
  const conversationId = config.conversationId ??
    `standalone-${createHash("sha256").update(realpathSync(dataRoot), "utf8").digest("hex")}`;
  const receivedAt = new Date().toISOString();
  const runtime = createCoreRuntime({
    officialDataRoot: dataRoot,
    now: () => new Date().toISOString(),
  });
  try {
    const outcome = await executeAgentCommand(runtime, command, {
      received_at: receivedAt,
      timezone: "Asia/Shanghai",
      operation_id: randomUUID(),
      source_message_id: randomUUID(),
      conversation_id: conversationId,
    });
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } finally {
    runtime.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const code = error instanceof InputTooLargeError
    ? "DIET_AGENT_CLI_INPUT_TOO_LARGE"
    : error instanceof InvalidInputError
      ? "DIET_AGENT_CLI_INVALID_INPUT"
      : error instanceof AgentRuntimeConfigError
        ? "DIET_AGENT_CLI_CONFIG_REQUIRED"
        : "DIET_AGENT_CLI_UNAVAILABLE";
  process.stderr.write(`${code}\n`);
  process.exitCode = 2;
});
