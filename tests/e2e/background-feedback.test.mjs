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
