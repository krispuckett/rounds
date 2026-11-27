// Codex sessions, read from the Codex app's own databases in ~/.codex: threads (state_5.sqlite)
// and everything that happened in them (thread_history_1.sqlite). From them come what the
// indexer takes from Claude transcripts: the screens a session showed (markdown images in its
// replies) and the images it generated, the files it changed, the days it was prompted, and its
// name. A subagent's work belongs to the thread that started it; guardian reviews are left out.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { HOME, CODEX, CODEX_HOMES } from "./config.mjs";

export const PREFIX = "codex-";

const IMAGE = /!\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)/g;
const SHOT = /\.(png|jpe?g|webp)$/i;
function imagePath(value, cwd) {
  if (typeof value !== "string") return null;
  let f = value.replace(/^<|>$/g, "");
  if (/^file:/i.test(f)) { try { f = fileURLToPath(f); } catch { return null; } }
  else { try { f = decodeURIComponent(f); } catch {} }
  if ((!path.isAbsolute(f) && /^[a-z]+:/i.test(f)) || !SHOT.test(f)) return null;
  return f.startsWith("~") ? path.join(HOME, f.slice(1)) : path.isAbsolute(f) ? f : path.join(cwd || HOME, f);
}

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
async function readDatabases(log, root) {
  const state = await open(path.join(root, "state_5.sqlite"));
  const history = await open(path.join(root, "thread_history_1.sqlite"));
  if (!state || !history) { state?.close(); history?.close(); if(fs.existsSync(path.join(root,"state_5.sqlite")))log("Codex database or SQLite runtime unavailable."); return []; }
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

    const query = `
      select thread_id, rollout_ordinal, rowid as row_key, turn_id, item_type, coalesce(completed_at_ms, created_at_ms) as at,
        case when item_type = 'imageGeneration' then json_extract(item_json, '$.savedPath')
             when item_type = 'userMessage' then null else item_json end as body
      from thread_items
      where (item_type in ('userMessage', 'fileChange', 'imageGeneration')
         or (item_type = 'agentMessage' and item_json like '%![%'))`;
    const order=' order by thread_id, rollout_ordinal, rowid';
    const statement = history.prepare(query+order);
    // Node 22.12 exposes SQLite with the experimental flag but not iterate().
    // Use bounded pages on that older implementation.
    function* paged() { const first=history.prepare(query+order+" limit 500");const next=history.prepare(query+" and (thread_id,rollout_ordinal,rowid)>(?,?,?)"+order+" limit 500");let rows=first.all();for(;;){yield* rows;if(rows.length<500)break;const last=rows.at(-1);rows=next.all(last.thread_id,last.rollout_ordinal,last.row_key);} }
    const items = typeof statement.iterate==="function" ? statement.iterate() : paged();
    const generated = new Map(); // session id + turn -> the images that turn generated
    for (const it of items) {
      const s = whose(it.thread_id);
      const at = Number(it.at || 0);
      if (!s || !at) continue;
      if (it.item_type === "userMessage") {
        if (s.id === it.thread_id) s.days[dayOf(at)] = (s.days[dayOf(at)] || 0) + 1;
      } else if (it.item_type === "imageGeneration") {
        const image = imagePath(it.body, cwdOf.get(it.thread_id) || s.cwd);
        if (!image) continue;
        const k = `${s.id}\n${it.turn_id}`;
        const g = generated.get(k) || { s, send: { id: `gen:${it.turn_id}`, at, caption: "Generated images", shots: [] } };
        g.send.at = Math.max(g.send.at, at);
        g.send.shots.push(image);
        generated.set(k, g);
      } else {
        let item;
        try { item = JSON.parse(it.body); } catch { continue; }
        if (it.item_type === "agentMessage") {
          const text = item.text || "";
          const shots = [];
          for (const m of text.matchAll(IMAGE)) {
            const f = imagePath(m[1], cwdOf.get(it.thread_id) || s.cwd);
            if (f && !shots.includes(f)) shots.push(f);
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

const lastGood = new Map();
function readOne(root, log) {
  return new Promise((resolve) => {
    let w;
    try { w = new Worker(new URL(import.meta.url), { workerData: { codexWorker: true, root } }); } catch (e) { log(`Codex sessions skipped: ${e.message}`); return resolve([]); }
    let settled=false;
    const finish=(value,good=false)=>{if(settled)return;settled=true;clearTimeout(timer);if(good)lastGood.set(root,value);resolve(good?value:lastGood.get(root)||[]);};
    const timer=setTimeout(()=>{log("Codex index timed out; skipped for this pass.");w.terminate().catch(()=>{});finish([]);},120000);
    w.on("message", (m) => { if (m.log) log(m.log); else finish(m.sessions,Array.isArray(m.sessions)); });
    w.on("error", (e) => { log(`Codex sessions skipped: ${e.message}`); finish([]); });
    w.on("exit", () => finish([]));
  });
}
export async function readCodex({log=()=>{},roots=CODEX_HOMES}={}) {const sessions=new Map();for(const root of roots){for(const s of await readOne(root,log))if(!sessions.has(s.id))sessions.set(s.id,{...s,sourceRoot:root});}return [...sessions.values()];}
if (!isMainThread && workerData?.codexWorker) {
  const sessions = await readDatabases((log) => parentPort.postMessage({ log }),workerData.root||CODEX);
  parentPort.postMessage({ sessions });
}
