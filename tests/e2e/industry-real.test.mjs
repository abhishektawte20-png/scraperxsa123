// Real Chrome, the real extension and the shipped Industry mapping, against a copy of RTS's Industry window that runs
// RTS's own script (tests/helpers/rts-industry-control.js). Run with: npm run test:e2e
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TEXT_SAMPLE } from "../helpers/rovo-text-sample.mjs";
import { createHandler } from "../helpers/rts-industry-site.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromiumPath = () => { const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"; const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-")); return dir ? [path.join(root, dir, "chrome-linux", "chrome"), path.join(root, dir, "chrome-linux64", "chrome")].find((candidate) => fs.existsSync(candidate)) : undefined; };

async function publishIndustry(options = {}, code = "1.2.4 — Consulting Services", { fixedName = "", preopen = false } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-real-"));
  const ext = path.join(work, "ext"); fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.copyFileSync(path.join(repo, "tests/helpers/team-industry.js"), path.join(ext, "core", "teamDefaults.js"));

  const site = createHandler(options);
  const server = http.createServer(site.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), { executablePath: chromiumPath(), headless: false, viewport: { width: 1280, height: 800 }, args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  const popupMessages = [];
  // a person pressing OK on RTS's own message boxes in the window
  ctx.on("page", (p) => p.on("dialog", (d) => { popupMessages.push(d.message()); if (process.env.DBG) console.log("POPUP DIALOG", d.message()); if (!options.nobodyThere || p.url().includes("/main.html")) d.accept(); }));
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const page = await ctx.newPage();
    await page.goto(`${base}/main.html`);
    if (fixedName) await page.evaluate((n) => { window.fixedName = n; }, fixedName);
    if (preopen) { await page.click('input[value="Add/Edit Industry"]'); await page.waitForTimeout(1500); } // a window left open by hand
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
    }, TEXT_SAMPLE.replace("2.1.2 — Clothing", code));
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      window.confirm = () => true;
      for (const c of root.querySelectorAll(".action-card")) { const box = c.querySelector("input[type=checkbox]"); if (box) box.checked = /extras\.industryCode/.test(c.querySelector(".action-card-field").textContent); }
      [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish and save").click();
    });
    for (let i = 0; i < 90; i++) {
      if (await page.evaluate(() => /Saved \d/.test(document.getElementById("sx-test-root").shadowRoot.textContent))) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.getElementById("sx-test-root").shadowRoot.textContent);
    const progressLabel = await page.evaluate(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".pbar-label")?.textContent || "");
    return {
      summary: text.match(/Saved \d+ · Already in RTS \d+ · Needs attention \d+/)?.[0], text, progressLabel,
      server: JSON.parse(JSON.stringify(site.state)), model: site.MODEL, popupMessages,
      openWindows: ctx.pages().filter((p) => p.url().includes("/industryGroup/create.html")).length
    };
  } finally { await ctx.close(); server.close(); fs.rmSync(work, { recursive: true, force: true }); }
}

const consulting = (model) => model.flatMap((g) => g.segs.flatMap((s) => s.codes)).find((c) => c.n === "Consulting Services").id;

test("RTS's own Industry window: the choice is ticked, RTS receives the save, and only then is the window gone", { timeout: 180000 }, async () => {
  const r = await publishIndustry();
  if (process.env.DBG) console.log("RESULT", JSON.stringify({ summary: r.summary, text: r.text.slice(-600), server: r.server, popupMessages: r.popupMessages }));
  assert.deepEqual(r.server.saved, [consulting(r.model)], `RTS saved the choice (server saw ${r.server.saveRequests} save request(s), ${r.server.saveFinished} finished)`);
  assert.equal(r.server.saveFinished, 1);
  assert.match(r.summary, /Saved 1 · Already in RTS 0 · Needs attention 0/, r.text);
  assert.equal(r.openWindows, 0);
});

test("RTS's Industry window with a slow server and a confirmation from validateOnSave: nothing is cut off", { timeout: 180000 }, async () => {
  const r = await publishIndustry({ validateMs: 900, saveMs: 1500, confirmMessage: "Changing the Industry Group will change other things. Continue?" });
  assert.deepEqual(r.server.saved, [consulting(r.model)], `server: ${JSON.stringify(r.server)}`);
  assert.match(r.summary, /Saved 1 · Already in RTS 0 · Needs attention 0/, r.text);
});

test("RTS refuses the save (its own error box): the extension says so, and never reports the industry as saved", { timeout: 180000 }, async () => {
  const r = await publishIndustry({ saveError: "The industry group could not be saved." });
  assert.deepEqual(r.server.saved, []);
  assert.match(r.summary, /Saved 0 · Already in RTS 0 · Needs attention 1/, r.text);
  if (process.env.DBG) 
  assert.match(r.text, /RTS said: "The industry group could not be saved\."/, "RTS's own message is in the result, since nobody was there to read the box");
});

test("RTS answers 'ok' but stores nothing: the read-back finds the choice not ticked, so it is an error, not a success", { timeout: 180000 }, async () => {
  const r = await publishIndustry({ silentNoSave: true });
  assert.deepEqual(r.server.saved, []);
  assert.match(r.summary, /Saved 0 · Already in RTS 0 · Needs attention 1/, r.text);
});

test("the choice is already saved in RTS: nothing is saved again, and it is reported as already there", { timeout: 180000 }, async () => {
  const r = await publishIndustry({ alreadySaved: true });
  assert.equal(r.server.saveRequests, 0);
  assert.match(r.summary, /Saved 0 · Already in RTS 1 · Needs attention 0/, r.text);
});

test("RTS reuses one named window and one is already open from earlier: it is used, the choice is saved and read back", { timeout: 180000 }, async () => {
  const r = await publishIndustry({}, "1.2.4 — Consulting Services", { fixedName: "industryWindow", preopen: true });
  assert.deepEqual(r.server.saved, [consulting(r.model)], `server: ${JSON.stringify(r.server)}`);
  assert.match(r.summary, /Saved 1 · Already in RTS 0 · Needs attention 0/, r.text);
});

test("the same, with the window named and nothing open beforehand", { timeout: 180000 }, async () => {
  const r = await publishIndustry({}, "1.2.4 — Consulting Services", { fixedName: "industryWindow" });
  assert.deepEqual(r.server.saved, [consulting(r.model)], `server: ${JSON.stringify(r.server)}`);
  assert.match(r.summary, /Saved 1 · Already in RTS 0 · Needs attention 0/, r.text);
});

test("nobody is at the computer: RTS's confirmation before saving is answered by the extension, no box waits, and the choice is saved", { timeout: 180000 }, async () => {
  const r = await publishIndustry({ confirmMessage: "Changing the Industry Group will change other things. Continue?", nobodyThere: true });
  assert.equal(r.popupMessages.filter((m) => /Industry Group will change/.test(m)).length, 0, "the confirmation never reached a person");
  assert.deepEqual(r.server.saved, [consulting(r.model)], `server: ${JSON.stringify(r.server)}`);
  assert.match(r.summary, /Saved 1 · Already in RTS 0 · Needs attention 0/, r.text);
});
