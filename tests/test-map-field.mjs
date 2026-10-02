// "Map this field": a report value with no native RTS workflow is tied to an RTS
// field from the preview row, then published and read back.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/rovoContract.js";
import "../core/rovoText.js";
import "../core/schema.js";
import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/cache.js";
import "../core/stateMachine.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../core/resultsSummary.js";
import "../core/customFields.js";
import "../core/outputRules.js";
import "../core/outputFields.js";
import "../core/selectorBuilder.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/promptBuilder.js";
import "../core/executionPlan.js";
import "../core/workflows/businessEntityNameVariations.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/workflows/companySic.js";
import "../core/workflows/customField.js";
import "../content/ui.js";
import "../content/teach.js";
import "../content/rules.js";
import "../content/panel.js";
import { TEXT_SAMPLE } from "./helpers/rovo-text-sample.mjs";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return true; await tick(25); }
  return false;
}

function setup() {
  const dom = new JSDOM(`<!doctype html><body>
    <span class="flat-button__caption-x1">PBID: PB-1</span>
    <textarea id="briefDesc"></textarea>
    <button id="saveDesc" disabled>Save</button>
    <div id="smi"><div class="smiRow"><select class="net"><option value="">--</option><option value="FB">Facebook</option><option value="IG">Instagram</option></select><input class="handle"></div></div>
    <button id="addSmi" type="button">Add</button>
    <button id="saveSmi" disabled>Save</button>
  </body>`, { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent, MouseEvent: window.MouseEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const store = new Map();
  global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } } };

  const doc = window.document;
  const enable = (id) => () => { doc.getElementById(id).disabled = false; };
  doc.getElementById("briefDesc").addEventListener("input", enable("saveDesc"));
  doc.getElementById("saveDesc").addEventListener("click", () => setTimeout(() => { doc.getElementById("saveDesc").disabled = true; }, 30));
  const wire = (row) => { for (const c of row.querySelectorAll("select, input")) { c.addEventListener("input", enable("saveSmi")); c.addEventListener("change", enable("saveSmi")); } };
  wire(doc.querySelector(".smiRow"));
  doc.getElementById("addSmi").addEventListener("click", () => {
    const row = doc.createElement("div"); row.className = "smiRow";
    row.innerHTML = '<select class="net"><option value="">--</option><option value="FB">Facebook</option><option value="IG">Instagram</option></select><input class="handle">';
    doc.getElementById("smi").appendChild(row); wire(row);
  });
  doc.getElementById("saveSmi").addEventListener("click", () => setTimeout(() => { doc.getElementById("saveSmi").disabled = true; }, 30));

  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { doc, shadow };
}

const btn = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
function pickOnPage(doc, selector) {
  const target = doc.querySelector(selector);
  doc.elementFromPoint = () => target;
  const overlay = Array.from(document.querySelectorAll("div")).map((d) => d.shadowRoot?.querySelector(".teach-overlay")).find(Boolean);
  overlay.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
}
const cardFor = (shadow, path) => Array.from(shadow.querySelectorAll(".action-card")).filter((c) => c.querySelector(".action-card-field").textContent.startsWith(path));

async function publishOnly(shadow, path) {
  for (const card of shadow.querySelectorAll(".action-card")) {
    const box = card.querySelector("input[type=checkbox]");
    if (box && !box.disabled) box.checked = card.querySelector(".action-card-field").textContent.startsWith(path);
  }
  btn(shadow, "Publish selected to RTS").click();
  assert.ok(await until(() => /Published \d/.test(shadow.textContent)), "publish finished");
}

test("waiting rows offer 'Map this field' with an explanation; native rows do not", async () => {
  const { shadow } = setup();
  await tick();
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  btn(shadow, "Validate JSON").click();
  const desc = cardFor(shadow, "company.briefDescription")[0];
  assert.equal(desc.querySelector(".badge").textContent, "waiting for RTS evidence");
  const map = desc.querySelector("button.map");
  assert.ok(map);
  assert.match(map.getAttribute("data-tip"), /Teach the extension where "Brief description" goes in RTS/);
  assert.equal(cardFor(shadow, "businessEntity.websiteAddresses")[0].querySelector("button.map"), null, "native fields have no map button");
  assert.ok(shadow.querySelector(".group-title.waiting"), "waiting group heading");
  assert.ok(shadow.querySelector(".group-title.ready"), "ready group heading");
  for (const path of ["extras.address", "extras.startDate", "extras.management", "extras.industryCode"]) assert.ok(cardFor(shadow, path)[0]?.querySelector("button.map"), path);
});

test("map a single field from its row: guided dialog shows what the agent found, then it is published and read back", async () => {
  const { doc, shadow } = setup();
  await tick();
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  btn(shadow, "Validate JSON").click();

  cardFor(shadow, "company.briefDescription")[0].querySelector("button.map").click();
  const modal = shadow.querySelector(".teach-card");
  assert.match(modal.querySelector("h2").textContent, /Map "Brief description" to RTS/);
  assert.match(modal.textContent, /The agent found: Designer of streetwear apparel/);
  assert.match(modal.textContent, /How this works/);
  assert.match(btn(modal, "Pick field on page").getAttribute("data-tip"), /outlined in orange/);

  btn(modal, "Pick field on page").click();
  pickOnPage(doc, "#briefDesc"); await tick();
  btn(modal, "Pick Save button").click();
  pickOnPage(doc, "#saveDesc"); await tick();
  assert.equal(modal.querySelectorAll(".teach-guide li.done").length, 2, "steps 2 and 3 are ticked");
  btn(modal, "Save mapping").click();
  await tick(); await tick();

  assert.equal(globalThis.SXRTS.customFields.getBoundDef("company.briefDescription").label, "Brief description");
  assert.ok(!shadow.querySelector(".teach-modal").classList.contains("open"), "dialog closes after mapping so the preview is reachable");
  assert.match(shadow.textContent, /Mapped "Brief description"\. It is now in "Ready to publish" below\./);
  const card = cardFor(shadow, "company.briefDescription")[0];
  assert.equal(card.querySelector(".badge").textContent, "pending", "now runnable");
  assert.match(card.querySelector(".action-card-area").textContent, /^Mapped field · Brief description/);
  assert.equal(card.querySelector("button.map"), null);

  await publishOnly(shadow, "company.briefDescription");
  assert.match(doc.getElementById("briefDesc").value, /^Designer of streetwear apparel intended for individual consumers/);
  assert.equal(doc.getElementById("saveDesc").disabled, true);
  assert.match(shadow.textContent, /Published 1, skipped 0, failed 0/);
});

test("map a repeatable record (Add -> network + handle -> Save): both social handles are written and verified", async () => {
  const { doc, shadow } = setup();
  await tick();
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  btn(shadow, "Validate JSON").click();

  cardFor(shadow, "businessEntity.socialMediaIdentifiers")[0].querySelector("button.map").click();
  const modal = shadow.querySelector(".teach-card");
  assert.match(modal.textContent, /facebook\.com\/psyphergames/);
  btn(modal, "Pick Add button").click();
  pickOnPage(doc, "#addSmi"); await tick();
  btn(modal, "Pick an input").click();
  pickOnPage(doc, ".smiRow select.net"); await tick();
  btn(modal, "Pick an input").click();
  pickOnPage(doc, ".smiRow input.handle"); await tick();

  const mapSelects = Array.from(modal.querySelectorAll("select"));
  assert.equal(mapSelects.length, 2, "each picked input asks which agent value goes into it");
  assert.deepEqual(mapSelects.map((s) => s.value), ["network", "handleOrUrl"]);

  btn(modal, "Pick Save button").click();
  pickOnPage(doc, "#saveSmi"); await tick();
  btn(modal, "Save mapping").click();
  await tick(); await tick();

  const cards = cardFor(shadow, "businessEntity.socialMediaIdentifiers");
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.querySelector(".badge").textContent === "pending"));

  await publishOnly(shadow, "businessEntity.socialMediaIdentifiers");
  const rows = Array.from(doc.querySelectorAll(".smiRow")).slice(1);
  assert.deepEqual(rows.map((r) => [r.querySelector("select").selectedOptions[0].textContent, r.querySelector("input").value]), [
    ["Facebook", "https://www.facebook.com/psyphergames"], ["Instagram", "https://www.instagram.com/psyphergames/"]
  ]);
  assert.match(shadow.textContent, /Published 2, skipped 0, failed 0/);
});

test("a mapping combined with an output rule writes the rule's value", async () => {
  const { doc, shadow } = setup();
  await tick();
  await globalThis.SXRTS.outputRules.saveRule({ label: "Handle only", target: "smi.any", steps: [{ type: "lastPathSegment" }] });
  await globalThis.SXRTS.customFields.saveDefinition({
    key: "businessEntitySocialMediaIdentifiers", label: "Social media identifiers", description: "", kind: "record",
    fields: [{ key: "network", kind: "select", selectors: ["select.net"], options: [{ label: "Facebook", value: "FB" }, { label: "Instagram", value: "IG" }] }, { key: "handle", kind: "text", selectors: ["input.handle"] }],
    addButton: { selectors: ["#addSmi"], text: "Add" }, saveButton: { selectors: ["#saveSmi"], text: "Save" },
    binds: { path: "businessEntity.socialMediaIdentifiers", map: { network: "network", handle: "handleOrUrl" } }
  });
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  btn(shadow, "Validate JSON").click();
  await publishOnly(shadow, "businessEntity.socialMediaIdentifiers");
  const rows = Array.from(doc.querySelectorAll(".smiRow")).slice(1);
  assert.deepEqual(rows.map((r) => r.querySelector("input").value), ["psyphergames", "psyphergames"]);
  await globalThis.SXRTS.outputRules.removeRule(globalThis.SXRTS.outputRules.getCached()[0].id);
});

test("a mapped dropdown value the page doesn't offer is caught before anything is written", async () => {
  const { doc, shadow } = setup();
  await tick();
  await globalThis.SXRTS.customFields.saveDefinition({
    key: "extrasStartDate", label: "Start date", description: "", kind: "single",
    fields: [{ key: "value", kind: "select", selectors: ["select.net"], options: [{ label: "2020", value: "Y20" }] }],
    saveButton: { selectors: ["#saveSmi"], text: "Save" }, binds: { path: "extras.startDate", map: { value: "value" } }
  });
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  btn(shadow, "Validate JSON").click();
  await publishOnly(shadow, "extras.startDate");
  assert.match(shadow.textContent, /is not a supported value\. Supported: 2020/);
  assert.match(shadow.textContent, /Published 0, skipped 0, failed 1/);
  assert.equal(doc.querySelector("select.net").value, "");
});

test("validation result is structured: a verdict banner plus one coloured line per finding", async () => {
  const { shadow } = setup();
  await tick();
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  btn(shadow, "Validate JSON").click();
  assert.match(shadow.querySelector(".verdict.ok").textContent, /Valid/);
  assert.ok(shadow.querySelectorAll(".issue.warn").length >= 2);
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE.replace("* Total Rounds Found: 0", "* Total Rounds Found: 2");
  btn(shadow, "Validate JSON").click();
  assert.match(shadow.querySelector(".verdict.bad").textContent, /problem/);
  assert.match(shadow.querySelector(".issue.err .chip").textContent, /TIMELINE_COUNT_MISMATCH/);
});

test("branding: header and footer name the developer; the prompt carries the checklist; hover help is wired", async () => {
  const { shadow } = setup();
  await tick();
  assert.match(shadow.querySelector(".head").textContent, /ScraperX/);
  assert.match(shadow.querySelector(".head .by").textContent, /Developed by Abhishek Tawte/);
  assert.match(shadow.querySelector(".foot").textContent, /Developed by Abhishek Tawte/);
  assert.ok(shadow.querySelectorAll("[data-tip]").length >= 8, "buttons carry hover help");
  const bubble = shadow.querySelector(".sx-tip");
  assert.ok(bubble, "tooltip bubble installed");
  const copy = btn(shadow, "Copy prompt");
  copy.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  assert.match(bubble.textContent, /Copies the target domain/);
  assert.ok(bubble.classList.contains("show"));
});
