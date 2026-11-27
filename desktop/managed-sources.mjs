// Desktop canvases are isolated by the exact enabled source set. A disabled
// account's retained images, notes, or cached index cannot appear in another set.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export function selectedSources(providers){
  return providers.filter(p=>p.enabled&&["claude","codex"].includes(p.id)).flatMap(p=>p.profiles.filter(a=>a.enabled).map(a=>({id:a.id,provider:p.id,root:a.root}))).sort((a,b)=>a.id.localeCompare(b.id));
}
export function sourceKey(sources){return crypto.createHash("sha256").update(JSON.stringify(sources.map(a=>a.id).sort())).digest("hex").slice(0,24);}
export function managedPaths(base, sources){
  const data=path.join(base,"canvases",sourceKey(sources)),empty=path.join(data,"empty-sources");
  return {data,empty,claude:sources.filter(a=>a.provider==="claude").map(a=>a.root),codex:sources.filter(a=>a.provider==="codex").map(a=>a.root)};
}
export function prepareManagedSources(base,sources,env=process.env){
  const p=managedPaths(base,sources);
  fs.mkdirSync(p.data,{recursive:true});fs.mkdirSync(path.join(p.empty,"projects"),{recursive:true});
  const config=path.join(p.data,"config.json");
  if(!fs.existsSync(config))fs.writeFileSync(config,JSON.stringify({updates:false,relay:false,home:"Studio",projects:[],private:[],folders:true},null,2));
  const overrides={HOME:p.data,CLAUDE_HOME:p.empty,CODEX_HOME:p.empty,DESKTOP_SESSIONS:p.empty};
  for(const [k,v] of Object.entries(overrides)){env["ROUNDS_"+k]=v;env["WORKBENCH_"+k]=v;}
  env.ROUNDS_CLAUDE_HOMES=JSON.stringify(p.claude);env.ROUNDS_CODEX_HOMES=JSON.stringify(p.codex);env.ROUNDS_MANAGED_SOURCES="1";
  return p;
}
