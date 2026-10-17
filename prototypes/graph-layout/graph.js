import { DataFactory } from "n3";

const { namedNode, blankNode, literal, quad } = DataFactory;
export const EX = "https://example.org/layout/";
export const LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
export const WIDTH = 180,
  HEIGHT = 58;
export const key = (term) => (term.termType === "BlankNode" ? "_:" + term.value : term.value);

// Four disconnected components: deep chain, cycle, hub, and branching tree.
// Also exercise one blank node, parallel predicates, a self-loop, and an isolated resource.
export function fixture(count) {
  const terms = Array.from({ length: count }, (_, i) =>
    i === count - 1 ? blankNode("detail") : namedNode(EX + "r" + String(i).padStart(4, "0")),
  );
  const source = terms.map((term, i) =>
    quad(term, namedNode(LABEL), literal("Resource " + String(i).padStart(4, "0"))),
  );
  const connect = (a, b, predicate = "related") =>
    source.push(quad(terms[a], namedNode(EX + predicate), terms[b]));
  const section = Math.floor(count / 4);
  for (let i = 1; i < section; i++) connect(i - 1, i, "next");
  for (let i = section; i < 2 * section; i++)
    connect(i, i + 1 < 2 * section ? i + 1 : section, "cycle");
  for (let i = 2 * section + 1; i < 3 * section; i++) connect(2 * section, i, "member");
  for (let i = 3 * section + 1; i < count - 1; i++)
    connect(3 * section + Math.floor((i - 3 * section - 1) / 2), i, "child");
  connect(0, 1, "alternate");
  connect(section, section, "self");
  return source;
}

export function project(source) {
  const resources = new Map(),
    labels = new Map(),
    edges = [];
  for (const q of source) {
    resources.set(key(q.subject), q.subject);
    if (q.object.termType === "Literal") {
      if (q.predicate.value === LABEL) labels.set(key(q.subject), q.object.value);
    } else {
      resources.set(key(q.object), q.object);
      edges.push({
        id: JSON.stringify([key(q.subject), q.predicate.value, key(q.object)]),
        source: key(q.subject),
        target: key(q.object),
        predicate: q.predicate.value,
      });
    }
  }
  return {
    nodes: [...resources.keys()].sort().map((id) => ({ id, label: labels.get(id) || id })),
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function layoutInput(graph) {
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.randomSeed": "1",
      "elk.spacing.nodeNode": "35",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.separateConnectedComponents": "true",
    },
    children: graph.nodes.map((n) => ({ id: n.id, width: WIDTH, height: HEIGHT })),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

export const grid = (graph) =>
  Object.fromEntries(
    graph.nodes.map((n, i) => [n.id, { x: 40 + (i % 3) * 260, y: 40 + Math.floor(i / 3) * 100 }]),
  );
export const positionsFrom = (output) =>
  Object.fromEntries(output.children.map((n) => [n.id, { x: n.x, y: n.y }]));
export const fingerprint = (positions) =>
  JSON.stringify(Object.entries(positions).sort(([a], [b]) => a.localeCompare(b)));
export function overlaps(positions) {
  const values = Object.values(positions);
  let total = 0;
  for (let a = 0; a < values.length; a++)
    for (let b = a + 1; b < values.length; b++)
      if (
        Math.abs(values[a].x - values[b].x) < WIDTH &&
        Math.abs(values[a].y - values[b].y) < HEIGHT
      )
        total++;
  return total;
}

// Incremental placement intentionally does not ask ELK to move positioned resources.
export function fillMissing(graph, positions) {
  const next = { ...positions };
  const occupied = Object.values(next);
  for (const n of graph.nodes)
    if (!next[n.id]) {
      const incoming = graph.edges.find((e) => e.target === n.id && next[e.source]);
      const outgoing = graph.edges.find((e) => e.source === n.id && next[e.target]);
      const anchor = incoming
        ? next[incoming.source]
        : outgoing
          ? next[outgoing.target]
          : { x: 0, y: 0 };
      let candidate;
      for (let step = 0; ; step++) {
        candidate = {
          x: anchor.x + (incoming ? 260 : outgoing ? -260 : 0),
          y: anchor.y + step * 100,
        };
        if (
          !occupied.some(
            (p) =>
              Math.abs(p.x - candidate.x) < WIDTH + 20 && Math.abs(p.y - candidate.y) < HEIGHT + 20,
          )
        )
          break;
      }
      next[n.id] = candidate;
      occupied.push(candidate);
    }
  return next;
}

export function addResource(source, from) {
  const term = namedNode(EX + "added" + source.length);
  const subject = from.startsWith("_:") ? blankNode(from.slice(2)) : namedNode(from);
  return [
    ...source,
    quad(term, namedNode(LABEL), literal("Added resource")),
    quad(subject, namedNode(EX + "related"), term),
  ];
}

export function rename(source, id) {
  return source.map((q) =>
    key(q.subject) === id && q.predicate.value === LABEL
      ? quad(q.subject, q.predicate, literal(q.object.value + " edited"), q.graph)
      : q,
  );
}
