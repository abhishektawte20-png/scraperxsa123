// Real Chrome: during a run RTS's own alert/confirm boxes are answered at once and logged, so nobody has to press OK.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromiumPath = () => { const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"; const dir = fs.readdirSync(root).find((d) => d.startsWith("chromium-")); return dir ? [path.join(root, dir, "chrome-linux", "chrome"), path.join(root, dir, "chrome-linux64", "chrome")].find((candidate) => fs.existsSync(candidate)) : undefined; };

test("with the guard on, a page's alert and confirm return at once and are logged; with it off, Chrome's real box appears", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sxrts-dlg-"));
  const ext = path.join(work, "ext"); fs.mkdirSync(ext);
  for (const item of ["manifest.json", "background", "content", "core", "registry", "icons"]) fs.cpSync(path.join(repo, item), path.join(ext, item), { recursive: true });
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = [...manifest.host_permissions, "http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><body>page</body>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), { executablePath: chromiumPath(), headless: false, args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: [DIALOG_GUARD], world: "MAIN" });
    });
    await page.evaluate(() => document.documentElement.setAttribute("data-sx-run", "1"));
    const answers = await page.evaluate(() => ({ a: alert("Another site is already set as Current Primary HQ."), c: confirm("Data is not saved."), d: confirm("Delete the site?") }));
    assert.equal(answers.a, undefined);
    assert.equal(answers.c, true);
    assert.equal(answers.d, false);
    const logged = await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-sx-dialogs")).map((e) => `${e.kind}:${e.answer}`));
    assert.deepEqual(logged, ["alert:OK", "confirm:OK", "confirm:Cancel"]);

    // guard off: the page's own box is shown (Chrome raises a dialog event), so it is not swallowed
    await page.evaluate(() => document.documentElement.removeAttribute("data-sx-run"));
    const seen = new Promise((resolve) => page.once("dialog", async (dialog) => { const text = dialog.message(); await dialog.dismiss(); resolve(text); }));
    page.evaluate(() => { confirm("real box"); });
    assert.equal(await seen, "real box");
  } finally { await ctx.close(); server.close(); }
});
