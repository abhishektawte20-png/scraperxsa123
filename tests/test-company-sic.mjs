// DOM-level tests for the Company > SIC workflow, run against a jsdom
// reconstruction of the evidenced markup (fixtures/company-sic.html).
// The Add/Save behavior is simulated to match what was actually
// evidenced: a new inline row appended before the Add button, and the
// Save button (observed starting disabled) returning to disabled after
// a short delay — confirmed real behavior, per registry/company.sic.js.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/company-sic.html"), "utf8");

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../registry/company.sic.js";
import "../registry/index.js";
import "../core/workflows/companySic.js";

const NEW_ROW_TEMPLATE = `
  <input type="text" value="" class="input numberField" name="code" data-disabled-if-dnb-field="">
  <select class="input input_select" name="source" data-disabled-if-dnb-field="">
    <option value="-1" selected="selected"></option>
    <option value="1">Morningstar</option>
    <option value="2">PitchBook</option>
    <option value="3">SEC</option>
  </select>
`;

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>${fixtureHtml}</body></html>`, { runScripts: "outside-only" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLInputElement = dom.window.HTMLInputElement;
  global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  global.HTMLSelectElement = dom.window.HTMLSelectElement;
  global.Event = dom.window.Event;
  global.InputEvent = dom.window.InputEvent;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};

  const addButton = document.querySelector('[onclick="companySic.add()"]');
  const saveButton = document.getElementById("saveSicIndustryPath");

  addButton.addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "sic-row";
    row.innerHTML = NEW_ROW_TEMPLATE;
    addButton.insertAdjacentElement("beforebegin", row);
    // Simulate RTS's dirty-tracking on the freshly added row's controls.
    const newRow = addButton.previousElementSibling;
    newRow.querySelector('input[name="code"]').addEventListener("input", () => { saveButton.disabled = false; });
    newRow.querySelector('select[name="source"]').addEventListener("change", () => { saveButton.disabled = false; });
  });
  saveButton.addEventListener("click", () => {
    setTimeout(() => { saveButton.disabled = true; }, 30);
  });

  return dom;
}

const { companySic } = globalThis.SXRTS.workflows;

test("adds a new SIC code with a resolved Source, and saves", async () => {
  setupDom();
  const result = await companySic.applySicCode({ code: "1521", classificationSource: "PitchBook", action: "addIfMissing" });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(result.classificationSource, "PitchBook");
  const codes = document.querySelectorAll('input.numberField[name="code"]');
  assert.equal(codes[codes.length - 1].value, "1521");
});

test("skips a duplicate code without touching the DOM", async () => {
  setupDom();
  const result = await companySic.applySicCode({ code: "8742", classificationSource: "SEC", action: "addIfMissing" });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "duplicate");
  assert.equal(document.querySelectorAll('input.numberField[name="code"]').length, 1);
});

test("leaves Source at its default when none is proposed", async () => {
  setupDom();
  const result = await companySic.applySicCode({ code: "7389", classificationSource: null, action: "addIfMissing" });
  assert.equal(result.status, "savedValueVerified");
  const selects = document.querySelectorAll('select[name="source"]');
  assert.equal(selects[selects.length - 1].value, "-1");
});

test("rejects a Source value outside the evidenced catalog", async () => {
  setupDom();
  await assert.rejects(
    () => companySic.applySicCode({ code: "1234", classificationSource: "Experian", action: "addIfMissing" }),
    /not a supported SIC Source/
  );
});

test("throws rather than reporting success when Save never returns to disabled", async () => {
  setupDom();
  const saveButton = document.getElementById("saveSicIndustryPath");
  const clone = saveButton.cloneNode(true); // drop the simulated post-save disable
  clone.disabled = false; // simulate a pending change that was registered, but the save hangs
  saveButton.replaceWith(clone);
  await assert.rejects(
    () => companySic.applySicCode({ code: "9999", classificationSource: null, action: "addIfMissing" }),
    /never returned to a disabled/
  );
});
