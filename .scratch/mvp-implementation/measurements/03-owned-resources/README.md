# Owned-resource capacity measurements

These synthetic Windows x64 executions on 2026-10-11 used Node 24.14.1, npm 11.17.0 and 68,633,952,256 bytes of physical RAM (approximately 64 GiB). [Raw measurements](measurement.json) retain exact counts, bytes, durations and memory observations. They establish behavior for these fixtures, not supported project sizes or latency guarantees.

## Authoring method and results

A temporary Node controller initialized projects with one, ten or twenty owned N-Triples files. Each file contained 50,000 distinct subject/literal statements, one ontology root and one shared class declaration:

```text
<urn:owned:{file}:s{i}> <urn:p> "value {i}" .
<urn:owned:{file}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Ontology> .
<urn:shared> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .
```

Files were written in batches of 10,000 statements. Each sample used an independent Node process with `--max-old-space-size=512` and called `prepareResource` with receiving type `data`, destination `proposed.ttl`, and `model.create` or `model.import`. No sample published the proposed file. Import used an external Turtle file with a conceptual data model root, the shared class and 10,000 distinct subject/literal statements. Assertions checked resulting classification and captured owned-file revisions.

The baseline restored `authoring.ts` and `inspection.ts` from commit `704783e3dc919dec6f616576b9b06311af572fae` in a temporary module copy, using the same dependencies and starter assets. Successful durations cover preparation after module loading. Peak resident memory is `process.resourceUsage().maxRSS`, converted from KiB to MiB; it includes the whole child process and is not V8 heap size. Failed baseline processes exited 134 with heap-exhaustion diagnostics; no successful duration or peak observation is claimed for them.

| Version  | Owned files × triples per file | Operation | Result          | Preparation | Peak resident memory |
| -------- | ------------------------------ | --------- | --------------- | ----------- | -------------------- |
| Baseline | 1 × 50,002                     | Create    | Success         | 1,405 ms    | 355 MiB              |
| Revised  | 1 × 50,002                     | Create    | Success         | 1,203 ms    | 306 MiB              |
| Baseline | 10 × 50,002                    | Create    | Heap exhaustion | —           | —                    |
| Baseline | 10 × 50,002                    | Import    | Heap exhaustion | —           | —                    |
| Revised  | 10 × 50,002                    | Create    | Success         | 3,689 ms    | 413 MiB              |
| Revised  | 10 × 50,002                    | Import    | Success         | 6,396 ms    | 407 MiB              |
| Revised  | 20 × 50,002                    | Create    | Success         | 6,559 ms    | 429 MiB              |

Sequential inspection removes simultaneous retention of unrelated stores and buffers. It still reads every owned graph for identity protection, records revisions proportional to file count, and parses each file in full. Import scans owned graphs again for term-collision diagnostics. A single large file, large receiving vocabulary closure or large import can still exhaust memory. Malformed or unreadable owned identities continue to block authoring.

## Preview method and results

Separate temporary Node processes started the real server and its 512 MiB old-generation worker, then prepared authenticated ontology-import previews from two tab sessions in alternation. The same process also ran the HTTP measurement controller, so resident-memory observations include controller overhead, server assets and worker allocations. The controller wrote the source before starting the server. Peak values are cumulative for that process. Staging bytes include `record.json` and proposed output files, not directory allocation or filesystem overhead.

Each external N-Triples source contained one ontology root plus either 10,000 or 100,000 distinct statements of the form `<urn:s{i}> <urn:p> "value {i}" .`. Their exact input sizes were 347,888 and 3,677,888 bytes. Each preview had a distinct absent destination. Durations cover cumulative sequential preview preparation, including HTTP and permission checks.

| Source data triples | Pending previews | Elapsed   | Staging bytes | Peak resident memory |
| ------------------- | ---------------- | --------- | ------------- | -------------------- |
| 10,000              | 1                | 1,290 ms  | 339,924       | 247 MiB              |
| 10,000              | 10               | 5,229 ms  | 3,399,240     | 386 MiB              |
| 10,000              | 100              | 51,365 ms | 33,992,940    | 387 MiB              |
| 100,000             | 1                | 2,215 ms  | 3,579,927     | 645 MiB              |
| 100,000             | 10               | 14,784 ms | 35,799,270    | 762 MiB              |

The 101st smaller preview returned `PROJECT_BUSY`. Cancelling one preview freed a slot for the other tab, without evicting its previews. Graceful shutdown reduced staging bytes to zero in both executions. Assertions checked preview responses, shared-cap behavior, cancellation and cleanup. Separate worker/HTTP regressions establish idle expiry, expiry during publication, partial staging failure, cleanup-failure warnings, stale revisions, worker replacement and startup cleanup while preserving unknown files and transaction evidence.

The count cap remains 100 and explicitly provisional. These fixtures do not calibrate a universal count or byte quota: larger outputs require more disk, and allocation peaks depend on parsing/serialization as well as retained plans. The heap limit does not bound buffers or whole-process resident memory. Cleanup can wait for an active operation, and unsafe or failed cleanup leaves files with diagnostics. Linux/macOS execution, representative customer projects, disk-full stress, maximal allowed imports and long-duration storage testing remain unmeasured.
