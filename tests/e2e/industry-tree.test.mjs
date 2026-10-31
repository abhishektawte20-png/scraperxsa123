// Real-browser, real-extension test for a field chosen in a tree of checkboxes in a
// separate window (Industry tagging). Loads the unpacked extension, maps the field by
// clicking in the page AND in the window, publishes through the real panel and checks
// what was ticked and saved.
// Loads the unpacked extension into Chromium with host access to 127.0.0.1,
// maps the field by clicking in the page AND in the popup window, then
// publishes through the real panel. Run with: npm run test:e2e

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

function buildExtension(target, teamFile) {
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(target, item), { recursive: true });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  // The file a team lead ships: an exported teamDefaults.js dropped over the empty one.
  if (teamFile) fs.writeFileSync(path.join(target, "core", "teamDefaults.js"), teamFile);
}

async function scenario(mode, code = "2.1.2 — Clothing", { auto = false, teamFile, reuse = false } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-e2e-"));
  const ext = path.join(work, "ext");
  fs.mkdirSync(ext);
  buildExtension(ext, teamFile);
const MAIN = `<!doctype html><body style="font:14px sans-serif">
<span class="flat-button__caption-x1">PBID: PB-1</span>
<h3>Industry Tagging</h3>
<input id="addIndustry" type="button" value="Add/Edit Industry" class="btn btn_secondary" onclick="openIndustries('company', profile.getSection('CMP_IND'))">
<script>
  window.opens = 0; window.industries = []; window.saves = 0;
  window.profile = { getSection: (x) => x };
  // RTS opens this window under a fixed name, so a second press reuses a window that is still open.
  window.openIndustries = () => { window.opens++; window.open("/tree.html?mode=${mode}", "${reuse ? "industryWindow" : "indPopup\" + window.opens + \""}", "width=700,height=500"); };
  window.markIndustry = (names) => { window.industries = names; window.saves++; };
<\/script></body>`;
const GROUPS = [
  { n: "Business Products and Services (B2B)", open: false, kids: [{ n: "Commercial Services", leaves: ["Consulting Services", "Other"] }] },
  { n: "Consumer Products and Services (B2C)", open: true, kids: [
    { n: "Apparel and Accessories", leaves: ["Accessories", "Clothing", "Footwear", "Other"] },
    { n: "Consumer Durables", open: true, leaves: ["Appliances", "Other"] }
  ] },
  { n: "Information Technology", open: false, kids: [{ n: "Software", leaves: ["Application Software", "Other"] }] }
];
// The markup RTS really uses: drawn tick boxes (div.controls_checkBox) and + buttons (div.sub-section__icon-expand).
const TREE = `<!doctype html><body style="font:13px sans-serif"><h3>Select Industries</h3>
<style>ul{list-style:none;margin:0;padding-left:22px} .sub-section__icon-expand{width:11px;height:11px;cursor:pointer;background:#ccc;display:inline-block;vertical-align:middle} .controls_checkBox{width:13px;height:13px;border:1px solid #333;display:inline-block;margin:4px 5px 0 0;vertical-align:middle} .controls_checkBox_on{background:#2a2}</style>
<div style="display:none"><select id="adminsList">${Array.from({ length: 30 }, (_, i) => `<option>staff.member${i}</option>`).join("")}</select></div>
<div id="12848611Content"><ul id="root">${GROUPS.map((g, gi) => `<li><div class="mt_5 sub-section__icon-expand section__icon" id="industryControlGroup${16 + gi}12848611Expander"></div> <span>${g.n}</span><ul style="display:${g.open ? "block" : "none"}">${g.kids.map((k, ki) => `<li><div class="mt_5 sub-section__icon-expand section__icon" id="industryControlGroup${170 + gi * 10 + ki}12848611Expander"></div> <span>${k.n}</span><ul style="display:${k.open ? "block" : "none"}">${k.leaves.map((l, li) => `<li><div class="controls_checkBox" id="industryControlCode${400 + gi * 100 + ki * 10 + li}12848611CheckBox"${k.open ? " data-vis" : ""}></div> <span>${l}</span></li>`).join("")}</ul></li>`).join("")}</ul></li>`).join("")}</ul></div>
<input id="save" type="button" value="Save Changes" class="btn" disabled>
<script>
  const q = new URLSearchParams(location.search);
  const where = (box) => box.closest("ul").closest("li").querySelector(":scope > span").textContent + " > " + box.parentElement.querySelector(":scope > span").textContent;
  for (const box of document.querySelectorAll(".controls_checkBox")) { if ((window.opener.industries || []).includes(where(box))) box.classList.add("controls_checkBox_on"); }
  document.getElementById("root").addEventListener("click", (e) => {
    if (e.target.classList.contains("controls_checkBox")) { e.target.classList.toggle("controls_checkBox_on"); document.getElementById("save").disabled = false; return; }
    const t = e.target.closest(".sub-section__icon-expand"); if (!t) return;
    const list = t.parentElement.querySelector(":scope > ul"); list.style.display = list.style.display === "none" ? "block" : "none";
  });
  document.getElementById("save").addEventListener("click", () => {
    window.opener.markIndustry([...document.querySelectorAll(".controls_checkBox_on")].map(where));
    document.getElementById("save").disabled = true;
    if (q.get("mode") === "close") window.close();
  });
<\/script></body>`;
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(req.url.startsWith("/tree.html") ? TREE : MAIN); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), {
    executablePath: chromiumPath(), headless: false, viewport: { width: 1280, height: 800 },
    args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  try {
    return await drive(ctx, base, code, auto, reuse);
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function drive(ctx, base, code, auto, reuse) {
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
      const button = [...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text) || b.querySelector("b")?.textContent === text);
      if (!button) return null;
      button.scrollIntoView({ block: "center" });
      const r = button.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, { text, scope });
    assert.ok(point, `button "${text}" is on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
  };
  const clickAt = async (pg, selector) => {
    const p = await pg.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
    await pg.mouse.click(p.x, p.y);
    await pg.waitForTimeout(200);
  };

  await inPanel((text) => {
    const root = document.getElementById("sx-test-root").shadowRoot;
    const area = root.querySelector("#sxrts-response");
    area.value = text;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Validate JSON").click();
  }, TEXT_SAMPLE.replace("2.1.2 — Clothing", code));
  await page.waitForTimeout(300);
  await inPanel(() => {
    const root = document.getElementById("sx-test-root").shadowRoot;
    [...root.querySelectorAll(".action-card")].find((c) => /extras\.industryCode/.test(c.querySelector(".action-card-field").textContent)).querySelector("button.map").click();
  });
  await page.waitForTimeout(200);

  await click("Separate window");
  await click("Pick the button that opens the window");
  await clickAt(page, "#addIndustry");
  assert.equal(await inPanel(() => window.opens), 0, "picking the button does not click it");

  const popupPromise = ctx.waitForEvent("page");
  await click("Open the window and pick its fields");
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await popup.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => d.shadowRoot?.querySelector(".card")), null, { timeout: 8000 });
  const pickerClick = async (text) => {
    const p = await popup.evaluate((t) => {
      const host = [...document.querySelectorAll("div")].find((d) => d.shadowRoot?.querySelector(".card"));
      const b = [...host.shadowRoot.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(t));
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text);
    await popup.mouse.click(p.x, p.y);
    await popup.waitForTimeout(150);
  };
  await pickerClick("A tree of checkboxes");
  if (auto) {
    await pickerClick("Detect automatically");
    await popup.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => /^Found:/.test(d.shadowRoot?.querySelector(".ok")?.textContent || "")), null, { timeout: 15000 });
    const note = await popup.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.shadowRoot?.querySelector(".ok")?.textContent).find(Boolean));
    assert.match(note, /choice boxes|checkbox/);
    assert.match(note, /Save button "Save Changes"/);
    assert.match(note, /opening one revealed more choices/);
    assert.equal(await popup.evaluate(() => [...document.querySelectorAll("li > ul")].filter((u) => u.style.display === "none").length), 5, "the branch that was opened to test is closed again");
    assert.equal(await popup.evaluate(() => document.querySelectorAll(".controls_checkBox_on").length), 0, "nothing was ticked while detecting");
    // The developer copy starts at the tree, skips hidden lists, and counts repeated rows.
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    await pickerClick("Copy this window's structure");
    const shared = await popup.evaluate(() => navigator.clipboard.readText());
    assert.match(shared, /^WINDOW STRUCTURE/);
    assert.match(shared, /sub-section__icon-expand/);
    assert.doesNotMatch(shared, /adminsList|staff\.member/, "hidden lists are not copied");
    assert.match(shared, /controls_checkBox/);
  } else {
    await pickerClick("Pick a + button"); await clickAt(popup, ".sub-section__icon-expand");
    await pickerClick("Pick a checkbox"); await clickAt(popup, ".controls_checkBox[data-vis]");
    await pickerClick("Pick the Save button"); await clickAt(popup, "#save"); // greyed out, still pickable
  }
  await pickerClick("Done");
  await page.waitForTimeout(500);
  const card = await inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".teach-card").textContent);
  assert.match(card, /A tree of checkboxes/);
  await popup.close();
  await click("Save mapping");
  await page.waitForTimeout(300);

  if (reuse) {
    // A window for this form is already open (opened by hand); publishing must reuse it, not fail.
    await clickAt(page, "#addIndustry");
    await page.waitForTimeout(500);
    assert.equal(ctx.pages().filter((p) => p.url().includes("/tree.html")).length, 1);
  }
  await inPanel(() => {
    const root = document.getElementById("sx-test-root").shadowRoot;
    for (const c of root.querySelectorAll(".action-card")) {
      const box = c.querySelector("input[type=checkbox]");
      if (box) box.checked = /extras\.industryCode/.test(c.querySelector(".action-card-field").textContent);
    }
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish and save").click();
  });
  for (let i = 0; i < 120; i++) {
    if (await inPanel(() => /Saved \d/.test(document.getElementById("sx-test-root").shadowRoot.textContent))) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);
  return {
    summary: await inPanel(() => document.getElementById("sx-test-root").shadowRoot.textContent.match(/Saved \d+ · Already in RTS \d+ · Needs attention \d+/)?.[0]),
    industries: await inPanel(() => window.industries),
    saves: await inPanel(() => window.saves),
    opens: await inPanel(() => window.opens),
    openWindows: ctx.pages().filter((p) => p.url().includes("/tree.html")).length
  };
}

for (const mode of ["close", "stay"]) {
  test(`maps a tree of checkboxes in a window and publishes the right choice (the page ${mode === "close" ? "closes the window itself on Save" : "leaves the window open on Save"})`, { timeout: 150000 }, async () => {
    const result = await scenario(mode);
    assert.equal(result.summary, "Saved 1 · Already in RTS 0 · Needs attention 0");
    // 2.1.2 is the 2nd branch, 1st group, 2nd choice: Clothing.
    assert.deepEqual(result.industries, ["Apparel and Accessories > Clothing"]);
    assert.equal(result.saves, 1, "saved exactly once");
    assert.equal(result.openWindows, 0, "no window is left open");
    assert.ok(result.opens >= (mode === "close" ? 2 : 1), mode === "close" ? "the window was reopened to read the tick back" : "the window was opened");
  });
}

test("a generic name such as Other is chosen by its code, in the right group, in a real browser", { timeout: 150000 }, async () => {
  const result = await scenario("close", "2.2.2 — Other");
  assert.equal(result.summary, "Saved 1 · Already in RTS 0 · Needs attention 0");
  // 2.2.2 is the 2nd branch, 2nd group (Consumer Durables), 2nd choice: its Other, not Apparel's.
  assert.deepEqual(result.industries, ["Consumer Durables > Other"]);
  assert.equal(result.saves, 1);
});

test("a unique name decides the choice even if the code's position differs", { timeout: 150000 }, async () => {
  const result = await scenario("close", "2.1.2 — Footwear");
  assert.equal(result.summary, "Saved 1 · Already in RTS 0 · Needs attention 0");
  assert.deepEqual(result.industries, ["Apparel and Accessories > Footwear"]);
});

test("a name that is not in the tree publishes nothing", { timeout: 150000 }, async () => {
  const result = await scenario("close", "2.1.9 — Space Tourism");
  assert.match(result.summary, /Saved 0 · Already in RTS 0 · Needs attention 1/);
  assert.deepEqual(result.industries, []);
  assert.equal(result.saves, 0);
});

test("one click detects the checkboxes, the + buttons and Save, and the mapping publishes the right choice", { timeout: 150000 }, async () => {
  const result = await scenario("close", "2.1.2 — Clothing", { auto: true });
  assert.equal(result.summary, "Saved 1 · Already in RTS 0 · Needs attention 0");
  assert.deepEqual(result.industries, ["Apparel and Accessories > Clothing"]);
  assert.equal(result.saves, 1);
});

test("a window for the form that is already open is reused instead of failing with 'No popup window opened'", { timeout: 150000 }, async () => {
  const result = await scenario("stay", "2.1.2 — Clothing", { auto: true, reuse: true });
  assert.equal(result.summary, "Saved 1 · Already in RTS 0 · Needs attention 0");
  assert.deepEqual(result.industries, ["Apparel and Accessories > Clothing"]);
  assert.equal(result.saves, 1);
});
