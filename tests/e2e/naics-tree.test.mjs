// Real-browser, real-extension test for the NAICS tree dialog: a team lead
// maps it by clicking in the page (real mouse), exports the team defaults, and
// a researcher with those defaults publishes three codes without mapping
// anything. Run with: npm run test:e2e

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TEXT_SAMPLE } from "../helpers/rovo-text-sample.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pageScript = fs.readFileSync(path.join(repo, "tests/helpers/naics-page.js"), "utf8");

function chromiumPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-"));
  return dir ? path.join(root, dir, "chrome-linux", "chrome") : undefined;
}

function buildExtension(target, teamFile) {
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(target, item), { recursive: true });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  if (teamFile) fs.writeFileSync(path.join(target, "core", "teamDefaults.js"), teamFile);
}

const MAIN = `<!doctype html><body style="font:14px sans-serif">
<span class="flat-button__caption-x1">PBID: PB-1</span>
<h3>Industry Classification</h3>
<script src="/naics-page.js"></script><script>installNaicsPage({ delay: 30 });</script></body>`;

async function scenario(teamFile) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-naics-"));
  const ext = path.join(work, "ext");
  fs.mkdirSync(ext);
  buildExtension(ext, teamFile);
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/naics-page.js")) { res.setHeader("content-type", "text/javascript"); res.end(pageScript); return; }
    res.setHeader("content-type", "text/html");
    res.end(MAIN);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), {
    executablePath: chromiumPath(), headless: false, viewport: { width: 1280, height: 900 },
    args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  try {
    return await drive(ctx, base, teamFile);
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function drive(ctx, base, teamFile) {
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/main.html`);

  const files = await worker.evaluate(() => ASSISTANT_FILES.filter((f) => f !== "content/bootstrap.js"));
  const tabId = await worker.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/main*` }))[0]?.id, base);
  await worker.evaluate(async ({ tabId, files }) => {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const host = document.createElement("section");
      host.id = "sx-test-root";
      document.documentElement.appendChild(host);
      globalThis.SXRTS.panel.mount(host.attachShadow({ mode: "open" }));
    } });
  }, { tabId, files });

  const inPanel = (fn, arg) => page.evaluate(fn, arg);
  const click = async (text, scope = ".teach-card") => {
    const point = await inPanel(({ text, scope }) => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      const container = root.querySelector(scope) || root;
      const button = [...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
      if (!button) return null;
      button.scrollIntoView({ block: "center" });
      const r = button.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, { text, scope });
    assert.ok(point, `button "${text}" is on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(200);
  };
  const clickPage = async (selector) => {
    const p = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
  };
  const waitFor = async (check, label, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await check()) return; await page.waitForTimeout(150); }
    assert.fail(`timed out waiting for ${label}`);
  };
  const cardText = () => inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".teach-card")?.textContent ?? "");

  await inPanel((text) => {
    const root = document.getElementById("sx-test-root").shadowRoot;
    const area = root.querySelector("#sxrts-response");
    area.value = text;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Validate JSON").click();
  }, TEXT_SAMPLE);
  await page.waitForTimeout(300);

  let exportedFile = null;
  if (!teamFile) {
    await inPanel(() => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      [...root.querySelectorAll(".action-card")].find((c) => /naicsCodes\[0\]/.test(c.querySelector(".action-card-field").textContent)).querySelector("button.map").click();
    });
    await page.waitForTimeout(250);

    // Step A: the Add NAICS button. The gap beside it is refused first.
    await click("Pick the Add NAICS button");
    await clickPage("#naics .group__i");
    assert.match(await cardText(), /not the button itself/);
    await click("Pick the Add NAICS button");
    await clickPage("#addNaics .button__caption");
    await waitFor(() => page.evaluate(() => window.__naics.opens === 1), "the extension to open the dialog");

    // Step B: a + inside the dialog (a real click on the drawn plus sign).
    await click("Pick a + button");
    await clickPage("#left li:first-child .plus");
    // Step C: the extension opens a branch; point at a code's radio button.
    await click("Open a branch and pick a radio button");
    await waitFor(() => page.evaluate(() => !!document.querySelector(".teach-overlay") || [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".teach-overlay")].length), "the picker");
    await waitFor(() => page.evaluate(() => document.querySelectorAll("input[type=radio]").length > 0), "a branch to open");
    await clickPage("input[type=radio] + .radio-button__caption .radio-button__pointer");
    // Step D: the dialog's Save (greyed out, still pickable).
    await click("Pick the dialog's Save button");
    await clickPage("#dlgSave .button__caption");
    // Step E: close the dialog ourselves, then the section's Save Changes.
    await click("I'll close the dialog myself");
    await clickPage("#dlgCancel");
    await click("Continue", ".teach-bar");
    await click("Pick Save Changes");
    await clickPage("#naicsSave .button__caption");
    assert.equal((await cardText()).match(/Step E[\s\S]*Save Changes/) !== null, true);

    // Try a code: finds and selects it, saves nothing.
    await click("Find this code in the dialog");
    await waitFor(async () => /Found 541511 and selected it/.test(await cardText()), "the dry run");
    assert.equal(await page.evaluate(() => window.__naics.saves), 0);
    await clickPage("#dlgCancel");

    await click("Save mapping");
    await page.waitForTimeout(300);

    // Share it: Export team defaults.
    await click("Teach new field", ".card");
    const downloadPromise = page.waitForEvent("download");
    await click("Export team defaults");
    exportedFile = fs.readFileSync(await (await downloadPromise).path(), "utf8");
    await inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".teach-x").click());
  }

  // Publish all three NAICS codes through the real panel.
  const cards = await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".action-card")]
    .filter((c) => /naicsCodes/.test(c.querySelector(".action-card-field").textContent))
    .map((c) => ({ badge: c.querySelector(".badge")?.textContent, hasMapButton: Boolean(c.querySelector("button.map")) })));
  assert.deepEqual(cards, [0, 1, 2].map(() => ({ badge: "pending", hasMapButton: false })));
  await inPanel(() => {
    const root = document.getElementById("sx-test-root").shadowRoot;
    for (const card of root.querySelectorAll(".action-card")) {
      const box = card.querySelector("input[type=checkbox]");
      if (box) box.checked = /naicsCodes/.test(card.querySelector(".action-card-field").textContent);
    }
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish selected to RTS").click();
  });
  await waitFor(() => inPanel(() => /Published \d+, skipped \d+, failed \d+/.test(document.getElementById("sx-test-root").shadowRoot.textContent)), "the publish summary", 120000);
  return {
    summary: await inPanel(() => document.getElementById("sx-test-root").shadowRoot.textContent.match(/Published \d+, skipped \d+, failed \d+/)?.[0]),
    listed: await page.evaluate(() => window.__naics.listed),
    sectionSaves: await page.evaluate(() => window.__naics.sectionSaves),
    gecsSaves: await page.evaluate(() => window.__naics.gecsSaves),
    exportedFile
  };
}

const expectPublished = (result) => {
  assert.equal(result.summary, "Published 3, skipped 0, failed 0");
  assert.deepEqual(result.listed, ["315220", "448140", "315240"]);
  assert.equal(result.sectionSaves, 3);
  assert.equal(result.gecsSaves, 0, "the look-alike GECS Save Changes was never clicked");
};

test("a lead maps the NAICS dialog, exports it, and a researcher publishes three codes with no mapping", { timeout: 400000 }, async () => {
  const lead = await scenario();
  expectPublished(lead);
  assert.match(lead.exportedFile, /"kind": "naics"/);
  expectPublished(await scenario(lead.exportedFile));
});
