#!/usr/bin/env node
// rounds              open the canvas (indexes first if it never has)
// rounds --demo       open it on sample work, for a first look with nothing of yours read
// rounds init         set it up: the folder, the MCP server, the skill, the hooks (asks first)
// rounds update       bring the copy the hooks and the MCP server run up to this version
// rounds path         the folder this copy runs from (how an update finds a new one)
// rounds check        ask GitHub for the latest release now (the notes hook runs it once a day)
// rounds uninstall    take out what init put in (your canvas data stays)
// rounds index        read every transcript again
// rounds mcp          the MCP server, for Claude (stdio)
// rounds hook <notes|tool|git-push>   the hooks, for Claude and git
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const say = (s = "") => process.stdout.write(s + "\n");
if (Number(process.versions.node.split(".")[0]) < 20) { say(`Rounds needs Node 20 or newer; this is ${process.version}.`); process.exit(1); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// the command is the first word that isn't a flag; flags can come anywhere
const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith("-"));
const rest = argv.filter((a) => a !== cmd);
const yes = rest.includes("--yes") || rest.includes("-y");
// run through npx, this copy lives in npx's cache, which gets cleared
const fromNpx = /[\\/]_npx[\\/]/.test(ROOT);
const quote = (a) => (/\s/.test(a) ? `"${a}"` : a);

// From npx, init copies Rounds to a folder that lasts (~/.rounds/app), where the MCP server and
// the hooks run. npx fetches the newest Rounds on every run, so opening the canvas brings that
// copy up to date too: a fingerprint of what it runs says when.
const APP = ["bin", "server", "hooks", "skill", "dist", "package.json"];
function fingerprint(dir) {
  const h = crypto.createHash("sha1");
  const walk = (rel) => {
    const f = path.join(dir, rel);
    if (!fs.existsSync(f)) return;
    if (fs.statSync(f).isDirectory()) { for (const n of fs.readdirSync(f).sort()) walk(path.join(rel, n)); return; }
    h.update(rel); h.update(fs.readFileSync(f));
  };
  APP.forEach(walk);
  return h.digest("hex");
}
function copyApp(home) {
  // built beside it, then swapped in, so a hook that runs meanwhile finds a whole copy
  const next = `${home}.next`, old = `${home}.old`;
  fs.rmSync(next, { recursive: true, force: true });
  for (const d of APP) fs.cpSync(path.join(ROOT, d), path.join(next, d), { recursive: true });
  const pw = path.join(ROOT, "..", "playwright-core");
  if (fs.existsSync(pw)) fs.cpSync(pw, path.join(next, "node_modules", "playwright-core"), { recursive: true });
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(home)) fs.renameSync(home, old);
  fs.renameSync(next, home);
  fs.rmSync(old, { recursive: true, force: true });
}
async function update({ quiet = false } = {}) {
  const { DATA, CLAUDE } = await import("../server/config.mjs");
  const home = path.join(DATA, "app");
  if (!fromNpx || !fs.existsSync(home)) { if (!quiet) say(fromNpx ? "Rounds isn't set up here yet. Run init first." : "This copy of Rounds runs where it is; pull the repo to update it."); return; }
  if (fingerprint(ROOT) === fingerprint(home)) { if (!quiet) say("Rounds is up to date."); return; }
  copyApp(home);
  const skill = path.join(CLAUDE, "skills", "rounds", "SKILL.md");
  if (fs.existsSync(skill)) fs.copyFileSync(path.join(home, "skill", "SKILL.md"), skill);
  say(`Claude sessions you start from now on use Rounds ${JSON.parse(fs.readFileSync(path.join(home, "package.json"), "utf8")).version}.`);
}

if (rest.includes("--demo")) {
  // sample work in its own folder, and no transcripts read: nothing of yours shows
  const demo = path.join(os.homedir(), ".rounds-demo");
  // a newer demo replaces the copy (nothing in it is anyone's own work)
  const version = (d) => { try { return fs.readFileSync(path.join(d, "version"), "utf8"); } catch { return ""; } };
  if (!fs.existsSync(path.join(demo, "posts")) || version(demo) !== version(path.join(ROOT, "demo"))) {
    fs.rmSync(demo, { recursive: true, force: true, maxRetries: 3 });
    fs.cpSync(path.join(ROOT, "demo"), demo, { recursive: true });
  }
  // the sample work keeps its spacing but always ends about now, so the timeline has a story
  const stamp = path.join(demo, "generated");
  const then = Number(fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf8") : Date.now());
  const shift = Date.now() - then;
  if (shift > 3600e3) {
    for (const dir of ["posts", "pushes"]) for (const f of fs.readdirSync(path.join(demo, dir))) {
      const file = path.join(demo, dir, f), x = JSON.parse(fs.readFileSync(file, "utf8"));
      x.at += shift;
      fs.writeFileSync(file, JSON.stringify(x, null, 1));
    }
    const edits = path.join(demo, "store", "edits");
    if (fs.existsSync(edits)) for (const f of fs.readdirSync(edits)) {
      const file = path.join(edits, f), x = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const list of Object.values(x)) for (const e of list) e.at += shift;
      fs.writeFileSync(file, JSON.stringify(x));
    }
    const notes = path.join(demo, "comments.json");
    if (fs.existsSync(notes)) {
      const list = JSON.parse(fs.readFileSync(notes, "utf8"));
      for (const c of list) { c.at += shift; if (c.reply) c.reply.at += shift; }
      fs.writeFileSync(notes, JSON.stringify(list, null, 1));
    }
    fs.writeFileSync(stamp, String(Date.now()));
    fs.rmSync(path.join(demo, "index.json"), { force: true });
  }
  const empty = path.join(demo, ".empty");
  fs.mkdirSync(path.join(empty, "projects"), { recursive: true });
  for (const [k, v] of Object.entries({ HOME: demo, CLAUDE_HOME: empty, CODEX_HOME: empty, DESKTOP_SESSIONS: empty })) process.env[`ROUNDS_${k}`] = process.env[`WORKBENCH_${k}`] = v;
}

// From npx, the canvas runs as a child of this process. The dock's Update fetches the new release
// and ends the child with RESTART, saying where the new copy is; this process starts that one on
// the same port. Whatever opened Rounds (a terminal, a login item) keeps the one process it
// started. A new version that won't start gives way to the one before.
const RESTART = 75;
async function supervise() {
  let root = ROOT, prev = null, args = argv, bad = "";
  for (;;) {
    const began = Date.now();
    const child = spawn(process.execPath, [path.join(root, "bin", "rounds.mjs"), ...args], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env: { ...process.env, ROUNDS_CHILD: "1", ROUNDS_RESTART: prev ? "1" : "", ROUNDS_BAD_VERSION: bad },
    });
    let next = null;
    child.on("message", (m) => { if (m?.root) next = m.root; });
    const pass = (sig) => () => child.kill(sig);
    const sigs = ["SIGINT", "SIGTERM", "SIGHUP"].map((s) => [s, pass(s)]);
    for (const [s, f] of sigs) process.on(s, f);
    const code = await new Promise((r) => child.on("exit", (c, sig) => r(sig ? 0 : c ?? 0)));
    for (const [s, f] of sigs) process.off(s, f);
    if (code === RESTART && next && fs.existsSync(path.join(next, "bin", "rounds.mjs"))) {
      prev = root; root = next;
      if (!args.includes("--no-open")) args = [...args, "--no-open"];
      continue;
    }
    if (prev && code !== 0 && Date.now() - began < 30e3) {
      // and it isn't offered again; a later release is
      try { bad = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version; } catch {}
      say(`Rounds ${bad} didn't start, so the one before is back.`);
      root = prev; prev = null;
      continue;
    }
    process.exit(code);
  }
}

async function start() {
  if (fromNpx && !process.env.ROUNDS_CHILD) return supervise();
  await update({ quiet: true });
  const { loadConfig, DATA, CLAUDE } = await import("../server/config.mjs");
  // An install from before the hook kept published pages: init again adds that, asking first.
  // Rounds never changes Claude's settings on its own.
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CLAUDE, "settings.json"), "utf8"));
    const ours = (s.hooks?.PostToolUse || []).filter((e) => (e.hooks || []).some((h) => OURS.test(String(h.command || ""))));
    if (ours.length && !ours.some((e) => /\bArtifact\b/.test(e.matcher || ""))) say("To keep every page your sessions publish, even after its folder is cleared, run this once:\n  npx github:krispuckett/rounds init\n");
  } catch {}
  const port = Number(process.env.ROUNDS_PORT || loadConfig().port || 4797);
  process.env.ROUNDS_PORT = process.env.WORKBENCH_PORT = String(port);
  if (process.platform !== "darwin") say("Rounds is made for macOS. Elsewhere it runs, with screens shown at full size and no page previews unless Chrome is found.");
  if (!fs.existsSync(path.join(DATA, "index.json"))) {
    say(rest.includes("--demo") ? "Setting up the demo…" : "Reading your Claude sessions for the first time…");
    const { buildIndex } = await import("../server/indexer.mjs");
    await buildIndex({ log: (l) => say(`  ${l}`) });
  }
  if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
    say("Building the canvas…");
    execFileSync("npx", ["vite", "build", "--logLevel", "warn"], { cwd: ROOT, stdio: "inherit" });
  }
  const { serve } = await import("../server/serve.mjs");
  // just after an update, the old copy may still be letting go of the port
  for (let i = 0; ; i++) {
    try { await serve(port); break; } catch (e) {
      if (e?.code !== "EADDRINUSE" || !process.env.ROUNDS_RESTART || i >= 20) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const url = `http://localhost:${port}`;
  say(`Rounds is open at ${url}`);
  if (!rest.includes("--no-open")) spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

// What init puts into Claude's settings, from any version of it (Workbench was its first name),
// so a new init replaces the old and uninstall finds all of it.
const OURS = /[\\/]bin[\\/](rounds|workbench)\.mjs"? hook /;
const ourHooks = (settings) => {
  let n = 0;
  for (const [ev, list] of Object.entries(settings.hooks || {})) {
    const kept = list.filter((e) => !(e.hooks || []).some((h) => OURS.test(String(h.command || ""))));
    n += list.length - kept.length;
    if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
  }
  return n;
};
const claudeCli = (args) => { try { execFileSync("claude", args, { stdio: "ignore" }); return true; } catch { return false; } };

async function init() {
  const { DATA, CLAUDE, CONFIG } = await import("../server/config.mjs");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q) => yes || /^y/i.test((await rl.question(`${q} [y/N] `)).trim());
  const trial = !!process.env.ROUNDS_CLAUDE_HOME; // a stand-in Claude folder: Claude's own config is never touched

  say("Rounds keeps everything on this machine, in " + DATA);
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(CONFIG)) {
    fs.writeFileSync(CONFIG, JSON.stringify({ projects: [], private: [], folders: true, home: "Home", port: 4797 }, null, 2));
    say(`  Wrote ${CONFIG}. Name projects or keep work private there.`);
  }
  // From npx, Rounds copies itself to a folder that lasts, for the MCP server and the hooks to run.
  let home = ROOT;
  if (fromNpx) {
    home = path.join(DATA, "app");
    copyApp(home);
    say(`  Copied Rounds to ${home}, so it keeps working after npx clears its cache.`);
  }
  const SELF = path.join(home, "bin", "rounds.mjs");
  say();

  // 1. the MCP server, so sessions can post and read notes
  const mcpLine = ["mcp", "add", "--scope", "user", "rounds", "--", "node", SELF, "mcp"];
  if (await ask("Add the Rounds MCP server to Claude Code, so sessions can post their work?")) {
    if (trial) say(`  (trial run) would run: claude ${mcpLine.join(" ")}`);
    else {
      for (const name of ["workbench", "rounds"]) claudeCli(["mcp", "remove", "--scope", "user", name]); // an older copy gives way
      if (claudeCli(mcpLine)) say("  Added.");
      else say(`  Couldn't run claude. Add it yourself:\n  claude ${mcpLine.map(quote).join(" ")}`);
    }
  }

  // 2. the skill, which teaches Claude when and how to post
  if (await ask("Install the rounds skill, so Claude knows when and how to post?")) {
    const skills = path.join(CLAUDE, "skills");
    const old = path.join(skills, "workbench", "SKILL.md");
    if (fs.existsSync(old) && /^name: workbench$/m.test(fs.readFileSync(old, "utf8"))) fs.rmSync(path.dirname(old), { recursive: true, force: true });
    const dest = path.join(skills, "rounds");
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(home, "skill", "SKILL.md"), path.join(dest, "SKILL.md"));
    say(`  Installed to ${dest}.`);
  }

  // 3. the hooks: notes reach their session; posts and pushes are tied to it
  if (await ask("Add the hooks (your notes reach their session; pushes to main and published pages get recorded)?")) {
    const file = path.join(CLAUDE, "settings.json");
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    // the first backup is the one that matters: a second run never overwrites it
    const backup = [`${file}.before-rounds`, `${file}.before-workbench`].find((f) => fs.existsSync(f)) || `${file}.before-rounds`;
    if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
    const saved = fs.existsSync(backup);
    ourHooks(settings);
    settings.hooks ||= {};
    const run = (name) => ({ type: "command", command: `node "${SELF}" hook ${name}` });
    (settings.hooks.UserPromptSubmit ||= []).push({ hooks: [run("notes")] });
    (settings.hooks.PostToolUse ||= []).push({ matcher: "Bash|Artifact|mcp__rounds__rounds_post|mcp__rounds__rounds_change", hooks: [run("tool")] });
    fs.mkdirSync(CLAUDE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    say(`  Added to ${file}.${saved ? ` Your settings from before are in ${path.basename(backup)}.` : ""}`);
  }

  // 4. this repo: pushes made outside Claude show too, as their commits
  let repo = "";
  try { repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  if (repo) {
    const hook = path.join(repo, ".git", "hooks", "pre-push");
    const ours = fs.existsSync(hook) && /^# (rounds|workbench):/m.test(fs.readFileSync(hook, "utf8"));
    if (fs.existsSync(hook) && !ours) say(`This repo already has a pre-push hook; left it alone. To add Rounds to it: node "${SELF}" hook git-push`);
    else if (await ask(`Record pushes to main from ${path.basename(repo)} made outside Claude too?`)) {
      fs.writeFileSync(hook, `#!/bin/sh\n# rounds: record pushes to main on the canvas; never stops a push\nnode "${SELF}" hook git-push "$@" || true\nexit 0\n`);
      fs.chmodSync(hook, 0o755);
      say("  Added.");
    }
  }
  rl.close();

  say();
  say("Reading your Claude sessions…");
  const { buildIndex } = await import("../server/indexer.mjs");
  await buildIndex({ log: (l) => say(`  ${l}`) });
  say();
  say(`Done. Open the canvas with: ${fromNpx ? "npx github:krispuckett/rounds" : `node ${quote(path.join(ROOT, "bin", "rounds.mjs"))}`}`);
  say("New Claude sessions have Rounds; ones already open pick it up when you start them again.");
}

async function uninstall() {
  const { DATA, CLAUDE } = await import("../server/config.mjs");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q) => yes || /^y/i.test((await rl.question(`${q} [y/N] `)).trim());
  if (!(await ask("Take Rounds out of Claude Code (the MCP server, the skill, the hooks)?"))) { rl.close(); return; }
  rl.close();
  const trial = !!process.env.ROUNDS_CLAUDE_HOME;
  if (!trial) for (const name of ["rounds", "workbench"]) if (claudeCli(["mcp", "remove", "--scope", "user", name])) say(`  Removed the ${name} MCP server.`);
  for (const name of ["rounds", "workbench"]) {
    const skill = path.join(CLAUDE, "skills", name, "SKILL.md");
    if (fs.existsSync(skill) && new RegExp(`^name: ${name}$`, "m").test(fs.readFileSync(skill, "utf8"))) { fs.rmSync(path.dirname(skill), { recursive: true, force: true }); say(`  Removed the ${name} skill.`); }
  }
  const file = path.join(CLAUDE, "settings.json");
  try {
    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    const n = ourHooks(settings);
    if (!Object.keys(settings.hooks || {}).length) delete settings.hooks;
    if (n) { fs.writeFileSync(file, JSON.stringify(settings, null, 2)); say(`  Removed ${n} hook${n === 1 ? "" : "s"} from ${file}.`); }
  } catch {}
  let repo = "";
  try { repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  const hook = repo && path.join(repo, ".git", "hooks", "pre-push");
  if (hook && fs.existsSync(hook) && /^# (rounds|workbench):/m.test(fs.readFileSync(hook, "utf8"))) { fs.rmSync(hook); say(`  Removed this repo's pre-push hook.`); }
  fs.rmSync(path.join(DATA, "app"), { recursive: true, force: true });
  say(`Done. Your canvas (screens, notes, history) is still in ${DATA}; delete that folder if you want it gone too.`);
}

if (!cmd || cmd === "start") await start();
else if (cmd === "init") await init();
else if (cmd === "update") await update();
else if (cmd === "path") say(ROOT);
else if (cmd === "check") { const { checkNow } = await import("../server/updates.mjs"); await checkNow(); }
else if (cmd === "uninstall") await uninstall();
else if (cmd === "index") { const { buildIndex } = await import("../server/indexer.mjs"); await buildIndex({ log: say }); }
else if (cmd === "mcp") await import("../server/mcp.mjs");
else if (cmd === "hook") {
  const name = rest[0];
  const file = { notes: "notes", tool: "tool", push: "tool", "git-push": "git-push" }[name];
  if (!file) { say("rounds hook <notes|tool|git-push>"); process.exit(1); }
  await import(`../hooks/${file}.mjs`);
} else {
  say("rounds [init|update|uninstall|index|--demo]");
  process.exit(1);
}
