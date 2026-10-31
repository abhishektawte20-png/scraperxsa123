// A mapped field that is "not found" is often just on the other tab: the run switches tab and tries once more.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/customFields.js";
import "../core/selectorBuilder.js";
import "../core/navigation.js";
import "../core/workflows/customField.js";

const def = {
  key: "companyNote", label: "Note", description: "", kind: "single",
  fields: [{ key: "value", kind: "text", selectors: ["#noteBox"] }],
  saveButton: { selectors: ["#saveNote"], text: "Save" }
};

function setup(tab) {
  const dom = new JSDOM(`<!doctype html><body>
    <button class="navigation__button">Business Entity</button><button class="navigation__button">Company</button>
    <div id="page"></div></body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const doc = window.document;
  const state = { visited: [], saved: "" };
  const show = (name) => {
    state.visited.push(name);
    doc.getElementById("page").innerHTML = name === tab ? '<input id="noteBox" type="text"><input id="saveNote" type="button" value="Save" disabled>' : "<p>other tab</p>";
    const input = doc.getElementById("noteBox"), save = doc.getElementById("saveNote");
    if (input) { input.addEventListener("input", () => { save.disabled = false; }); save.addEventListener("click", () => { state.saved = input.value; save.disabled = true; }); }
  };
  show("Company");
  doc.querySelectorAll("button.navigation__button").forEach((b) => b.addEventListener("click", () => show(b.textContent)));
  return state;
}
const run = (record = { action: "addIfMissing", value: "hello" }) => globalThis.SXRTS.workflows.customField.applyCustomField(def, record);

test("a field that lives on the other tab is found after switching tab, and written and verified", async () => {
  const state = setup("Business Entity");
  const out = await run();
  assert.equal(out.status, "savedValueVerified");
  assert.equal(state.saved, "hello");
  assert.deepEqual(state.visited, ["Company", "Business Entity"], "only the tab that was needed was opened");
});

test("a field that is on no tab is still reported as not found, after trying both", async () => {
  const state = setup("Nowhere");
  await assert.rejects(run(), /was not found on this page/);
  assert.deepEqual(state.visited, ["Company", "Business Entity", "Company"]);
  assert.equal(state.saved, "");
});
