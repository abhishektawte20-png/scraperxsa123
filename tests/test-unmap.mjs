// Unmapping: delete your own mapping, hide a team mapping on this browser, restore it, and the buttons that do it.

import assert from "node:assert/strict";
import { test } from "node:test";
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
import "../content/teach.js";
import "../content/ui.js";
import "../content/panel.js";

const cf = () => globalThis.SXRTS.customFields;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const mapping = (key, path, label = key) => ({ key, label, description: "", kind: "single", fields: [{ key: "value", label: "v", description: "", kind: "text", selectors: ["#box"] }], saveButton: { selectors: ["#save"], text: "Save" }, binds: { path, map: { value: "value" } } });

function freshStore() {
  const store = new Map();
  global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: JSON.parse(JSON.stringify(store.get(k))) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, JSON.parse(JSON.stringify(v))); }, async remove(k) { store.delete(k); } } } };
  return store;
}

test("a team mapping is unmapped on this browser only, stays unmapped after a reload, and can be restored", async () => {
  freshStore();
  globalThis.SXRTS.teamDefaults = { mappings: [mapping("companyBriefDescription", "company.briefDescription", "Brief description"), mapping("extrasStartDate", "extras.startDate", "Start date")] };
  await cf().load();
  assert.deepEqual(cf().getCached().map((d) => d.key), ["companyBriefDescription", "extrasStartDate"]);

  const result = await cf().unmap("companyBriefDescription");
  assert.deepEqual(result, { removed: true, hidTeamMapping: true });
  assert.deepEqual(cf().getCached().map((d) => d.key), ["extrasStartDate"]);
  assert.equal(cf().getBoundDef("company.briefDescription"), null, "the field is unmapped: it is not published");
  assert.deepEqual(cf().getHidden().map((d) => d.label), ["Brief description"]);
  assert.ok(!cf().exportable().some((d) => d.key === "companyBriefDescription"), "not shared as a team default either");

  await cf().load(); // a new page: the marker was stored
  assert.deepEqual(cf().getCached().map((d) => d.key), ["extrasStartDate"]);

  assert.equal(await cf().restoreHidden("companyBriefDescription"), 1);
  assert.deepEqual(cf().getCached().map((d) => d.key).sort(), ["companyBriefDescription", "extrasStartDate"]);
  assert.equal(cf().getHidden().length, 0);
});

test("your own mapping is deleted; one that replaced a team mapping hides both, and Reset to team defaults brings the team's back", async () => {
  freshStore();
  globalThis.SXRTS.teamDefaults = { mappings: [mapping("extrasStartDate", "extras.startDate", "Start date")] };
  await cf().load();
  await cf().saveDefinition({ ...mapping("myStart", "extras.startDate", "Start date (mine)") });
  assert.equal(cf().getBoundDef("extras.startDate").key, "myStart");
  assert.deepEqual(await cf().unmap("myStart"), { removed: true, hidTeamMapping: true });
  assert.equal(cf().getBoundDef("extras.startDate"), null, "neither mine nor the team's is used");
  assert.equal(await cf().resetToTeam() >= 1, true);
  assert.equal(cf().getBoundDef("extras.startDate").key, "extrasStartDate");

  await cf().saveDefinition(mapping("onlyMine", "extras.fax", "Fax"));
  assert.deepEqual(await cf().unmap("onlyMine"), { removed: true, hidTeamMapping: false });
  assert.equal(cf().getBoundDef("extras.fax"), null);
  assert.deepEqual(await cf().unmap("doesNotExist"), { removed: false });
});

test("mapping a field again after it was unmapped works, and the marker is gone", async () => {
  freshStore();
  globalThis.SXRTS.teamDefaults = { mappings: [mapping("extrasStartDate", "extras.startDate", "Start date")] };
  await cf().load();
  await cf().unmap("extrasStartDate");
  assert.equal(cf().getBoundDef("extras.startDate"), null);
  await cf().saveDefinition(mapping("extrasStartDate", "extras.startDate", "Start date (new)"));
  assert.equal(cf().getBoundDef("extras.startDate").label, "Start date (new)");
  assert.equal(cf().getHidden().length, 0);
  await cf().load();
  assert.equal(cf().getBoundDef("extras.startDate").label, "Start date (new)");
});

function setupPanel() {
  const dom = new JSDOM(`<!doctype html><body><span class="flat-button__caption-x1">PBID: PB-1</span></body>`, { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent, MouseEvent: window.MouseEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return shadow;
}
const byText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);

test("the mapped-fields list has an Unmap button for a team mapping and a Restore button for it afterwards", async () => {
  freshStore();
  globalThis.SXRTS.teamDefaults = { mappings: [mapping("extrasStartDate", "extras.startDate", "Start date")] };
  const shadow = setupPanel();
  await cf().load();
  byText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  assert.match(card.textContent, /Start date/);
  const inItem = (text, label) => byText(Array.from(card.querySelectorAll(".teach-item")).find((i) => i.textContent.includes(text)), label);
  inItem("Start date", "Unmap").click();
  await tick(20);
  assert.doesNotMatch(card.textContent, /Start date {2}·/);
  assert.match(card.textContent, /Unmapped team mappings \(1\)/);
  Array.from(card.querySelectorAll(".teach-row")).find((r) => r.textContent.startsWith("Start date")).querySelector("button").click();
  await tick(20);
  assert.match(card.textContent, /Start date/);
  assert.equal(cf().getBoundDef("extras.startDate").key, "extrasStartDate");
});

test("a mapped field's card in the preview has an Unmap button that stops it being published", async () => {
  freshStore();
  globalThis.SXRTS.teamDefaults = { mappings: [mapping("extrasStartDate", "extras.startDate", "Start date")] };
  const shadow = setupPanel();
  await cf().load();
  const { TEXT_SAMPLE } = await import("./helpers/rovo-text-sample.mjs");
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  byText(shadow, "Validate JSON").click();
  await tick(50);
  const startCard = () => Array.from(shadow.querySelectorAll(".action-card")).find((c) => /extras\.startDate/.test(c.querySelector(".action-card-field").textContent));
  assert.equal(startCard().querySelector(".badge").textContent, "pending");
  byText(startCard(), "Unmap").click();
  await tick(80);
  assert.notEqual(startCard().querySelector(".badge").textContent, "pending", "no longer ready to publish");
  assert.ok(startCard().querySelector("button.map"), "it can be mapped again");
});

const REPORT = (await import("./helpers/rovo-text-sample.mjs")).TEXT_SAMPLE.replace(/\* Address: Borivali[^\n]*\n[^\n]*\n/, "* Address: 12600 Crystal View Blvd.\n   * Source: https://www.psypher.in/\n* City: Texas City\n   * Source: https://www.psypher.in/\n* Country: USA\n   * Source: https://www.psypher.in/\n");

test("the built-in Site has Unmap on its cards: it switches the Site off (cards wait for a mapping), and Restore Site switches it back on", async () => {
  freshStore();
  globalThis.SXRTS.teamDefaults = { mappings: [] };
  const shadow = setupPanel();
  await cf().load();
  await globalThis.SXRTS.workflows.companySite.setEnabled(true);
  shadow.querySelector("#sxrts-response").value = REPORT;
  byText(shadow, "Validate JSON").click();
  await tick(60);
  const cityCard = () => Array.from(shadow.querySelectorAll(".action-card")).find((c) => /extras\.city/.test(c.querySelector(".action-card-field").textContent));
  assert.equal(cityCard().querySelector(".badge").textContent, "pending", "ready to publish as part of the one site");
  assert.ok(byText(cityCard(), "Unmap Site"), "Unmap is offered on the site's cards");
  assert.ok(!byText(cityCard(), "Restore Site"));

  byText(cityCard(), "Unmap Site").click();
  await tick(120);
  assert.equal(globalThis.SXRTS.workflows.companySite.isEnabled(), false);
  assert.notEqual(cityCard().querySelector(".badge").textContent, "pending", "no longer published by the built-in Site");
  assert.ok(byText(cityCard(), "Restore Site"), "Restore is offered");
  assert.ok(!byText(cityCard(), "Unmap Site"));

  byText(cityCard(), "Restore Site").click();
  await tick(120);
  assert.equal(globalThis.SXRTS.workflows.companySite.isEnabled(), true);
  assert.equal(cityCard().querySelector(".badge").textContent, "pending");
});

test("Mapped & taught fields lists the built-in Site with Unmap, and Restore after it", async () => {
  freshStore();
  globalThis.SXRTS.teamDefaults = { mappings: [] };
  const shadow = setupPanel();
  await cf().load();
  await globalThis.SXRTS.workflows.companySite.setEnabled(true);
  byText(shadow.querySelector(".card"), "Teach new field").click();
  const card = shadow.querySelector(".teach-card");
  assert.match(card.textContent, /Site\s+·\s+built in/);
  byText(card, "Unmap").click();
  await tick(30);
  assert.equal(globalThis.SXRTS.workflows.companySite.isEnabled(), false);
  assert.match(card.textContent, /Site\s+·\s+built in\s+·\s+unmapped/);
  byText(card, "Restore").click();
  await tick(30);
  assert.equal(globalThis.SXRTS.workflows.companySite.isEnabled(), true);
});
