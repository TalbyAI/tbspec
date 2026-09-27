# Intent

This repository aims to build a command-line tool and a local web interface for project teams to manage versionable ontologies and models. Both interfaces work with the same local project and support creating, exploring, editing, and validating its contents. The command line supports team workflows and automation; the web interface offers editing and multiple visual views.

A project is a local directory or repository that may contain ontologies, models, or both. An ontology defines a reusable vocabulary of concepts and relationships. Projects may reference ontologies from other projects as versioned dependencies, allowing teams to reuse shared definitions without copying them.

Models describe aspects of the project's domain, such as data, workflows, information flows, and architecture, using the ontologies available to the project. They are versioned specifications that people and tools can consult. Ontologies and models use RDF in readable formats such as Turtle or N3.

Validation checks RDF format, use of the available vocabulary, and declared constraints. This lets teams evolve their descriptions while keeping their project models coherent.
