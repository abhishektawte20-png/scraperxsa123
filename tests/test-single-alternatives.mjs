// A single field whose box will not keep the value as the report gives it: the other forms of the same value are tried
// (a start date "2004" -> "01/01/2004"), and a value the page keeps only after real typing is typed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/selectorBuilder.js";
import "../core/customFields.js";
import "../core/workflows/customField.js";

const def = { key: "startDate", label: "Start date", kind: "single", fields: [{ key: "value", label: "Start date", kind: "text", selectors: ["#d"] }], saveButton: { selectors: ["#s"], text: "Save" } };

function page({ accepts }) {
  const dom = new JSDOM('<!doctype html><body><input id="d" type="text"><button id="s" disabled>Save</button></body>', { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const input = document.getElementById("d"), save = document.getElementById("s");
  const tried = [];
  // like RTS's start date: a value it does not understand is cleared again
  input.addEventListener("change", () => { tried.push(input.value); if (!accepts.test(input.value)) input.value = ""; else save.disabled = false; });
  save.addEventListener("click", () => setTimeout(() => { save.disabled = true; }, 10));
  Object.assign(globalThis.SXRTS.workflows.customField.TIMEOUTS, { retryPause: 0 });
  return { input, tried };
}
const run = (record) => globalThis.SXRTS.workflows.customField.applyCustomField(def, { action: "addIfMissing", ...record });

test("a date box that clears '2004' keeps '01/01/2004': the alternative is tried, saved and read back", async () => {
  const { input, tried } = page({ accepts: /^\d{2}\/\d{2}\/\d{4}$/ });
  const out = await run({ value: "2004", __alternatives: ["01/01/2004"] });
  assert.equal(out.status, "savedValueVerified");
  assert.equal(input.value, "01/01/2004");
  assert.ok(tried.includes("2004") && tried.includes("01/01/2004"));
});

test("when no form is kept, the error says what was typed and what the page now has", async () => {
  page({ accepts: /^never$/ });
  await assert.rejects(run({ value: "2004", __alternatives: ["01/01/2004"] }), /did not retain the proposed value\. Typed 4 characters; the page now has 0/);
});

test("a value the page keeps is not retyped or changed", async () => {
  const { input } = page({ accepts: /^\d{4}$/ });
  const out = await run({ value: "2004", __alternatives: ["01/01/2004"] });
  assert.equal(out.status, "savedValueVerified");
  assert.equal(input.value, "2004");
});
