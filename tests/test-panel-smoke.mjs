// Smoke test for content/panel.js: mounts the real panel into a bare
// jsdom page (no RTS markup at all) and exercises the parts that don't
// require a live RTS DOM — validation, preview rendering, cache writes,
// and that Publish correctly blocks via the identity lock when no RTS
// identity can be read. This does NOT exercise the DOM-mutating
// workflows themselves (those have their own dedicated fixture tests).

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/schema.js";
import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/cache.js";
import "../core/stateMachine.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
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

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.HTMLInputElement = window.HTMLInputElement;
  global.HTMLTextAreaElement = window.HTMLTextAreaElement;
  global.HTMLSelectElement = window.HTMLSelectElement;
  global.Event = window.Event;
  global.InputEvent = window.InputEvent;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const store = new Map();
  global.chrome = {
    storage: {
      local: {
        async get(key) { return store.has(key) ? { [key]: store.get(key) } : {}; },
        async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
        async remove(key) { store.delete(key); }
      }
    }
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { dom, shadow };
}

function textOf(shadow, selector) {
  return shadow.querySelector(selector)?.textContent ?? "";
}

test("mounts without throwing and shows the ScraperX brand", () => {
  const { shadow } = setupDom();
  assert.match(textOf(shadow, ".brand-text h1"), /ScraperX/);
  assert.ok(shadow.querySelector("#sxrts-response"));
});

test("validating a valid response builds a preview with the expected row count", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" },
    businessEntity: {
      nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing" }],
      websiteAddresses: [{ value: "www.psypher.in", action: "addIfMissing" }]
    }
  });
  responseArea.dispatchEvent(new window.Event("input", { bubbles: true }));

  const validateButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON");
  validateButton.click();

  const rows = shadow.querySelectorAll(".action-card");
  assert.equal(rows.length, 2);
  const publishButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish selected to RTS");
  assert.equal(publishButton.disabled, false);
});

test("a record's proposed value renders as labeled, individually editable fields (not a raw JSON blob)", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" },
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const card = shadow.querySelector(".action-card");
  const labels = Array.from(card.querySelectorAll(".value-field-label")).map((el) => el.textContent);
  assert.ok(labels.includes("name"));
  assert.ok(labels.includes("type"));

  const nameField = Array.from(card.querySelectorAll(".value-field")).find((f) => f.querySelector(".value-field-label").textContent === "name");
  const nameInput = nameField.querySelector("input, textarea");
  assert.equal(nameInput.value, "Psypher Inc");
  nameInput.value = "Psypher Incorporated"; // simulate a manual correction
  assert.equal(nameInput.value, "Psypher Incorporated"); // no JSON parsing involved, nothing to silently discard
});

test("rejects invalid JSON without building a preview", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = "{not valid json";
  const validateButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON");
  validateButton.click();
  const previewCard = Array.from(shadow.querySelectorAll(".card")).find((c) => c.textContent.includes("Preview, edit"));
  assert.ok(previewCard.classList.contains("hidden"));
});

test("publish blocks via the identity lock when no RTS page is present", async () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" },
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const publishButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish selected to RTS");
  publishButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const statuses = shadow.querySelectorAll(".status");
  const publishStatus = statuses[statuses.length - 1];
  assert.match(publishStatus.textContent, /Blocked:/);
});

// Regression coverage for a real reported case: an existing RTS profile
// with a visible PBID but a blank Domain field. Rovo's JSON always has
// pbId/entityId as null (it has no way to know an RTS-internal ID), so
// domain is the only field that could ever match — and here it can't,
// even though the profile is legitimate. This must no longer be a hard
// block; it should ask the researcher to manually confirm instead.
function addIdentityWithNoStrongMatch() {
  document.body.insertAdjacentHTML("beforeend", `
    <span class="flat-button__caption flat-button__caption-abc123">PBID: 862926-85</span>
    <input type="text" name="formalNameVariations" value="Aroma Grow Store" data-defaultvalue="Aroma Grow Store">
    <input type="text" value="" id="domainValue">
  `);
}

test("insufficient identity (no strong match, but no conflict either) asks for manual confirmation instead of blocking", async () => {
  const { shadow } = setupDom();
  addIdentityWithNoStrongMatch();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Aroma Grow Store", domain: "aromagrowstore.com" },
    businessEntity: { nameVariations: [{ name: "Best Supply Partners LLC", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  let confirmCalls = 0;
  window.confirm = () => { confirmCalls += 1; return confirmCalls === 1; }; // accept the generic publish confirm, decline the identity one

  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish selected to RTS").click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const statuses = shadow.querySelectorAll(".status");
  assert.match(statuses[statuses.length - 1].textContent, /could not be auto-confirmed, and you chose not to proceed manually/);
  assert.equal(confirmCalls, 2, "both the generic publish confirm and the identity confirm should have been asked");
});

test("insufficient identity proceeds to publish once manually confirmed", async () => {
  const { shadow } = setupDom();
  addIdentityWithNoStrongMatch();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="name-variation-row">
      <input type="text" value="" data-defaultvalue="" class="input businessEntityName" data-disabled-if-dnb-field="">
      <select class="input input_select businessEntityNameType" data-disabled-if-dnb-field="">
        <option value="LEGAL" selected="selected">Legal Name</option>
      </select>
    </div>
    <input type="button" value="Add New Name Variation" class="btn" id="addNameVariation">
    <input type="button" value="Save" id="saveBusinessEntityNameVariation">
  `);
  const nameInputs = () => document.querySelectorAll(".businessEntityName");
  document.getElementById("addNameVariation").addEventListener("click", () => {
    const row = document.createElement("div");
    row.innerHTML = `<input type="text" value="" data-defaultvalue="" class="input businessEntityName"><select class="input input_select businessEntityNameType"><option value="LEGAL" selected="selected">Legal Name</option></select>`;
    document.getElementById("addNameVariation").insertAdjacentElement("beforebegin", row);
  });
  document.getElementById("saveBusinessEntityNameVariation").addEventListener("click", () => {
    setTimeout(() => {
      const last = [...nameInputs()].pop();
      last.dataset.defaultvalue = last.value;
      last.classList.add("savedNameVariation");
    }, 10);
  });

  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Aroma Grow Store", domain: "aromagrowstore.com" },
    businessEntity: { nameVariations: [{ name: "Best Supply Partners LLC", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  window.confirm = () => true; // accept both the generic publish confirm and the identity confirm

  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish selected to RTS").click();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const statuses = shadow.querySelectorAll(".status");
  assert.match(statuses[statuses.length - 1].textContent, /Published 1, skipped 0, failed 0/);
});

test("clear cache button does not throw when no cache exists yet", async () => {
  const { shadow } = setupDom();
  const clearButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Clear cache for this profile");
  assert.doesNotThrow(() => clearButton.click());
});

test("copy agent setup instructions button exists and does not throw without a clipboard API", () => {
  const { shadow } = setupDom();
  const button = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Copy agent setup instructions");
  assert.ok(button);
  assert.doesNotThrow(() => button.click());
});

test("action and Name Type render as constrained dropdowns, not free-text inputs", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1" },
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing", confidence: "high" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const card = shadow.querySelector(".action-card");
  const fieldByLabel = (label) => Array.from(card.querySelectorAll(".value-field")).find((f) => f.querySelector(".value-field-label").textContent === label);

  const actionSelect = fieldByLabel("action").querySelector("select");
  assert.ok(actionSelect, "action should render as a <select>, not an <input>");
  assert.equal(actionSelect.value, "addIfMissing");

  const typeSelect = fieldByLabel("type").querySelector("select");
  assert.ok(typeSelect, "Name Type should render as a <select> populated from the evidenced catalog");
  assert.equal(typeSelect.value, "Legal Name");

  const confidenceSelect = fieldByLabel("confidence").querySelector("select");
  assert.ok(confidenceSelect, "confidence should render as a <select>");
  assert.equal(confidenceSelect.value, "high");
});

// Regression test for a real bug: core/executionPlan.js used to unwrap an
// envelope-kind field's proposedValue down to a bare scalar (e.g. just the
// email-pattern string), but applyEmailDefaultStructureValue() reads
// .action/.value off an object — so every real publish of this field
// either threw "'undefined' is not a supported Email Default Structure
// value" or silently no-op'd. This exercises the full panel -> execution
// plan -> workflow chain against a live (jsdom) RTS DOM to prove it now
// actually writes and saves the value.
test("publishing Email Default Structure actually writes and saves it end to end", async () => {
  const { shadow } = setupDom();
  document.body.insertAdjacentHTML("beforeend", `
    <span class="flat-button__caption flat-button__caption-abc123">PBID: PB-1</span>
    <input type="text" name="formalNameVariations" value="Aroma Grow Store" data-defaultvalue="Aroma Grow Store">
    <input type="text" value="" id="domainValue">
    <input type="text" value="" id="webURL" name="businessEntity.webURL">
    <select name="businessEntity.emailDefaultStructure.id">
      <option value="-1" selected="selected"></option>
      <option value="2">FirstInitialLastName@domain.com</option>
    </select>
    <div class="highlight-textarea" contenteditable=""></div>
    <input type="button" disabled="disabled" id="saveBusinessEntityButton">
  `);
  const emailSelect = document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]');
  const saveButton = document.getElementById("saveBusinessEntityButton");
  emailSelect.addEventListener("input", () => { saveButton.disabled = false; });
  emailSelect.addEventListener("change", () => { saveButton.disabled = false; });
  saveButton.addEventListener("click", () => { setTimeout(() => { saveButton.disabled = true; }, 10); });

  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Aroma Grow Store", pbId: "PB-1" },
    businessEntity: { emailDefaultStructure: { value: "FirstInitialLastName@domain.com", action: "addIfMissing" } }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const publishButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish selected to RTS");
  publishButton.click();
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(emailSelect.value, "2");
  const statuses = shadow.querySelectorAll(".status");
  assert.match(statuses[statuses.length - 1].textContent, /Published 1, skipped 0, failed 0/);
});

test("an invalid manual edit is caught by real schema re-validation before any workflow runs", async () => {
  const { shadow } = setupDom();
  document.body.insertAdjacentHTML("beforeend", `
    <span class="flat-button__caption flat-button__caption-abc123">PBID: PB-1</span>
    <input type="text" name="formalNameVariations" value="Aroma Grow Store" data-defaultvalue="Aroma Grow Store">
  `);
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Aroma Grow Store", pbId: "PB-1" },
    businessEntity: { nameVariations: [{ name: "Aroma Grow Store", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const card = shadow.querySelector(".action-card");
  const nameField = Array.from(card.querySelectorAll(".value-field")).find((f) => f.querySelector(".value-field-label").textContent === "name");
  nameField.querySelector("input").value = "   "; // blanked out by mistake while correcting it

  const publishButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish selected to RTS");
  publishButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const reason = card.querySelector(".action-reason").textContent;
  assert.match(reason, /must be a non-empty string/);
  assert.ok(!/Add New Name Variation/.test(reason), "the workflow (and its live DOM lookup) must never run once re-validation rejects the edit");
});
