import { DataFactory, Parser, Store } from "n3";
import { Validator } from "shacl-engine";
import { validations } from "shacl-engine/sparql.js";
import { ProjectError } from "./output.ts";
import { parseGraph } from "./rdf.ts";
import { loadStarters } from "./starters.ts";

export async function validateStarterGraph(
  type: string,
  source: string,
): Promise<{ conforms: boolean; problems: { shape: string; message: string }[] }> {
  if (!["data", "process", "state-machine"].includes(type))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Unknown built-in starter type.",
    );
  const bundle = await loadStarters();
  const shapes = new Store();
  const data = new Store(new Parser({ format: "Turtle" }).parse(source));
  const metadata = bundle.lock.dependencies["tbspec-metadata"];
  const selected = bundle.lock.dependencies[`tbspec-${type === "data" ? "metadata" : type}`];
  if (!metadata || !selected) throw new Error("Missing installed starter resources.");
  for (const dependency of new Set([metadata, selected]))
    for (const file of dependency.files) {
      const bytes = bundle.files[`${dependency.snapshot_path}/${file.key}`];
      if (!bytes) throw new Error("Missing bundle asset.");
      const graph = await parseGraph(bytes, file, bundle.vettedDigest);
      if (file.kind === "shapes") shapes.addQuads([...graph]);
      else
        for (const quad of graph.getQuads(null, null, null, null))
          if (
            [
              "http://www.w3.org/2000/01/rdf-schema#subClassOf",
              "http://www.w3.org/2000/01/rdf-schema#subPropertyOf",
            ].includes(quad.predicate.value)
          ) {
            data.addQuads([quad]);
            shapes.addQuads([quad]);
          }
    }
  // Only trusted immutable bundled SELECT constraints run here, over an in-memory local dataset.
  const validator = new Validator(shapes, {
    factory: { ...DataFactory, dataset: () => new Store() },
    validations,
  });
  const report = await validator.validate({ dataset: data });
  const problems = report.results.map((result) => ({
    shape: result.shape.ptr.term.value,
    message: result.message.map((message) => message.value).join("; "),
  }));
  // Renderer conversion is deliberately an application guard, separate from SHACL datatype validity.
  for (const quad of data)
    if (
      ["x", "y", "fontSize", "strokeWidth"].some(
        (field) => quad.predicate.value === `https://talby.ai/ontology/tbspec#${field}`,
      ) &&
      quad.object.termType === "Literal" &&
      !Number.isFinite(Number(quad.object.value))
    )
      problems.push({
        shape: "application:finite-number",
        message: "Numeric style or coordinate is nonfinite or unrepresentable.",
      });
  return { conforms: problems.length === 0, problems };
}
