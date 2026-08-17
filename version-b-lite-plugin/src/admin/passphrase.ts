import { stderr, stdin } from "node:process";

// 单个按键的纯处理结果，便于在不依赖真实 TTY 的单元测试里覆盖回退、控制字符拒绝等行为。
export type PassphraseKeyResult =
  | { readonly type: "append"; readonly next: string }
  | { readonly type: "backspace"; readonly next: string }
  | { readonly type: "enter" }
  | { readonly type: "interrupt" }
  | { readonly type: "control" };

export function applyPassphraseKey(current: string, key: string): PassphraseKeyResult {
  const code = key.codePointAt(0);
  if (code === undefined) return { type: "control" };
  if (code === 0x0d || code === 0x0a) return { type: "enter" };
  if (code === 0x7f || code === 0x08) {
    const points = Array.from(current);
    points.pop();
    return { type: "backspace", next: points.join("") };
  }
  if (code === 0x03) return { type: "interrupt" };
  if (code < 0x20) return { type: "control" };
  return { type: "append", next: current + key };
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

// 口令只允许从真实交互终端逐键读取：stdin 与 stderr 都必须挂在 TTY 上。重定向/管道输入
// 一律以 DIET_ADMIN_TTY_REQUIRED 拒绝，确保口令不会经 argv、环境变量、文件或管道进入进程。
export async function readPassphraseFromTty(options: {
  readonly confirm: boolean;
}): Promise<Uint8Array> {
  if (!stdin.isTTY || !stderr.isTTY) throw new Error("DIET_ADMIN_TTY_REQUIRED");
  return await new Promise<Uint8Array>((resolve, reject) => {
    let first: Uint8Array | undefined;
    let current = "";
    let settled = false;

    const cleanup = (): void => {
      stdin.removeListener("data", onData);
      stdin.pause();
      try {
        stdin.setRawMode(false);
      } catch {
        // 终端状态恢复失败时静默；主流程错误优先保留。
      }
      current = "";
      if (first !== undefined) {
        first.fill(0);
        first = undefined;
      }
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (value: Uint8Array): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const key of text) {
        const result = applyPassphraseKey(current, key);
        if (result.type === "append") {
          current = result.next;
          continue;
        }
        if (result.type === "backspace") {
          current = result.next;
          continue;
        }
        if (result.type === "interrupt") {
          stderr.write("\n");
          fail(new Error("DIET_ADMIN_INTERRUPTED"));
          return;
        }
        if (result.type === "control") {
          fail(new Error("DIET_ADMIN_PASSPHRASE_CONTROL"));
          return;
        }
        // enter
        stderr.write("\n");
        const candidate = bytesOf(current);
        if (options.confirm) {
          if (first === undefined) {
            first = candidate;
            current = "";
            stderr.write("Confirm passphrase: ");
            continue;
          }
          if (!equalBytes(first, candidate)) {
            fail(new Error("DIET_ADMIN_PASSPHRASE_MISMATCH"));
            return;
          }
          succeed(candidate);
          return;
        }
        succeed(candidate);
        return;
      }
    };

    try {
      stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      stdin.resume();
      stdin.on("data", onData);
      stderr.write("Enter passphrase: ");
    } catch (error) {
      fail(error instanceof Error ? error : new Error("DIET_ADMIN_TTY_REQUIRED"));
    }
  });
}
