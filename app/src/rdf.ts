import { Parser, type Quad, Store } from "n3";
import { RdfXmlParser } from "rdfxml-streaming-parser";
import { digest } from "./canonical.ts";
import { ProjectError } from "./output.ts";
import type { LockedFile } from "./schemas.ts";

export async function parseGraph(
  bytes: Uint8Array,
  file: LockedFile,
  vettedDigest?: string,
): Promise<Store> {
  if (digest(bytes) !== file.byte_digest || bytes.byteLength !== file.byte_length)
    throw new ProjectError(
      "invalid",
      "SNAPSHOT_INTEGRITY",
      "Locked snapshot bytes differ from their inventory. Restore the recorded bytes; no automatic fetch is performed.",
      file.key,
    );
  const store = await parseRdf(
    bytes,
    file.media_type,
    file.base_iri,
    file.parser_profile === "rdfxml-vetted-bundle-v1" && file.byte_digest === vettedDigest,
  );
  const declared = classifyGraph(store, file.key);
  if (declared.identity === "declared") {
    if (
      file.classification !== "declared" ||
      file.identity !== "declared" ||
      file.graph_iri !== declared.graphIri ||
      file.kind !== declared.kind
    )
      throw new ProjectError(
        "invalid",
        "GRAPH_CLASSIFICATION",
        "Locked classification or graph identity contradicts RDF declarations.",
        file.key,
      );
  } else if (file.classification === "declared" || file.identity === "declared")
    throw new ProjectError(
      "invalid",
      "GRAPH_CLASSIFICATION",
      "Lock claims a declared root that is absent from its graph.",
      file.key,
    );
  return store;
}

export async function parseRdf(
  bytes: Uint8Array,
  mediaType: string,
  baseIri: string,
  vetted = false,
): Promise<Store> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let quads: Quad[];
  if (mediaType === "application/rdf+xml") {
    if (/<!DOCTYPE|<!ENTITY/i.test(text) && !vetted)
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "DTD-bearing RDF/XML is permitted only for the exact installed vetted P-Plan bytes.",
      );
    const parser = new RdfXmlParser({ baseIRI: baseIri });
    const pending = new Promise<Quad[]>((resolve, reject) => {
      const items: Quad[] = [];
      parser.on("data", (quad: Quad) => items.push(quad));
      parser.on("error", reject);
      parser.on("end", () => resolve(items));
    });
    parser.end(text);
    quads = await pending;
  } else
    quads = new Parser({
      format: mediaType === "text/turtle" ? "Turtle" : "N-Triples",
      baseIRI: baseIri,
    }).parse(text);
  if (
    quads.some(
      (quad) =>
        quad.graph.termType !== "DefaultGraph" ||
        !["NamedNode", "BlankNode"].includes(quad.subject.termType) ||
        !["NamedNode", "BlankNode", "Literal"].includes(quad.object.termType),
    )
  )
    throw new ProjectError(
      "invalid",
      "RDF_FORMAT_UNSUPPORTED",
      "Only RDF 1.1 single graphs are supported.",
    );
  return new Store(quads);
}

export function classifyGraph(
  store: Store,
  selector: string,
): { kind: string; classification: string; identity: "declared" | "generated"; graphIri: string } {
  const metadata = "https://talby.ai/ontology/tbspec#";
  const kinds: Record<string, string[]> = {
    "http://www.w3.org/2002/07/owl#Ontology": ["ontology"],
    [`${metadata}Model`]: ["model"],
    [`${metadata}DataModel`]: ["model", "data-model"],
    [`${metadata}ConceptualDataModel`]: ["model", "data-model", "conceptual-data-model"],
    [`${metadata}ConcreteDataModel`]: ["model", "data-model", "concrete-data-model"],
    [`${metadata}ProcessModel`]: ["model", "process-model"],
    [`${metadata}StateMachineModel`]: ["model", "state-machine-model"],
    [`${metadata}VisualDesignModel`]: ["design"],
    [`${metadata}ShapesGraph`]: ["shapes"],
    [`${metadata}ViewModel`]: ["view"],
    [`${metadata}PresentationGraph`]: ["presentation"],
  };
  const roots = new Map<string, string[][]>();
  for (const quad of store)
    if (
      quad.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
      quad.object.termType === "NamedNode" &&
      kinds[quad.object.value]
    ) {
      if (quad.subject.termType !== "NamedNode")
        throw new ProjectError(
          "invalid",
          "GRAPH_CLASSIFICATION",
          "Managed graph roots must be IRIs.",
          selector,
        );
      const existing = roots.get(quad.subject.value) ?? [];
      existing.push(kinds[quad.object.value] ?? []);
      roots.set(quad.subject.value, existing);
    }
  if (roots.size > 1)
    throw new ProjectError(
      "invalid",
      "GRAPH_CLASSIFICATION",
      "Multiple managed graph roots are ambiguous.",
      selector,
    );
  const declared = [...roots.entries()][0];
  if (declared) {
    const paths = declared[1].sort((a, b) => b.length - a.length);
    const specific = paths[0] ?? [];
    if (paths.some((path) => path.some((kind, index) => specific[index] !== kind)))
      throw new ProjectError(
        "invalid",
        "GRAPH_CLASSIFICATION",
        "Managed root has incompatible kinds.",
        selector,
      );
    const kind = specific.at(-1) ?? "model";
    return {
      kind: kind === "data-model" ? "model" : kind,
      classification: "declared",
      identity: "declared",
      graphIri: declared[0],
    };
  }
  return {
    kind: "unclassified",
    classification: "unclassified",
    identity: "generated",
    graphIri: `urn:tbspec:graph:${digest(selector).slice(7)}`,
  };
}
