/**
 * Turns a template + an entity into a runnable Google URL, and works out which
 * terms in that query are the "signals" we want highlighted in the SERP.
 */

/** Strip scheme/path/www and lowercase — "https://www.Foo.com/x" -> "foo.com". */
export function bareDomain(website) {
  if (!website) return '';
  return String(website)
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
}

/** The ("Name" OR "www.site.com" OR "alias") group every boolean opens with. */
export function buildEntityGroup(entity) {
  const parts = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && !parts.some((p) => p.toLowerCase() === s.toLowerCase())) parts.push(s);
  };

  push(entity.company);
  if (entity.website) push(entity.website.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, ''));
  (entity.aliases || []).forEach(push);

  if (!parts.length) return '';
  return `(${parts.map((p) => `"${p}"`).join(' OR ')})`;
}

/** Substitute the {{...}} placeholders in a template query. */
export function renderQuery(template, entity) {
  const domain = bareDomain(entity.website);
  return String(template.query || '')
    .replaceAll('{{entity}}', buildEntityGroup(entity))
    .replaceAll('{{company}}', entity.company || '')
    .replaceAll('{{website}}', entity.website || '')
    .replaceAll('{{domain}}', domain)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The `-"Psypher AI"` tail that keeps a known-different company out of the
 * results in the first place.
 *
 * Filtering these out after the fact still costs the result slot — a boolean
 * that returns ten links spends six of them on the wrong company and we score
 * six of them as noise. Excluding at query time gets those six slots back as
 * usable results, at no extra queries and no extra time.
 *
 * Only ever built from terms the researcher typed themselves. The auto-detected
 * collision guesses in scoring.js deliberately do NOT feed this: a wrong guess
 * here silently removes results a researcher would never see, where a wrong
 * guess in scoring only demotes something still visible on screen.
 */
export function exclusionTerms(excludeTerms) {
  const parts = [];
  for (const raw of excludeTerms || []) {
    const term = String(raw || '').replaceAll('"', '').trim();
    if (!term) continue;
    if (parts.some((p) => p.toLowerCase() === term.toLowerCase())) continue;
    parts.push(term);
  }
  return parts;
}

export function buildExclusionTail(excludeTerms) {
  return exclusionTerms(excludeTerms).map((t) => `-"${t}"`).join(' ');
}

/** Full Google URL for a rendered query string. */
export function googleUrl(q, opts = {}) {
  const params = new URLSearchParams({ q, num: String(opts.num || 20), hl: opts.hl || 'en' });
  if (opts.recentOnly) params.set('tbs', 'qdr:y2');
  if (opts.country) params.set('gl', opts.country);
  return `https://www.google.com/search?${params.toString()}`;
}

/**
 * Signal terms = the quoted phrases that make the boolean *mean* something,
 * i.e. everything except the entity group and the site:/-site: operators.
 * These are what gets highlighted and scored in the SERP.
 */
export function deriveSignals(template, entity) {
  if (Array.isArray(template.signals) && template.signals.length) return template.signals.slice();

  const raw = String(template.query || '');
  const withoutEntity = raw.replaceAll('{{entity}}', ' ').replaceAll('{{company}}', ' ')
    .replaceAll('{{website}}', ' ').replaceAll('{{domain}}', ' ');

  const out = [];
  for (const m of withoutEntity.matchAll(/"([^"]+)"/g)) {
    const term = m[1].trim();
    if (!term) continue;
    if (/^-?site:/i.test(term)) continue;
    if (out.some((t) => t.toLowerCase() === term.toLowerCase())) continue;
    out.push(term);
  }

  // The entity's own words count as signals too — a hit that names the company
  // is what tells the researcher the result is actually about this company.
  const entityTerms = [];
  if (entity && entity.company) entityTerms.push(entity.company);
  const d = bareDomain(entity && entity.website);
  if (d) entityTerms.push(d);
  (entity && entity.aliases || []).forEach((a) => a && entityTerms.push(a));

  return out.concat(entityTerms.filter((t) => !out.some((o) => o.toLowerCase() === t.toLowerCase())));
}

/**
 * Add a keyword to a boolean without the researcher having to hand-edit
 * OR-syntax. Drops the new term into the first quoted OR-group in the query
 * (that's the boolean's main "what am I looking for" list — a multi-group
 * boolean like the EBITDA backup, which pairs a figure-type group with a
 * "million"/"billion" group, keeps its second group untouched). A boolean
 * with no quoted group yet (a bare site: list, or a blank placeholder) gets
 * a new AND-group appended instead, since there's nothing to join into.
 * Already-present terms are left alone rather than duplicated.
 */
export function insertKeyword(query, keyword) {
  const term = String(keyword || '').replaceAll('"', '').trim();
  if (!term) return query;

  const quoted = `"${term}"`;
  if (String(query || '').toLowerCase().includes(quoted.toLowerCase())) return query;

  const groupRe = /\(([^()]*"[^()]*)\)/;
  const m = query.match(groupRe);
  if (m) {
    const closeParenIndex = m.index + m[0].length - 1;
    return `${query.slice(0, closeParenIndex)} OR ${quoted}${query.slice(closeParenIndex)}`;
  }
  return `${query.trim()} AND (${quoted})`;
}

/** Compile a whole library into the job list for one entity. */
export function buildJobs(library, entity, opts = {}) {
  return library
    .filter((t) => t.enabled)
    .filter((t) => !opts.only || opts.only.includes(t.id))
    .map((t) => {
      if (t.engine === 'external') {
        return {
          id: t.id, category: t.category, name: t.name, engine: 'external',
          url: t.url, notes: t.notes || '', query: '', signals: []
        };
      }
      const base = renderQuery(t, entity);
      // Off unless the caller asks: a researcher who has not opted in gets
      // byte-identical queries to before.
      const excluded = opts.queryExclusions ? exclusionTerms(entity.excludeTerms) : [];
      const tail = buildExclusionTail(excluded);
      const q = tail ? `${base} ${tail}` : base;
      return {
        id: t.id,
        category: t.category,
        name: t.name,
        engine: 'google',
        query: q,
        excludedInQuery: excluded,
        url: googleUrl(q, opts),
        signals: deriveSignals(t, entity),
        entitySignals: [entity.company, bareDomain(entity.website), ...(entity.aliases || [])].filter(Boolean),
        notes: t.notes || ''
      };
    });
}
