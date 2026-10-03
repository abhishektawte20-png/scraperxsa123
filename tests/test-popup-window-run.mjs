// The part that runs inside the popup window RTS opens (Create Social Media
// Identifier): fill, press "Show existing data", Save, report what was seen.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/selectorBuilder.js";
import "../core/workflows/popupWindow.js";

const job = {
  replace: false,
  fields: [{ selectors: ["#identifierText"], kind: "text", value: "ChampionPoolSupply" }],
  preSave: [{ selectors: ["#showExisting"], text: "Show existing data" }],
  saveButton: { selectors: ['[data-test-id="social-media-change-tag-save-btn"]'], text: "Save Changes" }
};

function setup({ needShowFirst = true, clearsOnSave = false, saveNeverSettles = false, initial = "", hasShowButton = true } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <input id="identifierText" type="text" value="${initial}">
    ${hasShowButton ? '<input id="showExisting" type="button" value="Show existing data">' : ""}
    <input id="save" type="button" data-test-id="social-media-change-tag-save-btn" value="Save Changes" disabled>
  </body>`, { runScripts: "outside-only", url: "http://localhost/popup.html" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const state = { stages: [], closed: 0, saved: null, shown: !needShowFirst };
  global.chrome = { runtime: { sendMessage: (m) => state.stages.push(m.stage) } };
  window.close = () => { state.closed++; };
  const doc = window.document;
  const input = doc.getElementById("identifierText");
  const save = doc.getElementById("save");
  const refresh = () => { save.disabled = !(state.shown && input.value.trim()); };
  doc.getElementById("showExisting")?.addEventListener("click", () => { state.shown = true; refresh(); });
  input.addEventListener("input", refresh);
  save.addEventListener("click", () => {
    state.saved = input.value;
    if (clearsOnSave) input.value = "";
    if (!saveNeverSettles) save.disabled = true;
  });
  const t = globalThis.SXRTS.workflows.popupWindow.TIMEOUTS;
  Object.assign(t, { fields: 400, button: 400, settle: 400, after: 20 });
  return { state, doc };
}
const run = (override = {}) => globalThis.SXRTS.workflows.popupWindow.run({ ...job, ...override });

test("fills, presses Show existing data, saves, and reports that the window still shows the value", async () => {
  const { state } = setup();
  const result = await run();
  assert.deepEqual(result, { status: "saved", fieldRetained: true });
  assert.equal(state.saved, "ChampionPoolSupply");
  assert.deepEqual(state.stages, ["saveClicked"]);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(state.closed, 1, "the window is closed afterwards");
});

test("a window that empties its box on Save is reported as not retained", async () => {
  setup({ clearsOnSave: true });
  assert.equal((await run()).fieldRetained, false);
});

test("an existing value in the window is a skip, and nothing is saved", async () => {
  const { state } = setup({ initial: "OldHandle" });
  const result = await run();
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /already has a value \("OldHandle"\)/);
  assert.equal(state.saved, null);
  assert.deepEqual(state.stages, []);
});

test("replaceAfterConfirmation overwrites an existing value", async () => {
  const { state } = setup({ initial: "OldHandle" });
  assert.equal((await run({ replace: true })).status, "saved");
  assert.equal(state.saved, "ChampionPoolSupply");
});

test("Save that stays disabled is an error that tells the researcher to read the window", async () => {
  setup({ needShowFirst: true, hasShowButton: false });
  await assert.rejects(() => run({ preSave: [] }), /Save button stayed disabled/);
});

test("a missing button that must be pressed first is an error, and Save is never clicked", async () => {
  const { state } = setup({ hasShowButton: false });
  await assert.rejects(() => run(), /"Show existing data" that must be pressed before Save was not found/);
  assert.equal(state.saved, null);
});

test("a Save button that never settles is not reported as saved", async () => {
  setup({ saveNeverSettles: true });
  await assert.rejects(() => run(), /Save button stayed enabled/);
});

test("fields that are not in the window are an error", async () => {
  setup();
  await assert.rejects(() => run({ fields: [{ selectors: ["#nope"], kind: "text", value: "x" }] }), /mapped fields were not found/);
});
