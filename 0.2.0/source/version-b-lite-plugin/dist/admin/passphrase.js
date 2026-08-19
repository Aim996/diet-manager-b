import { stderr, stdin } from "node:process";
export function applyPassphraseKey(current, key) {
    const code = key.codePointAt(0);
    if (code === undefined)
        return { type: "control" };
    if (code === 0x0d || code === 0x0a)
        return { type: "enter" };
    if (code === 0x7f || code === 0x08) {
        const points = Array.from(current);
        points.pop();
        return { type: "backspace", next: points.join("") };
    }
    if (code === 0x03)
        return { type: "interrupt" };
    if (code < 0x20)
        return { type: "control" };
    return { type: "append", next: current + key };
}
function bytesOf(text) {
    return new TextEncoder().encode(text);
}
function equalBytes(a, b) {
    if (a.length !== b.length)
        return false;
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index])
            return false;
    }
    return true;
}
// 口令只允许从真实交互终端逐键读取：stdin 与 stderr 都必须挂在 TTY 上。重定向/管道输入
// 一律以 DIET_ADMIN_TTY_REQUIRED 拒绝，确保口令不会经 argv、环境变量、文件或管道进入进程。
export async function readPassphraseFromTty(options) {
    if (!stdin.isTTY || !stderr.isTTY)
        throw new Error("DIET_ADMIN_TTY_REQUIRED");
    return await new Promise((resolve, reject) => {
        let first;
        let current = "";
        let settled = false;
        const cleanup = () => {
            stdin.removeListener("data", onData);
            stdin.pause();
            try {
                stdin.setRawMode(false);
            }
            catch {
                // 终端状态恢复失败时静默；主流程错误优先保留。
            }
            current = "";
            if (first !== undefined) {
                first.fill(0);
                first = undefined;
            }
        };
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        };
        const succeed = (value) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve(value);
        };
        const onData = (chunk) => {
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
        }
        catch (error) {
            fail(error instanceof Error ? error : new Error("DIET_ADMIN_TTY_REQUIRED"));
        }
    });
}
