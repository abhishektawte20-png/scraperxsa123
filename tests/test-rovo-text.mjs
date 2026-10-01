// The text agent's SECTION-format report: noise removal, parsing, mapping to
// RTS, and the same methodology checks as the JSON path. TEXT_SAMPLE is the
// agent's real output, verbatim.

import assert from "node:assert/strict";
import { test } from "node:test";

import "../core/rovoContract.js";
import "../core/rovoText.js";
import "../core/identityLock.js";
import "../core/schema.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/executionPlan.js";
import { TEXT_SAMPLE } from "./helpers/rovo-text-sample.mjs";

const rt = globalThis.SXRTS.rovoText;
const rc = globalThis.SXRTS.rovoContract;
const schema = globalThis.SXRTS.schema;

const errors = (raw) => rt.analyze(raw).issues.filter((i) => i.severity === "error");
const codes = (raw) => errors(raw).map((i) => i.code);
const swap = (from, to) => {
  assert.ok(TEXT_SAMPLE.includes(from), `fixture no longer contains: ${from}`);
  return TEXT_SAMPLE.replace(from, to);
};

test("detects the text report, and does not mistake JSON or prose for it", () => {
  assert.equal(rt.isText(TEXT_SAMPLE), true);
  assert.equal(rt.isText('{"extraction_status":"success"}'), false);
  assert.equal(rt.isText("Sure! Here is a summary of the company."), false);
  assert.equal(rt.isText("```json\n{\"a\":1}\n```"), false);
});

test("the real agent output reads cleanly: no errors; only genuine warnings", () => {
  const result = rt.analyze(TEXT_SAMPLE);
  assert.deepEqual(result.issues.filter((i) => i.severity === "error"), []);
  const warnings = result.issues.filter((i) => i.severity === "warning").map((i) => `${i.code}@${i.path}`).sort();
  assert.deepEqual(warnings, [
    "EXTERNAL_SOURCE@social_media_identifiers.facebook",
    "EXTERNAL_SOURCE@social_media_identifiers.instagram",
    "HEDGED_VALUE@social_media_identifiers.instagram"
  ]);
  assert.ok(result.document);
});

test("the report is mapped to the internal document: identity, website, SMIs, SIC/NAICS, keywords, descriptions", () => {
  const { document } = rt.analyze(TEXT_SAMPLE);
  assert.equal(document.profileIdentity.domain, "psypher.in");
  assert.equal(document.profileIdentity.companyName, "Psypher");
  assert.equal(document.businessEntity.websiteAddresses[0].value, "https://www.psypher.in");
  assert.equal(document.businessEntity.nameVariations, undefined, "fallback names are never written");
  assert.deepEqual(document.businessEntity.socialMediaIdentifiers.map((s) => [s.network, s.handleOrUrl]), [
    ["Facebook", "https://www.facebook.com/psyphergames"], ["Instagram", "https://www.instagram.com/psyphergames/"]
  ]);
  assert.deepEqual(document.company.sicCodes.map((s) => s.code), ["2321", "2331", "5651"]);
  assert.deepEqual(document.company.naicsCodes.map((s) => s.code), ["315220", "448140", "315240"]);
  assert.equal(document.company.keywords.length, 10);
  assert.equal(document.company.keywords[9].value, "online clothing store");
  assert.match(document.company.briefDescription.value, /^Designer of streetwear apparel/);
  assert.match(document.company.fullDescription.value, /^The company offers oversized t-shirts/);
  assert.ok(!JSON.stringify(document).includes("Not found on the official website"));
});

test("an EDS derived from a generic mailbox (info@) is held for review, not written to RTS", () => {
  const result = rt.analyze(TEXT_SAMPLE);
  assert.equal(result.document.businessEntity.emailDefaultStructure, undefined);
  const row = result.rows.find((r) => r.section === "Email Default Structure");
  assert.equal(row.status, "REVIEW_REQUIRED");
  assert.match(row.detail, /generic mailbox \(info@psypher\.in\)/);
});

test("an EDS based on a personal address maps exactly to the RTS option", () => {
  const raw = swap("{first}@psypher.in (Based on [info@psypher.in](mailto:info@psypher.in))", "{first}.{last}@psypher.in (Based on [jane.doe@psypher.in](mailto:jane.doe@psypher.in))");
  const { document } = rt.analyze(raw);
  assert.equal(document.businessEntity.emailDefaultStructure.value, "First.Last@domain.com");
});

test("the validated pipeline: plan has a pending Website Address and 3 SIC codes; keywords wait for RTS evidence", () => {
  const validated = schema.validate(TEXT_SAMPLE);
  assert.equal(validated.rovo.format, "text");
  const actions = globalThis.SXRTS.executionPlan.buildExecutionPlan(validated);
  const by = (p) => actions.filter((a) => a.jsonPath === p);
  assert.equal(by("businessEntity.websiteAddresses")[0].executionStatus, "pending");
  assert.equal(by("company.sicCodes").length, 3);
  assert.equal(by("company.keywords")[0].executionStatus, "skipped");
});

// ---- noise removal ----

const INSTRUCTIONS_ECHO = [
  "You are Scraper X, a strict, deterministic system.",
  "SECTION 1: Entity Details",
  "DOMAIN LOCK — TLD EXACTNESS RULE",
  "SECTION 2: Important website links",
  "SECTION 3: Name variations",
  "psypher.in",
  "Sure, here is the report you asked for:"
].join("\n");

test("echoed instructions, preambles and trailing chat text are ignored", () => {
  const noisy = `${INSTRUCTIONS_ECHO}\n\n${TEXT_SAMPLE}\n\nLet me know if you want anything else!\nThanks`;
  const clean = rt.analyze(TEXT_SAMPLE);
  const result = rt.analyze(noisy);
  assert.deepEqual(result.document, clean.document);
  assert.ok(result.issues.some((i) => i.code === "NOISE_REMOVED"));
  assert.ok(result.ignoredLines >= 6);
});

test("when two reports are pasted, the last one wins", () => {
  const older = TEXT_SAMPLE.replace("Formal Name: Psypher", "Formal Name: Older Name");
  const result = rt.analyze(`${older}\n\n${TEXT_SAMPLE}`);
  assert.equal(result.document.profileIdentity.formalName, "Psypher");
});

test("a paste that lost its indentation or carries escaped markdown still reads the same", () => {
  const clean = rt.analyze(TEXT_SAMPLE).document;
  const flattened = TEXT_SAMPLE.split("\n").map((l) => l.replace(/^\s+/, "")).join("\n");
  assert.deepEqual(rt.analyze(flattened).document, clean);
  const escaped = TEXT_SAMPLE.replace("Email Default Structure (EDS)", "Email Default Structure \\(EDS\\)").replace("Site Email", "Site\\_Email").replace(/\*\*/g, "");
  assert.ok(rt.analyze(escaped).document);
});

// ---- hard rules ----

test("a missing required section is named", () => {
  const raw = TEXT_SAMPLE.replace(/SECTION 7: Management[\s\S]*?(?=SECTION 8:)/, "");
  assert.ok(errors(raw).some((e) => e.code === "SECTION_MISSING" && /SECTION 7/.test(e.path)));
});

test("the domain lock: a different TLD in the accessed URL is a mismatch; missing confirmations are errors", () => {
  assert.ok(codes(swap("`https://www.psypher.in`", "`https://www.psypher.io`")).includes("DOMAIN_MISMATCH"));
  const noConfirm = TEXT_SAMPLE.replace(/\* CONFIRMATION 3:.*\n/, "");
  assert.ok(codes(noConfirm).includes("DOMAIN_CONFIRMATION_MISSING"));
});

test("near-miss fallback wording is rejected", () => {
  assert.ok(codes(swap("Legal Name: Not found on the official website.", "Legal Name: Not found")).includes("FALLBACK_NOT_EXACT"));
  assert.ok(codes(swap("Former Name: Not found on the official website.", "Former Name: N/A")).includes("FALLBACK_NOT_EXACT"));
});

test("every extracted value needs its own source URL", () => {
  const raw = swap("* Address: Borivali, Borivali East, 400066 Mumbai MH, India\n   * Source: [Privacy policy](https://www.psypher.in/policies/privacy-policy)", "* Address: Borivali, Borivali East, 400066 Mumbai MH, India");
  assert.ok(errors(raw).some((e) => e.code === "MISSING_SOURCE" && /full_address/.test(e.path)));
});

test("keywords, SIC/NAICS limits and prohibited codes follow the methodology", () => {
  assert.ok(codes(swap("streetwear apparel, oversized t-shirts, cargo pants, unisex fashion, graphic tees, Indian streetwear, premium hoodies, bold clothing, streetwear culture, online clothing store.", "streetwear apparel, hoodies.")).includes("KEYWORD_COUNT"));
  assert.ok(codes(swap("2.1.2 — Clothing", "6.5.16 — Other Software")).includes("PROHIBITED_CODE"));
  const extraSic = TEXT_SAMPLE.replace("\nNAICS CODES", "\n4. 5311 — Department Stores\n   * Relevance: x.\n   * Source: OSHA SIC Manual\n\nNAICS CODES");
  assert.ok(errors(extraSic).some((e) => /maximum is 3/.test(e.message)));
  assert.ok(codes(swap("2321 — Men's", "232 — Men's")).includes("CODE_FORMAT"));
});

test("prohibited sources are rejected anywhere in the report", () => {
  assert.ok(codes(swap("* Source 1: https://www.psypher.in/", "* Source 1: https://pitchbook.com/profiles/company/1-2")).includes("PROHIBITED_SOURCE"));
  assert.ok(codes(swap("* Blog: https://www.psypher.in/ (Streetwear Fashion Blog India section)", "* Blog: https://psypher.atlassian.net/wiki/x")).includes("PROHIBITED_SOURCE"));
});

test("Total Rounds Found must equal the rows listed in the timeline", () => {
  assert.ok(codes(swap("* Total Rounds Found: 0", "* Total Rounds Found: 2")).includes("TIMELINE_COUNT_MISMATCH"));
});

test("a halted run is shown as Rovo's own halt, alone or with chat text around it", () => {
  const halt = "Conflicting information detected across sources; extraction halted to prevent data contamination.";
  for (const raw of [halt, `Here you go:\n${halt}\nThanks`]) {
    const result = rt.analyze(raw);
    assert.equal(result.halted, true);
    assert.ok(result.issues.some((i) => i.code === "HALTED" && i.message.includes("Conflicting information")));
  }
  assert.equal(rt.isText(halt), true);
});

test("a not-for-profit flag and a missing ANC block are surfaced as warnings", () => {
  const raw = TEXT_SAMPLE.replace("SECTION 2: Important website links", "* Note: Incorrect workflow — not-for-profit organisation. Should not be tracked by any team unless published.\n\nSECTION 2: Important website links");
  assert.ok(rt.analyze(raw).issues.some((i) => i.code === "NOT_FOR_PROFIT"));
  const noAnc = TEXT_SAMPLE.slice(0, TEXT_SAMPLE.indexOf("✅"));
  assert.ok(rt.analyze(noAnc).issues.some((i) => i.code === "ANC_MISSING" && i.severity === "warning"));
});

test("a native-script name becomes 'Native Other Name'; a Latin one 'Other Name'", () => {
  const withOthers = swap("* Other Name Variation: Not found on the official website.", "* Other Name Variation: 赛弗\n   * Source: https://www.psypher.in/cn\n* Other Name Variation: Psypher Streetwear\n   * Source: https://www.psypher.in/");
  const { document } = rt.analyze(withOthers);
  assert.deepEqual(document.businessEntity.nameVariations.map((n) => [n.name, n.type]), [["赛弗", "Native Other Name"], ["Psypher Streetwear", "Other Name"]]);
});

test("the correction prompt asks for the same text format, restating only the violations", () => {
  const issues = rt.analyze(swap("* Total Rounds Found: 0", "* Total Rounds Found: 2")).issues;
  const prompt = rc.buildCorrectionPrompt(issues, "psypher.in", "text");
  assert.match(prompt, /same section format/);
  assert.match(prompt, /\[TIMELINE_COUNT_MISMATCH\]/);
  assert.doesNotMatch(prompt, /JSON/);
});

test("schema.validate rejects a broken text report with its issue list and format", () => {
  assert.throws(() => schema.validate(swap("* Total Rounds Found: 0", "* Total Rounds Found: 2")), (error) => error.format === "text" && error.errors[0].includes("[TIMELINE_COUNT_MISMATCH]"));
});
