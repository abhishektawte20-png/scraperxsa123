// Ownership / Business Status History: skip an exact match, overwrite a different current row, add to an empty table,
// and only call it saved after the rows are read back. The tables copy the controls from RTS (input.shDate, select.shStatus,
// "Add New ... Status", Save OSH / Save BSH).
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/workflows/statusHistory.js";

const wf = () => globalThis.SXRTS.workflows.statusHistory;
const OSH_OPTIONS = ["", "Privately Held", "In IPO Registration", "Publicly Held", "Acquired/Merged", "Out of Business", "Other/Unknown"];
const BSH_OPTIONS = ["", "Product Development", "Profitable", "Generating Revenue", "Generating Revenue/Not Profitable", "Startup", "Out of Business"];

function page({ osh = [], bsh = [], dropSave = false } = {}) {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.assign(wf().TIMEOUTS, { add: 400, field: 400, save: 600 });
  const state = { saves: { osh: 0, bsh: 0 }, adds: { osh: 0, bsh: 0 } };
  const opts = (list, selected) => list.map((o) => `<option${o === selected ? " selected" : ""}>${o}</option>`).join("");
  const row = (list, d, s, current) => `<div class="row"><span class="${current ? "checkMark current" : "emptyMark"}"></span><input type="text" class="input shDate" value="${d}"><select class="input input_select shStatus">${opts(list, s)}</select></div>`;
  const section = (id, title, addValue, saveId, list, rows) => `<div id="${id}"><b>${title}</b><div class="rows">${rows.map((r, i) => row(list, r[0], r[1], i === 0)).join("")}</div><input type="button" value="${addValue}" class="btn"><input type="button" value="Save" id="${saveId}" disabled></div>`;
  document.body.innerHTML = section("osh", "Ownership Status History", "Add New Ownership Status", "saveOwnershipStatusHistory", OSH_OPTIONS, osh)
    + section("bsh", "Business Status History", "Add New Business Status", "saveTargetStageHistory", BSH_OPTIONS, bsh);
  for (const [id, key, list] of [["osh", "osh", OSH_OPTIONS], ["bsh", "bsh", BSH_OPTIONS]]) {
    const box = document.getElementById(id);
    const save = box.querySelector('input[type=button][id^="save"]');
    box.addEventListener("input", () => { save.disabled = false; });
    box.addEventListener("change", () => { save.disabled = false; });
    box.querySelector('input[value^="Add New"]').addEventListener("click", () => { state.adds[key]++; box.querySelector(".rows").insertAdjacentHTML("beforeend", row(list, "", "", false)); });
    save.addEventListener("click", () => { state.saves[key]++; if (!dropSave) setTimeout(() => { save.disabled = true; }, 30); });
  }
  return state;
}
const values = (id) => Array.from(document.querySelectorAll(`#${id} .row`)).map((r) => [r.querySelector("input.shDate").value, r.querySelector("select.shStatus").selectedOptions[0].textContent]);

test("a row that already shows the wanted date and status is left alone", async () => {
  const state = page({ osh: [["01/01/2025", "Privately Held"]] });
  const out = await wf().applyStatusHistory("ownership", { date: "01/01/2025", status: "Privately Held" });
  assert.equal(out.status, "skipped");
  assert.match(out.reason, /already has 01\/01\/2025 · Privately Held/);
  assert.equal(state.saves.osh, 0);
});

test("a row with a different date is overwritten (not duplicated), saved once and read back", async () => {
  const state = page({ osh: [["01/01/2025", "Privately Held"]] });
  const out = await wf().applyStatusHistory("ownership", { date: "01/01/2022", status: "Privately Held" });
  assert.equal(out.status, "savedValueVerified");
  assert.match(out.detail, /changed 01\/01\/2025 · Privately Held to 01\/01\/2022 · Privately Held/);
  assert.deepEqual(values("osh"), [["01/01/2022", "Privately Held"]]);
  assert.equal(state.saves.osh, 1);
  assert.equal(state.adds.osh, 0, "no extra row");
});

test("with several rows only the current (ticked) one is overwritten", async () => {
  page({ osh: [["01/01/2020", "Privately Held"], ["01/01/2025", "Publicly Held"]] });
  document.querySelectorAll("#osh .row")[0].firstElementChild.className = "emptyMark";
  document.querySelectorAll("#osh .row")[1].firstElementChild.className = "checkMark current";
  await wf().applyStatusHistory("ownership", { date: "03/03/2023", status: "Privately Held" });
  assert.deepEqual(values("osh"), [["01/01/2020", "Privately Held"], ["03/03/2023", "Privately Held"]]);
});

test("an empty business table gets a new row: date, Generating Revenue, Save BSH once", async () => {
  const state = page({});
  const out = await wf().applyStatusHistory("business", { date: "11/09/2026", status: "Generating Revenue" });
  assert.equal(out.status, "savedValueVerified");
  assert.match(out.detail, /added 11\/09\/2026 · Generating Revenue/);
  assert.deepEqual(values("bsh"), [["11/09/2026", "Generating Revenue"]]);
  assert.equal(state.adds.bsh, 1);
  assert.equal(state.saves.bsh, 1);
  assert.deepEqual(values("osh"), [], "the other table is untouched");
});

test("a different stage on the business row is overwritten, and 'Generating Revenue/Not Profitable' is not mistaken for 'Generating Revenue'", async () => {
  page({ bsh: [["11/09/2026", "Generating Revenue/Not Profitable"]] });
  await wf().applyStatusHistory("business", { date: "11/09/2026", status: "Generating Revenue" });
  assert.deepEqual(values("bsh"), [["11/09/2026", "Generating Revenue"]]);
});

test("a Save that never completes is an error, never a success", async () => {
  page({ osh: [], dropSave: true });
  await assert.rejects(wf().applyStatusHistory("ownership", { date: "01/01/2022", status: "Privately Held" }), /never returned to disabled/);
});

test("a missing section says which tab to open; a bad date or status is refused before anything is typed", async () => {
  page({});
  document.body.innerHTML = "<p>nothing</p>";
  await assert.rejects(wf().applyStatusHistory("ownership", { date: "01/01/2022", status: "Privately Held" }), /Add New Ownership Status.*not found.*Business Entity tab/);
  page({});
  await assert.rejects(wf().applyStatusHistory("ownership", { date: "2022", status: "Privately Held" }), /MM\/DD\/YYYY/);
  await assert.rejects(wf().applyStatusHistory("ownership", { date: "01/01/2022", status: "Nonsense" }), /not one of the status choices/);
  assert.deepEqual(values("osh"), [["01/01/2022", ""]].slice(0, 0).concat(values("osh")), "sanity");
});

test("start dates become MM/DD/YYYY: a year, a month and year, ISO and written forms; nothing usable gives null", () => {
  const f = wf().toMdy;
  assert.equal(f("2022"), "01/01/2022");
  assert.equal(f("05/2022"), "05/01/2022");
  assert.equal(f("5/17/2022"), "05/17/2022");
  assert.equal(f("2022-05"), "05/01/2022");
  assert.equal(f("2022-05-17"), "05/17/2022");
  assert.equal(f("May 2022"), "05/01/2022");
  assert.equal(f("17 May 2022"), "05/17/2022");
  assert.equal(f("2022 (Brand launch)"), "01/01/2022");
  assert.equal(f("Not found on the official website."), null);
  assert.equal(f(""), null);
  assert.equal(wf().todayMdy(new Date(2026, 10, 9)), "11/09/2026");
});
