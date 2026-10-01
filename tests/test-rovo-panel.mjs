// The real panel reading the frozen Rovo output contract (Section 13).

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/rovoContract.js";
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
import "../core/promptBuilder.js";
import "../core/executionPlan.js";
import "../core/workflows/businessEntityNameVariations.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/workflows/companySic.js";
import "../content/panel.js";
import { validOutput } from "./helpers/rovo-sample.mjs";

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
  assert.match(details.textContent, /Management:.*Jane Doe.*waiting for evidence/);
  assert.match(details.textContent, /Funding:.*2 round\(s\)/);
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
