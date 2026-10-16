importScripts('defaults.js');

const D = globalThis.GRAVETO_DEFAULTS;

async function updateBadge() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...D, ...settings };
  const active = s.power && (s.bassOn || s.reverbOn || s.slowedOn || s.volume !== 1);
  await chrome.action.setBadgeBackgroundColor({ color: '#ff7a45' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: active ? 'ON' : '' });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) updateBadge();
});
