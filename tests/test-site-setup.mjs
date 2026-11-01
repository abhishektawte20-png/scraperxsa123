// "Set up Site": see what is found in the Site form, point at what was missed, try it without saving, then publish.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

import "../core/jsonRepair.js";
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
import "../core/navigation.js";
import "../core/resultsSummary.js";
import "../core/customFields.js";
import "../core/selectorBuilder.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/agentSpec.js";
import "../core/promptBuilder.js";
import "../core/outputFields.js";
import "../core/executionPlan.js";
import "../core/workflows/businessEntityNameVariations.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/workflows/companySic.js";
import "../core/workflows/customField.js";
import "../core/workflows/companySite.js";
import "../core/outputRules.js";
import "../core/teamShare.js";
import "../content/teach.js";
import "../content/ui.js";
import "../content/panel.js";

const pageScript = readFileSync(new URL("./helpers/site-page.js", import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const site = () => globalThis.SXRTS.workflows.companySite;
const byText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);

function setup() {
  const dom = new JSDOM(`<!doctype html><body><span class="flat-button__caption-x1">PBID: PB-1</span></body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent, MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const store = new Map();
  global.chrome = { runtime: { connect() { throw new Error("none"); } }, storage: { local: { async get(k) { return store.has(k) ? { [k]: JSON.parse(JSON.stringify(store.get(k))) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, JSON.parse(JSON.stringify(v))); }, async remove(k) { store.delete(k); } } } };
  window.eval(pageScript);
  const raw = window.installSitePage({ real: true });
  const state = new Proxy(raw, { get: (t, k) => (Array.isArray(t[k]) ? Array.from(t[k]) : t[k]) });
  Object.assign(site().TIMEOUTS, { open: 400, field: 300, settle: 600, list: 300, poll: 5, section: 300 });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { state, shadow };
}

// jsdom has no layout: the element "under the pointer" is stubbed; the click lands on the picker overlay.
function clickOnPage(selector) {
  const target = document.querySelector(selector);
  document.elementFromPoint = () => target;
  const overlay = Array.from(document.querySelectorAll("div")).map((d) => d.shadowRoot?.querySelector(".teach-overlay")).find(Boolean);
  overlay.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
}

test("Set up Site: see what is found, point at a box the extension missed, try it without saving, and then publish with it", async () => {
  const { state, shadow } = setup();
  await globalThis.SXRTS.customFields.load();
  await site().loadFlag();
  // RTS "changed": the Status dropdown has other words and another name.
  const statusRow = document.querySelector('select[name="site.siteStatus.id"]').closest("tr");
  statusRow.querySelector("td").textContent = "Estado del sitio";
  statusRow.querySelector("select").setAttribute("name", "site.estado");
  statusRow.querySelector("select").id = "estadoBox";

  byText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  byText(card, "Set up").click();
  assert.match(card.textContent, /Set up Site/);

  byText(card, "Find the Site form").click();
  await tick(400);
  assert.equal(state.opens, 1, "the button was pressed once");
  assert.match(card.textContent, /✓ Add New Site button/);
  assert.match(card.textContent, /✓ City/);
  assert.match(card.textContent, /✗ Status/, "the changed box is reported as missing");
  assert.equal(state.saves, 0);

  // Point at it.
  const statusItem = Array.from(card.querySelectorAll(".teach-item")).find((i) => /Status/.test(i.textContent) && /✗/.test(i.textContent) && !/offers/.test(i.textContent));
  Array.from(statusItem.querySelectorAll("button")).find((b) => b.textContent === "Point at it").click();
  assert.ok(shadow.querySelector(".teach-bar"), "the picker is on");
  clickOnPage("#estadoBox");
  await tick(400);
  assert.match(card.textContent, /✓ Status/);
  assert.deepEqual(site().getSetup().roles.status.selectors.length > 0, true);

  // Try it: everything up to SAVE, then the form is put away.
  byText(card, "Try it (nothing is saved)").click();
  for (let i = 0; i < 60 && !/Nothing was saved/.test(card.textContent); i++) await tick(100);
  assert.match(card.textContent, /The whole form can be filled\. Nothing was saved\./);
  assert.match(card.textContent, /SAVE|every box read back/);
  assert.equal(state.saves, 0);
  assert.equal(document.getElementById("siteForm").style.display, "none");

  // A real run uses what was pointed at: one open, one save.
  const result = await site().applySite({ city: "Texas City", country: "United States", state: "Texas", address1: "12600 Crystal View Blvd." });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.saves, 1);
  assert.equal(state.lastForm.status, "Current");
  await site().setSetup(null);
});

test("pointing at something that is not a box is refused with the reason, and 'Forget what I pointed at' goes back to the extension's guesses", async () => {
  const { shadow } = setup();
  await globalThis.SXRTS.customFields.load();
  await site().loadFlag();
  byText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  byText(card, "Set up").click();
  byText(card, "Find the Site form").click();
  await tick(400);
  const cityItem = Array.from(card.querySelectorAll(".teach-item")).find((i) => /City/.test(i.textContent) && /✓/.test(i.textContent));
  Array.from(cityItem.querySelectorAll("button")).find((b) => b.textContent === "Point again").click();
  clickOnPage("#siteContent h1, #sites");
  await tick(50);
  assert.match(card.textContent, /That is not a box or a dropdown/);
  // point at the right one, then forget
  Array.from(Array.from(card.querySelectorAll(".teach-item")).find((i) => /City/.test(i.textContent) && /✓/.test(i.textContent)).querySelectorAll("button")).find((b) => b.textContent === "Point again").click();
  clickOnPage('input[name="site.city"]');
  await tick(400);
  assert.ok(site().getSetup()?.roles?.city);
  byText(card, "Forget what I pointed at").click();
  await tick(30);
  assert.equal(site().getSetup(), null);
});

test("the Site cards have a Set up Site button that opens the same window", async () => {
  const { shadow } = setup();
  await globalThis.SXRTS.customFields.load();
  await site().loadFlag();
  await site().setEnabled(true);
  const { TEXT_SAMPLE } = await import("./helpers/rovo-text-sample.mjs");
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE.replace(/\* Address: Borivali[^\n]*\n[^\n]*\n/, "* Address: 1 Road\n   * Source: https://www.psypher.in/\n* City: Pune\n   * Source: https://www.psypher.in/\n* Country: India\n   * Source: https://www.psypher.in/\n");
  byText(shadow, "Validate JSON").click();
  await tick(60);
  const card = Array.from(shadow.querySelectorAll(".action-card")).find((c) => /extras\.city/.test(c.querySelector(".action-card-field").textContent));
  byText(card, "Set up Site").click();
  assert.match(shadow.querySelector(".teach-card").textContent, /Set up Site/);
});

test("what was pointed at travels with the team defaults: exported, and used by someone who imports it", async () => {
  setup();
  await globalThis.SXRTS.customFields.load();
  await site().loadFlag();
  await site().setSetup({ openButton: { selectors: ["#addSite"], text: "Add New Site" }, roles: { city: { selectors: ['input[name="site.city"]'] } } });
  const data = globalThis.SXRTS.teamShare.buildData();
  assert.deepEqual(data.siteSetup.roles.city.selectors, ['input[name="site.city"]']);
  const file = globalThis.SXRTS.teamShare.buildFile(data);
  assert.match(file, /"siteSetup"/);
  await site().setSetup(null);
  assert.equal(site().getSetup(), null);
  const parsed = globalThis.SXRTS.teamShare.parseFile(file);
  await globalThis.SXRTS.teamShare.importData(parsed.data);
  assert.equal(site().getSetup().openButton.text, "Add New Site");
  await site().setSetup(null);
});
