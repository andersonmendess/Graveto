// Graveto — motor de áudio (content script, roda em cada frame).
//
// Os <audio>/<video> da página passam por um grafo Web Audio:
//
//   mídia ─→ input ─┬─→ bypass ─────────────────────────────────────────────┐
//                   └─→ bass (lowshelf) ─┬─→ dry ─────────────────────┐     │
//                                        └─→ pre-delay → reverb → wet ┴→ volume → limiter → fx ─┴→ out ─→ alto-falantes
//                                                                                                     └→ analisadores L/R (VU)
//
// "power" alterna entre bypass e fx com um crossfade curto. O slowed não passa pelo grafo:
// é playbackRate + preservesPitch=false no próprio elemento (velocidade e tom caem juntos).
(() => {
  'use strict';
  if (globalThis.__gravetoEngine) return;
  globalThis.__gravetoEngine = true;

  const DEFAULTS = globalThis.GRAVETO_DEFAULTS;
  const FRAME_ID = Math.random().toString(36).slice(2);
  const IS_TOP = window === window.top;
  const GESTURES = ['pointerdown', 'keydown', 'touchend'];

  let s = { ...DEFAULTS };
  let ready = false;

  let ctx = null;
  let n = null;              // nós do grafo
  let irSize = 0;            // duração (s) do impulso carregado no convolver
  let irTimer = 0;
  let reverbLinked = false;
  let unlinkTimer = 0;
  let gestureArmed = false;

  const known = new Set();          // elementos de mídia vistos
  const sources = new WeakMap();    // elemento → MediaElementAudioSourceNode
  const failed = new WeakSet();     // createMediaElementSource falhou (site já usa Web Audio nele)
  const rateOwned = new WeakSet();  // elementos cujo playbackRate estamos controlando
  const rateFights = new WeakMap(); // elemento → { n, t }: o site está resetando a velocidade?
  const ports = new Set();
  let meterTimer = 0;

  const wantsGraph = () => s.power && (s.bassOn || s.reverbOn || s.volume !== 1 || ports.size > 0);

  // ---------- grafo ----------

  function createEngine() {
    ctx = new AudioContext();
    n = {
      input: ctx.createGain(),
      bypass: ctx.createGain(),
      bass: ctx.createBiquadFilter(),
      dry: ctx.createGain(),
      preDelay: ctx.createDelay(0.2),
      convolver: ctx.createConvolver(),
      damp: ctx.createBiquadFilter(),
      wet: ctx.createGain(),
      volume: ctx.createGain(),
      limiter: ctx.createDynamicsCompressor(),
      fx: ctx.createGain(),
      out: ctx.createGain(),
      split: ctx.createChannelSplitter(2),
      anL: ctx.createAnalyser(),
      anR: ctx.createAnalyser(),
    };
    n.bass.type = 'lowshelf';
    n.preDelay.delayTime.value = 0.025;
    n.damp.type = 'lowpass';
    n.damp.frequency.value = 6500;
    n.damp.Q.value = 0.5;
    n.wet.gain.value = 0;

    // Limiter: segura os picos que o bass boost e o volume > 100% criam.
    const L = n.limiter;
    L.threshold.value = -1;
    L.knee.value = 0;
    L.ratio.value = 20;
    L.attack.value = 0.002;
    L.release.value = 0.15;

    // Força estéreo na saída para fontes mono aparecerem nos dois canais do VU.
    n.out.channelCount = 2;
    n.out.channelCountMode = 'explicit';
    n.out.channelInterpretation = 'speakers';
    n.anL.fftSize = n.anR.fftSize = 2048;
    n.buf = new Float32Array(n.anL.fftSize);

    n.input.connect(n.bypass).connect(n.out);
    n.input.connect(n.bass);
    n.bass.connect(n.dry).connect(n.volume);
    n.preDelay.connect(n.convolver).connect(n.damp).connect(n.wet).connect(n.volume);
    n.volume.connect(n.limiter).connect(n.fx).connect(n.out);
    n.out.connect(ctx.destination);
    n.out.connect(n.split);
    n.split.connect(n.anL, 0);
    n.split.connect(n.anR, 1);

    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') hookAll();
    });
    applyGraph(true);
  }

  function applyGraph(now = false) {
    if (!n) return;
    const t = ctx.currentTime;
    const set = (param, v) => (now ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, 0.04));

    set(n.bypass.gain, s.power ? 0 : 1);
    set(n.fx.gain, s.power ? 1 : 0);
    set(n.bass.frequency, s.bassFreq);
    set(n.bass.gain, s.bassOn ? s.bassGain : 0);
    set(n.volume.gain, s.volume);

    // Crossfade de potência constante entre seco e molhado. O convolver normalizado perde
    // ~10·log10(tamanho) dB em salas curtas; √(8/tamanho) deixa o molhado perto de −1 dB.
    const mix = s.reverbOn ? s.reverbMix : 0;
    const comp = irSize ? Math.sqrt(8 / irSize) : 1;
    set(n.dry.gain, Math.cos((mix * Math.PI) / 2));
    set(n.wet.gain, Math.sin((mix * Math.PI) / 2) * comp);

    linkReverb(s.power && s.reverbOn);
    if (s.reverbOn && s.reverbSize !== irSize) scheduleIR();
  }

  // Desliga o convolver do grafo quando o reverb está off (economiza CPU).
  function linkReverb(on) {
    clearTimeout(unlinkTimer);
    if (on && !reverbLinked) {
      n.bass.connect(n.preDelay);
      reverbLinked = true;
    } else if (!on && reverbLinked) {
      // Espera o wet chegar a zero antes de desconectar, senão a cauda corta com clique.
      unlinkTimer = setTimeout(() => {
        n.bass.disconnect(n.preDelay);
        reverbLinked = false;
      }, 400);
    }
  }

  function scheduleIR() {
    clearTimeout(irTimer);
    irTimer = setTimeout(() => {
      irSize = s.reverbSize;
      n.convolver.buffer = makeImpulse(irSize);
      applyGraph();
    }, irSize ? 150 : 0);
  }

  // Resposta ao impulso sintética: ruído estéreo descorrelacionado com decaimento
  // exponencial (−60 dB em `seconds`) e um passa-baixa que escurece ao longo da cauda,
  // como numa sala real onde os agudos morrem primeiro.
  function makeImpulse(seconds) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const ir = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const a = 1 - 0.85 * Math.sqrt(t / seconds);
        y += a * (Math.random() * 2 - 1 - y);
        d[i] = y * Math.exp((-6.9 * t) / seconds);
      }
      const fade = Math.min(len, Math.floor(rate * 0.004));
      for (let i = 0; i < fade; i++) d[i] *= i / fade;
    }
    return ir;
  }

  // ---------- mídia ----------

  // true = pode passar pelo Web Audio, false = não pode, null = ainda sem fonte.
  function routable(el) {
    if (el.srcObject) return false; // chamadas / WebRTC: não mexemos
    const src = el.currentSrc || el.src;
    if (!src) return null;
    let url;
    try {
      url = new URL(src, location.href);
    } catch {
      return false;
    }
    if (url.protocol === 'blob:' || url.protocol === 'data:') return true;
    if (url.origin === location.origin) return true;
    // Mídia de outro domínio sem CORS sai em silêncio do Web Audio — melhor não tocar.
    return el.crossOrigin !== null;
  }

  function hook(el) {
    if (!ctx || ctx.state !== 'running' || sources.has(el) || failed.has(el)) return;
    if (routable(el) !== true) return;
    try {
      const src = ctx.createMediaElementSource(el);
      src.connect(n.input);
      sources.set(el, src);
    } catch {
      failed.add(el);
    }
  }

  function hookAll() {
    for (const el of known) hook(el);
  }

  function ensureEngine() {
    if (!ctx) createEngine();
    if (ctx.state === 'running') return hookAll();
    // Sem interação do usuário na página o Chrome deixa o AudioContext suspenso.
    // Só conectamos a mídia depois que ele roda, senão ela ficaria muda.
    ctx.resume().catch(() => {});
    armGesture();
  }

  function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    const go = () => {
      gestureArmed = false;
      for (const t of GESTURES) removeEventListener(t, go, true);
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
    };
    for (const t of GESTURES) addEventListener(t, go, true);
  }

  function applyRate(el) {
    if (el.srcObject) return;
    if (s.power && s.slowedOn) {
      if (el.preservesPitch !== false) el.preservesPitch = false;
      if (Math.abs(el.playbackRate - s.slowedRate) > 1e-3) el.playbackRate = s.slowedRate;
      rateOwned.add(el);
    } else if (rateOwned.has(el)) {
      rateOwned.delete(el);
      el.preservesPitch = true;
      el.playbackRate = 1;
    }
  }

  // Sites como o YouTube resetam a velocidade ao trocar de vídeo; reaplica,
  // mas desiste se o site insistir (evita ping-pong infinito).
  function guardRate(el) {
    if (!(s.power && s.slowedOn)) return;
    if (!rateOwned.has(el)) return applyRate(el);
    if (Math.abs(el.playbackRate - s.slowedRate) < 1e-3 && el.preservesPitch === false) return;
    const now = performance.now();
    const f = rateFights.get(el) || { n: 0, t: now };
    if (now - f.t > 2000) {
      f.n = 0;
      f.t = now;
    }
    rateFights.set(el, f);
    if (++f.n <= 8) applyRate(el);
  }

  function scan() {
    for (const el of document.querySelectorAll('audio, video')) known.add(el);
    for (const el of known) {
      if (!el.isConnected && el.paused && !sources.has(el)) known.delete(el);
    }
  }

  function refresh() {
    if (!ready) return;
    scan();
    for (const el of known) applyRate(el);
    if (wantsGraph() && [...known].some((el) => routable(el) === true)) ensureEngine();
    applyGraph();
  }

  function onMediaEvent(e) {
    const el = e.target;
    if (!(el instanceof HTMLMediaElement)) return;
    known.add(el);
    if (!ready) return;
    if (e.type === 'ratechange') return guardRate(el);
    applyRate(el);
    if (wantsGraph() && routable(el) === true) ensureEngine();
  }

  // Captura no document pega eventos de mídia (que não borbulham) de qualquer elemento do DOM.
  for (const t of ['play', 'playing', 'loadedmetadata', 'ratechange']) {
    document.addEventListener(t, onMediaEvent, true);
  }
  document.addEventListener('DOMContentLoaded', refresh);

  // ---------- VU meter (popup conecta por port) ----------

  function measure(an) {
    an.getFloatTimeDomainData(n.buf);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < n.buf.length; i++) {
      const v = n.buf[i];
      sum += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    return [Math.sqrt(sum / n.buf.length), peak];
  }

  function report() {
    const media = [...known].filter((el) => el.isConnected || !el.paused);
    if (!media.length && !IS_TOP) return;
    const hooked = media.filter((el) => sources.has(el));
    const msg = {
      frame: FRAME_ID,
      media: media.length,
      hooked: hooked.length,
      blocked: media.filter((el) => !sources.has(el) && (failed.has(el) || routable(el) === false)).length,
      playing: media.some((el) => !el.paused),
      suspended: !!ctx && ctx.state !== 'running' && media.some((el) => !el.paused),
      levels: null,
    };
    if (n && ctx.state === 'running' && hooked.length) {
      const [rmsL, peakL] = measure(n.anL);
      const [rmsR, peakR] = measure(n.anR);
      msg.levels = [rmsL, rmsR, peakL, peakR];
    }
    for (const p of ports) {
      try {
        p.postMessage(msg);
      } catch {
        ports.delete(p);
      }
    }
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'graveto-meter') return;
    ports.add(port);
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      if (!ports.size) {
        clearInterval(meterTimer);
        meterTimer = 0;
      }
    });
    if (!meterTimer) meterTimer = setInterval(report, 33);
    refresh();
  });

  // ---------- configurações ----------

  chrome.storage.local.get('settings').then(({ settings }) => {
    s = { ...DEFAULTS, ...settings };
    ready = true;
    refresh();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    s = { ...DEFAULTS, ...changes.settings.newValue };
    refresh();
  });
})();
