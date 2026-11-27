import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = app.isPackaged ? path.join(process.resourcesPath, "rounds") : path.resolve(here, "..");
const icon = app.isPackaged ? path.join(root, "icon.png") : path.join(root, "public", "apple-touch-icon.png");
const smoke = process.argv.includes("--smoke");
const demo = smoke || process.argv.includes("--demo");
const background = process.argv.includes("--background");
app.setName(demo ? "Rounds Demo" : "Rounds");
if (process.platform === "win32") app.setAppUserModelId(demo ? "com.rounds.desktop.demo" : "com.rounds.desktop");
if (demo) app.setPath("userData", path.join(app.getPath("appData"), smoke ? "Rounds Smoke " + process.pid : "Rounds Demo"));
let win, tray, server, watcher, temporary, origin, quitting = false, lastRunning = new Set(), busy = false;
const settingsFile = () => path.join(app.getPath("userData"), "desktop-settings.json");
function readSettings() {
  try { return { login: false, watchAgents: false, tray: true, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; }
  catch { return { login: false, watchAgents: false, tray: true }; }
}
let settings;
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}
function show() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function setLogin(value) {
  if (!app.isPackaged || demo) return;
  app.setLoginItemSettings({ openAtLogin: value, path: process.execPath, args: ["--background"] });
  saveSettings({ login: app.getLoginItemSettings({ path: process.execPath, args: ["--background"] }).openAtLogin });
}
function refreshMenus() {
  const items = [
    { label: "Open Rounds", click: show },
    { label: "Start at login", type: "checkbox", checked: settings.login, enabled: app.isPackaged && !demo, click: item => { setLogin(item.checked); refreshMenus(); } },
    { label: "Open when Claude or Codex Desktop starts", type: "checkbox", checked: settings.watchAgents, enabled: process.platform === "win32" && !demo, click: item => { saveSettings({ watchAgents: item.checked }); refreshMenus(); } },
    { label: "Keep running in the tray", type: "checkbox", checked: settings.tray, click: item => { saveSettings({ tray: item.checked }); refreshMenus(); } },
    { type: "separator" },
    { label: "Quit Rounds", click: () => { quitting = true; app.quit(); } },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(items));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "Rounds", submenu: items }, { role: "editMenu" }, { role: "viewMenu" }]));
}
// Poll only visible agent application windows; a terminal CLI process is not a desktop launch.
async function checkAgents() {
  if (busy || !settings.watchAgents || process.platform !== "win32" || demo) return;
  busy = true;
  try {
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Process -Name Claude,Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty ProcessName"], { windowsHide: true, timeout: 5000 });
    const running = new Set(stdout.trim().split(/\r?\n/).map(x => x.trim().toLowerCase()).filter(Boolean));
    if ([...running].some(x => !lastRunning.has(x)) && !win?.isVisible()) show();
    lastRunning = running;
  } catch {} finally { busy = false; }
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
async function start() {
  settings = readSettings();
  if (demo) {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-desktop-demo-"));
    const data = path.join(temporary, "data"), empty = path.join(temporary, "empty");
    fs.cpSync(path.join(root, "demo"), data, { recursive: true });
    fs.mkdirSync(path.join(empty, "projects"), { recursive: true });
    const f = path.join(data, "config.json");
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), updates: false, relay: false }));
    Object.assign(process.env, { ROUNDS_HOME: data, ROUNDS_CLAUDE_HOME: empty, ROUNDS_DESKTOP_SESSIONS: empty, ROUNDS_BROWSER: "none" });
    // No demo topic processing can call the real Claude executable.
    for (const k of Object.keys(process.env)) if (/^path$/i.test(k)) delete process.env[k];
  }
  const port = await freePort();
  process.env.ROUNDS_PORT = process.env.WORKBENCH_PORT = String(port);
  origin = "http://127.0.0.1:" + port;
  const { serve } = await import(pathToFileURL(path.join(root, "server", "serve.mjs")).href);
  server = await serve(port);
  // No Node or Electron API access in the canvas, including the generated artifact frames.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({ width: 1440, height: 950, minWidth: 720, minHeight: 480, show: false, icon, title: "Rounds", webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => { if (new URL(target).origin !== origin) event.preventDefault(); });
  win.webContents.on("will-attach-webview", event => event.preventDefault());
  win.on("close", event => { if (!quitting && settings.tray) { event.preventDefault(); win.hide(); } });
  if (!smoke) {
    tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 32, height: 32 }));
    tray.setToolTip("Rounds"); tray.on("double-click", show); refreshMenus();
    watcher = setInterval(checkAgents, 5000);
    if (settings.watchAgents) checkAgents();
  }
  await win.loadURL(origin);
  if (smoke) {
    const result = await fetch(origin + "/api/index").then(r => r.json());
    if (!result.sets?.length) throw new Error("Demo data did not load");
    console.log("PASS: Electron renderer, isolated demo API, " + result.sets.length + " sets");
    quitting = true; app.quit(); return;
  }
  if (!background) show();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", show);
  app.on("activate", show);
  app.on("before-quit", () => { quitting = true; });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => { clearInterval(watcher); tray?.destroy(); server?.close(); server?.closeAllConnections(); if (temporary) try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3 }); } catch {} });
  app.whenReady().then(start).catch(error => { console.error(error); if (!smoke) dialog.showErrorBox("Rounds could not start", error.message); app.exit(1); });
}
