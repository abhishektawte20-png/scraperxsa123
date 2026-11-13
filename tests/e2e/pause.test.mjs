// Real Chrome: while the extension is paused, the background worker refuses to open or drive a window, even if asked.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createHandler } from "../helpers/rts-industry-site.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromiumPath = () => { const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"; const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-")); return dir ? [path.join(root, dir, "chrome-linux", "chrome"), path.join(root, dir, "chrome-linux64", "chrome")].find((c) => fs.existsSync(c)) : undefined; };

test("paused: no window is opened or driven, and the page is not clicked; resumed: the same request opens the window", { timeout: 120000 }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-pause-"));
  const ext = path.join(work, "ext"); fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const site = createHandler({});
  const server = http.createServer(site.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), { executablePath: chromiumPath(), headless: false, args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const page = await ctx.newPage();
    await page.goto(`${base}/main.html`);
    const files = await worker.evaluate(() => ASSISTANT_FILES.filter((f) => f !== "content/bootstrap.js"));
    const tabId = await worker.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/main*` }))[0]?.id, base);
    await worker.evaluate(async ({ tabId, files }) => { await chrome.scripting.executeScript({ target: { tabId }, files }); }, { tabId, files });
    const ask = () => worker.evaluate(async (id) => {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => globalThis.SXRTS.workflows.customField.runInWindow(document.querySelector('input[value="Add/Edit Industry"]'), { rows: { names: ["x"], trueText: "True" } }).then(() => "ran", (e) => e.message) });
      return r.result;
    }, tabId);

    await worker.evaluate(() => chrome.storage.local.set({ sxrts_paused: true }));
    const pagesBefore = ctx.pages().length;
    const paused = await ask();
    assert.match(paused, /paused/i);
    assert.equal(ctx.pages().length, pagesBefore, "no window was opened");
    assert.equal(await page.evaluate(() => window.opens), 0, "the opening button was not even pressed");

    await worker.evaluate(() => chrome.storage.local.set({ sxrts_paused: false }));
    const resumed = await ask();
    assert.doesNotMatch(resumed, /paused/i);
    assert.ok(await page.evaluate(() => window.opens) >= 1, "resumed: the button is pressed and the window opens");
  } finally { await ctx.close(); server.close(); fs.rmSync(work, { recursive: true, force: true }); }
});
