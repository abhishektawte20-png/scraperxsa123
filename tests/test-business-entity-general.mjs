// DOM-level tests for the Business Entity "General" shared-save-group
// workflow (Website Address, Email Default Structure, Research Notes),
// run against a jsdom reconstruction of the evidenced markup. The Save
// button's dirty-tracking and post-save disabled state are SIMULATED
// here to match the confirmed real behavior (the researcher verified
// the button returns to disabled after a successful save).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/business-entity-general.html"), "utf8");

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../registry/businessEntity.general.js";
import "../registry/index.js";
import "../core/workflows/businessEntityGeneral.js";

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

  const saveButton = document.getElementById("saveBusinessEntityButton");
  for (const selector of ["#webURL", 'select[name="businessEntity.emailDefaultStructure.id"]', ".highlight-textarea"]) {
    document.querySelector(selector).addEventListener("input", () => { saveButton.disabled = false; });
    document.querySelector(selector).addEventListener("change", () => { saveButton.disabled = false; });
  }
  saveButton.addEventListener("click", () => {
    setTimeout(() => { saveButton.disabled = true; }, 30);
  });

  return dom;
}

const { businessEntityGeneral } = globalThis.SXRTS.workflows;

test("writes Website Address when currently blank, then saves the group", async () => {
  setupDom();
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.dmcspain.com", action: "addIfMissing" }]
  });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(result.results.websiteAddresses.status, "savedValueVerified");
  assert.equal(document.getElementById("webURL").value, "www.dmcspain.com");
});

test("skips Website Address when it already has a value, unless replaceAfterConfirmation", async () => {
  setupDom();
  document.getElementById("webURL").value = "www.existing.com";
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.new.com", action: "addIfMissing" }]
  });
  assert.equal(result.status, "skipped");
  assert.equal(document.getElementById("webURL").value, "www.existing.com");

  const replaced = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.new.com", action: "replaceAfterConfirmation" }]
  });
  assert.equal(replaced.status, "savedValueVerified");
  assert.equal(document.getElementById("webURL").value, "www.new.com");
});

test("selects Email Default Structure by label or by code, only when currently blank", async () => {
  setupDom();
  const select = document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]');
  select.value = "-1"; // simulate a profile with no structure set yet
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    emailDefaultStructure: { value: "2", action: "addIfMissing" }
  });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(select.value, "2");
});

test("rejects an Email Default Structure value outside the evidenced catalog", async () => {
  setupDom();
  document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]').value = "-1";
  await assert.rejects(
    () => businessEntityGeneral.applyBusinessEntityGeneral({ emailDefaultStructure: { value: "Not.A.Real@pattern.com", action: "addIfMissing" } }),
    /not a supported Email Default Structure value/
  );
});

test("appends a research note only if not already present, and saves", async () => {
  setupDom();
  const editable = document.querySelector(".highlight-textarea");
  editable.textContent = "Existing note about the business.";
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    researchNotes: [
      { text: "Existing note about the business.", action: "addIfMissing" }, // already present, should not duplicate
      { text: "Bootstrapped, no external funding identified.", action: "addIfMissing" }
    ]
  });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(editable.textContent, "Existing note about the business.\nBootstrapped, no external funding identified.");
});

test("replaceAfterConfirmation overwrites existing research notes", async () => {
  setupDom();
  const editable = document.querySelector(".highlight-textarea");
  editable.textContent = "Old note.";
  await businessEntityGeneral.applyBusinessEntityGeneral({
    researchNotes: [{ text: "Fully replaced note.", action: "replaceAfterConfirmation" }]
  });
  assert.equal(editable.textContent, "Fully replaced note.");
});

test("applies all three fields together with exactly one Save click", async () => {
  setupDom();
  document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]').value = "-1"; // start blank, like Website Address
  const saveButton = document.getElementById("saveBusinessEntityButton");
  let clicks = 0;
  saveButton.addEventListener("click", () => { clicks += 1; });

  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.dmcspain.com", action: "addIfMissing" }],
    emailDefaultStructure: { value: "FirstInitialLastName@domain.com", action: "addIfMissing" },
    researchNotes: [{ text: "New note.", action: "addIfMissing" }]
  });

  assert.equal(clicks, 1);
  assert.equal(result.status, "savedValueVerified");
  assert.equal(result.results.websiteAddresses.status, "savedValueVerified");
  assert.equal(result.results.emailDefaultStructure.status, "savedValueVerified");
  assert.equal(result.results.researchNotes.status, "savedValueVerified");
});

test("reports failure (never false success) when the Save button never returns to disabled", async () => {
  setupDom();
  const saveButton = document.getElementById("saveBusinessEntityButton");
  const clone = saveButton.cloneNode(true); // drop the simulated post-save disable
  clone.disabled = false; // simulate a pending change that was registered, but the save hangs
  saveButton.replaceWith(clone);
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.dmcspain.com", action: "addIfMissing" }]
  });
  assert.equal(result.status, "failed");
  assert.match(result.results.websiteAddresses.reason, /never returned to a disabled/);
});

test("skips the whole group with nothing to save when every field is already populated", async () => {
  setupDom();
  document.getElementById("webURL").value = "www.already-set.com";
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.other.com", action: "addIfMissing" }]
  });
  assert.equal(result.status, "skipped");
});
