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

function setup({ ignoreFirstEnters = 0, enterAdds = true, autoSaves = false, existing = ["agentic ai (1185)", "ai development (797)"], dropsTag = false } = {}) {
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
    if (state.enters <= ignoreFirstEnters) return; // the suggestion list was not ready yet
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
  // keep the retries short in tests
  globalThis.SXRTS.workflows.customField.TAG_ATTEMPTS.splice(0, 3, { before: 40, after: 150 }, { before: 40, after: 150 }, { before: 40, after: 150 });
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

test("Enter pressed before the suggestions are ready is pressed again, and the tag is then confirmed", async () => {
  const { state, tags } = setup({ ignoreFirstEnters: 2 });
  const out = await run("beach club");
  assert.equal(out.status, "savedValueVerified");
  assert.equal(state.enters, 3, "pressed three times, the third one worked");
  assert.deepEqual(tags().at(-1), "beach club (0)");
});

test("a tag drawn as a pill whose word sits beside other markup is still recognised (RTS's .base-pill)", async () => {
  const { doc, state } = setup({ enterAdds: false });
  const input = doc.querySelector("input");
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !input.value.trim()) return;
    const pill = doc.createElement("div");
    pill.className = "element-group base-pill";
    pill.innerHTML = `<div class="element-group__item">${input.value.trim()}<i class="hint"> </i></div><div class="element-group__item base-pill__close-icon"><i class="rts-icon-close"></i></div>`;
    input.before(pill);
    input.value = "";
    doc.querySelector("button").disabled = false;
  });
  const result = await run("high jewellery");
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.saves, 1);
});

test("when Enter alone adds nothing, the suggestion row for that word is clicked, once, and nothing else", async () => {
  const { doc, state } = setup({ enterAdds: false });
  const input = doc.querySelector("input");
  let wrongClicks = 0;
  doc.body.insertAdjacentHTML("beforeend", '<ul class="suggestions"><li id="other">something else</li><li id="mine">rare jewels (new)</li></ul>');
  doc.getElementById("other").addEventListener("click", () => { wrongClicks++; });
  doc.getElementById("mine").addEventListener("click", () => {
    const tag = doc.createElement("span");
    tag.className = "tag";
    tag.innerHTML = '<span class="t">rare jewels (0)</span><b class="x">✖</b>';
    input.before(tag);
    input.value = "";
    doc.querySelector("button").disabled = false;
  });
  const result = await run("rare jewels");
  assert.equal(result.status, "savedValueVerified");
  assert.equal(wrongClicks, 0);
  assert.equal(state.saves, 1);
});

const runMany = (values) => globalThis.SXRTS.workflows.customField.applyTagBoxMany(def, values.map((value) => ({ action: "addIfMissing", value })));

test("ALL the keywords are typed first and Save is pressed ONCE, then every tag is read back", async () => {
  const { state, tags } = setup();
  const out = await runMany(["high jewellery", "luxury diamonds", "coloured gemstones", "bespoke jewellery"]);
  assert.deepEqual(out.map((r) => r.status), ["savedValueVerified", "savedValueVerified", "savedValueVerified", "savedValueVerified"]);
  assert.equal(state.saves, 1, "one Save for four keywords, not four");
  for (const word of ["high jewellery", "luxury diamonds", "coloured gemstones", "bespoke jewellery"]) assert.ok(tags().some((t) => t.startsWith(word)), word);
});

test("batch: a word that is already a tag, and a repeated word, are skipped; the rest are added with one Save", async () => {
  const { state } = setup({ existing: ["agentic ai (1185)"] });
  const out = await runMany(["agentic ai", "fleet tools", "fleet tools", "route maps"]);
  assert.deepEqual(out.map((r) => r.status), ["skipped", "savedValueVerified", "skipped", "savedValueVerified"]);
  assert.equal(state.saves, 1);
});

test("batch: one word that never becomes a tag fails on its own; the others are still added and saved", async () => {
  const { state, doc } = setup();
  const input = doc.querySelector("input");
  // Enter adds every word except "stubborn word"
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && input.value.trim() === "stubborn word") event.stopImmediatePropagation(); }, true);
  const out = await runMany(["good one", "stubborn word", "good two"]);
  assert.deepEqual(out.map((r) => r.status), ["savedValueVerified", "failed", "savedValueVerified"]);
  assert.match(out[1].reason, /no tag appeared/);
  assert.equal(state.saves, 1);
  assert.equal(input.value, "", "the stubborn word is not left typed in the box");
});

test("batch: if the page drops the tags after Save, none is reported as saved", async () => {
  setup({ dropsTag: true });
  const out = await runMany(["alpha beta", "gamma delta"]);
  assert.ok(out.every((r) => r.status === "failed"), JSON.stringify(out));
});

test("RTS keeps at most 10 keywords: the ones it drops on Save are reported as its limit (skipped), not as failures; the first ten are kept", async () => {
  const { doc, state } = setup({ existing: ["a1 x", "a2 x", "a3 x"] });
  const save = doc.querySelector("button");
  // like RTS: when Save is pressed, only the first 10 tags stay
  save.addEventListener("click", () => { const tags = Array.from(doc.querySelectorAll(".tag")); tags.slice(10).forEach((t) => t.remove()); });
  const words = ["w1 x", "w2 x", "w3 x", "w4 x", "w5 x", "w6 x", "w7 x", "w8 x", "w9 x", "w10 x"];
  const out = await runMany(words);
  assert.equal(state.saves, 1);
  assert.deepEqual(out.map((r) => r.status), ["savedValueVerified", "savedValueVerified", "savedValueVerified", "savedValueVerified", "savedValueVerified", "savedValueVerified", "savedValueVerified", "skipped", "skipped", "skipped"]);
  assert.match(out[9].detail, /RTS kept 10 and dropped "w10 x"/);
});
