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
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(process.env.SX_PKG || repo, item), path.join(ext, item), { recursive: true });
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
    await worker.evaluate(() => chrome.storage.local.set({ sxrts_researcher: "Test.Researcher" }));
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
    if (options.listOnly) {
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      await page.evaluate(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll("button")].find((b) => b.textContent === "Copy RTS industry list").click());
      let copied = "";
      for (let i = 0; i < 90 && !copied; i++) { await page.waitForTimeout(500); copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => "")); }
      return { copied, status: await page.evaluate(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".status")?.textContent || ""), server: JSON.parse(JSON.stringify(site.state)), model: site.MODEL, openWindows: ctx.pages().filter((p) => p.url().includes("/industryGroup/create.html")).length };
    }
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
    let assistAnswer = "";
    if (options.clickTry || options.clickMine) {
      await page.evaluate((label) => { const root = document.getElementById("sx-test-root").shadowRoot; [...root.querySelectorAll(".assist-box button")].find((b) => b.textContent.startsWith(label)).click(); }, options.clickTry ? "Try Industry code again" : "I ticked it myself");
      for (let i = 0; i < 120 && !/^(Done|Already|Checked|Not)/.test(assistAnswer); i++) { await page.waitForTimeout(500); assistAnswer = await page.evaluate(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".assist-box .helptext")].map((n) => n.textContent).find((t) => /^(Done|Already|Checked|Not)/.test(t)) || ""); }
    }
    const text = await page.evaluate(() => document.getElementById("sx-test-root").shadowRoot.textContent);
    const progressLabel = await page.evaluate(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".pbar-label")?.textContent || "");
    return {
      summary: text.match(/Saved \d+ · Already in RTS \d+ · Needs attention \d+/)?.[0], text, progressLabel,
      assistAnswer, server: JSON.parse(JSON.stringify(site.state)), model: site.MODEL, popupMessages,
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
  if (process.env.DBG) console.log("SERVER", JSON.stringify(r.server), "RESULT", [...r.text.replace(/\s+/g, " ").matchAll(/.{0,300}(Industry code was not saved|RTS said|did not accept).{0,400}/g)].map((m) => m[0]).join(" ||| "));
  assert.deepEqual(r.server.saved, []);
  assert.match(r.summary, /Saved 0 · Already in RTS 0 · Needs attention 1/, r.text);
  assert.match(r.text, /RTS said: "The industry group could not be saved\."/, "RTS's own message is in the result, since nobody was there to read the box");
  assert.match(r.text, /was not saved automatically/, "the researcher is offered a way to finish it, not left with a dead end");
  assert.match(r.text, /Try Industry code again/);
  assert.match(r.text, /I ticked it myself: check it/);
  assert.ok(r.server.loadRequests <= 3, `at most 3 windows were opened, not ${r.server.loadRequests}`);
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

test("a slow RTS (the Industry window takes 8 seconds to draw its tree): it waits, ticks, saves, and reads back with no extra windows", { timeout: 180000 }, async () => {
  const r = await publishIndustry({ loadMs: 8000, validateMs: 600, saveMs: 800 });
  assert.deepEqual(r.server.saved, [consulting(r.model)], `server: ${JSON.stringify(r.server)}`);
  assert.match(r.summary, /Saved 1 · Already in RTS 0 · Needs attention 0/, r.text);
  assert.equal(r.server.loadRequests, 2, "one window to tick and save, one to read the tick back");
});

test("a choice that is not in RTS's tree: the REAL reason reaches the researcher, and only one window is opened (it used to be repeated in 4 windows with the reason lost)", { timeout: 180000 }, async () => {
  const r = await publishIndustry({}, "1.2.4 — Made Up Services");
  assert.deepEqual(r.server.saved, []);
  assert.match(r.summary, /Saved 0 · Already in RTS 0 · Needs attention 1/, r.text);
  assert.match(r.text, /Check the name the report gives against RTS's list|RTS lists|was not found in the tree/);
  assert.equal(r.server.loadRequests, 1, `one window, not ${r.server.loadRequests}`);
  assert.match(r.text, /was not saved automatically/);
});

test("the first Industry window goes away by itself before it can report: a clean one is opened, the job is done, and it never takes more than 4 windows", { timeout: 180000 }, async () => {
  const r = await publishIndustry({ dieFirst: 1 });
  assert.deepEqual(r.server.saved, [consulting(r.model)], `server: ${JSON.stringify(r.server)}`);
  assert.match(r.summary, /Saved 1 · Already in RTS 0 · Needs attention 0/, r.text);
  assert.ok(r.server.windowsOpened <= 4, `windows opened: ${r.server.windowsOpened}`);
});

test("the first TWO Industry windows go away: the extension stops opening windows, and offers the guided way to finish (never a silent failure)", { timeout: 180000 }, async () => {
  const r = await publishIndustry({ dieFirst: 3 });
  assert.match(r.summary, /Saved 0 · Already in RTS 0 · Needs attention 1/, r.text);
  assert.match(r.text, /was not saved automatically/);
  assert.ok(r.server.windowsOpened <= 4, `windows opened: ${r.server.windowsOpened}`);
});

test("after the windows went away, 'Try Industry code again' (a real click) opens a clean window, saves, and reads the tick back", { timeout: 240000 }, async () => {
  const r = await publishIndustry({ dieFirst: 3, clickTry: true });
  assert.match(r.assistAnswer, /^Done: Industry code is saved and was read back from RTS/, r.assistAnswer);
  assert.deepEqual(r.server.saved, [consulting(r.model)]);
});

test("'I ticked it myself: check it' reads the tick: not ticked says so, never a success", { timeout: 240000 }, async () => {
  const r = await publishIndustry({ dieFirst: 3, clickMine: true });
  assert.match(r.assistAnswer, /^Not ticked yet/, r.assistAnswer);
  assert.deepEqual(r.server.saved, []);
});

test("'Copy RTS industry list' opens the window once, opens every branch and copies every choice as Group > Segment > Name (code)", { timeout: 240000 }, async () => {
  const r = await publishIndustry({ listOnly: true });
  if (process.env.DBG) console.log("COPIED", JSON.stringify(r.copied).slice(0, 800), "STATUS", r.status);
  const lines = r.copied.split("\n");
  const everyChoice = r.model.flatMap((g) => g.segs.flatMap((s) => s.codes.map((c) => c.n)));
  assert.equal(lines.length, everyChoice.length, `one line per choice (${everyChoice.length}), got ${lines.length}`);
  for (const name of everyChoice) assert.ok(lines.some((l) => l.includes(`> ${name}`) || l.startsWith(name)), `missing: ${name}`);
  assert.ok(lines.every((l) => /\(\d+\.\d+\.\d+\)$/.test(l)), "every line ends with its code, e.g. (1.2.4)");
  assert.ok(lines.some((l) => /Consulting Services$|Consulting Services  \(1\.2\.4\)$/.test(l)));
  assert.equal(r.server.loadRequests, 1, "the window is opened once");
  assert.deepEqual(r.server.saved, [], "nothing is changed in RTS");
  assert.equal(r.openWindows, 0, "the window is closed again");
});
