import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges, BaseEdge, getBezierPath } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { fixture, project, layoutInput, positionsFrom, grid, fillMissing, addResource, rename, fingerprint, WIDTH, HEIGHT } from './graph.js';
import './style.css';

const Resource = memo(({ data }) => <div className={'resource ' + (data.highlight ? 'highlight' : '')}>
  <Handle type="target" position={Position.Left}/><strong>{data.label}</strong>
  <small>{data.id.startsWith('_:') ? 'Blank node' : data.id.split('/').pop()}</small>
  <Handle type="source" position={Position.Right}/>
</div>);
const nodeTypes = { resource: Resource };
function Relationship(props) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, data } = props;
  let [path, labelX, labelY] = getBezierPath(props);
  if (props.source === props.target) {
    path = `M ${sx} ${sy} C ${sx + 80} ${sy - 110}, ${tx - 80} ${ty - 110}, ${tx} ${ty}`;
    labelX = (sx + tx) / 2; labelY = sy - 83;
  } else if (data.parallelCount > 1) {
    const offset = (data.parallelIndex - (data.parallelCount - 1) / 2) * 65;
    path = `M ${sx} ${sy} C ${sx + 65} ${sy + offset}, ${tx - 65} ${ty + offset}, ${tx} ${ty}`;
    labelX = (sx + tx) / 2; labelY = (sy + ty) / 2 + offset * .75;
  }
  return <BaseEdge {...props} path={path} labelX={labelX} labelY={labelY}/>;
}
const edgeTypes = { relationship: Relationship };
const initial = fixture(100);

function App() {
  const [count, setCount] = useState(100), [source, setSource] = useState(initial);
  const [mode, setMode] = useState('all'), [nodes, setNodes] = useState([]);
  const [selected, setSelected] = useState(null), [query, setQuery] = useState('');
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState({}), [message, setMessage] = useState('Preparing layout');
  const [edgeInfo, setEdgeInfo] = useState(null);
  const caches = useRef({}), worker = useRef(null), sequence = useRef(0), flow = useRef(null);
  const full = useMemo(() => project(source), [source]);
  const graph = useMemo(() => {
    if (mode === 'all') return full;
    const members = new Set(full.nodes.filter(n => !n.id.startsWith('_:')).slice(0, 12).map(n => n.id));
    return { nodes: full.nodes.filter(n => members.has(n.id)), edges: full.edges.filter(e => members.has(e.source) && members.has(e.target)) };
  }, [full, mode]);
  const neighbors = useMemo(() => new Set(selected ? [selected, ...graph.edges.flatMap(e =>
    e.source === selected ? [e.target] : e.target === selected ? [e.source] : [])] : []), [graph, selected]);
  const results = graph.nodes.filter(n => query.trim() && (n.label + ' ' + n.id).toLowerCase().includes(query.trim().toLowerCase()));
  const matches = results.slice(0, 20);

  function spawnWorker() {
    worker.current?.terminateWorker();
    worker.current = new ELK({ workerUrl });
  }
  useEffect(() => { spawnWorker(); return () => worker.current?.terminateWorker(); }, []);
  async function calculate(input, request) {
    const start = performance.now();
    const output = await worker.current.layout(layoutInput(input));
    return { id: request, output, ms: performance.now() - start };
  }
  function renderPositions(positions) {
    setNodes(graph.nodes.map(n => ({ id: n.id, type: 'resource', position: positions[n.id],
      width: WIDTH, height: HEIGHT, data: { ...n, highlight: neighbors.has(n.id) } })));
  }
  useEffect(() => {
    const request = ++sequence.current;
    setPreview(null); setSelected(current => graph.nodes.some(n => n.id === current) ? current : null); setEdgeInfo(null);
    const start = performance.now();
    async function initialize() {
      let positions = caches.current[mode];
      if (!positions && mode !== 'all') {
        // Sparse presentation: demonstrate that existing saved positions are anchors.
        positions = Object.fromEntries(graph.nodes.slice(0, 2).map((n, i) =>
          [n.id, { x: (mode === 'viewA' ? 100 : 500) + i * 260, y: mode === 'viewA' ? 100 : 400 }]));
      }
      try {
        if (!positions) {
          setBusy(true); setMessage('Computing initial layout in a worker');
          const result = await calculate(graph, request);
          if (request !== sequence.current) return;
          positions = positionsFrom(result.output);
          setMetrics({ workerLayoutMs: Math.round(result.ms), requestToResultMs: Math.round(performance.now() - start) });
        } else positions = fillMissing(graph, positions);
        if (request !== sequence.current) return;
        caches.current[mode] = positions;
        renderPositions(positions); setBusy(false); setMessage('Ready. Positions belong only to the active canvas.');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (request !== sequence.current) return;
          flow.current?.fitView({ padding: 0.15, minZoom: 0.005, maxZoom: 1 });
          setMetrics(m => ({ ...m, requestToTwoFramesMs: Math.round(performance.now() - start) }));
        }));
      } catch (error) {
        if (request === sequence.current) { setBusy(false); setMessage('Layout failed: ' + error.message); }
      }
    }
    initialize();
  }, [graph, mode]);
  useEffect(() => setNodes(current => current.map(n => ({ ...n, data: { ...n.data, highlight: neighbors.has(n.id) } }))), [neighbors]);

  async function reorganize(kind) {
    const request = ++sequence.current;
    setBusy(true); setMessage('Preparing preview; current positions are unchanged');
    try {
      const result = kind === 'grid' ? { positions: grid(graph), ms: 0 } : await calculate(graph, request);
      if (request !== sequence.current) return;
      const positions = result.positions || positionsFrom(result.output);
      setPreview(positions); renderPositions(positions); setBusy(false);
      setMetrics(m => ({ ...m, previewLayoutMs: Math.round(result.ms) }));
      setMessage('Preview only. Apply or cancel before editing.');
      requestAnimationFrame(() => flow.current?.fitView({ padding: 0.15, minZoom: 0.005, maxZoom: 1 }));
    } catch (error) { setBusy(false); setMessage('Layout failed: ' + error.message); }
  }
  function cancelPreview() { renderPositions(caches.current[mode]); setPreview(null); setMessage('Preview canceled. Previous positions restored.'); }
  function applyPreview() { caches.current[mode] = preview; setPreview(null); setMessage(mode === 'all' ? 'Applied to temporary complete-graph positions.' : 'Applied to this view presentation in memory.'); }
  function focus(id) {
    setSelected(id); setEdgeInfo(null);
    const node = nodes.find(n => n.id === id);
    if (node) flow.current?.setCenter(node.position.x + WIDTH / 2, node.position.y + HEIGHT / 2, { zoom: 1 });
  }
  const parallel = new Map();
  for (const edge of graph.edges) {
    const pair = JSON.stringify([edge.source, edge.target]);
    if (!parallel.has(pair)) parallel.set(pair, []);
    parallel.get(pair).push(edge.id);
  }
  const edges = graph.edges.map(e => ({ ...e, type: 'relationship', label: e.predicate.split('/').pop(),
    data: { parallelCount: parallel.get(JSON.stringify([e.source, e.target])).length,
      parallelIndex: parallel.get(JSON.stringify([e.source, e.target])).indexOf(e.id) },
    style: { stroke: selected && (e.source === selected || e.target === selected) ? '#b34b18' : '#9ca9b1', strokeWidth: 1.5 },
    markerEnd: { type: 'arrowclosed' } }));
  const disabled = busy || Boolean(preview);
  const selectedNode = graph.nodes.find(n => n.id === selected);
  window.__layoutProof = () => ({ count, mode, nodes: graph.nodes.length, edges: graph.edges.length,
    projected: graph.nodes.length, rendered: document.querySelectorAll('.react-flow__node').length,
    busy, preview: Boolean(preview), selected, neighborCount: neighbors.size,
    positions: caches.current, positionFingerprint: fingerprint(caches.current[mode] || {}),
    displayedFingerprint: fingerprint(Object.fromEntries(nodes.map(n => [n.id, n.position]))),
    sourceStatements: source.length, metrics, viewport: flow.current?.getViewport() });
  return <div className="app">
    <header><h1>Graph layout proof</h1><p>Throwaway trial: can automatic layout and resource search support 100 and 1,000 resources while preserving each view's positions?</p></header>
    <div className="toolbar">
      <label>Fixture <select aria-label="Fixture size" value={count} disabled={disabled} onChange={e => { const value = Number(e.target.value); caches.current = {}; setCount(value); setSource(fixture(value)); setMode('all'); }}><option value="100">100 resources</option><option value="1000">1,000 resources</option></select></label>
      <label>Canvas <select aria-label="Canvas" value={mode} disabled={disabled} onChange={e => setMode(e.target.value)}><option value="all">Complete graph</option><option value="viewA">View A</option><option value="viewB">View B</option></select></label>
      <button disabled={disabled} onClick={() => reorganize('elk')}>Reorganize</button><button disabled={disabled} onClick={() => reorganize('grid')}>Preview grid baseline</button>
      <button disabled={!preview} onClick={applyPreview}>Apply layout</button><button disabled={!preview} onClick={cancelPreview}>Cancel preview</button>
      {busy && <button onClick={() => {
        sequence.current++; spawnWorker(); setBusy(false);
        const positions = caches.current[mode] || grid(graph);
        caches.current[mode] = positions; renderPositions(positions);
        setMessage('Calculation canceled. Previous positions retained, or temporary grid used for a first opening.');
      }}>Cancel calculation</button>}
    </div>
    <main><aside>
      <label>Find resource<input aria-label="Find resource" placeholder="Label or full IRI" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <p>{results.length} matches{results.length > 20 ? '; showing first 20' : ''}</p>
      <div className="matches">{matches.map(n => <button key={n.id} disabled={disabled} onClick={() => focus(n.id)}>{n.label}</button>)}</div>
      <p>{graph.nodes.length} resources · {graph.edges.length} relationships · 0 hidden by filters</p>
      <button disabled={disabled} onClick={() => { setSelected(null); flow.current?.fitView({ padding: 0.15, minZoom: 0.005, maxZoom: 1 }); }}>Show complete canvas</button>
      {selectedNode && <section><h2>{selectedNode.label}</h2><code>{selected}</code><p>{neighbors.size - 1} immediate neighbors highlighted; graph membership unchanged.</p>
        <button disabled={disabled} onClick={() => setSource(rename(source, selected))}>Edit label</button>
        <button disabled={disabled} onClick={() => setSource(addResource(source, selected))}>Add related resource</button>
        <button disabled={disabled} onClick={() => { const current = caches.current[mode]; const updated = { ...current, [selected]: { x: current[selected].x + 100, y: current[selected].y + 100 } }; caches.current[mode] = updated; renderPositions(updated); }}>Move selected +100,+100</button>
      </section>}
      {edgeInfo && <section><h2>Selected relationship</h2><code>{edgeInfo.source}<br/>{edgeInfo.predicate}<br/>{edgeInfo.target}</code></section>}
      <section><h2>Trial state</h2><p role="status">{message}</p><p>Layout: {metrics.workerLayoutMs ?? '—'} ms<br/>Request to two animation frames: {metrics.requestToTwoFramesMs ?? '—'} ms<br/>Preview layout: {metrics.previewLayoutMs ?? '—'} ms</p><small>Frame timing is an observation, not a responsiveness guarantee. Views are in memory; reload resets this proof.</small></section>
      <section><h2>Try the boundaries</h2><ol><li>Search Resource 0050 and inspect its neighbors.</li><li>Move a resource, edit its label, and check its position.</li><li>Switch between View A and View B.</li><li>Preview grid, then cancel; try Reorganize and apply.</li><li>Repeat with 1,000 resources.</li></ol></section>
    </aside><div className="canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onInit={instance => { flow.current = instance; }} minZoom={0.005} maxZoom={2} onlyRenderVisibleElements
      nodesDraggable={!disabled} nodesConnectable={false} deleteKeyCode={null}
      onNodesChange={changes => setNodes(current => applyNodeChanges(changes, current))}
      onNodeClick={(_, n) => { if (!disabled) { setSelected(n.id); setEdgeInfo(null); } }}
      onEdgeClick={(_, e) => setEdgeInfo(graph.edges.find(item => item.id === e.id))}
      onNodeDragStop={(_, n) => { caches.current[mode] = { ...caches.current[mode], [n.id]: n.position }; }}>
      <Background/><Controls/></ReactFlow></div></main>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
