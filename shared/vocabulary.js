// Le vocabulaire et sa progression voyagent ensemble dans un fichier CSV.
export const MAX_WORDS = 5000;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const CSV_COLUMNS = ['id', 'english', 'french', 'category', 'example', 'example_fr', 'note', 'source', 'favorite', 'stage', 'review_count', 'correct_count', 'due_at', 'last_reviewed', 'created_at', 'history', 'csv_format'];

export const normalizeAnswer = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?,:;]+$/g, '').trim();
export const vocabularyKey = (word) => `${normalizeAnswer(word.english)}\u0000${normalizeAnswer(word.french)}`;
const headerKey = (value) => normalizeAnswer(value).replace(/[^a-z0-9]/g, '');
const ALIASES = {
  id: 'id', english: 'english', anglais: 'english', en: 'english', word: 'english', mot: 'english', motanglais: 'english', terme: 'english',
  french: 'french', francais: 'french', fr: 'french', translation: 'french', traduction: 'french', traductionfrancaise: 'french',
  category: 'category', categorie: 'category', theme: 'category', topic: 'category',
  example: 'example', exemple: 'example', exampleen: 'example', exempleanglais: 'example', sentence: 'example',
  examplefr: 'example_fr', exemplefr: 'example_fr', exemplefrancais: 'example_fr', traductionexemple: 'example_fr',
  note: 'note', notes: 'note', source: 'source', origine: 'source', favorite: 'favorite', favori: 'favorite',
  stage: 'stage', niveau: 'stage', reviewcount: 'review_count', correctcount: 'correct_count', dueat: 'due_at', lastreviewed: 'last_reviewed', createdat: 'created_at', history: 'history', historique: 'history', csvformat: 'csv_format',
};

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
// Les aperçus HTTP n'exposent pas toujours randomUUID ; l'identifiant n'est pas un secret.
const createId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const suffix = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36)).join('-')
    : `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `word-${Date.now().toString(36)}-${suffix}`;
};
const asText = (value, name, max, required = false) => {
  const text = value == null ? '' : String(value).trim();
  if (required && !text) throw fail(`Le champ « ${name} » est obligatoire.`);
  if (text.length > max) throw fail(`Le champ « ${name} » dépasse ${max} caractères.`);
  if (text.includes('\u0000')) throw fail(`Le champ « ${name} » contient un caractère non valide.`);
  return text;
};
const asNumber = (value, fallback, max) => {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw fail('La progression contient un nombre non valide.');
  return number;
};
const asDate = (value, fallback = '') => {
  if (value == null || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw fail('Une date de progression est non valide.');
  return date.toISOString();
};

export const sanitizeWord = (input, { now = new Date().toISOString(), preserveProgress = true } = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Chaque mot doit être un objet.');
  const word = {
    id: input.id && /^[a-zA-Z0-9_-]{1,100}$/.test(String(input.id)) ? String(input.id) : createId(),
    english: asText(input.english, 'anglais', 160, true),
    french: asText(input.french, 'français', 400, true),
    category: asText(input.category || 'Personnel', 'catégorie', 80),
    example: asText(input.example, 'exemple anglais', 800),
    example_fr: asText(input.example_fr, 'exemple français', 800),
    note: asText(input.note, 'note', 1000),
    source: asText(input.source || 'Ajout personnel', 'source', 180),
    favorite: input.favorite === true || input.favorite === 1 || ['true', '1', 'oui'].includes(String(input.favorite).toLowerCase()),
    stage: preserveProgress ? asNumber(input.stage, 0, 6) : 0,
    review_count: preserveProgress ? asNumber(input.review_count, 0, 1000000) : 0,
    correct_count: preserveProgress ? asNumber(input.correct_count, 0, 1000000) : 0,
    due_at: preserveProgress ? asDate(input.due_at, now) : now,
    last_reviewed: preserveProgress ? asDate(input.last_reviewed) : '',
    created_at: asDate(input.created_at, now),
    history: [],
  };
  if (word.correct_count > word.review_count) throw fail('Le nombre de bonnes réponses dépasse le nombre de révisions.');
  if (preserveProgress && input.history) {
    let history = input.history;
    if (typeof history === 'string') {
      try { history = JSON.parse(history); } catch { throw fail('L’historique de révision est illisible.'); }
    }
    if (!Array.isArray(history) || history.length > 1000) throw fail('L’historique est limité à 1 000 révisions par mot.');
    word.history = history.map((event) => {
      if (!event || !['again', 'good', 'easy'].includes(event.rating)) throw fail('Une révision contient un résultat non valide.');
      if (!event.at || !event.event_id || !/^[a-zA-Z0-9_-]{1,100}$/.test(String(event.event_id))) throw fail('Une révision contient un identifiant ou une date non valide.');
      return { at: asDate(event.at), rating: event.rating, event_id: String(event.event_id) };
    });
  }
  return word;
};

const detectDelimiter = (text) => {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && (character === '\n' || character === '\r')) break;
    else if (!quoted && character in counts) counts[character] += 1;
  }
  return Object.keys(counts).sort((left, right) => counts[right] - counts[left])[0];
};

const readCsvRows = (text, delimiter) => {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, line = 1, start = 1;
  const pushRow = () => {
    row.push(field);
    if (row.some((value) => value.trim() !== '')) rows.push({ values: row, line: start });
    row = []; field = ''; closed = false; start = line;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; closed = true; }
      } else { field += char; if (char === '\n') line += 1; }
      continue;
    }
    if (char === '"' && !field.trim() && !closed) { field = ''; quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; closed = false; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      line += 1; pushRow();
      if (rows.length > MAX_WORDS + 1) throw fail(`Le fichier est limité à ${MAX_WORDS} mots.`);
      continue;
    }
    if (closed && !/\s/.test(char)) throw fail(`Ligne ${line} : caractère inattendu après un guillemet fermant.`);
    if (char === '"') throw fail(`Ligne ${line} : guillemet inattendu. Entourez toute la cellule de guillemets.`);
    if (!closed) field += char;
  }
  if (quoted) throw fail(`Ligne ${start} : une cellule entre guillemets n’est pas fermée.`);
  if (field || row.length) pushRow();
  return rows;
};

export const parseVocabularyCsv = (input = '', { maxBytes = MAX_CSV_BYTES } = {}) => {
  const errors = [];
  let delimiter = ',';
  try {
    const text = String(input).replace(/^\uFEFF/, '').replace(/^\s*```(?:csv|text)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
    if (!text) return { words: [], errors: ['Le fichier CSV est vide.'], delimiter };
    if (new TextEncoder().encode(text).length > maxBytes) throw fail(`Le fichier CSV dépasse la limite de ${Math.round(maxBytes / 1024 / 1024)} Mo.`);
    delimiter = detectDelimiter(text);
    const rows = readCsvRows(text, delimiter);
    if (!rows.length) throw fail('Le fichier CSV est vide.');
    const possibleHeaders = rows[0].values.map((value) => ALIASES[headerKey(value)] || '');
    const hasHeaders = possibleHeaders.includes('english') && possibleHeaders.includes('french');
    const headers = hasHeaders ? possibleHeaders : ['english', 'french', 'category', 'example', 'example_fr', 'note', 'source'];
    if (hasHeaders && (headers.filter((value) => value === 'english').length > 1 || headers.filter((value) => value === 'french').length > 1)) throw fail('Les colonnes anglais ou français apparaissent plusieurs fois.');
    const dataRows = hasHeaders ? rows.slice(1) : rows;
    if (!dataRows.length) throw fail('Le CSV contient un en-tête mais aucun mot.');
    if (dataRows.length > MAX_WORDS) throw fail(`Le fichier est limité à ${MAX_WORDS} mots.`);
    const words = [];
    dataRows.forEach(({ values, line }) => {
      try {
        if (values.length < 2) throw fail('deux colonnes anglais et français sont nécessaires.');
        if (values.length > (hasHeaders ? headers.length : 7)) throw fail('trop de colonnes ; vérifiez les guillemets autour des cellules contenant le séparateur.');
        const row = Object.fromEntries(headers.flatMap((name, index) => name ? [[name, values[index] ?? '']] : []));
        if (row.csv_format === 'wordbloom-v1') {
          Object.keys(row).forEach((key) => { if (typeof row[key] === 'string' && row[key].startsWith("'")) row[key] = row[key].slice(1); });
        }
        words.push(sanitizeWord(row));
      } catch (error) { errors.push(`Ligne ${line} : ${error.message}`); }
    });
    return { words, errors, delimiter };
  } catch (error) { return { words: [], errors: [error.message], delimiter }; }
};

// Le préfixe est retiré uniquement lors d'un réimport portant notre marqueur.
const protectSpreadsheetCell = (value) => /^[\s]*[=+\-@\t\r\n']/.test(value) ? `'${value}` : value;
const csvCell = (value) => `"${protectSpreadsheetCell(String(value ?? '')).replace(/"/g, '""')}"`;
export const serializeVocabularyCsv = (words) => [
  CSV_COLUMNS.join(','),
  ...words.map((word) => CSV_COLUMNS.map((key) => csvCell(key === 'csv_format' ? 'wordbloom-v1' : key === 'history' ? JSON.stringify(word.history || []) : word[key])).join(',')),
].join('\r\n') + '\r\n';

export const mergeVocabulary = (existing, incoming) => {
  const words = existing.map((word) => ({ ...word }));
  const known = new Set(words.map(vocabularyKey));
  const ids = new Set(words.map((word) => word.id));
  let added = 0, skipped = 0;
  incoming.forEach((entry) => {
    const word = sanitizeWord(entry);
    const key = vocabularyKey(word);
    if (known.has(key)) { skipped += 1; return; }
    if (ids.has(word.id)) word.id = createId();
    known.add(key); ids.add(word.id); words.push(word); added += 1;
  });
  if (words.length > MAX_WORDS) throw fail(`La collection est limitée à ${MAX_WORDS} mots.`);
  return { words, added, skipped };
};

export const getAcceptedAnswers = (word, direction = 'en-fr') => {
  const value = direction === 'fr-en' ? word.english : word.french;
  const answers = String(value || '').split(/\s*[/;|]\s*/).map(normalizeAnswer).filter(Boolean);
  // L'infinitif anglais peut être répondu avec ou sans « to ».
  if (direction === 'fr-en') answers.forEach((answer) => { if (answer.startsWith('to ')) answers.push(answer.slice(3)); });
  return [...new Set(answers)];
};

export const dateKey = (value = new Date(), timeZone = 'Europe/Paris') => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const shiftDay = (day, offset) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
export const computeStats = (words = [], now = new Date()) => {
  const today = dateKey(now);
  const days = new Map();
  words.forEach((word) => (word.history || []).forEach((event) => {
    const day = dateKey(event.at);
    if (!days.has(day)) days.set(day, { ids: new Set(), correct: 0, attempts: 0 });
    const record = days.get(day); record.ids.add(word.id); record.attempts += 1;
    if (event.rating !== 'again') record.correct += 1;
  }));
  const reviewCount = words.reduce((total, word) => total + (word.review_count || 0), 0);
  const correctCount = words.reduce((total, word) => total + (word.correct_count || 0), 0);
  let streak = 0;
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  while (days.has(cursor)) { streak += 1; cursor = shiftDay(cursor, -1); }
  return {
    total: words.length,
    due: words.filter((word) => !word.review_count || !word.due_at || new Date(word.due_at) <= now).length,
    mastered: words.filter((word) => word.stage >= 3).length,
    learning: words.filter((word) => word.review_count > 0 && word.stage < 3).length,
    newWords: words.filter((word) => !word.review_count).length,
    favorites: words.filter((word) => word.favorite).length,
    todayReviewed: days.get(today)?.ids.size || 0,
    todayCorrect: days.get(today)?.correct || 0,
    todayAttempts: days.get(today)?.attempts || 0,
    reviewCount, correctCount, accuracy: reviewCount ? Math.round(correctCount / reviewCount * 100) : 0, streak,
    activity: Array.from({ length: 14 }, (_, index) => {
      const date = shiftDay(today, index - 13);
      return { date, count: days.get(date)?.ids.size || 0, correct: days.get(date)?.correct || 0 };
    }),
  };
};

export const applyReview = (word, rating, eventId, now = new Date().toISOString()) => {
  if (!['again', 'good', 'easy'].includes(rating)) throw fail('Choisissez « à revoir », « compris » ou « facile ».');
  if (!eventId || !/^[a-zA-Z0-9_-]{1,100}$/.test(eventId)) throw fail('Identifiant de révision manquant ou non valide.');
  if (word.history.some((event) => event.event_id === eventId)) return word;
  const stage = rating === 'again' ? Math.max(0, word.stage - 1) : Math.min(6, word.stage + (rating === 'easy' ? 2 : 1));
  const intervals = [0, 1, 3, 7, 14, 30, 60];
  const delay = rating === 'again' ? 10 * 60000 : intervals[stage] * 86400000;
  return { ...word, stage, review_count: word.review_count + 1, correct_count: word.correct_count + (rating === 'again' ? 0 : 1), due_at: new Date(Date.parse(now) + delay).toISOString(), last_reviewed: now, history: [...word.history, { at: now, rating, event_id: eventId }].slice(-1000) };
};
