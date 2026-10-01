// Selector builder: stable selectors only, verified against the live DOM.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/selectorBuilder.js";

function setup(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only" });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.Element = window.Element;
  global.HTMLInputElement = window.HTMLInputElement;
  global.HTMLSelectElement = window.HTMLSelectElement;
  global.HTMLTextAreaElement = window.HTMLTextAreaElement;
  return document;
}

const sb = () => globalThis.SXRTS.selectorBuilder;

test("prefers a stable id, and the selector resolves back to the element", () => {
  const doc = setup('<label for="foundedYear">Founded year</label><input id="foundedYear" class="form-control-3fA9x">');
  const input = doc.querySelector("input");
  const info = sb().inspectControl(input);
  assert.equal(info.kind, "text");
  assert.equal(info.selectors[0], "#foundedYear");
  assert.equal(info.label, "Founded year");
  assert.equal(info.suggestedKey, "foundedYear");
  assert.equal(doc.querySelector(info.selectors[0]), input);
});

test("never uses hashed CSS-module classes or state classes", () => {
  assert.equal(sb().isStableClass("flat-button__caption-3fA9xQ"), false);
  assert.equal(sb().isStableClass("savedNameVariation"), false);
  assert.equal(sb().isStableClass("is-active"), false);
  assert.equal(sb().isStableClass("businessEntityName"), true);
  const doc = setup('<input class="field-a8F3k2 plain-box" name="legalName">');
  const info = sb().inspectControl(doc.querySelector("input"));
  assert.ok(info.selectors.every((s) => !/a8F3k2/.test(s)));
  assert.ok(info.selectors.includes('input[name="legalName"]'));
});

test("reads a native dropdown's options and skips the blank placeholder", () => {
  const doc = setup('<select name="level"><option value="">Select</option><option value="G">Gold</option><option value="S">Silver</option></select>');
  const info = sb().inspectControl(doc.querySelector("select"));
  assert.equal(info.kind, "select");
  assert.deepEqual(info.options, [{ label: "Gold", value: "G" }, { label: "Silver", value: "S" }]);
});

test("record sub-fields get a selector shared by every row, not a one-row id", () => {
  const doc = setup('<div><input class="awardTitle" id="t1"></div><div><input class="awardTitle" id="t2"></div>');
  const first = doc.querySelector("#t1");
  const info = sb().inspectControl(first, { allowMultiple: true });
  assert.equal(info.selectors[0], "input.awardTitle");
  assert.equal(doc.querySelectorAll(info.selectors[0]).length, 2);
  const single = sb().inspectControl(first);
  assert.ok(single.selectors.every((s) => doc.querySelectorAll(s).length === 1));
});

test("custom dropdowns, checkboxes and disabled fields are refused with a reason", () => {
  const doc = setup('<input role="combobox" id="c"><input type="checkbox" id="k"><input id="d" disabled>');
  assert.match(sb().inspectControl(doc.querySelector("#c")).reason, /custom/);
  assert.match(sb().inspectControl(doc.querySelector("#k")).reason, /not supported/);
  assert.match(sb().inspectControl(doc.querySelector("#d")).reason, /disabled/);
});

test("clicking a label or wrapper resolves to the single control inside it", () => {
  const doc = setup('<div id="wrap"><span id="lbl">Name</span><input id="nm"></div>');
  assert.equal(sb().resolveControl(doc.querySelector("#wrap")), doc.querySelector("#nm"));
  assert.equal(sb().resolveControl(doc.querySelector("#lbl")), null);
});

test("buttons resolve by selector, falling back to their exact visible text", () => {
  const doc = setup('<button id="go">Save</button>');
  const info = sb().inspectButton(doc.querySelector("button"));
  assert.equal(info.text, "Save");
  assert.equal(sb().resolveButtonByDefinition({ selectors: ["#missing"], text: "Save" }), doc.querySelector("#go"));
  assert.equal(sb().resolveButtonByDefinition({ selectors: ["#go"], text: "" }), doc.querySelector("#go"));
});

test("suggested keys are camelCase, keeping already-camelCase words intact", () => {
  assert.equal(sb().toCamelKey("Founded year"), "foundedYear");
  assert.equal(sb().toCamelKey("businessEntity.emailDefaultStructure.id"), "businessEntityEmailDefaultStructureId");
  assert.equal(sb().toCamelKey("2nd Level"), "field2ndLevel");
  assert.equal(sb().toCamelKey("!!!"), "");
});
