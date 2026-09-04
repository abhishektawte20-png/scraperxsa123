/**
 * Pre-flight ambiguity probe.
 *
 * Running sixteen booleans against a name that turns out to match two different
 * companies contaminates all sixteen. One cheap query on the bare name, before
 * any of them, tells us whether that is about to happen — and if it is, the
 * researcher can settle it once instead of judging the same collision over and
 * over in every category.
 *
 * Deliberately silent in the common case: a name that resolves to a single
 * company adds one query and no interruption.
 */

import { bareDomain, googleUrl } from './query.js';
import { detectNameExtension, findConfusableDomainMention, termRegex } from './scoring.js';

/** The probe is the bare name — no signal terms, no site filters. */
export function probeQuery(entity) {
  const name = String(entity.company || '').trim();
  return name ? `"${name}"` : '';
}

export function probeUrl(entity, opts = {}) {
  const q = probeQuery(entity);
  return q ? googleUrl(q, { num: opts.num || 20, hl: opts.hl || 'en', country: opts.country }) : '';
}

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
};

/**
 * "headquartered in Kochi", "based in Delhi" — a cheap locality fingerprint.
 *
 * A place word deliberately cannot *end* in a period: otherwise "based in
 * Delhi. Psypher released…" reads "Delhi. Psypher" as one two-word city.
 * Leading abbreviations are allowed separately so "St. Louis" still works.
 */
const PLACE_WORD = "[A-Z][A-Za-z'-]+";
const PLACE_ABBREV = "[A-Z][A-Za-z]{0,2}\\.";
const PLACE_RE = new RegExp(
  `\\b(?:headquartered in|based in|located in|head ?office in|offices? in)\\s+` +
  `((?:${PLACE_ABBREV}\\s+)?${PLACE_WORD}(?:\\s+${PLACE_WORD})?)`,
  'g'
);

export function extractPlaces(text) {
  const out = [];
  for (const m of String(text || '').matchAll(PLACE_RE)) {
    // The character class has to allow interior punctuation for "St. Louis",
    // which also lets a sentence-ending period in — "Delhi." and "Delhi" would
    // otherwise show up as two different cities.
    const place = m[1].trim().replace(/[.,;:]+$/, '').trim();
    if (place && !out.some((p) => p.toLowerCase() === place.toLowerCase())) out.push(place);
  }
  return out;
}

/**
 * Sort probe results into candidate companies.
 *
 * The signature of "a different company sharing this name" is the same pair of
 * shapes the scorer already looks for — the name carrying an extra word
 * ("Psypher AI"), or a domain sharing the brand root but not the domain
 * ("psypher.ai" against a target on "psypher.in"). Anything showing neither is
 * assumed to be the target.
 */
export function clusterProbeResults(results, entity) {
  const entityDomain = bareDomain(entity.website);
  const knownWords = new Set(
    [entity.company, ...(entity.aliases || [])]
      .flatMap((s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u))
      .filter(Boolean)
  );
  const nameTerms = [entity.company, ...(entity.aliases || [])].filter(Boolean);

  const clusters = new Map();
  const add = (key, label, kind, marker, r, place) => {
    if (!clusters.has(key)) {
      clusters.set(key, { key, label, kind, marker, count: 0, samples: [], places: [], domains: [] });
    }
    const c = clusters.get(key);
    c.count += 1;
    if (c.samples.length < 3) c.samples.push({ title: r.title, url: r.url });
    const host = hostOf(r.url);
    if (host && !c.domains.includes(host)) c.domains.push(host);
    if (place && !c.places.includes(place)) c.places.push(place);
  };

  for (const r of results || []) {
    const text = `${r.title || ''} \n ${r.snippet || ''}`;
    const place = extractPlaces(text)[0] || null;
    const host = hostOf(r.url);

    // A page on the target's own domain settles it — always the target.
    if (entityDomain && (host === entityDomain || host.endsWith(`.${entityDomain}`))) {
      add('__target__', entity.company, 'target', null, r, place);
      continue;
    }

    const confusable = (entityDomain && host && host !== entityDomain && host.split('.')[0] === entityDomain.split('.')[0])
      ? host
      : findConfusableDomainMention(text, entityDomain);

    let extension = null;
    for (const term of nameTerms) {
      if (!termRegex(term).test(text)) continue;
      extension = detectNameExtension(text, term, knownWords);
      if (extension) break;
    }

    if (extension) {
      add(`ext:${extension.toLowerCase()}`, `${entity.company} ${extension}`, 'extension', extension, r, place);
    } else if (confusable) {
      add(`dom:${confusable}`, confusable, 'domain', confusable, r, place);
    } else {
      add('__target__', entity.company, 'target', null, r, place);
    }
  }

  return [...clusters.values()].sort((a, b) => {
    if (a.kind === 'target') return -1;
    if (b.kind === 'target') return 1;
    return b.count - a.count;
  });
}

/**
 * Is this worth interrupting the researcher for? Only when a rival cluster is
 * substantial enough to be a real company rather than one stray mention.
 */
export function isAmbiguous(clusters, opts = {}) {
  const minRivalHits = opts.minRivalHits ?? 2;
  return clusters.filter((c) => c.kind !== 'target' && c.count >= minRivalHits).length > 0;
}

/**
 * The exclude terms implied by the clusters the researcher marked "not us".
 *
 * Deliberately the rival's *full* name ("Psypher AI"), not the distinguishing
 * word alone ("AI"). These terms go into the Google query as -"term", and
 * -"AI" would throw away every page that so much as mentions AI, including
 * ones genuinely about the target. The full phrase excludes only the other
 * company, and is the more precise thing to match on when scoring too.
 */
export function exclusionsFromClusters(clusters, rejectedKeys) {
  const out = [];
  for (const c of clusters || []) {
    if (!rejectedKeys.includes(c.key)) continue;
    const term = c.kind === 'extension' ? c.label : c.marker;
    if (term && !out.some((t) => t.toLowerCase() === term.toLowerCase())) out.push(term);
  }
  return out;
}
