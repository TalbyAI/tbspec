import { utf8Compare } from "./canonical.ts";
import { captureInspection, inspectSnapshot } from "./inspection.ts";
import { failure, ProjectError, type Result } from "./output.ts";
import { discoverProject } from "./project.ts";
import { parseLock, selector } from "./schemas.ts";

const t = "https://talby.ai/ontology/tbspec#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const nodeRule = `${t}NodeVisualRule`;
const edgeRule = `${t}EdgeVisualRule`;
const appearanceFields = [
  "nodeShape",
  "fillColor",
  "strokeColor",
  "textColor",
  "strokeWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineStyle",
  "edgeRouting",
  "arrowHead",
  "labelMode",
  "labelProperty",
  "labelText",
];

function selectedDesign(value: string, lock: ReturnType<typeof parseLock>) {
  const selected = selector(value.startsWith("dep:") ? value.replaceAll("\\", "/") : value);
  if (!selected.startsWith("dep:")) return selected;
  const [id, ...parts] = selected.slice(4).split("/");
  const dependency = lock.dependencies[id ?? ""];
  const key = parts.join("/") || dependency?.primary;
  if (!dependency?.files.some((file) => file.key === key && file.kind === "design"))
    throw new ProjectError("invalid", "RESOURCE_MISSING", "Selected design is unavailable.");
  return `dep:${id}/${key}`;
}

export async function listDesigns(options: { project?: string; cwd?: string }): Promise<Result> {
  try {
    const root = await discoverProject(options);
    const snapshot = await captureInspection(root, "graph.list");
    const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    const listed = await inspectSnapshot(root, snapshot, { project: root, command: "graph.list" });
    const owned = (listed.data?.items ?? []).filter((resource) => resource.kind === "design");
    const locked = Object.entries(lock.dependencies).flatMap(([id, dependency]) =>
      dependency.files
        .filter((file) => file.kind === "design")
        .map((file) => ({
          selector: file.key === dependency.primary ? `dep:${id}` : `dep:${id}/${file.key}`,
          file: `${dependency.snapshot_path}/${file.key}`,
          graphIri: file.graph_iri,
          kind: "design",
          ownership: "dependency",
          dependencyId: id,
          revision: { state: "present", digest: file.byte_digest },
        })),
    );
    return {
      ...listed,
      data: { items: [...owned, ...locked].sort((a, b) => utf8Compare(a.selector, b.selector)) },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function showDesign(options: {
  project?: string;
  cwd?: string;
  selector: string;
}): Promise<Result> {
  try {
    const root = await discoverProject(options);
    const snapshot = await captureInspection(root, "graph.show");
    const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    const selected = selectedDesign(options.selector, lock);
    const graphSnapshot = await captureInspection(root, "graph.show", selected);
    const shown = await inspectSnapshot(root, graphSnapshot, {
      project: root,
      command: "graph.show",
      selector: selected,
    });
    const resource = shown.data?.resource;
    if (resource?.kind !== "design")
      throw new ProjectError(
        "invalid",
        "GRAPH_CLASSIFICATION",
        "Selector is not a visual design model.",
        resource?.file ?? selected,
      );
    const triples = shown.data?.triples ?? [];
    const rules = triples
      .filter(
        (triple) =>
          triple.subject.kind === "iri" &&
          triple.subject.value === resource.graphIri &&
          triple.predicate.value === `${t}rule` &&
          triple.object.kind === "iri",
      )
      .map((triple) => {
        const iri = triple.object.value;
        const statements = triples.filter(
          (candidate) => candidate.subject.kind === "iri" && candidate.subject.value === iri,
        );
        const types = statements
          .filter(
            (candidate) => candidate.predicate.value === rdfType && candidate.object.kind === "iri",
          )
          .map((candidate) => candidate.object.value);
        const targetConcept = statements.find(
          (candidate) => candidate.predicate.value === `${t}targetConcept`,
        )?.object;
        return {
          iri,
          kind: types.includes(nodeRule) ? "node" : types.includes(edgeRule) ? "edge" : "invalid",
          targetConcept: targetConcept?.kind === "iri" ? targetConcept.value : null,
          appearance: Object.fromEntries(
            statements.flatMap((candidate) => {
              const predicate = candidate.predicate.value;
              if (
                typeof predicate !== "string" ||
                candidate.predicate.kind !== "iri" ||
                !predicate.startsWith(t)
              )
                return [];
              const field = predicate.slice(t.length);
              return appearanceFields.includes(field) ? [[field, candidate.object]] : [];
            }),
          ),
        };
      })
      .sort((left, right) => utf8Compare(String(left.iri), String(right.iri)));
    return { ...shown, data: { ...shown.data, rules } };
  } catch (error) {
    return failure(error);
  }
}
