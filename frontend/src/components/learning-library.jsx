import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, FileSpreadsheet, FolderOpen, GraduationCap, LoaderCircle, RefreshCw, Search, Upload, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AppSelect, Modal, Status } from '@/components/vocabulary-ui';
import { LessonPlayer } from '@/components/ai-studio';
import { requestJson } from '@/lib/api';
import { normalizeAnswer } from '@shared/vocabulary.js';

const STATUSES=[{value:'new',label:'À découvrir'},{value:'learning',label:'En cours'},{value:'done',label:'Acquise'}];
const stateLabel=(value)=>STATUSES.find((item)=>item.value===value)?.label || 'À découvrir';
const typeLabel=(value)=>value==='grammar'?'Grammaire':'Vocabulaire';

const CsvImport = ({ initialKind, onClose, onImported }) => {
  const [kind,setKind]=useState(initialKind);
  const [filename,setFilename]=useState('');
  const [title,setTitle]=useState('');
  const [csv,setCsv]=useState('');
  const [level,setLevel]=useState('B1');
  const [preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const input=useRef(null);
  const locked=useRef(false);
  const change=(setter,value)=>{setter(value);setPreview(null);setError('');};
  const fileChange=async(file)=>{
    if(!file || locked.current)return;
    if(file.size>2*1024*1024){setError('Le CSV doit faire moins de 2 Mo.');return;}
    try{
      const bytes=await file.arrayBuffer();const contents=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      setCsv(contents);setFilename(file.name);setTitle(file.name.replace(/\.csv$/i,'').replace(/[_-]/g,' '));setPreview(null);setError('');
    }catch{setError('Ce fichier ne peut pas être lu. Enregistre-le au format CSV UTF-8.');}
  };
  const submit=async(event)=>{
    event.preventDefault();if(locked.current)return;locked.current=true;setBusy(true);setError('');
    const payload={kind,csv,title,level,filename:filename || 'collage.csv'};
    try{
      if(!preview){setPreview(await requestJson('/api/library/preview',{body:payload}));}
      else{const result=await requestJson('/api/library/import',{body:payload});await onImported(result);}
    }catch(issue){setError(issue.message);}finally{setBusy(false);locked.current=false;}
  };
  return <Modal title="Ajouter un CSV à ma bibliothèque" description="Une collection par fichier. Les doublons sont reconnus et la progression existante est conservée." onClose={()=>{if(!locked.current)onClose();}}>
    <form onSubmit={submit} className="library-import-form">
      <fieldset disabled={busy}>
        <div className="library-form-grid"><div className="form-field"><Label htmlFor="library-kind">Type de contenu</Label><AppSelect id="library-kind" value={kind} onValueChange={(v)=>change(setKind,v)} options={[{value:'vocabulary',label:'Vocabulaire : mots et traductions'},{value:'grammar',label:'Grammaire : règles et exemples'}]}/></div><div className="form-field"><Label htmlFor="library-level">Niveau par défaut</Label><AppSelect id="library-level" value={level} onValueChange={(v)=>change(setLevel,v)} options={['A1','A2','B1','B2','C1']}/></div></div>
        <div className="library-drop" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();fileChange(e.dataTransfer.files?.[0]);}}><FileSpreadsheet size={28}/><strong>{filename || 'Dépose ton CSV ici'}</strong><span>UTF-8 · virgule, point-virgule ou tabulation · 2 Mo maximum</span><Button type="button" variant="outline" onClick={()=>input.current?.click()}><Upload size={16}/>Choisir un fichier</Button><input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choisir un fichier CSV" onChange={(e)=>fileChange(e.target.files?.[0])}/></div>
        <div className="form-field"><Label htmlFor="library-title">Nom de la collection</Label><Input id="library-title" required maxLength={160} value={title} placeholder="Séance 8 — Temps du passé" onChange={(e)=>change(setTitle,e.target.value)}/></div>
        <div className="form-field"><Label htmlFor="library-csv">Ou colle le CSV</Label><Textarea id="library-csv" rows={5} required value={csv} onChange={(e)=>change(setCsv,e.target.value)} spellCheck={false} placeholder={kind==='grammar'?'title;topic;level;summary;example;example_fr':'english;french;category;example;example_fr'}/></div>
        <a className="library-template" href={`/api/library/template?kind=${kind}`} download><Download size={15}/>Télécharger le modèle {typeLabel(kind).toLowerCase()}</a>
      </fieldset>
      {error && <div role="alert" className="ai-error library-preserve">{error}</div>}
      {preview && <div className="library-preview" aria-live="polite"><div><strong>Aperçu : {preview.items_count} {kind==='grammar'?'fiche(s)':'mot(s)'}</strong><p>{preview.new_count} nouveau(x) · {preview.existing_count} déjà présent(s) · {preview.duplicate_count} doublon(s) dans le fichier.</p></div>{preview.already_imported && <p>Cette collection a déjà été importée. Aucun doublon ne sera créé.</p>}<div className="library-preview-rows">{preview.preview.map((item,i)=><div key={i}><strong>{item.english || item.title}</strong><span>{item.french || item.summary.slice(0,160)}</span></div>)}</div></div>}
      <div className="library-form-footer"><Button variant="ghost" type="button" disabled={busy} onClick={onClose}>Annuler</Button><Button type="submit" disabled={busy || !csv.trim() || !title.trim()}>{busy?<LoaderCircle size={16} className="spinner"/>:<Check size={16}/>} {busy?'Traitement…':preview?'Confirmer l’import':'Vérifier le CSV'}</Button></div>
    </form>
  </Modal>;
};

export const LearningLibrary = ({ speak, onPractice, onVocabularyChange, onOpenAi, importInitially=false, onImportOpened }) => {
  const [pane,setPane]=useState('vocabulary');
  const [library,setLibrary]=useState(null);
  const [collection,setCollection]=useState(null);
  const [lesson,setLesson]=useState(null);
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState('all');
  const [showImport,setShowImport]=useState(importInitially);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [scanResults,setScanResults]=useState(null);
  const [visible,setVisible]=useState(30);
  const live=useRef(false);const locked=useRef(false);const sequence=useRef(0);
  const reload=useCallback(async()=>{
    const id=++sequence.current;
    try{const data=await requestJson('/api/library');if(live.current && id===sequence.current){setLibrary(data);setError('');}}
    catch(issue){if(live.current && id===sequence.current)setError(issue.message);}
    finally{if(live.current && id===sequence.current)setLoading(false);}
  },[]);
  useEffect(()=>{live.current=true;reload();return()=>{live.current=false;};},[reload]);
  useEffect(()=>{if(importInitially){setShowImport(true);onImportOpened?.();}},[importInitially,onImportOpened]);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible' && !locked.current && !showImport && !lesson && !collection)reload();};const timer=setInterval(refresh,20000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[reload,showImport,lesson,collection]);
  useEffect(()=>{setSearch('');setVisible(30);setStatusFilter('all');},[pane,collection?.id]);
  const run=async(operation)=>{
    if(locked.current)return;locked.current=true;setBusy(true);setError('');
    try{await operation();}catch(issue){if(live.current)setError(issue.message);}finally{locked.current=false;if(live.current)setBusy(false);}
  };
  const openCollection=(id)=>run(async()=>{setCollection(await requestJson(`/api/library/collection?id=${encodeURIComponent(id)}`));setLesson(null);window.scrollTo({top:0,behavior:'smooth'});});
  const openLesson=(item)=>run(async()=>{const data=await requestJson(`/api/learning/lesson?id=${encodeURIComponent(item.id)}`);setLesson({...data,status:item.status || 'new'});window.scrollTo({top:0,behavior:'smooth'});});
  const changeStatus=(status)=>run(async()=>{
    const row=await requestJson('/api/library/progress',{body:{id:lesson.id,status}});
    setLesson((current)=>({...current,status:row.status}));
    setCollection((current)=>current?{...current,lessons:current.lessons.map((item)=>item.id===row.id?{...item,status:row.status}:item)}:current);
    await reload();toast.success('Progression de la leçon enregistrée.');
  });
  const scan=()=>run(async()=>{
    const result=await requestJson('/api/library/scan',{body:{},timeout:90000});setScanResults(result.results);await reload();await onVocabularyChange();
    if(result.results.some((r)=>r.status==='error'))toast.error('Certains fichiers n’ont pas pu être importés. Consulte le bilan.');else toast.success('Lecture du dossier imports terminée.');
  });
  const imported=async(result)=>{
    setShowImport(false);setPane(result.kind);setCollection(null);setLesson(null);await reload();await onVocabularyChange();
    toast.success(result.already_imported?'Collection déjà présente, progression conservée.':`${result.title} : ${result.items_count} éléments classés.`);
    openCollection(result.collection_id);
  };
  if(lesson)return <section className="learning-library"><div className="library-reading-status"><span>Mon suivi de cette fiche</span><AppSelect aria-label="Statut de la fiche" value={lesson.status} onValueChange={changeStatus} options={STATUSES} disabled={busy}/></div>{error && <p role="alert" className="ai-error">{error}</p>}<LessonPlayer key={lesson.id} lesson={lesson} speak={speak} onClose={()=>{setLesson(null);reload();}} onChanged={reload}/></section>;
  const query=normalizeAnswer(search);
  const matches=(value)=>normalizeAnswer(value).includes(query);
  const collectionItems=collection?.words?.filter((row)=>matches(`${row.english} ${row.french} ${row.category}`)) || collection?.lessons?.filter((row)=>matches(`${row.title} ${row.topic} ${row.summary}`) && (statusFilter==='all' || row.status===statusFilter)) || [];
  return <section className="learning-library">
    {collection && <Button variant="ghost" onClick={()=>{setCollection(null);reload();}}><ArrowLeft size={16}/>Ma bibliothèque</Button>}
    <div className="page-heading library-heading"><div><p className="eyebrow">MES COURS · MES SÉANCES · MES CSV</p><h1>{collection?.title || 'Ma bibliothèque'}</h1><p>{collection?.description || 'Retrouve tes mots, comprends les règles et avance à ton rythme.'}</p></div><Button onClick={()=>setShowImport(true)} disabled={busy}><Upload size={17}/>Importer un CSV</Button></div>
    {error && <div role="alert" className="ai-error">{error}<Button variant="outline" size="sm" onClick={reload}>Réessayer</Button></div>}
    {(loading || busy) && <p className="ai-inline-status" role="status"><LoaderCircle className="spinner" size={17}/>{busy?'Mise à jour…':'Chargement de la bibliothèque…'}</p>}
    {!collection && <div className="library-overview"><Card><BookOpen size={21}/><div><strong>{library?.total_words || 0}</strong><span>mots dans le carnet</span></div></Card><Card><GraduationCap size={21}/><div><strong>{library?.total_lessons || 0}</strong><span>fiches et leçons</span></div></Card><Card><Check size={21}/><div><strong>{library?.completed_lessons || 0}</strong><span>leçons marquées acquises</span></div></Card></div>}
    {collection ? <>
      <div className="library-toolbar"><div className="library-search"><Search size={17}/><Input aria-label="Rechercher dans cette collection" placeholder={collection.kind==='grammar'?'Rechercher une règle…':'Rechercher un mot…'} value={search} onChange={(e)=>{setSearch(e.target.value);setVisible(30);}}/></div>{collection.kind==='grammar'?<AppSelect aria-label="Filtrer le suivi" value={statusFilter} onValueChange={setStatusFilter} options={[{value:'all',label:'Tous les statuts'},...STATUSES]}/>:<div className="library-practice-actions"><Button disabled={busy || !collection.words.length} onClick={()=>onPractice('cards',collection.words)}>Cartes mémoire</Button><Button variant="outline" disabled={busy || !collection.words.length} onClick={()=>onPractice('quiz',collection.words)}>QCM</Button><Button variant="outline" disabled={busy || !collection.words.length} onClick={()=>onPractice('write',collection.words)}>Écrire</Button></div>}</div>
      <a className="library-template" href={`/api/library/export?id=${encodeURIComponent(collection.id)}`} download><Download size={15}/>Exporter cette collection en CSV</a>
      <p className="library-count">{collectionItems.length} {collection.kind==='grammar'?'fiche(s)':'mot(s)'} dans cette vue</p>
      <div className="library-items">{collectionItems.slice(0,visible).map((item)=>collection.kind==='grammar'?<Card className="library-lesson-card" key={item.id}><div className="library-card-meta"><Badge variant="outline">{item.level}</Badge><Badge variant="secondary">{stateLabel(item.status)}</Badge></div><h2>{item.title}</h2><p>{item.topic}</p><small>{item.exercise_count ? `${item.exercise_count} questions corrigées`:'Fiche de cours avec exemples'}</small><Button variant="outline" onClick={()=>openLesson(item)} disabled={busy}>Lire la leçon<ArrowRight size={16}/></Button></Card>:<Card key={item.id} className="library-word-card"><div className="library-card-meta"><Badge variant="outline">{item.category}</Badge><Status word={item}/></div><div className="library-word-heading"><h2 lang="en">{item.english}</h2><Button size="icon" variant="ghost" aria-label={`Écouter ${item.english}`} onClick={()=>speak(item.english)}><Volume2 size={19}/></Button></div><p className="library-translation">{item.french}</p>{item.example && <div className="library-example"><p lang="en">{item.example}</p><span>{item.example_fr}</span></div>}{item.note && <small className="library-preserve">{item.note}</small>}</Card>)}</div>
      {!collectionItems.length && <Card className="panel library-empty"><Search size={27}/><h2>Aucun résultat</h2><p>Modifie la recherche ou le filtre.</p></Card>}
      {collectionItems.length>visible && <Button variant="outline" className="library-load-more" onClick={()=>setVisible((n)=>n+30)}>Afficher la suite</Button>}
    </>:<>
      <Tabs value={pane} onValueChange={(value)=>{setPane(value);setCollection(null);}} className="library-tabs">
        <div className="library-toolbar"><TabsList aria-label="Types de leçons"><TabsTrigger value="vocabulary"><BookOpen size={16}/>Vocabulaire</TabsTrigger><TabsTrigger value="grammar"><GraduationCap size={16}/>Grammaire</TabsTrigger></TabsList><div className="library-search"><Search size={17}/><Input aria-label="Rechercher une collection" placeholder="Rechercher une collection…" value={search} onChange={(e)=>setSearch(e.target.value)}/></div></div>
        {['vocabulary','grammar'].map((kind)=><TabsContent value={kind} key={kind}><div className="library-collections">{library?.collections.filter((item)=>item.kind===kind && matches(`${item.title} ${item.description}`)).map((item)=><Card className={`library-collection-card ${item.system?'library-system':''}`} key={item.id}><div className="library-card-meta"><div className="library-folder-icon">{kind==='grammar'?<GraduationCap size={24}/>:<BookOpen size={24}/>}</div><Badge variant="outline">{item.system?'Vue complète':'Collection CSV'}</Badge></div><h2>{item.title}</h2><p>{item.description || (kind==='grammar'?'Règles, exemples et points à retenir.':'Tes mots et leurs traductions, prêts à réviser.')}</p><div className="library-collection-bottom"><span><strong>{item.count}</strong> {kind==='grammar'?'leçons':'mots'}{kind==='grammar' && item.done>0?` · ${item.done} acquises`:''}</span><Button variant="outline" disabled={busy} onClick={()=>openCollection(item.id)}>Ouvrir<ArrowRight size={16}/></Button></div>{item.filename && <small className="library-file"><FileSpreadsheet size={13}/>{item.filename}</small>}</Card>)}</div>{!loading && !library?.collections.some((item)=>item.kind===kind && matches(`${item.title} ${item.description}`)) && <Card className="panel library-empty"><FolderOpen size={28}/><h2>Aucune collection trouvée</h2><p>Importe ton premier CSV ou change ta recherche.</p></Card>}</TabsContent>)}
      </Tabs>
      <Card className="panel library-import-help"><div><FolderOpen size={25}/><h2>Ajouter des fichiers au projet</h2></div><p>Dépose tes CSV dans le dossier correspondant sur le serveur. Ils sont lus au démarrage, ou avec ce bouton, sans redéployer le site.</p><div className="library-folders"><code>imports/vocabulaire/</code><code>imports/grammaire/</code></div><div className="library-help-actions"><Button variant="outline" disabled={busy} onClick={scan}><RefreshCw size={16}/>Lire le dossier imports</Button><Button variant="ghost" onClick={onOpenAi}>Créer du contenu avec l’IA<ArrowRight size={16}/></Button></div><small>L’import et la lecture des leçons ne font aucun appel à OpenAI. Les doublons n’effacent pas tes résultats.</small></Card>
      {scanResults && <Card className="panel library-scan-results"><h2>Bilan des fichiers du serveur</h2>{!scanResults.length && <p>Aucun fichier CSV dans les deux sous-dossiers.</p>}{scanResults.map((row,i)=><div key={`${row.file}-${i}`}><strong>{row.file}</strong><span className={row.status==='error'?'library-error-text':''}>{row.status==='error'?row.error:row.status==='unchanged'?'Déjà importé — inchangé':`${row.items_count} éléments classés`}</span></div>)}</Card>}
    </>}
    {showImport && <CsvImport initialKind={collection?.kind || pane} onClose={()=>setShowImport(false)} onImported={imported}/>}
  </section>;
};
