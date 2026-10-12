import { Buffer } from "node:buffer";
import { compareDiagnosticImpact } from "./diagnostic-impact.ts";
import { equalRevision, fileBytes, revision } from "./filesystem.ts";
import {
  captureInspection,
  type InspectionData,
  inspectSnapshot,
  type Resource,
} from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { id, portablePath } from "./paths.ts";
import { discoverProject } from "./project.ts";
import { classifyGraph, parseGraph } from "./rdf.ts";
import {
  editModelType,
  type Lock,
  type ModelType,
  parseLock,
  parseManifest,
  type Row,
  selector,
} from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { type Plan, preparePlan, publishPlan, withPlanImpact } from "./transactions.ts";

export type ModelTypeConfigurationCommand =
  | "config.model-type.set"
  | "config.model-type.disable"
  | "config.model-type.enable"
  | "config.model-type.reset"
  | "config.model-type.design.set"
  | "config.model-type.design.clear";

export interface ModelTypeConfigurationOptions {
  project?: string;
  cwd?: string;
  command: ModelTypeConfigurationCommand;
  name: string;
  ontology?: string;
  design?: string;
  acceptImpact?: boolean;
  acceptedPreview?: string;
}

export interface PreparedModelTypeConfiguration {
  root: string;
  plan: Plan;
  diagnostics: Result["diagnostics"];
  modelType: { name: string; enabled: boolean; ontology: string; design: string | null };
  affectedModels: {
    selector: string;
    ontologyBefore: string | null;
    ontologyAfter: string | null;
    validityBefore: string;
    validityAfter: string;
  }[];
  projectValidity: "valid" | "invalid" | "unchecked";
  validationComplete: boolean;
}

function asData(result: Result<InspectionData>, operation: string): InspectionData {
  if (!result.data || ["conflict", "unavailable", "invalid_arguments"].includes(result.status)) {
    const diagnostic = result.diagnostics[0];
    throw new ProjectError(
      result.status === "ok" ? "unavailable" : result.status,
      diagnostic?.code ?? "IO_FAILURE",
      diagnostic?.message ?? `Cannot inspect the project for ${operation}.`,
      diagnostic?.file,
    );
  }
  return result.data;
}

function expandedSelector(
  value: string,
  lock: Lock,
): { selector: string; file: string; kind: string } {
  const selected = selector(
    value.startsWith("dep:") ? value.replaceAll("\\", "/") : portablePath(value),
  );
  if (!selected.startsWith("dep:")) return { selector: selected, file: selected, kind: "" };
  const [dependencyId, ...keyParts] = selected.slice(4).split("/");
  const dependency = lock.dependencies[dependencyId ?? ""];
  const key = keyParts.join("/") || dependency?.primary;
  const record = dependency?.files.find((file) => file.key === key);
  if (!dependency || !record)
    throw new ProjectError(
      "invalid",
      "ASSOCIATION_BROKEN",
      "Selected locked graph is missing.",
      selected,
    );
  return {
    selector: `dep:${dependencyId}/${record.key}`,
    file: `${dependency.snapshot_path}/${record.key}`,
    kind: record.kind,
  };
}

function sameSelector(left: string | null, right: string | null, lock: Lock): boolean {
  if (left === null || right === null) return left === right;
  try {
    return expandedSelector(left, lock).selector === expandedSelector(right, lock).selector;
  } catch {
    return left === right;
  }
}

async function graphKind(
  root: string,
  selected: string,
  lock: Lock,
  snapshot: Awaited<ReturnType<typeof captureInspection>>,
  owned: Resource[],
): Promise<string> {
  const graph = expandedSelector(selected, lock);
  if (!graph.selector.startsWith("dep:")) {
    const resource = owned.find((item) => item.selector === graph.selector);
    if (!resource)
      throw new ProjectError(
        "invalid",
        "RESOURCE_MISSING",
        "Selected project graph is missing.",
        graph.selector,
      );
    return resource.kind;
  }
  const [idPart, ...keyParts] = graph.selector.slice(4).split("/");
  const record = lock.dependencies[idPart ?? ""]?.files.find(
    (file) => file.key === keyParts.join("/"),
  );
  if (!record)
    throw new ProjectError(
      "invalid",
      "RESOURCE_MISSING",
      "Selected locked graph is missing.",
      graph.selector,
    );
  const captured = snapshot.reads.find((read) => read.kind === "file" && read.path === graph.file);
  if (!captured)
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Selected locked graph was not captured for configuration.",
      graph.file,
    );
  const bytes = snapshot.files[graph.file] ?? (await fileBytes(root, graph.file));
  if (!equalRevision(captured.revision, revision(bytes)))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Selected locked graph changed after inspection capture.",
      graph.file,
    );
  if (!bytes)
    throw new ProjectError(
      "invalid",
      "RESOURCE_MISSING",
      "Selected locked graph is missing.",
      graph.selector,
    );
  const bundle = await loadStarters();
  const store = await parseGraph(bytes, record, bundle.vettedDigest);
  const actual = classifyGraph(store, graph.selector);
  if (actual.graphIri !== record.graph_iri || actual.kind !== record.kind)
    throw new ProjectError(
      "invalid",
      "LOCK_INVALID",
      "Selected locked graph no longer matches its recorded identity or kind.",
      graph.file,
    );
  return actual.kind;
}

export async function prepareModelTypeConfiguration(
  options: ModelTypeConfigurationOptions,
): Promise<PreparedModelTypeConfiguration> {
  id(options.name);
  const root = await discoverProject(options);
  const snapshot = await captureInspection(root, "status");
  const manifestText = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
  const manifest = parseManifest(manifestText);
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const defaults = lock.starters.model_types;
  const overrides = (manifest.model_types ?? {}) as Record<string, Row>;
  const current = { ...defaults, ...overrides }[options.name] as ModelType | undefined;
  if (options.command !== "config.model-type.set" && !current)
    throw new ProjectError(
      "invalid_arguments",
      "MODEL_TYPE_UNUSABLE",
      "Model type does not exist.",
    );

  const ownedResult = await inspectSnapshot(root, snapshot, {
    project: root,
    command: "graph.list",
  });
  const owned = asData(ownedResult, options.command).items ?? [];
  const graphSelector = async (value: string, expectedKind: "ontology" | "design") => {
    const selected = expandedSelector(value, lock);
    const kind = await graphKind(root, selected.selector, lock, snapshot, owned);
    if (kind !== expectedKind)
      throw new ProjectError(
        "invalid",
        "GRAPH_CLASSIFICATION",
        `Selected graph must be a ${expectedKind}.`,
        selected.selector,
      );
    return selected.selector;
  };

  let nextRow: Row | undefined;
  let unchangedTypeSet = false;
  if (options.command === "config.model-type.set") {
    if (!options.ontology)
      throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Select an ontology graph.");
    const ontology = await graphSelector(options.ontology, "ontology");
    const row: Row = { ...(overrides[options.name] ?? current ?? { enabled: true, ontology: "" }) };
    if (current?.ontology && sameSelector(current.ontology, ontology, lock)) {
      unchangedTypeSet = true;
    } else {
      delete row.design;
      row.ontology = ontology;
      nextRow = row;
    }
  } else if (
    options.command === "config.model-type.disable" ||
    options.command === "config.model-type.enable"
  ) {
    nextRow = {
      ...(overrides[options.name] ?? current),
      enabled: options.command.endsWith("disable") ? false : true,
    };
  } else if (options.command === "config.model-type.reset") {
    if (!Object.hasOwn(defaults, options.name))
      throw new ProjectError(
        "invalid_arguments",
        "MODEL_TYPE_DEFAULT_MISSING",
        "Custom model types have no locked default to reset.",
      );
  } else if (options.command === "config.model-type.design.set") {
    if (!options.design)
      throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Select a design graph.");
    const design = await graphSelector(options.design, "design");
    nextRow = { ...(overrides[options.name] ?? current), design };
  } else {
    nextRow = { ...(overrides[options.name] ?? current) };
    delete nextRow.design;
  }

  const currentOntology = current?.ontology ?? null;
  const proposedOntology: string | null =
    options.command === "config.model-type.reset"
      ? (defaults[options.name]?.ontology ?? null)
      : unchangedTypeSet
        ? currentOntology
        : typeof nextRow?.ontology === "string"
          ? nextRow.ontology
          : currentOntology;
  const ontologyChanged = !sameSelector(currentOntology, proposedOntology, lock);
  const baselineInventory = asData(
    await inspectSnapshot(root, snapshot, { project: root, command: "graph.list" }),
    "model-type inventory",
  );
  const affected = (baselineInventory.items ?? []).filter(
    (resource) => resource.modelType === options.name,
  );
  const proposedText = unchangedTypeSet
    ? manifestText
    : editModelType(
        manifestText,
        options.name,
        options.command === "config.model-type.reset" ? undefined : nextRow,
      );
  const proposedSnapshot = {
    ...snapshot,
    files: { ...snapshot.files, "tbspec.toml": Buffer.from(proposedText) },
  };
  const needsImpact = ontologyChanged && affected.length > 0;
  const baselineResult = needsImpact
    ? await inspectSnapshot(root, snapshot, { project: root, command: "status" })
    : undefined;
  const baseline = baselineResult ? asData(baselineResult, "baseline validation") : undefined;
  const candidateResult = needsImpact
    ? await inspectSnapshot(root, proposedSnapshot, { project: root, command: "status" })
    : undefined;
  const candidate = candidateResult ? asData(candidateResult, "proposed validation") : undefined;
  const baselineState = new Map(
    (baseline?.validation?.resources ?? []).map((resource) => [resource.selector, resource.state]),
  );
  const proposedState = new Map(
    (candidate?.validation?.resources ?? []).map((resource) => [resource.selector, resource.state]),
  );
  const affectedModels = ontologyChanged
    ? affected.map((resource) => ({
        selector: resource.selector,
        ontologyBefore: currentOntology,
        ontologyAfter: proposedOntology,
        validityBefore: baselineState.get(resource.selector) ?? "partial",
        validityAfter: proposedState.get(resource.selector) ?? "partial",
      }))
    : [];
  const affectedSelectors = new Set(affected.map((resource) => resource.selector));
  const diagnostics = candidateResult?.diagnostics ?? [];
  const relevant = (items: Result["diagnostics"]) =>
    items.filter(
      (item) =>
        item.file === "tbspec.toml" ||
        affectedSelectors.has(item.selector ?? "") ||
        affected.some((resource) => resource.file === item.file),
    );
  const beforeDiagnostics = relevant(baselineResult?.diagnostics ?? []);
  const afterDiagnostics = relevant(diagnostics);
  const rows = { ...defaults, ...overrides } as Record<string, ModelType>;
  if (options.command === "config.model-type.reset")
    rows[options.name] = defaults[options.name] as ModelType;
  else if (!unchangedTypeSet) rows[options.name] = nextRow as unknown as ModelType;
  const effective = rows[options.name];
  if (!effective)
    throw new ProjectError("invalid", "MANIFEST_INVALID", "Effective model type is unavailable.");
  const modelType = {
    name: options.name,
    enabled: effective.enabled !== false,
    ontology: effective.ontology,
    design: effective.design ?? null,
  };
  const plan = preparePlan(
    snapshot,
    options.command,
    Buffer.compare(Buffer.from(manifestText), Buffer.from(proposedText)) === 0
      ? []
      : [{ file: "tbspec.toml", bytes: Buffer.from(proposedText) }],
    { name: options.name, modelType, affectedModels },
  );
  const impacted = withPlanImpact(plan, {
    arguments: {
      affectedModels,
      previousOntology: currentOntology,
      proposedOntology,
      validityBefore: baseline?.project?.validity ?? "unchecked",
      validityAfter: candidate?.project?.validity ?? "unchecked",
      validationComplete: candidate?.project?.validationComplete ?? false,
    },
    impact: (() => {
      const comparison = compareDiagnosticImpact(beforeDiagnostics, afterDiagnostics);
      const identityDiagnostics = comparison.unassessableDiagnostics
        .filter((diagnostic) => diagnostic.code !== "CHECK_SKIPPED")
        .map((diagnostic) => {
          const file = diagnostic.file ?? diagnostic.selector ?? options.name;
          return {
            code: "CHECK_SKIPPED",
            severity: "error" as const,
            message:
              "Affected impact cannot be compared because a diagnostic identity is unstable.",
            file,
            ...(diagnostic.selector ? { selector: diagnostic.selector } : {}),
            check: {
              kind: diagnostic.check?.kind ?? "vocabulary",
              state: "skipped" as const,
              blockedBy: [file],
            },
            details: { reason: "impact_identity_unassessable", identity: { kind: "file" } },
          };
        });
      return {
        baselineErrors: comparison.baselineErrors,
        introducedErrors: comparison.introducedErrors,
        worsenedErrors: comparison.worsenedErrors,
        skippedChecks: [...comparison.skippedChecks, ...identityDiagnostics],
        affectedFiles: needsImpact ? affected.map((resource) => resource.file) : [],
        acceptance: needsImpact || comparison.requiresAcceptance ? ["accept-impact"] : [],
      };
    })(),
  });
  return {
    root,
    plan: impacted,
    diagnostics,
    modelType,
    affectedModels: affectedModels.map((item) => ({
      ...item,
      validityBefore: String(item.validityBefore),
      validityAfter: String(item.validityAfter),
    })),
    projectValidity: candidate?.project?.validity ?? "unchecked",
    validationComplete: candidate?.project?.validationComplete ?? false,
  };
}

export async function publishModelTypeConfiguration(
  prepared: PreparedModelTypeConfiguration,
): Promise<Result> {
  try {
    const diagnostics = prepared.plan.writes.length
      ? await publishPlan(prepared.root, prepared.plan)
      : [];
    return ok(
      {
        applied: true,
        modelType: prepared.modelType,
        affectedModels: prepared.affectedModels,
        changes: prepared.plan.preview.changes,
        projectValidity: prepared.projectValidity,
        validationComplete: prepared.validationComplete,
      },
      [...prepared.diagnostics, ...diagnostics],
    );
  } catch (error) {
    return failure(error);
  }
}

export async function configureModelType(options: ModelTypeConfigurationOptions): Promise<Result> {
  try {
    if (
      options.acceptedPreview !== undefined &&
      !/^sha256:[0-9a-f]{64}$/.test(options.acceptedPreview)
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Accepted preview must be a SHA-256 digest.",
      );
    const prepared = await prepareModelTypeConfiguration(options);
    if (options.acceptedPreview && options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return {
        ...failure(
          new ProjectError(
            "conflict",
            "PREVIEW_CHANGED",
            "The accepted preview changed. Review the current plan.",
          ),
        ),
        data: { applied: false, preview: prepared.plan.preview },
      };
    if (prepared.plan.preview.impact.acceptance.includes("accept-impact") && !options.acceptImpact)
      return {
        ...ok(
          {
            applied: false,
            modelType: prepared.modelType,
            affectedModels: prepared.affectedModels,
            preview: prepared.plan.preview,
            projectValidity: prepared.projectValidity,
            validationComplete: prepared.validationComplete,
          },
          prepared.diagnostics,
        ),
        status: "preview",
      };
    return await publishModelTypeConfiguration(prepared);
  } catch (error) {
    return failure(error);
  }
}
