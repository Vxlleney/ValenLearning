import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { appError } from './actions.js';
import { readCsv, serializeCsv } from './csv.js';
import { parseVocabularyCsv, mergeVocabulary, vocabularyKey, normalizeAnswer, MAX_CSV_BYTES, CSV_COLUMNS } from '../shared/vocabulary.js';

// Les collections organisent les donnees existantes sans recopier la progression.
export const LIBRARY_TABLES = {
  collections: { file: 'collections.csv', columns: ['id','kind','title','description','level','filename','created_at'] },
  collectionItems: { file: 'collection-elements.csv', columns: ['id','collection_id','item_type','item_id','position'] },
  lessonProgress: { file: 'suivi-lecons.csv', columns: ['id','status','updated_at'] },
};
export const LIBRARY_FILES = Object.values(LIBRARY_TABLES).map((table) => table.file);
const LEVELS = ['A1','A2','B1','B2','C1'];
const fingerprint = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,32);
const headerKey = (value) => normalizeAnswer(value).replace(/[^a-z0-9]/g,'');
const text = (value, label, max, required=false) => {
  if (value != null && typeof value !== 'string') throw appError(`${label} doit être du texte.`);
  const result=(value || '').trim();
  if (required && !result) throw appError(`${label} est obligatoire.`);
  if (result.length>max || result.includes('\0')) throw appError(`${label} est trop long ou contient un caractère interdit.`);
  return result;
};
const separator = (csv) => {
  const counts={',':0,';':0,'\t':0}; let quoted=false;
  for(let i=0;i<csv.length;i+=1){const c=csv[i];if(c==='"'){if(quoted && csv[i+1]==='"')i+=1;else quoted=!quoted;}else if(!quoted && /[\r\n]/.test(c))break;else if(!quoted && c in counts)counts[c]+=1;}
  return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
};
const ALIASES={
  title:'title',titre:'title',lesson:'title',lecon:'title', topic:'topic',theme:'topic',sujet:'topic',
  level:'level',niveau:'level', summary:'summary',resume:'summary',regle:'summary',rule:'summary',contenu:'summary',content:'summary',
  structure:'structure',formula:'structure',formule:'structure',example:'example',exemple:'example',exampleen:'example',exempleanglais:'example',
  examplefr:'example_fr',exemplefr:'example_fr',traductionexemple:'example_fr',
  commonmistake:'common_mistake',erreurfrequente:'common_mistake',pitfall:'common_mistake',
  tip:'tip',astuce:'tip',note:'tip',conseil:'tip',source:'source',origine:'source',
};
export const GRAMMAR_COLUMNS=['title','topic','level','summary','structure','example','example_fr','common_mistake','tip','source'];
export const libraryTemplate=(kind) => {
  if(kind==='grammar')return serializeCsv(GRAMMAR_COLUMNS,[{title:'For et since',topic:'Durée et point de départ',level:'B1',summary:'For indique une durée ; since indique le point de départ.',structure:'have/has + participe passé + for/since',example:'I have worked here for three years.',example_fr:'Je travaille ici depuis trois ans.',common_mistake:'Ne pas dire since three years.',tip:'For = combien de temps ? Since = depuis quand ?',source:'Mon cours'}]);
  if(kind==='vocabulary')return serializeCsv(['english','french','category','example','example_fr','note','source'],[{english:'deadline',french:'date limite / échéance',category:'Travail',example:'The deadline is Friday.',example_fr:'La date limite est vendredi.',note:'By Friday = au plus tard vendredi.',source:'Ma séance'}]);
  throw appError('Type de modèle inconnu.');
};

export const prepareLibraryImport=(state,payload) => {
  if(!payload || !['grammar','vocabulary'].includes(payload.kind))throw appError('Choisis Vocabulaire ou Grammaire.');
  const kind=payload.kind;
  if(typeof payload.csv!=='string' || !payload.csv.trim())throw appError('Le fichier CSV est vide.');
  if(Buffer.byteLength(payload.csv,'utf8')>MAX_CSV_BYTES)throw appError('Le CSV dépasse 2 Mo.',413);
  const csv=payload.csv.replace(/^\uFEFF/,'').replace(/^\s*```(?:csv|text)?\s*\n/i,'').replace(/\n```\s*$/,'').trim();
  let rows;
  try{rows=readCsv(csv,{delimiter:separator(csv),maxRows:5001,maxBytes:MAX_CSV_BYTES});}catch(error){throw appError(error.message);}
  if(rows.length<2)throw appError('Ajoute un en-tête et au moins une entrée.');
  const headers=rows[0].map(headerKey);
  if(new Set(headers).size!==headers.length || headers.some((h)=>!h))throw appError('Les noms de colonnes doivent être non vides et uniques.');
  rows.slice(1).forEach((row,index)=>{if(row.length!==headers.length)throw appError(`Entrée ${index+1} : nombre de colonnes incorrect. Vérifie les guillemets.`);});
  const filename=text(payload.filename || 'import.csv','Nom du fichier',200).replace(/[\\/]/g,'_');
  const title=text(payload.title || filename.replace(/\.csv$/i,'').replace(/[_-]/g,' '),'Titre',160,true);
  const description=text(payload.description,'Description',1000);
  const level=text(payload.level || 'B1','Niveau',10);
  if(!LEVELS.includes(level))throw appError('Niveau attendu : A1, A2, B1, B2 ou C1.');
  const records=[];
  if(kind==='vocabulary'){
    if(!headers.some((h)=>['english','anglais','en','word','mot','motanglais','terme'].includes(h)) || !headers.some((h)=>['french','francais','fr','translation','traduction','traductionfrancaise'].includes(h)))throw appError('Un CSV de vocabulaire doit contenir english et french (ou anglais et français). Pour une règle, choisis Grammaire.');
    const parsed=parseVocabularyCsv(csv);
    if(parsed.errors.length)throw appError(parsed.errors.slice(0,5).join('\n'));
    records.push(...parsed.words);
  }else{
    if(rows.length>501)throw appError('Un import est limité à 500 fiches de grammaire.');
    const mapped=headers.map((h)=>ALIASES[h]||'');
    if(!mapped.includes('title') || !mapped.includes('summary'))throw appError('Un CSV de grammaire doit contenir title et summary (ou titre et regle).');
    const known=mapped.filter(Boolean);
    if(new Set(known).size!==known.length)throw appError('Deux colonnes désignent le même champ de grammaire.');
    rows.slice(1).forEach((row,index)=>{
      try{
        const ownFormat = headers.includes('csvformat') && row[headers.indexOf('csvformat')]==='valen-library-v1';
        const item=Object.fromEntries(mapped.flatMap((h,i)=>h?[[h,ownFormat && row[i].startsWith("'") ? row[i].slice(1) : row[i]]]:[]));
        const summary=text(item.summary,'Règle',8000,true);
        const fields=[['structure','STRUCTURE'],['example','EXEMPLE ANGLAIS'],['example_fr','TRADUCTION'],['common_mistake','ERREUR À ÉVITER'],['tip','À RETENIR']].map(([key,label])=>{const v=text(item[key],label,1000);return v?`${label}\n${v}`:'';}).filter(Boolean);
        const result={title:text(item.title,'Titre',160,true),topic:text(item.topic || item.title,'Thème',160,true),level:text(item.level || level,'Niveau',10),summary:[summary,...fields].join('\n\n'),source:text(item.source || `Import CSV / ${filename}`,'Source',180)};
        if(!LEVELS.includes(result.level))throw appError('Niveau attendu : A1, A2, B1, B2 ou C1.');
        if(result.summary.length>12000)throw appError('La fiche complète dépasse 12 000 caractères.');
        records.push(result);
      }catch(error){throw appError(`Entrée ${index+1} : ${error.message}`);}
    });
  }
  const semantic=(record)=>kind==='vocabulary'?vocabularyKey(record):fingerprint([record.title,record.topic,record.level,record.summary]);
  const unique=new Map(records.map((row)=>[semantic(row),row]));
  const items=[...unique.values()];
  // Pas de date, nom de fichier ou identifiant aleatoire dans l'empreinte : reimport stable.
  const identity=items.map(semantic).sort();
  const id=`collection-${fingerprint([kind,identity])}`;
  const knownWords=new Set(state.words.map(vocabularyKey));
  const knownLessons=new Set(state.lessons.map((item)=>fingerprint([item.title,item.topic,item.level,item.summary])));
  const existing=items.filter((row)=>kind==='vocabulary'?knownWords.has(vocabularyKey(row)):knownLessons.has(semantic(row))).length;
  const preview={collection_id:id,kind,title,description,level,filename,input_count:records.length,items_count:items.length,new_count:items.length-existing,existing_count:existing,duplicate_count:records.length-items.length,already_imported:state.collections.some((row)=>row.id===id),preview:items.slice(0,5).map((row)=>kind==='vocabulary'?{english:row.english,french:row.french,category:row.category}:{title:row.title,level:row.level,summary:row.summary})};
  return {items,preview};
};

export const applyLibraryImport=(current,payload) => {
  const {items,preview}=prepareLibraryImport(current,payload);
  if(preview.already_imported)return {state:current,result:{...preview,added:0,already_imported:true}};
  const now=new Date().toISOString();
  const state={...current,collections:[...current.collections],collectionItems:[...current.collectionItems],lessons:[...current.lessons]};
  let ids=[];
  if(payload.kind==='vocabulary'){
    const merged=mergeVocabulary(state.words,items);state.words=merged.words;
    const map=new Map(state.words.map((row)=>[vocabularyKey(row),row.id]));
    ids=items.map((row)=>map.get(vocabularyKey(row)));
  }else{
    const map=new Map(state.lessons.map((row)=>[fingerprint([row.title,row.topic,row.level,row.summary]),row.id]));
    for(const row of items){const key=fingerprint([row.title,row.topic,row.level,row.summary]);if(!map.has(key)){const id=`grammar-${key}`;state.lessons.push({...row,id,created_at:now});map.set(key,id);}ids.push(map.get(key));}
  }
  state.collections.push({id:preview.collection_id,kind:preview.kind,title:preview.title,description:preview.description,level:preview.level,filename:preview.filename,created_at:now});
  state.collectionItems.push(...ids.map((id,index)=>({id:`link-${fingerprint([preview.collection_id,id])}`,collection_id:preview.collection_id,item_type:preview.kind==='vocabulary'?'word':'lesson',item_id:id,position:String(index)})));
  return {state,result:{...preview,added:preview.new_count}};
};
export const validateLibraryState=(state) => {
  const fail=()=>{throw new Error('Bibliotheque CSV non valide.');};
  const cols=new Map(state.collections.map((r)=>[r.id,r]));const words=new Set(state.words?.map((r)=>r.id) || []);const lessons=new Set(state.lessons.map((r)=>r.id));const pairs=new Set();
  for(const row of state.collections)if(!['vocabulary','grammar'].includes(row.kind)||!row.title||!LEVELS.includes(row.level)||Number.isNaN(Date.parse(row.created_at)))fail();
  for(const row of state.collectionItems){const col=cols.get(row.collection_id);const pair=`${row.collection_id}:${row.item_id}`;
    if(!col || !/^\d+$/.test(row.position) || row.item_type!==(col.kind==='vocabulary'?'word':'lesson') || (row.item_type==='lesson' && !lessons.has(row.item_id)) || pairs.has(pair))fail();
    // Un mot supprime du carnet peut rester reference : la vue ignore ces liens sans detruire l'import.
    pairs.add(pair);
  }
  for(const row of state.lessonProgress)if(!lessons.has(row.id)||!['new','learning','done'].includes(row.status)||Number.isNaN(Date.parse(row.updated_at)))fail();
};
const lessonCard=(state,row) => {
  const exercises=state.exercises.filter((q)=>q.lesson_id===row.id);
  const answers=new Map(state.attempts.map((r)=>[r.exercise_id,r]));
  return {...row,status:state.lessonProgress.find((r)=>r.id===row.id)?.status || 'new',exercise_count:exercises.length,answered:exercises.filter((q)=>answers.has(q.id)).length};
};
export const collectionSnapshot=(state,id) => {
  if(id==='all-vocabulary')return {id,kind:'vocabulary',title:'Tout mon vocabulaire',description:'Le carnet complet, toutes origines confondues.',words:state.words};
  if(id==='all-grammar')return {id,kind:'grammar',title:'Toutes mes leçons',description:'Fiches importées et leçons créées dans l’Atelier IA.',lessons:state.lessons.map((row)=>lessonCard(state,row))};
  const col=state.collections.find((r)=>r.id===id);
  if(!col)throw appError('Collection introuvable.',404);
  const ids=state.collectionItems.filter((r)=>r.collection_id===id).sort((a,b)=>Number(a.position)-Number(b.position)).map((r)=>r.item_id);
  const records=new Map((col.kind==='vocabulary'?state.words:state.lessons).map((r)=>[r.id,r]));
  const items=ids.map((i)=>records.get(i)).filter(Boolean);
  return {...col,...(col.kind==='vocabulary'?{words:items}:{lessons:items.map((row)=>lessonCard(state,row))})};
};
export const librarySnapshot=(state) => {
  const summary=(col)=>{
    const data=collectionSnapshot(state,col.id);const items=data.words || data.lessons;
    return {...col,count:items.length,done:data.lessons?items.filter((r)=>r.status==='done').length:items.filter((r)=>Number(r.stage)>=3).length};
  };
  return {collections:[summary({id:'all-vocabulary',kind:'vocabulary',title:'Tout mon vocabulaire',description:'Tous les mots du carnet, dont les ajouts IA.',system:true}),summary({id:'all-grammar',kind:'grammar',title:'Toutes mes leçons',description:'Fiches de cours et quiz, toutes origines confondues.',system:true}),...state.collections.slice().reverse().map(summary)],total_words:state.words.length,total_lessons:state.lessons.length,completed_lessons:state.lessonProgress.filter((r)=>r.status==='done').length};
};
export const applyLessonProgress=(current,payload) => {
  if(!payload || !current.lessons.some((r)=>r.id===payload.id))throw appError('Leçon introuvable.',404);
  if(!['new','learning','done'].includes(payload.status))throw appError('Statut de leçon non valide.');
  const row={id:payload.id,status:payload.status,updated_at:new Date().toISOString()};
  return {state:{...current,lessonProgress:[...current.lessonProgress.filter((r)=>r.id!==payload.id),row]},result:row};
};

// Pas de surveillance d'un repertoire arbitraire : deux sous-dossiers fixes, liens symboliques refuses.
export const scanImportDirectory=async (store,directory) => {
  if(!directory)throw appError('Le dossier imports n’est pas configuré.',503);
  const results=[];let seen=0;
  for(const [folder,kind] of [['vocabulaire','vocabulary'],['grammaire','grammar']]){
    const base=path.join(directory,folder);let entries;
    try{const stat=await fs.lstat(base);if(!stat.isDirectory() || stat.isSymbolicLink())throw new Error('Dossier non autorise.');entries=await fs.readdir(base,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;results.push({file:folder,status:'error',error:'Dossier illisible ou lien symbolique refusé.'});continue;}
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name)).filter((e)=>/\.csv$/i.test(e.name))){
      if(++seen>40){results.push({file:folder,status:'error',error:'Limite de 40 fichiers par lecture atteinte.'});return {results};}
      const name=`${folder}/${entry.name}`;
      try{
        const filename=path.join(base,entry.name);const stat=await fs.lstat(filename);
        if(!entry.isFile() || !stat.isFile() || stat.isSymbolicLink())throw appError('Seuls les fichiers CSV ordinaires sont autorisés.');
        if(stat.size>MAX_CSV_BYTES)throw appError('Le fichier dépasse 2 Mo.');
        const csv=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(filename));
        const result=await store.importLibrary({kind,csv,filename:entry.name});
        results.push({file:name,status:result.already_imported?'unchanged':'imported',...result});
      }catch(error){results.push({file:name,status:'error',error:error.status?error.message:'Fichier non lisible en UTF-8 ou sauvegarde indisponible.'});}
    }
  }
  return {results};
};

// Export exploitable dans un tableur et reimportable, sans appel a une IA.
export const exportCollectionCsv=(state,id) => {
  const collection=collectionSnapshot(state,id);
  const protect=(value)=>/^[\s]*[=+\-@\t\r\n']/.test(String(value ?? '')) ? `'${value}` : value;
  const records=collection.words || collection.lessons;
  const columns=collection.kind==='vocabulary' ? CSV_COLUMNS.filter((c)=>c!=='history') : ['title','topic','level','summary','source','csv_format'];
  return serializeCsv(columns,records.map((item)=>Object.fromEntries(columns.map((key)=>[key,protect(key==='csv_format' ? (collection.kind==='vocabulary'?'wordbloom-v1':'valen-library-v1') : item[key])]))));
};
