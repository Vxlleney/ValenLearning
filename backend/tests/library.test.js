import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createStore, DATA_FILES } from '../storage.js';
import { createServer } from '../server.js';
import { LIBRARY_FILES, scanImportDirectory } from '../library.js';
import { readCsv } from '../csv.js';

const setup=async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'valen-library-'));
  const dataDir=path.join(dir,'data');const seedPath=path.join(dir,'seed.csv');const importDir=path.join(dir,'imports');
  await fs.writeFile(seedPath,'english,french,category\nhello,bonjour,Quotidien\nmeeting,reunion,Travail\n');
  await fs.mkdir(path.join(importDir,'vocabulaire'),{recursive:true});await fs.mkdir(path.join(importDir,'grammaire'));
  const store=createStore({dataDir,seedPath});await store.load();
  t.after(async()=>{await store.close();await fs.rm(dir,{recursive:true,force:true});});
  return {dir,dataDir,seedPath,importDir,store};
};
const vocab={kind:'vocabulary',filename:'mots.csv',title:'Ma seance',csv:'english;french;category\nhello;bonjour;Quotidien\ndeploy;deployer;Informatique\ndeploy;deployer;Informatique\n'};
const grammar={kind:'grammar',filename:'regles.csv',title:'Grammaire',csv:'titre;theme;niveau;regle;structure;exemple;exemple_fr;erreur_frequente;astuce\nFor et since;Temps;B1;For = duree, since = point de depart.;have + participe passe;I have worked here for three years.;Je travaille ici depuis trois ans.;Pas since three years.;For = combien de temps ?\n'};

test('apercu sans ecriture, import vocabulaire, rattachement et doublons',async(t)=>{
  const {store}=await setup(t);const before=await store.backupFiles();const preview=await store.previewLibrary(vocab);
  assert.equal(preview.items_count,2);assert.equal(preview.new_count,1);assert.equal(preview.existing_count,1);assert.equal(preview.duplicate_count,1);
  assert.deepEqual(await store.backupFiles(),before);
  const imported=await store.importLibrary(vocab);const collection=await store.collection(imported.collection_id);
  assert.equal(collection.words.length,2);assert.equal((await store.load()).words.length,3);
  const again=await store.importLibrary({...vocab,filename:'autre.csv',title:'Autre',csv:'english,french,category\nhello,bonjour,Quotidien\ndeploy,deployer,Informatique\n'});
  assert.equal(again.already_imported,true);assert.equal(again.collection_id,imported.collection_id);assert.equal((await store.librarySnapshot()).collections.length,3);
});
test('import preserve une progression existante et un favori',async(t)=>{
  const {store}=await setup(t);const word=(await store.load()).words[0];
  await store.mutate({action:'review',id:word.id,rating:'good',event_id:'test-review'});await store.mutate({action:'favorite',id:word.id,favorite:true});
  await store.importLibrary(vocab);const next=(await store.load()).words.find((r)=>r.id===word.id);
  assert.equal(next.review_count,1);assert.equal(next.history[0].event_id,'test-review');assert.equal(next.favorite,true);
});
test('grammaire : alias francais, exemples, suivi, restart et export',async(t)=>{
  const f=await setup(t);const imported=await f.store.importLibrary(grammar);const col=await f.store.collection(imported.collection_id);
  assert.equal(col.lessons.length,1);assert.match(col.lessons[0].summary,/I have worked here/);assert.match(col.lessons[0].summary,/Pas since three years/);
  const id=col.lessons[0].id;await f.store.updateLessonProgress({id,status:'done'});
  const fresh=createStore({dataDir:f.dataDir,seedPath:f.seedPath});const snapshot=await fresh.librarySnapshot();assert.equal(snapshot.completed_lessons,1);
  assert.equal((await fresh.collection(imported.collection_id)).lessons[0].status,'done');
  const exported=await fresh.exportCollection(imported.collection_id);const again=await fresh.importLibrary({...grammar,csv:exported});assert.equal(again.already_imported,true);
});
test('toutes les lignes sont validees : aucun import partiel sur erreur',async(t)=>{
  const {store}=await setup(t);const before=await store.backupFiles();
  for(const csv of ['titre;regle\nTest;Une regle\nIncomplet', 'title,summary\nGood,Hello\n,Missing title','title,summary,level\nGood,Hello,B9','title,summary\nGood,"unfinished']){
    await assert.rejects(store.importLibrary({...grammar,csv}));assert.deepEqual(await store.backupFiles(),before);
  }
});
test('refus de mauvais type, colonnes dupliquees, entree vide et fichier trop grand',async(t)=>{
  const {store}=await setup(t);
  await assert.rejects(store.importLibrary({...vocab,csv:grammar.csv}),/english/);
  await assert.rejects(store.importLibrary({...grammar,csv:vocab.csv}),/title/);
  await assert.rejects(store.importLibrary({...vocab,csv:'english;english;french\na;b;c'}),/uniques/);
  await assert.rejects(store.importLibrary({...grammar,csv:'title,summary\n'}),/au moins/);
  await assert.rejects(store.importLibrary({...grammar,csv:'a'.repeat(2*1024*1024+1)}),/2 Mo/);
  await assert.rejects(store.importLibrary({...grammar,csv:'title,titre,summary\nx,y,z'}),/m.me champ/);
});
test('BOM, tabulations, guillemets, accents et cellules multilignes',async(t)=>{
  const {store}=await setup(t);
  const csv='\uFEFFtitle\tsummary\n"Pr\u00e9t\u00e9rit"\t"Yesterday: ""finished"".\nAction termin\u00e9e."\n';
  const real=await store.importLibrary({...grammar,csv});const col=await store.collection(real.collection_id);
  assert.match(col.lessons[0].summary,/finished/);assert.equal(col.lessons.length,1);assert.equal(col.lessons[0].title,'Pr\u00e9t\u00e9rit');
});
test('exports neutralisent les formules et se reimportent sans apostrophe ajoutee',async(t)=>{
  const {store}=await setup(t);const a=await store.importLibrary({...grammar,csv:'title,summary\n"=1+1","@SUM(A1:A9)"\n'});
  const exported=await store.exportCollection(a.collection_id);assert.match(exported,/'=1\+1/);
  assert.equal((await store.importLibrary({...grammar,csv:exported})).already_imported,true);
});
test('migration des huit CSV precedents sans perte de contenu',async(t)=>{
  const f=await setup(t);const old=await f.store.backupFiles();for(const name of LIBRARY_FILES)await fs.unlink(path.join(f.dataDir,name));
  const fresh=createStore({dataDir:f.dataDir,seedPath:f.seedPath});const current=await fresh.load();assert.equal(current.words.length,2);
  const after=await fresh.backupFiles();for(const name of DATA_FILES.filter((n)=>!LIBRARY_FILES.includes(n)))assert.equal(after[name],old[name]);
  assert.equal(Object.keys(after).length,11);
});
test('un seul fichier nouveau absent ne provoque pas de reinitialisation',async(t)=>{
  const {store,dataDir}=await setup(t);await fs.unlink(path.join(dataDir,LIBRARY_FILES[0]));await assert.rejects(store.load(),/CSV/);
});
test('lecture du dossier : doublons, erreurs isolees et liens refuses',async(t)=>{
  const f=await setup(t);await fs.writeFile(path.join(f.importDir,'vocabulaire','mots.csv'),vocab.csv);await fs.writeFile(path.join(f.importDir,'grammaire','regles.csv'),grammar.csv);
  await fs.writeFile(path.join(f.importDir,'grammaire','erreur.csv'),'title,summary\nmissing');
  await fs.symlink(f.seedPath,path.join(f.importDir,'vocabulaire','lien.csv'));
  const a=await scanImportDirectory(f.store,f.importDir);assert.equal(a.results.filter((r)=>r.status==='imported').length,2);assert.equal(a.results.filter((r)=>r.status==='error').length,2);
  const b=await scanImportDirectory(f.store,f.importDir);assert.equal(b.results.filter((r)=>r.status==='unchanged').length,2);
});
test('imports simultanes : aucun doublon et aucun resultat perdu',async(t)=>{
  const {store}=await setup(t);const result=await Promise.all([store.importLibrary(vocab),store.importLibrary(vocab),store.importLibrary(grammar)]);
  assert.equal(result.filter((r)=>r.already_imported).length,1);assert.equal((await store.librarySnapshot()).collections.length,4);
});
test('suppression d un mot : collection toujours lisible',async(t)=>{
  const {store}=await setup(t);const a=await store.importLibrary(vocab);const word=(await store.collection(a.collection_id)).words[0];await store.mutate({action:'delete',id:word.id});
  assert.equal((await store.collection(a.collection_id)).words.length,1);assert.equal((await store.librarySnapshot()).total_words,2);
});
test('reprise transactionnelle apres interruption pendant un import',async(t)=>{
  const f=await setup(t);const broken=createStore({dataDir:f.dataDir,seedPath:f.seedPath,onCommitStep:async(step)=>{if(step==='rename:lecons.csv')throw new Error('Coupure');}});
  await assert.rejects(broken.importLibrary(grammar),/Coupure/);const fresh=createStore({dataDir:f.dataDir,seedPath:f.seedPath});const snapshot=await fresh.librarySnapshot();assert.equal(snapshot.total_lessons,1);assert.equal(snapshot.collections.length,3);
});
test('API : authentification, origine, modeles, import et exports',async(t)=>{
  const f=await setup(t);const password='test-password-123456';const server=createServer({...f,password,username:'valentin'});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise((resolve)=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;const auth={Authorization:`Basic ${Buffer.from(`valentin:${password}`).toString('base64')}`};
  assert.equal((await fetch(`${base}/api/library`)).status,401);
  const tpl=await fetch(`${base}/api/library/template?kind=grammar`,{headers:auth});assert.equal(tpl.status,200);assert.equal(readCsv(await tpl.text())[0][0],'title');
  const request=(route,body,extra={})=>fetch(`${base}${route}`,{method:'POST',headers:{...auth,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal((await request('/api/library/import',grammar,{Origin:'https://evil.example'})).status,403);
  const imported=await (await request('/api/library/import',grammar)).json();assert.ok(imported.collection_id);
  const detail=await (await fetch(`${base}/api/library/collection?id=${imported.collection_id}`,{headers:auth})).json();assert.equal(detail.lessons.length,1);
  assert.equal((await request('/api/library/progress',{id:detail.lessons[0].id,status:'done'})).status,200);
  const exportCsv=await fetch(`${base}/api/library/export?id=${imported.collection_id}`,{headers:auth});assert.equal(exportCsv.status,200);
  assert.equal((await request('/api/library/scan',{})).status,200);
  assert.equal((await fetch(`${base}/api/library/template?kind=bad`,{headers:auth})).status,400);
  assert.equal((await fetch(`${base}/api/library/collection?id=missing`,{headers:auth})).status,404);
});
