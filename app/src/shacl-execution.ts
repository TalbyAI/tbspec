import { randomUUID } from "node:crypto";
import type { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import type { BindingsFactory } from "@comunica/utils-bindings-factory";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, type Term as N3Term, Store } from "n3";
import { Validator } from "shacl-engine";
import { compileXPathPattern } from "./shacl-regex.ts";

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

interface EnginePointer extends Pointer {
  terms: Term[];
  value: string;
  out(terms: Term[]): EnginePointer;
  in(terms: Term[]): EnginePointer;
  list(): EnginePointer[];
  node(terms: Term[]): EnginePointer;
  [Symbol.iterator](): Iterator<EnginePointer>;
}

interface EngineReport {
  conforms: boolean;
  results: unknown[];
}

interface EngineShape {
  ptr: EnginePointer;
  validator: { shape(pointer: EnginePointer): EngineShape };
  validate(context: EngineContext): Promise<{ report: EngineReport }>;
}

interface EngineContext {
  focusNode: EnginePointer;
  valueOrNode: EnginePointer;
  values: EnginePointer;
  shape: EngineShape;
  options: { debug?: boolean; details?: boolean };
  create(options: { child?: boolean; focusNode?: EnginePointer }): EngineContext;
  test(success: boolean, component: Term, args?: Record<string, unknown>): void;
  violation(component: Term, args?: Record<string, unknown>): void;
  debug(component: Term, args?: Record<string, unknown>): void;
}

interface EngineConstraintShape {
  ptr: EnginePointer;
  validator: { shape(pointer: EnginePointer): EngineShape };
}

type EngineValidation = {
  generic?: (context: EngineContext) => void | Promise<void>;
  property?: (context: EngineContext) => void | Promise<void>;
  node?: (context: EngineContext) => void | Promise<void>;
};

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
  let queryContext: Promise<{ engine: QueryEngine; bindings: BindingsFactory }> | undefined;
  const queryBindings = async (query: string, values: Record<string, Term>) => {
    queryContext ??= Promise.all([
      import("@comunica/query-sparql-rdfjs-lite"),
      import("@comunica/utils-bindings-factory"),
    ]).then(([{ QueryEngine }, { BindingsFactory }]) => ({
      engine: new QueryEngine(),
      bindings: new BindingsFactory(DataFactory),
    }));
    const { engine, bindings } = await queryContext;
    return engine.queryBindings(query, {
      sources: [data],
      initialBindings: bindings.fromRecord(values),
    });
  };
  const localSparql = DataFactory.namedNode(`urn:tbspec:sparql:${randomUUID()}`);
  const queries = new Map<string, { query: string; messages: Term[] }[]>();
  for (const statement of shapes.getQuads(null, `${sh}sparql`, null, null)) {
    const deactivated = object(statement.object, `${sh}deactivated`);
    if (!deactivated || !["true", "1"].includes(deactivated.value)) {
      const query = object(statement.object, `${sh}select`);
      if (!query) throw new Error("Query was not preflighted.");
      const constraints = queries.get(key(statement.subject)) ?? [];
      constraints.push({
        query: query.value,
        messages: shapes.getObjects(statement.object, `${sh}message`, null),
      });
      queries.set(key(statement.subject), constraints);
    }
    shapes.removeQuad(statement);
    if (!deactivated || !["true", "1"].includes(deactivated.value))
      shapes.addQuad(statement.subject, localSparql, statement.object);
  }
  const compile = (shape: { ptr: { term: Term } }) => {
    const validate = async (context: ConstraintContext) => {
      for (const constraint of queries.get(key(shape.ptr.term)) ?? []) {
        const stream = await queryBindings(constraint.query, { this: context.focusNode.term });
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
  const parameter = (shape: EngineConstraintShape, name: string) =>
    shape.ptr.out([DataFactory.namedNode(`${sh}${name}`)]).term;
  const listValues = (head: Term): Term[] => {
    const values: Term[] = [];
    let current = head;
    while (current.value !== `${rdf}nil`) {
      const item = shapes.getObjects(current, `${rdf}first`, null)[0];
      const rest = shapes.getObjects(current, `${rdf}rest`, null)[0];
      if (!item || !rest) throw new Error("List was not preflighted.");
      values.push(item);
      current = rest;
    }
    return values;
  };
  const comparisons = new Map<string, boolean | null>();
  const compare = async (
    left: Term,
    operator: "<" | "<=" | ">" | ">=",
    right: Term,
  ): Promise<boolean | null> => {
    const xsd = "http://www.w3.org/2001/XMLSchema#";
    if (left.termType === "Literal" && right.termType === "Literal") {
      const leftDateTime = left.datatype.value === `${xsd}dateTime`;
      const rightDateTime = right.datatype.value === `${xsd}dateTime`;
      if (leftDateTime && rightDateTime) {
        const timezone = /(?:Z|[+-]\d{2}:\d{2})$/;
        if (timezone.test(left.value) !== timezone.test(right.value)) return null;
      }
      if (left.datatype.value === `${xsd}string` && right.datatype.value === `${xsd}string`) {
        const leftCodepoints = [...left.value].map(
          (character) => character.codePointAt(0) as number,
        );
        const rightCodepoints = [...right.value].map(
          (character) => character.codePointAt(0) as number,
        );
        let order = 0;
        for (
          let index = 0;
          index < Math.min(leftCodepoints.length, rightCodepoints.length);
          index++
        ) {
          const leftCodepoint = leftCodepoints[index] as number;
          const rightCodepoint = rightCodepoints[index] as number;
          if (leftCodepoint !== rightCodepoint) {
            order = leftCodepoint < rightCodepoint ? -1 : 1;
            break;
          }
        }
        if (!order) order = Math.sign(leftCodepoints.length - rightCodepoints.length);
        return operator === "<"
          ? order < 0
          : operator === "<="
            ? order <= 0
            : operator === ">"
              ? order > 0
              : order >= 0;
      }
    }
    const comparisonKey = JSON.stringify([key(left), operator, key(right)]);
    const cached = comparisons.get(comparisonKey);
    if (cached !== undefined) return cached;
    try {
      const stream = await queryBindings(`SELECT (?left ${operator} ?right AS ?result) WHERE {}`, {
        left,
        right,
      });
      const result = (await stream.toArray())[0]?.get("result");
      const valid =
        result?.termType === "Literal" &&
        result.datatype.value === "http://www.w3.org/2001/XMLSchema#boolean"
          ? result.value === "true" || result.value === "1"
          : null;
      if (comparisonKey.length <= 2048 && comparisons.size < 256)
        comparisons.set(comparisonKey, valid);
      return valid;
    } catch {
      return null;
    }
  };
  const component = (name: string) =>
    DataFactory.namedNode(sh + name[0]?.toUpperCase() + name.slice(1) + "ConstraintComponent");
  const message = (text: string) => [DataFactory.literal(text)];
  const compileRange = (
    shape: EngineConstraintShape,
    name: "maxExclusive" | "maxInclusive" | "minExclusive" | "minInclusive",
    operator: "<" | "<=" | ">" | ">=",
    text: string,
  ): EngineValidation => {
    const limit = parameter(shape, name);
    if (!limit) throw new Error(`Missing ${name} parameter after preflight.`);
    return {
      generic: async (context) => {
        const valid = await compare(context.valueOrNode.term, operator, limit);
        context.test(valid === true, component(name), {
          args: { [name]: limit },
          message: message(text),
          value: context.valueOrNode,
        });
      },
    };
  };
  const compileLanguageIn = (shape: EngineConstraintShape): EngineValidation => {
    const head = parameter(shape, "languageIn");
    if (!head) throw new Error("Missing languageIn parameter after preflight.");
    const ranges = listValues(head).map((term) => term.value.toLowerCase());
    return {
      generic: (context) => {
        const value = context.valueOrNode.term;
        const language = value.termType === "Literal" ? value.language.toLowerCase() : "";
        const matched =
          Boolean(language) &&
          ranges.some(
            (range) => range === "*" || language === range || language.startsWith(`${range}-`),
          );
        context.test(matched, component("LanguageIn"), {
          args: { languageIn: ranges.join(", ") },
          message: message("Language does not match any of {$languageIn}"),
          value: context.valueOrNode,
        });
      },
    };
  };
  const compileLength = (
    shape: EngineConstraintShape,
    name: "minLength" | "maxLength",
  ): EngineValidation => {
    const countTerm = parameter(shape, name);
    if (!countTerm) throw new Error(`Missing ${name} parameter after preflight.`);
    const count = Number(countTerm.value);
    const maximum = name === "maxLength";
    return {
      generic: (context) => {
        const value = context.valueOrNode.term;
        const length = [...value.value].length;
        const valid =
          value.termType !== "BlankNode" && (maximum ? length <= count : length >= count);
        context.test(valid, component(name), {
          args: { [name]: count },
          message: message(
            maximum
              ? "Value has more than {$maxLength} characters"
              : "Value has less than {$minLength} characters",
          ),
          value: context.valueOrNode,
        });
      },
    };
  };
  const compilePattern = (shape: EngineConstraintShape): EngineValidation => {
    const patternTerm = parameter(shape, "pattern");
    const flagsTerm = parameter(shape, "flags");
    if (!patternTerm) throw new Error("Missing pattern parameter after preflight.");
    const pattern = patternTerm.value;
    const flags = flagsTerm?.value ?? "";
    const matches = compileXPathPattern(pattern, flags);
    return {
      generic: (context) => {
        const value = context.valueOrNode.term;
        context.test(value.termType !== "BlankNode" && matches(value.value), component("Pattern"), {
          args: { flags, pattern },
          message: message('Value does not match pattern "{$pattern}"'),
          value: context.valueOrNode,
        });
      },
    };
  };
  const compileUniqueLang = (shape: EngineConstraintShape): EngineValidation | null => {
    const enabled = parameter(shape, "uniqueLang");
    if (!enabled || !["true", "1"].includes(enabled.value)) return null;
    return {
      property: (context) => {
        const counts = new Map<string, number>();
        for (const value of context.values) {
          const language =
            value.term.termType === "Literal" ? value.term.language.toLowerCase() : "";
          if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
        }
        const duplicates = [...counts].filter(([, count]) => count > 1);
        for (const [language] of duplicates)
          context.violation(component("UniqueLang"), {
            args: { lang: language },
            message: message('Language "{?lang}" used more than once'),
          });
        if (!duplicates.length) context.debug(component("UniqueLang"));
      },
    };
  };
  const compileHasValue = (shape: EngineConstraintShape): EngineValidation => {
    const required = shape.ptr.out([DataFactory.namedNode(sh + "hasValue")]).terms;
    return {
      node: (context) => {
        for (const hasValue of required)
          context.test(hasValue.equals(context.valueOrNode.term), component("HasValue"), {
            args: { hasValue },
            message: message("Value must be {$hasValue}"),
          });
      },
      property: (context) => {
        for (const hasValue of required) {
          const present = context.values.terms.some((value) => value.equals(hasValue));
          context.test(present, component("HasValue"), {
            args: { hasValue },
            message: message("Missing expected value {$hasValue}"),
          });
        }
      },
    };
  };
  const compileEquals = (shape: EngineConstraintShape): EngineValidation => {
    const predicates = shape.ptr.out([DataFactory.namedNode(sh + "equals")]).terms;
    return {
      node: (context) => {
        for (const predicate of predicates) {
          const value = context.valueOrNode.term;
          const references = distinct(context.focusNode.out([predicate]).terms);
          const referenceKeys = new Set(references.map(key));
          context.test(referenceKeys.has(key(value)), component("Equals"), {
            args: { equals: predicate },
            message: message("Must have same values as {$equals}"),
            value: context.valueOrNode,
          });
          for (const reference of references) {
            if (key(reference) === key(value)) continue;
            context.violation(component("Equals"), {
              args: { equals: predicate },
              message: message("Must have same values as {$equals}"),
              value: context.focusNode.node([reference]),
            });
          }
        }
      },
      property: (context) => {
        for (const predicate of predicates) {
          const references = distinct(context.focusNode.out([predicate]).terms);
          const values = distinct(context.values.terms);
          const referenceKeys = new Set(references.map(key));
          const valueKeys = new Set(values.map(key));
          const differences = [
            ...values.filter((value) => !referenceKeys.has(key(value))),
            ...references.filter((value) => !valueKeys.has(key(value))),
          ];
          for (const value of differences)
            context.violation(component("Equals"), {
              args: { equals: predicate },
              message: message("Must have same values as {$equals}"),
              value: context.focusNode.node([value]),
            });
          if (!differences.length)
            context.debug(component("Equals"), {
              args: { equals: predicate },
              message: message("Must have same values as {$equals}"),
            });
        }
      },
    };
  };
  const compileDisjoint = (shape: EngineConstraintShape): EngineValidation => {
    const predicates = shape.ptr.out([DataFactory.namedNode(sh + "disjoint")]).terms;
    return {
      generic: (context) => {
        for (const predicate of predicates) {
          const overlaps =
            context.focusNode.dataset.match(
              context.focusNode.term as N3Term,
              predicate as N3Term,
              context.valueOrNode.term as N3Term,
            ).size > 0;
          context.test(!overlaps, component("Disjoint"), {
            args: { disjoint: predicate },
            message: message("Value node must not also be one of the values of {$disjoint}"),
            value: context.valueOrNode,
          });
        }
      },
    };
  };
  const compileClosed = (shape: EngineConstraintShape): EngineValidation | null => {
    const closed = parameter(shape, "closed");
    if (!closed || !["true", "1"].includes(closed.value)) return null;
    const allowed = new Set<string>();
    for (const propertyShape of shapes.getObjects(shape.ptr.term, sh + "property", null)) {
      const path = shapes.getObjects(propertyShape, sh + "path", null)[0];
      if (path?.termType === "NamedNode") allowed.add(key(path));
    }
    const ignoredHead = parameter(shape, "ignoredProperties");
    const ignored = new Set(ignoredHead ? listValues(ignoredHead).map(key) : []);
    return {
      generic: (context) => {
        const valueNode = context.valueOrNode;
        const quads = valueNode.dataset.getQuads(
          valueNode.term as Quad["subject"],
          null,
          null,
          null,
        );
        let violations = 0;
        for (const quad of quads) {
          if (allowed.has(key(quad.predicate)) || ignored.has(key(quad.predicate))) continue;
          violations++;
          context.violation(component("Closed"), {
            args: { closed, path: quad.predicate },
            message: message("Predicate is not allowed (closed shape)"),
            path: [
              {
                quantifier: "one",
                start: "subject",
                end: "object",
                predicates: [quad.predicate],
              },
            ],
            value: valueNode.node([quad.object]),
          });
        }
        if (!violations) context.debug(component("Closed"));
      },
    };
  };
  const compileLogical = (
    shape: EngineConstraintShape,
    name: "and" | "or" | "xone" | "not",
  ): EngineValidation => {
    const parameters = shape.ptr.out([DataFactory.namedNode(sh + name)]).terms;
    const groups = name === "not" ? parameters.map((term) => [term]) : parameters.map(listValues);
    const groupShapes = groups.map((group) =>
      group.map((term) => shape.validator.shape(shape.ptr.node([term]))),
    );
    return {
      generic: async (context) => {
        for (const [groupIndex, shapesInGroup] of groupShapes.entries()) {
          const reports: EngineReport[] = [];
          for (const child of shapesInGroup) {
            reports.push(
              (
                await child.validate(
                  context.create({ child: true, focusNode: context.valueOrNode }),
                )
              ).report,
            );
            if (
              name === "or" &&
              reports.at(-1)?.conforms &&
              !context.options.debug &&
              !context.options.details
            )
              break;
          }
          const conforms = reports.map((report) => report.conforms);
          const valid =
            name === "not"
              ? !conforms[0]
              : name === "and"
                ? conforms.every(Boolean)
                : name === "or"
                  ? conforms.some(Boolean)
                  : conforms.filter(Boolean).length === 1;
          context.test(valid, component(name), {
            args: name === "not" ? { not: groups[groupIndex]?.[0] as Term } : {},
            message: name === "not" ? message("Value does have shape {$not}") : [],
            results: reports.flatMap((report) => report.results),
            value: context.valueOrNode,
          });
        }
      },
    };
  };
  const compileQualifiedShape = (shape: EngineConstraintShape): EngineValidation => {
    const valueShapeTerms = shape.ptr.out([
      DataFactory.namedNode(sh + "qualifiedValueShape"),
    ]).terms;
    const minTerms = shape.ptr.out([DataFactory.namedNode(sh + "qualifiedMinCount")]).terms;
    const maxTerms = shape.ptr.out([DataFactory.namedNode(sh + "qualifiedMaxCount")]).terms;
    const disjoint = shape.ptr
      .out([DataFactory.namedNode(sh + "qualifiedValueShapesDisjoint")])
      .terms.some((term) => ["true", "1"].includes(term.value));
    if (!valueShapeTerms.length || (!minTerms.length && !maxTerms.length)) return {};
    const ownTerms = new Set(valueShapeTerms.map(key));
    const qualified = valueShapeTerms.map((valueShapeTerm) => {
      const valueShape = shape.validator.shape(shape.ptr.node([valueShapeTerm]));
      const siblingTerms = disjoint
        ? distinct(
            shapes
              .getSubjects(sh + "property", shape.ptr.term, null)
              .flatMap((parent) => shapes.getObjects(parent, sh + "property", null))
              .filter((sibling) => !sibling.equals(shape.ptr.term))
              .flatMap((sibling) => shapes.getObjects(sibling, sh + "qualifiedValueShape", null))
              .filter((term) => !ownTerms.has(key(term))),
          )
        : [];
      return {
        valueShapeTerm,
        valueShape,
        siblings: siblingTerms.map((term) => shape.validator.shape(shape.ptr.node([term]))),
      };
    });
    return {
      property: async (context) => {
        for (const { valueShapeTerm, valueShape, siblings } of qualified) {
          const resultsDeep: unknown[] = [];
          let count = 0;
          for (const value of context.values) {
            const report = (
              await valueShape.validate(context.create({ child: true, focusNode: value }))
            ).report;
            resultsDeep.push(...report.results);
            if (!report.conforms) continue;
            let matchesSibling = false;
            if (context.options.debug || context.options.details) {
              const reports = await Promise.all(
                siblings.map(
                  async (sibling) =>
                    (await sibling.validate(context.create({ child: true, focusNode: value })))
                      .report,
                ),
              );
              resultsDeep.push(...reports.flatMap((siblingReport) => siblingReport.results));
              matchesSibling = reports.some((siblingReport) => siblingReport.conforms);
            } else {
              for (const sibling of siblings) {
                const siblingReport = (
                  await sibling.validate(context.create({ child: true, focusNode: value }))
                ).report;
                if (siblingReport.conforms) {
                  matchesSibling = true;
                  break;
                }
              }
            }
            if (!matchesSibling) count++;
          }
          for (const maxTerm of maxTerms) {
            const maxCount = Number(maxTerm.value);
            context.test(count <= maxCount, component("QualifiedMaxCount"), {
              args: {
                qualifiedMaxCount: maxCount,
                qualifiedValueShape: valueShapeTerm,
                qualifiedValueShapesDisjoint: disjoint,
              },
              message: message(
                "More than {$qualifiedMaxCount} values have shape {$qualifiedValueShape}",
              ),
              results: resultsDeep,
            });
          }
          for (const minTerm of minTerms) {
            const minCount = Number(minTerm.value);
            context.test(count >= minCount, component("QualifiedMinCount"), {
              args: {
                qualifiedMinCount: minCount,
                qualifiedValueShape: valueShapeTerm,
                qualifiedValueShapesDisjoint: disjoint,
              },
              message: message(
                "Less than {$qualifiedMinCount} values have shape {$qualifiedValueShape}",
              ),
              results: resultsDeep,
            });
          }
        }
      },
    };
  };
  const compileLessThan = (
    shape: EngineConstraintShape,
    name: "lessThan" | "lessThanOrEquals",
  ): EngineValidation => {
    const predicates = shape.ptr.out([DataFactory.namedNode(sh + name)]).terms;
    if (!predicates.length) throw new Error(`Missing ${name} parameter after preflight.`);
    const equal = name === "lessThanOrEquals";
    const constraintComponent = component(equal ? "LessThanOrEquals" : "LessThan");
    const text = equal
      ? "Value is not less than or equal to value of {$lessThanOrEquals}"
      : "Value is not less than value of {$lessThan}";
    return {
      property: async (context) => {
        for (const predicate of predicates) {
          const references = context.focusNode.out([predicate]).terms;
          for (const value of context.values) {
            for (const reference of references) {
              const valid = await compare(value.term, equal ? "<=" : "<", reference);
              context.test(valid === true, constraintComponent, {
                args: { [name]: predicate },
                message: message(text),
                value,
              });
            }
          }
        }
      },
    };
  };
  const coreValidations = new Map<Term, (shape: EngineConstraintShape) => EngineValidation | null>([
    [DataFactory.namedNode(sh + "closed"), compileClosed],
    [DataFactory.namedNode(sh + "hasValue"), compileHasValue],
    [DataFactory.namedNode(sh + "equals"), compileEquals],
    [DataFactory.namedNode(sh + "disjoint"), compileDisjoint],
    [DataFactory.namedNode(sh + "and"), (shape) => compileLogical(shape, "and")],
    [DataFactory.namedNode(sh + "or"), (shape) => compileLogical(shape, "or")],
    [DataFactory.namedNode(sh + "xone"), (shape) => compileLogical(shape, "xone")],
    [DataFactory.namedNode(sh + "not"), (shape) => compileLogical(shape, "not")],
    [DataFactory.namedNode(`${sh}languageIn`), compileLanguageIn],
    [DataFactory.namedNode(`${sh}maxLength`), (shape) => compileLength(shape, "maxLength")],
    [DataFactory.namedNode(`${sh}minLength`), (shape) => compileLength(shape, "minLength")],
    [DataFactory.namedNode(`${sh}pattern`), compilePattern],
    [DataFactory.namedNode(`${sh}uniqueLang`), compileUniqueLang],
    [DataFactory.namedNode(`${sh}qualifiedValueShape`), compileQualifiedShape],
    [
      DataFactory.namedNode(`${sh}maxExclusive`),
      (shape) => compileRange(shape, "maxExclusive", "<", "Value is not less than {$maxExclusive}"),
    ],
    [
      DataFactory.namedNode(`${sh}maxInclusive`),
      (shape) =>
        compileRange(
          shape,
          "maxInclusive",
          "<=",
          "Value is not less than or equal to {$maxInclusive}",
        ),
    ],
    [
      DataFactory.namedNode(`${sh}minExclusive`),
      (shape) =>
        compileRange(shape, "minExclusive", ">", "Value is not greater than {$minExclusive}"),
    ],
    [
      DataFactory.namedNode(`${sh}minInclusive`),
      (shape) =>
        compileRange(
          shape,
          "minInclusive",
          ">=",
          "Value is not greater than or equal to {$minInclusive}",
        ),
    ],
    [DataFactory.namedNode(`${sh}lessThan`), (shape) => compileLessThan(shape, "lessThan")],
    [
      DataFactory.namedNode(`${sh}lessThanOrEquals`),
      (shape) => compileLessThan(shape, "lessThanOrEquals"),
    ],
  ]);
  const validations = new Map<Term, unknown>([[localSparql, compile]]);
  for (const [term, validator] of coreValidations) validations.set(term, validator);
  return new Validator(shapes, {
    factory: { ...DataFactory, dataset: () => new Store() },
    validations,
  }).validate({ dataset });
}
