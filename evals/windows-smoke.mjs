// Offline smoke test: use the checked-in demo data, never real session directories.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-smoke-"));
const data = path.join(tmp, "data"), empty = path.join(tmp, "empty");
fs.cpSync(path.join(root, "demo"), data, { recursive: true });
fs.mkdirSync(path.join(empty, "projects"), { recursive: true });
const config = JSON.parse(fs.readFileSync(path.join(data, "config.json"), "utf8"));
fs.writeFileSync(path.join(data, "config.json"), JSON.stringify({ ...config, updates: false, relay: false }));
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^path$/i.test(key)));
const env = { ...cleanEnv, PATH: "", ROUNDS_HOME: data, ROUNDS_CLAUDE_HOME: empty, ROUNDS_DESKTOP_SESSIONS: empty, ROUNDS_PORT: String(port), ROUNDS_BROWSER: "none" };
const bind = spawnSync(process.execPath, ["--input-type=module", "-e", `import { serve } from "./server/serve.mjs"; const s = await serve(0); const address = s.address().address; await new Promise(r => s.close(r)); if (address !== "127.0.0.1") throw new Error("Unexpected bind address: " + address); process.exit(0);`], { cwd: root, env, encoding: "utf8", timeout: 10000, windowsHide: true });
assert.equal(bind.status, 0, bind.stderr || String(bind.error || ""));
const child = spawn(process.execPath, [path.join(root, "bin", "rounds.mjs"), "--no-open"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let logs = "";
child.stdout.on("data", d => logs += d); child.stderr.on("data", d => logs += d);
const exited = new Promise(resolve => child.once("exit", resolve));
try {
  let response;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { response = await fetch("http://127.0.0.1:" + port + "/api/index"); if (response.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(response?.ok, logs);
  const idx = await response.json();
  assert.ok(idx.sets?.length > 0, "sample canvas has no sets");
  const page = await fetch("http://127.0.0.1:" + port + "/");
  assert.ok(page.ok && (await page.text()).includes("Rounds"));
  const forbidden = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/api/index", headers: { Host: "example.invalid" } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
  });
  assert.equal(forbidden, 403);
  console.log("PASS: sample index, production canvas, loopback host check (" + idx.sets.length + " sets)");
} finally {
  if (child.exitCode === null) child.kill();
  await exited;
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
