import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CSV_COLUMNS, MAX_WORDS, parseVocabularyCsv, sanitizeWord, vocabularyKey } from '../shared/vocabulary.js';
import { applyAction, appError } from './actions.js';
import { readRecords, serializeCsv } from './csv.js';
import { LIBRARY_FILES, prepareLibraryImport, applyLibraryImport, librarySnapshot, collectionSnapshot, applyLessonProgress, exportCollectionCsv } from './library.js';
import { LEARNING_FILES, emptyLearningFiles, decodeLearning, encodeLearning, learningSnapshot, lessonSnapshot, applyLearningAction } from './learning-state.js';

export const WORD_COLUMNS = CSV_COLUMNS.filter((column) => column !== 'history');
export const REVIEW_COLUMNS = ['word_id', 'event_id', 'at', 'rating'];
export const SETTING_COLUMNS = ['key', 'value'];
const JOURNAL_COLUMNS = ['file', 'temporary', 'sha256'];
const BASE_FILES = ['vocabulaire.csv', 'revisions.csv', 'parametres.csv'];
export const DATA_FILES = [...BASE_FILES, ...LEARNING_FILES];
const V2_FILES = DATA_FILES.filter((name) => !LIBRARY_FILES.includes(name));
const MAX_STORAGE_BYTES = 10 * 1024 * 1024;
const JOURNAL = '.transaction.csv';
const validId = (value) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const defaults = { goal: 10, theme: 'dark' };
const unreadable = () => appError('Les fichiers CSV sauvegardés ne peuvent pas être lus. Aucune donnée n’a été réinitialisée ni remplacée. Vérifie le dossier data ou restaure une sauvegarde complète.', 503);
const protectCell = (value) => /^[\s]*[=+\-@\t\r\n']/.test(String(value ?? '')) ? `'${value}` : value;

const validateSettings = (settings) => {
  if (!settings || ![5, 10, 15, 20].includes(Number(settings.goal)) || !['light', 'dark'].includes(settings.theme)) throw appError('L’objectif ou le thème est non valide.');
  return { goal: Number(settings.goal), theme: settings.theme };
};

const serializeWords = (words) => serializeCsv(WORD_COLUMNS, words.map((word) => Object.fromEntries(WORD_COLUMNS.map((column) => [column, column === 'csv_format' ? 'wordbloom-v1' : protectCell(word[column])]))));

const decodeState = (files) => {
  const records = readRecords(files['vocabulaire.csv'], WORD_COLUMNS, { maxRows: MAX_WORDS + 1 });
  const ids = new Set(), pairs = new Set();
  const words = records.map((raw) => {
    if (raw.csv_format !== 'wordbloom-v1') throw new Error('Version CSV inconnue.');
    const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.startsWith("'") ? value.slice(1) : value]));
    if (!validId(row.id) || ids.has(row.id) || !row.created_at || !['true', 'false'].includes(row.favorite)) throw new Error('Mot ou identifiant non valide.');
    if (['stage', 'review_count', 'correct_count'].some((key) => !/^\d+$/.test(row[key]))) throw new Error('Progression incomplète.');
    const word = sanitizeWord(row);
    const pair = vocabularyKey(word);
    if (pairs.has(pair)) throw new Error('Vocabulaire en double.');
    ids.add(word.id); pairs.add(pair);
    return word;
  });
  const byId = new Map(words.map((word) => [word.id, word]));
  const eventIds = new Set();
  for (const row of readRecords(files['revisions.csv'], REVIEW_COLUMNS, { maxRows: MAX_WORDS * 1000 + 1 })) {
    const word = byId.get(row.word_id);
    const key = `${row.word_id}\0${row.event_id}`;
    if (!word || !validId(row.event_id) || !['again', 'good', 'easy'].includes(row.rating) || !row.at || Number.isNaN(Date.parse(row.at)) || eventIds.has(key)) throw new Error('Révision non valide ou sans mot associé.');
    eventIds.add(key);
    word.history.push({ event_id: row.event_id, at: new Date(row.at).toISOString(), rating: row.rating });
    if (word.history.length > 1000) throw new Error('Historique trop long.');
  }
  for (const word of words) {
    if (word.history.length > word.review_count || word.history.filter((event) => event.rating !== 'again').length > word.correct_count) throw new Error('Historique et compteurs incohérents.');
  }
  const settingRows = readRecords(files['parametres.csv'], SETTING_COLUMNS, { maxRows: 3 });
  if (settingRows.length !== 2 || new Set(settingRows.map((row) => row.key)).size !== 2 || settingRows.some((row) => !['goal', 'theme'].includes(row.key))) throw new Error('Paramètres incomplets.');
  const settings = validateSettings(Object.fromEntries(settingRows.map((row) => [row.key, row.value])));
  return { words, settings, ...decodeLearning(files) };
};

const encodeState = (state) => {
  const { words, settings } = state;
  if (words.length > MAX_WORDS) throw appError('La collection est limitée à 5 000 mots.');
  const files = {
    ...encodeLearning(state),
    'vocabulaire.csv': serializeWords(words),
    'revisions.csv': serializeCsv(REVIEW_COLUMNS, words.flatMap((word) => word.history.map((event) => ({ word_id: word.id, ...event })))),
    'parametres.csv': serializeCsv(SETTING_COLUMNS, Object.entries(validateSettings(settings)).map(([key, value]) => ({ key, value }))),
  };
  if (Object.values(files).reduce((total, content) => total + Buffer.byteLength(content, 'utf8'), 0) > MAX_STORAGE_BYTES) throw appError('La sauvegarde dépasse 10 Mo. Exporte une sauvegarde avant de réduire tes données.', 413);
  // On valide aussi les nouvelles données avant de créer le moindre fichier temporaire.
  decodeState(files);
  return files;
};

const revisionOf = (files) => hash(DATA_FILES.map((name) => `${name}\0${files[name]}`).join('\0'));
const exists = async (filename) => {
  try { await fs.access(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

export const createStore = ({ dataDir, seedPath = fileURLToPath(new URL('../exemples/pack-demarrage.csv', import.meta.url)), onCommitStep } = {}) => {
  if (!dataDir) throw new Error('Un dossier de données est nécessaire.');
  const directory = path.resolve(dataDir);
  let queue = Promise.resolve();
  const serial = (operation) => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const syncDirectory = async () => {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  };
  const readFile = async (filename) => {
    const fullPath = path.join(directory, filename);
    const stat = await fs.lstat(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORAGE_BYTES) throw unreadable();
    return new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(fullPath));
  };
  const writeDurable = async (filename, content) => {
    const handle = await fs.open(path.join(directory, filename), 'wx', 0o600);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  };

  const recover = async () => {
    if (!await exists(path.join(directory, JOURNAL))) return;
    try {
      const entries = readRecords(await readFile(JOURNAL), JOURNAL_COLUMNS, { maxRows: DATA_FILES.length + 1, maxBytes: 8192 });
      if (![BASE_FILES, V2_FILES, DATA_FILES].some((schema) => entries.length === schema.length && new Set(entries.map((entry) => entry.file)).size === schema.length && entries.every((entry) => schema.includes(entry.file)))) throw new Error('Journal incomplet.');
      const files = { ...emptyLearningFiles() }, pending = [];
      for (const entry of entries) {
        if (!DATA_FILES.includes(entry.file) || !/^\.pending-[a-f0-9-]{36}-[a-z-]+\.csv$/.test(entry.temporary) || !entry.temporary.endsWith(`-${entry.file}`) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Journal non valide.');
        const isPending = await exists(path.join(directory, entry.temporary));
        const content = await readFile(isPending ? entry.temporary : entry.file);
        if (hash(content) !== entry.sha256) throw new Error('Une empreinte du journal ne correspond pas.');
        files[entry.file] = content;
        if (isPending) pending.push(entry);
      }
      decodeState(files);
      for (const entry of pending) await fs.rename(path.join(directory, entry.temporary), path.join(directory, entry.file));
      await syncDirectory();
      await fs.unlink(path.join(directory, JOURNAL));
      await syncDirectory();
    } catch {
      throw appError('Une sauvegarde interrompue ne peut pas être reprise. Aucune donnée n’a été réinitialisée. Conserve tout le dossier data pour restaurer une sauvegarde complète.', 503);
    }
  };

  const commit = async (files) => {
    const transaction = randomUUID();
    const entries = DATA_FILES.map((file) => ({ file, temporary: `.pending-${transaction}-${file}`, sha256: hash(files[file]) }));
    for (const entry of entries) await writeDurable(entry.temporary, files[entry.file]);
    await syncDirectory();
    const journalTemporary = `.journal-${transaction}.csv`;
    await writeDurable(journalTemporary, serializeCsv(JOURNAL_COLUMNS, entries));
    await fs.rename(path.join(directory, journalTemporary), path.join(directory, JOURNAL));
    await syncDirectory();
    // Le journal durable est le point de validation. Une interruption reprend toutes les versions ensemble.
    await onCommitStep?.('journal');
    for (const entry of entries) {
      await fs.rename(path.join(directory, entry.temporary), path.join(directory, entry.file));
      await onCommitStep?.(`rename:${entry.file}`);
    }
    await syncDirectory();
    await fs.unlink(path.join(directory, JOURNAL));
    await syncDirectory();
  };

  const load = async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await recover();
    const names = await fs.readdir(directory);
    const canonical = DATA_FILES.filter((name) => names.includes(name));
    if (!canonical.length) {
      const unknown = names.filter((name) => !/^\.(pending|journal)-[a-f0-9-]{36}(?:-[a-z-]+)?\.csv$/.test(name));
      if (unknown.length) throw unreadable();
      let parsed;
      try {
        const seed = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(seedPath));
        parsed = parseVocabularyCsv(seed);
        if (parsed.errors.length) throw new Error('Pack de démarrage illisible.');
      } catch {
        throw appError('Le pack CSV de démarrage est absent ou illisible. Aucune donnée n’a été créée.', 503);
      }
      const files = encodeState({ words: parsed.words, settings: defaults });
      await commit(files);
      return { ...decodeState(files), files, revision: revisionOf(files) };
    }
    const previousSchema = [V2_FILES, BASE_FILES].find((schema) => schema.every((name) => names.includes(name)) && DATA_FILES.filter((name) => !schema.includes(name)).every((name) => !names.includes(name)));
    const migrating = !!previousSchema;
    if (canonical.length !== DATA_FILES.length && !migrating) throw unreadable();
    if (migrating) {
      const files = { ...emptyLearningFiles(), ...Object.fromEntries(await Promise.all(previousSchema.map(async (filename) => [filename, await readFile(filename)]))) };
      decodeState(files);
      await commit(files);
    }
    try {
      const files = Object.fromEntries(await Promise.all(DATA_FILES.map(async (filename) => [filename, await readFile(filename)])));
      if (Object.values(files).reduce((total, content) => total + Buffer.byteLength(content, 'utf8'), 0) > MAX_STORAGE_BYTES) throw unreadable();
      return { ...decodeState(files), files, revision: revisionOf(files) };
    } catch {
      throw unreadable();
    }
  };

  const publicState = ({ words, settings, revision }) => ({ words, settings, revision, storage: 'csv' });

  return {
    // Aucun descripteur de fichier ne reste ouvert ; attendre suffit pour achever les écritures.
    close: () => queue,
    load: () => serial(async () => publicState(await load())),
    exportCsv: () => serial(async () => (await load()).files['vocabulaire.csv']),
    backupFiles: () => serial(async () => ({ ...(await load()).files })),
    exportFile: (filename) => serial(async () => {
      if (!DATA_FILES.includes(filename)) throw appError('Export non autorise.', 404);
      return (await load()).files[filename];
    }),
    exportCollection: (id) => serial(async () => exportCollectionCsv(await load(),id)),
    librarySnapshot: () => serial(async () => librarySnapshot(await load())),
    collection: (id) => serial(async () => collectionSnapshot(await load(),id)),
    previewLibrary: (payload) => serial(async () => prepareLibraryImport(await load(),payload).preview),
    importLibrary: (payload) => serial(async () => {
      const current=await load(); const {state,result}=applyLibraryImport(current,payload);
      const files=encodeState(state); if(revisionOf(files)!==current.revision)await commit(files); return result;
    }),
    updateLessonProgress: (payload) => serial(async () => {
      const current=await load();const {state,result}=applyLessonProgress(current,payload);
      const files=encodeState(state);if(revisionOf(files)!==current.revision)await commit(files);return result;
    }),
    learningSnapshot: () => serial(async () => learningSnapshot(await load())),
    lesson: (id) => serial(async () => lessonSnapshot(await load(),id)),
    learningMutate: (payload) => serial(async () => {
      const current = await load();
      const { state, result } = applyLearningAction(current,payload);
      const files = encodeState(state);
      if (revisionOf(files) !== current.revision) await commit(files);
      return result;
    }),
    mutate: (payload) => serial(async () => {
      const current = await load();
      const result = applyAction(current.words, payload);
      const files = encodeState({ ...current, words: result.words });
      const revision = revisionOf(files);
      if (revision !== current.revision) await commit(files);
      return { ...publicState({ words: result.words, settings: current.settings, revision }), ...(result.added !== undefined ? { added: result.added, skipped: result.skipped } : {}) };
    }),
    updateSettings: (changes) => serial(async () => {
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some((key) => !['goal', 'theme'].includes(key))) throw appError('Paramètres non valides.');
      const current = await load();
      const settings = validateSettings({ ...current.settings, ...changes });
      const files = encodeState({ ...current, settings });
      if (revisionOf(files) !== current.revision) await commit(files);
      return { settings };
    }),
  };
};
