// The part that runs inside a window that is a tree of checkboxes (Industry tagging): open the
// branches, tick the choice named in the report, Save, and say what was seen.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/selectorBuilder.js";
import "../core/workflows/popupWindow.js";

const TREE = [
  { name: "Business Products and Services (B2B)", open: false, kids: [{ name: "Commercial Services", kids: [{ leaf: "Consulting Services" }, { leaf: "Other" }] }] },
  { name: "Information Technology", open: true, kids: [
    { name: "Communications and Networking", kids: [{ leaf: "Wireless Communications" }, { leaf: "Other" }] },
    { name: "IT Services", open: true, kids: [{ leaf: "IT Consulting and Outsourcing", checked: true }, { leaf: "Systems Integration" }, { leaf: "Other" }] },
    { name: "Software", kids: [{ leaf: "Application Software" }, { leaf: "Automation/Workflow Software" }, { leaf: "Network Management Software" }] }
  ] },
  { name: "Healthcare", kids: [{ name: "Services", kids: [{ leaf: "Other" }] }] }
];

const job = (value = "6.5.1 — Application Software", extra = {}) => ({
  tree: { expander: { selectors: ["img.tg"] }, leaf: { selectors: ['input[type="checkbox"]'] } },
  value,
  preSave: [],
  saveButton: { selectors: ["#save"], text: "Save" },
  ...extra
});

function render(nodes, dynamic) {
  return nodes.map((n) => {
    if (n.leaf) return `<li><input type="checkbox" ${n.checked ? "checked" : ""}> ${n.leaf}</li>`;
    const kids = dynamic ? "" : `<ul style="display:${n.open ? "block" : "none"}">${render(n.kids, dynamic)}</ul>`;
    return `<li><img class="tg" src="${n.open ? "minus" : "plus"}.gif" data-open="${n.open ? 1 : 0}"> <span>${n.name}</span>${kids}</li>`;
  }).join("");
}

function setup({ dynamic = false, closeOnSave = false, saveNeverSettles = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body><ul id="root">${render(TREE, dynamic)}</ul><input id="save" type="button" value="Save" disabled></body>`, { runScripts: "outside-only", url: "http://localhost/industryGroup/create.html" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, NodeFilter: window.NodeFilter,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const state = { stages: [], closed: 0, saves: 0 };
  global.chrome = { runtime: { sendMessage: (m) => state.stages.push(m.stage) } };
  window.close = () => { state.closed++; };
  const doc = window.document;
  const save = doc.getElementById("save");

  if (dynamic) {
    // Branches are drawn only while open, like a React tree.
    const model = JSON.parse(JSON.stringify(TREE));
    const draw = () => {
      const html = (nodes) => nodes.map((n) => n.leaf
        ? `<li><input type="checkbox" ${n.checked ? "checked" : ""} data-n="${n.leaf}"> ${n.leaf}</li>`
        : `<li><img class="tg" src="${n.open ? "minus" : "plus"}.gif"> <span>${n.name}</span>${n.open ? `<ul>${html(n.kids)}</ul>` : ""}</li>`).join("");
      doc.getElementById("root").innerHTML = html(model);
    };
    draw();
    doc.getElementById("root").addEventListener("click", (event) => {
      if (event.target.matches?.("input[type=checkbox]")) {
        const find = (nodes) => nodes.flatMap((n) => (n.leaf ? [n] : find(n.kids)));
        const leaf = find(model).filter((n) => n.leaf === event.target.dataset.n).find((n) => (n.checked ? true : true));
        // the clicked box is the n-th box of that name
        const boxes = Array.from(doc.querySelectorAll(`input[data-n="${event.target.dataset.n}"]`));
        const all = find(model).filter((n) => n.leaf === event.target.dataset.n);
        void leaf; all[boxes.indexOf(event.target)].checked = event.target.checked;
        save.disabled = false;
        return;
      }
      const toggle = event.target.closest?.("img.tg");
      if (!toggle) return;
      const items = Array.from(doc.querySelectorAll("img.tg"));
      const order = [];
      const walk = (nodes) => nodes.forEach((n) => { if (!n.leaf) { order.push(n); if (n.open) walk(n.kids); } });
      walk(model);
      const node = order[items.indexOf(toggle)];
      node.open = !node.open;
      draw();
    });
  } else {
    doc.getElementById("root").addEventListener("click", (event) => {
      if (event.target.matches?.("input[type=checkbox]")) { save.disabled = false; return; }
      const toggle = event.target.closest?.("img.tg");
      if (!toggle) return;
      const list = toggle.parentElement.querySelector(":scope > ul");
      const open = list.style.display !== "none";
      list.style.display = open ? "none" : "block";
      toggle.src = open ? "plus.gif" : "minus.gif";
    });
  }
  save.addEventListener("click", () => {
    state.saves++;
    if (closeOnSave) doc.getElementById("root").remove();
    if (!saveNeverSettles) save.disabled = true;
  });
  Object.assign(globalThis.SXRTS.workflows.popupWindow.TIMEOUTS, { fields: 400, button: 400, settle: 400, after: 20, branch: 120, poll: 5, search: 5000 });
  return { doc, state };
}
const run = (override) => globalThis.SXRTS.workflows.popupWindow.run(override);
const ticked = (doc) => Array.from(doc.querySelectorAll("input[type=checkbox]")).filter((b) => b.checked).map((b) => b.parentElement.textContent.trim());

for (const dynamic of [false, true]) {
  const how = dynamic ? "a tree that draws a branch only while it is open" : "a tree whose branches are hidden and shown";

  test(`finds the choice in closed branches, ticks only it, saves and reads the tick back (${how})`, async () => {
    const { doc, state } = setup({ dynamic });
    const result = await run(job());
    assert.deepEqual(result, { status: "saved", fieldRetained: true });
    assert.equal(state.saves, 1);
    assert.deepEqual(ticked(doc).sort(), ["Application Software", "IT Consulting and Outsourcing"]);
    assert.deepEqual(state.stages, ["saveClicked"]);
  });

  test(`a branch that was already open is not left closed, and the choice inside it is found (${how})`, async () => {
    const { doc } = setup({ dynamic });
    const result = await run(job("6.4.2 — Systems Integration"));
    assert.equal(result.status, "saved");
    assert.ok(ticked(doc).includes("Systems Integration"));
  });

  test(`a choice that is already ticked is left alone and nothing is saved (${how})`, async () => {
    const { state } = setup({ dynamic });
    const result = await run(job("6.4.1 — IT Consulting and Outsourcing"));
    assert.equal(result.status, "skipped");
    assert.match(result.reason, /already ticked/);
    assert.equal(state.saves, 0);
    assert.deepEqual(state.stages, []);
  });
}

test("names are matched ignoring case, punctuation and & versus and", async () => {
  setup();
  assert.equal((await run(job("6.4.2 — systems   INTEGRATION"))).status, "saved");
  setup();
  assert.equal((await run(job("1.1.1 — consulting services"))).status, "saved");
});

test("a name that is not in the tree is an error that lists similar names", async () => {
  const { state } = setup();
  await assert.rejects(run(job("6.5.9 — Network Software Tools")), /"Network Software Tools" was not found in the tree of choices \(similar: .*Network Management Software/);
  assert.equal(state.saves, 0);
});

// A browser lays the tree out with deeper branches further right; the fake page does the same.
function indentByDepth() {
  window.Element.prototype.getBoundingClientRect = function () {
    let depth = 0;
    for (let n = this.parentElement; n; n = n.parentElement) if (n.tagName === "UL") depth++;
    return { left: 10 + depth * 20, top: 0, right: 0, bottom: 0, width: 10, height: 10, x: 0, y: 0 };
  };
}

test("a generic name such as Other is found through its code: branch, group, position", async () => {
  const { doc, state } = setup();
  indentByDepth();
  const result = await run(job("2.2.3 — Other"));
  assert.equal(result.status, "saved");
  assert.equal(state.saves, 1);
  // The Other under IT Services (2nd branch, 2nd group, 3rd choice), not the one under Communications.
  const mine = Array.from(doc.querySelectorAll("input[type=checkbox]")).filter((b) => b.checked && /Other/.test(b.parentElement.textContent));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].closest("li").parentElement.closest("li").querySelector("span").textContent, "IT Services");
});

test("a code that points at a different name ticks nothing", async () => {
  const { doc, state } = setup();
  indentByDepth();
  await assert.rejects(run(job("2.2.2 — Other")), /RTS lists "Systems Integration" at that place/);
  await assert.rejects(run(job("2.9.1 — Other")), /has 3 group\(s\)/);
  await assert.rejects(run(job("9.1.1 — Other")), /no branch number 9/);
  assert.equal(state.saves, 0);
  assert.deepEqual(Array.from(doc.querySelectorAll("input[type=checkbox]")).filter((b) => b.checked).length, 1);
});

test("Other without a usable code is refused instead of guessing", async () => {
  const { state } = setup();
  indentByDepth();
  await assert.rejects(run(job("Other")), /does not say which/);
  await assert.rejects(run(job("2.2 — Other")), /does not say which/);
  assert.equal(state.saves, 0);
});

test("a report with no industry name is refused", async () => {
  setup();
  await assert.rejects(run(job("")), /no industry name/);
});

test("a window that closes itself on Save leaves the tick unconfirmed here (the page reopens it to check)", async () => {
  const { state } = setup({ closeOnSave: true });
  const result = await run(job());
  assert.deepEqual(result, { status: "saved", fieldRetained: null });
  assert.equal(state.saves, 1);
});

test("Save that never settles is an error, not a success", async () => {
  setup({ saveNeverSettles: true });
  await assert.rejects(run(job()), /Save did not complete/);
});

test("verify only reads the tick back and never saves", async () => {
  const { state } = setup();
  assert.deepEqual(await run(job("6.4.1 — IT Consulting and Outsourcing", { verifyOnly: true })), { status: "verified", checked: true });
  assert.deepEqual(await run(job("6.5.1 — Application Software", { verifyOnly: true })), { status: "verified", checked: false });
  assert.equal(state.saves, 0);
});

test("a tree with no + buttons picked still works when the choice is already visible", async () => {
  const { doc } = setup();
  const result = await run({ ...job("6.4.2 — Systems Integration"), tree: { leaf: { selectors: ['input[type="checkbox"]'] } } });
  assert.equal(result.status, "saved");
  assert.ok(ticked(doc).includes("Systems Integration"));
  setup();
  await assert.rejects(run({ ...job("6.5.1 — Application Software"), tree: { leaf: { selectors: ['input[type="checkbox"]'] } } }), /was not found in the tree/);
});
