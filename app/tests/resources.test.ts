import assert from "node:assert/strict";
import test from "node:test";
import { validateStarterGraph } from "../src/starter-validation.ts";
import { loadStarters } from "../src/starters.ts";

const prefixes = `@prefix t: <https://talby.ai/ontology/tbspec#> . @prefix p: <http://purl.org/net/p-plan#> . @prefix proc: <https://talby.ai/ontology/process#> . @prefix sm: <https://talby.ai/ontology/state-machine#> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix e: <urn:example:> .`;
test("immutable bundles have exact identities, attributed P-Plan 1.3 and independent common metadata", async () => {
  const bundle = await loadStarters();
  assert.equal(bundle.lock.starters.common_contract, "dep:tbspec-metadata");
  assert.equal(Object.keys(bundle.lock.dependencies).length, 6);
  for (const [name, root] of [
    ["metadata", "tbspec"],
    ["process", "process"],
    ["state-machine", "state-machine"],
  ]) {
    const dependency = bundle.lock.dependencies[`tbspec-${name}`];
    assert.ok(dependency);
    assert.equal(dependency.files[0]?.graph_iri, `https://talby.ai/ontology/${root}`);
    const source =
      bundle.files[`${dependency.snapshot_path}/${dependency.primary}`]?.toString("utf8");
    assert.match(source ?? "", new RegExp(`https://talby.ai/ontology/${root}/0.1.0`));
  }
  const pplan =
    bundle.files[".tbspec/dependencies/tbspec-process/source/p-plan.owl"]?.toString("utf8") ?? "";
  assert.match(pplan, /<owl:versionInfo>1.3<\/owl:versionInfo>/);
  assert.match(pplan, /creativecommons.org\/licenses\/by\/4.0/);
  assert.match(pplan, /isPrecededBy/);
  assert.doesNotMatch(pplan, /isPreceededBy/);
});
test("empty starters, shared plans, inverse variables and descriptive state cycles validate offline", async () => {
  const cases: [string, string][] = [
    ["data", 'e:model a t:ConceptualDataModel ; t:modelType "data" .'],
    ["data", 'e:model a t:ConcreteDataModel ; t:modelType "data" .'],
    ["process", 'e:plan a t:ProcessModel, p:Plan ; t:modelType "process" .'],
    [
      "state-machine",
      'e:machine a t:StateMachineModel, sm:StateMachine ; t:modelType "state-machine" .',
    ],
    [
      "process",
      "e:plan a p:Plan . e:other a p:Plan . e:step a p:Step ; p:isStepOfPlan e:plan, e:other . e:decision a proc:Decision ; p:isStepOfPlan e:plan . e:v a p:Variable ; p:isVariableOfPlan e:plan ; p:isInputVarOf e:decision ; p:isOutputVarOf e:step . e:step p:hasOutputVar e:v . e:flow a proc:Flow ; proc:inPlan e:plan ; proc:source e:step ; proc:target e:decision .",
    ],
    [
      "state-machine",
      "e:m a sm:StateMachine . e:a a sm:InitialState ; sm:inMachine e:m . e:b a sm:State ; sm:inMachine e:m . e:ab a sm:Transition ; sm:inMachine e:m ; sm:source e:a ; sm:target e:b . e:ba a sm:Transition ; sm:inMachine e:m ; sm:source e:b ; sm:target e:a .",
    ],
    [
      "state-machine",
      "e:m a sm:StateMachine . e:a a sm:InitialState, sm:FinalState ; sm:inMachine e:m .",
    ],
    [
      "data",
      'e:view a t:ViewModel ; t:sourceGraph e:source ; t:member e:a, e:b ; t:relationship [ rdf:subject e:a ; rdf:predicate e:p ; rdf:object e:b ] . e:presentation a t:PresentationGraph ; t:forView e:view ; t:nodePresentation [ t:element e:a ; t:x -10 ; t:y -20 ; t:labelText "inherited" ] .',
    ],
  ];
  for (const [type, source] of cases) {
    const result = await validateStarterGraph(type, `${prefixes}\n${source}`);
    assert.equal(result.conforms, true, JSON.stringify({ source, result }));
  }
});
test("bundled local Core and SELECT constraints reject structural violations", async () => {
  const cases: [string, string][] = [
    ["data", 'e:model a t:Model ; t:modelType "" .'],
    ["data", "e:model a t:ConceptualDataModel ; t:schema e:schema ."],
    [
      "data",
      "e:view a t:ViewModel ; t:sourceGraph e:source ; t:member e:a ; t:relationship [ rdf:subject e:a ; rdf:predicate e:p ; rdf:object e:b ] .",
    ],
    [
      "data",
      "e:v a t:ViewModel ; t:sourceGraph e:s ; t:member e:a ; t:relationship [ rdf:subject e:a ; rdf:predicate e:p ; rdf:object e:a ], [ rdf:subject e:a ; rdf:predicate e:p ; rdf:object e:a ] .",
    ],
    [
      "data",
      "e:p a t:PresentationGraph ; t:forView e:v ; t:nodePresentation [ t:element e:a ; t:x 1 ] .",
    ],
    [
      "data",
      "e:p a t:PresentationGraph ; t:forView e:v ; t:nodePresentation [ t:element e:a ], [ t:element e:a ] .",
    ],
    ["data", 'e:r a t:NodeVisualRule ; t:targetConcept owl:Class ; t:edgeRouting "bezier" .'],
    ["data", 'e:r a t:EdgeVisualRule ; t:targetConcept rdf:type ; t:fillColor "#FFFFFF" .'],
    ["data", 'e:r a t:NodeVisualRule ; t:targetConcept owl:Class ; t:labelMode "text" .'],
    [
      "data",
      'e:r a t:NodeVisualRule ; t:targetConcept owl:Class ; t:fontSize 0 ; t:strokeWidth -1 ; t:fillColor "red" .',
    ],
    ["data", 'e:r a t:NodeVisualRule ; t:targetConcept owl:Class ; t:fontSize "INF"^^xsd:double .'],
    [
      "process",
      "e:p a p:Plan . e:q a p:Plan . e:s a p:Step ; p:isStepOfPlan e:p ; p:hasInputVar e:v . e:v a p:Variable ; p:isVariableOfPlan e:q .",
    ],
    [
      "process",
      "e:p a p:Plan . e:s a p:Step ; p:isStepOfPlan e:p . e:t a p:Step ; p:isStepOfPlan e:p . e:v a p:Variable ; p:isVariableOfPlan e:p ; p:isOutputVarOf e:s, e:t .",
    ],
    [
      "process",
      "e:p a p:Plan . e:q a p:Plan . e:s a p:Step ; p:isStepOfPlan e:p . e:t a p:Step ; p:isStepOfPlan e:q . e:f a proc:Flow ; proc:inPlan e:p ; proc:source e:s ; proc:target e:t .",
    ],
    [
      "state-machine",
      "e:m a sm:StateMachine . e:a a sm:InitialState ; sm:inMachine e:m . e:b a sm:InitialState ; sm:inMachine e:m .",
    ],
    [
      "state-machine",
      "e:m a sm:StateMachine . e:a a sm:FinalState ; sm:inMachine e:m . e:b a sm:State ; sm:inMachine e:m . e:t a sm:Transition ; sm:inMachine e:m ; sm:source e:a ; sm:target e:b .",
    ],
    [
      "state-machine",
      "e:m a sm:StateMachine . e:n a sm:StateMachine . e:a a sm:State ; sm:inMachine e:m . e:b a sm:State ; sm:inMachine e:n . e:t a sm:Transition ; sm:inMachine e:m ; sm:source e:a ; sm:target e:b .",
    ],
    ["state-machine", "e:a sm:inMachine e:m . e:m a sm:StateMachine ."],
  ];
  for (const [type, source] of cases) {
    const result = await validateStarterGraph(type, `${prefixes}\n${source}`);
    assert.equal(result.conforms, false, source);
    assert.ok(result.problems.length > 0);
  }
});
