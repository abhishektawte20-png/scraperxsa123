import { getLibrary, saveLibrary, resetLibrary, getSettings, getEntity, saveEntity, getRuns, clearRuns } from '../lib/store.js';
import { buildEntityGroup, renderQuery } from '../lib/query.js';
import { toMarkdown, toCsv, slug, groupByCategory } from '../lib/export.js';

// ── tiny helpers ─────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Escape first, then mark — so the terms never smuggle markup in. */
function highlight(text, terms) {
  const safe = esc(text);
  const parts = (terms || [])
    .filter((t) => t && String(t).trim().length > 1)
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRe(esc(String(t).trim())).replace(/\\?\s+/g, '\\s+'));
  if (!parts.length) return safe;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${parts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
  return safe.replace(re, (_m, pre, hit) => `${pre}<mark>${hit}</mark>`);
}

const send = (type, extra = {}) =>
  chrome.runtime.sendMessage({ type, ...extra }).then((r) => {
    if (!r) throw new Error('no response from background');
    if (r.ok === false) throw new Error(r.error || 'unknown error');
    return r.data;
  });

const fmtTime = (ts) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = old; }, 1400); }
  } catch { /* clipboard refused — nothing useful to do */ }
}

// ── app state ────────────────────────────────────────────────────────────────

const app = {
  library: [],
  selected: new Set(),
  settings: {},
  entity: { company: '', website: '', aliases: [] },
  run: null,
  running: false
};

// ── entity form ──────────────────────────────────────────────────────────────

function readEntity() {
  return {
    company: $('#company').value.trim(),
    website: $('#website').value.trim(),
    aliases: $('#aliases').value.split('\n').map((s) => s.trim()).filter(Boolean)
  };
}

function refreshEntityPreview() {
  app.entity = readEntity();
  const group = buildEntityGroup(app.entity);
  $('#entityPreview').textContent = group || '—';
  saveEntity(app.entity);
  updateRunButton();
}

// ── boolean selector ─────────────────────────────────────────────────────────

function renderSelector() {
  const host = $('#selector');
  host.innerHTML = groupByCategory(app.library).map(([cat, items]) => `
    <div class="sel-group">
      <div class="sel-group-head">
        <input type="checkbox" class="cat-check" data-cat="${esc(cat)}">
        <span>${esc(cat)}</span>
      </div>
      ${items.map((t) => `
        <div class="sel-item">
          <input type="checkbox" class="tpl-check" id="chk_${esc(t.id)}" data-id="${esc(t.id)}"
                 ${app.selected.has(t.id) ? 'checked' : ''}>
          <label for="chk_${esc(t.id)}">${esc(t.name)}</label>
          ${t.engine === 'external' ? '<span class="sel-tag sel-tag-ext">opens only</span>' : ''}
          ${t.tag === 'rovo-down' ? '<span class="sel-tag">ROVO down</span>' : ''}
        </div>`).join('')}
    </div>`).join('');

  host.querySelectorAll('.tpl-check').forEach((el) => {
    el.addEventListener('change', () => {
      el.checked ? app.selected.add(el.dataset.id) : app.selected.delete(el.dataset.id);
      updateSelectionCounts();
    });
  });
  host.querySelectorAll('.cat-check').forEach((el) => {
    el.addEventListener('change', () => {
      app.library.filter((t) => t.category === el.dataset.cat).forEach((t) => {
        el.checked ? app.selected.add(t.id) : app.selected.delete(t.id);
      });
      renderSelector();
      updateSelectionCounts();
    });
  });
  updateSelectionCounts();
}

function updateSelectionCounts() {
  const n = app.selected.size;
  $('#selectedCount').textContent = `${n} selected`;

  $$('.cat-check').forEach((el) => {
    const items = app.library.filter((t) => t.category === el.dataset.cat);
    const on = items.filter((t) => app.selected.has(t.id)).length;
    el.checked = on === items.length && items.length > 0;
    el.indeterminate = on > 0 && on < items.length;
  });

  const google = app.library.filter((t) => app.selected.has(t.id) && t.engine !== 'external').length;
  const { minDelayMs = 4000, maxDelayMs = 9000 } = app.settings;
  const secs = Math.round((google * ((minDelayMs + maxDelayMs) / 2 + 3500)) / 1000);
  $('#etaHint').textContent = google
    ? `${google} Google ${google === 1 ? 'query' : 'queries'} · roughly ${secs < 90 ? `${secs}s` : `${Math.round(secs / 60)} min`} at the current pacing.`
    : '';
  updateRunButton();
}

function updateRunButton() {
  $('#startBtn').disabled = app.running || !app.selected.size || !$('#company').value.trim();
}

function applyPreset(kind) {
  app.selected.clear();
  for (const t of app.library) {
    if (kind === 'all') app.selected.add(t.id);
    else if (kind === 'default' && t.enabled) app.selected.add(t.id);
    else if (kind === 'rovo' && (t.enabled || t.tag === 'rovo-down')) app.selected.add(t.id);
  }
  renderSelector();
}

// ── running ──────────────────────────────────────────────────────────────────

function setRunning(on) {
  app.running = on;
  if (on) $('#pauseBtn').textContent = 'Pause';
  $('#startBtn').hidden = on;
  $('#pauseBtn').hidden = !on;
  $('#stopBtn').hidden = !on;
  $('#progressWrap').hidden = !on;
  updateRunButton();
}

function setProgress(index, total, label) {
  $('#progressBar').style.width = `${total ? (index / total) * 100 : 0}%`;
  $('#progressText').textContent = `${index} / ${total} — ${label}`;
}

async function start() {
  const entity = readEntity();
  if (!entity.company) return;
  await saveEntity(entity);

  app.run = { runId: null, entity, queries: [], startedAt: Date.now(), aggregate: [] };
  $('#resultsList').innerHTML = '';
  $('#resultsEmpty').hidden = true;
  $('#summaryCard').hidden = true;
  $('#aggregateCard').hidden = true;
  $('#resultFilters').hidden = false;

  try {
    const { runId, total } = await send('SX_START', { payload: { entity, only: [...app.selected] } });
    app.run.runId = runId;
    setRunning(true);
    setProgress(0, total, 'starting…');
    switchTab('results');
  } catch (e) {
    alert(`Could not start the run: ${e.message}`);
  }
}

// ── result rendering ─────────────────────────────────────────────────────────

function tierChip(entry) {
  if (entry.status === 'manual') return '<span class="chip">manual</span>';
  if (entry.status === 'error') return `<span class="chip chip-error">${esc(entry.error || 'error')}</span>`;
  if (entry.zeroResults || !(entry.results || []).length) return '<span class="chip chip-zero">no hits</span>';

  const c = entry.summary?.critical || 0;
  const s = entry.summary?.strong || 0;
  return (c ? `<span class="chip chip-critical">${c} critical</span>` : '') +
         (s ? `<span class="chip chip-strong">${s} strong</span>` : '') ||
         '<span class="chip">weak only</span>';
}

function flaggedCount(entry) {
  return (entry.results || []).filter((r) => r.flag).length;
}

function resultRow(r) {
  const terms = r.highlightTerms || [];
  return `
    <div class="result tier-${esc(r.tier)}${r.flag ? ' is-flagged' : ''}">
      <div class="result-top">
        <span class="result-score">${r.score}</span>
        ${r.flag ? `<span class="result-flag">${r.flag.icon} ${esc(r.flag.label)}</span>` : ''}
        <a class="result-title" href="${esc(r.url)}" target="_blank" rel="noreferrer">${highlight(r.title, terms)}</a>
      </div>
      <div class="result-url">${esc(r.displayUrl || r.url)}</div>
      ${r.snippet ? `<div class="result-snippet">${highlight(r.snippet, terms)}</div>` : ''}
      <div class="result-why">${(r.reasons || []).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>
    </div>`;
}

function queryGroup(entry) {
  const hasResults = (entry.results || []).length > 0;
  const countLabel = entry.resultCount != null ? `${entry.resultCount.toLocaleString()} results` : '';
  const flagged = flaggedCount(entry);

  return `
    <div class="qgroup${flagged ? ' has-flag' : ''}${hasResults && (entry.summary?.critical || entry.summary?.strong) ? ' is-open' : ''}" data-id="${esc(entry.id)}">
      <button class="qgroup-head" type="button">
        <div>
          <div class="qgroup-cat">${esc(entry.category)}</div>
          <div class="qgroup-name">${esc(entry.name)}</div>
        </div>
        <div class="qgroup-meta">
          ${countLabel ? `<span class="chip">${esc(countLabel)}</span>` : ''}
          ${flagged ? `<span class="chip chip-flag">${flagged} flagged</span>` : ''}
          ${tierChip(entry)}
        </div>
      </button>
      <div class="qgroup-body">
        ${entry.query ? `<div class="qquery">${esc(entry.query)}</div>` : ''}
        <div class="row row-tight" style="margin-bottom:8px">
          ${entry.url ? `<button class="btn btn-ghost btn-sm" data-open="${esc(entry.url)}">Open in Google</button>` : ''}
          ${entry.query ? `<button class="btn btn-ghost btn-sm" data-copy="${esc(entry.query)}">Copy boolean</button>` : ''}
        </div>
        ${entry.notes ? `<p class="hint">${esc(entry.notes)}</p>` : ''}
        ${hasResults ? entry.results.map(resultRow).join('') : '<p class="hint">No results kept for this boolean.</p>'}
      </div>
    </div>`;
}

function renderResults() {
  const run = app.run;
  if (!run || !run.queries.length) return;

  const onlyStrong = $('#onlyStrong').checked;
  const onlyFlagged = $('#onlyFlagged').checked;
  const hideEmpty = $('#hideEmpty').checked;

  const entries = run.queries
    .map((e) => {
      let results = e.results || [];
      if (onlyStrong) results = results.filter((r) => r.tier === 'critical' || r.tier === 'strong');
      if (onlyFlagged) results = results.filter((r) => r.flag);
      return results === e.results ? e : { ...e, results };
    })
    .filter((e) => !hideEmpty || (e.results || []).length || e.status === 'manual' || e.status === 'error');

  $('#resultsList').innerHTML = entries.map(queryGroup).join('') ||
    '<p class="empty">Nothing matched the current filters.</p>';

  $('#resultsCount').textContent = String(run.queries.length);
  renderSummary();
}

function renderSummary() {
  const run = app.run;
  if (!run || !run.queries.length) return;

  const all = run.queries.flatMap((q) => q.results || []);
  const stats = [
    ['Booleans', run.queries.length, ''],
    ['Critical', all.filter((r) => r.tier === 'critical').length, 'stat-critical'],
    ['Strong', all.filter((r) => r.tier === 'strong').length, 'stat-strong'],
    ['Sources', new Set(all.map((r) => r.url)).size, ''],
    ['No hits', run.queries.filter((q) => q.status === 'ok' && !(q.results || []).length).length, '']
  ];

  $('#summaryCard').hidden = false;
  $('#summaryTitle').textContent = run.entity?.company || 'Run summary';
  $('#summaryStats').innerHTML = stats.map(([label, num, cls]) => `
    <div class="stat ${cls}"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`).join('');

  $('#enrichBtn').hidden = !app.settings.enrichEndpoint;
  renderAggregate();
}

function renderAggregate() {
  const agg = (app.run?.aggregate || []).filter((a) => a.queryCount > 1);
  $('#aggregateCard').hidden = !agg.length;
  if (!agg.length) return;

  $('#aggregateList').innerHTML = agg.slice(0, 15).map((a) => `
    <div class="agg-item">
      <span class="agg-count" title="${a.queryCount} booleans found this">${a.queryCount}</span>
      <div class="agg-body">
        <a class="agg-title" href="${esc(a.url)}" target="_blank" rel="noreferrer">${esc(a.title)}</a>
        <div class="agg-meta">${esc(a.url)}</div>
        <div class="agg-meta">${esc(a.queries.map((q) => q.name).join(' · '))}${a.date ? ` · ${esc(a.date)}` : ''}</div>
      </div>
    </div>`).join('');
}

// ── library tab ──────────────────────────────────────────────────────────────

function renderLibrary() {
  $('#libraryList').innerHTML = groupByCategory(app.library).map(([cat, items]) => items.map((t) => `
    <div class="lib-item" data-id="${esc(t.id)}">
      <div class="lib-head">
        <input type="checkbox" class="lib-enabled" data-id="${esc(t.id)}" ${t.enabled ? 'checked' : ''} title="In the default set">
        <div>
          <div class="lib-cat">${esc(cat)}</div>
          <div class="lib-name">${esc(t.name)}</div>
        </div>
        <div class="lib-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${esc(t.id)}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-preview="${esc(t.id)}">Copy</button>
        </div>
      </div>
      <div class="lib-query">${esc(t.engine === 'external' ? t.url : t.query)}</div>
    </div>`).join('')).join('');
}

let editingId = null;
function openEditor(id) {
  const t = app.library.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  $('#editTitle').textContent = t.name;
  $('#editName').value = t.name;
  $('#editCategory').value = t.category;
  $('#editQuery').value = t.engine === 'external' ? (t.url || '') : (t.query || '');
  $('#editDialog').showModal();
}

async function saveEditor() {
  const t = app.library.find((x) => x.id === editingId);
  if (!t) return;
  t.name = $('#editName').value.trim() || t.name;
  t.category = $('#editCategory').value.trim() || t.category;
  if (t.engine === 'external') t.url = $('#editQuery').value.trim();
  else t.query = $('#editQuery').value.trim();
  await saveLibrary(app.library);
  renderLibrary();
  renderSelector();
}

/**
 * Pull booleans straight off whatever internal tool page is open, by reading the
 * google.com/search URLs the sheet already renders next to each Copy button.
 */
async function grabFromTab() {
  const granted = await chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] }).catch(() => false);
  if (!granted) return alert('Permission is needed to read the boolean sheet from the open tab.');

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;

  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const found = [];
      const seen = new Set();

      const rowOf = (el) => el.closest('tr, li, [role="row"]') || el.parentElement?.parentElement || el.parentElement;
      const headingAbove = (el) => {
        let n = rowOf(el);
        while (n) {
          let p = n.previousElementSibling;
          while (p) {
            const t = (p.innerText || '').trim();
            if (t && t.length < 40 && !/google|copy boolean|http/i.test(t)) return t.split('\n')[0].trim();
            p = p.previousElementSibling;
          }
          n = n.parentElement;
          if (n === document.body) break;
        }
        return 'Imported';
      };

      const consider = (el, url) => {
        if (!url || seen.has(url)) return;
        seen.add(url);
        const row = rowOf(el);
        const cells = row ? [...row.querySelectorAll('td, th, div, span')].map((c) => (c.innerText || '').trim()) : [];
        const name = cells.find((t) => t && t.length < 60 && !/^https?:/i.test(t) && !/^(google|copy boolean|web crawler|not valid query)$/i.test(t))
          || (row?.innerText || '').split('\n')[0].trim() || 'Imported boolean';
        found.push({ name, url, category: headingAbove(el) });
      };

      document.querySelectorAll('a[href*="google.com/search"]').forEach((a) => consider(a, a.href));
      const re = /https?:\/\/(?:www\.)?google\.com\/search\?q=\S+/gi;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        for (const m of (n.nodeValue || '').matchAll(re)) consider(n.parentElement || document.body, m[0]);
      }
      return found;
    }
  }).catch((e) => { alert(`Could not read that tab: ${e.message}`); return []; });

  if (!result || !result.length) return alert('No Google boolean URLs found on that page.');

  let added = 0;
  for (const item of result) {
    let q;
    try { q = new URL(item.url).searchParams.get('q') || ''; } catch { continue; }
    if (!q.trim()) continue;

    // The sheet bakes one company into every boolean; swap that leading
    // ("Name" OR "site") group back out for the {{entity}} placeholder.
    const query = q.replace(/^\s*\([^)]*\)/, '{{entity}}').trim();
    const id = `imported.${slug(item.category)}.${slug(item.name)}`;
    if (app.library.some((t) => t.id === id)) continue;

    app.library.push({
      id, category: item.category || 'Imported', name: item.name,
      engine: 'google', enabled: false,
      query: query.startsWith('{{entity}}') ? query : `{{entity}} AND ${query}`
    });
    added++;
  }

  await saveLibrary(app.library);
  renderLibrary();
  renderSelector();
  alert(`Imported ${added} boolean${added === 1 ? '' : 's'} (added disabled — review, then tick them on).`);
}

// ── history tab ──────────────────────────────────────────────────────────────

async function renderHistory() {
  const runs = await getRuns();
  $('#historyList').innerHTML = runs.length ? runs.map((r) => `
    <div class="hist-item">
      <div class="hist-body">
        <div class="hist-name">${esc(r.entity?.company || 'Untitled')}</div>
        <div class="hist-meta">${fmtTime(r.startedAt)} · ${r.queries?.length || 0} booleans · ${esc(r.status)}</div>
      </div>
      <button class="btn btn-ghost btn-sm" data-load="${esc(r.runId)}">Open</button>
    </div>`).join('') : '<p class="empty">No runs yet.</p>';

  $$('#historyList [data-load]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const found = (await getRuns()).find((r) => r.runId === btn.dataset.load);
      if (!found) return;
      app.run = found;
      $('#resultsEmpty').hidden = true;
      $('#resultFilters').hidden = false;
      renderResults();
      switchTab('results');
    });
  });
}

// ── tabs ─────────────────────────────────────────────────────────────────────

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === name));
  if (name === 'history') renderHistory();
  if (name === 'library') renderLibrary();
}

// ── background events ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg?.type) return;

  if (msg.type === 'SX_PROGRESS') {
    setProgress(msg.index, msg.total, `${msg.job.category} › ${msg.job.name}`);
  }

  if (msg.type === 'SX_QUERY_DONE') {
    if (!app.run) app.run = { queries: [], entity: app.entity, startedAt: Date.now() };
    app.run.queries.push(msg.entry);
    setProgress(msg.index, msg.total, 'running…');
    renderResults();
  }

  if (msg.type === 'SX_RUN_DONE') {
    app.run = msg.run;
    setRunning(false);
    renderResults();
    renderHistory();
  }

  if (msg.type === 'SX_BLOCKED') {
    $('#blockedBanner').hidden = false;
    setRunning(false);
  }

  if (msg.type === 'SX_RUN_STOPPED' || msg.type === 'SX_RUN_ERROR') {
    setRunning(false);
    if (msg.error) alert(`Run stopped: ${msg.error}`);
  }

  if (msg.type === 'SX_RUN_PAUSED') { $('#pauseBtn').textContent = 'Resume'; }
  if (msg.type === 'SX_RUN_RESUMED') { $('#pauseBtn').textContent = 'Pause'; setRunning(true); $('#blockedBanner').hidden = true; }

  if (msg.type === 'SX_ENRICHED') {
    $('#enrichOut').hidden = false;
    $('#enrichOut').textContent = JSON.stringify(msg.data, null, 2);
  }
  if (msg.type === 'SX_ENRICH_ERROR') {
    $('#enrichOut').hidden = false;
    $('#enrichOut').textContent = `Enrichment failed: ${msg.error}`;
  }
});

// ── wiring ───────────────────────────────────────────────────────────────────

function wire() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // The docked side panel is narrow by design; this reopens the same page as
  // a normal tab, where the CSS grid widens into a full dashboard layout.
  $('#expandView').addEventListener('click', () => send('SX_OPEN', { url: chrome.runtime.getURL('sidepanel/panel.html') }));

  ['#company', '#website', '#aliases'].forEach((sel) =>
    $(sel).addEventListener('input', refreshEntityPreview));

  $('#selAll').addEventListener('click', () => applyPreset('all'));
  $('#selNone').addEventListener('click', () => applyPreset('none'));
  $('#selDefault').addEventListener('click', () => applyPreset('default'));
  $('#selRovoDown').addEventListener('click', () => applyPreset('rovo'));

  $('#startBtn').addEventListener('click', start);
  $('#stopBtn').addEventListener('click', () => send('SX_STOP').then(() => setRunning(false)));
  $('#pauseBtn').addEventListener('click', () => {
    const resuming = $('#pauseBtn').textContent === 'Resume';
    send(resuming ? 'SX_RESUME' : 'SX_PAUSE');
  });
  $('#resumeAfterBlock').addEventListener('click', () => {
    $('#blockedBanner').hidden = true;
    send('SX_RESUME').then(() => setRunning(true));
  });

  $('#onlyStrong').addEventListener('change', renderResults);
  $('#onlyFlagged').addEventListener('change', renderResults);
  $('#hideEmpty').addEventListener('change', renderResults);

  $('#copyMd').addEventListener('click', (e) => app.run && copy(toMarkdown(app.run), e.target));
  $('#exportJson').addEventListener('click', () =>
    app.run && download(`scraperx-${slug(app.run.entity?.company)}.json`, JSON.stringify(app.run, null, 2), 'application/json'));
  $('#exportCsv').addEventListener('click', () =>
    app.run && download(`scraperx-${slug(app.run.entity?.company)}.csv`, toCsv(app.run), 'text/csv'));

  $('#enrichBtn').addEventListener('click', async (e) => {
    if (!app.run?.runId) return;
    e.target.disabled = true;
    $('#enrichOut').hidden = false;
    $('#enrichOut').textContent = 'Sending to enrichment endpoint…';
    try {
      const data = await send('SX_ENRICH', { runId: app.run.runId });
      $('#enrichOut').textContent = JSON.stringify(data, null, 2);
    } catch (err) {
      $('#enrichOut').textContent = `Enrichment failed: ${err.message}`;
    } finally {
      e.target.disabled = false;
    }
  });

  // Delegated: result-group toggles, open/copy buttons.
  $('#resultsList').addEventListener('click', (e) => {
    const head = e.target.closest('.qgroup-head');
    if (head) { head.parentElement.classList.toggle('is-open'); return; }
    const open = e.target.closest('[data-open]');
    if (open) { send('SX_OPEN', { url: open.dataset.open }); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) copy(cp.dataset.copy, cp);
  });

  $('#libraryList').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return openEditor(ed.dataset.edit);
    const pv = e.target.closest('[data-preview]');
    if (pv) {
      const t = app.library.find((x) => x.id === pv.dataset.preview);
      if (t) copy(t.engine === 'external' ? t.url : renderQuery(t, readEntity()), pv);
    }
  });
  $('#libraryList').addEventListener('change', async (e) => {
    const el = e.target.closest('.lib-enabled');
    if (!el) return;
    const t = app.library.find((x) => x.id === el.dataset.id);
    if (!t) return;
    t.enabled = el.checked;
    await saveLibrary(app.library);
    renderSelector();
  });

  $('#editSave').addEventListener('click', () => setTimeout(saveEditor, 0));

  $('#libExport').addEventListener('click', () =>
    download('scraperx-booleans.json', JSON.stringify(app.library, null, 2), 'application/json'));
  $('#libImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array of templates');
      app.library = parsed;
      await saveLibrary(app.library);
      renderLibrary(); renderSelector();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
    e.target.value = '';
  });
  $('#libReset').addEventListener('click', async () => {
    if (!confirm('Reset the boolean library to the shipped defaults?')) return;
    await resetLibrary();
    app.library = await getLibrary();
    applyPreset('default');
    renderLibrary();
  });
  $('#libGrab').addEventListener('click', grabFromTab);

  $('#clearHistory').addEventListener('click', async () => {
    if (!confirm('Delete all stored runs?')) return;
    await clearRuns();
    renderHistory();
  });

  $('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

// ── boot ─────────────────────────────────────────────────────────────────────

(async function init() {
  [app.library, app.settings, app.entity] = await Promise.all([getLibrary(), getSettings(), getEntity()]);

  $('#company').value = app.entity.company || '';
  $('#website').value = app.entity.website || '';
  $('#aliases').value = (app.entity.aliases || []).join('\n');
  $('#entityPreview').textContent = buildEntityGroup(app.entity) || '—';

  wire();
  applyPreset('default');

  // Reattach to a run that's already going (the panel can be closed and reopened).
  try {
    const st = await send('SX_STATE');
    if (st?.active) {
      app.run = st.run;
      setRunning(st.status === 'running');
      setProgress(st.index, st.total, st.status);
      if (st.status === 'blocked') $('#blockedBanner').hidden = false;
      if (st.run?.queries?.length) { $('#resultsEmpty').hidden = true; $('#resultFilters').hidden = false; renderResults(); }
    }
  } catch { /* worker not up yet — nothing in flight */ }
})();
