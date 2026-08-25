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

// ── OpenCorporates (140+ jurisdictions, broadest geographic coverage) ────────

// Free without a key, but capped at 500 requests/month per requesting IP —
// that's the researcher's own connection, not shared across every ScraperX
// user, so it's usable for normal day-to-day volume. A researcher's own token
// (free tier or paid) raises that; entirely optional.
export function openCorporatesSearchUrl(company, apiToken) {
  const q = String(company || '').trim();
  if (!q) return '';
  const params = new URLSearchParams({ q, per_page: '10' });
  if (apiToken) params.set('api_token', apiToken);
  return `https://api.opencorporates.com/v0.4/companies/search?${params.toString()}`;
}

const OC_INACTIVE_STATUS_RE = /dissolved|struck.?off|liquidat|inactive|merged|amalgamat|withdrawn|revoked|terminat|no longer/i;

export function parseOpenCorporatesResponse(json) {
  const rows = json?.results?.companies;
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const c = row?.company;
    const name = String(c?.name || '').trim();
    if (!name) continue;
    const status = String(c?.current_status || '').trim();
    out.push({
      name,
      companyNumber: String(c?.company_number || ''),
      jurisdiction: String(c?.jurisdiction_code || ''),
      status,
      outOfBusiness: c?.inactive === true || !!c?.dissolution_date || OC_INACTIVE_STATUS_RE.test(status),
      url: String(c?.opencorporates_url || '')
    });
  }
  return out;
}

export function matchOpenCorporatesRecords(records, entity) {
  const wanted = nameTokens(entity?.company);
  if (!wanted.length) return [];
  return records
    .map((r) => {
      const got = new Set(nameTokens(r.name));
      return { ...r, matchRatio: wanted.filter((t) => got.has(t)).length / wanted.length };
    })
    .filter((r) => r.matchRatio >= 0.6)
    .sort((a, b) => b.matchRatio - a.matchRatio || Number(b.outOfBusiness) - Number(a.outOfBusiness));
}

export async function openCorporatesLookup(entity, apiToken, fetchImpl = fetch) {
  const url = openCorporatesSearchUrl(entity?.company, apiToken);
  if (!url) return { ok: false, source: 'OpenCorporates', records: [] };
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      // A 401/403 here almost always means the shared unauthenticated
      // allowance (500/month) is exhausted, not that anything is broken.
      const hint = res.status === 401 || res.status === 403 ? ' — likely the free monthly allowance is used up' : '';
      return { ok: false, source: 'OpenCorporates', records: [], error: `http ${res.status}${hint}` };
    }
    const json = await res.json();
    return { ok: true, source: 'OpenCorporates', records: matchOpenCorporatesRecords(parseOpenCorporatesResponse(json), entity) };
  } catch (e) {
    return { ok: false, source: 'OpenCorporates', records: [], error: e?.message || 'lookup failed' };
  }
}

// ── UK Companies House (free, but requires the researcher's own free key) ───

// Unlike GLEIF/EDGAR/OpenCorporates, this one 401s on every call with no key
// at all — there is no useful anonymous allowance to fall back to, so it is
// simply skipped rather than fired and left to fail.
export function companiesHouseSearchUrl(company) {
  const q = String(company || '').trim();
  if (!q) return '';
  return `https://api.company-information.service.gov.uk/search/companies?${new URLSearchParams({ q, items_per_page: '10' })}`;
}

const CH_INACTIVE_STATUS_RE = /^(?!active$).+/i; // anything other than exactly "active"

export function parseCompaniesHouseResponse(json) {
  const rows = Array.isArray(json?.items) ? json.items : [];
  const out = [];
  for (const row of rows) {
    const name = String(row?.title || '').trim();
    if (!name) continue;
    const status = String(row?.company_status || '').trim();
    out.push({
      name,
      companyNumber: String(row?.company_number || ''),
      status,
      outOfBusiness: !!status && CH_INACTIVE_STATUS_RE.test(status),
      url: row?.company_number ? `https://find-and-update.company-information.service.gov.uk/company/${row.company_number}` : ''
    });
  }
  return out;
}

export function matchCompaniesHouseRecords(records, entity) {
  const wanted = nameTokens(entity?.company);
  if (!wanted.length) return [];
  return records
    .map((r) => {
      const got = new Set(nameTokens(r.name));
      return { ...r, matchRatio: wanted.filter((t) => got.has(t)).length / wanted.length };
    })
    .filter((r) => r.matchRatio >= 0.6)
    .sort((a, b) => b.matchRatio - a.matchRatio || Number(b.outOfBusiness) - Number(a.outOfBusiness));
}

export async function companiesHouseLookup(entity, apiKey, fetchImpl = fetch) {
  if (!apiKey) return { ok: false, source: 'Companies House', records: [], skipped: true };
  const url = companiesHouseSearchUrl(entity?.company);
  if (!url) return { ok: false, source: 'Companies House', records: [] };
  try {
    // HTTP Basic auth, key as username, blank password — the documented
    // scheme for this API. btoa is available in the extension service worker.
    const res = await fetchImpl(url, { headers: { Authorization: `Basic ${btoa(`${apiKey}:`)}`, Accept: 'application/json' } });
    if (!res.ok) return { ok: false, source: 'Companies House', records: [], error: `http ${res.status}` };
    const json = await res.json();
    return { ok: true, source: 'Companies House', records: matchCompaniesHouseRecords(parseCompaniesHouseResponse(json), entity) };
  } catch (e) {
    return { ok: false, source: 'Companies House', records: [], error: e?.message || 'lookup failed' };
  }
}

// ── combined run-once-per-run check ──────────────────────────────────────────

/**
 * Every lookup, combined into the one thing scoring actually needs: is there
 * registry-level corroboration that this company is out of business? Never
 * throws — a failure on any one source just means that source contributes
 * nothing. `opts.openCorporatesToken` and `opts.companiesHouseKey` are the
 * researcher's own, optional; Companies House is skipped outright without one.
 */
export async function checkRegistries(entity, opts = {}, fetchImpl = fetch) {
  const [gleif, edgar, openCorporates, companiesHouse] = await Promise.all([
    gleifLookup(entity, fetchImpl),
    secEdgarLookup(entity, fetchImpl),
    openCorporatesLookup(entity, opts.openCorporatesToken, fetchImpl),
    companiesHouseLookup(entity, opts.companiesHouseKey, fetchImpl)
  ]);

  const outOfBusinessSources = [];
  if (gleif.records.some((r) => r.outOfBusiness)) outOfBusinessSources.push('GLEIF');
  if (edgar.hits.some((h) => h.isMaterialEvent)) outOfBusinessSources.push('SEC EDGAR');
  if (openCorporates.records.some((r) => r.outOfBusiness)) outOfBusinessSources.push('OpenCorporates');
  if (companiesHouse.records.some((r) => r.outOfBusiness)) outOfBusinessSources.push('Companies House');

  return {
    gleif, edgar, openCorporates, companiesHouse,
    outOfBusiness: outOfBusinessSources.length > 0,
    outOfBusinessSources,
    checkedAt: Date.now()
  };
}
