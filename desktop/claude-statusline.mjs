// Optional Claude Code status-line command. Reads the documented stdin payload,
// stores only subscription quota values, and emits a concise status line.
// Do not replace an existing status line without the user's consent.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
let input="";
for await (const chunk of process.stdin) { input+=chunk;if(input.length>1024*1024)process.exit(1); }
try {
  const j=JSON.parse(input), rate_limits={};
  for(const key of ["five_hour","seven_day"]){
    const x=j.rate_limits?.[key];
    if(typeof x?.used_percentage==="number"&&Number.isFinite(x.used_percentage)&&x.used_percentage>=0&&x.used_percentage<=100){
      rate_limits[key]={used_percentage:x.used_percentage,resets_at:typeof x.resets_at==="number"?x.resets_at:null};
    }
  }
  if(Object.keys(rate_limits).length){
    const root=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),".claude");
    const f=path.join(root,".rounds-usage.json"),temp=f+"."+crypto.randomUUID()+".tmp";
    try{fs.writeFileSync(temp,JSON.stringify({asOf:Date.now(),rate_limits}),{mode:0o600,flag:"wx"});fs.renameSync(temp,f);}finally{fs.rmSync(temp,{force:true});}
  }
  console.log(Object.entries(rate_limits).map(([k,x])=>(k==="five_hour"?"5h":"7d")+": "+Math.round(x.used_percentage)+"%").join(" | ")||"Quota unavailable");
}catch{console.log("Quota unavailable");}
