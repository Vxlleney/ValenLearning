import { randomUUID, createHash } from 'node:crypto';
import { appError, applyAction } from './actions.js';
import { readRecords, serializeCsv } from './csv.js';
import { LIBRARY_TABLES, validateLibraryState } from './library.js';

// Une ligne par objet : aucune liste JSON n'est stockee dans une cellule.
export const LEARNING_TABLES = {
  ...LIBRARY_TABLES,
  lessons: { file: 'lecons.csv', columns: ['id', 'title', 'topic', 'level', 'summary', 'source', 'created_at'] },
  exercises: { file: 'exercices.csv', columns: ['id', 'lesson_id', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_index', 'explanation'] },
  attempts: { file: 'resultats-exercices.csv', columns: ['id', 'exercise_id', 'selected_index', 'correct', 'at'] },
  corrections: { file: 'corrections.csv', columns: ['id', 'original', 'corrected', 'translation', 'explanation', 'tip', 'level', 'created_at'] },
  usage: { file: 'utilisation-ia.csv', columns: ['id', 'action', 'day', 'status', 'model', 'input_tokens', 'output_tokens', 'result_id', 'added', 'skipped', 'error_code', 'payload_hash', 'created_at', 'completed_at'] },
};
export const LEARNING_FILES = Object.values(LEARNING_TABLES).map((table) => table.file);
export const isId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const hashPayload = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const protect = (value) => /^[\s]*[=+\-@\t\r\n']/.test(String(value ?? '')) ? `'${value}` : value;
const unprotect = (value) => value.startsWith("'") ? value.slice(1) : value;
const validDate = (value) => typeof value === 'string' && !!value && !Number.isNaN(Date.parse(value));
const validIndex = (value) => /^[0-3]$/.test(String(value));
const assert = (condition) => { if (!condition) throw new Error('Contenu CSV apprentissage non valide.'); };

export const emptyLearningFiles = () => Object.fromEntries(Object.values(LEARNING_TABLES).map(({file, columns}) => [file, serializeCsv(columns, [])]));
export const decodeLearning = (files) => {
  const state = {};
  for (const [key, table] of Object.entries(LEARNING_TABLES)) {
    const ids = new Set();
    state[key] = readRecords(files[table.file], table.columns, { maxRows: 50001 }).map((record) => {
      const row = Object.fromEntries(Object.entries(record).map(([name, value]) => [name, unprotect(value)]));
      assert(isId(row.id) && !ids.has(row.id));
      assert(Object.values(row).every((value) => value.length <= 12000 && !value.includes('\0')));
      ids.add(row.id);
      return row;
    });
  }
  const lessonIds = new Set(state.lessons.map((item) => item.id));
  const exerciseIds = new Set(state.exercises.map((item) => item.id));
  for (const row of state.lessons) assert(row.title && row.summary && validDate(row.created_at) && ['A1','A2','B1','B2','C1'].includes(row.level));
  for (const row of state.exercises) assert(lessonIds.has(row.lesson_id) && validIndex(row.correct_index) && row.question && row.explanation && ['option_a','option_b','option_c','option_d'].every((key) => row[key]));
  for (const row of state.attempts) assert(exerciseIds.has(row.exercise_id) && validIndex(row.selected_index) && ['true','false'].includes(row.correct) && validDate(row.at));
  for (const row of state.corrections) assert(row.original && row.corrected && validDate(row.created_at) && ['A1','A2','B1','B2','C1'].includes(row.level));
  for (const row of state.usage) assert(['vocabulary','lesson','correction'].includes(row.action) && ['pending','completed','failed'].includes(row.status) && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && /^[a-f0-9]{64}$/.test(row.payload_hash) && validDate(row.created_at) && ['input_tokens','output_tokens','added','skipped'].every((key) => /^\d+$/.test(row[key])));
  validateLibraryState(state);
  return state;
};
export const encodeLearning = (state) => Object.fromEntries(Object.entries(LEARNING_TABLES).map(([key, {file, columns}]) => [file, serializeCsv(columns, (state[key] || []).map((record) => Object.fromEntries(columns.map((column) => [column, protect(record[column])]))))]));

export const learningSnapshot = (state) => {
  const today = state.usage.filter((row) => row.day === dayKey());
  const latest = new Map();
  for (const attempt of state.attempts) latest.set(attempt.exercise_id, attempt);
  return {
    lessons: [...state.lessons].reverse().map((lesson) => {
      const exercises = state.exercises.filter((row) => row.lesson_id === lesson.id);
      return { ...lesson, exercise_count: exercises.length, answered: exercises.filter((item) => latest.has(item.id)).length, correct: exercises.filter((item) => latest.get(item.id)?.correct === 'true').length };
    }),
    corrections: [...state.corrections].reverse().slice(0, 100),
    total_corrections: state.corrections.length,
    attempts_count: state.attempts.length,
    usage: { today: today.length, completed: today.filter((row) => row.status === 'completed').length,
      input_tokens: today.reduce((total,row) => total + Number(row.input_tokens),0), output_tokens: today.reduce((total,row) => total + Number(row.output_tokens),0),
      last_success: [...state.usage].reverse().find((row) => row.status === 'completed')?.completed_at || '',
      recent: state.usage.slice(-10).reverse().map(({ id, action, status, model, created_at, completed_at, error_code }) => ({ id, action, status, model, created_at, completed_at, error_code })),
    },
  };
};
const grade = (exercise, attempt) => ({ ...attempt, correct: attempt.correct === 'true', selected_index: Number(attempt.selected_index), correct_index: Number(exercise.correct_index), explanation: exercise.explanation });
export const lessonSnapshot = (state, id) => {
  const lesson = state.lessons.find((row) => row.id === id);
  if (!lesson) throw appError('Cette leçon est introuvable.',404);
  return { ...lesson, exercises: state.exercises.filter((row) => row.lesson_id === id).map((exercise) => {
    const attempt = [...state.attempts].reverse().find((row) => row.exercise_id === exercise.id);
    return { id: exercise.id, question: exercise.question, options: ['option_a','option_b','option_c','option_d'].map((key) => exercise[key]), last_attempt: attempt ? grade(exercise,attempt) : null };
  }) };
};
const completedResult = (state, row) => ({ kind: row.action, request_id: row.id, added: Number(row.added), skipped: Number(row.skipped),
  ...(row.action === 'lesson' ? { lesson: lessonSnapshot(state,row.result_id) } : {}),
  ...(row.action === 'correction' ? { correction: state.corrections.find((item) => item.id === row.result_id) } : {}),
});

export const applyLearningAction = (current, payload) => {
  const state = { ...current, ...Object.fromEntries(Object.keys(LEARNING_TABLES).map((key) => [key,[...current[key]]])) };
  const now = new Date().toISOString();
  if (payload.action === 'reserve') {
    const { id, kind, model, payloadHash, dailyLimit } = payload;
    if (!isId(id)) throw appError('Identifiant de demande invalide.');
    const existing = state.usage.find((row) => row.id === id);
    if (existing) {
      if (existing.payload_hash !== payloadHash || existing.action !== kind) throw appError('Cet identifiant correspond à une autre demande.',409);
      if (existing.status === 'completed') return { state, result: { cached: true, ...completedResult(state,existing) } };
      throw appError('Cette demande a déjà été envoyée. Actualise le carnet avant de lancer une nouvelle génération.',409);
    }
    if (state.usage.filter((row) => row.day === dayKey()).length >= dailyLimit) throw appError('La limite quotidienne d’appels IA est atteinte. Les jeux et les contenus enregistrés restent accessibles.',429);
    if (state.usage.some((row) => row.status === 'pending' && Date.now() - Date.parse(row.created_at) < 95000)) throw appError('Une génération est déjà en cours sur un appareil.',409);
    state.usage.push({ id, action: kind, day: dayKey(), status: 'pending', model, input_tokens: 0, output_tokens: 0, result_id: '', added: 0, skipped: 0, error_code: '', payload_hash: payloadHash, created_at: now, completed_at: '' });
    return { state, result: { cached: false } };
  }
  if (payload.action === 'complete' || payload.action === 'fail') {
    const index = state.usage.findIndex((row) => row.id === payload.id);
    if (index < 0) throw appError('La demande IA n’existe pas.',404);
    const previous = state.usage[index];
    if (previous.status === 'completed') return { state, result: completedResult(state,previous) };
    if (previous.status !== 'pending') throw appError('La demande IA est déjà terminée.',409);
    const tokens = payload.usage || {};
    const record = { ...previous, status: payload.action === 'fail' ? 'failed' : 'completed', completed_at: now,
      input_tokens: Math.max(0,Math.trunc(Number(tokens.input_tokens)||0)), output_tokens: Math.max(0,Math.trunc(Number(tokens.output_tokens)||0)), error_code: payload.errorCode || '' };
    if (payload.action === 'complete') {
      const data = payload.data;
      if (previous.action === 'vocabulary') {
        const incoming = data.words.map((word) => ({ ...word, source: `OpenAI / ${previous.model}`, note: `[${payload.level}] ${word.note}`.slice(0,1000) }));
        const merged = applyAction(state.words,{ action: 'add_many', words: incoming });
        state.words = merged.words; record.added = merged.added; record.skipped = merged.skipped;
      } else if (previous.action === 'lesson') {
        const id = randomUUID(); record.result_id = id;
        state.lessons.push({ id, title: data.title, summary: data.summary, topic: payload.topic, level: payload.level, source: `OpenAI / ${previous.model}`, created_at: now });
        state.exercises.push(...data.exercises.map((exercise) => ({ id: randomUUID(), lesson_id: id, question: exercise.question, option_a: exercise.options[0], option_b: exercise.options[1], option_c: exercise.options[2], option_d: exercise.options[3], correct_index: exercise.correct_index, explanation: exercise.explanation })));
      } else {
        const id = randomUUID(); record.result_id = id;
        state.corrections.push({ id, original: payload.original, corrected: data.corrected, translation: data.translation, explanation: data.explanation, tip: data.tip, level: payload.level, created_at: now });
      }
    }
    state.usage[index] = record;
    return { state, result: payload.action === 'fail' ? { status: 'failed' } : completedResult(state,record) };
  }
  if (payload.action === 'answer') {
    if (!isId(payload.id) || !isId(payload.exercise_id) || !Number.isInteger(payload.selected_index) || payload.selected_index < 0 || payload.selected_index > 3) throw appError('Réponse non valide.');
    const exercise = state.exercises.find((row) => row.id === payload.exercise_id);
    if (!exercise) throw appError('Exercice introuvable.',404);
    const existing = state.attempts.find((row) => row.id === payload.id);
    if (existing) {
      if (existing.exercise_id !== exercise.id || Number(existing.selected_index) !== payload.selected_index) throw appError('Cette réponse a déjà été enregistrée avec un autre choix.',409);
      return { state, result: grade(exercise,existing) };
    }
    const attempt = { id: payload.id, exercise_id: exercise.id, selected_index: String(payload.selected_index), correct: String(Number(exercise.correct_index) === payload.selected_index), at: now };
    state.attempts.push(attempt);
    return { state, result: grade(exercise,attempt) };
  }
  throw appError('Action d’apprentissage inconnue.');
};
