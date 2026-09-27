# Lock external resources as local snapshots

Projects can reuse RDF from local directories, Git repositories, and generic URLs whose contents may later change or disappear. Each dependency is kept as a local snapshot with its source and content signature recorded in a lockfile; validation uses that snapshot, while a separate check detects source drift. This makes project results reproducible and available offline, at the cost of explicit dependency updates and local storage.
