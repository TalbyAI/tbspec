import assert from "node:assert/strict";
import test from "node:test";
import { parseRdf } from "../src/rdf.ts";

test("RDF/XML security checks ignore DTD-like text inside comments and CDATA", async () => {
  const xml = `<?xml version="1.0"?>
<!-- <!DOCTYPE rdf:RDF [ <!ENTITY x SYSTEM "file:///should-not-be-read"> ]> -->
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="https://example.org/item">
    <rdf:value><![CDATA[<!DOCTYPE rdf:RDF>]]></rdf:value>
  </rdf:Description>
</rdf:RDF>`;
  const store = await parseRdf(
    Buffer.from(xml),
    "application/rdf+xml",
    "https://example.org/data.rdf",
  );
  assert.equal(store.size, 1);
});

test("RDF/XML rejects external DTDs before parsing or external resolution", async () => {
  const xml = `<?xml version="1.0"?>
<!DOCTYPE rdf:RDF SYSTEM "file:///must-not-be-read">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>`;
  await assert.rejects(async () => {
    try {
      await parseRdf(Buffer.from(xml), "application/rdf+xml", "https://example.org/data.rdf");
    } catch (error) {
      assert.equal(
        (error as { diagnostic?: { code?: string } }).diagnostic?.code,
        "RDF_FORMAT_UNSUPPORTED",
      );
      throw error;
    }
    assert.fail("External DTD was accepted.");
  });
});
