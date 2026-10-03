// A list entry filled in a separate popup window (Social Media Identifier ->
// "New"). The background worker is replaced by a fake port that answers like
// the real one; what is tested here is the page side: picking the row by its
// name, handing the job over, and confirming that RTS really changed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/customFields.js";
import "../core/selectorBuilder.js";
import "../core/workflows/customField.js";

const rowDef = {
  key: "socialMedia", label: "Social media identifiers", description: "", kind: "record",
  fields: [{ key: "handle", kind: "text", selectors: ["#identifierText"] }],
  openButton: { selectors: ["#change"], text: "New" },
  saveButton: { selectors: ['[data-test-id="social-media-change-tag-save-btn"]'], text: "Save Changes" },
  window: { path: "/socialMedia/loadChangeIdentifier.html", preSave: [{ selectors: ["#showExisting"], text: "Show existing data" }] },
  rowBy: { outKey: "network", rowSelector: "div.smRow" },
  binds: { path: "businessEntity.socialMediaIdentifiers", map: { handle: "handleOrUrl" } }
};
const singleDef = {
  key: "employees", label: "Employees", description: "", kind: "single",
  fields: [{ key: "value", kind: "text", selectors: ["#identifierText"] }],
  openButton: { selectors: ["#openOne"], text: "Edit" },
  saveButton: { selectors: ["#save"], text: "Save Changes" },
  window: { path: "/x.html", preSave: [] }
};

function setup({ behaviour }) {
  const dom = new JSDOM(`<!doctype html><body>
    ${["Twitter", "Facebook", "Instagram"].map((n) => `<div class="smRow" data-n="${n}"><span>${n}</span>
      <input id="change" type="button" value="New" class="btn buttonView"><input type="button" value="History" class="btn buttonView" disabled></div>`).join("")}
    <div class="smRow" data-n="LinkedIn"><span>LinkedIn</span> <span>13/03/2026</span><input type="button" value="History" class="btn buttonView"></div>
    <input id="openOne" type="button" value="Edit">
  </body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const state = { jobs: [], opened: [], origins: [] };
  for (const button of document.querySelectorAll("#change, #openOne")) {
    button.addEventListener("click", () => state.opened.push(button.closest(".smRow")?.dataset.n ?? "one"));
  }
  global.chrome = {
    runtime: {
      connect() {
        const listeners = [];
        const port = {
          onMessage: { addListener: (fn) => listeners.push(fn) },
          onDisconnect: { addListener() {} },
          disconnect() {},
          postMessage(message) {
            state.jobs.push(message.job);
            state.origins.push(message.origin);
            const say = (m) => setTimeout(() => listeners.forEach((fn) => fn(m)), 5);
            say({ type: "armed" });
            setTimeout(() => {
              behaviour.mutate?.(document, state);
              behaviour.reply ? listeners.forEach((fn) => fn(behaviour.reply)) : null;
            }, 40);
          }
        };
        return port;
      }
    }
  };
  globalThis.SXRTS.workflows.customField.TIMEOUTS.rowChange = 300;
  return { document, state };
}

const linkFacebook = (doc) => {
  const row = doc.querySelector('.smRow[data-n="Facebook"]');
  row.querySelector("#change").remove();
  row.insertAdjacentHTML("beforeend", "<span>03/10/2026 10:00</span>");
};
const run = (def, record) => globalThis.SXRTS.workflows.customField.applyCustomField(def, record);
const fbRecord = { action: "addIfMissing", handle: "ChampionPoolSupply", __row: "Facebook" };

test("clicks the New button of the row named by the network and hands the job to the window", async () => {
  const { state } = setup({ behaviour: { mutate: linkFacebook, reply: { type: "result", result: { status: "windowClosedAfterSave" } } } });
  const result = await run(rowDef, fbRecord);
  assert.deepEqual(state.opened, ["Facebook"], "Twitter's and Instagram's New buttons are not touched");
  assert.equal(state.origins[0], "http://localhost");
  assert.deepEqual(state.jobs[0].fields, [{ selectors: ["#identifierText"], kind: "text", value: "ChampionPoolSupply" }]);
  assert.equal(state.jobs[0].preSave[0].text, "Show existing data");
  assert.equal(state.jobs[0].saveButton.text, "Save Changes");
  assert.equal(result.status, "savedStateVerified");
  assert.match(result.detail, /Facebook as linked/);
});

test("a window that shows the value afterwards, plus a changed row, is a verified value", async () => {
  setup({ behaviour: { mutate: linkFacebook, reply: { type: "result", result: { status: "saved", fieldRetained: true } } } });
  assert.equal((await run(rowDef, fbRecord)).status, "savedValueVerified");
});

test("if the row still looks the same after Save it is reported, not assumed", async () => {
  setup({ behaviour: { reply: { type: "result", result: { status: "windowClosedAfterSave" } } } });
  await assert.rejects(() => run(rowDef, fbRecord), /Facebook row in RTS still looks unchanged/);
});

test("a network whose row has no New button is already linked and is skipped without opening anything", async () => {
  const { state } = setup({ behaviour: {} });
  const result = await run(rowDef, { ...fbRecord, __row: "LinkedIn" });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /LinkedIn already has an entry/);
  assert.equal(state.jobs.length, 0);
});

test("a network with no row in RTS is a clear error", async () => {
  setup({ behaviour: {} });
  await assert.rejects(() => run(rowDef, { ...fbRecord, __row: "Pinterest" }), /No row labelled "Pinterest"/);
});

test("an error from the window is passed through", async () => {
  setup({ behaviour: { reply: { type: "error", error: "No popup window opened. Allow pop-ups." } } });
  await assert.rejects(() => run(rowDef, fbRecord), /No popup window opened/);
});

test("a window that reports an existing value is a skip", async () => {
  setup({ behaviour: { reply: { type: "result", result: { status: "skipped", reason: 'The popup already has a value ("x").' } } } });
  const result = await run(rowDef, fbRecord);
  assert.equal(result.status, "skipped");
});

test("a single field in a window is verified only if the window still shows the value", async () => {
  setup({ behaviour: { reply: { type: "result", result: { status: "saved", fieldRetained: true } } } });
  assert.equal((await run(singleDef, { action: "addIfMissing", value: "250" })).status, "savedValueVerified");
  setup({ behaviour: { reply: { type: "result", result: { status: "windowClosedAfterSave" } } } });
  await assert.rejects(() => run(singleDef, { action: "addIfMissing", value: "250" }), /could not be confirmed/);
});

test("definitions: a list in a window needs recognised rows; an unrecognised one is refused", () => {
  const cf = globalThis.SXRTS.customFields;
  globalThis.SXRTS.outputFields = globalThis.SXRTS.outputFields ?? { get: () => ({ label: "x", kind: "list", keys: [{ key: "network" }, { key: "handleOrUrl" }] }) };
  assert.deepEqual(cf.validateDefinition(singleDef), []);
  assert.ok(cf.validateDefinition({ ...rowDef, rowBy: undefined }).some((e) => /rows of this list could not be recognised/.test(e)));
  assert.ok(cf.validateDefinition({ ...singleDef, openButton: undefined }).some((e) => /needs the button that opens it/.test(e)));
});

test("toDefRecord carries the row's name so the workflow can find the row", () => {
  const record = globalThis.SXRTS.customFields.toDefRecord(rowDef, { network: "Facebook", handleOrUrl: "Acme", action: "addIfMissing" });
  assert.equal(record.__row, "Facebook");
  assert.equal(record.handle, "Acme");
});
