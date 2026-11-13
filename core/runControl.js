"use strict";

/*
 * Pause. One switch, kept on this computer, that stops the extension from touching RTS: no clicks, no typing, no windows.
 * The panel checks it before every step of a publish (a publish that is paused part-way stops at the next step), and the
 * background worker refuses to open or drive a window while it is on. Nothing runs in the page until the researcher
 * presses Publish (or Map / Detect / Undo); Pause makes even those refuse.
 */
(() => {
  const KEY = "sxrts_paused";
  let paused = false;
  let touched = false; // set() was called: a slower load() must not overwrite it with an older stored value
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) { try { fn(paused); } catch { /* a listener must not break the others */ } } };

  async function load() {
    let stored = false;
    try { stored = Boolean((await chrome.storage.local.get(KEY))?.[KEY]); } catch { /* no storage: not paused */ }
    if (!touched) paused = stored;
    notify();
    return paused;
  }
  async function set(flag) {
    touched = true;
    paused = Boolean(flag);
    try { await chrome.storage.local.set({ [KEY]: paused }); } catch { /* kept for this page only */ }
    notify();
    return paused;
  }
  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.runControl = { KEY, load, set, isPaused: () => paused, onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
})();
