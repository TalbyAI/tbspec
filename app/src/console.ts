import { createInterface } from "node:readline";
import { exits, failure, ok, type Result } from "./output.ts";
import { readRuntime, runtimeError } from "./runtime.ts";
import { webProject } from "./web.ts";

export async function attachConsole(root: string): Promise<Result> {
  const controller = new AbortController();
  let outcome: Result = ok({ detached: true });
  let stopWork: Promise<void> | undefined;
  const stop = () => {
    stopWork ??= webProject({ project: root, action: "stop" }).then((result) => {
      outcome = result;
      controller.abort();
    });
  };
  const disconnect = () => controller.abort();
  const lines = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  if (lines) {
    lines.on("line", (line) => {
      if (line.trim() === "detach") controller.abort();
    });
    lines.on("SIGINT", stop);
    lines.on("close", disconnect);
  } else {
    process.stdin.on("end", disconnect);
    process.stdin.on("error", disconnect);
    process.stdin.resume();
  }
  process.on("SIGINT", stop);
  try {
    const record = await readRuntime(root);
    if (!record?.baseUrl)
      throw runtimeError(
        "unavailable",
        "RUNTIME_UNAVAILABLE",
        "Runtime disappeared before console attachment.",
      );
    const identity = await webProject({ project: root, action: "status" });
    if (identity.status !== "ok") return identity;
    const response = await fetch(new URL("api/control/v1/console", record.baseUrl), {
      headers: { Authorization: `Bearer ${record.controlToken}` },
      signal: controller.signal,
    });
    if (!response.ok || !response.body)
      throw runtimeError(
        "unavailable",
        "RUNTIME_AUTH_FAILED",
        "Console authorization or transport failed; server remains independent.",
      );
    if (lines)
      process.stdout.write(
        "Console attached. Type detach to leave the server running; Ctrl+C stops it.\n",
      );
    let pending = "";
    const decoder = new TextDecoder();
    for await (const bytes of response.body) {
      pending += decoder.decode(bytes, { stream: true });
      if (pending.length > 65536)
        throw runtimeError(
          "unavailable",
          "RUNTIME_UNAVAILABLE",
          "Console frame exceeds the limit.",
        );
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const frame = JSON.parse(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (frame.protocolVersion !== 1 || frame.instanceId !== record.instanceId)
          throw runtimeError(
            "conflict",
            "RUNTIME_PROTOCOL_UNSUPPORTED",
            "Console identity or protocol changed.",
          );
        if (frame.type === "log") process.stdout.write(`${String(frame.data.message)}\n`);
        else if (frame.type === "state")
          process.stdout.write(`Server ${String(frame.data.state)}.\n`);
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) outcome = failure(error);
  } finally {
    process.off("SIGINT", stop);
    lines?.close();
    process.stdin.off("end", disconnect);
    process.stdin.off("error", disconnect);
    process.stdin.pause();
    await stopWork;
  }
  process.exitCode = exits[outcome.status];
  return outcome;
}
