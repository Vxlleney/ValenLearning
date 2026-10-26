import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, CircleHelp, CloudCheck, Flame, Home, Layers, Lightbulb, LoaderCircle, Pencil, Plus, RefreshCw, Search, Settings2, Sparkles, Star, Target, Trash2, Upload, Volume2, X, ChartNoAxesColumnIncreasing, Copy, FileSpreadsheet, Gamepad2 } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Toaster } from '@/components/ui/sonner';
import { CATEGORIES, Category, Status, statusOf, AppSelect, Modal, WordForm } from '@/components/vocabulary-ui.jsx';
import { ModeCards, Game } from '@/components/learning-games.jsx';
import { AiStudio } from '@/components/ai-studio.jsx';
import { LearningLibrary } from '@/components/learning-library.jsx';
import { useVocabulary } from '@/hooks/use-vocabulary.js';
import { computeStats, dateKey, normalizeAnswer, parseVocabularyCsv, } from '@shared/vocabulary.js';
const NAV = [
    { id: 'home', label: 'Mon espace', icon: Home },
    { id: 'words', label: 'Mon vocabulaire', icon: BookOpen },
    { id: 'library', label: 'Ma bibliothèque', icon: Layers },
    { id: 'practice', label: "M’entraîner", icon: Gamepad2 },
    { id: 'ai', label: 'Atelier IA', icon: Sparkles },
    { id: 'progress', label: 'Mes progrès', icon: ChartNoAxesColumnIncreasing },
];
const CSV_EXAMPLE = 'english;french;category;example;example_fr\ndeadline;date limite;Travail;The deadline is Friday.;La date limite est vendredi.';
const shuffle = (values) => {
    const output = [...values];
    for (let index = output.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1));
        [output[index], output[target]] = [output[target], output[index]];
    }
    return output;
};
const isDue = (word) => !word.review_count || !word.due_at || new Date(word.due_at).getTime() <= Date.now();
const download = (content, filename, type = 'text/csv;charset=utf-8') => {
    const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const ValenLearning = () => {
    const [tab, setTab] = useState('home');
    const [libraryImport, setLibraryImport] = useState(false);
    const [modal, setModal] = useState(null);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('Toutes');
    const [filter, setFilter] = useState('all');
    const [visibleCount, setVisibleCount] = useState(20);
    const [csv, setCsv] = useState('');
    const [fileName, setFileName] = useState('');
    const [dragging, setDragging] = useState(false);
    const [practiceDirection, setPracticeDirection] = useState('en-fr');
    const [practiceCount, setPracticeCount] = useState('10');
    const [practiceCategory, setPracticeCategory] = useState('Toutes');
    const [plan, setPlan] = useState(null);
    const [gameKey, setGameKey] = useState(0);
    const fileInput = useRef(null);
    const deleteTriggerRef = useRef(null);
    const voicesRef = useRef([]);
    const utteranceRef = useRef(null);
    const [backingUp, setBackingUp] = useState(false);
    const editing = ['word', 'settings', 'delete'].includes(modal?.type);
    const { words, goal, loading, refreshing, saving, savingGoal, loadError, goalError, lastSynced, refresh, mutate, saveGoal } = useVocabulary({ editing, sessionActive: !!plan });
    const notify = (message, error = false) => error ? sonnerToast.error(message) : sonnerToast.success(message);
    const readOnly = loading || !!loadError;
    const stats = useMemo(() => computeStats(words), [words]);
    const categories = useMemo(() => [...new Set([...CATEGORIES, ...words.map((word) => word.category)])].filter(Boolean), [words]);
    const progress = Math.min(100, stats.todayReviewed / goal * 100);
    useEffect(() => {
        const hash = window.location.hash.slice(1);
        if ([...NAV.map((item) => item.id), 'import'].includes(hash)) setTab(hash);
    }, []);
    useEffect(() => { setVisibleCount(20); }, [search, category, filter]);
    const navigate = (value) => { setTab(value); setPlan(null); window.history.replaceState(null, '', `#${value}`); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    useEffect(() => {
        if (!('speechSynthesis' in window)) return;
        const synthesis = window.speechSynthesis;
        const updateVoices = () => { voicesRef.current = synthesis.getVoices(); };
        updateVoices();
        synthesis.addEventListener('voiceschanged', updateVoices);
        return () => {
            synthesis.removeEventListener('voiceschanged', updateVoices);
            synthesis.cancel();
            utteranceRef.current = null;
        };
    }, []);
    const speak = (text) => {
        if (!('speechSynthesis' in window)) {
            notify('La prononciation n’est pas disponible dans ce navigateur.', true);
            return;
        }
        const synthesis = window.speechSynthesis;
        synthesis.cancel();
        const voices = (voicesRef.current.length ? voicesRef.current : synthesis.getVoices()).filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang));
        // La lecture part immédiatement après le clic, y compris sur téléphone.
        const british = (voice) => /^en[-_]GB$/i.test(voice.lang);
        const voice = voices.find((item) => item.localService && british(item)) || voices.find((item) => item.localService) || voices.find(british) || voices[0];
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = voice?.lang || 'en-GB';
        utterance.rate = 0.85;
        if (voice) utterance.voice = voice;
        utteranceRef.current = utterance;
        utterance.onend = () => { if (utteranceRef.current === utterance) utteranceRef.current = null; };
        utterance.onerror = (event) => {
            if (utteranceRef.current === utterance) utteranceRef.current = null;
            if (event.error !== 'interrupted' && event.error !== 'canceled') notify('La voix anglaise est indisponible. Vérifie les voix installées ou ta connexion Internet.', true);
        };
        synthesis.speak(utterance);
    };
    const copyText = async (text) => { try {
        await navigator.clipboard.writeText(text);
        notify('Copié ! Tu peux le coller dans ChatGPT.');
    }
    catch {
        setModal({ type: 'copy', text });
    } };
    const exportCsv = async () => {
        if (readOnly) {
            notify('Synchronise le carnet avec le serveur avant de l’exporter.', true);
            return;
        }
        try {
            const response = await fetch('/api/export', { cache: 'no-store' });
            if (!response.ok)
                throw new Error('L’export n’a pas abouti. Réessaie dans un instant.');
            download(await response.blob(), `valen-learning-vocabulaire-${dateKey()}.csv`);
            notify('Ton vocabulaire et sa progression ont été exportés en CSV.');
        }
        catch (error) {
            notify(error.message, true);
        }
    };
    const backupArchive = async () => {
        if (readOnly || backingUp) return;
        setBackingUp(true);
        try {
            const response = await fetch('/api/backup', { cache: 'no-store' });
            if (!response.ok) throw new Error('La sauvegarde n’a pas abouti. Réessaie dans un instant.');
            download(await response.blob(), `valen-learning-sauvegarde-${dateKey()}.zip`, 'application/zip');
            notify('La sauvegarde complète a été téléchargée.');
        } catch (error) {
            notify(error.message, true);
        } finally {
            setBackingUp(false);
        }
    };
    const startSession = (mode, daily = false, queueOverride = null) => {
        if (readOnly || saving) {
            notify('Synchronise le carnet avec le serveur avant de commencer une séance.', true);
            return;
        }
        let candidates = queueOverride || words.filter((word) => daily || practiceCategory === 'Toutes' || word.category === practiceCategory);
        if (!candidates.length) {
            notify('Ajoute quelques mots pour commencer à t’entraîner.');
            return;
        }
        if (mode === 'quiz' && new Set(candidates.map((word) => normalizeAnswer(practiceDirection === 'en-fr' ? word.french : word.english))).size < 2) {
            notify('Le quiz a besoin d’au moins deux traductions différentes. Essaie les cartes mémoire.');
            return;
        }
        const amount = daily ? goal : practiceCount === 'all' ? candidates.length : Number(practiceCount);
        candidates = shuffle(candidates).sort((a, b) => Number(isDue(b)) - Number(isDue(a)));
        setPlan({ mode, direction: daily ? 'en-fr' : practiceDirection, queue: candidates.slice(0, amount) });
        setGameKey((value) => value + 1);
        setTab('practice');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const filteredWords = useMemo(() => words.filter((word) => {
        const matchesSearch = normalizeAnswer(`${word.english} ${word.french} ${word.example || ''}`).includes(normalizeAnswer(search));
        const matchesCategory = category === 'Toutes' || word.category === category;
        const matchesFilter = filter === 'all' || filter === statusOf(word) || (filter === 'favorites' && word.favorite) || (filter === 'due' && isDue(word));
        return matchesSearch && matchesCategory && matchesFilter;
    }), [words, search, category, filter]);
    const csvPreview = useMemo(() => {
        if (!csv.trim())
            return null;
        try {
            return parseVocabularyCsv(csv);
        }
        catch (error) {
            return { words: [], errors: [error.message] };
        }
    }, [csv]);
    const readFile = async (file) => {
        if (!file || saving)
            return;
        if (file.size > 2 * 1024 * 1024) {
            notify('Le fichier doit faire moins de 2 Mo.', true);
            return;
        }
        try {
            const contents = await file.text();
            setCsv(contents);
            setFileName(file.name);
        }
        catch {
            notify('Impossible de lire ce fichier. Essaie de coller son contenu.', true);
        }
    };
    const importCsv = async () => {
        try {
            const data = await mutate({ action: 'import', csv });
            notify(`${data.added || 0} mot${data.added === 1 ? '' : 's'} ajouté${data.added === 1 ? '' : 's'}${data.skipped ? ` · ${data.skipped} doublon${data.skipped > 1 ? 's' : ''} ignoré${data.skipped > 1 ? 's' : ''}` : ''}.`);
            setCsv('');
            setFileName('');
            navigate('words');
        }
        catch (error) {
            notify(error.message, true);
        }
    };
    const favorite = async (word) => { try {
        await mutate({ action: 'favorite', id: word.id, favorite: !word.favorite });
    }
    catch (error) {
        notify(error.message, true);
    } };
    const wordOfDay = words.length ? words[Math.floor(Date.now() / 86400000) % words.length] : null;
    const recentWords = [...words].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 4);
    const formatDate = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const showWord = (word) => setModal({ type: 'view', word });
    const recentRows = <Card className="word-list">{recentWords.map((word) => <div className="word-row" key={word.id}><Button className="word-main" onClick={() => showWord(word)} variant="ghost" type="button"><strong lang="en">{word.english}</strong><span className="word-sub">{word.french}</span></Button><Category category={word.category}/><div className="word-actions"><Button className="icon-button" aria-label={`Écouter ${word.english}`} onClick={() => speak(word.english)} variant="ghost" size="icon-sm" type="button"><Volume2 size={17}/></Button><Status word={word}/></div></div>)}</Card>;
    const dailyPanel = <Card className="panel daily-panel"><div className="panel-heading"><h3>Ton rendez-vous quotidien</h3><Target size={19}/></div>
    <div className="progress-circle"><svg width="144" height="144" viewBox="0 0 144 144" aria-label={`${stats.todayReviewed} mots sur ${goal} révisés aujourd’hui`}><circle cx="72" cy="72" r="61" fill="none" stroke="var(--progress-track)" strokeWidth="9"/><circle cx="72" cy="72" r="61" fill="none" stroke="var(--primary)" strokeWidth="9" strokeLinecap="round" strokeDasharray="383.3" strokeDashoffset={383.3 * (1 - progress / 100)} transform="rotate(-90 72 72)"/></svg><div className="goal-count"><strong>{stats.todayReviewed}<small>/{goal}</small></strong><span>mots aujourd’hui</span></div></div>
    <p className="daily-caption">{progress >= 100 ? 'Objectif atteint. Tu peux être fier de toi !' : stats.todayReviewed > 0 ? 'Tu es en bonne voie. Continue comme ça !' : 'Une petite habitude, de grands progrès.'}</p>
    <div className="week-row">{Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setUTCDate(date.getUTCDate() - 6 + index); const key = dateKey(date); const activity = stats.activity.find((item) => item.date === key); const done = activity?.count > 0; return <div className={`week-day ${done ? 'done' : ''} ${index === 6 ? 'today' : ''}`} key={key} title={`${key} : ${activity?.count || 0} révision(s)`}><span>{new Intl.DateTimeFormat('fr-FR', { weekday: 'narrow', timeZone: 'Europe/Paris' }).format(date)}</span><i>{done ? <Check size={13}/> : index === 6 ? <span className="today-dot"/> : '·'}</i></div>; })}</div>
    <div className="streak-note"><Flame size={17}/><span>{stats.streak > 0 ? `${stats.streak} jour${stats.streak > 1 ? 's' : ''} de suite. Garde le rythme !` : 'Ta prochaine série commence aujourd’hui.'}</span></div>
  </Card>;
    return <div className="app-shell">
    <a className="skip-link" href="#main">Aller au contenu</a>
    <aside className="sidebar">
      <Button className="brand" onClick={() => navigate('home')} aria-label="Valen Learning, accueil" variant="ghost" type="button"><img className="brand-logo" src="/valen-learning-logo.png" alt="Valen Learning"/></Button>
      <p className="sidebar-label">MON APPRENTISSAGE</p>
      <nav aria-label="Navigation principale">{NAV.map((item) => { const Icon = item.icon; return <Button className={`nav-item ${tab === item.id ? 'active' : ''}`} aria-current={tab === item.id ? 'page' : undefined} key={item.id} onClick={() => navigate(item.id)} variant="ghost" type="button"><Icon size={19}/><span>{item.label}</span>{item.id === 'words' && <Badge className="nav-count" variant="secondary">{words.length}</Badge>}</Button>; })}</nav>
      <Separator className="sidebar-divider"/>
      <Button className={`nav-item ${tab === 'import' ? 'active' : ''}`} onClick={() => { setLibraryImport(true); navigate('library'); }} aria-current={tab === 'import' ? 'page' : undefined} variant="ghost" type="button"><Upload size={19}/><span>Importer un CSV</span></Button>
      <Button className="nav-item" onClick={exportCsv} disabled={readOnly || saving} variant="ghost" type="button"><ArrowDownToLine size={19}/><span>Exporter mes mots</span></Button>
      <div className="sidebar-bottom"><Card className="sidebar-tip"><span className="sidebar-tip-icon"><Lightbulb size={26}/></span><strong>Un mot de plus.<br />Une limite de moins.</strong><p>5 minutes aujourd’hui font la différence demain.</p><span>Let’s grow together <ArrowUpRight size={13}/></span></Card><Button className="sidebar-profile" onClick={() => setModal({ type: 'settings' })} variant="ghost" type="button"><Avatar className="avatar"><AvatarFallback>V</AvatarFallback></Avatar><span className="profile-copy"><strong>Valentin</strong><small>Objectif : anglais B2</small></span><Settings2 size={17}/></Button></div>
    </aside>
    <main id="main" className="main-content">
      <header className="topbar">
        <div className="breadcrumb"><span className="mobile-brand"><img className="mobile-brand-logo" src="/valen-learning-logo.png" alt="Valen Learning" /></span><span className="desktop-breadcrumb">Mon apprentissage <span>/</span> <strong>{tab === 'import' ? 'Importer mes mots' : NAV.find((item) => item.id === tab)?.label}</strong></span></div>
        <div className="topbar-actions">
          <div className="sync-actions">
            <div className="sync-status">
              <span className="save-status" data-state={loading || saving || refreshing ? 'loading' : loadError ? 'error' : 'saved'} aria-live="polite">{loading || saving || refreshing ? <LoaderCircle size={15} className="spinner" /> : <span className="status-dot" />}{loading ? 'Chargement…' : saving ? 'Enregistrement…' : refreshing ? 'Synchronisation…' : loadError ? 'Serveur inaccessible' : 'Carnet synchronisé'}</span>
              {lastSynced && <span className="sync-note">Dernière sync. <time dateTime={lastSynced.toISOString()}>{new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastSynced)}</time></span>}
            </div>
            <Button className="icon-button" variant="ghost" size="icon-sm" type="button" disabled={loading || refreshing || saving || editing} aria-label="Actualiser le carnet depuis le serveur" title="Actualiser le carnet" onClick={() => refresh({ force: true })}><RefreshCw size={17} className={refreshing ? 'spinner' : undefined} /></Button>
          </div>
          <Button className="icon-button" onClick={() => setModal({ type: 'help' })} aria-label="Comment utiliser Valen Learning" variant="ghost" size="icon-sm" type="button"><CircleHelp size={20} /></Button>
          <Avatar className="top-avatar avatar"><AvatarFallback>V</AvatarFallback></Avatar>
        </div>
      </header>
      {loading && <div className="info-banner connection-banner" role="status"><LoaderCircle className="spinner" size={18} /><span>Chargement de ton carnet et de tes paramètres depuis le serveur…</span></div>}
      {loadError && <div role="alert" className="info-banner error connection-banner"><div><strong>Le carnet ne peut pas être synchronisé.</strong><p>{loadError}</p><p>Les données déjà chargées restent visibles. Les modifications et les jeux reprendront après la reconnexion.</p></div><Button className="text-button" onClick={() => refresh({ force: true })} disabled={refreshing || saving} variant="ghost" type="button">Réessayer<RefreshCw size={15} /></Button></div>}

      {tab === 'library' && <LearningLibrary speak={speak} onPractice={(mode,queue) => startSession(mode,false,queue)} onVocabularyChange={() => refresh({force:true})} onOpenAi={() => navigate('ai')} importInitially={libraryImport} onImportOpened={() => setLibraryImport(false)}/>}
      {tab === 'ai' && <AiStudio onVocabularyChange={() => refresh({force:true})} onOpenWords={() => navigate('words')} onBackup={backupArchive} speak={speak}/>}
      {tab === 'home' && <>
        <div className="page-heading"><div><p className="eyebrow">{formatDate}</p><h1>Fais grandir ton anglais<span className="heading-flower">✳</span></h1><p>Bonjour Valentin, chaque petit pas compte.</p></div><Button disabled={readOnly || saving} onClick={() => setModal({ type: 'word' })} variant="outline" type="button"><Plus size={18}/>Ajouter un mot</Button></div>
        <div className="ai-home-banner"><BookOpen size={19}/><div><strong>Tes leçons ont leur bibliothèque.</strong><span>Vocabulaire, grammaire et collections importées en CSV.</span></div><Button variant="outline" onClick={() => navigate('library')}>Mes leçons<ArrowRight size={16}/></Button></div>
        <div className="ai-home-banner"><Sparkles size={19}/><div><strong>Ton atelier anglais est ouvert.</strong><span>Ajoute des mots automatiquement, crée une leçon ou corrige ton texte.</span></div><Button variant="outline" onClick={() => navigate('ai')}>Atelier IA<ArrowRight size={16}/></Button></div>
        <div className="dashboard-grid"><div className="dashboard-main">
          <Card className="hero-card"><div className="hero-copy"><Badge className="hero-tag" variant="secondary"><span />TA PAUSE ANGLAIS</Badge><h2 className="hero-title">Un peu chaque jour.<br /><em>Beaucoup plus loin.</em></h2><p className="hero-subtitle">Tes mots t’attendent. Prends quelques minutes<br className="desktop-break"/> pour les faire entrer dans ton quotidien.</p><Button disabled={readOnly || saving || !words.length} onClick={() => startSession('cards', true)} variant="default" type="button">Commencer ma séance<ArrowRight size={19}/></Button><div className="hero-meta"><span><Layers size={14}/>{Math.min(goal, words.length)} mots</span><span>·</span><span>Environ 5 min</span></div></div><div className="hero-art" aria-hidden="true"><span className="art-orbit"/><span className="sparkle sparkle-one">✦</span><span className="sparkle sparkle-two">✳</span><div className="floating-word-card card-back"><span className="word-card-label">UN PEU CHAQUE JOUR</span><BookOpen size={41}/></div><div className="floating-word-card card-front"><span className="word-card-label">ENGLISH <Volume2 size={12}/></span><span className="word-card-word">grow</span><span className="word-card-line"/><span className="word-card-translation">grandir, progresser</span><span className="word-card-bottom"><BookOpen size={14}/>one word at a time</span></div><span className="art-small-dot"/></div></Card>
          <div className="stat-grid"><Card className="stat-card"><div className="stat-icon sage"><BookOpen size={20}/></div><div><strong className="stat-value">{stats.total}</strong><span className="stat-label">mots dans mon carnet</span></div><span className="stat-note">Tout commence ici</span></Card><Card className="stat-card"><div className="stat-icon peach"><RefreshCw size={20}/></div><div><strong className="stat-value">{stats.due}</strong><span className="stat-label">mots à réviser</span></div><span className="stat-note">Un petit rappel ?</span></Card><Card className="stat-card"><div className="stat-icon lavender"><CheckCheck size={20}/></div><div><strong className="stat-value">{stats.mastered}</strong><span className="stat-label">mots acquis</span></div><span className="stat-note">Et ce n’est qu’un début</span></Card></div>
          <div className="section-heading"><div><h2>À chaque envie, son jeu</h2><p>Choisis ta façon de mémoriser.</p></div><span className="section-count">3 façons d’apprendre</span></div><ModeCards onStart={startSession} disabled={readOnly || saving || !words.length}/>
          <section className="recent-section"><div className="section-heading"><h2>Les derniers mots de ton carnet</h2><Button className="text-button" onClick={() => navigate('words')} variant="ghost" type="button">Tout voir<ArrowRight size={16}/></Button></div>{words.length ? recentRows : <div className="empty-state">Ton carnet est prêt à accueillir ton premier mot.</div>}</section>
        </div><aside className="dashboard-aside">{dailyPanel}
          {wordOfDay && <Card className="panel word-of-day"><div className="panel-heading"><span className="word-eyebrow"><Sparkles size={15}/>LE MOT DU JOUR</span><Button className="icon-button" aria-label={`Écouter ${wordOfDay.english}`} onClick={() => speak(wordOfDay.english)} variant="ghost" size="icon-sm" type="button"><Volume2 size={18}/></Button></div><h3 className="daily-word" lang="en">{wordOfDay.english}</h3><p className="daily-translation">{wordOfDay.french}</p><Category category={wordOfDay.category}/>{wordOfDay.example && <div className="word-example"><p lang="en">“{wordOfDay.example}”</p><span>{wordOfDay.example_fr}</span></div>}<Button className="text-button" onClick={() => showWord(wordOfDay)} variant="ghost" type="button">Découvrir ce mot<ArrowUpRight size={16}/></Button></Card>}
          <Card className="import-nudge"><span><FileSpreadsheet size={22}/></span><div><h3>Tous tes mots, au même endroit.</h3><p>Importe le vocabulaire de tes séances en un seul CSV.</p><Button className="text-button" onClick={() => navigate('import')} variant="ghost" type="button">Importer mes mots<ArrowRight size={15}/></Button></div></Card>
        </aside></div>
      </>}

      {tab === 'words' && <>
        <div className="page-heading"><div><p className="eyebrow">TON CARNET PERSONNEL</p><h1>Les mots qui te font avancer.</h1><p>{words.length} mots et expressions. Une infinité de conversations.</p></div><div className="heading-actions"><Button onClick={exportCsv} disabled={readOnly || saving} variant="outline" type="button"><ArrowDownToLine size={17}/>Exporter le CSV</Button><Button disabled={readOnly || saving} onClick={() => setModal({ type: 'word' })} variant="default" type="button"><Plus size={18}/>Ajouter un mot</Button></div></div>
        <div className="vocabulary-toolbar"><div className="search-field"><Search size={19}/><Input aria-label="Rechercher dans le vocabulaire" placeholder="Un mot, une traduction…" value={search} onChange={(event) => setSearch(event.target.value)}/>{search && <Button className="icon-button" aria-label="Effacer la recherche" onClick={() => setSearch('')} variant="ghost" size="icon-sm" type="button"><X size={16}/></Button>}</div><div className="filters"><AppSelect aria-label="Filtrer par catégorie" value={category} onValueChange={setCategory} options={[{ value: 'Toutes', label: 'Toutes les catégories' }, ...categories]}/><AppSelect aria-label="Filtrer par progression" value={filter} onValueChange={setFilter} options={[{ value: 'all', label: 'Tous les mots' }, { value: 'due', label: 'À réviser' }, { value: 'new', label: 'Nouveaux' }, { value: 'learning', label: 'En cours' }, { value: 'mastered', label: 'Acquis' }, { value: 'favorites', label: 'Mes favoris' }]}/></div></div>
        <div className="table-wrap"><Table className="vocabulary-table"><TableHeader><TableRow><TableHead>Mot anglais</TableHead><TableHead>Traduction</TableHead><TableHead>Catégorie</TableHead><TableHead>Progression</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{filteredWords.slice(0, visibleCount).map((word) => <TableRow key={word.id}><TableCell><Button className="table-word" onClick={() => showWord(word)} lang="en" variant="ghost" type="button">{word.english}</Button>{word.example && <span className="table-example" lang="en">{word.example}</span>}</TableCell><TableCell>{word.french}</TableCell><TableCell><Category category={word.category}/></TableCell><TableCell><Status word={word}/></TableCell><TableCell><div className="word-actions"><Button className={`icon-button favorite-button ${word.favorite ? 'active' : ''}`} disabled={readOnly || saving} aria-label={`${word.favorite ? 'Retirer' : 'Ajouter'} ${word.english} ${word.favorite ? 'des' : 'aux'} favoris`} onClick={() => favorite(word)} variant="ghost" size="icon-sm" type="button"><Star size={17} fill={word.favorite ? 'currentColor' : 'none'}/></Button><Button className="icon-button" aria-label={`Écouter ${word.english}`} onClick={() => speak(word.english)} variant="ghost" size="icon-sm" type="button"><Volume2 size={17}/></Button><Button className="icon-button" disabled={readOnly || saving} aria-label={`Modifier ${word.english}`} onClick={() => setModal({ type: 'word', word })} variant="ghost" size="icon-sm" type="button"><Pencil size={16}/></Button><Button className="icon-button delete-word" disabled={readOnly || saving} aria-label={`Supprimer ${word.english}`} onClick={() => setModal({ type: 'delete', word })} variant="ghost" size="icon-sm" type="button"><Trash2 size={16}/></Button></div></TableCell></TableRow>)}</TableBody></Table>{!filteredWords.length && <div className="empty-state"><Search size={32}/><h3>{words.length ? 'Aucun mot ne correspond.' : 'Ton premier mot t’attend.'}</h3><p>{words.length ? 'Essaie une autre recherche ou une autre catégorie.' : 'Ajoute un mot ou importe une liste CSV pour démarrer.'}</p><Button onClick={() => words.length ? (setSearch(''), setCategory('Toutes'), setFilter('all')) : navigate('import')} variant="outline" type="button">{words.length ? 'Effacer les filtres' : 'Importer une liste'}</Button></div>}</div>
        <div className="table-footer"><span>{Math.min(visibleCount, filteredWords.length)} sur {filteredWords.length} mots</span>{filteredWords.length > visibleCount && <Button onClick={() => setVisibleCount((value) => value + 30)} variant="outline" size="sm" type="button">Afficher plus<ChevronDown size={16}/></Button>}<span><CloudCheck size={15}/>Ton carnet est conservé au format CSV.</span></div>
      </>}

      {tab === 'practice' && (plan ? <Game key={gameKey} plan={plan} allWords={words} speak={speak} unavailable={readOnly} onExit={() => setPlan(null)} onRestart={(nextPlan) => { setPlan(nextPlan); setGameKey((value) => value + 1); }} onReview={async (id, rating, event_id) => { await mutate({ action: 'review', id, rating, event_id }); }}/> : <>
        <div className="page-heading"><div><p className="eyebrow">C’EST EN PRATIQUANT QU’ON PROGRESSE</p><h1>Une petite séance ?</h1><p>Les mots nouveaux et ceux à revoir passent en premier.</p></div><Badge className="category-pill category-grammaire" variant="secondary"><RefreshCw size={14}/>{stats.due} mots à réviser</Badge></div>
        <Card className="practice-options panel"><div className="form-field"><span id="translation-direction-label">Sens de traduction</span><RadioGroup className="direction-options" value={practiceDirection} onValueChange={setPracticeDirection} aria-labelledby="translation-direction-label"><Label className="direction-option" data-state={practiceDirection === 'en-fr' ? 'checked' : 'unchecked'} htmlFor="direction-en-fr"><RadioGroupItem id="direction-en-fr" value="en-fr" />Anglais → Français</Label><Label className="direction-option" data-state={practiceDirection === 'fr-en' ? 'checked' : 'unchecked'} htmlFor="direction-fr-en"><RadioGroupItem id="direction-fr-en" value="fr-en" />Français → Anglais</Label></RadioGroup></div><div className="form-field"><Label htmlFor="practice-count">Nombre de mots</Label><AppSelect id="practice-count" value={practiceCount} onValueChange={setPracticeCount} options={[{ value: '5', label: '5 mots · express' }, { value: '10', label: '10 mots · quotidien' }, { value: '20', label: '20 mots · motivé' }, { value: 'all', label: 'Tous mes mots' }]}/></div><div className="form-field"><Label htmlFor="practice-category">Catégorie</Label><AppSelect id="practice-category" value={practiceCategory} onValueChange={setPracticeCategory} options={[{ value: 'Toutes', label: 'Toutes les catégories' }, ...categories]}/></div></Card>
        <ModeCards onStart={startSession} disabled={readOnly || saving || !words.length}/><Card className="practice-tip panel"><Lightbulb size={23}/><div><h3>Le secret, c’est de revenir.</h3><p>Un mot réussi s’espace peu à peu dans tes révisions. Un mot oublié revient plus vite. Tu peux aussi choisir « Tous mes mots » pour tout revoir.</p></div></Card>
      </>)}

      {tab === 'progress' && <>
        <div className="page-heading"><div><p className="eyebrow">LE CHEMIN PARCOURU</p><h1>Des petits pas qui s’additionnent.</h1><p>Ta progression réelle, au fil de tes séances.</p></div><Button onClick={() => setModal({ type: 'settings' })} variant="outline" type="button"><Settings2 size={17}/>Mon objectif</Button></div>
        <div className="stat-grid"><Card className="stat-card"><div className="stat-icon peach"><Flame size={22}/></div><div><strong className="stat-value">{stats.streak}</strong><span className="stat-label">jour{stats.streak > 1 ? 's' : ''} de suite</span></div></Card><Card className="stat-card"><div className="stat-icon sage"><CheckCheck size={22}/></div><div><strong className="stat-value">{stats.accuracy || 0}%</strong><span className="stat-label">de bonnes réponses</span></div></Card><Card className="stat-card"><div className="stat-icon lavender"><Layers size={22}/></div><div><strong className="stat-value">{stats.reviewCount}</strong><span className="stat-label">révisions effectuées</span></div></Card></div>
        <div className="dashboard-grid"><div className="dashboard-main"><Card className="panel"><div className="panel-heading"><div><h2>Un peu d’anglais chaque jour</h2><p>Nombre de révisions sur les 7 derniers jours.</p></div><ChartNoAxesColumnIncreasing size={22}/></div><div className="chart-week">{Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setUTCDate(date.getUTCDate() - 6 + index); const activity = stats.activity.find((item) => item.date === dateKey(date)); const value = activity?.count || 0; const max = Math.max(goal, ...stats.activity.slice(-7).map((item) => item.count)); return <div className="chart-day" key={index}><strong>{value}</strong><div className="chart-bar-space"><div className={`chart-bar ${index === 6 ? 'today' : ''}`} style={{ height: `${Math.max(3, value / max * 100)}%`, opacity: value ? 1 : 0.25 }}/></div><span>{new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'Europe/Paris' }).format(date)}</span></div>; })}</div></Card>
          <Card className="panel"><div className="panel-heading"><h2>Ton vocabulaire progresse</h2><ChartNoAxesColumnIncreasing size={23}/></div><div className="progress-list">{[{ title: 'Mots acquis', value: stats.mastered, className: 'mastered', note: 'Au moins trois étapes de mémorisation franchies.' }, { title: 'En cours d’apprentissage', value: stats.learning, className: 'learning', note: 'Déjà rencontrés, à consolider.' }, { title: 'Nouveaux mots', value: stats.newWords, className: 'new', note: 'Prêts pour leur première révision.' }].map((item) => <div className="progress-item" key={item.title}><div><strong>{item.title}</strong><span>{item.value} mots</span></div><Progress className={`mastery-track ${item.className}`} aria-label={item.title} value={words.length ? item.value / words.length * 100 : 0}/><small>{item.note}</small></div>)}</div></Card>
        </div><aside className="dashboard-aside">{dailyPanel}<Card className="help-card"><Lightbulb size={23}/><h3>Tu ne vois pas encore de progrès ?</h3><p>Termine une première séance. Tes réponses alimenteront automatiquement ces indicateurs, sans rien à remplir.</p><Button onClick={() => startSession('cards', true)} disabled={readOnly || saving || !words.length} variant="default" type="button">C’est parti<ArrowRight size={17}/></Button></Card></aside></div>
      </>}

      {tab === 'import' && <>
        <div className="page-heading"><div><p className="eyebrow">AGRANDIS TON CARNET</p><h1>Tes mots méritent une place ici.</h1><p>Un fichier CSV ou un copier-coller. On s’occupe du reste.</p></div><Button onClick={() => download('\uFEFF' + CSV_EXAMPLE, 'valen-learning-modele.csv')} variant="outline" type="button"><ArrowDownToLine size={17}/>Télécharger le modèle</Button></div>
        <div className="imports-grid"><Card className="panel import-panel"><div className="panel-heading"><h2>Importer mon vocabulaire</h2><FileSpreadsheet size={23}/></div><Button disabled={saving} className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); readFile(event.dataTransfer.files[0]); }} onClick={() => fileInput.current?.click()} variant="ghost" type="button"><span className="upload-icon"><Upload size={27}/></span><strong>{fileName || 'Dépose ton fichier CSV ici'}</strong><span>ou clique pour choisir un fichier</span><small>CSV ou TSV · UTF-8 · 2 Mo maximum</small></Button><input ref={fileInput} className="sr-only" disabled={saving} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" aria-label="Choisir un fichier CSV" onChange={(event) => { readFile(event.target.files[0]); event.target.value = ''; }}/><div className="or-divider"><span>ou colle ta liste</span></div><Label className="sr-only" htmlFor="csv-content">Contenu CSV à importer</Label><Textarea id="csv-content" disabled={saving} className="csv-textarea" spellCheck={false} value={csv} onChange={(event) => { setCsv(event.target.value); setFileName(''); }} placeholder={'english;french;category\nimprove;améliorer;Travail\nmeeting;réunion;Travail'}/>
          <p className="format-note"><Check size={15}/>Virgules, points-virgules et tabulations reconnus automatiquement.</p>
          {csvPreview && <div className="import-preview"><div className="import-summary"><strong>{csvPreview.words.length} mot{csvPreview.words.length > 1 ? 's' : ''} détecté{csvPreview.words.length > 1 ? 's' : ''}</strong><span>Les doublons seront ignorés.</span></div>{csvPreview.errors?.length > 0 && <div className="error-text" role="alert">{csvPreview.errors.slice(0, 3).map((error, index) => <p key={index}>{typeof error === 'string' ? error : error.message || JSON.stringify(error)}</p>)}<p>Corrige ces lignes avant d’importer.</p></div>}{csvPreview.words.slice(0, 5).map((word, index) => <div className="preview-row" key={index}><strong>{word.english}</strong><ArrowRight size={13}/><span>{word.french}</span></div>)}{csvPreview.words.length > 5 && <small>Et {csvPreview.words.length - 5} autres mots…</small>}</div>}
          <Button disabled={readOnly || saving || !csvPreview?.words.length || !!csvPreview?.errors?.length} onClick={importCsv} className="import-submit" variant="default" type="button">{saving ? <LoaderCircle className="spinner" size={18}/> : <Plus size={18}/>}Ajouter à mon vocabulaire</Button>
        </Card><aside className="import-aside"><Card className="panel backup-card"><div className="panel-heading"><h2>Sauvegarde complète</h2><ArrowDownToLine size={22} /></div><p>Conserve une copie de tout ton carnet : les mots, les révisions, tes paramètres, les leçons et les corrections.</p><p className="format-note">Un fichier ZIP contenant onze fichiers CSV : carnet, progression, leçons et corrections.</p><Button variant="outline" disabled={readOnly || saving || backingUp} onClick={backupArchive}>{backingUp ? <LoaderCircle className="spinner" size={17} /> : <ArrowDownToLine size={17} />}Télécharger la sauvegarde ZIP</Button></Card><Card className="panel chatgpt-card"><span className="stat-icon sage"><Sparkles size={23}/></span><h2>De ChatGPT à ton carnet.</h2><p>À la fin d’une séance, demande à ChatGPT un CSV de tes nouveaux mots, puis importe-le ici.</p><div className="prompt-example">« Prépare un CSV de ces mots, avec leur traduction française et un exemple. »</div><Button className="text-button" onClick={() => copyText('Prépare un CSV UTF-8 des mots et expressions anglais étudiés dans cette conversation, avec les colonnes english;french;category;example;example_fr. Ajoute les traductions françaises et un exemple pour chaque mot. Sépare les variantes françaises par /. Je copierai ce CSV dans Valen Learning.')} variant="ghost" type="button"><Copy size={16}/>Copier la demande</Button><p className="format-note">ChatGPT ne se connecte pas automatiquement à ton serveur privé. Télécharge son CSV ou colle son contenu dans le champ d’import.</p></Card><Card className="panel"><div className="panel-heading"><h3>Récupérer mes anciennes listes</h3><BookOpen size={19}/></div><p>Dans une ancienne conversation, demande un CSV des mots qui y ont été étudiés, puis importe-le ici.</p><Button onClick={() => copyText('Rassemble tous les mots et expressions anglais étudiés dans cette conversation. Fournis un CSV UTF-8 avec les colonnes english;french;category;example;example_fr. Une ligne par mot, variantes françaises séparées par /, sans inventer de vocabulaire issu de séances absentes.')} variant="outline" size="sm" type="button"><Copy size={15}/>Copier la demande CSV</Button></Card><Card className="help-card"><CheckCheck size={24}/><h3>Simple et réutilisable.</h3><ul><li>Deux colonnes suffisent : anglais et français.</li><li>Les exemples et catégories sont facultatifs.</li><li>Les mots déjà présents gardent leur progression.</li><li>L’export CSV conserve les mots et leur progression.</li></ul></Card></aside></div>
        <p className="footer-note">Le pack de départ contient 36 exemples de vocabulaire. Il ne reconstitue pas l’historique de tes anciennes conversations.</p>
      </>}
      <footer className="app-footer"><span><img src="/favicon.svg" className="footer-brand-mark" width="18" height="18" alt=""/>Valen Learning · Un mot à la fois.</span><span>Tes mots. Ton rythme. Tes progrès.</span></footer>
    </main>
    {modal?.type === 'word' && <WordForm word={modal.word} saving={saving} unavailable={readOnly} reconnecting={refreshing} onReconnect={() => refresh({ force: true })} onClose={() => { if (!saving) setModal(null); }} onSave={async (word) => { const result = await mutate({ action: word.id ? 'update' : 'add', ...(word.id ? { id: word.id } : {}), word }); setModal(null); notify(word.id ? 'Mot mis à jour.' : result.skipped ? 'Ce mot est déjà dans ton carnet.' : 'Un nouveau mot dans ton carnet !'); }}/>}
    {modal?.type === 'view' && <Modal title="Dans ton carnet" onClose={() => setModal(null)}><div className="modal-body word-detail"><div className="panel-heading"><Category category={modal.word.category}/><Status word={modal.word}/></div><div className="question-word"><h2 className="daily-word" lang="en">{modal.word.english}</h2><Button className="icon-button" onClick={() => speak(modal.word.english)} aria-label="Écouter le mot" variant="ghost" size="icon-sm" type="button"><Volume2 size={23}/></Button></div><p className="daily-translation">{modal.word.french}</p>{modal.word.example && <div className="example-block"><p lang="en">“{modal.word.example}”</p><span>{modal.word.example_fr}</span></div>}{modal.word.note && <p className="info-banner">{modal.word.note}</p>}<p className="format-note">Origine : {modal.word.source || 'Ajout personnel'}</p><p className="format-note">{modal.word.review_count || 0} révision(s) · {modal.word.correct_count || 0} réponse(s) réussie(s)</p></div><div className="modal-actions"><Button disabled={readOnly || saving} onClick={() => setModal({ type: 'word', word: modal.word })} variant="outline" type="button"><Pencil size={16}/>Modifier</Button><Button disabled={readOnly || saving} onClick={() => { startSession('cards', false, [modal.word]); setModal(null); }} variant="default" type="button">Réviser ce mot<ArrowRight size={17}/></Button></div></Modal>}
    {modal?.type === 'delete' && <AlertDialog open onOpenChange={(open) => { if (!open && !saving)
            setModal(null); }}>
      <AlertDialogContent onOpenAutoFocus={() => { deleteTriggerRef.current = document.activeElement; }} onCloseAutoFocus={(event) => { event.preventDefault(); if (deleteTriggerRef.current?.isConnected) deleteTriggerRef.current.focus(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Retirer ce mot du carnet ?</AlertDialogTitle>
          <AlertDialogDescription><strong>{modal.word.english}</strong> et son historique de révision seront supprimés. Tu peux télécharger une sauvegarde complète avant de le retirer.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Conserver le mot</AlertDialogCancel>
          <Button variant="destructive" disabled={saving || readOnly} onClick={async () => { try {
            await mutate({ action: 'delete', id: modal.word.id });
            setModal(null);
            notify('Mot retiré du carnet.');
        }
        catch (error) {
            notify(error.message, true);
        } }}>
            {saving ? <LoaderCircle className="spinner" size={16}/> : <Trash2 size={16}/>}Supprimer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
    {modal?.type === 'settings' && <Modal title="Trouve ton rythme" onClose={() => { if (!savingGoal) setModal(null); }}><div className="modal-body"><p>Choisis un objectif qui tient dans ton quotidien. Il sera le même sur ton ordinateur et ton téléphone.</p><div className="form-field settings-goal"><Label htmlFor="daily-goal">Mon objectif quotidien</Label><AppSelect id="daily-goal" value={goal} disabled={readOnly || saving} onValueChange={async (selected) => { try { await saveGoal(selected); } catch { /* Le message reste affiché dans cette fenêtre. */ } }} options={[5, 10, 15, 20].map((value) => ({ value, label: `${value} mots par jour` }))} /></div>{savingGoal && <p className="format-note settings-saving" role="status"><LoaderCircle className="spinner" size={15} />Enregistrement de l’objectif sur le serveur…</p>}{goalError && <div className="settings-error" role="alert"><p className="error-text">{goalError}</p>{loadError && <Button type="button" variant="outline" disabled={refreshing || saving} onClick={() => refresh({ force: true })}>{refreshing ? "Reconnexion…" : "Réessayer la connexion"}</Button>}</div>}<p className="format-note server-settings-note">Chaque changement confirmé est enregistré sur le serveur, avec ton carnet et tes révisions. Aucun réglage n’est stocké uniquement dans ce navigateur.</p></div><div className="modal-actions"><Button disabled={savingGoal} onClick={() => setModal(null)} variant="default" type="button">Fermer<Check size={17} /></Button></div></Modal>}

    {modal?.type === 'help' && <Modal title="Bienvenue sur Valen Learning." onClose={() => setModal(null)}><div className="modal-body help-steps"><div><span className="step-number">1</span><section><h3>Remplis ton carnet</h3><p>Ajoute un mot avec sa traduction ou importe toute une liste CSV. Chaque ajout est sauvegardé automatiquement.</p></section></div><div><span className="step-number">2</span><section><h3>Pratique à ta façon</h3><p>Cartes mémoire, quiz ou traduction écrite. Change le sens de traduction et choisis une catégorie si tu veux.</p></section></div><div><span className="step-number">3</span><section><h3>Reviens un peu chaque jour</h3><p>Les mots difficiles sont proposés en priorité. Le carnet et les résultats sont enregistrés automatiquement sur le serveur. Exporte tes mots en CSV ou télécharge la sauvegarde complète depuis Importer un CSV.</p></section></div><p className="info-banner">Ton ordinateur et ton téléphone partagent le même carnet lorsqu’ils ouvrent ce serveur. Pour ajouter une liste préparée avec ChatGPT, demande un CSV puis importe-le ici.</p><p className="format-note">La prononciation utilise les voix de ton appareil. Certaines voix nécessitent une connexion Internet.</p></div><div className="modal-actions"><Button onClick={() => setModal(null)} variant="default" type="button">À moi de jouer<ArrowRight size={17}/></Button></div></Modal>}
    {modal?.type === 'copy' && <Modal title="Copier cette demande" description="La copie automatique n’est pas disponible ici. Sélectionne le texte ci-dessous, puis utilise Copier sur ton appareil." onClose={() => setModal(null)}><div className="modal-body"><Label htmlFor="copy-prompt" className="sr-only">Demande à copier dans ChatGPT</Label><Textarea id="copy-prompt" value={modal.text} readOnly rows={7} onFocus={(event) => event.target.select()} autoFocus /></div><div className="modal-actions"><Button onClick={() => setModal(null)}>Fermer</Button></div></Modal>}
    <Toaster theme="dark" position="bottom-right" richColors closeButton duration={5000} containerAriaLabel="Notifications" toastOptions={{ closeButtonAriaLabel: 'Fermer la notification' }}/>
  </div>;
};
export default ValenLearning;
