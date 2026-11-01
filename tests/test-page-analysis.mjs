// Analyze page: reads the visible page (or the open dialog) into a list of controls with their words, grouped by
// form, matched to report fields. Read-only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/selectorBuilder.js";
import "../core/outputFields.js";
import "../core/pageAnalysis.js";

const pa = () => globalThis.SXRTS.pageAnalysis;

function page(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event });
  return window;
}

const POSITION_FORM = `
  <div id="people"><h3>Management</h3><input type="button" id="addPos" class="btn" value="Add New Management Position"></div>
  <form id="posForm"><h3>Management position</h3><table>
    <tr><td><label for="fn">Full name*</label></td><td><input id="fn" name="person.fullName"></td></tr>
    <tr><td><label for="jt">Job title</label></td><td><input id="jt" name="position.title"></td></tr>
    <tr><td>Relationship*</td><td><select name="position.relationship"><option value=""></option><option value="1">Executive</option><option value="2">Board Member</option></select></td></tr>
    <tr><td>Source</td><td><textarea name="position.source"></textarea></td></tr>
    <tr><td>Current</td><td><input type="checkbox" name="position.current"></td></tr>
  </table><input type="button" id="savePos" value="Save Changes" disabled></form>`;

test("the controls are listed with their words, kind, required flag and choices, grouped by form, and nothing on the page changes", () => {
  page(POSITION_FORM);
  const before = document.body.innerHTML;
  const result = pa().scan();
  assert.equal(document.body.innerHTML, before, "read-only");
  const form = result.regions.find((r) => /Management position/.test(r.title));
  assert.ok(form, result.regions.map((r) => r.title).join("|"));
  const by = (label) => form.items.find((i) => i.label === label);
  assert.equal(by("Full name").kind, "text");
  assert.equal(by("Full name").required, true);
  assert.equal(by("Job title").required, false);
  assert.equal(by("Relationship").kind, "select");
  assert.deepEqual(by("Relationship").options.map((o) => o.label), ["Executive", "Board Member"]);
  assert.equal(by("Source").kind, "text");
  assert.equal(form.items.find((i) => i.kind === "checkbox").mappable, false);
  assert.ok(form.items.some((i) => i.kind === "button" && i.label === "Save Changes" && i.disabled), "a greyed-out Save is listed");
  assert.ok(result.buttons.some((b) => b.label === "Add New Management Position"));
  assert.ok(by("Full name").selectors.length, "it says how to find the box again");
});

test("an open dialog is read on its own (the page behind it is left out); 'page' reads everything", () => {
  page(`<input id="behind" placeholder="behind the dialog"><div class="modal" style="position:fixed"><h2>Add person</h2><label for="n">First name</label><input id="n"><input type="button" value="Submit"></div>`);
  const auto = pa().scan();
  assert.equal(auto.scope, "window");
  assert.ok(auto.items.some((i) => i.label === "First name"));
  assert.ok(!auto.items.some((i) => i.selectors.some((s) => s.includes("behind"))), "the page behind is left out");
  const whole = pa().scan({ scope: "page" });
  assert.equal(whole.scope, "page");
  assert.ok(whole.items.length > auto.items.length);
});

test("what a button revealed is told apart from what was already there", () => {
  page(`<input type="button" id="open" value="Add"><div id="f" style="display:none"><label for="a">City</label><input id="a"></div>`);
  document.getElementById("open").addEventListener("click", () => { document.getElementById("f").style.display = ""; });
  const before = pa().scan();
  document.getElementById("open").click();
  const after = pa().scan();
  assert.deepEqual(pa().appeared(before, after).map((i) => i.label), ["City"]);
});

test("each box is matched to the report field it most likely fills, by its words", () => {
  const management = globalThis.SXRTS.outputFields.get("extras.management");
  assert.equal(pa().suggestKey("Full name", management), "fullName");
  assert.equal(pa().suggestKey("Job title", management), "title");
  assert.equal(pa().suggestKey("Position", management), "title");
  assert.equal(pa().suggestKey("Crawling name zzz", management), null);
  assert.equal(pa().suggestField(["Full name", "Job title"]), "extras.management");
  const social = globalThis.SXRTS.outputFields.get("businessEntity.socialMediaIdentifiers");
  assert.equal(pa().suggestKey("Network", social), "network");
  assert.equal(pa().suggestKey("Profile URL", social), "handleOrUrl");
});

test("the text account for the developer lists regions, boxes, required flags, choices and selectors, and no typed values", () => {
  page(POSITION_FORM);
  document.getElementById("fn").value = "SECRET PERSON";
  const text = pa().asText(pa().scan());
  assert.match(text, /\[Management position\]/);
  assert.match(text, /select\s+Relationship/);
  assert.match(text, /choices: Executive, Board Member/);
  assert.match(text, /text\s+Full name/);
  assert.doesNotMatch(text, /SECRET PERSON/);
  assert.equal(typeof JSON.stringify(pa().plain(pa().scan())), "string", "a plain copy can be stored");
});
