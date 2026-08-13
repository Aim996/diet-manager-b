import { isProxy } from "node:util/types";
import type { DatabaseSync } from "node:sqlite";

import {
  createDietDomainService,
  type DietDomainService,
} from "../domain/service.js";
import { openDietDatabase, type DietDatabaseRuntime } from "../storage/database.js";
import {
  assertRuntimeRootAuthority,
  CORE_RUNTIME_SECRET_FILENAME,
  createRuntimeRootAuthority,
  loadOrCreateRuntimeSecret,
  type RuntimeRootAuthority,
} from "./filesystem-authority.js";
import { registerCoreRuntime } from "./runtime-executor.js";

export { CORE_RUNTIME_SECRET_FILENAME } from "./filesystem-authority.js";

export interface CreateCoreRuntimeOptions {
  readonly officialDataRoot: string;
  readonly now: () => string;
}

export interface CoreRuntime {
  close(): void;
}

interface CoreRuntimeSession {
  readonly database: DatabaseSync;
  readonly service: DietDomainService;
}

interface RuntimeState {
  readonly root: string;
  readonly rootAuthority: RuntimeRootAuthority;
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

export function createCoreRuntime(options: CreateCoreRuntimeOptions): CoreRuntime {
  const validated = exactOptions(options);
  const rootAuthority = createRuntimeRootAuthority(validated.officialDataRoot);
  const cached = liveByRoot.get(rootAuthority.root);
  if (cached !== undefined) {
    const cachedState = states.get(cached);
    if (cachedState === undefined) throw new Error("STORAGE_PATH_INVALID:root_identity");
    assertRuntimeRootAuthority(cachedState.rootAuthority);
    return cached;
  }

  let runtime!: CoreRuntime;
  const state: RuntimeState = {
    root: rootAuthority.root,
    rootAuthority,
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
  registerCoreRuntime(runtime, () => acquireCoreRuntimeSession(runtime));
  assertRuntimeRootAuthority(rootAuthority);
  liveByRoot.set(rootAuthority.root, runtime);
  return runtime;
}

function acquireCoreRuntimeSession(runtime: CoreRuntime): CoreRuntimeSession {
  const state = states.get(runtime);
  if (state === undefined) return invalid("runtime");
  if (state.closed) return invalid("closed");
  assertRuntimeRootAuthority(state.rootAuthority);
  if (state.session !== undefined) return state.session;
  const secret = loadOrCreateRuntimeSecret(state.rootAuthority);
  assertRuntimeRootAuthority(state.rootAuthority);
  let databaseRuntime: DietDatabaseRuntime | undefined;
  try {
    databaseRuntime = openDietDatabase({
      privateRuntimeRoot: state.root,
      now: state.now,
    });
    assertRuntimeRootAuthority(state.rootAuthority);
    const session = Object.freeze({
      database: databaseRuntime.database,
      service: createDietDomainService({
        database: databaseRuntime.database,
        secret,
        now: state.now,
      }),
    });
    assertRuntimeRootAuthority(state.rootAuthority);
    state.databaseRuntime = databaseRuntime;
    state.session = session;
    return session;
  } catch (error) {
    databaseRuntime?.close();
    throw error;
  }
}
