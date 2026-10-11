import type { Term } from "@rdfjs/types";
import { Parser } from "@traqula/parser-sparql-1-1";
import { DataFactory, Store } from "n3";
import { ProjectError } from "./output.ts";
import { absoluteIri } from "./paths.ts";
import type { Row } from "./schemas.ts";

const sh = "http://www.w3.org/ns/shacl#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const owl = "http://www.w3.org/2002/07/owl#";
const xsd = "http://www.w3.org/2001/XMLSchema#";
const parser = new Parser();

function reject(code: string, message: string): never {
  throw new ProjectError("invalid", code, message);
}
function walk(
  value: unknown,
  visit: (node: Row, parent?: Row, key?: string) => void,
  parent?: Row,
  key?: string,
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, parent, key);
    return;
  }
  const node = value as Row;
  visit(node, parent, key);
  for (const [field, child] of Object.entries(node))
    if (field !== "loc") walk(child, visit, node, field);
}

/** One AST policy for every local query; shape rules additionally enforce SHACL pre-binding. */
export function localQuery(text: string, shapes = false): void {
  let ast: Row;
  try {
    ast = parser.parse(text) as unknown as Row;
  } catch {
    reject(
      shapes ? "SHACL_QUERY_REJECTED" : "QUERY_REJECTED",
      "Query cannot be parsed as SPARQL 1.1.",
    );
  }
  const code = shapes ? "SHACL_QUERY_REJECTED" : "QUERY_REJECTED";
  if (ast.type !== "query" || (shapes && ast.subType !== "select"))
    reject(code, "Only local query forms are permitted; constraints require SELECT.");
  walk(ast, (node, parent, key) => {
    if (
      node.subType === "service" ||
      (node.type === "datasetClauses" && (node.clauses as unknown[]).length)
    )
      reject(code, "SERVICE and FROM dataset clauses are forbidden, including nested queries.");
    if (!shapes) return;
    if (["minus", "values"].includes(String(node.subType)))
      reject(code, "SHACL pre-binding forbids MINUS and VALUES.");
    if (node.subType === "variable" && ["shapesGraph", "currentShape"].includes(String(node.value)))
      reject(code, "The validator does not bind shapesGraph or currentShape.");
    if (node.subType === "variable" && node.value === "this" && key === "variable")
      reject(code, "AS must not rebind this.");
    if (
      node.subType === "variable" &&
      node.value === "PATH" &&
      !(parent?.type === "triple" && key === "predicate")
    )
      reject(code, "$PATH is allowed only as a triple-pattern predicate.");
    if (node.type === "query") {
      const variables = node.variables as Row[] | undefined;
      if (!variables?.some((v) => v.subType === "variable" && v.value === "this"))
        reject(code, "Every SELECT, including subqueries, must explicitly project this.");
    }
  });
}

export function prepareShapes(source: Store): Store {
  const graph = new Store([...source]);
  const one = (subject: Term, predicate: string) => {
    const values = graph.getObjects(subject, predicate, null);
    if (values.length !== 1)
      reject("SHACL_GRAPH_INVALID", `Expected exactly one <${predicate}> value.`);
    const value = values[0];
    if (!value) reject("SHACL_GRAPH_INVALID", "Missing shape parameter.");
    return value;
  };
  function list(head: Term): Term[] {
    const result: Term[] = [];
    const seen = new Set<string>();
    while (head.value !== `${rdf}nil`) {
      if (head.termType !== "BlankNode" && head.termType !== "NamedNode")
        reject("SHACL_GRAPH_INVALID", "A shape list must have RDF nodes.");
      if (seen.has(head.value)) reject("SHACL_GRAPH_INVALID", "Cyclic RDF list in shapes graph.");
      seen.add(head.value);
      result.push(one(head, `${rdf}first`));
      head = one(head, `${rdf}rest`);
    }
    return result;
  }
  function path(term: Term, seen = new Set<string>()): string {
    if (term.termType === "NamedNode") return `<${term.value}>`;
    if (term.termType !== "BlankNode" || seen.has(term.value))
      reject("SHACL_GRAPH_INVALID", "Property path is malformed or cyclic.");
    const next = new Set([...seen, term.value]);
    if (graph.countQuads(term, `${rdf}first`, null, null)) {
      const steps = list(term);
      if (steps.length < 2)
        reject("SHACL_GRAPH_INVALID", "Sequence paths require at least two members.");
      return `(${steps.map((step) => path(step, next)).join("/")})`;
    }
    const operators = [
      ["inversePath", "^"],
      ["alternativePath", "|"],
      ["zeroOrMorePath", "*"],
      ["oneOrMorePath", "+"],
      ["zeroOrOnePath", "?"],
    ] as const;
    const declared = operators.filter(([name]) =>
      graph.countQuads(term, `${sh}${name}`, null, null),
    );
    if (declared.length !== 1)
      reject("SHACL_GRAPH_INVALID", "Property path needs exactly one operator.");
    const [name, operator] = declared[0] ?? ["inversePath", "^"];
    const value = one(term, `${sh}${name}`);
    if (operator === "|") {
      const alternatives = list(value);
      if (alternatives.length < 2)
        reject("SHACL_GRAPH_INVALID", "Alternative paths require at least two members.");
      return `(${alternatives.map((step) => path(step, next)).join("|")})`;
    }
    const nested = path(value, next);
    return operator === "^" ? `^(${nested})` : `(${nested})${operator}`;
  }
  const prefixes = (constraint: Term) => {
    const result = new Map<string, string>();
    const seen = new Set<string>();
    function include(term: Term) {
      if (seen.has(term.value)) return;
      seen.add(term.value);
      for (const imported of graph.getObjects(term, `${owl}imports`, null)) include(imported);
      for (const declaration of graph.getObjects(term, `${sh}declare`, null)) {
        const prefix = one(declaration, `${sh}prefix`);
        const namespace = one(declaration, `${sh}namespace`);
        if (
          prefix.termType !== "Literal" ||
          !/^[A-Za-z_][A-Za-z0-9_-]*$|^$/.test(prefix.value) ||
          namespace.termType !== "Literal" ||
          namespace.datatype.value !== `${xsd}anyURI` ||
          !absoluteIri(namespace.value)
        )
          reject(
            "SHACL_GRAPH_INVALID",
            "Prefix declarations require a valid prefix and absolute xsd:anyURI namespace.",
          );
        if (result.has(prefix.value) && result.get(prefix.value) !== namespace.value)
          reject("SHACL_GRAPH_INVALID", "Conflicting SHACL prefix declarations.");
        result.set(prefix.value, namespace.value);
      }
    }
    for (const term of graph.getObjects(constraint, `${sh}prefixes`, null)) include(term);
    return [...result].map(([prefix, namespace]) => `PREFIX ${prefix}: <${namespace}>`).join("\n");
  };
  for (const statement of graph) {
    if (
      [
        "target",
        "ask",
        "validator",
        "nodeValidator",
        "propertyValidator",
        "rule",
        "js",
        "expression",
      ].some((name) => statement.predicate.value === `${sh}${name}`) ||
      (statement.predicate.value === `${rdf}type` &&
        [
          "SPARQLTarget",
          "SPARQLTargetType",
          "ConstraintComponent",
          "SPARQLAskValidator",
          "SPARQLSelectValidator",
        ].some((name) => statement.object.value === `${sh}${name}`))
    )
      reject(
        "SHACL_FORM_UNSUPPORTED",
        "Only SHACL Core and sh:sparql SELECT constraints are supported; targets, custom validators and rules are unavailable.",
      );
    if (
      ["and", "or", "xone", "in", "ignoredProperties"].some(
        (name) => statement.predicate.value === `${sh}${name}`,
      )
    )
      list(statement.object);
    if (statement.predicate.value === `${sh}path`) path(statement.object);
    if (
      [
        "minCount",
        "maxCount",
        "minLength",
        "maxLength",
        "qualifiedMinCount",
        "qualifiedMaxCount",
      ].some((name) => statement.predicate.value === `${sh}${name}`) &&
      (statement.object.termType !== "Literal" ||
        statement.object.datatype.value !== `${xsd}integer` ||
        !/^\+?\d+$/.test(statement.object.value))
    )
      reject(
        "SHACL_GRAPH_INVALID",
        "Cardinality and length parameters must be nonnegative integers.",
      );
    if (
      ["closed", "deactivated", "uniqueLang", "qualifiedValueShapesDisjoint"].some(
        (name) => statement.predicate.value === `${sh}${name}`,
      ) &&
      (statement.object.termType !== "Literal" ||
        statement.object.datatype.value !== `${xsd}boolean` ||
        !["true", "false", "1", "0"].includes(statement.object.value))
    )
      reject("SHACL_GRAPH_INVALID", "Boolean shape parameters need valid xsd:boolean literals.");
    if (
      [
        "targetClass",
        "targetSubjectsOf",
        "targetObjectsOf",
        "class",
        "datatype",
        "equals",
        "disjoint",
        "lessThan",
        "lessThanOrEquals",
      ].some((name) => statement.predicate.value === `${sh}${name}`) &&
      statement.object.termType !== "NamedNode"
    )
      reject("SHACL_GRAPH_INVALID", "Class, datatype and predicate parameters must be IRIs.");
    if (
      statement.predicate.value === `${sh}nodeKind` &&
      !["BlankNode", "IRI", "Literal", "BlankNodeOrIRI", "BlankNodeOrLiteral", "IRIOrLiteral"].some(
        (name) => statement.object.value === `${sh}${name}`,
      )
    )
      reject("SHACL_GRAPH_INVALID", "Unknown SHACL node kind.");
    if (
      ["property", "node", "not", "qualifiedValueShape"].some(
        (name) => statement.predicate.value === `${sh}${name}`,
      ) &&
      !["NamedNode", "BlankNode"].includes(statement.object.termType)
    )
      reject("SHACL_GRAPH_INVALID", "Shape references must be RDF nodes.");
    if (
      [
        "minCount",
        "maxCount",
        "minLength",
        "maxLength",
        "datatype",
        "nodeKind",
        "path",
        "closed",
        "deactivated",
        "uniqueLang",
        "qualifiedMinCount",
        "qualifiedMaxCount",
        "qualifiedValueShapesDisjoint",
      ].some((name) => statement.predicate.value === `${sh}${name}`) &&
      graph.countQuads(statement.subject, statement.predicate, null, null) > 1
    )
      reject(
        "SHACL_GRAPH_INVALID",
        "Shape parameter has multiple values where only one is permitted.",
      );
    if (
      statement.predicate.value === `${rdf}type` &&
      statement.object.value === `${sh}NodeShape` &&
      graph.countQuads(statement.subject, `${sh}path`, null, null)
    )
      reject("SHACL_GRAPH_INVALID", "NodeShape must not declare a property path.");
    if (
      (statement.predicate.value === `${rdf}type` &&
        statement.object.value === `${sh}PropertyShape`) ||
      statement.predicate.value === `${sh}property`
    ) {
      const subject =
        statement.predicate.value === `${sh}property` ? statement.object : statement.subject;
      if (graph.countQuads(subject, `${sh}path`, null, null) !== 1)
        reject("SHACL_GRAPH_INVALID", "Property shapes require exactly one path.");
    }
    if (statement.predicate.value === `${sh}pattern`) {
      if (
        statement.object.termType !== "Literal" ||
        statement.object.datatype.value !== `${xsd}string`
      )
        reject("SHACL_GRAPH_INVALID", "Patterns require string literals.");
      const flags = graph.getObjects(statement.subject, `${sh}flags`, null);
      if (
        flags.length > 1 ||
        flags.some(
          (term) =>
            term.termType !== "Literal" ||
            term.datatype.value !== `${xsd}string` ||
            !/^[imsx]*$/.test(term.value),
        )
      )
        reject(
          "SHACL_GRAPH_INVALID",
          "Pattern flags must be a single string using only i, m, s and x.",
        );
      const originalFlags = flags[0]?.value ?? "";
      let pattern = statement.object.value;
      if (originalFlags.includes("x")) {
        let escaped = false;
        let inClass = false;
        pattern = [...pattern]
          .filter((character) => {
            // XPath x also removes whitespace between a backslash and its escaped character.
            if (!inClass && /[\t\n\r ]/.test(character)) return false;
            if (escaped) {
              escaped = false;
              return true;
            }
            if (character === "\\") {
              escaped = true;
              return true;
            }
            if (character === "[") inClass = true;
            if (character === "]") inClass = false;
            return true;
          })
          .join("");
      }
      // XPath character escapes differ from JavaScript, both inside and outside classes.
      const characterClasses: Record<string, string> = {
        d: "\\p{Nd}",
        D: "\\P{Nd}",
        w: "[\\p{L}\\p{M}\\p{N}\\p{S}]",
        W: "[\\p{P}\\p{Z}\\p{C}]",
        s: "[ \\t\\r\\n]",
        S: "[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\u{10ffff}]",
        "-": "\\x2d",
      };
      let inCharacterClass = false;
      pattern = pattern.replace(/\\[\s\S]|[[\]]/gu, (token) => {
        if (token === "[") inCharacterClass = true;
        if (token === "]") inCharacterClass = false;
        const replacement = token.startsWith("\\") ? characterClasses[token.slice(1)] : undefined;
        return replacement
          ? inCharacterClass && replacement.startsWith("[")
            ? replacement.slice(1, -1)
            : replacement
          : token;
      });
      const normalizedFlags = `${[...new Set(originalFlags.replaceAll("x", ""))].join("")}u`;
      try {
        new RegExp(pattern, normalizedFlags);
      } catch {
        reject(
          "SHACL_GRAPH_INVALID",
          "Pattern or flags cannot be compiled by the pinned Core engine.",
        );
      }
      graph.removeQuad(statement);
      graph.addQuad(statement.subject, statement.predicate, DataFactory.literal(pattern));
      graph.removeQuads(graph.getQuads(statement.subject, `${sh}flags`, null, null));
      graph.addQuad(
        statement.subject,
        DataFactory.namedNode(`${sh}flags`),
        DataFactory.literal(normalizedFlags),
      );
    }
  }
  for (const statement of [...graph.getQuads(null, `${sh}sparql`, null, null)]) {
    if (!["NamedNode", "BlankNode"].includes(statement.object.termType))
      reject("SHACL_GRAPH_INVALID", "sh:sparql requires a constraint node.");
    const select = one(statement.object, `${sh}select`);
    if (select.termType !== "Literal" || select.datatype.value !== `${xsd}string`)
      reject("SHACL_GRAPH_INVALID", "sh:select requires one string literal.");
    let text = `${prefixes(statement.object)}\n${select.value}`;
    localQuery(text, true);
    const paths = graph.getObjects(statement.subject, `${sh}path`, null);
    // Protect quoted strings, IRIs and comments from the engine's textual $PATH substitution.
    text = text.replace(
      /"""(?:[\s\S]*?)"""|'''(?:[\s\S]*?)'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^<>\s]*>|#[^\r\n]*|[$?]PATH\b/g,
      (token) => {
        if (token === "$PATH" || token === "?PATH") {
          if (paths.length !== 1 || !paths[0])
            reject("SHACL_QUERY_REJECTED", "$PATH requires exactly one property-shape path.");
          return path(paths[0]);
        }
        return token.replaceAll("$PATH", "\\u0024PATH");
      },
    );
    localQuery(text, true);
    graph.removeQuads(graph.getQuads(statement.object, `${sh}select`, null, null));
    graph.addQuad(
      statement.object as import("@rdfjs/types").Quad_Subject,
      DataFactory.namedNode(`${sh}select`),
      DataFactory.literal(text),
    );
  }
  // The preflighted text already includes prefixes and paths; compilation must use those exact bytes.
  graph.removeQuads(graph.getQuads(null, `${sh}prefixes`, null, null));
  return graph;
}
