// Lecture CSV stricte, commune aux fichiers persistants et au journal.
export const readCsv = (input, { maxRows = 100000, maxBytes = 10 * 1024 * 1024, delimiter = ',' } = {}) => {
  if (Buffer.byteLength(input, 'utf8') > maxBytes) throw new Error('Le fichier CSV dépasse la taille autorisée.');
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const push = () => {
    row.push(field);
    if (row.some((cell) => cell !== '')) rows.push(row);
    if (rows.length > maxRows) throw new Error('Le fichier CSV contient trop de lignes.');
    row = []; field = ''; closed = false;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; closed = true; }
      } else field += char;
      continue;
    }
    if (char === '"' && field === '' && !closed) { quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; closed = false; continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      push(); continue;
    }
    if (char === '"' || closed) throw new Error('Une cellule CSV contient des guillemets non valides.');
    field += char;
  }
  if (quoted) throw new Error('Une cellule CSV entre guillemets est incomplète.');
  if (field || row.length || closed) push();
  return rows;
};

export const serializeCsv = (columns, records) => `${[
  columns.join(','),
  ...records.map((record) => columns.map((key) => `"${String(record[key] ?? '').replace(/"/g, '""')}"`).join(',')),
].join('\r\n')}\r\n`;

export const readRecords = (text, columns, options = {}) => {
  const rows = readCsv(text, options);
  if (!rows.length || rows[0].length !== columns.length || rows[0].some((name, index) => name !== columns[index])) throw new Error('L’en-tête du fichier CSV est inattendu.');
  return rows.slice(1).map((row) => {
    if (row.length !== columns.length) throw new Error('Une ligne CSV est incomplète.');
    return Object.fromEntries(columns.map((key, index) => [key, row[index]]));
  });
};
