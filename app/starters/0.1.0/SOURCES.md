# Starter release 0.1.0 sources and licenses

`inventory.toml` binds the exact UTF-8/raw bytes, lengths, parser bases/profiles, graph identities, graph signatures and interpretation closures. Consumer bundle sources retain its exact SHA-256 digest and attribution/license strings. This file supplements that machine inventory with per-file attribution. Vocabulary identities are identifiers; initialization and validation never dereference them.

## Authored Talby resources

`source/tbspec.ttl`, `source/proc.ttl`, `source/sm.ttl`, their `.shacl.ttl` support files and `source/{data,process,state-machine}.design.ttl` are authored by the Talby tbspec contributors under the [MIT license](../LICENSE). Stable ontology identities are `https://talby.ai/ontology/{tbspec,process,state-machine}` with version IRIs ending `/0.1.0`. Shapes use `/0.1.0/shapes`; named shapes and design rules use release-scoped fragment IRIs.

Their definitions implement the [approved starter contract](../../../.scratch/mvp-technical-architecture/issues/11-starter-resource-contract.md). The metadata ontology is the common contract and default data ontology; there is no fourth tool-owned data namespace. Shapes are open and encode local structure only. Cross-file association, classification, selected-rule applicability and resulting effective label configuration remain project/application diagnostics.

## Exact upstream snapshots

| File                | Source                                                                                                                                                                                       | Attribution/license                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `source/rdf.ttl`    | [W3C RDF namespace](https://www.w3.org/1999/02/22-rdf-syntax-ns.ttl)                                                                                                                         | W3C, RDF vocabulary; [W3C document license](https://www.w3.org/copyright/document-license/).                     |
| `source/rdfs.ttl`   | [W3C RDF Schema namespace](https://www.w3.org/2000/01/rdf-schema.ttl)                                                                                                                        | W3C, RDF Schema vocabulary; W3C document license.                                                                |
| `source/owl.ttl`    | [W3C OWL 2 namespace](https://www.w3.org/2002/07/owl.ttl)                                                                                                                                    | W3C, OWL 2 vocabulary; W3C document license.                                                                     |
| `source/shacl.ttl`  | [W3C SHACL namespace](https://www.w3.org/ns/shacl.ttl)                                                                                                                                       | W3C, SHACL vocabulary; W3C document license.                                                                     |
| `source/p-plan.owl` | [P-Plan pinned source](https://raw.githubusercontent.com/dgarijo/Vocabularies/773007a6d7ed2fb0054967008cc128fa5c48ca36/P-PLAN/p-plan.owl), commit `773007a6d7ed2fb0054967008cc128fa5c48ca36` | Daniel Garijo and Yolanda Gil, P-Plan 1.3; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), unchanged. |

W3C sources were retrieved on 2026-10-07 and retained byte-for-byte. Copyright notices and RDF annotations within them are retained. Standard namespaces preserve their significant HTTP/HTTPS spellings. Full standard vocabularies are local vocabulary resources, with their declared ontology identities where supplied and otherwise generated graph identities. They do not become a new tool namespace.

P-Plan's exact release declares version `1.3` and CC BY 4.0. Preserve its internal entity declarations and `p-plan:isPrecededBy`; do not substitute the earlier documentation's `isPreceededBy` or license. The trusted bundle's digest is the sole authority for its `rdfxml-vetted-bundle-v1` exception. No external entity or network resolution occurs.

## XML Schema extraction

`source/xsd.ttl` is a small authored local RDF declaration of standard datatype identities from [W3C XML Schema datatypes](https://www.w3.org/TR/xmlschema11-2/), not a claim that W3C publishes this particular Turtle serialization. Attribution: W3C XML Schema contributors, with the RDF extraction by Talby tbspec contributors. Source specification: W3C document license; authored serialization: MIT. It covers the datatypes used by starters and common RDF authoring, without asserting executable datatype semantics beyond the approved validator profile.

## Release policy

These files are the first authored release, independent of application and project schema versions. They have not been externally published or hosted by this implementation. Once published, exact version documents and shape/rule identities are immutable. Application upgrades neither regenerate these files nor replace a project's locked copies. Explicit future dependency updates must disclose interpretation and byte changes.
