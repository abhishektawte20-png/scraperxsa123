// End to end through the real panel: teach a field by clicking it on a
// simulated RTS page, see it in the prompt, paste JSON, publish, and check
// the last-pasted-JSON cache. Page behaviour (Save enables on edit, disables
// after save) is simulated as in test-custom-workflow.mjs.

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
import "../core/resultsSummary.js";
import "../core/customFields.js";
import "../core/selectorBuilder.js";
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
import "../core/workflows/customField.js";
import "../content/teach.js";
import "../content/ui.js";
import "../content/panel.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return true;
    await tick(25);
  }
  return false;
}

function setup() {
  const dom = new JSDOM(`<!doctype html><body>
    <span class="flat-button__caption-x1">PBID: PB-1</span>
    <label for="foundedYear">Founded year</label>
    <input id="foundedYear" value="">
    <button id="saveCompany" disabled>Save</button>
  </body>`, { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent, MouseEvent: window.MouseEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const store = new Map();
  global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } } };

  const doc = window.document;
  doc.getElementById("foundedYear").addEventListener("input", () => { doc.getElementById("saveCompany").disabled = false; });
  doc.getElementById("saveCompany").addEventListener("click", () => setTimeout(() => { doc.getElementById("saveCompany").disabled = true; }, 30));

  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { doc, shadow, store };
}

const buttonByText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
// jsdom has no layout, so elementFromPoint is stubbed to return the element
// the user "clicked"; the click itself lands on the picker overlay, exactly
// as it does in a real browser.
function clickOnPage(doc, selector) {
  const target = doc.querySelector(selector);
  doc.elementFromPoint = () => target;
  const overlay = Array.from(document.querySelectorAll("div")).map((d) => d.shadowRoot?.querySelector(".teach-overlay")).find(Boolean);
  overlay.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
}

test("teach a field by clicking it on the page, then it flows through prompt, validate, publish and cache", async () => {
  const { doc, shadow, store } = setup();
  await tick();

  // Open the teach modal from the panel.
  buttonByText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  assert.match(card.textContent, /Nothing mapped yet/);

  // New field wizard -> pick the input on the page.
  buttonByText(card, "Teach new field").click();
  buttonByText(card, "Pick field on page").click();
  assert.ok(shadow.querySelector(".teach-bar"), "the on-page picker bar is shown");
  clickOnPage(doc, "#foundedYear");
  await tick();
  assert.match(card.textContent, /#foundedYear/);
  assert.match(card.textContent, /Show captured HTML/);
  assert.equal(shadow.querySelector(".teach-bar"), null, "picker is torn down after a pick");

  // Pick its Save button.
  buttonByText(card, "Pick Save button").click();
  clickOnPage(doc, "#saveCompany");
  await tick();

  // Name/description were auto-filled from the page label; add a description.
  const inputs = Array.from(card.querySelectorAll("input[type=text]"));
  assert.equal(inputs[0].value, "Founded year");
  assert.equal(inputs[1].value, "foundedYear");
  inputs[2].value = "Year the company was founded";
  inputs[2].dispatchEvent(new window.Event("input", { bubbles: true }));

  buttonByText(card, "Save taught field").click();
  await tick();
  assert.equal(globalThis.SXRTS.customFields.getCached().length, 1);
  assert.match(card.textContent, /custom\.foundedYear/);
  assert.match(card.textContent, /Found on this page/);

  // The per-run prompt stays domain-only (the Rovo agent owns its methodology),
  // while the legacy prompt builder still reflects the taught field.
  assert.doesNotMatch(shadow.querySelector("#sxrts-prompt").value, /custom\.|"custom"|custom:/);
  assert.match(globalThis.SXRTS.promptBuilder.buildPrompt({ domain: "acme.com" }), /custom\.foundedYear \(Founded year\): Year the company was founded/);

  // Paste JSON containing the taught field and validate.
  const response = shadow.querySelector("#sxrts-response");
  response.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Acme", pbId: "PB-1", domain: "acme.com" },
    custom: { foundedYear: { value: 1997, action: "addIfMissing", source: "https://acme.com/about" } }
  });
  buttonByText(shadow, "Validate JSON").click();
  const cards = shadow.querySelectorAll(".action-card");
  assert.equal(cards.length, 1);
  assert.match(cards[0].textContent, /custom\.foundedYear/);
  assert.match(cards[0].textContent, /Taught field/);

  // Publish writes the page and verifies the save.
  buttonByText(shadow, "Publish selected to RTS").click();
  assert.ok(await until(() => /Published 1/.test(shadow.textContent)), "publish summary reports one success");
  assert.equal(doc.getElementById("foundedYear").value, "1997");

  // The last pasted JSON was cached under the open profile's PBID.
  const cached = Array.from(store.keys()).find((k) => k.startsWith("sxrts_lastjson:"));
  assert.equal(cached, "sxrts_lastjson:PB-1");
  assert.match(store.get(cached).text, /foundedYear/);
});

test("a custom value outside a taught dropdown's options is rejected at validation, before any publish", async () => {
  const { shadow } = setup();
  await globalThis.SXRTS.customFields.saveDefinition({
    key: "tier", label: "Tier", description: "", kind: "single",
    fields: [{ key: "value", kind: "select", selectors: ["select#tier"], options: [{ label: "Gold", value: "G" }] }],
    saveButton: { selectors: ["#saveCompany"], text: "Save" }
  });
  const response = shadow.querySelector("#sxrts-response");
  response.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Acme", pbId: "PB-1", domain: "acme.com" },
    custom: { tier: { value: "Bronze", action: "addIfMissing" } }
  });
  buttonByText(shadow, "Validate JSON").click();
  assert.equal(shadow.querySelectorAll(".action-card").length, 0);
  assert.match(shadow.querySelector(".status.error").textContent, /Supported: Gold/);
  await globalThis.SXRTS.customFields.removeDefinition("tier");
});

test("the last pasted JSON can be restored for the same profile after reopening the panel", async () => {
  const { store } = setup();
  await globalThis.SXRTS.cache.setLastJson({ pbId: "PB-1" }, '{"restored":true}');
  // Reopen: a fresh panel on the same page identity offers the restore button.
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow2 = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow2);
  assert.ok(await until(() => buttonByText(shadow2, "Restore last pasted JSON")));
  buttonByText(shadow2, "Restore last pasted JSON").click();
  assert.equal(shadow2.querySelector("#sxrts-response").value, '{"restored":true}');
  assert.ok(store);
});
