import assert from 'node:assert/strict';
import { Module, createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const temp=mkdtempSync(join(tmpdir(),'jukebox-ui-'));const require=createRequire(import.meta.url);const original=Module._load;
try{
 writeFileSync(join(temp,'package.json'),'{"type":"commonjs"}');symlinkSync(resolve('node_modules'),join(temp,'node_modules'),'dir');
 mkdirSync(join(temp,'lib'),{recursive:true});mkdirSync(join(temp,'app/components'),{recursive:true});
 for(const path of ['lib/catalog-utils.ts','lib/local-audio.ts','lib/game.ts','app/components/Scoreboard.tsx','app/components/RoomScene.tsx','app/components/MusicPlayer.tsx','app/components/Dialog.tsx','app/components/SupportPanels.tsx']){
  const code=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  writeFileSync(join(temp,path.replace(/\.tsx?$/,'.js')),code);
 }
 copyFileSync('lib/catalog.json',join(temp,'lib/catalog.json'));
 Module._load=function(name,...args){if(name.startsWith('@/'))name=join(temp,name.slice(2)+'.js');return original.call(this,name,...args);};
 const {createRoom,joinRoom,settingsOf,applyAction,viewRoom}=require(join(temp,'lib/game.js'));
 const now=Date.now();const person=i=>({id:`p${i}`,name:`玩家${i}`,tokenHash:`tokenhash${i}`,hand:[],score:i,lastSeen:now,readyFor:'G01'});
 const r=createRoom('ABCD23',person(0),settingsOf({mode:'guess'}),now);for(let i=1;i<8;i++)joinRoom(r,person(i),now);
 applyAction(r,'p0',{type:'start'},now);applyAction(r,'p0',{type:'advance'},now);
 const Scoreboard=require(join(temp,'app/components/Scoreboard.js')).default;const RoomScene=require(join(temp,'app/components/RoomScene.js')).default;
 const {Rules}=require(join(temp,'app/components/SupportPanels.js'));const noOp=()=>{};const act=async()=>true;
 const host=viewRoom(r,'p0');const guest=viewRoom(r,'p1');
 const hostHtml=renderToStaticMarkup(React.createElement(Scoreboard,{room:host,act}));
 assert.equal((hostHtml.match(/type="number"/g)||[]).length,8);
 for(const p of r.players)assert.ok(hostHtml.includes(`${p.name} 的总分`));
 const guestHtml=renderToStaticMarkup(React.createElement(Scoreboard,{room:guest,act}));assert.ok(!guestHtml.includes('type="number"'));
 const scene=renderToStaticMarkup(React.createElement(RoomScene,{room:host,clock:0,connected:true,act,openHost:noOp,openCredits:noOp,invite:noOp,copied:false}));
 assert.ok(scene.includes('class="hand-stage"'));assert.ok(!scene.includes('class="private-column"'));
 for(const id of host.self.hand){assert.ok(scene.includes(`/cards/card_${id}.jpg`));assert.ok(!scene.includes(`/cards/thumb_${id}.jpg`));}
 const rules=renderToStaticMarkup(React.createElement(Rules,{onClose:noOp}));assert.ok(rules.includes('至少骗到一票'));assert.ok(rules.includes('被作者误认成间谍'));
 for(const phrase of ['为改规则留一点余地','试验规则','规则仍在生长','每人需先导入','把听见的'])assert.ok(!rules.includes(phrase)&&!scene.includes(phrase));
 console.log('PASS host sees editable totals for all 8 players; guests see read-only scores');
 console.log('PASS hand cards render at full-resolution paths in the primary playing area');
 console.log('PASS current identity scoring and player-facing copy render without development notes');
}finally{Module._load=original;rmSync(temp,{recursive:true,force:true});}
