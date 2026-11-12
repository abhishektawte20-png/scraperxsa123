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

  // The text as a person sees it: a <br> and a block boundary are line breaks (textContent would run the lines together),
  // links and other inline elements contribute their text.
  function readContentEditable(el) {
    if (!el) return "";
    let out = "";
    const BLOCK = /^(DIV|P|LI|UL|OL|TR|TABLE|H[1-6])$/;
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) out += child.nodeValue;
        else if (child.nodeType === 1) {
          if (child.tagName === "BR") out += "\n";
          else {
            const block = BLOCK.test(child.tagName);
            if (block && out && !out.endsWith("\n")) out += "\n";
            walk(child);
            if (block && out && !out.endsWith("\n")) out += "\n";
          }
        }
      }
    };
    walk(el);
    return out;
  }

  // Adds text AFTER what is already in the box without touching it: its links, line breaks and everything else stay as
  // they are. Lines of `text` become text nodes separated by <br>; a blank line before it keeps entries apart.
  async function appendContentEditable(el, text, { blankLineBefore = true } = {}) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();
    await wait(0);
    const hadText = readContentEditable(el).trim() !== "";
    const lines = String(text).split("\n");
    if (hadText && blankLineBefore) { el.appendChild(document.createElement("br")); el.appendChild(document.createElement("br")); }
    lines.forEach((line, index) => {
      if (index > 0) el.appendChild(document.createElement("br"));
      if (line !== "") el.appendChild(document.createTextNode(line));
    });
    const inputEvent = typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text) })
      : new Event("input", { bubbles: true });
    el.dispatchEvent(inputEvent);
    await wait(0);
    el.blur();
    await wait(20);
  }

  function verifyContentEditable(el, expected) {
    return readContentEditable(el).trim() === String(expected).trim();
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.adapters = globalThis.SXRTS.adapters || {};
  globalThis.SXRTS.adapters.contentEditable = { applyContentEditable, appendContentEditable, readContentEditable, verifyContentEditable, setContentEditableValue };
})();
