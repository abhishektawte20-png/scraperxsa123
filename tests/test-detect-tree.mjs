// Automatic detection of a tree of checkboxes in a window: finds the checkboxes, the + buttons and Save,
// and tests the + buttons by opening one. Includes a tree that draws its choices only when a branch opens.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/selectorBuilder.js";
import "../content/popupPicker.js";

const sb = () => globalThis.SXRTS.selectorBuilder;
const detect = () => globalThis.SXRTS.popupPicker.detectTree(sb(), null);

function page(html, script) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, NodeFilter: window.NodeFilter });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.eval(script || "");
  return window.document;
}

const OPEN_CLOSE = `
  document.addEventListener("click", (e) => {
    const t = e.target.closest("img.tg"); if (!t) return;
    const list = t.parentElement.querySelector(":scope > ul");
    list.style.display = list.style.display === "none" ? "block" : "none";
  });`;

test("finds the checkboxes, the + buttons and Save, and opens every branch to read the whole list", async () => {
  const doc = page(`<ul>
    <li><img class="tg" alt="+"> Energy<ul style="display:none"><li><input type="checkbox" name="i"> Oil</li><li><input type="checkbox" name="i"> Gas</li></ul></li>
    <li><img class="tg" alt="+"> Healthcare<ul style="display:none"><li><input type="checkbox" name="i"> Devices</li></ul></li></ul>
    <input type="button" id="save" value="Save" disabled>`, OPEN_CLOSE);
  const found = await detect();
  assert.equal(found.leaf.selectors.length > 0, true);
  assert.equal(sb().matchAll(found.leaf.selectors[0]).length, 3);
  assert.ok(found.expander, "a + button was recognised");
  assert.equal(sb().matchAll(found.expander.selectors[0]).length, 2);
  assert.equal(found.saveButton.text, "Save");
  assert.deepEqual(found.notes, []);
  assert.match(found.summary.join(" "), /3 choices in 2 branches.*\+ buttons tested.*Save button "Save"/);
  assert.deepEqual(found.counts, { choices: 3, branches: 2, covered: 3 });
  assert.deepEqual(Array.from(doc.querySelectorAll("li > ul")).map((u) => u.style.display), ["block", "block"], "every branch was opened to read the list");
  assert.equal(doc.querySelectorAll("input[type=checkbox]:checked").length, 0, "nothing is ticked");
});

test("a tree that draws its choices only when a branch is opened is still detected", async () => {
  const doc = page(`<ul id="root"><li><img class="tg" alt="+"> <span>Energy</span></li><li><img class="tg" alt="+"> <span>Healthcare</span></li></ul>
    <input type="button" id="save" value="Save Changes" disabled>`, `
    document.getElementById("root").addEventListener("click", (e) => {
      const t = e.target.closest("img.tg"); if (!t) return;
      const li = t.parentElement;
      if (li.querySelector("ul")) { li.querySelector("ul").remove(); return; }
      li.insertAdjacentHTML("beforeend", '<ul><li><input type="checkbox" name="i"> Oil</li><li><input type="checkbox" name="i"> Gas</li></ul>');
    });`);
  const found = await detect();
  assert.ok(found.leaf, "checkboxes found after opening a branch");
  assert.ok(found.expander);
  assert.equal(found.saveButton.text, "Save Changes");
  assert.match(found.summary.join(" "), /4 choices in 2 branches/);
  assert.ok(doc.querySelectorAll("input[type=checkbox]").length >= 2);
});

test("an already-open list needs no + button", async () => {
  page(`<ul><li><input type="checkbox"> Oil</li><li><input type="checkbox"> Gas</li></ul><button>Save</button>`);
  const found = await detect();
  assert.equal(found.expander, null);
  assert.deepEqual(found.notes, []);
  assert.match(found.summary.join(" "), /2 choices in 0 branches/);
});

test("what could not be found is said plainly", async () => {
  page(`<p>Nothing here</p>`);
  const none = await detect();
  assert.equal(none.leaf, null);
  assert.match(none.notes.join(" "), /No choice boxes were found/);

  page(`<ul><li><input type="checkbox"> Oil</li></ul><button>Save</button><button>Save and close</button>`);
  const two = await detect();
  assert.match(two.notes.join(" "), /More than one Save button/);
  assert.equal(two.saveButton, null);

  page(`<ul><li><input type="checkbox"> Oil</li></ul>`);
  assert.match((await detect()).notes.join(" "), /No Save button was found/);
});
