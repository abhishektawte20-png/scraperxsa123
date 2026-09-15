"use strict";

/*
 * Safe adapter for a contenteditable element (used by RTS for e.g.
 * Research Notes). Uses textContent only — never innerHTML — so no HTML
 * from the proposed value can be injected into the page.
 */
(() => {
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setContentEditableValue(el, value) {
    el.textContent = value;
    const inputEvent = typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) })
      : new Event("input", { bubbles: true });
    el.dispatchEvent(inputEvent);
  }

  async function applyContentEditable(el, value) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();
    await wait(0);
    setContentEditableValue(el, value);
    await wait(0);
    el.blur();
    await wait(20);
  }

  function readContentEditable(el) {
    return el?.textContent ?? "";
  }

  function verifyContentEditable(el, expected) {
    return readContentEditable(el).trim() === String(expected).trim();
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.adapters = globalThis.SXRTS.adapters || {};
  globalThis.SXRTS.adapters.contentEditable = { applyContentEditable, readContentEditable, verifyContentEditable, setContentEditableValue };
})();
