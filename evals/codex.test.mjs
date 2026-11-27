import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
test("Codex reads an isolated SQLite history, including Windows absolute and file URL images",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"rounds-codex-"));
 try{
  process.env.ROUNDS_CODEX_HOME=dir;
  const state=new DatabaseSync(path.join(dir,"state_5.sqlite")),history=new DatabaseSync(path.join(dir,"thread_history_1.sqlite"));
  state.exec("create table threads(id,name,title,cwd,archived,created_at_ms,updated_at_ms,source,thread_source)");
  state.prepare("insert into threads values(?,?,?,?,?,?,?,?,?)").run("fixture-thread","Fixture","Fixture",dir,0,1700000000000,1700000001000,"cli","user");
  history.exec("create table thread_items(thread_id,turn_id,item_type,completed_at_ms,created_at_ms,item_json,rollout_ordinal)");
  const image=path.join(dir,"screen.png"),url=pathToFileURL(image).href;
  history.prepare("insert into thread_items values(?,?,?,?,?,?,?)").run("fixture-thread","t1","agentMessage",1700000001000,1700000000000,JSON.stringify({id:"i1",text:"Here is the result. ![preview]("+url+")"}),1);
  const insert=history.prepare("insert into thread_items values(?,?,?,?,?,?,?)");
  const raw=path.join(dir,"raw.png").replace(/\\/g,"/");
  insert.run("fixture-thread","t2","agentMessage",1700000002000,1700000000000,JSON.stringify({id:"i2",text:"![raw](<"+raw+">)"}),2);
  insert.run("fixture-thread","t3","imageGeneration",1700000003000,1700000000000,JSON.stringify({savedPath:"generated.png"}),3);
  insert.run("fixture-thread","t4","fileChange",1700000004000,1700000000000,JSON.stringify({id:"i4",status:"completed",changes:[{path:path.join(dir,"added.txt"),diff:"hello",kind:{type:"add"}}]}),4);
  state.close();history.close();
  const {readCodex}=await import("../server/codex.mjs");
  const records=await readCodex({log:console.log});
  assert.equal(records.length,1);assert.equal(records[0].title,"Fixture");assert.equal(path.normalize(records[0].sends[0].shots[0]),path.normalize(image));assert.equal(path.normalize(records[0].sends[1].shots[0]),path.normalize(raw));assert.equal(records[0].sends[2].shots[0],path.join(dir,"generated.png"));assert.equal(records[0].edits[0].name,"Write");
  const plain=spawnSync(process.execPath,["--input-type=module","-e","import {readCodex} from './server/codex.mjs'; const rows=await readCodex();if(!Array.isArray(rows))process.exit(2);console.log('plain CLI safely returned '+rows.length+' Codex sessions')"],{cwd:process.cwd(),env:{...process.env,ROUNDS_CODEX_HOME:dir,ROUNDS_CODEX_HOMES:JSON.stringify([dir])},encoding:"utf8",timeout:10000});assert.equal(plain.status,0,plain.stderr||String(plain.error||""));console.log(plain.stdout.trim());
 }finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});}
});
