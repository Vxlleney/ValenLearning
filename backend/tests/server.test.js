import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createServer } from '../server.js';
import { createStore, DATA_FILES } from '../storage.js';
import { readCsv } from '../csv.js';
import { createZip } from '../zip.js';
import { sanitizeWord, applyReview, serializeVocabularyCsv } from '../../shared/vocabulary.js';

const fixture = async (t, options = {}) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'valen-learning-test-'));
  const dataDir = path.join(temporary, 'data');
  const seedPath = path.join(temporary, 'seed.csv');
  const frontendDist = path.join(temporary, 'frontend');
  await fs.mkdir(frontendDist);
  await fs.writeFile(seedPath, options.seed || 'english;french;category\nhello;bonjour;Quotidien\nmeeting;réunion;Travail\n');
  await fs.writeFile(path.join(frontendDist, 'index.html'), '<!doctype html><title>Valen Learning</title>');
  const servers = [];
  const start = async (overrides = {}) => {
    const server = createServer({ dataDir, seedPath, frontendDist, ...options, ...overrides });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    return { server, url, request: (route, body, settings = {}) => fetch(`${url}${route}`, body === undefined ? settings : { method: 'POST', headers: { 'Content-Type': 'application/json', ...settings.headers }, body: JSON.stringify(body), ...settings }) };
  };
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  return { dataDir, seedPath, frontendDist, temporary, start };
};

const readZip = (bytes) => {
  const files = {};
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    files[bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')] = bytes.subarray(start, start + size).toString('utf8');
    offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), Object.keys(files).length);
  return files;
};

test('sauvegarde CSV, révisions, paramètres et redémarrage', async (t) => {
  const files = await fixture(t);
  const app = await files.start();
  const initial = await (await app.request('/api/vocabulary')).json();
  assert.equal(initial.words.length, 2);
  assert.deepEqual(initial.settings, { goal: 10, theme: 'dark' });
  assert.equal(initial.storage, 'csv');
  const added = await (await app.request('/api/vocabulary', { action: 'add', word: { english: '=SUM(1,2)', french: 'formule', example: 'A "quoted", multiline\nexample.' } })).json();
  assert.equal(added.added, 1);
  const word = added.words.find((entry) => entry.french === 'formule');
  const reviewed = await (await app.request('/api/vocabulary', { action: 'review', id: word.id, rating: 'good', event_id: 'review-1' })).json();
  assert.equal(reviewed.words.find((entry) => entry.id === word.id).review_count, 1);
  const settings = await app.request('/api/settings', { goal: 15, theme: 'light' }, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
  assert.equal(settings.status, 200);
  assert.deepEqual((await settings.json()).settings, { goal: 15, theme: 'light' });
  const fresh = await files.start();
  const reloaded = await (await fresh.request('/api/vocabulary')).json();
  assert.equal(reloaded.words.find((entry) => entry.id === word.id).english, '=SUM(1,2)');
  assert.equal(reloaded.words.find((entry) => entry.id === word.id).history[0].event_id, 'review-1');
  assert.equal(reloaded.settings.goal, 15);
  assert.deepEqual((await fs.readdir(files.dataDir)).sort(), [...DATA_FILES].sort());
  const csv = await fs.readFile(path.join(files.dataDir, 'vocabulaire.csv'), 'utf8');
  assert.ok(!readCsv(csv)[0].includes('history'));
  assert.ok(csv.includes("'=SUM(1,2)"));
  const exported = await app.request('/api/export');
  assert.match(exported.headers.get('content-disposition'), /\.csv/);
  assert.ok(!readCsv(await exported.text())[0].includes('history'));
});

test('concurrence PC/téléphone et révision idempotente', async (t) => {
  const files = await fixture(t);
  const app = await files.start();
  const initial = await (await app.request('/api/vocabulary')).json();
  const id = initial.words[0].id;
  const responses = await Promise.all([
    ...Array.from({ length: 15 }, (_, index) => app.request('/api/vocabulary', { action: 'add', word: { english: `word ${index}`, french: `mot ${index}` } })),
    ...Array.from({ length: 8 }, () => app.request('/api/vocabulary', { action: 'review', id, rating: 'good', event_id: 'same-event' })),
    ...Array.from({ length: 5 }, (_, index) => app.request('/api/vocabulary', { action: 'review', id, rating: 'again', event_id: `event-${index}` })),
  ]);
  assert.ok(responses.every((response) => response.status === 200));
  const final = await (await app.request('/api/vocabulary')).json();
  assert.equal(final.words.length, 17);
  const word = final.words.find((entry) => entry.id === id);
  assert.equal(word.review_count, 6);
  assert.equal(word.correct_count, 1);
  assert.equal(word.history.length, 6);
});

test('import legacy atomique avec historique aplati et sauvegarde ZIP complète', async (t) => {
  const files = await fixture(t);
  const app = await files.start();
  const legacy = applyReview(sanitizeWord({ english: 'already', french: 'déjà' }), 'good', 'legacy-event', '2026-10-25T09:00:00.000Z');
  const imported = await app.request('/api/vocabulary', { action: 'import', csv: serializeVocabularyCsv([legacy]) });
  assert.equal(imported.status, 200);
  const state = await imported.json();
  assert.equal(state.words.find((entry) => entry.english === 'already').history[0].event_id, 'legacy-event');
  const duplicate = await (await app.request('/api/vocabulary', { action: 'import', csv: 'english;french\nalready;déjà' })).json();
  assert.equal(duplicate.skipped, 1);
  const invalid = await app.request('/api/vocabulary', { action: 'import', csv: 'english;french\nvalid;valide\nmissing;' });
  assert.equal(invalid.status, 400);
  assert.equal((await (await app.request('/api/vocabulary')).json()).words.length, 3);
  const response = await app.request('/api/backup');
  assert.equal(response.headers.get('content-type'), 'application/zip');
  const zip = readZip(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(zip).sort(), [...DATA_FILES].sort());
  assert.match(zip['revisions.csv'], /legacy-event/);
  assert.ok(!zip['vocabulaire.csv'].includes('"history"'));
  for (const [name, content] of Object.entries(zip)) assert.equal(content, await fs.readFile(path.join(files.dataDir, name), 'utf8'));
  // Vecteur CRC-32 indépendant publié pour la chaîne de contrôle standard.
  assert.equal(createZip({ 'test.txt': '123456789' }).readUInt32LE(14), 0xcbf43926);
});

test('initialisation depuis le vrai format legacy préserve toutes les révisions', async (t) => {
  const legacy = applyReview(applyReview(sanitizeWord({ english: 'since', french: 'depuis', source: 'Séance précédente' }), 'good', 'legacy-start-1'), 'again', 'legacy-start-2');
  const files = await fixture(t, { seed: serializeVocabularyCsv([legacy]) });
  const app = await files.start();
  const initialized = await (await app.request('/api/vocabulary')).json();
  assert.equal(initialized.words.length, 1);
  assert.deepEqual(initialized.words[0], legacy);
  const reviews = readCsv(await fs.readFile(path.join(files.dataDir, 'revisions.csv'), 'utf8'));
  assert.equal(reviews.length, 3);
  const fresh = await files.start();
  assert.deepEqual((await (await fresh.request('/api/vocabulary')).json()).words[0], legacy);
});

test('une collection vidée reste vide au redémarrage', async (t) => {
  const files = await fixture(t);
  const app = await files.start();
  const initial = await (await app.request('/api/vocabulary')).json();
  for (const word of initial.words) assert.equal((await app.request('/api/vocabulary', { action: 'delete', id: word.id })).status, 200);
  const fresh = await files.start();
  assert.equal((await (await fresh.request('/api/vocabulary')).json()).words.length, 0);
  assert.equal(readCsv(await fs.readFile(path.join(files.dataDir, 'vocabulaire.csv'), 'utf8')).length, 1);
});

test('authentification, origine, statique et limites des demandes', async (t) => {
  const files = await fixture(t, { username: 'valentin', password: 'test-password' });
  const app = await files.start();
  const authorization = `Basic ${Buffer.from('valentin:test-password').toString('base64')}`;
  const auth = { Authorization: authorization };
  assert.equal((await app.request('/health')).status, 200);
  assert.equal((await app.request('/api/vocabulary')).status, 401);
  assert.match((await app.request('/')).headers.get('www-authenticate'), /^Basic/);
  assert.equal((await app.request('/api/vocabulary', undefined, { headers: auth })).status, 200);
  const write = { action: 'add', word: { english: 'cat', french: 'chat' } };
  assert.equal((await app.request('/api/vocabulary', write, { headers: { ...auth, 'Content-Type': 'application/json', Origin: 'https://other.example' } })).status, 403);
  assert.equal((await app.request('/api/vocabulary', write, { headers: { ...auth, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await app.request('/api/vocabulary', write, { headers: { ...auth, 'Content-Type': 'application/json', Origin: app.url } })).status, 200);
  assert.equal((await app.request('/api/vocabulary', write, { headers: { ...auth, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.request('/api/vocabulary', { action: 'import', csv: 'x'.repeat(2 * 1024 * 1024 + 1) }, { headers: { ...auth, 'Content-Type': 'application/json' } })).status, 413);
  assert.equal((await app.request('/api/vocabulary', { huge: 'x'.repeat(3 * 1024 * 1024) }, { headers: { ...auth, 'Content-Type': 'application/json' } })).status, 413);
  const streamed = await fetch(`${app.url}/api/vocabulary`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, duplex: 'half', body: Readable.from(['{"huge":"', ...Array.from({ length: 49 }, () => 'x'.repeat(65536)), '"}']) });
  assert.equal(streamed.status, 413);
  const homepage = await app.request('/', undefined, { headers: auth });
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await app.request('/data/vocabulaire.csv', undefined, { headers: auth })).status, 404);
  await fs.symlink(path.join(files.dataDir, 'vocabulaire.csv'), path.join(files.frontendDist, 'exposed.csv'));
  assert.equal((await app.request('/exposed.csv', undefined, { headers: auth })).status, 404);
  assert.equal((await app.request('/%2e%2e%2fdata/vocabulaire.csv', undefined, { headers: auth })).status, 404);
  assert.equal((await app.request('/api/vocabulary', undefined, { method: 'DELETE', headers: auth })).status, 405);
});

test('CSV corrompu ou fichier manquant : refus sans réinitialisation', async (t) => {
  const files = await fixture(t);
  const app = await files.start();
  await app.request('/api/vocabulary');
  const vocabulary = path.join(files.dataDir, 'vocabulaire.csv');
  const original = await fs.readFile(vocabulary, 'utf8');
  await fs.writeFile(vocabulary, original + '"unfinished');
  assert.equal((await app.request('/api/vocabulary')).status, 503);
  assert.equal((await app.request('/api/vocabulary', { action: 'add', word: { english: 'safe', french: 'sûr' } })).status, 503);
  assert.equal(await fs.readFile(vocabulary, 'utf8'), original + '"unfinished');
  await fs.writeFile(vocabulary, Buffer.concat([Buffer.from(original), Buffer.from([0xff])]));
  assert.equal((await app.request('/api/vocabulary')).status, 503);
  await fs.writeFile(vocabulary, original);
  await fs.unlink(path.join(files.dataDir, 'revisions.csv'));
  assert.equal((await app.request('/api/vocabulary')).status, 503);
  assert.equal(await fs.readFile(vocabulary, 'utf8'), original);
  assert.ok(!(await fs.readdir(files.dataDir)).includes('revisions.csv'));
});

test('reprise cohérente après interruption entre deux renommages', async (t) => {
  const files = await fixture(t);
  let fail = false;
  const store = createStore({ dataDir: files.dataDir, seedPath: files.seedPath, onCommitStep: (step) => { if (fail && step === 'rename:vocabulaire.csv') throw new Error('Interruption simulée'); } });
  const initial = await store.load();
  fail = true;
  await assert.rejects(store.mutate({ action: 'review', id: initial.words[0].id, rating: 'good', event_id: 'crash-review' }));
  assert.ok((await fs.readdir(files.dataDir)).includes('.transaction.csv'));
  const restored = await createStore({ dataDir: files.dataDir, seedPath: files.seedPath }).load();
  assert.equal(restored.words[0].review_count, 1);
  assert.equal(restored.words[0].history[0].event_id, 'crash-review');
  assert.deepEqual((await fs.readdir(files.dataDir)).sort(), [...DATA_FILES].sort());
  const retry = await createStore({ dataDir: files.dataDir, seedPath: files.seedPath }).mutate({ action: 'review', id: initial.words[0].id, rating: 'good', event_id: 'crash-review' });
  assert.equal(retry.words[0].review_count, 1);
});

test('journal de reprise invalide : aucun remplacement supplémentaire', async (t) => {
  const files = await fixture(t);
  const store = createStore({ dataDir: files.dataDir, seedPath: files.seedPath });
  await store.load();
  const before = await store.backupFiles();
  await fs.writeFile(path.join(files.dataDir, '.transaction.csv'), 'file,temporary,sha256\nvocabulaire.csv,../../outside.csv,wrong\n');
  await assert.rejects(store.load(), { status: 503 });
  for (const name of DATA_FILES) assert.equal(await fs.readFile(path.join(files.dataDir, name), 'utf8'), before[name]);
});

test('limite de 5 000 mots et historique de 1 000 événements', async (t) => {
  const files = await fixture(t);
  const store = createStore({ dataDir: files.dataDir, seedPath: files.seedPath });
  const initial = await store.load();
  await assert.rejects(store.mutate({ action: 'add_many', words: Array.from({ length: 5001 }, (_, index) => ({ english: `word ${index}`, french: `mot ${index}` })) }), { status: 400 });
  const base = sanitizeWord({ english: 'history', french: 'historique' });
  base.review_count = 1000;
  base.correct_count = 1000;
  base.history = Array.from({ length: 1000 }, (_, index) => ({ event_id: `retained-${index}`, rating: 'good', at: '2026-10-25T09:00:00.000Z' }));
  const imported = await store.mutate({ action: 'import', csv: serializeVocabularyCsv([base]) });
  const word = imported.words.find((entry) => entry.english === 'history');
  const reviewed = await store.mutate({ action: 'review', id: word.id, rating: 'good', event_id: 'newest' });
  const result = reviewed.words.find((entry) => entry.id === word.id);
  assert.equal(result.history.length, 1000);
  assert.equal(result.review_count, 1001);
  assert.equal(result.history[0].event_id, 'retained-1');
  assert.equal(result.history.at(-1).event_id, 'newest');
  assert.equal(reviewed.words.length, initial.words.length + 1);
});
