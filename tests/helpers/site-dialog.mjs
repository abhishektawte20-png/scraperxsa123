// The Site section replica in jsdom.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

import "../../core/identityLock.js";
import "../../core/adapters/textField.js";
import "../../core/adapters/nativeSelect.js";
import "../../core/navigation.js";
import "../../core/selectorBuilder.js";
import "../../registry/company.sites.js";
import "../../registry/index.js";
import "../../core/resultsSummary.js";
import "../../core/workflows/companySite.js";

export const site = globalThis.SXRTS.workflows.companySite;
const pageScript = readFileSync(new URL("./site-page.js", import.meta.url), "utf8");

export function setup(options = {}) {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event, InputEvent: window.InputEvent, KeyboardEvent: window.KeyboardEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // A fresh browser storage for every page: nothing remembered by one test reaches the next.
  const store = new Map();
  global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: JSON.parse(JSON.stringify(store.get(k))) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, JSON.parse(JSON.stringify(v))); }, async remove(k) { store.delete(k); } } } };
  window.eval(pageScript);
  const raw = window.installSitePage(options);
  const state = new Proxy(raw, { get: (target, key) => (Array.isArray(target[key]) ? Array.from(target[key]) : target[key]) });
  Object.assign(site.TIMEOUTS, { open: 400, field: 300, settle: 600, list: 300, poll: 5, section: 300, state: 1500, after: 40, format: 40 });
  return { doc: window.document, state };
}
