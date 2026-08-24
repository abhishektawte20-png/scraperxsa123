const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const serp = require('./fixture.cjs');

const EXT = path.resolve(__dirname, '..');
// Honour a preinstalled Chromium if the environment provides one.
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
const log = (...a) => console.log(...a);
let failures = 0;
function check(name, cond, extra = '') {
  log(`${cond ? '  PASS' : '  FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sx-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox']
  });

  // Serve a synthetic SERP for every Google request the extension makes.
  let serves = 0;
  await context.route('https://www.google.com/**', (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/search')) return route.fulfill({ status: 200, body: 'ok' });
    serves++;
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: serp(url.searchParams.get('q') || '') });
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  log('\nExtension loaded, id =', extId);

  const errors = [];
  context.on('weberror', (e) => errors.push(String(e.error())));

  // --- panel loads --------------------------------------------------------
  const panel = await context.newPage();
  panel.on('pageerror', (e) => errors.push('panel: ' + e.message));
  panel.on('console', (m) => { if (m.type() === 'error') errors.push('panel console: ' + m.text()); });
  await panel.goto(`chrome-extension://${extId}/sidepanel/panel.html`);
  await panel.waitForSelector('#selector .sel-item', { timeout: 10000 });

  log('\n[panel]');
  check('boolean selector rendered', (await panel.locator('.sel-item').count()) >= 20,
    `${await panel.locator('.sel-item').count()} items`);
  check('categories rendered', (await panel.locator('.sel-group').count()) >= 10,
    `${await panel.locator('.sel-group').count()} groups`);
  check('defaults pre-selected', /\d+ selected/.test(await panel.locator('#selectedCount').textContent()),
    await panel.locator('#selectedCount').textContent());

  // --- entity preview -----------------------------------------------------
  await panel.fill('#company', 'L&L Exhibition Management');
  await panel.fill('#website', 'www.homeshowcenter.com');
  await panel.waitForTimeout(150);
  const preview = await panel.locator('#entityPreview').textContent();
  check('entity group built', preview === '("L&L Exhibition Management" OR "www.homeshowcenter.com")', preview);

  // --- speed up the run for the test -------------------------------------
  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 10, maxDelayMs: 20, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000,
      highlightSerp: true, closeTabWhenDone: true, windowMode: 'current'
    }
  }));

  // Run a small subset so the test stays quick.
  const subset = ['backing.general', 'entity.startdate', 'smi.linkedin', 'site.hq'];
  log('\n[run]');

  // Tick exactly our subset through the real checkboxes, then press Run.
  await panel.click('#selNone');
  for (const id of subset) await panel.check(`#chk_${id.replace(/\./g, '\\.')}`);
  check('subset selected in UI', (await panel.locator('#selectedCount').textContent()).startsWith(String(subset.length)),
    await panel.locator('#selectedCount').textContent());
  check('run button enabled', await panel.locator('#startBtn').isEnabled());

  const donePromise = panel.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 60000);
    chrome.runtime.onMessage.addListener(function handler(m) {
      if (m.type === 'SX_RUN_DONE') { clearTimeout(timer); chrome.runtime.onMessage.removeListener(handler); resolve(m.run); }
    });
  }));

  await panel.click('#startBtn');

  // start() is async (storage write, then the worker round-trip), so wait for
  // the UI to react rather than sampling the instant after the click.
  let switched = true;
  try {
    await panel.waitForFunction(
      () => document.querySelector('.panel[data-panel="results"]').classList.contains('is-active'),
      null, { timeout: 5000 });
  } catch { switched = false; }
  check('switched to the results tab on start', switched);
  check('progress bar rendered', (await panel.locator('#progressWrap').count()) === 1);
  check('the Run tab actually hides once another tab is active — not just deactivated in class',
    await panel.evaluate(() => getComputedStyle(document.querySelector('.panel[data-panel="run"]')).display) === 'none');

  const done = await donePromise;

  check('run completed', !done.timeout, done.timeout ? 'timed out' : `${done.queries.length} queries`);
  check('every boolean produced an entry', done.queries?.length === subset.length);
  check('Google pages were actually fetched', serves >= subset.length, `${serves} SERPs served`);

  const ok = (done.queries || []).filter((q) => q.status === 'ok');
  check('all queries ok', ok.length === subset.length,
    (done.queries || []).map((q) => `${q.name}:${q.status}${q.error ? '(' + q.error + ')' : ''}`).join(', '));

  const first = ok[0];
  log('\n[extraction]');
  check('result count parsed from #result-stats', first?.resultCount === 12300, String(first?.resultCount));
  check('organic results extracted', (first?.results || []).length >= 4, `${first?.results?.length} kept`);
  check('titles captured', !!first?.results?.[0]?.title, first?.results?.[0]?.title);
  check('snippets captured', (first?.results || []).every((r) => r.snippet && r.snippet.length > 10));
  check('urls are real targets, not google redirects',
    (first?.results || []).every((r) => /^https?:\/\//.test(r.url) && !r.url.includes('google.com/url')));

  log('\n[scoring]');
  const top = first.results[0];
  check('press release about the company ranks first',
    top.url.includes('businesswire.com'), `${top.url} (score ${top.score})`);
  check('top hit is critical or strong', ['critical', 'strong'].includes(top.tier), top.tier);
  check('pitchbook aggregator ranked below the press hit',
    first.results.findIndex((r) => r.url.includes('pitchbook')) > 0);
  check('unrelated result classified as noise',
    first.results.find((r) => r.url.includes('example.org'))?.tier === 'noise',
    first.results.find((r) => r.url.includes('example.org'))?.tier);
  check('signal terms recorded', (top.signalHits || []).length > 0, (top.signalHits || []).join(', '));
  check('snippet date parsed', top.date === '2024-03-12', String(top.date));
  check('company + funding signal from a press source is flagged',
    top.flag && top.flag.label === 'Investor backing detected', JSON.stringify(top.flag));
  check('aggregator hit on the same boolean is not flagged',
    first.results.find((r) => r.url.includes('pitchbook'))?.flag == null,
    JSON.stringify(first.results.find((r) => r.url.includes('pitchbook'))?.flag));

  const hq = ok.find((q) => q.id === 'site.hq');
  check('HQ boolean finds the headquarters sentence',
    (hq?.results || []).some((r) => (r.signalHits || []).includes('headquartered')),
    (hq?.results?.[0]?.signalHits || []).join(', '));

  log('\n[aggregation]');
  const multi = (done.aggregate || []).filter((a) => a.queryCount > 1);
  check('cross-boolean corroboration computed', multi.length > 0, `${multi.length} sources seen by >1 boolean`);
  check('most-corroborated source ranked first',
    done.aggregate[0]?.queryCount >= (done.aggregate[1]?.queryCount ?? 0),
    `${done.aggregate[0]?.queryCount} booleans: ${done.aggregate[0]?.url}`);

  // --- panel rendering ----------------------------------------------------
  log('\n[panel rendering]');
  await panel.waitForTimeout(400);
  check('query groups rendered', (await panel.locator('.qgroup').count()) === subset.length,
    `${await panel.locator('.qgroup').count()} groups`);
  check('summary card shown', await panel.locator('#summaryCard').isVisible());
  const ctl = await panel.evaluate(() => ({
    startHidden: document.querySelector('#startBtn').hidden,
    stopHidden: document.querySelector('#stopBtn').hidden,
    pauseHidden: document.querySelector('#pauseBtn').hidden,
    progressHidden: document.querySelector('#progressWrap').hidden,
    resultsActive: document.querySelector('.panel[data-panel="results"]').classList.contains('is-active')
  }));
  check('run controls reset after finish',
    ctl.startHidden === false && ctl.stopHidden === true && ctl.pauseHidden === true,
    JSON.stringify(ctl));
  check('summary counts populated', (await panel.locator('.stat').count()) === 5,
    `${await panel.locator('.stat').count()} stats`);
  check('highlight marks painted in panel', (await panel.locator('.result-snippet mark').count()) > 0,
    `${await panel.locator('.result-snippet mark').count()} marks`);

  const md = await panel.evaluate(() => {
    document.querySelector('#copyMd').click();
    return true;
  });
  check('report copy button wired', md === true);

  // --- flag UI + filter ----------------------------------------------------
  log('\n[flag ui]');
  check('flagged result rendered with the co-occurrence badge',
    (await panel.locator('.result.is-flagged .result-flag').count()) > 0,
    `${await panel.locator('.result.is-flagged .result-flag').count()} badges`);
  check('flag badge names the finding', (await panel.locator('.result-flag').first().textContent() || '').includes('Investor backing'),
    await panel.locator('.result-flag').first().textContent());
  check('query group carries the flagged-count chip', (await panel.locator('.chip-flag').count()) > 0);

  const beforeFilter = await panel.locator('.result').count();
  await panel.check('#onlyFlagged');
  await panel.waitForTimeout(150);
  const afterFilter = await panel.locator('.result').count();
  const unflaggedVisible = await panel.locator('.result:not(.is-flagged)').count();
  check('only-flagged filter narrows the result list', afterFilter > 0 && afterFilter <= beforeFilter,
    `${beforeFilter} -> ${afterFilter}`);
  check('only-flagged filter hides everything unflagged', unflaggedVisible === 0, `${unflaggedVisible} unflagged still visible`);
  await panel.uncheck('#onlyFlagged');

  // --- editing booleans: quick-edit pencil, add-a-keyword, new boolean -----
  log('\n[edit booleans]');
  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);

  await panel.locator('[data-quickedit="backing.general"]').click({ force: true });
  await panel.waitForSelector('#editDialog[open]');
  check('quick-edit pencil opens the dialog pre-filled with the existing query',
    (await panel.inputValue('#editQuery')).includes('"venture funding"'));

  await panel.fill('#newKeyword', 'secured investment');
  await panel.click('#addKeywordBtn');
  const afterAdd = await panel.inputValue('#editQuery');
  check('Add button inserts the keyword into the existing OR-group without touching the rest',
    afterAdd.includes('"venture funding" OR "secured investment"'), afterAdd);

  await panel.click('#editSave');
  await panel.waitForTimeout(150);
  const savedTemplate = (await panel.evaluate(() => new Promise((resolve) =>
    chrome.storage.local.get('sx_library', (r) => resolve(r.sx_library)))))
    .find((t) => t.id === 'backing.general');
  check('the added keyword persists to storage', savedTemplate.query.includes('"secured investment"'), savedTemplate.query);

  // A run kicked off after the edit should carry the new keyword into the real query.
  await panel.click('#selNone');
  await panel.check(`#chk_backing\\.general`);
  const editedRunDone = panel.evaluate(() => new Promise((resolve) => {
    chrome.runtime.onMessage.addListener(function h(m) { if (m.type === 'SX_RUN_DONE') { chrome.runtime.onMessage.removeListener(h); resolve(m.run); } });
  }));
  await panel.click('#startBtn');
  const editedResult = await editedRunDone;
  check('a run started after editing actually uses the edited boolean',
    editedResult.queries[0].query.includes('"secured investment"'), editedResult.queries[0].query);

  // A brand-new boolean, built from nothing, with a keyword typed straight in.
  await panel.click('[data-tab="library"]');
  await panel.waitForTimeout(150);
  await panel.click('#libNew');
  await panel.waitForSelector('#editDialog[open]');
  await panel.fill('#editName', 'Media Coverage');
  await panel.fill('#editCategory', 'Custom Research');
  await panel.fill('#newKeyword', 'featured in');
  await panel.click('#addKeywordBtn');
  await panel.click('#editSave');
  await panel.waitForTimeout(150);

  const created = (await panel.evaluate(() => new Promise((resolve) =>
    chrome.storage.local.get('sx_library', (r) => resolve(r.sx_library)))))
    .find((t) => t.name === 'Media Coverage');
  check('a brand-new boolean gets a stable custom id', !!created && created.id.startsWith('custom.'), created?.id);
  check('the new boolean carries the typed keyword', created?.query.includes('"featured in"'), created?.query);
  check('the blank starting template leaves no stray empty "" behind', !created?.query.includes('""'), created?.query);
  check('new booleans are enabled by default, ready to run', created?.enabled === true);

  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  check('the new boolean shows up in the Run tab selector',
    (await panel.locator('.sel-item:has-text("Media Coverage")').count()) === 1);

  // --- full-screen / expand view -------------------------------------------
  log('\n[expand to full screen]');
  const [fullTab] = await Promise.all([
    context.waitForEvent('page', { timeout: 8000 }),
    panel.click('#expandView')
  ]);
  await fullTab.waitForLoadState('domcontentloaded');
  check('expand button opens the panel as its own tab',
    fullTab.url().endsWith('sidepanel/panel.html'), fullTab.url());

  await fullTab.setViewportSize({ width: 1200, height: 900 });
  await fullTab.waitForSelector('#selector .sel-item');
  const layout = await fullTab.evaluate(() => {
    const section = document.querySelector('section[data-panel="run"]');
    const company = section.querySelector('.card');
    const runCol = section.querySelector('.run-col');
    return {
      direction: getComputedStyle(section).flexDirection,
      sideBySide: runCol.getBoundingClientRect().left > company.getBoundingClientRect().right - 5
    };
  });
  check('wide viewport switches the Run tab into a side-by-side layout',
    layout.direction === 'row' && layout.sideBySide, JSON.stringify(layout));

  // The dashboard layout only applies `.is-active`-gated rules to the Run
  // panel; confirm switching away in the wide tab still actually hides it
  // (this is exactly where the display:none-vs-flex specificity bug showed up).
  await fullTab.click('[data-tab="library"]');
  const runHiddenWide = await fullTab.evaluate(() =>
    getComputedStyle(document.querySelector('.panel[data-panel="run"]')).display === 'none');
  check('Run tab hides in the wide/full-screen layout too', runHiddenWide);
  await fullTab.close();

  // --- SERP overlay -------------------------------------------------------
  log('\n[serp overlay]');
  const serpPage = await context.newPage();
  await serpPage.goto('https://www.google.com/search?q=test');
  await serpPage.waitForTimeout(800);
  check('unmanaged SERP left untouched (no banner)', (await serpPage.locator('.sx-bar').count()) === 0);
  check('unmanaged SERP not highlighted', (await serpPage.locator('mark.sx-hit').count()) === 0);

  // --- managed SERP overlay ----------------------------------------------
  log('\n[managed serp overlay]');
  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 10, maxDelayMs: 20, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000,
      highlightSerp: true, closeTabWhenDone: false, windowMode: 'current'
    }
  }));

  const done2 = panel.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 40000);
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m.type === 'SX_RUN_DONE') { clearTimeout(timer); chrome.runtime.onMessage.removeListener(h); resolve(m.run); }
    });
  }));
  await panel.evaluate(() => chrome.runtime.sendMessage({
    type: 'SX_START',
    payload: { entity: { company: 'L&L Exhibition Management', website: 'www.homeshowcenter.com', aliases: [] },
               only: ['backing.general'] }
  }));
  await done2;
  await panel.waitForTimeout(600);

  // The unmanaged page from the earlier phase is also a google.com/search tab —
  // pick the one carrying this boolean's own query.
  const runTab = context.pages().find((pg) => pg.url().includes('venture+funding'));
  check('run tab left open when closeTabWhenDone is off', !!runTab, runTab ? runTab.url().slice(0, 60) : 'none');
  if (runTab) {
    check('ScraperX banner injected on the managed SERP', (await runTab.locator('.sx-bar').count()) === 1);
    check('banner names the boolean',
      (await runTab.locator('.sx-bar-name').textContent() || '').includes('General Financing'),
      await runTab.locator('.sx-bar-name').textContent());
    check('signal terms highlighted on the page', (await runTab.locator('mark.sx-hit').count()) > 0,
      `${await runTab.locator('mark.sx-hit').count()} marks`);
    check('score badges added to results', (await runTab.locator('.sx-badge').count()) >= 4,
      `${await runTab.locator('.sx-badge').count()} badges`);
    check('top result flagged critical', (await runTab.locator('.sx-tier-critical').count()) >= 1);
    check('highlighting did not destroy the links',
      (await runTab.locator('#rso a[href^="https://"]').count()) >= 5);
    await runTab.close();
  }

  // --- pause / resume ------------------------------------------------------
  log('\n[pause and resume]');
  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 700, maxDelayMs: 900, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000,
      highlightSerp: false, closeTabWhenDone: true, windowMode: 'current'
    }
  }));

  // Pause as soon as the first boolean lands, so we stop mid-queue.
  await panel.evaluate(() => new Promise((resolve) => {
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m.type === 'SX_QUERY_DONE') {
        chrome.runtime.onMessage.removeListener(h);
        chrome.runtime.sendMessage({ type: 'SX_PAUSE' }).then(resolve);
      }
    });
    chrome.runtime.sendMessage({
      type: 'SX_START',
      payload: { entity: { company: 'Acme', website: 'acme.com', aliases: [] },
                 only: ['backing.general', 'entity.startdate', 'site.hq'] }
    });
  }));
  await panel.waitForTimeout(1400);

  const paused = (await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'SX_STATE' }))).data;
  check('run pauses mid-queue', paused.status === 'paused', paused.status);
  check('pause stops the queue advancing', paused.index < 3, `index ${paused.index} of ${paused.total}`);

  const resumedRun = panel.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 40000);
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m.type === 'SX_RUN_DONE') { clearTimeout(timer); chrome.runtime.onMessage.removeListener(h); resolve(m.run); }
    });
  }));
  // Two resumes in quick succession must not start two loops.
  await panel.evaluate(() => Promise.all([
    chrome.runtime.sendMessage({ type: 'SX_RESUME' }),
    chrome.runtime.sendMessage({ type: 'SX_RESUME' })
  ]));
  const finished = await resumedRun;
  check('resume finishes the remaining booleans', !finished.timeout && finished.queries.length === 3,
    finished.timeout ? 'timed out' : `${finished.queries.length} queries`);
  check('no boolean ran twice',
    new Set((finished.queries || []).map((q) => q.id)).size === (finished.queries || []).length,
    (finished.queries || []).map((q) => q.id).join(', '));

  // --- CAPTCHA handling ---------------------------------------------------
  log('\n[captcha handling]');
  await context.unroute('https://www.google.com/**');
  await context.route('https://www.google.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><title>Our systems have detected unusual traffic</title></head>'
        + '<body><form id="captcha-form"></form></body></html>'
  }));

  const blocked = panel.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 30000);
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m.type === 'SX_BLOCKED') { clearTimeout(timer); chrome.runtime.onMessage.removeListener(h); resolve(m); }
    });
  }));
  await panel.evaluate(() => chrome.runtime.sendMessage({
    type: 'SX_START',
    payload: { entity: { company: 'Acme', website: 'acme.com', aliases: [] },
               only: ['backing.general', 'entity.startdate'] }
  }));
  const blockMsg = await blocked;
  check('block detected and broadcast', !blockMsg.timeout, JSON.stringify(blockMsg).slice(0, 90));

  const stateAfterBlock = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'SX_STATE' }));
  check('run parked in blocked state', stateAfterBlock?.data?.status === 'blocked', stateAfterBlock?.data?.status);
  check('run did not burn through the remaining queries',
    (stateAfterBlock?.data?.run?.queries?.length ?? 99) < 2,
    `${stateAfterBlock?.data?.run?.queries?.length} queries recorded`);

  await panel.waitForTimeout(300);
  check('panel shows the verification banner', await panel.locator('#blockedBanner').isVisible());

  const stopped = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'SX_STOP' }));
  check('blocked run can be stopped', stopped?.ok === true);

  log('\n[errors]');
  const real = errors.filter((e) => !/Could not establish connection|message port closed/i.test(e));
  check('no page or worker errors', real.length === 0, real.slice(0, 4).join(' | '));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
