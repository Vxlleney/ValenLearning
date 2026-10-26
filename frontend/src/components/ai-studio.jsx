import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleHelp, Download, GraduationCap, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Volume2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AppSelect } from '@/components/vocabulary-ui';
import { requestId, requestJson } from '@/lib/api';

const LEVELS = [{value:'A1',label:'A1 · Débutant'},{value:'A2',label:'A2 · Élémentaire'},{value:'B1',label:'B1 · Intermédiaire'},{value:'B2',label:'B2 · Objectif ingénieur'},{value:'C1',label:'C1 · Avancé'}];
const DATE = new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const EXPORTS = [['lecons.csv','Leçons'],['exercices.csv','Exercices'],['resultats-exercices.csv','Résultats'],['corrections.csv','Corrections'],['utilisation-ia.csv','Utilisation IA']];
const labels = {vocabulary:'Générer et ajouter les mots',lesson:'Créer ma leçon',correction:'Corriger et enregistrer'};

export const LessonPlayer = ({ lesson, speak, onClose, onChanged }) => {
  const [answers,setAnswers] = useState(() => Object.fromEntries(lesson.exercises.filter((item) => item.last_attempt).map((item) => [item.id,item.last_attempt])));
  const [busy,setBusy] = useState(null);
  const [error,setError] = useState('');
  const events = useRef({});
  const saving = useRef(false);
  const answered = Object.keys(answers).length;
  const correct = Object.values(answers).filter((item) => item.correct).length;
  const answer = async (exercise,index) => {
    if (saving.current || answers[exercise.id]) return;
    saving.current=true; setBusy(exercise.id);setError('');
    // Le meme identifiant est reutilise apres une coupure pour eviter les doublons.
    const event = events.current[exercise.id] || {id:requestId(),selected:index};
    events.current[exercise.id]=event;
    try {
      const result = await requestJson('/api/learning/answer',{body:{id:event.id,exercise_id:exercise.id,selected_index:event.selected}});
      setAnswers((current) => ({...current,[exercise.id]:result}));
      onChanged();
    } catch (issue) {setError(issue.message);} finally {setBusy(null);saving.current=false;}
  };
  return <section className="ai-lesson-player">
    <Button variant="ghost" onClick={onClose}><ArrowLeft size={16}/>Toutes mes leçons</Button>
    <div className="page-heading"><div><p className="eyebrow">LEÇON ENREGISTRÉE · {lesson.level}</p><h1>{lesson.title}</h1><p>{lesson.source} · Lecture et quiz sans appel IA</p></div><Badge variant="secondary">{lesson.exercises.length} questions</Badge></div>
    <Card className="panel ai-course"><div className="panel-heading"><h2>Comprendre avant de pratiquer</h2><BookOpen size={21}/></div><div className="ai-preserve">{lesson.summary}</div></Card>
    {lesson.exercises.length > 0 ? <>
    <div className="ai-quiz-heading"><div><h2>À toi de jouer</h2><p>{answered}/{lesson.exercises.length} réponses · {correct} correcte{correct > 1 ? 's' : ''}</p></div><Button variant="outline" disabled={!!busy || !answered} onClick={() => {setAnswers({});events.current={};setError('');}}>Recommencer</Button></div>
    <Progress value={answered/lesson.exercises.length*100} aria-label="Progression du quiz"/>
    {error && <p className="ai-error" role="alert">{error} Le choix précédent est conservé pour un nouvel essai sans doublon.</p>}
    <div className="ai-questions">{lesson.exercises.map((exercise,index) => {
      const result=answers[exercise.id];
      return <Card className="panel ai-question" key={exercise.id}>
        <div className="ai-question-title"><Badge variant="outline">{String(index+1).padStart(2,'0')}</Badge><h3>{exercise.question}</h3></div>
        <div className="ai-answer-options" role="group" aria-label={`Choix pour la question ${index+1}`}>{exercise.options.map((option,optionIndex) => <Button type="button" variant="outline" key={optionIndex} disabled={!!busy || !!result}
          className={`ai-option ${result?.correct_index === optionIndex ? 'is-correct' : result?.selected_index === optionIndex ? 'is-wrong' : ''}`}
          onClick={() => answer(exercise,optionIndex)}><span className="ai-option-letter">{'ABCD'[optionIndex]}</span><span>{option}</span>{result?.correct_index === optionIndex && <Check size={18}/>}</Button>)}</div>
        {busy === exercise.id && <p role="status" className="ai-inline-status"><LoaderCircle className="spinner" size={16}/>Enregistrement de ta réponse…</p>}
        {result && <div className={`ai-feedback ${result.correct ? 'good' : 'again'}`} role="status"><strong>{result.correct ? 'Bien joué !' : `La bonne réponse est ${'ABCD'[result.correct_index]}.`}</strong><p>{result.explanation}</p><Button variant="ghost" size="sm" onClick={() => speak(exercise.options[result.correct_index])}><Volume2 size={15}/>Écouter la réponse</Button></div>}
      </Card>;
    })}</div>
    {answered===lesson.exercises.length && <Card className="panel ai-finished"><GraduationCap size={30}/><div><h2>Leçon terminée : {correct}/{lesson.exercises.length}</h2><p>Les résultats sont enregistrés sur ton serveur. Tu les retrouveras sur tes autres appareils.</p></div></Card>}    </> : <Card className="panel ai-tip-card"><h3>Lire, comprendre, réutiliser</h3><p>Cette fiche ne contient pas de QCM. Relis la règle, cache les exemples, puis écris deux phrases en anglais. Dans Ma bibliothèque, le suivi de la fiche permet de la marquer en cours ou acquise.</p></Card>}

  </section>;
};

export const AiStudio = ({ onVocabularyChange, onOpenWords, onBackup, speak }) => {
  const [kind,setKind]=useState('vocabulary');
  const [mode,setMode]=useState('words');
  const [level,setLevel]=useState('B1');
  const [count,setCount]=useState('8');
  const [texts,setTexts]=useState({vocabulary:'',lesson:'',correction:''});
  const [withVocabulary,setWithVocabulary]=useState(false);
  const [status,setStatus]=useState(null);
  const [library,setLibrary]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [loadError,setLoadError]=useState('');
  const [busy,setBusy]=useState(false);
  const [lesson,setLesson]=useState(null);
  const [lastResult,setLastResult]=useState(null);
  const [opening,setOpening]=useState('');
  const live=useRef(false);
  const busyRef=useRef(false);
  const readNumber=useRef(0);
  const reload = useCallback(async () => {
    const sequence=++readNumber.current;
    try {
      const [nextStatus,nextLibrary]=await Promise.all([requestJson('/api/ai/status'),requestJson('/api/learning')]);
      if (!live.current || readNumber.current!==sequence) return;
      setStatus(nextStatus);setLibrary(nextLibrary);setLoadError('');
    } catch (issue) {if(live.current && readNumber.current===sequence)setLoadError(issue.message);}
    finally {if(live.current && readNumber.current===sequence)setLoading(false);}
  },[]);
  useEffect(() => {
    live.current=true;reload();
    const refresh = () => {if(document.visibilityState==='visible' && !busyRef.current)reload();};
    const timer=setInterval(refresh,20000);
    window.addEventListener('focus',refresh);
    return () => {live.current=false;readNumber.current+=1;clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[reload]);
  const generate = async (event) => {
    event.preventDefault();
    if(busyRef.current || !status?.configured || loadError) return;
    busyRef.current=true;setBusy(true);setError('');setLastResult(null);
    try {
      const result=await requestJson('/api/ai/generate',{timeout:85000,body:{request_id:requestId(),kind,text:texts[kind],level,mode,count:Number(count),use_vocabulary:withVocabulary && kind!=='correction'}});
      if(!live.current)return;
      setLastResult(result);
      if(result.kind==='vocabulary'){
        await onVocabularyChange();
        toast.success(`${result.added} mot(s) ajouté(s), ${result.skipped} doublon(s) ignoré(s).`);
      }else if(result.kind==='lesson')setLesson(result.lesson);
      else toast.success('Correction enregistrée dans ton CSV.');
      await reload();
    }catch(issue){if(live.current){setError(issue.message);await reload();}}
    finally{busyRef.current=false;if(live.current)setBusy(false);}
  };
  const openLesson=async(id)=>{
    if(opening)return;setOpening(id);setError('');
    try {const value=await requestJson(`/api/learning/lesson?id=${encodeURIComponent(id)}`);if(live.current){setLesson(value);window.scrollTo({top:0,behavior:'smooth'});}}
    catch(issue){if(live.current)setError(issue.message);}finally{if(live.current)setOpening('');}
  };
  if(lesson)return <LessonPlayer key={lesson.id} lesson={lesson} speak={speak} onChanged={reload} onClose={()=>{setLesson(null);reload();}}/>;
  const unavailable=loading || busy || !status?.configured || !!loadError || status.today >= status.daily_limit;
  const content=texts[kind];
  return <section className="ai-studio">
    <div className="page-heading"><div><p className="eyebrow">TON ANGLAIS, SUR MESURE</p><h1>Un professeur dans ton carnet.</h1><p>Crée une fois. Apprends chaque jour. Retrouve tout sur tes appareils.</p></div><Badge className="ai-brand-badge" variant="outline"><Sparkles size={15}/>Atelier OpenAI</Badge></div>
    {loadError && <div className="ai-error" role="alert">{loadError}<Button variant="outline" size="sm" onClick={reload}>Réessayer</Button></div>}
    {loading && <p className="ai-inline-status" role="status"><LoaderCircle className="spinner" size={18}/>Chargement de ton atelier…</p>}
    <div className="ai-layout"><div className="ai-main">
      <Card className="panel ai-generator">
        <div className="panel-heading"><div><h2>Que veux-tu apprendre ?</h2><p>L’IA prépare le contenu. Ton serveur le garde en CSV.</p></div><Sparkles size={22}/></div>
        <Tabs value={kind} onValueChange={(value)=>{setKind(value);setError('');setLastResult(null);}}>
          <TabsList className="ai-tabs"><TabsTrigger value="vocabulary" disabled={busy}>Vocabulaire</TabsTrigger><TabsTrigger value="lesson" disabled={busy}>Leçon & quiz</TabsTrigger><TabsTrigger value="correction" disabled={busy}>Correction</TabsTrigger></TabsList>
          <form onSubmit={generate}>
            <fieldset disabled={busy} className="ai-form">
              <div className="ai-form-options"><div className="form-field"><Label htmlFor="ai-level">Mon niveau</Label><AppSelect id="ai-level" value={level} options={LEVELS} onValueChange={setLevel}/></div>
              {kind==='vocabulary' && <div className="form-field"><Label htmlFor="ai-mode">Comment ajouter ?</Label><AppSelect id="ai-mode" value={mode} onValueChange={setMode} options={[{value:'words',label:'Je donne les mots'},{value:'theme',label:'Je choisis un thème'}]}/></div>}
              {kind==='vocabulary' && mode==='theme' && <div className="form-field ai-count"><Label htmlFor="ai-count">Quantité</Label><AppSelect id="ai-count" value={count} onValueChange={setCount} options={['5','8','10','12']}/></div>}</div>
              <TabsContent value="vocabulary"><div className="form-field"><Label htmlFor="ai-vocabulary">{mode==='words' ? 'Tes mots ou expressions anglais' : 'Le thème à explorer'}</Label><Textarea id="ai-vocabulary" rows={5} maxLength={3000} required={kind==='vocabulary'} value={texts.vocabulary} onChange={(event)=>setTexts((current)=>({...current,vocabulary:event.target.value}))} placeholder={mode==='words' ? 'although\ndeadline\nkeep in mind' : 'Anglais professionnel : réunions, informatique et gestion de projet'}/><small>{mode==='words' ? 'Un mot ou une expression par ligne, 12 au maximum.' : 'L’IA proposera de nouveaux mots utiles sur ce thème.'} Traduction, exemple bilingue et conseil d’usage seront ajoutés automatiquement.</small></div></TabsContent>
              <TabsContent value="lesson"><div className="form-field"><Label htmlFor="ai-lesson">Le sujet de ta leçon</Label><Textarea id="ai-lesson" rows={5} maxLength={3000} required={kind==='lesson'} value={texts.lesson} onChange={(event)=>setTexts((current)=>({...current,lesson:event.target.value}))} placeholder="Comprendre le present perfect et le prétérit, avec des exemples au travail."/><small>Un cours expliqué en français, des exemples et 5 questions corrigées. Pas un test TOEIC officiel.</small></div></TabsContent>
              <TabsContent value="correction"><div className="form-field"><Label htmlFor="ai-correction">Ton texte en anglais</Label><Textarea id="ai-correction" rows={6} maxLength={3000} required={kind==='correction'} value={texts.correction} onChange={(event)=>setTexts((current)=>({...current,correction:event.target.value}))} placeholder="Today I have worked on my application. Employees must changes their passwords."/><small>La correction, la traduction et les explications seront enregistrées pour tes révisions.</small></div></TabsContent>
              {kind!=='correction' && <Label className="ai-checkbox"><input type="checkbox" checked={withVocabulary} onChange={(event)=>setWithVocabulary(event.target.checked)}/><span>Utiliser jusqu’à 20 mots de mon carnet à revoir pour personnaliser la demande.</span></Label>}
              <div className="ai-consent"><ShieldCheck size={18}/><p>Le texte saisi{withVocabulary && kind!=='correction' ? ' et les mots sélectionnés du carnet' : ''} sera envoyé à OpenAI. N’y colle pas de données confidentielles. Un clic lance un appel API facturé séparément de ChatGPT.</p></div>
              <Button type="submit" disabled={unavailable || !content.trim()} className="ai-generate-button">{busy ? <LoaderCircle size={18} className="spinner"/> : <Sparkles size={18}/>} {busy ? 'Création et enregistrement…' : labels[kind]}</Button>
            </fieldset>
          </form>
        </Tabs>
        {error && <div className="ai-error" role="alert">{error}</div>}
        {lastResult?.kind==='vocabulary' && <div className="ai-success" role="status"><Check size={19}/><div><strong>{lastResult.added} mots ajoutés au carnet</strong><p>{lastResult.skipped} doublon(s) ignoré(s). Tes jeux sont prêts.</p></div><Button variant="outline" size="sm" onClick={onOpenWords}>Voir mes mots<ArrowRight size={14}/></Button></div>}
      </Card>
      <div className="section-heading ai-library-heading"><div><h2>Ma bibliothèque de leçons</h2><p>Disponible sans nouvel appel IA, sur tous tes appareils.</p></div><Badge variant="secondary">{library?.lessons.length || 0}</Badge></div>
      <div className="ai-lesson-list">{library?.lessons.map((item)=><Card className="ai-lesson-card" key={item.id}><div className="ai-lesson-icon"><GraduationCap size={23}/></div><div className="ai-lesson-info"><div className="ai-lesson-meta"><Badge variant="outline">{item.level}</Badge><span>{item.exercise_count} questions · {item.answered}/{item.exercise_count} répondues</span></div><h3>{item.title}</h3><p>{item.source} · {DATE.format(new Date(item.created_at))}</p></div><Button variant="outline" disabled={!!opening} onClick={()=>openLesson(item.id)}>{opening===item.id ? <LoaderCircle className="spinner" size={16}/> : <ArrowRight size={16}/>}<span>Ouvrir</span></Button></Card>)}</div>
      {!loading && library?.lessons.length===0 && <Card className="panel ai-empty"><BookOpen size={27}/><p>Ta première leçon t’attend. Choisis un sujet dans l’onglet Leçon & quiz.</p></Card>}
      <div className="section-heading ai-library-heading"><div><h2>Mes corrections enregistrées</h2><p>Relis tes erreurs pour ne plus les refaire.</p></div></div>
      <div className="ai-corrections">{library?.corrections.map((item)=><Card className="ai-correction-card" key={item.id}><details open={lastResult?.correction?.id===item.id}><summary><span>{item.original.slice(0,100)}{item.original.length>100 ? '…' : ''}</span><small>{DATE.format(new Date(item.created_at))}</small></summary><div className="ai-correction-body"><Label>Version corrigée</Label><p className="ai-corrected ai-preserve" lang="en">{item.corrected}</p><Button size="sm" variant="outline" onClick={()=>speak(item.corrected)}><Volume2 size={15}/>Écouter</Button><Label>Traduction</Label><p className="ai-preserve">{item.translation}</p><Label>Comprendre mes erreurs</Label><p className="ai-preserve">{item.explanation}</p><div className="ai-tip"><CircleHelp size={18}/><p>{item.tip}</p></div></div></details></Card>)}</div>
      {!loading && library?.corrections.length===0 && <p className="ai-muted">Aucune correction pour le moment. Tes prochains textes corrigés apparaîtront ici.</p>}
      {(library?.total_corrections || 0)>100 && <p className="ai-muted">Les 100 dernières corrections sont affichées. Le CSV contient l’historique complet.</p>}
    </div><aside className="ai-aside">
      <Card className="panel ai-status-card"><div className="panel-heading"><h3>Mon moteur IA</h3><KeyRound size={19}/></div><Badge variant={status?.configured ? 'secondary' : 'outline'}>{status?.configured ? 'Clé configurée' : 'Clé à renseigner'}</Badge><p className="ai-model">{status?.model || 'OpenAI'}</p>
        {!status?.configured ? <div className="ai-setup"><p>Sur le serveur, ouvre <code>.env</code> et renseigne :</p><pre>OPENAI_API_KEY=ta_cle</pre><p>Puis applique la configuration :</p><pre>docker compose up -d</pre><p>Ne partage jamais ta clé dans le chat ni dans le code React.</p></div> : <p className="ai-muted">{status.last_success ? `Dernier appel réussi : ${DATE.format(new Date(status.last_success))}.` : 'La clé est présente. La connexion sera vérifiée lors de ta première génération.'}</p>}
        <div className="ai-quota"><span>Appels aujourd’hui</span><strong>{status?.today || 0}<small> / {status?.daily_limit || 30}</small></strong><Progress value={status ? Math.min(100,status.today/status.daily_limit*100) : 0} aria-label="Appels IA utilisés aujourd’hui"/></div><p className="ai-muted">Limite commune à tous tes appareils, remise à zéro à minuit, heure de Paris. Les essais en erreur comptent aussi.</p>
        <p className="ai-token-count">{(status?.input_tokens || 0).toLocaleString('fr-FR')} tokens en entrée · {(status?.output_tokens || 0).toLocaleString('fr-FR')} en sortie aujourd’hui</p><Button variant="outline" disabled={busy} onClick={reload}><RefreshCw size={15}/>Actualiser l’état</Button>
      </Card>
      <Card className="panel ai-storage-card"><div className="panel-heading"><h3>Tout reste en CSV</h3><ShieldCheck size={19}/></div><p>Le carnet et la progression sont enregistrés sur un seul serveur, pas dans chaque navigateur.</p><Button variant="outline" onClick={onBackup}><Download size={16}/>Sauvegarde complète</Button><div className="ai-export-links">{EXPORTS.map(([name,label])=><a key={name} href={`/api/export/file?name=${encodeURIComponent(name)}`} download={name}><Download size={13}/>{label} <span>CSV</span></a>)}</div></Card>
      <Card className="panel ai-tip-card"><h3>Ton rituel quotidien</h3><p><strong>1.</strong> Révise tes mots pendant 5 minutes.</p><p><strong>2.</strong> Pratique une leçon et son quiz.</p><p><strong>3.</strong> Raconte ta journée en anglais et relis la correction.</p><small>L’IA peut faire des erreurs. Vérifie les contenus qui te semblent douteux ; tes fiches de vocabulaire restent modifiables.</small></Card>
    </aside></div>
  </section>;
};
