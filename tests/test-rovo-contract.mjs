// The frozen Rovo output contract ("Section 13"): reading it, enforcing the
// agent's own written rules, and translating it for RTS. These tests also
// pin the contract itself so an accidental edit to it fails loudly.

import assert from "node:assert/strict";
import { test } from "node:test";

import "../core/rovoContract.js";
import "../core/identityLock.js";
import "../core/schema.js";
import "../core/customFields.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/executionPlan.js";
import { validOutput, NF, sourced } from "./helpers/rovo-sample.mjs";

const rc = globalThis.SXRTS.rovoContract;
const schema = globalThis.SXRTS.schema;

const errorsOf = (src) => rc.analyze(src).issues.filter((i) => i.severity === "error");
const codesOf = (src) => errorsOf(src).map((i) => i.code);

// ---- the contract itself is frozen ----

test("FROZEN CONTRACT: top-level key order, fallback phrases, and ANC values never change", () => {
  assert.deepEqual(Object.keys(rc.TEMPLATE), [
    "extraction_status", "halt_reason", "target_domain", "extraction_date", "domain_confirmation", "not_for_profit_flag",
    "entity_details", "funding", "website_links", "name_variations", "site_and_contact", "email_default_structure",
    "social_media_identifiers", "management", "industry_classification", "verticals", "description", "employee_count",
    "sic_codes", "naics_codes", "keywords", "anc"
  ]);
  assert.deepEqual(rc.FALLBACKS, [
    "Not found on the official website.",
    "Not found on the official website — non-English site, partial extraction only.",
    "Not defined in methodology.",
    "Description cannot be generated without violating methodology.",
    "Entity cannot be confidently identified from the official website.",
    "No round identified under PB methodology"
  ]);
  assert.deepEqual(Object.keys(rc.TEMPLATE.anc), ["accepted_used", "rejected_not_used"]);
  assert.deepEqual(Object.keys(rc.TEMPLATE.name_variations), ["formal_name", "legal_name", "familiar_name", "former_name", "other_name_variations"]);
});

test("a compliant Rovo output has no errors and no warnings", () => {
  const result = rc.analyze(validOutput());
  assert.deepEqual(result.issues, []);
  assert.ok(result.document);
});

// ---- translation to RTS ----

test("compliant output is translated: names, website, EDS, SMI, SIC, keywords; fallbacks are never written", () => {
  const { document } = rc.analyze(validOutput());
  assert.equal(document.profileIdentity.domain, "acme.com");
  assert.equal(document.profileIdentity.companyName, "Acme");
  assert.deepEqual(document.businessEntity.nameVariations.map((n) => [n.name, n.type]), [
    ["Acme Holdings Ltd", "Legal Name"], ["ACM", "Familiar Name"], ["艾克美", "Native Other Name"]
  ]);
  assert.equal(document.businessEntity.websiteAddresses[0].value, "https://www.acme.com/");
  assert.equal(document.businessEntity.emailDefaultStructure.value, "First.Last@domain.com");
  assert.deepEqual(document.businessEntity.socialMediaIdentifiers.map((s) => s.network), ["LinkedIn"]);
  assert.deepEqual(document.company.sicCodes.map((s) => s.code), ["7372", "7371"]);
  assert.equal(document.company.keywords.length, 10);
  assert.ok(!JSON.stringify(document).includes("Not found on the official website"));
});

test("the translated document passes the normal validator and builds an execution plan", () => {
  const validated = schema.validate(JSON.stringify(validOutput()));
  assert.ok(validated.rovo);
  const actions = globalThis.SXRTS.executionPlan.buildExecutionPlan(validated);
  const byPath = (p) => actions.filter((a) => a.jsonPath === p);
  assert.equal(byPath("businessEntity.nameVariations").length, 3);
  assert.equal(byPath("company.sicCodes").length, 2);
  assert.equal(byPath("company.sicCodes")[0].executionStatus, "pending");
  // evidence-less fields are still shown, and flagged as waiting, not hidden
  assert.equal(byPath("company.keywords")[0].executionStatus, "skipped");
  assert.match(byPath("company.keywords")[0].skipReason, /registry entry|evidence/i);
});

test("researched-but-unmapped data is listed with an explicit RTS automation status", () => {
  const { rows } = rc.analyze(validOutput());
  const byLabel = Object.fromEntries(rows.map((r) => [r.section, r]));
  assert.equal(byLabel["Management"].status, "WAITING_FOR_EVIDENCE");
  assert.equal(byLabel["Address"].status, "WAITING_FOR_EVIDENCE");
  assert.equal(byLabel["Phone"].status, "NO_VALUE");
  assert.equal(byLabel["Funding"].status, "INFORMATIONAL");
});

// ---- hard rules (errors) ----

test("a halted extraction is surfaced with Rovo's own reason and nothing is applied", () => {
  const halted = { extraction_status: "halted", halt_reason: "Invalid source detected. Extraction failed due to violation of source policy.", target_domain: "acme.com", extraction_date: "01 Oct 2026", anc: { accepted_used: "AIGEN_SRX_V1_Y", rejected_not_used: "AIGEN_SRX_V1_N" } };
  assert.throws(() => schema.validate(JSON.stringify(halted)), (error) => error.errors.some((e) => /HALTED.*Invalid source detected/.test(e)));
});

test("missing keys are named exactly", () => {
  const src = validOutput();
  delete src.funding.backing_status;
  delete src.anc;
  const found = errorsOf(src).filter((i) => i.code === "MISSING_KEY").map((i) => i.path);
  assert.deepEqual(found.sort(), ["anc", "funding.backing_status"]);
});

test("empty strings and disallowed nulls are rejected; a source_url null is allowed only beside a fallback", () => {
  const src = validOutput();
  src.name_variations.legal_name = { value: "", source_url: "https://www.acme.com/terms" };
  src.name_variations.former_name = { value: NF, source_url: null };               // allowed
  src.site_and_contact.city = { value: "Leeds", source_url: null };               // not allowed
  src.funding.researcher_note = null;                                             // not allowed
  const codes = errorsOf(src).map((i) => `${i.code}@${i.path}`);
  assert.ok(codes.includes("EMPTY_STRING@name_variations.legal_name.value"));
  assert.ok(codes.includes("NULL_NOT_ALLOWED@site_and_contact.city.source_url"));
  assert.ok(codes.includes("NULL_NOT_ALLOWED@funding.researcher_note"));
  assert.ok(!codes.some((c) => c.includes("former_name")));
});

test("near-miss fallback wording ('N/A', 'Not found') is rejected; the exact phrase is accepted", () => {
  const src = validOutput();
  src.name_variations.former_name = { value: "N/A", source_url: null };
  src.site_and_contact.phone = { value: "Not found", source_url: null };
  const codes = errorsOf(src);
  assert.equal(codes.filter((i) => i.code === "FALLBACK_NOT_EXACT").length, 2);
});

test("booleans must be real booleans, counts real integers", () => {
  const src = validOutput();
  src.domain_confirmation.tld_match_confirmed = "true";
  src.funding.total_rounds_found = "2";
  src.management[0].is_founder = "Yes";
  const codes = codesOf(src);
  assert.equal(codes.filter((c) => c === "INVALID_TYPE").length, 3);
});

test("non-https and malformed source URLs are rejected", () => {
  const src = validOutput();
  src.name_variations.legal_name.source_url = "http://www.acme.com/terms";
  src.site_and_contact.city.source_url = "www.acme.com/contact";
  assert.equal(codesOf(src).filter((c) => c === "URL_INVALID").length, 2);
});

test("prohibited sources are rejected anywhere: aggregators, internal systems, and the three Part C substrings", () => {
  const src = validOutput();
  src.funding.timeline[0].source_1 = "https://www.crunchbase.com/organization/acme";
  src.funding.timeline[1].source_2 = "https://pitchbook.com/profiles/company/12345-67";
  src.website_links.key_links.push({ label: "Docs", url: "https://acme.atlassian.net/wiki/x" });
  src.industry_classification.evidence_1 = { quote: "see https://tracxn.com/d/companies/acme", source_url: "https://confluence.example.com/page" };
  const prohibited = errorsOf(src).filter((i) => i.code === "PROHIBITED_SOURCE").map((i) => i.path);
  assert.ok(prohibited.includes("funding.timeline[0].source_1"));
  assert.ok(prohibited.includes("funding.timeline[1].source_2"));
  assert.ok(prohibited.includes("website_links.key_links[1].url"));
  assert.ok(prohibited.some((p) => p.startsWith("industry_classification")));
});

test("TLD exactness: a different TLD in the accessed URL or website is a domain mismatch", () => {
  const src = validOutput();
  src.domain_confirmation.url_accessed = "https://www.acme.io/";
  src.entity_details.official_website.value = "https://www.acme.ai/";
  assert.equal(codesOf(src).filter((c) => c === "DOMAIN_MISMATCH").length, 2);
});

test("funding.timeline length must equal total_rounds_found; no rounds forces the prescribed routing", () => {
  const src = validOutput();
  src.funding.total_rounds_found = 3;
  assert.ok(codesOf(src).includes("TIMELINE_COUNT_MISMATCH"));
  const none = validOutput();
  none.funding.timeline = []; none.funding.total_rounds_found = 0;
  assert.ok(errorsOf(none).filter((i) => i.code === "CONSTRAINT").length >= 2);
  none.funding.backing_status = "Corporation / Bootstrapped";
  none.funding.team_routing = "All-Rounders/Private Company Team";
  assert.deepEqual(errorsOf(none), []);
});

test("SIC/NAICS: at most 3, exactly one best fit, correct digit counts, 523930 replaced", () => {
  const src = validOutput();
  src.sic_codes.push({ rank: 3, best_fit: true, code: "73", title: "x", relevance: "x", source: "OSHA SIC Manual" });
  src.sic_codes.push({ rank: 4, best_fit: false, code: "7373", title: "x", relevance: "x", source: "OSHA SIC Manual" });
  src.naics_codes[0].code = "523930";
  const codes = errorsOf(src);
  assert.ok(codes.some((i) => i.code === "CONSTRAINT" && /maximum is 3/.test(i.message)));
  assert.ok(codes.some((i) => /exactly one entry with best_fit/.test(i.message)));
  assert.ok(codes.some((i) => i.code === "CODE_FORMAT"));
  assert.ok(codes.some((i) => /523940/.test(i.message)));
});

test("keywords: at least 10, 2-3 words each, no 'solution', no generic filler", () => {
  const src = validOutput();
  src.keywords = ["fleet", "route monitoring software tools", "digital solutions", "online platform", "vehicle tracking"];
  const messages = errorsOf(src).map((i) => i.message).join("\n");
  assert.match(messages, /minimum of 10/);
  assert.match(messages, /"fleet" must be 2–3 words/);
  assert.match(messages, /must be 2–3 words/);
  assert.match(messages, /solution/);
  assert.match(messages, /prohibited generic keyword/);
});

test("prohibited and always-secondary industry codes, and TMT/Industrials verticals, are rejected", () => {
  const src = validOutput();
  src.industry_classification.primary_industry_code = { number: "6.5.15", name: "Vertical Market Software" };
  src.industry_classification.secondary_industry_codes = [{ number: "1.4.4", name: "x", evidence: { quote: "x", source_url: "https://www.acme.com/" } }];
  src.verticals.assigned = [{ vertical_name: "TMT", trigger_evidence: { quote: "x", source_url: "https://www.acme.com/" }, definition_match_confirmation: "x", gate_question_passed: "Q1" }];
  const codes = codesOf(src);
  assert.equal(codes.filter((c) => c === "PROHIBITED_CODE").length, 2);
  assert.ok(codes.includes("PROHIBITED_VERTICAL"));
});

test("the Formal Name can never also be the Familiar Name", () => {
  const src = validOutput();
  src.name_variations.familiar_name = sourced("acme");
  assert.ok(codesOf(src).includes("NAME_RULE"));
});

test("not-for-profit: flagged with the exact note; wrong note is an error", () => {
  const src = validOutput();
  src.not_for_profit_flag = { is_not_for_profit: true, note: "Incorrect workflow — not-for-profit organisation. Should not be tracked by any team unless published." };
  const result = rc.analyze(src);
  assert.equal(result.notForProfit, true);
  assert.ok(result.issues.some((i) => i.code === "NOT_FOR_PROFIT" && i.severity === "warning"));
  src.not_for_profit_flag.note = "Not applicable";
  assert.ok(codesOf(src).includes("CONSTRAINT"));
});

// ---- content rules and unknown fields (warnings) ----

test("description rules are reported as warnings, not silently accepted", () => {
  const src = validOutput();
  src.description.business_description = "Developer of innovative fleet solutions for Acme customers. It also does more.";
  src.description.full_description = "The company offers tracking routing and billing for fleets.";
  const warnings = rc.analyze(src).issues.filter((i) => i.severity === "warning" && i.code === "DESCRIPTION_RULE").map((i) => i.message).join("\n");
  assert.match(warnings, /one sentence/);
  assert.match(warnings, /prohibited word\(s\): "solutions", "innovative"|prohibited word\(s\): "innovative"/);
  assert.match(warnings, /"solutions"/);
  assert.match(warnings, /repeat the company name/);
  assert.match(warnings, /comma before an "enabling \/ helping \/ assisting" clause/);
  assert.equal(errorsOf(src).length, 0);
});

test("unknown keys are reported (UNKNOWN_FIELD), never silently dropped", () => {
  const src = validOutput();
  src.extra_section = { x: 1 };
  src.funding.surprise = "x";
  const unknown = rc.analyze(src).issues.filter((i) => i.code === "UNKNOWN_FIELD").map((i) => i.path).sort();
  assert.deepEqual(unknown, ["extra_section", "funding.surprise"]);
});

test("a blocking paste produces a correction prompt that restates only the violations", () => {
  const src = validOutput();
  src.keywords = ["fleet"];
  const issues = rc.analyze(src).issues;
  const prompt = rc.buildCorrectionPrompt(issues, "acme.com");
  assert.match(prompt, /acme\.com/);
  assert.match(prompt, /\[KEYWORD_COUNT\] keywords/);
  assert.doesNotMatch(prompt, /Required JSON shape/);
});

test("the legacy v1.0 format still works unchanged", () => {
  const legacy = schema.validate(JSON.stringify({ schemaVersion: "1.0", profileIdentity: { companyName: "X", domain: "x.com" }, businessEntity: {} }));
  assert.equal(legacy.rovo, null);
});
