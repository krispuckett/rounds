// What's waiting on you: every desktop session that finished a turn lately, and whether it stopped
// to ask you something. Each one carries what it said at the end of its turn: its short summary,
// the question it left you and the answers it offered (the Code tab's wrap-up), or, for a session
// that asked in its closing message instead, the questions found there.
//
// Read on request from the desktop app's session records and the end of each transcript; a
// Claude Code session outside the desktop app has no record here, so it never shows as waiting.
import fs from "node:fs";
import path from "node:path";
import { CLAUDE_HOMES, DESKTOP_SESSIONS, projects } from "./config.mjs";

const TAIL = 4 << 20; // a turn's end is in the last few megabytes of its transcript

function files(dir, test, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}

function tail(file) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    const n = Math.min(size, TAIL);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}

const plain = (s) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim();

// The questions in a closing message: list items and paragraphs that end in a question mark.
function questionsIn(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = plain(raw);
    if (line.endsWith("?") && line.length > 12) out.push(line);
  }
  return out;
}

// How a session's last turn ended: its wrap-up (summary, question, answers) and closing message.
function lastTurn(file) {
  let wrap = null, text = "";
  for (const line of tail(file).split("\n")) {
    if (!line.includes('"assistant"')) continue;
    let x;
    try { x = JSON.parse(line); } catch { continue; }
    if (x.type !== "assistant") continue;
    for (const c of x.message?.content || []) {
      if (c.type === "tool_use" && String(c.name).endsWith("wrap_up")) { wrap = c.input || {}; text = ""; }
      else if (c.type === "text" && c.text?.trim()) text = c.text;
    }
  }
  return { wrap, text };
}

export function waiting({ since = Date.now() - 14 * 864e5 } = {}) {
  const P = projects();
  const transcripts = new Map();
  for (const f of new Set(CLAUDE_HOMES.flatMap(home=>files(path.join(home,"projects"),(n)=>n.endsWith(".jsonl"))))) {
    if (f.includes(`${path.sep}subagents${path.sep}`)) continue;
    transcripts.set(path.basename(f, ".jsonl"), f);
  }
  const stops = [];
  for (const file of files(DESKTOP_SESSIONS, (n) => n.startsWith("local_") && n.endsWith(".json"))) {
    let s;
    try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const at = Number(s.lastTurnEdgeAt || 0);
    if (!s.sessionId || !s.title || s.isArchived || at < since) continue;
    if (P.isPrivate(s.title, s.cwd)) continue;
    const t = transcripts.get(s.lastAssistantCliSessionId) || transcripts.get(s.cliSessionId);
    const { wrap, text } = t ? lastTurn(t) : { wrap: null, text: "" };
    let ask = wrap?.ask || "";
    let more = 0;
    if (!ask && !wrap?.recap) {
      const qs = questionsIn(text);
      if (qs.length && qs[0].length <= 110) { ask = qs[0]; more = qs.length - 1; }
      else more = qs.length;
    }
    const answers = (wrap?.actions || []).map((a) => a.label).filter(Boolean).slice(0, 2);
    // what it said last, when the turn left no summary: the closing message's first paragraph
    const said = plain(text.split(/\n\s*\n/)[0] || "").slice(0, 260);
    let recap = wrap?.recap || s.turnWrapUp?.description || s.postTurnSummary?.status_detail || said;
    // a status line that is itself one of the questions says nothing the question doesn't
    if ((ask || more) && recap.trim().endsWith("?")) recap = said && !said.endsWith("?") ? said : "";
    const needs = !!s.turnWrapUp?.needsUser;
    stops.push({
      id: s.sessionId,
      title: s.title,
      project: P.of([s.title], s.cwd),
      at,
      recap,
      ask,
      more,
      answers: ask ? answers : [],
      needs,
      waiting: needs || !!ask || more > 0,
      unseen: Number(s.lastFocusedAt || 0) < at,
    });
  }
  // waiting on you first, then the rest, newest first in each
  stops.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.at - a.at);
  return { since, projects: Object.fromEntries(P.names), stops };
}
