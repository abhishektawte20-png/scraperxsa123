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

  // The exact inverse of appendContentEditable: finds the nodes that adding `text` made (its text nodes and line breaks, the
  // LAST such run in the box) and, when it was added after other text, the blank-line pair that kept it apart. Nothing else is
  // touched. Returns the nodes to remove, or null when the box does not hold that run (RTS may have rewritten it).
  function findAppendedNodes(el, text) {
    const wanted = [];
    String(text).split("\n").forEach((line, index) => {
      if (index > 0) wanted.push({ br: true });
      if (line !== "") wanted.push({ line });
    });
    if (!wanted.length) return null;
    const kids = Array.from(el.childNodes);
    const same = (node, want) => (want.br ? node.nodeName === "BR" : node.nodeType === 3 && node.data.trim() === want.line.trim());
    for (let start = kids.length - wanted.length; start >= 0; start--) {
      if (!wanted.every((want, i) => same(kids[start + i], want))) continue;
      const nodes = kids.slice(start, start + wanted.length);
      const before = kids.slice(0, start);
      const separator = before.slice(-2);
      const earlierText = before.slice(0, -2).map((n) => n.textContent).join("").trim();
      if (separator.length === 2 && separator.every((n) => n.nodeName === "BR") && earlierText) nodes.unshift(...separator);
      return nodes;
    }
    return null;
  }

  async function removeAppendedContentEditable(el, text) {
    const nodes = findAppendedNodes(el, text);
    if (!nodes) throw new Error("The text this tool added was not found in the box as it was added, so nothing was removed.");
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
    el.focus();
    await wait(0);
    for (const node of nodes) node.remove();
    el.dispatchEvent(typeof InputEvent === "function" ? new InputEvent("input", { bubbles: true, inputType: "deleteContent" }) : new Event("input", { bubbles: true }));
    await wait(0);
    el.blur();
    await wait(20);
  }

  function verifyContentEditable(el, expected) {
    return readContentEditable(el).trim() === String(expected).trim();
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.adapters = globalThis.SXRTS.adapters || {};
  globalThis.SXRTS.adapters.contentEditable = { applyContentEditable, appendContentEditable, findAppendedNodes, removeAppendedContentEditable, readContentEditable, verifyContentEditable, setContentEditableValue };
})();
