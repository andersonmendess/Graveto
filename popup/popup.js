'use strict';

const D = globalThis.GRAVETO_DEFAULTS;

const PRESETS = {
  clean: { bassOn: false, reverbOn: false, slowedOn: false, volume: 1 },
  bass: { bassOn: true, bassGain: 10, bassFreq: 80, reverbOn: false, slowedOn: false },
  slowedReverb: {
    slowedOn: true, slowedRate: 0.82,
    reverbOn: true, reverbMix: 0.35, reverbSize: 3.5,
    bassOn: true, bassGain: 4, bassFreq: 100,
  },
  hall: { reverbOn: true, reverbMix: 0.25, reverbSize: 2.2, slowedOn: false },
};

const trim = (v) => String(+v.toFixed(1));
const FORMAT = {
  bassGain: (v) => `+${trim(v)} dB`,
  bassFreq: (v) => `${v} Hz`,
  reverbMix: (v) => `${Math.round(v * 100)}%`,
  reverbSize: (v) => `${v.toFixed(1)} s`,
  slowedRate: (v) => `${v.toFixed(2)}×`,
  volume: (v) => `${Math.round(v * 100)}%`,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let s = { ...D };

// ---------- controles ----------

function render() {
  for (const el of $$('[data-key]')) {
    const v = s[el.dataset.key];
    if (el.type === 'checkbox') {
      el.checked = v;
    } else {
      el.value = v;
      fill(el);
    }
  }
  for (const out of $$('output[data-for]')) out.textContent = FORMAT[out.dataset.for](s[out.dataset.for]);
  for (const mod of $$('[data-module]')) mod.classList.toggle('off', !s[mod.dataset.module]);

  const st = 12 * Math.log2(s.slowedRate);
  $('#pitch').textContent = `${st < -0.05 ? '−' : ''}${Math.abs(st).toFixed(1)} semitons`;

  $('#power').setAttribute('aria-pressed', String(s.power));
  document.body.classList.toggle('power-off', !s.power);
}

function fill(range) {
  const p = ((range.value - range.min) / (range.max - range.min)) * 100;
  range.style.setProperty('--p', `${p}%`);
}

let saveTimer = 0;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    chrome.storage.local.set({ settings: s });
  }, 40);
}

function update(patch) {
  s = { ...s, ...patch };
  render();
  save();
}

for (const el of $$('[data-key]')) {
  el.addEventListener('input', () => {
    const key = el.dataset.key;
    const patch = { [key]: el.type === 'checkbox' ? el.checked : parseFloat(el.value) };
    // Mexer no slider de um módulo desligado já liga o módulo.
    const mod = el.closest('[data-module]');
    if (el.type === 'range' && mod) patch[mod.dataset.module] = true;
    update(patch);
  });
}

$('#power').addEventListener('click', () => update({ power: !s.power }));

for (const btn of $$('[data-preset]')) {
  btn.addEventListener('click', () => update({ ...PRESETS[btn.dataset.preset], power: true }));
}

// ---------- conexão com a aba ----------

const frames = new Map(); // frame id → último relatório
let connError = '';
const openedAt = performance.now();

async function connect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^(https?|file):/.test(tab.url || '')) {
    connError = 'Esta página não permite extensões';
    return;
  }
  openPort(tab.id, true);
}

function openPort(tabId, retry) {
  const port = chrome.tabs.connect(tabId, { name: 'graveto-meter' });
  port.onMessage.addListener((m) => {
    m.at = performance.now();
    frames.set(m.frame, m);
  });
  port.onDisconnect.addListener(async () => {
    void chrome.runtime.lastError;
    frames.clear();
    if (!retry) {
      connError = 'Não foi possível acessar esta aba';
      return;
    }
    // Aba aberta antes da extensão ser instalada/recarregada: injeta o motor agora.
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['src/defaults.js', 'src/content.js'],
      });
      openPort(tabId, false);
    } catch {
      connError = 'Esta página não permite extensões';
    }
  });
}

function aggregate(now) {
  const a = { any: false, media: 0, hooked: 0, blocked: 0, playing: false, suspended: false, levels: null };
  for (const [id, m] of frames) {
    if (now - m.at > 600) {
      frames.delete(id);
      continue;
    }
    a.any = true;
    a.media += m.media;
    a.hooked += m.hooked;
    a.blocked += m.blocked;
    a.playing ||= m.playing;
    a.suspended ||= m.suspended;
    if (m.levels) a.levels = a.levels ? a.levels.map((v, i) => Math.max(v, m.levels[i])) : m.levels.slice();
  }
  return a;
}

function statusOf(a, now) {
  if (connError) return [connError, 'err'];
  if (!s.power) return ['Desligado — áudio original', ''];
  if (!a.any) return [now - openedAt > 1500 ? 'Sem resposta — recarregue a aba' : 'Conectando…', ''];
  if (!a.media) return ['Nenhum áudio ou vídeo nesta página', ''];
  if (a.suspended) return ['Clique na página para liberar o áudio', 'warn'];
  if (a.hooked) {
    if (!a.playing) return ['Pronto — dê play', 'ok'];
    return [`Processando ${a.hooked} mídia${a.hooked > 1 ? 's' : ''}`, 'ok'];
  }
  if (a.blocked) return ['Mídia protegida/externa: só o Slowed funciona', 'warn'];
  return ['Aguardando mídia…', ''];
}

let lastStatus = '';
function showStatus([text, kind]) {
  const key = text + kind;
  if (key === lastStatus) return;
  lastStatus = key;
  $('#status').textContent = text;
  $('#status').title = text;
  $('#dot').className = kind;
}

// ---------- VU meter ----------

const MIN_DB = -48;
const MAX_DB = 3;
const SCALE = [-48, -36, -24, -18, -12, -6, 0];
const toDb = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -Infinity);

const canvas = $('#vu');
const g = canvas.getContext('2d');
const css = getComputedStyle(document.documentElement);
const C = Object.fromEntries(
  ['ok', 'warn', 'hot', 'seg-off', 'muted', 'dim'].map((k) => [k, css.getPropertyValue(`--${k}`).trim()]),
);

const vu = {
  rms: [0, 0],                    // amplitude com balística (ataque rápido, queda lenta)
  hold: [-Infinity, -Infinity],   // pico segurado, dB
  holdAt: [0, 0],
  clipAt: -1e9,
};

function stepMeter(dt, now, levels) {
  for (let c = 0; c < 2; c++) {
    const target = levels ? levels[c] : 0;
    const tau = target > vu.rms[c] ? 0.05 : 0.3;
    vu.rms[c] += (target - vu.rms[c]) * (1 - Math.exp(-dt / tau));

    const peak = levels ? levels[2 + c] : 0;
    const pdb = toDb(peak);
    if (pdb >= vu.hold[c]) {
      vu.hold[c] = pdb;
      vu.holdAt[c] = now;
    } else if (now - vu.holdAt[c] > 1200) {
      vu.hold[c] -= 24 * dt;
    }
    if (peak >= 0.999) vu.clipAt = now;
  }
}

function sizeCanvas() {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const MONO = '"Cascadia Mono", "JetBrains Mono", Consolas, monospace';

function drawMeter() {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  g.clearRect(0, 0, W, H);

  const x0 = 16;
  const barW = W - x0;
  const barH = 11;
  const segW = 3;
  const gap = 2;
  const count = Math.floor((barW + gap) / (segW + gap));
  const pos = (db) => (Math.max(MIN_DB, Math.min(MAX_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB);
  const xOf = (db) => x0 + pos(db) * barW;

  // Gradiente contínuo ao longo da escala: ciano → laranja (−12) → vermelho (≥ −3).
  const grad = g.createLinearGradient(x0, 0, W, 0);
  grad.addColorStop(0, C.ok);
  grad.addColorStop(pos(-20), C.ok);
  grad.addColorStop(pos(-9), C.warn);
  grad.addColorStop(pos(-2), C.hot);
  grad.addColorStop(1, C.hot);

  g.textBaseline = 'middle';
  g.textAlign = 'left';

  for (let c = 0; c < 2; c++) {
    const y = 3 + c * (barH + 7);
    g.font = `700 9.5px ${MONO}`;
    g.fillStyle = C.muted;
    g.fillText(c ? 'R' : 'L', 0, y + barH / 2 + 0.5);

    const litCount = Math.round(pos(toDb(vu.rms[c])) * count);

    // trilho apagado
    g.fillStyle = C['seg-off'];
    for (let i = litCount; i < count; i++) g.fillRect(x0 + i * (segW + gap), y, segW, barH);

    // trecho aceso, com brilho
    if (litCount > 0) {
      g.save();
      g.beginPath();
      for (let i = 0; i < litCount; i++) g.rect(x0 + i * (segW + gap), y, segW, barH);
      g.fillStyle = grad;
      g.shadowColor = toDb(vu.rms[c]) > -9 ? C.warn : C.ok;
      g.shadowBlur = 8;
      g.fill();
      g.restore();
    }

    // pico segurado: linha fina brilhante
    if (vu.hold[c] > MIN_DB) {
      const hx = Math.min(W - 2, xOf(vu.hold[c]));
      g.save();
      g.fillStyle = vu.hold[c] >= -2 ? C.hot : '#ffffff';
      g.shadowColor = g.fillStyle;
      g.shadowBlur = 6;
      g.fillRect(hx - 1, y - 2, 2, barH + 4);
      g.restore();
    }
  }

  // escala em dB
  const sy = 3 + 2 * (barH + 7) + 4;
  g.font = `9px ${MONO}`;
  g.textAlign = 'center';
  g.fillStyle = C.dim;
  for (const db of SCALE) {
    const x = xOf(db);
    g.fillRect(Math.round(x) - 0.5, sy - 3, 1, 3);
    g.fillText(db === 0 ? '0' : String(db), Math.min(W - 6, Math.max(x0 + 8, x)), sy + 6);
  }
}

let lastReadout = '';
function showReadout(now) {
  const db = Math.max(vu.hold[0], vu.hold[1]);
  const text = db > MIN_DB ? `${db < 0 ? '−' : '+'}${Math.abs(db).toFixed(1)} dB` : '−∞ dB';
  if (text !== lastReadout) $('#readout').textContent = lastReadout = text;
  $('#clip').classList.toggle('on', now - vu.clipAt < 1500);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const a = aggregate(now);
  stepMeter(dt, now, a.levels);
  drawMeter();
  showReadout(now);
  showStatus(statusOf(a, now));
  requestAnimationFrame(frame);
}

// ---------- início ----------

(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  s = { ...D, ...settings };
  render();
  sizeCanvas();
  requestAnimationFrame(frame);
  connect();
})();
