'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCheck, Keyboard,
  Layers, LoaderCircle, RefreshCw, Trophy, Volume2, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Category } from './vocabulary-ui.jsx';
import { getAcceptedAnswers, normalizeAnswer } from '@shared/vocabulary.js';

const MODES = [
  { id: 'cards', title: 'Cartes mémoire', text: 'Retourne la carte, retrouve le sens.', icon: Layers, art: 'flashcards', meta: 'À ton rythme', color: 'sage' },
  { id: 'quiz', title: 'Le bon mot', text: 'Quatre propositions. À toi de jouer.', icon: CheckCheck, art: 'quiz', meta: 'Quiz de traduction', color: 'peach' },
  { id: 'write', title: 'À toi d’écrire', text: 'Retrouve la traduction de mémoire.', icon: Keyboard, art: 'type', meta: 'Pour bien mémoriser', color: 'lavender' },
];

const shuffle = (values) => {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
};

const makeEventId = () => globalThis.crypto?.randomUUID?.() || `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const firstTranslation = (value) => String(value || '').split('/')[0].trim();

const ModeCards = ({ onStart, disabled = false }) => (
  <div className="mode-grid">
    {MODES.map((mode) => {
      const Icon = mode.icon;
      return (
        <Card key={mode.id} className="mode-card">
          <Button
            type="button"
            variant="ghost"
            className="mode-card-button h-auto w-full flex-col items-stretch whitespace-normal text-left"
            onClick={() => onStart(mode.id)}
            disabled={disabled}
          >
            <span className={`mode-art ${mode.art}`} aria-hidden="true">
              {mode.id === 'cards' ? (
                <><span className="mini-card back">Aa</span><span className="mini-card front">aA</span></>
              ) : mode.id === 'quiz' ? (
                <><span className="mini-answer"><span>A</span> a little</span><span className="mini-answer selected"><span>B</span> a lot <Check size={14} /></span></>
              ) : (
                <span className="mini-typing">hello<span className="typing-cursor" /> <Keyboard size={22} /></span>
              )}
            </span>
            <span className="mode-title">{mode.title}</span>
            <span className="mode-description">{mode.text}</span>
            <span className="mode-meta"><span><Icon size={14} />{mode.meta}</span><ArrowUpRight size={19} /></span>
          </Button>
        </Card>
      );
    })}
  </div>
);

const Game = ({ plan, allWords, onReview, onExit, onRestart, speak, unavailable = false }) => {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const eventRef = useRef(makeEventId());
  // La banque reste stable pendant la séance, même après une sauvegarde.
  const choiceBank = useRef(allWords).current;
  const word = plan.queue[index];
  const direction = plan.direction;
  const question = word ? (direction === 'en-fr' ? word.english : word.french) : '';
  const solution = word ? (direction === 'en-fr' ? word.french : word.english) : '';
  const accepted = word ? getAcceptedAnswers(word, direction) : [];
  const choices = useMemo(() => {
    if (!word) return [];
    const correct = firstTranslation(direction === 'en-fr' ? word.french : word.english);
    const acceptedSet = new Set(getAcceptedAnswers(word, direction).map(normalizeAnswer));
    const frenchMeanings = new Set(getAcceptedAnswers(word, 'en-fr'));
    const alternatives = [...new Map(
      choiceBank
        .filter((item) => item.id !== word.id && (direction !== 'fr-en' || !getAcceptedAnswers(item, 'en-fr').some((meaning) => frenchMeanings.has(meaning))))
        .map((item) => firstTranslation(direction === 'en-fr' ? item.french : item.english))
        .map((item) => [normalizeAnswer(item), item]),
    ).values()].filter((item) => !acceptedSet.has(normalizeAnswer(item)) && normalizeAnswer(item) !== normalizeAnswer(correct));
    return shuffle([correct, ...shuffle(alternatives).slice(0, 3)]);
  }, [word?.id, choiceBank, direction]);

  const advance = () => {
    setIndex((value) => value + 1);
    setRevealed(false);
    setAnswer('');
    setFeedback(null);
    setError('');
    eventRef.current = makeEventId();
  };

  const submit = async (rating, candidate = '') => {
    if (saving || feedback || unavailable) return;
    setSaving(true);
    setError('');
    try {
      await onReview(word.id, rating, eventRef.current);
      const correct = rating !== 'again';
      setResults((items) => [...items, { word, correct }]);
      if (plan.mode === 'cards') advance();
      else setFeedback({ correct, candidate });
    } catch (issue) {
      setError(issue.status === 404
        ? 'Ce mot a été retiré du carnet sur un autre appareil. Quitte la séance puis relance-la pour récupérer la liste à jour.'
        : `${issue.message} Tu peux réessayer : les réponses confirmées ne seront pas comptées deux fois.`);
    } finally {
      setSaving(false);
    }
  };

  const submitWritten = (event) => {
    event.preventDefault();
    if (!answer.trim()) return;
    const correct = accepted.map(normalizeAnswer).includes(normalizeAnswer(answer));
    submit(correct ? 'good' : 'again', answer);
  };

  if (!word) {
    const correct = results.filter((result) => result.correct).length;
    const mistakes = results.filter((result) => !result.correct).map((result) => result.word);
    return (
      <Card className="session-result panel">
        <div className="result-icon"><Trophy size={40} /></div>
        <p className="eyebrow">UNE SÉANCE DE PLUS POUR TOI</p>
        <h1>Bien joué, Valentin !</h1>
        <p>Chaque révision fait grandir ton vocabulaire.</p>
        <div className="result-stats">
          <div><strong>{results.length}</strong><span>{results.length > 1 ? 'mots révisés' : 'mot révisé'}</span></div>
          <div><strong>{correct}</strong><span>{correct > 1 ? 'bonnes réponses' : 'bonne réponse'}</span></div>
          <div><strong>{results.length ? Math.round(correct / results.length * 100) : 0}%</strong><span>de réussite</span></div>
        </div>
        <p className="footer-note">Ta progression est enregistrée sur le serveur. Les mots difficiles reviendront plus tôt.</p>
        <div className="exercise-actions">
          {mistakes.length > 0 && <Button variant="outline" disabled={unavailable} onClick={() => onRestart({ ...plan, queue: mistakes })}><RefreshCw size={17} />Revoir mes {mistakes.length} erreur{mistakes.length > 1 ? 's' : ''}</Button>}
          <Button onClick={onExit}>Terminer la séance<Check size={17} /></Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="practice-center">
      <div className="practice-header">
        <Button variant="ghost" className="text-button" onClick={onExit}><ArrowLeft size={17} />Quitter la séance</Button>
        <span>{MODES.find((mode) => mode.id === plan.mode)?.title}</span>
        <strong>{index + 1} / {plan.queue.length}</strong>
      </div>
      <Progress className="session-track" value={index / plan.queue.length * 100} aria-label="Progression de la séance" aria-valuetext={`${index} mots terminés sur ${plan.queue.length}`} />
      <div className="question-meta"><Category category={word.category} /><span>{direction === 'en-fr' ? 'Anglais → Français' : 'Français → Anglais'}</span></div>

      {plan.mode === 'cards' ? (
        <>
          <Card className={`flashcard ${revealed ? 'revealed' : ''}`}>
            <Button variant="ghost" size="icon" className="icon-button card-sound" onClick={() => speak(word.english)} aria-label={`Écouter ${word.english}`}><Volume2 size={21} /></Button>
            <Button variant="ghost" className="flashcard-content h-auto whitespace-normal" disabled={unavailable} onClick={() => setRevealed((value) => !value)} aria-label={revealed ? 'Masquer la traduction' : 'Retourner la carte'}>
              <span className="prompt-label">{revealed ? 'LA TRADUCTION' : direction === 'en-fr' ? 'QUE SIGNIFIE CE MOT ?' : 'COMMENT LE DIRE EN ANGLAIS ?'}</span>
              <span className="flashcard-word" lang={direction === 'en-fr' ? 'en' : 'fr'}>{question}</span>
              {revealed ? (
                <><span className="flashcard-answer" lang={direction === 'en-fr' ? 'fr' : 'en'}>{solution}</span>{word.note && <span className="flashcard-note">{word.note}</span>}</>
              ) : (
                <span className="flip-hint"><RefreshCw size={15} />Clique pour retourner la carte</span>
              )}
            </Button>
            {revealed && word.example && <div className="example-block"><p lang="en">“{word.example}”</p>{word.example_fr && <small>{word.example_fr}</small>}</div>}
          </Card>
          {revealed ? (
            <div className="review-buttons">
              <Button disabled={saving || unavailable} variant="outline" onClick={() => submit('again')}><RefreshCw size={17} />À revoir</Button>
              <Button disabled={saving || unavailable} onClick={() => submit('good')}><Check size={17} />Je le savais</Button>
              <Button disabled={saving || unavailable} variant="outline" onClick={() => submit('easy')}><Zap size={17} />Très facile</Button>
            </div>
          ) : <p className="keyboard-hint">Prends un instant pour chercher avant de regarder la réponse.</p>}
        </>
      ) : (
        <>
          <Card className="question-card panel">
            <p className="prompt-label">{direction === 'en-fr' ? 'TROUVE LA TRADUCTION FRANÇAISE' : 'TROUVE LA TRADUCTION ANGLAISE'}</p>
            <div className="question-word">
              <h2 lang={direction === 'en-fr' ? 'en' : 'fr'}>{question}</h2>
              {direction === 'en-fr' && <Button variant="ghost" size="icon" className="icon-button" aria-label={`Écouter ${word.english}`} onClick={() => speak(word.english)}><Volume2 size={22} /></Button>}
            </div>
            {direction === 'fr-en' && word.example_fr && <p className="question-context">Contexte : {word.example_fr}</p>}
          </Card>
          {plan.mode === 'quiz' ? (
            <div className="answer-options">
              {choices.map((choice, optionIndex) => {
                const correctChoice = accepted.map(normalizeAnswer).includes(normalizeAnswer(choice)) || normalizeAnswer(choice) === normalizeAnswer(firstTranslation(solution));
                const className = feedback ? correctChoice ? 'correct' : feedback.candidate === choice ? 'wrong' : '' : '';
                return (
                  <Button key={choice} variant="outline" className={`answer-option h-auto whitespace-normal ${className}`} disabled={saving || unavailable || !!feedback} onClick={() => { setAnswer(choice); submit(correctChoice ? 'good' : 'again', choice); }}>
                    <span className="answer-letter">{'ABCD'[optionIndex]}</span>
                    <span>{choice}</span>
                    {feedback && correctChoice && <Check size={18} />}
                  </Button>
                );
              })}
            </div>
          ) : (
            <form className="translation-form" onSubmit={submitWritten}>
              <Label htmlFor="translation-answer" className="sr-only">Ta traduction</Label>
              <Input id="translation-answer" className="answer-input" autoComplete="off" autoFocus disabled={!!feedback || saving || unavailable} placeholder={direction === 'en-fr' ? 'Écris la traduction en français…' : 'Écris la traduction en anglais…'} value={answer} onChange={(event) => setAnswer(event.target.value)} />
              <Button type="submit" disabled={!!feedback || saving || unavailable || !answer.trim()}>{saving ? <LoaderCircle className="spinner" size={18} /> : <Check size={18} />}Vérifier</Button>
            </form>
          )}
          {feedback && (
            <div className={`feedback ${feedback.correct ? 'correct' : 'wrong'}`} role="status">
              <strong>{feedback.correct ? 'Exactement, bien joué !' : 'Ce mot reviendra pour t’aider à le retenir.'}</strong>
              <p>{word.english} <ArrowRight size={15} /> {word.french}</p>
              {word.example && <div className="example-block"><p lang="en">{word.example}</p><small>{word.example_fr}</small></div>}
              {word.note && <small>{word.note}</small>}
              <Button disabled={unavailable} onClick={advance}>Continuer<ArrowRight size={18} /></Button>
            </div>
          )}
        </>
      )}
      {saving && <p className="footer-note"><LoaderCircle size={14} className="spinner" />Enregistrement de ta réponse…</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
};

export { MODES, ModeCards, Game };
