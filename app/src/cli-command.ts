import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuthoringOptions } from "./authoring.ts";
import { guidance, help } from "./guidance.ts";
import type { InspectionCommand } from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { applicationVersion } from "./version.ts";

export interface CliInvocation {
  json: boolean;
  foreground: boolean;
  initialized: boolean;
  execute: () => Promise<Result>;
}

export function parseCli(argv: readonly string[]): CliInvocation {
  const json = argv.includes("--json");
  let foreground = false;
  let initialized = false;
  function prepare(): Result | CliInvocation["execute"] {
    const positional: string[] = [];
    const options = new Map<string, string | true>();
    const repeatedValues = new Map<string, string[]>();
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
          "--id",
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
          "--all",
          "--dangling",
        ].includes(argument)
      )
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          `Unknown option: ${argument}. Use tbspec --help.`,
        );
      if (options.has(argument) && !["--schema", "--file", "--resource"].includes(argument))
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
          "--id",
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
        if (argument === "--file" || argument === "--resource") {
          const values = repeatedValues.get(argument) ?? [];
          values.push(value);
          repeatedValues.set(argument, values);
        }
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
        "refactor",
        "references",
        "gc",
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
    if (options.has("--id") && !(command === "dependency" && positional[0] === "add"))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--id applies only to dependency add.",
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
    const values = (flag: string) => repeatedValues.get(flag) ?? [];
    const rejectOptions = (allowed: string[]) => {
      const unexpected = [...options.keys()].filter(
        (flag) => !["--json", "--project", "--help", ...allowed].includes(flag),
      );
      if (unexpected.length)
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          `Unsupported option for this operation: ${unexpected[0]}.`,
        );
    };
    if (
      values("--file").length > 1 &&
      !(command === "references" && ["redirect", "remove"].includes(positional[0] ?? ""))
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "This operation accepts at most one --file option.",
      );
    if (values("--resource").length > 1 && command !== "gc")
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "This operation accepts at most one --resource option.",
      );
    if (command === "refactor") {
      rejectOptions(["--apply"]);
      if (positional[0] !== "iri" || positional.length !== 3)
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Use refactor iri <old-iri> <new-iri> [--apply].",
        );
      return async () => {
        const { refactorIri } = await import("./repair.ts");
        return refactorIri({
          project: selectedProject,
          oldIri: positional[1] ?? "",
          newIri: positional[2] ?? "",
          apply: options.has("--apply"),
        });
      };
    }
    if (command === "references") {
      const action = positional[0];
      if (action === "list" && positional.length === 1) {
        rejectOptions(["--target", "--dangling"]);
        if (options.has("--all"))
          throw new ProjectError(
            "invalid_arguments",
            "ARGUMENT_INVALID",
            "Reference listing uses --target or --dangling; --all applies only to repair scope.",
          );
        return async () => {
          const { listReferences } = await import("./repair.ts");
          return listReferences({
            project: selectedProject,
            ...(value("--target") ? { target: value("--target") } : {}),
            ...(options.has("--dangling") ? { dangling: true } : {}),
          });
        };
      }
      if (action === "redirect" && positional.length === 3) {
        rejectOptions(["--file", "--all", "--apply"]);
        if (options.has("--all") === values("--file").length > 0)
          throw new ProjectError(
            "invalid_arguments",
            "ARGUMENT_INVALID",
            "Choose one or more --file paths or --all.",
          );
        return async () => {
          const { redirectReferences } = await import("./repair.ts");
          return redirectReferences({
            project: selectedProject,
            targetIri: positional[1] ?? "",
            newIri: positional[2] ?? "",
            ...(values("--file").length ? { files: values("--file") } : {}),
            ...(options.has("--all") ? { all: true } : {}),
            apply: options.has("--apply"),
          });
        };
      }
      if (action === "remove" && positional.length === 2) {
        rejectOptions(["--file", "--all", "--apply"]);
        if (options.has("--all") === values("--file").length > 0)
          throw new ProjectError(
            "invalid_arguments",
            "ARGUMENT_INVALID",
            "Choose one or more --file paths or --all.",
          );
        return async () => {
          const { removeReferences } = await import("./repair.ts");
          return removeReferences({
            project: selectedProject,
            targetIri: positional[1] ?? "",
            ...(values("--file").length ? { files: values("--file") } : {}),
            ...(options.has("--all") ? { all: true } : {}),
            apply: options.has("--apply"),
          });
        };
      }
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Use references list [--target <iri> | --dangling]; references redirect <old-iri> <new-iri> (--file <path> ... | --all) [--apply]; or references remove <target-iri> (--file <path> ... | --all) [--apply].",
      );
    }
    if (command === "gc") {
      rejectOptions(["--resource", "--all", "--apply", "--confirm"]);
      if (positional.length || (options.has("--all") && values("--resource").length > 0))
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Use gc [--resource <path> ... | --all] [--apply --confirm].",
        );
      return async () => {
        const { collectGarbage } = await import("./repair.ts");
        return collectGarbage({
          project: selectedProject,
          ...(values("--resource").length ? { resources: values("--resource") } : {}),
          ...(options.has("--all") ? { all: true } : {}),
          apply: options.has("--apply"),
          confirm: options.has("--confirm"),
        });
      };
    }
    if (command === "dependency") {
      const action = positional[0];
      if (options.has("--accept-impact") && action !== "update")
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Only dependency update accepts --accept-impact.",
        );
      if (
        (options.has("--apply") && action !== "update" && action !== "rename") ||
        (options.has("--confirm") && action !== "remove")
      )
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "--apply applies only to dependency update or rename; --confirm applies only to dependency removal.",
        );
      const mutationOptions = [
        "--source",
        "--id",
        "--ref",
        "--resource",
        "--kind",
        "--accepted-preview",
        "--apply",
        "--confirm",
        "--accept-impact",
        "--target",
        "--role",
      ];
      if (
        action === "list" &&
        positional.length === 1 &&
        !mutationOptions.some((flag) => options.has(flag))
      )
        return async () => {
          const { dependencyList } = await import("./dependencies.ts");
          return dependencyList({ project: selectedProject });
        };
      if (
        action === "show" &&
        positional.length === 2 &&
        !mutationOptions.some((flag) => options.has(flag))
      )
        return async () => {
          const { dependencyShow } = await import("./dependencies.ts");
          return dependencyShow({ project: selectedProject, id: positional[1] ?? "" });
        };
      if (
        action === "check" &&
        positional.length <= 2 &&
        !mutationOptions.some((flag) => options.has(flag))
      )
        return async () => {
          const { dependencyCheck } = await import("./dependencies.ts");
          return dependencyCheck({
            project: selectedProject,
            ...(positional[1] ? { id: positional[1] } : {}),
          });
        };
      if (
        action === "select" &&
        positional.length === 3 &&
        !mutationOptions.some((flag) => options.has(flag))
      )
        return async () => {
          const { dependencySelect } = await import("./dependencies.ts");
          return dependencySelect({
            project: selectedProject,
            ontologyIri: positional[1] ?? "",
            id: positional[2] ?? "",
          });
        };
      if (
        action === "clear" &&
        positional.length === 2 &&
        !mutationOptions.some((flag) => options.has(flag))
      )
        return async () => {
          const { dependencyClear } = await import("./dependencies.ts");
          return dependencyClear({ project: selectedProject, ontologyIri: positional[1] ?? "" });
        };
      if (
        action === "update" &&
        positional.length === 2 &&
        !["--source", "--ref", "--resource", "--kind", "--target", "--role"].some((flag) =>
          options.has(flag),
        )
      )
        return async () => {
          const { dependencyUpdate } = await import("./dependencies.ts");
          return dependencyUpdate({
            project: selectedProject,
            id: positional[1] ?? "",
            apply: options.has("--apply"),
            acceptImpact: options.has("--accept-impact"),
            ...(value("--accepted-preview")
              ? { acceptedPreview: value("--accepted-preview") }
              : {}),
          });
        };
      if (
        action === "rename" &&
        positional.length === 3 &&
        ![
          "--source",
          "--ref",
          "--resource",
          "--kind",
          "--accept-impact",
          "--confirm",
          "--target",
          "--role",
        ].some((flag) => options.has(flag))
      )
        return async () => {
          const { dependencyRename } = await import("./dependencies.ts");
          return dependencyRename({
            project: selectedProject,
            from: positional[1] ?? "",
            to: positional[2] ?? "",
            apply: options.has("--apply"),
            ...(value("--accepted-preview")
              ? { acceptedPreview: value("--accepted-preview") }
              : {}),
          });
        };
      if (
        action === "remove" &&
        positional.length === 2 &&
        ![
          "--source",
          "--ref",
          "--resource",
          "--kind",
          "--apply",
          "--accept-impact",
          "--target",
          "--role",
        ].some((flag) => options.has(flag))
      )
        return async () => {
          const { dependencyRemove } = await import("./dependencies.ts");
          return dependencyRemove({
            project: selectedProject,
            id: positional[1] ?? "",
            confirm: options.has("--confirm"),
            ...(value("--accepted-preview")
              ? { acceptedPreview: value("--accepted-preview") }
              : {}),
          });
        };
      if (
        action === "support" &&
        positional[1] === "set" &&
        positional.length === 3 &&
        value("--role") &&
        value("--source") &&
        !["--kind", "--apply", "--confirm", "--accept-impact"].some((flag) => options.has(flag)) &&
        ["shacl", "design"].includes(value("--role") ?? "")
      )
        return async () => {
          const { dependencySupportSet } = await import("./dependencies.ts");
          return dependencySupportSet({
            project: selectedProject,
            id: positional[2] ?? "",
            ...(value("--target") ? { target: value("--target") } : {}),
            role: value("--role") as "shacl" | "design",
            source: value("--source") as string,
            ...(value("--resource") ? { resource: value("--resource") } : {}),
            ...(value("--ref") ? { ref: value("--ref") } : {}),
            ...(value("--accepted-preview")
              ? { acceptedPreview: value("--accepted-preview") }
              : {}),
          });
        };
      if (
        action === "support" &&
        positional[1] === "clear" &&
        positional.length === 3 &&
        value("--role") &&
        value("--resource") &&
        ["shacl", "design"].includes(value("--role") ?? "") &&
        !options.has("--source") &&
        !options.has("--ref") &&
        !["--kind", "--apply", "--confirm", "--accept-impact"].some((flag) => options.has(flag))
      )
        return async () => {
          const { dependencySupportClear } = await import("./dependencies.ts");
          return dependencySupportClear({
            project: selectedProject,
            id: positional[2] ?? "",
            ...(value("--target") ? { target: value("--target") } : {}),
            role: value("--role") as "shacl" | "design",
            resource: value("--resource") as string,
            ...(value("--accepted-preview")
              ? { acceptedPreview: value("--accepted-preview") }
              : {}),
          });
        };
      if (
        action === "inspect" &&
        ((positional.length === 1 && value("--source")) ||
          (positional.length === 2 && !options.has("--source")))
      )
        return async () => {
          const { dependencyInspect } = await import("./dependencies.ts");
          return dependencyInspect({
            project: selectedProject,
            source: (value("--source") ?? positional[1]) as string,
            ...(value("--ref") ? { ref: value("--ref") } : {}),
            ...(value("--resource") ? { resource: value("--resource") } : {}),
          });
        };
      if (
        action === "add" &&
        positional.length === 2 &&
        ((value("--source") && !options.has("--id")) ||
          (value("--id") && !options.has("--source"))) &&
        value("--kind") &&
        ["ontology", "model", "design"].includes(value("--kind") ?? "")
      )
        return async () => {
          const { dependencyAdd } = await import("./dependencies.ts");
          return dependencyAdd({
            project: selectedProject,
            source: (value("--source") ? value("--source") : positional[1]) as string,
            id: (value("--id") ? value("--id") : positional[1]) as string,
            kind: value("--kind") as "ontology" | "model" | "design",
            ...(value("--ref") ? { ref: value("--ref") } : {}),
            ...(value("--resource") ? { resource: value("--resource") } : {}),
            ...(value("--accepted-preview")
              ? { acceptedPreview: value("--accepted-preview") }
              : {}),
          });
        };
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Use dependency inspect <source> [--ref <revision>] [--resource <selector>] (also accepts --source <source>); dependency add <source> --id <id> --kind ontology|model|design [--ref <revision>] [--resource <selector>] --accepted-preview <fingerprint> (also accepts <id> --source <source>); dependency update <id> [--apply --accepted-preview <fingerprint> --accept-impact]; dependency rename <old-id> <new-id> [--apply --accepted-preview <fingerprint>]; dependency remove <id> [--confirm --accepted-preview <fingerprint>]; dependency support set <id> --role shacl|design --source <source> [--resource <exact-file>] [--target <dep:id/file>] --accepted-preview <fingerprint>; dependency support clear <id> --role shacl|design --resource <dep:id/support-file> [--target <dep:id/file>]; dependency list; dependency show <id>; dependency check [<id>]; dependency select <ontology-iri> <id>; or dependency clear <ontology-iri>.",
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
        return async () => {
          const { listViews } = await import("./views.ts");
          return listViews({
            project: selectedProject,
            ...(value("--source") ? { source: value("--source") } : {}),
          });
        };
      if (
        action === "show" &&
        positional.length === 2 &&
        !options.has("--source") &&
        !options.has("--protocol") &&
        !options.has("--confirm") &&
        !options.has("--accepted-preview")
      )
        return async () => {
          const { showView } = await import("./views.ts");
          return showView({ project: selectedProject, selector: positional[1] ?? "" });
        };
      if (
        action === "create" &&
        positional.length === 2 &&
        value("--source") &&
        !options.has("--confirm")
      )
        return async () => {
          const { viewOperation } = await import("./views.ts");
          return viewOperation({
            project: selectedProject,
            action: "create",
            path: positional[1] ?? "",
            source: value("--source"),
            ...(value("--protocol") ? { protocol: value("--protocol") } : {}),
            ...(value("--accepted-preview")
              ? { acceptedPreview: value("--accepted-preview") }
              : {}),
          });
        };
      if (
        action === "remove" &&
        positional.length === 2 &&
        !options.has("--source") &&
        !options.has("--protocol")
      )
        return async () => {
          const { viewOperation } = await import("./views.ts");
          return viewOperation({
            project: selectedProject,
            action: "remove",
            selector: positional[1] ?? "",
            confirm: options.has("--confirm"),
            ...(value("--accepted-preview")
              ? { acceptedPreview: value("--accepted-preview") }
              : {}),
          });
        };
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
        return async () => {
          const { listDesigns } = await import("./designs.ts");
          return listDesigns({ project: selectedProject });
        };
      if (action === "show" && positional.length === 2 && !options.has("--iri"))
        return async () => {
          const { showDesign } = await import("./designs.ts");
          return showDesign({ project: selectedProject, selector: positional[1] ?? "" });
        };
      if (action === "remove" && positional.length === 2)
        return async () => {
          const { removeResource } = await import("./resource-lifecycle.ts");
          return removeResource({
            project: selectedProject,
            kind: "design",
            selector: positional[1] ?? "",
            confirm: options.has("--confirm"),
            acceptedPreview: value("--accepted-preview"),
          });
        };
      if (action === "select" && positional.length === 3)
        return async () => {
          const { authorResource } = await import("./authoring.ts");
          return authorResource({
            project: selectedProject,
            command: "design.select",
            path: positional[1] ?? "",
            source: positional[2],
            acceptedPreview: value("--accepted-preview"),
          });
        };
      if (action === "clear" && positional.length === 2)
        return async () => {
          const { authorResource } = await import("./authoring.ts");
          return authorResource({
            project: selectedProject,
            command: "design.clear",
            path: positional[1] ?? "",
            acceptedPreview: value("--accepted-preview"),
          });
        };
      if (
        (action === "create" && positional.length === 2) ||
        (action === "import" && positional.length === 3)
      )
        return async () => {
          const { authorResource } = await import("./authoring.ts");
          return authorResource({
            project: selectedProject,
            command: `design.${action}` as "design.create" | "design.import",
            path: positional[action === "import" ? 2 : 1] ?? "",
            ...(action === "import" ? { source: positional[1] } : {}),
            iri: value("--iri"),
            acceptedPreview: value("--accepted-preview"),
          });
        };
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
        (command === "query" && positional[0] === "remove") ||
        command === "gc"
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
      !(command === "dependency" && positional[0] === "update") &&
      !(command === "refactor" && positional[0] === "iri") &&
      !(command === "references" && ["redirect", "remove"].includes(positional[0] ?? "")) &&
      command !== "gc"
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--apply applies only to resource, dependency, refactor, reference repair, or garbage collection operations.",
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
      ) &&
      !(command === "gc")
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--resource applies only to dependency inspect/add, support set/clear, or garbage collection.",
      );
    if (options.has("--kind") && !(command === "dependency" && positional[0] === "add"))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--kind applies only to dependency add.",
      );
    if (
      options.has("--all") &&
      !(
        command === "gc" ||
        (command === "references" && ["redirect", "remove"].includes(positional[0] ?? ""))
      )
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--all applies only to reference repair or garbage collection.",
      );
    if (
      options.has("--file") &&
      !(command === "references" && ["redirect", "remove"].includes(positional[0] ?? "")) &&
      !(command === "query" && ["save", "run"].includes(positional[0] ?? ""))
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--file applies only to query or reference repair.",
      );
    if (options.has("--dangling") && !(command === "references" && positional[0] === "list"))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--dangling applies only to references list.",
      );
    if (
      options.has("--target") &&
      !(
        command === "dependency" &&
        positional[0] === "support" &&
        ["set", "clear"].includes(positional[1] ?? "")
      ) &&
      !(command === "references" && positional[0] === "list")
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
      (command !== "query" || options.has("--help")) &&
      !(command === "references" && options.has("--file"))
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
      (options.has("--file") &&
        !["save", "run"].includes(queryAction ?? "") &&
        command !== "references")
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
        return async () => {
          const { listQueries } = await import("./query.ts");
          return listQueries({ project: selectedProject });
        };
      if (
        action === "show" &&
        positional.length === 2 &&
        !queryOptions.some((flag) => options.has(flag))
      )
        return async () => {
          const { showQuery } = await import("./query.ts");
          return showQuery({ project: selectedProject, name: positional[1] ?? "" });
        };
      if (action === "save" && positional.length === 2 && queryFile)
        return async () => {
          const { querySave } = await import("./query.ts");
          return querySave({
            project: selectedProject,
            name: positional[1] ?? "",
            queryText: await readText(queryFile),
            ...(parameterFile ? { parametersText: await readText(parameterFile) } : {}),
          });
        };
      if (
        action === "run" &&
        positional.length === 1 &&
        (queryFile !== undefined) !== (saved !== undefined)
      )
        return async () => {
          const { queryRun } = await import("./query.ts");
          return queryRun({
            project: selectedProject,
            ...(queryFile ? { queryText: await readText(queryFile) } : { saved }),
            ...(value("--graph") ? { graph: value("--graph") } : {}),
            ...(bindingsFile ? { bindingsText: await readText(bindingsFile) } : {}),
          });
        };
      if (
        action === "remove" &&
        positional.length === 2 &&
        !["--file", "--parameters", "--saved", "--graph", "--bindings"].some((flag) =>
          options.has(flag),
        )
      )
        return async () => {
          const { queryRemove } = await import("./query.ts");
          return queryRemove({
            project: selectedProject,
            name: positional[1] ?? "",
            confirm: options.has("--confirm"),
          });
        };
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
      return async () => {
        const { inspectProject } = await import("./inspection.ts");
        return inspectProject({
          project: selectedProject,
          command: "validate",
          selector: positional[0],
        });
      };
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
      return async () => {
        const { inspectImpact } = await import("./resource-lifecycle.ts");
        return inspectImpact({
          project: selectedProject,
          kind: kind as "ontology" | "model" | "shapes" | "model-type",
          selector: positional[1] ?? "",
        });
      };
    }
    if (command === "resource") {
      if (positional[0] === "move" && positional.length === 3)
        return async () => {
          const { moveResource } = await import("./resource-lifecycle.ts");
          return moveResource({
            project: selectedProject,
            selector: positional[1] ?? "",
            destination: positional[2] ?? "",
            apply: options.has("--apply"),
            acceptedPreview: value("--accepted-preview"),
          });
        };
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Use resource move <owned-selector> <destination> [--apply --accepted-preview <digest>].",
      );
    }
    if (command === "shapes") {
      if (positional[0] === "list" && positional.length === 1)
        return async () => {
          const { inspectProject } = await import("./inspection.ts");
          return inspectProject({
            project: selectedProject,
            command: "shapes.list",
            selector: value("--source"),
          });
        };
      if (positional[0] === "create" && positional.length === 2)
        return async () => {
          const { authorResource } = await import("./authoring.ts");
          return authorResource({
            project: selectedProject,
            command: "shapes.create",
            path: positional[1] ?? "",
            acceptedPreview: value("--accepted-preview"),
          });
        };
      if (positional[0] === "remove" && positional.length === 2)
        return async () => {
          const { removeResource } = await import("./resource-lifecycle.ts");
          return removeResource({
            project: selectedProject,
            kind: "shapes",
            selector: positional[1] ?? "",
            confirm: options.has("--confirm"),
            acceptedPreview: value("--accepted-preview"),
          });
        };
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Use shapes list [--source <path>] or shapes create <source-path>.",
      );
    }
    if (command === "config") {
      if (positional[0] !== "model-type") {
        if (positional.join(" ") === "show" && positional.length === 1)
          return async () => {
            const { inspectProject } = await import("./inspection.ts");
            return inspectProject({ project: selectedProject, command: "config.show" });
          };
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Use config show or config model-type --help.",
        );
      }
      const action = positional[1];
      if (action === "remove" && positional.length === 3)
        return async () => {
          const { removeResource } = await import("./resource-lifecycle.ts");
          return removeResource({
            project: selectedProject,
            kind: "model-type",
            selector: positional[2] ?? "",
            confirm: options.has("--confirm"),
            acceptedPreview: value("--accepted-preview"),
          });
        };
      if (action === "list" && positional.length === 2)
        return async () => {
          const { inspectProject } = await import("./inspection.ts");
          return inspectProject({ project: selectedProject, command: "config.model-type.list" });
        };
      if (action === "show" && positional.length === 3) {
        return async () => {
          const { inspectProject } = await import("./inspection.ts");
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
        };
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
      return async () => {
        const { configureModelType } = await import("./configuration.ts");
        return configureModelType({
          project: selectedProject,
          ...configuration,
          acceptImpact: options.has("--accept-impact"),
          acceptedPreview: value("--accepted-preview"),
        });
      };
    }
    if (command === "ontology" || command === "model") {
      if (positional[0] === "remove" && positional.length === 2)
        return async () => {
          const { removeResource } = await import("./resource-lifecycle.ts");
          return removeResource({
            project: selectedProject,
            kind: command,
            selector: positional[1] ?? "",
            confirm: options.has("--confirm"),
            acceptedPreview: value("--accepted-preview"),
          });
        };
      if (command === "model" && positional[0] === "schema") {
        const action = positional[1];
        if (action === "list" && positional.length === 3)
          return async () => {
            const { inspectProject } = await import("./inspection.ts");
            return inspectProject({
              project: selectedProject,
              command: "model.schema.list",
              selector: positional[2],
            });
          };
        if (["add", "remove"].includes(action ?? "") && positional.length === 4)
          return async () => {
            const { authorResource } = await import("./authoring.ts");
            return authorResource({
              project: selectedProject,
              command: `model.schema.${action}` as AuthoringOptions["command"],
              path: positional[2] ?? "",
              source: positional[3],
              confirm: options.has("--confirm"),
              acceptedPreview: value("--accepted-preview"),
            });
          };
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
        return async () => {
          const { inspectProject } = await import("./inspection.ts");
          return inspectProject({
            project: selectedProject,
            command: `${command}.${action}`,
            selector: positional[1],
          });
        };
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
      return async () => {
        const { authorResource } = await import("./authoring.ts");
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
      };
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
      return async () => {
        const { webProject } = await import("./web.ts");
        return webProject({
          project: selectedProject,
          action: action as "start" | "status" | "stop",
          port,
        });
      };
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
      return async () => {
        const { inspectProject } = await import("./inspection.ts");
        return inspectProject({ project: selectedProject, command: operation, selector });
      };
    }
    const base = options.get("--base-iri");
    if (project && positional.length)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "init accepts a directory or --project, not both.",
      );
    initialized = true;
    return async () => {
      const { initializeProject } = await import("./project.ts");
      return initializeProject({
        directory: positional[0] ?? (typeof project === "string" ? resolve(project) : undefined),
        baseIri: typeof base === "string" ? base : undefined,
      });
    };
  }
  const action = prepare();
  return {
    json,
    foreground,
    initialized,
    execute: typeof action === "function" ? action : async () => action,
  };
}
