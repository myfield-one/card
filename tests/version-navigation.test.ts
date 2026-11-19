import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("a warm root service worker does not serve the current shell for historical versions", async () => {
  const listeners = new Map<string, (event: object) => void>();
  vm.runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL,
    self: {
      location: { origin: "https://card.example" },
      addEventListener: (name: string, handler: (event: object) => void) => listeners.set(name, handler),
    },
    caches: { match: () => Promise.resolve(new Response("root shell")) },
    fetch: () => Promise.reject(new Error("offline")),
  });
  const handleFetch = listeners.get("fetch")!;
  const navigation = (path: string) => {
    let response: Promise<Response> | undefined;
    handleFetch({
      request: { method: "GET", url: `https://card.example${path}`, mode: "navigate" },
      respondWith: (value: Promise<Response>) => { response = value; },
    });
    return response;
  };
  assert.equal(await (await navigation("/")!)?.text(), "root shell");
  assert.equal(navigation("/v0.9.7/"), undefined);
  assert.equal(navigation("/unknown/"), undefined);
});
