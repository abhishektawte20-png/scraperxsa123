// A replica of RTS's "Select NAICS" dialog for jsdom tests. The page itself is
// tests/helpers/naics-page.js, which the real-browser test also serves.

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

import "../../core/identityLock.js";
import "../../core/customFields.js";
import "../../core/selectorBuilder.js";
import "../../core/workflows/customField.js";
import "../../core/workflows/treePicker.js";

export const t = globalThis.SXRTS.workflows.treePicker;
const pageScript = readFileSync(new URL("./naics-page.js", import.meta.url), "utf8");

export function setup(options = {}) {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, Event: window.Event, MouseEvent: window.MouseEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.eval(pageScript);
  const raw = window.installNaicsPage(options);
  // Arrays made inside the jsdom window come from another realm; hand them out as ours.
  const state = new Proxy(raw, { get: (target, key) => (Array.isArray(target[key]) ? Array.from(target[key]) : target[key]) });
  Object.assign(t.TIMEOUTS, { open: 600, settle: 300, choose: 300, button: 300, save: 800, section: 600, poll: 5, search: 30000 });
  return { doc: window.document, state, dlg: window.document.getElementById("dlg") };
}
