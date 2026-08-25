/** Thin wrapper over chrome.storage so the rest of the code stops thinking about it. */

import { DEFAULT_LIBRARY } from './library.js';

export const DEFAULT_SETTINGS = {
  // Pacing. These are deliberately human-speed: the extension is standing in
  // for a researcher pasting queries, not a crawler.
  minDelayMs: 4000,
  maxDelayMs: 9000,
  longPauseEvery: 12,
  longPauseMs: 30000,

  resultsPerQuery: 20,       // &num=
  keepTopResults: 8,         // how many we store per query
  navTimeoutMs: 25000,
  recentOnly: false,         // tbs=qdr:y2
  country: '',               // gl=
  // Push the researcher's own exclude terms into the query as -"term", so the
  // wrong company never occupies a result slot. Only their typed terms are
  // ever used — never the auto-detected collision guesses.
  queryExclusions: true,
  // One query on the bare company name before the library runs, to catch a
  // name that matches two different companies before it contaminates all of
  // them. Silent unless a rival actually turns up.
  preflightProbe: true,
  // Two free, official registries checked once per run: GLEIF (Legal Entity
  // Identifier index) and SEC EDGAR full-text search. Coverage is narrow —
  // most private, non-US companies won't be in either — so this only ever
  // adds corroboration, never a penalty for coming back empty.
  registryCheck: true,

  highlightSerp: true,       // paint terms on the SERP itself
  closeTabWhenDone: true,
  windowMode: 'background',  // 'background' | 'current'

  enrichEndpoint: '',        // e.g. https://<project>.up.railway.app/enrich
  autoEnrich: false
};

const KEYS = { library: 'sx_library', settings: 'sx_settings', runs: 'sx_runs', entity: 'sx_entity' };

async function get(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] === undefined ? fallback : out[key];
}
const set = (key, value) => chrome.storage.local.set({ [key]: value });

export async function getLibrary() {
  const stored = await get(KEYS.library, null);
  if (!stored || !Array.isArray(stored) || !stored.length) return structuredClone(DEFAULT_LIBRARY);

  // Merge in any templates added to the shipped defaults since this user last
  // saved, so an upgrade doesn't silently drop new booleans.
  const known = new Set(stored.map((t) => t.id));
  const added = DEFAULT_LIBRARY.filter((t) => !known.has(t.id)).map(structuredClone);
  return stored.concat(added);
}
export const saveLibrary = (lib) => set(KEYS.library, lib);
export const resetLibrary = () => chrome.storage.local.remove(KEYS.library);

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await get(KEYS.settings, {})) };
}
export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await set(KEYS.settings, next);
  return next;
}

export const getEntity = () =>
  get(KEYS.entity, { company: '', website: '', aliases: [], contextTerms: [], excludeTerms: [] });
export const saveEntity = (entity) => set(KEYS.entity, entity);

/** Run history, newest first, capped so storage doesn't grow forever. */
export async function getRuns() { return get(KEYS.runs, []); }
export async function saveRun(run) {
  const runs = await getRuns();
  const idx = runs.findIndex((r) => r.runId === run.runId);
  if (idx >= 0) runs[idx] = run; else runs.unshift(run);
  await set(KEYS.runs, runs.slice(0, 25));
}
export async function deleteRun(runId) {
  await set(KEYS.runs, (await getRuns()).filter((r) => r.runId !== runId));
}
export const clearRuns = () => chrome.storage.local.remove(KEYS.runs);
