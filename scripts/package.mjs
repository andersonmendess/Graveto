// Gera dist/graveto-<versão>.zip com apenas os arquivos que a extensão usa.
// Uso: node scripts/package.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

const FILES = [
  'manifest.json',
  'src/defaults.js',
  'src/content.js',
  'src/background.js',
  'popup/popup.html',
  'popup/popup.css',
  'popup/popup.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join('dist', `graveto-${version}.zip`);
rmSync(join(root, out), { force: true });

// bsdtar (Windows 10+ e macOS) cria zip com -a; no Linux usa o `zip`.
// No Windows chama o tar do sistema pelo caminho: o GNU tar do Git Bash ignora -a e gera um tar.
if (process.platform === 'linux') {
  execFileSync('zip', ['-q', out, ...FILES], { cwd: root, stdio: 'inherit' });
} else {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-a', '-cf', out, ...FILES], { cwd: root, stdio: 'inherit' });
}

if (readFileSync(join(root, out)).toString('latin1', 0, 2) !== 'PK') {
  throw new Error(`${out} não é um zip válido`);
}
console.log(out);
