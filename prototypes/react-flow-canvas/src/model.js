import { DataFactory, Parser, Writer } from "n3";

const { namedNode, blankNode, literal, quad } = DataFactory;
export const EX = "https://example.org/orders/";
export const P = "urn:canvas-proof:";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const prefixes = { ex: EX, p: P, rdf: RDF, rdfs: RDFS, xsd: XSD };

export const parse = (text) =>
  new Parser({ format: "text/turtle", blankNodePrefix: "" }).parse(text);
export const serialize = (quads) =>
  Object.entries(prefixes)
    .map(([prefix, iri]) => `@prefix ${prefix}: <${iri}> .`)
    .join("\n") +
  "\n\n" +
  new Writer({ prefixes }).quadsToString(quads);
export const termId = (term) =>
  term.termType === "Literal"
    ? `Literal:${term.value}@${term.language}^^${term.datatype.value}`
    : `${term.termType}:${term.value}`;
export const quadId = (item) => [item.subject, item.predicate, item.object].map(termId).join("|");
export const localName = (iri) => iri.replace(/^.*[/#:]/, "") || iri;
export const isResource = (term) => term.termType === "NamedNode" || term.termType === "BlankNode";
export const validIri = (value) => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: RDF IRIs must reject control characters.
  return /^(https?:\/\/|urn:)[^\u0000-\u0020\u007F<>"{}|^`\\]+$/u.test(value);
};

const same = (a, b) => a.equals(b);
const has = (quads, subject, predicate, object) =>
  quads.some(
    (q) => same(q.subject, subject) && same(q.predicate, predicate) && same(q.object, object),
  );
const values = (quads, subject, predicate) =>
  quads
    .filter((q) => same(q.subject, subject) && q.predicate.value === predicate)
    .map((q) => q.object);

export function viewMembers(viewQuads, name) {
  const root = namedNode(P + name);
  const nodes = new Set(values(viewQuads, root, P + "node").map(termId));
  const edges = new Set();
  for (const record of values(viewQuads, root, P + "edge")) {
    const subject = values(viewQuads, record, RDF + "subject")[0];
    const predicate = values(viewQuads, record, RDF + "predicate")[0];
    const object = values(viewQuads, record, RDF + "object")[0];
    if (subject && predicate && object) edges.add(quadId(quad(subject, predicate, object)));
  }
  return { nodes, edges };
}

export function positionsFromRdf(quads) {
  const positions = {};
  for (const q of quads) {
    if (q.predicate.value !== P + "x" && q.predicate.value !== P + "y") continue;
    const id = termId(q.subject);
    positions[id] ??= {};
    positions[id][q.predicate.value === P + "x" ? "x" : "y"] = Number(q.object.value);
  }
  return positions;
}

export function project(source, viewQuads, name, presentation) {
  const members = name === "all" ? null : viewMembers(viewQuads, name);
  const resourceQuads = source.filter((q) => isResource(q.object));
  const edgeQuads = members
    ? resourceQuads.filter((q) => members.edges.has(quadId(q)))
    : resourceQuads;
  const resources = new Map();
  for (const q of source) {
    if (isResource(q.subject)) resources.set(termId(q.subject), q.subject);
    if (isResource(q.object)) resources.set(termId(q.object), q.object);
  }
  const selected = members
    ? [...members.nodes].filter((id) => resources.has(id))
    : [...resources.keys()].sort();
  const positions = positionsFromRdf(presentation);
  const nodes = selected.map((id, index) => {
    const term = resources.get(id);
    const label =
      values(source, term, RDFS + "label")[0]?.value ||
      (term.termType === "BlankNode" ? `Blank node ${term.value}` : localName(term.value));
    return {
      id,
      type: "rdf",
      position: positions[id] || { x: 80 + (index % 3) * 280, y: 70 + Math.floor(index / 3) * 200 },
      data: { label, kind: term.termType === "BlankNode" ? "blank node" : "IRI", term },
    };
  });
  const visible = new Set(selected);
  const edges = edgeQuads
    .filter((q) => visible.has(termId(q.subject)) && visible.has(termId(q.object)))
    .map((q) => ({
      id: quadId(q),
      source: termId(q.subject),
      target: termId(q.object),
      label: localName(q.predicate.value),
      data: { quad: q },
      type: "smoothstep",
    }));
  return { nodes, edges, resources };
}

export function addToView(viewQuads, name, item, source = []) {
  const root = namedNode(P + name);
  let next = [...viewQuads];
  const include = (term) => {
    const predicate = namedNode(P + "node");
    if (!has(next, root, predicate, term)) next.push(quad(root, predicate, term));
  };
  if (!("predicate" in item)) {
    if (item.termType === "BlankNode")
      throw new Error("Blank nodes cannot be saved as view members.");
    include(item);
    const members = viewMembers(next, name).nodes;
    for (const relationship of source) {
      if (
        !isResource(relationship.object) ||
        relationship.subject.termType === "BlankNode" ||
        relationship.object.termType === "BlankNode"
      )
        continue;
      if (
        (same(relationship.subject, item) || same(relationship.object, item)) &&
        members.has(termId(relationship.subject)) &&
        members.has(termId(relationship.object))
      )
        next = addToView(next, name, relationship);
    }
    return next;
  }
  if (item.subject.termType === "BlankNode" || item.object.termType === "BlankNode")
    throw new Error("Relationships with blank-node endpoints cannot be saved in a view.");
  include(item.subject);
  include(item.object);
  if (viewMembers(next, name).edges.has(quadId(item))) return next;
  const record = blankNode();
  next.push(quad(root, namedNode(P + "edge"), record));
  next.push(quad(record, namedNode(RDF + "subject"), item.subject));
  next.push(quad(record, namedNode(RDF + "predicate"), item.predicate));
  next.push(quad(record, namedNode(RDF + "object"), item.object));
  return next;
}

export function replaceViewRelation(viewQuads, name, oldQuad, replacement) {
  const root = namedNode(P + name);
  const records = values(viewQuads, root, P + "edge").filter((record) => {
    const subject = values(viewQuads, record, RDF + "subject")[0];
    const predicate = values(viewQuads, record, RDF + "predicate")[0];
    const object = values(viewQuads, record, RDF + "object")[0];
    return (
      subject && predicate && object && quadId(quad(subject, predicate, object)) === quadId(oldQuad)
    );
  });
  const next = viewQuads.filter(
    (q) =>
      !records.some(
        (record) => same(q.subject, record) || (same(q.subject, root) && same(q.object, record)),
      ),
  );
  return replacement && records.length ? addToView(next, name, replacement) : next;
}

export function setPosition(presentation, term, position) {
  const next = presentation.filter(
    (q) => !(same(q.subject, term) && [P + "x", P + "y"].includes(q.predicate.value)),
  );
  next.push(
    quad(
      term,
      namedNode(P + "x"),
      literal(String(Math.round(position.x)), namedNode(XSD + "integer")),
    ),
  );
  next.push(
    quad(
      term,
      namedNode(P + "y"),
      literal(String(Math.round(position.y)), namedNode(XSD + "integer")),
    ),
  );
  return next;
}

export function changeRelation(source, oldQuad, predicateIri) {
  if (!validIri(predicateIri))
    throw new Error("Enter a Turtle-safe absolute http(s) or urn predicate IRI.");
  const replacement = quad(oldQuad.subject, namedNode(predicateIri), oldQuad.object);
  return { quads: replaceQuad(source, oldQuad, replacement), replacement };
}

export function replaceQuad(source, previous, replacement) {
  const oldId = quadId(previous);
  if (oldId !== quadId(replacement) && source.some((q) => quadId(q) === quadId(replacement)))
    return source.filter((q) => quadId(q) !== oldId);
  return source.map((q) => (quadId(q) === oldId ? replacement : q));
}

export function addRelation(source, subject, predicateIri, object) {
  if (!validIri(predicateIri))
    throw new Error("Enter a Turtle-safe absolute http(s) or urn predicate IRI.");
  const added = quad(subject, namedNode(predicateIri), object);
  return {
    quads: has(source, subject, added.predicate, object) ? source : [...source, added],
    added,
  };
}
