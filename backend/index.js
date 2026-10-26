import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';

// Le fichier .env est utile hors Docker ; Compose fournit deja ces variables.
try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const password = process.env.APP_PASSWORD || '';
if (password.length < 12 || /CHANGE_ME|REMPLACER|CHANGER/i.test(password) || /[\r\n\0]/.test(password)) throw new Error('Renseigne APP_PASSWORD dans .env : au moins 12 caracteres, sans valeur exemple.');
const username = process.env.APP_USERNAME || 'valentin';
if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new Error('APP_USERNAME doit contenir uniquement lettres, chiffres, point, tiret ou underscore.');

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT doit être un nombre compris entre 0 et 65535.');
const host = process.env.HOST || '0.0.0.0';
const server = createServer({
  dataDir: process.env.DATA_DIR || path.join(projectRoot, 'data'),
  seedPath: process.env.SEED_CSV || path.join(projectRoot, 'exemples', 'pack-demarrage.csv'),
  frontendDist: process.env.FRONTEND_DIST || path.join(projectRoot, 'frontend', 'dist'),
  importDir: process.env.IMPORT_DIR || path.join(projectRoot,'imports'),
  username, password,
  aiOptions: { apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', dailyLimit: Number(process.env.AI_DAILY_LIMIT || 30), maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 6000) },
});

// Verifie et migre les CSV avant d'accepter les connexions.
await server.app.store.load();
const imported = await server.app.scanImports();
for (const item of imported.results) process.stdout.write(`Import ${item.file} : ${item.status}${item.error ? ` - ${item.error}` : ''}\n`);
server.listen(port, host, () => process.stdout.write(`Valen Learning écoute sur ${host}:${server.address().port}\n`));
server.on('error', (error) => { process.stderr.write(`Démarrage impossible : ${error.code || 'erreur serveur'}\n`); process.exitCode = 1; });
const stop = () => server.close(() => { process.exitCode = 0; });
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
