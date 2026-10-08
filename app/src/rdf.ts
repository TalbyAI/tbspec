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
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let quads: Quad[];
  if (file.media_type === "application/rdf+xml") {
    if (
      /<!DOCTYPE|<!ENTITY/i.test(text) &&
      (file.parser_profile !== "rdfxml-vetted-bundle-v1" || file.byte_digest !== vettedDigest)
    )
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "DTD-bearing RDF/XML is permitted only for the exact installed vetted P-Plan bytes.",
        file.key,
      );
    const parser = new RdfXmlParser({ baseIRI: file.base_iri });
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
      format: file.media_type === "text/turtle" ? "Turtle" : "N-Triples",
      baseIRI: file.base_iri,
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
      file.key,
    );
  const store = new Store(quads);
  const metadata = "https://talby.ai/ontology/tbspec#";
  const kinds: Record<string, string[]> = {
    "http://www.w3.org/2002/07/owl#Ontology": ["ontology"],
    [`${metadata}Model`]: [
      "model",
      "conceptual-data-model",
      "concrete-data-model",
      "process-model",
      "state-machine-model",
    ],
    [`${metadata}DataModel`]: ["conceptual-data-model", "concrete-data-model"],
    [`${metadata}ConceptualDataModel`]: ["conceptual-data-model"],
    [`${metadata}ConcreteDataModel`]: ["concrete-data-model"],
    [`${metadata}ProcessModel`]: ["process-model"],
    [`${metadata}StateMachineModel`]: ["state-machine-model"],
    [`${metadata}VisualDesignModel`]: ["design"],
    [`${metadata}ShapesGraph`]: ["shapes"],
    [`${metadata}ViewModel`]: ["view"],
    [`${metadata}PresentationGraph`]: ["presentation"],
  };
  const roots = new Map<string, string[][]>();
  for (const quad of quads)
    if (
      quad.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
      kinds[quad.object.value]
    ) {
      if (quad.subject.termType !== "NamedNode")
        throw new ProjectError(
          "invalid",
          "GRAPH_CLASSIFICATION",
          "Managed graph roots must be IRIs.",
          file.key,
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
      file.key,
    );
  const declared = [...roots.entries()][0];
  if (declared) {
    if (
      file.classification !== "declared" ||
      file.identity !== "declared" ||
      file.graph_iri !== declared[0] ||
      declared[1].some((allowed) => !allowed.includes(file.kind))
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
