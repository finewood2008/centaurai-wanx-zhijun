const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startServer, localService } = require("../shell/server.cjs");

test("desktop only accepts loopback services", () => {
  for (const value of [
    "https://example.com",
    "http://example.com",
    "http://user:password@127.0.0.1:8088",
    "http://127.0.0.1:8088/private",
  ])
    assert.throws(() => localService(value));
  assert.equal(localService("http://127.0.0.1:8088").hostname, "127.0.0.1");
});

test("isolated renderer serves own UI and forwards native authenticated requests", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhijun-ui-"));
  await fs.writeFile(
    path.join(root, "index.html"),
    "Zhijun independent renderer",
  );
  const calls = [];
  const upstream = http.createServer((req, res) => {
    calls.push({
      url: req.url,
      auth: req.headers.authorization,
      method: req.method,
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-Octop-Access-Token": "renewed-test-token",
    });
    res.end(JSON.stringify({ atom: "same-native-id" }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const service = await startServer({
    root,
    upstream: `http://127.0.0.1:${upstream.address().port}`,
    port: 0,
  });
  t.after(async () => {
    service.close();
    upstream.closeAllConnections();
    upstream.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const page = await fetch(service.origin);
  assert.match(await page.text(), /independent renderer/);
  assert.match(
    page.headers.get("Content-Security-Policy"),
    /object-src 'none'/,
  );
  const result = await fetch(
    `${service.origin}/api/agents/synthetic/memory/atoms/a:replace`,
    {
      method: "POST",
      headers: { Origin: service.origin, Authorization: "Bearer test-token" },
      body: "{}",
    },
  );
  assert.deepEqual(await result.json(), { atom: "same-native-id" });
  assert.equal(
    result.headers.get("X-Octop-Access-Token"),
    "renewed-test-token",
  );
  assert.deepEqual(calls, [
    {
      url: "/api/agents/synthetic/memory/atoms/a:replace",
      auth: "Bearer test-token",
      method: "POST",
    },
  ]);
  assert.equal(
    (
      await fetch(`${service.origin}/api/auth/login`, {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${service.origin}/api/auth/login`, { method: "POST" }))
      .status,
    403,
  );
  assert.equal((await fetch(`${service.origin}/shell/main.cjs`)).status, 404);
  assert.equal(calls.length, 1);
});

test("WANX unavailable is reported as failure", async (t) => {
  const reserve = http.createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const service = await startServer({
    root: os.tmpdir(),
    upstream: `http://127.0.0.1:${port}`,
    port: 0,
  });
  t.after(() => service.close());
  const response = await fetch(`${service.origin}/api/health`);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error.message, /未连接/);
});
