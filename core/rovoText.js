"use strict";

/*
 * Reader for the Rovo agent's SECTION-format text output (the human-readable
 * "SECTION 1: Entity Details ... KEYWORDS ... ANC" report). Deterministic:
 * no AI and no guessing. It
 *   1. cuts the noise: everything before the last "SECTION 1:" heading
 *      (echoed instructions, chat preamble) and everything from the ANC block
 *      on is ignored;
 *   2. splits the report into its sections and reads "Label: value" lines,
 *      with indented "Source:" / "Logic:" / "Relevance:" lines attached to the
 *      field above them (markdown bold, backticks and [text](url) links are
 *      reduced to plain text and the real URL);
 *   3. builds the same Section-13-shaped object the JSON reader produces, so
 *      the very same methodology checks, translation to RTS and preview run.
 * Anything it cannot recognise is reported, never silently mapped.
 */
(() => {
  const C = () => globalThis.SXRTS.rovoContract;

  const HALT_PHRASES = [
    "Invalid source detected. Extraction failed due to violation of source policy.",
    "Conflicting information detected across sources; extraction halted to prevent data contamination.",
    "Official website at provided domain is inaccessible. Extraction cannot proceed without researcher confirmation of correct domain."
  ];

  const SECTION_KEYS = {
    "1": "entity", "1B": "funding", "2": "links", "3": "names", "4": "site", "6": "smi", "7": "management",
    "8": "industry", "8B": "industry", "9": "description"
  };
  const PSEUDO_HEADINGS = {
    "EMPLOYEE COUNT": "employees", "SIC CODES": "sic", "NAICS CODES": "naics", "KEYWORDS": "keywords"
  };
  const PLAIN_SECTIONS = new Set(["description", "keywords"]);
  // Labels that belong to the field above them, per section (so a flattened
  // paste that lost its indentation is still read correctly).
  const SUB_LABELS = {
    names: ["source", "note"], site: ["source", "logic", "note"], smi: ["source", "note"], management: [],
    industry: ["evidence", "source", "trigger evidence", "definition match confirmation"],
    sic: ["relevance", "source"], naics: ["relevance", "source"], entity: [], funding: [], links: [], employees: []
  };
  const SMI_LABELS = { linkedin: "linkedin", "twitter/x": "twitter_x", twitter: "twitter_x", x: "twitter_x", facebook: "facebook", instagram: "instagram", youtube: "youtube" };
  const GENERIC_MAILBOXES = ["info", "contact", "hello", "support", "sales", "admin", "office", "enquiries", "inquiries", "mail", "team", "service", "help", "careers", "hr", "press", "marketing", "accounts", "billing", "customerservice", "customercare"];
  const HEDGES = /\b(appears?|possibly|probably|likely|may be|might|seems?|presumably|legacy|shared)\b/i;
  const LEGAL_SUFFIXES = /\b(inc\.?|incorporated|llc|l\.l\.c\.?|ltd\.?|limited|gmbh|s\.l\.?|sl|pvt\.?|private limited|co\.?|company|kg|b\.v\.?|bv|corp\.?|corporation|llp|plc|ag|s\.a\.?|sa|sas|s\.r\.l\.?|srl|oy|ab|as|a\/s|pty|pte|oü|nv|n\.v\.?|ou|kk|k\.k\.|sdn bhd|bhd|ltda|e\.u\.?|ug|ohg|se|spa|s\.p\.a\.?)(?=[\s,.)]|$)/i;

  // ---------- low-level text handling ----------

  function stripMarkdown(text) {
    return text
      .replace(/\\([*_`\[\]()#|~>])/g, "$1")
      .replace(/\[([^\]]*)\]\(\s*(?:mailto:)?([^)\s]+)\s*\)/g, "$2")
      .replace(/\*\*|__/g, "")
      .replace(/`/g, "")
      .replace(/\s*\[\d+\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseLine(raw) {
    const line = raw.replace(/\t/g, "    ").replace(/[​-‏⁠﻿]/g, "").replace(/\s+$/, "");
    const match = line.match(/^(\s*)(?:#+\s*)?([*\-•]\s+|\d+[.)]\s+)?(.*)$/);
    return { indent: match[1].length, marker: match[2] ? (/\d/.test(match[2]) ? "num" : "bullet") : null, text: stripMarkdown(match[3]), raw: line };
  }

  function splitLabel(text) {
    const match = text.match(/^([A-Za-z][A-Za-z0-9 /&()'’.,\-]{0,70}?):(?:\s+(.*))?$/);
    if (!match || /^https?$/i.test(match[1]) || match[1].includes("://")) return { label: null, value: text };
    return { label: match[1].trim(), value: (match[2] ?? "").trim() };
  }

  function labelKey(label) {
    const key = (label || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    return /^sources?( url| link| urls)?( 1)?$/.test(key) ? "source" : key;
  }

  const TRAIL = /[.,;:]+$/;
  // A full URL, or (with {bare:true}) a bare host/path such as
  // "www.psypher.in/about", which is read as https://<that>.
  function urlOf(text, { bare = false } = {}) {
    if (typeof text !== "string") return null;
    const full = text.match(/https?:\/\/[^\s)>\]|\\]+/i);
    if (full) return full[0].replace(TRAIL, "");
    if (!bare) return null;
    const host = text.match(/(?:^|[\s(|—–])((?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s)>\]|\\]*)?)/i);
    return host ? `https://${host[1].replace(TRAIL, "")}` : null;
  }

  // "Value | Source: https://..." / "Value (Source: ...)" on one line.
  function splitInlineSource(value) {
    const match = typeof value === "string" ? value.match(/^(.*?)\s*[|(—–;-]?\s*\bsources?(?:\s+url)?\s*[:=]\s*(.+?)\)?\s*$/i) : null;
    return match && match[1] ? { value: match[1].replace(/[|(—–;\s-]+$/, "").trim(), source: match[2].trim() } : { value, source: null };
  }

  function parseSource(text) {
    if (!text) return { url: null, text: "" };
    const url = urlOf(text, { bare: true });
    return { url, text: text.trim() };
  }

  // ---------- noise removal ----------

  function extractBlock(raw) {
    const cleaned = raw.replace(/\r\n?/g, "\n");
    const lines = cleaned.split("\n");
    const headingRe = /^\s*(?:#+\s*)?(?:\*\*)?\s*SECTION\s+1\s*[:\-—]/i;
    let start = -1;
    lines.forEach((line, index) => { if (headingRe.test(line)) start = index; });
    let end = lines.length;
    const ancAt = lines.findIndex((line, index) => index > start && /ACCEPTED\s*\/\s*USED/i.test(line));
    const ancPresent = ancAt !== -1;
    if (ancPresent) end = ancAt;
    return { lines: lines.slice(Math.max(start, 0), end), ignoredBefore: Math.max(start, 0), ancPresent, start };
  }

  function isText(raw) {
    if (typeof raw !== "string") return false;
    const stripped = raw.trim().replace(/^```(?:\w+)?\s*/, "");
    if (stripped.startsWith("{")) return false;
    return (raw.match(/^\s*(?:#+\s*)?(?:\*\*)?\s*SECTION\s+\d+[A-Z]?\s*[:\-—]/gim) || []).length >= 2 || HALT_PHRASES.some((phrase) => raw.includes(phrase));
  }

  // ---------- sectioning ----------

  // Headings are routed by their title, so a section keeps working even if the
  // agent numbers it differently (e.g. "SECTION 10: Employee Count").
  function routeByTitle(title) {
    const t = title.toLowerCase();
    if (/entity details/.test(t)) return "entity";
    if (/rounds|funding/.test(t)) return "funding";
    if (/website links/.test(t)) return "links";
    if (/name variation/.test(t)) return "names";
    if (/site address|start date|email default/.test(t)) return "site";
    if (/social media|smis?\b/.test(t)) return "smi";
    if (/management/.test(t)) return "management";
    if (/industry code|vertical/.test(t)) return "industry";
    if (/employee count|headcount/.test(t)) return "employees";
    if (/\bnaics\b/.test(t)) return "naics";
    if (/\bsic\b/.test(t)) return "sic";
    if (/description/.test(t)) return "description";
    if (/^keywords?\b/.test(t)) return "keywords";
    return null;
  }

  function splitSections(lines, unrecognized) {
    const sections = {};
    let current = "preamble";
    const push = (key, line) => { (sections[key] ||= []).push(line); };
    for (const raw of lines) {
      const line = parseLine(raw);
      if (!line.text) continue;
      const heading = line.text.match(/^SECTION\s+(\d+[A-Z]?)\s*[:\-—]\s*(.*)$/i);
      if (heading) {
        const key = routeByTitle(heading[2]) || SECTION_KEYS[heading[1].toUpperCase()];
        if (key) current = key;
        else { current = "other"; unrecognized.push(`SECTION ${heading[1]}: ${heading[2]}`.slice(0, 80)); }
        if (key === "industry" && heading[1].toUpperCase() === "8B") push(current, { ...line, text: "Verticals Assigned:" });
        continue;
      }
      const pseudo = line.text.match(/^(EMPLOYEE COUNT|SIC CODES?|NAICS CODES?|KEYWORDS?)\s*(?:\([^)]*\))?\s*(?::\s*(.*))?$/i);
      if (pseudo) {
        const name = pseudo[1].toUpperCase().replace(/CODE$/, "CODES").replace(/^KEYWORD$/, "KEYWORDS");
        current = PSEUDO_HEADINGS[name];
        if (pseudo[2]) push(current, { ...line, text: pseudo[2], indent: 0 });
        continue;
      }
      push(current, line);
    }
    return sections;
  }

  function buildEntries(key, lines) {
    const entries = [];
    const subs = SUB_LABELS[key] || [];
    for (const line of lines) {
      const { label, value } = PLAIN_SECTIONS.has(key) ? { label: null, value: line.text } : splitLabel(line.text);
      const top = entries[entries.length - 1];
      const isSub = top && (line.indent > top.indent || (label && subs.includes(labelKey(label)) && top.label !== undefined));
      const item = { label, key: labelKey(label), value, text: line.text, indent: line.indent, marker: line.marker, subs: [] };
      if (isSub) top.subs.push(item);
      else entries.push(item);
    }
    return entries;
  }

  const find = (entries, key) => entries.find((entry) => entry.key === key);
  const findAll = (entries, key) => entries.filter((entry) => entry.key === key);
  const subOf = (entry, key) => entry?.subs.find((sub) => sub.key === key);

  // ---------- field helpers ----------

  const FB = () => C().FALLBACKS[0];
  const NOT_FOUND = () => ({ value: FB(), source_url: null });

  function checkNearMiss(path, value, issues) {
    if (typeof value === "string" && /^(n\/a|na|unknown|none|not available)\.?$/i.test(value.trim())) {
      C().issue(issues, "error", "FALLBACK_NOT_EXACT", path, `"${value}" is not a prescribed fallback phrase.`);
    } else if (typeof value === "string" && /^not found/i.test(value) && !C().isFallback(value)) {
      C().issue(issues, "error", "FALLBACK_NOT_EXACT", path, `"${value}" must match the prescribed fallback phrase character for character.`);
    }
  }

  // A value + its source, with the methodology's per-field sourcing rule.
  function sourced(entry, path, issues, notes, { requireSource = true, warnMissing = true } = {}) {
    if (!entry) {
      if (warnMissing) C().issue(issues, "warning", "FIELD_MISSING", path, "was not found in the output.");
      return NOT_FOUND();
    }
    const inline = splitInlineSource(entry.value);
    const value = inline.value;
    checkNearMiss(path, value, issues);
    if (!value || C().isFallback(value)) return NOT_FOUND();
    const src = parseSource(subOf(entry, "source")?.value || inline.source);
    const note = [subOf(entry, "note")?.value, src.url ? src.text.replace(src.url, "").replace(/^[\s(]+|[\s)]+$/g, "") : src.text].filter(Boolean).join(" ");
    if (requireSource && !src.url) {
      C().issue(issues, "error", "MISSING_SOURCE", `${path}.source`, "a value needs its own source URL (every extracted field is sourced at field level).");
    }
    if (src.url) notes.push({ path, url: src.url, text: `${note} ${value}` });
    return { value, source_url: src.url };
  }

  function mapEds(value, basisEmail) {
    const domainPart = (value.match(/@(.+)$/) || [])[1];
    if (!domainPart) return null;
    const pattern = value.replace(/@.*$/, "").toLowerCase().replace(/\s+/g, "");
    const table = { "{first}": "FirstName", "{first}.{last}": "First.Last", "{first}_{last}": "First_Last", "{f}{last}": "FirstInitialLastName", "{firstinitial}{last}": "FirstInitialLastName" };
    return table[pattern] ? `${table[pattern]}@domain.com` : null;
  }

  // ---------- the reader ----------

  function analyze(raw) {
    const issues = [];
    const extraRows = [];
    const notes = [];
    const { lines, ignoredBefore, ancPresent, start } = extractBlock(raw);
    const text = lines.join("\n");

    if (start === -1) {
      const halt = HALT_PHRASES.find((phrase) => raw.includes(phrase));
      if (halt) {
        C().issue(issues, "error", "HALTED", "halt_reason", `Rovo halted the extraction: ${halt}`);
        return { issues, document: null, rows: [], halted: true, notForProfit: false, format: "text", ignoredLines: 0 };
      }
      C().issue(issues, "error", "SECTION_MISSING", "SECTION 1", 'no "SECTION 1:" heading was found, so the output could not be located.');
      return { issues, document: null, rows: [], halted: false, notForProfit: false, format: "text", ignoredLines: 0 };
    }
    const haltInside = HALT_PHRASES.find((phrase) => lines.some((l) => stripMarkdown(l) === phrase));
    if (haltInside) {
      C().issue(issues, "error", "HALTED", "halt_reason", `Rovo halted the extraction: ${haltInside}`);
      return { issues, document: null, rows: [], halted: true, notForProfit: false, format: "text", ignoredLines: ignoredBefore };
    }

    const unrecognized = [];
    const sections = splitSections(lines, unrecognized);
    const entries = Object.fromEntries(Object.keys(sections).map((key) => [key, buildEntries(key, sections[key])]));

    for (const [key, label] of [["entity", "SECTION 1: Entity Details"], ["names", "SECTION 3: Name variations"], ["site", "SECTION 4: Site address, start date and Email default structure"],
      ["smi", "SECTION 6: Social Media Identifiers"], ["management", "SECTION 7: Management"], ["industry", "SECTION 8: Industry Code, Vertical, and Keywords"],
      ["description", "SECTION 9: Full Description"], ["employees", "EMPLOYEE COUNT"], ["sic", "SIC CODES"], ["naics", "NAICS CODES"], ["keywords", "KEYWORDS"]]) {
      if (!entries[key]?.length) C().issue(issues, "error", "SECTION_MISSING", label, "this section is required in every output (even when its values are fallback phrases).");
    }
    for (const [key, label] of [["funding", "SECTION 1B: In-Scope Rounds Extraction"], ["links", "SECTION 2: Important website links"]]) {
      if (!entries[key]?.length) C().issue(issues, "warning", "SECTION_MISSING", label, "was not found in the output.");
    }
    for (const line of unrecognized) C().issue(issues, "warning", "UNKNOWN_FIELD", line, "is not a recognised section and was not used.");

    // ----- Section 1: domain lock + backing -----
    const entity = entries.entity || [];
    const confirmation = (n) => entity.find((e) => new RegExp(`^confirmation ${n}$`).test(e.key));
    const domainText = confirmation(1)?.value || "";
    const domainMatch = domainText.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
    const accessedUrl = urlOf(confirmation(2)?.value || "", { bare: true });
    const targetDomain = domainMatch ? domainMatch[1].toLowerCase() : "";
    if (!confirmation(1) || !confirmation(2) || !confirmation(3)) {
      C().issue(issues, "error", "DOMAIN_CONFIRMATION_MISSING", "SECTION 1", "CONFIRMATION 1, 2 and 3 (the domain lock) must all be present.");
    }
    if (confirmation(1) && !targetDomain) C().issue(issues, "error", "DOMAIN_CONFIRMATION_MISSING", "CONFIRMATION 1", "the exact domain provided could not be read.");
    if (confirmation(2) && !accessedUrl) C().issue(issues, "error", "DOMAIN_CONFIRMATION_MISSING", "CONFIRMATION 2", "the exact URL accessed could not be read.");

    const funding = entries.funding || [];
    const fundingInfo = (key) => find(funding, key)?.value || find(entity, key)?.value || "";
    const timelineRows = funding.filter((e) => /^\|?\s*\d+\s*\|/.test(e.text));
    const totalRounds = parseInt((find(funding, "total rounds found")?.value || "").replace(/[^\d]/g, ""), 10);
    if (Number.isInteger(totalRounds) && timelineRows.length !== totalRounds) {
      C().issue(issues, "error", "TIMELINE_COUNT_MISMATCH", "FUNDING TIMELINE", `lists ${timelineRows.length} round(s) but Total Rounds Found is ${totalRounds}; they must be equal.`);
    }
    for (const row of timelineRows) notes.push({ path: "FUNDING TIMELINE", url: urlOf(row.text), text: row.text });

    // ----- Section 3: names -----
    const names = entries.names || [];
    const other = [];
    for (const entry of findAll(names, "other name variation").concat(findAll(names, "other name variations"))) {
      const inline = splitInlineSource(entry.value);
      if (!inline.value || C().isFallback(inline.value)) continue;
      const src = parseSource(subOf(entry, "source")?.value || inline.source);
      if (!src.url) C().issue(issues, "error", "MISSING_SOURCE", "name_variations.other_name_variations.source", "a name needs its own source URL.");
      other.push({ name: inline.value, script: /[^\u0000-ɏ]/.test(inline.value) ? "Non-Latin script" : NOT_FOUND().value, source_url: src.url });
    }
    const nameSrc = {
      formal_name: sourced(find(names, "formal name"), "name_variations.formal_name", issues, notes),
      legal_name: sourced(find(names, "legal name"), "name_variations.legal_name", issues, notes),
      familiar_name: sourced(find(names, "familiar name"), "name_variations.familiar_name", issues, notes),
      former_name: sourced(find(names, "former name"), "name_variations.former_name", issues, notes),
      other_name_variations: other
    };
    if (!find(names, "other name variation") && !find(names, "other name variations")) C().issue(issues, "warning", "FIELD_MISSING", "name_variations.other_name_variations", "was not found in the output.");
    if (C().real(nameSrc.legal_name.value) && !LEGAL_SUFFIXES.test(nameSrc.legal_name.value)) {
      C().issue(issues, "warning", "LEGAL_NAME_SUFFIX", "name_variations.legal_name", `"${nameSrc.legal_name.value}" has no recognisable legal suffix; a Legal Name must always carry its legal tail.`);
    }

    // ----- Section 4: site, start date, EDS -----
    const site = entries.site || [];
    // Only the full address is required; the agent may list its parts too.
    const siteField = (key, path, warnMissing = false) => sourced(find(site, key), `site_and_contact.${path}`, issues, notes, { warnMissing });
    const siteSrc = {
      full_address: siteField("address", "full_address"), city: siteField("city", "city"), state_or_region: siteField("state", "state_or_region"),
      country: siteField("country", "country"), postcode: siteField("postcode", "postcode"), phone: siteField("phone", "phone"), fax: siteField("fax", "fax"),
      site_email: siteField("site email", "site_email"),
      start_date: { ...siteField("start date", "start_date"), corroborating_source_url: null, selection_logic: subOf(find(site, "start date"), "logic")?.value || "" }
    };
    for (const key of ["address", "start date", "site email", "email default structure"]) {
      if (!find(site, key)) C().issue(issues, "warning", "FIELD_MISSING", `site.${key}`, "was not found in the output.");
    }
    const edsEntry = find(site, "email default structure") || find(site, "eds");
    let eds = NOT_FOUND();
    if (edsEntry && edsEntry.value && !C().isFallback(edsEntry.value)) {
      const src = parseSource(subOf(edsEntry, "source")?.value || splitInlineSource(edsEntry.value).source);
      if (!src.url) C().issue(issues, "error", "MISSING_SOURCE", "email_default_structure.source", "the Email Default Structure needs its own source URL.");
      const pattern = edsEntry.value.split(/\s+\(/)[0].trim();
      const basis = (edsEntry.value.match(/based on\s+([^\s)]+@[^\s)]+)/i) || [])[1] || "";
      const generic = basis && GENERIC_MAILBOXES.includes(basis.split("@")[0].toLowerCase().replace(/[^a-z]/g, ""));
      const label = mapEds(pattern);
      if (generic) {
        extraRows.push({ section: "Email Default Structure", value: `${pattern} (based on ${basis})`, status: "REVIEW_REQUIRED", detail: `Derived from a generic mailbox (${basis}), not a personal address, so it is not written to RTS automatically.` });
      } else if (!label) {
        extraRows.push({ section: "Email Default Structure", value: pattern, status: "REVIEW_REQUIRED", detail: "This pattern does not map exactly to one of the RTS Email Default Structure options, so it is not written automatically." });
      } else {
        eds = { value: label, source_url: src.url, sample_emails_observed: basis ? [basis] : [] };
      }
    }
    const emailDefault = { value: eds.value, source_url: eds.source_url, sample_emails_observed: eds.sample_emails_observed || [] };

    // ----- Section 6: SMIs -----
    const smi = { other: [] };
    for (const entry of entries.smi || []) {
      const mapped = SMI_LABELS[entry.key];
      if (!entry.label) continue;
      const inline = splitInlineSource(entry.value);
      const value = inline.value;
      checkNearMiss(`social_media_identifiers.${entry.key}`, value, issues);
      const url = urlOf(value, { bare: true });
      const src = parseSource(subOf(entry, "source")?.value || inline.source);
      const note = subOf(entry, "note")?.value || null;
      if (value && !C().isFallback(value) && !src.url) C().issue(issues, "error", "MISSING_SOURCE", `social_media_identifiers.${entry.key}.source`, "an SMI needs its own source URL.");
      if (src.url) notes.push({ path: `social_media_identifiers.${entry.key}`, url: src.url, text: `${note || ""} ${src.text}` });
      const real = value && !C().isFallback(value);
      if (mapped) smi[mapped] = real ? { value: url || value, source_url: src.url, note } : { value: FB(), source_url: null, note: null };
      else if (real && url) smi.other.push({ platform: entry.label, url, source_url: src.url });
    }
    for (const field of ["linkedin", "twitter_x", "facebook", "instagram", "youtube"]) {
      if (!smi[field]) {
        smi[field] = { value: FB(), source_url: null, note: null };
        if (["linkedin", "twitter_x", "facebook"].includes(field)) C().issue(issues, "warning", "FIELD_MISSING", `social_media_identifiers.${field}`, "was not found in the output.");
      }
    }

    // ----- Section 7: management -----
    const people = [];
    let person = null;
    const readSource = (entry) => { const src = parseSource(entry.value); person.source_url = src.url; person.srcText = src.text; };
    for (const entry of entries.management || []) {
      if (entry.key === "name") { person = { full_name: entry.value, titles: [], is_founder: false, regional_title_equivalent: null, source_url: null, srcText: "" }; people.push(person); }
      else if (person && entry.key === "title") person.titles = entry.value.split(/\s*(?:,|\/|&|\band\b)\s*/i).filter(Boolean);
      else if (person && entry.key === "source") readSource(entry);
      else if (!C().isFallback(entry.text)) C().issue(issues, "warning", "UNKNOWN_FIELD", "SECTION 7", `"${entry.text.slice(0, 60)}" was not recognised.`);
      // a Source indented under its person's Name/Title line
      for (const sub of entry.subs) if (person && sub.key === "source") readSource(sub);
    }
    const management = people.filter((p) => p.full_name && !C().isFallback(p.full_name));
    for (const p of management) {
      p.is_founder = p.titles.some((t) => /founder/i.test(t));
      if (!p.source_url) C().issue(issues, "error", "MISSING_SOURCE", `management.${p.full_name}.source`, "a management entry needs a source URL on the official website.");
      if (p.source_url) notes.push({ path: `management.${p.full_name}`, url: p.source_url, text: p.srcText });
    }

    // ----- Section 8: industry + verticals -----
    const industry = entries.industry || [];
    const buyer = find(industry, "primary buyer type");
    const codeEntry = find(industry, "primary industry code");
    const codeMatch = (codeEntry?.value || "").match(/^(\d+(?:\.\d+)*)\s*[—–-]\s*(.+)$/);
    const evidenceFor = find(industry, "evidence for primary code");
    const secondaryRaw = find(industry, "secondary industry code") || find(industry, "secondary industry codes");
    const secondary = [];
    for (const part of (secondaryRaw?.value || "").split(/\s*;\s*/).filter((p) => p && !/^(none|not applicable)\.?$/i.test(p))) {
      const [codePart, evidencePart = ""] = part.split("|").map((x) => x.trim());
      const m = codePart.match(/^(\d+(?:\.\d+)*)\s*[—–-]\s*(.+)$/);
      if (m) secondary.push({ number: m[1], name: m[2], evidence: { quote: evidencePart.replace(/^evidence:\s*/i, "") || FB(), source_url: urlOf(evidencePart) } });
    }
    const assigned = [];
    for (const entry of findAll(industry, "vertical name")) {
      if (!entry.value || C().isFallback(entry.value)) continue;
      assigned.push({
        vertical_name: entry.value,
        trigger_evidence: { quote: subOf(entry, "trigger evidence")?.value || FB(), source_url: urlOf(subOf(entry, "source")?.value) },
        definition_match_confirmation: subOf(entry, "definition match confirmation")?.value || FB(),
        gate_question_passed: "Not stated"
      });
    }
    for (const key of ["primary buyer type", "primary industry code", "primary industry sector", "confidence"]) {
      if (!find(industry, key)) C().issue(issues, "warning", "FIELD_MISSING", `industry.${key}`, "was not found in the output.");
    }
    const industrySrc = {
      buyer_type: { primary: buyer?.value || FB(), evidence_1: { quote: subOf(buyer, "evidence")?.value || FB(), source_url: urlOf(subOf(buyer, "source")?.value) }, evidence_2: { quote: FB(), source_url: null } },
      primary_business_activity: FB(), public_identity_test: FB(),
      primary_industry_code: codeMatch ? { number: codeMatch[1], name: codeMatch[2] } : { number: FB(), name: FB() },
      primary_industry_sector: find(industry, "primary industry sector")?.value || FB(),
      evidence_for_primary_code: { quote: evidenceFor?.value || FB(), source_url: urlOf(subOf(evidenceFor, "source")?.value) },
      logic: find(industry, "logic")?.value || FB(),
      secondary_industry_codes: secondary,
      confidence: find(industry, "confidence")?.value || FB(), confidence_rationale: FB(), additional_information_needed: null
    };
    if (codeEntry && !codeMatch && !C().isFallback(codeEntry.value)) {
      C().issue(issues, "error", "CODE_FORMAT", "industry.primary_industry_code", `"${codeEntry.value}" must read "<number> — <name>".`);
    }

    // ----- Section 9: description, employees, SIC, NAICS, keywords -----
    let descLines = (entries.description || []).map((e) => e.value.replace(/^(?:business description|brief description|full description|bd|fd)\s*[:\-–—]\s*/i, "")).filter(Boolean);
    // Both sentences in one paragraph: the Full Description always starts "The company".
    if (descLines.length === 1) {
      const parts = descLines[0].split(/(?<=[.!?])\s+(?=The company\b)/);
      if (parts.length === 2) descLines = parts;
    }
    const [bd, fd] = descLines;
    if (descLines.length < 2 && !descLines.every((l) => C().isFallback(l))) {
      C().issue(issues, "error", "DESCRIPTION_RULE", "SECTION 9", "must contain the two description sentences (Business Description, then Full Description).");
    }
    const prefix = C().CLASSIFICATION_PREFIXES.find((p) => bd && bd.startsWith(p)) || (bd && !C().isFallback(bd) ? bd.split(" ").slice(0, 2).join(" ") : FB());
    const transition = ((bd || "").match(/\b(intended for|designed for|designed to|catering to|based in|headquartered in)\b/i) || [])[1] || FB();
    const descriptionSrc = { classification_prefix: prefix || FB(), transition_phrase: transition, business_description: bd || FB(), full_description: fd || FB() };

    const emp = entries.employees || [];
    const currentEmp = find(emp, "current");
    const employeeSrc = {
      current: { count: currentEmp?.value || FB(), date: FB(), source_url: urlOf(currentEmp?.value) },
      history: [], notes: find(emp, "notes")?.value || ""
    };

    const codeList = (key, kind) => {
      const out = [];
      for (const entry of entries[key] || []) {
        if (/^no (sic|naics) code identified/i.test(entry.text)) { out.push({ rank: 1, best_fit: true, code: "", title: entry.text, relevance: "", source: kind === "SIC" ? "OSHA SIC Manual" : "2022 NAICS Manual" }); continue; }
        const m = entry.text.match(/^(\d{2,6})\s*[—–-]\s*(.+?)(\s*\(Best fit\))?\s*\**$/i);
        if (!m) { C().issue(issues, "warning", "UNKNOWN_FIELD", `${kind} CODES`, `"${entry.text.slice(0, 60)}" was not recognised.`); continue; }
        out.push({ rank: out.length + 1, best_fit: Boolean(m[3]), code: m[1], title: m[2].trim(), relevance: subOf(entry, "relevance")?.value || "", source: subOf(entry, "source")?.value || "" });
      }
      return out;
    };
    const sicSrc = codeList("sic", "SIC");
    const naicsSrc = codeList("naics", "NAICS");

    const keywords = (entries.keywords || []).flatMap((e) => e.value.split(/[,;]/))
      .map((k) => k.replace(/^[\s*\-•\d.)]+/, "").replace(/[.\s]+$/, "").trim()).filter(Boolean);

    // ----- assemble the shared Section-13-shaped source -----
    const formal = C().real(nameSrc.formal_name.value);
    const src = {
      target_domain: targetDomain,
      domain_confirmation: { domain_provided: targetDomain, url_accessed: accessedUrl || "", tld_match_confirmed: true },
      entity_details: { entity_identified: true, official_website: accessedUrl ? { value: accessedUrl, source_url: accessedUrl } : NOT_FOUND() },
      funding: {
        total_rounds_found: Number.isInteger(totalRounds) ? totalRounds : 0, backing_status: fundingInfo("backing status") || FB(),
        team_routing: fundingInfo("team routing") || FB()
      },
      name_variations: nameSrc, site_and_contact: siteSrc, email_default_structure: emailDefault, social_media_identifiers: smi,
      management, industry_classification: industrySrc, verticals: { assigned, evaluated_not_assigned: [], pages_reviewed: [] },
      description: descriptionSrc, employee_count: employeeSrc, sic_codes: sicSrc, naics_codes: naicsSrc, keywords
    };
    if (!formal && !C().real(nameSrc.legal_name.value)) src.name_variations.formal_name = NOT_FOUND();

    // ----- source-quality notes -----
    const hosts = (url) => C().hostOf(url);
    for (const note of notes) {
      if (!note.url || !targetDomain) continue;
      const host = hosts(note.url);
      if (host && !C().hostMatches(host, targetDomain) && !/^FUNDING/.test(note.path)) {
        C().issue(issues, "warning", "EXTERNAL_SOURCE", note.path, `is sourced from ${host}, not the official website (${targetDomain}); external sources are only for fields missing from the website.`);
      }
      if (HEDGES.test(note.text || "") && !/^FUNDING/.test(note.path)) {
        C().issue(issues, "warning", "HEDGED_VALUE", note.path, "the agent's own note hedges this value (\"appears\", \"likely\", \"legacy\"...): verify before relying on it.");
      }
    }

    if (/not-for-profit organi[sz]ation/i.test(text)) {
      C().issue(issues, "warning", "NOT_FOR_PROFIT", "SECTION 1", "the output flags a not-for-profit organisation (incorrect workflow; should not be tracked unless published).");
    }
    if (!ancPresent) C().issue(issues, "warning", "ANC_MISSING", "ANC", "the ANC tracking block (ACCEPTED / USED, REJECTED / NOT USED) was not found at the end.");
    if (ignoredBefore) issues.push({ severity: "info", code: "NOISE_REMOVED", path: "", message: `ignored ${ignoredBefore} line(s) before "SECTION 1" (instructions or chat text).` });

    // Part C check, applied to the whole report.
    const lower = text.toLowerCase();
    for (const bad of ["pitchbook.com", "tracxn.com", "atlassian.net"]) {
      if (lower.includes(bad)) C().issue(issues, "error", "PROHIBITED_SOURCE", "output", `contains "${bad}", a prohibited source. The output must be rejected.`);
    }

    const result = C().analyzeParsed(src, { extraIssues: issues, extraRows, format: "text" });
    result.ignoredLines = ignoredBefore;
    result.notForProfit = issues.some((i) => i.code === "NOT_FOR_PROFIT");
    return result;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.rovoText = { isText, analyze, extractBlock, HALT_PHRASES };
})();
