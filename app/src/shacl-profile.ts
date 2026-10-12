import type { Term } from "@rdfjs/types";
import { Parser } from "@traqula/parser-sparql-1-1";
import { DataFactory, Store } from "n3";
import { ProjectError, type Status } from "./output.ts";
import { absoluteIri } from "./paths.ts";
import type { Row } from "./schemas.ts";
import { compileXPathPattern } from "./shacl-regex.ts";

const sh = "http://www.w3.org/ns/shacl#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const owl = "http://www.w3.org/2002/07/owl#";
const xsd = "http://www.w3.org/2001/XMLSchema#";
const parser = new Parser();

function reject(code: string, message: string, status: Status = "invalid"): never {
  throw new ProjectError(status, code, message);
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
function inspectLocalQuery(text: string, shapes: boolean, status: Status) {
  let ast: Row;
  try {
    ast = parser.parse(text) as unknown as Row;
  } catch {
    reject(
      shapes ? "SHACL_QUERY_REJECTED" : "QUERY_REJECTED",
      "Query cannot be parsed as SPARQL 1.1.",
      status,
    );
  }
  const code = shapes ? "SHACL_QUERY_REJECTED" : "QUERY_REJECTED";
  const variables = new Set<string>();
  if (ast.type !== "query" || (shapes && ast.subType !== "select"))
    reject(code, "Only local query forms are permitted; constraints require SELECT.", status);
  walk(ast, (node, parent, key) => {
    if (node.subType === "variable" && typeof node.value === "string") variables.add(node.value);
    if (
      node.subType === "service" ||
      (node.type === "datasetClauses" && (node.clauses as unknown[]).length)
    )
      reject(
        code,
        "SERVICE and FROM dataset clauses are forbidden, including nested queries.",
        status,
      );
    if (!shapes) return;
    if (["minus", "values"].includes(String(node.subType)))
      reject(code, "SHACL pre-binding forbids MINUS and VALUES.", status);
    if (node.subType === "variable" && ["shapesGraph", "currentShape"].includes(String(node.value)))
      reject(code, "The validator does not bind shapesGraph or currentShape.", status);
    if (node.subType === "variable" && node.value === "this" && key === "variable")
      reject(code, "AS must not rebind this.", status);
    if (
      node.subType === "variable" &&
      node.value === "PATH" &&
      !(parent?.type === "triple" && key === "predicate")
    )
      reject(code, "$PATH is allowed only as a triple-pattern predicate.", status);
    if (node.type === "query") {
      const variables = node.variables as Row[] | undefined;
      if (!variables?.some((v) => v.subType === "variable" && v.value === "this"))
        reject(code, "Every SELECT, including subqueries, must explicitly project this.", status);
    }
  });
  const projection = (ast.variables as Row[] | undefined) ?? [];
  const projectedVariables = projection.flatMap((item) => {
    if (item.subType === "variable" && typeof item.value === "string") return [item.value];
    if (item.subType === "bind" && typeof item.variable === "object" && item.variable) {
      const variable = item.variable as Row;
      return variable.subType === "variable" && typeof variable.value === "string"
        ? [variable.value]
        : [];
    }
    return [];
  });
  return {
    form: String(ast.subType),
    variables,
    projectedVariables: projection.some((item) => item.subType === "wildcard")
      ? [...variables]
      : projectedVariables,
  };
}
export function localQuery(text: string, shapes = false): void {
  inspectLocalQuery(text, shapes, "invalid");
}
export function localQueryInfo(text: string, status: Status = "invalid") {
  return inspectLocalQuery(text, false, status);
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
    if (head.termType !== "BlankNode" && head.termType !== "NamedNode")
      reject("SHACL_GRAPH_INVALID", "A shape list must have RDF nodes.");
    if (head.value === `${rdf}nil` && head.termType !== "NamedNode")
      reject("SHACL_GRAPH_INVALID", "rdf:nil must be an IRI.");
    while (head.value !== `${rdf}nil`) {
      if (head.termType !== "BlankNode" && head.termType !== "NamedNode")
        reject("SHACL_GRAPH_INVALID", "A shape list must have RDF nodes.");
      if (seen.has(head.value)) reject("SHACL_GRAPH_INVALID", "Cyclic RDF list in shapes graph.");
      seen.add(head.value);
      result.push(one(head, `${rdf}first`));
      head = one(head, `${rdf}rest`);
    }
    if (head.termType !== "NamedNode") reject("SHACL_GRAPH_INVALID", "rdf:nil must be an IRI.");
    const nil = DataFactory.namedNode(`${rdf}nil`);
    if (
      graph.countQuads(nil, `${rdf}first`, null, null) ||
      graph.countQuads(nil, `${rdf}rest`, null, null)
    )
      reject("SHACL_GRAPH_INVALID", "rdf:nil must not have rdf:first or rdf:rest values.");
    return result;
  }
  function path(term: Term, seen = new Set<string>()): string {
    if (term.termType === "NamedNode") return `<${term.value}>`;
    if (term.termType !== "BlankNode" || seen.has(term.value))
      reject("SHACL_GRAPH_INVALID", "Property path is malformed or cyclic.");
    const next = new Set([...seen, term.value]);
    const operators = [
      ["inversePath", "^"],
      ["alternativePath", "|"],
      ["zeroOrMorePath", "*"],
      ["oneOrMorePath", "+"],
      ["zeroOrOnePath", "?"],
    ] as const;
    if (graph.countQuads(term, `${rdf}first`, null, null)) {
      const steps = list(term);
      if (steps.length < 2)
        reject("SHACL_GRAPH_INVALID", "Sequence paths require at least two members.");
      return `(${steps.map((step) => path(step, next)).join("/")})`;
    }
    const declared = operators.filter(([name]) =>
      graph.countQuads(term, `${sh}${name}`, null, null),
    );
    if (declared.length !== 1)
      reject("SHACL_GRAPH_INVALID", "Property path needs exactly one operator.");
    const [name, operator] = declared[0] ?? ["inversePath", "^"];
    const operatorQuads = graph.getQuads(term, null, null, null);
    if (operatorQuads.length !== 1 || operatorQuads[0]?.predicate.value !== `${sh}${name}`)
      reject("SHACL_GRAPH_INVALID", "Operator paths must have exactly one defining triple.");
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
          prefix.datatype.value !== `${xsd}string` ||
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
        let prefixCheck: Row;
        try {
          prefixCheck = parser.parse(
            `PREFIX ${prefix.value}: <urn:tbspec:prefix-check:>\nSELECT $this WHERE {}`,
          ) as unknown as Row;
        } catch {
          reject("SHACL_GRAPH_INVALID", "SHACL prefix declaration has an invalid SPARQL prefix.");
        }
        const context = (prefixCheck.context as Row[] | undefined) ?? [];
        if (
          context.length !== 1 ||
          context[0]?.key !== prefix.value ||
          (context[0]?.value as Row | undefined)?.value !== "urn:tbspec:prefix-check:"
        )
          reject("SHACL_GRAPH_INVALID", "SHACL prefix declaration has an invalid SPARQL prefix.");
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
      ["and", "or", "xone", "in", "ignoredProperties", "languageIn"].some(
        (name) => statement.predicate.value === `${sh}${name}`,
      )
    ) {
      const members = list(statement.object);
      if (
        ["and", "or", "xone"].includes(statement.predicate.value.slice(sh.length)) &&
        members.some((member) => !["NamedNode", "BlankNode"].includes(member.termType))
      )
        reject("SHACL_GRAPH_INVALID", "Logical shape lists may contain only shape nodes.");
    }
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
        !/^[+-]?\d+$/.test(statement.object.value))
    )
      reject(
        "SHACL_GRAPH_INVALID",
        "Cardinality and length parameters must be xsd:integer literals.",
      );
    if (
      ["minExclusive", "minInclusive", "maxExclusive", "maxInclusive"].some(
        (name) => statement.predicate.value === `${sh}${name}`,
      ) &&
      statement.object.termType !== "Literal"
    )
      reject("SHACL_GRAPH_INVALID", "Range parameters must be literals.");
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
      statement.predicate.value === `${sh}targetNode` &&
      statement.object.termType === "BlankNode"
    )
      reject("SHACL_GRAPH_INVALID", "sh:targetNode values must be IRIs or literals.");
    if (statement.predicate.value === `${sh}severity` && statement.object.termType !== "NamedNode")
      reject("SHACL_GRAPH_INVALID", "sh:severity values must be IRIs.");
    if (
      statement.predicate.value === `${sh}message` &&
      (statement.object.termType !== "Literal" ||
        (statement.object.datatype.value !== `${xsd}string` &&
          statement.object.datatype.value !== `${rdf}langString`))
    )
      reject(
        "SHACL_GRAPH_INVALID",
        "sh:message values must be xsd:string or language-tagged literals.",
      );
    if (
      [
        "minCount",
        "maxCount",
        "uniqueLang",
        "lessThan",
        "lessThanOrEquals",
        "qualifiedValueShape",
      ].some((name) => statement.predicate.value === `${sh}${name}`) &&
      graph.countQuads(statement.subject, `${sh}path`, null, null) === 0
    )
      reject("SHACL_GRAPH_INVALID", "This Core parameter is permitted only on property shapes.");
    if (
      ["qualifiedMinCount", "qualifiedMaxCount"].some(
        (name) => statement.predicate.value === `${sh}${name}`,
      ) &&
      graph.countQuads(statement.subject, `${sh}qualifiedValueShape`, null, null) > 0 &&
      graph.countQuads(statement.subject, `${sh}path`, null, null) === 0
    )
      reject(
        "SHACL_GRAPH_INVALID",
        "Qualified count parameters are permitted only on property shapes.",
      );
    if (
      statement.predicate.value === `${sh}nodeKind` &&
      (statement.object.termType !== "NamedNode" ||
        ![
          "BlankNode",
          "IRI",
          "Literal",
          "BlankNodeOrIRI",
          "BlankNodeOrLiteral",
          "IRIOrLiteral",
        ].some((name) => statement.object.value === `${sh}${name}`))
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
      statement.predicate.value === `${sh}node` &&
      graph.countQuads(statement.object, `${sh}path`, null, null)
    )
      reject("SHACL_GRAPH_INVALID", "sh:node values must be node shapes without a property path.");
    if (
      [
        "closed",
        "ignoredProperties",
        "minCount",
        "maxCount",
        "minLength",
        "maxLength",
        "minExclusive",
        "minInclusive",
        "maxExclusive",
        "maxInclusive",
        "datatype",
        "nodeKind",
        "path",
        "deactivated",
        "uniqueLang",
        "qualifiedMinCount",
        "qualifiedMaxCount",
        "qualifiedValueShape",
        "qualifiedValueShapesDisjoint",
        "pattern",
        "flags",
        "languageIn",
        "in",
        "severity",
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
        flags.some(
          (term) =>
            term.termType !== "Literal" ||
            term.datatype.value !== `${xsd}string` ||
            !/^[imsx]*$/.test(term.value),
        )
      )
        reject("SHACL_GRAPH_INVALID", "Pattern flags must be strings using only i, m, s and x.");
      try {
        compileXPathPattern(statement.object.value, flags[0]?.value ?? "");
      } catch {
        reject("SHACL_GRAPH_INVALID", "Pattern or flags are not valid XPath regular expressions.");
      }
    }
    if (
      statement.predicate.value === `${sh}flags` &&
      (statement.object.termType !== "Literal" ||
        statement.object.datatype.value !== `${xsd}string` ||
        !/^[imsx]*$/.test(statement.object.value))
    )
      reject("SHACL_GRAPH_INVALID", "Pattern flags must be strings using only i, m, s and x.");
    if (statement.predicate.value === `${sh}languageIn`) {
      for (const member of list(statement.object))
        if (member.termType !== "Literal" || member.datatype.value !== `${xsd}string`)
          reject("SHACL_GRAPH_INVALID", "sh:languageIn members must be xsd:string literals.");
    }
    if (statement.predicate.value === `${sh}ignoredProperties`) {
      for (const member of list(statement.object))
        if (member.termType !== "NamedNode")
          reject("SHACL_GRAPH_INVALID", "sh:ignoredProperties members must be IRIs.");
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
    // SPARQL variable tails include astral symbols and unassigned characters, beyond Unicode letters.
    text = text.replace(
      /"""(?:\\[\s\S]|(?!""")[^\\])*"""|'''(?:\\[\s\S]|(?!''')[^\\])*'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^<>\s]*>|\\[~.!$&'()*+,;=/?#@%-]|#[^\r\n]*|[$?]PATH(?![A-Za-z_0-9\u00b7\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u203f-\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}]|[\u0300-\u036f])/gu,
      (token) => {
        if (token !== "$PATH" && token !== "?PATH") return token;
        if (paths.length !== 1 || !paths[0])
          reject("SHACL_QUERY_REJECTED", "$PATH requires exactly one property-shape path.");
        return path(paths[0]);
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
