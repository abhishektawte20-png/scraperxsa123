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
    const q = url.searchParams.get('q') || '';
    const bare = q.trim();
    const body = q.includes('"nested-layout"') ? serp.nestedSerp(q)   // multi-result wrapper
      : q.includes('"chapter 11"') ? serp.registryConfirmedSerp(q)    // registry corroboration
      : bare === '"Psypher"' ? serp.probeSerp(q)                      // pre-flight probe
      : bare === '"Acme Robotics"' ? serp.soloSerp(q)                // unambiguous probe
      : q.includes('psypher.in') ? serp.autoCollisionSerp(q)
      : q.includes('Psypher') ? serp.collisionSerp(q)
      : serp(q);
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });

  // Serve the two registry APIs too — every run hits them once (registryCheck
  // defaults on), so an unrouted request here would stall or fail every test
  // in this file, not just the ones that care about the registry feature.
  // Default: empty, matching what a private/non-US company actually gets back.
  let gleifCalls = 0;
  let edgarCalls = 0;
  let openCorporatesCalls = 0;
  let companiesHouseCalls = 0;
  let gleifFixture = { data: [] };
  let edgarFixture = { hits: { hits: [] } };
  let openCorporatesFixture = { results: { companies: [] } };
  let companiesHouseFixture = { items: [] };
  let companiesHouseAuthHeader = null;
  await context.route('https://api.gleif.org/**', (route) => {
    gleifCalls++;
    route.fulfill({ status: 200, contentType: 'application/vnd.api+json', body: JSON.stringify(gleifFixture) });
  });
  await context.route('https://efts.sec.gov/**', (route) => {
    edgarCalls++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(edgarFixture) });
  });
  await context.route('https://api.opencorporates.com/**', (route) => {
    openCorporatesCalls++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(openCorporatesFixture) });
  });
  await context.route('https://api.company-information.service.gov.uk/**', (route) => {
    companiesHouseCalls++;
    companiesHouseAuthHeader = route.request().headers()['authorization'] || null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(companiesHouseFixture) });
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
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000, preflightProbe: false,
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
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000, preflightProbe: false,
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

  // --- XSS hardening: a boolean's own name/category is researcher-editable
  // (quick-edit pencil, New boolean, library import) and reaches serp.js's
  // innerHTML calls on live google.com — prove it's escaped, not executed. ---
  log('\n[xss hardening]');
  await panel.click('[data-tab="library"]');
  await panel.waitForTimeout(150);
  await panel.click('#libNew');
  await panel.waitForSelector('#editDialog[open]');
  const payload = `<img src=x onerror='window.__sx_xss=(window.__sx_xss||0)+1'>`;
  await panel.fill('#editName', `Injected${payload}Name`);
  await panel.fill('#editCategory', `Injected${payload}Category`);
  await panel.click('#editSave');
  await panel.waitForTimeout(150);

  const xssTemplate = (await panel.evaluate(() => new Promise((resolve) =>
    chrome.storage.local.get('sx_library', (r) => resolve(r.sx_library)))))
    .find((t) => t.name.startsWith('Injected'));
  check('malicious boolean saved as inert data, not executed in the panel',
    !!xssTemplate, JSON.stringify(xssTemplate?.name));

  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  await panel.click('#selNone');
  await panel.check(`#chk_${xssTemplate.id.replace(/\./g, '\\.')}`);

  const [xssTab] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }),
    (async () => {
      const doneXss = panel.evaluate(() => new Promise((resolve) => {
        chrome.runtime.onMessage.addListener(function h(m) { if (m.type === 'SX_RUN_DONE') { chrome.runtime.onMessage.removeListener(h); resolve(m.run); } });
      }));
      await panel.click('#startBtn');
      await doneXss;
    })()
  ]);
  await xssTab.waitForTimeout(600);

  const xssFired = await xssTab.evaluate(() => window.__sx_xss || 0);
  check('the payload never executes on the SERP page', xssFired === 0, `window.__sx_xss = ${xssFired}`);
  check('no img[onerror] element was created from the escaped markup',
    (await xssTab.locator('img[onerror]').count()) === 0);
  const bannerText = await xssTab.locator('.sx-bar-name').textContent().catch(() => '');
  check('the raw payload shows as literal, escaped text in the banner instead',
    (bannerText || '').includes('<img') && (bannerText || '').includes('Name'), bannerText);
  await xssTab.close();

  // --- name-collision disambiguation ---------------------------------------
  // Reproduces the exact production report: "Psypher" (target) colliding with
  // the unrelated "Psypher Interactive", plus a negated funding claim and a
  // ToS-page word match — all in one real run through the actual UI.
  log('\n[name-collision disambiguation]');
  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 10, maxDelayMs: 20, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000, preflightProbe: false,
      highlightSerp: false, closeTabWhenDone: true, windowMode: 'current'
    }
  }));

  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  await panel.fill('#company', 'Psypher');
  await panel.fill('#website', 'psypher.ai');
  await panel.click('.disambig summary'); // expand the collapsed <details>
  await panel.fill('#excludeTerms', 'Interactive\nGames\nStudio');
  await panel.waitForTimeout(150);

  const collisionEntityPreview = await panel.locator('#entityPreview').textContent();
  check('disambiguation fields do not change the entity group Google receives',
    collisionEntityPreview === '("Psypher" OR "psypher.ai")', collisionEntityPreview);

  await panel.click('#selNone');
  await panel.check('#chk_backing\\.general');
  const collisionRun = panel.evaluate(() => new Promise((resolve) => {
    chrome.runtime.onMessage.addListener(function h(m) { if (m.type === 'SX_RUN_DONE') { chrome.runtime.onMessage.removeListener(h); resolve(m.run); } });
  }));
  await panel.click('#startBtn');
  const collisionResult = await collisionRun;
  const financingResults = collisionResult.queries[0].results;

  const tracxnHit = financingResults.find((r) => r.url.includes('tracxn.com'));
  const businesswireHit = financingResults.find((r) => r.url.includes('businesswire.com'));
  check('the name-collision result is demoted to noise', tracxnHit?.tier === 'noise', tracxnHit?.tier);
  check('the name-collision result carries no flag', tracxnHit?.flag == null);
  check('the genuine same-name result (different article) still gets flagged',
    businesswireHit?.flag?.label === 'Investor backing detected', JSON.stringify(businesswireHit?.flag));

  await panel.waitForTimeout(400);
  check('the panel shows a "different company?" badge on the collision result',
    (await panel.locator('.result-collision').count()) > 0,
    await panel.locator('.result-collision').first().textContent().catch(() => 'none'));

  // Same entity, the Grant boolean — "grant" used as a legal verb on the ToS
  // page must not read as a funding signal either.
  await panel.click('[data-tab="run"]'); // the previous run auto-switched to Results
  await panel.waitForTimeout(150);
  await panel.click('#selNone');
  await panel.check('#chk_backing\\.grant');
  const grantRun = panel.evaluate(() => new Promise((resolve) => {
    chrome.runtime.onMessage.addListener(function h(m) { if (m.type === 'SX_RUN_DONE') { chrome.runtime.onMessage.removeListener(h); resolve(m.run); } });
  }));
  await panel.click('#startBtn');
  const grantResult = await grantRun;
  const tosHit = grantResult.queries[0].results.find((r) => r.url.includes('psypher.ai/terms'));
  check('"grant" as a legal verb on a ToS page is not flagged as funding',
    tosHit?.flag == null, JSON.stringify(tosHit?.flag));

  // --- auto-detected collision: same test, but nothing pre-configured -----
  // The point of this round's fix: it has to work without the researcher
  // having predicted "AI" as an exclude term in advance. Fresh entity, fresh
  // run, excludeTerms/contextTerms left empty on purpose.
  log('\n[auto-detected collision — zero configuration]');
  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  await panel.fill('#company', 'Psypher');
  await panel.fill('#website', 'psypher.in');
  await panel.fill('#excludeTerms', '');
  await panel.fill('#contextTerms', '');
  await panel.waitForTimeout(150);

  await panel.click('#selNone');
  await panel.check('#chk_entity\\.startdate');
  const autoRun = panel.evaluate(() => new Promise((resolve) => {
    chrome.runtime.onMessage.addListener(function h(m) { if (m.type === 'SX_RUN_DONE') { chrome.runtime.onMessage.removeListener(h); resolve(m.run); } });
  }));
  await panel.click('#startBtn');
  const autoResult = await autoRun;
  const startDateResults = autoResult.queries[0].results;

  const genuinePsypher = startDateResults.find((r) => r.url.includes('www.psypher.in'));
  const psypherAiTracxn = startDateResults.find((r) => r.url.includes('Companies/psypher-ai'));
  const psypherAiTos = startDateResults.find((r) => r.url.includes('psypher.ai/terms'));
  const psypherAiLegalEntity = startDateResults.find((r) => r.url.includes('Legal-Entities'));

  check('the genuine psypher.in result stays critical and flagged, no config needed',
    genuinePsypher?.tier === 'critical' && genuinePsypher?.flag != null,
    JSON.stringify({ tier: genuinePsypher?.tier, flag: genuinePsypher?.flag }));

  check('"Psypher AI" on tracxn.com is auto-detected and demoted, with zero excludeTerms set',
    psypherAiTracxn?.tier === 'weak' && psypherAiTracxn?.extensionWord === 'AI' && psypherAiTracxn?.flag == null,
    JSON.stringify({ tier: psypherAiTracxn?.tier, extensionWord: psypherAiTracxn?.extensionWord, flag: psypherAiTracxn?.flag }));

  check('the ToS page hosted directly on psypher.ai is caught via confusable domain',
    psypherAiTos?.confusableDomain === 'psypher.ai' && psypherAiTos?.tier !== 'critical',
    JSON.stringify({ confusableDomain: psypherAiTos?.confusableDomain, tier: psypherAiTos?.tier }));

  check('"PSYPHER AI PRIVATE LIMITED" (all-caps, different legal entity) is caught too',
    psypherAiLegalEntity?.extensionWord === 'AI', psypherAiLegalEntity?.extensionWord);

  await panel.waitForTimeout(400);
  check('the panel shows a "verify" badge naming the detected extension',
    (await panel.locator('.result-verify:has-text("also called")').count()) > 0,
    await panel.locator('.result-verify').first().textContent().catch(() => 'none'));

  // --- pre-flight ambiguity probe -----------------------------------------
  log('\n[pre-flight ambiguity probe]');
  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 10, maxDelayMs: 20, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000,
      preflightProbe: true, queryExclusions: true,
      highlightSerp: false, closeTabWhenDone: true, windowMode: 'current'
    }
  }));

  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  await panel.fill('#company', 'Psypher');
  await panel.fill('#website', 'psypher.in');
  await panel.fill('#excludeTerms', '');
  await panel.fill('#contextTerms', '');
  await panel.waitForTimeout(150);
  await panel.click('#selNone');
  await panel.check('#chk_entity\\.startdate');

  const probeRunDone = panel.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 40000);
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m.type === 'SX_RUN_DONE') { clearTimeout(timer); chrome.runtime.onMessage.removeListener(h); resolve(m.run); }
    });
  }));
  await panel.click('#startBtn');

  await panel.waitForSelector('#ambiguityDialog[open]', { timeout: 15000 });
  check('the probe stops the run and asks before spending the other queries',
    await panel.locator('#ambiguityDialog').isVisible());

  const ambigItems = await panel.locator('.ambig-item').count();
  check('both companies are offered', ambigItems === 2, `${ambigItems} clusters shown`);
  check('the target is marked, not offered for exclusion',
    (await panel.locator('.ambig-item.is-target').count()) === 1);
  const rivalText = await panel.locator('.ambig-item:not(.is-target)').first().textContent();
  check('the rival is named by the extra word in its name', /Psypher AI/.test(rivalText), rivalText.trim().slice(0, 60));
  check('the location discriminator is shown to the researcher', /Kochi/.test(rivalText));
  check('the rival is pre-ticked for exclusion',
    (await panel.locator('.ambig-item.is-rejected').count()) === 1);

  await panel.click('#ambiguityConfirm');
  const probeRun = await probeRunDone;
  check('the run continues once the researcher answers', !probeRun.timeout,
    probeRun.timeout ? 'timed out' : `${probeRun.queries.length} queries`);

  const storedEntity = await panel.evaluate(() => new Promise((resolve) =>
    chrome.storage.local.get('sx_entity', (r) => resolve(r.sx_entity))));
  check('the answer is remembered for this company, not just this run',
    (storedEntity.excludeTerms || []).includes('Psypher AI'), JSON.stringify(storedEntity.excludeTerms));

  check('the exclusion reaching Google is the rival\'s full name, not the bare word',
    probeRun.queries[0].query.includes('-"Psypher AI"') && !probeRun.queries[0].query.includes('-"AI"'),
    probeRun.queries[0].query.slice(-40));

  await panel.waitForTimeout(300);
  check('the panel form reflects the newly remembered exclusion',
    (await panel.inputValue('#excludeTerms')).includes('Psypher AI'), await panel.inputValue('#excludeTerms'));

  // An unambiguous name must not interrupt.
  log('\n[probe stays silent when the name is unambiguous]');
  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  await panel.fill('#company', 'Acme Robotics');
  await panel.fill('#website', 'acme.com');
  await panel.fill('#excludeTerms', '');
  await panel.waitForTimeout(150);
  await panel.click('#selNone');
  await panel.check('#chk_entity\\.startdate');

  const soloDone = panel.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 40000);
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m.type === 'SX_RUN_DONE') { clearTimeout(timer); chrome.runtime.onMessage.removeListener(h); resolve(m.run); }
    });
  }));
  await panel.click('#startBtn');
  const soloRun = await soloDone;
  check('an unambiguous company runs straight through with no dialog',
    !soloRun.timeout && !(await panel.locator('#ambiguityDialog').isVisible()),
    soloRun.timeout ? 'timed out' : 'completed silently');
  check('the probe still recorded what it found', (soloRun.probe?.clusters || []).length === 1,
    `${soloRun.probe?.clusters?.length} cluster(s)`);

  // --- reported: title/URL/snippet mismatch -------------------------------
  // Google sometimes wraps several results in one `div.g`. Picking the block
  // by class name then grabs the first cite and snippet inside it — a
  // different result's URL and text under this result's title, which is how a
  // link ends up opening something else entirely.
  log('\n[reported: each result keeps its own link and text]');
  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 10, maxDelayMs: 20, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000, preflightProbe: false,
      highlightSerp: false, closeTabWhenDone: true, windowMode: 'current'
    }
  }));
  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  await panel.fill('#company', 'nested-layout');
  await panel.fill('#website', 'psypher.in');
  await panel.fill('#excludeTerms', '');
  await panel.click('#selNone');
  await panel.check('#chk_oob\\.bankruptcy_us');

  const nestedDone = panel.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 40000);
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m.type === 'SX_RUN_DONE') { clearTimeout(timer); chrome.runtime.onMessage.removeListener(h); resolve(m.run); }
    });
  }));
  await panel.click('#startBtn');
  const nestedRun = await nestedDone;
  const nested = nestedRun.queries[0].results;

  check('all three results are extracted from the shared wrapper', nested.length === 3, `${nested.length}`);

  const byTitle = (frag) => nested.find((r) => r.title.includes(frag));
  const game = byTitle('RF ONLINE NEXT');
  const privacy = byTitle('Privacy Policy');
  const insta = byTitle('Instagram');

  check('the game page keeps its own URL, not a neighbour\'s',
    game?.url === 'https://rfonlinenext.github.io/biosuits/psypher', game?.url);
  check('the privacy page keeps its own URL',
    privacy?.url === 'https://www.psypher.in/policies/privacy-policy', privacy?.url);
  check('the Instagram result keeps its own URL',
    insta?.url === 'https://www.instagram.com/psypher.in', insta?.url);

  check('the displayed cite matches the link it sits under',
    game?.displayUrl === 'rfonlinenext.github.io' && privacy?.displayUrl === 'psypher.in',
    `${game?.displayUrl} / ${privacy?.displayUrl}`);
  check('each snippet belongs to its own result',
    game?.snippet.includes('invincibility') && privacy?.snippet.includes('merger or bankruptcy'),
    (game?.snippet || '').slice(0, 40));
  check('no result borrows another result\'s text',
    !game?.snippet.includes('merger or bankruptcy') && !privacy?.snippet.includes('invincibility'));

  check('the privacy page is no longer an out-of-business finding',
    privacy?.flag == null && privacy?.tier === 'weak',
    JSON.stringify({ tier: privacy?.tier, flag: privacy?.flag }));

  // --- identity confidence -------------------------------------------------
  log('\n[identity: domain beats name]');
  await panel.waitForTimeout(300);
  const idBadges = await panel.locator('.result-id').count();
  check('domain-confirmed results carry an identity badge', idBadges > 0, `${idBadges} badges`);

  const beforeId = await panel.locator('.result').count();
  await panel.check('#onlyIdentity');
  await panel.waitForTimeout(200);
  const afterId = await panel.locator('.result').count();
  check('the domain-confirmed filter narrows the list', afterId > 0 && afterId <= beforeId,
    `${beforeId} -> ${afterId}`);
  check('nothing without a domain match survives the filter',
    (await panel.locator('.result:not(:has(.result-id))').count()) === 0);
  await panel.uncheck('#onlyIdentity');

  // --- registry check: GLEIF + SEC EDGAR ------------------------------------
  log('\n[registry check: GLEIF + SEC EDGAR corroboration]');
  gleifFixture = { data: [{
    id: '5493009XYZLEI00001',
    attributes: {
      entity: {
        legalName: { name: 'Psypher Streetwear Private Limited' },
        legalAddress: { city: 'Delhi', country: 'IN' },
        status: 'ACTIVE',
        successorEntity: { leiRecordExists: false }
      },
      registration: { status: 'MERGED' }
    }
  }] };
  edgarFixture = { hits: { hits: [] } };
  openCorporatesFixture = { results: { companies: [{ company: { name: 'Some Unrelated Ltd', current_status: 'Active' } }] } };
  companiesHouseFixture = { items: [] };
  gleifCalls = 0; edgarCalls = 0; openCorporatesCalls = 0; companiesHouseCalls = 0;

  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 10, maxDelayMs: 20, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000,
      preflightProbe: false, registryCheck: true, queryExclusions: true,
      openCorporatesToken: '', companiesHouseKey: '',
      highlightSerp: false, closeTabWhenDone: true, windowMode: 'current'
    }
  }));
  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  await panel.fill('#company', 'Psypher');
  await panel.fill('#website', 'www.psypher.in');
  await panel.fill('#excludeTerms', '');
  await panel.click('#selNone');
  await panel.check('#chk_oob\\.bankruptcy_us');

  const registryRunDone = panel.evaluate(() => new Promise((resolve) => {
    chrome.runtime.onMessage.addListener(function h(m) { if (m.type === 'SX_RUN_DONE') { chrome.runtime.onMessage.removeListener(h); resolve(m.run); } });
  }));
  await panel.click('#startBtn');
  const registryRun = await registryRunDone;

  check('GLEIF, EDGAR and OpenCorporates all fired (keyless-capable); Companies House did not (no key set)',
    gleifCalls >= 1 && edgarCalls >= 1 && openCorporatesCalls >= 1 && companiesHouseCalls === 0,
    `gleif=${gleifCalls} edgar=${edgarCalls} oc=${openCorporatesCalls} ch=${companiesHouseCalls}`);
  check('the run carries a registry result', !!registryRun.registry, JSON.stringify(registryRun.registry));
  check('a MERGED GLEIF record is recognised as an out-of-business signal',
    registryRun.registry?.outOfBusiness === true, JSON.stringify(registryRun.registry?.gleif));
  check('the matched GLEIF record is the right company, not a stranger',
    registryRun.registry?.gleif?.records?.[0]?.legalName === 'Psypher Streetwear Private Limited');
  check('an unrelated OpenCorporates hit is filtered out by name matching',
    registryRun.registry?.openCorporates?.records?.length === 0, JSON.stringify(registryRun.registry?.openCorporates));
  check('Companies House is skipped outright with no key configured, not fired and ignored',
    registryRun.registry?.companiesHouse?.skipped === true);

  const bankruptcyHit = registryRun.queries[0].results.find((r) => r.url.includes('reuters.com'));
  check('the press hit itself still carries the bankruptcy flag', bankruptcyHit?.flag?.label === 'Out-of-business signal',
    JSON.stringify(bankruptcyHit?.flag));
  check('registry corroboration is named in that result\'s reasons',
    (bankruptcyHit?.reasons || []).some((r) => r.includes('registry')), (bankruptcyHit?.reasons || []).join(' | '));

  await panel.waitForTimeout(300);
  await panel.click('[data-tab="results"]');
  await panel.waitForTimeout(200);
  check('the registry check card is visible', await panel.locator('#registryCard').isVisible());
  const registryCardText = await panel.locator('#registryCard').textContent();
  check('the card names the matched legal entity',
    /Psypher Streetwear Private Limited/.test(registryCardText), registryCardText.trim().slice(0, 120));
  check('the card surfaces the inactive/merged registration status',
    /MERGED/.test(registryCardText), registryCardText.trim().slice(0, 200));
  check('the card says EDGAR found nothing, plainly — not as a red flag',
    /no sec filings found/i.test(registryCardText), registryCardText.trim());
  check('the card explains Companies House was skipped, not silently blank',
    /no api key configured/i.test(registryCardText), registryCardText.trim());

  // --- Companies House: only fires once a key is actually configured -------
  log('\n[registry check: Companies House only with a key configured]');
  companiesHouseFixture = { items: [{ title: 'Psypher Streetwear Ltd', company_number: '09999999', company_status: 'dissolved' }] };
  companiesHouseCalls = 0; companiesHouseAuthHeader = null;

  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 10, maxDelayMs: 20, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000,
      preflightProbe: false, registryCheck: true, queryExclusions: true,
      openCorporatesToken: '', companiesHouseKey: 'test-free-key',
      highlightSerp: false, closeTabWhenDone: true, windowMode: 'current'
    }
  }));
  await panel.click('[data-tab="run"]');
  await panel.waitForTimeout(150);
  await panel.click('#selNone');
  await panel.check('#chk_oob\\.bankruptcy_us');

  const chRunDone = panel.evaluate(() => new Promise((resolve) => {
    chrome.runtime.onMessage.addListener(function h(m) { if (m.type === 'SX_RUN_DONE') { chrome.runtime.onMessage.removeListener(h); resolve(m.run); } });
  }));
  await panel.click('#startBtn');
  const chRun = await chRunDone;

  check('Companies House is actually queried once a key is set', companiesHouseCalls >= 1);
  check('the key goes over as HTTP Basic auth, not exposed in the URL',
    /^Basic /.test(companiesHouseAuthHeader || ''), companiesHouseAuthHeader);
  check('a dissolved Companies House record is recognised as out-of-business',
    chRun.registry?.companiesHouse?.records?.[0]?.outOfBusiness === true,
    JSON.stringify(chRun.registry?.companiesHouse));
  check('Companies House is named among the corroborating sources',
    (chRun.registry?.outOfBusinessSources || []).includes('Companies House'), JSON.stringify(chRun.registry?.outOfBusinessSources));

  await panel.waitForTimeout(300);
  await panel.click('[data-tab="results"]');
  await panel.waitForTimeout(200);
  const chCardText = await panel.locator('#registryCard').textContent();
  check('the card shows the matched Companies House record',
    /Psypher Streetwear Ltd/.test(chCardText) && /dissolved/.test(chCardText), chCardText.trim().slice(0, 300));

  // Reset for the rest of the suite — a private non-UK, non-US company should
  // get nothing back from any of these registries the vast majority of the time.
  gleifFixture = { data: [] };
  edgarFixture = { hits: { hits: [] } };
  openCorporatesFixture = { results: { companies: [] } };
  companiesHouseFixture = { items: [] };

  // --- pause / resume ------------------------------------------------------
  log('\n[pause and resume]');
  await panel.evaluate(() => chrome.storage.local.set({
    sx_settings: {
      minDelayMs: 700, maxDelayMs: 900, longPauseEvery: 0, longPauseMs: 0,
      resultsPerQuery: 20, keepTopResults: 8, navTimeoutMs: 15000, preflightProbe: false,
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

  // --- options page --------------------------------------------------------
  // Not reachable from any other flow — the only way to catch this page
  // breaking (e.g. a stale CSS variable name after a panel.css rename that
  // options.html's own inline <style> still referenced) is to open it directly.
  log('\n[options page]');
  const optsPage = await context.newPage();
  const optsErrors = [];
  optsPage.on('pageerror', (e) => optsErrors.push(e.message));
  await optsPage.goto(`chrome-extension://${extId}/options/options.html`);
  await optsPage.waitForSelector('#minDelayMs');
  check('options page loads without script errors', optsErrors.length === 0, optsErrors.join(' | '));

  const bodyBg = await optsPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('shared panel.css actually resolved (background isn\'t transparent)',
    bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent', bodyBg);

  await optsPage.fill('#minDelayMs', '5000');
  await optsPage.click('#save');
  await optsPage.waitForTimeout(200);
  const savedSettings = await optsPage.evaluate(() => new Promise((resolve) =>
    chrome.storage.local.get('sx_settings', (r) => resolve(r.sx_settings))));
  check('a changed setting round-trips through storage', savedSettings?.minDelayMs === 5000, JSON.stringify(savedSettings));

  await optsPage.click('#reset');
  await optsPage.waitForTimeout(200);
  check('Restore defaults resets the field', (await optsPage.inputValue('#minDelayMs')) === '4000');
  await optsPage.close();

  log('\n[errors]');
  const real = errors.filter((e) => !/Could not establish connection|message port closed/i.test(e));
  check('no page or worker errors', real.length === 0, real.slice(0, 4).join(' | '));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
