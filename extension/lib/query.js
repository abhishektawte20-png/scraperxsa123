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
      const q = renderQuery(t, entity);
      return {
        id: t.id,
        category: t.category,
        name: t.name,
        engine: 'google',
        query: q,
        url: googleUrl(q, opts),
        signals: deriveSignals(t, entity),
        entitySignals: [entity.company, bareDomain(entity.website), ...(entity.aliases || [])].filter(Boolean),
        notes: t.notes || ''
      };
    });
}
