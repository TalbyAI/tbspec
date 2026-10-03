# Ontology and Model Management

This context describes the vocabulary used to define and maintain a project's knowledge and domain descriptions.

## Language

**Project**:
A versionable local directory that contains ontologies, domain models, view models, presentation graphs, or visual design models, and may reuse external resources.

**Ontology**:
A reusable vocabulary of concepts and relationships that a project defines or references to describe its domain.

**Dependency**:
An ontology, domain model, or visual design model obtained from outside the project and made available for reuse within it.

**Dependency snapshot**:
A fixed local copy of a dependency that remains available to the project until explicitly updated or removed.

**Dependency closure**:
The discoverable resources required to interpret a selected dependency, together with their directly associated support and inherited selections.

**Source drift**:
A difference between a dependency's locked interpretation content or associations and those currently obtainable from its recorded sources.

**Domain model**:
A formal or semi-formal description of a project's domain, expressed using the vocabularies available to that project. Domain models may describe data, workflows, information flows, or architecture.

**Model type**:
A named category of domain model whose available concepts are defined by an associated ontology.

**Data model**:
A domain model describing either conceptual data structures or concrete domain resources and their values.

**Conceptual data model**:
A data model describing classes of entities, their attributes, and their relationships.

**Concrete data model**:
A data model describing individual resources, their properties, and their values.

**Process model**:
A domain model describing activities, decisions, inputs, outputs, responsible parties, and the flow between activities.

**Plan**:
A description of planned process steps, their inputs and outputs, and the flows between them.

**Process step**:
A planned activity belonging to one or more plans. A decision is a specialized process step.

**Decision**:
A process step describing a choice between possible outgoing flows.

**Flow**:
An immediate directed connection between two process steps in one plan, optionally carrying a descriptive condition.

**Responsible party**:
A person, organization, or role assigned responsibility for a planned process step.

**State machine model**:
A domain model describing states, including initial and final states, and transitions with events, conditions, or actions.

**State machine**:
A description of a subject's states and the transitions between them.

**State**:
A condition or mode of a subject within a state machine.

**Initial state**:
The designated starting state of a state machine.

**Final state**:
A terminal state with no outgoing transition.

**Transition**:
A directed change between two states in a state machine, optionally described by an event, condition, or action.

**Presentation graph**:
A graph describing the visual appearance or placement of specific elements in one view of an ontology or domain model, separate from its content.

**View model**:
A description of the explicitly selected elements and relationships of one ontology or domain model that appear in a particular perspective.

**Source graph**:
The single ontology or domain model from which a view model selects elements and relationships.

**Visual design model**:
A reusable description of visual presentation rules for concept types, such as shapes, colors, and typography, that does not describe the placement or appearance of any specific domain element.

**Visual rule**:
A reusable description of how one concept type appears, independent of any specific element in a view.

**Saved query**:
A named, reusable, read-only SPARQL query belonging to a project, optionally accepting declared RDF term parameters.
