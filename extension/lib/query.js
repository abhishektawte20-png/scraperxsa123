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
 * The same {{company}}/{{website}}/{{domain}} placeholders, but URL-encoded
 * and for a plain link rather than a boolean — an external.engine template's
 * `url` (a manual "go check this yourself" deep link, e.g. a registry site
 * search) that wants the company name baked into the URL. A template with no
 * placeholders (the Rovo agent links) passes through unchanged.
 */
export function renderExternalUrl(urlTemplate, entity) {
  const domain = bareDomain(entity?.website);
  return String(urlTemplate || '')
    .replaceAll('{{company}}', encodeURIComponent(entity?.company || ''))
    .replaceAll('{{website}}', encodeURIComponent(entity?.website || ''))
    .replaceAll('{{domain}}', encodeURIComponent(domain));
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
 * The boolean's own signal terms, minus the entity's own name/domain/aliases
 * — what's left is what the boolean is actually asking about, as opposed to
 * just "is this the company." A companion search restricted to the official
 * site doesn't need the name check (site: already settles that), so this is
 * the useful half.
 */
function contentOnlySignals(signals, entity) {
  const entityTerms = new Set(
    [entity?.company, bareDomain(entity?.website), ...(entity?.aliases || [])]
      .filter(Boolean).map((s) => String(s).toLowerCase())
  );
  return (signals || []).filter((s) => !entityTerms.has(String(s).toLowerCase()));
}

/**
 * A companion query restricted to the company's own website: the same
 * boolean, asking the same question, but `site:{{domain}} AND (...)` instead
 * of hoping the page happens to rank organically for the phrasing against
 * press coverage and aggregators. Returns '' when there's nothing to ask —
 * no domain configured, or a boolean (LinkedIn, Facebook/Twitter) whose only
 * "signal" is the company's own name, where searching the company's own site
 * for its own name says nothing.
 */
export function buildSiteQuery(template, entity) {
  const domain = bareDomain(entity?.website);
  if (!domain) return '';
  const content = contentOnlySignals(deriveSignals(template, entity), entity);
  if (!content.length) return '';
  return `site:${domain} AND (${content.map((t) => `"${t}"`).join(' OR ')})`;
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
    .flatMap((t) => {
      if (t.engine === 'external') {
        return [{
          id: t.id, category: t.category, name: t.name, engine: 'external',
          url: renderExternalUrl(t.url, entity), notes: t.notes || '', query: '', signals: []
        }];
      }
      const base = renderQuery(t, entity);
      // Off unless the caller asks: a researcher who has not opted in gets
      // byte-identical queries to before.
      const excluded = opts.queryExclusions ? exclusionTerms(entity.excludeTerms) : [];
      const tail = buildExclusionTail(excluded);
      const q = tail ? `${base} ${tail}` : base;
      const entitySignals = [entity.company, bareDomain(entity.website), ...(entity.aliases || [])].filter(Boolean);
      const job = {
        id: t.id,
        category: t.category,
        name: t.name,
        engine: 'google',
        query: q,
        excludedInQuery: excluded,
        url: googleUrl(q, opts),
        signals: deriveSignals(t, entity),
        entitySignals,
        notes: t.notes || ''
      };

      const jobs = [job];

      if (opts.siteSearch) {
        const siteQ = buildSiteQuery(t, entity);
        if (siteQ) { // '' when there's nothing to ask the official site beyond its own name
          jobs.push({
            id: `${t.id}.site`,
            category: t.category,
            name: `${t.name} — official site`,
            engine: 'google',
            query: siteQ,
            excludedInQuery: [],
            url: googleUrl(siteQ, opts),
            signals: deriveSignals(t, entity),
            entitySignals,
            notes: 'Same question, restricted to pages Google has indexed from the company’s own website.',
            isSiteCompanion: true,
            templateId: t.id // for scoring: shares the parent boolean's legal-page exemptions etc.
          });
        }
      }

      // A wider phrase list run as its own boolean, not a silent replacement —
      // the point is letting a researcher compare it against the classic
      // version, not deciding for them which one is "right".
      if (opts.expandedKeywords && t.expandedSignals?.length) {
        // insertKeyword expects the raw template text — {{entity}} still a bare
        // placeholder, no parentheses of its own yet — so the new phrase lands
        // in the boolean's own OR-group. Running it on the already-rendered `q`
        // would instead insert into the entity group (the first parenthesized
        // group once {{entity}} has been substituted), diluting the "is this
        // even about the company" requirement rather than adding search terms.
        let expandedTemplateQuery = t.query;
        for (const kw of t.expandedSignals) expandedTemplateQuery = insertKeyword(expandedTemplateQuery, kw);
        const expandedBase = renderQuery({ query: expandedTemplateQuery }, entity);
        const expandedQ = tail ? `${expandedBase} ${tail}` : expandedBase;
        jobs.push({
          id: `${t.id}.expanded`,
          category: t.category,
          name: `${t.name} — expanded keywords`,
          engine: 'google',
          query: expandedQ,
          excludedInQuery: excluded,
          url: googleUrl(expandedQ, opts),
          signals: [...deriveSignals(t, entity), ...t.expandedSignals],
          entitySignals,
          notes: 'The classic boolean plus additional phrasing, run side by side so you can judge which finds more.',
          isExpandedCompanion: true,
          templateId: t.id
        });
      }

      return jobs;
    });
}
