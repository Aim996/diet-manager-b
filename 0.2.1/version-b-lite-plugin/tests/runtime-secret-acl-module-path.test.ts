import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import casesCatalog from "../../shared/acceptance-cases/cases.json";
import { handleCoreRequest } from "../src/application/command-handler.js";
import { createCoreRuntime } from "../src/application/runtime.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
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
    operation_id: "operation-acl-module-path",
    source_message_id: "message-acl-module-path",
    conversation_id: "conversation-acl-module-path",
    prior_context: [],
  };
}

// Publishes a module tree whose Microsoft.PowerShell.Security manifest declares
// Core-only compatibility, exactly like the one PowerShell 7 puts first on
// PSModulePath. Windows PowerShell 5.1 matches that first entry and then refuses
// to load it, so Get-Acl and Set-Acl disappear from the child shell.
function publishCoreOnlySecurityModule(host: string): string {
  const moduleRoot = join(host, "poison-psmodulepath");
  mkdirSync(join(moduleRoot, "Microsoft.PowerShell.Security"), { recursive: true });
  writeFileSync(
    join(moduleRoot, "Microsoft.PowerShell.Security", "Microsoft.PowerShell.Security.psd1"),
    [
      "@{",
      "  ModuleVersion = '7.0.0.0'",
      "  GUID = 'a94c8c7e-9810-47c0-b8af-65089c13a35a'",
      "  Author = 'diet-manager-regression'",
      "  CompatiblePSEditions = @('Core')",
      "  PowerShellVersion = '7.0'",
      "  CmdletsToExport = @('Get-Acl', 'Set-Acl')",
      "  FunctionsToExport = @()",
      "  AliasesToExport = @()",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return moduleRoot;
}

describe("CORE-SECRET-ACL-001 authority secret protection is independent of the caller shell", () => {
  it.runIf(process.platform === "win32")(
    "commits when the caller exports a PowerShell 7 style PSModulePath",
    () => {
      const host = mkdtempSync(join(tmpdir(), `diet-manager-acl-host-${randomUUID()}-`));
      roots.add(host);
      const root = mkdtempSync(join(tmpdir(), `diet-manager-acl-psmp-${randomUUID()}-`));
      roots.add(root);

      const original = process.env.PSModulePath;
      process.env.PSModulePath = [publishCoreOnlySecurityModule(host), original ?? ""]
        .filter((entry) => entry.length > 0)
        .join(";");

      const runtime = createCoreRuntime({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      try {
        const outcome = handleCoreRequest(runtime, request());
        expect(outcome).not.toHaveProperty("error_code");
        expect(outcome).toMatchObject({ action: "record_meal", committed: true });
      } finally {
        runtime.close();
        if (original === undefined) delete process.env.PSModulePath;
        else process.env.PSModulePath = original;
      }
    },
  );
});
