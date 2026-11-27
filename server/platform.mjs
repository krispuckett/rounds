// Platform-specific executable and session-directory discovery. Never invoke a shell
// with user or agent supplied arguments; on Windows prefer native executables.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export function which(name, { platform = process.platform, env = process.env } = {}) {
  const win = platform === "win32", p = win ? path.win32 : path;
  const names = win && !p.extname(name) ? [name + ".exe", name + ".com"] : [name];
  for (const dir of (env.PATH || env.Path || "").split(win ? ";" : path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const f = p.join(dir.replace(/^"|"$/g, ""), n);
      try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch {}
    }
  }
  return null;
}
export function windowsBrowser({ env = process.env, runnable = f => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } }, find = which } = {}) {
  const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
  const browsers = [
    ["Google", "Chrome", "Application", "chrome.exe"],
    ["Microsoft", "Edge", "Application", "msedge.exe"],
    ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
    ["Chromium", "Application", "chrome.exe"],
  ];
  for (const parts of browsers) for (const root of roots) {
    const f = path.win32.join(root, ...parts); if (runnable(f)) return f;
  }
  for (const n of ["chrome.exe", "msedge.exe", "brave.exe", "chromium.exe"]) { const f = find(n); if (f) return f; }
  return null;
}
export function desktopSessionRoot({ platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  if (platform !== "win32") return path.join(home, "Library/Application Support/Claude/claude-code-sessions");
  const p = path.win32;
  const roaming = env.APPDATA || p.join(home, "AppData", "Roaming");
  const local = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
  const candidates = [p.join(roaming, "Claude", "claude-code-sessions"), p.join(local, "Claude", "claude-code-sessions")];
  // Store installations may redirect the app's roaming data into a package directory.
  try {
    for (const name of fs.readdirSync(p.join(local, "Packages")).filter(n => /^Claude_/i.test(n))) {
      candidates.push(p.join(local, "Packages", name, "LocalCache", "Roaming", "Claude", "claude-code-sessions"));
    }
  } catch {}
  return candidates.find(exists) || candidates[0];
}
