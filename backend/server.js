import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { appError } from './actions.js';
import { createStore } from './storage.js';
import { createZip } from './zip.js';
import { createAiService } from './ai.js';
import { libraryTemplate, scanImportDirectory } from './library.js';

const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const digest = (value) => createHash('sha256').update(value, 'utf8').digest();
const json = (response, status, body, headers = {}) => {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, ...headers });
  response.end(bytes);
};

const readJson = (request) => {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw appError('Le contenu doit être envoyé au format JSON.', 415);
  const declared = Number(request.headers['content-length']);
  if (declared > MAX_REQUEST_BYTES) throw appError('La demande dépasse la limite de 3 Mo.', 413);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0, finished = false;
    const finish = (error, body) => {
      if (finished) return;
      finished = true;
      request.off('data', onData); request.off('end', onEnd); request.off('aborted', onAbort); request.off('error', onError);
      if (error) { request.resume(); reject(error); } else resolve(body);
    };
    const onData = (chunk) => {
      length += chunk.length;
      if (length > MAX_REQUEST_BYTES) { finish(appError('La demande dépasse la limite de 3 Mo.', 413)); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { finish(appError('Le contenu JSON est vide ou illisible.')); }
    };
    const onError = () => finish(appError('La demande a été interrompue.', 400));
    const onAbort = () => finish(appError('La demande a été interrompue.', 400));
    request.on('data', onData); request.on('end', onEnd); request.on('error', onError); request.on('aborted', onAbort);
  });
};

const checkOrigin = (request) => {
  if (request.headers['sec-fetch-site'] === 'cross-site') throw appError('Cette demande doit provenir de Valen Learning.', 403);
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    const host = new URL(`http://${request.headers.host}`).host;
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.host.toLowerCase() !== host.toLowerCase()) throw new Error('Origine différente.');
  } catch {
    throw appError('Cette demande doit provenir de Valen Learning.', 403);
  }
};

const authenticate = (request, username, password) => {
  if (!password) return true;
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Basic ([a-zA-Z0-9+/]+={0,2})$/i);
  const candidate = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
  return timingSafeEqual(digest(candidate), digest(`${username}:${password}`));
};

const serveStatic = async (request, response, pathname, root) => {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw appError('Chemin non valide.', 400); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..') || decoded.split('/').some((part) => part.startsWith('.'))) throw appError('Page introuvable.', 404);
  if (/^\/(data|backend|shared)(?:\/|$)/i.test(decoded)) throw appError('Page introuvable.', 404);
  let filename = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!filename.startsWith(`${root}${path.sep}`)) throw appError('Page introuvable.', 404);
  let realRoot, realFile, stat;
  try {
    realRoot = await fs.realpath(root);
    try { realFile = await fs.realpath(filename); } catch (error) {
      if (error.code !== 'ENOENT' || path.extname(decoded)) throw error;
      filename = path.join(root, 'index.html');
      realFile = await fs.realpath(filename);
    }
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) throw appError('Page introuvable.', 404);
    stat = await fs.stat(realFile);
    if (!stat.isFile()) throw appError('Page introuvable.', 404);
  } catch (error) {
    if (error.status) throw error;
    throw appError('Page introuvable. Compile le frontend avant de démarrer le serveur.', 404);
  }
  const extension = path.extname(realFile).toLowerCase();
  if (!mime[extension]) throw appError('Fichier introuvable.', 404);
  const contents = await fs.readFile(realFile);
  response.writeHead(200, { 'Content-Type': mime[extension], 'Content-Length': stat.size, 'Cache-Control': extension === '.html' ? 'private, no-store' : 'private, max-age=3600' });
  response.end(request.method === 'HEAD' ? undefined : contents);
};

export const createApp = ({
  dataDir = fileURLToPath(new URL('../data', import.meta.url)),
  seedPath,
  frontendDist = fileURLToPath(new URL('../frontend/dist', import.meta.url)),
  importDir,
  username = 'valentin',
  password = '',
  store = createStore({ dataDir, seedPath }),
  aiOptions = {},
} = {}) => {
  const frontend = path.resolve(frontendDist);
  const ai = createAiService({ store, ...aiOptions });
  const authFailures = new Map();
  const handler = async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(request.url, 'http://localhost');
      const method = request.method || 'GET';
      if (url.pathname === '/health' && (method === 'GET' || method === 'HEAD')) {
        if (method === 'HEAD') { response.writeHead(200); response.end(); } else json(response, 200, { status: 'ok' });
        return;
      }
      const clientAddress = request.socket.remoteAddress || 'unknown';
      const failure = authFailures.get(clientAddress);
      if (failure && failure.until <= Date.now()) authFailures.delete(clientAddress);
      if (failure && failure.until > Date.now() && failure.count >= 20) throw appError('Trop de tentatives de connexion. Reessaie dans 15 minutes.',429);
      if (!authenticate(request, username, password)) {
        if (authFailures.size > 1000) { for (const [key,value] of authFailures) if (value.until <= Date.now()) authFailures.delete(key); }
        if (authFailures.size < 1000 || authFailures.has(clientAddress)) authFailures.set(clientAddress, {count: (failure?.until > Date.now() ? failure.count : 0) + 1, until: failure?.until > Date.now() ? failure.until : Date.now()+900000});
        request.resume();
        json(response, 401, { error: 'Identifiant ou mot de passe requis.' }, { 'WWW-Authenticate': 'Basic realm="Valen Learning", charset="UTF-8"' });
        return;
      }
      authFailures.delete(clientAddress);
      if (method !== 'GET' && method !== 'HEAD') checkOrigin(request);
      if (url.pathname === '/api/library' && method === 'GET') {json(response,200,await store.librarySnapshot());return;}
      if (url.pathname === '/api/library/collection' && method === 'GET') {json(response,200,await store.collection(url.searchParams.get('id')));return;}
      if (url.pathname === '/api/library/preview' && method === 'POST') {json(response,200,await store.previewLibrary(await readJson(request)));return;}
      if (url.pathname === '/api/library/import' && method === 'POST') {json(response,200,await store.importLibrary(await readJson(request)));return;}
      if (url.pathname === '/api/library/progress' && method === 'POST') {json(response,200,await store.updateLessonProgress(await readJson(request)));return;}
      if (url.pathname === '/api/library/scan' && method === 'POST') {await readJson(request);json(response,200,await scanImportDirectory(store,importDir));return;}
      if (url.pathname === '/api/library/export' && method === 'GET') {
        const csv=Buffer.from(`\uFEFF${await store.exportCollection(url.searchParams.get('id'))}`,'utf8');
        response.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="valen-learning-collection.csv"','Content-Length':csv.length});response.end(csv);return;
      }
      if (url.pathname === '/api/library/template' && method === 'GET') {
        const kind=url.searchParams.get('kind');const csv=Buffer.from(`\uFEFF${libraryTemplate(kind)}`,'utf8');
        response.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="modele-${kind}.csv"`,'Content-Length':csv.length});response.end(csv);return;
      }
      if (url.pathname === '/api/ai/status' && method === 'GET') {
        json(response,200,await ai.status()); return;
      }
      if (url.pathname === '/api/ai/generate' && method === 'POST') {
        json(response,200,await ai.generate(await readJson(request))); return;
      }
      if (url.pathname === '/api/learning' && method === 'GET') {
        json(response,200,await store.learningSnapshot()); return;
      }
      if (url.pathname === '/api/learning/lesson' && method === 'GET') {
        json(response,200,await store.lesson(url.searchParams.get('id'))); return;
      }
      if (url.pathname === '/api/learning/answer' && method === 'POST') {
        const body = await readJson(request);
        json(response,200,await store.learningMutate({id:body?.id,exercise_id:body?.exercise_id,selected_index:body?.selected_index,action:'answer'})); return;
      }
      if (url.pathname === '/api/export/file' && method === 'GET') {
        const name = url.searchParams.get('name');
        const csv = Buffer.from(`\uFEFF${await store.exportFile(name)}`,'utf8');
        response.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}"`,'Content-Length':csv.length});
        response.end(csv); return;
      }
      if (url.pathname === '/api/vocabulary') {
        if (method === 'GET') json(response, 200, await store.load());
        else if (method === 'POST') json(response, 200, await store.mutate(await readJson(request)));
        else throw appError('Méthode non autorisée.', 405);
        return;
      }
      if (url.pathname === '/api/settings') {
        if (method === 'PATCH' || method === 'POST') json(response, 200, await store.updateSettings(await readJson(request)));
        else if (method === 'GET') json(response, 200, { settings: (await store.load()).settings });
        else throw appError('Méthode non autorisée.', 405);
        return;
      }
      if (url.pathname === '/api/export' && method === 'GET') {
        const csv = Buffer.from(`\uFEFF${await store.exportCsv()}`, 'utf8');
        response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="vocabulaire-valen-learning.csv"', 'Content-Length': csv.length });
        response.end(csv);
        return;
      }
      if (url.pathname === '/api/backup' && method === 'GET') {
        const zip = createZip(await store.backupFiles());
        response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="valen-learning-sauvegarde.zip"', 'Content-Length': zip.length });
        response.end(zip);
        return;
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/api') throw appError('Route API introuvable.', 404);
      if (method !== 'GET' && method !== 'HEAD') throw appError('Méthode non autorisée.', 405);
      await serveStatic(request, response, url.pathname, frontend);
    } catch (error) {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      // Les détails du système de fichiers restent sur le serveur et ne révèlent aucun chemin au navigateur.
      const status = error.status || 503;
      request.resume();
      json(response, status, { error: error.status ? error.message : 'La sauvegarde est momentanément indisponible. Les données existantes sont conservées.' });
    }
  };
  return Object.assign(handler, { store, ai, scanImports: () => scanImportDirectory(store,importDir) });
};

export const createServer = (options = {}) => {
  const app = createApp(options);
  const server = http.createServer({ requestTimeout: 90000, headersTimeout: 15000, maxHeaderSize: 16384 }, app);
  server.app = app;
  return server;
};
