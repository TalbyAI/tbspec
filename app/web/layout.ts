import type { ElkNode } from "elkjs/lib/elk-api.js";
import ELK from "elkjs/lib/elk-api.js";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface CanvasPosition {
  x: string;
  y: string;
}

export type PositionMap = Record<string, CanvasPosition>;

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const validCoordinate = (value: string | undefined) => {
  if (typeof value !== "string" || value.trim() === "") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric);
};

function plainDecimal(value: number) {
  const raw = value.toString();
  const match = raw.toLowerCase().match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/);
  if (!match) return raw;
  const sign = match[1] ?? "";
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  const digits = `${integer}${fraction}`;
  const point = integer.length + exponent;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

export function coordinateLexical(value: number): string {
  if (!Number.isFinite(value))
    throw new Error("Layout returned a coordinate outside the supported finite range.");
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER / 1000) return plainDecimal(value);
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  return rounded.toFixed(3).replace(/(?:\.0+|(?:(\.\d*?)0+))$/, "$1");
}

export function usablePosition(value: CanvasPosition | undefined): value is CanvasPosition {
  return !!value && validCoordinate(value.x) && validCoordinate(value.y);
}

function sortedNodes(nodes: LayoutNode[]) {
  return [...nodes].sort((left, right) => compareText(left.id, right.id));
}

function connectedComponents(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const adjacent = new Map<string, Set<string>>();
  for (const id of ids) adjacent.set(id, new Set());
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    adjacent.get(edge.source)?.add(edge.target);
    adjacent.get(edge.target)?.add(edge.source);
  }
  const unseen = new Set([...ids].sort(compareText));
  const components: string[][] = [];
  while (unseen.size > 0) {
    const first = [...unseen].sort(compareText)[0];
    if (first === undefined) break;
    const pending = [first];
    const component: string[] = [];
    unseen.delete(first);
    while (pending.length > 0) {
      const current = pending.shift();
      if (current === undefined) continue;
      component.push(current);
      for (const neighbor of [...(adjacent.get(current) ?? [])].sort(compareText))
        if (unseen.delete(neighbor)) pending.push(neighbor);
    }
    components.push(component.sort(compareText));
  }
  return components;
}

export function mergeIncrementalPositions(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  computed: PositionMap,
  previous: PositionMap,
): PositionMap {
  const ordered = sortedNodes(nodes);
  const nodesById = new Map(ordered.map((node) => [node.id, node]));
  const result: PositionMap = {};
  const occupied: {
    id: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[] = [];
  for (const node of ordered)
    if (usablePosition(previous[node.id])) {
      result[node.id] = previous[node.id];
      const x = Number(previous[node.id]?.x);
      const y = Number(previous[node.id]?.y);
      occupied.push({
        id: node.id,
        left: x,
        top: y,
        right: x + node.width,
        bottom: y + node.height,
      });
    }

  let occupiedRight = occupied.length > 0 ? Math.max(...occupied.map((box) => box.right)) : 0;
  let occupiedTop = occupied.length > 0 ? Math.min(...occupied.map((box) => box.top)) : 0;
  const collides = (left: number, top: number, width: number, height: number) =>
    occupied.some(
      (box) =>
        left < box.right + 24 &&
        left + width + 24 > box.left &&
        top < box.bottom + 24 &&
        top + height + 24 > box.top,
    );
  const place = (id: string, x: number, y: number) => {
    const node = nodesById.get(id);
    if (!node || !Number.isFinite(x) || !Number.isFinite(y)) return;
    let left = x;
    let top = y;
    if (collides(left, top, node.width, node.height)) {
      const step = Math.max(48, Math.min(320, Math.max(node.width, node.height) + 32));
      let ring = 1;
      while (ring <= 100_000) {
        const offsets = [
          [ring, 0],
          [-ring, 0],
          [0, ring],
          [0, -ring],
          [ring, ring],
          [ring, -ring],
          [-ring, ring],
          [-ring, -ring],
        ];
        const candidate = offsets.find(([offsetX, offsetY]) => {
          const candidateX = left + (offsetX ?? 0) * step;
          const candidateY = top + (offsetY ?? 0) * step;
          return (
            Number.isFinite(candidateX) &&
            Number.isFinite(candidateY) &&
            !collides(candidateX, candidateY, node.width, node.height)
          );
        });
        if (candidate) {
          left += (candidate[0] ?? 0) * step;
          top += (candidate[1] ?? 0) * step;
          break;
        }
        if (
          left + ring * step === left &&
          left - ring * step === left &&
          top + ring * step === top &&
          top - ring * step === top
        )
          throw new Error("No distinct finite canvas position is available beside a saved node.");
        ring += 1;
      }
      if (ring > 100_000)
        throw new Error("No finite collision-free position is available for a new canvas node.");
    }
    const position = { x: coordinateLexical(left), y: coordinateLexical(top) };
    result[id] = position;
    occupied.push({
      id,
      left,
      top,
      right: left + node.width,
      bottom: top + node.height,
    });
    occupiedRight = Math.max(occupiedRight, left + node.width);
    occupiedTop = Math.min(occupiedTop, top);
  };
  for (const component of connectedComponents(ordered, edges)) {
    const anchors = component.filter((id) => usablePosition(previous[id]));
    const missing = component.filter((id) => !usablePosition(previous[id]));
    if (missing.length === 0) continue;
    const firstAnchor = anchors[0];
    const anchorLayout = firstAnchor ? computed[firstAnchor] : undefined;
    const anchorPrior = firstAnchor ? previous[firstAnchor] : undefined;
    if (firstAnchor && usablePosition(anchorLayout) && usablePosition(anchorPrior)) {
      const offsetX = Number(anchorPrior.x) - Number(anchorLayout.x);
      const offsetY = Number(anchorPrior.y) - Number(anchorLayout.y);
      for (const id of missing) {
        const layout = computed[id];
        if (!usablePosition(layout)) continue;
        place(id, Number(layout.x) + offsetX, Number(layout.y) + offsetY);
      }
      continue;
    }

    const componentPoints = component.flatMap((id) => {
      const node = nodesById.get(id);
      const position = computed[id];
      if (!node || !usablePosition(position)) return [];
      const x = Number(position.x);
      const y = Number(position.y);
      return [{ left: x, top: y, right: x + node.width, bottom: y + node.height }];
    });
    if (componentPoints.length === 0) continue;
    const bounds = {
      left: Math.min(...componentPoints.map((point) => point.left)),
      top: Math.min(...componentPoints.map((point) => point.top)),
      right: Math.max(...componentPoints.map((point) => point.right)),
      bottom: Math.max(...componentPoints.map((point) => point.bottom)),
    };
    const offsetX = occupied.length === 0 ? 0 : occupiedRight + 80 - bounds.left;
    const offsetY = occupied.length === 0 ? 0 : occupiedTop - bounds.top;
    for (const id of missing) {
      const layout = computed[id];
      if (!usablePosition(layout)) continue;
      place(id, Number(layout.x) + offsetX, Number(layout.y) + offsetY);
    }
  }
  for (const node of ordered)
    if (!usablePosition(result[node.id]))
      throw new Error("ELK did not produce a finite position for every canvas node.");
  return result;
}

export function fallbackGrid(nodes: LayoutNode[]): PositionMap {
  const ordered = sortedNodes(nodes);
  const positions: PositionMap = {};
  const gapX = 72;
  const gapY = 56;
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  const columnWidth = Math.max(420, Math.ceil(Math.sqrt(ordered.length)) * 320);
  for (const node of ordered) {
    if (x > 0 && x + node.width > columnWidth) {
      x = 0;
      y += rowHeight + gapY;
      rowHeight = 0;
    }
    positions[node.id] = { x: coordinateLexical(x), y: coordinateLexical(y) };
    x += node.width + gapX;
    rowHeight = Math.max(rowHeight, node.height);
  }
  return positions;
}

export async function layoutWithElk(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  signal: AbortSignal,
): Promise<PositionMap> {
  const orderedNodes = sortedNodes(nodes);
  const ids = new Set(orderedNodes.map((node) => node.id));
  const orderedEdges = edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .sort((left, right) => compareText(left.id, right.id));
  if (
    orderedNodes.some(
      (node) => !Number.isFinite(node.width + node.height) || node.width <= 0 || node.height <= 0,
    )
  )
    throw new Error("Canvas node dimensions are not available yet.");
  if (signal.aborted) throw new DOMException("Layout cancelled.", "AbortError");
  const elk = new ELK({ workerUrl });
  let onAbort: (() => void) | undefined;
  try {
    const result = await new Promise<Awaited<ReturnType<typeof elk.layout>>>((resolve, reject) => {
      onAbort = () => {
        elk.terminateWorker();
        reject(new DOMException("Layout cancelled.", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void elk
        .layout({
          id: "root",
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": "RIGHT",
            "elk.randomSeed": "42",
            "elk.separateConnectedComponents": "true",
            "elk.spacing.nodeNode": "56",
            "elk.layered.spacing.nodeNodeBetweenLayers": "96",
            "elk.edgeRouting": "ORTHOGONAL",
          },
          children: orderedNodes.map((node) => ({
            id: node.id,
            width: node.width,
            height: node.height,
          })),
          edges: orderedEdges.map((edge) => ({
            id: edge.id,
            sources: [edge.source],
            targets: [edge.target],
          })),
        })
        .then(resolve, reject);
    });
    if (signal.aborted) throw new DOMException("Layout cancelled.", "AbortError");
    return Object.fromEntries(
      (result.children ?? []).map((node: ElkNode) => [
        node.id,
        { x: coordinateLexical(node.x ?? 0), y: coordinateLexical(node.y ?? 0) },
      ]),
    );
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    elk.terminateWorker();
  }
}
