// RTS's own "Expand" control opens every section of the tab; it is pressed once before publishing
// and after switching tab, so a field is not missed only because its section was collapsed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/navigation.js";

function page(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement });
  return window.document;
}
const nav = () => globalThis.SXRTS.navigation;

test("the page's Expand control is pressed once and the sections open", async () => {
  const doc = page(`<div class="hdr"><a id="refresh">Refresh Page</a> <a id="expand" href="#">Expand</a> <a id="collapse" href="#">Collapse</a></div>
    <div id="sec" style="display:none">Website Address</div>`);
  doc.getElementById("expand").addEventListener("click", () => { doc.getElementById("sec").style.display = "block"; });
  assert.equal(await nav().expandAll(), true);
  assert.equal(doc.getElementById("sec").style.display, "block");
});

test("Collapse is never pressed, a page with no Expand control carries on, and the extension's own panel is ignored", async () => {
  const doc = page(`<a id="collapse">Collapse</a><div id="sxrts-assistant-root"><button id="mine">Expand</button></div>`);
  let collapsed = 0, mine = 0;
  doc.getElementById("collapse").addEventListener("click", () => collapsed++);
  doc.getElementById("mine").addEventListener("click", () => mine++);
  assert.equal(await nav().expandAll(), false);
  assert.equal(collapsed + mine, 0);
});

test("a hidden Expand control is not pressed", async () => {
  const doc = page(`<a id="expand" style="display:none">Expand</a>`);
  let n = 0;
  doc.getElementById("expand").addEventListener("click", () => n++);
  assert.equal(await nav().expandAll(), false);
  assert.equal(n, 0);
});
