import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverProviders, loadPreferences, savePreferences } from "./providers.mjs";

test("current provider names and legacy aliases stay grouped", () => {
  const rows = discoverProviders({ home: path.join(os.tmpdir(), "nonexistent-rounds-fixture"), env: {} });
  assert.equal(rows.length, 8);
  assert.equal(rows.find(p => p.id === "devin").name, "Devin");
  assert.ok(rows.find(p => p.id === "devin").aliases.includes("Windsurf"));
  assert.ok(rows.find(p => p.id === "antigravity").cli.includes("gemini"));
});
test("profile discovery does not parse credentials; labels and toggles persist across rescans", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-profiles-"));
  try {
    const a = path.join(home, ".claude-profiles", "one"), b = path.join(home, ".claude-profiles", "two");
    for (const f of [a,b]) { fs.mkdirSync(f, { recursive: true }); fs.writeFileSync(path.join(f, ".credentials.json"), "NOT JSON: do not read"); }
    const env = { CLAUDE_CONFIG_DIR: a };
    const scan = (preferences = {}) => discoverProviders({ home, env, preferences }).find(p => p.id === "claude");
    const first = scan();
    assert.equal(first.profiles.length, 2);
    assert.ok(first.profiles.every(p => !p.enabled && p.identityStatus === "unverified"));
    const id = first.profiles[0].id;
    const prefs = path.join(home, "rounds", "accounts.json");
    savePreferences(prefs, { providers: { claude: true }, profiles: { [id]: { label: "Work", enabled: true } } });
    const second = scan(loadPreferences(prefs));
    assert.equal(second.enabled, true);
    assert.equal(second.profiles.find(p => p.id === id).label, "Work");
    assert.equal(second.profiles.find(p => p.id === id).enabled, true);
    fs.rmSync(a, { recursive: true });
    assert.equal(loadPreferences(prefs).profiles[id].label, "Work");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
test("malformed preference files are not overwritten", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-prefs-"));
  try {
    const f = path.join(dir, "accounts.json");
    fs.writeFileSync(f, "{broken");
    assert.throws(() => savePreferences(f, { providers: { claude: true } }));
    assert.equal(fs.readFileSync(f, "utf8"), "{broken");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
