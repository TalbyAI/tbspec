import { Buffer } from "node:buffer";
import type { PreparedResource } from "./authoring.ts";
import { captureInspection, inspectSnapshot, type Resource } from "./inspection.ts";
import { ProjectError } from "./output.ts";
import { absoluteIri, portablePath } from "./paths.ts";
import { discoverProject } from "./project.ts";
import { editDesignChoice, parseLock, parseManifest, selector } from "./schemas.ts";
import { preparePlan } from "./transactions.ts";

export async function prepareDesignChoice(options: {
  project?: string;
  cwd?: string;
  action: "select" | "clear";
  conceptIri: string;
  design?: string;
}): Promise<PreparedResource> {
  if (!absoluteIri(options.conceptIri))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Concept IRI must be absolute.",
    );
  if ((options.action === "select") !== (typeof options.design === "string"))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      options.action === "select"
        ? "Select a design graph."
        : "Clear does not accept a design graph.",
    );

  const root = await discoverProject(options);
  const snapshot = await captureInspection(root, "status");
  const manifestText = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
  parseManifest(manifestText);
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const listing = await inspectSnapshot(root, snapshot, { project: root, command: "graph.list" });
  if (!listing.data)
    throw new ProjectError(
      listing.status,
      listing.diagnostics[0]?.code ?? "IO_FAILURE",
      listing.diagnostics[0]?.message ?? "Cannot inspect available design models.",
    );

  let selected: string | undefined;
  let resource: Resource | undefined;
  let selectedDiagnostics: typeof listing.diagnostics = [];
  if (options.design !== undefined) {
    selected = selector(
      options.design.startsWith("dep:")
        ? options.design.replaceAll("\\", "/")
        : portablePath(options.design),
    );
    if (selected.startsWith("dep:")) {
      const [id, ...parts] = selected.slice(4).split("/");
      const dependency = lock.dependencies[id ?? ""];
      const file = dependency?.files.find(
        (item) => item.key === (parts.join("/") || dependency.primary),
      );
      if (!dependency || !file || file.kind !== "design")
        throw new ProjectError(
          "invalid",
          "RESOURCE_MISSING",
          "Selected design is unavailable.",
          selected,
        );
      selected = `dep:${id}/${file.key}`;
    }
    if (selected.startsWith("dep:")) {
      const inspected = await inspectSnapshot(root, snapshot, {
        project: root,
        command: "graph.show",
        selector: selected,
      });
      selectedDiagnostics = inspected.diagnostics;
      if (!inspected.data)
        throw new ProjectError(
          inspected.status,
          inspected.diagnostics[0]?.code ?? "RESOURCE_MISSING",
          inspected.diagnostics[0]?.message ?? "Selected design is unavailable.",
          selected,
        );
      resource = inspected.data.resource;
    } else resource = listing.data.items?.find((item) => item.selector === selected);
    if (resource?.kind !== "design")
      throw new ProjectError(
        "invalid",
        "GRAPH_CLASSIFICATION",
        "Selected resource is not a visual design model.",
        selected,
      );
  } else {
    resource = listing.data.items?.find((item) => item.kind === "design");
  }

  const nextManifest = editDesignChoice(manifestText, options.conceptIri, selected);
  if (nextManifest === manifestText)
    throw new ProjectError("conflict", "REVISION_CONFLICT", "Design choice is already current.");
  const plan = preparePlan(
    snapshot,
    `design.${options.action}`,
    [{ file: "tbspec.toml", bytes: Buffer.from(nextManifest) }],
    { conceptIri: options.conceptIri, design: selected ?? null },
  );
  return {
    root,
    plan,
    resource: resource ?? {
      selector: "tbspec.toml",
      file: "tbspec.toml",
      graphIri: null,
      identity: null,
      kind: "design",
      classification: "design",
      ownership: "project",
      revision: plan.preview.changes[0]?.before ?? { state: "absent" },
      associations: [],
    },
    diagnostics: [...listing.diagnostics, ...selectedDiagnostics],
  };
}
