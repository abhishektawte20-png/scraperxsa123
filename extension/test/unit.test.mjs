import { toMarkdown, toCsv, slug, groupByCategory } from '../lib/export.js';
import { buildJobs, renderQuery, bareDomain, buildEntityGroup, deriveSignals, insertKeyword } from '../lib/query.js';
import { DEFAULT_LIBRARY } from '../lib/library.js';
import { scoreResult, classifyDomain, isLegalBoilerplatePage, signalProximity } from '../lib/scoring.js';
import { buildExclusionTail, exclusionTerms } from '../lib/query.js';
import { clusterProbeResults, isAmbiguous, exclusionsFromClusters, probeQuery, extractPlaces } from '../lib/probe.js';

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
const legalNameCtx = { ...grantCtx, category: 'Out of Business', templateId: 'oob.legalname',
  signals: ['privacy policy', 'terms of use', 'Psypher'] };
const legalNameHit = scoreResult({
  title: 'Terms of Service', url: 'https://www.psypher.ai/terms',
  snippet: 'These terms of use govern your access to Psypher AI services.'
}, legalNameCtx);
check('Out of Business > Legal Name still gets its intended hit on a ToS page',
  legalNameHit.signalHits.includes('terms of use'), JSON.stringify(legalNameHit.signalHits));

console.log('\n[reported: bankruptcy boolean matching a privacy policy]');
// A privacy policy says "a business transaction such as a merger or bankruptcy".
// That is boilerplate on every such page, not evidence the company folded.
const privacyPage = {
  title: 'Privacy Policy', url: 'https://www.psypher.in/policies/privacy-policy',
  snippet: '... www.psypher.in (the "Site") ... In connection with a business transaction such as a merger or bankruptcy ...'
};
const bankruptcyCtx = {
  company: 'Psypher', entityDomain: 'psypher.in', category: 'Out of Business',
  templateId: 'oob.bankruptcy_us', entitySignals: ['Psypher', 'psypher.in'],
  signals: ['chapter 7', 'chapter 11', 'bankruptcy', 'bankrupt', 'Psypher', 'psypher.in']
};
const bankruptcyOnPrivacy = scoreResult(privacyPage, bankruptcyCtx);
check('boilerplate "bankruptcy" on a privacy page is not counted',
  bankruptcyOnPrivacy.signalHits.length === 0, JSON.stringify(bankruptcyOnPrivacy.signalHits));
check('it is not reported as an out-of-business finding', bankruptcyOnPrivacy.flag === null);
check('it no longer outranks results that answered something',
  bankruptcyOnPrivacy.tier === 'weak', bankruptcyOnPrivacy.tier);

const legalNameOnPrivacy = scoreResult(
  { ...privacyPage, snippet: 'These terms of use and privacy policy govern access to Psypher.' },
  { ...bankruptcyCtx, templateId: 'oob.legalname', signals: ['privacy policy', 'terms of use', 'Psypher'] });
check('the Legal Name boolean, which wants these pages, is unaffected',
  legalNameOnPrivacy.signalHits.includes('terms of use') && legalNameOnPrivacy.flag !== null,
  JSON.stringify(legalNameOnPrivacy.signalHits));

const noAnswer = scoreResult(
  { title: 'Psypher — Contact', url: 'https://www.psypher.in/pages/contact', snippet: 'Get in touch with the Psypher team.' },
  bankruptcyCtx);
check('a company page answering nothing the boolean asked is capped at weak',
  noAnswer.tier === 'weak', noAnswer.tier);
const siteOnlyBoolean = scoreResult(
  { title: 'Psypher | LinkedIn', url: 'https://www.linkedin.com/company/psypher', snippet: 'Psypher | 240 followers.' },
  { company: 'Psypher', entityDomain: 'psypher.in', category: 'SMI', templateId: 'smi.linkedin',
    entitySignals: ['Psypher', 'psypher.in'], signals: ['Psypher', 'psypher.in'] });
check('a site-only boolean is exempt — being on the right domain IS its finding',
  siteOnlyBoolean.tier !== 'weak', siteOnlyBoolean.tier);

console.log('\n[reported: a game walkthrough is not a bankruptcy]');
// "Main Quest Chapter 7-70" matched the bankruptcy boolean and was reported as
// an out-of-business signal on a video-game wiki.
const gameQuest = scoreResult({
  title: 'RF ONLINE NEXT: Main Quest Chapter 7-70 Stop Vector',
  url: 'https://rfonlinenext.github.io/biosuits/psypher',
  snippet: '... grant brief invincibility when hit, making them Psypher-proof for the duration.'
}, bankruptcyCtx);
check('"Chapter 7" with no insolvency context is not a bankruptcy signal',
  gameQuest.signalHits.length === 0, JSON.stringify(gameQuest.signalHits));
check('the game page is not reported as out-of-business', gameQuest.flag === null);
check('the reason names the ambiguity',
  gameQuest.reasons.some((r) => r.includes('insolvency')), gameQuest.reasons.join(' | '));

const realFiling = scoreResult({
  title: 'Psypher files for Chapter 7 bankruptcy', url: 'https://www.reuters.com/legal/psypher',
  snippet: 'Psypher filed for Chapter 7 bankruptcy protection in Delaware court, citing creditors.'
}, bankruptcyCtx);
check('a genuine Chapter 7 filing still flags', realFiling.flag !== null, JSON.stringify(realFiling.flag));
check('both the filing chapter and the word bankruptcy count',
  realFiling.signalHits.includes('chapter 7') && realFiling.signalHits.includes('bankruptcy'),
  realFiling.signalHits.join(', '));
check('a news section at /legal/ is not mistaken for a terms-of-service page',
  isLegalBoilerplatePage('https://www.reuters.com/legal/psypher', 'Psypher files for Chapter 7') === false);
check('an actual legal-notice page is still detected',
  isLegalBoilerplatePage('https://example.com/legal-notice', '') === true);

console.log('\n[identity confidence: a domain is more unique than a name]');
const identCtx = { company: 'Psypher', entityDomain: 'psypher.in', category: 'Prior Backing',
  templateId: 'backing.general', entitySignals: ['Psypher', 'psypher.in'],
  signals: ['raised', 'Psypher', 'psypher.in'] };
const bothSeen = scoreResult({ title: 'Psypher raises seed round', url: 'https://news.example.com/a',
  snippet: 'Psypher (psypher.in) raised a seed round this week.' }, identCtx);
const domainOnly = scoreResult({ title: 'Funding roundup', url: 'https://news.example.com/b',
  snippet: 'The brand at psypher.in raised a seed round this week.' }, identCtx);
const nameOnly2 = scoreResult({ title: 'Psypher raises seed round', url: 'https://news.example.com/c',
  snippet: 'Psypher raised a seed round this week.' }, identCtx);
check('name and domain together is the strongest identity', bothSeen.identity === 'name+domain', bothSeen.identity);
check('a domain mention alone is recognised as a domain match, not a name match',
  domainOnly.identity === 'domain', domainOnly.identity);
check('a name mention alone is the weakest of the three', nameOnly2.identity === 'name', nameOnly2.identity);
check('a domain match outranks a bare name match',
  domainOnly.score > nameOnly2.score, `${domainOnly.score} > ${nameOnly2.score}`);
check('the company name being a substring of its own domain does not fake a name match',
  domainOnly.identity !== 'name+domain');

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

console.log('\n[auto-detected collision: no excludeTerms configured, the real production case]');
// The exact pair reported in production: "Psypher" (Indian streetwear, psypher.in)
// vs. "Psypher AI" (an unrelated Kochi tech startup, psypher.ai) — both founded
// in 2024, both India-based, nothing pre-configured to tell them apart.
const psypherAutoCtx = {
  company: 'Psypher', entityDomain: 'psypher.in', category: 'Entity Recognition',
  entitySignals: ['Psypher', 'psypher.in'],
  signals: ['founded in', 'was founded', 'Psypher', 'psypher.in']
};
const psypherAutoReal = scoreResult({
  title: 'About Psypher – Indian Streetwear Brand Story', url: 'https://www.psypher.in/pages/about-psypher',
  snippet: 'PSYPHER emerged from a desire to translate artistic ideas into wearable art. Founded in 2024, we\'re...'
}, psypherAutoCtx);
check('the genuine target scores normally with no config needed',
  psypherAutoReal.tier === 'critical' && psypherAutoReal.flag !== null, JSON.stringify({ tier: psypherAutoReal.tier, flag: psypherAutoReal.flag }));
check('the genuine target is never flagged as a possible different company', psypherAutoReal.possibleDifferentCompany === false);

const psypherAiAutoTracxn = scoreResult({
  title: 'Psypher AI - 2026 Company Profile, Team & Competitors', url: 'https://tracxn.com/Discover/Companies/psypher-ai',
  snippet: 'Psypher AI was founded in 2024. Psypher AI is headquartered in Kochi, India.'
}, psypherAutoCtx);
check('"Psypher AI" is auto-detected as a possible different company with zero configuration',
  psypherAiAutoTracxn.possibleDifferentCompany === true && psypherAiAutoTracxn.extensionWord === 'AI',
  JSON.stringify({ possibleDifferentCompany: psypherAiAutoTracxn.possibleDifferentCompany, extensionWord: psypherAiAutoTracxn.extensionWord }));
check('it is downgraded, not hidden — still weak, never critical/strong',
  psypherAiAutoTracxn.tier === 'weak', psypherAiAutoTracxn.tier);
check('it never carries the flag', psypherAiAutoTracxn.flag === null);
check('the reason tells the researcher exactly what to add to the exclude-terms field',
  psypherAiAutoTracxn.reasons.some((r) => r.includes('"AI"') && r.includes('Not this company if it also mentions')),
  psypherAiAutoTracxn.reasons.join(' | '));

const psypherAiAutoOwnSite = scoreResult({
  title: 'Terms of Service', url: 'https://www.psypher.ai/terms',
  snippet: 'All services, content, code, and branding are owned by Psypher AI and protected by international IP laws.'
}, psypherAutoCtx);
check('a page literally hosted on the confusable domain is caught even without a name-extension phrase',
  psypherAiAutoOwnSite.confusableDomain === 'psypher.ai', psypherAiAutoOwnSite.confusableDomain);
check('it is downgraded and never flagged', psypherAiAutoOwnSite.tier !== 'critical' && psypherAiAutoOwnSite.flag === null);

const psypherAiAutoPrivateLimited = scoreResult({
  title: 'PSYPHER AI PRIVATE LIMITED - Company Profile', url: 'https://tracxn.com/Discover/Legal-Entities/India/psypher-ai',
  snippet: 'PSYPHER AI PRIVATE LIMITED is a Private Limited Company and was incorporated on Oct 14, 2024 in India.'
}, psypherAutoCtx);
check('detection works on all-caps text too (case-insensitive root, case-checked extension)',
  psypherAiAutoPrivateLimited.extensionWord === 'AI', psypherAiAutoPrivateLimited.extensionWord);

console.log('\n[auto-detected collision: generalizes to other companies]');
const boltCtx = {
  company: 'Bolt', entityDomain: 'bolt.eu', category: 'Prior Backing',
  entitySignals: ['Bolt', 'bolt.eu'], signals: ['raises', 'raised', 'Bolt', 'bolt.eu']
};
const boltFintech = scoreResult({
  title: 'Bolt raises $355M at a $14B valuation', url: 'https://www.bolt.com/blog/series-e',
  snippet: 'Bolt, the checkout and fraud-prevention company, announced it raised $355M in a Series E round.'
}, boltCtx);
check('bolt.com (an unrelated fintech) is caught as a confusable domain against bolt.eu (mobility)',
  boltFintech.confusableDomain === 'bolt.com', boltFintech.confusableDomain);
check('never carries the flag', boltFintech.flag === null);

const boltMobility = scoreResult({
  title: 'Bolt raises €150M in new funding round', url: 'https://techcrunch.com/2024/bolt-funding',
  snippet: 'Bolt, the Estonian ride-hailing and delivery company, has raised €150M in new funding.'
}, boltCtx);
check('the genuine company on a neutral press domain scores normally',
  boltMobility.tier !== 'noise' && boltMobility.flag !== null, JSON.stringify({ tier: boltMobility.tier, flag: boltMobility.flag }));

console.log('\n[auto-detected collision: false-positive guards]');
const acmeCtx = {
  company: 'Acme', entityDomain: 'acmelabs.com', category: 'Entity Recognition',
  entitySignals: ['Acme', 'acmelabs.com', 'Acme Labs'], // the full name is listed as an alias
  signals: ['founded in', 'was founded', 'Acme', 'acmelabs.com', 'Acme Labs']
};
const acmeOwnFullName = scoreResult({
  title: 'Acme Labs was founded in 2019', url: 'https://www.acmelabs.com/about',
  snippet: 'Acme Labs was founded in 2019 by a team of former engineers.'
}, acmeCtx);
check('a company\'s own full name, already listed as an alias, is not treated as a collision',
  acmeOwnFullName.extensionWord === null && acmeOwnFullName.tier === 'critical',
  JSON.stringify({ extensionWord: acmeOwnFullName.extensionWord, tier: acmeOwnFullName.tier }));

const legalSuffixCtx = {
  company: 'Reliance', entityDomain: 'ril.com', category: 'Entity Recognition',
  entitySignals: ['Reliance', 'ril.com'], signals: ['founded in', 'Reliance', 'ril.com']
};
const legalSuffixHit = scoreResult({
  title: 'Reliance Inc. announces new plant', url: 'https://www.ril.com/news/plant',
  snippet: 'Reliance Inc. today announced a new manufacturing plant.'
}, legalSuffixCtx);
check('a legal-entity suffix ("Inc.") is not mistaken for a different company\'s name',
  legalSuffixHit.extensionWord === null, legalSuffixHit.extensionWord);

console.log('\n[sentence proximity: signal near the company, not just on the same page]');
const proxCtx = {
  company: 'Psypher', entityDomain: 'psypher.in', category: 'Prior Backing',
  entitySignals: ['Psypher', 'psypher.in'],
  signals: ['raised', 'raises', 'venture funding', 'Psypher', 'psypher.in']
};
const sameSentence = scoreResult({
  title: 'Psypher raised $8M Series A', url: 'https://www.businesswire.com/x',
  snippet: 'Psypher raised $8M in Series A funding led by investors.'
}, proxCtx);
check('company and signal in one sentence is the strong case',
  sameSentence.proximity === 'same-sentence' && sameSentence.distantSignal === false, sameSentence.proximity);
check('a same-sentence hit still carries the flag', sameSentence.flag !== null);

const nextSentence = scoreResult({
  title: 'Psypher profile', url: 'https://news.example.com/x',
  snippet: 'Psypher is a streetwear brand. The company raised $2M last year.'
}, proxCtx);
check('an adjacent sentence still counts — not everything across a full stop is noise',
  nextSentence.proximity === 'near' && nextSentence.distantSignal === false, nextSentence.proximity);

const farAway = scoreResult({
  title: 'Psypher — Indian Streetwear Brand', url: 'https://news.example.com/y',
  snippet: 'Psypher emerged from a desire to translate artistic ideas into wearable art, founded 2024 in Delhi with a small team of designers and illustrators working across India. In other news this week, Acme Corp raised $40M in a round led by Sequoia to expand its logistics network.'
}, proxCtx);
check('a signal belonging to a different story on the page is marked distant',
  farAway.distantSignal === true && farAway.proximity === 'far', farAway.proximity);
check('a distant signal never carries the flag', farAway.flag === null);
check('a distant signal scores lower than the same-sentence version',
  farAway.score < sameSentence.score, `${farAway.score} < ${sameSentence.score}`);
check('the reason explains the demotion',
  farAway.reasons.some((r) => r.includes('far from any mention')), farAway.reasons.join(' | '));

check('proximity says nothing when the company is never named',
  signalProximity('some text about funding', 5, []) === 'no-entity');
check('an abbreviation is not mistaken for a sentence end',
  signalProximity('Psypher Inc. raised money', 21, [0]) === 'same-sentence');

console.log('\n[query-side exclusions]');
check('exclusion terms are quoted and negated',
  buildExclusionTail(['Psypher AI', 'Interactive']) === '-"Psypher AI" -"Interactive"',
  buildExclusionTail(['Psypher AI', 'Interactive']));
check('duplicates and case variants collapse',
  exclusionTerms(['AI', 'ai', ' AI ']).length === 1, JSON.stringify(exclusionTerms(['AI', 'ai', ' AI '])));
check('embedded quotes cannot break out of the operator',
  buildExclusionTail(['bad"term']) === '-"badterm"', buildExclusionTail(['bad"term']));
check('no terms yields an empty tail, not a stray operator', buildExclusionTail([]) === '');

const exclEntity = { company: 'Psypher', website: 'psypher.in', aliases: [], excludeTerms: ['Psypher AI'] };
const jobOff = buildJobs(DEFAULT_LIBRARY, exclEntity, { only: ['backing.general'] })[0];
const jobOn = buildJobs(DEFAULT_LIBRARY, exclEntity, { only: ['backing.general'], queryExclusions: true })[0];
check('exclusions are off unless asked for', !jobOff.query.includes('-"Psypher AI"'));
check('exclusions reach the query when enabled', jobOn.query.includes('-"Psypher AI"'), jobOn.query.slice(-40));
check('the excluded terms are reported on the job', jobOn.excludedInQuery.includes('Psypher AI'));
const noExcl = buildJobs(DEFAULT_LIBRARY, { company: 'Psypher', website: 'psypher.in', aliases: [] },
  { only: ['backing.general'], queryExclusions: true })[0];
check('an entity with nothing configured gets a byte-identical query',
  noExcl.query === jobOff.query, 'unchanged');

console.log('\n[pre-flight ambiguity probe]');
const probeEntity = { company: 'Psypher', website: 'psypher.in', aliases: [] };
check('the probe is the bare name, no signals or filters', probeQuery(probeEntity) === '"Psypher"', probeQuery(probeEntity));
check('places are pulled out of snippets',
  extractPlaces('Psypher AI is headquartered in Kochi, India.')[0] === 'Kochi',
  JSON.stringify(extractPlaces('Psypher AI is headquartered in Kochi, India.')));
check('a sentence-ending period is not treated as part of the city name',
  JSON.stringify(extractPlaces('Founded in 2024, based in Delhi. Psypher, based in Delhi, released a drop.')) === '["Delhi"]',
  JSON.stringify(extractPlaces('Founded in 2024, based in Delhi. Psypher, based in Delhi, released a drop.')));
check('interior punctuation in a real place name survives',
  extractPlaces('headquartered in St. Louis today')[0] === 'St. Louis',
  JSON.stringify(extractPlaces('headquartered in St. Louis today')));

const probeResults = [
  { title: 'About Psypher – Indian Streetwear Brand Story', url: 'https://www.psypher.in/pages/about-psypher',
    snippet: 'PSYPHER emerged from a desire to translate artistic ideas into wearable art. Founded in 2024.' },
  { title: 'Psypher AI - 2026 Company Profile', url: 'https://tracxn.com/Discover/Companies/psypher-ai',
    snippet: 'Psypher AI was founded in 2024. Psypher AI is headquartered in Kochi, India.' },
  { title: 'Terms of Service', url: 'https://www.psypher.ai/terms',
    snippet: 'All services and branding are owned by Psypher AI.' },
  { title: 'PSYPHER AI PRIVATE LIMITED', url: 'https://tracxn.com/Discover/Legal-Entities/India/psypher-ai',
    snippet: 'PSYPHER AI PRIVATE LIMITED was incorporated on Oct 14, 2024 in India.' },
  { title: 'Psypher streetwear drop', url: 'https://hypebeast.com/psypher',
    snippet: 'Psypher, based in Delhi, released a new capsule collection.' }
];
const clusters = clusterProbeResults(probeResults, probeEntity);
check('the two companies separate into two clusters', clusters.length === 2, `${clusters.length} clusters`);
check('the target cluster is listed first', clusters[0].kind === 'target', clusters[0].kind);
check('the rival is labelled by the extra word in its name',
  clusters[1].label === 'Psypher AI', clusters[1].label);
check('a page on the target\'s own domain always lands in the target cluster',
  clusters[0].domains.includes('psypher.in'), JSON.stringify(clusters[0].domains));
check('locations are captured as a discriminator (Delhi vs Kochi)',
  clusters[0].places.includes('Delhi') && clusters[1].places.includes('Kochi'),
  JSON.stringify([clusters[0].places, clusters[1].places]));
check('this counts as ambiguous', isAmbiguous(clusters) === true);
check('rejecting the rival yields its full name, not the bare distinguishing word',
  exclusionsFromClusters(clusters, [clusters[1].key]).includes('Psypher AI'),
  JSON.stringify(exclusionsFromClusters(clusters, [clusters[1].key])));
check('the bare word alone is never used — -"AI" would gut the results',
  !exclusionsFromClusters(clusters, [clusters[1].key]).includes('AI'));
check('rejecting nothing yields no exclusions', exclusionsFromClusters(clusters, []).length === 0);

const soloClusters = clusterProbeResults([
  { title: 'Acme Robotics raises $8M', url: 'https://businesswire.com/x', snippet: 'Acme Robotics raised $8M.' },
  { title: 'About Acme Robotics', url: 'https://www.acme.com/about', snippet: 'Acme Robotics, based in Boston.' }
], { company: 'Acme Robotics', website: 'acme.com', aliases: [] });
check('an unambiguous name produces one cluster and no interruption',
  soloClusters.length === 1 && isAmbiguous(soloClusters) === false, `${soloClusters.length} cluster(s)`);
check('a single stray mention is below the interrupt threshold',
  isAmbiguous(clusterProbeResults([
    ...probeResults.slice(0, 1),
    { title: 'Psypher Labs one-off', url: 'https://example.com/a', snippet: 'Psypher Labs is unrelated.' }
  ], probeEntity)) === false);

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
