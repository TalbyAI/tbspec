import assert from "node:assert/strict";
import test from "node:test";
import { loadViewsWorkspace } from "../web/views-workspace.ts";

test("views workspace waits for each inspection before exposing both inventories", async () => {
  const calls: string[] = [];
  let reading = false;
  const inspect = async (route: "views" | "designs") => {
    assert.equal(reading, false, "overlapping inspection requests return PROJECT_BUSY");
    reading = true;
    calls.push(route);
    await new Promise((resolve) => setTimeout(resolve, 0));
    reading = false;
    return {
      data: {
        items:
          route === "views"
            ? [
                { selector: "views/one.ttl", source: "models/canvas.ttl" },
                { selector: "views/two.ttl", source: "models/canvas.ttl" },
              ]
            : [{ selector: "designs-one.ttl" }, { selector: "designs-two.ttl" }],
      },
    };
  };

  const result = await loadViewsWorkspace(inspect);

  assert.deepEqual(calls, ["views", "designs"]);
  assert.deepEqual(result.views.data.items, [
    { selector: "views/one.ttl", source: "models/canvas.ttl" },
    { selector: "views/two.ttl", source: "models/canvas.ttl" },
  ]);
  assert.deepEqual(result.designs.data.items, [
    { selector: "designs-one.ttl" },
    { selector: "designs-two.ttl" },
  ]);
});
