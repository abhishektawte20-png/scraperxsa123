// Quality gate for the Copy prompt: every rule the checker enforces is stated
// in the prompt the agent receives, and the exact failures seen in real runs
// (an empty notes string, "solutions" in a keyword, a netlify.app source) are
// both prevented in the prompt and handled by the checker.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import "../core/agentSpec.js";
import "../core/rovoContract.js";
import "../core/promptBuilder.js";
import "../core/identityLock.js";
import "../core/schema.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import { validOutput } from "./helpers/rovo-sample.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rc = globalThis.SXRTS.rovoContract;
const prompt = globalThis.SXRTS.promptBuilder.buildRunPrompt({ domain: "kpssecurity.com" });
const analyze = (src) => rc.analyze(src, { domain: "kpssecurity.com" });
const codes = (src, severity) => analyze(src).issues.filter((i) => !severity || i.severity === severity).map((i) => `${i.code}@${i.path}`);

// ---- every check the contract reader can raise is explained in the prompt ----

const COVERED_BY = {
  INVALID_TYPE: /true\/false literals|Counts of rounds are integers/,
  EMPTY_ARRAY: /emit a single object|single object|exactly one object/i,
  MISSING_KEY: /RULE 3 — SCHEMA COMPLETENESS/,
  UNKNOWN_FIELD: /emit exactly these keys/,
  NULL_NOT_ALLOWED: /RULE 5 — NULL USAGE IS RESTRICTED/,
  EMPTY_STRING: /RULE 13 — NO BLANK SLOTS/,
  FALLBACK_NOT_EXACT: /RULE 4 — FALLBACK PHRASES ARE VALUES/,
  MARKDOWN_LINK: /RULE 10 — PLAIN TEXT VALUES/,
  URL_INVALID: /RULE 6 — FIELD-LEVEL SOURCING/,
  PROHIBITED_SOURCE: /prospeo\.io, apollo\.io, zoominfo\.com, crunchbase\.com/,
  DOMAIN_MISMATCH: /exact same TLD/,
  ENTITY_NOT_IDENTIFIED: /Entity cannot be confidently identified/,
  TIMELINE_COUNT_MISMATCH: /its length must equal "funding\.total_rounds_found"/,
  SEQUENCE_ORDER: /"sequence" numbered from 1/,
  ROUND_TYPE_UNRECOGNIZED: /"funding\.timeline\[\]\.round_type": exactly one of/,
  CONSTRAINT: /best_fit": true|All-Rounders\/Private Company Team|523940/,
  CODE_FORMAT: /4-digit SIC and 6-digit NAICS/,
  KEYWORD_COUNT: /"keywords": at least 10 entries/,
  KEYWORD_FORMAT: /Never use the word "solution" or "solutions" in a keyword/,
  KEYWORD_DUPLICATE: /never repeat a keyword/,
  PROHIBITED_CODE: /1\.4\.4, 2\.6\.3, 2\.9\.1, 6\.1\.7, 6\.2\.2, 6\.4\.3 and 6\.5\.16/,
  PROHIBITED_VERTICAL: /"TMT" and "Industrials"/,
  MANAGEMENT_ENTRY: /"management\[\]\.titles"/,
  EXTERNAL_SOURCE: /netlify\.app/,
  PAGES_TRAVERSED: /only pages of the official website that you actually opened/,
  EMPLOYEE_DATE: /ONLY when the count and its source_url are on the official website/,
  NOT_FOR_PROFIT: /"not_for_profit_flag": for a not-for-profit organisation/,
  DESCRIPTION_RULE: /"business_description" is ONE sentence that begins with the classification_prefix/,
  NAME_RULE: /"name_variations\.familiar_name": never the same text as formal_name/,
  HALTED: /RULE 12 — HALT CONDITIONS/,
  HEADER_MISSING: /Keys 1 to 5 are the header/
};

test("every check the reader can raise has its rule stated in the Copy prompt", () => {
  const source = readFileSync(path.join(here, "../core/rovoContract.js"), "utf8");
  const raised = new Set([...source.matchAll(/issue\(issues,\s*"(?:error|warning)",\s*"([A-Z_]+)"/g)].map((m) => m[1]));
  assert.ok(raised.size >= 25, `found only ${raised.size} codes — the pattern may be stale`);
  const missing = [...raised].filter((code) => !COVERED_BY[code]);
  assert.deepEqual(missing, [], `these checks have no rule in the prompt yet: ${missing.join(", ")}`);
  for (const code of raised) assert.match(prompt, COVERED_BY[code], `${code}: the prompt does not state its rule`);
});

// ---- the three failures from the kpssecurity.com run ----

function kps() {
  const src = validOutput();
  src.target_domain = "kpssecurity.com";
  src.domain_confirmation = { domain_provided: "kpssecurity.com", url_accessed: "https://www.kpssecurity.com/", tld_match_confirmed: true };
  const site = "https://www.kpssecurity.com/";
  const swap = (node) => {
    if (Array.isArray(node)) return node.forEach(swap);
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === "string" && /^https:\/\/www\.acme\.com/.test(v)) node[k] = v.replace("www.acme.com", "www.kpssecurity.com");
        else swap(v);
      }
    }
  };
  swap(src);
  src.entity_details.official_website = { value: site, source_url: site };
  return src;
}

test("baseline: a report written to the prompt's rules has no errors and no warnings", () => {
  const issues = analyze(kps()).issues;
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
});

test("an empty employee_count.notes no longer blocks the preview, and the prompt forbids it by name", () => {
  const src = kps();
  src.employee_count.notes = "";
  assert.deepEqual(codes(src, "error"), []);
  assert.ok(codes(src, "warning").includes("EMPTY_STRING@employee_count.notes"));
  assert.match(prompt, /employee_count\.notes/);
  assert.match(prompt, /No additional notes\./);
});

test("an empty value that RTS does read is still an error", () => {
  const src = kps();
  src.name_variations.legal_name = { value: "", source_url: "https://www.kpssecurity.com/terms" };
  assert.ok(codes(src, "error").includes("EMPTY_STRING@name_variations.legal_name.value"));
});

test("'corporate security solutions' is rejected by the checker and banned in the prompt with the right wording given", () => {
  const src = kps();
  src.keywords[2] = "corporate security solutions";
  assert.ok(codes(src, "error").includes("KEYWORD_FORMAT@keywords[2]"));
  assert.match(prompt, /never "corporate security solutions"/);
  src.keywords[2] = "corporate security services";
  assert.deepEqual(codes(src, "error"), []);
});

test("a netlify.app source is flagged, and the prompt names hosting-platform addresses explicitly", () => {
  const src = kps();
  src.name_variations.formal_name.source_url = "https://kpssecurity.netlify.app/about";
  assert.ok(codes(src, "warning").some((c) => c.startsWith("EXTERNAL_SOURCE@kpssecurity.netlify.app")));
  assert.match(prompt, /netlify\.app, vercel\.app, github\.io/);
  assert.match(prompt, /cite the target-domain URL you requested/);
});

test("the final self-check in the prompt covers blanks, wording and source hosts", () => {
  const final = prompt.slice(prompt.indexOf("RULE 15 — FINAL CHECK"), prompt.indexOf("SCHEMA —"));
  assert.match(final, /no string anywhere is ""/);
  assert.match(final, /solution/);
  assert.match(final, /every source_url host is the target domain/);
});

// ---- robustness: whatever the agent returns, the reader answers and never throws ----

test("fuzz: every leaf set to empty, null, a number, an object or a markdown link never crashes the reader", () => {
  const leaves = [];
  const collect = (node, trail) => {
    if (Array.isArray(node)) node.forEach((v, i) => collect(v, [...trail, i]));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) collect(v, [...trail, k]);
    else leaves.push(trail);
  };
  collect(validOutput(), []);
  assert.ok(leaves.length > 150);
  const bad = ["", null, 7, {}, [], "[x](https://y.com)", "N/A", "Not found", true];
  let runs = 0;
  for (const trail of leaves) {
    for (const value of bad) {
      const src = validOutput();
      let node = src;
      for (const step of trail.slice(0, -1)) node = node[step];
      node[trail[trail.length - 1]] = value;
      const result = rc.analyze(src, { domain: "acme.com" });
      assert.ok(Array.isArray(result.issues), trail.join("."));
      runs += 1;
    }
  }
  assert.ok(runs > 1300);
});
