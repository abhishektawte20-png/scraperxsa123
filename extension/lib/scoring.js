/**
 * Ranks a SERP result for a given boolean.
 *
 * The point is the thing the researchers do by eye: out of twenty blue links,
 * which two or three actually say something about *this* company that belongs
 * on the profile. We score on four axes and expose the reasons so the panel can
 * show its working rather than an unexplained number.
 */

const SOCIAL = [
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'youtube.com', 'tiktok.com'
];

const PRESS = [
  'prnewswire.com', 'businesswire.com', 'globenewswire.com', 'newswire.com',
  'accesswire.com', 'einpresswire.com', 'prweb.com'
];

const AGGREGATOR = [
  'pitchbook.com', 'crunchbase.com', 'zoominfo.com', 'owler.com', 'dnb.com',
  'dandb.com', 'manta.com', 'hoovers.com', 'bloomberg.com', 'brightscope.com',
  'usbizplace.com', 'credibility.com', 'findusabusiness.com', 'yelp.com',
  'glassdoor.com', 'indeed.com', 'apollo.io', 'rocketreach.co', 'signalhire.com',
  'leadiq.com', 'growjo.com', 'buzzfile.com'
];

const REGISTRY = [
  'sec.gov', 'sba.gov', 'usaspending.gov', 'grants.gov', 'gov.uk',
  'companieshouse.gov.uk', 'opencorporates.com', 'bizapedia.com',
  'sam.gov', 'justia.com', 'courtlistener.com', 'pacermonitor.com'
];

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } };
const inList = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

export function classifyDomain(url, entityDomain) {
  const host = hostOf(url);
  if (!host) return 'other';
  if (entityDomain && (host === entityDomain || host.endsWith(`.${entityDomain}`))) return 'official';
  if (inList(host, SOCIAL)) return 'social';
  if (inList(host, PRESS)) return 'press';
  if (inList(host, REGISTRY)) return 'registry';
  if (inList(host, AGGREGATOR)) return 'aggregator';
  return 'other';
}

const DOMAIN_WEIGHT = {
  official: 30,
  registry: 26,
  press: 22,
  social: 18,
  other: 10,
  aggregator: 2
};

/** Escape a term for use inside a RegExp. */
export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-ish boundary matching. Plain \b breaks on terms like "ch. 11" and "L&L",
 * so we bound on non-word characters ourselves and allow flexible whitespace.
 */
export function termRegex(term) {
  const body = escapeRe(String(term).trim()).replace(/\\?\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${body})(?=$|[^\\p{L}\\p{N}])`, 'giu');
}

export function findTerms(text, terms) {
  const hay = String(text || '');
  const hits = [];
  for (const term of terms || []) {
    if (!term || String(term).length < 2) continue;
    if (termRegex(term).test(hay)) hits.push(term);
  }
  return hits;
}

/** Tokens of the company name that are distinctive enough to match on. */
const STOPWORDS = new Set([
  'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'company', 'co', 'the',
  'and', 'of', 'group', 'holdings', 'plc', 'gmbh', 'sa', 'bv', 'ag', 'pvt',
  'private', 'management', 'services', 'solutions', 'international', 'global'
]);

export function nameTokens(company) {
  return String(company || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}&]+/u)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Parse the "5 Jan 2024 — " date Google prefixes on many snippets. */
export function parseSnippetDate(snippet) {
  const m = String(snippet || '').match(
    /^\s*(\d{1,2}\s+\w{3,9}\s+\d{4}|\w{3,9}\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})\s*[—–-]/
  );
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * @param {{title:string,url:string,snippet:string}} result
 * @param {{signals:string[], entitySignals:string[], company:string, entityDomain:string}} ctx
 */
export function scoreResult(result, ctx) {
  const haystack = `${result.title || ''} \n ${result.snippet || ''}`;
  const reasons = [];
  const domainClass = classifyDomain(result.url, ctx.entityDomain);

  // 1. Is this result about the right company at all?
  const entityHits = findTerms(haystack, ctx.entitySignals || []);
  const tokens = nameTokens(ctx.company);
  const tokenHits = tokens.filter((t) => termRegex(t).test(haystack));
  const urlHasDomain = ctx.entityDomain && String(result.url || '').toLowerCase().includes(ctx.entityDomain);

  let entityScore = 0;
  if (entityHits.length) { entityScore = 34; reasons.push('names the company or its site'); }
  else if (tokens.length && tokenHits.length === tokens.length) { entityScore = 26; reasons.push('all name tokens present'); }
  else if (tokenHits.length) { entityScore = 12 * (tokenHits.length / tokens.length); reasons.push('partial name match'); }
  if (urlHasDomain) { entityScore += 10; reasons.push('company domain in URL'); }
  // A page served from the company's own domain is about the company by
  // definition, whatever its <title> happens to say.
  if (domainClass === 'official' && entityScore < 34) {
    entityScore = 34;
    if (!reasons.includes('company domain in URL')) reasons.push('on the company website');
  }

  // 2. Does it carry the signal the boolean was looking for?
  const contentSignals = (ctx.signals || []).filter(
    (s) => !(ctx.entitySignals || []).some((e) => String(e).toLowerCase() === String(s).toLowerCase())
  );
  const signalHits = findTerms(haystack, contentSignals);
  const signalScore = Math.min(30, signalHits.length * 12);
  if (signalHits.length) reasons.push(`signal: ${signalHits.slice(0, 3).join(', ')}`);

  // 3. How much do we trust the source?
  const domainScore = DOMAIN_WEIGHT[domainClass] ?? 10;
  reasons.push(`source: ${domainClass}`);

  // 4. Recency — a 2011 funding note is not the current picture.
  const date = parseSnippetDate(result.snippet);
  let recencyScore = 0;
  if (date) {
    const years = (Date.now() - new Date(date).getTime()) / (365.25 * 24 * 3600 * 1000);
    recencyScore = years <= 1 ? 12 : years <= 3 ? 8 : years <= 6 ? 4 : 0;
    reasons.push(`dated ${date}`);
  }

  const score = Math.round(entityScore + signalScore + domainScore + recencyScore);
  const tier = score >= 70 ? 'critical' : score >= 45 ? 'strong' : score >= 25 ? 'weak' : 'noise';

  return {
    score,
    tier,
    domainClass,
    date,
    entityHits: entityHits.length ? entityHits : tokenHits,
    signalHits,
    reasons,
    // Everything worth painting yellow on the page.
    highlightTerms: [...new Set([...(entityHits.length ? entityHits : tokenHits), ...signalHits])]
  };
}

export const TIER_RANK = { critical: 3, strong: 2, weak: 1, noise: 0 };
