#!/usr/bin/env node
import { resolve } from "node:path";
import { attachConsole } from "./console.ts";
import { guidance, help } from "./guidance.ts";
import { type InspectionCommand, inspectProject } from "./inspection.ts";
import { exits, failure, ok, ProjectError, type Result } from "./output.ts";
import { initializeProject } from "./project.ts";
import { applicationVersion } from "./runtime.ts";
import { webProject } from "./web.ts";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
let foreground = false;
let initialized = false;
async function dispatch(): Promise<Result> {
  const positional: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    if (
      ![
        "--json",
        "--help",
        "--version",
        "--project",
        "--base-iri",
        "--port",
        "--background",
      ].includes(argument)
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        `Unknown option: ${argument}. Use tbspec --help.`,
      );
    if (options.has(argument))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        `Repeated option: ${argument}.`,
      );
    if (["--project", "--base-iri", "--port"].includes(argument)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--"))
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          `${argument} requires a value.`,
        );
      options.set(argument, value);
    } else options.set(argument, true);
  }
  const command = positional.shift() ?? "";
  if (command && !["init", "llms", "status", "graph", "config", "web"].includes(command))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      `Unknown command: ${command}. Use tbspec --help.`,
    );
  if (options.has("--base-iri") && command !== "init")
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--base-iri is valid only with init.",
    );
  if (
    (options.has("--port") || options.has("--background")) &&
    (command !== "web" || positional.length)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--port and --background apply only to web start/reconnect.",
    );
  if (command === "init" && positional.length > 1)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "init accepts at most one directory.",
    );
  if (options.has("--version")) {
    if (command || positional.length || options.has("--base-iri") || options.has("--help"))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--version is a root invocation.",
      );
    return ok({ applicationVersion });
  }
  if (options.has("--help") || !command) return ok(help(command));
  if (command === "llms") {
    const result = guidance(positional);
    return result.found
      ? ok(result.data)
      : {
          schemaVersion: 1,
          status: "invalid_arguments",
          data: result.data,
          diagnostics: [
            {
              code: "ARGUMENT_INVALID",
              severity: "error",
              message: "Unknown guidance topic. Use the nearest valid index.",
              file: null,
            },
          ],
        };
  }
  const project = options.get("--project");
  const selectedProject = typeof project === "string" ? project : undefined;
  if (command === "web") {
    const action = positional[0] ?? "start";
    if (
      positional.length > 1 ||
      !["start", "status", "stop"].includes(action) ||
      positional[0] === "start"
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Use web, web status or web stop.",
      );
    const rawPort = options.get("--port");
    const port = typeof rawPort === "string" ? Number(rawPort) : undefined;
    if (
      port !== undefined &&
      (typeof rawPort !== "string" ||
        !/^[1-9][0-9]*$/.test(rawPort) ||
        !Number.isInteger(port) ||
        port > 65535)
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--port requires an integer from 1 to 65535.",
      );
    foreground = action === "start" && !json && !options.has("--background");
    return webProject({
      project: selectedProject,
      action: action as "start" | "status" | "stop",
      port,
    });
  }
  if (["status", "graph", "config"].includes(command)) {
    let operation: InspectionCommand;
    let selector: string | undefined;
    if (command === "status" && !positional.length) operation = "status";
    else if (command === "graph" && positional[0] === "list" && positional.length === 1)
      operation = "graph.list";
    else if (command === "graph" && positional[0] === "show" && positional.length === 2) {
      operation = "graph.show";
      selector = positional[1];
    } else if (command === "config" && positional.join(" ") === "show") operation = "config.show";
    else if (command === "config" && positional.join(" ") === "model-type list")
      operation = "config.model-type.list";
    else
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Invalid inspection signature. Use command --help.",
      );
    return inspectProject({ project: selectedProject, command: operation, selector });
  }
  const base = options.get("--base-iri");
  if (project && positional.length)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "init accepts a directory or --project, not both.",
    );
  initialized = true;
  return initializeProject({
    directory: positional[0] ?? (typeof project === "string" ? resolve(project) : undefined),
    baseIri: typeof base === "string" ? base : undefined,
  });
}
let result: Result;
try {
  result = await dispatch();
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
        : initialized && result.status === "ok"
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
if (result.status === "ok" && foreground && result.data && "server" in result.data) {
  const server = result.data.server as { projectRoot: string };
  const attached = await attachConsole(server.projectRoot);
  for (const diagnostic of attached.diagnostics)
    process.stderr.write(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}\n`);
  process.exitCode = exits[attached.status];
}
