"use strict";
const bridge = window.roundsSettings;
const content = document.getElementById("content"), status = document.getElementById("status"), save = document.getElementById("save");
const iconNames = { claude:"claude-color", codex:"codex-color", antigravity:"antigravity-color", grok:"grok", devin:"devin-color", cursor:"cursor", copilot:"githubcopilot", kiro:"kiro-color" };
let tab="integrations", rows=[], desktop={}, dirty=false, loading=false, metadata=new Map();
const el=(tag,cls,text)=>{const n=document.createElement(tag); if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function toggle(value,change,label,disabled=false){const n=el("input");n.type="checkbox";n.checked=value;n.disabled=disabled;n.setAttribute("aria-label",label);n.addEventListener("change",()=>change(n.checked));return n;}
function mark(){dirty=true;save.disabled=false;status.textContent="Unsaved preferences";}
function brand(p){const b=el("div","brand"),i=el("img");i.src="node_modules/@lobehub/icons-static-svg/icons/"+iconNames[p.id]+".svg";i.alt=p.name+" logo";b.append(i);return b;}
function header(p){const row=el("div","row"),text=el("div","grow");text.append(el("div","name",p.name),el("div","small",[p.company,p.cliPaths.length?"CLI detected":"",p.desktopDetected?"Desktop detected":""].filter(Boolean).join(" · ")));row.append(brand(p),text);return row;}
function notice(text){return el("div","notice",text);}
function render(){
  content.replaceChildren();
  if(loading){content.append(notice("Discovering local integrations…"));return;}
  if(tab==="integrations"){
    content.append(notice("One row per provider. Profiles are local environments, not necessarily distinct authenticated subscriptions. Provider discovery does not grant session access."));
    for(const p of rows){const g=el("article","group"),r=header(p),summary=el("span","pill",p.detected?"Detected":"Not detected");r.append(summary,toggle(p.enabled,v=>{p.enabled=v;mark();render();},p.name+" preference",!p.detected));g.append(r);if(p.profiles.length){const count=p.profiles.length;g.append(el("p","small",count+" "+(count===1?"profile":"profiles")+" discovered · "+(p.enabled?p.profiles.filter(a=>a.enabled).length:0)+" selected"));}g.append(el("p","small",p.sessionAdapter?"Session adapter available; preferences require activation to affect indexing.":"Discovery only · session adapter not available"));content.append(g);}
  }else if(tab==="accounts"){
    content.append(notice("Rename local profiles once and save their preferences. Identity and quota lookups are explicit and read-only. A selected profile is not connected until its session adapter is configured."));
    for(const p of rows.filter(p=>p.profiles.length)){const g=el("article","group"),r=header(p);r.append(el("span","pill",p.profiles.length+" profiles"));g.append(r);
      for(const a of p.profiles){const card=el("div","account"),head=el("div","account-head"),input=el("input","grow");input.type="text";input.maxLength=80;input.value=a.label;input.setAttribute("aria-label","Profile display name");input.addEventListener("input",()=>{a.label=input.value;mark();});head.append(input,toggle(a.enabled,v=>{a.enabled=v;mark();},a.label+" preference",!p.enabled));card.append(head,el("div","small details",a.root));const m=metadata.get(a.id)||{};card.append(el("div","small",m.identity?.email||m.identity?.label||"Identity not yet verified"));if(m.identity?.plan)card.append(el("div","small","Plan: "+m.identity.plan));
        const actions=el("div","actions");for(const [key,label] of [["identity","Identify account"],["usage","Refresh usage"]]){const b=el("button",null,label);b.disabled=!["claude","codex"].includes(p.id);b.addEventListener("click",async()=>{b.disabled=true;b.textContent="Checking…";try{const result=await bridge[key](a.id);metadata.set(a.id,{...metadata.get(a.id),[key]:result});}catch(e){metadata.set(a.id,{...metadata.get(a.id),[key]:{error:String(e.message||e)}});}render();});actions.append(b);}card.append(actions);
        if(m.identity?.error)card.append(el("div","small error",m.identity.error));
        if(m.usage){const u=el("div","usage");if(m.usage.error)u.append(el("div","small",m.usage.error));for(const x of m.usage.windows||[]){const label=el("div","small",x.label+" · "+Math.round(x.used)+"% used"),bar=el("progress","meter");bar.max=100;bar.value=x.used;u.append(label,bar);if(x.resetsAt)u.append(el("div","small","Resets "+new Date(x.resetsAt).toLocaleString()));}if(m.usage.asOf)u.append(el("div","small","As of "+new Date(m.usage.asOf).toLocaleString()));card.append(u);}g.append(card);}
      content.append(g);}
    if(!rows.some(p=>p.profiles.length))content.append(notice("No supported local profiles were discovered."));
  }else{
    const g=el("article","group general");for(const [key,label,detail] of [["login","Start at Windows login","Launch in the background."],["watchAgents","Open with Claude or Codex Desktop","Requires Rounds to be running in the tray."],["tray","Keep running in the tray","Closing the window hides Rounds instead of quitting."]]){const r=el("div","row"),t=el("div","grow");t.append(el("div","name",label),el("div","small",detail));r.append(t,toggle(!!desktop[key],async v=>{try{desktop=await bridge.general({[key]:v});status.textContent="Desktop preference saved";}catch(e){status.textContent=String(e.message||e);}render();},label,key==="login"&&!desktop.canLogin));g.append(r);}content.append(g);
  }
}
async function scan(){if(dirty&&!confirm("Discard unsaved preferences and rescan?"))return;loading=true;render();try{const result=await bridge.scan();rows=result.providers;desktop=result.desktop;dirty=false;save.disabled=true;status.textContent="Discovery complete";}catch(e){status.textContent=String(e.message||e);}finally{loading=false;render();}}
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{tab=b.dataset.tab;document.querySelectorAll("nav button").forEach(x=>x.setAttribute("aria-selected",String(x===b)));render();}));
document.getElementById("refresh").addEventListener("click",scan);
save.addEventListener("click",async()=>{save.disabled=true;try{const patch={providers:Object.fromEntries(rows.map(p=>[p.id,p.enabled])),profiles:Object.fromEntries(rows.flatMap(p=>p.profiles.map(a=>[a.id,{label:a.label.trim(),enabled:a.enabled}])))};await bridge.save(patch);dirty=false;status.textContent="Preferences saved";}catch(e){save.disabled=false;status.textContent=String(e.message||e);}});
scan();
