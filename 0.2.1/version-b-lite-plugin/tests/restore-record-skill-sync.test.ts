import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// DEC-031 R-4：SKILL.md 同步 restore_record 动作与撤销后恢复回执。
const testsDirectory = dirname(fileURLToPath(import.meta.url));
const skillPath = resolve(testsDirectory, "..", "skills", "diet-manager-b", "SKILL.md");
const skill = readFileSync(skillPath, "utf8");

describe("DEC-031 R-4 SKILL.md restore_record sync", () => {
  it("lists restore_record in the action selection table", () => {
    expect(skill).toContain("`restore_record`");
    expect(skill).toMatch(/撤销后恢复[^\n]*`restore_record`/u);
  });

  it("teaches the restore receipt next to undo", () => {
    expect(skill).toContain("`restore_record` 告知“已恢复”");
    expect(skill).toContain("`undo_record` 告知“已撤销”");
  });
});
