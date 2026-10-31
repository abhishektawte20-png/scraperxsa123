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
// Two levels of + buttons with different ids: sectors (...Group...) and groups (...Segment...).
const expander = { selectors: ['[id^="industryControlGroup"][id$="Expander"]', '[id^="industryControlSegment"][id$="Expander"]'], text: "" };
const job = (value, extra = {}) => ({ tree: { leaf, expander }, value, preSave: [], saveButton: { selectors: ["#saveIndustryButton"], text: "Save Changes" }, ...extra });

function setup({ lazy = false, closeOnSave = false } = {}) {
  let n = 100;
  const gi = new Map();
  // RTS's markup: the click handler of a choice carries its place checkCode(this, sector, group, choice) from 0,
  // its look is the WHOLE class (controls_checkBox / controls_checkBox_checked), and every box is clickable.
  const box = (l, a, b, c) => { const o = typeof l === "string" ? { n: l } : l; const k = n++; return `<div id="industryControlCode${k}"><div><div id="industryControlCode${k}1284861CheckBox" class="${o.on ? "controls_checkBox_checked" : "controls_checkBox"}" style="cursor:pointer" onclick="IndustryControl.checkCode(this, ${a}, ${b}, ${c});"></div></div><div id="industryControlCode${k}1284861Description">${o.n}</div></div>`; };
  const sector = (g, a) => `<div id="industryControlGroup${n}"><div id="industryControlGroup${n++}1284861Expander" class="mt_5 sub-section__icon-expand section__icon" style="cursor:pointer"></div><div><div class="controls_checkBox_border"><div id="industryControlGroup${n++}1284861CheckBox" class="controls_emptyCheckBox" style="cursor:pointer"></div></div></div><div id="industryControlGroup${n}Description">${g.name}</div><div class="child" style="display:none">${lazy ? "" : g.kids.map((k, b) => segment(k, a, b)).join("")}</div></div>`;
  const segment = (k, a, b) => `<div id="industryControlSegment${n}"><div id="industryControlSegment${n++}1284861Expander" class="mt_5 sub-section__icon-expand section__icon" style="cursor:pointer"></div><div><div id="industryControlSegment${n++}1284861CheckBox" class="controls_emptyCheckBox" style="cursor:pointer"></div></div><div id="industryControlSegment${n}Description">${k.name}</div><div class="child" style="display:none">${lazy ? "" : k.leaves.map((l, c) => box(l, a, b, c)).join("")}</div></div>`;
  const html = `<div id="root">${TREE.map((g, a) => sector(g, a)).join("")}</div><input id="saveIndustryButton" type="button" value="Save Changes" disabled>`;
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only", url: "http://localhost/industryGroup/create.html" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, NodeFilter: window.NodeFilter, HTMLInputElement: window.HTMLInputElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const doc = window.document;
  const state = { saves: 0, stages: [], closed: 0, clickedBranchBoxes: 0 };
  global.chrome = { runtime: { sendMessage: (m) => state.stages.push(m.stage) } };
  window.close = () => { state.closed++; };
  const save = doc.getElementById("saveIndustryButton");
  const drawChildren = (holder, level, a, b) => {
    const name = holder.querySelector(":scope > [id$=Description]").textContent;
    if (level === 1) { const t = TREE.find((x) => x.name === name); holder.querySelector(":scope > .child").innerHTML = t.kids.map((k, kb) => segment(k, TREE.indexOf(t), kb)).join(""); }
    else { const t = TREE.find((x) => x.kids.some((k) => k.name === name)); const kb = t.kids.findIndex((k) => k.name === name); holder.querySelector(":scope > .child").innerHTML = t.kids[kb].leaves.map((l, c) => box(l, TREE.indexOf(t), kb, c)).join(""); }
  };
  doc.getElementById("root").addEventListener("click", (event) => {
    const t = event.target;
    if (/^industryControlCode\d+1284861CheckBox$/.test(t.id)) { t.className = t.className === "controls_checkBox" ? "controls_checkBox_checked" : "controls_checkBox"; save.disabled = false; return; }
    if (/CheckBox$/.test(t.id)) { state.clickedBranchBoxes++; return; }
    if (!/Expander$/.test(t.id)) return;
    const holder = t.parentElement, child = holder.querySelector(":scope > .child");
    const open = child.style.display !== "none";
    if (!open && lazy && !child.children.length) drawChildren(holder, /^industryControlGroup/.test(t.id) ? 1 : 2);
    child.style.display = open ? "none" : "block";
    t.className = open ? "mt_5 sub-section__icon-expand section__icon" : "mt_5 sub-section__icon-collapse section__icon";
  });
  save.addEventListener("click", () => { state.saves++; if (closeOnSave) doc.getElementById("root").remove(); save.disabled = true; });
  Object.assign(globalThis.SXRTS.workflows.popupWindow.TIMEOUTS, { fields: 400, button: 400, settle: 400, after: 20, branch: 120, poll: 5, search: 5000 });
  const ticked = () => Array.from(doc.querySelectorAll(".controls_checkBox_checked")).map((b) => b.parentElement.parentElement.querySelector("[id$=Description]").textContent);
  return { doc, state, ticked };
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

test("a generic name such as Other goes by the place RTS gives it, even with no page layout to go by", async () => {
  const { ticked, state } = setup();
  // 2.2.2 is sector 2, its group 2, choice 2: the Other under Consumer Durables, not the Others elsewhere.
  const out = await run(job("2.2.2 — Other"));
  assert.equal(out.status, "saved");
  assert.equal(state.saves, 1);
  const mine = ticked().filter((x) => x === "Other");
  assert.equal(mine.length, 1);
  const box = Array.from(document.querySelectorAll(".controls_checkBox_checked")).find((b) => /Other/.test(b.parentElement.parentElement.textContent));
  assert.match(box.getAttribute("onclick"), /checkCode\(this, 1, 1, 1\)/, "sector 1, group 1, choice 1 (from 0)");
});

test("a place that holds a different name, or a wrong name for a place, ticks nothing", async () => {
  const { ticked, state } = setup();
  await assert.rejects(run(job("2.1.2 — Footwear")), /RTS lists "Footwear" at 2\.1\.3, not at 2\.1\.2/);
  await assert.rejects(run(job("2.2.2 — Chemicals")), /RTS lists "Chemicals" at 1\.1\.2, not at 2\.2\.2/);
  assert.equal(state.saves, 0);
  assert.deepEqual(ticked(), ["Clothing"]);
});

test("the reported name must match what RTS lists, even when the place exists", async () => {
  const { state } = setup();
  await assert.rejects(run(job("1.1.2 — Chemicals and Plastics")), /check the code and name|not found/);
  assert.equal(state.saves, 0);
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
  const { doc, state } = setup();
  const found = await globalThis.SXRTS.popupPicker.detectTree(globalThis.SXRTS.selectorBuilder, null);
  assert.ok(found.leaf, found.notes.join(" "));
  assert.ok(found.expander);
  assert.equal(found.saveButton.text, "Save Changes");
  assert.match(found.leaf.selectors[0], /industryControlCode/, "the pattern of the choices only, not the branches' own boxes");
  assert.match(found.expander.selectors[0], /industryControlGroup|icon-expand/);
  assert.equal(found.leaf.baseKey, "DIV|controls_checkBox", "the unticked look, not the ticked one");
  assert.equal(doc.querySelectorAll(".controls_checkBox_checked").length, 1, "nothing was ticked while detecting");
  assert.equal(state.clickedBranchBoxes, 0, "the boxes of branches were never clicked");
  assert.deepEqual(found.expander.selectors, ['[id^="industryControlGroup"][id$="Expander"]', '[id^="industryControlSegment"][id$="Expander"]'], "both levels of + buttons, top level first");
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
