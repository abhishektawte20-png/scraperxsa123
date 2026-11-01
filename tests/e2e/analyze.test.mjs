// Real Chromium, real extension, real panel: "Analyze page" reads a form, a button's inline form is turned into ONE
// mapping (report names, a fixed relationship, one Save) and the agent's people are published with it; a button that
// opens a separate window is scanned through the worker. Run with: npm run test:e2e

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

function chromiumPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-"));
  return dir ? path.join(root, dir, "chrome-linux", "chrome") : undefined;
}

const MAIN = `<!doctype html><body style="font:14px sans-serif"><span class="flat-button__caption-x1">PBID: PB-1</span>
<div id="mgmt"><h3>Management</h3><ul id="people"></ul>
  <input type="button" id="addPos" class="btn" value="Add New Management Position">
  <input type="button" id="addPerson" class="btn" value="Search Person">
  <form id="posForm" style="display:none"><h3>Management position</h3><table>
    <tr><td>Full name*</td><td><input name="person.fullName"></td></tr>
    <tr><td>Job title</td><td><input name="position.title"></td></tr>
    <tr><td>Relationship*</td><td><select name="position.relationship"><option value=""></option><option value="1">Executive</option><option value="2">Board Member</option></select></td></tr>
  </table><input type="button" id="savePos" value="Save Changes" disabled><input type="button" id="cancelPos" value="Cancel"></form></div>
<script>
  window.s = { opens: 0, saves: 0, last: null };
  const form = document.getElementById("posForm"), save = document.getElementById("savePos");
  const ready = () => { save.disabled = !(form.querySelector('[name="person.fullName"]').value && form.querySelector("select").value); };
  form.addEventListener("input", ready); form.addEventListener("change", ready);
  document.getElementById("addPos").addEventListener("click", () => { window.s.opens++; form.style.display = ""; });
  document.getElementById("cancelPos").addEventListener("click", () => { form.style.display = "none"; });
  document.getElementById("addPerson").addEventListener("click", () => { window.open("/person.html", "personWin", "width=600,height=400"); });
  save.addEventListener("click", () => {
    window.s.saves++;
    window.s.last = { name: form.querySelector('[name="person.fullName"]').value, title: form.querySelector('[name="position.title"]').value, relationship: form.querySelector("select").selectedOptions[0].textContent };
    document.getElementById("people").insertAdjacentHTML("beforeend", "<li>" + window.s.last.name + "</li>");
    form.style.display = "none"; save.disabled = true;
  });
<\/script></body>`;
const PERSON = `<!doctype html><body style="font:14px sans-serif"><h2>Search Person</h2>
<label for="first">First name</label> <input id="first"><br><label for="last">Last name</label> <input id="last"><br>
<input type="button" id="submit" value="Submit"></body>`;

async function scenario(run) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-analyze-"));
  const ext = path.join(work, "ext");
  fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(req.url.startsWith("/person.html") ? PERSON : MAIN); });
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
    const modalText = () => inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".hx-modal.open")?.textContent || "");
    const clickIn = (text, scope = "") => inPanel(({ text, scope }) => { [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(`${scope} button`)].find((b) => b.textContent === text).click(); }, { text, scope });
    const setSelect = (matchOption, value) => inPanel(({ matchOption, value }) => {
      const s = [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".hx-modal.open select")].find((x) => [...x.options].some((o) => o.textContent === matchOption));
      s.value = value; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, { matchOption, value });
    const waitText = async (re, label, timeout = 20000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) { if (re.test(await modalText())) return; await page.waitForTimeout(200); }
      assert.fail(`timed out waiting for ${label}: ${(await modalText()).slice(0, 300)}`);
    };
    await inPanel((text) => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      const area = root.querySelector("#sxrts-response");
      area.value = text;
      area.dispatchEvent(new Event("input", { bubbles: true }));
      [...root.querySelectorAll("button")].find((b) => b.textContent === "Validate JSON").click();
    }, TEXT_SAMPLE);
    await page.waitForTimeout(400);
    return await run({ page, ctx, base, inPanel, modalText, clickIn, setSelect, waitText });
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

test("an inline form is turned into one mapping with Analyze page, and the agent's people are published with it", { timeout: 200000 }, async () => {
  await scenario(async ({ page, inPanel, clickIn, setSelect, waitText }) => {
    await clickIn("Analyze page");
    await page.waitForTimeout(300);
    await clickIn("Scan this page", ".hx-modal.open");
    await waitText(/Add New Management Position/, "the scan");
    assert.equal(await page.evaluate(() => window.s.opens), 0, "scanning pressed nothing");

    const index = await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".hx-modal.open select")].find((s) => [...s.options].some((o) => o.textContent === "Add New Management Position")) && [...[...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".hx-modal.open select")].find((s) => [...s.options].some((o) => o.textContent === "Add New Management Position")).options].findIndex((o) => o.textContent === "Add New Management Position") - 1);
    await setSelect("Add New Management Position", String(index));
    await clickIn("Press it and scan", ".hx-modal.open");
    await waitText(/showed 5 new control/, "the form that opened");
    assert.equal(await page.evaluate(() => window.s.opens), 1);
    // Relationship: always Executive.
    const rel = await inPanel(() => { const rows = [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".hx-modal.open .hx-row")].filter((r) => /→/.test(r.textContent)); return rows.map((r) => r.textContent.slice(0, 20)); });
    assert.equal(rel.length, 3);
    await inPanel(() => { const rows = [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".hx-modal.open .hx-row")].filter((r) => /→/.test(r.textContent)); const s = rows[2].querySelector("select"); s.value = "__fixed"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForTimeout(100);
    await inPanel(() => { const rows = [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".hx-modal.open .hx-row")].filter((r) => /→/.test(r.textContent)); const s = rows[2].querySelectorAll("select")[1]; s.value = "Executive"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await clickIn("Create mapping", ".hx-modal.open");
    await waitText(/Mapped "Management" as one form/, "the mapping");
    await inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".hx-modal.open .hx-x").click());
    await page.waitForTimeout(600);

    // The agent's person is now ready to publish.
    const card = await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".action-card")].filter((c) => /extras\.management/.test(c.querySelector(".action-card-field").textContent)).map((c) => c.querySelector(".badge")?.textContent));
    assert.deepEqual(card, ["pending"]);
    await inPanel(() => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      for (const c of root.querySelectorAll(".action-card")) { const cb = c.querySelector("input[type=checkbox]"); if (cb) cb.checked = !cb.disabled && /extras\.management/.test(c.querySelector(".action-card-field").textContent); }
      [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish and save").click();
    });
    for (let i = 0; i < 60; i++) { if (await inPanel(() => /Saved \d+ · Already in RTS \d+ · Needs attention \d+/.test(document.getElementById("sx-test-root").shadowRoot.textContent))) break; await page.waitForTimeout(500); }
    const summary = await inPanel(() => document.getElementById("sx-test-root").shadowRoot.textContent.match(/Saved \d+ · Already in RTS \d+ · Needs attention \d+/)?.[0]);
    assert.equal(summary, "Saved 1 · Already in RTS 0 · Needs attention 0");
    const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.s)));
    assert.equal(s.saves, 1, "one Save");
    assert.equal(s.last.relationship, "Executive");
    assert.match(s.last.name, /Abhishek Tawte/);
    assert.ok(s.last.title.length > 0, "the title came from the report");
  });
});

test("a button that opens a separate window is scanned through the worker: its boxes are listed, and the window is closed again", { timeout: 120000 }, async () => {
  await scenario(async ({ page, ctx, inPanel, clickIn, setSelect, waitText }) => {
    await clickIn("Analyze page");
    await page.waitForTimeout(300);
    await clickIn("Scan this page", ".hx-modal.open");
    await waitText(/Search Person/, "the scan");
    const index = await inPanel(() => [...[...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".hx-modal.open select")].find((s) => [...s.options].some((o) => o.textContent === "Search Person")).options].findIndex((o) => o.textContent === "Search Person") - 1);
    await setSelect("Search Person", String(index));
    await clickIn("Press it and scan", ".hx-modal.open");
    await waitText(/opened a separate window/, "the window scan", 30000);
    const text = await (async () => inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".hx-modal.open")?.textContent || ""))();
    assert.match(text, /First name/);
    assert.match(text, /Last name/);
    assert.match(text, /Submit/);
    await page.waitForTimeout(1200);
    assert.equal(ctx.pages().filter((p) => p.url().includes("/person.html")).length, 0, "the window was closed again");
  });
});
