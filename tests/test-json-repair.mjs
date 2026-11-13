// Plain-language JSON errors and the repairs that are safe (only when the meaning is never in doubt).

import assert from "node:assert/strict";
import { test } from "node:test";
import "../core/jsonRepair.js";

const jr = globalThis.SXRTS.jsonRepair;
const parseError = (text) => { try { JSON.parse(text); } catch (e) { return e; } return null; };

test("valid JSON needs no repair and is returned unchanged", () => {
  const r = jr.repair('{"a": [1, 2], "b": "x"}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.fixes, []);
});

test("each safe repair is applied, and only when the result parses", () => {
  const cases = [
    ['{"a": 1,}', "TRAILING_COMMA"],
    ['{"a": [1, 2,\n ]}', "TRAILING_COMMA"],
    ['{\u201Ca\u201D: \u201Cx\u201D}', "CURLY_QUOTES"],
    ['{"a": "line one\nline two"}', "RAW_NEWLINE"],
    ['{"a": "x\ty"}', "RAW_TAB"],
    ['{"a": True, "b": None}', "PYTHON_LITERAL"],
    ['{"a": 1, // note\n "b": 2}', "COMMENT"],
    ['{"a": /* hi */ 1}', "COMMENT"],
    ['\uFEFF{"a": 1}', "INVISIBLE"],
    ['{"a": "it\\\'s"}', "ESCAPED_APOSTROPHE"],
    ['{"a":\u00A01}', "NBSP"]
  ];
  for (const [text, code] of cases) {
    const r = jr.repair(text);
    assert.equal(r.ok, true, `${code}: ${JSON.stringify(text)}`);
    assert.ok(r.fixes.some((f) => f.code === code), `${code} reported`);
    JSON.parse(r.text);
  }
  assert.deepEqual(JSON.parse(jr.repair('{"a": "line one\nline two"}').text), { a: "line one line two" }, "a line break inside text is a chat window's wrap: it becomes a space");
  assert.deepEqual(JSON.parse(jr.repair('{\u201Ca\u201D: \u201Cx\u201D}').text), { a: "x" });
});

test("repairs never change values: commas, comments and look-alikes inside text are left alone", () => {
  const text = '{"a": "x, ] // not a comment, True, \u201Cq\u201D", "b": [1,2]}';
  const r = jr.repair(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fixes, []);
  assert.deepEqual(JSON.parse(r.text), JSON.parse(text));
});

test("anything that needs a guess is not repaired", () => {
  for (const text of [
    '{"a": "he said "hello" to me"}',      // quote mark inside text
    '{"a": ["x", "y"',                      // cut off
    '{"a": "unfinished}',                   // unterminated text
    '{"a": ["a" "b"]}',                     // missing comma
    "{'a': 'x'}",                           // single-quoted keys and values
    '{"a": \u201Cit has a " inside\u201D}'
  ]) {
    const r = jr.repair(text);
    assert.equal(r.ok, false, text);
    assert.equal(r.text, text);
  }
});

test("explain gives the line, column, the text nearby and a plain reason", () => {
  const text = '{\n  "a": 1,\n  "b": ["x" "y"]\n}';
  const e = jr.explain(parseError(text), text);
  assert.equal(e.line, 3);
  assert.ok(e.column >= 8);
  assert.match(e.near, /"x" "y"/);
  assert.match(e.reason, /missing|comma/i);
  assert.match(e.text, /^Line 3, column \d+: /);
  const cut = '{"a": ["x", "y"';
  const c = jr.explain(parseError(cut), cut);
  assert.match(c.reason, /cut off/);
  assert.equal(c.line, 1);
});

test("summaries say what was fixed and where", () => {
  const r = jr.repair('{\n"a": 1,\n"b": [1,],\n"c": 2,\n}');
  assert.equal(r.ok, true);
  const [line] = jr.summarize(r.fixes);
  assert.match(line, /removed a comma before a closing bracket \(2 times\), lines 3, 4/);
});

test("a hard-wrapped fallback phrase is joined back into exactly the phrase the methodology prescribes", () => {
  const r = jr.repair('{"former_name": { "value": "Not found\n   on the official website.", "source_url": null }}');
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(r.text).former_name.value, "Not found on the official website.");
});

test("a web address whose closing quote mark was written as %22 is closed again; the same text elsewhere is left alone", () => {
  const broken = '{"youtube": { "value": "https://www.youtube.com/@FarfallaEventsKC%22 }, "former_name": { "value": "Not found\non the official website." } }';
  const r = jr.repair(broken);
  assert.equal(r.ok, true, JSON.stringify(r.next));
  const parsed = JSON.parse(r.text);
  assert.equal(parsed.youtube.value, "https://www.youtube.com/@FarfallaEventsKC");
  assert.equal(parsed.former_name.value, "Not found on the official website.");
  assert.ok(r.fixes.some((f) => f.code === "URL_QUOTE") && r.fixes.some((f) => f.code === "RAW_NEWLINE"));
  const fine = jr.repair('{"u": "https://x.com/a%22b", "v": "text %22 } more"}');
  assert.equal(fine.ok, true);
  assert.deepEqual(fine.fixes, []);
  assert.equal(JSON.parse(fine.text).v, "text %22 } more");
});

test("when safe fixes are not enough, the NEXT problem is reported too, not just the first", () => {
  const r = jr.repair('{"a": "x\ny", "b": ["p" "q"]}');
  assert.equal(r.ok, false);
  assert.ok(r.tried.some((f) => f.code === "RAW_NEWLINE"));
  assert.match(r.next.text, /Something is missing between two items|Unexpected/);
});
