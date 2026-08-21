#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";

import {
  cloneAgentCommand,
  createCoreRuntime,
  executeAgentCommand,
} from "../index.js";
import { AgentRuntimeConfigError, loadAgentRuntimeConfig } from "./config.js";

const INPUT_MAX_BYTES = 65_536;

class InvalidInputError extends Error {}
class InputTooLargeError extends Error {}
class OutputWriteError extends Error {}

function invalidInput(): never {
  throw new InvalidInputError();
}

function assertNoDuplicateJsonKeys(input: string): void {
  let index = 0;
  let depth = 0;

  function whitespace(): void {
    while (index < input.length && /[\u0009\u000a\u000d\u0020]/u.test(input[index]!)) index += 1;
  }

  function stringValue(): string {
    const start = index;
    if (input[index] !== '"') invalidInput();
    index += 1;
    while (index < input.length) {
      const code = input.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        try {
          return JSON.parse(input.slice(start, index)) as string;
        } catch {
          return invalidInput();
        }
      }
      if (code < 0x20) invalidInput();
      if (code === 0x5c) {
        index += 1;
        const escape = input[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(input.slice(index + 1, index + 5))) invalidInput();
          index += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) invalidInput();
      }
      index += 1;
    }
    return invalidInput();
  }

  function value(): void {
    whitespace();
    const token = input[index];
    if (token === '"') {
      stringValue();
      return;
    }
    if (token === "{") {
      objectValue();
      return;
    }
    if (token === "[") {
      arrayValue();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (input.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(input.slice(index));
    if (number === null) invalidInput();
    index += number[0].length;
  }

  function objectValue(): void {
    if (++depth > 128) invalidInput();
    index += 1;
    whitespace();
    const keys = new Set<string>();
    if (input[index] === "}") {
      index += 1;
      depth -= 1;
      return;
    }
    while (true) {
      whitespace();
      const key = stringValue();
      if (keys.has(key)) invalidInput();
      keys.add(key);
      whitespace();
      if (input[index] !== ":") invalidInput();
      index += 1;
      value();
      whitespace();
      if (input[index] === "}") {
        index += 1;
        depth -= 1;
        return;
      }
      if (input[index] !== ",") invalidInput();
      index += 1;
    }
  }

  function arrayValue(): void {
    if (++depth > 128) invalidInput();
    index += 1;
    whitespace();
    if (input[index] === "]") {
      index += 1;
      depth -= 1;
      return;
    }
    while (true) {
      value();
      whitespace();
      if (input[index] === "]") {
        index += 1;
        depth -= 1;
        return;
      }
      if (input[index] !== ",") invalidInput();
      index += 1;
    }
  }

  value();
  whitespace();
  if (index !== input.length) invalidInput();
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
    assertNoDuplicateJsonKeys(input);
    value = JSON.parse(input);
  } catch {
    return invalidInput();
  }
  try {
    return cloneAgentCommand(value);
  } catch {
    return invalidInput();
  }
}

async function writeOutcome(value: unknown): Promise<void> {
  const line = `${JSON.stringify(value)}\n`;
  await new Promise<void>((resolve, reject) => {
    const failed = (): void => reject(new OutputWriteError());
    const onError = (): void => failed();
    process.stdout.once("error", onError);
    try {
      process.stdout.write(line, (error) => {
        if (error === null || error === undefined) resolve();
        else failed();
        setImmediate(() => process.stdout.off("error", onError));
      });
    } catch {
      process.stdout.off("error", onError);
      failed();
    }
  });
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
    await writeOutcome(outcome);
  } finally {
    runtime.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const code = error instanceof InputTooLargeError
    ? "DIET_AGENT_CLI_INPUT_TOO_LARGE"
    : error instanceof InvalidInputError
      ? "DIET_AGENT_CLI_INVALID_INPUT"
      : error instanceof OutputWriteError
        ? "DIET_AGENT_CLI_OUTPUT_FAILED"
      : error instanceof AgentRuntimeConfigError
        ? "DIET_AGENT_CLI_CONFIG_REQUIRED"
        : "DIET_AGENT_CLI_UNAVAILABLE";
  process.stderr.write(`${code}\n`);
  process.exitCode = 2;
});
