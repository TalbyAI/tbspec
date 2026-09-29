import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { DataFactory } from 'n3';
import sourceText from '../fixtures/orders.ttl?raw';
import focusViewText from '../fixtures/orders.focus.view.ttl?raw';
import focusPresentationText from '../fixtures/orders.focus.presentation.ttl?raw';
import auditViewText from '../fixtures/orders.audit.view.ttl?raw';
import auditPresentationText from '../fixtures/orders.audit.presentation.ttl?raw';
import { EX, addRelation, addToView, changeRelation, localName, parse, project,
  quadId, replaceQuad, replaceViewRelation, serialize, setPosition, termId } from './model.js';
import './style.css';

const { literal, quad } = DataFactory;
const initialViews = { focus: parse(focusViewText), audit: parse(auditViewText) };
const initialPresentations = { focus: parse(focusPresentationText), audit: parse(auditPresentationText) };
const modes = { all: 'Complete graph', focus: 'Customer view', audit: 'Audit view' };

function RdfNode({ data }) {
  return <div className={`rdf-node ${data.kind === 'blank node' ? 'blank' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <small>{data.kind}</small><strong>{data.label}</strong>
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { rdf: RdfNode };

function LiteralRow({ item, onSave }) {
  const [value, setValue] = useState(item.object.value);
  useEffect(() => setValue(item.object.value), [item.object.value]);
  const suffix = item.object.language ? `@${item.object.language}` :
    item.object.datatype.value.endsWith('#string') ? '' : `^^${localName(item.object.datatype.value)}`;
  return <form className="literal-row" onSubmit={(event) => { event.preventDefault(); onSave(item, value); }}>
    <label>{localName(item.predicate.value)} <small>{suffix}</small></label>
    <div><input value={value} onChange={(event) => setValue(event.target.value)} /><button type="submit">Save</button></div>
  </form>;
}

function download(name, contents) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([contents], { type: 'text/turtle' }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function App() {
  const [source, setSource] = useState(() => parse(sourceText));
  const [sourceDraft, setSourceDraft] = useState(sourceText);
  const [draftDirty, setDraftDirty] = useState(false);
  const [views, setViews] = useState(initialViews);
  const [presentations, setPresentations] = useState(initialPresentations);
  const [fullPositions, setFullPositions] = useState([]);
  const [mode, setMode] = useState('all');
  const [selected, setSelected] = useState(null);
  const [pending, setPending] = useState(null);
  const [predicate, setPredicate] = useState('');
  const [message, setMessage] = useState('Drag a connection between handles, or select a node or relationship.');
  const graph = useMemo(() => project(source, views[mode] || [], mode,
    mode === 'all' ? fullPositions : presentations[mode]), [source, views, presentations, fullPositions, mode]);
  const [nodes, setNodes] = useState(graph.nodes);
  useEffect(() => setNodes(graph.nodes), [graph]);

  const selectedNode = selected?.kind === 'node' ? graph.resources.get(selected.id) : null;
  const selectedEdge = selected?.kind === 'edge' ? source.find((q) => quadId(q) === selected.id) : null;
  const literalQuads = selectedNode ? source.filter((q) => q.subject.equals(selectedNode) && q.object.termType === 'Literal') : [];

  function commitSource(next, feedback, applyDraft = false) {
    setSource(next);
    if (!draftDirty || applyDraft) {
      setSourceDraft(serialize(next));
      setDraftDirty(false);
    }
    setMessage(draftDirty && !applyDraft
      ? `${feedback} Unapplied Turtle draft preserved; applying it will replace canvas edits.`
      : feedback);
  }

  function onConnect({ source: from, target: to }) {
    if (!graph.resources.has(from) || !graph.resources.has(to)) return;
    setPending({ from, to });
    setPredicate(EX + 'relatedTo');
    setSelected(null);
    setMessage('Enter the predicate IRI, then add the relationship.');
  }

  function addPending() {
    try {
      const result = addRelation(source, graph.resources.get(pending.from), predicate.trim(), graph.resources.get(pending.to));
      const nextView = mode === 'all' ? null : addToView(views[mode], mode, result.added);
      commitSource(result.quads, 'Relationship added to the RDF source.');
      if (nextView) setViews((before) => ({ ...before, [mode]: nextView }));
      setSelected({ kind: 'edge', id: quadId(result.added) });
      setPending(null);
    } catch (error) { setMessage(error.message); }
  }

  function updateEdge() {
    try {
      const result = changeRelation(source, selectedEdge, predicate.trim());
      setViews((before) => Object.fromEntries(Object.entries(before).map(([name, quads]) =>
        [name, replaceViewRelation(quads, name, selectedEdge, result.replacement)])));
      commitSource(result.quads, 'Predicate changed in RDF source and saved views.');
      setSelected({ kind: 'edge', id: quadId(result.replacement) });
    } catch (error) { setMessage(error.message); }
  }

  function deleteEdge() {
    setViews((before) => Object.fromEntries(Object.entries(before).map(([name, quads]) =>
      [name, replaceViewRelation(quads, name, selectedEdge, null)])));
    commitSource(source.filter((q) => quadId(q) !== quadId(selectedEdge)), 'Relationship removed from RDF source and saved views.');
    setSelected(null);
  }

  function addSelectionToView(name) {
    try {
      const item = selectedNode || selectedEdge;
      const nextView = addToView(views[name], name, item, source);
      setViews((before) => ({ ...before, [name]: nextView }));
      setMessage(selectedNode
        ? `Resource added to ${modes[name]}; existing links to members of that view were included.`
        : `Relationship added to ${modes[name]}; its endpoints were included automatically.`);
    } catch (error) { setMessage(error.message); }
  }

  function saveLiteral(item, value) {
    const replacement = item.object.language ? literal(value, item.object.language) : literal(value, item.object.datatype);
    commitSource(replaceQuad(source, item, quad(item.subject, item.predicate, replacement)),
      'Literal changed in RDF source; its language or datatype was kept.');
  }

  function applySource() {
    try { commitSource(parse(sourceDraft), 'Turtle parsed; the complete graph and saved views now project from the new RDF source.', true); }
    catch (error) { setMessage(`Source parse error: ${error.message}`); }
  }

  function onNodeDragStop(_event, node) {
    const term = graph.resources.get(node.id);
    if (mode === 'all') setFullPositions((before) => setPosition(before, term, node.position));
    else setPresentations((before) => ({ ...before, [mode]: setPosition(before[mode], term, node.position) }));
    setMessage(mode === 'all' ? 'Complete-graph position is temporary.' :
      `Position recorded in the ${modes[mode]} presentation RDF.`);
  }

  function chooseMode(next) {
    setMode(next); setSelected(null); setPending(null);
    setMessage(next === 'all' ? 'Every resource and relationship in the source graph is visible.' :
      `${modes[next]} reads its membership and positions from its own RDF files.`);
  }

  return <div className="app">
    <header>
      <div><span className="eyebrow">THROWAWAY PROTOTYPE · TICKET 06</span><h1>RDF canvas proof</h1>
        <p>Can React Flow make RDF editing and complete-graph exploration usable while Turtle stays authoritative?</p></div>
      <div className="mode-switch" aria-label="Graph mode">{Object.entries(modes).map(([key, label]) =>
        <button key={key} className={mode === key ? 'active' : ''} onClick={() => chooseMode(key)}>{label}</button>)}</div>
    </header>
    <main>
      <section className="canvas" aria-label="RDF graph canvas">
        <div className="canvas-note"><strong>{modes[mode]}</strong><span>{graph.nodes.length} resources · {graph.edges.length} relationships</span></div>
        <ReactFlow nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView
          onNodesChange={(changes) => setNodes((before) => applyNodeChanges(changes, before))}
          onNodeDragStop={onNodeDragStop} onConnect={onConnect}
          onNodeClick={(_event, node) => { setSelected({ kind: 'node', id: node.id }); setPending(null); }}
          onEdgeClick={(_event, edge) => { setSelected({ kind: 'edge', id: edge.id }); setPredicate(edge.data.quad.predicate.value); setPending(null); }}
          onPaneClick={() => { setSelected(null); setPending(null); }}
          nodesConnectable edgesFocusable elementsSelectable deleteKeyCode={null}>
          <Background gap={22} color="#dbe3ec" /><Controls /></ReactFlow>
      </section>
      <aside>
        <div className="status" role="status">{message}</div>
        {pending && <section><h2>New relationship</h2><p>{graph.resources.get(pending.from)?.value} → {graph.resources.get(pending.to)?.value}</p>
          <label htmlFor="new-predicate">Predicate IRI</label><input id="new-predicate" value={predicate} onChange={(event) => setPredicate(event.target.value)} />
          <button onClick={addPending}>Add relationship</button></section>}
        {selectedNode && <section><h2>{selectedNode.termType === 'BlankNode' ? 'Blank node' : 'Resource'}</h2>
          <p className="term">{selectedNode.value}</p><h3>Literal properties</h3>
          {literalQuads.length ? literalQuads.map((q) => <LiteralRow key={quadId(q)} item={q} onSave={saveLiteral} />) : <p>No literal properties.</p>}
          {mode === 'all' && selectedNode.termType !== 'BlankNode' && <div className="actions">
            <button onClick={() => addSelectionToView('focus')}>Add to customer view</button>
            <button onClick={() => addSelectionToView('audit')}>Add to audit view</button></div>}</section>}
        {selectedEdge && <section><h2>Relationship</h2><p className="term">{selectedEdge.subject.value} → {selectedEdge.object.value}</p>
          <label htmlFor="edge-predicate">Predicate IRI</label><input id="edge-predicate" value={predicate} onChange={(event) => setPredicate(event.target.value)} />
          <div className="actions"><button onClick={updateEdge}>Save predicate</button><button onClick={deleteEdge}>Delete</button></div>
          {mode === 'all' && <div className="actions"><button disabled={selectedEdge.subject.termType === 'BlankNode' || selectedEdge.object.termType === 'BlankNode'} onClick={() => addSelectionToView('focus')}>Add to customer view</button>
            <button disabled={selectedEdge.subject.termType === 'BlankNode' || selectedEdge.object.termType === 'BlankNode'} onClick={() => addSelectionToView('audit')}>Add to audit view</button></div>}</section>}
        <section className="source"><h2>RDF source</h2><p>Canvas edits update Turtle unless you have an unapplied draft. Applying a draft replaces canvas edits made since you started it.</p>
          <textarea aria-label="RDF source" value={sourceDraft} onChange={(event) => { setSourceDraft(event.target.value); setDraftDirty(true); }} spellCheck="false" />
          <div className="actions"><button onClick={applySource}>Apply Turtle</button>
            <button onClick={() => download('orders.ttl', serialize(source))}>Download source</button></div></section>
        {mode !== 'all' && <section><h2>Saved view RDF</h2><p>These graphs hold membership and positions separately from source.</p>
          <details><summary>View membership</summary><pre>{serialize(views[mode])}</pre></details>
          <details><summary>Presentation positions</summary><pre>{serialize(presentations[mode])}</pre></details>
          <div className="actions"><button onClick={() => download(`orders.${mode}.view.ttl`, serialize(views[mode]))}>Download view</button>
            <button onClick={() => download(`orders.${mode}.presentation.ttl`, serialize(presentations[mode]))}>Download positions</button></div></section>}
      </aside>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
