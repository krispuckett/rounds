// Read-only provider and profile discovery. A profile is not necessarily a unique
// authenticated account. Never inspect credential file contents during discovery.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const PROVIDERS = Object.freeze([
  { id: "claude", name: "Claude", company: "Anthropic", cli: ["claude"], aliases: ["Claude Desktop", "Claude Code", "Cowork"], branding: "https://www.anthropic.com/", sessionAdapter: "claude" },
  { id: "codex", name: "ChatGPT / Codex", company: "OpenAI", cli: ["codex"], aliases: ["Codex Desktop", "Codex CLI"], branding: "https://openai.com/brand/", sessionAdapter: null },
  { id: "antigravity", name: "Google Antigravity", company: "Google", cli: ["antigravity", "agy", "gemini"], aliases: ["Antigravity IDE", "Gemini CLI"], branding: "https://www.antigravity.google/press", sessionAdapter: null },
  { id: "grok", name: "Grok", company: "xAI", cli: ["grok"], aliases: ["Grok CLI"], branding: "https://x.ai/", sessionAdapter: null },
  { id: "devin", name: "Devin", company: "Cognition", cli: ["devin", "windsurf"], aliases: ["Devin Desktop", "Windsurf"], branding: "https://devin.ai/", sessionAdapter: null },
  { id: "cursor", name: "Cursor", company: "Anysphere", cli: ["cursor", "cursor-agent"], aliases: ["Cursor CLI"], branding: "https://cursor.com/", sessionAdapter: null },
  { id: "copilot", name: "GitHub Copilot", company: "GitHub", cli: ["copilot"], aliases: ["Copilot CLI"], branding: "https://github.com/features/copilot", sessionAdapter: null },
  { id: "kiro", name: "Kiro", company: "AWS", cli: ["kiro", "kiro-cli"], aliases: ["Kiro CLI"], branding: "https://kiro.dev/", sessionAdapter: null },
]);

function directory(f) { try { return fs.statSync(f).isDirectory(); } catch { return false; } }
function file(f) { try { return fs.statSync(f).isFile(); } catch { return false; } }
function children(f) {
  try { return fs.readdirSync(f, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(f, e.name)); } catch { return []; }
}
function realRoot(f, platform) {
  let root;
  try { root = fs.realpathSync(f); } catch { root = path.resolve(f); }
  return platform === "win32" ? root.toLowerCase() : root;
}
export function profileId(provider, root, platform = process.platform) {
  return provider + ":" + crypto.createHash("sha256").update(realRoot(root, platform)).digest("hex").slice(0, 24);
}
function cliPath(name, env, platform) {
  const windows = platform === "win32";
  const names = windows ? [name + ".exe", name + ".cmd", name + ".bat", name] : [name];
  for (const dir of (env.PATH || env.Path || "").split(windows ? ";" : path.delimiter)) {
    if (!dir) continue;
    for (const n of names) { const f = path.join(dir.replace(/^"|"$/g, ""), n); if (file(f)) return f; }
  }
  return null;
}
function candidates(provider, home, env, customRoots) {
  const explicit = Array.isArray(customRoots?.[provider]) ? customRoots[provider] : [];
  if (provider === "claude") return [env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"), ...children(path.join(home, ".claude-profiles")), ...explicit];
  if (provider === "codex") return [env.CODEX_HOME, path.join(home, ".codex"), ...children(path.join(home, ".codex-profiles")), ...explicit];
  return explicit;
}
function hasProfileEvidence(provider, dir) {
  if (provider === "claude") return file(path.join(dir, ".credentials.json")) || directory(path.join(dir, "projects")) || file(path.join(dir, "settings.json"));
  if (provider === "codex") return file(path.join(dir, "auth.json")) || directory(path.join(dir, "sessions")) || file(path.join(dir, "config.toml"));
  return false;
}
export function discoverProviders({ home = os.homedir(), env = process.env, platform = process.platform, customRoots = {}, desktopNames = [], preferences = { providers: {}, profiles: {} } } = {}) {
  return PROVIDERS.map(provider => {
    const cli = [...new Set(provider.cli.map(n => cliPath(n, env, platform)).filter(Boolean))];
    const profiles = new Map();
    for (const candidate of candidates(provider.id, home, env, customRoots)) {
      if (typeof candidate !== "string" || !directory(candidate) || !hasProfileEvidence(provider.id, candidate)) continue;
      const id = profileId(provider.id, candidate, platform);
      if (profiles.has(id)) continue;
      const p = preferences.profiles?.[id] || {};
      profiles.set(id, { id, provider: provider.id, root: path.resolve(candidate), defaultLabel: path.basename(candidate), label: p.label || path.basename(candidate), enabled: p.enabled === true, identityStatus: "unverified", usageStatus: "unavailable" });
    }
    const names = [provider.name, ...provider.aliases, ...({claude:["Claude"],codex:["Codex"],antigravity:["Antigravity"],devin:["Devin","Windsurf"],copilot:["GitHub Copilot"]}[provider.id]||[])].map(n=>n.toLowerCase());
    const desktopDetected = desktopNames.some(n=>typeof n==="string"&&names.includes(n.toLowerCase().trim()));
    return { ...provider, cliPaths: cli, desktopDetected, detected: desktopDetected || !!cli.length || !!profiles.size, enabled: preferences.providers?.[provider.id] === true, profiles: [...profiles.values()] };
  });
}
// Store stable user choices separately from discovery, preserving temporarily absent profiles.
export function loadPreferences(filename) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (parsed.version !== 1 || !parsed.providers || !parsed.profiles) throw new Error("Unsupported account preferences format");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, providers: {}, profiles: {} };
    throw error; // never overwrite a malformed file
  }
}
export function savePreferences(filename, patch) {
  const old = loadPreferences(filename);
  const next = { version: 1, providers: { ...old.providers }, profiles: { ...old.profiles } };
  const allowed = new Set(PROVIDERS.map(p => p.id));
  for (const [id, enabled] of Object.entries(patch.providers || {})) {
    if (!allowed.has(id) || typeof enabled !== "boolean") throw new Error("Invalid provider preference");
    next.providers[id] = enabled;
  }
  for (const [id, value] of Object.entries(patch.profiles || {})) {
    if (!/^[a-z]+:[a-f0-9]{24}$/.test(id) || !allowed.has(id.split(":")[0]) || typeof value?.label !== "string" || !value.label.trim() || value.label.length > 80 || typeof value.enabled !== "boolean") throw new Error("Invalid profile preference");
    next.profiles[id] = { label: value.label.trim(), enabled: value.enabled };
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = filename + "." + crypto.randomUUID() + ".tmp";
  try { fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { flag: "wx" }); fs.renameSync(tmp, filename); }
  finally { fs.rmSync(tmp, { force: true }); }
  return next;
}
