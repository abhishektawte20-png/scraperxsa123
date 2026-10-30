// A tag box (Keywords): type a word, press Enter, and the word becomes a tag. Existing tags show a use
// count, which is ignored. Success is claimed only when the tag is really there afterwards.

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

const def = {
  key: "companyKeywords", label: "Keywords", description: "", kind: "record",
  fields: [{ key: "value", label: "Enter or paste keywords", description: "", kind: "text", selectors: ['input[placeholder="Enter or paste keywords"]'] }],
  saveButton: { selectors: ['[data-test-id="description-keywords-save-btn"]'], text: "Save Changes" },
  addButton: { selectors: ["div.keywords__list"], text: "" },
  binds: { path: "company.keywords", map: { value: "value" } }
};

function setup({ enterAdds = true, autoSaves = false, existing = ["agentic ai (1185)", "ai development (797)"], dropsTag = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="keywords"><div class="keywords__list">${existing.map((t) => `<span class="tag"><span class="t">${t}</span><b class="x">✖</b></span>`).join("")}<input placeholder="Enter or paste keywords" class="keywords__input" type="text" maxlength="100"></div></div>
    <button data-test-id="description-keywords-save-btn" disabled>Save Changes</button></body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, KeyboardEvent: window.KeyboardEvent,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const doc = window.document;
  const input = doc.querySelector("input");
  const save = doc.querySelector("button");
  const state = { saves: 0, enters: 0 };
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.enters++;
    if (!enterAdds || !input.value.trim()) return;
    event.preventDefault();
    const tag = doc.createElement("span");
    tag.className = "tag";
    tag.innerHTML = `<span class="t">${input.value.trim()} (0)</span><b class="x">✖</b>`;
    input.before(tag);
    input.value = "";
    if (!autoSaves) save.disabled = false;
    if (dropsTag) setTimeout(() => tag.remove(), 5);
  });
  save.addEventListener("click", () => { state.saves++; save.disabled = true; });
  globalThis.SXRTS.workflows.customField.TIMEOUTS.rowChange = 300;
  return { doc, state, tags: () => Array.from(doc.querySelectorAll(".t")).map((n) => n.textContent) };
}
const run = (value) => globalThis.SXRTS.workflows.customField.applyCustomField(def, { action: "addIfMissing", value });

test("a new keyword is typed, Enter makes it a tag, Save Changes is pressed and the tag is confirmed", async () => {
  const { state, tags } = setup();
  const out = await run("beach club");
  assert.deepEqual(out, { status: "savedValueVerified", name: "companyKeywords" });
  assert.deepEqual(tags(), ["agentic ai (1185)", "ai development (797)", "beach club (0)"]);
  assert.equal(state.enters, 1);
  assert.equal(state.saves, 1);
});

test("a page that saves on Enter needs no Save click", async () => {
  const { state } = setup({ autoSaves: true });
  assert.equal((await run("water sports")).status, "savedValueVerified");
  assert.equal(state.saves, 0);
});

test("a keyword that is already a tag is skipped, ignoring its use count and case", async () => {
  const { state, tags } = setup();
  const out = await run("Agentic AI");
  assert.equal(out.status, "skipped");
  assert.equal(out.reason, "duplicate");
  assert.equal(state.enters, 0);
  assert.equal(tags().length, 2);
});

test("words ending in x or containing digits are not mangled when compared", async () => {
  const { tags } = setup({ existing: ["box (12)", "web 3 (4)"] });
  assert.equal((await run("box")).status, "skipped");
  assert.equal((await run("bo")).status, "savedValueVerified");
  assert.equal(tags().length, 3);
});

test("Enter that does not make a tag is an error that asks for the report, never a success", async () => {
  setup({ enterAdds: false });
  await assert.rejects(run("beach club"), /no tag appeared/);
});

test("a tag that disappears after Save is an error", async () => {
  setup({ dropsTag: true });
  await assert.rejects(run("beach club"), /Save did not complete for Keywords|no tag appeared|no longer there/);
});

test("a box with a row layout (an Add button that is not the box) still uses the normal row flow", async () => {
  setup();
  const rowDef = { ...def, addButton: { selectors: ['[data-test-id="description-keywords-save-btn"]'], text: "Save Changes" } };
  await assert.rejects(globalThis.SXRTS.workflows.customField.applyCustomField(rowDef, { action: "addIfMissing", value: "x" }), /did not appear after clicking Add/);
});
