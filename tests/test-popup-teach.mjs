// Teaching a field that sits inside a popup, end to end through the real
// panel: pick the opening button, let the extension open the popup, pick the
// field and Save inside it, then publish and read the value back.

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
  while (Date.now() < deadline) { if (check()) return true; await tick(25); }
  return false;
}

function setup() {
  const dom = new JSDOM(`<!doctype html><body>
    <span class="flat-button__caption-x1">PBID: PB-1</span>
    <button id="openDlg" type="button">Edit employees</button>
    <div id="dlg" style="display:none">
      <input id="empInput" name="employees" placeholder="Employees" value="">
      <button id="dlgSave" disabled>Save</button>
      <button id="dlgClose" type="button">Close</button>
    </div>
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
  const state = { saved: "" };
  const dlg = doc.getElementById("dlg");
  const input = doc.getElementById("empInput");
  doc.getElementById("openDlg").addEventListener("click", () => { dlg.style.display = "block"; input.value = state.saved; doc.getElementById("dlgSave").disabled = true; });
  input.addEventListener("input", () => { doc.getElementById("dlgSave").disabled = false; });
  doc.getElementById("dlgSave").addEventListener("click", () => { state.saved = input.value; setTimeout(() => { dlg.style.display = "none"; }, 30); });
  doc.getElementById("dlgClose").addEventListener("click", () => { dlg.style.display = "none"; });
  globalThis.SXRTS.workflows.customField.TIMEOUTS.open = 800;

  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { doc, shadow, state, dlg };
}

const buttonByText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent.startsWith(text) || b.querySelector("b")?.textContent === text);
function clickOnPage(doc, selector) {
  const target = doc.querySelector(selector);
  doc.elementFromPoint = () => target;
  const overlay = Array.from(document.querySelectorAll("div")).map((d) => d.shadowRoot?.querySelector(".teach-overlay")).find(Boolean);
  overlay.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
}

test("teach a field inside a popup, then publish it and verify the saved value", async () => {
  const { doc, shadow, state, dlg } = setup();
  await tick();
  buttonByText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  buttonByText(card, "Teach new field").click();

  // Choose "Inside a popup": the opener step appears.
  assert.equal(buttonByText(card, "Pick the button that opens the popup"), undefined, "hidden until a popup is chosen");
  buttonByText(card, "Inside a popup").click();
  assert.match(card.textContent, /Step A · The button that opens the popup/);

  // Pick the opener; the extension clicks it for us so the popup is open.
  buttonByText(card, "Pick the button that opens the popup").click();
  clickOnPage(doc, "#openDlg");
  await tick(20);
  assert.equal(dlg.style.display, "block", "the extension opened the popup");
  assert.match(card.textContent, /Clicked it for you/);

  // While picking inside the popup the bar can reopen it if it closed.
  dlg.style.display = "none";
  buttonByText(card, "Pick field on page").click();
  const reopen = Array.from(shadow.querySelectorAll(".teach-bar button")).find((b) => b.textContent === "Open the popup");
  assert.ok(reopen, "the pick bar offers Open the popup");
  reopen.click();
  assert.equal(dlg.style.display, "block");
  clickOnPage(doc, "#empInput");
  await tick();
  assert.match(card.textContent, /#empInput/);

  buttonByText(card, "Pick Save button").click();
  clickOnPage(doc, "#dlgSave");
  await tick();
  buttonByText(card, "Pick Close button (optional)").click();
  clickOnPage(doc, "#dlgClose");
  await tick();

  buttonByText(card, "Save taught field").click();
  await tick();
  const def = globalThis.SXRTS.customFields.getCached()[0];
  assert.equal(def.key, "employees");
  assert.deepEqual(def.openButton.selectors, ["#openDlg"]);
  assert.deepEqual(def.closeButton.selectors, ["#dlgClose"]);
  assert.match(card.textContent, /Single field in a popup/);
  assert.match(card.textContent, /Popup button "Edit employees" found on this page/);

  // Publish: opens the popup itself, fills, saves, reopens to verify.
  dlg.style.display = "none";
  shadow.querySelector("#sxrts-response").value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Acme", pbId: "PB-1", domain: "acme.com" },
    custom: { employees: { value: 250, action: "addIfMissing", source: "https://acme.com/about" } }
  });
  buttonByText(shadow, "Validate JSON").click();
  buttonByText(shadow, "Publish selected to RTS").click();
  assert.ok(await until(() => /Published 1/.test(shadow.textContent)), shadow.textContent.slice(-400));
  assert.equal(state.saved, "250");
  assert.equal(dlg.style.display, "none", "the popup is closed again afterwards");
  await globalThis.SXRTS.customFields.removeDefinition("employees");
});

test("choosing a popup but not picking its opening button is stopped before saving", async () => {
  const { doc, shadow } = setup();
  await tick();
  buttonByText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  buttonByText(card, "Teach new field").click();
  buttonByText(card, "Inside a popup").click();
  dlgOpen(doc);
  buttonByText(card, "Pick field on page").click();
  clickOnPage(doc, "#empInput");
  await tick();
  buttonByText(card, "Pick Save button").click();
  clickOnPage(doc, "#dlgSave");
  await tick();
  buttonByText(card, "Save taught field").click();
  await tick();
  assert.match(card.textContent, /Pick the button that opens the popup first/);
  assert.equal(globalThis.SXRTS.customFields.getCached().length, 0);
});

function dlgOpen(doc) { doc.getElementById("dlg").style.display = "block"; }

test("a repeatable record has no popup option", async () => {
  const { shadow } = setup();
  await tick();
  buttonByText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  buttonByText(card, "Teach new field").click();
  buttonByText(card, "Repeatable record").click();
  assert.equal(buttonByText(card, "Inside a popup"), undefined);
});
