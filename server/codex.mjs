// Codex sessions, read from the Codex app's own databases in ~/.codex: threads (state_5.sqlite)
// and everything that happened in them (thread_history_1.sqlite). From them come what the
// indexer takes from Claude transcripts: the screens a session showed (markdown images in its
// replies) and the images it generated, the files it changed, the days it was prompted, and its
// name. A subagent's work belongs to the thread that started it; guardian reviews are left out.
import fs from "node:fs";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { HOME, CODEX } from "./config.mjs";

export const PREFIX = "codex-";

const IMAGE = /!\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)/g;
const SHOT = /\.(png|jpe?g|webp)$/i;

// a reply's words as a caption: no images, links kept as their text, the first paragraph
function captionOf(text) {
  const t = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "").trim();
  const first = t.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return first.length > 180 ? `${first.slice(0, 177).replace(/\s+\S*$/, "")}…` : first;
}

const linesOf = (s) => { const a = s.split("\n"); if (a.length > 1 && a[a.length - 1] === "") a.pop(); return a; };
// a unified diff's hunks, in the shape Claude Code records them
function hunksOf(diff) {
  const out = [];
  let h = null;
  for (const l of linesOf(diff)) {
    const m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { h = { oldStart: Number(m[1]), newStart: Number(m[2]), lines: [] }; out.push(h); continue; }
    if (h && /^[ +\-]/.test(l)) h.lines.push(l);
  }
  return out;
}

const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

async function open(file) {
  if (!fs.existsSync(file)) return null;
  let DatabaseSync;
  // node:sqlite says once that it's experimental; that is no news to the person running Rounds
  const warn = process.emitWarning;
  process.emitWarning = (w, ...a) => (/SQLite/.test(String(w?.message ?? w)) ? undefined : warn.call(process, w, ...a));
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { return null; } // Node before 22.5
  finally { process.emitWarning = warn; }
  try { return new DatabaseSync(file, { readOnly: true }); } catch { return null; }
}

// Every Codex session with what it made, or [] when there's no Codex here. Runs in a worker
// (below): the history runs to gigabytes, and the canvas keeps answering while it's read.
async function readDatabases(log) {
  const state = await open(path.join(CODEX, "state_5.sqlite"));
  const history = await open(path.join(CODEX, "thread_history_1.sqlite"));
  if (!state || !history) { state?.close(); history?.close(); return []; }
  // a Codex whose databases are laid out differently (older, or newer) is skipped, never the canvas
  try {
    const sessions = new Map(); // thread id -> session
    const owner = new Map(); // any thread id -> the session its work belongs to
    const cwdOf = new Map(); // any thread id -> the folder it ran in
    const rows = state.prepare("select id, name, title, cwd, archived, created_at_ms, updated_at_ms, source, thread_source from threads").all();
    for (const r of rows) {
      const src = String(r.source || "");
      if (r.cwd) cwdOf.set(r.id, r.cwd);
      if (/guardian/.test(src) || r.thread_source === "guardian_review") continue;
      const parent = (src.match(/"parent_thread_id":"([^"]+)"/) || [])[1];
      if (parent) { owner.set(r.id, parent); continue; }
      const words = String(r.title || "").split("## My request:").pop().replace(/\s+/g, " ").trim();
      const title = r.name || (words && !/^[</#]/.test(words) ? words.slice(0, 64) : "") || path.basename(r.cwd || "") || "Codex session";
      sessions.set(r.id, { id: r.id, title, cwd: r.cwd || "", archived: !!r.archived, at: Number(r.updated_at_ms || r.created_at_ms || 0), days: {}, sends: [], edits: [] });
      owner.set(r.id, r.id);
    }
    // a subagent of a subagent belongs to the first session up the chain
    const whose = (id) => { let x = id; for (let i = 0; i < 8 && owner.get(x) && owner.get(x) !== x; i++) x = owner.get(x); return sessions.get(x); };

    const items = history.prepare(`
      select thread_id, turn_id, item_type, coalesce(completed_at_ms, created_at_ms) as at,
        case when item_type = 'imageGeneration' then json_extract(item_json, '$.savedPath')
             when item_type = 'userMessage' then null else item_json end as body
      from thread_items
      where item_type in ('userMessage', 'fileChange', 'imageGeneration')
         or (item_type = 'agentMessage' and item_json like '%![%')
      order by thread_id, rollout_ordinal`).all();
    const generated = new Map(); // session id + turn -> the images that turn generated
    for (const it of items) {
      const s = whose(it.thread_id);
      const at = Number(it.at || 0);
      if (!s || !at) continue;
      if (it.item_type === "userMessage") {
        if (s.id === it.thread_id) s.days[dayOf(at)] = (s.days[dayOf(at)] || 0) + 1;
      } else if (it.item_type === "imageGeneration") {
        if (typeof it.body !== "string" || !SHOT.test(it.body)) continue;
        const k = `${s.id}\n${it.turn_id}`;
        const g = generated.get(k) || { s, send: { id: `gen:${it.turn_id}`, at, caption: "Generated images", shots: [] } };
        g.send.at = Math.max(g.send.at, at);
        g.send.shots.push(it.body);
        generated.set(k, g);
      } else {
        let item;
        try { item = JSON.parse(it.body); } catch { continue; }
        if (it.item_type === "agentMessage") {
          const text = item.text || "";
          const shots = [];
          for (const m of text.matchAll(IMAGE)) {
            let f = m[1].replace(/^<|>$/g, "").replace(/^file:\/\//, "");
            try { f = decodeURIComponent(f); } catch {}
            if (/^[a-z]+:/i.test(f) || !SHOT.test(f)) continue;
            f = f.startsWith("~") ? path.join(HOME, f.slice(1)) : path.isAbsolute(f) ? f : path.join(cwdOf.get(it.thread_id) || s.cwd || HOME, f);
            if (!shots.includes(f)) shots.push(f);
          }
          if (shots.length) s.sends.push({ id: item.id || `${it.thread_id}:${at}`, at, caption: captionOf(text), shots });
        } else if (it.item_type === "fileChange") {
          if (item.status && item.status !== "completed") continue; // a patch that failed changed nothing
          for (const c of item.changes || []) {
            if (typeof c?.path !== "string" || typeof c.diff !== "string") continue;
            const id = `${item.id}:${c.path}`;
            const kind = c.kind?.type;
            if (kind === "add") s.edits.push({ id, at, path: c.path, name: "Write", input: { content: c.diff }, result: { type: "create", content: c.diff } });
            else if (kind === "update" && c.diff) s.edits.push({ id, at, path: c.kind.move_path || c.path, name: "Edit", input: {}, result: { structuredPatch: hunksOf(c.diff) } });
            else if (kind === "delete") s.edits.push({ id, at, path: c.path, name: "Edit", input: {}, result: { structuredPatch: [{ oldStart: 1, newStart: 0, lines: linesOf(c.diff).map((l) => `-${l}`) }] } });
          }
        }
      }
    }
    for (const { s, send } of generated.values()) s.sends.push(send);
    const out = [...sessions.values()].filter((s) => s.sends.length || s.edits.length || Object.keys(s.days).length);
    log(`${out.length} Codex sessions`);
    return out;
  } catch (e) {
    log(`Codex sessions skipped: ${e.message}`);
    return [];
  } finally {
    state.close();
    history.close();
  }
}

export function readCodex({ log = () => {} } = {}) {
  return new Promise((resolve) => {
    let w;
    try { w = new Worker(new URL(import.meta.url), { workerData: { codexWorker: true } }); } catch (e) { log(`Codex sessions skipped: ${e.message}`); return resolve([]); }
    w.on("message", (m) => { if (m.log) log(m.log); else resolve(m.sessions); });
    w.on("error", (e) => { log(`Codex sessions skipped: ${e.message}`); resolve([]); });
    w.on("exit", () => resolve([]));
  });
}
if (!isMainThread && workerData?.codexWorker) {
  const sessions = await readDatabases((log) => parentPort.postMessage({ log }));
  parentPort.postMessage({ sessions });
}
