import { groupAccounts } from "./account-groups.mjs";
const bridge=window.roundsSettings,content=document.getElementById("content"),status=document.getElementById("status"),save=document.getElementById("save");
const icons={claude:"claude-color",codex:"codex-color",antigravity:"antigravity-color",grok:"grok",devin:"devin-color",cursor:"cursor",copilot:"githubcopilot",kiro:"kiro-color"};
let tab="integrations",rows=[],desktop={},dirty=false,loading=false,metadata=new Map(),generation=0;
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
const groups=p=>groupAccounts(p,id=>metadata.get(id)?.identity);
function toggle(v,change,label,disabled=false){const n=el("input");n.type="checkbox";n.checked=v;n.disabled=disabled;n.setAttribute("aria-label",label);n.addEventListener("change",()=>change(n.checked));return n;}
function mark(){dirty=true;save.disabled=false;status.textContent="Unsaved preferences";}
function brand(p){const b=el("div","brand"),i=el("img");i.src="node_modules/@lobehub/icons-static-svg/icons/"+icons[p.id]+".svg";i.alt=p.name+" logo";b.append(i);return b;}
function header(p){const row=el("div","row"),t=el("div","grow");t.append(el("div","name",p.name),el("div","small",[p.company,p.cliPaths.length?"CLI detected":"",p.desktopDetected?"Desktop detected":""].filter(Boolean).join(" · ")));row.append(brand(p),t);return row;}
const notice=t=>el("div","notice",t);
function counts(p){const all=groups(p),n=all.filter(g=>g.verified).length,unknown=all.length-n;return [n?n+" "+(n===1?"verified account":"verified accounts"):"",unknown?unknown+" unverified "+(unknown===1?"profile":"profiles"):"",p.enabled?all.filter(g=>g.enabled).length+" selected":"0 selected"].filter(Boolean).join(" · ");}
function redraw(){if(document.activeElement?.tagName!=="INPUT"||document.activeElement.type!=="text")render();}
async function fetchMetadata(a,key){try{const result=await bridge[key](a.id);metadata.set(a.id,{...metadata.get(a.id),[key]:result});}catch(e){metadata.set(a.id,{...metadata.get(a.id),[key]:{error:String(e.message||e)}});}}
function accountCard(p,g){const card=el("div","account"),head=el("div","account-head"),input=el("input","grow");
 input.type="text";input.maxLength=80;input.value=g.label;input.setAttribute("aria-label","Account display name");input.addEventListener("input",()=>{for(const a of g.profiles)a.label=input.value;mark();});
 head.append(input,toggle(g.enabled,v=>{for(const a of g.profiles)a.enabled=v;mark();render();},g.label+" account preference",!p.enabled));card.append(head);
 const a=g.primary,m=metadata.get(a.id)||{},identity=g.identity||{};
 card.append(el("div","small details",identity.email||identity.label||"Account identity not yet verified"));
 if(identity.organization)card.append(el("div","small",identity.organization));if(identity.plan)card.append(el("div","small","Plan: "+identity.plan));
 if(g.profiles.length>1){card.append(el("div","small",g.profiles.length+" local profiles for this account"));for(const x of g.profiles){const r=el("div","row");r.append(el("div","grow small",x.root),toggle(x.enabled,v=>{x.enabled=v;mark();render();},x.defaultLabel+" profile preference",!p.enabled));card.append(r);}}
 else card.append(el("div","small details",a.root));
 const actions=el("div","actions");for(const [key,label] of [["identity","Identify account"],["usage","Refresh usage"]]){const b=el("button",null,label);b.disabled=!["claude","codex"].includes(p.id);b.addEventListener("click",async()=>{b.disabled=true;b.textContent="Checking…";await fetchMetadata(a,key);render();});actions.append(b);}card.append(actions);
 if(m.identity?.error)card.append(el("div","small error",m.identity.error));
 if(m.usage){const u=el("div","usage");if(m.usage.error)u.append(el("div","small",m.usage.error));for(const x of m.usage.windows||[]){const label=el("div","small",x.label+" · "+Math.round(x.used)+"% used"),bar=el("progress","meter");bar.max=100;bar.value=x.used;u.append(label,bar);if(x.resetsAt)u.append(el("div","small","Resets "+new Date(x.resetsAt).toLocaleString()));}if(m.usage.asOf)u.append(el("div","small","As of "+new Date(m.usage.asOf).toLocaleString()));card.append(u);}return card;
}
function render(){content.replaceChildren();if(loading){content.append(notice("Discovering local integrations…"));return;}
 if(tab==="integrations"){content.append(notice("One row per provider. Enable a provider and its accounts to include supported session history in your local canvas."));
  for(const p of rows){const g=el("article","group"),r=header(p);r.append(el("span","pill",p.detected?"Detected":"Not detected"),toggle(p.enabled,v=>{p.enabled=v;mark();render();},p.name+" preference",!p.detected));g.append(r);if(p.profiles.length)g.append(el("p","small",counts(p)));g.append(el("p","small",p.sessionAdapter?"Session history supported; saved selections apply on restart.":"Discovery only · session adapter not available"));content.append(g);}
 }else if(tab==="accounts"){content.append(notice("Rename accounts once. Verified matching profiles are grouped; uncertain profiles are shown separately. Only selected Claude and Codex profiles are indexed."));
  for(const p of rows.filter(p=>p.profiles.length)){const g=el("article","group"),r=header(p);r.append(el("span","pill",groups(p).length+" account groups"));g.append(r);for(const account of groups(p))g.append(accountCard(p,account));content.append(g);}
  if(!rows.some(p=>p.profiles.length))content.append(notice("No supported local profiles were discovered."));
 }else{const g=el("article","group general");for(const [key,label,detail] of [["login","Start at Windows login","Launch in the background."],["watchAgents","Open with Claude or Codex Desktop","Requires Rounds to be running in the tray."],["tray","Keep running in the tray","Closing the window hides Rounds instead of quitting."]]){const r=el("div","row"),t=el("div","grow");t.append(el("div","name",label),el("div","small",detail));r.append(t,toggle(!!desktop[key],async v=>{try{desktop=await bridge.general({[key]:v});status.textContent="Desktop preference saved";}catch(e){status.textContent=String(e.message||e);}render();},label,key==="login"&&!desktop.canLogin));g.append(r);}content.append(g);}
}
async function refreshUsage(){const active=rows.filter(p=>p.enabled&&["claude","codex"].includes(p.id)).flatMap(p=>groups(p).filter(g=>g.enabled).map(g=>g.primary));await Promise.allSettled(active.map(a=>fetchMetadata(a,"usage")));redraw();}
async function scan(){if(dirty&&!confirm("Discard unsaved preferences and rescan?"))return;const current=++generation;loading=true;render();try{const result=await bridge.scan();if(current!==generation)return;rows=result.providers;desktop=result.desktop;dirty=false;save.disabled=true;status.textContent="Discovery complete";}catch(e){status.textContent=String(e.message||e);}finally{loading=false;render();}
 if(current!==generation)return;const profiles=rows.filter(p=>["claude","codex"].includes(p.id)).flatMap(p=>p.profiles);await Promise.allSettled(profiles.map(a=>fetchMetadata(a,"identity")));if(current===generation){redraw();await refreshUsage();}
}
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{tab=b.dataset.tab;document.querySelectorAll("nav button").forEach(x=>x.setAttribute("aria-selected",String(x===b)));render();}));
document.getElementById("refresh").addEventListener("click",scan);
save.addEventListener("click",async()=>{save.disabled=true;try{const patch={providers:Object.fromEntries(rows.map(p=>[p.id,p.enabled])),profiles:Object.fromEntries(rows.flatMap(p=>p.profiles.map(a=>[a.id,{label:a.label.trim(),enabled:a.enabled}])))};const result=await bridge.save(patch);dirty=false;status.textContent=result.restartRequired?"Saved. Restarting to apply source selections…":"Preferences saved";if(result.restartRequired)await bridge.restart();}catch(e){save.disabled=false;status.textContent=String(e.message||e);}});
setInterval(()=>{if(!document.hidden&&!dirty)refreshUsage();},300000);
scan();
