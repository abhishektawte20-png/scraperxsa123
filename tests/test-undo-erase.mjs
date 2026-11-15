// Undo erases what this tool added, and only that: the act log text, restored statuses / history rows, the keyword tag.
// Everything else on the page must be byte-for-byte unchanged afterwards.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
import { statusControlsHtml } from "./helpers/status-controls.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/business-entity-general.html"), "utf8");

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../registry/businessEntity.general.js";
import "../registry/index.js";
import "../core/selectorBuilder.js";
import "../core/workflows/statusHistory.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/undoLedger.js";
const { undoLedger } = globalThis.SXRTS;
const wf = globalThis.SXRTS.workflows;

function setupDom(extra = "") {
  const dom = new JSDOM(`<!doctype html><html><body>${fixtureHtml}${extra}</body></html>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const save = document.getElementById("saveBusinessEntityButton");
  state.saves = 0;
  for (const selector of ["#webURL", 'select[name="businessEntity.emailDefaultStructure.id"]', ".highlight-textarea"]) {
    document.querySelector(selector).addEventListener("input", () => { save.disabled = false; });
    document.querySelector(selector).addEventListener("change", () => { save.disabled = false; });
  }
  document.body.addEventListener("change", () => { save.disabled = false; });
  save.addEventListener("click", () => { state.saves++; setTimeout(() => { save.disabled = true; }, 30); });
}
const state = { saves: 0 };
const NOTE = "11/12/26 Abhishek.Tawte: Completed New Co Research.\n\n\nAGENTS: AIGEN_SRX_V1_Y\nUsed ScraperX UI Automation Tool for Research\n///";

test("the act log: undo removes only the text this tool added; the old notes, links and breaks stay exactly as they were", async () => {
  setupDom();
  const editable = document.querySelector(".highlight-textarea");
  editable.innerHTML = '06/12/26, Aimee: per NBC<br>1 <a class="highlight-textarea__link" href="https://x.com/">https://x.com/</a><br><br>10/30/26 Sampada: proceed ///';
  const original = editable.innerHTML;
  const website = document.getElementById("webURL").value;
  const run = await wf.businessEntityGeneral.applyBusinessEntityGeneral({ researchNotes: [{ text: NOTE, action: "addIfMissing" }] });
  assert.equal(run.status, "savedValueVerified");
  assert.notEqual(editable.innerHTML, original);
  const item = { id: "0", path: "businessEntity.researchNotes", value: NOTE, added: run.results.researchNotes.added, ...undoLedger.planFor({ path: "businessEntity.researchNotes", added: run.results.researchNotes.added }) };
  assert.equal(item.kind, "researchNote");
  const result = await undoLedger.undoItem({ ...item, kind: "researchNote" });
  assert.equal(result.ok, true, result.message);
  assert.equal(editable.innerHTML, original, "the box is exactly as it was before the run");
  assert.equal(document.getElementById("webURL").value, website, "nothing else changed");
});

test("the act log: text that was edited since is NOT removed (nothing is changed, nothing saved)", async () => {
  setupDom();
  const editable = document.querySelector(".highlight-textarea");
  editable.innerHTML = "old ///";
  await wf.businessEntityGeneral.applyBusinessEntityGeneral({ researchNotes: [{ text: NOTE, action: "addIfMissing" }] });
  editable.innerHTML = editable.innerHTML.replace("Completed New Co Research.", "Completed New Co Research (edited by hand).");
  const edited = editable.innerHTML;
  state.saves = 0;
  const result = await undoLedger.undoItem({ kind: "researchNote", added: [NOTE] });
  assert.equal(result.ok, false);
  assert.equal(editable.innerHTML, edited);
  assert.equal(state.saves, 0);
});

test("a status goes back to what it was, and the other two statuses are not touched", async () => {
  setupDom(statusControlsHtml({ financing: "Angel-Backed" }));
  const selects = Array.from(document.querySelectorAll("select")).map((s) => [s.name || s.id, s.value]);
  const run = await wf.businessEntityGeneral.applyBusinessEntityGeneral({ financingStatus: { action: "replaceAfterConfirmation", value: "Corporation" } });
  const before = run.results.financingStatus.before;
  assert.equal(run.status, "savedValueVerified", JSON.stringify(run));
  assert.equal(before, "Angel-Backed");
  const result = await undoLedger.undoItem({ kind: "status", path: "businessEntity.financingStatus", before });
  assert.equal(result.ok, true, result.message);
  const now = Array.from(document.querySelectorAll("select")).map((s) => [s.name || s.id, s.value]);
  assert.deepEqual(now, selects, "financing is back to Angel-Backed; research and publish never moved");
});

test("a keyword: only the pill with that exact text is removed, then saved and read back", async () => {
  setupDom('<div class="keywords__list"><div class="base-pill"><div class="element-group__item">AI</div><div class="element-group__item base-pill__close-icon"></div></div><div class="base-pill"><div class="element-group__item">AI tools</div><div class="element-group__item base-pill__close-icon"></div></div></div><button data-test-id="description-keywords-save-btn" id="kwsave">Save Changes</button>');
  document.querySelectorAll(".base-pill__close-icon").forEach((x) => x.addEventListener("click", () => { x.closest(".base-pill").remove(); document.getElementById("kwsave").disabled = false; }));
  const kw = document.getElementById("kwsave");
  kw.addEventListener("click", () => setTimeout(() => { kw.disabled = true; }, 20));
  globalThis.SXRTS.customFields = { getDefinition: () => ({ saveButton: { selectors: ['[data-test-id="description-keywords-save-btn"]'], text: "Save Changes" } }) };
  const result = await undoLedger.undoItem({ kind: "keyword", customKey: "k", value: "AI" });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(Array.from(document.querySelectorAll(".base-pill")).map((p) => p.firstElementChild.textContent), ["AI tools"]);
});

test("plans: act log, status, history, keyword get automatic undo; an added history row (no 'before') stays by hand", () => {
  const p = (item) => undoLedger.planFor(item);
  assert.equal(p({ path: "businessEntity.researchNotes", added: ["x"] }).auto, true);
  assert.equal(p({ path: "businessEntity.researchNotes" }).auto, false);
  assert.equal(p({ path: "businessEntity.publishStatus", before: "Hold" }).auto, true);
  assert.equal(p({ path: "businessEntity.ownershipStatus", before: "05/17/2022 · Privately Held" }).auto, true);
  assert.equal(p({ path: "businessEntity.ownershipStatus", before: "" }).auto, false);
  assert.equal(p({ path: "company.keywords", customKey: "k" }).auto, true);
});
