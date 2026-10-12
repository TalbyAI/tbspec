#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type AuthoringOptions, authorResource } from "./authoring.ts";
import { configureModelType } from "./configuration.ts";
import { attachConsole } from "./console.ts";
import {
  dependencyAdd,
  dependencyCheck,
  dependencyClear,
  dependencyInspect,
  dependencyList,
  dependencySelect,
  dependencyShow,
  dependencySupportClear,
  dependencySupportSet,
  dependencyUpdate,
} from "./dependencies.ts";
import { listDesigns, showDesign } from "./designs.ts";
import { guidance, help } from "./guidance.ts";
import { type InspectionCommand, inspectProject } from "./inspection.ts";
import { exits, failure, ok, ProjectError, type Result } from "./output.ts";
import { initializeProject } from "./project.ts";
import { listQueries, queryRemove, queryRun, querySave, showQuery } from "./query.ts";
import { inspectImpact, moveResource, removeResource } from "./resource-lifecycle.ts";
import { applicationVersion } from "./runtime.ts";
import { listViews, showView, viewOperation } from "./views.ts";
import { webProject } from "./web.ts";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
let foreground = false;
let initialized = false;
async function dispatch(): Promise<Result> {
  const positional: string[] = [];
  const options = new Map<string, string | true>();
  const schemas: string[] = [];
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
        "--iri",
        "--type",
        "--profile",
        "--schema",
        "--accepted-preview",
        "--confirm",
        "--apply",
        "--source",
        "--ref",
        "--resource",
        "--kind",
        "--file",
        "--parameters",
        "--saved",
        "--graph",
        "--bindings",
        "--ontology",
        "--protocol",
        "--accept-impact",
        "--target",
        "--role",
      ].includes(argument)
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        `Unknown option: ${argument}. Use tbspec --help.`,
      );
    if (options.has(argument) && argument !== "--schema")
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        `Repeated option: ${argument}.`,
      );
    if (
      [
        "--project",
        "--base-iri",
        "--port",
        "--iri",
        "--type",
        "--profile",
        "--schema",
        "--accepted-preview",
        "--source",
        "--ref",
        "--resource",
        "--kind",
        "--file",
        "--parameters",
        "--saved",
        "--graph",
        "--bindings",
        "--ontology",
        "--target",
        "--role",
        "--protocol",
      ].includes(argument)
    ) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--"))
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          `${argument} requires a value.`,
        );
      options.set(argument, value);
      if (argument === "--schema") schemas.push(value);
    } else options.set(argument, true);
  }
  const command = positional.shift() ?? "";
  if (
    command &&
    ![
      "init",
      "llms",
      "status",
      "validate",
      "shapes",
      "graph",
      "config",
      "web",
      "ontology",
      "model",
      "query",
      "dependency",
      "impact",
      "resource",
      "view",
      "design",
    ].includes(command)
  )
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
    ["--iri", "--type", "--profile", "--schema"].some((flag) => options.has(flag)) &&
    !["ontology", "model", "design"].includes(command)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--iri applies only to ontology, model, or design authoring; model options apply only to models.",
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
  const value = (flag: string) =>
    typeof options.get(flag) === "string" ? (options.get(flag) as string) : undefined;
  if (command === "dependency") {
    const action = positional[0];
    if (options.has("--accept-impact") && action !== "update")
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Only dependency update accepts --accept-impact.",
      );
    if ((options.has("--apply") && action !== "update") || options.has("--confirm"))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--apply applies only to dependency update; --confirm does not apply to dependencies.",
      );
    const mutationOptions = [
      "--source",
      "--ref",
      "--resource",
      "--kind",
      "--accepted-preview",
      "--apply",
      "--accept-impact",
      "--target",
      "--role",
    ];
    if (
      action === "list" &&
      positional.length === 1 &&
      !mutationOptions.some((flag) => options.has(flag))
    )
      return dependencyList({ project: selectedProject });
    if (
      action === "show" &&
      positional.length === 2 &&
      !mutationOptions.some((flag) => options.has(flag))
    )
      return dependencyShow({ project: selectedProject, id: positional[1] ?? "" });
    if (
      action === "check" &&
      positional.length <= 2 &&
      !mutationOptions.some((flag) => options.has(flag))
    )
      return dependencyCheck({
        project: selectedProject,
        ...(positional[1] ? { id: positional[1] } : {}),
      });
    if (
      action === "select" &&
      positional.length === 3 &&
      !mutationOptions.some((flag) => options.has(flag))
    )
      return dependencySelect({
        project: selectedProject,
        ontologyIri: positional[1] ?? "",
        id: positional[2] ?? "",
      });
    if (
      action === "clear" &&
      positional.length === 2 &&
      !mutationOptions.some((flag) => options.has(flag))
    )
      return dependencyClear({ project: selectedProject, ontologyIri: positional[1] ?? "" });
    if (
      action === "update" &&
      positional.length === 2 &&
      !["--source", "--ref", "--resource", "--kind", "--target", "--role"].some((flag) =>
        options.has(flag),
      )
    )
      return dependencyUpdate({
        project: selectedProject,
        id: positional[1] ?? "",
        apply: options.has("--apply"),
        acceptImpact: options.has("--accept-impact"),
        ...(value("--accepted-preview") ? { acceptedPreview: value("--accepted-preview") } : {}),
      });
    if (
      action === "support" &&
      positional[1] === "set" &&
      positional.length === 3 &&
      value("--target") &&
      value("--role") &&
      value("--source") &&
      value("--resource") &&
      !["--kind", "--apply", "--confirm", "--accept-impact"].some((flag) => options.has(flag)) &&
      ["shacl", "design"].includes(value("--role") ?? "")
    )
      return dependencySupportSet({
        project: selectedProject,
        id: positional[2] ?? "",
        target: value("--target") as string,
        role: value("--role") as "shacl" | "design",
        source: value("--source") as string,
        resource: value("--resource") as string,
        ...(value("--ref") ? { ref: value("--ref") } : {}),
        ...(value("--accepted-preview") ? { acceptedPreview: value("--accepted-preview") } : {}),
      });
    if (
      action === "support" &&
      positional[1] === "clear" &&
      positional.length === 3 &&
      value("--target") &&
      value("--role") &&
      value("--resource") &&
      ["shacl", "design"].includes(value("--role") ?? "") &&
      !options.has("--source") &&
      !options.has("--ref") &&
      !["--kind", "--apply", "--confirm", "--accept-impact"].some((flag) => options.has(flag))
    )
      return dependencySupportClear({
        project: selectedProject,
        id: positional[2] ?? "",
        target: value("--target") as string,
        role: value("--role") as "shacl" | "design",
        resource: value("--resource") as string,
        ...(value("--accepted-preview") ? { acceptedPreview: value("--accepted-preview") } : {}),
      });
    if (action === "inspect" && positional.length === 1 && value("--source"))
      return dependencyInspect({
        project: selectedProject,
        source: value("--source") as string,
        ...(value("--ref") ? { ref: value("--ref") } : {}),
        ...(value("--resource") ? { resource: value("--resource") } : {}),
      });
    if (
      action === "add" &&
      positional.length === 2 &&
      value("--source") &&
      value("--kind") &&
      ["ontology", "model", "design"].includes(value("--kind") ?? "")
    )
      return dependencyAdd({
        project: selectedProject,
        source: value("--source") as string,
        id: positional[1] ?? "",
        kind: value("--kind") as "ontology" | "model" | "design",
        ...(value("--ref") ? { ref: value("--ref") } : {}),
        ...(value("--resource") ? { resource: value("--resource") } : {}),
        ...(value("--accepted-preview") ? { acceptedPreview: value("--accepted-preview") } : {}),
      });
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Use dependency inspect --source <directory|git|http-url> [--ref <revision>] [--resource <selector>]; dependency add <id> --source <source> --kind ontology|model|design [--ref <revision>] [--resource <selector>] --accepted-preview <fingerprint>; dependency update <id> [--apply --accepted-preview <fingerprint> --accept-impact]; dependency support set <id> --target <dep:id/file> --role shacl|design --source <source> --resource <exact-file> --accepted-preview <fingerprint>; dependency support clear <id> --target <dep:id/file> --role shacl|design --resource <dep:id/support-file>; dependency list; dependency show <id>; dependency check [<id>]; dependency select <ontology-iri> <id>; or dependency clear <ontology-iri>.",
    );
  }
  if (command === "view") {
    const action = positional[0];
    if (
      action === "list" &&
      positional.length === 1 &&
      !options.has("--protocol") &&
      !options.has("--confirm") &&
      !options.has("--accepted-preview")
    )
      return listViews({
        project: selectedProject,
        ...(value("--source") ? { source: value("--source") } : {}),
      });
    if (
      action === "show" &&
      positional.length === 2 &&
      !options.has("--source") &&
      !options.has("--protocol") &&
      !options.has("--confirm") &&
      !options.has("--accepted-preview")
    )
      return showView({ project: selectedProject, selector: positional[1] ?? "" });
    if (
      action === "create" &&
      positional.length === 2 &&
      value("--source") &&
      !options.has("--confirm")
    )
      return viewOperation({
        project: selectedProject,
        action: "create",
        path: positional[1] ?? "",
        source: value("--source"),
        ...(value("--protocol") ? { protocol: value("--protocol") } : {}),
        ...(value("--accepted-preview") ? { acceptedPreview: value("--accepted-preview") } : {}),
      });
    if (
      action === "remove" &&
      positional.length === 2 &&
      !options.has("--source") &&
      !options.has("--protocol")
    )
      return viewOperation({
        project: selectedProject,
        action: "remove",
        selector: positional[1] ?? "",
        confirm: options.has("--confirm"),
        ...(value("--accepted-preview") ? { acceptedPreview: value("--accepted-preview") } : {}),
      });
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Use view list [--source <selector>]; view show <view-selector>; view create <path> --source <selector> [--protocol <selector>]; or view remove <view-selector> [--confirm --accepted-preview <digest>].",
    );
  }
  if (command === "design") {
    const action = positional[0];
    const allowedOptions =
      action === "create" || action === "import"
        ? ["--iri", "--accepted-preview"]
        : action === "remove"
          ? ["--confirm", "--accepted-preview"]
          : action === "select" || action === "clear"
            ? ["--accepted-preview"]
            : [];
    const unsupported = [...options.keys()].filter(
      (flag) => !["--project", "--json", "--help", ...allowedOptions].includes(flag),
    );
    if (unsupported.length)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        `Option ${unsupported[0]} does not apply to design ${action ?? "commands"}.`,
      );
    if (action === "list" && positional.length === 1 && !options.has("--iri"))
      return listDesigns({ project: selectedProject });
    if (action === "show" && positional.length === 2 && !options.has("--iri"))
      return showDesign({ project: selectedProject, selector: positional[1] ?? "" });
    if (action === "remove" && positional.length === 2)
      return removeResource({
        project: selectedProject,
        kind: "design",
        selector: positional[1] ?? "",
        confirm: options.has("--confirm"),
        acceptedPreview: value("--accepted-preview"),
      });
    if (action === "select" && positional.length === 3)
      return authorResource({
        project: selectedProject,
        command: "design.select",
        path: positional[1] ?? "",
        source: positional[2],
        acceptedPreview: value("--accepted-preview"),
      });
    if (action === "clear" && positional.length === 2)
      return authorResource({
        project: selectedProject,
        command: "design.clear",
        path: positional[1] ?? "",
        acceptedPreview: value("--accepted-preview"),
      });
    if (
      (action === "create" && positional.length === 2) ||
      (action === "import" && positional.length === 3)
    )
      return authorResource({
        project: selectedProject,
        command: `design.${action}` as "design.create" | "design.import",
        path: positional[action === "import" ? 2 : 1] ?? "",
        ...(action === "import" ? { source: positional[1] } : {}),
        iri: value("--iri"),
        acceptedPreview: value("--accepted-preview"),
      });
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Use design list; design show <selector>; design create <path> [--iri <iri>]; design import <source-selector> <path> [--iri <new-iri>]; design remove <owned-path> [--confirm]; design select <concept-iri> <selector>; or design clear <concept-iri>.",
    );
  }
  const schemaOperation = command === "model" && positional[0] === "schema";
  if (
    schemaOperation &&
    ["--iri", "--type", "--profile", "--schema"].some((flag) => options.has(flag))
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Schema operations do not accept creation/import options.",
    );
  if (
    options.has("--accepted-preview") &&
    !(
      (command === "shapes" && positional[0] === "create") ||
      (command === "design" &&
        ["create", "import", "remove", "select", "clear"].includes(positional[0] ?? "")) ||
      ((command === "ontology" || command === "model") &&
        ["create", "import"].includes(positional[0] ?? "")) ||
      (schemaOperation && ["add", "remove"].includes(positional[1] ?? "")) ||
      (command === "dependency" && ["add", "update"].includes(positional[0] ?? "")) ||
      (command === "dependency" &&
        positional[0] === "support" &&
        ["set", "clear"].includes(positional[1] ?? "")) ||
      ((command === "ontology" || command === "model" || command === "shapes") &&
        positional[0] === "remove") ||
      (command === "resource" && positional[0] === "move") ||
      (command === "config" &&
        positional[0] === "model-type" &&
        ["set", "disable", "enable", "reset", "design", "remove"].includes(positional[1] ?? ""))
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--accepted-preview requires a resource mutation.",
    );
  if (
    options.has("--confirm") &&
    !(
      (command === "model" && positional[0] === "schema" && positional[1] === "remove") ||
      ((command === "ontology" || command === "model" || command === "shapes") &&
        positional[0] === "remove") ||
      (command === "design" && positional[0] === "remove") ||
      (command === "view" && positional[0] === "remove") ||
      (command === "config" && positional[0] === "model-type" && positional[1] === "remove") ||
      (command === "query" && positional[0] === "remove")
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--confirm applies only to confirmed removal operations.",
    );
  if (
    options.has("--source") &&
    !(command === "shapes" && positional[0] === "list") &&
    !(command === "view" && ["list", "create"].includes(positional[0] ?? "")) &&
    !(command === "dependency" && ["inspect", "add"].includes(positional[0] ?? "")) &&
    !(command === "dependency" && positional[0] === "support" && positional[1] === "set")
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--source applies only to shapes list, view list/create, dependency inspect/add, or support set.",
    );
  if (
    options.has("--apply") &&
    !(command === "resource" && positional[0] === "move") &&
    !(command === "dependency" && positional[0] === "update")
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--apply applies only to resource move or dependency update.",
    );
  if (
    options.has("--ref") &&
    !(command === "dependency" && ["inspect", "add"].includes(positional[0] ?? "")) &&
    !(command === "dependency" && positional[0] === "support" && positional[1] === "set")
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--ref applies only to dependency inspect/add or support set.",
    );
  if (
    options.has("--resource") &&
    !(command === "dependency" && ["inspect", "add"].includes(positional[0] ?? "")) &&
    !(
      command === "dependency" &&
      positional[0] === "support" &&
      ["set", "clear"].includes(positional[1] ?? "")
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--resource applies only to dependency inspect/add or support set/clear.",
    );
  if (options.has("--kind") && !(command === "dependency" && positional[0] === "add"))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--kind applies only to dependency add.",
    );
  if (
    options.has("--target") &&
    !(
      command === "dependency" &&
      positional[0] === "support" &&
      ["set", "clear"].includes(positional[1] ?? "")
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--target applies only to dependency support set/clear.",
    );
  if (
    options.has("--role") &&
    !(
      command === "dependency" &&
      positional[0] === "support" &&
      ["set", "clear"].includes(positional[1] ?? "")
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--role applies only to dependency support set/clear.",
    );
  if (options.has("--protocol") && !(command === "view" && positional[0] === "create"))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--protocol applies only to view create.",
    );
  const queryAction = command === "query" ? positional[0] : undefined;
  const queryOptions = ["--file", "--parameters", "--saved", "--graph", "--bindings"];
  if (
    queryOptions.some((flag) => options.has(flag)) &&
    (command !== "query" || options.has("--help"))
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Query options apply only to query commands.",
    );
  if (
    (options.has("--parameters") && queryAction !== "save") ||
    (options.has("--saved") && queryAction !== "run") ||
    (options.has("--graph") && queryAction !== "run") ||
    (options.has("--bindings") && queryAction !== "run") ||
    (options.has("--file") && !["save", "run"].includes(queryAction ?? ""))
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Query option is not valid for this action.",
    );
  if (
    options.has("--ontology") &&
    !(command === "config" && positional[0] === "model-type" && positional[1] === "set")
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--ontology applies only to config model-type set.",
    );
  if (
    options.has("--accept-impact") &&
    !(
      command === "config" &&
      positional[0] === "model-type" &&
      ["set", "reset"].includes(positional[1] ?? "")
    ) &&
    !(command === "dependency" && positional[0] === "update")
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--accept-impact applies only to config model-type set/reset or dependency update.",
    );
  if (command === "query") {
    const action = positional[0];
    const queryFile = value("--file");
    const parameterFile = value("--parameters");
    const saved = value("--saved");
    const bindingsFile = value("--bindings");
    const readText = async (path: string) =>
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(path));
    if (
      action === "list" &&
      positional.length === 1 &&
      !queryOptions.some((flag) => options.has(flag))
    )
      return listQueries({ project: selectedProject });
    if (
      action === "show" &&
      positional.length === 2 &&
      !queryOptions.some((flag) => options.has(flag))
    )
      return showQuery({ project: selectedProject, name: positional[1] ?? "" });
    if (action === "save" && positional.length === 2 && queryFile)
      return querySave({
        project: selectedProject,
        name: positional[1] ?? "",
        queryText: await readText(queryFile),
        ...(parameterFile ? { parametersText: await readText(parameterFile) } : {}),
      });
    if (
      action === "run" &&
      positional.length === 1 &&
      (queryFile !== undefined) !== (saved !== undefined)
    )
      return queryRun({
        project: selectedProject,
        ...(queryFile ? { queryText: await readText(queryFile) } : { saved }),
        ...(value("--graph") ? { graph: value("--graph") } : {}),
        ...(bindingsFile ? { bindingsText: await readText(bindingsFile) } : {}),
      });
    if (
      action === "remove" &&
      positional.length === 2 &&
      !["--file", "--parameters", "--saved", "--graph", "--bindings"].some((flag) =>
        options.has(flag),
      )
    )
      return queryRemove({
        project: selectedProject,
        name: positional[1] ?? "",
        confirm: options.has("--confirm"),
      });
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Use query list; query show <name>; query save <name> --file <path> [--parameters <path.toml>]; query run (--file <path.rq> | --saved <name>) [--graph <selector>] [--bindings <path.json>]; or query remove <name> [--confirm].",
    );
  }
  if (command === "validate") {
    if (positional.length > 1)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "validate accepts at most one graph selector.",
      );
    return inspectProject({
      project: selectedProject,
      command: "validate",
      selector: positional[0],
    });
  }
  if (command === "impact") {
    const kind = positional[0];
    if (
      positional.length !== 2 ||
      !["ontology", "model", "design", "shapes", "model-type"].includes(kind ?? "")
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Use impact <ontology|model|design|shapes|model-type> <exact-selector-or-name>.",
      );
    return inspectImpact({
      project: selectedProject,
      kind: kind as "ontology" | "model" | "shapes" | "model-type",
      selector: positional[1] ?? "",
    });
  }
  if (command === "resource") {
    if (positional[0] === "move" && positional.length === 3)
      return moveResource({
        project: selectedProject,
        selector: positional[1] ?? "",
        destination: positional[2] ?? "",
        apply: options.has("--apply"),
        acceptedPreview: value("--accepted-preview"),
      });
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Use resource move <owned-selector> <destination> [--apply --accepted-preview <digest>].",
    );
  }
  if (command === "shapes") {
    if (positional[0] === "list" && positional.length === 1)
      return inspectProject({
        project: selectedProject,
        command: "shapes.list",
        selector: value("--source"),
      });
    if (positional[0] === "create" && positional.length === 2)
      return authorResource({
        project: selectedProject,
        command: "shapes.create",
        path: positional[1] ?? "",
        acceptedPreview: value("--accepted-preview"),
      });
    if (positional[0] === "remove" && positional.length === 2)
      return removeResource({
        project: selectedProject,
        kind: "shapes",
        selector: positional[1] ?? "",
        confirm: options.has("--confirm"),
        acceptedPreview: value("--accepted-preview"),
      });
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Use shapes list [--source <path>] or shapes create <source-path>.",
    );
  }
  if (command === "config") {
    if (positional[0] !== "model-type") {
      if (positional.join(" ") === "show" && positional.length === 1)
        return inspectProject({ project: selectedProject, command: "config.show" });
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Use config show or config model-type --help.",
      );
    }
    const action = positional[1];
    if (action === "remove" && positional.length === 3)
      return removeResource({
        project: selectedProject,
        kind: "model-type",
        selector: positional[2] ?? "",
        confirm: options.has("--confirm"),
        acceptedPreview: value("--accepted-preview"),
      });
    if (action === "list" && positional.length === 2)
      return inspectProject({ project: selectedProject, command: "config.model-type.list" });
    if (action === "show" && positional.length === 3) {
      const result = await inspectProject({
        project: selectedProject,
        command: "config.model-type.list",
      });
      if (result.status !== "ok" || !result.data) return result;
      const row = (result.data.items as unknown as { name: string }[] | undefined)?.find(
        (item) => item.name === positional[2],
      );
      if (!row)
        return failure(
          new ProjectError(
            "invalid_arguments",
            "MODEL_TYPE_UNUSABLE",
            "Model type does not exist.",
          ),
        );
      return ok({ modelType: row }, result.diagnostics);
    }
    let configuration:
      | { command: "config.model-type.set"; name: string; ontology: string }
      | {
          command:
            | "config.model-type.disable"
            | "config.model-type.enable"
            | "config.model-type.reset";
          name: string;
        }
      | { command: "config.model-type.design.set"; name: string; design: string }
      | { command: "config.model-type.design.clear"; name: string };
    if (action === "set" && positional.length === 3 && value("--ontology"))
      configuration = {
        command: "config.model-type.set",
        name: positional[2] ?? "",
        ontology: value("--ontology") ?? "",
      };
    else if (["disable", "enable", "reset"].includes(action ?? "") && positional.length === 3)
      configuration = {
        command: `config.model-type.${action}` as
          | "config.model-type.disable"
          | "config.model-type.enable"
          | "config.model-type.reset",
        name: positional[2] ?? "",
      };
    else if (action === "design" && positional[2] === "set" && positional.length === 5)
      configuration = {
        command: "config.model-type.design.set",
        name: positional[3] ?? "",
        design: positional[4] ?? "",
      };
    else if (action === "design" && positional[2] === "clear" && positional.length === 4)
      configuration = {
        command: "config.model-type.design.clear",
        name: positional[3] ?? "",
      };
    else
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Invalid config model-type signature. Use config model-type --help.",
      );
    return configureModelType({
      project: selectedProject,
      ...configuration,
      acceptImpact: options.has("--accept-impact"),
      acceptedPreview: value("--accepted-preview"),
    });
  }
  if (command === "ontology" || command === "model") {
    if (positional[0] === "remove" && positional.length === 2)
      return removeResource({
        project: selectedProject,
        kind: command,
        selector: positional[1] ?? "",
        confirm: options.has("--confirm"),
        acceptedPreview: value("--accepted-preview"),
      });
    if (command === "model" && positional[0] === "schema") {
      const action = positional[1];
      if (action === "list" && positional.length === 3)
        return inspectProject({
          project: selectedProject,
          command: "model.schema.list",
          selector: positional[2],
        });
      if (["add", "remove"].includes(action ?? "") && positional.length === 4)
        return authorResource({
          project: selectedProject,
          command: `model.schema.${action}` as AuthoringOptions["command"],
          path: positional[2] ?? "",
          source: positional[3],
          confirm: options.has("--confirm"),
          acceptedPreview: value("--accepted-preview"),
        });
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Invalid model schema signature. Use model --help.",
      );
    }
    const action = positional[0];
    if (
      (action === "list" && positional.length === 1) ||
      (action === "show" && positional.length === 2)
    ) {
      if (
        ["--iri", "--type", "--profile", "--schema", "--accepted-preview"].some((flag) =>
          options.has(flag),
        )
      )
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Authoring options do not apply to inspection.",
        );
      return inspectProject({
        project: selectedProject,
        command: `${command}.${action}`,
        selector: positional[1],
      });
    }
    if (
      !(
        (action === "create" && positional.length === 2) ||
        (action === "import" && positional.length === 3)
      )
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Invalid resource signature. Use command --help.",
      );
    return authorResource({
      project: selectedProject,
      command: `${command}.${action}`,
      path: positional[action === "import" ? 2 : 1] ?? "",
      source: action === "import" ? positional[1] : undefined,
      iri: value("--iri"),
      type: value("--type"),
      profile: value("--profile") as AuthoringOptions["profile"],
      schemas,
      acceptedPreview: value("--accepted-preview"),
    });
  }
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
  if (["status", "graph"].includes(command)) {
    let operation: InspectionCommand;
    let selector: string | undefined;
    if (command === "status" && !positional.length) operation = "status";
    else if (command === "graph" && positional[0] === "list" && positional.length === 1)
      operation = "graph.list";
    else if (command === "graph" && positional[0] === "show" && positional.length === 2) {
      operation = "graph.show";
      selector = positional[1];
    } else
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
