// Opening a closed RTS section only when the control that is needed is missing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/navigation.js";

function setup(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only" });
  Object.assign(global, { window: dom.window, document: dom.window.document });
  return dom.window.document;
}
const nav = () => globalThis.SXRTS.navigation;

test("nothing is clicked when the control is already there", async () => {
  const doc = setup('<div id="bar">Industries and Verticals</div><button id="add">Add</button>');
  let clicks = 0;
  doc.getElementById("bar").addEventListener("click", () => clicks++);
  assert.equal(await nav().ensureSectionOpen(() => doc.getElementById("add"), ["Industries and Verticals"]), true);
  assert.equal(clicks, 0);
});

test("a closed section's bar is clicked once and the control then appears", async () => {
  const doc = setup('<div id="bar">Industries and Verticals <span>?</span></div><div id="body"></div>');
  let clicks = 0;
  doc.getElementById("bar").addEventListener("click", () => { clicks++; doc.getElementById("body").innerHTML = '<button id="add">Add</button>'; });
  assert.equal(await nav().ensureSectionOpen(() => doc.getElementById("add"), ["Industries and Verticals"]), true);
  assert.equal(clicks, 1);
});

test("if the click does not bring the control, it is clicked again so an open section is not left closed", async () => {
  const doc = setup('<div id="bar">Industries and Verticals</div>');
  const states = [];
  let open = true;
  doc.getElementById("bar").addEventListener("click", () => { open = !open; states.push(open); });
  assert.equal(await nav().ensureSectionOpen(() => null, ["Industries and Verticals"]), false);
  assert.deepEqual(states, [false, true], "closed then put back");
  assert.equal(open, true);
});

test("a title that is not on the page is ignored, and a longer text that merely starts with it is not a title bar", async () => {
  const doc = setup('<p>Industries and Verticals are covered in the long help text for this page</p>');
  assert.equal(nav().findSectionBar("Industries and Verticals"), null);
  assert.equal(await nav().ensureSectionOpen(() => null, ["Nope"]), false);
  assert.ok(doc);
});
