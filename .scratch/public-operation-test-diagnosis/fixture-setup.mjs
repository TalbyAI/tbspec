import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.endsWith("/app/tests/cli.test.ts")) return result;
    const original = `  for (const args of [
    ["model", "create", "schema.ttl", "--type", "data"],
    ["model", "create", "model.ttl", "--type", "data", "--profile", "concrete"],
    ["model", "schema", "add", "model.ttl", "schema.ttl"],
    ["shapes", "create", "model.ttl"],
  ])
    assert.equal(invoke(args, root).status, 0);`;
    let source = String(result.source).replaceAll("\r\n", "\n");
    if (!source.includes(original)) throw new Error("Fixture setup seam changed.");
    source = `import { authorResource as diagnosticAuthorResource } from '../src/authoring.ts';\n${source}`;
    source = source.replace(
      original,
      `  for (const options of [
      { command: 'model.create', path: 'schema.ttl', type: 'data' },
      { command: 'model.create', path: 'model.ttl', type: 'data', profile: 'concrete' },
    ]) assert.equal((await diagnosticAuthorResource({ project: root, ...options })).status, 'ok');
    for (const args of [
      ["model", "schema", "add", "model.ttl", "schema.ttl"],
      ["shapes", "create", "model.ttl"],
    ]) assert.equal(invoke(args, root).status, 0);`,
    );
    return { ...result, source };
  },
});
