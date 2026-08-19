import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// DEC-030 C-5：SKILL.md 同步 set_profile / set_goal 动作与两行进度条回执格式。
// 权威渲染规则见 DEC-030 brief §5（§17.5 固定顺序 + §17.6 进度条）。
const testsDirectory = dirname(fileURLToPath(import.meta.url));
const skillPath = resolve(testsDirectory, "..", "skills", "diet-manager-b", "SKILL.md");
const skill = readFileSync(skillPath, "utf8");

describe("DEC-030 C-5 SKILL.md goal/progress sync", () => {
  it("lists set_profile and set_goal in the action selection table", () => {
    expect(skill).toContain("`set_profile`");
    expect(skill).toContain("`set_goal`");
    expect(skill).toMatch(/设置或更新个人档案[^\n]*`set_profile`/u);
    expect(skill).toMatch(/设置或更新六项目标[^\n]*`set_goal`/u);
  });

  it("teaches the two-line progress bar format in the fixed six-field order", () => {
    expect(skill).toContain("🔥热量 🥩蛋白质 🧈脂肪 🍚碳水 🥦膳食纤维 💧饮水");
    expect(skill).toContain("Emoji 名称 ██████████ 103%");
    expect(skill).toContain("Emoji 当前量/目标 单位");
    expect(skill).toContain("`configured_goals`");
    expect(skill).toContain("`progress`");
  });

  it("marks unconfigured dimensions and the reference-goal health boundary", () => {
    expect(skill).toContain("尚未配置目标");
    expect(skill).toContain("参考目标（公式估算，可覆盖）");
    expect(skill).toContain("不构成医疗建议");
  });
});
