import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Parser as SparqlParser } from '@traqula/parser-sparql-1-1'
import { QueryEngine } from '@comunica/query-sparql-rdfjs-lite'
import { BindingsFactory } from '@comunica/utils-bindings-factory'
import { DataFactory, Parser as RdfParser, Store } from 'n3'
import Validator from 'shacl-engine/Validator.js'
import { targetResolvers, validations } from 'shacl-engine/sparql.js'

const ex = 'https://example.org/'
const graphs = {
  ontology: DataFactory.namedNode(`${ex}ontology`),
  model: DataFactory.namedNode(`${ex}model`),
  decoy: DataFactory.namedNode(`${ex}decoy`),
  shapes: DataFactory.namedNode(`${ex}shapes`)
}
const shSelect = DataFactory.namedNode('http://www.w3.org/ns/shacl#select')
const shAsk = DataFactory.namedNode('http://www.w3.org/ns/shacl#ask')
const sparql = new SparqlParser()
const engine = new QueryEngine()

function check(condition, label) {
  assert.ok(condition, label)
  console.log(`PASS ${label}`)
}

async function parseFile(name, format) {
  const source = await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
  try { return new RdfParser({ format, baseIRI: ex }).parse(source) }
  catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }) }
}

async function load(store, name, format, graph) {
  // Stage the complete parse before touching the active graph.
  const staged = await parseFile(name, format)
  store.removeQuads(store.getQuads(null, null, null, graph))
  store.addQuads(staged.map(q => DataFactory.quad(q.subject, q.predicate, q.object, graph)))
}

function safeQuery(text, forms = ['select', 'ask', 'construct', 'describe']) {
  const ast = sparql.parse(text)
  const hasService = node => node && typeof node === 'object' &&
    (node.subType === 'service' || Object.values(node).some(hasService))
  if (ast.type !== 'query' || !forms.includes(ast.subType) ||
      ast.datasets.clauses.length || hasService(ast)) throw new Error('query policy rejected input')
  return text
}

function queryView(store) {
  const view = new Store(store.getQuads(null, null, null, null))
  for (const graph of [graphs.ontology, graphs.model]) {
    view.addQuads(store.getQuads(null, null, null, graph)
      .map(q => DataFactory.quad(q.subject, q.predicate, q.object)))
  }
  return view
}

async function main() {
  const store = new Store()
  await load(store, 'ontology.ttl', 'text/turtle', graphs.ontology)
  await load(store, 'model.nt', 'application/n-triples', graphs.model)
  await load(store, 'decoy.ttl', 'text/turtle', graphs.decoy)
  await load(store, 'shapes.ttl', 'text/turtle', graphs.shapes)
  check(store.countQuads(null, null, null, graphs.model) === 3, 'Turtle and N-Triples loaded as named graphs')

  const view = queryView(store)
  const context = { sources: [view], unionDefaultGraph: false }
  const typedContext = {
    ...context,
    initialBindings: new BindingsFactory(DataFactory).fromRecord({
      age: DataFactory.literal('7', DataFactory.namedNode('http://www.w3.org/2001/XMLSchema#integer'))
    })
  }
  const rows = await engine.queryBindings(safeQuery(`SELECT ?s WHERE { GRAPH <${graphs.model.value}> { ?s <${ex}age> ?age } }`), typedContext)
    .then(stream => stream.toArray())
  check(rows.length === 1 && rows[0].get('s').value === `${ex}car1`, 'SELECT, named graph, typed binding')
  check(await engine.queryBoolean(safeQuery(`ASK { <${ex}car1> <${ex}age> ?age }`), typedContext), 'ASK uses typed binding in selected default union')
  check(!await engine.queryBoolean(safeQuery(`ASK { <${ex}secret> <${ex}flag> ?value }`), context), 'default union excludes decoy')
  check(await engine.queryBoolean(safeQuery(`ASK { GRAPH <${graphs.decoy.value}> { <${ex}secret> <${ex}flag> ?value } }`), context), 'decoy remains available by graph name')
  const construct = await engine.queryQuads(safeQuery(`CONSTRUCT { ?s <${ex}copy> ?age } WHERE { ?s <${ex}age> ?age }`), typedContext).then(stream => stream.toArray())
  check(construct.length === 1 && construct[0].object.datatype.value.endsWith('#integer'), 'CONSTRUCT uses typed binding and preserves datatype')
  const describe = await engine.queryQuads(safeQuery(`DESCRIBE ?s WHERE { ?s <${ex}age> ?age }`), typedContext).then(stream => stream.toArray())
  check(describe.length >= 3, 'DESCRIBE uses typed binding and returns local triples')

  for (const text of [
    `INSERT DATA { <${ex}s> <${ex}p> <${ex}o> }`,
    'LOAD <http://127.0.0.1:1/data>',
    'SELECT * WHERE { SERVICE <http://127.0.0.1:1/sparql> { ?s ?p ?o } }',
    'SELECT * WHERE { FILTER EXISTS { SERVICE <http://127.0.0.1:1/sparql> { ?s ?p ?o } } }',
    'SELECT * WHERE { { SELECT * WHERE { SERVICE <http://127.0.0.1:1/sparql> { ?s ?p ?o } } } }',
    `SELECT * FROM <${graphs.decoy.value}> WHERE { ?s ?p ?o }`,
    `SELECT * FROM NAMED <${graphs.decoy.value}> WHERE { ?s ?p ?o }`
  ]) assert.throws(() => safeQuery(text), /query policy rejected input/)
  check(true, 'Update, nested SERVICE, FROM, and FROM NAMED rejected before engine call')

  const shapes = new Store((await parseFile('shapes.ttl', 'text/turtle')))
  for (const predicate of [shSelect, shAsk]) {
    for (const q of shapes.getQuads(null, predicate, null, null)) safeQuery(q.object.value, ['select', 'ask'])
  }
  assert.throws(() => safeQuery('SELECT $this WHERE { SERVICE <http://127.0.0.1:1/> { $this ?p ?o } }', ['select', 'ask']))
  const data = new Store(store.getQuads(null, null, null, graphs.model)
    .map(q => DataFactory.quad(q.subject, q.predicate, q.object)))
  const report = await new Validator(shapes, { factory: DataFactory, targetResolvers, validations }).validate({ dataset: data })
  const components = report.results.map(r => r.constraintComponent.value)
  check(!report.conforms && components.some(c => c.endsWith('MinCountConstraintComponent')) &&
    components.some(c => c.endsWith('SPARQLConstraintComponent')), 'SHACL Core and SPARQL violations attributed to shapes graph')
  for (const result of report.results) {
    console.log(`DIAGNOSTIC shapesGraph=${graphs.shapes.value} component=${result.constraintComponent.value}`)
  }

  const before = store.countQuads(null, null, null, graphs.decoy)
  await assert.rejects(load(store, 'malformed.ttl', 'text/turtle', graphs.decoy), /malformed\.ttl/)
  check(store.countQuads(null, null, null, graphs.decoy) === before, 'malformed import names its file and leaves active graph intact')
  check(await engine.queryBoolean(safeQuery(`ASK { GRAPH <${graphs.model.value}> { <${ex}car1> <${ex}age> ?age } }`),
    { sources: [queryView(store)], unionDefaultGraph: false }), 'unrelated graph-specific query still runs')
  check(!await engine.queryBoolean(safeQuery(`ASK { <${ex}car1> a <${ex}Vehicle> }`), context) &&
    !await engine.queryBoolean(safeQuery(`ASK { <${ex}car1> <${ex}name> ?name }`), context), 'baseline has no implicit subclass or subproperty inference')
  check(await engine.queryBoolean(safeQuery(`ASK { <${ex}car1> a ?kind . ?kind <http://www.w3.org/2000/01/rdf-schema#subClassOf>* <${ex}Vehicle> }`), context) &&
    await engine.queryBoolean(safeQuery(`ASK { <${ex}car1> ?property "Roadster" . ?property <http://www.w3.org/2000/01/rdf-schema#subPropertyOf>* <${ex}name> }`), context),
  'SPARQL property paths recover subclass and subproperty relationships')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
