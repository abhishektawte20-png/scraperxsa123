import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/business-entity-general.html"), "utf8");
function fakeChrome() {
  const data = {};
  global.chrome = { storage: { local: {
    get: async (k) => (typeof k === "string" ? { [k]: data[k] } : { ...data }),
    set: async (o) => { Object.assign(data, JSON.parse(JSON.stringify(o))); },
    remove: async (k) => { delete data[k]; }
  } } };
  return data;
}

import "../core/resultsSummary.js";
import "../core/outputFields.js";
import "../core/fieldStats.js";
const fs = globalThis.SXRTS.fieldStats;
const DAY = 86400000;

test("rows are sorted into saved / already / failed / not mapped, and deliberate skips are ignored", () => {
  const c = (status, message = "") => fs.classify({ status, message });
  assert.equal(c("savedValueVerified"), "saved");
  assert.equal(c("failed", "boom"), "failed");
  assert.equal(c("skipped", 'Website Address already has a value ("x").'), "already");
  assert.equal(c("skipped", "No selector registry entry exists for this field yet."), "unmapped");
  assert.equal(c("skipped", "action=skip"), "other");
  assert.equal(c("skipped", "RTS has only one Website Address field; only the first proposed value can ever be applied."), "other");
});

test("per-field success rate, most common error and totals", async () => {
  fakeChrome();
  const now = Date.now();
  await fs.record([
    { field: "company.keywords[0]", status: "savedValueVerified" },
    { field: "company.keywords[1]", status: "savedValueVerified" },
    { field: "company.keywords[2]", status: "failed", message: "Enter too early", value: "ai" },
    { field: "extras.industryCode", status: "failed", message: "Frame with ID 0 was removed.", value: "2.1.2" },
    { field: "extras.city", status: "skipped", message: "No selector registry entry exists for this field yet." },
    { field: "businessEntity.websiteAddresses", status: "skipped", message: 'Website Address already has a value ("a").' }
  ], { domain: "a.com", version: "0.22.0" }, now);
  const s = fs.summarize(await fs.readAll(), { since: now - DAY });
  const kw = s.rows.find((r) => r.path === "company.keywords");
  assert.deepEqual([kw.saved, kw.failed, kw.tried, Math.round(kw.rate * 100)], [2, 1, 3, 67]);
  assert.equal(kw.topError, "Enter too early");
  assert.equal(s.rows.find((r) => r.path === "extras.city").rate, null, "a field never attempted has no rate");
  assert.equal(s.rows.find((r) => r.path === "businessEntity.websiteAddresses").rate, 1);
  assert.deepEqual([s.total.saved, s.total.already, s.total.failed, s.total.unmapped], [2, 1, 2, 1]);
  assert.equal(s.rows[0].failed >= s.rows[1].failed, true, "worst fields first");
});

test("the digest names the numbers, the worst fields and the failure log, and only covers the period", async () => {
  fakeChrome();
  const now = Date.now();
  await fs.record([{ field: "company.keywords", status: "failed", message: "old failure" }], { domain: "old.com" }, now - 20 * DAY);
  await fs.record([{ field: "extras.industryCode", status: "failed", message: "Frame with ID 0 was removed.", value: "2.1.2" }, { field: "company.keywords", status: "savedValueVerified" }], { domain: "new.com", version: "0.22.0" }, now - DAY);
  const { text, summary } = await fs.digest({ now });
  assert.equal(summary.total.failed, 1);
  assert.match(text, /Fields attempted: 2 · saved 1 · already in RTS 0 · failed 1/);
  assert.match(text, /Success rate .*: 50%/);
  assert.match(text, /new\.com .*Frame with ID 0 was removed\./);
  assert.doesNotMatch(text, /old failure/);
});

test("events older than the retention period are dropped on the next write, and Clear erases everything", async () => {
  fakeChrome();
  const now = Date.now();
  await fs.record([{ field: "a", status: "failed", message: "x" }], {}, now - 40 * DAY);
  await fs.record([{ field: "b", status: "failed", message: "y" }], {}, now);
  assert.deepEqual((await fs.readAll()).map((e) => e.path), ["b"]);
  await fs.clear();
  assert.equal((await fs.readAll()).length, 0);
});
