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

test("check mappings opens the section the same way", async () => {
  const { state } = setup({ real: true });
  const result = await site.check();
  assert.ok(result.parts.every((p) => p.ok), JSON.stringify(result.parts.filter((p) => !p.ok)));
  assert.equal(state.saves, 0);
});
