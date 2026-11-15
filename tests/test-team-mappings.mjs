// The mappings that ship to every researcher (team/teamDefaults.js): each is valid, none can press Save twice or a Close
// button, and each opening button / field resolves against the page structure RTS really has.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

globalThis.SXRTS = {};
await import("../core/outputFields.js");
await import("../core/customFields.js");
await import("../core/selectorBuilder.js");
new Function(readFileSync(new URL("../team/teamDefaults.js", import.meta.url), "utf8"))();
const defs = globalThis.SXRTS.teamDefaults.mappings;
const byKey = (key) => defs.find((d) => d.key === key);
const cf = globalThis.SXRTS.customFields;
const sb = globalThis.SXRTS.selectorBuilder;

function page(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: "https://rts.pitchbook.com/" });
  Object.assign(global, { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, NodeFilter: dom.window.NodeFilter });
  dom.window.HTMLElement.prototype.checkVisibility = () => true;
}

test("every shipped mapping is valid, keys are unique, and each is bound to a field the report has", () => {
  assert.equal(defs.length, 8);
  assert.equal(new Set(defs.map((d) => d.key)).size, defs.length);
  for (const def of defs) {
    assert.deepEqual(cf.validateDefinition(def), [], def.key);
    assert.ok(def.binds?.path, `${def.key} is bound to a report field`);
  }
});

test("no mapping presses its own Save button as a step 'before Save', and none lists a Close / Cancel control", () => {
  const closing = /(^|[^a-z])(close|cancel|dismiss|exit)([^a-z]|$)/i;
  for (const def of defs) {
    for (const step of def.window?.preSave || []) {
      const sameSelector = Boolean(step.selectors?.[0]) && step.selectors[0] === def.saveButton?.selectors?.[0];
      const sameWords = step.text && def.saveButton?.text && step.text.toLowerCase() === def.saveButton.text.toLowerCase();
      assert.ok(!sameSelector && !sameWords, `${def.key}: "${step.text}" is the Save button itself`);
    }
    const everySelector = JSON.stringify([def.openButton, def.saveButton, def.fields, def.window, def.tree]);
    assert.ok(!closing.test(everySelector.replace(/"text":"[^"]*"/g, "")), `${def.key} lists a close / cancel control`);
  }
});

test("Keywords: the box is found by its placeholder in the structure RTS has (tags above, one input)", () => {
  page('<div class="keywords"><div class="keywords__list"><div class="base-pill"><div class="element-group__item">AI</div><div class="element-group__item base-pill__close-icon"><i class="rts-icon-close"></i></div></div><input placeholder="Enter or paste keywords" class="keywords__input" type="text" maxlength="100"></div></div><button data-test-id="description-keywords-save-btn" class="button_main button_primary-color button_size-default">Save Changes</button>');
  const def = byKey("companyKeywords");
  assert.equal(sb.resolveAll(def.fields[0].selectors).length, 1);
  assert.equal(sb.resolveButtonByDefinition(def.saveButton).getAttribute("data-test-id"), "description-keywords-save-btn");
});

test("NAICS: the Add NAICS button is found by its own test id, not by position", () => {
  page('<button data-test-id="other" class="button">Other</button><button data-test-id="naics-add-button" class="button" disabled><span>Add NAICS</span></button>');
  assert.equal(sb.resolveButtonByDefinition(byKey("companyNaicsCodes").openButton).getAttribute("data-test-id"), "naics-add-button");
});

test("Start date and the Industry button resolve to the one control each", () => {
  page('<div class="row"><input type="text" name="startDate" id="startDate" class="input"></div><div id="containerIndustryGroup"><div><div class="mb_10"></div><div class="mb_20"></div><div class="d_flex"><input type="button" value="Add/Edit Industry" class="btn btn_secondary"></div></div></div>');
  assert.equal(sb.resolveAll(byKey("extrasStartDate").fields[0].selectors).length, 1);
  const opener = sb.resolveButtonByDefinition(byKey("extrasIndustryCode").openButton);
  assert.equal(opener.value, "Add/Edit Industry");
});

test("a positional selector that lands on a DIFFERENT button (Employee count: 'form > div:nth-of-type(2) > div > div > button') is not used: the button with the recorded words is", () => {
  page(`<form><div></div><div><div><div><button type="button" id="wrong">Cancel</button></div></div></div></form>
        <section><form><div></div><div><div><div><button type="button" id="right">Add New Employee Count</button></div></div></div></form></section>`);
  const opener = sb.resolveButtonByDefinition(byKey("extrasEmployeeCount").openButton);
  assert.equal(opener.id, "right", "the first form's first button (Cancel) is not pressed");
  page(`<form><div></div><div><div><div><button type="button" id="only">Cancel</button></div></div></div></form>`);
  assert.equal(sb.resolveButtonByDefinition(byKey("extrasEmployeeCount").openButton), null, "no button with the recorded words: nothing is pressed");
});
