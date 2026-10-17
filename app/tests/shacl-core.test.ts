import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Parser, Store } from "n3";
import { inspectProject } from "../src/inspection.ts";
import { ProjectError } from "../src/output.ts";
import { initializeProject } from "../src/project.ts";
import { runShapes } from "../src/shacl-execution.ts";
import { prepareShapes } from "../src/shacl-profile.ts";

const prefixes = `@prefix t: <https://talby.ai/ontology/tbspec#> . @prefix sh: <http://www.w3.org/ns/shacl#> . @prefix ex: <urn:ex:> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;

test("Core count validation does not load SPARQL execution dependencies", () => {
  const script = `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    import { Parser, Store } from "n3";
    registerHooks({ resolve(specifier, context, nextResolve) {
      assert.ok(!specifier.startsWith("@comunica/"), "Unexpected SPARQL dependency: " + specifier);
      return nextResolve(specifier, context);
    }});
    const { runShapes } = await import(${JSON.stringify(new URL("../src/shacl-execution.ts", import.meta.url).href)});
    const { prepareShapes } = await import(${JSON.stringify(new URL("../src/shacl-profile.ts", import.meta.url).href)});
    const graph = text => new Store(new Parser().parse(${JSON.stringify(prefixes)} + text));
    const report = await runShapes(prepareShapes(graph("ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:minCount 2 .")), graph("ex:item ex:value 1 ."));
    assert.equal(report.conforms, false);
    assert.equal(report.results.length, 1);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("SHACL constructs query engines only for actual SELECT or Core comparison work", () => {
  const script = `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    import { Parser, Store } from "n3";
    const require = createRequire(import.meta.url);
    const dependency = require("@comunica/query-sparql-rdfjs-lite/lib/QueryEngine.js");
    const Original = dependency.QueryEngine;
    let engines = 0;
    dependency.QueryEngine = class extends Original {
      constructor(...args) { super(...args); engines++; }
    };
    const { runShapes } = await import(${JSON.stringify(new URL("../src/shacl-execution.ts", import.meta.url).href)});
    const { prepareShapes } = await import(${JSON.stringify(new URL("../src/shacl-profile.ts", import.meta.url).href)});
    const graph = (text) => new Store(new Parser().parse(${JSON.stringify(prefixes)} + text));
    const data = graph("ex:item ex:value 1 .");
    const validate = (shapes) => runShapes(prepareShapes(graph(shapes)), data);
    try {
      const count = await validate("ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:minCount 2 .");
      assert.equal(count.conforms, false);
      assert.equal(engines, 0, "Core count constraints must not construct a query engine");
      const range = await validate("ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:minExclusive 2 .");
      assert.equal(range.conforms, false);
      assert.equal(engines, 1, "Typed Core comparison must still execute its query fallback");
      const sparql = await validate('ex:shape a sh:NodeShape; sh:targetNode ex:item; sh:sparql [ sh:select "SELECT $this WHERE { $this <urn:ex:value> ?value }" ] .');
      assert.equal(sparql.conforms, false);
      assert.equal(engines, 2, "SELECT work must use an engine local to that validation");
      const conforming = await validate("ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:minCount 1 .");
      assert.equal(conforming.conforms, true);
      assert.equal(engines, 2);
    } finally { dependency.QueryEngine = Original; }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("SHACL comparison reuse preserves exact terms, bounded retention and independent runs", () => {
  const script = `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    import { Parser, Store } from "n3";
    const require = createRequire(import.meta.url);
    const dependency = require("@comunica/query-sparql-rdfjs-lite/lib/QueryEngine.js");
    const Original = dependency.QueryEngine;
    let calls = 0, failNext = false;
    dependency.QueryEngine = class extends Original {
      async queryBindings(...args) {
        calls++;
        if(failNext) { failNext = false; throw new Error("Transient query failure"); }
        return super.queryBindings(...args);
      }
    };
    const { runShapes } = await import(${JSON.stringify(new URL("../src/shacl-execution.ts", import.meta.url).href)});
    const { prepareShapes } = await import(${JSON.stringify(new URL("../src/shacl-profile.ts", import.meta.url).href)});
    const graph = text => new Store(new Parser().parse(${JSON.stringify(prefixes)} + text));
    const validate = (data, limit = "0", extra = "") => runShapes(prepareShapes(graph(
      "ex:shape a sh:PropertyShape; sh:targetSubjectsOf ex:value; sh:path ex:value; sh:minInclusive " + limit + " . " + extra
    )), graph(data));
    const repeated = (term, count = 12) => Array.from({length:count}, (_, i) => "ex:item" + i + " ex:value " + term + " .").join(" ");
    try {
      const first = await validate(repeated("1"));
      assert.equal(first.conforms, true);
      assert.equal(calls, 1, "Repeated typed comparisons should execute once per run");
      const before = calls;
      const concurrent = await Promise.all([validate(repeated("1")), validate(repeated("-1"))]);
      assert.deepEqual(concurrent.map(r => r.conforms), [true, false]);
      assert.equal(calls - before, 2, "Concurrent runs must not share comparison results");

      for(const [term, limit, conforms, expectedCalls] of [
        ['"01"^^xsd:integer', '0', true, 1],
        ['"1"^^xsd:decimal', '0', true, 1],
        ['"bad"^^xsd:integer', '0', false, 1],
        ['"INF"^^xsd:double', '0', true, 1],
        ['"NaN"^^xsd:double', '0', false, 1],
        ['"2026-01-01T01:00:00+01:00"^^xsd:dateTime', '"2026-01-01T00:00:00Z"^^xsd:dateTime', true, 1],
        ['"2026-01-01T00:00:00"^^xsd:dateTime', '"2026-01-01T00:00:00Z"^^xsd:dateTime', false, 0],
      ]) {
        const start = calls;
        assert.equal((await validate(repeated(term), limit)).conforms, conforms, term);
        assert.equal(calls - start, expectedCalls, term);
      }
      const start = calls;
      assert.equal((await validate('ex:a ex:value "1"^^xsd:integer . ex:b ex:value "01"^^xsd:integer . ex:c ex:value "1"^^xsd:decimal . ex:d ex:value "1"@en . ex:e ex:value "1"@fr .')).conforms, false);
      assert.equal(calls - start, 5, "Lexical forms, datatypes and languages must remain distinct");

      const capacityStart = calls;
      const many = Array.from({length:300}, (_, i) => "ex:item" + i + " ex:value " + i + " .").join(" ");
      assert.equal((await validate(many, "0", "ex:other a sh:PropertyShape; sh:targetSubjectsOf ex:value; sh:path ex:value; sh:minInclusive 0 .")).conforms, true);
      assert.equal(calls - capacityStart, 344, "Only 256 comparison entries may be retained");
      const largeStart = calls;
      assert.equal((await validate(repeated('"' + '9'.repeat(3000) + '"^^xsd:integer', 2))).conforms, true);
      assert.equal(calls - largeStart, 2, "Oversized keys must not be retained");
      failNext = true;
      const transientStart = calls;
      const transient = await validate(repeated("1", 2));
      assert.equal(transient.results.length, 1);
      assert.equal(calls - transientStart, 2, "Transient failures must not become cached results");
    } finally { dependency.QueryEngine = Original; }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
});

async function project() {
  const root = await mkdtemp(join(tmpdir(), "tb-shacl-core-"));
  assert.equal(
    (await initializeProject({ directory: root, baseIri: "https://example.org/" })).status,
    "ok",
  );
  return root;
}

async function inspect(root: string, data: string, shapes: string) {
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:value a owl:DatatypeProperty . ${data}`,
  );
  await writeFile(
    join(root, "model.shacl.ttl"),
    `${prefixes} ex:graph a t:ShapesGraph . ${shapes}`,
  );
  return inspectProject({ project: root, command: "validate", selector: "model.ttl" });
}

function graph(text: string) {
  return new Store(new Parser().parse(`${prefixes} ${text}`));
}

function rejectShapes(shapes: string) {
  assert.throws(
    () => prepareShapes(graph(shapes)),
    (error: unknown) =>
      error instanceof ProjectError &&
      error.status === "invalid" &&
      error.diagnostic.code === "SHACL_GRAPH_INVALID",
    shapes,
  );
}

function patternShape(pattern: string, flags = "") {
  const flag = flags ? `; sh:flags ${JSON.stringify(flags)}` : "";
  return `ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:pattern ${JSON.stringify(pattern)}${flag} .`;
}

function runPattern(pattern: string, value: string, flags = "") {
  return runShapes(
    prepareShapes(graph(patternShape(pattern, flags))),
    graph(`ex:item ex:value ${JSON.stringify(value)} .`),
  );
}

test("SHACL patterns accept XPath XML name escapes, class subtraction, Unicode categories, and blocks", async () => {
  const accepted: [string, string][] = [
    ["^\\i\\c*$", "é-name9"],
    ["^\\I+$", "123"],
    ["^[a-z-[aeiou]]+$", "rhythm"],
    ["^\\p{Lu}+\\p{Nd}$", "Ω7"],
    ["^\\p{IsGreek}+$", "Ωβ"],
    ["^\\P{IsGreek}+$", "abc"],
  ];
  for (const [pattern, value] of accepted) {
    const report = await runPattern(pattern, value);
    assert.equal(report.conforms, true, pattern);
  }

  const subtraction = await runPattern("^[a-z-[aeiou]]+$", "ae");
  assert.equal(subtraction.conforms, false);
  assert.equal(
    subtraction.results[0]?.constraintComponent.value,
    "http://www.w3.org/ns/shacl#PatternConstraintComponent",
  );
});

test("SHACL patterns keep XPath substring, anchor, flag, and back-reference semantics", async () => {
  const accepted: [string, string, string][] = [
    ["^b$", "a\nb\nc", "m"],
    ["^a.b$", "a\nb", "s"],
    ["^ä$", "Ä", "i"],
    ["^(ab)\\1$", "abab", ""],
    ["^(a)\\12$", "aa2", ""],
    ["^a[ ]b$", "a b", "x"],
    ["^a#b$", "a#b", "x"],
  ];
  for (const [pattern, value, flags] of accepted) {
    const report = await runPattern(pattern, value, flags);
    assert.equal(report.conforms, true, `${pattern}/${flags}`);
  }

  for (const [pattern, value] of [
    ["^b$", "a\nb\nc"],
    ["^(ab)\\1$", "abba"],
    ["^(a)\\12$", "a2"],
  ] as const)
    assert.equal((await runPattern(pattern, value)).conforms, false, pattern);
});

test("SHACL XPath patterns keep Unicode i semantics distinct from JavaScript", async () => {
  const matching: [string, string][] = [
    ["^I$", "ı"],
    ["^(I)\\1$", "Iı"],
  ];
  for (const [pattern, value] of matching) {
    assert.equal((await runPattern(pattern, value, "i")).conforms, true, pattern);
  }

  const nonmatching: [string, string][] = [
    ["^\\p{Lu}$", "a"],
    ["^\\p{Ll}$", "A"],
    ["^\\i$", "µ"],
    ["^\\i$", "ͅ"],
  ];
  for (const [pattern, value] of nonmatching) {
    assert.equal((await runPattern(pattern, value, "i")).conforms, false, pattern);
  }
});

test("SHACL XPath patterns keep line terminators, free-spacing escapes, and bounded parser work", async () => {
  const nonmatching: [string, string, string][] = [
    ["^b$", "a\rb", "m"],
    ["a{1000000000}", "a", ""],
  ];
  for (const [pattern, value, flags] of nonmatching) {
    assert.equal((await runPattern(pattern, value, flags)).conforms, false, `${pattern}/${flags}`);
  }

  assert.equal((await runPattern(".", "\r")).conforms, true);
  assert.equal((await runPattern("^a\\ sb$", "a\tb", "x")).conforms, true);

  for (const pattern of ["(?:a)", "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l\\12)"]) {
    rejectShapes(patternShape(pattern));
  }

  assert.equal((await runPattern("a+?", "a")).conforms, true);
});

test("SHACL patterns reject JavaScript-only or malformed regex forms during preflight", () => {
  const rejected: [string, string][] = [
    ["(?=a)", ""],
    ["\\p{NoSuchCategory}", ""],
    ["[z-a]", ""],
    ["a", "q"],
  ];
  for (const [pattern, flags] of rejected) rejectShapes(patternShape(pattern, flags));
});

test("public SHACL validation attributes pattern violations and malformed shapes", async () => {
  const root = await project();
  const data = 'ex:item ex:value "ae" .';
  const matching = await inspect(root, data, patternShape("^\\i+$"));
  assert.equal(matching.status, "ok", JSON.stringify(matching.diagnostics));
  assert.equal(matching.data?.validationComplete, true);

  const violated = await inspect(root, data, patternShape("^[a-z-[aeiou]]+$"));
  assert.equal(violated.status, "invalid");
  assert.equal(violated.data?.validationComplete, true);
  const diagnostic = violated.diagnostics.find((item) => item.code === "SHACL_RESULT");
  assert.ok(diagnostic, JSON.stringify(violated.diagnostics));
  assert.equal(diagnostic.file, "model.ttl");
  assert.equal(diagnostic.selector, "model.ttl");
  assert.equal(diagnostic.shacl?.selector, "model.shacl.ttl");
  assert.equal(diagnostic.shacl?.focusNode?.value, "urn:ex:item");
  assert.equal(
    diagnostic.shacl?.constraintComponent?.value,
    "http://www.w3.org/ns/shacl#PatternConstraintComponent",
  );

  const malformed = await inspect(root, data, patternShape("(?=a)"));
  assert.equal(malformed.status, "invalid");
  assert.equal(malformed.data?.validationComplete, false);
  assert.ok(
    malformed.diagnostics.some(
      (item) => item.code === "SHACL_GRAPH_INVALID" && item.file === "model.shacl.ttl",
    ),
    JSON.stringify(malformed.diagnostics),
  );
});

test("Unicode SHACL string length counts Unicode code points", async () => {
  const root = await project();
  const value = "𝟠";
  const maxLength = await inspect(
    root,
    `ex:item ex:value ${JSON.stringify(value)} .`,
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:maxLength 1 .",
  );
  assert.equal(maxLength.status, "ok", JSON.stringify(maxLength.diagnostics));

  const minLength = await inspect(
    root,
    `ex:item ex:value ${JSON.stringify(value)} .`,
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:minLength 2 .",
  );
  assert.equal(minLength.status, "invalid");
  assert.ok(minLength.diagnostics.some((diagnostic) => diagnostic.code === "SHACL_RESULT"));
  assert.ok(
    minLength.diagnostics.some(
      (diagnostic) =>
        typeof diagnostic.shacl?.constraintComponent?.value === "string" &&
        diagnostic.shacl.constraintComponent.value.endsWith("MinLengthConstraintComponent"),
    ),
  );
});

test("SHACL integer count parameters retain signed xsd:integer semantics", async () => {
  const root = await project();
  const negativeMinimum = await inspect(
    root,
    "",
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:minCount -1 .",
  );
  assert.equal(negativeMinimum.status, "ok", JSON.stringify(negativeMinimum.diagnostics));
  assert.equal(
    negativeMinimum.diagnostics.some((diagnostic) => diagnostic.code === "SHACL_RESULT"),
    false,
  );

  const negativeMaximum = await inspect(
    root,
    'ex:item ex:value "present" .',
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:maxCount -1 .",
  );
  assert.ok(
    negativeMaximum.diagnostics.some(
      (diagnostic) =>
        typeof diagnostic.shacl?.constraintComponent?.value === "string" &&
        diagnostic.shacl.constraintComponent.value.endsWith("MaxCountConstraintComponent"),
    ),
  );
});

test("SHACL languageIn follows SPARQL language-range matching", async () => {
  const root = await project();
  for (const [range, tag] of [
    ["EN", "en-US"],
    ["*", "fr"],
  ]) {
    const result = await inspect(
      root,
      `ex:item ex:value "text"@${tag} .`,
      `ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:languageIn (${JSON.stringify(range)}) .`,
    );
    assert.equal(result.status, "ok", `${range}/${tag}: ${JSON.stringify(result.diagnostics)}`);
  }

  const boundary = await inspect(
    root,
    'ex:item ex:value "text"@english .',
    'ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:languageIn ("en") .',
  );
  assert.equal(boundary.status, "invalid");
  assert.ok(boundary.diagnostics.some((diagnostic) => diagnostic.code === "SHACL_RESULT"));
});

test("SHACL uniqueLang accepts every valid true lexical form of xsd:boolean", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:item ex:value "first"@en, "second"@en .',
    'ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:uniqueLang "1"^^xsd:boolean .',
  );
  assert.equal(result.status, "invalid");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SHACL_RESULT"));
});

test("disjoint qualified counts exclude a value matching any sibling shape", async () => {
  const root = await project();
  const result = await inspect(
    root,
    "ex:value a owl:ObjectProperty . ex:A a owl:Class . ex:B a owl:Class . ex:C a owl:Class . ex:item ex:value ex:node . ex:node a ex:A, ex:B .",
    `ex:shape a sh:NodeShape; sh:targetNode ex:item;
      sh:property [ sh:path ex:value; sh:qualifiedValueShape [ sh:class ex:A ]; sh:qualifiedValueShapesDisjoint true; sh:qualifiedMinCount 1 ];
      sh:property [ sh:path ex:value; sh:qualifiedValueShape [ sh:class ex:B ]; sh:qualifiedValueShapesDisjoint true; sh:qualifiedMinCount 1 ];
      sh:property [ sh:path ex:value; sh:qualifiedValueShape [ sh:class ex:C ]; sh:qualifiedValueShapesDisjoint true; sh:qualifiedMinCount 1 ] .`,
  );
  const results = result.diagnostics.filter((diagnostic) => diagnostic.code === "SHACL_RESULT");
  assert.equal(results.length, 3, JSON.stringify(result.diagnostics));
});

test("SHACL lessThan compares strings by Unicode code point", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:p a owl:DatatypeProperty . ex:q a owl:DatatypeProperty . ex:item ex:p "Z"; ex:q "a" .',
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:p; sh:lessThan ex:q .",
  );
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));

  const supplementary = await inspect(
    root,
    'ex:item ex:p "𐀀"; ex:q "" .',
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:p; sh:lessThan ex:q .",
  );
  assert.equal(supplementary.status, "invalid", JSON.stringify(supplementary.diagnostics));
  assert.ok(
    supplementary.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "SHACL_RESULT" &&
        String(diagnostic.shacl?.constraintComponent?.value ?? "").endsWith(
          "LessThanConstraintComponent",
        ),
    ),
  );
});

test("SHACL string ranges compare with SPARQL ordering", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:item ex:value "Z" .',
    'ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:maxExclusive "a" .',
  );
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));

  const equalBound = await inspect(
    root,
    'ex:item ex:value "Z" .',
    'ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:maxExclusive "Z" .',
  );
  assert.ok(
    equalBound.diagnostics.some(
      (diagnostic) =>
        typeof diagnostic.shacl?.constraintComponent?.value === "string" &&
        diagnostic.shacl.constraintComponent.value.endsWith("MaxExclusiveConstraintComponent"),
    ),
  );
});

test("SHACL dateTime range constraints reject values incomparable by timezone", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:time a owl:DatatypeProperty . ex:item ex:time "2002-10-09T12:00:00-05:00"^^xsd:dateTime, "2002-10-09T12:00:00"^^xsd:dateTime .`,
  );
  await writeFile(
    join(root, "model.shacl.ttl"),
    `${prefixes} ex:graph a t:ShapesGraph . ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:time; sh:minInclusive "2002-10-09T12:00:00"^^xsd:dateTime .`,
  );
  const result = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  const violations = result.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "SHACL_RESULT" &&
      String(diagnostic.shacl?.constraintComponent?.value ?? "").endsWith(
        "MinInclusiveConstraintComponent",
      ),
  );
  assert.equal(result.status, "invalid", JSON.stringify(result.diagnostics));
  assert.equal(violations.length, 1, JSON.stringify(result.diagnostics));
});

test("SHACL preflight rejects repeated Core singleton parameters", () => {
  const malformed = [
    'ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:pattern "a", "b" .',
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:maxInclusive 1, 2 .",
    'ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:languageIn ("en"), ("fr") .',
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:in (1), (2) .",
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:languageIn (1) .",
    'ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:closed true; sh:ignoredProperties ("not an IRI") .',
    'ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:flags "i", "m" .',
    "ex:shape sh:targetNode ex:item; sh:closed false, true .",
    "ex:shape sh:targetNode ex:item; sh:ignoredProperties (), (ex:value) .",
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:qualifiedValueShape [ ], [ ] .",
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:qualifiedValueShape [ ]; sh:qualifiedMinCount 0, 1 .",
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:qualifiedValueShape [ ]; sh:qualifiedMaxCount 1, 2 .",
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:qualifiedValueShape [ ]; sh:qualifiedValueShapesDisjoint true, false .",
    "ex:shape sh:targetNode ex:item; sh:severity sh:Warning, sh:Violation .",
  ];
  for (const shapes of malformed) rejectShapes(shapes);
});

test("SHACL preflight validates target nodes, severity, and messages", async () => {
  const root = await project();
  const malformed = [
    "ex:shape sh:targetNode [ ] .",
    'ex:shape sh:severity "warning" .',
    'ex:shape sh:message "message"^^ex:customString .',
  ];
  for (const shapes of malformed) rejectShapes(shapes);

  const valid = await inspect(
    root,
    'ex:item ex:value "present" .',
    'ex:shape sh:targetNode ex:item; sh:path ex:value; sh:severity sh:Warning; sh:message "Needs review"@en; sh:minCount 2 .',
  );
  assert.equal(valid.status, "ok");
  assert.ok(
    valid.diagnostics.some(
      (diagnostic) => diagnostic.code === "SHACL_RESULT" && diagnostic.severity === "warning",
    ),
    JSON.stringify(valid.diagnostics),
  );
});

test("SHACL preflight enforces literal range values and property-only parameters", async () => {
  const root = await project();
  const malformed = [
    "ex:shape sh:targetNode ex:item; sh:minInclusive ex:bound .",
    "ex:shape sh:targetNode ex:item; sh:maxExclusive [ ] .",
    "ex:shape a sh:NodeShape; sh:targetNode ex:item; sh:minCount 1 .",
    "ex:shape sh:targetNode ex:item; sh:maxCount 1 .",
    "ex:shape sh:targetNode ex:item; sh:uniqueLang true .",
    "ex:shape sh:targetNode ex:item; sh:lessThan ex:other .",
    'ex:shape sh:targetNode ex:item; sh:nodeKind "http://www.w3.org/ns/shacl#IRI" .',
    "ex:shape sh:targetNode ex:item; sh:qualifiedValueShape [ sh:class ex:A ]; sh:qualifiedMinCount 1 .",
    "ex:shape a sh:NodeShape; sh:targetNode ex:item; sh:qualifiedValueShape [ sh:class ex:A ]; sh:qualifiedMinCount 1 .",
    "ex:shape sh:targetNode ex:item; sh:or (ex:A 1) .",
    `ex:shape sh:targetNode ex:item; sh:or _:list . _:list <http://www.w3.org/1999/02/22-rdf-syntax-ns#first> ex:A; <http://www.w3.org/1999/02/22-rdf-syntax-ns#rest> "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil" .`,
    "ex:shape sh:targetNode ex:item; sh:node [ sh:path ex:value ] .",
    "ex:shape sh:targetNode ex:item; sh:path [ sh:inversePath ex:value; ex:extra true ] .",
    `ex:shape sh:targetNode ex:item; sh:sparql [ sh:prefixes [ sh:declare [ sh:prefix "ex: <urn:x:> PREFIX y"; sh:namespace "urn:ex:"^^xsd:anyURI ] ]; sh:select "SELECT $this WHERE { $this <urn:ex:p> ?value }" ] .`,
  ];
  for (const shapes of malformed) rejectShapes(shapes);

  const orphanQualifiedCounts = await inspect(
    root,
    "ex:C a owl:Class . ex:item a ex:C .",
    "ex:shape a sh:NodeShape; sh:targetNode ex:item; sh:class ex:C; sh:qualifiedValueShapesDisjoint true; sh:qualifiedMinCount 5; sh:qualifiedMaxCount 2 .",
  );
  assert.equal(
    orphanQualifiedCounts.status,
    "ok",
    JSON.stringify(orphanQualifiedCounts.diagnostics),
  );
  assert.equal(
    orphanQualifiedCounts.diagnostics.some((diagnostic) => diagnostic.code === "SHACL_RESULT"),
    false,
  );
});

test("SHACL closed parameters allow one ignored-property list and active raw paths", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:allowed a owl:DatatypeProperty . ex:alsoAllowed a owl:DatatypeProperty . ex:item ex:allowed "a"; ex:alsoAllowed "b" .',
    `ex:shape sh:targetNode ex:item; sh:closed true; sh:ignoredProperties (<urn:ex:allowed>);
      sh:property [ sh:path ex:alsoAllowed ] .`,
  );
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.equal(
    result.diagnostics.some((diagnostic) => diagnostic.code === "SHACL_RESULT"),
    false,
  );
});

test("Core parameters with multiple values apply every independent constraint", async () => {
  const root = await project();
  const cases: [string, string, string][] = [
    [
      "ex:A a owl:Class . ex:item a ex:A .",
      "ex:shape sh:targetNode ex:item; sh:or ([ sh:class ex:A ]), ([ sh:class ex:B ]) .",
      "OrConstraintComponent",
    ],
    [
      "ex:A a owl:Class . ex:item a ex:A .",
      "ex:shape sh:targetNode ex:item; sh:not [ sh:class ex:B ], [ sh:class ex:A ] .",
      "NotConstraintComponent",
    ],
    [
      "ex:A a owl:Class . ex:item ex:value ex:A .",
      "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:hasValue ex:A, ex:B .",
      "HasValueConstraintComponent",
    ],
    [
      "ex:q1 a owl:ObjectProperty . ex:q2 a owl:ObjectProperty . ex:A a owl:Class . ex:B a owl:Class . ex:item ex:value ex:A; ex:q1 ex:A; ex:q2 ex:B .",
      "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:disjoint ex:q1, ex:q2 .",
      "DisjointConstraintComponent",
    ],
    [
      "ex:q1 a owl:ObjectProperty . ex:q2 a owl:ObjectProperty . ex:A a owl:Class . ex:B a owl:Class . ex:item ex:value ex:A; ex:q1 ex:A; ex:q2 ex:B .",
      "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:equals ex:q1, ex:q2 .",
      "EqualsConstraintComponent",
    ],
    [
      'ex:q1 a owl:DatatypeProperty . ex:q2 a owl:DatatypeProperty . ex:item ex:value "1"; ex:q1 "2"; ex:q2 "0" .',
      "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:lessThan ex:q1, ex:q2 .",
      "LessThanConstraintComponent",
    ],
  ];
  for (const [data, shapes, component] of cases) {
    const result = await inspect(root, data, shapes);
    assert.equal(result.status, "invalid", `${shapes}: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "SHACL_RESULT" &&
          typeof diagnostic.shacl?.constraintComponent?.value === "string" &&
          diagnostic.shacl.constraintComponent.value.endsWith(component),
      ),
      `${shapes}: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

test("SHACL node-shape property-pair constraints compare against the focus node", async () => {
  const root = await project();
  const cases: [string, string, string, boolean][] = [
    [
      "ex:q a owl:ObjectProperty . ex:item ex:q ex:item .",
      "ex:shape a sh:NodeShape; sh:targetNode ex:item; sh:equals ex:q .",
      "EqualsConstraintComponent",
      false,
    ],
    [
      "ex:q a owl:ObjectProperty . ex:item ex:q ex:other .",
      "ex:shape a sh:NodeShape; sh:targetNode ex:item; sh:equals ex:q .",
      "EqualsConstraintComponent",
      true,
    ],
    [
      "ex:q a owl:ObjectProperty . ex:item ex:q ex:item .",
      "ex:shape a sh:NodeShape; sh:targetNode ex:item; sh:disjoint ex:q .",
      "DisjointConstraintComponent",
      true,
    ],
  ];
  for (const [data, shapes, component, hasViolation] of cases) {
    const result = await inspect(root, data, shapes);
    assert.equal(
      result.status,
      hasViolation ? "invalid" : "ok",
      JSON.stringify(result.diagnostics),
    );
    assert.equal(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "SHACL_RESULT" &&
          typeof diagnostic.shacl?.constraintComponent?.value === "string" &&
          diagnostic.shacl.constraintComponent.value.endsWith(component),
      ),
      hasViolation,
      `${shapes}: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

test("closed shapes inspect active raw paths and report each forbidden triple", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:item ex:allowed "one", "two"; ex:unknown "three", "four" .',
    `ex:shape a sh:NodeShape; sh:targetNode ex:item; sh:closed true;
      sh:property [ sh:path ex:allowed; sh:deactivated true ];
      sh:property [ sh:path [ sh:alternativePath (ex:allowed ex:other) ] ] .`,
  );
  const results = result.diagnostics.filter((diagnostic) => diagnostic.code === "SHACL_RESULT");
  assert.equal(results.length, 2, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    results.map((diagnostic) => diagnostic.shacl?.path?.value),
    ["urn:ex:unknown", "urn:ex:unknown"],
  );
});

test("SHACL closed property shapes inspect each value node", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:valueProperty a owl:ObjectProperty . ex:allowed a owl:DatatypeProperty . ex:unknown a owl:DatatypeProperty . ex:item ex:allowed "ok"; ex:unknown "bad" . ex:owner ex:valueProperty ex:item .',
    `ex:shape a sh:PropertyShape; sh:targetNode ex:owner; sh:path ex:valueProperty; sh:closed true;
      sh:property [ sh:path ex:allowed ] .`,
  );
  const results = result.diagnostics.filter((diagnostic) => diagnostic.code === "SHACL_RESULT");
  assert.equal(results.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(results[0]?.shacl?.path?.value, "urn:ex:unknown");
  assert.equal(results[0]?.shacl?.value?.value, "bad");
});

test("deactivated SHACL SPARQL constraints do not run", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:item ex:value "present" .',
    `ex:shape sh:targetNode ex:item;
      sh:sparql [ sh:select "PREFIX ex: <urn:ex:> SELECT $this WHERE { $this ex:value ?value }"; sh:deactivated true ] .`,
  );
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.equal(
    result.diagnostics.some((diagnostic) => diagnostic.code === "SHACL_RESULT"),
    false,
  );
});

test("SHACL SPARQL path expansion preserves escaped dollar names and Unicode prefixes", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:foo\\$PATH a owl:DatatypeProperty . ex:p a owl:DatatypeProperty . ex:item ex:foo\\$PATH "found"; ex:p "value" .',
    `ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:p;
      sh:sparql [ sh:prefixes [ sh:declare [ sh:prefix "π"; sh:namespace "urn:ex:"^^xsd:anyURI ] ];
        sh:select "SELECT $this WHERE { $this π:foo\\\\$PATH $PATHé . $this $PATH ?value . FILTER ($PATHé = \\"found\\") }" ] .`,
  );
  assert.equal(result.status, "invalid", JSON.stringify(result.diagnostics));
  assert.equal(
    result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "SHACL_RESULT" &&
        String(diagnostic.shacl?.constraintComponent?.value ?? "").endsWith(
          "SPARQLConstraintComponent",
        ),
    ).length,
    1,
    JSON.stringify(result.diagnostics),
  );
});

test("SHACL PATH expansion preserves a leading escaped variable name in a QName", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:\\$PATH a owl:DatatypeProperty . ex:item ex:\\$PATH "found" .',
    `ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value;
      sh:sparql [ sh:select "PREFIX ex: <urn:ex:> SELECT $this WHERE { $this ex:\\\\$PATH ?value . BIND (\\"found\\" AS $PATH😀) FILTER (?value = $PATH😀) }" ] .`,
  );
  assert.equal(
    result.diagnostics.filter((diagnostic) => diagnostic.code === "SHACL_RESULT").length,
    1,
    JSON.stringify(result.diagnostics),
  );
  assert.equal(result.data?.validationComplete, true);
});

test("SHACL ranges permit positive infinity without applying renderer limits", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:item ex:value "INF"^^xsd:double .',
    "ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:value; sh:datatype xsd:double; sh:minExclusive 0 .",
  );
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.equal(result.data?.validationComplete, true);
});

test("SHACL PATH expansion preserves escaped hashes before the path variable", async () => {
  const root = await project();
  const result = await inspect(
    root,
    'ex:foo\\#bar a owl:DatatypeProperty . ex:p a owl:DatatypeProperty . ex:item ex:foo\\#bar "bad"; ex:p "good" .',
    `ex:shape a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:p;
      sh:sparql [ sh:select "PREFIX ex: <urn:ex:> SELECT $this WHERE { $this ex:foo\\\\#bar ?candidate . $this $PATH ?value . FILTER (?value = \\"bad\\") }" ] .`,
  );
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.equal(result.data?.validationComplete, true);
});
