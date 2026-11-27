import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopSessionRoot, which, windowsBrowser } from "../server/platform.mjs";

test("Windows desktop lookup uses roaming data or an existing local directory", () => {
  const env = { APPDATA: "C:\\Users\\example\\Roaming", LOCALAPPDATA: "C:\\Users\\example\\Local" };
  const opts = { platform: "win32", env, home: "C:\\Users\\example" };
  assert.equal(desktopSessionRoot({ ...opts, exists: () => false }), path.win32.join(env.APPDATA, "Claude", "claude-code-sessions"));
  const local = path.win32.join(env.LOCALAPPDATA, "Claude", "claude-code-sessions");
  assert.equal(desktopSessionRoot({ ...opts, exists: f => f === local }), local);
});
test("macOS lookup is unchanged", () => {
  assert.equal(desktopSessionRoot({ platform: "darwin", home: "/Users/example" }), path.join("/Users/example", "Library/Application Support/Claude/claude-code-sessions"));
});
test("native executable discovery honors PATH and spaces", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rounds test "));
  const name = process.platform === "win32" ? "test-cli.exe" : "test-cli";
  try {
    const f = path.join(temp, name);
    fs.writeFileSync(f, "");
    fs.chmodSync(f, 0o755);
    assert.equal(which("test-cli", { env: { PATH: temp } }), f);
    assert.equal(which("missing", { env: { PATH: temp } }), null);
    if (process.platform === "win32") assert.equal(which("test-cli", { platform: "win32", env: { PATH: `C:\\missing;"${temp}"` } }), f);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test("Windows browser discovery finds Edge and honors PATH fallback", () => {
  const env = { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\example\\Local" };
  const edge = path.win32.join(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe");
  assert.equal(windowsBrowser({ env, runnable: f => f === edge, find: () => null }), edge);
  assert.equal(windowsBrowser({ env, runnable: () => false, find: n => n === "brave.exe" ? "custom-brave" : null }), "custom-brave");
  assert.equal(windowsBrowser({ env, runnable: () => false, find: () => null }), null);
});
