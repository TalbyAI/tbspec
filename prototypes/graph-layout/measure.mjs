import ELK from 'elkjs/lib/elk.bundled.js';
import { writeFile } from 'node:fs/promises';
import { fixture, project, layoutInput, positionsFrom, grid, overlaps, fillMissing, addResource, rename, fingerprint } from './graph.js';
const elk = new ELK();
const results = [];
for (const count of [100, 1000]) {
  const source = fixture(count), graph = project(source);
  const originalSource = JSON.stringify(source);
  const start = performance.now();
  const positions = positionsFrom(await elk.layout(layoutInput(graph)));
  const ms = performance.now() - start;
  const repeated = positionsFrom(await elk.layout(layoutInput(graph)));
  const added = fillMissing(project(addResource(source, graph.nodes[1].id)), positions);
  const edited = fillMissing(project(rename(source, graph.nodes[1].id)), positions);
  results.push({ count, edges: graph.edges.length, nodeLayoutMs: Math.round(ms),
    finiteCoordinates: Object.values(positions).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
    elkOverlaps: overlaps(positions), gridOverlaps: overlaps(grid(graph)),
    repeatPositionsEqual: fingerprint(positions) === fingerprint(repeated),
    existingPositionsPreservedOnAdd: Object.keys(positions).every(id => JSON.stringify(positions[id]) === JSON.stringify(added[id])),
    overlapsAfterAdd: overlaps(added), literalEditPositionsEqual: fingerprint(positions) === fingerprint(edited),
    sourceUnchangedByLayout: originalSource === JSON.stringify(source) });
}
const record = { executedAt: new Date().toISOString(), platform: process.platform, node: process.version, elk: '0.12.0', results };
await writeFile('measurement.json', JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record, null, 2));
