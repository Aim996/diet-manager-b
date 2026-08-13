import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  linkSync,
  lstatSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isProxy } from "node:util/types";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  createDietDomainService,
  type DietDomainService,
} from "../domain/service.js";
import {
  assertPrivateRuntimeRoot,
  openDietDatabase,
  type DietDatabaseRuntime,
} from "../storage/database.js";

export const CORE_RUNTIME_SECRET_FILENAME = ".diet-manager-b.authority-secret";

export interface CreateCoreRuntimeOptions {
  readonly officialDataRoot: string;
  readonly now: () => string;
}

export interface CoreRuntime {
  close(): void;
}

export interface CoreRuntimeSession {
  readonly database: DatabaseSync;
  readonly service: DietDomainService;
}

interface RuntimeState {
  readonly root: string;
  readonly rootDev: bigint | number;
  readonly rootIno: bigint | number;
  readonly now: () => string;
  closed: boolean;
  databaseRuntime?: DietDatabaseRuntime;
  session?: CoreRuntimeSession;
}

const liveByRoot = new Map<string, CoreRuntime>();
const states = new WeakMap<CoreRuntime, RuntimeState>();

function invalid(reason: string): never {
  throw new TypeError(`CORE_RUNTIME_INVALID:${reason}`);
}

function clockValue(now: () => string): string {
  let value: unknown;
  try {
    value = now();
  } catch {
    return invalid("clock");
  }
  if (typeof value !== "string") return invalid("clock");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return invalid("clock");
  }
  return value;
}

function exactOptions(value: unknown): CreateCoreRuntimeOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("options");
  }
  if (isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return invalid("options");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 || keys.some((key) => typeof key !== "string") ||
    !keys.includes("officialDataRoot") || !keys.includes("now")
  ) return invalid("options");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      return invalid("options");
    }
  }
  const root = descriptors.officialDataRoot.value;
  const now = descriptors.now.value;
  if (typeof root !== "string") return invalid("root");
  if (typeof now !== "function") return invalid("clock");
  clockValue(now as () => string);
  return Object.freeze({ officialDataRoot: root, now: now as () => string });
}

function rootIdentity(root: string): {
  readonly root: string;
  readonly dev: bigint | number;
  readonly ino: bigint | number;
} {
  const canonical = assertPrivateRuntimeRoot(root);
  const stat = lstatSync(canonical, { bigint: true });
  return Object.freeze({ root: canonical, dev: stat.dev, ino: stat.ino });
}

function privateSecret(path: string): Uint8Array {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("CORE_RUNTIME_SECRET_INVALID:reparse");
  if (!stat.isFile()) throw new Error("CORE_RUNTIME_SECRET_INVALID:file");
  if (stat.nlink !== 1) throw new Error("CORE_RUNTIME_SECRET_INVALID:link_count");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("CORE_RUNTIME_SECRET_INVALID:permissions");
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength !== 32) throw new Error("CORE_RUNTIME_SECRET_INVALID:length");
  return Uint8Array.from(bytes);
}

function readSecretIfPresent(path: string): Uint8Array | undefined {
  try {
    return privateSecret(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function loadOrCreateSecret(root: string): Uint8Array {
  const finalPath = join(root, CORE_RUNTIME_SECRET_FILENAME);
  const existing = readSecretIfPresent(finalPath);
  if (existing !== undefined) return existing;

  const candidatePath = join(root, `.${CORE_RUNTIME_SECRET_FILENAME}.candidate-${randomUUID()}`);
  try {
    writeFileSync(candidatePath, randomBytes(32), { flag: "wx", mode: 0o600 });
    if (process.platform !== "win32") chmodSync(candidatePath, 0o600);
    privateSecret(candidatePath);
    try {
      linkSync(candidatePath, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    try {
      unlinkSync(candidatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return privateSecret(finalPath);
}

export function createCoreRuntime(options: CreateCoreRuntimeOptions): CoreRuntime {
  const validated = exactOptions(options);
  const identity = rootIdentity(validated.officialDataRoot);
  const cached = liveByRoot.get(identity.root);
  if (cached !== undefined) {
    const cachedState = states.get(cached);
    if (
      cachedState === undefined || cachedState.rootDev !== identity.dev ||
      cachedState.rootIno !== identity.ino
    ) throw new Error("STORAGE_PATH_INVALID:root_identity");
    return cached;
  }

  let runtime!: CoreRuntime;
  const state: RuntimeState = {
    root: identity.root,
    rootDev: identity.dev,
    rootIno: identity.ino,
    now: validated.now,
    closed: false,
  };
  runtime = Object.freeze({
    close(): void {
      if (state.closed) return;
      state.closed = true;
      state.databaseRuntime?.close();
      state.databaseRuntime = undefined;
      state.session = undefined;
      if (liveByRoot.get(state.root) === runtime) liveByRoot.delete(state.root);
    },
  });
  states.set(runtime, state);
  liveByRoot.set(identity.root, runtime);
  return runtime;
}

export function acquireCoreRuntimeSession(runtime: CoreRuntime): CoreRuntimeSession {
  const state = states.get(runtime);
  if (state === undefined) return invalid("runtime");
  if (state.closed) return invalid("closed");
  if (state.session !== undefined) return state.session;
  const identity = rootIdentity(state.root);
  if (identity.dev !== state.rootDev || identity.ino !== state.rootIno) {
    throw new Error("STORAGE_PATH_INVALID:root_identity");
  }
  const secret = loadOrCreateSecret(state.root);
  let databaseRuntime: DietDatabaseRuntime | undefined;
  try {
    databaseRuntime = openDietDatabase({
      privateRuntimeRoot: state.root,
      now: state.now,
    });
    const session = Object.freeze({
      database: databaseRuntime.database,
      service: createDietDomainService({
        database: databaseRuntime.database,
        secret,
        now: state.now,
      }),
    });
    state.databaseRuntime = databaseRuntime;
    state.session = session;
    return session;
  } catch (error) {
    databaseRuntime?.close();
    throw error;
  }
}
