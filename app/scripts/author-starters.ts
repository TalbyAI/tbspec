// Release authoring only. Installed initialization copies these immutable assets; it never runs this script.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Parser } from "n3";
import { digest, graphSignature } from "../src/canonical.ts";
import {
  type Dependency,
  interpretationSignature,
  type LockedFile,
  writeToml,
} from "../src/schemas.ts";

const directory = new URL("../starters/0.1.0/", import.meta.url);
const ns = {
  tbspec: "https://talby.ai/ontology/tbspec#",
  proc: "https://talby.ai/ontology/process#",
  sm: "https://talby.ai/ontology/state-machine#",
  "p-plan": "http://purl.org/net/p-plan#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  sh: "http://www.w3.org/ns/shacl#",
};
const prefixes = Object.entries(ns)
  .map(([prefix, iri]) => `@prefix ${prefix}: <${iri}> .`)
  .join("\n");
const terms: Record<
  string,
  {
    classes: Record<string, string>;
    objects: Record<string, string>;
    literals: Record<string, string>;
    hierarchy: [string, string][];
  }
> = {
  tbspec: {
    classes: {
      Model: "A domain-model graph.",
      DataModel: "A domain model of data.",
      ConceptualDataModel: "A model describing data classes and properties.",
      ConcreteDataModel: "A model containing individual resources and values.",
      ProcessModel: "A descriptive process-model graph.",
      StateMachineModel: "A descriptive state-machine-model graph.",
      ViewModel: "A selected perspective on one source graph.",
      PresentationGraph: "Appearance and placement of elements in one view.",
      VisualDesignModel: "Reusable declarative rules for exact concept types.",
      ShapesGraph: "A graph containing SHACL constraints.",
      VisualRule: "An appearance rule for an exact concept.",
      NodeVisualRule: "An appearance rule targeting an exact class.",
      EdgeVisualRule: "An appearance rule targeting an exact property.",
    },
    objects: {
      schema: "A conceptual-schema graph associated with a concrete model.",
      sourceGraph: "The source ontology or model of a view.",
      forView: "The view described by a presentation graph.",
      member: "An IRI element selected from the source graph.",
      relationship: "A local descriptor of a selected exact RDF relationship.",
      nodePresentation: "A node appearance record local to this presentation graph.",
      relationshipPresentation: "An exact relationship appearance record local to this graph.",
      element: "The selected source IRI described by a node record.",
      chosenRule: "The applicable exact visual rule chosen in this view.",
      rule: "A rule defined in this visual design.",
      targetConcept: "The exact class or property targeted by a visual rule.",
      labelProperty: "The vocabulary property supplying literal labels.",
    },
    literals: {
      modelType: "The configured model-type name.",
      x: "Absolute horizontal canvas coordinate.",
      y: "Absolute vertical canvas coordinate.",
      group: "A nonempty flat visual group name scoped to this view.",
      nodeShape: "A supported generic node shape.",
      fillColor: "A hexadecimal node fill color.",
      strokeColor: "A hexadecimal outline color.",
      textColor: "A hexadecimal label color.",
      strokeWidth: "A nonnegative stroke width in canvas pixels.",
      fontFamily: "A supported built-in font family.",
      fontSize: "A positive font size in canvas pixels.",
      fontWeight: "A supported integer font weight.",
      fontStyle: "A normal or italic font style.",
      lineStyle: "A supported line pattern.",
      edgeRouting: "A supported generic relationship routing mode.",
      arrowHead: "The supported relationship arrow style.",
      labelMode: "The supported deterministic label-selection mode.",
      labelText: "A literal label when label mode is text.",
    },
    hierarchy: [
      ["DataModel", "Model"],
      ["ConceptualDataModel", "DataModel"],
      ["ConcreteDataModel", "DataModel"],
      ["ProcessModel", "Model"],
      ["StateMachineModel", "Model"],
      ["NodeVisualRule", "VisualRule"],
      ["EdgeVisualRule", "VisualRule"],
    ],
  },
  proc: {
    classes: {
      Decision: "A descriptive process step representing a choice.",
      Flow: "An immediate descriptive connection between two steps in a plan.",
    },
    objects: {
      source: "The source step of a flow.",
      target: "The target step of a flow.",
      inPlan: "The local plan containing a flow.",
      responsibleParty: "An IRI person, organization or role responsible for a step.",
    },
    literals: { condition: "An optional descriptive condition on a flow; never executable." },
    hierarchy: [["Decision", "p-plan:Step"]],
  },
  sm: {
    classes: {
      StateMachine: "A descriptive collection of states and transitions.",
      State: "A condition or mode of a subject within one machine.",
      InitialState: "An optional designated starting state.",
      FinalState: "A terminal state with no outgoing transition.",
      Transition: "A directed descriptive change between states.",
    },
    objects: {
      inMachine: "The single local machine owning a state or transition.",
      source: "The source state of a transition.",
      target: "The target state of a transition.",
    },
    literals: {
      event: "An optional descriptive event; never executable.",
      condition: "An optional descriptive condition; never executable.",
      action: "An optional descriptive action; never executable.",
    },
    hierarchy: [
      ["InitialState", "State"],
      ["FinalState", "State"],
    ],
  },
};
for (const [prefix, definition] of Object.entries(terms)) {
  const root = ns[prefix as keyof typeof ns].slice(0, -1);
  let text = `${prefixes}\n\n<${root}> a owl:Ontology ; owl:versionIRI <${root}/0.1.0> ; rdfs:label ${JSON.stringify(`${prefix} vocabulary`)}@en .\n`;
  const imports = prefix === "proc" ? ["http://purl.org/net/p-plan#"] : [ns.rdf, ns.rdfs];
  for (const imported of imports) text += `<${root}> owl:imports <${imported}> .\n`;
  for (const [type, entries] of [
    ["Class", definition.classes],
    ["ObjectProperty", definition.objects],
    ["DatatypeProperty", definition.literals],
  ] as const)
    for (const [term, comment] of Object.entries(entries))
      text += `${prefix}:${term} a owl:${type} ; rdfs:label ${JSON.stringify(term.replace(/([a-z])([A-Z])/g, "$1 $2"))}@en ; rdfs:comment ${JSON.stringify(comment)}@en ; rdfs:isDefinedBy <${root}> .\n`;
  for (const [child, parent] of definition.hierarchy)
    text += `${prefix}:${child} rdfs:subClassOf ${parent.includes(":") ? parent : `${prefix}:${parent}`} .\n`;
  await writeFile(new URL(`source/${prefix}.ttl`, directory), text);
}
// XML Schema supplies datatypes as a specification, not an RDF serialization. This explicit local vocabulary is a documented extraction.
await writeFile(
  new URL("source/xsd.ttl", directory),
  `${prefixes}\n\n${["string", "boolean", "integer", "decimal", "double", "float", "date", "dateTime", "anyURI", "nonNegativeInteger", "positiveInteger", "int", "long", "unsignedInt", "unsignedLong", "duration", "base64Binary", "hexBinary", "normalizedString", "token", "language"].map((term) => `xsd:${term} a rdfs:Datatype ; rdfs:label "${term}"@en ; rdfs:isDefinedBy <http://www.w3.org/2001/XMLSchema> .`).join("\n")}\n`,
);

const shapeTexts: Record<string, string[]> = { tbspec: [], proc: [], sm: [] };
function shape(prefix: string, name: string, target: string, constraints: string) {
  shapeTexts[prefix]?.push(
    `<${ns[prefix as keyof typeof ns].slice(0, -1)}/0.1.0/shapes#${name}Shape> a sh:NodeShape ; ${target} ; ${constraints} .`,
  );
}
const iri = "sh:nodeKind sh:IRI";
const resource = "sh:nodeKind sh:BlankNodeOrIRI";
const prop = (path: string, constraints: string) =>
  `sh:property [ sh:path ${path} ; ${constraints} ]`;
const one = (path: string, constraints: string) =>
  prop(path, `sh:minCount 1 ; sh:maxCount 1 ; ${constraints}`);
const optionalText = (path: string) =>
  prop(path, "sh:maxCount 1 ; sh:or ( [ sh:datatype xsd:string ] [ sh:datatype rdf:langString ] )");
const localSelect = (query: string, message: string) =>
  `sh:node [ sh:sparql [ sh:message ${JSON.stringify(message)}@en ; sh:select """${Object.entries(
    ns,
  )
    .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
    .join("\n")}\nSELECT $this WHERE { ${query} }""" ] ]`;
const tuple = [one("rdf:subject", iri), one("rdf:predicate", iri), one("rdf:object", iri)].join(
  " ; ",
);
shape(
  "tbspec",
  "Ontology",
  "sh:targetClass owl:Ontology",
  `${iri} ; ${prop("owl:versionIRI", `sh:maxCount 1 ; ${iri}`)}`,
);
shape(
  "tbspec",
  "Model",
  "sh:targetClass tbspec:Model",
  `${iri} ; ${prop("tbspec:modelType", "sh:maxCount 1 ; sh:datatype xsd:string ; sh:minLength 1")}`,
);
shape(
  "tbspec",
  "SchemaReference",
  "sh:targetSubjectsOf tbspec:schema",
  `sh:class tbspec:ConcreteDataModel ; ${prop("tbspec:schema", iri)}`,
);
shape("tbspec", "ShapesGraph", "sh:targetClass tbspec:ShapesGraph", iri);
shape(
  "tbspec",
  "RelationshipSelection",
  "sh:targetObjectsOf tbspec:relationship",
  `${resource} ; ${tuple}`,
);
shape(
  "tbspec",
  "ViewModel",
  "sh:targetClass tbspec:ViewModel",
  `${iri} ; ${one("tbspec:sourceGraph", iri)} ; ${prop("tbspec:member", iri)} ; ${prop("tbspec:relationship", `${resource} ; sh:node <https://talby.ai/ontology/tbspec/0.1.0/shapes#RelationshipSelectionShape>`)} ; ${localSelect("$this tbspec:relationship ?r . ?r rdf:subject ?s ; rdf:object ?o . FILTER (NOT EXISTS { $this tbspec:member ?s } || NOT EXISTS { $this tbspec:member ?o })", "Selected relationship endpoints must be members.")} ; ${localSelect("$this tbspec:relationship ?r, ?r2 . ?r rdf:subject ?s ; rdf:predicate ?p ; rdf:object ?o . ?r2 rdf:subject ?s ; rdf:predicate ?p ; rdf:object ?o . FILTER (?r != ?r2)", "Duplicate selected relationship tuple.")}`,
);
const appearance: string[] = [];
for (const [field, values] of Object.entries({
  nodeShape: ["rectangle", "rounded-rectangle", "ellipse", "diamond"],
  fontFamily: ["system-ui", "sans-serif", "serif", "monospace"],
  fontStyle: ["normal", "italic"],
  lineStyle: ["solid", "dashed", "dotted"],
  edgeRouting: ["straight", "bezier", "step"],
  arrowHead: ["none", "arrow"],
  labelMode: ["property", "local-name", "iri", "text", "none"],
}))
  appearance.push(
    prop(
      `tbspec:${field}`,
      `sh:maxCount 1 ; sh:datatype xsd:string ; sh:in ( ${values.map((value) => JSON.stringify(value)).join(" ")} )`,
    ),
  );
for (const field of ["fillColor", "strokeColor", "textColor"])
  appearance.push(
    prop(
      `tbspec:${field}`,
      'sh:maxCount 1 ; sh:datatype xsd:string ; sh:pattern "^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$"',
    ),
  );
const numeric =
  "sh:or ( [ sh:datatype xsd:integer ] [ sh:datatype xsd:decimal ] [ sh:datatype xsd:double ] )";
appearance.push(
  prop("tbspec:strokeWidth", `sh:maxCount 1 ; ${numeric} ; sh:minInclusive 0`),
  prop("tbspec:fontSize", `sh:maxCount 1 ; ${numeric} ; sh:minExclusive 0`),
  prop(
    "tbspec:fontWeight",
    "sh:maxCount 1 ; sh:datatype xsd:integer ; sh:in (100 200 300 400 500 600 700 800 900)",
  ),
  prop("tbspec:labelProperty", `sh:maxCount 1 ; ${iri}`),
  optionalText("tbspec:labelText"),
);
shape(
  "tbspec",
  "Appearance",
  "sh:targetClass tbspec:VisualRule",
  `${appearance.join(" ; ")} ; ${localSelect('$this tbspec:labelMode ?mode ; tbspec:labelText ?text . FILTER (?mode != "text")', "Explicit local label mode is incompatible with labelText.")} ; ${localSelect('$this tbspec:labelMode ?mode ; tbspec:labelProperty ?property . FILTER (?mode != "property")', "Explicit local label mode is incompatible with labelProperty.")}`,
);
const appearanceRef = "sh:node <https://talby.ai/ontology/tbspec/0.1.0/shapes#AppearanceShape>";
const forbid = (fields: string[]) =>
  fields.map((field) => prop(`tbspec:${field}`, "sh:maxCount 0")).join(" ; ");
const nodeForbid = forbid(["edgeRouting", "arrowHead"]);
const edgeForbid = forbid(["nodeShape", "fillColor"]);
const ruleFields = forbid(["x", "y", "element", "chosenRule", "group"]);
shape(
  "tbspec",
  "VisualRule",
  "sh:targetClass tbspec:VisualRule ; sh:targetObjectsOf tbspec:rule",
  `${iri} ; sh:xone ( [ sh:class tbspec:NodeVisualRule ] [ sh:class tbspec:EdgeVisualRule ] ) ; ${one("tbspec:targetConcept", iri)} ; ${ruleFields} ; ${appearanceRef} ; ${localSelect('$this tbspec:labelMode "text" . FILTER NOT EXISTS { $this tbspec:labelText ?text }', "Text label mode requires labelText.")} ; ${localSelect('$this tbspec:labelText ?text . FILTER NOT EXISTS { $this tbspec:labelMode "text" }', "labelText requires text label mode.")} ; ${localSelect('$this tbspec:labelProperty ?property . OPTIONAL { $this tbspec:labelMode ?mode } FILTER (BOUND(?mode) && ?mode != "property")', "labelProperty requires property label mode.")}`,
);
shape("tbspec", "NodeVisualRule", "sh:targetClass tbspec:NodeVisualRule", nodeForbid);
shape("tbspec", "EdgeVisualRule", "sh:targetClass tbspec:EdgeVisualRule", edgeForbid);
shape(
  "tbspec",
  "VisualDesignModel",
  "sh:targetClass tbspec:VisualDesignModel",
  `${iri} ; ${prop("tbspec:rule", `${iri} ; sh:node <https://talby.ai/ontology/tbspec/0.1.0/shapes#VisualRuleShape>`)} ; ${localSelect("$this tbspec:rule ?r, ?r2 . ?r a ?kind ; tbspec:targetConcept ?target . ?r2 a ?kind ; tbspec:targetConcept ?target . FILTER ((?kind = tbspec:NodeVisualRule || ?kind = tbspec:EdgeVisualRule) && ?r != ?r2)", "Duplicate rule for an exact kind and concept.")}`,
);
shape(
  "tbspec",
  "NodePresentation",
  "sh:targetObjectsOf tbspec:nodePresentation",
  `${resource} ; ${one("tbspec:element", iri)} ; ${prop("tbspec:x", `sh:maxCount 1 ; ${numeric}`)} ; ${prop("tbspec:y", `sh:maxCount 1 ; ${numeric}`)} ; ${prop("tbspec:chosenRule", `sh:maxCount 1 ; ${iri}`)} ; ${prop("tbspec:group", "sh:maxCount 1 ; sh:datatype xsd:string ; sh:minLength 1")} ; ${appearanceRef} ; ${nodeForbid} ; ${localSelect("FILTER ((EXISTS { $this tbspec:x ?x }) != (EXISTS { $this tbspec:y ?y }))", "Coordinates must be paired.")}`,
);
shape(
  "tbspec",
  "RelationshipPresentation",
  "sh:targetObjectsOf tbspec:relationshipPresentation",
  `${resource} ; ${tuple} ; ${prop("tbspec:chosenRule", `sh:maxCount 1 ; ${iri}`)} ; ${appearanceRef} ; ${edgeForbid} ; ${forbid(["x", "y", "element", "group"])}`,
);
shape(
  "tbspec",
  "PresentationGraph",
  "sh:targetClass tbspec:PresentationGraph",
  `${iri} ; ${one("tbspec:forView", iri)} ; ${prop("tbspec:nodePresentation", resource)} ; ${prop("tbspec:relationshipPresentation", resource)} ; ${localSelect("$this tbspec:nodePresentation ?r, ?r2 . ?r tbspec:element ?e . ?r2 tbspec:element ?e . FILTER (?r != ?r2)", "Duplicate node presentation.")} ; ${localSelect("$this tbspec:relationshipPresentation ?r, ?r2 . ?r rdf:subject ?s ; rdf:predicate ?p ; rdf:object ?o . ?r2 rdf:subject ?s ; rdf:predicate ?p ; rdf:object ?o . FILTER (?r != ?r2)", "Duplicate relationship presentation.")}`,
);
// Local kind targets catch untyped property uses without relying on domain/range entailment.
shape("proc", "Plan", "sh:targetClass p-plan:Plan", resource);
shape(
  "proc",
  "Step",
  "sh:targetClass p-plan:Step ; sh:targetSubjectsOf p-plan:isStepOfPlan ; sh:targetSubjectsOf p-plan:hasInputVar ; sh:targetSubjectsOf p-plan:hasOutputVar ; sh:targetSubjectsOf proc:responsibleParty ; sh:targetObjectsOf p-plan:isInputVarOf ; sh:targetObjectsOf p-plan:isOutputVarOf",
  `${resource} ; sh:class p-plan:Step ; ${prop("p-plan:isStepOfPlan", `sh:minCount 1 ; ${resource} ; sh:class p-plan:Plan`)} ; ${prop("proc:responsibleParty", iri)} ; ${prop("[ sh:alternativePath ( p-plan:hasInputVar [ sh:inversePath p-plan:isInputVarOf ] ) ]", `${resource} ; sh:class p-plan:Variable`)} ; ${prop("[ sh:alternativePath ( p-plan:hasOutputVar [ sh:inversePath p-plan:isOutputVarOf ] ) ]", `${resource} ; sh:class p-plan:Variable`)} ; ${localSelect("$this (p-plan:hasInputVar|p-plan:hasOutputVar|^p-plan:isInputVarOf|^p-plan:isOutputVarOf) ?v . FILTER NOT EXISTS { $this p-plan:isStepOfPlan ?plan . ?v p-plan:isVariableOfPlan ?plan }", "Step and effective variable must share a plan.")}`,
);
shape(
  "proc",
  "Variable",
  "sh:targetClass p-plan:Variable ; sh:targetSubjectsOf p-plan:isVariableOfPlan ; sh:targetSubjectsOf p-plan:isInputVarOf ; sh:targetSubjectsOf p-plan:isOutputVarOf ; sh:targetObjectsOf p-plan:hasInputVar ; sh:targetObjectsOf p-plan:hasOutputVar",
  `${resource} ; sh:class p-plan:Variable ; ${prop("p-plan:isVariableOfPlan", `sh:minCount 1 ; ${resource} ; sh:class p-plan:Plan`)} ; ${prop("[ sh:alternativePath ( p-plan:isOutputVarOf [ sh:inversePath p-plan:hasOutputVar ] ) ]", `sh:maxCount 1 ; ${resource} ; sh:class p-plan:Step`)} ; ${prop("[ sh:alternativePath ( p-plan:isInputVarOf [ sh:inversePath p-plan:hasInputVar ] ) ]", `${resource} ; sh:class p-plan:Step`)}`,
);
shape("proc", "Decision", "sh:targetClass proc:Decision", `sh:class p-plan:Step ; ${resource}`);
shape(
  "proc",
  "Flow",
  "sh:targetClass proc:Flow ; sh:targetSubjectsOf proc:source ; sh:targetSubjectsOf proc:target ; sh:targetSubjectsOf proc:inPlan ; sh:targetSubjectsOf proc:condition",
  `${resource} ; sh:class proc:Flow ; ${one("proc:source", `${resource} ; sh:class p-plan:Step`)} ; ${one("proc:target", `${resource} ; sh:class p-plan:Step`)} ; ${one("proc:inPlan", `${resource} ; sh:class p-plan:Plan`)} ; ${optionalText("proc:condition")} ; ${localSelect("$this proc:inPlan ?plan ; proc:source ?s ; proc:target ?t . FILTER (NOT EXISTS { ?s p-plan:isStepOfPlan ?plan } || NOT EXISTS { ?t p-plan:isStepOfPlan ?plan })", "Flow endpoints must belong to its plan.")}`,
);
shape(
  "sm",
  "StateMachine",
  "sh:targetClass sm:StateMachine",
  `${resource} ; ${localSelect("?s a sm:InitialState ; sm:inMachine $this . ?s2 a sm:InitialState ; sm:inMachine $this . FILTER (?s != ?s2)", "A machine has at most one initial state.")}`,
);
shape(
  "sm",
  "State",
  "sh:targetClass sm:State",
  `${resource} ; ${one("sm:inMachine", `${resource} ; sh:class sm:StateMachine`)}`,
);
shape("sm", "InitialState", "sh:targetClass sm:InitialState", "sh:class sm:State");
shape(
  "sm",
  "FinalState",
  "sh:targetClass sm:FinalState",
  `sh:class sm:State ; ${localSelect("?transition sm:source $this .", "A final state cannot have an outgoing transition.")}`,
);
shape(
  "sm",
  "Transition",
  "sh:targetClass sm:Transition ; sh:targetSubjectsOf sm:source ; sh:targetSubjectsOf sm:target ; sh:targetSubjectsOf sm:event ; sh:targetSubjectsOf sm:condition ; sh:targetSubjectsOf sm:action",
  `${resource} ; sh:class sm:Transition ; ${one("sm:inMachine", `${resource} ; sh:class sm:StateMachine`)} ; ${one("sm:source", `${resource} ; sh:class sm:State`)} ; ${one("sm:target", `${resource} ; sh:class sm:State`)} ; ${["event", "condition", "action"].map((field) => optionalText(`sm:${field}`)).join(" ; ")} ; ${localSelect("$this sm:inMachine ?machine ; sm:source ?s ; sm:target ?t . FILTER (NOT EXISTS { ?s sm:inMachine ?machine } || NOT EXISTS { ?t sm:inMachine ?machine })", "Transition endpoints must belong to its machine.")}`,
);
shapeTexts.sm?.push(
  `[] a sh:NodeShape ; sh:targetSubjectsOf sm:inMachine ; sh:or ( [ sh:class sm:State ] [ sh:class sm:Transition ] ) .`,
);
for (const [prefix, shapes] of Object.entries(shapeTexts)) {
  const root = `${ns[prefix as keyof typeof ns].slice(0, -1)}/0.1.0/shapes`;
  await writeFile(
    new URL(`source/${prefix}.shacl.ttl`, directory),
    `${prefixes}\n\n<${root}> a tbspec:ShapesGraph .\n${shapes.join("\n\n")}\n`,
  );
}

const designs = {
  data: {
    nodes: [
      "owl:Class",
      "rdfs:Class",
      "rdfs:Datatype",
      "owl:NamedIndividual",
      "owl:ObjectProperty",
      "owl:DatatypeProperty",
      "rdf:Property",
    ],
    edges: ["rdf:type", "rdfs:subClassOf", "rdfs:subPropertyOf", "rdfs:domain", "rdfs:range"],
  },
  process: {
    nodes: ["p-plan:Plan", "p-plan:Step", "p-plan:Variable", "proc:Decision", "proc:Flow"],
    edges: [
      "p-plan:isStepOfPlan",
      "p-plan:isVariableOfPlan",
      "p-plan:hasInputVar",
      "p-plan:hasOutputVar",
      "p-plan:isInputVarOf",
      "p-plan:isOutputVarOf",
      "p-plan:isPrecededBy",
      "proc:source",
      "proc:target",
      "proc:inPlan",
      "proc:responsibleParty",
    ],
  },
  "state-machine": {
    nodes: ["sm:StateMachine", "sm:State", "sm:InitialState", "sm:FinalState", "sm:Transition"],
    edges: ["sm:inMachine", "sm:source", "sm:target"],
  },
};
for (const [name, targets] of Object.entries(designs)) {
  const root = `https://talby.ai/design/${name}/0.1.0`;
  let text = `${prefixes}\n\n<${root}> a tbspec:VisualDesignModel .\n`;
  for (const [kind, concepts] of Object.entries(targets))
    for (const concept of concepts) {
      const [prefix, term] = concept.split(":");
      const label =
        prefix === "p-plan" ? "PPlan" : `${prefix?.[0]?.toUpperCase()}${prefix?.slice(1)}`;
      const rule = `${root}#${label}${term?.[0]?.toUpperCase()}${term?.slice(1)}${kind === "nodes" ? "Node" : "Edge"}Rule`;
      const nodeShape =
        concept === "proc:Decision"
          ? "diamond"
          : ["p-plan:Variable", "sm:InitialState", "sm:FinalState"].includes(concept)
            ? "ellipse"
            : "rounded-rectangle";
      text += `<${root}> tbspec:rule <${rule}> .\n<${rule}> a tbspec:${kind === "nodes" ? "Node" : "Edge"}VisualRule ; tbspec:targetConcept ${concept} ; tbspec:strokeColor "#334155" ; tbspec:textColor "#172536" ; tbspec:strokeWidth ${concept === "sm:FinalState" ? 3 : 1} ; tbspec:fontFamily "system-ui" ; tbspec:fontSize 14 ; tbspec:fontWeight 400 ; tbspec:fontStyle "normal" ; tbspec:lineStyle "solid" ; tbspec:labelMode "property" ; tbspec:labelProperty rdfs:label ; ${kind === "nodes" ? `tbspec:nodeShape "${nodeShape}" ; tbspec:fillColor "#FFFFFF"` : 'tbspec:edgeRouting "bezier" ; tbspec:arrowHead "arrow"'} .\n`;
    }
  await writeFile(new URL(`source/${name}.design.ttl`, directory), text);
}

const dependencies: Record<string, Dependency> = {};
const standards = ["rdf", "rdfs", "owl", "xsd", "sh"];
async function locked(
  filename: string,
  kind: string,
  graphIri: string,
  roles: string[],
): Promise<LockedFile> {
  const key = `source/${filename}`;
  const bytes = await readFile(new URL(key, directory));
  const file = {
    key,
    source: "source",
    source_resource: filename,
    context: "source",
    roles,
    kind,
    classification: kind === "unclassified" ? "unclassified" : "declared",
    graph_iri: graphIri,
    identity: "declared",
    source_graph_iri: graphIri,
    byte_digest: digest(bytes),
    byte_length: bytes.length,
    media_type: filename.endsWith(".owl") ? "application/rdf+xml" : "text/turtle",
    base_iri:
      filename === "p-plan.owl"
        ? "https://raw.githubusercontent.com/dgarijo/Vocabularies/773007a6d7ed2fb0054967008cc128fa5c48ca36/P-PLAN/p-plan.owl"
        : ((
            {
              "rdf.ttl": "https://www.w3.org/1999/02/22-rdf-syntax-ns.ttl",
              "rdfs.ttl": "https://www.w3.org/2000/01/rdf-schema.ttl",
              "owl.ttl": "https://www.w3.org/2002/07/owl.ttl",
              "shacl.ttl": "https://www.w3.org/ns/shacl.ttl",
            } as Record<string, string>
          )[filename] ?? graphIri),
    parser_profile: filename.endsWith(".owl") ? "rdfxml-vetted-bundle-v1" : "turtle-strict-v1",
  };
  if (filename !== "p-plan.owl")
    new Parser({ format: "Turtle", baseIRI: file.base_iri }).parse(bytes.toString("utf8"));
  return { ...file, graph_signature: graphSignature(file) };
}
for (const [name, prefix] of [
  ["metadata", "tbspec"],
  ["process", "proc"],
  ["state-machine", "sm"],
] as const) {
  const root = ns[prefix].slice(0, -1);
  const primary = await locked(`${prefix}.ttl`, "ontology", root, ["primary"]);
  const shape = await locked(`${prefix}.shacl.ttl`, "shapes", `${root}/0.1.0/shapes`, ["shacl"]);
  const files = [primary, shape];
  for (const standard of standards) {
    const filename = `${standard === "sh" ? "shacl" : standard}.ttl`;
    const file = await locked(
      filename,
      "unclassified",
      ns[standard as keyof typeof ns].slice(0, -1),
      ["vocabulary"],
    );
    const quads = new Parser({ format: "Turtle", baseIRI: file.base_iri }).parse(
      (await readFile(new URL(file.key, directory))).toString("utf8"),
    );
    const roots = quads.filter(
      (quad) =>
        quad.predicate.value === `${ns.rdf}type` &&
        quad.object.value === `${ns.owl}Ontology` &&
        quad.subject.termType === "NamedNode",
    );
    if (roots.length === 1 && roots[0]) {
      file.kind = "ontology";
      file.classification = "declared";
      file.graph_iri = roots[0].subject.value;
      file.source_graph_iri = file.graph_iri;
    } else {
      file.identity = "generated";
      file.graph_iri = `urn:tbspec:graph:${digest(`dep:tbspec-${name}/${file.key}`).slice(7)}`;
      file.source_graph_iri = `urn:tbspec:graph:${digest(file.key).slice(7)}`;
    }
    files.push(file);
  }
  if (prefix === "proc")
    files.push(await locked("p-plan.owl", "ontology", "http://purl.org/net/p-plan#", ["closure"]));
  const dep: Dependency = {
    kind: "ontology",
    primary: primary.key,
    snapshot_path: `.tbspec/dependencies/tbspec-${name}`,
    interpretation_signature: "",
    sources: [
      {
        id: "source",
        kind: "bundle",
        locator: "tbspec:bundle/starters/0.1.0",
        selected_resource: `${prefix}.ttl`,
        release: "0.1.0",
        attribution:
          "Talby tbspec contributors; W3C standard vocabulary definitions; Daniel Garijo and Yolanda Gil, P-Plan 1.3 (pinned source 773007a6d7ed2fb0054967008cc128fa5c48ca36). See SOURCES.md for exact file sources.",
        license:
          "Talby resources: MIT; W3C vocabulary resources: W3C Document License; P-Plan 1.3: CC BY 4.0.",
      },
    ],
    files,
    edges: files.slice(2).map((file) => ({
      context: "source",
      from: primary.key,
      relation: file.key === "source/p-plan.owl" ? "import" : "vocabulary",
      to: file.key,
    })),
    bindings: [],
    associations: [
      {
        context: "source",
        resource: primary.key,
        role: "shacl",
        support: shape.key,
        origin: "source",
        active: true,
      },
    ],
    choices: [],
    attachments: [],
  };
  dep.interpretation_signature = interpretationSignature(dep);
  dependencies[`tbspec-${name}`] = dep;
}
for (const name of Object.keys(designs)) {
  const primary = await locked(
    `${name}.design.ttl`,
    "design",
    `https://talby.ai/design/${name}/0.1.0`,
    ["primary"],
  );
  const dep: Dependency = {
    kind: "design",
    primary: primary.key,
    snapshot_path: `.tbspec/dependencies/tbspec-${name}-design`,
    interpretation_signature: "",
    sources: [
      {
        id: "source",
        kind: "bundle",
        locator: "tbspec:bundle/starters/0.1.0",
        selected_resource: `${name}.design.ttl`,
        release: "0.1.0",
        attribution: "Talby tbspec contributors.",
        license: "MIT",
      },
    ],
    files: [primary],
    edges: [],
    bindings: [],
    associations: [],
    choices: [],
    attachments: [],
  };
  dep.interpretation_signature = interpretationSignature(dep);
  dependencies[`tbspec-${name}-design`] = dep;
}
const starters = {
  common_contract: "dep:tbspec-metadata",
  model_types: {
    data: { enabled: true, ontology: "dep:tbspec-metadata", design: "dep:tbspec-data-design" },
    process: { enabled: true, ontology: "dep:tbspec-process", design: "dep:tbspec-process-design" },
    "state-machine": {
      enabled: true,
      ontology: "dep:tbspec-state-machine",
      design: "dep:tbspec-state-machine-design",
    },
  },
};
await writeFile(
  new URL("inventory.toml", directory),
  writeToml({ schema_version: 1, release: "0.1.0", starters, dependencies }),
);
process.stdout.write(`Authored ${fileURLToPath(directory)}\n`);
