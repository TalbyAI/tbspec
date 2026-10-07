# Choose the permanent domain and ontology IRI policy

Type: grilling
Status: ready-for-human
State: resolved
Assigned to: Codex

## Question

Which of the owned domains (`talby.ai`, `talbyai.com`, `talby.app`) will host permanent tbspec vocabulary identities, and what are the ontology IRI, version IRI, term IRI, and redirect/versioning rules? Decide this before assigning stable IRIs to metadata and starter ontologies. Use the OWL 2 ontology/version IRI convention and account for changing web hosts without changing RDF identities.

## Answer

Use `talby.ai` as the permanent RDF identity domain. Publish three independently versioned ontologies:

| Vocabulary        | Ontology IRI                              | First version IRI                               | Term IRI pattern                                 |
| ----------------- | ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| tbspec metadata   | `https://talby.ai/ontology/tbspec`        | `https://talby.ai/ontology/tbspec/0.1.0`        | `https://talby.ai/ontology/tbspec#{Term}`        |
| Process extension | `https://talby.ai/ontology/process`       | `https://talby.ai/ontology/process/0.1.0`       | `https://talby.ai/ontology/process#{Term}`       |
| State machine     | `https://talby.ai/ontology/state-machine` | `https://talby.ai/ontology/state-machine/0.1.0` | `https://talby.ai/ontology/state-machine#{Term}` |

- Each RDF ontology document declares its stable ontology IRI as `owl:Ontology` and its particular release with `owl:versionIRI`. `0.1.0` is the first public vocabulary release for each ontology, independent of the functional spec and application versions. Each later release gets a new version IRI; published version documents are immutable.
- The stable ontology IRI serves the current release, while every version IRI continues to serve its specific release. A `#` term is dereferenced through its ontology IRI. Keep published term IRIs when their meanings remain compatible; introduce a new term IRI for an incompatible meaning and retain the old term's published definition. Exact term and shape names belong to [Define metadata and starter resource identities and shapes](11-starter-resource-contract.md).
- Keep `talby.ai` resolving these paths if web hosting changes, using DNS or a proxy to change the server behind them. Do not rewrite ontology, version, or term IRIs to a new host. Other owned domains may direct visitors to `talby.ai`, but do not mint parallel RDF identities there. Serve at least an RDF representation at the stable and version paths; HTML documentation may be added through content negotiation.

This follows the [OWL 2 ontology and version IRI convention](https://www.w3.org/TR/owl2-syntax/#Ontology_IRI_and_Version_IRI) and the W3C [hash namespace publication recipe](https://www.w3.org/TR/swbp-vocab-pub/).
