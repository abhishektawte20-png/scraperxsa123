/**
 * ScraperX run engine.
 *
 * One tab, one query at a time, human-paced. The extension is doing what the
 * researcher was doing by hand — it is not a crawler, and the pacing below is
 * deliberate rather than incidental.
 */

import { getLibrary, getSettings, getRuns, saveRun, saveEntity } from '../lib/store.js';
import { buildJobs, bareDomain } from '../lib/query.js';
import { scoreResult } from '../lib/scoring.js';
import { probeUrl, clusterProbeResults, isAmbiguous, exclusionsFromClusters } from '../lib/probe.js';
import { checkRegistries } from '../lib/registries.js';

// ── run state (in memory; the run itself is mirrored to storage each step) ────

let state = null;      // { runId, status, jobs, index, tabId, windowId, run, settings, entity }
let pending = null;    // { tabId, resolve, timer }
let keepAlive = null;
let looping = false;   // guards against two run loops racing after a fast pause/resume

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => Math.round(min + Math.random() * Math.max(0, max - min));

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => { /* panel closed */ });
}

function startKeepAlive() {
  stopKeepAlive();
  // Touching an extension API resets the service worker's idle timer; without
  // this the worker can be torn down mid-throttle-delay and the run stalls.
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
}
function stopKeepAlive() {
  if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
}

// ── tab plumbing ─────────────────────────────────────────────────────────────

async function ensureTab() {
  if (state.tabId != null) {
    try { await chrome.tabs.get(state.tabId); return state.tabId; } catch { state.tabId = null; }
  }

  if (state.settings.windowMode === 'background') {
    const win = await chrome.windows.create({ url: 'about:blank', focused: false });
    state.windowId = win.id;
    state.tabId = win.tabs[0].id;
    try { await chrome.windows.update(win.id, { state: 'minimized' }); } catch { /* some platforms refuse */ }
  } else {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    state.tabId = tab.id;
  }
  return state.tabId;
}

async function closeTab() {
  try {
    if (state?.windowId != null) await chrome.windows.remove(state.windowId);
    else if (state?.tabId != null) await chrome.tabs.remove(state.tabId);
  } catch { /* already gone */ }
  if (state) { state.tabId = null; state.windowId = null; }
}

/** Navigate the run tab and wait for the SERP agent to report, or time out. */
function navigateAndWait(tabId, url, timeoutMs) {
  return new Promise((resolve) => {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = {
      tabId,
      resolve,
      timer: setTimeout(() => {
        const p = pending; pending = null;
        p?.resolve({ error: 'timeout' });
      }, timeoutMs)
    };
    chrome.tabs.update(tabId, { url }).catch((e) => {
      if (pending?.timer) clearTimeout(pending.timer);
      pending = null;
      resolve({ error: `navigation failed: ${e.message}` });
    });
  });
}

// ── scoring a page of results ────────────────────────────────────────────────

function processSerp(job, payload, settings, entity, registry) {
  const ctx = {
    company: entity.company,
    entityDomain: bareDomain(entity.website),
    entitySignals: job.entitySignals || [],
    signals: job.signals || [],
    category: job.category,
    templateId: job.templateId || job.id,
    excludeTerms: entity.excludeTerms || [],
    contextTerms: entity.contextTerms || [],
    registryOutOfBusiness: !!registry?.outOfBusiness,
    registryOutOfBusinessSources: registry?.outOfBusinessSources || []
  };

  const scored = (payload.results || [])
    .map((r) => ({ ...r, ...scoreResult(r, ctx) }))
    .sort((a, b) => b.score - a.score || a.rank - b.rank);

  const kept = scored.slice(0, settings.keepTopResults);
  const summary = {
    total: scored.length,
    critical: scored.filter((r) => r.tier === 'critical').length,
    strong: scored.filter((r) => r.tier === 'strong').length,
    resultCount: payload.stats?.count ?? null
  };

  return { scored, kept, summary };
}

// ── the run loop ─────────────────────────────────────────────────────────────

async function runLoop() {
  if (looping) return;
  looping = true;
  startKeepAlive();

  try {
    await drive();
  } finally {
    looping = false;
    stopKeepAlive();
  }
}

async function drive() {
  while (state && state.status === 'running' && state.index < state.jobs.length) {
    const job = state.jobs[state.index];

    broadcast({
      type: 'SX_PROGRESS',
      runId: state.runId,
      index: state.index,
      total: state.jobs.length,
      job: { id: job.id, category: job.category, name: job.name }
    });

    if (job.engine === 'external') {
      // Rovo agents and anything else we deliberately don't scrape: surface the
      // link for the researcher and move on.
      state.run.queries.push({
        id: job.id, category: job.category, name: job.name, engine: 'external',
        url: job.url, notes: job.notes, status: 'manual', results: [], summary: null
      });
      state.index++;
      await persist();
      continue;
    }

    const tabId = await ensureTab();
    const payload = await navigateAndWait(tabId, job.url, state.settings.navTimeoutMs);

    // The SERP agent reported a block: stop, hand the tab to the human.
    if (state.status === 'blocked') { await persist(); return; }

    let entry;
    if (payload?.error) {
      entry = {
        id: job.id, category: job.category, name: job.name, engine: 'google', isSiteCompanion: !!job.isSiteCompanion,
        query: job.query, url: job.url, status: 'error', error: payload.error,
        results: [], summary: null
      };
    } else {
      const { kept, summary } = processSerp(job, payload, state.settings, state.entity, state.run.registry);
      entry = {
        id: job.id, category: job.category, name: job.name, engine: 'google', isSiteCompanion: !!job.isSiteCompanion,
        query: job.query, url: job.url, status: 'ok',
        resultCount: payload.stats?.count ?? null,
        resultStatsText: payload.stats?.text || '',
        zeroResults: !!payload.stats?.zeroResults,
        results: kept, summary
      };
    }

    state.run.queries.push(entry);
    state.index++;
    await persist();
    broadcast({ type: 'SX_QUERY_DONE', runId: state.runId, entry, index: state.index, total: state.jobs.length });

    if (state.index >= state.jobs.length) break;
    if (state.status !== 'running') break;

    // Pace it.
    const { minDelayMs, maxDelayMs, longPauseEvery, longPauseMs } = state.settings;
    let wait = jitter(minDelayMs, maxDelayMs);
    if (longPauseEvery > 0 && state.index % longPauseEvery === 0) wait += longPauseMs;
    await sleep(wait);
  }

  if (!state) return;

  if (state.index >= state.jobs.length && state.status === 'running') {
    await finishRun();
  } else {
    await persist();
  }
}

async function finishRun() {
  state.status = 'done';
  state.run.status = 'done';
  state.run.finishedAt = Date.now();
  state.run.aggregate = aggregate(state.run);
  await persist();

  if (state.settings.closeTabWhenDone) await closeTab();
  broadcast({ type: 'SX_RUN_DONE', runId: state.runId, run: state.run });

  if (state.settings.autoEnrich && state.settings.enrichEndpoint) {
    enrich(state.run, state.settings.enrichEndpoint)
      .then((data) => broadcast({ type: 'SX_ENRICHED', runId: state.run.runId, data }))
      .catch((e) => broadcast({ type: 'SX_ENRICH_ERROR', runId: state.run.runId, error: e.message }));
  }
}

/**
 * Cross-query view: a URL that surfaces under five different booleans is the
 * one the researcher should read first, whatever any single query scored it.
 */
function aggregate(run) {
  const byUrl = new Map();
  for (const q of run.queries) {
    for (const r of q.results || []) {
      if (!r.url) continue;
      const hit = byUrl.get(r.url) || {
        url: r.url, title: r.title, domainClass: r.domainClass,
        bestScore: 0, queries: [], signalHits: new Set(), date: r.date
      };
      hit.bestScore = Math.max(hit.bestScore, r.score);
      hit.queries.push({ id: q.id, name: q.name, category: q.category, score: r.score, tier: r.tier });
      (r.signalHits || []).forEach((s) => hit.signalHits.add(s));
      if (!hit.date && r.date) hit.date = r.date;
      byUrl.set(r.url, hit);
    }
  }

  return [...byUrl.values()]
    .map((h) => ({
      ...h,
      signalHits: [...h.signalHits],
      queryCount: h.queries.length,
      // Corroboration across booleans is worth real weight.
      compositeScore: h.bestScore + Math.min(30, (h.queries.length - 1) * 8)
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 40);
}

async function persist() {
  if (!state) return;
  state.run.status = state.status;
  state.run.progress = { index: state.index, total: state.jobs.length };
  await saveRun(state.run);
}

async function enrich(run, endpoint) {
  const raw = {
    company_name: run.entity.company,
    website: run.entity.website,
    aliases: run.entity.aliases,
    findings: run.queries
      .filter((q) => q.results?.length)
      .map((q) => ({
        category: q.category,
        boolean: q.name,
        query: q.query,
        result_count: q.resultCount,
        top_results: q.results.slice(0, 5).map((r) => ({
          title: r.title, url: r.url, snippet: r.snippet,
          date: r.date, score: r.score, signals: r.signalHits
        }))
      }))
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw })
  });
  if (!res.ok) throw new Error(`enrich endpoint returned ${res.status}`);
  return res.json();
}

// ── commands from the panel ──────────────────────────────────────────────────

function compileJobs(library, entity, settings, only) {
  return buildJobs(library, entity, {
    num: settings.resultsPerQuery,
    recentOnly: settings.recentOnly,
    country: settings.country,
    queryExclusions: settings.queryExclusions,
    siteSearch: settings.siteSearch,
    only
  });
}

/**
 * One query on the bare company name, before the library runs.
 *
 * If the name resolves to a single company this costs one query and says
 * nothing. If it resolves to two, settling it here saves the researcher from
 * re-judging the same collision in every category that follows.
 */
async function runProbe() {
  const url = probeUrl(state.entity, { num: state.settings.resultsPerQuery, country: state.settings.country });
  if (!url) return false;

  broadcast({ type: 'SX_PROBE_START', runId: state.runId });
  const tabId = await ensureTab();
  state.probing = true;
  let payload;
  try {
    payload = await navigateAndWait(tabId, url, state.settings.navTimeoutMs);
  } finally {
    state.probing = false;
  }
  if (state.status === 'blocked') return false;
  if (payload?.error) return false; // a failed probe must never block the real run

  const clusters = clusterProbeResults(payload.results || [], state.entity);
  state.run.probe = { clusters, at: Date.now() };

  if (!isAmbiguous(clusters)) {
    broadcast({ type: 'SX_PROBE_CLEAR', runId: state.runId, clusters });
    return false;
  }

  state.status = 'ambiguous';
  await persist();
  broadcast({ type: 'SX_AMBIGUOUS', runId: state.runId, clusters });
  return true;
}

/**
 * GLEIF + SEC EDGAR, once per run. Plain fetch() calls — no tab, no SERP,
 * runs independently of the probe. A lookup failure (offline, rate limited,
 * unexpected response) never blocks or fails the run; it just means that
 * source contributes nothing this time.
 */
async function runRegistryCheck() {
  try {
    const registry = await checkRegistries(state.entity, {
      openCorporatesToken: state.settings.openCorporatesToken,
      companiesHouseKey: state.settings.companiesHouseKey
    });
    if (!state) return;
    state.run.registry = registry;
    await persist();
    broadcast({ type: 'SX_REGISTRY_READY', runId: state.runId, registry });
  } catch {
    // Never let a registry lookup problem take down the run itself.
  }
}

async function startRun({ entity, only }) {
  if (state && state.status === 'running') throw new Error('a run is already in progress');

  const [library, settings] = await Promise.all([getLibrary(), getSettings()]);
  const jobs = compileJobs(library, entity, settings, only);
  if (!jobs.length) throw new Error('no booleans selected');

  const runId = `run_${Date.now()}`;
  state = {
    runId,
    status: 'running',
    jobs,
    index: 0,
    tabId: null,
    windowId: null,
    settings,
    entity,
    library,
    only,
    run: {
      runId,
      entity,
      startedAt: Date.now(),
      status: 'running',
      progress: { index: 0, total: jobs.length },
      queries: [],
      aggregate: []
    }
  };

  await persist();
  (async () => {
    // Awaited (not fire-and-forget): a boolean scored before this resolves
    // would silently miss the corroboration bonus. It's two small JSON
    // fetches, not a page load — negligible next to the probe/query pacing.
    if (settings.registryCheck) await runRegistryCheck();
    if (!state || state.status !== 'running') return;
    if (settings.preflightProbe) {
      const paused = await runProbe();
      if (paused) return; // waiting on the researcher to pick the right company
      if (!state || state.status !== 'running') return;
    }
    await runLoop();
  })().catch(async (e) => {
    if (state) { state.status = 'error'; state.run.error = e.message; await persist(); }
    broadcast({ type: 'SX_RUN_ERROR', error: e.message });
  });

  return { runId, total: jobs.length };
}

/**
 * The researcher has said which cluster is theirs. Fold the rejected ones into
 * the entity's exclude terms, recompile so the exclusions reach the queries
 * themselves, and go.
 */
async function resolveAmbiguity({ rejectedKeys }) {
  if (!state || state.status !== 'ambiguous') return { ok: false };

  const clusters = state.run.probe?.clusters || [];
  const added = exclusionsFromClusters(clusters, rejectedKeys || []);
  if (added.length) {
    const existing = state.entity.excludeTerms || [];
    const merged = [...existing];
    for (const t of added) {
      if (!merged.some((e) => String(e).toLowerCase() === t.toLowerCase())) merged.push(t);
    }
    state.entity = { ...state.entity, excludeTerms: merged };
    state.run.entity = state.entity;
    await saveEntity(state.entity); // persists for every future run of this company
    state.jobs = compileJobs(state.library, state.entity, state.settings, state.only);
  }

  state.run.probe.resolved = { rejectedKeys: rejectedKeys || [], added };
  state.status = 'running';
  await persist();
  broadcast({ type: 'SX_AMBIGUITY_RESOLVED', runId: state.runId, added });
  runLoop().catch(() => {});
  return { ok: true, added };
}

async function stopRun() {
  if (!state) return { ok: true };
  state.status = 'stopped';
  if (pending?.timer) { clearTimeout(pending.timer); const p = pending; pending = null; p.resolve({ error: 'stopped' }); }
  await persist();
  await closeTab();
  broadcast({ type: 'SX_RUN_STOPPED', runId: state.runId });
  return { ok: true };
}

async function pauseRun() {
  if (!state || state.status !== 'running') return { ok: false };
  state.status = 'paused';
  await persist();
  broadcast({ type: 'SX_RUN_PAUSED', runId: state.runId });
  return { ok: true };
}

async function resumeRun() {
  if (!state || !['paused', 'blocked'].includes(state.status)) return { ok: false };
  state.status = 'running';
  await persist();
  broadcast({ type: 'SX_RUN_RESUMED', runId: state.runId });
  runLoop().catch(() => {});
  return { ok: true };
}

function currentState() {
  if (!state) return { active: false };
  return {
    active: true,
    runId: state.runId,
    status: state.status,
    index: state.index,
    total: state.jobs.length,
    entity: state.entity,
    run: state.run
  };
}

// ── message routing ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  // The SERP agent checks in. Reply synchronously so it can paint immediately.
  if (msg.type === 'SX_SERP_READY') {
    const tabId = sender.tab?.id;
    const isRunTab = state && tabId === state.tabId && pending && pending.tabId === tabId;
    if (!isRunTab) { sendResponse({ managed: false }); return false; }

    // The pre-flight probe navigates a SERP too, but it is not one of the
    // booleans — scoring it against jobs[state.index] would paint the wrong
    // boolean's terms all over it.
    if (state.probing) {
      if (pending?.timer) clearTimeout(pending.timer);
      const pp = pending; pending = null;
      pp.resolve(msg);
      sendResponse({ managed: true, highlight: false });
      return false;
    }

    const job = state.jobs[state.index];
    const { scored, summary } = processSerp(job, msg, state.settings, state.entity);

    if (pending?.timer) clearTimeout(pending.timer);
    const p = pending; pending = null;
    p.resolve(msg);

    const terms = [...new Set(scored.slice(0, 10).flatMap((r) => r.highlightTerms || []))];
    sendResponse({
      managed: true,
      highlight: state.settings.highlightSerp,
      terms,
      scored: scored.map((r) => ({ rank: r.rank, score: r.score, tier: r.tier, reasons: r.reasons, flag: r.flag })),
      job: { category: job.category, name: job.name },
      summary
    });
    return false;
  }

  if (msg.type === 'SX_SERP_BLOCKED') {
    const tabId = sender.tab?.id;
    if (state && tabId === state.tabId) {
      state.status = 'blocked';
      if (pending?.timer) clearTimeout(pending.timer);
      const p = pending; pending = null;
      p?.resolve({ error: 'blocked' });
      persist();
      // Bring the tab forward — a human needs to clear this.
      if (state.windowId != null) chrome.windows.update(state.windowId, { state: 'normal', focused: true }).catch(() => {});
      chrome.tabs.update(tabId, { active: true }).catch(() => {});
      broadcast({ type: 'SX_BLOCKED', reason: msg.reason, runId: state.runId, index: state.index });
    }
    sendResponse({ ok: true });
    return false;
  }

  // Panel commands — all async.
  const handlers = {
    SX_START: () => startRun(msg.payload || {}),
    SX_STOP: () => stopRun(),
    SX_RESOLVE_AMBIGUITY: () => resolveAmbiguity(msg.payload || {}),
    SX_PAUSE: () => pauseRun(),
    SX_RESUME: () => resumeRun(),
    SX_STATE: async () => currentState(),
    SX_RUNS: async () => getRuns(),
    SX_ENRICH: async () => {
      const settings = await getSettings();
      const endpoint = msg.endpoint || settings.enrichEndpoint;
      if (!endpoint) throw new Error('no enrichment endpoint configured');
      const runs = await getRuns();
      const run = runs.find((r) => r.runId === msg.runId);
      if (!run) throw new Error('run not found');
      return enrich(run, endpoint);
    },
    SX_OPEN: async () => {
      await chrome.tabs.create({ url: msg.url, active: msg.active !== false });
      return { ok: true };
    }
  };

  const handler = handlers[msg.type];
  if (!handler) return false;

  Promise.resolve()
    .then(handler)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

// If the run tab is closed out from under us, don't leave the loop hanging.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state && tabId === state.tabId) {
    state.tabId = null;
    if (pending && pending.tabId === tabId) {
      clearTimeout(pending.timer);
      const p = pending; pending = null;
      p.resolve({ error: 'run tab was closed' });
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});
