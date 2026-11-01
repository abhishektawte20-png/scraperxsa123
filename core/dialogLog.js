"use strict";

/*
 * The extension's side of the dialog guard (core/dialogGuardMain.js runs inside the page).
 * begin() switches the guard on for the length of a run; end() switches it off and returns what RTS said.
 */
(() => {
  const root = () => document.documentElement;
  function begin() {
    root().removeAttribute("data-sx-dialogs");
    root().setAttribute("data-sx-run", "1");
  }
  function peek() {
    try { return JSON.parse(root().getAttribute("data-sx-dialogs") || "[]"); } catch { return []; }
  }
  function end() {
    const log = peek();
    root().removeAttribute("data-sx-run");
    return log;
  }
  // The distinct messages RTS showed, each once with how many times.
  function summarize(log) {
    const counts = new Map();
    for (const entry of log) counts.set(entry.message, (counts.get(entry.message) ?? 0) + 1);
    return Array.from(counts, ([message, times]) => ({ message, times }));
  }
  const saw = (pattern, from = 0) => peek().slice(from).some((entry) => pattern.test(entry.message));
  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.dialogLog = { begin, peek, end, summarize, saw };
})();
