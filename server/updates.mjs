// New versions. Once a day the canvas asks GitHub for the latest release of Rounds; when it's
// newer than this copy, the dock offers it. Updating fetches that release through npx, then this
// server ends and the start-up process (bin/rounds.mjs) starts the new one on the same port; the
// new one brings the copy the hooks and the MCP server run (~/.rounds/app) up to itself.
//
// Sessions hear about it too: the notes hook tells the person once per release, in whichever
// session they type in first (updateNotice). What the last check found is kept in updates.json in
// the data folder, so the hook never waits on the network; when that's a day old, the hook asks
// again in the background.
//
// Only a copy run through npx updates this way; a checkout updates with git. "updates": false in
// config.json turns the check off. ROUNDS_RELEASES_URL (a URL or a JSON file) and ROUNDS_SOURCE
// (what npx fetches) stand in for GitHub when testing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, DATA } from "./config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const FROM_NPX = /[\\/]_npx[\\/]/.test(ROOT);
// a copy that updates through npx: npx's own, or the one init keeps in the data folder (the hooks')
const MANAGED = FROM_NPX || ROOT === path.resolve(DATA, "app");
const CACHE = path.join(DATA, "updates.json");
const RELEASES = process.env.ROUNDS_RELEASES_URL || "https://api.github.com/repos/krispuckett/rounds/releases/latest";
const SOURCE = process.env.ROUNDS_SOURCE || "github:krispuckett/rounds";
// bin/rounds.mjs runs the server as its child, with a channel back, when it can start it again
const restartable = () => process.env.ROUNDS_CHILD === "1" && typeof process.send === "function";

const parts = (v) => String(v).replace(/^v/, "").split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
const newer = (a, b) => {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

let latest = null; // { version, tag, url, notes }
let checkedAt = 0;
let updating = null;

const readCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { return {}; } };
const writeCache = (c) => {
  try { const tmp = `${CACHE}.${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(c)); fs.renameSync(tmp, CACHE); } catch {}
};

// The latest release, null when there's none, undefined when GitHub couldn't be asked.
async function fetchRelease() {
  try {
    const r = /^(\/|file:)/.test(RELEASES)
      ? JSON.parse(fs.readFileSync(RELEASES.startsWith("file:") ? fileURLToPath(RELEASES) : RELEASES, "utf8"))
      : await fetch(RELEASES, { headers: { accept: "application/vnd.github+json", "user-agent": "rounds" }, signal: AbortSignal.timeout(10e3) }).then((res) => (res.ok ? res.json() : null));
    const tag = r?.tag_name;
    if (!tag || r.draft || r.prerelease) return null;
    // Pin to the tag's commit: a tag can be moved after this check, but a commit sha can't, so
    // fetching that sha later guarantees npx brings exactly what was seen here.
    const repo = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\//.exec(RELEASES)?.[1];
    const sha = repo && await fetch(`https://api.github.com/repos/${repo}/git/refs/tags/${tag}`, { headers: { accept: "application/vnd.github+json", "user-agent": "rounds" }, signal: AbortSignal.timeout(10e3) })
      .then((res) => (res.ok ? res.json() : null)).then((ref) => ref?.object?.sha).catch(() => null);
    return { version: tag.replace(/^v/, ""), tag, sha: sha || tag, url: r.html_url || "", notes: r.body || "" };
  } catch { return undefined; } // offline, or GitHub busy: ask again later
}

/** Asks once and keeps the answer for the hook. `rounds check` runs this in the background. */
export async function checkNow() {
  const at = Date.now(), r = await fetchRelease();
  if (r === undefined) return;
  const c = readCache(), bad = process.env.ROUNDS_BAD_VERSION;
  writeCache({
    ...c,
    checkedAt: at,
    release: r && { version: r.version, tag: r.tag, sha: r.sha },
    // a release that didn't start here (bin/rounds.mjs went back from it) waits for the next one
    bad: bad && !(c.bad || []).includes(bad) ? [...(c.bad || []), bad] : c.bad || [],
    // a canvas that can update itself says so, for the hook's wording
    canvas: restartable() ? { pid: process.pid } : c.canvas,
  });
  return r;
}

async function check() {
  checkedAt = Date.now();
  const r = await checkNow();
  if (r === undefined) return;
  latest = r && newer(r.tag, VERSION) && !(readCache().bad || []).includes(r.version) ? r : null;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/** The line the notes hook shows the person, once per release; null almost always. */
export function updateNotice() {
  if (!MANAGED || loadConfig().updates === false) return null;
  const c = readCache();
  if (!c.checkedAt || Date.now() - c.checkedAt > 24 * 3600e3) {
    // asked in the background, so this prompt never waits; a later one tells
    writeCache({ ...c, checkedAt: Date.now() });
    try { spawn(process.execPath, [path.join(ROOT, "bin", "rounds.mjs"), "check"], { detached: true, stdio: "ignore" }).unref(); } catch {}
  }
  const r = c.release;
  if (!r || !newer(r.tag, VERSION) || (c.bad || []).includes(r.version)) return null;
  // whichever session makes this file first tells; every other one stays quiet
  try { fs.closeSync(fs.openSync(path.join(DATA, `.told-${r.version}`), "wx")); } catch { return null; }
  return c.canvas?.pid && alive(c.canvas.pid)
    ? `Rounds ${r.version} is out. Press Update at the bottom of the canvas.`
    : `Rounds ${r.version} is out. Open the canvas with npx github:krispuckett/rounds to get it.`;
}

/** Starts the daily check, when this copy can use what it finds (or a test asks for it). */
export function watchReleases() {
  if (loadConfig().updates === false) return;
  if (!FROM_NPX && !process.env.ROUNDS_RELEASES_URL) return;
  setTimeout(check, 5e3).unref();
  // hourly, asking only once a day has passed: a laptop asleep for days asks when it wakes
  setInterval(() => { if (Date.now() - checkedAt > 24 * 3600e3) check(); }, 3600e3).unref();
}

// a new id each time a server starts, so the page can tell a new one from the old one back
const BOOT = `${process.pid}-${Date.now()}`;
export const versionState = () => ({ current: VERSION, boot: BOOT, latest, updating: !!updating });

/** Fetches the latest release through npx and, once it's there, hands over to it. */
export function runUpdate() {
  if (!latest) return Promise.resolve({ error: "Rounds is up to date." });
  if (!restartable()) return Promise.resolve({ error: FROM_NPX ? "Open Rounds again with npx github:krispuckett/rounds to update." : "This copy runs from its folder; pull it to update." });
  const want = latest;
  updating ??= new Promise((resolve) => {
    // `rounds path` in the new copy says where npx put it
    const env = { ...process.env };
    delete env.ROUNDS_CHILD;
    console.log(`[rounds] Updating to ${want.version}…`);
    execFile("npx", ["-y", `${SOURCE}#${want.sha || want.tag}`, "path"], { cwd: os.tmpdir(), env, timeout: 5 * 60e3, maxBuffer: 4 << 20 }, (err, out, errOut) => {
      const root = String(out || "").trim().split("\n").pop()?.trim() || "";
      let version = "";
      try { version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version; } catch {}
      if (err || version !== want.version || !fs.existsSync(path.join(root, "bin", "rounds.mjs"))) {
        const why = String(errOut || "").trim().split("\n").filter(Boolean).pop() || (version ? `npx brought ${version}` : `npx couldn't fetch ${SOURCE}#${want.tag}`);
        console.log(`[rounds] Couldn't update to ${want.version}: ${why}`);
        updating = null;
        return resolve({ error: why });
      }
      resolve({ ok: true, version, root });
    });
  });
  return updating;
}

/** After the answer has gone out: tell the start-up process where the new copy is, and end. */
let handing = false;
export function handOver(root) {
  if (handing) return;
  handing = true;
  console.log("[rounds] Starting the new version…");
  process.send({ root }, () => process.exit(75));
}
