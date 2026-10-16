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

// ---------- VU meter (analógico) ----------

const MIN_DB = -48;
const toDb = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -Infinity);

// Dois mostradores clássicos: agulha com balística de VU (~300 ms), calibrada para
// −12 dBFS RMS = 0 VU, faixa vermelha acima de 0 VU e LED de pico.
const VU_REF_DBFS = -12;
const VU_MIN = -20;
const VU_MAX = 3;
const NEEDLE_TAU = 0.065;
const PEAK_LED = 0.891; // −1 dBFS
const PEAK_HOLD_MS = 450;

// Geometria em unidades de desenho; o canvas é escalado para a largura real do painel.
const W = 302;
const H = 118;
const FACE_W = 146;
const FACE_H = 112;
const FACE_Y = 3;
const FACES = [0, W - FACE_W];
const SWEEP = (42 * Math.PI) / 180;
const PIVOT_DROP = 26; // pivô abaixo da face, como nos medidores analógicos
const RADIUS = 82;

const canvas = $('#vu');
const g = canvas.getContext('2d');
let res = 1; // pixels de canvas por unidade de desenho
let faceLayers = [];

const vu = {
  needle: [-0.04, -0.04],
  peakUntil: [0, 0],
  hold: [-Infinity, -Infinity], // pico segurado em dB, para o readout
  holdAt: [0, 0],
  clipAt: -1e9,
};

function vuPosition(v) {
  const lo = Math.pow(10, VU_MIN / 20);
  const hi = Math.pow(10, VU_MAX / 20);
  return (Math.pow(10, v / 20) - lo) / (hi - lo);
}

const angleFor = (pos) => -SWEEP + pos * 2 * SWEEP;
const polar = (cx, cy, angle, r) => [cx + Math.sin(angle) * r, cy - Math.cos(angle) * r];

// A face é desenhada uma vez numa camada separada; a cada quadro só a agulha muda.
function drawFace(label) {
  const face = document.createElement('canvas');
  face.width = Math.round(FACE_W * res);
  face.height = Math.round(FACE_H * res);
  const c = face.getContext('2d');
  c.scale(res, res);

  const cx = FACE_W / 2;
  const cy = FACE_H + PIVOT_DROP;

  c.beginPath();
  c.roundRect(0, 0, FACE_W, FACE_H, 8);
  const bg = c.createRadialGradient(cx, FACE_H * 0.55, 10, cx, FACE_H * 0.55, FACE_W * 0.75);
  bg.addColorStop(0, '#fbf0d4');
  bg.addColorStop(1, '#e7cf9c');
  c.fillStyle = bg;
  c.fill();
  c.save();
  c.clip();

  // Arco da escala: preto até 0 VU, faixa vermelha depois.
  const aZero = angleFor(vuPosition(0));
  c.lineWidth = 1.2;
  c.strokeStyle = '#2a1f17';
  c.beginPath();
  c.arc(cx, cy, RADIUS, angleFor(0) - Math.PI / 2, aZero - Math.PI / 2);
  c.stroke();
  c.lineWidth = 4;
  c.strokeStyle = '#c8372d';
  c.beginPath();
  c.arc(cx, cy, RADIUS + 2, aZero - Math.PI / 2, angleFor(1) - Math.PI / 2);
  c.stroke();

  const labeled = new Set([-20, -10, -7, -5, -3, 0, 3]);
  c.font = '600 9px "Segoe UI", system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const v of [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]) {
    const a = angleFor(vuPosition(v));
    const major = labeled.has(v);
    const [x1, y1] = polar(cx, cy, a, RADIUS);
    const [x2, y2] = polar(cx, cy, a, RADIUS + (major ? 9 : 6));
    c.strokeStyle = v > 0 ? '#c8372d' : '#2a1f17';
    c.lineWidth = major ? 1.4 : 1;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    if (major) {
      const [tx, ty] = polar(cx, cy, a, RADIUS + 15);
      c.fillStyle = c.strokeStyle;
      c.fillText(v > 0 ? `+${v}` : `${Math.abs(v)}`, tx, ty);
    }
  }

  // Marcações de porcentagem por dentro do arco, como num VU clássico.
  c.strokeStyle = 'rgba(42, 31, 23, 0.45)';
  c.lineWidth = 1;
  for (let i = 1; i <= 10; i++) {
    const a = angleFor(vuPosition(20 * Math.log10(i / 10)));
    const [x1, y1] = polar(cx, cy, a, RADIUS - 3);
    const [x2, y2] = polar(cx, cy, a, RADIUS - (i % 5 === 0 ? 8 : 6));
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }

  c.fillStyle = '#2a1f17';
  c.font = '700 13px "Segoe UI", system-ui, sans-serif';
  c.fillText('VU', cx, FACE_H - 34);

  // Base escura que esconde o pivô.
  const base = c.createLinearGradient(0, FACE_H - 18, 0, FACE_H);
  base.addColorStop(0, '#2b221b');
  base.addColorStop(1, '#1a1410');
  c.fillStyle = base;
  c.fillRect(0, FACE_H - 18, FACE_W, 18);
  c.fillStyle = '#a39482';
  c.font = '600 10px "Segoe UI", system-ui, sans-serif';
  c.textAlign = 'left';
  c.fillText(label, 10, FACE_H - 9);
  c.textAlign = 'right';
  c.fillText('GRAVETO', FACE_W - 10, FACE_H - 9);
  c.restore();

  return face;
}

function sizeCanvas() {
  res = (canvas.clientWidth / W) * (devicePixelRatio || 1);
  canvas.width = Math.round(W * res);
  canvas.height = Math.round(H * res);
  faceLayers = [drawFace('L'), drawFace('R')];
}

function stepMeter(dt, now, levels) {
  const k = 1 - Math.exp(-dt / NEEDLE_TAU);
  for (let c = 0; c < 2; c++) {
    const rms = s.power && levels ? levels[c] : 0;
    const target = Math.min(1.06, Math.max(-0.04, vuPosition(toDb(rms) - VU_REF_DBFS)));
    vu.needle[c] += (target - vu.needle[c]) * k;

    const peak = levels ? levels[2 + c] : 0;
    if (peak >= PEAK_LED) vu.peakUntil[c] = now + PEAK_HOLD_MS;
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

function drawMeter(now) {
  g.setTransform(res, 0, 0, res, 0, 0);
  g.clearRect(0, 0, W, H);

  for (let c = 0; c < 2; c++) {
    const x = FACES[c];
    const cx = x + FACE_W / 2;
    const cy = FACE_Y + FACE_H + PIVOT_DROP;
    g.drawImage(faceLayers[c], x, FACE_Y, FACE_W, FACE_H);

    // Agulha (com sombra leve), recortada acima da base.
    g.save();
    g.beginPath();
    g.roundRect(x, FACE_Y, FACE_W, FACE_H - 18, [8, 8, 0, 0]);
    g.clip();
    const [tx, ty] = polar(cx, cy, angleFor(vu.needle[c]), RADIUS + 6);
    g.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx + 2, cy);
    g.lineTo(tx + 2, ty + 1);
    g.stroke();
    g.strokeStyle = '#1b1410';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(tx, ty);
    g.stroke();
    g.restore();

    // LED de pico.
    const lit = now < vu.peakUntil[c];
    g.beginPath();
    g.arc(x + FACE_W - 12, FACE_Y + 12, 4, 0, Math.PI * 2);
    g.fillStyle = lit ? '#ff3b2f' : '#6b2a22';
    g.fill();
    if (lit) {
      g.save();
      g.shadowColor = '#ff3b2f';
      g.shadowBlur = 10;
      g.fill();
      g.restore();
    }

    if (!s.power) {
      g.beginPath();
      g.roundRect(x, FACE_Y, FACE_W, FACE_H, 8);
      g.fillStyle = 'rgba(13, 10, 8, 0.55)';
      g.fill();
    }
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
  drawMeter(now);
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
