import { toMarkdown, toCsv, slug, groupByCategory } from '../lib/export.js';
import { buildJobs, renderQuery, bareDomain, buildEntityGroup, deriveSignals } from '../lib/query.js';
import { DEFAULT_LIBRARY } from '../lib/library.js';
import { scoreResult, classifyDomain } from '../lib/scoring.js';

let fail = 0;
const check = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`); if (!c) fail++; };

console.log('\n[query building]');
check('bare domain strips scheme and www', bareDomain('https://www.Foo.co.uk/path?x=1') === 'foo.co.uk', bareDomain('https://www.Foo.co.uk/path?x=1'));
check('entity group quotes each term',
  buildEntityGroup({ company: 'Acme Co', website: 'https://acme.com/', aliases: ['Acme Holdings'] })
  === '("Acme Co" OR "acme.com" OR "Acme Holdings")',
  buildEntityGroup({ company: 'Acme Co', website: 'https://acme.com/', aliases: ['Acme Holdings'] }));
check('entity group dedupes case-insensitively',
  buildEntityGroup({ company: 'Acme', website: '', aliases: ['ACME', 'Other'] }) === '("Acme" OR "Other")');
check('placeholders all substitute',
  renderQuery({ query: '{{company}}|{{website}}|{{domain}}|{{entity}}' }, { company: 'A', website: 'www.b.com', aliases: [] })
  === 'A|www.b.com|b.com|("A" OR "www.b.com")');

const entity = { company: 'L&L Exhibition Management', website: 'www.homeshowcenter.com', aliases: [] };
const jobs = buildJobs(DEFAULT_LIBRARY, entity, { num: 20 });
check('default set builds 16 jobs', jobs.length === 16, String(jobs.length));
check('external jobs carry a url not a query',
  jobs.every((j) => j.engine !== 'external' || (j.url && !j.query)));
check('every google job has a search url',
  jobs.filter((j) => j.engine === 'google').every((j) => j.url.startsWith('https://www.google.com/search?q=')));
check('only= filter respected', buildJobs(DEFAULT_LIBRARY, entity, { only: ['smi.linkedin'] }).length === 1);

console.log('\n[signals]');
const sig = deriveSignals(DEFAULT_LIBRARY.find((t) => t.id === 'oob.bankruptcy_us'), entity);
check('quoted phrases become signals', sig.includes('chapter 11') && sig.includes('bankrupt'));
check('site: operators excluded from signals', !sig.some((s) => /site:/i.test(s)), sig.filter(s=>/site:/i.test(s)).join());
check('entity terms appended', sig.includes('L&L Exhibition Management'));
const siteOnly = deriveSignals(DEFAULT_LIBRARY.find((t) => t.id === 'smi.linkedin'), entity);
check('site-only boolean still yields entity signals', siteOnly.length === 2, siteOnly.join(' | '));

console.log('\n[scoring edges]');
check('pitchbook classified as aggregator', classifyDomain('https://pitchbook.com/x', 'acme.com') === 'aggregator');
check('subdomain of company site counts as official', classifyDomain('https://news.acme.com/x', 'acme.com') === 'official');
check('sec.gov classified as registry', classifyDomain('https://www.sec.gov/edgar', 'acme.com') === 'registry');
const amp = scoreResult(
  { title: 'L&L Exhibition Management files for chapter 11', url: 'https://news.example.com/a', snippet: 'ch. 11 filing reported' },
  { company: 'L&L Exhibition Management', entityDomain: 'homeshowcenter.com',
    entitySignals: ['L&L Exhibition Management'], signals: ['chapter 11', 'ch. 11', 'bankrupt'] });
check('ampersand names match', amp.entityHits.length > 0, JSON.stringify(amp.entityHits));
check('dotted terms like "ch. 11" match', amp.signalHits.includes('ch. 11'), amp.signalHits.join(', '));
check('multi-word signal matched', amp.signalHits.includes('chapter 11'));
const empty = scoreResult({ title: '', url: '', snippet: '' }, { company: 'X', entityDomain: '', entitySignals: [], signals: [] });
check('empty result does not throw and scores as noise', empty.tier === 'noise', String(empty.score));

console.log('\n[flagging: company + signal co-occurrence]');
const backingCtx = {
  company: 'Acme Robotics', entityDomain: 'acme.com', category: 'Prior Backing',
  entitySignals: ['Acme Robotics', 'acme.com'], signals: ['raised', 'venture funding']
};
const backingHit = scoreResult(
  { title: 'Acme Robotics raised $10M in venture funding', url: 'https://www.businesswire.com/news/x',
    snippet: 'Acme Robotics raised a Series A round.' }, backingCtx);
check('company + signal from a press source is flagged', backingHit.flag !== null, JSON.stringify(backingHit.flag));
check('flag label is category-specific', backingHit.flag?.label === 'Investor backing detected', backingHit.flag?.label);

const nameOnly = scoreResult(
  { title: 'Acme Robotics office relocation announced', url: 'https://www.businesswire.com/news/y',
    snippet: 'Acme Robotics moved offices.' }, backingCtx);
check('company mention without the target signal is not flagged', nameOnly.flag === null, JSON.stringify(nameOnly.flag));

const noiseHit = scoreResult(
  { title: 'Industry roundup', url: 'https://example.org/news', snippet: 'General commentary, no company named.' },
  backingCtx);
check('unrelated noise result is not flagged', noiseHit.flag === null);

const aggregatorHit = scoreResult(
  { title: 'Acme Robotics - PitchBook Profile', url: 'https://pitchbook.com/profiles/acme',
    snippet: 'Acme Robotics raised funding.' }, backingCtx);
check('aggregator source does not get flagged even with a full match',
  aggregatorHit.flag === null, JSON.stringify(aggregatorHit.flag));

const oobCtx = { ...backingCtx, category: 'Out of Business', signals: ['chapter 11', 'bankrupt'] };
const oobHit = scoreResult(
  { title: 'Acme Robotics files for chapter 11', url: 'https://www.reuters.com/business/acme',
    snippet: 'Acme Robotics filed for bankruptcy protection.' }, oobCtx);
check('flag label follows the boolean category, not just Prior Backing',
  oobHit.flag?.label === 'Out-of-business signal', oobHit.flag?.label);

console.log('\n[exports]');
const run = {
  entity: { company: 'L&L Exhibition Management', website: 'www.homeshowcenter.com' },
  startedAt: Date.now(),
  aggregate: [{ url: 'https://a.com/1', title: 'Big news', queryCount: 3, date: '2024-01-02', queries: [] }],
  queries: [
    { id: 'a', category: 'Prior Backing', name: 'General Financing', query: '("X") AND ("raises")',
      resultCount: 1234, status: 'ok',
      results: [{ rank: 1, score: 88, tier: 'critical', title: 'Raised $4M', url: 'https://a.com/1',
        snippet: 'They "raised" $4M\nacross rounds', date: '2024-01-02', signalHits: ['raised'] }] },
    { id: 'b', category: 'SMI', name: 'LinkedIn', query: '("X") AND site:linkedin.com',
      resultCount: 0, status: 'ok', results: [] }
  ]
};
const md = toMarkdown(run);
check('markdown has the company heading', md.startsWith('# L&L Exhibition Management'));
check('markdown groups by category', md.includes('## Prior Backing') && md.includes('## SMI'));
check('markdown includes the boolean', md.includes('("X") AND ("raises")'));
check('markdown marks empty booleans', md.includes('_No strong hits._'));
check('markdown lists corroborated sources', md.includes('found by 3 booleans'));

const csv = toCsv(run);
const rows = csv.split('\n');
check('csv has header + one row per result + one for the empty query', rows.length === 3, String(rows.length));
check('csv quotes embedded quotes', rows[1].includes('""raised""'), rows[1].slice(0, 140));
check('csv flattens newlines', !rows[1].includes('\n') && rows[1].includes('$4M across rounds'));
check('csv header order stable', rows[0] === 'company,category,boolean,result_count,rank,score,tier,flag,title,url,date,signals,snippet');

check('slug is filename safe', slug('L&L Exhibition Management!') === 'l-l-exhibition-management', slug('L&L Exhibition Management!'));
check('category grouping follows the sheet order',
  groupByCategory(run.queries)[0][0] === 'Prior Backing');

console.log(`\n${fail === 0 ? 'ALL UNIT CHECKS PASSED' : fail + ' UNIT CHECK(S) FAILED'}`);
process.exit(fail ? 1 : 0);
