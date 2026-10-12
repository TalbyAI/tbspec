import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectProject } from "../src/inspection.ts";
import { initializeProject } from "../src/project.ts";
import { listQueries, queryRemove, queryRun, querySave, showQuery } from "../src/query.ts";

test("saved queries preserve declaration bytes and expose their parsed parameters", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-files-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  const parameters =
    '# Keep this comment\r\nschema_version = 1\r\n\r\n[[parameters]]\r\nname = "customer"\r\nkind = "iri"\r\nrequired = true\r\n';
  const queryText = "SELECT ?order WHERE { ?order <urn:queries:customer> ?customer }";

  const saved = await querySave({
    project: root,
    name: "orders-by-customer",
    queryText,
    parametersText: parameters,
  });

  assert.equal(saved.status, "ok", JSON.stringify(saved));
  assert.equal(
    await readFile(join(root, "queries/orders-by-customer.query.toml"), "utf8"),
    parameters,
  );
  const listed = await listQueries({ project: root });
  assert.equal(listed.status, "ok", JSON.stringify(listed));
  assert.deepEqual(listed.data?.items, [
    {
      name: "orders-by-customer",
      queryFile: "queries/orders-by-customer.rq",
      parametersFile: "queries/orders-by-customer.query.toml",
      parameters: [{ name: "customer", kind: "iri", required: true }],
    },
  ]);
  const shown = await showQuery({ project: root, name: "orders-by-customer" });
  assert.equal(shown.status, "ok", JSON.stringify(shown));
  assert.equal(shown.data?.queryText, queryText);
  assert.equal(shown.data?.revisions.query.state, "present");
  assert.equal(shown.data?.revisions.parameters.state, "present");
});

test("query files preserve a UTF-8 BOM while parsing and running the saved query", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-bom-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  const queryText = '\uFEFFASK { <urn:query:bom> <urn:query:value> "present" }';
  const parametersText = "\uFEFFschema_version = 1\nparameters = []\n";
  const saved = await querySave({ project: root, name: "bom", queryText, parametersText });
  assert.equal(saved.status, "ok", JSON.stringify(saved));
  assert.deepEqual(await readFile(join(root, "queries/bom.rq")), Buffer.from(queryText));
  assert.deepEqual(
    await readFile(join(root, "queries/bom.query.toml")),
    Buffer.from(parametersText),
  );
  const shown = await showQuery({ project: root, name: "bom" });
  assert.equal(shown.data?.queryText, queryText);
  const result = await queryRun({ project: root, saved: "bom" });
  assert.deepEqual(result.data, { type: "ask", value: false });
});

test("local query forms preserve typed RDF results and false ASK succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-results-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  await writeFile(
    join(root, "ontology.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix ex: <urn:query:> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<urn:query:ontology> a owl:Ontology; ex:label "Bonjour"@FR; ex:code "007"^^xsd:integer; ex:child [ ex:label "Child" ] .
<urn:query:Child> rdfs:subClassOf <urn:query:Parent> .
<urn:query:instance> a <urn:query:Child> .
`,
  );
  const lockBefore = await readFile(join(root, "tbspec.lock"));
  const ontologyBefore = await readFile(join(root, "ontology.ttl"));

  const selected = await queryRun({
    project: root,
    queryText:
      "SELECT ?label ?missing WHERE { <urn:query:ontology> <urn:query:label> ?label OPTIONAL { <urn:query:ontology> <urn:query:absent> ?missing } }",
  });
  assert.equal(selected.status, "ok", JSON.stringify(selected));
  assert.deepEqual(selected.data, {
    type: "select",
    variables: ["label", "missing"],
    rows: [{ label: { kind: "literal", value: "Bonjour", language: "fr" } }],
  });

  const wildcard = await queryRun({
    project: root,
    queryText:
      "SELECT * WHERE { { SELECT ?subject WHERE { ?subject <urn:query:label> ?hidden } } }",
  });
  assert.equal(wildcard.status, "ok", JSON.stringify(wildcard));
  assert.ok(wildcard.data);
  assert.equal(wildcard.data.type, "select");
  assert.deepEqual(wildcard.data.variables, ["subject"]);
  assert.equal((wildcard.data.rows as unknown[]).length, 2);
  assert.ok(
    (wildcard.data.rows as Record<string, unknown>[]).every(
      (row) => Object.keys(row).join() === "subject",
    ),
  );

  const typed = await queryRun({
    project: root,
    queryText: "SELECT ?subject WHERE { ?subject <urn:query:code> ?code }",
    bindingsText:
      '{"code":{"kind":"literal","value":"007","datatype":"http://www.w3.org/2001/XMLSchema#integer"}}',
  });
  assert.equal(typed.status, "ok", JSON.stringify(typed));
  assert.ok(typed.data);
  assert.equal(typed.data.type, "select");
  assert.equal(
    (typed.data.rows as { subject: { value: string } }[])[0]?.subject.value,
    "urn:query:ontology",
  );

  const falseAsk = await queryRun({
    project: root,
    queryText: "ASK { <urn:query:missing> ?p ?o }",
  });
  assert.equal(falseAsk.status, "ok", JSON.stringify(falseAsk));
  assert.deepEqual(falseAsk.data, { type: "ask", value: false });

  const blank = await queryRun({
    project: root,
    queryText: "SELECT ?child WHERE { <urn:query:ontology> <urn:query:child> ?child }",
  });
  assert.ok(blank.data);
  assert.deepEqual((blank.data.rows as { child: { kind: string; scope: string } }[])[0]?.child, {
    kind: "blank",
    value: "b0",
    scope: "result",
  });

  const constructed = await queryRun({
    project: root,
    queryText:
      "CONSTRUCT { <urn:query:copy> <urn:query:label> ?label } WHERE { <urn:query:ontology> <urn:query:label> ?label }",
  });
  assert.ok(constructed.data);
  assert.equal(constructed.data.type, "construct");
  assert.deepEqual((constructed.data.triples as { object: unknown }[])[0]?.object, {
    kind: "literal",
    value: "Bonjour",
    language: "fr",
  });

  const described = await queryRun({
    project: root,
    queryText: "DESCRIBE <urn:query:ontology>",
  });
  assert.ok(described.data);
  assert.equal(described.data.type, "describe");
  assert.ok((described.data.triples as unknown[]).length >= 3);

  const hierarchy = await queryRun({
    project: root,
    queryText:
      "SELECT ?ancestor WHERE { <urn:query:Child> <http://www.w3.org/2000/01/rdf-schema#subClassOf>+ ?ancestor }",
  });
  assert.equal(hierarchy.status, "ok", JSON.stringify(hierarchy));
  assert.ok(hierarchy.data);
  assert.equal(
    (hierarchy.data.rows as Record<string, { value: string }>[])[0]?.ancestor?.value,
    "urn:query:Parent",
  );
  const noInference = await queryRun({
    project: root,
    queryText: "ASK { <urn:query:instance> a <urn:query:Parent> }",
  });
  assert.deepEqual(noInference.data, { type: "ask", value: false });
  assert.deepEqual(await readFile(join(root, "tbspec.lock")), lockBefore);
  assert.deepEqual(await readFile(join(root, "ontology.ttl")), ontologyBefore);
});

test("full-project queries keep support and unclassified graphs named-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-dataset-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  await writeFile(
    join(root, "model.ttl"),
    `@prefix meta: <https://talby.ai/ontology/tbspec#> . <urn:dataset:model> a meta:Model; <urn:dataset:value> "model" .`,
  );
  await writeFile(
    join(root, "support.ttl"),
    `@prefix meta: <https://talby.ai/ontology/tbspec#> . <urn:dataset:support> a meta:ShapesGraph; <urn:dataset:value> "support" .`,
  );
  await writeFile(join(root, "plain.ttl"), '<urn:dataset:plain> <urn:dataset:value> "plain" .');
  for (const [queryText, value] of [
    ['ASK { <urn:dataset:model> <urn:dataset:value> "model" }', true],
    ['ASK { <urn:dataset:support> <urn:dataset:value> "support" }', false],
    [
      'ASK { GRAPH <urn:dataset:support> { <urn:dataset:support> <urn:dataset:value> "support" } }',
      true,
    ],
  ] as [string, boolean][]) {
    const result = await queryRun({ project: root, queryText });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(result.data, { type: "ask", value });
  }
  const inventory = await inspectProject({ project: root, command: "graph.list" });
  assert.equal(inventory.status, "ok", JSON.stringify(inventory));
  const plain = inventory.data?.items?.find((resource) => resource.selector === "plain.ttl");
  const plainIri = plain?.graphIri;
  assert.ok(typeof plainIri === "string");
  const defaultPlain = await queryRun({
    project: root,
    queryText: 'ASK { <urn:dataset:plain> <urn:dataset:value> "plain" }',
  });
  const namedPlain = await queryRun({
    project: root,
    queryText: `ASK { GRAPH <${plainIri}> { <urn:dataset:plain> <urn:dataset:value> "plain" } }`,
  });
  assert.deepEqual(defaultPlain.data, { type: "ask", value: false });
  assert.deepEqual(namedPlain.data, { type: "ask", value: true });
});

test("full queries report unresolved choices and graph collisions while exact selection stays isolated", async () => {
  const unresolvedRoot = await mkdtemp(join(tmpdir(), "tbspec-query-choice-"));
  await initializeProject({ directory: unresolvedRoot, baseIri: "urn:queries:/" });
  await writeFile(join(unresolvedRoot, "selected.ttl"), '<urn:selected> <urn:p> "selected" .');
  await writeFile(
    join(unresolvedRoot, "tbspec.toml"),
    `${await readFile(join(unresolvedRoot, "tbspec.toml"), "utf8")}\n[ontology_choices]\n"urn:not-installed" = "missing-dependency"\n`,
  );
  const selected = await queryRun({
    project: unresolvedRoot,
    graph: "selected.ttl",
    queryText: 'ASK { <urn:selected> <urn:p> "selected" }',
  });
  assert.deepEqual(selected.data, { type: "ask", value: true });
  const unresolved = await queryRun({
    project: unresolvedRoot,
    queryText: "ASK { ?s ?p ?o }",
  });
  assert.equal(unresolved.status, "conflict", JSON.stringify(unresolved));
  assert.equal(unresolved.diagnostics[0]?.code, "ONTOLOGY_CONFLICT");

  const collisionRoot = await mkdtemp(join(tmpdir(), "tbspec-query-collision-"));
  await initializeProject({ directory: collisionRoot, baseIri: "urn:queries:/" });
  await writeFile(
    join(collisionRoot, "one.ttl"),
    `@prefix meta: <https://talby.ai/ontology/tbspec#> . <urn:colliding-support> a meta:ShapesGraph; <urn:p> "one" .`,
  );
  await writeFile(
    join(collisionRoot, "two.ttl"),
    `@prefix meta: <https://talby.ai/ontology/tbspec#> . <urn:colliding-support> a meta:ShapesGraph; <urn:p> "two" .`,
  );
  const collision = await queryRun({ project: collisionRoot, queryText: "ASK { ?s ?p ?o }" });
  assert.equal(collision.status, "conflict", JSON.stringify(collision));
  assert.equal(collision.diagnostics[0]?.code, "GRAPH_IRI_COLLISION");
});

test("selected graph queries ignore malformed unrelated files and reject unsafe query forms", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-isolation-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  await writeFile(
    join(root, "selected.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> . <urn:selected> a owl:Ontology; <urn:p> <urn:o> .`,
  );
  await writeFile(join(root, "broken.ttl"), "broken Turtle [");

  const isolated = await queryRun({
    project: root,
    graph: "selected.ttl",
    queryText: "ASK { GRAPH <urn:selected> { <urn:selected> <urn:p> <urn:o> } }",
  });
  assert.equal(isolated.status, "ok", JSON.stringify(isolated));
  assert.deepEqual(isolated.data, { type: "ask", value: true });
  const whole = await queryRun({ project: root, queryText: "ASK { ?s ?p ?o }" });
  assert.equal(whole.status, "invalid");
  assert.ok(whole.diagnostics.some((diagnostic) => diagnostic.code === "RDF_SYNTAX"));

  for (const queryText of [
    "INSERT DATA { <urn:s> <urn:p> <urn:o> }",
    "SELECT * WHERE { SERVICE <https://example.org/sparql> { ?s ?p ?o } }",
    "SELECT * FROM <urn:remote> WHERE { ?s ?p ?o }",
    "SELECT * FROM NAMED <urn:remote> WHERE { ?s ?p ?o }",
    "SELECT * WHERE { FILTER EXISTS { SERVICE <https://example.org/sparql> { ?s ?p ?o } } }",
  ]) {
    const rejected = await queryRun({ project: root, graph: "selected.ttl", queryText });
    assert.equal(rejected.status, "invalid_arguments", queryText);
    assert.equal(rejected.diagnostics[0]?.code, "QUERY_REJECTED");
  }
});

test("saved query bindings follow declarations and removal requires confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-lifecycle-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  await writeFile(
    join(root, "data.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> . <urn:data> a owl:Ontology; <urn:value> "7" .`,
  );
  assert.equal(
    (
      await querySave({
        project: root,
        name: "required-value",
        queryText: "SELECT ?subject WHERE { ?subject <urn:value> ?value }",
        parametersText: `schema_version = 1\n\n[[parameters]]\nname = "value"\nkind = "literal"\nrequired = true\n`,
      })
    ).status,
    "ok",
  );
  const missing = await queryRun({ project: root, saved: "required-value" });
  assert.equal(missing.status, "invalid_arguments");
  const wrong = await queryRun({
    project: root,
    saved: "required-value",
    bindingsText: '{"value":{"kind":"iri","value":"urn:value"}}',
  });
  assert.equal(wrong.status, "invalid_arguments");
  const matching = await queryRun({
    project: root,
    saved: "required-value",
    bindingsText: '{"value":{"kind":"literal","value":"7"}}',
  });
  assert.equal(matching.status, "ok", JSON.stringify(matching));
  assert.ok(matching.data);
  assert.equal((matching.data.rows as unknown[]).length, 1);

  const preview = await queryRemove({ project: root, name: "required-value" });
  assert.equal(preview.status, "preview");
  assert.ok(preview.data);
  assert.equal((preview.data.preview as { changes: unknown[] }).changes.length, 2);
  assert.equal((await listQueries({ project: root })).status, "ok");
  const removed = await queryRemove({ project: root, name: "required-value", confirm: true });
  assert.equal(removed.status, "ok", JSON.stringify(removed));
  assert.equal((await listQueries({ project: root })).data?.items.length, 0);
});

test("saved-query updates and removals reject stale reviewed file revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-revisions-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  const initial = await querySave({
    project: root,
    name: "reviewed",
    queryText: "ASK { ?s ?p ?o }",
  });
  assert.equal(initial.status, "ok", JSON.stringify(initial));

  const reviewed = await showQuery({ project: root, name: "reviewed" });
  assert.equal(reviewed.status, "ok", JSON.stringify(reviewed));
  const declarationPath = join(root, "queries/reviewed.query.toml");
  const updatedDeclaration = "# independent edit\nschema_version = 1\nparameters = []\n";
  await writeFile(declarationPath, updatedDeclaration);
  const staleSave = await querySave({
    project: root,
    name: "reviewed",
    queryText: "ASK { ?s ?p ?o }",
    expectedRevisions: reviewed.data?.revisions,
  });
  assert.equal(staleSave.status, "conflict", JSON.stringify(staleSave));
  assert.equal(await readFile(declarationPath, "utf8"), updatedDeclaration);

  const latest = await showQuery({ project: root, name: "reviewed" });
  assert.equal(latest.status, "ok", JSON.stringify(latest));
  const queryPath = join(root, "queries/reviewed.rq");
  const updatedQuery = "ASK { <urn:latest> ?p ?o }";
  await writeFile(queryPath, updatedQuery);
  const staleRemove = await queryRemove({
    project: root,
    name: "reviewed",
    confirm: true,
    expectedRevisions: latest.data?.revisions,
  });
  assert.equal(staleRemove.status, "conflict", JSON.stringify(staleRemove));
  assert.equal(await readFile(queryPath, "utf8"), updatedQuery);
  assert.equal(await readFile(declarationPath, "utf8"), updatedDeclaration);
});

test("saved-query create review binds both target files to absence", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-absent-revision-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  await mkdir(join(root, "queries"));
  await writeFile(join(root, "queries/raced.rq"), "ASK { ?s ?p ?o }");
  const raced = await querySave({
    project: root,
    name: "raced",
    queryText: "ASK { <urn:draft> ?p ?o }",
    expectedRevisions: { query: { state: "absent" }, parameters: { state: "absent" } },
  });
  assert.equal(raced.status, "conflict", JSON.stringify(raced));
  assert.equal(await readFile(join(root, "queries/raced.rq"), "utf8"), "ASK { ?s ?p ?o }");
  await assert.rejects(readFile(join(root, "queries/raced.query.toml")), { code: "ENOENT" });
});

test("bindings enforce BCP 47 tag grammar and SPARQL variable names", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-query-language-tags-"));
  await initializeProject({ directory: root, baseIri: "urn:queries:/" });
  for (const language of ["en-US", "x-private", "i-klingon", "zh-cmn-Hans-CN"]) {
    const result = await queryRun({
      project: root,
      queryText: "SELECT ?1 WHERE { BIND(?input AS ?1) }",
      bindingsText: JSON.stringify({ input: { kind: "literal", value: "hello", language } }),
    });
    assert.equal(result.status, "ok", language);
    assert.ok(result.data);
    assert.deepEqual((result.data.rows as Record<string, unknown>[])[0]?.["1"], {
      kind: "literal",
      value: "hello",
      language: language.toLowerCase(),
    });
  }
  for (const language of ["en-a", "en-abcde-abcde", "en-US-123456789", "en-u-ca-gregory-u-nu-latn"])
    assert.equal(
      (
        await queryRun({
          project: root,
          queryText: "SELECT ?1 WHERE { BIND(?input AS ?1) }",
          bindingsText: JSON.stringify({ input: { kind: "literal", value: "hello", language } }),
        })
      ).status,
      "invalid_arguments",
      language,
    );
  const declaration = await querySave({
    project: root,
    name: "digit-variable",
    queryText: 'SELECT ?1 WHERE { BIND("value" AS ?1) }',
    parametersText:
      'schema_version = 1\n[[parameters]]\nname = "1"\nkind = "literal"\nrequired = true\n',
  });
  assert.equal(declaration.status, "ok", JSON.stringify(declaration));
});
