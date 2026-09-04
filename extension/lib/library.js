/**
 * Default boolean library.
 *
 * Transcribed from the researchers' existing boolean sheet — the same strings
 * that sit behind each "Copy Boolean" button, so a run here produces exactly
 * the SERP a researcher would have got by copying and pasting.
 *
 * Placeholders available inside `query`:
 *   {{entity}}   ("Company Name" OR "www.site.com" OR "alias" ...)  <- built from the entity form
 *   {{company}}  raw company name
 *   {{website}}  raw website as entered
 *   {{domain}}   bare hostname of the website (no scheme, no www.)
 *
 * `signals` is optional. When omitted the runner derives the signal terms from
 * the quoted phrases in the query itself, minus the entity group and operators.
 */

export const EXCLUDE_PB = 'AND -site:pitchbook.com';

// The directory exclusions that ride along with every Boolean Backup query.
const BACKUP_EXCLUSIONS = [
  '-site:pitchbook.com',
  '-site:usbiz.org',
  '-site:manta.com',
  '-site:credibility.com',
  '-site:findusabusiness.com',
  '-site:dandb.com',
  '-site:hoovers.com',
  '-site:owler.com',
  '-site:brightscope.com',
  '-site:usbizplace.com'
].map((s) => `AND ${s}`).join(' ');

export const DEFAULT_LIBRARY = [
  // ── Prior Backing ──────────────────────────────────────────────────────────
  {
    id: 'backing.general',
    category: 'Prior Backing',
    name: 'General Financing',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("raises" OR "raised" OR "received" OR "received funding" OR "receives financing" OR "received financing" OR "receives funding" OR "venture funding") ${EXCLUDE_PB}`,
    expandedSignals: ['secures funding', 'secured funding', 'closes funding round', 'lands funding', 'nets funding', 'bags funding', 'investment from', 'seed round', 'pre-seed round', 'series funding']
  },
  {
    id: 'backing.grant',
    category: 'Prior Backing',
    name: 'Grant',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("won" OR "grant" OR "sbic" OR "sbir" OR "was awarded") ${EXCLUDE_PB}`,
    expandedSignals: ['receives grant', 'awarded grant', 'grant funding']
  },

  // ── Entity Recognition ─────────────────────────────────────────────────────
  {
    id: 'entity.startdate',
    category: 'Entity Recognition',
    name: 'Start Date',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("incorporated in" OR "founded in" OR "founded on" OR "established in" OR "started in" OR "launched in" OR "was founded") ${EXCLUDE_PB}`,
    expandedSignals: ['incorporated on', 'registered in', 'formed in', 'founded by', 'co-founded in', 'dates back to']
  },
  {
    id: 'entity.nonprofit',
    category: 'Entity Recognition',
    name: 'Non-Profit Entity',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("non-profit" OR "nonprofit" OR "not-for-profit" OR "non-governmental organization" OR "social enterprise")`,
    expandedSignals: ['registered charity', 'charitable organization', 'public charity']
  },
  {
    id: 'entity.winddown',
    category: 'Entity Recognition',
    name: 'Investor Wind Down',
    engine: 'google',
    enabled: false,
    query: '{{entity}}',
    notes: 'Blank in the source sheet — fill in the boolean before enabling.'
  },

  // ── SMI (social media identifiers) ─────────────────────────────────────────
  {
    id: 'smi.linkedin',
    category: 'SMI',
    name: 'LinkedIn',
    engine: 'google',
    enabled: true,
    query: '{{entity}} AND site:www.linkedin.com'
  },
  {
    id: 'smi.facebook_twitter',
    category: 'SMI',
    name: 'Facebook + Twitter',
    engine: 'google',
    enabled: true,
    query: '{{entity}} AND (site:facebook.com OR site:twitter.com OR site:x.com)'
  },

  // ── Site Search ────────────────────────────────────────────────────────────
  {
    id: 'site.hq',
    category: 'Site Search',
    name: 'HQ Search',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("headquarters" OR "based out of" OR "headquartered" OR "head office") ${EXCLUDE_PB}`,
    expandedSignals: ['based in', 'registered office', 'principal place of business', 'corporate headquarters']
  },

  // ── Management ─────────────────────────────────────────────────────────────
  {
    id: 'mgmt.toplevel',
    category: 'Management',
    name: 'Top Level Management Search',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("chief executive officer" OR "ceo" OR "coo" OR "founder" OR "co-founder" OR "chief financial officer" OR "cfo" OR "managing director" OR "management" OR "chief" OR "president" OR "cto") ${EXCLUDE_PB}`,
    expandedSignals: ['appointed as', 'joins as', 'joined as', 'promoted to', 'named as', 'steps down as', 'resigns as', 'chief operating officer', 'chief technology officer', 'vice president']
  },

  // ── Service Providers ──────────────────────────────────────────────────────
  {
    id: 'sp.search',
    category: 'Service Providers',
    name: 'Service Provider Search',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("advise" OR "advisor" OR "advised" OR "legal") ${EXCLUDE_PB}`,
    expandedSignals: ['law firm', 'general counsel', 'outside counsel', 'represented by', 'auditor', 'accounting firm']
  },

  // ── ROVO agents (external, opened not scraped) ─────────────────────────────
  {
    id: 'rovo.financials',
    category: 'Financials Search',
    name: 'FS ROVO Agent',
    engine: 'external',
    enabled: false,
    url: 'https://home.atlassian.com/o/b572df62-3309-42bc-be93-b9141d4045a3/people/agent/91dfa998-ab18-4c03-a691-89f9873e6cd7',
    notes: 'Rovo agent — opened in a tab for you to run, never auto-scraped.'
  },
  {
    id: 'rovo.employees',
    category: 'Employee Counts',
    name: 'EC ROVO Agent',
    engine: 'external',
    enabled: false,
    url: 'https://home.atlassian.com/o/b572df62-3309-42bc-be93-b9141d4045a3/people/agent/2c3978fc-8fbd-494c-acde-553fa36f1b77',
    notes: 'Rovo agent — opened in a tab for you to run, never auto-scraped.'
  },
  {
    id: 'registry.zaubacorp',
    category: 'Entity Recognition',
    name: 'Zauba Corp (India registry — manual check)',
    engine: 'external',
    enabled: false, // India-specific; off by default like the Rovo agents
    url: 'https://www.zaubacorp.com/companysearchresults/{{company}}',
    notes: 'Zauba Corp has no public API of its own — what shows up calling itself one is a paid third-party scraper, not a free service Zauba offers. This opens their site search for you to check by hand, same as before, rather than scraping a commercial data vendor\'s site automatically.'
  },

  // ── Out of Business ────────────────────────────────────────────────────────
  {
    id: 'oob.general',
    category: 'Out of Business',
    name: 'Out of Business',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("closes operations" OR "closed their doors" OR "closes its doors" OR "closed its doors" OR "files for bankruptcy" OR "bankruptcy" OR "bankrupt") ${EXCLUDE_PB}`,
    expandedSignals: ['ceases operations', 'winds down', 'goes out of business', 'discontinues operations']
  },
  {
    id: 'oob.bankruptcy_us',
    category: 'Out of Business',
    name: 'Bankruptcy (U.S.)',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("ch. 11" OR "ch 11" OR "ch 7" OR "ch. 7" OR "closes their doors" OR "chapter 11" OR "chapter 7" OR "shuts down" OR "dead pool" OR "ends operations" OR "out of business" OR "bankruptcy" OR "bankrupt") ${EXCLUDE_PB}`,
    expandedSignals: ['files chapter 11', 'voluntary bankruptcy', 'debtor-in-possession']
  },
  {
    id: 'oob.bankruptcy_intl',
    category: 'Out of Business',
    name: 'Bankruptcy (Outside U.S.)',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("into administration" OR "enters administration" OR "filing for protection" OR "into receivership" OR "debt reorganizing" OR "debt restructuring") ${EXCLUDE_PB}`,
    expandedSignals: ['insolvency proceedings', 'voluntary liquidation', 'winding up petition', 'corporate insolvency resolution process', 'nclt']
  },
  {
    id: 'oob.acquisition',
    category: 'Out of Business',
    name: 'Acquisition',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("acquired" OR "merged" OR "buyout" OR "merges" OR "merger" OR "lbo" OR "leveraged buyout" OR "acquisition" OR "purchased" OR "acquires" OR "placement") ${EXCLUDE_PB}`,
    expandedSignals: ['agrees to acquire', 'definitive agreement', 'asset purchase']
  },
  {
    id: 'oob.legalname',
    category: 'Out of Business',
    name: 'Legal Name',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("privacy policy" OR "terms of use" OR "legal notice" OR "privacy notice" OR "all rights reserved" OR "registered" OR "trademark") ${EXCLUDE_PB}`,
    expandedSignals: ['doing business as', 'formerly known as', 'trading as']
  },
  {
    id: 'oob.website',
    category: 'Out of Business',
    name: 'Website',
    engine: 'google',
    enabled: true,
    query: '{{entity}} AND (site:bloomberg.com/research OR site:yelp.com OR site:facebook.com OR site:twitter.com OR site:google.com/finance)'
  },

  // ── Spin Out (USO) ─────────────────────────────────────────────────────────
  {
    id: 'uso.spinout',
    category: 'Spin Out (USO)',
    name: 'Spin Out',
    engine: 'google',
    enabled: true,
    query: `{{entity}} AND ("spin out" OR "spun out of" OR "spin off") ${EXCLUDE_PB}`,
    expandedSignals: ['spun off from', 'carved out of', 'divested from']
  },

  // ── Boolean Backup (only when ROVO is down) ────────────────────────────────
  {
    id: 'backup.employees',
    category: 'Boolean Backup',
    name: 'Employee Count',
    engine: 'google',
    enabled: false,
    tag: 'rovo-down',
    query: `{{entity}} AND ("number of employees" OR "total employees" OR "employee count") ${BACKUP_EXCLUSIONS}`,
    expandedSignals: ['headcount', 'workforce of'],
    notes: 'Run only when ROVO is down.'
  },
  {
    id: 'backup.revenue',
    category: 'Boolean Backup',
    name: 'Revenue',
    engine: 'google',
    enabled: false,
    tag: 'rovo-down',
    query: `{{entity}} AND ("gross receipts" OR "revenue" OR "revenues" OR "sales of" OR "in sales" OR "turnover" OR "bookings" OR "annual recurring" OR "run rate") ${BACKUP_EXCLUSIONS}`,
    expandedSignals: ['annual revenue', 'reported revenue'],
    notes: 'Run only when ROVO is down.'
  },
  {
    id: 'backup.ebitda',
    category: 'Boolean Backup',
    name: 'EBITDA',
    engine: 'google',
    enabled: false,
    tag: 'rovo-down',
    query: `{{entity}} AND ("ebitda" OR "ebit" OR "earnings before interest") AND ("million" OR "billion") ${BACKUP_EXCLUSIONS}`,
    expandedSignals: ['adjusted ebitda'],
    notes: 'Run only when ROVO is down.'
  },
  {
    id: 'backup.netincome',
    category: 'Boolean Backup',
    name: 'Net Income',
    engine: 'google',
    enabled: false,
    tag: 'rovo-down',
    query: `{{entity}} AND ("net income" OR "annual income" OR "earnings" OR "profits") AND ("million" OR "billion") ${BACKUP_EXCLUSIONS}`,
    expandedSignals: ['net profit', 'profit after tax', 'bottom line'],
    notes: 'Run only when ROVO is down.'
  }
];

export const CATEGORY_ORDER = [
  'Prior Backing',
  'Entity Recognition',
  'SMI',
  'Site Search',
  'Management',
  'Service Providers',
  'Financials Search',
  'Employee Counts',
  'Out of Business',
  'Spin Out (USO)',
  'Boolean Backup'
];
