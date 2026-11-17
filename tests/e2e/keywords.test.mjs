// Real Chrome, the real extension and the SHIPPED Keywords mapping, against a page that behaves like RTS's Keywords box: words are
// typed, a suggestion list is drawn a moment later, Enter turns the word into a tag, and Save Changes is pressed. All the keywords
// must go in with ONE Save, and every tag must be read back.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { validOutput } from "../helpers/rovo-sample.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromiumPath = () => { const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"; const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-")); return dir ? [path.join(root, dir, "chrome-linux", "chrome"), path.join(root, dir, "chrome-linux64", "chrome")].find((p) => fs.existsSync(p)) : undefined; };

const PAGE = (existing, suggestMs, dropWord, lateMs = 0) => `<!doctype html><body style="font:14px sans-serif"><span class="flat-button__caption-x1">PBID: PB-1</span>
<div id="late-host"></div><template id="kwtpl"><div data-v-1 class="keywords"><div data-v-1 class="keywords__list" id="list">${existing.map((w) => `<div class="element-group base-pill"><div class="element-group__item">${w}</div><div class="element-group__item base-pill__close-icon"><i class="rts-icon-close"></i></div></div>`).join("")}<input placeholder="Enter or paste keywords" class="keywords__input" type="text" maxlength="100" id="kw"></div></div></template>
<div id="suggest" style="display:none"><ul></ul></div>
<button data-test-id="description-keywords-save-btn" class="button_main button_primary-color button_size-default" id="save" disabled>Save Changes</button>
<script>
  window.saves = 0; window.savedTags = [];
  const draw = () => { document.getElementById("late-host").appendChild(document.getElementById("kwtpl").content.cloneNode(true)); wire(); };
  setTimeout(draw, ${lateMs});
  function wire() {
  const input = document.getElementById("kw"), list = document.getElementById("list"), save = document.getElementById("save"), box = document.getElementById("suggest");
  let drawn = "";
  input.addEventListener("input", () => { drawn = ""; box.style.display = "none"; const w = input.value.trim(); if (!w) return; setTimeout(() => { if (input.value.trim() === w) { drawn = w; box.querySelector("ul").innerHTML = "<li>" + w + " (new)</li>"; box.style.display = ""; } }, ${suggestMs}); });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return; e.preventDefault();
    const w = input.value.trim(); if (!w || drawn !== w) return;           // Enter before the suggestion list exists does nothing
    if (w === ${JSON.stringify(dropWord)}) return;                          // this word is never accepted
    const pill = document.createElement("div"); pill.className = "element-group base-pill";
    pill.innerHTML = '<div class="element-group__item">' + w + '</div><div class="element-group__item base-pill__close-icon"><i class="rts-icon-close"></i></div>';
    input.before(pill); input.value = ""; box.style.display = "none"; save.disabled = false;
  });
  save.addEventListener("click", () => { window.saves++; window.savedTags = [...list.querySelectorAll(".base-pill .element-group__item:first-child")].map((n) => n.textContent); save.disabled = true; });
  }
</script></body>`;

async function run({ existing = [], suggestMs = 350, dropWord = "", lateMs = 0 } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-kw-"));
  const ext = path.join(work, "ext"); fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(process.env.SX_PKG || repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.copyFileSync(path.join(repo, "team/teamDefaults.js"), path.join(ext, "core", "teamDefaults.js")); // the shipped mappings
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE(existing, suggestMs, dropWord, lateMs)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), { executablePath: chromiumPath(), headless: false, viewport: { width: 1280, height: 800 }, args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  ctx.on("page", (p) => p.on("dialog", (d) => d.accept())); // a person pressing OK on the confirmation questions
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ sxrts_researcher: "Test.Researcher" }));
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    const files = await worker.evaluate(() => ASSISTANT_FILES.filter((f) => f !== "content/bootstrap.js"));
    const tabId = await worker.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/*` }))[0]?.id, base);
    await worker.evaluate(async ({ tabId, files }) => {
      await chrome.scripting.executeScript({ target: { tabId }, files });
      await chrome.scripting.executeScript({ target: { tabId }, func: () => { const host = document.createElement("section"); host.id = "sx-test-root"; document.documentElement.appendChild(host); globalThis.SXRTS.panel.mount(host.attachShadow({ mode: "open" })); } });
    }, { tabId, files });
    const out = validOutput();
    await page.evaluate((text) => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      root.querySelector("#sxrts-domain").value = "acme.com";
      const area = root.querySelector("#sxrts-response"); area.value = text; area.dispatchEvent(new Event("input", { bubbles: true }));
      [...root.querySelectorAll("button")].find((b) => b.textContent === "Validate JSON").click();
    }, JSON.stringify(out));
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      window.confirm = () => true;
      for (const c of root.querySelectorAll(".action-card")) { const box = c.querySelector("input[type=checkbox]"); if (box) box.checked = /company\.keywords/.test(c.querySelector(".action-card-field").textContent); }
      [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish and save").click();
    });
    const started = Date.now();
    for (let i = 0; i < 180; i++) {
      if (await page.evaluate(() => /Saved \d/.test(document.getElementById("sx-test-root").shadowRoot.textContent))) break;
      await page.waitForTimeout(250);
    }
    const seconds = (Date.now() - started) / 1000;
    const text = await page.evaluate(() => document.getElementById("sx-test-root").shadowRoot.textContent);
    return { summary: text.match(/Saved \d+ · Already in RTS \d+ · Needs attention \d+/)?.[0], saves: await page.evaluate(() => window.saves), tags: await page.evaluate(() => window.savedTags), seconds, text };
  } finally { await ctx.close(); server.close(); fs.rmSync(work, { recursive: true, force: true }); }
}

test("ten keywords: all are added, Save is pressed ONCE, and every tag is read back", { timeout: 240000 }, async () => {
  const r = await run();
  assert.match(r.summary, /Saved 10 · Already in RTS 0 · Needs attention 0/, r.text.slice(-600));
  console.log(`  ten keywords took ${r.seconds.toFixed(1)}s`);
  assert.equal(r.saves, 1, "one Save for ten keywords");
  assert.equal(r.tags.length, 10);
  assert.ok(r.tags.includes("fleet management") && r.tags.includes("transport operators"));
});

test("keywords already in RTS are skipped, the rest go in with one Save", { timeout: 240000 }, async () => {
  const r = await run({ existing: ["fleet management", "vehicle tracking"] });
  assert.match(r.summary, /Saved 8 · Already in RTS 2 · Needs attention 0/, r.text.slice(-600));
  assert.equal(r.saves, 1);
  assert.equal(r.tags.length, 10);
});

test("a keyword RTS never accepts fails on its own; the other nine are saved, once", { timeout: 240000 }, async () => {
  const r = await run({ dropWord: "driver safety" });
  assert.match(r.summary, /Saved 9 · Already in RTS 0 · Needs attention 1/, r.text.slice(-600));
  assert.equal(r.saves, 1);
  assert.ok(!r.tags.includes("driver safety"));
});

test("the Keywords box is drawn 3 seconds late and sits in a closed section: it is waited for, and the keywords still go in with ONE Save", { timeout: 240000 }, async () => {
  const r = await run({ lateMs: 3000 });
  assert.match(r.summary, /Saved 10 · Already in RTS 0 · Needs attention 0/, r.text.slice(-600));
  assert.equal(r.saves, 1);
});
