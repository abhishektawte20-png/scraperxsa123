// 15-day run history and one-click feedback: storage, automatic erasing,
// comparison, message building and the panel wiring.

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
import "../core/issueReport.js";
import "../core/history.js";
import "../core/feedback.js";
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
import "../content/ui.js";
import "../content/history.js";
import "../content/feedback.js";
import "../content/panel.js";
import { validOutput } from "./helpers/rovo-sample.mjs";

const DAY = 24 * 60 * 60 * 1000;
const history = globalThis.SXRTS.history;
const feedback = globalThis.SXRTS.feedback;

function fakeStorage() {
  const store = new Map();
  let limit = Infinity;
  const area = {
    async get(k) { return store.has(k) ? { [k]: JSON.parse(JSON.stringify(store.get(k))) } : {}; },
    async set(o) { for (const [k, v] of Object.entries(o)) { const text = JSON.stringify(v); if (text.length > limit) throw new Error("QUOTA_BYTES quota exceeded"); store.set(k, JSON.parse(text)); } },
    async remove(k) { store.delete(k); }
  };
  global.chrome = { storage: { local: area }, runtime: {} };
  return { store, setLimit: (n) => { limit = n; } };
}

const entry = (over = {}) => ({ domain: "kpssecurity.com", company: "Kps Security", pbid: "1414159-39", version: "0.18.0", outcome: "valid", format: "json", issues: [], errors: 0, warnings: 0, raw: '{"a":1}', validated: { company: { keywords: [{ value: "access control systems", action: "addIfMissing" }] } }, ...over });

// ---------------- history ----------------

test("a saved run is kept for 15 days and erased automatically after that", async () => {
  fakeStorage();
  const t0 = Date.UTC(2026, 9, 4);
  await history.record(entry(), t0);
  assert.equal((await history.list({ now: t0 + 14 * DAY })).length, 1, "still there on day 14");
  assert.equal(history.daysLeft((await history.list({ now: t0 }))[0], t0 + 10 * DAY), 5);
  assert.equal((await history.list({ now: t0 + 15 * DAY + 1 })).length, 0, "gone after 15 days");
  assert.equal(await history.purge(t0 + 16 * DAY), 1);
  assert.equal((await history.list({ now: t0 })).length, 0, "purge really deleted it from storage");
});

test("recording also erases expired runs, so storage never grows past 15 days of data", async () => {
  const s = fakeStorage();
  const t0 = Date.UTC(2026, 9, 1);
  await history.record(entry({ domain: "old.com", raw: "old" }), t0);
  await history.record(entry({ domain: "new.com", raw: "new" }), t0 + 20 * DAY);
  assert.deepEqual(s.store.get(history.KEY).map((r) => r.domain), ["new.com"]);
});

test("the same paste within a minute updates one record; a later paste is a new record; newest first", async () => {
  fakeStorage();
  const t0 = Date.UTC(2026, 9, 4);
  const a = await history.record(entry(), t0);
  const b = await history.record(entry(), t0 + 20 * 1000);
  assert.equal(a, b);
  await history.record(entry({ raw: '{"a":2}' }), t0 + 2 * 60 * 1000);
  const rows = await history.list({ now: t0 + 3 * 60 * 1000 });
  assert.equal(rows.length, 2);
  assert.ok(rows[0].savedAt > rows[1].savedAt);
});

test("search finds a run by company, website or PBID; a publish result is attached to its run", async () => {
  fakeStorage();
  const t0 = Date.UTC(2026, 9, 4);
  const id = await history.record(entry(), t0);
  await history.record(entry({ domain: "psypher.in", company: "Psypher", pbid: "154920-17", raw: "p" }), t0 + 1000);
  assert.equal((await history.list({ query: "kps", now: t0 })).length, 1);
  assert.equal((await history.list({ query: "154920", now: t0 })).length, 1);
  assert.equal((await history.list({ query: "psypher.in", now: t0 })).length, 1);
  assert.equal((await history.list({ query: "nothing", now: t0 })).length, 0);
  assert.equal(await history.attachPublish(id, { saved: 1, skipped: 0, failed: 1, rows: [{ field: "company.keywords", status: "failed", message: "Save disabled", value: "x" }] }, t0 + 5000), true);
  const run = (await history.list({ query: "kps", now: t0 }))[0];
  assert.equal(run.publish.failed, 1);
  assert.equal(run.publish.rows[0].message, "Save disabled");
  assert.equal(await history.attachPublish("missing", { rows: [] }), false);
});

test("two runs of the same company can be compared field by field", async () => {
  fakeStorage();
  const t0 = Date.UTC(2026, 9, 4);
  await history.record(entry({ raw: "1", validated: { company: { briefDescription: { value: "Provider of guard services." }, keywords: [{ value: "access control" }] } } }), t0);
  await history.record(entry({ raw: "2", validated: { company: { briefDescription: { value: "Provider of security services." }, keywords: [{ value: "access control" }] } } }), t0 + DAY);
  const [newer, older] = await history.list({ now: t0 + DAY });
  assert.deepEqual(history.diff(older, newer), [{ path: "company.briefDescription.value", before: "Provider of guard services.", after: "Provider of security services." }]);
});

test("remove and clear erase on request; a full browser store drops the oldest runs instead of failing", async () => {
  const s = fakeStorage();
  const t0 = Date.UTC(2026, 9, 4);
  const id = await history.record(entry(), t0);
  await history.remove(id);
  assert.equal((await history.list({ now: t0 })).length, 0);
  s.setLimit(2500);
  for (let i = 0; i < 6; i += 1) await history.record(entry({ raw: `run ${i} ${"x".repeat(400)}`, validated: null }), t0 + i * 120000);
  const kept = await history.list({ now: t0 + DAY / 2 });
  assert.ok(kept.length >= 1 && kept.length < 6);
  assert.match(kept[0].raw, /^run 5/, "the newest run is the one that survives");
  await history.clear();
  assert.equal((await history.list({ now: t0 })).length, 0);
});

// ---------------- feedback ----------------

const TEAMS = "https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=zzz";

test("only Teams, Slack, Google Chat and Discord webhook addresses are accepted", () => {
  assert.equal(feedback.check(TEAMS).kind, "teams");
  assert.equal(feedback.check("https://contoso.webhook.office.com/webhookb2/abc").kind, "teams");
  assert.equal(feedback.check("https://acme.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/x/triggers/manual/paths/invoke").kind, "teams");
  assert.equal(feedback.check("https://hooks.slack.com/services/T/B/X").kind, "slack");
  assert.equal(feedback.check("https://chat.googleapis.com/v1/spaces/S/messages?key=k").kind, "gchat");
  assert.equal(feedback.check("https://discord.com/api/webhooks/1/abc").kind, "discord");
  for (const bad of ["", "not a url", "http://prod.logic.azure.com/x", "https://evil.example.com/hook", "https://logic.azure.com.evil.com/x", "https://discord.com/channels/1/2", "https://hooks.slack.com.evil.io/x"]) {
    assert.equal(feedback.check(bad).ok, false, bad);
  }
});

function sampleMessage(over = {}) {
  return feedback.build({ note: "Brief description came out cut off", name: "Asha", report: "ScraperX issue report · v0.18.0\nSUMMARY\nValidation: valid\n\nJSON\n{ \"big\": true }", raw: '{"x":1}', includeOutput: true, meta: { company: "Kps Security", domain: "kpssecurity.com", pbid: "1414159-39", version: "0.18.0", sentAt: "2026-10-04T10:00:00Z" }, ...over });
}

test("the message carries who, which company, the comment and the readable part of the report only", () => {
  const m = sampleMessage();
  assert.match(m.title, /Kps Security · kpssecurity\.com/);
  assert.ok(m.facts.some(([k, v]) => k === "From" && v === "Asha"));
  assert.match(m.report, /SUMMARY/);
  assert.doesNotMatch(m.report, /"big"/, "the duplicate JSON block is not sent");
  assert.equal(m.output, '{"x":1}');
  assert.equal(sampleMessage({ includeOutput: false }).output, "");
  assert.match(sampleMessage({ note: "  " }).note, /no comment written/);
});

test("long reports and outputs are cut to what a channel accepts, and say so", () => {
  const m = sampleMessage({ report: "r".repeat(30000), raw: "o".repeat(40000) });
  assert.ok(m.report.length < 9200 && /30000 characters in total/.test(m.report));
  assert.ok(m.output.length < 9200 && /40000 characters in total/.test(m.output));
  const card = feedback.body("teams", m);
  assert.ok(JSON.stringify(card).length < 25000, "stays under the Teams card size limit");
});

test("each channel gets the body shape it expects", () => {
  const m = sampleMessage();
  const teams = feedback.body("teams", m);
  assert.equal(teams.type, "message");
  assert.equal(teams.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
  assert.equal(teams.attachments[0].content.type, "AdaptiveCard");
  assert.ok(teams.attachments[0].content.body.some((b) => b.type === "FactSet"));
  assert.match(feedback.body("slack", m).text, /Brief description came out cut off/);
  assert.match(feedback.body("gchat", m).text, /Kps Security/);
  assert.ok(feedback.body("discord", m).content.length <= 1900);
});

test("send posts JSON to the webhook and reports success, refusal and network failure honestly", async () => {
  const calls = [];
  const ok = await feedback.send(TEAMS, sampleMessage(), async (url, init) => { calls.push({ url, init }); return { ok: true, status: 202 }; });
  assert.equal(ok.ok, true);
  assert.equal(calls[0].url, TEAMS);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).type, "message");
  const refused = await feedback.send(TEAMS, sampleMessage(), async () => ({ ok: false, status: 404 }));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /HTTP 404/);
  const down = await feedback.send(TEAMS, sampleMessage(), async () => { throw new Error("Failed to fetch"); });
  assert.match(down.error, /Could not reach Microsoft Teams: Failed to fetch/);
  let called = false;
  const blocked = await feedback.send("https://evil.example.com/x", sampleMessage(), async () => { called = true; return { ok: true }; });
  assert.equal(blocked.ok, false);
  assert.equal(called, false, "nothing is posted to an address that is not allowed");
});

test("the channel address is read from this browser first, then from the shipped file, and bad ones are refused", async () => {
  fakeStorage();
  globalThis.SXRTS.feedbackConfig = { webhookUrl: "" };
  assert.equal(await feedback.getUrl(), "");
  assert.equal((await feedback.setUrl("https://evil.example.com/x")).ok, false);
  assert.equal(await feedback.getUrl(), "");
  globalThis.SXRTS.feedbackConfig = { webhookUrl: "https://hooks.slack.com/services/T/B/SHIPPED" };
  assert.match(await feedback.getUrl(), /SHIPPED/);
  assert.equal((await feedback.setUrl(TEAMS)).ok, true);
  assert.equal(await feedback.getUrl(), TEAMS);
  assert.equal((await feedback.setUrl("")).cleared, true);
  assert.match(await feedback.getUrl(), /SHIPPED/);
  globalThis.SXRTS.feedbackConfig = { webhookUrl: "" };
});

// ---------------- the panel ----------------

function mountPanel() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const s = fakeStorage();
  const sent = [];
  global.chrome.runtime = { async sendMessage(message) { sent.push(message); return { ok: true, label: "Microsoft Teams" }; } };
  const copied = [];
  Object.defineProperty(global, "navigator", { value: { clipboard: { writeText: async (text) => { copied.push(text); } } }, configurable: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { shadow, sent, copied, store: s.store };
}
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 3000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return true; await tick(20); } return false; }
const btn = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);

test("Validate saves the run to the history, and the History window lists it with its erase date", async () => {
  const { shadow, store } = mountPanel();
  shadow.querySelector("#sxrts-domain").value = "acme.com";
  shadow.querySelector("#sxrts-response").value = JSON.stringify(validOutput());
  btn(shadow, "Validate JSON").click();
  assert.ok(await until(() => store.get(history.KEY)?.length === 1), "run saved");
  const saved = store.get(history.KEY)[0];
  assert.equal(saved.outcome, "valid");
  assert.equal(saved.domain, "acme.com");
  assert.ok(Object.keys(saved.facts).length > 5);
  assert.ok(saved.expiresAt - saved.savedAt === 15 * DAY);
  btn(shadow, "History").click();
  assert.ok(await until(() => /erased in 15 days/.test(shadow.querySelector(".hx-modal.open")?.textContent ?? "")));
  assert.match(shadow.querySelector(".hx-modal").textContent, /acme\.com/);
});

test("a rejected paste is saved too (so QA can see what the agent returned), flagged invalid", async () => {
  const { shadow, store } = mountPanel();
  shadow.querySelector("#sxrts-domain").value = "acme.com";
  const bad = validOutput();
  bad.keywords = ["fleet"];
  shadow.querySelector("#sxrts-response").value = JSON.stringify(bad);
  btn(shadow, "Validate JSON").click();
  assert.ok(await until(() => store.get(history.KEY)?.length === 1));
  const saved = store.get(history.KEY)[0];
  assert.equal(saved.outcome, "invalid");
  assert.ok(saved.errors >= 1);
  assert.ok(saved.issues.some((line) => /KEYWORD_COUNT/.test(line)));
  assert.deepEqual(saved.facts, {});
});

test("Send feedback posts the report through the extension in one click, and never without a channel", async () => {
  const { shadow, sent, store } = mountPanel();
  shadow.querySelector("#sxrts-domain").value = "acme.com";
  shadow.querySelector("#sxrts-response").value = JSON.stringify(validOutput());
  btn(shadow, "Validate JSON").click();
  btn(shadow, "Feedback").click();
  await until(() => shadow.querySelector(".fb-modal.open"));
  const modal = shadow.querySelector(".fb-modal");
  const sendBtn = Array.from(modal.querySelectorAll("button")).find((b) => /^Send/.test(b.textContent));
  assert.ok(sendBtn.disabled, "no channel yet: Send is off");
  assert.match(modal.textContent, /No feedback channel is set up yet/);
  // set the channel once
  modal.querySelector("details input[type=text]").value = TEAMS;
  Array.from(modal.querySelectorAll("button")).find((b) => b.textContent === "Save channel address").click();
  assert.ok(await until(() => /Feedback will go to Microsoft Teams/.test(modal.textContent)));
  assert.equal(store.get(feedback.STORAGE_KEY).url, TEAMS);
  modal.querySelector("textarea").value = "Brief description was cut off";
  modal.querySelector("textarea").dispatchEvent(new window.Event("input"));
  const send2 = Array.from(modal.querySelectorAll("button")).find((b) => b.textContent === "Send to Microsoft Teams");
  assert.ok(!send2.disabled);
  send2.click();
  assert.ok(await until(() => sent.length === 1));
  assert.equal(sent[0].type, "sxrts-send-feedback");
  assert.equal(sent[0].url, TEAMS);
  assert.match(sent[0].message.note, /cut off/);
  assert.match(sent[0].message.report, /ScraperX issue report/);
  assert.ok(sent[0].message.output.length > 100, "agent output included by default");
  assert.ok(await until(() => /Sent to Microsoft Teams/.test(modal.textContent)));
});

test("a failed send shows the reason instead of pretending it worked", async () => {
  const { shadow } = mountPanel();
  global.chrome.runtime.sendMessage = async () => ({ ok: false, error: "Microsoft Teams refused the message (HTTP 404)." });
  await global.chrome.storage.local.set({ [feedback.STORAGE_KEY]: { url: TEAMS } });
  btn(shadow, "Feedback").click();
  await until(() => shadow.querySelector(".fb-modal.open") && Array.from(shadow.querySelectorAll(".fb-modal button")).some((b) => b.textContent === "Send to Microsoft Teams"));
  Array.from(shadow.querySelectorAll(".fb-modal button")).find((b) => b.textContent === "Send to Microsoft Teams").click();
  assert.ok(await until(() => /HTTP 404/.test(shadow.querySelector(".fb-modal").textContent)));
  assert.doesNotMatch(shadow.querySelector(".fb-modal").textContent, /Thank you/);
});
