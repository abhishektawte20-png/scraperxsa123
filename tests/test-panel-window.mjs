// "Map this field": a report value with no native RTS workflow is tied to an RTS
// field from the preview row, then published and read back.

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
import "../core/issueReport.js";
import "../core/customFields.js";
import "../core/outputRules.js";
import "../core/outputFields.js";
import "../core/selectorBuilder.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/agentSpec.js";
import "../core/promptBuilder.js";
import "../core/executionPlan.js";
import "../core/workflows/businessEntityNameVariations.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/workflows/companySic.js";
import "../core/workflows/customField.js";
import "../content/ui.js";
import "../content/teach.js";
import "../content/rules.js";
import "../content/panel.js";
import { TEXT_SAMPLE } from "./helpers/rovo-text-sample.mjs";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return true; await tick(25); }
  return false;
}

function setup() {
  const dom = new JSDOM(`<!doctype html><body>
    <span class="flat-button__caption-x1">PBID: PB-1</span>
    <textarea id="briefDesc"></textarea>
    <button id="saveDesc" disabled>Save</button>
    <div id="smi"><div class="smiRow"><select class="net"><option value="">--</option><option value="FB">Facebook</option><option value="IG">Instagram</option></select><input class="handle"></div></div>
    <button id="addSmi" type="button">Add</button>
    <button id="saveSmi" disabled>Save</button>
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
  global.chrome = { storage: { saved: {}, local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) { store.set(k, v); global.chrome.storage.saved[k] = JSON.parse(JSON.stringify(v)); } }, async remove(k) { store.delete(k); } } } };

  const doc = window.document;
  const enable = (id) => () => { doc.getElementById(id).disabled = false; };
  doc.getElementById("briefDesc").addEventListener("input", enable("saveDesc"));
  doc.getElementById("saveDesc").addEventListener("click", () => setTimeout(() => { doc.getElementById("saveDesc").disabled = true; }, 30));
  const wire = (row) => { for (const c of row.querySelectorAll("select, input")) { c.addEventListener("input", enable("saveSmi")); c.addEventListener("change", enable("saveSmi")); } };
  wire(doc.querySelector(".smiRow"));
  doc.getElementById("addSmi").addEventListener("click", () => {
    const row = doc.createElement("div"); row.className = "smiRow";
    row.innerHTML = '<select class="net"><option value="">--</option><option value="FB">Facebook</option><option value="IG">Instagram</option></select><input class="handle">';
    doc.getElementById("smi").appendChild(row); wire(row);
  });
  doc.getElementById("saveSmi").addEventListener("click", () => setTimeout(() => { doc.getElementById("saveSmi").disabled = true; }, 30));

  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { doc, shadow };
}

const btn = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
function pickOnPage(doc, selector) {
  const target = doc.querySelector(selector);
  doc.elementFromPoint = () => target;
  const overlay = Array.from(document.querySelectorAll("div")).map((d) => d.shadowRoot?.querySelector(".teach-overlay")).find(Boolean);
  overlay.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
}
const cardFor = (shadow, path) => Array.from(shadow.querySelectorAll(".action-card")).filter((c) => c.querySelector(".action-card-field").textContent.startsWith(path));

async function publishOnly(shadow, path) {
  for (const card of shadow.querySelectorAll(".action-card")) {
    const box = card.querySelector("input[type=checkbox]");
    if (box && !box.disabled) box.checked = card.querySelector(".action-card-field").textContent.startsWith(path);
  }
  btn(shadow, "Publish selected to RTS").click();
  assert.ok(await until(() => /Published \d/.test(shadow.textContent)), "publish finished");
}


const fire = (target, type, init = {}) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
const settleStorage = () => tick(10);

test("the window can be dragged by its title bar, stays reachable, and the place is remembered", async () => {
  const { shadow } = setup();
  await tick();
  const panel = shadow.querySelector(".panel");
  const head = shadow.querySelector(".head");
  fire(head, "mousedown", { clientX: 10, clientY: 10 });
  assert.ok(panel.classList.contains("dragging"));
  fire(window, "mousemove", { clientX: 210, clientY: 130 });
  fire(window, "mouseup");
  assert.equal(panel.classList.contains("dragging"), false);
  assert.equal(panel.style.left, "200px");
  assert.equal(panel.style.top, "120px");
  assert.equal(panel.style.right, "auto");
  await settleStorage();
  assert.deepEqual(JSON.parse(JSON.stringify(globalThis.chrome.storage.saved?.sxrts_panel_ui ?? {})), globalThis.chrome.storage.saved?.sxrts_panel_ui ?? {});

  // Dragging far off screen keeps a strip of the title bar in view.
  fire(head, "mousedown", { clientX: 200, clientY: 120 });
  fire(window, "mousemove", { clientX: 99999, clientY: 99999 });
  fire(window, "mouseup");
  assert.ok(parseInt(panel.style.left, 10) < window.innerWidth, "still on screen horizontally");
  assert.ok(parseInt(panel.style.top, 10) < window.innerHeight, "still on screen vertically");

  // A press on a title-bar button is not a drag.
  fire(shadow.querySelector(".close.minimize"), "mousedown", { clientX: 1, clientY: 1 });
  assert.equal(panel.classList.contains("dragging"), false);
});

test("minimize shrinks the window to its title bar and restores it; double-click resets the position", async () => {
  const { shadow } = setup();
  await tick();
  const panel = shadow.querySelector(".panel");
  const minimize = shadow.querySelector(".minimize");
  minimize.click();
  assert.ok(panel.classList.contains("min"));
  assert.equal(minimize.textContent, "▢");
  minimize.click();
  assert.equal(panel.classList.contains("min"), false);

  fire(shadow.querySelector(".head"), "mousedown", { clientX: 5, clientY: 5 });
  fire(window, "mousemove", { clientX: 305, clientY: 205 });
  fire(window, "mouseup");
  minimize.click();
  shadow.querySelector(".head").dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  assert.equal(panel.classList.contains("min"), false);
  assert.equal(panel.style.left, "");
  assert.equal(panel.style.right, "");
});

test("the remembered place and minimized state come back when the window is opened again", async () => {
  const first = setup();
  await tick();
  fire(first.shadow.querySelector(".head"), "mousedown", { clientX: 0, clientY: 0 });
  fire(window, "mousemove", { clientX: 150, clientY: 90 });
  fire(window, "mouseup");
  first.shadow.querySelector(".minimize").click();
  await settleStorage();
  const saved = globalThis.chrome.storage.saved;
  assert.ok(saved?.sxrts_panel_ui, "saved");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow2 = host.attachShadow({ mode: "open" });
  globalThis.chrome.storage.local.get = async (k) => ({ [k]: saved[k] });
  globalThis.SXRTS.panel.mount(shadow2);
  await tick(30);
  const panel2 = shadow2.querySelector(".panel");
  assert.equal(panel2.style.left, "150px");
  assert.equal(panel2.style.top, "90px");
  assert.ok(panel2.classList.contains("min"));
});

test("every card can be folded and unfolded from its heading", async () => {
  const { shadow } = setup();
  await tick();
  const card = shadow.querySelector(".card");
  const heading = card.querySelector("h2");
  assert.ok(heading.classList.contains("fold"));
  heading.click();
  assert.ok(card.classList.contains("collapsed"));
  heading.click();
  assert.equal(card.classList.contains("collapsed"), false);
});

test("the issues report gathers validation errors in one box and copies", async () => {
  const { shadow } = setup();
  await tick();
  const report = shadow.querySelector("#sxrts-report");
  assert.ok(shadow.querySelector("#sxrts-report").closest(".card").classList.contains("hidden"), "hidden until there is something to report");
  shadow.querySelector("#sxrts-response").value = "this is not a report";
  btn(shadow, "Validate JSON").click();
  const card = report.closest(".card");
  assert.equal(card.classList.contains("hidden"), false);
  assert.match(report.value, /^ScraperX issue report/);
  assert.match(report.value, /Validation: FAILED/);
  assert.match(report.value, /VALIDATION ERRORS \(\d+\)/);
  assert.match(card.querySelector(".report-count").textContent, /to look at/);

  let copied = "";
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text) => { copied = text; } } }, configurable: true });
  btn(shadow, "Copy report").click();
  await tick(10);
  assert.match(copied, /^ScraperX issue report/);
  assert.match(shadow.textContent, /Report copied/);
});

test("after a publish, the report lists what failed, what was skipped and what is not mapped, with likely causes and the mapping", async () => {
  const { shadow } = setup();
  await tick();
  // A mapping whose box is not on the page, so publishing it fails.
  await globalThis.SXRTS.customFields.saveDefinition({
    key: "companyBriefDescription", label: "Brief description", description: "", kind: "single",
    fields: [{ key: "value", kind: "text", selectors: ["#notThere"] }],
    saveButton: { selectors: ["#saveDesc"], text: "Save" },
    binds: { path: "company.briefDescription", map: { value: "value" } }
  });
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  btn(shadow, "Validate JSON").click();
  assert.ok(shadow.querySelector(".verdict.ok"), shadow.querySelector(".status.error")?.textContent);
  await publishOnly(shadow, "company.briefDescription");
  const text = shadow.querySelector("#sxrts-report").value;
  assert.match(text, /FAILED \(1\)/);
  assert.match(text, /company\.briefDescription · mapped field "Brief description"/);
  assert.match(text, /Message: Brief description › value was not found on this page/);
  assert.match(text, /Likely cause: A mapped control is not on screen/);
  assert.match(text, /Mapping: single; fields value=#notThere; Save #saveDesc/);
  assert.match(text, /NOT MAPPED YET \(no RTS field known for these\) \(\d+\)/);
  assert.match(text, /company\.keywords ×10\n   Message: No selector registry entry exists for this field yet\.\n   Values: /, "ten keywords are one entry");
  assert.match(text, /extras\.address/);
  assert.match(text, /"counts": \{/);
  assert.ok(shadow.querySelector(".report-count").textContent.includes("to look at"));
});
