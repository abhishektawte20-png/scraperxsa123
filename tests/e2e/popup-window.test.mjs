// Real-browser, real-extension test for a field filled in a separate popup
// window (Social Media Identifier -> "New" opens its own Chrome window).
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

async function scenario(mode, teamFile) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-e2e-"));
  const ext = path.join(work, "ext");
  fs.mkdirSync(ext);
  buildExtension(ext, teamFile);
const MAIN = `<!doctype html><body style="font:14px sans-serif">
<span class="flat-button__caption-x1">PBID: PB-1</span>
<h3>Social Media Identifiers</h3>
<div id="sm">
${["Twitter", "Facebook", "Instagram", "LinkedIn"].map((n, i) => n === "LinkedIn"
  ? `<div class="smRow" data-n="${n}" style="margin:4px"><span style="display:inline-block;width:110px">${n}</span> <span>13/03/2026 11:28</span> <input type="button" value="History" class="btn btn_small btn_secondary w_100 buttonHistory"> <input type="button" value="Unlink" class="btn btn_small btn_danger w_100 buttonUnlink"></div>`
  : `<div class="smRow" data-n="${n}" data-id="${i + 1}" style="margin:4px"><span style="display:inline-block;width:110px">${n}</span> <input id="change" type="button" value="New" class="btn btn_small btn_secondary w_100 buttonView"> <input type="button" value="History" class="btn btn_small btn_secondary w_100 buttonHistory" disabled> <input type="button" value="Unlink" class="btn btn_small btn_secondary w_100 buttonUnlink" disabled></div>`).join("\n")}
</div>
<script>
  window.opens = 0;
  for (const b of document.querySelectorAll("#change")) b.addEventListener("click", () => {
    window.opens++;
    const row = b.closest(".smRow");
    window.open("/popup.html?smnId=" + row.dataset.id + "&name=" + row.dataset.n + "&mode=${mode}", "smPopup" + window.opens, "width=700,height=400");
  });
  window.markLinked = (name, value) => {
    const row = document.querySelector('.smRow[data-n="' + name + '"]');
    row.querySelector("#change").remove();
    row.insertAdjacentHTML("beforeend", ' <span>' + new Date().toLocaleString() + '</span>');
    const unlink = row.querySelector(".buttonUnlink"); unlink.disabled = false; unlink.className = "btn btn_small btn_danger w_100 buttonUnlink";
    window.saved = window.saved || {}; window.saved[name] = value;
  };
<\/script></body>`;
const POPUP = `<!doctype html><body style="font:13px sans-serif">
<h3>Create Social Media Identifier</h3>
<label id="lbl" for="identifierText">Name</label> <input id="identifierText" type="text" class="input" value="">
<label>Data After <input type="text" value=""></label>
<label>Review Status <select><option></option><option>Approved</option></select></label>
<p><input id="showExisting" type="button" value="Show existing data" class="btn btn_small"></p>
<p id="msg" style="color:#c00">Please, press Show existing data before Save Identifier</p>
<input id="save" type="button" class="btn buttonSave" data-test-id="social-media-change-tag-save-btn" value="Save Changes" disabled>
<script>
  const q = new URLSearchParams(location.search); const name = q.get("name");
  document.getElementById("lbl").textContent = name; document.title = "Create Social Media Identifier";
  let shown = false; const inp = document.getElementById("identifierText"), save = document.getElementById("save");
  const refresh = () => { save.disabled = !(shown && inp.value.trim()); document.getElementById("msg").style.display = shown ? "none" : ""; };
  document.getElementById("showExisting").addEventListener("click", () => { shown = true; refresh(); });
  inp.addEventListener("input", refresh);
  save.addEventListener("click", () => { window.opener.markLinked(name, inp.value); save.disabled = true; if (q.get("mode") === "close") window.close(); });
<\/script></body>`;
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(req.url.startsWith("/popup.html") ? POPUP : MAIN); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), {
    executablePath: chromiumPath(), headless: false, viewport: { width: 1280, height: 800 },
    args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  try {
    return await drive(ctx, base, { teamFile });
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function drive(ctx, base, { teamFile } = {}) {
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/main.html`);

  // The toolbar icon cannot be clicked from a test, so the panel is injected the
  // way background.js does it, with an open shadow root so the test can reach it.
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
  }, TEXT_SAMPLE);
  await page.waitForTimeout(300);
  let exportedFile = null;
  if (!teamFile) {
    await inPanel(() => {
      const root = document.getElementById("sx-test-root").shadowRoot;
      [...root.querySelectorAll(".action-card")].find((c) => /socialMediaIdentifiers\[0\]/.test(c.querySelector(".action-card-field").textContent)).querySelector("button.map").click();
    });
    await page.waitForTimeout(200);

    // Map: separate window, pick any row's New button (a real click on the page).
    await click("Separate window");
    await click("Pick the button that opens the window");
    await clickAt(page, '.smRow[data-n="Facebook"] #change');
    const note = await inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".teach-note")?.textContent);
    assert.match(note, /Recognised 4 rows/);
    assert.equal(await inPanel(() => window.opens), 0, "picking the button does not click it");

    // Open the window, then pick its parts there.
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
    await pickerClick("Pick the text box"); await clickAt(popup, "#identifierText");
    await pickerClick("Pick a button to press first"); await clickAt(popup, "#showExisting");
    await pickerClick("Pick the Save button"); await clickAt(popup, "#save"); // greyed out, still pickable
    await pickerClick("Done");
    await page.waitForTimeout(500);
    assert.match(await inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".teach-card").textContent), /#identifierText/);
    await popup.close();
    await click("Save mapping");
    await page.waitForTimeout(300);

    // Share it: Export team defaults from the Mapped & taught fields window.
    await click("Teach new field", ".card");
    const downloadPromise = page.waitForEvent("download");
    await click("Export team defaults");
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "teamDefaults.js");
    exportedFile = fs.readFileSync(await download.path(), "utf8");
    await inPanel(() => document.getElementById("sx-test-root").shadowRoot.querySelector(".teach-x").click());
  } else {
    // A researcher with the shipped file: the mapping is already in effect, nothing to map.
    const mapButtons = await inPanel(() => [...document.getElementById("sx-test-root").shadowRoot.querySelectorAll(".action-card")]
      .filter((c) => /socialMediaIdentifiers/.test(c.querySelector(".action-card-field").textContent))
      .map((c) => ({ badge: c.querySelector(".badge")?.textContent, hasMapButton: Boolean(c.querySelector("button.map")) })));
    assert.deepEqual(mapButtons, [{ badge: "pending", hasMapButton: false }, { badge: "pending", hasMapButton: false }]);
  }

  // Publish both social records through the real panel.
  await inPanel(() => {
    const root = document.getElementById("sx-test-root").shadowRoot;
    for (const card of root.querySelectorAll(".action-card")) {
      const box = card.querySelector("input[type=checkbox]");
      if (box) box.checked = /socialMediaIdentifiers/.test(card.querySelector(".action-card-field").textContent);
    }
    const publish = [...root.querySelectorAll("button")].find((b) => b.textContent === "Publish selected to RTS");
    publish.click();
  });
  for (let i = 0; i < 120; i++) {
    if (await inPanel(() => /Published \d/.test(document.getElementById("sx-test-root").shadowRoot.textContent))) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000); // the window closes itself shortly after reporting
  return {
    summary: await inPanel(() => document.getElementById("sx-test-root").shadowRoot.textContent.match(/Published \d+, skipped \d+, failed \d+/)?.[0]),
    saved: await inPanel(() => window.saved),
    rows: await inPanel(() => [...document.querySelectorAll(".smRow")].map((r) => `${r.dataset.n}:${r.querySelector("#change") ? "New" : "linked"}`)),
    openWindows: ctx.pages().filter((p) => p.url().includes("/popup.html")).length,
    exportedFile
  };
}

const expectPublished = (result) => {
  assert.equal(result.summary, "Published 2, skipped 0, failed 0");
  assert.deepEqual(result.saved, { Facebook: "https://www.facebook.com/psyphergames", Instagram: "https://www.instagram.com/psyphergames/" });
  assert.deepEqual(result.rows, ["Twitter:New", "Facebook:linked", "Instagram:linked", "LinkedIn:linked"]);
  assert.equal(result.openWindows, 0, "no popup window is left open");
};

for (const mode of ["close", "stay"]) {
  test(`maps and publishes through a separate popup window (the page ${mode === "close" ? "closes the window itself on Save" : "leaves the window open on Save"})`, { timeout: 150000 }, async () => {
    expectPublished(await scenario(mode));
  });
}

test("a mapping exported by the team lead works from day one for a researcher who maps nothing", { timeout: 300000 }, async () => {
  const lead = await scenario("close");
  expectPublished(lead);
  assert.match(lead.exportedFile, /globalThis\.SXRTS\.teamDefaults/);
  assert.match(lead.exportedFile, /"businessEntity\.socialMediaIdentifiers"/);
  const researcher = await scenario("close", lead.exportedFile);
  expectPublished(researcher);
});
