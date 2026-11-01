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

function tabs() {
  const doc = setup(`<button class="navigation__button" id="be">Business Entity</button><button class="navigation__button" id="co">Company</button>
    <div id="tabBE"><input id="webURL"><a id="expBE" href="#">Expand</a></div><div id="tabCO" style="display:none"><div id="containerIndustryGroup"></div><a id="expCO" href="#">Expand</a></div>`);
  const open = { be: false, co: false };
  const show = (which) => { doc.getElementById("tabBE").style.display = which === "be" ? "block" : "none"; doc.getElementById("tabCO").style.display = which === "co" ? "block" : "none"; };
  doc.getElementById("be").addEventListener("click", () => show("be"));
  doc.getElementById("co").addEventListener("click", () => show("co"));
  for (const [id, key] of [["expBE", "be"], ["expCO", "co"]]) doc.getElementById(id).addEventListener("click", (event) => { event.preventDefault(); open[key] = true; event.currentTarget.textContent = "Collapse"; });
  return { doc, open, show, front: () => (doc.getElementById("tabBE").style.display === "none" ? "co" : "be") };
}

test("expandEverything opens the sections of BOTH tabs, never collapses an open one, and puts the tab that was in front back in front", async () => {
  const t = tabs();
  assert.equal(await nav().expandEverything(), 2);
  assert.deepEqual(t.open, { be: true, co: true });
  assert.equal(t.front(), "be", "the Business Entity tab was in front at the start, so it is in front again");
  await nav().expandEverything();
  assert.deepEqual(t.open, { be: true, co: true });
  // started on Company: ends on Company
  t.show("co");
  await nav().expandEverything();
  assert.equal(t.front(), "co");
});

test("showTab brings a tab in front only when it is not, so each group of fields is published with its own tab shown", async () => {
  const t = tabs();
  assert.equal(await nav().showTab("Business Entity"), true);
  assert.equal(t.front(), "be");
  assert.equal(await nav().showTab("Company"), true);
  assert.equal(t.front(), "co");
  assert.equal(nav().currentTab(), "Company");
  assert.equal(await nav().showTab("Company"), true, "already in front: nothing is clicked");
  assert.equal(await nav().showTab("Business Entity"), true);
  assert.equal(nav().currentTab(), "Business Entity");
});
