// The statuses every profile gets: Financing = Corporation, Research = Does Not Qualify…, Publish = Publish, Ownership
// (start date, Privately Held) and Business (today, Generating Revenue) history. They come from the extension, not the prompt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../registry/businessEntity.general.js";
import "../registry/index.js";
import "../core/outputFields.js";
import "../core/resultsSummary.js";
import "../core/executionPlan.js";
import "../core/workflows/statusHistory.js";
import "../core/workflows/businessEntityGeneral.js";
import { statusControlsHtml } from "./helpers/status-controls.mjs";

const plan = (doc) => globalThis.SXRTS.executionPlan.buildExecutionPlan(doc);
const rowFor = (actions, path) => actions.find((a) => a.jsonPath === path);

test("every plan carries the five statuses, overwriting whatever is there, with the values the team chose", () => {
  const actions = plan({ profileIdentity: { companyName: "A", domain: "a.com" } });
  const v = (path) => rowFor(actions, path).proposedValue;
  assert.equal(v("businessEntity.financingStatus").value, "Corporation");
  assert.equal(v("businessEntity.researchStatus").value, "Does Not Qualify for Meth./Not Act. Tracked");
  assert.equal(v("businessEntity.publishStatus").value, "Publish");
  for (const path of ["businessEntity.financingStatus", "businessEntity.researchStatus", "businessEntity.publishStatus"]) {
    assert.equal(v(path).action, "replaceAfterConfirmation");
    assert.equal(rowFor(actions, path).executionStatus, "pending");
    assert.equal(rowFor(actions, path).always, true);
  }
  assert.equal(v("businessEntity.businessStatus").value, "Generating Revenue");
  assert.match(v("businessEntity.businessStatus").date, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(v("businessEntity.businessStatus").date, globalThis.SXRTS.workflows.statusHistory.todayMdy());
});

test("the ownership row takes the start date the report found, as MM/DD/YYYY; without one it is shown as skipped, with the reason", () => {
  const withDate = plan({ profileIdentity: { companyName: "A", domain: "a.com" }, extras: { startDate: { value: "2022", action: "addIfMissing" } } });
  const own = rowFor(withDate, "businessEntity.ownershipStatus");
  assert.deepEqual([own.proposedValue.value, own.proposedValue.date, own.executionStatus], ["Privately Held", "01/01/2022", "pending"]);
  const without = plan({ profileIdentity: { companyName: "A", domain: "a.com" } });
  const skipped = rowFor(without, "businessEntity.ownershipStatus");
  assert.equal(skipped.executionStatus, "skipped");
  assert.match(skipped.skipReason, /No start date was found/);
});

function page(options) {
  const dom = new JSDOM(`<!doctype html><body>${statusControlsHtml(options)}<input type="button" id="saveBusinessEntityButton" disabled></body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const save = document.getElementById("saveBusinessEntityButton");
  for (const sel of document.querySelectorAll("select")) sel.addEventListener("change", () => { save.disabled = false; });
  save.addEventListener("click", () => { setTimeout(() => { save.disabled = true; }, 20); });
  return save;
}
const shown = (sel) => document.querySelector(sel).selectedOptions[0].textContent;

test("a drop-down that shows something else is overwritten, the three are saved with ONE press, and what changed is reported", async () => {
  let presses = 0;
  const save = page({ financing: "Angel-Backed", research: "ProxyCurl Automated", publish: "Do Not Publish" });
  save.addEventListener("click", () => { presses++; });
  const out = await globalThis.SXRTS.workflows.businessEntityGeneral.applyBusinessEntityGeneral({
    financingStatus: { value: "Corporation", action: "replaceAfterConfirmation" },
    researchStatus: { value: "Does Not Qualify for Meth./Not Act. Tracked", action: "replaceAfterConfirmation" },
    publishStatus: { value: "Publish", action: "replaceAfterConfirmation" }
  });
  assert.equal(out.status, "savedValueVerified");
  assert.equal(presses, 1, "one Save for all three");
  assert.deepEqual([shown('select[name="company.financingStatus.id"]'), shown("#companyResearchStatus"), shown("select.profile-publish-status")], ["Corporation", "Does Not Qualify for Meth./Not Act. Tracked", "Publish"]);
  assert.match(out.results.researchStatus.detail, /Research status changed from "ProxyCurl Automated" to "Does Not Qualify for Meth\.\/Not Act\. Tracked"/);
});

test("a drop-down that already shows the wanted value is left alone: nothing is saved", async () => {
  let presses = 0;
  const save = page({});
  save.addEventListener("click", () => { presses++; });
  const out = await globalThis.SXRTS.workflows.businessEntityGeneral.applyBusinessEntityGeneral({ publishStatus: { value: "Publish", action: "replaceAfterConfirmation" } });
  assert.equal(out.status, "skipped");
  assert.match(out.results.publishStatus.reason, /Publish Status already equals "Publish"/);
  assert.equal(presses, 0);
});

test("a missing drop-down or a value RTS does not offer is an error that says what to do", async () => {
  page({});
  document.getElementById("companyResearchStatus").remove();
  const missing = await globalThis.SXRTS.workflows.businessEntityGeneral.applyBusinessEntityGeneral({ researchStatus: { value: "Anything", action: "replaceAfterConfirmation" } });
  assert.match(missing.results.researchStatus.reason, /Research Status dropdown was not found.*Business Entity tab/);
  page({});
  const wrong = await globalThis.SXRTS.workflows.businessEntityGeneral.applyBusinessEntityGeneral({ publishStatus: { value: "Nonsense", action: "replaceAfterConfirmation" } });
  assert.match(wrong.results.publishStatus.reason, /not one of the dropdown's choices/);
});

test("a start date that names a day is typed as MM/DD/YYYY; a year or month and year stay as written", () => {
  const f = globalThis.SXRTS.workflows.statusHistory.startDateText;
  assert.deepEqual(["12 Apr 2025", "Apr 12, 2025", "2025-04-12", "2025", "05/2022"].map(f), ["04/12/2025", "04/12/2025", "04/12/2025", "2025", "05/2022"]);
});

test("the result a researcher sees is short and plain: one headline, only what needs a look, no ticks, crosses or codes; the old list is folded under 'Details'", async () => {
  await import("../core/resultsSummary.js");
  const rs = globalThis.SXRTS.resultsSummary;
  const clean = rs.buildSummary({ "company.keywords": { status: "savedValueVerified", name: "k" }, "company.briefDescription": { status: "skipped", reason: "duplicate", detail: "already equals x" } });
  assert.match(clean.html, /All done · 2 saved/);
  assert.doesNotMatch(clean.html.split("<details")[0], /✗|✓|needs attention/i, "nothing alarming above the folded details");
  const mixed = rs.buildSummary({
    "company.keywords": { status: "savedValueVerified" },
    "extras.startDate": { status: "error", error: "Save did not complete for Start date: the saved value no longer matches." },
    "businessEntity.websiteAddresses": { status: "error", error: "Website Address field was not found." },
    "extras.employeeCount": { status: "error", error: "The Save button for Employee count is disabled; the change was not registered by the page." }
  });
  const top = mixed.html.split("<details")[0];
  assert.match(top, /1 done · 3 to look at/);
  assert.match(top, /Start date<\/b>: saved, but please check it in RTS/);
  assert.match(top, /Website address<\/b>: could not find this box on the page/);
  assert.match(top, /Employee count<\/b>: RTS did not accept it/);
  assert.doesNotMatch(top, /Save did not complete|disabled|✗/, "no technical text for the researcher");
  assert.match(mixed.html, /Details \(for the developer\)/);
  assert.match(mixed.html, /Needs attention 3/, "the exact numbers and messages are still there, folded");
});
