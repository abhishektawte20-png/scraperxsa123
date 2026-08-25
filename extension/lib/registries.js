/**
 * Optional corroboration from two free, public, official registries — neither
 * one is a search engine, so neither can replace the boolean runs. What they
 * add is a source Google-scraping can never give: a *government/industry
 * registry's own record* of whether this legal entity is active, merged, or
 * retired, and (for US filers) the SEC's own list of filings mentioning it.
 *
 * Coverage is narrow by design, not by bug: GLEIF only has entities that hold
 * a Legal Entity Identifier (mostly ones that touch banks, securities or
 * derivatives); SEC EDGAR only has US filers. A small private company with no
 * US listing and no LEI — most of them — will come back empty from both, and
 * that emptiness means nothing either way. Never treat "not found" as a
 * negative signal.
 *
 * Both are plain `fetch()` JSON calls — no page to scrape, no tab to drive.
 * Every parse step is defensive: an unexpected response shape degrades to "no
 * match" rather than throwing, since this sandbox's network policy blocks
 * both api.gleif.org and efts.sec.gov, the same way it blocks google.com, so
 * the exact live response shape could not be round-tripped here. The URL
 * building and parsing below is verified against the two APIs' published
 * documentation instead — run a real company through it once to confirm.
 */

import { nameTokens } from './scoring.js';

// ── GLEIF (Legal Entity Identifier index) ────────────────────────────────────

export function gleifSearchUrl(company) {
  const q = String(company || '').trim();
  if (!q) return '';
  const params = new URLSearchParams({ 'filter[fulltext]': q, 'page[size]': '10' });
  return `https://api.gleif.org/api/v1/lei-records?${params.toString()}`;
}

// A record whose registration has lapsed, or whose entity itself has merged
// into / been absorbed by another, is the registry's own confirmation of an
// out-of-business-shaped event — independent of anything a web page says.
const OUT_OF_BUSINESS_REG_STATUS = new Set(['MERGED', 'RETIRED', 'ANNULLED', 'DUPLICATE']);

/** JSON:API `data[]` rows -> flat records. Missing/odd fields fall out as ''. */
export function parseGleifResponse(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  const out = [];
  for (const row of rows) {
    const a = row?.attributes || {};
    const entity = a.entity || {};
    const legalName = String(entity.legalName?.name || '').trim();
    if (!legalName) continue;
    const addr = entity.legalAddress || entity.headquartersAddress || {};
    const entityStatus = String(entity.status || '').toUpperCase();
    const registrationStatus = String(a.registration?.status || '').toUpperCase();
    out.push({
      lei: String(row?.id || a.lei || ''),
      legalName,
      country: String(addr.country || ''),
      city: String(addr.city || ''),
      entityStatus,
      registrationStatus,
      outOfBusiness: entityStatus === 'INACTIVE' || OUT_OF_BUSINESS_REG_STATUS.has(registrationStatus),
      successorName: entity.successorEntity?.leiRecordExists ? String(entity.successorEntity?.legalName?.name || '') : ''
    });
  }
  return out;
}

/**
 * `filter[fulltext]` is deliberately loose (it matches name variants, trade
 * names, transliterations) — this is the precision half: keep only records
 * whose legal name shares most of this company's distinctive name tokens, so
 * "Apex Systems" doesn't get credited to an unrelated "Apex Trading Ltd".
 */
export function matchGleifRecords(records, entity) {
  const wanted = nameTokens(entity?.company);
  if (!wanted.length) return [];
  const wantedSet = new Set(wanted);
  return records
    .map((r) => {
      const got = new Set(nameTokens(r.legalName));
      const overlap = wanted.filter((t) => got.has(t)).length;
      return { ...r, matchRatio: overlap / wanted.length };
    })
    .filter((r) => r.matchRatio >= 0.6)
    .sort((a, b) => b.matchRatio - a.matchRatio || Number(b.outOfBusiness) - Number(a.outOfBusiness));
}

export async function gleifLookup(entity, fetchImpl = fetch) {
  const url = gleifSearchUrl(entity?.company);
  if (!url) return { ok: false, source: 'GLEIF', records: [] };
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/vnd.api+json' } });
    if (!res.ok) return { ok: false, source: 'GLEIF', records: [], error: `http ${res.status}` };
    const json = await res.json();
    return { ok: true, source: 'GLEIF', records: matchGleifRecords(parseGleifResponse(json), entity) };
  } catch (e) {
    return { ok: false, source: 'GLEIF', records: [], error: e?.message || 'lookup failed' };
  }
}

// ── SEC EDGAR full-text search (US filers only) ──────────────────────────────

export function secEdgarSearchUrl(company, opts = {}) {
  const q = String(company || '').trim();
  if (!q) return '';
  const params = new URLSearchParams({ q: `"${q}"` });
  if (opts.forms) params.set('forms', opts.forms);
  return `https://efts.sec.gov/LATEST/search-index?${params.toString()}`;
}

// An 8-K is filed for a material corporate event — bankruptcy among them, but
// also plenty of things that aren't. It's a "go read this" pointer for the
// researcher, not an automated bankruptcy detector.
const MATERIAL_EVENT_FORM_RE = /^8-K/i;

function edgarFilingUrl(cik, adsh) {
  if (!cik || !adsh) return '';
  const cikNum = String(cik).replace(/^0+/, '') || '0';
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${adsh.replace(/-/g, '')}/${adsh}-index.htm`;
}

/** Elasticsearch-shaped `hits.hits[]` -> flat filing records. */
export function parseSecEdgarResponse(json) {
  const hits = Array.isArray(json?.hits?.hits) ? json.hits.hits : [];
  const out = [];
  for (const h of hits) {
    const s = h?._source || {};
    const form = String(s.form || s.root_form || '').trim();
    const adsh = String(s.adsh || '').trim();
    if (!form && !adsh) continue;
    const cik = Array.isArray(s.ciks) ? s.ciks[0] : s.ciks;
    out.push({
      companyNames: Array.isArray(s.display_names) ? s.display_names.map(String) : [],
      form,
      fileDate: String(s.file_date || ''),
      accessionNo: adsh,
      isMaterialEvent: MATERIAL_EVENT_FORM_RE.test(form),
      url: edgarFilingUrl(cik, adsh)
    });
  }
  return out;
}

export function matchSecEdgarHits(hits, entity) {
  const wanted = nameTokens(entity?.company);
  if (!wanted.length) return [];
  return hits.filter((h) => h.companyNames.some((n) => {
    const got = new Set(nameTokens(n));
    return wanted.filter((t) => got.has(t)).length / wanted.length >= 0.6;
  }));
}

export async function secEdgarLookup(entity, fetchImpl = fetch) {
  const url = secEdgarSearchUrl(entity?.company);
  if (!url) return { ok: false, source: 'SEC EDGAR', hits: [] };
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, source: 'SEC EDGAR', hits: [], error: `http ${res.status}` };
    const json = await res.json();
    return { ok: true, source: 'SEC EDGAR', hits: matchSecEdgarHits(parseSecEdgarResponse(json), entity) };
  } catch (e) {
    return { ok: false, source: 'SEC EDGAR', hits: [], error: e?.message || 'lookup failed' };
  }
}

// ── combined run-once-per-run check ──────────────────────────────────────────

/**
 * Both lookups, combined into the one thing scoring actually needs: is there
 * registry-level corroboration that this company is out of business (merged,
 * retired LEI registration, or a material-event 8-K on file)? Never throws —
 * a network failure on either just means that source contributes nothing.
 */
export async function checkRegistries(entity, fetchImpl = fetch) {
  const [gleif, edgar] = await Promise.all([
    gleifLookup(entity, fetchImpl),
    secEdgarLookup(entity, fetchImpl)
  ]);
  const outOfBusiness = gleif.records.some((r) => r.outOfBusiness) || edgar.hits.some((h) => h.isMaterialEvent);
  return { gleif, edgar, outOfBusiness, checkedAt: Date.now() };
}
