import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../lib/store.js';

const NUMERIC = ['minDelayMs', 'maxDelayMs', 'longPauseEvery', 'longPauseMs', 'resultsPerQuery', 'keepTopResults', 'navTimeoutMs'];
const BOOLEAN = ['recentOnly', 'queryExclusions', 'preflightProbe', 'registryCheck', 'highlightSerp', 'closeTabWhenDone', 'autoEnrich'];
const TEXT = ['country', 'enrichEndpoint', 'windowMode'];

const $ = (id) => document.getElementById(id);

function fill(settings) {
  for (const k of [...NUMERIC, ...TEXT]) if ($(k)) $(k).value = settings[k] ?? '';
  for (const k of BOOLEAN) if ($(k)) $(k).checked = !!settings[k];
}

function read() {
  const out = {};
  for (const k of NUMERIC) {
    const n = parseInt($(k).value, 10);
    out[k] = Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS[k];
  }
  for (const k of BOOLEAN) out[k] = $(k).checked;
  for (const k of TEXT) out[k] = $(k).value.trim();

  // A max below the min would make the jitter meaningless.
  if (out.maxDelayMs < out.minDelayMs) out.maxDelayMs = out.minDelayMs;
  out.resultsPerQuery = Math.min(50, Math.max(10, out.resultsPerQuery));
  out.keepTopResults = Math.min(30, Math.max(1, out.keepTopResults));
  return out;
}

function flash() {
  $('saved').classList.add('show');
  setTimeout(() => $('saved').classList.remove('show'), 1400);
}

$('save').addEventListener('click', async () => { await saveSettings(read()); flash(); });
$('reset').addEventListener('click', async () => { fill(DEFAULT_SETTINGS); await saveSettings(DEFAULT_SETTINGS); flash(); });

fill(await getSettings());
