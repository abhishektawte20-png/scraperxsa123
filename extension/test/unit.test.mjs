import { toMarkdown, toCsv, slug, groupByCategory } from '../lib/export.js';
import { buildJobs, renderQuery, bareDomain, buildEntityGroup, deriveSignals, insertKeyword } from '../lib/query.js';
import { DEFAULT_LIBRARY } from '../lib/library.js';
import { scoreResult, classifyDomain, isLegalBoilerplatePage } from '../lib/scoring.js';

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

console.log('\n[add-a-keyword]');
const backing = DEFAULT_LIBRARY.find((t) => t.id === 'backing.general').query;
const withNewTerm = insertKeyword(backing, 'secured investment');
check('new keyword joins the existing OR-group', withNewTerm.includes('"venture funding" OR "secured investment")'),
  withNewTerm);
check('everything else in the query is untouched',
  withNewTerm.startsWith(backing.slice(0, backing.indexOf('"venture funding"') + '"venture funding"'.length)));

const siteOnlyQuery = DEFAULT_LIBRARY.find((t) => t.id === 'oob.website').query;
const withSiteAdd = insertKeyword(siteOnlyQuery, 'archived');
check('a query with no quoted group gets a new AND-group instead of a broken OR',
  withSiteAdd.endsWith('AND ("archived")'), withSiteAdd);

const ebitda = DEFAULT_LIBRARY.find((t) => t.id === 'backup.ebitda').query;
const withEbitdaTerm = insertKeyword(ebitda, 'operating income');
check('multi-group boolean gets the term in its first (target) group, not the second',
  withEbitdaTerm.includes('"earnings before interest" OR "operating income")') &&
  !withEbitdaTerm.includes('"billion" OR "operating income"'),
  withEbitdaTerm);

check('adding a term already present is a no-op', insertKeyword(backing, 'raised') === backing);
check('adding a term already present ignores case', insertKeyword(backing, 'RAISED') === backing);
check('quotes in the typed term are stripped, not smuggled into the query',
  insertKeyword(backing, 'a "sneaky" term').includes('"a sneaky term"'));
check('blank input is a no-op', insertKeyword(backing, '   ') === backing);

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

console.log('\n[entity disambiguation: same name, different company]');
const psypherCtx = {
  company: 'Psypher', entityDomain: 'psypher.ai', category: 'Prior Backing',
  entitySignals: ['Psypher', 'psypher.ai'],
  signals: ['raises', 'raised', 'received funding', 'venture funding', 'Psypher', 'psypher.ai'],
  excludeTerms: ['Interactive', 'Games', 'Studio']
};
const collision = scoreResult({
  title: 'Meet Psypher Interactive Walked into their stall at GAFX',
  url: 'https://tracxn.com/Discover/Companies',
  snippet: 'Psypher AI has not raised any funding yet, per this profile.'
}, psypherCtx);
check('a name collision is demoted to noise regardless of raw score', collision.tier === 'noise', collision.tier);
check('a name collision never carries the flag', collision.flag === null, JSON.stringify(collision.flag));
check('the collision reason names the term that gave it away',
  collision.reasons.some((r) => r.includes('Interactive')), collision.reasons.join(' | '));
check('isCollision is reported on the result', collision.isCollision === true);

const onOwnSite = scoreResult({
  title: 'Psypher Interactive Partnership', url: 'https://www.psypher.ai/blog/interactive-launch',
  snippet: 'Psypher announces an interactive product launch.'
}, psypherCtx);
check('the company\'s own domain is exempt from the collision check even if it mentions the exclude term',
  onOwnSite.isCollision === false, JSON.stringify({ url: onOwnSite.domainClass, collision: onOwnSite.isCollision }));

const realHit = scoreResult({
  title: 'Psypher raises $8M Series A to expand AI healthcare platform',
  url: 'https://www.businesswire.com/news/psypher-series-a',
  snippet: 'Psypher, the AI-powered healthcare startup, announced it raised $8M in Series A funding.'
}, psypherCtx);
check('a genuine hit with no exclude term present scores normally', realHit.tier === 'critical', realHit.tier);
check('a genuine hit still carries the flag', realHit.flag !== null);

console.log('\n[entity disambiguation: distinguishing context]');
const contextCtx = { ...psypherCtx, excludeTerms: [], contextTerms: ['AI', 'healthcare', 'fintech'] };
const noContext = scoreResult({
  title: 'Psypher raises $8M', url: 'https://news.example.com/a',
  snippet: 'Psypher raised $8M this week, details unclear.'
}, contextCtx);
check('name matched but none of the configured context terms found — downgraded, not dropped',
  noContext.contextMismatch === true && noContext.tier !== 'critical', JSON.stringify({ tier: noContext.tier, mismatch: noContext.contextMismatch }));

const withContext = scoreResult({
  title: 'Psypher raises $8M for its AI healthcare platform', url: 'https://news.example.com/b',
  snippet: 'Psypher, an AI healthcare startup, raised $8M this week.'
}, contextCtx);
check('context present — no mismatch, scores normally', withContext.contextMismatch === false);

console.log('\n[negation-aware signal matching]');
const negCtx = { company: 'Acme', entityDomain: 'acme.com', category: 'Prior Backing',
  entitySignals: ['Acme'], signals: ['raised', 'Acme'] };
const negatedResult = scoreResult({
  title: 'About Acme', url: 'https://www.acme.com/about',
  snippet: 'Acme has not raised any funding yet, remaining fully bootstrapped.'
}, negCtx);
check('"has not raised" does not count as a positive signal hit', negatedResult.signalHits.length === 0, JSON.stringify(negatedResult.signalHits));
check('the negated term is reported separately, not silently dropped',
  negatedResult.negatedHits.includes('raised'), negatedResult.negatedHits.join(', '));
check('a negated match never carries the flag', negatedResult.flag === null);

const positiveResult = scoreResult({
  title: 'Acme raised funding', url: 'https://www.acme.com/news',
  snippet: 'Acme raised $5M in seed funding this week.'
}, negCtx);
check('an un-negated match still counts normally', positiveResult.signalHits.includes('raised'));

console.log('\n[legal/privacy boilerplate discount]');
const grantCtx = { company: 'Psypher', entityDomain: 'psypher.ai', category: 'Prior Backing',
  entitySignals: ['Psypher', 'psypher.ai'], signals: ['won', 'grant', 'sbic', 'sbir', 'was awarded', 'Psypher'] };
const tosMatch = scoreResult({
  title: 'Terms of Service', url: 'https://www.psypher.ai/terms',
  snippet: 'All content is owned by Psypher AI. By submitting it, you grant us a license to use it.'
}, grantCtx);
check('"grant" used as a legal verb on a ToS page is not counted', tosMatch.signalHits.length === 0, JSON.stringify(tosMatch.signalHits));
check('a ToS-page match never carries the flag', tosMatch.flag === null);
check('the Legal Name boolean is exempt from the ToS discount (it is deliberately searching these pages)',
  isLegalBoilerplatePage('https://www.psypher.ai/terms', 'Terms of Service') === true);
const legalNameCtx = { ...grantCtx, category: 'Out of Business', signals: ['privacy policy', 'terms of use', 'Psypher'] };
const legalNameHit = scoreResult({
  title: 'Terms of Service', url: 'https://www.psypher.ai/terms',
  snippet: 'These terms of use govern your access to Psypher AI services.'
}, legalNameCtx);
check('Out of Business > Legal Name still gets its intended hit on a ToS page',
  legalNameHit.signalHits.includes('terms of use'), JSON.stringify(legalNameHit.signalHits));

console.log('\n[sense-checking: matching the word is not matching the meaning]');
const senseCtx = {
  company: 'Acme Robotics', entityDomain: 'acme.com', category: 'Prior Backing',
  entitySignals: ['Acme Robotics', 'acme.com'],
  signals: ['raises', 'raised', 'received', 'received funding', 'venture funding', 'Acme Robotics', 'acme.com']
};
const wrongSense = scoreResult({
  title: 'Acme Robotics raises awareness for road safety', url: 'https://news.example.com/a',
  snippet: 'Acme Robotics raises awareness with a new campaign this month, no financial details.'
}, senseCtx);
check('"raises awareness" is not counted as a financing signal',
  wrongSense.signalHits.length === 0, JSON.stringify(wrongSense.signalHits));
check('the ambiguous term is reported, not silently dropped',
  wrongSense.ambiguousHits.includes('raises'), wrongSense.ambiguousHits.join(', '));
check('the wrong-sense match never carries the flag', wrongSense.flag === null);

const rightSense = scoreResult({
  title: 'Acme Robotics raises $8M Series A', url: 'https://www.businesswire.com/news/acme',
  snippet: 'Acme Robotics raised $8M in Series A funding led by top investors.'
}, senseCtx);
check('"raises $8M Series A" — money context present — counts normally',
  rightSense.signalHits.includes('raises') || rightSense.signalHits.includes('raised'), rightSense.signalHits.join(', '));
check('a genuine financing hit still carries the flag', rightSense.flag !== null);

const compoundPhrase = scoreResult({
  title: 'Acme Robotics received funding', url: 'https://www.prnewswire.com/x',
  snippet: 'Acme Robotics received funding from local backers this week.'
}, senseCtx);
check('a self-confirming compound phrase ("received funding") needs no extra corroboration',
  compoundPhrase.signalHits.includes('received funding'), compoundPhrase.signalHits.join(', '));

const oobSenseCtx = { ...senseCtx, category: 'Out of Business', signals: ['acquired', 'merged', 'acquisition', 'Acme Robotics', 'acme.com'] };
const acquiredWrongSense = scoreResult({
  title: 'How our team acquired a taste for robotics', url: 'https://blog.example.com/a',
  snippet: 'Our engineers acquired a taste for hands-on robotics over the years.'
}, oobSenseCtx);
check('"acquired a taste for" is not counted as an M&A signal',
  acquiredWrongSense.signalHits.length === 0, JSON.stringify(acquiredWrongSense.signalHits));
const acquiredRightSense = scoreResult({
  title: 'Acme Robotics acquired by BigCorp for $50M', url: 'https://www.businesswire.com/news/x',
  snippet: 'BigCorp announced it acquired Acme Robotics in a $50M deal.'
}, oobSenseCtx);
check('"acquired ... in a $50M deal" — deal context present — counts normally',
  acquiredRightSense.signalHits.includes('acquired'), acquiredRightSense.signalHits.join(', '));

console.log('\n[sense-checking: extended to Management, Service Providers, Boolean Backup]');
const mgmtCtx = {
  company: 'Acme Corp', entityDomain: 'acme.com', category: 'Management',
  entitySignals: ['Acme Corp', 'acme.com'],
  signals: ['chief executive officer', 'ceo', 'management', 'chief', 'president', 'Acme Corp', 'acme.com']
};
const wrongChief = scoreResult({
  title: 'Acme Corp says the chief among these problems is staffing', url: 'https://news.example.com/a',
  snippet: 'Acme Corp executives say the chief among these operational problems is staffing shortages.'
}, mgmtCtx);
check('"the chief among these problems" is not counted as a leadership signal',
  wrongChief.signalHits.length === 0, JSON.stringify(wrongChief.signalHits));
check('the ambiguous term is reported', wrongChief.ambiguousHits.includes('chief'), wrongChief.ambiguousHits.join(', '));

const rightChief = scoreResult({
  title: 'Acme Corp names new chief amid restructuring', url: 'https://www.businesswire.com/news/acme',
  snippet: 'Acme Corp appointed a new chief, effective immediately.'
}, mgmtCtx);
check('"appointed a new chief" — leadership context present — counts normally',
  rightChief.signalHits.includes('chief'), rightChief.signalHits.join(', '));

const spCtx = {
  company: 'Acme Corp', entityDomain: 'acme.com', category: 'Service Providers',
  entitySignals: ['Acme Corp', 'acme.com'], signals: ['advise', 'advisor', 'advised', 'legal', 'Acme Corp', 'acme.com']
};
const wrongLegal = scoreResult({
  title: 'Acme Corp says downloading movies is not legal in some regions', url: 'https://news.example.com/b',
  snippet: 'Acme Corp streaming service warns that downloading content is not legal in some regions.'
}, spCtx);
check('"is not legal" is not counted as a service-provider signal (also caught by negation)',
  wrongLegal.signalHits.length === 0, JSON.stringify(wrongLegal.signalHits));

const rightLegal = scoreResult({
  title: 'Acme Corp retains outside counsel', url: 'https://www.reuters.com/business/acme',
  snippet: 'Acme Corp retained outside counsel from Smith LLP for the legal review of the merger.'
}, spCtx);
check('"outside counsel" / "LLP" context present — "legal" counts normally',
  rightLegal.signalHits.includes('legal'), rightLegal.signalHits.join(', '));

const revCtx = {
  company: 'Acme Corp', entityDomain: 'acme.com', category: 'Boolean Backup',
  entitySignals: ['Acme Corp', 'acme.com'], signals: ['revenue', 'turnover', 'bookings', 'Acme Corp', 'acme.com']
};
const wrongTurnover = scoreResult({
  title: 'Acme Corp reports high employee turnover this quarter', url: 'https://news.example.com/c',
  snippet: 'Acme Corp reports high turnover among frontline staff this quarter, HR says.'
}, revCtx);
check('"employee turnover" is not counted as a revenue signal',
  wrongTurnover.signalHits.length === 0, JSON.stringify(wrongTurnover.signalHits));
check('the ambiguous term is reported', wrongTurnover.ambiguousHits.includes('turnover'));

const rightTurnover = scoreResult({
  title: 'Acme Corp turnover reached $50M in fiscal 2025', url: 'https://www.businesswire.com/news/acme',
  snippet: 'Acme Corp turnover reached $50M in fiscal 2025, up from last year.'
}, revCtx);
check('"turnover reached $50M in fiscal 2025" — revenue context present — counts normally',
  rightTurnover.signalHits.includes('turnover'), rightTurnover.signalHits.join(', '));

console.log('\n[sense-checking: the confirming context cannot be the company\'s own name]');
const capitalCtx = {
  company: 'XYZ Capital', entityDomain: 'xyzcapital.com', category: 'Prior Backing',
  entitySignals: ['XYZ Capital', 'xyzcapital.com'],
  signals: ['raises', 'raised', 'received funding', 'XYZ Capital', 'xyzcapital.com']
};
const selfConfirmBug = scoreResult({
  title: 'XYZ Capital raises awareness for financial literacy', url: 'https://news.example.com/a',
  snippet: 'XYZ Capital raises awareness with a new outreach campaign this month, no financial figures disclosed.'
}, capitalCtx);
check('a company named "XYZ Capital" does not confirm its own "raises" just by being named',
  selfConfirmBug.signalHits.length === 0 && selfConfirmBug.flag === null,
  JSON.stringify({ signalHits: selfConfirmBug.signalHits, flag: selfConfirmBug.flag }));
check('the ambiguous term is still reported rather than silently vanishing',
  selfConfirmBug.ambiguousHits.includes('raises'));

const genuineCapitalHit = scoreResult({
  title: 'XYZ Capital raises $8M for new fund', url: 'https://www.businesswire.com/news/xyz',
  snippet: 'XYZ Capital raised $8M in fresh capital commitments for its latest fund this week.'
}, capitalCtx);
check('a genuine hit for the same company still counts when real financing context is present',
  genuineCapitalHit.signalHits.includes('raises') || genuineCapitalHit.signalHits.includes('raised'),
  genuineCapitalHit.signalHits.join(', '));

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
