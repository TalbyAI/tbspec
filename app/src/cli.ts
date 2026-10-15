#!/usr/bin/env node
import { type CliInvocation, parseCli } from "./cli-command.ts";
import { exits, failure, type Result } from "./output.ts";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
let invocation: CliInvocation | undefined;
let result: Result;
try {
  invocation = parseCli(argv);
  result = await invocation.execute();
} catch (error) {
  result = failure(error);
}
for (const diagnostic of result.diagnostics)
  process.stderr.write(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}\n`);
if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
else {
  const text =
    result.data && "text" in result.data
      ? String(result.data.text)
      : result.data && "applicationVersion" in result.data
        ? String(result.data.applicationVersion)
        : invocation?.initialized && result.status === "ok"
          ? "Project initialized with offline locked defaults."
          : result.data
            ? JSON.stringify(result.data, null, 2)
            : "";
  if (text) process.stdout.write(`${text}\n`);
  if (result.data && "topics" in result.data && Array.isArray(result.data.topics))
    for (const topic of result.data.topics)
      process.stdout.write(`${topic.invocation} — ${topic.description}\n`);
}
process.exitCode = exits[result.status];
if (result.status === "ok" && invocation?.foreground && result.data && "server" in result.data) {
  const { attachConsole } = await import("./console.ts");
  const server = result.data.server as { projectRoot: string };
  const attached = await attachConsole(server.projectRoot);
  for (const diagnostic of attached.diagnostics)
    process.stderr.write(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}\n`);
  process.exitCode = exits[attached.status];
}
