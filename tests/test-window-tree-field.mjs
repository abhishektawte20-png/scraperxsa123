// A single choice made in a tree of checkboxes in a separate window (Industry tagging): the page
// side. The background worker is replaced by a fake port; what is tested is the job handed over and
// how the outcome is confirmed (including reopening the window to read the tick back).

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/outputFields.js";
import "../core/customFields.js";
import "../core/selectorBuilder.js";
import "../core/workflows/customField.js";

const cf = globalThis.SXRTS.customFields;
const treeDef = {
  key: "industryTagging", label: "Industry code", description: "", kind: "single",
  fields: [{ key: "value", label: "Industry code", description: "", kind: "tree" }],
  openButton: { selectors: ["#addIndustry"], text: "Add Industry" },
  saveButton: { selectors: ["#save"], text: "Save" },
  window: { path: "/industryGroup/create.html", preSave: [], tree: { leaf: { selectors: ['input[type="checkbox"]'], text: "" }, expander: { selectors: ["img.tg"], text: "" } } },
  binds: { path: "extras.industryCode", map: { value: "value" } }
};

function setup(replyFor) {
  const dom = new JSDOM(`<!doctype html><body><input id="addIndustry" type="button" value="Add Industry"></body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, Event: window.Event, InputEvent: window.InputEvent
  });
  const state = { jobs: [], opened: 0 };
  document.getElementById("addIndustry").addEventListener("click", () => state.opened++);
  global.chrome = {
    runtime: {
      connect() {
        const listeners = [];
        return {
          onMessage: { addListener: (fn) => listeners.push(fn) },
          onDisconnect: { addListener() {} },
          disconnect() {},
          postMessage(message) {
            state.jobs.push(message.job);
            const say = (m) => setTimeout(() => listeners.forEach((fn) => fn(m)), 5);
            say({ type: "armed" });
            setTimeout(() => listeners.forEach((fn) => fn(replyFor(message.job, state))), 30);
          }
        };
      }
    }
  };
  return state;
}
const run = (record) => globalThis.SXRTS.workflows.customField.applyCustomField(treeDef, { action: "addIfMissing", value: "6.5.1 — Application Software", ...record });
const result = (r) => ({ type: "result", result: r });

test("a tree definition is valid, and one with no checkbox picked or the wrong kind is not", () => {
  assert.deepEqual(cf.validateDefinition(treeDef), []);
  const noLeaf = { ...treeDef, window: { ...treeDef.window, tree: { expander: treeDef.window.tree.expander } } };
  assert.ok(cf.validateDefinition(noLeaf).some((e) => /tree's checkboxes/.test(e)));
  const asList = { ...treeDef, kind: "record", rowBy: { outKey: "x", rowSelector: "div" } };
  assert.ok(cf.validateDefinition(asList).some((e) => /must be a single field/.test(e)));
  const noExpander = { ...treeDef, window: { ...treeDef.window, tree: { leaf: treeDef.window.tree.leaf } } };
  assert.deepEqual(cf.validateDefinition(noExpander), []);
});

test("the window gets the tree, the report's value and the Save button, and a read-back tick is a verified value", async () => {
  const state = setup(() => result({ status: "saved", fieldRetained: true }));
  const out = await run();
  assert.deepEqual(out, { status: "savedValueVerified", name: "industryTagging" });
  assert.equal(state.opened, 1);
  assert.equal(state.jobs.length, 1);
  assert.deepEqual(state.jobs[0], { tree: { expander: treeDef.window.tree.expander, leaf: treeDef.window.tree.leaf }, value: "6.5.1 — Application Software", preSave: [], saveButton: treeDef.saveButton });
});

test("a window that closes itself is reopened and the tick read back before success is claimed", async () => {
  const state = setup((job) => (job.verifyOnly ? result({ status: "verified", checked: true }) : result({ status: "windowClosedAfterSave" })));
  assert.equal((await run()).status, "savedValueVerified");
  assert.equal(state.jobs.length, 2);
  assert.equal(state.jobs[1].verifyOnly, true);
  assert.equal(state.jobs[1].value, "6.5.1 — Application Software");
  assert.equal(state.opened, 2, "the opening button was pressed again");
});

test("if the reopened window shows the choice unticked it is an error, never a success", async () => {
  setup((job) => (job.verifyOnly ? result({ status: "verified", checked: false }) : result({ status: "saved", fieldRetained: null })));
  await assert.rejects(run(), /the choice is not ticked/);
});

test("an already-ticked choice is a skip and nothing is read back", async () => {
  const state = setup(() => result({ status: "skipped", reason: '"Application Software" is already ticked in RTS.' }));
  const out = await run();
  assert.equal(out.status, "skipped");
  assert.match(out.reason, /already ticked/);
  assert.equal(state.jobs.length, 1);
});

test("errors from the window (not found, ambiguous, save stuck) are passed through", async () => {
  setup(() => ({ type: "error", error: '"Space Tourism" was not found in the tree of choices.' }));
  await assert.rejects(run({ value: "9.9.9 — Space Tourism" }), /not found in the tree of choices/);
});

test("no value proposed is a skip and the window is never opened", async () => {
  const state = setup(() => result({ status: "saved", fieldRetained: true }));
  const out = await run({ value: "" });
  assert.equal(out.status, "skipped");
  assert.equal(state.opened, 0);
});
