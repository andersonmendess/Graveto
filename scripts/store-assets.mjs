// Renderiza as imagens da Chrome Web Store a partir de store/assets.html com o Chrome headless.
// Uso: node scripts/store-assets.mjs ["caminho/do/chrome.exe"]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const page = pathToFileURL(join(root, 'store', 'assets.html')).href;

const candidates = [
  process.argv[2],
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];
const chrome = candidates.find((p) => p && existsSync(p));
if (!chrome) throw new Error('Chrome não encontrado; passe o caminho como argumento.');

const ASSETS = [
  { id: 'shot1', file: 'screenshot-1.png', w: 1280, h: 800 },
  { id: 'shot2', file: 'screenshot-2.png', w: 1280, h: 800 },
  { id: 'tile', file: 'promo-small-440x280.png', w: 440, h: 280 },
  { id: 'marquee', file: 'promo-marquee-1400x560.png', w: 1400, h: 560 },
];

const profile = mkdtempSync(join(tmpdir(), 'graveto-chrome-'));
try {
  for (const a of ASSETS) {
    const out = join(root, 'store', a.file);
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      `--user-data-dir=${profile}`, '--force-device-scale-factor=1',
      `--window-size=${a.w},${a.h}`, '--virtual-time-budget=1500',
      `--screenshot=${out}`, `${page}?a=${a.id}`,
    ], { stdio: 'ignore' });
    console.log(`store/${a.file}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
