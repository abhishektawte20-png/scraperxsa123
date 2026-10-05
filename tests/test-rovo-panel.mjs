// The real panel reading the frozen Rovo output contract (Section 13).

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/rovoContract.js";
import "../core/rovoText.js";
import "../core/schema.js";
import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/cache.js";
import "../core/stateMachine.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../core/resultsSummary.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/agentSpec.js";
import "../core/promptBuilder.js";
import "../core/outputFields.js";
import "../core/executionPlan.js";
import "../core/workflows/businessEntityNameVariations.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/workflows/companySic.js";
import "../content/ui.js";
import "../content/panel.js";
import { validOutput } from "./helpers/rovo-sample.mjs";
import { TEXT_SAMPLE } from "./helpers/rovo-text-sample.mjs";

function setup() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const store = new Map();
  global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } } };
  const copied = [];
  Object.defineProperty(global, "navigator", { value: { clipboard: { writeText: async (text) => { copied.push(text); } } }, configurable: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { shadow, copied };
}

const button = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
const paste = (shadow, value) => { shadow.querySelector("#sxrts-response").value = typeof value === "string" ? value : JSON.stringify(value); };

test("a compliant Section 13 paste builds a preview; evidence-less fields read 'waiting for RTS evidence', not 'skipped'", () => {
  const { shadow } = setup();
  paste(shadow, validOutput());
  button(shadow, "Validate JSON").click();
  assert.match(shadow.querySelector(".status").textContent, /Valid/);
  const cards = Array.from(shadow.querySelectorAll(".action-card"));
  const byPath = (p) => cards.filter((c) => c.querySelector(".action-card-field").textContent.startsWith(p));
  assert.equal(byPath("businessEntity.nameVariations").length, 3);
  assert.equal(byPath("company.sicCodes").length, 2);
  assert.equal(byPath("businessEntity.nameVariations")[0].querySelector(".badge").textContent, "pending");
  assert.equal(byPath("company.keywords")[0].querySelector(".badge").textContent, "waiting for RTS evidence");
  const details = shadow.querySelector("details");
  assert.match(details.textContent, /Funding:.*2 round\(s\)/);
  // management and the site fields are preview cards that can be mapped
  const mgmt = byPath("extras.management")[0];
  assert.ok(mgmt, "management card is shown");
  assert.equal(mgmt.querySelector(".badge").textContent, "waiting for RTS evidence");
  assert.ok(mgmt.querySelector("button.map"), "management card offers Map this field");
  assert.match(mgmt.textContent, /Map this field/);
  assert.equal(byPath("extras.address").length, 1);
});

test("a paste that breaks the output rules is rejected with the exact list, and a correction prompt is offered", async () => {
  const { shadow, copied } = setup();
  const bad = validOutput();
  bad.keywords = ["fleet"];
  bad.funding.timeline[0].source_1 = "https://pitchbook.com/profiles/company/1";
  delete bad.anc;
  paste(shadow, bad);
  button(shadow, "Validate JSON").click();
  const status = shadow.querySelector(".status").textContent;
  assert.match(status, /\[KEYWORD_COUNT\] keywords/);
  assert.match(status, /\[PROHIBITED_SOURCE\] funding\.timeline\[0\]\.source_1/);
  assert.match(status, /\[MISSING_KEY\] anc/);
  assert.equal(shadow.querySelectorAll(".action-card").length, 0);

  const fix = button(shadow, "Copy correction prompt");
  assert.ok(!fix.classList.contains("hidden"));
  fix.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(copied.length, 1);
  assert.match(copied[0], /\[PROHIBITED_SOURCE\]/);
  assert.doesNotMatch(copied[0], /Required JSON shape/);

  // Re-pasting a corrected output clears the error state and the button.
  paste(shadow, validOutput());
  button(shadow, "Validate JSON").click();
  assert.ok(fix.classList.contains("hidden"));
  assert.match(shadow.querySelector(".status").textContent, /Valid/);
});

test("a halted extraction shows Rovo's own halt reason and offers no 'correction'", () => {
  const { shadow } = setup();
  paste(shadow, { extraction_status: "halted", halt_reason: "Conflicting information detected across sources; extraction halted to prevent data contamination.", target_domain: "acme.com", extraction_date: "01 Oct 2026", anc: { accepted_used: "AIGEN_SRX_V1_Y", rejected_not_used: "AIGEN_SRX_V1_N" } });
  button(shadow, "Validate JSON").click();
  assert.match(shadow.querySelector(".status").textContent, /\[HALTED\].*Conflicting information detected/);
  assert.ok(button(shadow, "Copy correction prompt").classList.contains("hidden"));
  assert.equal(shadow.querySelectorAll(".action-card").length, 0);
});

test("a not-for-profit flag and unknown keys are surfaced as warnings, never dropped", () => {
  const { shadow } = setup();
  const src = validOutput();
  src.not_for_profit_flag = { is_not_for_profit: true, note: "Incorrect workflow — not-for-profit organisation. Should not be tracked by any team unless published." };
  src.surprise_key = 1;
  paste(shadow, src);
  button(shadow, "Validate JSON").click();
  const status = shadow.querySelector(".status").textContent;
  assert.match(status, /\[NOT_FOR_PROFIT\].*Incorrect workflow/);
  assert.match(status, /\[UNKNOWN_FIELD\] surprise_key/);
  assert.ok(shadow.querySelectorAll(".action-card").length > 0, "full output is still previewed");
});

test("the text report: noise around it is ignored, the preview is built, and held-back fields are explained", () => {
  const { shadow } = setup();
  paste(shadow, `Please extract psypher.in\nSECTION 1: Entity Details (instructions)\n\nSure, here you go:\n\n${TEXT_SAMPLE}\n\nAnything else?`);
  button(shadow, "Validate JSON").click();
  const status = shadow.querySelector(".status").textContent;
  assert.match(status, /Valid/);
  assert.match(status, /\[NOISE_REMOVED\]/);
  assert.match(status, /\[HEDGED_VALUE\] social_media_identifiers\.instagram/);
  const cards = Array.from(shadow.querySelectorAll(".action-card"));
  const byPath = (p) => cards.filter((c) => c.querySelector(".action-card-field").textContent.startsWith(p));
  assert.equal(byPath("businessEntity.websiteAddresses")[0].querySelector(".badge").textContent, "pending");
  assert.equal(byPath("company.sicCodes").length, 3);
  assert.match(shadow.querySelector("details").textContent, /Email Default Structure:.*review required.*generic mailbox/);
});

test("a text report that breaks the rules is rejected, and the correction prompt asks for the same text format", async () => {
  const { shadow, copied } = setup();
  paste(shadow, TEXT_SAMPLE.replace("* Total Rounds Found: 0", "* Total Rounds Found: 2").replace("`https://www.psypher.in`", "`https://www.psypher.io`"));
  button(shadow, "Validate JSON").click();
  const status = shadow.querySelector(".status").textContent;
  assert.match(status, /\[TIMELINE_COUNT_MISMATCH\]/);
  assert.match(status, /\[DOMAIN_MISMATCH\]/);
  assert.equal(shadow.querySelectorAll(".action-card").length, 0);
  button(shadow, "Copy correction prompt").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(copied[0], /same section format/);
  assert.doesNotMatch(copied[0], /JSON object/);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nodePath from "node:path";
const dmcOutput = readFileSync(nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), "helpers/dmcspain-output.json"), "utf8");

test("the real dmcspain.com output: with the domain in the panel only the genuine problem is shown, and the correction prompt names it", async () => {
  const { shadow, copied } = setup();
  shadow.querySelector("#sxrts-domain").value = "dmcspain.com";
  paste(shadow, dmcOutput);
  button(shadow, "Validate JSON").click();
  const status = shadow.querySelector(".status").textContent;
  assert.doesNotMatch(status, /schemaVersion|profileIdentity/);
  assert.match(status, /\[PROHIBITED_SOURCE\] employee_count\.current\.source_url: uses prospeo\.io/);
  assert.equal(shadow.querySelectorAll(".issue.err").length, 1);
  button(shadow, "Copy correction prompt").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(copied[0], /\[PROHIBITED_SOURCE\] employee_count\.current\.source_url/);
  assert.match(copied[0], /How to fix: Remove this source and use only valid sources/);
});

test("the real dmcspain.com output with no domain entered: exact missing-key errors, never the old-format message", () => {
  const { shadow } = setup();
  shadow.querySelector("#sxrts-domain").value = "";
  paste(shadow, dmcOutput);
  button(shadow, "Validate JSON").click();
  const status = shadow.querySelector(".status").textContent;
  assert.doesNotMatch(status, /schemaVersion|profileIdentity/);
  assert.match(status, /\[MISSING_KEY\] extraction_status/);
  assert.match(status, /\[MISSING_KEY\] domain_confirmation/);
});

test("when validation fails, the warnings are shown in the same pass, and the correction prompt asks the agent to fix them too", async () => {
  const { shadow, copied } = setup();
  shadow.querySelector("#sxrts-domain").value = "dmcspain.com";
  paste(shadow, dmcOutput);
  button(shadow, "Validate JSON").click();
  assert.equal(shadow.querySelectorAll(".issue.err").length, 1);
  assert.ok(shadow.querySelectorAll(".issue.warn").length >= 4, "warnings are listed under the error");
  assert.match(shadow.querySelector(".status").textContent, /\[EXTERNAL_SOURCE\] www\.esas\.org/);
  button(shadow, "Copy correction prompt").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(copied[0], /Also fix these/);
  assert.match(copied[0], /\[EXTERNAL_SOURCE\] www\.esas\.org/);
  assert.match(copied[0], /\[EMPLOYEE_DATE\] employee_count\.current\.date/);
  assert.match(copied[0], /How to fix: Use a page on the official website/);
});

test("output that is not in the agent's format at all still gets a correction prompt, with the exact format resent", async () => {
  const { shadow, copied } = setup();
  shadow.querySelector("#sxrts-domain")?.setAttribute("value", "kpssecurity.com");
  const fix = button(shadow, "Copy correction prompt");
  for (const pasted of ["Here is what I found about the company: it sells locks.", '{"company": {"name": "x",}}', "[see report](https://example.com/report) {\"a\":1}"]) {
    paste(shadow, pasted);
    button(shadow, "Validate JSON").click();
    assert.ok(!fix.classList.contains("hidden"), `button shown for: ${pasted}`);
    copied.length = 0;
    fix.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(copied[0], /could not be read because it was not in the required output format/);
    assert.match(copied[0], /THIS RUN/);
    assert.match(copied[0], /extraction_status/);
    assert.match(copied[0], /Start a fresh session reset/);
  }
  // Nothing pasted yet is not a format problem.
  paste(shadow, "");
  button(shadow, "Validate JSON").click();
  assert.ok(fix.classList.contains("hidden"));
});

test("a valid output that still breaks methodology rules can be sent back for a cleaner run", async () => {
  const { shadow, copied } = setup();
  const out = validOutput();
  out.employee_count.source_1 = "https://www.linkedin.com/company/acme";
  paste(shadow, out);
  button(shadow, "Validate JSON").click();
  assert.match(shadow.querySelector(".status").textContent, /Valid/);
  const fix = button(shadow, "Copy correction prompt");
  assert.ok(!fix.classList.contains("hidden"));
  fix.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(copied[0], /Fix these \(the output could be read, but they broke your methodology\)/);
  assert.match(copied[0], /EXTERNAL_SOURCE/);
  assert.doesNotMatch(copied[0], /Fix exactly these problems/);

  // A clean output offers nothing to correct.
  paste(shadow, validOutput());
  button(shadow, "Validate JSON").click();
  assert.ok(fix.classList.contains("hidden"));
});
