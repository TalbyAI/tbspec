# RDF engine comparison prototype

Throwaway proof for [Compare RDF engines with one integrated proof](../../.scratch/mvp-technical-architecture/issues/04-integrated-rdf-engine-proof.md). It runs the same small Turtle, N-Triples, SHACL, and malformed-file fixtures against Node/RDF.js and embedded Apache Jena. See [VERDICT.md](VERDICT.md) for the observed results.

## Run Node/RDF.js

Requires Node 22.12+ and npm. From this prototype's directory:

```sh
cd node
npm ci
npm test
```

`node/package-lock.json` pins packages; npm installs them only in `node/node_modules/`.

## Run embedded Jena

Requires JDK 21+ and Maven 3.9+. From this prototype's directory:

```sh
cd jena
mvn -q compile exec:java -Dexec.mainClass=Smoke
```

On PowerShell, quote `'-Dexec.mainClass=Smoke'`. `jena/.mvn/maven.config` redirects Maven's dependency repository to `jena/.m2/`; build output stays in `jena/target/`. No root commands or packages are involved.

Each command exits nonzero if a proof check fails. Both scripts print `PASS` lines and the source shapes graph for every SHACL diagnostic. The two candidates share fixture data only; neither depends on the other or on application code.
