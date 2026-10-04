// "Take a break" (Super Over) in a real browser: the real content/game.js is
// mounted, opened, played with a bot that swings on the ring's NOW moment, and
// closed. Canvas drawing, timing, keyboard scoping and preference saving cannot
// be proven in jsdom, which has no canvas.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function openGame(page) {
  await page.setContent('<!doctype html><html><body><input id="outside"></body></html>');
  await page.evaluate(() => {
    const store = {};
    window.__store = store;
    window.chrome = { storage: { local: { async get(k) { return k in store ? { [k]: JSON.parse(JSON.stringify(store[k])) } : {}; }, async set(o) { Object.assign(store, JSON.parse(JSON.stringify(o))); } } } };
  });
  await page.addScriptTag({ path: path.join(repo, "content/game.js") });
  await page.evaluate(() => {
    const host = document.createElement("section");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    window.__game = globalThis.SXRTS.gameUi.mount(shadow);
    window.__host = host;
  });
}

test("Super Over opens, plays a whole run with a bot, saves its preference and closes", { timeout: 150000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await openGame(page);

    const gameHost = () => page.evaluateHandle(() => window.__host.shadowRoot.querySelector(".sx-game-host"));
    const inGame = (fn, arg) => page.evaluate(({ src, arg }) => new Function("sr", "arg", `return (${src})(sr, arg)`)(window.__host.shadowRoot.querySelector(".sx-game-host").shadowRoot, arg), { src: fn.toString(), arg });

    assert.equal(await page.evaluate(() => window.__host.shadowRoot.querySelector(".sx-game-host").hidden), true, "hidden until opened");
    await page.evaluate(() => window.__game.open());
    assert.equal(await page.evaluate(() => window.__host.shadowRoot.querySelector(".sx-game-host").hidden), false);

    await inGame((sr) => sr.querySelector('[data-diff="pro"]').click());
    await inGame((sr) => sr.getElementById("goRandom").click());
    assert.match(await inGame((sr) => sr.getElementById("iNo").textContent), /Match 1 of 3 · .*timing/);
    const spaceTaken = () => page.evaluate(() => { const e = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true, composed: true }); document.body.dispatchEvent(e); return e.defaultPrevented; });
    assert.equal(await spaceTaken(), false, "keys are left alone on the menu screens");
    await inGame((sr) => sr.getElementById("goPlay").click());
    assert.equal(await spaceTaken(), true, "SPACE swings during a match");

    // The bot swings when the ball is LEAD ms from the bat. Pro has the narrowest window, about +/-60 ms.
    await page.evaluate(() => {
      const d = window.__game.debug;
      window.__bot = setInterval(() => {
        const sr = window.__host.shadowRoot.querySelector(".sx-game-host").shadowRoot;
        const G = d.G; if (!G) return;
        if (G.phase === "set") sr.getElementById("bowlNow").click();
        else if ((G.phase === "run" || G.phase === "flight") && G.pressT === null && performance.now() >= G.arriveAt - d.LEAD) d.swing();
        const next = sr.getElementById("rNext");
        if (!sr.getElementById("sResult").hidden && next.dataset.mode !== "again") next.click();
        else if (!sr.getElementById("sIntro").hidden) sr.getElementById("goPlay").click();
      }, 4);
    });

    await page.waitForFunction(() => window.__host.shadowRoot.querySelector(".sx-game-host").shadowRoot.getElementById("rNext").dataset.mode === "again", null, { timeout: 140000, polling: 500 });
    await page.evaluate(() => clearInterval(window.__bot));

    const end = await inGame((sr) => ({ stars: sr.getElementById("rStars").textContent, runs: sr.getElementById("rScore").textContent, code: sr.getElementById("rCode").textContent }));
    assert.match(end.stars, /^\d\/9$/);
    assert.match(end.code, /SO-[0-9A-Z]{4}/);
    assert.ok(Number(end.stars[0]) >= 3, `a perfectly timed bot must win most matches, got ${end.stars}`);

    // The canvas is really drawn on, and the batter is rendered.
    const drawn = await page.evaluate(() => {
      const c = window.__host.shadowRoot.querySelector(".sx-game-host").shadowRoot.getElementById("cv");
      return { w: c.width, h: c.height };
    });
    assert.deepEqual(drawn, { w: 800, h: 400 });

    // Only the level and best score are kept.
    const saved = await page.evaluate(() => window.__store.sxrts_game);
    assert.equal(saved["so-diff"], "pro");
    assert.ok(saved["so-best"] >= 3);
    assert.deepEqual(Object.keys(saved).sort(), ["so-best", "so-diff"]);

    // Escape closes; afterwards keys are left alone and the level is remembered.
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.__game.debug.isOpen()), false);
    assert.equal(await page.evaluate(() => window.__host.shadowRoot.querySelector(".sx-game-host").hidden), true);
    assert.equal(await page.evaluate(() => { const e = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; }), false);
    await page.evaluate(() => window.__game.open());
    assert.equal(await inGame((sr) => sr.querySelector('[data-diff="pro"]').classList.contains("on")), true, "level remembered");
    await inGame((sr) => sr.getElementById("closeGame").click());
    assert.equal(await page.evaluate(() => window.__game.debug.isOpen()), false);

    // Typing in a field inside the game page is not swallowed.
    await page.evaluate(() => window.__game.open());
    await inGame((sr) => sr.getElementById("codeIn").focus());
    await page.keyboard.type("SO-1A2B");
    assert.equal(await inGame((sr) => sr.getElementById("codeIn").value), "SO-1A2B");
    await page.evaluate(() => window.__game.close());

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
