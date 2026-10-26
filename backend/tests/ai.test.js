import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.js';
import { createStore, DATA_FILES } from '../storage.js';
import { readRecords } from '../csv.js';
import { LEARNING_TABLES, LEARNING_FILES } from '../learning-state.js';
import { createAiService } from '../ai.js';

const word = {english:'although',french:'bien que',category:'Grammaire',example:'Although it was raining, I went outside.',example_fr:'Bien qu’il pleuve, je suis sorti.',note:'Introduit une concession.'};
const lesson = {title:'Since, for et by',summary:'Since introduit un point de départ. For exprime une durée. By marque une échéance.',exercises:Array.from({length:5},(_,index)=>({question:`Question ${index+1} : I have worked here ___ 2020.`,options:['since','for','by','during'],correct_index:0,explanation:'2020 est le point de départ : since.'}))};
const correction = {corrected:'Employees must change their passwords.',translation:'Les employés doivent changer leurs mots de passe.',explanation:'Après must, le verbe reste à la base verbale.',tip:'must + verbe sans to.'};
const response=(data,extra={})=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}],usage:{input_tokens:120,output_tokens:300},...extra}),{status:200,headers:{'Content-Type':'application/json'}});
const input=(overrides={})=>({request_id:randomUUID(),kind:'vocabulary',text:'although',level:'B1',mode:'words',count:1,...overrides});
const setup=async(t,{fetchImpl=async()=>response({words:[word]}),apiKey='FAKE_TEST_KEY_NOT_REAL',dailyLimit=30,...options}={})=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'valen-ai-test-'));
 const dataDir=path.join(directory,'data');const seedPath=path.join(directory,'seed.csv');
 await fs.writeFile(seedPath,'english;french\nhello;bonjour\n');
 const server=createServer({dataDir,seedPath,...options,aiOptions:{apiKey,dailyLimit,fetchImpl}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,body,headers={})=>{
  const res=await fetch(`${url}${route}`,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'Content-Type':'application/json'}:{}),...headers}});
  return {status:res.status,data:await res.json(),headers:res.headers};
 };
 t.after(async()=>{await new Promise((resolve)=>server.close(resolve));await server.app.store.close();await fs.rm(directory,{recursive:true,force:true});});
 return {call,store:server.app.store,dataDir,seedPath,server,url};
};

test('IA non configuree : jeux disponibles, aucun appel reseau, etat explicite',async(t)=>{
 let calls=0;const app=await setup(t,{apiKey:'',fetchImpl:async()=>{calls++;return response({words:[word]});}});
 assert.equal((await app.call('/api/ai/status')).data.configured,false);
 assert.equal((await app.call('/api/ai/generate',input())).status,503);
 assert.equal((await app.call('/api/vocabulary')).data.words.length,1);
 assert.equal(calls,0);assert.equal((await app.store.learningSnapshot()).usage.today,0);
});
test('cle cote serveur, Responses strict, store:false, ajout CSV et relecture',async(t)=>{
 const app=await setup(t,{fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer FAKE_TEST_KEY_NOT_REAL');
  const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.model,'gpt-4.1-mini');assert.equal(body.text.format.strict,true);assert.equal(body.text.format.type,'json_schema');
  assert.equal(body.input.includes('hello'),false);return response({words:[word]});
 }});
 const result=await app.call('/api/ai/generate',input());assert.equal(result.status,200);assert.equal(result.data.added,1);
 const state=await app.store.load();assert.equal(state.words.length,2);assert.equal(state.words[1].note.startsWith('[B1]'),true);
 const reloaded=await createStore({dataDir:app.dataDir,seedPath:app.seedPath}).load();assert.equal(reloaded.words[1].english,'although');
 const status=(await app.call('/api/ai/status')).data;assert.equal(status.input_tokens,120);assert.equal(status.output_tokens,300);
 assert.equal(JSON.stringify(status).includes('FAKE_TEST_KEY_NOT_REAL'),false);
 assert.deepEqual((await fs.readdir(app.dataDir)).sort(),[...DATA_FILES].sort());
});
test('idempotence : un meme clic ne facture pas un second appel',async(t)=>{
 let calls=0;const app=await setup(t,{fetchImpl:async()=>{calls++;return response({words:[word]});}});const data=input();
 const first=await app.call('/api/ai/generate',data);const second=await app.call('/api/ai/generate',data);
 assert.equal(first.status,200);assert.equal(second.data.cached,true);assert.equal(calls,1);
 assert.equal((await app.call('/api/ai/generate',{...data,text:'something else'})).status,409);
 assert.equal((await app.store.load()).words.length,2);
});
test('budget persistant commun aux appareils et aux redemarrages',async(t)=>{
 const app=await setup(t,{dailyLimit:2});
 assert.equal((await app.call('/api/ai/generate',input())).status,200);
 assert.equal((await app.call('/api/ai/generate',input())).data.skipped,1);
 assert.equal((await app.call('/api/ai/generate',input())).status,429);
 const second=createAiService({store:createStore({dataDir:app.dataDir,seedPath:app.seedPath}),apiKey:'FAKE',dailyLimit:2,fetchImpl:async()=>{throw new Error('Ne doit pas etre appele');}});
 await assert.rejects(second.generate(input()),{status:429});
});
test('concurrence PC/telephone : une seule generation a la fois',async(t)=>{
 let release;const gate=new Promise((resolve)=>{release=resolve;});let calls=0;
 const app=await setup(t,{fetchImpl:async()=>{calls++;await gate;return response({words:[word]});}});
 const first=app.call('/api/ai/generate',input());
 // Attend le debut effectif de l'appel simule, sans toucher a une API externe.
 for(let count=0;calls===0&&count<100;count++)await new Promise((resolve)=>setTimeout(resolve,5));
 const second=await app.call('/api/ai/generate',input());assert.equal(second.status,409);
 release();assert.equal((await first).status,200);assert.equal(calls,1);
});
test('authentification : aucun appel IA avant verification du mot de passe',async(t)=>{
 let calls=0;const app=await setup(t,{username:'valentin',password:'TEST_PASSWORD_FOR_TEST_ONLY',fetchImpl:async()=>{calls++;return response({words:[word]});}});
 assert.equal((await app.call('/api/ai/generate',input())).status,401);assert.equal(calls,0);
 const headers={Authorization:`Basic ${Buffer.from('valentin:TEST_PASSWORD_FOR_TEST_ONLY').toString('base64')}`};
 assert.equal((await app.call('/api/ai/generate',input(),headers)).status,200);assert.equal(calls,1);
});
test('origine et taille : la generation ne peut pas etre declenchee depuis un autre site',async(t)=>{
 let calls=0;const app=await setup(t,{fetchImpl:async()=>{calls++;return response({words:[word]});}});
 assert.equal((await app.call('/api/ai/generate',input(),{Origin:'https://evil.example'})).status,403);
 assert.equal((await app.call('/api/ai/generate',input({text:'a'.repeat(3001)}))).status,400);
 assert.equal((await app.call('/api/ai/generate',input({text:Array.from({length:13},()=> 'word').join('\n')}))).status,400);
 assert.equal(calls,0);
});
test('lecon : 5 QCM, reponse verifiee sur le serveur, reprise depuis un autre appareil',async(t)=>{
 const app=await setup(t,{fetchImpl:async()=>response(lesson)});
 const generated=await app.call('/api/ai/generate',input({kind:'lesson',text:'Since et for'}));assert.equal(generated.status,200);
 const saved=generated.data.lesson;assert.equal(saved.exercises.length,5);assert.equal('correct_index' in saved.exercises[0],false);
 const body={id:randomUUID(),exercise_id:saved.exercises[0].id,selected_index:1};
 const graded=await app.call('/api/learning/answer',body);assert.equal(graded.data.correct,false);assert.equal(graded.data.correct_index,0);
 assert.equal((await app.call('/api/learning/answer',body)).status,200);
 assert.equal((await app.call('/api/learning/answer',{...body,selected_index:0})).status,409);
 const snapshot=(await app.call('/api/learning')).data;assert.equal(snapshot.attempts_count,1);assert.equal(snapshot.lessons[0].answered,1);
 const reloaded=(await app.call(`/api/learning/lesson?id=${saved.id}`)).data;assert.equal(reloaded.exercises[0].last_attempt.correct,false);
 // Ne pas faire confiance a un champ action fourni par le client.
 assert.equal((await app.call('/api/learning/answer',{...body,action:'reserve'})).status,200);
});
test('correction : texte et explication sauvegardes dans des CSV plats',async(t)=>{
 const app=await setup(t,{fetchImpl:async()=>response(correction)});
 const result=await app.call('/api/ai/generate',input({kind:'correction',text:'Employees must changes their passwords.'}));
 assert.equal(result.status,200);assert.equal(result.data.correction.corrected,correction.corrected);
 const files=await app.store.backupFiles();const rows=readRecords(files['corrections.csv'],LEARNING_TABLES.corrections.columns);
 assert.equal(rows.length,1);assert.equal(rows[0].original,'Employees must changes their passwords.');
 assert.equal((await app.call('/api/learning')).data.corrections[0].id,result.data.correction.id);
});
test('CSV : formules neutralisees et retours a la ligne preserves',async(t)=>{
 const changed={...correction,corrected:'=2+2',explanation:'Ligne 1\nLigne 2, avec "guillemets".'};
 const app=await setup(t,{fetchImpl:async()=>response(changed)});
 assert.equal((await app.call('/api/ai/generate',input({kind:'correction',text:'=2+2'}))).status,200);
 const csv=await fs.readFile(path.join(app.dataDir,'corrections.csv'),'utf8');assert.ok(csv.includes("'=2+2"));
 const reloaded=await app.store.learningSnapshot();assert.equal(reloaded.corrections[0].corrected,'=2+2');assert.equal(reloaded.corrections[0].explanation,changed.explanation);
});
for(const scenario of [
 {name:'cle refusee',reply:()=>new Response(JSON.stringify({error:{message:'secret FAKE_TEST_KEY_NOT_REAL'}}),{status:401}),status:502},
 {name:'quota OpenAI',reply:()=>new Response('{}',{status:429}),status:429},
 {name:'modele indisponible',reply:()=>new Response('{}',{status:404}),status:502},
 {name:'contenu JSON invalide',reply:()=>response({wrong:'invalid'}),status:502},
 {name:'sortie tronquee',reply:()=>response({words:[word]},{status:'incomplete'}),status:502},
 {name:'refus de contenu',reply:()=>response({}, {output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}),status:422},
 {name:'reseau indisponible',reply:()=>{throw new Error('fetch failed');},status:504},
])test(`Echec ${scenario.name} : ne modifie pas le carnet, conserve le quota`,async(t)=>{
 const app=await setup(t,{fetchImpl:async()=>scenario.reply()});const result=await app.call('/api/ai/generate',input());
 assert.equal(result.status,scenario.status);assert.equal(JSON.stringify(result.data).includes('FAKE_TEST_KEY_NOT_REAL'),false);
 assert.equal((await app.store.load()).words.length,1);assert.equal((await app.store.learningSnapshot()).usage.today,1);
 assert.equal((await app.store.learningSnapshot()).usage.recent[0].status,'failed');
});
test('choix identiques dans un QCM : la lecon est refusee integralement',async(t)=>{
 const bad=structuredClone(lesson);bad.exercises[2].options=['since','since','for','by'];
 const app=await setup(t,{fetchImpl:async()=>response(bad)});
 assert.equal((await app.call('/api/ai/generate',input({kind:'lesson'}))).status,502);
 assert.equal((await app.store.learningSnapshot()).lessons.length,0);
});
test('vocabulaire transmis uniquement sur demande explicite',async(t)=>{
 let prompt='';const app=await setup(t,{fetchImpl:async(_,options)=>{prompt=JSON.parse(options.body).input;return response({words:[word]});}});
 await app.call('/api/ai/generate',input({use_vocabulary:true}));assert.ok(prompt.includes('hello'));
});
test('migration ancienne version : conserve mots, revisions et objectif',async(t)=>{
 const app=await setup(t);await app.store.load();
 await app.store.updateSettings({goal:15});
 for(const name of LEARNING_FILES)await fs.unlink(path.join(app.dataDir,name));
 const migrated=await app.store.load();assert.equal(migrated.words.length,1);assert.equal(migrated.settings.goal,15);
 assert.deepEqual((await fs.readdir(app.dataDir)).sort(),[...DATA_FILES].sort());
});
test('un seul CSV apprentissage manquant : aucune reinitialisation silencieuse',async(t)=>{
 const app=await setup(t);await app.store.load();await fs.unlink(path.join(app.dataDir,'corrections.csv'));
 await assert.rejects(app.store.load(),{status:503});assert.equal((await fs.readdir(app.dataDir)).includes('corrections.csv'),false);
});
test('export securise : liste blanche des CSV, ni .env ni chemins arbitraires',async(t)=>{
 const app=await setup(t);
 assert.equal((await app.call('/api/export/file?name=.env')).status,404);
 const res=await fetch(`${app.url}/api/export/file?name=lecons.csv`);assert.equal(res.status,200);assert.ok((await res.text()).includes('id,title,topic'));
});
test('interruption pendant un ajout IA : reprise de tous les CSV coherente',async(t)=>{
 const app=await setup(t);await app.store.load();
 let crash=false;
 const store=createStore({dataDir:app.dataDir,seedPath:app.seedPath,onCommitStep:async(step)=>{if(crash && step==='rename:vocabulaire.csv')throw new Error('Interruption simulee');}});
 const id=randomUUID();await store.learningMutate({action:'reserve',id,kind:'lesson',model:'test',payloadHash:'a'.repeat(64),dailyLimit:30});
 crash=true;await assert.rejects(store.learningMutate({action:'complete',id,data:lesson,level:'B1',topic:'Since',usage:{input_tokens:10,output_tokens:20}}));
 const restored=createStore({dataDir:app.dataDir,seedPath:app.seedPath});const state=await restored.learningSnapshot();
 assert.equal(state.lessons.length,1);assert.equal(state.lessons[0].exercise_count,5);assert.equal(state.usage.completed,1);
});
