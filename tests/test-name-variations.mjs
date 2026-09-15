// DOM-level tests for the Name Variations workflow, run against a jsdom
// reconstruction of the evidenced RTS markup (fixtures/business-entity-
// name-variations.html). The Add/Save click handlers below simulate only
// the behavior actually observed in the supplied evidence (new row
// appended before the Add button; saved row gains data-defaultvalue match
// + the "savedNameVariation" class after a short delay).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/business-entity-name-variations.html"), "utf8");

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/index.js";
import "../core/workflows/businessEntityNameVariations.js";

const NEW_ROW_TEMPLATE = `
  <input type="text" value="" data-defaultvalue="" class="input businessEntityName" data-disabled-if-dnb-field="">
  <select class="input input_select businessEntityNameType" data-disabled-if-dnb-field="">
    <option value="FAMILIAR">Familiar Name</option>
    <option value="FORMER">Former Name</option>
    <option value="LEGAL">Legal Name</option>
    <option value="OTHER" selected="selected">Other Name</option>
    <option value="NATIVE_FORMAL">Native Formal Name</option>
    <option value="NATIVE_FAMILIAR">Native Familiar Name</option>
    <option value="NATIVE_FORMER">Native Former Name</option>
    <option value="NATIVE_LEGAL">Native Legal Name</option>
    <option value="NATIVE_OTHER">Native Other Name</option>
  </select>
`;

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>${fixtureHtml}</body></html>`, { runScripts: "outside-only" });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLInputElement = window.HTMLInputElement;
  global.HTMLTextAreaElement = window.HTMLTextAreaElement;
  global.HTMLSelectElement = window.HTMLSelectElement;
  global.Event = window.Event;
  global.InputEvent = window.InputEvent;
  window.HTMLElement.prototype.scrollIntoView = () => {};

  document.getElementById("addNameVariation").addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "name-variation-row";
    row.innerHTML = NEW_ROW_TEMPLATE;
    document.getElementById("addNameVariation").insertAdjacentElement("beforebegin", row);
  });

  document.getElementById("saveBusinessEntityNameVariation").addEventListener("click", () => {
    setTimeout(() => {
      const inputs = document.querySelectorAll(".businessEntityName");
      const last = inputs[inputs.length - 1];
      last.dataset.defaultvalue = last.value;
      last.classList.add("savedNameVariation");
    }, 30);
  });

  return dom;
}

test("applies a new name variation and verifies the saved DOM signal", async () => {
  setupDom();
  const result = await globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation({
    name: "Protocol Destination Management Company Spain",
    type: "Other Name"
  });
  assert.equal(result.status, "savedValueVerified");
  const inputs = document.querySelectorAll(".businessEntityName");
  const saved = inputs[inputs.length - 1];
  assert.equal(saved.value, "Protocol Destination Management Company Spain");
  assert.ok(saved.classList.contains("savedNameVariation"));
});

test("accepts the internal option code as well as the display label", async () => {
  setupDom();
  const result = await globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation({
    name: "Protocol DMC",
    type: "LEGAL"
  });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(result.type, "Legal Name");
});

test("never reads or overwrites the primary Formal Name field as a variation row", async () => {
  setupDom();
  const existing = globalThis.SXRTS.workflows.businessEntityNameVariations.readExistingRecords(
    globalThis.SXRTS.registry.getField("businessEntity.nameVariations")
  );
  assert.equal(existing.length, 2); // not 3 — the main field is excluded
  assert.ok(!existing.some((record) => record.nameInput.name === "formalNameVariations"));

  await globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation({ name: "Some Other Name", type: "Other Name" });
  const mainField = document.querySelector('input[name="formalNameVariations"]');
  assert.equal(mainField.value, "Protocol DMC Spain"); // untouched
});

test("skips a duplicate (same normalized name + type) without touching the DOM", async () => {
  setupDom();
  const result = await globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation({
    name: "protocol dmc spain",
    type: "familiar name"
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "duplicate");
  assert.equal(document.querySelectorAll(".businessEntityName").length, 3); // main field + 2 rows, unchanged
});

test("rejects a Type value that is not in the evidenced catalog", async () => {
  setupDom();
  await assert.rejects(
    () => globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation({ name: "X Corp", type: "Trade Name" }),
    /not a supported Name Type/
  );
});

test("throws rather than clicking Save when the button is disabled", async () => {
  setupDom();
  document.getElementById("saveBusinessEntityNameVariation").disabled = true;
  await assert.rejects(
    () => globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation({ name: "New Co", type: "Other Name" }),
    /Save button is disabled/
  );
});

test("throws rather than reporting success when the saved-value signal never appears", async () => {
  setupDom();
  const saveButton = document.getElementById("saveBusinessEntityNameVariation");
  saveButton.replaceWith(saveButton.cloneNode(true)); // drop the simulated save handler
  await assert.rejects(
    () => globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation({ name: "No Signal Co", type: "Other Name" }),
    /Save did not complete/
  );
});
