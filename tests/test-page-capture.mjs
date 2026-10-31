// Automatic page capture: the structure around a field that could not be written goes into the
// report, found by the field's own label, with typed values and long text left out.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/pageCapture.js";
import "../core/outputFields.js";
import "../core/issueReport.js";
import "../core/feedback.js";

const pc = globalThis.SXRTS.pageCapture;

function page(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return dom.window.document;
}

const PAGE = `
  <div id="header"><span>PBID: 999999-99</span></div>
  <div class="section" id="kw-section">
    <div class="row"><b>Keywords:</b> <a href="/help?token=SECRET#x" class="help">?</a></div>
    <div class="tagbox" data-id="123456" data-clipboard-text="https://rts.pitchbook.com/ext/1166374-99?secret-link=1" data-tooltip="Copy link to this section" id="box9988776" style="color:red; display:none">
      <span class="tag">secret keyword one</span><span class="tag">secret keyword two</span>
      <input type="text" name="kw" id="kwInput" value="typed secret value" placeholder="Add keyword">
    </div>
    <textarea name="notes">private notes text</textarea>
    <select name="kind"><option value="A" selected>Alpha</option><option value="B">Beta</option></select>
    <input type="checkbox" name="agree" value="True" checked>
    <button type="button" onclick="addKeyword('private text', 1166374)" disabled>Add</button>
    <script>var secret = "do not leak";</script>
    <svg width="10"><path d="M0 0"/></svg>
    <p>${"very long paragraph of company text ".repeat(12)}</p>
  </div>
  <div class="section" id="mgmt"><h3>Management</h3><button class="show">Show existing</button><input type="text" value="Jane Doe"></div>
`;

test("the area around a field is found by its label on the page", () => {
  const doc = page(PAGE);
  const [hit] = pc.capture(doc, [{ path: "company.keywords", label: "Keywords" }]);
  assert.equal(hit.found, true);
  assert.equal(hit.term, "Keywords");
  assert.match(hit.html, /class="tagbox"/);
  assert.match(hit.html, /id="kwInput"/);
  assert.match(hit.html, /name="kw"/);
  assert.match(hit.html, /placeholder="Add keyword"/);
  assert.match(hit.html, /onclick="addKeyword\('…', #\)"/, "a handler keeps its shape, not its arguments");
  assert.match(hit.html, /disabled/);
});

test("no typed or stored values, scripts or free text leave the page", () => {
  const doc = page(PAGE);
  const [hit] = pc.capture(doc, [{ path: "company.keywords", label: "Keywords" }]);
  assert.doesNotMatch(hit.html, /typed secret value|private notes text|do not leak|token=SECRET|<script|<path/);
  assert.doesNotMatch(hit.html, /123456/, "numbers in data attributes are masked");
  assert.match(hit.html, /data-id="#"/);
  assert.doesNotMatch(hit.html, /1166374|ext\/#|secret-link|9988776/, "no attribute carries a link or an id");
  assert.match(hit.html, /href="\/help"/, "links keep the path, not the query");
  assert.match(hit.html, /<svg>\n<\/svg>/);
  assert.match(hit.html, /style="display:none"/);
  assert.doesNotMatch(hit.html, /color:red/);
  assert.match(hit.html, /<option value="A" selected="">Alpha/);
  assert.match(hit.html, /type="checkbox"[^>]*value="True"/, "a checkbox's value is a label, not typed data");
  assert.doesNotMatch(hit.html, /very long paragraph|secret keyword/, "free text and chips are replaced");
  assert.match(hit.html, /<span class="tag">…<\/span>/);
  assert.match(hit.html, /<b>Keywords:<\/b>/, "labels are kept");
  assert.match(hit.html, /<button[^>]*>Add<\/button>/, "buttons are kept");
});

test("a field whose label is not on screen says so, and areas shared by two fields are not repeated", () => {
  const doc = page(PAGE);
  const out = pc.capture(doc, [
    { path: "extras.verticals", label: "Verticals" },
    { path: "company.keywords", label: "Keywords" },
    { path: "company.keywords[1]", label: "Keywords" },
    { path: "extras.management", label: "Management" }
  ]);
  assert.equal(out[0].found, false);
  assert.match(out[0].note, /Not on screen/);
  assert.ok(out[1].html);
  assert.match(out[2].note, /Same page area as company.keywords/);
  assert.equal(out[2].html, "");
  assert.match(out[3].html, /Show existing/);
  assert.doesNotMatch(out[3].html, /Jane Doe/);
});

test("the extension's own panel is never captured, and a known button anchors the capture", () => {
  const doc = page(`<div id="sxrts-assistant-root"><span>Keywords</span></div><div id="real"><span>Other</span><button id="anchor">New</button></div>`);
  const [a] = pc.capture(doc, [{ path: "company.keywords", label: "Keywords" }]);
  assert.equal(a.found, false);
  const [b] = pc.capture(doc, [{ path: "x.y", label: "Y", anchor: doc.getElementById("anchor") }]);
  assert.equal(b.found, true);
  assert.match(b.html, /id="anchor"/);
});

test("size limits hold: per capture, in total and in the number of fields", () => {
  const big = Array.from({ length: 30 }, (_, i) => `<div><input name="f${i}" class="${"c".repeat(60)}"></div>`).join("");
  const doc = page(`<div><b>Keywords</b>${big}</div>`);
  const [one] = pc.capture(doc, [{ path: "company.keywords", label: "Keywords" }], { perCapture: 500 });
  assert.ok(one.html.length < 700);
  assert.match(one.html, /cut here/);
  const many = pc.capture(doc, Array.from({ length: 16 }, (_, i) => ({ path: `p${i}`, label: `Nope${i}` })));
  assert.equal(many.length, 13);
  assert.match(many.at(-1).note, /4 more field\(s\)/);
});

test("the issue report carries the captures after its JSON block, and the feedback message can carry them separately", () => {
  const doc = page(PAGE);
  const captures = pc.capture(doc, [{ path: "company.keywords", label: "Keywords" }]);
  const built = globalThis.SXRTS.issueReport.build({ version: "9", domain: "acme.com", captures, actions: [{ jsonPath: "company.keywords[0]", executionStatus: "skipped", skipReason: "No selector registry entry exists", proposedValue: { value: "a" } }] });
  assert.ok(built.text.indexOf("\nJSON\n") < built.text.indexOf("PAGE CAPTURES"), "captures come after the JSON block");
  assert.match(built.text, /\[1\] company\.keywords \(Keywords\) · found by "Keywords"/);
  assert.match(built.text, /class="tagbox"/);

  const fb = globalThis.SXRTS.feedback;
  const withIt = fb.build({ note: "n", report: built.text, includeOutput: false, meta: {} });
  assert.match(withIt.captures, /^PAGE CAPTURES/);
  assert.doesNotMatch(withIt.report, /PAGE CAPTURES|class="tagbox"/, "the readable report stays short");
  assert.match(JSON.stringify(fb.body("teams", withIt)), /Page structure \(typed values removed\)/);
  const without = fb.build({ note: "n", report: built.text, includeOutput: false, includeStructure: false, meta: {} });
  assert.equal(without.captures, "");
  assert.doesNotMatch(JSON.stringify(fb.body("teams", without)), /Page structure/);
  assert.ok(JSON.stringify(fb.body("teams", fb.build({ note: "x".repeat(5000), report: "r".repeat(30000) + "\nPAGE CAPTURES\n" + "h".repeat(30000), raw: "o".repeat(30000), includeOutput: true, meta: {} }))).length < 26000, "stays under the channel's size limit");
});
