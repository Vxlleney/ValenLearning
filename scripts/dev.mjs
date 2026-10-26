import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(process.execPath, ['--watch', 'backend/index.js'], { cwd: root, stdio: 'inherit' }),
  spawn(npm, ['run', 'dev', '--workspace', 'frontend'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }),
];
let stopping = false;
// Les deux processus de développement s’arrêtent ensemble.
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  process.exitCode = code;
};
children.forEach((child) => {
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => stop(code || 0));
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
