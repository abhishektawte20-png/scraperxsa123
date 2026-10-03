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

test("a box with no id, name or stable class is found by the label printed beside it (Brief / Full Description)", () => {
  // Same layout as RTS: identical blocks, generated class names, label in an earlier sibling.
  const block = (label) => `<div class="blk"><div class="row"><label>${label} <img alt="?"></label></div><div class="wrap-9fA3kQ"><textarea class="box-9fA3kQ"></textarea></div></div>`;
  const doc = setup(block("Brief Description:") + block("Full Description:"));
  const [brief, full] = doc.querySelectorAll("textarea");

  const briefInfo = sb().inspectControl(brief);
  assert.equal(briefInfo.kind, "text");
  assert.equal(briefInfo.selectors[0], "sx-label::textarea::Brief Description:");
  assert.equal(briefInfo.fragile, false);
  assert.equal(sb().resolveFirst(briefInfo.selectors), brief);
  assert.equal(sb().resolveFirst(sb().inspectControl(full).selectors), full, "the Full Description box resolves to itself, not to the Brief one");
});

test("the label selector still resolves after the page re-renders with different generated class names", () => {
  const html = (cls) => `<div class="blk"><div><label>Brief Description:</label></div><div><textarea class="${cls}"></textarea></div></div>`;
  const first = setup(html("a-1x9Kq3"));
  const selectors = sb().inspectControl(first.querySelector("textarea")).selectors;
  const second = setup(html("zz-7Pq2Lm"));
  assert.equal(sb().resolveFirst(selectors), second.querySelector("textarea"));
});

test("with no label either, a longer position path is used until it is unique", () => {
  const nest = (n) => `<main>${"<div>".repeat(7)}<textarea></textarea>${"</div>".repeat(7)}</main>`;
  const doc = setup(nest(1) + nest(2));
  const [a, b] = doc.querySelectorAll("textarea");
  const infoB = sb().inspectControl(b);
  assert.equal(infoB.kind, "text");
  assert.equal(infoB.fragile, true);
  assert.equal(sb().resolveAll(infoB.selectors).length, 1);
  assert.equal(sb().resolveFirst(infoB.selectors), b);
  assert.notEqual(sb().resolveFirst(infoB.selectors), a);
});

test("buttons never get a label-based selector", () => {
  const doc = setup('<div><span>Facebook</span></div><div><input type="button" value="New"></div>');
  const info = sb().inspectButton(doc.querySelector("input"));
  assert.ok(info.selectors.every((s) => !s.startsWith("sx-label::")));
});

test("boxes that share one label are told apart by their number", () => {
  const block = `<div><div><label>Notes:</label></div><div><textarea class="a-9fA3kQ"></textarea></div></div>`;
  const doc = setup(block + block + block);
  const boxes = Array.from(doc.querySelectorAll("textarea"));
  for (const [i, box] of boxes.entries()) {
    const info = sb().inspectControl(box);
    assert.equal(info.kind, "text");
    assert.equal(info.selectors[0], `sx-label::textarea::Notes:||${i + 1}`);
    assert.equal(sb().resolveAll(info.selectors).length, 1);
    assert.equal(sb().resolveFirst(info.selectors), box);
  }
});

test("any pile of identical, unlabelled, attribute-free boxes can be picked and resolves back to exactly that box", () => {
  const deep = (inner) => "<div><span>".repeat(14) + inner + "</span></div>".repeat(14);
  const layouts = [
    Array.from({ length: 8 }, () => "<textarea></textarea>").join(""),
    Array.from({ length: 6 }, () => `<div><textarea></textarea></div>`).join(""),
    Array.from({ length: 4 }, () => `<section>${deep("<textarea></textarea>")}</section>`).join(""),
    `<table>${Array.from({ length: 5 }, () => "<tr><td><textarea></textarea></td><td><textarea></textarea></td></tr>").join("")}</table>`,
    Array.from({ length: 5 }, () => `<div class="c-1x9Kq3"><div class="d-7Pq2Lm"><textarea class="e-5Zt8Rw"></textarea></div></div>`).join("")
  ];
  for (const html of layouts) {
    const doc = setup(html);
    for (const box of doc.querySelectorAll("textarea")) {
      const info = sb().inspectControl(box);
      assert.equal(info.kind, "text", `a selector was built for ${html.slice(0, 40)}`);
      assert.equal(sb().resolveAll(info.selectors).length, 1);
      assert.equal(sb().resolveFirst(info.selectors), box);
    }
  }
});

test("identical boxes inside blocks that reuse the same id (RTS repeats ids) still get a selector", () => {
  // No label, no name, generated classes, and an ancestor id that appears more than once.
  const block = (n) => `<div id="descBlock"><div><div class="g-${n}x9Kq3"><textarea class="t-${n}Zt8Rw"></textarea></div></div></div>`;
  const doc = setup(block(1) + block(2) + block(3));
  for (const box of doc.querySelectorAll("textarea")) {
    const info = sb().inspectControl(box);
    assert.equal(info.kind, "text", info.reason);
    assert.equal(sb().resolveAll(info.selectors).length, 1);
    assert.equal(sb().resolveFirst(info.selectors), box);
  }
});

test("the same, with labels that repeat and ids that repeat", () => {
  const block = `<div id="blk"><div id="row"><label>Notes:</label></div><div id="wrap"><textarea></textarea></div></div>`;
  const doc = setup(block + block);
  for (const box of doc.querySelectorAll("textarea")) {
    const info = sb().inspectControl(box);
    assert.equal(info.kind, "text", info.reason);
    assert.equal(sb().resolveFirst(info.selectors), box);
  }
});

test("fuzz: every text box and dropdown in 300 random pages with repeated ids, names, labels and classes gets a selector that resolves back to exactly it", () => {
  let seed = 20261003;
  const rand = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
  const pick = (list) => list[rand(list.length)];
  const attrs = () => [
    rand(3) === 0 ? ` id="${pick(["blk", "row", "wrap", "box", "x"])}"` : "",
    rand(2) === 0 ? ` class="${pick(["a-1x9Kq3", "b-7Pq2Lm", "wrap", "row"])}"` : ""
  ].join("");
  function node(depth) {
    if (depth === 0 || rand(5) === 0) {
      const control = pick(["textarea", "input", "select"]);
      const own = [rand(3) === 0 ? ` name="${pick(["n1", "n2"])}"` : "", rand(4) === 0 ? ` placeholder="${pick(["p1", "p2"])}"` : "", rand(4) === 0 ? ` class="${pick(["a-1x9Kq3", "c-4Mn8Zs"])}"` : "", rand(5) === 0 ? ` id="${pick(["blk", "x", "fld"])}"` : ""].join("");
      return control === "select" ? `<select${own}><option value="">--</option><option value="a">A</option></select>` : control === "input" ? `<input type="text"${own}>` : `<textarea${own}></textarea>`;
    }
    const tag = pick(["div", "div", "span", "section", "p"]);
    const kids = Array.from({ length: 1 + rand(3) }, () => (rand(3) === 0 ? `<label>${pick(["Notes:", "Description:", "Name"])}</label>` : "") + node(depth - 1)).join("");
    return `<${tag}${attrs()}>${kids}</${tag}>`;
  }
  let checked = 0;
  for (let page = 0; page < 300; page++) {
    const doc = setup(Array.from({ length: 1 + rand(4) }, () => node(2 + rand(4))).join(""));
    for (const control of doc.querySelectorAll("input, textarea, select")) {
      const info = sb().inspectControl(control);
      assert.ok(info.kind === "text" || info.kind === "select", `page ${page}: ${info.reason}\n${doc.body.innerHTML}`);
      const found = sb().resolveAll(info.selectors);
      assert.equal(found.length, 1, `page ${page}: ${info.selectors} matched ${found.length}`);
      assert.equal(found[0], control);
      checked++;
    }
  }
  assert.ok(checked > 500, `checked ${checked} controls`);
});

test("a box under tags whose names CSS cannot select (o:p, fb:comments) still gets a selector", () => {
  // `o:p` reads as a pseudo-class in a CSS selector, so every CSS path through it is invalid.
  const doc = setup('<o:p><div><textarea></textarea></div></o:p><o:p><div><textarea></textarea></div></o:p>');
  const boxes = Array.from(doc.querySelectorAll("textarea"));
  assert.equal(boxes.length, 2);
  for (const box of boxes) {
    const info = sb().inspectControl(box);
    assert.equal(info.kind, "text", info.reason);
    assert.equal(info.fragile, true);
    assert.match(info.selectors[0], /^sx-path::/);
    assert.equal(sb().resolveFirst(info.selectors), box);
  }
});

test("a form field named 'id' (which hides form.id) does not break picking", () => {
  const doc = setup('<form><input name="id" value="1"><input name="classList"><div><textarea></textarea></div></form><form><input name="id"><div><textarea></textarea></div></form>');
  for (const box of doc.querySelectorAll("textarea")) {
    const info = sb().inspectControl(box);
    assert.equal(info.kind, "text", info.reason);
    assert.equal(sb().resolveFirst(info.selectors), box);
  }
});

test("naming a box by the text beside it: the selector leads back to exactly that box, even among look-alikes", () => {
  const block = (label) => `<table><tr><td><b>${label}</b></td></tr><tr><td><div><textarea></textarea></div></td></tr></table>`;
  const doc = setup(block("Brief Description:") + block("Full Description:") + block("Notes:") + block("Notes:"));
  const boxes = Array.from(doc.querySelectorAll("textarea"));
  const labelOf = (i) => doc.querySelectorAll("b")[i];

  const brief = sb().anchorSelectorFor(boxes[0], labelOf(0));
  assert.equal(brief.text, "Brief Description:");
  assert.equal(brief.selector, "sx-after::textarea::Brief Description:");
  assert.equal(sb().resolveFirst([brief.selector]), boxes[0]);
  assert.equal(sb().resolveFirst([sb().anchorSelectorFor(boxes[1], labelOf(1)).selector]), boxes[1]);

  // Two boxes share the label "Notes:": each gets its own number.
  assert.equal(sb().anchorSelectorFor(boxes[2], labelOf(2)).selector, "sx-after::textarea::Notes:||1");
  assert.equal(sb().anchorSelectorFor(boxes[3], labelOf(3)).selector, "sx-after::textarea::Notes:||2");
  assert.equal(sb().resolveFirst(["sx-after::textarea::Notes:||2"]), boxes[3]);
});

test("naming by label tolerates case and spacing, rejects text that does not lead to the box, and survives a re-render", () => {
  const html = (cls) => `<div><span class="${cls}">Brief   description:</span></div><div><textarea></textarea></div><div><span>Other</span></div><div><textarea></textarea></div>`;
  const first = setup(html("a-1x9Kq3"));
  const [box, other] = first.querySelectorAll("textarea");
  assert.equal(sb().anchorSelectorForText(box, "brief description:"), "sx-after::textarea::brief description:");
  assert.equal(sb().anchorSelectorForText(other, "Brief description:"), null, "that text leads to the first box, not this one");
  assert.equal(sb().anchorSelectorForText(box, "Nothing like this"), null);
  assert.equal(sb().anchorSelectorForText(box, ""), null);
  const selector = sb().anchorSelectorForText(box, "Brief description:");

  const second = setup(html("zz-7Pq2Lm"));
  assert.equal(sb().resolveFirst([selector]), second.querySelector("textarea"));
});

test("a box nothing can identify is accepted as 'needs a label' instead of being refused", () => {
  const doc = setup("<div><textarea></textarea></div>");
  const info = sb().inspectControl(doc.querySelector("textarea"));
  assert.equal(info.kind, "text");
  assert.ok(info.selectors.length > 0, "even this one has a position-based fallback");
  assert.equal(info.needsLabel, false);
});
