// docs/rovo-agent-json-output-block.txt is pasted into the Rovo agent's
// instructions. These tests keep it in lock-step with what the extension
// accepts: same schema, same EDS options, and an output written exactly the
// way the block says (including every "not found" shape) must validate.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import "../core/rovoContract.js";
import "../core/rovoText.js";
import "../core/schema.js";
import "../core/identityLock.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import { TEXT_SAMPLE } from "./helpers/rovo-text-sample.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const block = readFileSync(path.join(here, "../docs/rovo-agent-json-output-block.txt"), "utf8");
const rc = globalThis.SXRTS.rovoContract;
const NF = "Not found on the official website.";

function schemaFromBlock() {
  const start = block.indexOf("SCHEMA — emit exactly these keys, in this order:") + "SCHEMA — emit exactly these keys, in this order:".length;
  const end = block.indexOf("KEY-SPECIFIC RULES");
  return JSON.parse(block.slice(start, end).trim());
}

function shape(template) {
  if (typeof template === "string") return "leaf";
  if (Array.isArray(template)) return [shape(template[0])];
  return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, shape(v)]));
}
function shapeOfSample(value) {
  if (Array.isArray(value)) return [shapeOfSample(value[0])];
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOfSample(v)]));
  return "leaf";
}

test("the schema in the block is exactly the schema the extension reads (same keys, same order, same nesting)", () => {
  const fromBlock = schemaFromBlock();
  assert.deepEqual(Object.keys(fromBlock), Object.keys(rc.TEMPLATE));
  assert.deepEqual(JSON.stringify(shapeOfSample(fromBlock)), JSON.stringify(shape(rc.TEMPLATE)));
});

test("the block lists every Email Default Structure option RTS accepts, and every prescribed fallback phrase", () => {
  const options = globalThis.SXRTS.registry.getField("businessEntity.emailDefaultStructure").form.select.options.map((o) => o.label);
  assert.equal(options.length, 42);
  for (const label of options) assert.ok(block.includes(`\n${label}\n`) || block.endsWith(`\n${label}\n`), `missing EDS option: ${label}`);
  for (const phrase of rc.FALLBACKS) assert.ok(block.includes(phrase), `missing fallback phrase: ${phrase}`);
  assert.ok(block.includes("AIGEN_SRX_V1_Y") && block.includes("AIGEN_SRX_V1_N"));
});

// psypher.in, exactly as the block instructs the agent to emit it.
function psypherJson() {
  const site = "https://www.psypher.in/";
  const policy = "https://www.psypher.in/policies/privacy-policy";
  const nf = { value: NF, source_url: null };
  return {
    extraction_status: "success", halt_reason: null, target_domain: "psypher.in", extraction_date: "02 Oct 2026",
    domain_confirmation: { domain_provided: "psypher.in", url_accessed: "https://www.psypher.in", tld_match_confirmed: true },
    not_for_profit_flag: { is_not_for_profit: false, note: "Not applicable" },
    entity_details: { entity_identified: true, official_website: { value: site, source_url: site } },
    funding: {
      timeline: [], total_rounds_found: 0, total_confirmed_funding: NF,
      latest_round: { type: NF, date: NF, amount: NF }, latest_investors: [],
      backing_status: "Corporation / Bootstrapped", team_routing: "All-Rounders/Private Company Team",
      routing_logic: "No funding events identified.", researcher_note: "No funding events identified. The company appears to be a bootstrapped corporation.",
      out_of_scope_rounds: [{ round_type: "No round identified under PB methodology", status: "Not applicable", date: "Not applicable", amount: "Not applicable", key_detail: "Not applicable", source_url: null, source_type: "Not applicable" }]
    },
    website_links: { pages_traversed: [site, policy], key_links: [{ label: "Privacy Policy", url: policy }] },
    name_variations: { formal_name: { value: "Psypher", source_url: site }, legal_name: nf, familiar_name: nf, former_name: nf, other_name_variations: [] },
    site_and_contact: {
      full_address: { value: "Borivali, Borivali East, 400066 Mumbai MH, India", source_url: policy },
      city: nf, state_or_region: nf, country: nf, postcode: nf, phone: nf, fax: nf,
      site_email: { value: "info@psypher.in", source_url: policy },
      start_date: { value: "2024", source_url: site, corroborating_source_url: null, selection_logic: "The official website states the brand was established in 2024." }
    },
    email_default_structure: nf && { value: NF, source_url: null, sample_emails_observed: ["info@psypher.in"] },
    social_media_identifiers: {
      linkedin: { value: NF, source_url: null, note: null }, twitter_x: { value: NF, source_url: null, note: null },
      facebook: { value: NF, source_url: null, note: null }, instagram: { value: NF, source_url: null, note: null },
      youtube: { value: NF, source_url: null, note: null }, other: []
    },
    management: [{ full_name: "Abhishek Tawte", titles: ["Founder"], is_founder: true, regional_title_equivalent: null, source_url: site }],
    industry_classification: {
      buyer_type: { primary: "B2C", evidence_1: { quote: "Shop premium Indian streetwear at Psypher", source_url: site }, evidence_2: { quote: "Discover oversized tees, cargos, hoodies & more.", source_url: site } },
      primary_business_activity: "Designs and sells streetwear apparel directly to consumers.", public_identity_test: "Most people would call this company a clothing brand.",
      primary_industry_code: { number: "2.1.2", name: "Clothing" }, primary_industry_sector: "B2C",
      evidence_for_primary_code: { quote: "oversized t-shirts, cargos, and hoodies", source_url: site },
      logic: "Apparel sold directly to individual consumers.",
      secondary_industry_codes: [{ number: "2.6.6", name: "Specialty Retail", evidence: { quote: "online streetwear store", source_url: site } }],
      confidence: "High", confidence_rationale: "Explicit product pages.", additional_information_needed: null
    },
    verticals: {
      assigned: [{ vertical_name: "E-Commerce", trigger_evidence: { quote: "online streetwear store", source_url: site }, definition_match_confirmation: "Retailer selling online consumer products.", gate_question_passed: "Q1-Q4" }],
      evaluated_not_assigned: [{ vertical_name: "Mobile Commerce", rejection_reason: "Mobile transactions are not the core product." }], pages_reviewed: [site]
    },
    description: {
      classification_prefix: "Designer of", transition_phrase: "intended for",
      business_description: "Designer of streetwear apparel intended for individual consumers.",
      full_description: "The company offers oversized t-shirts, cargo pants, hoodies, graphic tees, unisex fashion, and streetwear accessories, enabling customers to express individuality through bold and unconventional clothing styles."
    },
    employee_count: { current: { count: NF, date: NF, source_url: null }, history: [], notes: "No headcount data is publicly disclosed." },
    sic_codes: [
      { rank: 1, best_fit: true, code: "2321", title: "Men's and Boys' Shirts, Except Work Shirts", relevance: "Designs and sells oversized t-shirts.", source: "OSHA SIC Manual" },
      { rank: 2, best_fit: false, code: "2331", title: "Women's, Misses', and Juniors' Blouses and Shirts", relevance: "Offers unisex apparel.", source: "OSHA SIC Manual" },
      { rank: 3, best_fit: false, code: "5651", title: "Family Clothing Stores", relevance: "Operates an online clothing store.", source: "OSHA SIC Manual" }
    ],
    naics_codes: [
      { rank: 1, best_fit: true, code: "315220", title: "Men's and Boys' Cut and Sew Apparel Manufacturing", relevance: "Designs streetwear apparel.", source: "2022 NAICS Manual" },
      { rank: 2, best_fit: false, code: "448140", title: "Family Clothing Stores", relevance: "Retails unisex streetwear.", source: "2022 NAICS Manual" },
      { rank: 3, best_fit: false, code: "315240", title: "Women's, Misses', and Girls' Cut and Sew Apparel Manufacturing", relevance: "Produces unisex garments.", source: "2022 NAICS Manual" }
    ],
    keywords: ["streetwear apparel", "oversized t-shirts", "cargo pants", "unisex fashion", "graphic tees", "Indian streetwear", "premium hoodies", "bold clothing", "streetwear culture", "online clothing store"],
    anc: { accepted_used: "AIGEN_SRX_V1_Y", rejected_not_used: "AIGEN_SRX_V1_N" }
  };
}

test("psypher.in written exactly as the block instructs (all 'not found' shapes included) validates with no errors", () => {
  const result = rc.analyze(psypherJson());
  assert.deepEqual(result.issues.filter((i) => i.severity === "error"), []);
  assert.deepEqual(result.issues.filter((i) => i.severity === "warning"), []);
  assert.ok(result.document);
});

test("the JSON and the text report for the same company produce the same RTS data", () => {
  const fromJson = rc.analyze(psypherJson()).document;
  const fromText = globalThis.SXRTS.rovoText.analyze(TEXT_SAMPLE).document;
  assert.deepEqual(fromJson.businessEntity.websiteAddresses.map((w) => w.value.replace(/\/$/, "")), fromText.businessEntity.websiteAddresses.map((w) => w.value));
  assert.deepEqual(fromJson.company.sicCodes.map((s) => s.code), fromText.company.sicCodes.map((s) => s.code));
  assert.deepEqual(fromJson.company.naicsCodes.map((s) => s.code), fromText.company.naicsCodes.map((s) => s.code));
  assert.deepEqual(fromJson.company.keywords.map((k) => k.value), fromText.company.keywords.map((k) => k.value));
  assert.equal(fromJson.company.briefDescription.value, fromText.company.briefDescription.value);
  assert.equal(fromJson.company.fullDescription.value, fromText.company.fullDescription.value);
  assert.equal(fromJson.extras.address.value, fromText.extras.address.value);
  assert.equal(fromJson.extras.startDate.value, fromText.extras.startDate.value);
  assert.equal(fromJson.extras.management[0].fullName, fromText.extras.management[0].fullName);
});

test("the extension still rejects the mistakes the block warns about", () => {
  const bad = psypherJson();
  bad.name_variations.legal_name = { value: "Not found", source_url: null };       // near-miss fallback
  bad.site_and_contact.start_date.source_url = "homepage";                         // description, not a URL
  bad.funding.timeline = [{ sequence: 1, round_type: "Seed", date: "x", amount: "x", investors: ["x"], source_1: "https://news.example.org/a", source_2: null, flag: null }]; // count mismatch
  bad.email_default_structure = { value: "x", source_url: "https://www.psypher.in/", sample_emails_observed: [] };
  const codes = rc.analyze(bad).issues.filter((i) => i.severity === "error").map((i) => i.code);
  for (const code of ["FALLBACK_NOT_EXACT", "URL_INVALID", "TIMELINE_COUNT_MISMATCH"]) assert.ok(codes.includes(code), code);
});

// ---------------------------------------------------------------------------
// The complete per-run prompt ("Copy prompt") and the real dmcspain.com output
// that exposed the gaps: the agent dropped the five header keys, sourced the
// address/phone/email from another organisation's site, and used prospeo.io.
// ---------------------------------------------------------------------------

import "../core/agentSpec.js";
import "../core/promptBuilder.js";
import { render } from "../scripts/build-agent-spec.mjs";

const dmc = readFileSync(path.join(here, "helpers/dmcspain-output.json"), "utf8");
const codes = (analysis, severity) => analysis.issues.filter((i) => i.severity === severity).map((i) => i.code);

test("core/agentSpec.js is generated from the docs block (what is pasted into the agent == what Copy prompt sends)", () => {
  assert.equal(readFileSync(path.join(here, "../core/agentSpec.js"), "utf8"), render());
});

test("Copy prompt: domain first, today's date, the literal required start, and no unfilled placeholders", () => {
  const prompt = globalThis.SXRTS.promptBuilder.buildRunPrompt({ domain: "dmcspain.com", now: new Date(2026, 9, 2) });
  assert.equal(prompt.split("\n")[0], "dmcspain.com");
  assert.match(prompt, /Target domain: dmcspain\.com\nToday's date: 02 Oct 2026/);
  assert.match(prompt, /BEGIN YOUR RESPONSE WITH EXACTLY THIS TEXT/);
  assert.match(prompt, /"extraction_status": "success",\n  "halt_reason": null,\n  "target_domain": "dmcspain\.com",\n  "extraction_date": "02 Oct 2026",/);
  assert.doesNotMatch(prompt, /<the domain you were given>|<today's date as DD Mon YYYY>/);
  assert.match(prompt, /<the full https:\/\/ URL you accessed>/, "only the value the agent must supply remains a placeholder");
  assert.match(prompt, /exactly 22/i);
  assert.match(prompt, /RULE 7 — SOURCE DOMAIN/);
});

test("Copy prompt covers every mistake seen in the real output", () => {
  const prompt = globalThis.SXRTS.promptBuilder.buildRunPrompt({ domain: "dmcspain.com" });
  assert.match(prompt, /Keys 1 to 5 are the header/);                                        // dropped header
  assert.match(prompt, /another organisation's page/);                                          // esas.org
  assert.match(prompt, /prospeo\.io/);                                                           // prospeo.io
  assert.match(prompt, /ONLY when the count and its source_url are on the official website/);   // employee date label
  assert.match(prompt, /only pages of the official website that you actually opened/);          // pages_traversed
  assert.match(prompt, /"transition_phrase" is the connecting phrase that actually appears/);   // transition
  assert.match(prompt, /"02 Oct 2026 \(website, assumed current\)"|"\d{2} \w{3} \d{4} \(website, assumed current\)"/);   // real date, not a placeholder
  assert.match(prompt, /never an aggregator or directory/);                                      // corroborating source
});

test("the dmcspain.com output is still recognised as the agent's output, with exact 'missing key' errors (not schemaVersion/profileIdentity)", () => {
  assert.equal(rc.isContract(JSON.parse(dmc)), true);
  let error;
  try { globalThis.SXRTS.schema.validate(dmc); } catch (e) { error = e; }
  const text = error.errors.join("\n");
  assert.doesNotMatch(text, /schemaVersion|profileIdentity/);
  for (const key of ["extraction_status", "halt_reason", "target_domain", "extraction_date", "domain_confirmation"]) assert.match(text, new RegExp(`\\[MISSING_KEY\\] ${key}`));
});

test("with the researcher's domain, the dropped header is filled in, and the REAL problems are what remain", () => {
  let error;
  try { globalThis.SXRTS.schema.validate(dmc, { domain: "dmcspain.com" }); } catch (e) { error = e; }
  assert.deepEqual(error.issues.filter((i) => i.severity === "error").map((i) => i.code), ["PROHIBITED_SOURCE"]);
  assert.match(error.errors[0], /employee_count\.current\.source_url: uses prospeo\.io/);
  const warnings = error.issues.filter((i) => i.severity === "warning").map((i) => i.code);
  for (const code of ["HEADER_MISSING", "EXTERNAL_SOURCE", "PAGES_TRAVERSED", "EMPLOYEE_DATE", "DESCRIPTION_RULE"]) assert.ok(warnings.includes(code), code);
  const external = error.issues.find((i) => i.code === "EXTERNAL_SOURCE" && /esas\.org/.test(i.path));
  assert.match(external.message, /8 field\(s\) are sourced from www\.esas\.org, not the official website \(dmcspain\.com\)/);
});

test("once the prohibited source is removed, the output validates, with the cross-domain sources flagged for review", () => {
  const fixed = JSON.parse(dmc);
  fixed.employee_count.current = { count: NF, date: NF, source_url: null };
  const validated = globalThis.SXRTS.schema.validate(JSON.stringify(fixed), { domain: "dmcspain.com" });
  assert.equal(validated.profileIdentity.domain, "dmcspain.com");
  assert.ok(validated.warnings.some((w) => /\[HEADER_MISSING\]/.test(w)));
  assert.ok(validated.warnings.some((w) => /\[EXTERNAL_SOURCE\] www\.esas\.org/.test(w)));
});

test("the domain entered in the panel is the authority: a different TLD than the agent's sources is a hard block", () => {
  const fixed = JSON.parse(dmc);
  fixed.employee_count.current = { count: NF, date: NF, source_url: null };
  assert.throws(() => globalThis.SXRTS.schema.validate(JSON.stringify(fixed), { domain: "dmcspain.io" }),
    (error) => error.errors.some((e) => /\[DOMAIN_MISMATCH\].*dmcspain\.com.*dmcspain\.io/.test(e)));
});

test("a complete output that follows the prompt gets no header warning", () => {
  const analysis = rc.analyze(psypherJson(), { domain: "psypher.in" });
  assert.deepEqual(codes(analysis, "error"), []);
  assert.ok(!codes(analysis, "warning").includes("HEADER_MISSING"));
});

test("an output with only a few contract keys is still not mistaken for the old v1.0 format, and the old format still works", () => {
  assert.equal(rc.isContract({ funding: {}, keywords: [] }), true);
  assert.equal(rc.isContract({ schemaVersion: "1.0", profileIdentity: {}, anc: {} }), false);
  assert.equal(rc.isContract({ keywords: [] }), false);
});
