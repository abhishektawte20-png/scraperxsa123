// "Take a break": the game is isolated from the panel, only keeps its level and
// best score, and the panel offers it. The real drawing and play-through are
// covered in tests/e2e/game.test.mjs (jsdom has no canvas).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });

const saved = {};
globalThis.chrome = { storage: { local: { async get(k) { return k in saved ? { [k]: saved[k] } : {}; }, async set(o) { Object.assign(saved, o); } } } };

await import("../content/game.js");
const gameUi = globalThis.SXRTS.gameUi;

function mounted() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const api = gameUi.mount(shadow);
  const root = shadow.querySelector(".sx-game-host");
  return { api, root, game: root.shadowRoot };
}

test("the game lives in its own shadow root, hidden until opened", async () => {
  const { api, root, game } = mounted();
  assert.equal(root.hidden, true);
  assert.ok(game.querySelector(".modal"), "modal in its own shadow root");
  await api.open();
  assert.equal(root.hidden, false);
  assert.equal(game.getElementById("sTitle").hidden, false);
  assert.equal(game.getElementById("sGame").hidden, true);
  api.close();
  assert.equal(root.hidden, true);
});

test("Escape closes it and is not leaked to the page", async () => {
  const { api } = mounted();
  await api.open();
  const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(esc);
  assert.equal(api.debug.isOpen(), false);
  assert.equal(esc.defaultPrevented, true);
  const later = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(later);
  assert.equal(later.defaultPrevented, false, "closed game ignores keys");
});

test("only the level and best score are stored", async () => {
  const { api, game } = mounted();
  await api.open();
  game.querySelector('[data-diff="normal"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved.sxrts_game, { "so-diff": "normal" });
  api.close();
  const again = mounted();
  await again.api.open();
  assert.equal(again.game.querySelector('[data-diff="normal"]').classList.contains("on"), true);
  again.api.close();
});

test("a run code must look like SO-XXXX", async () => {
  const { api, game } = mounted();
  await api.open();
  game.getElementById("codeIn").value = "nonsense";
  game.getElementById("codeGo").click();
  assert.match(game.getElementById("codeMsg").textContent, /does not look right/);
  game.getElementById("codeIn").value = "SO-1A2B";
  game.getElementById("codeGo").click();
  assert.equal(game.getElementById("sIntro").hidden, false);
  api.close();
});

test("the game makes no network calls and touches nothing outside its own shadow root", () => {
  const src = readFileSync(new URL("../content/game.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|sendMessage|WebSocket|sendBeacon/);
  assert.doesNotMatch(src, /document\.(getElementById|querySelector)/);
});

test("the panel offers it and the background injects it before the panel", () => {
  const panel = readFileSync(new URL("../content/panel.js", import.meta.url), "utf8");
  assert.match(panel, /gameUi\?\.mount\(shadow\)/);
  assert.match(panel, /text: "Take a break"/);
  const bg = readFileSync(new URL("../background/background.js", import.meta.url), "utf8");
  assert.ok(bg.indexOf('"content/game.js"') > 0 && bg.indexOf('"content/game.js"') < bg.indexOf('"content/panel.js"'));
});
