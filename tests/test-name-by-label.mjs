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
    <table><tr><td><b>Brief Description:</b></td></tr><tr><td><div><textarea></textarea></div></td></tr></table>
    <table><tr><td><b>Full Description:</b></td></tr><tr><td><div><textarea></textarea></div></td></tr></table>
    <button id="saveDesc" disabled>Save</button>
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
  for (const box of doc.querySelectorAll("textarea")) box.addEventListener("input", () => { doc.getElementById("saveDesc").disabled = false; });
  doc.getElementById("saveDesc").addEventListener("click", () => setTimeout(() => { doc.getElementById("saveDesc").disabled = true; }, 30));
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { doc, shadow };
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


test("name a look-alike box by its label while mapping, then publish into exactly that box", async () => {
  const { doc, shadow } = setup();
  await tick();
  buttonByText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  buttonByText(card, "Teach new field").click();

  const [brief, full] = doc.querySelectorAll("textarea");
  buttonByText(card, "Pick field on page").click();
  clickOnPage(doc, "table:nth-of-type(1) textarea");
  await tick();
  assert.ok(buttonByText(card, "Name this box by its label"), "offered under the picked box: " + card.textContent.slice(0, 900));

  buttonByText(card, "Name this box by its label").click();
  clickOnPage(doc, "table:nth-of-type(1) b");
  await tick();
  assert.match(card.textContent, /the textarea that comes after the text "Brief Description:"/);
  const withValue = (value) => Array.from(card.querySelectorAll("input[type=text]")).find((i) => i.value === value);
  assert.ok(withValue("Brief Description:"), "the label text is shown and editable");

  // Editing the label to something that does not lead to this box is refused.
  const labelBox = withValue("Brief Description:");
  labelBox.value = "Full Description:";
  labelBox.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(card.textContent, /does not lead back to this box/);

  buttonByText(card, "Pick Save button").click();
  clickOnPage(doc, "#saveDesc");
  await tick();
  const texts = Array.from(card.querySelectorAll("input[type=text]"));
  texts[0].value = "Brief description";
  texts[0].dispatchEvent(new window.Event("input", { bubbles: true }));
  texts[1].value = "briefDescription";
  texts[1].dispatchEvent(new window.Event("input", { bubbles: true }));
  buttonByText(card, "Save taught field").click();
  await tick();
  const def = globalThis.SXRTS.customFields.getCached()[0];
  assert.equal(def.fields[0].selectors[0], "sx-after::textarea::Brief Description:");

  shadow.querySelector("#sxrts-response").value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Acme", pbId: "PB-1", domain: "acme.com" },
    custom: { briefDescription: { value: "Acme makes anvils.", action: "addIfMissing", source: "https://acme.com/about" } }
  });
  buttonByText(shadow, "Validate JSON").click();
  buttonByText(shadow, "Publish selected to RTS").click();
  assert.ok(await until(() => /Published 1/.test(shadow.textContent)), shadow.textContent.slice(-300));
  assert.equal(brief.value, "Acme makes anvils.");
  assert.equal(full.value, "", "the look-alike Full Description box is untouched");
});
