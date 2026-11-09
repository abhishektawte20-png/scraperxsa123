// Real Chromium, real extension, real panel: the report's address fields are published as ONE site
// (Primary HQ, Current, site name = city), a site that is already listed is not added again, and the
// "add anyway" box adds it. Run with: npm run test:e2e

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
const pageScript = fs.readFileSync(path.join(repo, "tests/helpers/site-page.js"), "utf8");

function chromiumPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-"));
  return dir ? [path.join(root, dir, "chrome-linux", "chrome"), path.join(root, dir, "chrome-linux64", "chrome")].find((candidate) => fs.existsSync(candidate)) : undefined;
}

const REPORT = TEXT_SAMPLE.replace(/\* Address: Borivali[^\n]*\n[^\n]*\n/, `* Address: 12600 Crystal View Blvd.
   * Source: https://www.psypher.in/
* City: Texas City
   * Source: https://www.psypher.in/
* State: TX
   * Source: https://www.psypher.in/
* Country: USA
   * Source: https://www.psypher.in/
* Postcode: 77568
   * Source: https://www.psypher.in/
* Phone: 281-941-6001
   * Source: https://www.psypher.in/
`);

const MAIN = `<!doctype html><body style="font:14px sans-serif"><span class="flat-button__caption-x1">PBID: PB-1</span>
<script src="/site-page.js"></script><script>installSitePage({ collapsed: true, real: true });</script></body>`;

test("the address fields are published as one site; a listed site is not added twice; 'add anyway' adds it", { timeout: 300000 }, async () => {
  assert.match(REPORT, /\* City: Texas City/);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-site-"));
  const ext = path.join(work, "ext");
  fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/site-page.js")) { res.setHeader("content-type", "text/javascript"); res.end(pageScript); return; }
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
    const validate = async () => {
      await inPanel((text) => {
        const root = document.getElementById("sx-test-root").shadowRoot;
        const area = root.querySelector("#sxrts-response");
        area.value = text;
        area.dispatchEvent(new Event("input", { bubbles: true }));
        [...root.querySelectorAll("button")].find((b) => b.textContent === "Validate JSON").click();
      }, REPORT);
      await page.waitForTimeout(500);
    };
    await validate();

    const siteCards = await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".action-card")]
      .filter((c) => /extras\.(address|city|state|country|postcode|phone)/.test(c.querySelector(".action-card-field").textContent))
      .map((c) => ({ field: c.querySelector(".action-card-field").textContent.trim(), badge: c.querySelector(".badge")?.textContent, map: Boolean(c.querySelector("button.map")) })));
    assert.equal(siteCards.length, 6, JSON.stringify(siteCards));
    assert.ok(siteCards.every((c) => c.badge === "pending" && !c.map), "every site card is ready to publish with nothing to map");

    const publish = async ({ anyway = false } = {}) => {
      await inPanel((anywayWanted) => {
        const root = document.getElementById("sx-test-root").shadowRoot;
        const anywayInput = [...root.querySelectorAll("label")].find((l) => /Add the site even if one already exists/.test(l.textContent))?.querySelector("input");
        if (anywayInput) anywayInput.checked = anywayWanted;
        for (const card of root.querySelectorAll(".action-card")) {
          const cb = card.querySelector("input[type=checkbox]");
          if (cb) cb.checked = !cb.disabled && /extras\.(address|city|state|country|postcode|phone)/.test(card.querySelector(".action-card-field").textContent);
        }
        [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish and save").click();
      }, anyway);
      await page.waitForTimeout(500);
      for (let i = 0; i < 90; i++) {
        if (await inPanel(() => /Saved \d+ · Already in RTS \d+ · Needs attention \d+/.test(document.getElementById("sx-test-root").shadowRoot.textContent))) break;
        await page.waitForTimeout(500);
      }
      return inPanel(() => document.getElementById("sx-test-root").shadowRoot.textContent.match(/Saved \d+ · Already in RTS \d+ · Needs attention \d+/)?.[0]);
    };
    const site = () => page.evaluate(() => JSON.parse(JSON.stringify({ saves: window.__site.saves, opens: window.__site.opens, form: window.__site.lastForm, sites: window.__site.sites, barClicks: window.__site.barClicks })));

    // 0. Set up Site: what is found, then a try-run that saves nothing.
    await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".card button")].find((b) => b.textContent === "Teach new field").click());
    await page.waitForTimeout(300);
    await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".teach-card button")].find((b) => b.textContent === "Set up").click());
    await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".teach-card button")].find((b) => b.textContent === "Find the Site form").click());
    const cardText = () => inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".teach-card")?.textContent || "");
    for (let i = 0; i < 40 && !/✓ City/.test(await cardText()); i++) await page.waitForTimeout(250);
    assert.match(await cardText(), /✓ Add New Site button/);
    assert.match(await cardText(), /✓ SAVE button/);
    await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".teach-card button")].find((b) => b.textContent === "Try it (nothing is saved)").click());
    for (let i = 0; i < 40 && !/Nothing was saved/.test(await cardText()); i++) await page.waitForTimeout(250);
    assert.match(await cardText(), /The whole form can be filled\. Nothing was saved\./);
    const tried = await page.evaluate(() => ({ saves: window.__site.saves, formShown: document.getElementById("siteForm").style.display !== "none" }));
    assert.deepEqual(tried, { saves: 0, formShown: false });
    await inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".teach-x").click());
    await page.waitForTimeout(300);

    // 1. No site yet: one form, one save, from a collapsed section.
    assert.equal(await publish(), "Saved 1 · Already in RTS 0 · Needs attention 0");
    let state = await site();
    assert.equal(state.saves, 1, "one SAVE for all six fields");
    assert.equal(state.opens, 2, "once while looking (the form stays open for the try-run), once for the real run");
    assert.ok(state.barClicks >= 1, "the Site section was opened");
    assert.deepEqual(state.form, { name: "Texas City", type: "Primary HQ", address1: "12600 Crystal View Blvd.", city: "Texas City", country: "United States", state: "Texas", zip: "77568", phone: "281-941-6001", fax: "", email: "", status: "Current" });

    // 2. The same report again: the site is listed, so nothing is added and it shows as already in RTS.
    await validate();
    assert.equal(await publish(), "Saved 0 · Already in RTS 1 · Needs attention 0");
    state = await site();
    assert.equal(state.saves, 1, "nothing was added");
    assert.equal(state.opens, 2, "the form was not opened again");

    // 3. "Add the site even if one already exists" adds it.
    await validate();
    assert.equal(await publish({ anyway: true }), "Saved 1 · Already in RTS 0 · Needs attention 0");
    state = await site();
    assert.equal(state.saves, 2);
    assert.equal(state.sites.length, 2);

    // 4. The undo ledger lists the site to delete by hand (one line, not six).
    await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll("button")].find((b) => b.textContent === "Undo").click());
    await page.waitForTimeout(500);
    const undoText = await inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".hx-modal.open")?.textContent || "");
    assert.match(undoText, /Texas City/);
    assert.match(undoText, /remove by hand/);
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
