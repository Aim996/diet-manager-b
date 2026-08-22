import { expect, it } from "vitest";

import {
  applyPassphraseKey,
  readPassphraseFromTty,
} from "../src/admin/passphrase.js";

it("refuses to read a passphrase when stdio is not a terminal", async () => {
  // vitest runs with non-TTY stdio, so the terminal-only reader must fail closed.
  await expect(readPassphraseFromTty({ confirm: true })).rejects.toThrow("DIET_ADMIN_TTY_REQUIRED");
  await expect(readPassphraseFromTty({ confirm: false })).rejects.toThrow("DIET_ADMIN_TTY_REQUIRED");
});

it("appends printable keys and advances the accumulated passphrase", () => {
  expect(applyPassphraseKey("", "h")).toEqual({ type: "append", next: "h" });
  expect(applyPassphraseKey("h", "i")).toEqual({ type: "append", next: "hi" });
  expect(applyPassphraseKey("a", "😀")).toEqual({ type: "append", next: "a😀" });
});

it("backspace removes exactly one code point", () => {
  expect(applyPassphraseKey("hi", "\x7f")).toEqual({ type: "backspace", next: "h" });
  expect(applyPassphraseKey("a😀", "\x08")).toEqual({ type: "backspace", next: "a" });
  expect(applyPassphraseKey("", "\x7f")).toEqual({ type: "backspace", next: "" });
});

it("enter, interrupt and control keys are recognized distinctly", () => {
  expect(applyPassphraseKey("abc", "\r")).toEqual({ type: "enter" });
  expect(applyPassphraseKey("abc", "\n")).toEqual({ type: "enter" });
  expect(applyPassphraseKey("abc", "\x03")).toEqual({ type: "interrupt" });
  expect(applyPassphraseKey("abc", "\x01")).toEqual({ type: "control" });
  expect(applyPassphraseKey("abc", "\t")).toEqual({ type: "control" });
});
