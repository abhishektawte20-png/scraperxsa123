// RTS draws its industry tick boxes itself: div.controls_checkBox inside a tree of
// div.sub-section__icon-expand buttons. A choice is ticked when its look differs from the usual (unticked) look.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/selectorBuilder.js";
import "../core/workflows/popupWindow.js";
import "../content/popupPicker.js";

const TREE = [
  { name: "Business Products and Services (B2B)", kids: [{ name: "Commercial Products", leaves: ["Aerospace and Defense", "Chemicals", "Other"] }] },
  { name: "Consumer Products and Services (B2C)", kids: [{ name: "Apparel and Accessories", leaves: ["Accessories", { n: "Clothing", on: true }, "Footwear", "Other"] }, { name: "Consumer Durables", leaves: ["Appliances", "Other"] }] },
  { name: "Information Technology", kids: [{ name: "Software", leaves: ["Application Software", "Other"] }] }
];

// RTS's real markup: a frame (controls_checkBox_border) around the box, ids that carry a record number, and a box of
// its own for every branch (controls_emptyCheckBox) that is NOT a choice.
const leaf = { selectors: ['[id^="industryControlCode"][id$="CheckBox"]'], text: "" };
const expander = { selectors: ['[id^="industryControlGroup"][id$="Expander"]'], text: "" };
const job = (value, extra = {}) => ({ tree: { leaf, expander }, value, preSave: [], saveButton: { selectors: ["#saveIndustryButton"], text: "Save Changes" }, ...extra });

function setup({ lazy = false, closeOnSave = false } = {}) {
  let n = 100;
  const box = (l) => { const o = typeof l === "string" ? { n: l } : l; return `<li><div class="controls_checkBox_border"><div id="industryControlCode${n++}1284861CheckBox" class="controls_checkBox${o.on ? " controls_checkBox_checked" : ""}"></div></div> <span>${o.n}</span></li>`; };
  const group = (g, level) => `<li><div id="industryControlGroup${n++}1284861Expander" class="mt_5 sub-section__icon-expand section__icon"></div><div class="controls_checkBox_border"><div id="industryControlGroup${n++}1284861CheckBox" class="controls_emptyCheckBox"></div></div> <span>${g.name}</span><ul style="display:none">${lazy ? "" : level === 1 ? g.kids.map((k) => group(k, 2)).join("") : g.leaves.map(box).join("")}</ul></li>`;
  const html = `<ul id="root">${TREE.map((g) => group(g, 1)).join("")}</ul><input id="saveIndustryButton" type="button" value="Save Changes" disabled>`;
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only", url: "http://localhost/industryGroup/create.html" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, NodeFilter: window.NodeFilter, HTMLInputElement: window.HTMLInputElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const doc = window.document;
  const state = { saves: 0, stages: [], closed: 0 };
  global.chrome = { runtime: { sendMessage: (m) => state.stages.push(m.stage) } };
  window.close = () => { state.closed++; };
  const save = doc.getElementById("saveIndustryButton");
  const build = (li, level) => {
    const g = (level === 1 ? TREE : TREE.flatMap((t) => t.kids)).find((x) => x.name === li.querySelector(":scope > span").textContent);
    li.querySelector(":scope > ul").innerHTML = level === 1 ? g.kids.map((k) => group(k, 2)).join("") : g.leaves.map(box).join("");
  };
  doc.getElementById("root").addEventListener("click", (event) => {
    const t = event.target;
    if (t.classList.contains("controls_checkBox")) { t.classList.toggle("controls_checkBox_checked"); save.disabled = false; return; }
    if (!t.classList.contains("sub-section__icon-expand")) return;
    const li = t.parentElement, list = li.querySelector(":scope > ul");
    const open = list.style.display !== "none";
    if (!open && lazy && !list.children.length) build(li, li.parentElement.id === "root" ? 1 : 2);
    list.style.display = open ? "none" : "block";
  });
  save.addEventListener("click", () => { state.saves++; if (closeOnSave) doc.getElementById("root").remove(); save.disabled = true; });
  Object.assign(globalThis.SXRTS.workflows.popupWindow.TIMEOUTS, { fields: 400, button: 400, settle: 400, after: 20, branch: 120, poll: 5, search: 5000 });
  return { doc, state, ticked: () => Array.from(doc.querySelectorAll(".controls_checkBox_checked")).map((b) => b.closest("li").querySelector(":scope > span").textContent) };
}
const run = (j) => globalThis.SXRTS.workflows.popupWindow.run(j);

for (const lazy of [false, true]) {
  const how = lazy ? "branches drawn only when opened" : "branches hidden and shown";

  test(`finds a drawn tick box in closed branches, ticks only it, saves and reads the tick back (${how})`, async () => {
    const { ticked, state } = setup({ lazy });
    const out = await run(job("2.1.1 — Accessories"));
    assert.deepEqual(out, { status: "saved", fieldRetained: true });
    assert.equal(state.saves, 1);
    assert.deepEqual(ticked().sort(), ["Accessories", "Clothing"], "the one that was already ticked is untouched");
  });

  test(`a choice that is already ticked is left alone (${how})`, async () => {
    const { state } = setup({ lazy });
    const out = await run(job("2.1.2 — Clothing"));
    assert.equal(out.status, "skipped");
    assert.match(out.reason, /already ticked/);
    assert.equal(state.saves, 0);
  });
}

test("a given usual look (baseKey) decides what counts as ticked, even when few choices are on screen", async () => {
  const { doc } = setup();
  // Only Clothing's group is opened by the researcher; with one group on screen the odd one out is still found.
  const base = "DIV|controls_checkBox";
  const out = await run(job("1.1.2 — Chemicals", { tree: { leaf: { ...leaf, baseKey: base }, expander } }));
  assert.equal(out.status, "saved");
  assert.ok(doc.querySelectorAll(".controls_checkBox_checked").length === 2);
});

test("a generic name such as Other still goes by its code, with drawn boxes too", async () => {
  const { ticked } = setup();
  window.Element.prototype.getBoundingClientRect = function () {
    let depth = 0;
    for (let n = this.parentElement; n; n = n.parentElement) if (n.tagName === "UL") depth++;
    return { left: 10 + depth * 20, top: 0, right: 0, bottom: 0, width: 10, height: 10, x: 0, y: 0 };
  };
  const out = await run(job("2.2.2 — Other"));
  assert.equal(out.status, "saved");
  assert.ok(ticked().includes("Other") && ticked().length === 2);
});

test("verify only reads the drawn tick back and never saves", async () => {
  const { state } = setup();
  assert.deepEqual(await run(job("2.1.2 — Clothing", { verifyOnly: true })), { status: "verified", checked: true });
  assert.deepEqual(await run(job("2.1.1 — Accessories", { verifyOnly: true })), { status: "verified", checked: false });
  assert.equal(state.saves, 0);
});

test("a window that closes itself on Save leaves the tick unconfirmed here", async () => {
  const { state } = setup({ closeOnSave: true });
  assert.deepEqual(await run(job("2.1.3 — Footwear")), { status: "saved", fieldRetained: null });
  assert.equal(state.saves, 1);
});

test("Detect recognises the drawn boxes and the + buttons, and remembers the usual look", async () => {
  const { doc } = setup();
  const found = await globalThis.SXRTS.popupPicker.detectTree(globalThis.SXRTS.selectorBuilder, null);
  assert.ok(found.leaf, found.notes.join(" "));
  assert.ok(found.expander);
  assert.equal(found.saveButton.text, "Save Changes");
  assert.match(found.leaf.selectors[0], /industryControlCode/, "the pattern of the choices only, not the branches' own boxes");
  assert.match(found.expander.selectors[0], /industryControlGroup|icon-expand/);
  assert.equal(found.leaf.baseKey, "DIV|controls_checkBox", "the unticked look, not the ticked one");
  assert.equal(doc.querySelectorAll(".controls_checkBox_checked").length, 1, "nothing was ticked while detecting");
  // Everything was read: all 11 choices under 3 sectors and 4 groups; the 7 boxes of the branches themselves are not choices.
  assert.equal(found.counts.choices, 11);
  assert.equal(found.counts.covered, 11);
  assert.match(found.summary.join(" "), /11 choices in 7 branches/);
  assert.equal(found.counts.branches, 7, "3 sectors + 4 groups");
  assert.deepEqual(found.notes, []);
});

test("Detect opens branches when the drawn boxes exist only after a branch is opened", async () => {
  setup({ lazy: true });
  const found = await globalThis.SXRTS.popupPicker.detectTree(globalThis.SXRTS.selectorBuilder, null);
  assert.ok(found.leaf, found.notes.join(" "));
  assert.match(found.summary.join(" "), /11 choices in 7 branches/);
});
