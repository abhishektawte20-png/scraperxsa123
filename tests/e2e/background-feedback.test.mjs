// Real-browser, real-extension test for the background worker's two new jobs:
// posting feedback (only to allowed channel addresses) and erasing history
// older than 15 days. Run with: npm run test:e2e

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function chromiumPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-"));
  return dir ? path.join(root, dir, "chrome-linux", "chrome") : undefined;
}

test("the worker starts, schedules the history purge, erases expired runs, and refuses feedback to addresses that are not allowed", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-bg-"));
  const ext = path.join(work, "ext");
  fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = [...manifest.host_permissions, "http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><body>page</body>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), {
    executablePath: chromiumPath(), headless: false,
    args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const page = await ctx.newPage();
    await page.goto(`${base}/`);

    // the purge is scheduled
    let alarms = [];
    for (let i = 0; i < 20 && !alarms.length; i += 1) { alarms = await worker.evaluate(() => chrome.alarms.getAll()); if (!alarms.length) await page.waitForTimeout(150); }
    assert.ok(alarms.some((a) => a.name === "sxrts-history-purge"), "history purge alarm exists");

    // expired runs are erased, fresh ones kept
    const left = await worker.evaluate(async () => {
      const day = 24 * 60 * 60 * 1000;
      await chrome.storage.local.set({ sxrts_history: [
        { id: "new", savedAt: Date.now(), expiresAt: Date.now() + 5 * day, domain: "new.com" },
        { id: "old", savedAt: Date.now() - 20 * day, expiresAt: Date.now() - 5 * day, domain: "old.com" }
      ] });
      await purgeHistory();
      return (await chrome.storage.local.get("sxrts_history")).sxrts_history.map((r) => r.id);
    });
    assert.deepEqual(left, ["new"]);

    // the page asks the worker to post feedback
    const tabId = await worker.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/*` }))[0]?.id, base);
    const ask = (url) => worker.evaluate(async ({ tabId, url }) => {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, args: [url], func: (u) => chrome.runtime.sendMessage({ type: "sxrts-send-feedback", url: u, message: { title: "t", facts: [["a", "b"]], note: "n", report: "r", output: "" } }) });
      return result;
    }, { tabId, url });

    const blocked = await ask("https://evil.example.com/hook");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /only post to Microsoft Teams, Slack, Google Chat or Discord/);

    const unreachable = await ask("https://sxrts-no-such-host.logic.azure.com/workflows/x");
    assert.equal(unreachable.ok, false);
    assert.match(unreachable.error, /Could not reach Microsoft Teams/);
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("the weekly digest is posted once a week to the team channel, never without one, and 'send now' works", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-digest-"));
  const ext = path.join(work, "ext");
  fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = [...manifest.host_permissions, "http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><body>page</body>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), {
    executablePath: chromiumPath(), headless: false,
    args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    const day = 86400000;
    await page.waitForTimeout(1000); // the worker's own start-up digest check has finished
    const out = await worker.evaluate(async (day) => {
      const sent = [];
      globalThis.SXRTS.feedback.send = async (url, message) => { sent.push({ url, message }); return { ok: true, label: "Microsoft Teams" }; };
      await chrome.storage.local.clear();
      const now = Date.now();
      await globalThis.SXRTS.fieldStats.record([
        { field: "extras.industryCode", status: "failed", message: "Frame with ID 0 was removed.", value: "2.1.2" },
        { field: "company.keywords", status: "savedValueVerified" }
      ], { domain: "acme.com", version: "0.22.0" }, now - 2 * day);
      const log = {};
      log.first = await maybeSendDigest(now - 9 * day);            // starts counting
      log.noChannel = await maybeSendDigest(now);                    // due, but no channel: nothing sent, nothing lost
      log.sentBefore = sent.length;
      await chrome.storage.local.set({ sxrts_feedback: { url: "https://x.logic.azure.com/workflows/abc" } });
      log.notDue = await maybeSendDigest(now - 9 * day + 2 * day);
      log.due = await maybeSendDigest(now);
      log.sentAfter = sent.length;
      log.message = sent[0]?.message;
      log.again = await maybeSendDigest(now + day);                  // already sent: not due again
      log.sentFinal = sent.length;
      return log;
    }, day);
    assert.equal(out.first.sent, false);
    assert.equal(out.noChannel.reason, "no channel");
    assert.equal(out.sentBefore, 0);
    assert.equal(out.notDue.reason, "not due");
    assert.equal(out.due.sent, true);
    assert.equal(out.sentAfter, 1);
    assert.match(out.message.report, /Fields attempted: 2 · saved 1 · already in RTS 0 · failed 1/);
    assert.match(out.message.report, /acme\.com .*Frame with ID 0 was removed\./);
    assert.equal(out.again.reason, "not due");
    assert.equal(out.sentFinal, 1);

    // the "Send digest now" button: the page asks the worker
    const tabId = await worker.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/*` }))[0]?.id, base);
    const reply = await worker.evaluate(async (tabId) => {
      globalThis.SXRTS.feedback.send = async () => ({ ok: true, label: "Microsoft Teams" });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => chrome.runtime.sendMessage({ type: "sxrts-digest-now" }) });
      return result;
    }, tabId);
    assert.equal(reply.ok, true);
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
