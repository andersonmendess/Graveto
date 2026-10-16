// Configuração padrão, compartilhada entre content script, popup e service worker.
// Atribuição (e não `const`) para não quebrar se o script for injetado duas vezes.
globalThis.GRAVETO_DEFAULTS = Object.freeze({
  power: true,
  volume: 1,

  bassOn: false,
  bassGain: 8,      // dB
  bassFreq: 90,     // Hz (lowshelf)

  reverbOn: false,
  reverbMix: 0.3,   // 0–1
  reverbSize: 3,    // segundos de cauda (RT60)

  slowedOn: false,
  slowedRate: 0.85, // playbackRate
});
