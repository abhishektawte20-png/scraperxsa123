"use strict";

/*
 * Reader for the FROZEN Rovo output contract (the agent's "Section 13"
 * strict-JSON schema). Nothing here changes what Rovo produces: it takes
 * that JSON exactly as emitted, checks it against the agent's own written
 * rules (structure, types, null/empty rules, fallback phrases, source
 * policy, key-specific constraints), and translates the RTS-relevant parts
 * into the internal representation the rest of the extension already uses.
 *
 * Findings are split by severity:
 *   error   - a hard rule from Section 13 / Part C is broken. The paste is
 *             rejected with an exact list, so nothing unverified is applied.
 *   warning - a Section 9 style rule or an informational finding (unknown
 *             key, not-for-profit flag). Reported, never silently dropped.
 *
 * This module is pure (no DOM, no storage) and never invents data: a value
 * Rovo marked with a fallback phrase is never turned into an RTS value.
 */
(() => {
  const FALLBACKS = [
    "Not found on the official website.",
    "Not found on the official website — non-English site, partial extraction only.",
    "Not defined in methodology.",
    "Description cannot be generated without violating methodology.",
    "Entity cannot be confidently identified from the official website.",
    "No round identified under PB methodology"
  ];
  const NFP_NOTE = "Incorrect workflow — not-for-profit organisation. Should not be tracked by any team unless published.";
  const PROHIBITED_SUBSTRINGS = ["pitchbook.com", "tracxn.com", "atlassian.net"];
  const PROHIBITED_HOSTS = [
    "pitchbook.com", "tracxn.com", "atlassian.net", "crunchbase.com", "apollo.io", "prospeo.io", "owler.com",
    "cbinsights.com", "dealroom.co", "privco.com", "growjo.com", "craft.co", "golden.com", "harmonic.ai"
  ];
  const PROHIBITED_HOST_WORDS = ["confluence", "sharepoint"];
  const UNIVERSALLY_PROHIBITED_CODES = ["1.4.4", "2.6.3", "2.9.1", "6.1.7", "6.2.2", "6.4.3", "6.5.16"];
  const ALWAYS_SECONDARY_CODES = ["6.5.15", "2.1.4", "2.4.5"];
  const CLASSIFICATION_PREFIXES = ["Manufacturer of", "Provider of", "Operator of", "Developer of", "Designer of", "Retailer of", "Distributor of", "Producer of"];
  const MARKETING_WORDS = ["solution", "solutions", "leading", "best", "top", "premier", "world-class", "trusted", "reliable", "innovative", "cutting-edge", "high-quality", "state-of-the-art", "advanced", "superior"];
  const ROUND_TYPES = [
    "Capitalization", "Grant", "Product Crowdfunding", "Angel", "Pre-Seed", "Seed", "Late Stage VC", "Private Equity / Growth",
    "Corporate Round", "Debt", "Acquisition / Merger", "IPO / Public Listing", "Bankruptcy Admin/Reorg", "Bankruptcy Liquidation",
    "University Spin-Off", "Restart", "Management Buyout"
  ];

  // Leaf markers for the structural template below.
  const S = "string";            // non-empty string
  const N = "nullableString";    // null, or a non-empty string
  const B = "boolean";
  const I = "integer";
  const IS = "intOrString";
  const sourced = { value: S, source_url: S };
  const social = { value: S, source_url: S, note: N };

  const TEMPLATE = {
    extraction_status: S, halt_reason: N, target_domain: S, extraction_date: S,
    domain_confirmation: { domain_provided: S, url_accessed: S, tld_match_confirmed: B },
    not_for_profit_flag: { is_not_for_profit: B, note: S },
    entity_details: { entity_identified: B, official_website: sourced },
    funding: {
      timeline: [{ sequence: I, round_type: S, date: S, amount: S, investors: [S], source_1: S, source_2: N, flag: N }],
      total_rounds_found: I, total_confirmed_funding: S,
      latest_round: { type: S, date: S, amount: S },
      latest_investors: [S], backing_status: S, team_routing: S, routing_logic: S, researcher_note: S,
      out_of_scope_rounds: [{ round_type: S, status: S, date: S, amount: S, key_detail: S, source_url: S, source_type: S }]
    },
    website_links: { pages_traversed: [S], key_links: [{ label: S, url: S }] },
    name_variations: {
      formal_name: sourced, legal_name: sourced, familiar_name: sourced, former_name: sourced,
      other_name_variations: [{ name: S, script: S, source_url: S }]
    },
    site_and_contact: {
      full_address: sourced, city: sourced, state_or_region: sourced, country: sourced, postcode: sourced,
      phone: sourced, fax: sourced, site_email: sourced,
      start_date: { value: S, source_url: S, corroborating_source_url: N, selection_logic: S }
    },
    email_default_structure: { value: S, source_url: S, sample_emails_observed: [S] },
    social_media_identifiers: {
      linkedin: social, twitter_x: social, facebook: social, instagram: social, youtube: social,
      other: [{ platform: S, url: S, source_url: S }]
    },
    management: [{ full_name: S, titles: [S], is_founder: B, regional_title_equivalent: N, source_url: S }],
    industry_classification: {
      buyer_type: { primary: S, evidence_1: { quote: S, source_url: S }, evidence_2: { quote: S, source_url: S } },
      primary_business_activity: S, public_identity_test: S,
      primary_industry_code: { number: S, name: S },
      primary_industry_sector: S,
      evidence_for_primary_code: { quote: S, source_url: S },
      logic: S,
      secondary_industry_codes: [{ number: S, name: S, evidence: { quote: S, source_url: S } }],
      confidence: S, confidence_rationale: S, additional_information_needed: N
    },
    verticals: {
      assigned: [{ vertical_name: S, trigger_evidence: { quote: S, source_url: S }, definition_match_confirmation: S, gate_question_passed: S }],
      evaluated_not_assigned: [{ vertical_name: S, rejection_reason: S }],
      pages_reviewed: [S]
    },
    description: { classification_prefix: S, transition_phrase: S, business_description: S, full_description: S },
    employee_count: {
      current: { count: IS, date: S, source_url: S },
      history: [{ count: IS, date: S, source_url: S }],
      notes: S
    },
    sic_codes: [{ rank: I, best_fit: B, code: S, title: S, relevance: S, source: S }],
    naics_codes: [{ rank: I, best_fit: B, code: S, title: S, relevance: S, source: S }],
    keywords: [S],
    anc: { accepted_used: S, rejected_not_used: S }
  };

  // Arrays the methodology explicitly allows to be empty. Every other array
  // must carry at least one entry ("emit a single object whose value fields
  // carry the fallback phrase").
  const MAY_BE_EMPTY = new Set([
    "funding.timeline", "funding.latest_investors", "management", "employee_count.history",
    "name_variations.other_name_variations", "social_media_identifiers.other", "verticals.assigned",
    "verticals.evaluated_not_assigned", "industry_classification.secondary_industry_codes",
    "email_default_structure.sample_emails_observed", "verticals.pages_reviewed"
  ]);

  // Only fields whose "nothing found" answer is a prescribed fallback phrase
  // are policed for near-miss wording ("N/A", "Not found", ...).
  const FALLBACK_KEYS = new Set(["value", "name", "full_name", "quote", "business_description", "full_description", "classification_prefix", "code", "title"]);
  // Narrative fields that the extension never writes to RTS.
  const INFORMATIONAL_ONLY = /^(employee_count\.notes|funding\.(researcher_note|routing_logic))$/;
  const URL_KEYS = new Set(["source_url", "source_1", "source_2", "url", "corroborating_source_url", "url_accessed"]);

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isFallback(value) {
    return typeof value === "string" && FALLBACKS.includes(value);
  }

  function real(value) {
    return typeof value === "string" && value.trim() && !isFallback(value) ? value.trim() : null;
  }

  function normalizeDomain(value) {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
  }

  function hostOf(value) {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  function hostMatches(host, domain) {
    return host === domain || host === `www.${domain}` || host.endsWith(`.${domain}`);
  }

  function issue(issues, severity, code, path, message) {
    issues.push({ severity, code, path, message });
  }

  function formatIssue(item) {
    return item.path ? `[${item.code}] ${item.path}: ${item.message}` : `[${item.code}] ${item.message}`;
  }

  function parentHasFallback(parent) {
    return isPlainObject(parent) && Object.values(parent).some((v) => isFallback(v));
  }

  // ---------- structural walk ----------

  function walk(template, value, path, issues, parent, key) {
    if (typeof template === "string") {
      checkLeaf(template, value, path, issues, parent, key);
      return;
    }
    if (Array.isArray(template)) {
      if (!Array.isArray(value)) {
        issue(issues, "error", "INVALID_TYPE", path, `must be an array. Received: ${describe(value)}`);
        return;
      }
      if (!value.length && !MAY_BE_EMPTY.has(path)) {
        issue(issues, "error", "EMPTY_ARRAY", path, "must contain at least one entry (use a single entry carrying the prescribed fallback phrase when nothing was found).");
      }
      value.forEach((item, index) => walk(template[0], item, `${path}[${index}]`, issues, value, index));
      return;
    }
    if (!isPlainObject(value)) {
      issue(issues, "error", "INVALID_TYPE", path || "(root)", `must be an object. Received: ${describe(value)}`);
      return;
    }
    for (const name of Object.keys(template)) {
      const childPath = path ? `${path}.${name}` : name;
      if (!(name in value)) {
        issue(issues, "error", "MISSING_KEY", childPath, "is required in every output, even when the value is a fallback phrase.");
        continue;
      }
      walk(template[name], value[name], childPath, issues, value, name);
    }
    for (const name of Object.keys(value)) {
      if (!(name in template)) {
        issue(issues, "warning", "UNKNOWN_FIELD", path ? `${path}.${name}` : name, "is not part of the output contract and was not used.");
      }
    }
  }

  function describe(value) {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }

  function checkLeaf(type, value, path, issues, parent, key) {
    if (type === B) {
      if (typeof value !== "boolean") issue(issues, "error", "INVALID_TYPE", path, `must be a JSON boolean (true/false), not ${describe(value)}.`);
      return;
    }
    if (type === I) {
      if (!Number.isInteger(value)) issue(issues, "error", "INVALID_TYPE", path, `must be an integer. Received: ${describe(value)}.`);
      return;
    }
    if (value === null) {
      if (type === N) return;
      // Rule 5: a source_url may be null only when its paired value is a fallback phrase.
      if (/source_url$/.test(key) && parentHasFallback(parent)) return;
      issue(issues, "error", "NULL_NOT_ALLOWED", path, "null is not permitted here (only halt_reason, source_2, flag, note, corroborating_source_url, regional_title_equivalent, additional_information_needed, or a source_url paired with a fallback phrase).");
      return;
    }
    if (type === IS && Number.isInteger(value)) return;
    if (typeof value !== "string") {
      issue(issues, "error", "INVALID_TYPE", path, `must be a string. Received: ${describe(value)}.`);
      return;
    }
    if (value === "") {
      // Free-text notes that nothing in RTS reads must not block a good report;
      // they are still flagged, because the agent's own rule forbids empty strings.
      if (INFORMATIONAL_ONLY.test(path)) {
        issue(issues, "warning", "EMPTY_STRING", path, "is empty. Nothing from it is used in RTS, so the preview still builds; the agent's rules say empty strings are never permitted.");
      } else {
        issue(issues, "error", "EMPTY_STRING", path, "empty strings are never permitted; use the prescribed fallback phrase.");
      }
      return;
    }
    if (FALLBACK_KEYS.has(key)) {
      if (/^(n\/a|na|unknown|none|null|not available|not applicable)$/i.test(value.trim())) {
        issue(issues, "error", "FALLBACK_NOT_EXACT", path, `"${value}" is not a prescribed fallback phrase.`);
      } else if (/^not found/i.test(value) && !isFallback(value)) {
        issue(issues, "error", "FALLBACK_NOT_EXACT", path, `"${value}" must match the prescribed fallback phrase character for character.`);
      }
    }
    if (/\]\(https?:/i.test(value) || /^\[.+\]\(.+\)$/.test(value)) {
      issue(issues, "error", "MARKDOWN_LINK", path, "contains markdown link syntax; values must be plain text.");
    }
    if (URL_KEYS.has(key) && !isFallback(value)) {
      const host = hostOf(value);
      if (!host || !/^https:\/\//i.test(value)) {
        issue(issues, "error", "URL_INVALID", path, `must be a valid https:// URL. Received: ${describe(value)}.`);
      }
    }
  }

  // ---------- cross-field rules ----------

  function collectStrings(value, path, out) {
    if (typeof value === "string") out.push([path, value]);
    else if (Array.isArray(value)) value.forEach((item, i) => collectStrings(item, `${path}[${i}]`, out));
    else if (isPlainObject(value)) for (const [k, v] of Object.entries(value)) collectStrings(v, path ? `${path}.${k}` : k, out);
  }

  function checkSourcePolicy(src, issues) {
    const strings = [];
    collectStrings(src, "", strings);
    for (const [path, text] of strings) {
      const lower = text.toLowerCase();
      for (const bad of PROHIBITED_SUBSTRINGS) {
        if (lower.includes(bad)) issue(issues, "error", "PROHIBITED_SOURCE", path, `contains "${bad}", a prohibited source. The output must be rejected.`);
      }
      const key = path.split(".").pop().replace(/\[\d+\]$/, "");
      if (URL_KEYS.has(key) || /^https?:\/\//i.test(text)) {
        const host = hostOf(text);
        if (!host) continue;
        const listed = PROHIBITED_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
        const word = PROHIBITED_HOST_WORDS.find((w) => host.includes(w));
        if (listed && !PROHIBITED_SUBSTRINGS.includes(listed)) issue(issues, "error", "PROHIBITED_SOURCE", path, `uses ${host}, a data aggregator / prohibited source.`);
        else if (word) issue(issues, "error", "PROHIBITED_SOURCE", path, `uses ${host}, an internal-system domain.`);
      }
    }
  }

  function checkDomain(src, issues) {
    const target = normalizeDomain(src.target_domain);
    const provided = normalizeDomain(src.domain_confirmation?.domain_provided);
    if (target && provided && target !== provided) {
      issue(issues, "error", "DOMAIN_MISMATCH", "domain_confirmation.domain_provided", `"${src.domain_confirmation.domain_provided}" does not match target_domain "${src.target_domain}" (TLD must match exactly).`);
    }
    const accessed = typeof src.domain_confirmation?.url_accessed === "string" ? hostOf(src.domain_confirmation.url_accessed) : null;
    if (accessed && target && !hostMatches(accessed, target)) {
      issue(issues, "error", "DOMAIN_MISMATCH", "domain_confirmation.url_accessed", `host "${accessed}" is not the target domain "${target}" (a different TLD is a different company).`);
    }
    if (src.domain_confirmation?.tld_match_confirmed === false) {
      issue(issues, "error", "DOMAIN_MISMATCH", "domain_confirmation.tld_match_confirmed", "TLD match was not confirmed.");
    }
    if (src.entity_details?.entity_identified === false) {
      issue(issues, "error", "ENTITY_NOT_IDENTIFIED", "entity_details.entity_identified", "the entity could not be confidently identified from the official website.");
    }
    const siteHost = real(src.entity_details?.official_website?.value) ? hostOf(src.entity_details.official_website.value) : null;
    if (siteHost && target && !hostMatches(siteHost, target)) {
      issue(issues, "error", "DOMAIN_MISMATCH", "entity_details.official_website.value", `host "${siteHost}" is not the target domain "${target}".`);
    }
  }

  function checkFunding(src, issues) {
    const funding = src.funding;
    if (!isPlainObject(funding) || !Array.isArray(funding.timeline)) return;
    if (Number.isInteger(funding.total_rounds_found) && funding.timeline.length !== funding.total_rounds_found) {
      issue(issues, "error", "TIMELINE_COUNT_MISMATCH", "funding.timeline", `has ${funding.timeline.length} row(s) but total_rounds_found is ${funding.total_rounds_found}; they must be equal.`);
    }
    funding.timeline.forEach((round, index) => {
      if (isPlainObject(round) && round.sequence !== index + 1 && Number.isInteger(round.sequence)) {
        issue(issues, "warning", "SEQUENCE_ORDER", `funding.timeline[${index}].sequence`, `expected ${index + 1} (earliest first, numbered from 1).`);
      }
      const type = round?.round_type;
      if (typeof type === "string" && !ROUND_TYPES.includes(type) && !/^Series [A-Z]\+?$/.test(type)) {
        issue(issues, "warning", "ROUND_TYPE_UNRECOGNIZED", `funding.timeline[${index}].round_type`, `"${type}" is not one of the methodology's round types.`);
      }
    });
    if (funding.timeline.length === 0 && Number.isInteger(funding.total_rounds_found) && funding.total_rounds_found === 0) {
      if (funding.backing_status !== "Corporation / Bootstrapped") issue(issues, "error", "CONSTRAINT", "funding.backing_status", 'must be "Corporation / Bootstrapped" when no rounds are confirmed.');
      if (funding.team_routing !== "All-Rounders/Private Company Team") issue(issues, "error", "CONSTRAINT", "funding.team_routing", 'must be "All-Rounders/Private Company Team" when no rounds are confirmed.');
    }
  }

  function checkCodes(list, label, pattern, src, issues) {
    if (!Array.isArray(list) || !list.length) return;
    const first = list[0];
    if (list.length === 1 && typeof first?.title === "string" && first.title.startsWith(`No ${label} code identified`)) return;
    if (list.length > 3) issue(issues, "error", "CONSTRAINT", `${label.toLowerCase()}_codes`, `has ${list.length} entries; the maximum is 3.`);
    const best = list.filter((entry) => entry?.best_fit === true);
    if (best.length !== 1) issue(issues, "error", "CONSTRAINT", `${label.toLowerCase()}_codes`, `must contain exactly one entry with best_fit true (found ${best.length}).`);
    list.forEach((entry, index) => {
      if (!isPlainObject(entry)) return;
      if (entry.rank !== index + 1 && Number.isInteger(entry.rank)) issue(issues, "error", "CONSTRAINT", `${label.toLowerCase()}_codes[${index}].rank`, `must be ${index + 1} (ranked 1..3 in order).`);
      if (typeof entry.code === "string" && entry.code && !pattern.test(entry.code)) {
        issue(issues, "error", "CODE_FORMAT", `${label.toLowerCase()}_codes[${index}].code`, `"${entry.code}" is not a ${label === "SIC" ? "4-digit" : "6-digit"} code.`);
      }
      if (label === "NAICS" && entry.code === "523930") {
        issue(issues, "error", "CONSTRAINT", `naics_codes[${index}].code`, 'NAICS 523930 must be replaced with "523940 — Portfolio Management and Investment Advice".');
      }
    });
  }

  function checkKeywords(src, issues) {
    const keywords = src.keywords;
    if (!Array.isArray(keywords)) return;
    if (keywords.length < 10) issue(issues, "error", "KEYWORD_COUNT", "keywords", `has ${keywords.length}; a minimum of 10 is mandatory.`);
    const seen = new Set();
    keywords.forEach((keyword, index) => {
      if (typeof keyword !== "string") return;
      const words = keyword.trim().split(/\s+/).filter(Boolean);
      if (words.length < 2 || words.length > 3) issue(issues, "error", "KEYWORD_FORMAT", `keywords[${index}]`, `"${keyword}" must be 2–3 words.`);
      if (/solutions?\b/i.test(keyword)) issue(issues, "error", "KEYWORD_FORMAT", `keywords[${index}]`, `"${keyword}" must not contain the word "solution(s)".`);
      if (["business services", "online platform", "digital tools", "customer service", "one stop shop"].includes(keyword.trim().toLowerCase())) {
        issue(issues, "error", "KEYWORD_FORMAT", `keywords[${index}]`, `"${keyword}" is a prohibited generic keyword.`);
      }
      const norm = keyword.trim().toLowerCase();
      if (seen.has(norm)) issue(issues, "warning", "KEYWORD_DUPLICATE", `keywords[${index}]`, `"${keyword}" is repeated.`);
      seen.add(norm);
    });
  }

  function checkIndustry(src, issues) {
    const number = src.industry_classification?.primary_industry_code?.number;
    if (typeof number === "string") {
      if (UNIVERSALLY_PROHIBITED_CODES.includes(number)) issue(issues, "error", "PROHIBITED_CODE", "industry_classification.primary_industry_code.number", `${number} is a deprecated/prohibited industry code.`);
      if (ALWAYS_SECONDARY_CODES.includes(number)) issue(issues, "error", "PROHIBITED_CODE", "industry_classification.primary_industry_code.number", `${number} may only ever be a secondary code, never primary.`);
    }
    (src.industry_classification?.secondary_industry_codes || []).forEach((entry, index) => {
      if (UNIVERSALLY_PROHIBITED_CODES.includes(entry?.number)) issue(issues, "error", "PROHIBITED_CODE", `industry_classification.secondary_industry_codes[${index}].number`, `${entry.number} is a deprecated/prohibited industry code.`);
    });
    (src.verticals?.assigned || []).forEach((entry, index) => {
      if (["tmt", "industrials"].includes(String(entry?.vertical_name).trim().toLowerCase())) {
        issue(issues, "error", "PROHIBITED_VERTICAL", `verticals.assigned[${index}].vertical_name`, `"${entry.vertical_name}" is system-managed and must never be assigned by a researcher/agent.`);
      }
    });
  }

  function checkManagement(src, issues) {
    (src.management || []).forEach((person, index) => {
      if (isPlainObject(person) && Array.isArray(person.titles) && !person.titles.length) {
        issue(issues, "error", "MANAGEMENT_ENTRY", `management[${index}].titles`, "a management entry needs an explicit title; entries without one must not be emitted.");
      }
    });
  }

  // Sources on a different domain than the target. External sources are only
  // allowed for fields missing from the official website, and a page that
  // belongs to another organisation is the classic cross-contamination case,
  // so each foreign host is reported once with the fields that rely on it.
  function checkSourceHosts(src, issues) {
    const target = normalizeDomain(src.target_domain);
    if (!target) return;
    const byHost = new Map();
    const visit = (value, path) => {
      if (typeof value === "string") {
        const key = path.split(".").pop().replace(/\[\d+\]$/, "");
        if (!["source_url", "source_1", "source_2", "corroborating_source_url"].includes(key)) return;
        if (/^funding\./.test(path)) return;
        const host = hostOf(value);
        if (host && !hostMatches(host, target)) (byHost.get(host) || byHost.set(host, []).get(host)).push(path);
      } else if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}[${i}]`));
      else if (isPlainObject(value)) for (const [k, v] of Object.entries(value)) visit(v, path ? `${path}.${k}` : k);
    };
    visit(src, "");
    for (const [host, paths] of byHost) {
      const shown = paths.slice(0, 4).join(", ") + (paths.length > 4 ? `, +${paths.length - 4} more` : "");
      issue(issues, "warning", "EXTERNAL_SOURCE", host, `${paths.length} field(s) are sourced from ${host}, not the official website (${target}): ${shown}. External sources are only for fields missing from the website, and the page must belong to this company. Check it is not another organisation's page.`);
    }
    (src.website_links?.pages_traversed || []).forEach((url, index) => {
      const host = typeof url === "string" ? hostOf(url) : null;
      if (host && !hostMatches(host, target)) issue(issues, "warning", "PAGES_TRAVERSED", `website_links.pages_traversed[${index}]`, `lists ${host}, which is not a page of the official website (${target}).`);
    });
  }

  function checkEmployeeCount(src, issues) {
    const current = src.employee_count?.current;
    const target = normalizeDomain(src.target_domain);
    if (!isPlainObject(current) || typeof current.date !== "string" || typeof current.source_url !== "string") return;
    const host = hostOf(current.source_url);
    if (/website,\s*assumed current/i.test(current.date) && host && target && !hostMatches(host, target)) {
      issue(issues, "warning", "EMPLOYEE_DATE", "employee_count.current.date", `says "assumed current (website)" but the source is ${host}, not the official website. An external count needs the date of that source, and is not extractable without one.`);
    }
  }

  function checkNotForProfit(src, issues) {
    const flag = src.not_for_profit_flag;
    if (!isPlainObject(flag)) return;
    if (flag.is_not_for_profit === true) {
      if (flag.note !== NFP_NOTE) issue(issues, "error", "CONSTRAINT", "not_for_profit_flag.note", `must be exactly: "${NFP_NOTE}"`);
      issue(issues, "warning", "NOT_FOR_PROFIT", "not_for_profit_flag", NFP_NOTE);
    } else if (flag.is_not_for_profit === false && flag.note !== "Not applicable") {
      issue(issues, "error", "CONSTRAINT", "not_for_profit_flag.note", 'must be "Not applicable" when the entity is not a not-for-profit.');
    }
  }

  function checkDescription(src, issues) {
    const d = src.description;
    if (!isPlainObject(d)) return;
    const bd = real(d.business_description);
    const fd = real(d.full_description);
    const prefix = real(d.classification_prefix);
    const companyName = real(src.name_variations?.formal_name?.value);
    if (prefix && !CLASSIFICATION_PREFIXES.includes(prefix)) {
      issue(issues, "warning", "DESCRIPTION_RULE", "description.classification_prefix", `"${prefix}" is not one of: ${CLASSIFICATION_PREFIXES.join(", ")}.`);
    }
    if (bd) {
      if (prefix && !bd.startsWith(prefix)) issue(issues, "warning", "DESCRIPTION_RULE", "description.business_description", `must begin with the classification prefix "${prefix}".`);
      if (/^(is|are) a\b/i.test(bd)) issue(issues, "warning", "DESCRIPTION_RULE", "description.business_description", 'must not begin with "is a / are a".');
      const sentences = bd.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length > 1) issue(issues, "warning", "DESCRIPTION_RULE", "description.business_description", "must be one sentence.");
    }
    if (fd) {
      if (!/^The company/.test(fd)) issue(issues, "warning", "DESCRIPTION_RULE", "description.full_description", 'must begin with "The company".');
      // The methodology asks for one comma "before the enabling/helping/assisting
      // clause", but its own worked examples also use commas inside the product
      // list, so the clause comma is what is checked (not the total).
      if (!/,\s+(enabling|helping|assisting)\b/.test(fd)) {
        issue(issues, "warning", "DESCRIPTION_RULE", "description.full_description", 'must contain a comma before an "enabling / helping / assisting" clause.');
      }
    }
    const transition = real(d.transition_phrase);
    const sameTransition = (bd, phrase) => {
      const text = bd.toLowerCase();
      const wanted = phrase.toLowerCase();
      // "designed for" and "designed to" are the same connecting phrase.
      return text.includes(wanted) || (/^designed (for|to)$/.test(wanted) && /designed (for|to)\b/.test(text));
    };
    if (bd && transition && !sameTransition(bd, transition)) {
      issue(issues, "warning", "DESCRIPTION_RULE", "description.transition_phrase", `"${transition}" does not appear in the business description, so the connecting phrase was misreported.`);
    }
    for (const [label, text] of [["business_description", bd], ["full_description", fd]]) {
      if (!text) continue;
      const hits = MARKETING_WORDS.filter((word) => new RegExp(`(^|[^\\w-])${word}([^\\w-]|$)`, "i").test(text));
      if (hits.length) issue(issues, "warning", "DESCRIPTION_RULE", `description.${label}`, `contains prohibited word(s): ${hits.map((w) => `"${w}"`).join(", ")}.`);
      if (companyName && text.toLowerCase().includes(companyName.toLowerCase())) {
        issue(issues, "warning", "DESCRIPTION_RULE", `description.${label}`, "must not repeat the company name.");
      }
    }
  }

  function checkNames(src, issues) {
    const nv = src.name_variations;
    if (!isPlainObject(nv)) return;
    const formal = real(nv.formal_name?.value);
    const familiar = real(nv.familiar_name?.value);
    if (formal && familiar && formal.toLowerCase() === familiar.toLowerCase()) {
      issue(issues, "error", "NAME_RULE", "name_variations.familiar_name.value", "the Formal Name must never also be listed as the Familiar Name.");
    }
  }

  function checkHalted(src, issues) {
    if (src.extraction_status === "halted") {
      issue(issues, "error", "HALTED", "halt_reason", `Rovo halted the extraction: ${typeof src.halt_reason === "string" ? src.halt_reason : "(no reason given)"}`);
      return true;
    }
    // A missing key is reported by the structural walk as MISSING_KEY, together
    // with every other missing key, instead of aborting here.
    if (src.extraction_status === undefined) return false;
    if (src.extraction_status !== "success") {
      issue(issues, "error", "INVALID_TYPE", "extraction_status", `must be "success" or "halted". Received: ${describe(src.extraction_status)}.`);
      return true;
    }
    if (src.halt_reason !== null && src.halt_reason !== undefined) issue(issues, "error", "CONSTRAINT", "halt_reason", 'must be null when extraction_status is "success".');
    return false;
  }

  // ---------- translation to the internal representation ----------

  const NETWORKS = { linkedin: "LinkedIn", twitter_x: "Twitter/X", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube" };

  function toInternalDocument(src) {
    const nv = src.name_variations || {};
    const formal = real(nv.formal_name?.value);
    const domain = normalizeDomain(src.target_domain);
    const act = "addIfMissing";
    const doc = {
      schemaVersion: "1.0",
      meta: { generatedAt: typeof src.extraction_date === "string" ? src.extraction_date : null, agent: "ScraperX/Rovo", inputFingerprint: null },
      profileIdentity: {
        companyName: formal || real(nv.familiar_name?.value) || real(nv.legal_name?.value) || domain || null,
        formalName: formal, domain: domain || null, pbId: null, entityId: null, sourceRtsUrl: null
      },
      businessEntity: {},
      company: {}
    };

    const site = real(src.entity_details?.official_website?.value);
    if (site) doc.businessEntity.websiteAddresses = [{ value: site, action: act, source: src.entity_details.official_website.source_url ?? null, confidence: null }];

    const variations = [];
    const add = (entry, type) => {
      const name = real(entry?.value);
      if (name) variations.push({ name, type, action: act, source: entry.source_url ?? null, confidence: null });
    };
    add(nv.legal_name, "Legal Name");
    add(nv.familiar_name, "Familiar Name");
    add(nv.former_name, "Former Name");
    for (const other of Array.isArray(nv.other_name_variations) ? nv.other_name_variations : []) {
      const name = real(other?.name);
      if (!name) continue;
      // A name in another script is RTS's "Native Other Name"; a Latin-script
      // variant is "Other Name". The preview shows the type for confirmation.
      const type = real(other.script) ? "Native Other Name" : "Other Name";
      variations.push({ name, type, action: act, source: other.source_url ?? null, confidence: null });
    }
    if (variations.length) doc.businessEntity.nameVariations = variations;

    const eds = real(src.email_default_structure?.value);
    if (eds) doc.businessEntity.emailDefaultStructure = { value: eds, action: act, source: src.email_default_structure.source_url ?? null, confidence: null };

    const smi = [];
    for (const [key, network] of Object.entries(NETWORKS)) {
      const entry = src.social_media_identifiers?.[key];
      const handle = real(entry?.value);
      if (handle) smi.push({ network, handleOrUrl: handle, action: act, source: entry.source_url ?? null, confidence: null });
    }
    for (const other of Array.isArray(src.social_media_identifiers?.other) ? src.social_media_identifiers.other : []) {
      const url = real(other?.url);
      if (url && real(other.platform)) smi.push({ network: other.platform, handleOrUrl: url, action: act, source: other.source_url ?? null, confidence: null });
    }
    if (smi.length) doc.businessEntity.socialMediaIdentifiers = smi;

    const bd = real(src.description?.business_description);
    if (bd) doc.company.briefDescription = { value: bd, action: act, source: null, confidence: null };
    const fd = real(src.description?.full_description);
    if (fd) doc.company.fullDescription = { value: fd, action: act, source: null, confidence: null };
    const keywords = (Array.isArray(src.keywords) ? src.keywords : []).filter((k) => real(k));
    if (keywords.length) doc.company.keywords = keywords.map((value) => ({ value, action: act }));
    // The Rovo "source" for a SIC code is the OSHA manual, not one of RTS's own
    // Source dropdown values, so classificationSource is deliberately left unset.
    const sic = (Array.isArray(src.sic_codes) ? src.sic_codes : []).filter((e) => real(e?.code));
    if (sic.length) doc.company.sicCodes = sic.map((e) => ({ code: e.code, classificationSource: null, action: act, source: null }));
    const naics = (Array.isArray(src.naics_codes) ? src.naics_codes : []).filter((e) => real(e?.code));
    if (naics.length) doc.company.naicsCodes = naics.map((e) => ({ code: e.code, action: act }));

    // Values the agent researched that have no native RTS workflow. They can
    // be tied to an RTS field with "Map this field" (see core/outputFields.js).
    const extras = {};
    const one = (key, entry) => { const v = real(entry?.value); if (v) extras[key] = { value: v, action: act, source: entry.source_url ?? null }; };
    const sc = src.site_and_contact || {};
    one("address", sc.full_address); one("city", sc.city); one("state", sc.state_or_region); one("country", sc.country);
    one("postcode", sc.postcode); one("phone", sc.phone); one("fax", sc.fax); one("siteEmail", sc.site_email); one("startDate", sc.start_date);
    const ic = src.industry_classification?.primary_industry_code;
    if (real(ic?.number)) extras.industryCode = { value: real(ic.name) ? `${ic.number} — ${ic.name}` : ic.number, action: act, source: null };
    const emp = src.employee_count?.current;
    if (real(String(emp?.count ?? ""))) extras.employeeCount = { value: String(emp.count), action: act, source: emp.source_url ?? null };
    const verticals = (src.verticals?.assigned || []).map((v) => v?.vertical_name).filter(real);
    if (verticals.length) extras.verticals = verticals.map((value) => ({ value, action: act }));
    const people = (Array.isArray(src.management) ? src.management : []).filter((m) => real(m?.full_name));
    if (people.length) extras.management = people.map((m) => ({ fullName: m.full_name, title: (m.titles || []).join(", "), action: act, source: m.source_url ?? null }));
    if (Object.keys(extras).length) doc.extras = extras;
    return doc;
  }

  // What Rovo researched that is NOT turned into an RTS action, so useful
  // research is never hidden just because RTS automation isn't evidenced.
  function describeUnmapped(src) {
    const rows = [];
    const row = (section, value, status, detail) => rows.push({ section, value, status, detail });
    const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));

    const formal = src.name_variations?.formal_name;
    row("Formal Name", show(formal?.value), real(formal?.value) ? "INFORMATIONAL" : "NO_VALUE", "The RTS primary Formal Name is the profile's own identity field and is not written by this extension.");
    const f = src.funding;
    if (isPlainObject(f)) {
      row("Funding", `${f.total_rounds_found ?? "?"} round(s); backing: ${show(f.backing_status)}; routing: ${show(f.team_routing)}`, "INFORMATIONAL", "Routing guidance for the researcher; nothing is written to RTS.");
    }
    return rows;
  }

  // ---------- public API ----------

  // The agent's output is recognised by its own top-level keys, not by one
  // particular key: an output that dropped "extraction_status" is still the
  // agent's output (and gets a precise "missing key" error), not a legacy v1.0
  // document.
  const CONTRACT_KEYS = ["extraction_status", "halt_reason", "target_domain", "extraction_date", "domain_confirmation", "not_for_profit_flag", "entity_details", "funding", "website_links", "name_variations", "site_and_contact", "email_default_structure", "social_media_identifiers", "management", "industry_classification", "verticals", "description", "employee_count", "sic_codes", "naics_codes", "keywords"];
  function isContract(parsed) {
    if (!isPlainObject(parsed) || "schemaVersion" in parsed) return false;
    return CONTRACT_KEYS.filter((key) => key in parsed).length >= 2;
  }

  // The content/source/code rules that do not depend on the JSON layout, so
  // the text reader is held to exactly the same methodology checks.
  function analyzeParsed(src, { extraIssues = [], extraRows = [], format = "text" } = {}) {
    const issues = [...extraIssues];
    checkSourcePolicy(src, issues);
    checkDomain(src, issues);
    checkCodes(src.sic_codes, "SIC", /^\d{4}$/, src, issues);
    checkCodes(src.naics_codes, "NAICS", /^\d{6}$/, src, issues);
    checkKeywords(src, issues);
    checkIndustry(src, issues);
    checkManagement(src, issues);
    checkDescription(src, issues);
    checkNames(src, issues);
    const seen = new Set();
    const unique = issues.filter((i) => {
      const key = `${i.severity}|${i.code}|${i.path}|${i.message}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
    const hasErrors = unique.some((i) => i.severity === "error");
    return {
      issues: unique,
      document: hasErrors ? null : toInternalDocument(src),
      rows: hasErrors ? [] : [...describeUnmapped(src), ...extraRows],
      halted: false,
      notForProfit: false,
      format
    };
  }

  const HEADER_KEYS = ["extraction_status", "halt_reason", "target_domain", "extraction_date", "domain_confirmation"];

  // If the agent left out the five header keys, the researcher's own domain
  // (entered in the panel) stands in for them, and every source is still
  // checked against that domain. Nothing here is ever written to RTS.
  function fillHeader(src, domain, issues) {
    const missing = HEADER_KEYS.filter((key) => !(key in src));
    const target = normalizeDomain(domain);
    if (!missing.length || !target || src.extraction_status === "halted") return src;
    const site = real(src.entity_details?.official_website?.value);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const filled = {
      extraction_status: "success", halt_reason: null, target_domain: target,
      extraction_date: `${String(now.getDate()).padStart(2, "0")} ${months[now.getMonth()]} ${now.getFullYear()}`,
      domain_confirmation: { domain_provided: target, url_accessed: site || `https://${target}`, tld_match_confirmed: true }
    };
    for (const key of missing) src = { ...src, [key]: filled[key] };
    issue(issues, "warning", "HEADER_MISSING", "", `the agent left out ${missing.join(", ")}. The domain you entered (${target}) was used instead, and every source below was checked against it.`);
    return src;
  }

  function analyze(srcIn, options = {}) {
    const issues = [];
    const src = fillHeader(srcIn, options.domain, issues);
    const halted = checkHalted(src, issues);
    if (halted) {
      return { issues, document: null, rows: [], halted: true, notForProfit: false };
    }
    walk(TEMPLATE, src, "", issues, null, "");
    checkSourcePolicy(src, issues);
    checkDomain(src, issues);
    checkFunding(src, issues);
    checkCodes(src.sic_codes, "SIC", /^\d{4}$/, src, issues);
    checkCodes(src.naics_codes, "NAICS", /^\d{6}$/, src, issues);
    checkKeywords(src, issues);
    checkIndustry(src, issues);
    checkManagement(src, issues);
    checkSourceHosts(src, issues);
    checkEmployeeCount(src, issues);
    checkNotForProfit(src, issues);
    checkDescription(src, issues);
    checkNames(src, issues);

    const hasErrors = issues.some((i) => i.severity === "error");
    return {
      issues,
      document: hasErrors ? null : toInternalDocument(src),
      rows: hasErrors ? [] : describeUnmapped(src),
      halted: false,
      notForProfit: src.not_for_profit_flag?.is_not_for_profit === true,
      format: "json"
    };
  }

  // How to fix each kind of finding, in the agent's own terms. These restate
  // the existing rules; they never add to or change the methodology.
  const FIX_HINTS = {
    SECTION_MISSING: "Include this section under its exact heading. If nothing was found, still include it using the prescribed fallback phrase.",
    DOMAIN_CONFIRMATION_MISSING: "Write CONFIRMATION 1, 2 and 3 exactly as specified; CONFIRMATION 2 must contain the full URL you accessed, starting with https://.",
    DOMAIN_MISMATCH: "Only the exact provided domain, including its TLD, may be accessed and used.",
    MISSING_SOURCE: "Give this field its own line directly under it: \"Source: <full https:// URL>\". If no valid source exists, return the prescribed fallback phrase instead of a value.",
    KEYWORD_COUNT: "Return at least 10 keywords.",
    KEYWORD_FORMAT: "Each keyword must be 2-3 words naming a product, service or market. Put the keywords on one line separated by commas.",
    DESCRIPTION_RULE: "Follow the Business Description / Full Description structure: exactly two sentences, each on its own line, the second beginning \"The company\".",
    FALLBACK_NOT_EXACT: "Use the prescribed fallback phrase character for character; never N/A, unknown or a paraphrase.",
    PROHIBITED_SOURCE: "Remove this source and use only valid sources; data aggregators and internal systems are never allowed.",
    PROHIBITED_CODE: "Use only an approved, non-prohibited industry code.",
    CODE_FORMAT: "SIC codes are 4 digits and NAICS codes 6 digits, with the exact manual title.",
    TIMELINE_COUNT_MISMATCH: "Total Rounds Found must equal the number of rounds listed in the timeline.",
    CONSTRAINT: "Follow the stated output constraint exactly.",
    MARKDOWN_LINK: "Return plain text and plain URLs only.",
    NULL_NOT_ALLOWED: "Use the prescribed fallback phrase instead of null here.",
    EMPTY_STRING: "Use the prescribed fallback phrase instead of an empty value.",
    MISSING_KEY: "Include every key of the output format, even when its value is a fallback phrase. The object must begin with extraction_status, halt_reason, target_domain, extraction_date and domain_confirmation.",
    URL_INVALID: "Provide a full, valid https:// URL.",
    EXTERNAL_SOURCE: "Use a page on the official website. Use an external page only for a field that is not on the website, and only if it displays this company's domain.",
    PAGES_TRAVERSED: "List only pages of the official website.",
    EMPLOYEE_DATE: "Use the date of the external source, or the fallback phrase if it has no date.",
    HEADER_MISSING: "Start the object with extraction_status, halt_reason, target_domain, extraction_date and domain_confirmation."
  };

  // A message for the researcher to send back to Rovo. It restates the
  // violations (with how to fix each) only; it never restates or alters the
  // methodology itself.
  // Warnings that point at a real methodology problem are sent back too, so one
  // correction pass fixes everything the extension noticed.
  const REVIEW = ["EXTERNAL_SOURCE", "PAGES_TRAVERSED", "EMPLOYEE_DATE", "HEADER_MISSING", "DESCRIPTION_RULE", "FIELD_MISSING", "LEGAL_NAME_SUFFIX"];
  const reviewIssues = (issues) => issues.filter((i) => i.severity === "warning" && REVIEW.includes(i.code));

  function buildCorrectionPrompt(issues, domain, format = "json") {
    const errors = issues.filter((i) => i.severity === "error").slice(0, 40);
    const review = reviewIssues(issues).slice(0, 20);
    const shape = format === "text" ? "the corrected output in the same section format, with the same headings, labels and fallback phrases as always" : "only the corrected JSON object, with the same schema, keys and fallback phrases as always";
    return [
      `Your previous output for ${domain || "this domain"} broke the output rules and methodology. Start a fresh session reset, redo the extraction, and return ${shape}.`,
      "",
      ...(errors.length ? ["Fix exactly these problems:"] : []),
      ...errors.map((item, index) => `${index + 1}. ${formatIssue(item)}${FIX_HINTS[item.code] ? `\n   How to fix: ${FIX_HINTS[item.code]}` : ""}`),
      ...(review.length ? ["", errors.length ? "Also fix these (they broke your methodology even though they did not stop the output being read):" : "Fix these (the output could be read, but they broke your methodology):", ...review.map((item, index) => `${index + 1}. ${formatIssue(item)}${FIX_HINTS[item.code] ? `\n   How to fix: ${FIX_HINTS[item.code]}` : ""}`)] : [])
    ].join("\n");
  }

  // For output that could not be read at all (no JSON or report found, broken JSON,
  // markdown links, not the agent's format). The exact output format is resent in
  // full, because the agent clearly did not follow it.
  function buildFormatCorrectionPrompt(reasons, domain, runPrompt) {
    return [
      `Your previous output for ${domain || "this domain"} could not be read because it was not in the required output format:`,
      ...reasons.slice(0, 5).map((reason) => `- ${reason}`),
      "",
      "Start a fresh session reset, redo the extraction, and return ONLY the answer in the exact output format below. Nothing before or after it, no markdown links, no commentary.",
      "",
      runPrompt
    ].join("\n");
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.rovoContract = { isContract, analyze, analyzeParsed, formatIssue, buildCorrectionPrompt, buildFormatCorrectionPrompt, reviewIssues, FALLBACKS, TEMPLATE, normalizeDomain, isFallback, real, hostOf, hostMatches, CLASSIFICATION_PREFIXES, UNIVERSALLY_PROHIBITED_CODES, issue };
})();
