// Real Chrome, the real extension: the Verticals window opens, True is pressed for the vertical the report gave, the window
// closes, the section's Save changes is pressed, and the Published list is read back. Run with: npm run test:e2e
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TEXT_SAMPLE } from "../helpers/rovo-text-sample.mjs";
import { createHandler } from "../helpers/rts-verticals-site.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromiumPath = () => { const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"; const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-")); return dir ? [path.join(root, dir, "chrome-linux", "chrome"), path.join(root, dir, "chrome-linux64", "chrome")].find((c) => fs.existsSync(c)) : undefined; };

async function publishVerticals(options = {}, vertical = "E-Commerce") {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-vert-"));
  const ext = path.join(work, "ext"); fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const site = createHandler(options);
  const server = http.createServer(site.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), { executablePath: chromiumPath(), headless: false, viewport: { width: 1280, height: 900 }, args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  ctx.on("page", (p) => p.on("dialog", (d) => d.accept()));
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ sxrts_researcher: "Test.Researcher" }));
    const page = await ctx.newPage();
    await page.goto(`${base}/main.html`);
    const files = await worker.evaluate(() => ASSISTANT_FILES.filter((f) => f !== "content/bootstrap.js"));
    const tabId = await worker.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/main*` }))[0]?.id, base);
    await worker.evaluate(async ({ tabId, files }) => {
      await chrome.scripting.executeScript({ target: { tabId }, files });
      await chrome.scripting.executeScript({ target: { tabId }, func: () => {
        const host = document.createElement("section"); host.id = "sx-test-root"; document.documentElement.appendChild(host);
        globalThis.SXRTS.panel.mount(host.attachShadow({ mode: "open" }));
      } });
    }, { tabId, files });
    await page.evaluate((text) => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      const area = root.querySelector("#sxrts-response");
      area.value = text; area.dispatchEvent(new Event("input", { bubbles: true }));
      [...root.querySelectorAll("button")].find((b) => b.textContent === "Validate JSON").click();
    }, TEXT_SAMPLE.replace("Vertical Name: E-Commerce", `Vertical Name: ${vertical}`));
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      for (const c of root.querySelectorAll(".action-card")) { const box = c.querySelector("input[type=checkbox]"); if (box) box.checked = /extras\.verticals/.test(c.querySelector(".action-card-field").textContent); }
      [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish and save").click();
    });
    for (let i = 0; i < 90; i++) {
      if (await page.evaluate(() => /Saved \d/.test(document.getElementById("sx-test-root").shadowRoot.textContent))) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(800);
    const text = await page.evaluate(() => document.getElementById("sx-test-root").shadowRoot.textContent);
    return { summary: text.match(/Saved \d+ · Already in RTS \d+ · Needs attention \d+/)?.[0], text, server: JSON.parse(JSON.stringify(site.state)), openWindows: ctx.pages().filter((p) => p.url().includes("/verticals.html")).length };
  } finally { await ctx.close(); server.close(); fs.rmSync(work, { recursive: true, force: true }); }
}

test("a vertical the report gave is chosen (True) in RTS's window, saved once with the section's Save changes, and read back from Published Verticals", { timeout: 180000 }, async () => {
  const r = await publishVerticals();
  assert.deepEqual(r.server.published, ["LOHAS & Wellness", "E-Commerce"], `server: ${JSON.stringify(r.server)}`);
  assert.equal(r.server.saveRequests, 1);
  assert.match(r.summary, /Saved 1 · Already in RTS 0 · Needs attention 0/, r.text);
  assert.equal(r.openWindows, 0);
});

test("a vertical that is already published is not touched: no window, no save", { timeout: 180000 }, async () => {
  const r = await publishVerticals({ published: ["LOHAS & Wellness", "E-Commerce"] });
  assert.equal(r.server.chooseRequests, 0);
  assert.equal(r.server.saveRequests, 0);
  assert.match(r.summary, /Saved 0 · Already in RTS 1 · Needs attention 0/, r.text);
});

test("RTS refuses the save: the vertical is not reported as saved", { timeout: 180000 }, async () => {
  const r = await publishVerticals({ saveRefuses: true });
  assert.deepEqual(r.server.published, ["LOHAS & Wellness"]);
  assert.match(r.summary, /Saved 0 · Already in RTS 0 · Needs attention 1/, r.text);
});
