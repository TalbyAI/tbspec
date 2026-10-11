import { randomUUID } from "node:crypto";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { BindingsFactory } from "@comunica/utils-bindings-factory";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, type Term as N3Term, Store } from "n3";
import { Validator } from "shacl-engine";

const sh = "http://www.w3.org/ns/shacl#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const key = (term: Term) =>
  JSON.stringify([
    term.termType,
    term.value,
    term.termType === "Literal" ? term.language : "",
    term.termType === "Literal" ? term.datatype.value : "",
  ]);
const distinct = (terms: Term[]) => [...new Map(terms.map((term) => [key(term), term])).values()];

interface Pointer {
  term: Term;
  dataset: Store;
  node(terms: Term[]): Pointer;
}
interface ConstraintContext {
  focusNode: Pointer;
  violation(
    component: Term,
    args: { args: Record<string, Term>; message: Term[]; value: Pointer },
  ): void;
}

/** Adapt the pinned engine's Core traversal and SELECT extension without adding inferred data. */
export async function runShapes(prepared: Store, data: Store) {
  const shapes = new Store([...prepared]);
  const paths = new Map<string, Term>();
  const object = (term: Term, predicate: string) => shapes.getObjects(term, predicate, null)[0];
  function list(head: Term): Term[] {
    const result: Term[] = [];
    while (head.value !== `${rdf}nil`) {
      const item = object(head, `${rdf}first`);
      const rest = object(head, `${rdf}rest`);
      if (!item || !rest) throw new Error("Path was not preflighted.");
      result.push(item);
      head = rest;
    }
    return result;
  }
  function follow(seeds: Term[], path: Term, reverse = false): Term[] {
    if (path.termType === "NamedNode")
      return distinct(
        seeds.flatMap((seed) =>
          reverse ? data.getSubjects(path, seed, null) : data.getObjects(seed, path, null),
        ),
      );
    if (object(path, `${rdf}first`)) {
      const steps = list(path);
      return (reverse ? steps.reverse() : steps).reduce(
        (terms, step) => follow(terms, step, reverse),
        seeds,
      );
    }
    const inverse = object(path, `${sh}inversePath`);
    if (inverse) return follow(seeds, inverse, !reverse);
    const alternative = object(path, `${sh}alternativePath`);
    if (alternative)
      return distinct(list(alternative).flatMap((step) => follow(seeds, step, reverse)));
    const optional = object(path, `${sh}zeroOrOnePath`);
    if (optional) return distinct([...seeds, ...follow(seeds, optional, reverse)]);
    const zero = object(path, `${sh}zeroOrMorePath`);
    const repeated = zero ?? object(path, `${sh}oneOrMorePath`);
    if (!repeated) throw new Error("Path was not preflighted.");
    const values = new Map((zero ? seeds : []).map((term) => [key(term), term]));
    let frontier = seeds;
    while (frontier.length) {
      const next = follow(frontier, repeated, reverse).filter((term) => !values.has(key(term)));
      for (const term of next) values.set(key(term), term);
      frontier = next;
    }
    return [...values.values()];
  }
  // Complex paths are virtual match requests. Iteration and unrestricted queries see only real quads.
  for (const statement of shapes.getQuads(null, `${sh}path`, null, null))
    if (statement.object.termType === "BlankNode") {
      const predicate = DataFactory.namedNode(`urn:tbspec:path:${randomUUID()}`);
      paths.set(predicate.value, statement.object);
      shapes.removeQuad(statement);
      shapes.addQuad(statement.subject, statement.predicate, predicate);
    }
  class PathDataset extends Store {
    override match(
      subject?: N3Term | null,
      predicate?: N3Term | null,
      value?: N3Term | null,
      graph?: N3Term | null,
    ): ReturnType<Store["match"]> {
      const path = predicate ? paths.get(predicate.value) : undefined;
      if (!path) return super.match(subject, predicate, value, graph);
      if (graph && graph.termType !== "DefaultGraph") return new Store().match();
      const seeds = subject ? [subject] : distinct([...data].flatMap((q) => [q.subject, q.object]));
      const quads: Quad[] = [];
      for (const seed of seeds)
        for (const target of follow([seed], path))
          if (!value || value.equals(target))
            quads.push(
              DataFactory.quad(
                seed as Quad["subject"],
                predicate as Quad["predicate"],
                target as Quad["object"],
              ),
            );
      return new Store(quads).match();
    }
  }
  const dataset = paths.size ? new PathDataset([...data]) : data;
  const engine = new QueryEngine();
  const bindings = new BindingsFactory(DataFactory);
  const localSparql = DataFactory.namedNode(`urn:tbspec:sparql:${randomUUID()}`);
  const queries = new Map<string, { query: string; messages: Term[] }[]>();
  for (const statement of shapes.getQuads(null, `${sh}sparql`, null, null)) {
    const query = object(statement.object, `${sh}select`);
    if (!query) throw new Error("Query was not preflighted.");
    const constraints = queries.get(key(statement.subject)) ?? [];
    constraints.push({
      query: query.value,
      messages: shapes.getObjects(statement.object, `${sh}message`, null),
    });
    queries.set(key(statement.subject), constraints);
    shapes.removeQuad(statement);
    shapes.addQuad(statement.subject, localSparql, statement.object);
  }
  const compile = (shape: { ptr: { term: Term } }) => {
    const validate = async (context: ConstraintContext) => {
      for (const constraint of queries.get(key(shape.ptr.term)) ?? []) {
        const stream = await engine.queryBindings(constraint.query, {
          sources: [data],
          initialBindings: bindings.fromRecord({ this: context.focusNode.term }),
        });
        for (const row of await stream.toArray())
          context.violation(DataFactory.namedNode(`${sh}SPARQLConstraintComponent`), {
            args: Object.fromEntries([...row].map(([variable, term]) => [variable.value, term])),
            message: constraint.messages,
            value: context.focusNode.node([row.get("value") ?? context.focusNode.term]),
          });
      }
    };
    // The stock extension bypasses Core property traversal. This registered parameter runs once per focus.
    return { node: validate, property: validate };
  };
  return new Validator(shapes, {
    factory: { ...DataFactory, dataset: () => new Store() },
    validations: new Map([[localSparql, compile]]),
  }).validate({ dataset });
}
