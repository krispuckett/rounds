import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, session, ipcMain } from "electron";
import { discoverProviders, loadPreferences, savePreferences } from "./providers.mjs";
import { identify, usage } from "./account-info.mjs";
import { selectedSources, sourceKey, prepareManagedSources } from "./managed-sources.mjs";
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
let win, settingsWindow, tray, server, watcher, temporary, origin, quitting = false, lastRunning = new Set(), busy = false;
const preferencesFile = () => path.join(app.getPath("userData"), "accounts.json");
const settingsFile = () => path.join(app.getPath("userData"), "desktop-settings.json");
function readSettings() {
  try { return { login: false, watchAgents: false, tray: true, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; }
  catch { return { login: false, watchAgents: false, tray: true }; }
}
let settings, activeSourceKey;
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
async function scanProviders({includeDesktop=true}={}) {
  if (demo) return discoverProviders({home:temporary||os.tmpdir(),env:{},preferences:loadPreferences(preferencesFile())});
  let desktopNames=[];
  if(includeDesktop&&process.platform==="win32"){
    try { const {stdout}=await promisify(execFile)("powershell.exe",["-NoProfile","-NonInteractive","-Command","Get-StartApps | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"],{windowsHide:true,timeout:6000,maxBuffer:1024*1024}); const x=JSON.parse(stdout);desktopNames=Array.isArray(x)?x:[x]; }catch{console.warn("[rounds] Windows Start menu discovery was unavailable.");}
  }
  return discoverProviders({preferences:loadPreferences(preferencesFile()),desktopNames});
}
const generalSettings=()=>({...settings,canLogin:app.isPackaged&&!demo});
function openSettings(){
  if(settingsWindow&&!settingsWindow.isDestroyed()){settingsWindow.show();settingsWindow.focus();return;}
  settingsWindow=new BrowserWindow({width:810,height:780,minWidth:520,minHeight:450,title:"Rounds Settings",icon,parent:win,autoHideMenuBar:true,webPreferences:{preload:path.join(here,"settings-preload.cjs"),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  settingsWindow.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  settingsWindow.webContents.on("will-navigate",e=>e.preventDefault());
  settingsWindow.webContents.on("will-attach-webview",e=>e.preventDefault());
  settingsWindow.on("closed",()=>{settingsWindow=null;});
  settingsWindow.loadFile(path.join(here,"settings.html"));
}
function installSettingsIPC(){
  const trusted=(event)=>{if(!settingsWindow||event.sender!==settingsWindow.webContents||event.senderFrame!==settingsWindow.webContents.mainFrame||event.senderFrame.url!==pathToFileURL(path.join(here,"settings.html")).href)throw new Error("Settings request rejected.");};
  const profile=async(id)=>{for(const p of await scanProviders({includeDesktop:false})){const a=p.profiles.find(x=>x.id===id);if(a)return {a,p};}throw new Error("Profile is no longer available.");};
  ipcMain.handle("settings:scan",async event=>{trusted(event);return {providers:await scanProviders(),desktop:generalSettings()};});
  ipcMain.handle("settings:save",async(event,patch)=>{trusted(event);const prefs=savePreferences(preferencesFile(),patch);const current=sourceKey(selectedSources(await scanProviders({includeDesktop:false})));return {saved:true,restartRequired:!demo&&current!==activeSourceKey};});
  ipcMain.handle("settings:restart",event=>{trusted(event);if(demo)return false;setTimeout(()=>{app.relaunch({args:process.argv.slice(1).filter(a=>!["--background","--settings"].includes(a))});quitting=true;app.quit();},150);return true;});
  ipcMain.handle("settings:identity",async(event,id)=>{trusted(event);if(demo)return {error:"Unavailable in demo mode."};const {a,p}=await profile(id);return identify(a,p.cliPaths);});
  ipcMain.handle("settings:usage",async(event,id)=>{trusted(event);if(demo)return {error:"Unavailable in demo mode."};const {a,p}=await profile(id);return usage(a,p.cliPaths);});
  ipcMain.handle("settings:general",(event,patch)=>{trusted(event);for(const [key,value] of Object.entries(patch||{})){if(typeof value!=="boolean")throw new Error("Invalid preference.");if(key==="login"){if(!app.isPackaged||demo)throw new Error("Startup is available in the installed app.");setLogin(value);}else if(key==="watchAgents"){if(process.platform!=="win32"||demo)throw new Error("Desktop detection is unavailable here.");saveSettings({watchAgents:value});}else if(key==="tray")saveSettings({tray:value});else throw new Error("Invalid preference.");}refreshMenus();return generalSettings();});
}
function refreshMenus() {
  const items = [
    { label: "Open Rounds", click: show },
    { label: "Settings…", accelerator: "CmdOrCtrl+,", click: openSettings },
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
  if(app.isPackaged&&!demo)settings.login=app.getLoginItemSettings({path:process.execPath,args:["--background"]}).openAtLogin;
  installSettingsIPC();
  if (demo) {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-desktop-demo-"));
    const data = path.join(temporary, "data"), empty = path.join(temporary, "empty");
    fs.cpSync(path.join(root, "demo"), data, { recursive: true });
    fs.mkdirSync(path.join(empty, "projects"), { recursive: true });
    if(smoke){fs.mkdirSync(path.join(temporary,".claude","projects"),{recursive:true});fs.mkdirSync(path.join(temporary,".codex","sessions"),{recursive:true});}
    const f = path.join(data, "config.json");
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), updates: false, relay: false }));
    Object.assign(process.env, { ROUNDS_HOME: data, ROUNDS_CLAUDE_HOME: empty, ROUNDS_CODEX_HOME: empty, ROUNDS_DESKTOP_SESSIONS: empty, ROUNDS_CLAUDE_HOMES: "[]", ROUNDS_CODEX_HOMES: "[]", ROUNDS_BROWSER: "none" });
    // No demo topic processing can call the real Claude executable.
    for (const k of Object.keys(process.env)) if (/^path$/i.test(k)) delete process.env[k];
  }
  if(!demo){const sources=selectedSources(await scanProviders({includeDesktop:false}));activeSourceKey=sourceKey(sources);prepareManagedSources(app.getPath("userData"),sources);}
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
    const fixture=path.join(temporary,"sqlite-fixture");fs.mkdirSync(fixture,{recursive:true});
    const {DatabaseSync}=await import("node:sqlite");
    const state=new DatabaseSync(path.join(fixture,"state_5.sqlite")),history=new DatabaseSync(path.join(fixture,"thread_history_1.sqlite"));
    state.exec("create table threads(id,name,title,cwd,archived,created_at_ms,updated_at_ms,source,thread_source)");
    state.prepare("insert into threads values(?,?,?,?,?,?,?,?,?)").run("fixture","Fixture","Fixture",fixture,0,1700000000000,1700000001000,"cli","user");
    history.exec("create table thread_items(thread_id,turn_id,item_type,completed_at_ms,created_at_ms,item_json,rollout_ordinal)");
    history.prepare("insert into thread_items values(?,?,?,?,?,?,?)").run("fixture","t1","agentMessage",1700000001000,1700000000000,JSON.stringify({id:"i1",text:"![fixture](screen.png)"}),1);
    state.close();history.close();
    const {readCodex}=await import(pathToFileURL(path.join(root,"server","codex.mjs")).href);
    const fixtureRead=await readCodex({roots:[fixture],log:console.log});if(fixtureRead.length!==1||fixtureRead[0].sends[0].shots[0]!==path.join(fixture,"screen.png"))throw new Error("Packaged SQLite reader smoke failed");
    console.log("PASS: Electron SQLite worker and Codex fixture");
    openSettings();
    await new Promise((resolve,reject)=>{if(!settingsWindow.webContents.isLoadingMainFrame())return resolve();settingsWindow.webContents.once("did-finish-load",resolve);settingsWindow.webContents.once("did-fail-load",()=>reject(new Error("Settings did not load")));});
    const check=await settingsWindow.webContents.executeJavaScript(`(async()=>{const data=await window.roundsSettings.scan();const p=data.providers.find(x=>x.id==="claude");if(!p||p.profiles.length!==1||data.providers.length!==8)throw Error("Unexpected discovery fixture");await window.roundsSettings.save({providers:{claude:true},profiles:{[p.profiles[0].id]:{label:"Fixture account",enabled:true}}});const again=await window.roundsSettings.scan();if(again.providers.find(x=>x.id==="claude").profiles[0].label!=="Fixture account")throw Error("Preference did not persist");for(let i=0;i<30;i++){if(document.querySelectorAll(".brand img").length===8&&[...document.querySelectorAll(".brand img")].every(x=>x.complete&&x.naturalWidth>0))return "8 bundled provider logos and settings persistence";await new Promise(r=>setTimeout(r,100));}throw Error("Provider logos did not load");})()`);
    console.log("PASS: "+check);
    quitting = true; app.quit(); return;
  }
  if (!background) show();
  if(process.argv.includes("--settings"))openSettings();
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
