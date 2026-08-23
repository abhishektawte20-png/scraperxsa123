/** Turning a finished run into something a researcher can paste into the profile. */

import { CATEGORY_ORDER } from './library.js';

const fmtTime = (ts) => new Date(ts).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});

export function groupByCategory(items) {
  const map = new Map();
  for (const t of items) {
    if (!map.has(t.category)) map.set(t.category, []);
    map.get(t.category).push(t);
  }
  return [...map.entries()].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a[0]) + 1 || 99) - (CATEGORY_ORDER.indexOf(b[0]) + 1 || 99)
  );
}

export function toMarkdown(run) {
  const lines = [
    `# ${run.entity.company}`,
    run.entity.website ? `Website: ${run.entity.website}` : '',
    `Run: ${fmtTime(run.startedAt)} · ${run.queries.length} booleans`,
    ''
  ];

  const corroborated = (run.aggregate || []).filter((a) => a.queryCount > 1).slice(0, 10);
  if (corroborated.length) {
    lines.push('## Corroborated sources', '');
    corroborated.forEach((a) =>
      lines.push(`- [${a.title}](${a.url}) — found by ${a.queryCount} booleans${a.date ? ` · ${a.date}` : ''}`));
    lines.push('');
  }

  for (const [cat, items] of groupByCategory(run.queries)) {
    lines.push(`## ${cat}`, '');
    for (const q of items) {
      const count = q.resultCount != null ? ` (${q.resultCount.toLocaleString()} results)` : '';
      lines.push(`### ${q.name}${count}`);
      if (q.query) lines.push('', '```', q.query, '```', '');
      const keep = (q.results || []).filter((r) => r.tier === 'critical' || r.tier === 'strong');
      if (!keep.length) lines.push('_No strong hits._', '');
      keep.forEach((r) => {
        lines.push(`- **[${r.score}] [${r.title}](${r.url})**${r.date ? ` · ${r.date}` : ''}`);
        if (r.snippet) lines.push(`  > ${r.snippet.replace(/\n+/g, ' ').slice(0, 300)}`);
        if (r.signalHits?.length) lines.push(`  _signals: ${r.signalHits.join(', ')}_`);
      });
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function toCsv(run) {
  const head = ['company', 'category', 'boolean', 'result_count', 'rank', 'score', 'tier',
    'title', 'url', 'date', 'signals', 'snippet'];
  const cell = (v) => `"${String(v ?? '').replaceAll('"', '""').replace(/\r?\n/g, ' ')}"`;
  const rows = [head.join(',')];

  for (const q of run.queries) {
    if (!(q.results || []).length) {
      rows.push([run.entity.company, q.category, q.name, q.resultCount ?? '', '', '', q.status,
        '', '', '', '', ''].map(cell).join(','));
      continue;
    }
    for (const r of q.results) {
      rows.push([run.entity.company, q.category, q.name, q.resultCount ?? '', r.rank, r.score, r.tier,
        r.title, r.url, r.date ?? '', (r.signalHits || []).join('; '), r.snippet].map(cell).join(','));
    }
  }
  return rows.join('\n');
}

export const slug = (s) => String(s || 'run').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
