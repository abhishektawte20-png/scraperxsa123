// Company > Site: one site, one form, one SAVE; Primary HQ and Current always; site name = city.

import assert from "node:assert/strict";
import { test } from "node:test";

import { setup, site } from "./helpers/site-dialog.mjs";

const TEXAS = { city: "Texas City", country: "United States", state: "Texas", address1: "12600 Crystal View Blvd.", zip: "77568", phone: "281-941-6001", email: "info@lagoonfesttexas.com" };

test("a collapsed Site section is opened, the form is filled once with Primary HQ and Current, saved once, and read back", async () => {
  const { state, doc } = setup();
  const result = await site.applySite(TEXAS);
  assert.deepEqual([result.status, result.name], ["savedValueVerified", "Texas City"]);
  assert.equal(state.saves, 1);
  assert.equal(state.opens, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(state.lastForm)), { name: "Texas City", type: "Primary HQ", address1: "12600 Crystal View Blvd.", city: "Texas City", country: "United States", state: "Texas", zip: "77568", phone: "281-941-6001", fax: "", email: "info@lagoonfesttexas.com", status: "Current" });
  assert.equal(doc.getElementById("siteForm").style.display, "none");
});

test("the report's own site type and status are ignored: it is always Primary HQ and Current", async () => {
  const { state } = setup();
  await site.applySite({ ...TEXAS, siteType: "Regional Office", status: "Former" });
  assert.deepEqual([state.lastForm.type, state.lastForm.status], ["Primary HQ", "Current"]);
});

test("boxes are found by the text printed next to them when the page gives them no names", async () => {
  const { state } = setup({ labelsOnly: true });
  const result = await site.applySite(TEXAS);
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.lastForm.city, "Texas City");
  assert.equal(state.lastForm.zip, "77568");
});

test("a state abbreviation and a country alias are understood", async () => {
  const { state } = setup();
  await site.applySite({ ...TEXAS, state: "TX", country: "USA" });
  assert.deepEqual([state.lastForm.state, state.lastForm.country], ["Texas", "United States"]);
});

test("outside the US the state goes into the text box that replaces the list", async () => {
  const { state } = setup();
  const result = await site.applySite({ city: "Pune", country: "India", state: "Maharashtra", address1: "1 MG Road" });
  assert.equal(result.status, "savedValueVerified");
  assert.deepEqual([state.lastForm.country, state.lastForm.state], ["India", "Maharashtra"]);
});

test("a site that is already listed (same address line) is not added again: reported as already in RTS", async () => {
  const { state } = setup({ existing: [{ name: "Texas City", address1: "12600 Crystal View Blvd.", city: "Texas City" }] });
  const result = await site.applySite(TEXAS);
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /already exists/i);
  assert.equal(state.opens, 0, "the form was never opened");
  assert.equal(state.saves, 0);
});

test("with no address line, the same city counts as the same site", async () => {
  const { state } = setup({ existing: [{ name: "Pune", address1: "", city: "Pune" }] });
  const result = await site.applySite({ city: "Pune", country: "India" });
  assert.equal(result.status, "skipped");
  assert.equal(state.saves, 0);
});

test("'add anyway' adds the site even though one is listed", async () => {
  const { state } = setup({ existing: [{ name: "Texas City", address1: "12600 Crystal View Blvd.", city: "Texas City" }] });
  const result = await site.applySite(TEXAS, { addAnyway: true });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.saves, 1);
});

test("a different address in the same city is a new site", async () => {
  const { state } = setup({ existing: [{ name: "Texas City", address1: "1 Old Road", city: "Texas City" }] });
  assert.equal((await site.applySite(TEXAS)).status, "savedValueVerified");
  assert.equal(state.sites.length, 2);
});

test("a section that is already open is left open", async () => {
  const { state } = setup({ collapsed: false });
  await site.applySite(TEXAS);
  assert.equal(state.barClicks, 0);
});

test("when the Company tab is not showing, it is opened first", async () => {
  const { state } = setup({ otherTab: true });
  const result = await site.applySite(TEXAS);
  assert.equal(result.status, "savedValueVerified");
  assert.ok(state.tabClicks >= 1);
});

test("no city or no country is a plain failure and nothing is opened", async () => {
  const { state } = setup();
  const result = await site.applySite({ address1: "1 Road", country: "India" });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /city/);
  assert.equal(state.opens, 0);
});

test("a value that is not one of RTS's choices stops the run and cancels the form: nothing is saved, nothing is left open", async () => {
  const { state, doc } = setup();
  await assert.rejects(site.applySite({ ...TEXAS, country: "Atlantis" }), /"Atlantis" is not one of the dropdown's choices/);
  assert.equal(state.saves, 0);
  assert.equal(state.cancels, 1);
  assert.equal(doc.getElementById("siteForm").style.display, "none");
});

test("a SAVE that RTS does not accept is an error, never a success, and the form is cancelled", async () => {
  const { state } = setup({ rejectSave: true });
  await assert.rejects(site.applySite(TEXAS), /Save did not complete/);
  assert.equal(state.saves, 0);
  assert.equal(state.cancels, 1);
});

test("a missing Add New Site button is a clear error", async () => {
  const { doc } = setup();
  doc.getElementById("addSite").remove();
  await assert.rejects(site.applySite(TEXAS), /Site section could not be opened/);
});

// RTS's real layout: the section block holds its own title bar, and only the small icon in the bar reacts to a click.
test("the Site section is opened even when only the little icon in its title bar reacts to a click", async () => {
  const { state, doc } = setup({ real: true });
  const result = await site.applySite(TEXAS);
  assert.equal(result.status, "savedValueVerified");
  assert.ok(state.barClicks >= 1);
  assert.equal(state.saves, 1);
  assert.equal(doc.getElementById("siteContent").style.display, "", "the section is left open");
});

test("with that layout and the Company tab not showing, it still works", async () => {
  const { state } = setup({ real: true, otherTab: true });
  assert.equal((await site.applySite(TEXAS)).status, "savedValueVerified");
  assert.ok(state.tabClicks >= 1);
});

test("a section that cannot be opened is explained: what was tried, and that opening it by hand then publishing works", async () => {
  const { doc } = setup({ real: true });
  doc.getElementById("siteIcon").remove(); // nothing on the page can open the section any more
  await assert.rejects(site.applySite(TEXAS), /Site section could not be opened.*by hand/s);
});

test("the state list that loads a moment after the country is chosen is waited for", async () => {
  const { state } = setup({ slowStates: true });
  const result = await site.applySite(TEXAS);
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.lastForm.state, "Texas");
});

test("boxes the page wipes when the country changes are read back and filled again before Save", async () => {
  const { state } = setup({ wipeOnCountry: true });
  const result = await site.applySite(TEXAS);
  assert.equal(result.status, "savedValueVerified");
  assert.deepEqual([state.lastForm.zip, state.lastForm.phone], ["77568", "281-941-6001"]);
});

test("a form that stays open after a good Save (Save greyed out again) is a success, and it is put away", async () => {
  const { state, doc } = setup({ keepOpenAfterSave: true });
  const result = await site.applySite(TEXAS);
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.saves, 1);
  assert.equal(doc.getElementById("siteForm").style.display, "none", "the saved form was put away");
});

test("city, state, country and zip are taken from a full address, only for what the report left out", async () => {
  const d = site.deriveFromAddress;
  assert.deepEqual(d("12600 Crystal View Blvd., Texas City, TX 77568, United States"), { country: "United States", zip: "77568", state: "TX", city: "Texas City" });
  assert.deepEqual(d("Borivali, Borivali East, 400066 Mumbai MH, India"), { country: "India", zip: "400066", state: "MH", city: "Mumbai" });
  assert.deepEqual(d("1 Main St, Austin, Texas 78701, USA"), { country: "United States", zip: "78701", state: "Texas", city: "Austin" });
  assert.deepEqual(d("Nowhere"), {});

  const { state } = setup();
  const result = await site.applySite({ address1: "12600 Crystal View Blvd., Texas City, TX 77568, United States" });
  assert.equal(result.status, "savedValueVerified");
  assert.deepEqual([state.lastForm.city, state.lastForm.state, state.lastForm.country, state.lastForm.zip, state.lastForm.name], ["Texas City", "Texas", "United States", "77568", "Texas City"]);
  assert.match(result.derived, /taken from the address/);
  // what the report does give is never replaced
  const second = setup();
  await site.applySite({ address1: "1 Road, Elsewhere, TX 11111, United States", city: "Texas City", country: "United States", state: "Texas" });
  assert.equal(second.state.lastForm.city, "Texas City");
});

test("the built-in Site can be switched off and on, and the choice is remembered", async () => {
  const store = new Map();
  global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } } };
  assert.equal(site.isEnabled(), true);
  await site.setEnabled(false);
  assert.equal(site.isEnabled(), false);
  await site.loadFlag();
  assert.equal(site.isEnabled(), false, "remembered");
  await site.setEnabled(true);
  await site.loadFlag();
  assert.equal(site.isEnabled(), true);
});

// ---- "Set up Site": what the researcher pointed at wins; steps are named; a dry run saves nothing ----
test("a box the researcher pointed at is used instead of the built-in guess (a look-alike earlier on the page is ignored)", async () => {
  const { state, doc } = setup();
  const decoy = doc.createElement("input");
  decoy.name = "site.siteName";
  doc.getElementById("companyTab").insertBefore(decoy, doc.getElementById("companyTab").firstChild);
  await site.setSetup({ roles: { siteName: { selectors: ["#siteForm tr:nth-child(1) input"] } } });
  try {
    const result = await site.applySite(TEXAS);
    assert.equal(result.status, "savedValueVerified");
    assert.equal(state.lastForm.name, "Texas City");
    assert.equal(decoy.value, "", "the look-alike was left alone");
  } finally { await site.setSetup(null); }
});

test("the button the researcher pointed at opens the form, even when its words are different", async () => {
  const { state, doc } = setup();
  doc.getElementById("addSite").value = "Nuevo sitio";
  await assert.rejects(site.applySite(TEXAS), /Site section could not be opened/);
  await site.setSetup({ openButton: { selectors: ["#addSite"], text: "Nuevo sitio" } });
  try {
    assert.equal((await site.applySite(TEXAS)).status, "savedValueVerified");
    assert.equal(state.saves, 1);
  } finally { await site.setSetup(null); }
});

test("a failure names where it stopped: the steps that were done before it", async () => {
  setup();
  await assert.rejects(site.applySite({ ...TEXAS, country: "Atlantis" }), (error) => {
    assert.match(error.message, /"Atlantis" is not one of the dropdown's choices/);
    assert.match(error.message, /Done before this: Site section open; Add New Site pressed, form open; site name, site type\./);
    assert.ok(Array.isArray(error.trace) && error.trace.length >= 3);
    return true;
  });
});

test("a dry run goes through every step up to Save, then puts the form away: nothing is saved, even for a site that is already listed", async () => {
  const { state, doc } = setup({ existing: [{ name: "Texas City", address1: "12600 Crystal View Blvd.", city: "Texas City" }] });
  const result = await site.applySite(TEXAS, { dryRun: true });
  assert.equal(result.status, "checked");
  assert.match(result.trace.join("|"), /every box read back/);
  assert.equal(state.saves, 0);
  assert.equal(state.cancels, 1);
  assert.equal(doc.getElementById("siteForm").style.display, "none");
});

test("inspect: opens the Site section and the form, lists what is found, and leaves the form open for pointing", async () => {
  const { state, doc } = setup({ real: true });
  const { items } = await site.inspect();
  const by = (id) => items.find((i) => i.id === id);
  assert.ok(items.filter((i) => !["cancel"].includes(i.id)).every((i) => i.ok), JSON.stringify(items.filter((i) => !i.ok)));
  assert.ok(by("opener").selector, "it says how the button is found");
  assert.equal(state.opens, 1);
  assert.equal(state.saves, 0);
  assert.equal(doc.getElementById("siteForm").style.display, "", "the form is left open");
  doc.querySelector('select[name="site.siteStatus.id"]').closest("tr").remove();
  assert.equal((await site.inspect()).items.find((i) => i.id === "status").ok, false);
  assert.equal(state.opens, 1, "an open form is not opened again");
});

test("what was pointed at is remembered across page loads and can be cleared", async () => {
  const store = new Map();
  global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } } };
  await site.setSetup({ save: { selectors: ["#x"], text: "Save" } });
  await site.setSetup({ ...site.getSetup(), roles: { city: { selectors: ["#c"] } } });
  await site.loadFlag();
  assert.deepEqual(site.getSetup().roles.city.selectors, ["#c"]);
  await site.setSetup(null);
  await site.loadFlag();
  assert.equal(site.getSetup(), null);
});

test("values typed by a try-run, or by a run that failed, never end up in the next site", async () => {
  const { state } = setup();
  await site.applySite({ ...TEXAS, email: "sample@example.com", fax: "111", state: "Texas" }, { dryRun: true });
  await assert.rejects(site.applySite({ ...TEXAS, country: "Atlantis", phone: "999" }));
  await site.applySite({ city: "Austin", country: "United States", state: "California", address1: "1 Road" });
  assert.deepEqual([state.lastForm.email, state.lastForm.fax, state.lastForm.phone, state.lastForm.zip, state.lastForm.state, state.lastForm.city], ["", "", "", "", "California", "Austin"]);
});
