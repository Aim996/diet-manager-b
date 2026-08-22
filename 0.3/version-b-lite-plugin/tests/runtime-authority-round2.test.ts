import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import casesCatalog from "../../shared/acceptance-cases/cases.json";

const observation = vi.hoisted(() => ({
  candidateSizeAtAclSet: undefined as number | undefined,
  swapAuditWith: undefined as string | undefined,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const childProcess = await importOriginal<typeof import("node:child_process")>();
  return {
    ...childProcess,
    spawnSync(...args: Parameters<typeof childProcess.spawnSync>) {
      const options = args[2] as { env?: NodeJS.ProcessEnv } | undefined;
      const script = Array.isArray(args[1]) ? String(args[1][3] ?? "") : "";
      const path = options?.env?.DIET_SECRET_PATH;
      if (script.includes("Set-Acl") && typeof path === "string" && existsSync(path)) {
        observation.candidateSizeAtAclSet = statSync(path).size;
      }
      if (!script.includes("Set-Acl") && script.includes("Get-Acl") &&
          typeof path === "string" && observation.swapAuditWith !== undefined) {
        const decoy = observation.swapAuditWith;
        const displaced = `${path}.broad`;
        observation.swapAuditWith = undefined;
        renameSync(path, displaced);
        renameSync(decoy, path);
        try {
          return childProcess.spawnSync(...args);
        } finally {
          renameSync(path, decoy);
          renameSync(displaced, path);
        }
      }
      return childProcess.spawnSync(...args);
    },
  };
});

import { handleCoreRequest } from "../src/application/command-handler.js";
import { createCoreRuntime } from "../src/application/runtime.js";

const roots = new Set<string>();

afterEach(() => {
  observation.candidateSizeAtAclSet = undefined;
  observation.swapAuditWith = undefined;
  for (const root of roots) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: false });
    roots.delete(root);
  }
});

function request() {
  const sourceText = casesCatalog.cases.find((value) => value.id === "CASE-MEAL-021")!.source_text;
  return {
    action: "record_meal" as const,
    source_text: sourceText,
    received_at: "2026-08-11T08:30:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: "operation-round2",
    source_message_id: "message-round2",
    conversation_id: "conversation-round2",
    prior_context: [],
  };
}

describe("Task 8 round-two application authority", () => {
  it("publishes no importable secret or arbitrary-envelope capability modules", () => {
    expect(existsSync(new URL("../src/application/filesystem-authority.ts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/application/runtime-executor.ts", import.meta.url))).toBe(false);
  });

  it.runIf(process.platform === "win32")(
    "protects and audits an empty candidate before writing secret bytes",
    () => {
      const root = mkdtempSync(join(tmpdir(), `diet-manager-round2-${randomUUID()}-`));
      roots.add(root);
      const runtime = createCoreRuntime({ officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z" });
      try {
        expect(handleCoreRequest(runtime, request()).committed).toBe(true);
        expect(observation.candidateSizeAtAclSet).toBe(0);
      } finally {
        runtime.close();
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "binds the exclusive ACL audit to the same final secret identity",
    () => {
      const root = mkdtempSync(join(tmpdir(), `diet-manager-round2-swap-${randomUUID()}-`));
      roots.add(root);
      const first = createCoreRuntime({ officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z" });
      expect(handleCoreRequest(first, request()).committed).toBe(true);
      first.close();

      const secret = join(root, ".diet-manager-b.authority-secret");
      const decoy = join(root, "exact-decoy");
      renameSync(secret, decoy);
      copyFileSync(decoy, secret);
      observation.swapAuditWith = decoy;

      const reopened = createCoreRuntime({ officialDataRoot: root,
        now: () => "2026-08-11T00:30:02.000Z" });
      try {
        expect(handleCoreRequest(reopened, request())).toEqual({
          action: "record_meal", status: "failed", committed: false,
          operation_id: "operation-round2", error_code: "CORE_RUNTIME_SECRET_INVALID",
        });
      } finally {
        reopened.close();
      }
    },
  );
});
