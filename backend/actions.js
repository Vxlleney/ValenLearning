import { applyReview, mergeVocabulary, parseVocabularyCsv, sanitizeWord, vocabularyKey, MAX_CSV_BYTES, MAX_WORDS } from '../shared/vocabulary.js';

export const appError = (message, status = 400) => Object.assign(new Error(message), { status });
const editableFields = ['english', 'french', 'category', 'example', 'example_fr', 'note', 'source'];

// Cette fonction ne touche pas au disque : toute modification peut être validée avant sauvegarde.
export const applyAction = (words, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw appError('Action manquante.');
  if (['add', 'add_many', 'import'].includes(payload.action)) {
    let incoming;
    if (payload.action === 'import') {
      if (typeof payload.csv !== 'string') throw appError('Le texte CSV est obligatoire.');
      if (Buffer.byteLength(payload.csv, 'utf8') > MAX_CSV_BYTES) throw appError('Le fichier CSV dépasse la limite de 2 Mo.', 413);
      const parsed = parseVocabularyCsv(payload.csv);
      if (parsed.errors.length) throw appError(parsed.errors.slice(0, 5).join('\n'));
      incoming = parsed.words;
    } else {
      incoming = payload.action === 'add' ? [payload.word] : payload.words;
      if (!Array.isArray(incoming) || !incoming.length) throw appError('Ajoute au moins un mot.');
      if (incoming.length > MAX_WORDS) throw appError('La liste est limitée à 5 000 mots.');
      incoming = incoming.map((word) => sanitizeWord(word, { preserveProgress: false }));
    }
    return mergeVocabulary(words, incoming);
  }
  const index = words.findIndex((word) => word.id === payload.id);
  if (index === -1) throw appError('Ce mot n’existe plus. Actualise ta collection.', 404);
  const existing = words[index];
  const next = [...words];
  if (payload.action === 'delete') next.splice(index, 1);
  else if (payload.action === 'favorite') {
    if (typeof payload.favorite !== 'boolean') throw appError('Le favori doit être vrai ou faux.');
    next[index] = { ...existing, favorite: payload.favorite };
  } else if (payload.action === 'review') next[index] = applyReview(existing, payload.rating, payload.event_id);
  else if (payload.action === 'update') {
    if (!payload.word || typeof payload.word !== 'object' || Array.isArray(payload.word)) throw appError('Le mot à modifier est manquant.');
    const edits = Object.fromEntries(editableFields.filter((field) => field in payload.word).map((field) => [field, payload.word[field]]));
    const updated = sanitizeWord({ ...existing, ...edits });
    if (words.some((word, position) => position !== index && vocabularyKey(word) === vocabularyKey(updated))) throw appError('Cette paire anglais / français existe déjà.', 409);
    next[index] = updated;
  } else throw appError('Cette action n’est pas reconnue.');
  return { words: next };
};
