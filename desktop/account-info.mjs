// Only provider-owned CLI interfaces are invoked. Never read auth.json or .credentials.json.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";

const run = promisify(execFile);
export function childEnv(profile, base = process.env, home = os.homedir()) {
  const env = { ...base };
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|CLAUDE_CONFIG_DIR|CODEX_HOME)$/i.test(key)) delete env[key];
  if (profile.provider === "claude" && path.resolve(profile.root).toLowerCase() !== path.resolve(home,".claude").toLowerCase()) env.CLAUDE_CONFIG_DIR = profile.root;
  if (profile.provider === "codex") env.CODEX_HOME = profile.root;
  return env;
}
const exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
export function executable(provider, cliPaths, { platform = process.platform, arch = process.arch } = {}) {
  for (const f of cliPaths || []) {
    if (platform !== "win32" || /\.exe$/i.test(f)) return f;
    if (provider === "codex" && /\.cmd$/i.test(f)) {
      const base = path.dirname(f);
      const pkg = "codex-win32-" + (arch === "arm64" ? "arm64" : "x64");
      const triplet = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
      for (const prefix of [path.join(base,"node_modules","@openai","codex","node_modules","@openai",pkg),path.join(base,"node_modules","@openai",pkg)]) {
        for (const sub of ["bin","codex"]) {
          const candidate = path.join(prefix,"vendor",triplet,sub,"codex.exe");
          if (exists(candidate)) return candidate;
        }
      }
    }
  }
  return null;
}
const safeString = x => typeof x === "string" ? x.slice(0,180) : null;
function quotaWindow(value, minutes, reset) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const label = minutes===300?"5-hour limit":minutes===10080?"Weekly limit":Number.isFinite(minutes)?minutes+"-minute limit":"Usage limit";
  return { label, used: Math.min(100,value), resetsAt: typeof reset==="number" && Number.isFinite(reset) ? reset*1000 : null };
}
export function codexWindows(result) {
  const limits=result?.rateLimits;
  return [limits?.primary,limits?.secondary].filter(Boolean).map(w=>quotaWindow(w.usedPercent,w.windowDurationMins,w.resetsAt)).filter(Boolean);
}
export function claudeWindows(payload) {
  return [["five_hour",300],["seven_day",10080]].map(([k,m])=>quotaWindow(payload?.rate_limits?.[k]?.used_percentage,m,payload?.rate_limits?.[k]?.resets_at)).filter(Boolean);
}
export async function codexRead(profile, cliPaths, method, { spawnImpl=spawn, bin=executable("codex",cliPaths), timeoutMs=15000 }={}) {
  if(!["account/read","account/rateLimits/read"].includes(method))throw new Error("Unsupported account method.");
  if(!bin)throw new Error("Native Codex CLI executable was not found.");
  return new Promise((resolve,reject)=>{
    const child=spawnImpl(bin,["app-server","--listen","stdio://"],{env:childEnv(profile),stdio:["pipe","pipe","ignore"],windowsHide:true});
    const lines=readline.createInterface({input:child.stdout});
    let done=false;
    function finish(error,result){if(done)return;done=true;clearTimeout(timer);lines.close();child.stdin.destroy();child.kill();error?reject(error):resolve(result);}
    const timer=setTimeout(()=>finish(Object.assign(new Error("Codex account request timed out."),{code:"ETIMEDOUT"})),timeoutMs);
    const send=obj=>child.stdin.write(JSON.stringify(obj)+"\n");
    child.on("error",()=>finish(new Error("Could not start Codex CLI.")));
    child.on("exit",()=>finish(new Error("Codex app-server closed before returning data.")));
    child.stdin.on("error",()=>finish(new Error("Codex app-server connection closed.")));
    lines.on("line",line=>{let message;try{message=JSON.parse(line);}catch{return;}
      if(message.id===1){if(message.error)return finish(new Error("Codex app-server initialization failed."));send({method:"initialized",params:{}});send({id:2,method,params:method==="account/read"?{refreshToken:false}:{}});}
      if(message.id===2){if(message.error)return finish(new Error("Codex did not return the requested account information."));finish(null,message.result);}
    });
    send({id:1,method:"initialize",params:{clientInfo:{name:"rounds",title:"Rounds",version:"1.3.0"}}});
  });
}
export async function identify(profile,cliPaths){
  try{
    if(profile.provider==="claude"){
      const bin=executable("claude",cliPaths);
      if(!bin)throw new Error("Native Claude Code executable was not found.");
      const {stdout}=await run(bin,["auth","status","--json"],{env:childEnv(profile),timeout:10000,windowsHide:true,maxBuffer:128*1024});
      const j=JSON.parse(stdout);
      return {label:j.loggedIn?"Signed in ("+(safeString(j.authMethod)||"account")+")":"Not signed in",email:safeString(j.email||j.account?.email),plan:safeString(j.subscriptionType||j.planType),organization:safeString(j.orgName||j.organizationName)};
    }
    if(profile.provider==="codex"){
      const result=await codexRead(profile,cliPaths,"account/read");
      const a=result?.account;
      return {label:a?"Signed in ("+(safeString(a.type)||"account")+")":"Not signed in",email:safeString(a?.email),plan:safeString(a?.planType)};
    }
    return {error:"This provider does not expose a supported identity reader."};
  }catch(e){return {error:(e.code==="ETIMEDOUT"||e.killed)?"Account lookup timed out.":"Account identity is unavailable from the installed CLI."};}
}
export async function usage(profile,cliPaths){
  try{
    if(profile.provider==="codex"){
      const windows=codexWindows(await codexRead(profile,cliPaths,"account/rateLimits/read"));
      return windows.length?{windows,asOf:Date.now()}:{error:"Codex did not report quota windows for this account."};
    }
    if(profile.provider==="claude"){
      // The documented status-line stdin contains rate_limits. Only opt-in
      // capture writes a snapshot; never call an undocumented OAuth endpoint.
      const snapshot=JSON.parse(fs.readFileSync(path.join(profile.root,".rounds-usage.json"),"utf8"));
      const windows=claudeWindows(snapshot).filter(w=>Number.isFinite(snapshot.asOf)&&snapshot.asOf<=Date.now()&&Date.now()-snapshot.asOf<(w.label==="5-hour limit"?5:168)*3600000&&(!w.resetsAt||w.resetsAt>Date.now()));
      return windows.length?{windows,asOf:snapshot.asOf}:{error:"No current quota snapshot. Run an active Claude Code session with the optional status-line capture configured."};
    }
  }catch(e){return {error:profile.provider==="claude"?"No Claude status-line quota snapshot yet. See the optional capture setup.":"Codex quota could not be read from the installed CLI."};}
  return {error:"Usage is not available for this provider."};
}
