"use strict";

/*
 * Safe text/textarea adapter. Uses the native property setter (bypassing any
 * React-controlled wrapper) and dispatches the same input/change lifecycle a
 * real keystroke would produce, matching the technique proven in the
 * Conference ScraperX Field Assistant reference extension.
 */
(() => {
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setNativeValue(control, value) {
    const isTextarea = control instanceof HTMLTextAreaElement;
    const prototype = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (!descriptor?.set) throw new Error("This control cannot be updated safely.");
    descriptor.set.call(control, value);
    const inputEvent = typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) })
      : new Event("input", { bubbles: true });
    control.dispatchEvent(inputEvent);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function applyText(control, value) {
    control.scrollIntoView({ block: "center", inline: "nearest" });
    control.focus({ preventScroll: true });
    await wait(0);
    setNativeValue(control, value);
    await wait(0);
    control.blur();
    await wait(20);
  }

  // The way a person's typing reaches a page: select what is there and insert the text through the browser's own editing command.
  // Pages that rebuild their value from keystrokes (editors that ignore a plain value change) see this as real input.
  async function applyTyped(control, value) {
    control.scrollIntoView({ block: "center", inline: "nearest" });
    control.focus({ preventScroll: true });
    await wait(0);
    try { control.select(); } catch { /* not selectable */ }
    let done = false;
    try { done = Boolean(document.execCommand?.("insertText", false, String(value))); } catch { done = false; }
    if (!done) setNativeValue(control, value);
    await wait(30);
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.blur();
    await wait(60);
  }

  // Waits (at most ms) until the control holds the value: a page may set it back or validate it a moment after the event.
  async function retains(control, expected, ms = 500) {
    const deadline = Date.now() + ms;
    for (;;) {
      if (verifyText(control, expected)) return true;
      if (Date.now() > deadline) return false;
      await wait(40);
    }
  }

  function readText(control) {
    return control?.value ?? "";
  }

  function verifyText(control, expected) {
    return readText(control).trim() === String(expected).trim();
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.adapters = globalThis.SXRTS.adapters || {};
  globalThis.SXRTS.adapters.textField = { setNativeValue, applyText, applyTyped, retains, readText, verifyText };
})();
