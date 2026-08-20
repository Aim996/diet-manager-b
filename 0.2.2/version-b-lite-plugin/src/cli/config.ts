import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";

const RUNTIME_CONFIG_SCHEMA_VERSION = "diet-manager/runtime-config/v1" as const;
const RUNTIME_CONFIG_MAX_BYTES = 16_384;

export interface AgentRuntimeConfig {
  readonly officialDataRoot: string;
  readonly timezone: "Asia/Shanghai";
  readonly conversationId?: string;
}

export class AgentRuntimeConfigError extends Error {
  readonly code = "DIET_AGENT_CLI_CONFIG_REQUIRED" as const;

  constructor() {
    super("DIET_AGENT_CLI_CONFIG_REQUIRED");
    this.name = "AgentRuntimeConfigError";
  }
}

type BigIntStats = ReturnType<typeof fstatSync> & {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly nlink: bigint;
  readonly size: bigint;
};

function configRequired(): never {
  throw new AgentRuntimeConfigError();
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function validateOrdinaryFile(stat: BigIntStats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n ||
      stat.size < 0n || stat.size > BigInt(RUNTIME_CONFIG_MAX_BYTES)) {
    configRequired();
  }
}

function readExactOrdinaryFile(path: string): string {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(path, { bigint: true }) as BigIntStats;
    validateOrdinaryFile(before);
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true }) as BigIntStats;
    validateOrdinaryFile(opened);
    if (!sameIdentity(before, opened)) configRequired();

    const length = Number(opened.size);
    const bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const count = readSync(descriptor, bytes, offset, length - offset, offset);
      if (count === 0) configRequired();
      offset += count;
    }

    const after = fstatSync(descriptor, { bigint: true }) as BigIntStats;
    const current = lstatSync(path, { bigint: true }) as BigIntStats;
    validateOrdinaryFile(after);
    validateOrdinaryFile(current);
    if (!sameIdentity(opened, after) || !sameIdentity(after, current) || after.size !== opened.size) {
      configRequired();
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof AgentRuntimeConfigError) throw error;
    return configRequired();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function exactConfigRecord(value: unknown): Readonly<Record<string, PropertyDescriptor>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    return configRequired();
  }
  const required = ["schema_version", "official_data_root", "timezone"] as const;
  const allowed = new Set([...required, "conversation_id"]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      required.some((key) => !keys.includes(key))) {
    return configRequired();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      return configRequired();
    }
  }
  return descriptors;
}

function parseConfigFile(path: string): AgentRuntimeConfig {
  let value: unknown;
  try {
    value = JSON.parse(readExactOrdinaryFile(path));
  } catch (error) {
    if (error instanceof AgentRuntimeConfigError) throw error;
    return configRequired();
  }
  const descriptors = exactConfigRecord(value);
  const schemaVersion = descriptors.schema_version?.value;
  const officialDataRoot = descriptors.official_data_root?.value;
  const timezone = descriptors.timezone?.value;
  const conversationId = descriptors.conversation_id?.value;
  if (schemaVersion !== RUNTIME_CONFIG_SCHEMA_VERSION ||
      typeof officialDataRoot !== "string" || officialDataRoot.length === 0 ||
      timezone !== "Asia/Shanghai" ||
      (conversationId !== undefined && typeof conversationId !== "string")) {
    return configRequired();
  }
  return Object.freeze({
    officialDataRoot,
    timezone,
    ...(conversationId === undefined ? {} : { conversationId }),
  });
}

export function loadAgentRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<AgentRuntimeConfig> {
  const configFile = environment.DIET_MANAGER_CONFIG_FILE;
  if (configFile !== undefined && configFile.length === 0) configRequired();
  const fileConfig = configFile === undefined ? undefined : parseConfigFile(configFile);
  const officialDataRoot = environment.DIET_MANAGER_DATA_ROOT ?? fileConfig?.officialDataRoot;
  if (officialDataRoot === undefined || officialDataRoot.length === 0) configRequired();
  const conversationId = environment.DIET_MANAGER_CONVERSATION_ID ?? fileConfig?.conversationId;
  return Object.freeze({
    officialDataRoot,
    timezone: "Asia/Shanghai",
    ...(conversationId === undefined ? {} : { conversationId }),
  });
}
