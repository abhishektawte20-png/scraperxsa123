// A field that lives inside a popup: the workflow opens it with the mapped
// button, fills the field, clicks the popup's Save, and reopens the popup to
// read the saved value back. Page behaviour is simulated in jsdom.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/customFields.js";
import "../core/selectorBuilder.js";
import "../core/workflows/customField.js";

const popupDef = {
  key: "employees", label: "Employees", description: "", kind: "single",
  fields: [{ key: "value", kind: "text", selectors: ["#empInput"] }],
  openButton: { selectors: ["#openDlg"], text: "Edit employees" },
  closeButton: { selectors: ["#dlgClose"], text: "Close" },
  saveButton: { selectors: ["#dlgSave"], text: "Save" }
};

function setup({ saved = "", retainOnReopen = true, opens = true, closesOnSave = true, openAtStart = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="openDlg" type="button">Edit employees</button>
    <div id="dlg" style="display:none">
      <input id="empInput" value="">
      <button id="dlgSave" disabled>Save</button>
      <button id="dlgClose" type="button">Close</button>
    </div>
  </body>`, { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const doc = window.document;
  const state = { saved, saves: 0, opened: 0, closed: 0 };
  const dlg = doc.getElementById("dlg");
  const input = doc.getElementById("empInput");
  const open = () => { dlg.style.display = "block"; input.value = retainOnReopen ? state.saved : ""; doc.getElementById("dlgSave").disabled = true; state.opened++; };
  const close = () => { dlg.style.display = "none"; state.closed++; };
  doc.getElementById("openDlg").addEventListener("click", () => { if (opens) setTimeout(open, 20); });
  input.addEventListener("input", () => { doc.getElementById("dlgSave").disabled = false; });
  doc.getElementById("dlgSave").addEventListener("click", () => {
    state.saved = input.value;
    state.saves++;
    setTimeout(() => { doc.getElementById("dlgSave").disabled = true; if (closesOnSave) close(); }, 30);
  });
  doc.getElementById("dlgClose").addEventListener("click", close);
  doc.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  if (openAtStart) open();
  globalThis.SXRTS.workflows.customField.TIMEOUTS.open = 400;
  return { doc, state };
}

const run = (def, value, action = "addIfMissing") => globalThis.SXRTS.workflows.customField.applyCustomField(def, { value, action });
const shown = (doc) => doc.getElementById("dlg").style.display !== "none";

test("opens the popup, fills, saves, reopens to read the value back, then closes the popup", async () => {
  const { doc, state } = setup();
  const result = await run(popupDef, "250");
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.saved, "250");
  assert.equal(state.saves, 1);
  assert.equal(state.opened, 2, "opened once to fill and once to read back");
  assert.equal(shown(doc), false, "the popup is closed afterwards");
});

test("a popup that is already open is used as it is and left open if it stays open", async () => {
  const { doc, state } = setup({ openAtStart: true, closesOnSave: false });
  const result = await run(popupDef, "250");
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.opened, 1, "only the researcher's own open; nothing was clicked to open it");
  assert.equal(shown(doc), true, "a popup the researcher had open is left open");
});

test("a popup that stays open after Save is read back without reopening", async () => {
  const { doc, state } = setup({ closesOnSave: false });
  const result = await run(popupDef, "250");
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.opened, 1);
  assert.equal(shown(doc), false, "closed with the Close button once verified");
});

test("without a Close button the popup is closed with Escape", async () => {
  const { doc } = setup({ closesOnSave: false });
  const result = await run({ ...popupDef, closeButton: undefined }, "250");
  assert.equal(result.status, "savedValueVerified");
  assert.equal(shown(doc), false);
});

test("a popup that already has a value is skipped and closed again", async () => {
  const { doc, state } = setup({ saved: "100" });
  const result = await run(popupDef, "250");
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /already has a value/);
  assert.equal(state.saves, 0);
  assert.equal(shown(doc), false);
});

test("a missing opener button is a clear error", async () => {
  setup();
  document.getElementById("openDlg").remove();
  await assert.rejects(() => run(popupDef, "250"), /button that opens the popup .* was not found/);
});

test("a popup that never opens is reported, not assumed", async () => {
  setup({ opens: false });
  await assert.rejects(() => run(popupDef, "250"), /did not open after clicking "Edit employees"/);
});

test("a popup that does not show the saved value when reopened is not reported as saved", async () => {
  const { state } = setup({ retainOnReopen: false });
  await assert.rejects(() => run(popupDef, "250"), /saved value no longer matches/);
  assert.equal(state.saves, 1);
});

test("a hidden copy of the same input elsewhere on the page is ignored", async () => {
  const { doc } = setup();
  const stray = doc.createElement("div");
  stray.style.display = "none";
  stray.innerHTML = '<input id="empInput">';
  doc.body.insertBefore(stray, doc.body.firstChild);
  const result = await run(popupDef, "250");
  assert.equal(result.status, "savedValueVerified");
});

test("popup definitions are validated: single only, button must be identifiable", () => {
  const cf = globalThis.SXRTS.customFields;
  assert.deepEqual(cf.validateDefinition(popupDef), []);
  assert.ok(cf.validateDefinition({ ...popupDef, kind: "record", addButton: { selectors: ["#a"] } }).some((e) => /single field can sit inside a popup/.test(e)));
  assert.ok(cf.validateDefinition({ ...popupDef, openButton: { selectors: [], text: "" } }).some((e) => /could not be identified/.test(e)));
  assert.ok(cf.validateDefinition({ ...popupDef, openButton: undefined }).some((e) => /Close button only makes sense/.test(e)));
});
