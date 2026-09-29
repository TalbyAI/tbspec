import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DataFactory } from 'n3';
import { EX, addRelation, addToView, changeRelation, parse, positionsFromRdf,
  project, quadId, replaceQuad, replaceViewRelation, serialize, setPosition, termId, viewMembers } from './src/model.js';

const { literal, namedNode, quad } = DataFactory;
const fixture = (name) => parse(readFileSync(`fixtures/${name}`, 'utf8'));
const source = fixture('orders.ttl');
const focus = fixture('orders.focus.view.ttl');
const audit = fixture('orders.audit.view.ttl');
const focusPosition = fixture('orders.focus.presentation.ttl');
const auditPosition = fixture('orders.audit.presentation.ttl');
const all = project(source, [], 'all', []);
const focused = project(source, focus, 'focus', focusPosition);
const audited = project(source, audit, 'audit', auditPosition);
assert(all.nodes.some((node) => node.data.kind === 'blank node'));
assert(all.edges.some((edge) => edge.label === 'privateNote'));
assert(source.some((q) => q.object.termType === 'Literal' && q.object.value === 'Draft'));
assert.equal(focused.nodes.length, 2);
assert.equal(focused.edges.length, 1);
assert.equal(audited.nodes.length, 2);
assert.equal(audited.edges.length, 1);
const order = namedNode(EX + 'order1');
assert.notDeepEqual(positionsFromRdf(focusPosition)[termId(order)], positionsFromRdf(auditPosition)[termId(order)]);
const opaque = source.find((q) => q.predicate.value === EX + 'unrecognized');
const status = source.find((q) => q.predicate.value === EX + 'status');
const replacement = quad(status.subject, status.predicate, literal('Ready'));
const editedLiteral = replaceQuad(source, status, replacement);
assert.equal(editedLiteral.findIndex((q) => quadId(q) === quadId(replacement)), source.indexOf(status));
assert.deepEqual(project(editedLiteral, [], 'all', []).nodes.map((node) => [node.id, node.position]),
  all.nodes.map((node) => [node.id, node.position]), 'literal edit must not move resources');
const blankBefore = all.nodes.find((node) => node.data.kind === 'blank node').id;
const blankAfter = project(parse(serialize(source)), [], 'all', []).nodes.find((node) => node.data.kind === 'blank node').id;
assert.equal(blankAfter, blankBefore, 'source reparse must keep the blank-node label stable');
const added = addRelation(source, order, EX + 'reviews', namedNode(EX + 'alice'));
const changed = changeRelation(added.quads, added.added, EX + 'approves');
assert.equal(changed.quads.findIndex((q) => quadId(q) === quadId(changed.replacement)),
  added.quads.findIndex((q) => quadId(q) === quadId(added.added)), 'editing should keep statement order');
assert(parse(serialize(changed.quads)).some((q) => quadId(q) === quadId(opaque)));
const expanded = addToView(focus, 'focus', changed.replacement);
const members = viewMembers(expanded, 'focus');
assert(members.edges.has(quadId(changed.replacement)));
assert(members.nodes.has(termId(order)) && members.nodes.has(termId(namedNode(EX + 'alice'))));
assert(!viewMembers(replaceViewRelation(expanded, 'focus', changed.replacement, null), 'focus').edges.has(quadId(changed.replacement)));
const withCustomer = addToView(focus, 'focus', namedNode(EX + 'Customer'), source);
assert([...viewMembers(withCustomer, 'focus').edges].some((id) => id.includes('rdf-syntax-ns#type') && id.includes(EX + 'Customer')),
  'adding Customer should include its relationship to Alice already in the view');
assert.equal(project(source, withCustomer, 'focus', focusPosition).edges.length, 2);
assert.equal(positionsFromRdf(setPosition(focusPosition, order, { x: 5, y: 9 }))[termId(order)].x, 5);
assert.throws(() => addToView(focus, 'focus', all.resources.get(all.nodes.find((node) => node.data.kind === 'blank node').id)), /Blank nodes/);
assert.throws(() => addToView(focus, 'focus', source.find((q) => q.predicate.value === EX + 'privateNote')), /blank-node endpoints/);
for (const invalid of ['https://example.org/a>b', 'https://example.org/a\\b', 'urn:a|b']) {
  assert.throws(() => addRelation(source, order, invalid, namedNode(EX + 'alice')), /predicate IRI/);
  assert.throws(() => changeRelation(source, status, invalid), /predicate IRI/);
}
console.log('PASS: RDF projection, two views, positions, relationship edits, blank-node policy, and opaque round trip');
