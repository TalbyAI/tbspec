import { useEdges, useNodes, useNodesInitialized, useReactFlow } from "@xyflow/react";
import { useEffect, useRef } from "react";
import {
  type CanvasPosition,
  coordinateLexical,
  fallbackGrid,
  type LayoutEdge,
  type LayoutNode,
  layoutWithElk,
  mergeIncrementalPositions,
  type PositionMap,
  usablePosition,
} from "./layout.ts";

export interface LayoutRequest {
  id: number;
  active: boolean;
  mode: "missing" | "reorganize";
}

export interface LayoutCompletion {
  fallback: boolean;
  durationMs: number;
  nodeCount: number;
}

interface CanvasLayoutBridgeProps {
  request: LayoutRequest;
  revision: string;
  previous: PositionMap;
  focus?: { id: string; sequence: number };
  onStart: () => void;
  onResult: (positions: PositionMap, result: LayoutCompletion) => void;
  onFailure: (message: string) => void;
}

function dimensionsReady(nodes: LayoutNode[]) {
  return nodes.length > 0 && nodes.every((node) => node.width > 0 && node.height > 0);
}

function retainedPositions(nodes: LayoutNode[], previous: PositionMap) {
  return Object.fromEntries(
    nodes.flatMap((node) =>
      usablePosition(previous[node.id]) ? [[node.id, previous[node.id]]] : [],
    ),
  ) as PositionMap;
}

function fillFallback(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  previous: PositionMap,
): PositionMap {
  const fallback = fallbackGrid(nodes);
  const retained = retainedPositions(nodes, previous);
  return mergeIncrementalPositions(nodes, edges, fallback, retained);
}

export function CanvasLayoutBridge({
  request,
  revision,
  previous,
  focus,
  onStart,
  onResult,
  onFailure,
}: CanvasLayoutBridgeProps) {
  const flow = useReactFlow();
  const observedNodes = useNodes();
  const observedEdges = useEdges();
  const initialized = useNodesInitialized();
  const currentRequest = useRef(request);
  const currentRevision = useRef(revision);
  const currentPrevious = useRef(previous);
  const previousSignature = JSON.stringify(previous);
  const currentPreviousSignature = useRef(previousSignature);
  const currentDimensions = useRef("");
  const currentCallbacks = useRef({ onStart, onResult, onFailure });
  const focused = useRef(focus);
  currentRequest.current = request;
  currentRevision.current = revision;
  currentPrevious.current = previous;
  currentPreviousSignature.current = previousSignature;
  currentCallbacks.current = { onStart, onResult, onFailure };
  focused.current = focus;
  const dimensions = observedNodes
    .map((node) => `${node.id}:${node.measured?.width ?? 0}x${node.measured?.height ?? 0}`)
    .sort();
  const dimensionSignature = JSON.stringify(dimensions);
  const styleSignature = JSON.stringify(
    observedNodes
      .map((node) => [node.id, node.style ?? {}, node.className ?? ""] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
  const graphSignature = JSON.stringify(
    observedEdges
      .map((edge) => [edge.id, edge.source, edge.target] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
  const currentGraph = useRef(graphSignature);
  const currentStyle = useRef(styleSignature);
  currentDimensions.current = dimensionSignature;
  currentGraph.current = graphSignature;
  currentStyle.current = styleSignature;

  useEffect(() => {
    if (!focus || dimensionSignature.length === 0) return;
    const node = flow.getNode(focus.id);
    if (!node) return;
    const width = node.measured?.width ?? 0;
    const height = node.measured?.height ?? 0;
    if (width <= 0 || height <= 0) return;
    flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      duration: 400,
      zoom: 1.1,
    });
  }, [flow, focus, dimensionSignature]);

  useEffect(() => {
    if (!request.active || !initialized) return;
    const reactNodes = flow.getNodes();
    const nodes = reactNodes.map((node) => ({
      id: node.id,
      width: node.measured?.width ?? 0,
      height: node.measured?.height ?? 0,
    }));
    if (!dimensionsReady(nodes)) return;
    const ids = new Set(nodes.map((node) => node.id));
    const edges = flow
      .getEdges()
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      }))
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    const requestId = request.id;
    const revisionAtStart = revision;
    const dimensionsAtStart = dimensionSignature;
    const styleAtStart = styleSignature;
    const graphAtStart = graphSignature;
    const prior = currentPrevious.current;
    const previousAtStart = previousSignature;
    const controller = new AbortController();
    const startedAt = performance.now();
    currentCallbacks.current.onStart();

    void layoutWithElk(nodes, edges, controller.signal)
      .then((computed) => {
        if (
          controller.signal.aborted ||
          currentRequest.current.id !== requestId ||
          !currentRequest.current.active ||
          currentRevision.current !== revisionAtStart ||
          currentDimensions.current !== dimensionsAtStart ||
          currentStyle.current !== styleAtStart ||
          currentPreviousSignature.current !== previousAtStart ||
          currentGraph.current !== graphAtStart
        )
          return;
        const next =
          request.mode === "missing"
            ? mergeIncrementalPositions(nodes, edges, computed, prior)
            : computed;
        currentCallbacks.current.onResult(next, {
          fallback: false,
          durationMs: performance.now() - startedAt,
          nodeCount: nodes.length,
        });
      })
      .catch((problem: unknown) => {
        if (
          controller.signal.aborted ||
          currentRequest.current.id !== requestId ||
          !currentRequest.current.active ||
          currentRevision.current !== revisionAtStart ||
          currentDimensions.current !== dimensionsAtStart ||
          currentStyle.current !== styleAtStart ||
          currentPreviousSignature.current !== previousAtStart ||
          currentGraph.current !== graphAtStart
        )
          return;
        const message =
          problem instanceof Error ? problem.message : "The ELK layout worker failed.";
        const hasPrior = nodes.some((node) => usablePosition(prior[node.id]));
        if (request.mode === "reorganize" && hasPrior) {
          currentCallbacks.current.onFailure(`${message} Existing positions were kept.`);
          return;
        }
        try {
          const fallback = fillFallback(nodes, edges, prior);
          currentCallbacks.current.onResult(fallback, {
            fallback: true,
            durationMs: performance.now() - startedAt,
            nodeCount: nodes.length,
          });
          currentCallbacks.current.onFailure(
            `${message} A temporary grid is available; retry ELK layout when ready.`,
          );
        } catch {
          currentCallbacks.current.onFailure(
            `${message} The deterministic grid could not be completed; existing positions were kept. Retry ELK layout when ready.`,
          );
        }
      });

    return () => controller.abort();
  }, [
    dimensionSignature,
    flow,
    graphSignature,
    initialized,
    request.active,
    request.id,
    request.mode,
    previousSignature,
    revision,
    styleSignature,
  ]);

  return null;
}

export function lexicalPositions(
  nodes: { id: string; position: { x: number; y: number } }[],
): PositionMap {
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: coordinateLexical(node.position.x),
        y: coordinateLexical(node.position.y),
      } satisfies CanvasPosition,
    ]),
  );
}
