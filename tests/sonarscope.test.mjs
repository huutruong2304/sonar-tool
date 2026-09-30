import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the SonarScope dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /SonarScope/i);
  assert.match(html, /All projects at a glance/i);
  assert.match(html, /UT COVERAGE/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("includes the SonarQube proxy and AI-copy workflow", async () => {
  const [page, route, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sonar/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Copy.*to AI/);
  assert.match(page, /localStorage/);
  assert.match(route, /api\/measures\/component/);
  assert.match(route, /api\/issues\/search/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
