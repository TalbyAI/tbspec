# Ontology and Model Management

This context describes the vocabulary used to define and maintain a project's knowledge and domain descriptions.

## Language

**Project**:
A versionable local directory that contains ontologies, domain models, view models, presentation graphs, or visual design models, and may reuse external resources.

**Ontology**:
A reusable vocabulary of concepts and relationships that a project defines or references to describe its domain.

**Dependency**:
An ontology, domain model, or visual design model obtained from outside the project and made available for reuse within it.

**Domain model**:
A formal or semi-formal description of a project's domain, expressed using the vocabularies available to that project. Domain models may describe data, workflows, information flows, or architecture.

**Model type**:
A named category of domain model whose available concepts are defined by an associated ontology.

**Data model**:
A domain model describing conceptual entities, their attributes, and their relationships.

**Process model**:
A domain model describing activities, decisions, inputs, outputs, responsible parties, and the flow between activities.

**State machine model**:
A domain model describing states, including initial and final states, and transitions with events, conditions, or actions.

**Presentation graph**:
A graph describing the visual appearance or placement of specific elements in one view of an ontology or domain model, separate from its content.

**View model**:
A description of the explicitly selected elements and relationships of one ontology or domain model that appear in a particular perspective.

**Visual design model**:
A reusable description of visual presentation rules for concept types, such as shapes, colors, and typography, that does not describe the placement or appearance of any specific domain element.

**Saved query**:
A named, reusable, read-only SPARQL query belonging to a project, optionally accepting declared RDF term parameters.
