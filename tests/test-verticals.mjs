// Verticals: the window (rows with True / False buttons, found by the name printed in each row) and the page around it
// (Published Verticals list, Add New Vertical, the section's Save changes).
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/selectorBuilder.js";
import "../core/navigation.js";
import "../core/workflows/popupWindow.js";
import "../core/workflows/customField.js";
import "../core/workflows/verticals.js";

const NAMES = ["3D Printing", "AdTech", "Advanced Manufacturing", "AgTech", "Artificial Intelligence & Machine Learning", "LOHAS & Wellness"];

function globals(dom) {
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event, InputEvent: window.InputEvent, NodeFilter: window.NodeFilter });
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// ---- the window ----
function windowPage({ chosen = [], twice = false, closeOnTrue = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body><div><b>Recommended Verticals</b></div><div><b>Other Verticals</b></div><table>${NAMES.map((n) => `
    <tr><td class="v">${n}</td><td class="d">A long description of ${n} that mentions True and False values in prose.</td>
    <td><button class="btn${chosen.includes(n) ? " btn_on" : ""}">True</button><button class="btn">False</button></td></tr>`).join("")}
    ${twice ? `<tr><td class="v">AdTech</td><td class="d">dup</td><td><button class="btn">True</button><button class="btn">False</button></td></tr>` : ""}
  </table></body>`, { runScripts: "outside-only", url: "http://localhost/industryGroup/vertical.html" });
  globals(dom);
  const state = { pressed: [], closed: 0, stages: [] };
  global.chrome = { runtime: { sendMessage: (m) => { state.stages.push(m.stage); } } };
  window.close = () => { state.closed++; };
  for (const button of document.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      const name = button.closest("tr").querySelector(".v").textContent;
      if (button.textContent === "True") { state.pressed.push(name); button.classList.add("btn_on"); if (closeOnTrue) window.close(); }
    });
  }
  Object.assign(globalThis.SXRTS.workflows.popupWindow.TIMEOUTS, { fields: 400, after: 10, rowsSettle: 20, button: 300, settle: 300 });
  return state;
}
const runWindow = (names) => globalThis.SXRTS.workflows.popupWindow.run({ rows: { names, trueText: "True" } });

test("the window: each vertical is found by the name printed in its row and its True button pressed; the window is closed", async () => {
  const state = windowPage();
  const out = await runWindow(["AdTech", "Artificial Intelligence & Machine Learning"]);
  assert.deepEqual(out, { status: "clicked", clicked: ["AdTech", "Artificial Intelligence & Machine Learning"], already: [], missing: [] });
  assert.deepEqual(state.pressed, ["AdTech", "Artificial Intelligence & Machine Learning"], "only those two True buttons, never False, never another row");
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(state.closed, 1);
});

test("the window: names match loosely ('&' and 'and', capitals), a vertical already True is not pressed again, an unknown one is reported", async () => {
  const state = windowPage({ chosen: ["AgTech"] });
  const out = await runWindow(["ai and machine learning", "agtech", "advanced manufacturing", "Space Tourism"]);
  assert.deepEqual(out.clicked, ["Advanced Manufacturing"].map(() => "advanced manufacturing"));
  assert.deepEqual(out.already, ["agtech"]);
  assert.deepEqual(out.missing, ["ai and machine learning", "Space Tourism"].map((n) => n), "'AI and ...' is not the printed name, so it is reported, never guessed");
  assert.deepEqual(state.pressed, ["Advanced Manufacturing"]);
});

test("the window: a name that appears twice is never guessed", async () => {
  const state = windowPage({ twice: true });
  const out = await runWindow(["AdTech"]);
  assert.deepEqual(out.missing, ["AdTech"]);
  assert.deepEqual(state.pressed, []);
});

test("the window: no True buttons at all is an error that says so", async () => {
  const dom = new JSDOM("<!doctype html><body><p>loading</p></body>", { runScripts: "outside-only", url: "http://localhost/" });
  globals(dom);
  global.chrome = { runtime: { sendMessage: () => {} } };
  Object.assign(globalThis.SXRTS.workflows.popupWindow.TIMEOUTS, { fields: 150 });
  await assert.rejects(runWindow(["AdTech"]), /no "True" buttons were found/);
});

// ---- the page ----
function mainPage({ published = ["LOHAS & Wellness"], saveNeverEnables = false, windowIgnores = false, noSection = false } = {}) {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost/" });
  globals(dom);
  const state = { windows: [], saves: 0 };
  const render = () => {
    document.body.innerHTML = `<div id="vert"><b>Verticals</b>
      <div class="h">Published Verticals (${published.length})</div>${published.map((p) => `<div class="r"><a>Edit</a> ${p}</div>`).join("")}
      <div class="h">Recommended Verticals (0)</div>
      <button id="add" type="button">Add New Vertical</button></div>
      <div><span>Input By: someone</span><input type="button" id="save" value="Save changes" disabled></div>`;
    document.getElementById("add").addEventListener("click", () => {});
    document.getElementById("save").addEventListener("click", () => { state.saves++; setTimeout(() => { published.push(...state.pending); state.pending = []; render(); document.getElementById("save").disabled = true; }, 30); });
  };
  state.pending = [];
  if (noSection) { document.body.innerHTML = "<p>nothing here</p>"; } else render();
  // the window is simulated: pressing True waits in "pending" and wakes the section's Save
  globalThis.SXRTS.workflows.customField.runInWindow = async (opener, job) => {
    state.windows.push(job);
    const out = { status: "clicked", clicked: [], already: [], missing: [] };
    for (const name of job.rows.names) {
      if (name === "Space Tourism") out.missing.push(name);
      else if (!windowIgnores) { state.pending.push(name); out.clicked.push(name); } else out.clicked.push(name);
    }
    if (out.clicked.length && !saveNeverEnables) document.getElementById("save").disabled = false;
    return out;
  };
  Object.assign(globalThis.SXRTS.workflows.verticals.TIMEOUTS, { open: 200, enable: 300, save: 500, list: 400 });
  return state;
}
const apply = (names) => globalThis.SXRTS.workflows.verticals.applyVerticals(names);

test("the page: a vertical already under Published Verticals is left alone; a new one is chosen, saved once and read back from the list", async () => {
  const state = mainPage({ published: ["LOHAS & Wellness"] });
  const { results } = await apply(["LOHAS & Wellness", "Artificial Intelligence & Machine Learning"]);
  assert.equal(results["LOHAS & Wellness"].status, "skipped");
  assert.match(results["LOHAS & Wellness"].detail, /already in the Published Verticals list/);
  assert.equal(results["Artificial Intelligence & Machine Learning"].status, "savedValueVerified");
  assert.equal(state.saves, 1);
  assert.deepEqual(state.windows[0].rows.names, ["Artificial Intelligence & Machine Learning"], "the window is only asked for the new one");
});

test("the page: everything already listed means the window is never opened", async () => {
  const state = mainPage({ published: ["LOHAS & Wellness"] });
  const { results } = await apply(["LOHAS & Wellness"]);
  assert.equal(results["LOHAS & Wellness"].status, "skipped");
  assert.equal(state.windows.length, 0);
  assert.equal(state.saves, 0);
});

test("the page: a vertical RTS does not list is a failure with the name; TMT and Industrials are never assigned", async () => {
  const state = mainPage({});
  const { results } = await apply(["Space Tourism", "TMT", "Industrials", "AdTech"]);
  assert.equal(results["Space Tourism"].status, "failed");
  assert.match(results["Space Tourism"].detail, /not found/);
  assert.equal(results.TMT.status, "skipped");
  assert.match(results.Industrials.detail, /system-managed/);
  assert.equal(results.AdTech.status, "savedValueVerified");
  assert.deepEqual(state.windows[0].rows.names, ["Space Tourism", "AdTech"]);
});

test("the page: success is never claimed when the list does not show the vertical afterwards", async () => {
  mainPage({ windowIgnores: true });
  const { results } = await apply(["AdTech"]);
  assert.equal(results.AdTech.status, "failed");
  assert.match(results.AdTech.detail, /is not in the Published Verticals list afterwards/);
});

test("the page: no section on the page says which tab to open", async () => {
  mainPage({ noSection: true });
  await assert.rejects(apply(["AdTech"]), /Add New Vertical.*not found.*Company tab/);
});
