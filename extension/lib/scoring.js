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

/**
 * What it means for a result to actually confirm the thing a boolean went
 * looking for: the company's own name AND one of the boolean's target
 * phrases showing up together, from a source credible enough to cite. A
 * "General Financing" hit that only matches the company name is just a
 * mention; one that also matches "raised" from a press source is the
 * researcher's answer — flag it as such rather than leaving it as an
 * unlabeled number.
 */
const CATEGORY_FLAG = {
  'Prior Backing': { label: 'Investor backing detected', icon: '\u{1F4B0}' },
  'Entity Recognition': { label: 'Entity confirmed', icon: '\u{1F4CB}' },
  'SMI': { label: 'Social profile confirmed', icon: '\u{1F517}' },
  'Site Search': { label: 'HQ / site confirmed', icon: '\u{1F3E2}' },
  'Management': { label: 'Management named', icon: '\u{1F464}' },
  'Service Providers': { label: 'Service provider named', icon: '\u{1F91D}' },
  'Out of Business': { label: 'Out-of-business signal', icon: '\u{26A0}\u{FE0F}' },
  'Spin Out (USO)': { label: 'Spin-out signal', icon: '\u{1F500}' },
  'Boolean Backup': { label: 'Figure mentioned', icon: '\u{1F4CA}' }
};
const DEFAULT_FLAG = { label: 'Company + signal match', icon: '\u{2705}' };

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

// "has not raised any funding yet" contains "raised" — a plain substring/word
// match calls that a hit. Look at the words right before a match for a
// negation cue before counting it as a real one.
const NEGATION_RE = /\b(not|never|no|n['’]t|without|denies|denied|rules? out|ruled out|yet to|fails? to|failed to|unable to|nor|neither)\b/i;
const NEGATION_WINDOW = 60;

/**
 * Like findTerms, but reports whether each hit sits behind a negation in the
 * text immediately before it — "raised" in "has not raised" doesn't confirm
 * backing, it's evidence against it. Only the first occurrence of each term
 * is inspected, matching findTerms' one-hit-per-term semantics.
 */
export function findSignalMatches(text, terms) {
  const hay = String(text || '');
  const out = [];
  for (const term of terms || []) {
    if (!term || String(term).length < 2) continue;
    const m = termRegex(term).exec(hay);
    if (!m) continue;
    const matchStart = m.index + m[1].length;
    const before = hay.slice(Math.max(0, matchStart - NEGATION_WINDOW), matchStart);
    out.push({ term, negated: NEGATION_RE.test(before) });
  }
  return out;
}

/**
 * Blanks out every mention of the entity's own name/website/aliases in a
 * copy of the text. Confirming context for an ambiguous signal word ("Capital",
 * "Ventures", "Partners") is meant to come from somewhere else in the result —
 * a company literally named "XYZ Capital" would otherwise confirm its own
 * "raises" every time, just by being mentioned, which defeats the check.
 */
export function stripEntityMentions(text, entitySignals) {
  let out = String(text || '');
  for (const term of entitySignals || []) {
    if (!term || String(term).length < 2) continue;
    out = out.replace(termRegex(term), (_full, pre) => pre);
  }
  return out;
}

// A ToS/privacy page's boilerplate ("...you grant us a license...") makes
// ordinary words like "grant" or "acquired" look like hits for booleans they
// have nothing to do with. Out of Business > Legal Name is the one boolean
// that's deliberately searching these pages — everyone else should discount
// a signal match found there rather than take it at face value.
const LEGAL_PAGE_URL_RE = /\/(terms(-of-(use|service))?|privacy(-policy)?|cookies?|legal|eula|tos)(\/|$|[?#])/i;
const LEGAL_PAGE_TITLE_RE = /\b(terms of (service|use)|privacy (policy|notice)|cookie policy|legal notice|end[\s-]user license)\b/i;

export function isLegalBoilerplatePage(url, title) {
  return LEGAL_PAGE_URL_RE.test(String(url || '')) || LEGAL_PAGE_TITLE_RE.test(String(title || ''));
}

/**
 * A matched word can be technically "found" while meaning something else
 * entirely: "raises" shows up in "raises awareness" and "raises three kids"
 * about as often as in a funding round; "acquired" shows up in "acquired a
 * taste for" as readily as in an M&A deal. Matching the word isn't matching
 * the boolean's actual question. These are the bare, ambiguous signal terms
 * per category and the context that has to appear alongside one before it
 * counts as the sense the boolean meant — deliberately excluding the more
 * specific phrases already in the same boolean ("received funding", "SBIR",
 * "acquisition"), since those already carry their own meaning unambiguously.
 */
const AMBIGUOUS_SENSE = {
  'Prior Backing': {
    terms: new Set(['raises', 'raised', 'received', 'won', 'grant']),
    confirm: /(\$|€|£|₹|\bmillion\b|\bbillion\b|\bfunding\b|\bfinanc(?:e|ed|ing)\b|\binvestors?\b|\binvestments?\b|\bcapital\b|\bventure\b|\bseed\b|\bseries [a-z]\b|\bbacked\b|\bequity\b|\bvaluation\b|\bsbir\b|\bsbic\b)/i,
    topic: 'financing'
  },
  'Out of Business': {
    terms: new Set(['acquired', 'merged', 'purchased', 'placement']),
    confirm: /(\$|€|£|₹|\bmillion\b|\bbillion\b|\bdeal\b|\btransaction\b|\bstake\b|\bshares?\b|\bbuyout\b|\blbo\b|\bprivate equity\b)/i,
    topic: 'a deal'
  },
  // "the chief among these problems" and "the city's new police chief" both
  // match "chief"; "time management" and "risk management" both match
  // "management". None of them say anything about this company's leadership.
  // Confirm words are deliberately narrow: generic ones like "corp" or
  // "firm" match plenty of real company names outright ("Acme Corp") and
  // would confirm every bare "chief"/"legal" hit regardless of sense —
  // exactly the bug this mechanism exists to catch.
  'Management': {
    terms: new Set(['chief', 'president', 'management']),
    confirm: /\b(ceo|coo|cfo|cto|co-founder|appointed|joins as|joined as|promoted to|board of directors|executive team|leadership team|named as)\b/i,
    topic: 'a corporate leadership role'
  },
  // "is this legal in my state" and "I'd advise against it" both match —
  // neither is a law firm or an advisory engagement.
  'Service Providers': {
    terms: new Set(['advise', 'advised', 'legal']),
    confirm: /\b(counsel|attorney|law firm|llp|represented by|legal team|general counsel|outside counsel|advisor|advisers?|consultant)\b/i,
    topic: 'a professional services engagement'
  },
  // "employee turnover" and "hotel bookings" both match; neither is revenue.
  'Boolean Backup': {
    terms: new Set(['turnover', 'bookings']),
    confirm: /(\$|€|£|₹|\brevenue\b|\bsales\b|\bmillion\b|\bbillion\b|\bannual\b|\bfiscal\b|\bfy\s?\d{2,4}\b|\bgenerated\b)/i,
    topic: 'revenue figures'
  }
};

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
 * @param {{signals:string[], entitySignals:string[], company:string, entityDomain:string,
 *          category?:string, excludeTerms?:string[], contextTerms?:string[]}} ctx
 *
 * `excludeTerms` and `contextTerms` are the researcher's own disambiguation:
 * a short or common company name ("Psypher") collides with unrelated
 * companies that happen to share it ("Psypher Interactive"), and no amount
 * of text matching alone can tell them apart — only the researcher knows
 * "Interactive" means it's not us, or that our company is always described
 * as "AI" / "healthcare". Both are optional and opt-in; leaving them unset
 * reproduces the old behavior exactly.
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

  // 1b. Name collision guard. The name matched, but does the text also carry
  // a term the researcher said means "that's a different company"? A page on
  // the company's own domain is exempt — the domain already settles identity.
  const collisionHits = domainClass === 'official' ? [] : findTerms(haystack, ctx.excludeTerms || []);
  const isCollision = entityScore > 0 && collisionHits.length > 0;
  if (isCollision) reasons.push(`possible different company — also mentions "${collisionHits[0]}"`);

  // 1c. Context guard. If the researcher gave distinguishing context terms
  // (industry, sector — whatever the name alone doesn't convey) and the name
  // matched but none of that context showed up, it's worth a second look
  // rather than a confident "critical".
  const hasContextConfig = (ctx.contextTerms || []).length > 0;
  const contextHits = hasContextConfig ? findTerms(haystack, ctx.contextTerms) : [];
  const contextMismatch = !isCollision && hasContextConfig && entityScore > 0 && contextHits.length === 0;
  if (contextMismatch) reasons.push('name matched but none of the expected context found — verify');

  if (isCollision) entityScore = Math.min(entityScore, 6);
  else if (contextMismatch) entityScore = Math.round(entityScore * 0.5);

  // 2. Does it carry the signal the boolean was looking for? A match sitting
  // right behind "not"/"never"/etc. is evidence against the signal, not for
  // it — don't count it, but say so rather than silently dropping it.
  const contentSignals = (ctx.signals || []).filter(
    (s) => !(ctx.entitySignals || []).some((e) => String(e).toLowerCase() === String(s).toLowerCase())
  );
  const signalMatches = findSignalMatches(haystack, contentSignals);
  const onLegalPage = ctx.category !== 'Out of Business' && isLegalBoilerplatePage(result.url, result.title);
  const negatedHits = signalMatches.filter((m) => m.negated).map((m) => m.term);
  const positiveMatches = onLegalPage ? [] : signalMatches.filter((m) => !m.negated);

  // Split out matches that only found the word, not the sense: a bare
  // "raises"/"acquired" with no money- or deal-shaped context nearby doesn't
  // answer what this boolean actually asked.
  const sense = AMBIGUOUS_SENSE[ctx.category];
  const confirmHaystack = sense ? stripEntityMentions(haystack, ctx.entitySignals) : haystack;
  const ambiguousHits = [];
  const signalHits = [];
  for (const m of positiveMatches) {
    if (sense && sense.terms.has(m.term.toLowerCase()) && !sense.confirm.test(confirmHaystack)) ambiguousHits.push(m.term);
    else signalHits.push(m.term);
  }

  const signalScore = Math.min(30, signalHits.length * 12);
  if (signalHits.length) reasons.push(`signal: ${signalHits.slice(0, 3).join(', ')}`);
  if (onLegalPage && signalMatches.length) reasons.push('on a terms/privacy page — generic wording, not counted');
  else if (negatedHits.length) reasons.push(`note: "${negatedHits[0]}" appears negated — not counted`);
  if (ambiguousHits.length) {
    reasons.push(`note: "${ambiguousHits[0]}" found but nothing nearby suggests ${sense.topic} — may be a different sense of the word`);
  }

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

  let score = Math.round(entityScore + signalScore + domainScore + recencyScore);
  let tier = score >= 70 ? 'critical' : score >= 45 ? 'strong' : score >= 25 ? 'weak' : 'noise';

  // A collision hit is noise by definition, whatever the raw arithmetic says;
  // a context mismatch is downgraded, not dismissed, since the researcher
  // might just not have listed every context term.
  if (isCollision) { tier = 'noise'; score = Math.min(score, 15); }
  else if (contextMismatch && (tier === 'critical' || tier === 'strong')) { tier = 'weak'; score = Math.min(score, 44); }

  // The finding, named: the company is confirmed present AND the boolean's
  // own target phrase showed up, from a source that isn't a bought-data
  // aggregator. This is the line between "Google returned something" and
  // "we found what we were looking for."
  const namesCompany = entityHits.length > 0 || (tokens.length > 0 && tokenHits.length === tokens.length);
  const hasSignal = signalHits.length > 0;
  const credibleSource = domainClass !== 'aggregator';
  let flag = null;
  if (namesCompany && hasSignal && credibleSource && !isCollision) {
    const spec = (ctx.category && CATEGORY_FLAG[ctx.category]) || DEFAULT_FLAG;
    flag = { ...spec, category: ctx.category || null };
  }

  return {
    score,
    tier,
    domainClass,
    date,
    entityHits: entityHits.length ? entityHits : tokenHits,
    signalHits,
    negatedHits,
    ambiguousHits,
    isCollision,
    contextMismatch,
    reasons,
    flag,
    // Everything worth painting yellow on the page.
    highlightTerms: [...new Set([...(entityHits.length ? entityHits : tokenHits), ...signalHits])]
  };
}

export const TIER_RANK = { critical: 3, strong: 2, weak: 1, noise: 0 };
