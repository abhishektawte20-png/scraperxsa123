"use strict";

/*
 * Field picker for a popup window that RTS opened. Injected into that window
 * by the background worker while the researcher is mapping a field. The
 * researcher clicks the text box, any button that must be pressed before
 * Save, and the Save button; the result goes back to the mapping window
 * through chrome.storage.local, keyed by a one-off token.
 */
(() => {
  const STORAGE_KEY = "sxrts_window_pick";
  const CSS = `
    :host { all: initial; }
    .card { position: fixed; z-index: 2147483647; top: 12px; right: 12px; width: 300px; max-height: calc(100vh - 24px); overflow-y: auto; background: #fff; color: #1b2430; border-radius: 12px; box-shadow: 0 10px 32px rgba(15,30,60,.35); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
    .head { background: #0b2f52; color: #fff; padding: 10px 12px; font-weight: 600; }
    .head small { display: block; font-weight: 400; opacity: .8; }
    .body { padding: 10px 12px; display: grid; gap: 8px; }
    .btn { background: #124a80; color: #fff; border: 1px solid #124a80; border-radius: 6px; padding: 6px 10px; font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
    .btn.secondary { background: #fff; color: #124a80; }
    .btn:disabled { opacity: .45; cursor: default; }
    .item { background: #f8fafc; border: 1px solid #e2e6ed; border-radius: 6px; padding: 5px 8px; font-size: 12px; display: flex; justify-content: space-between; gap: 6px; align-items: center; word-break: break-all; }
    .item code { font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
    .x { background: none; border: 0; color: #a3291c; cursor: pointer; font-size: 15px; }
    .err { background: #fdecea; color: #a3291c; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
    .ok { background: #eef7f1; color: #166f4c; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
    h4 { margin: 2px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; color: #124a80; }
    .muted { color: #6b778c; font-size: 12px; }
    .modes { display: flex; gap: 6px; flex-wrap: wrap; }
    .overlay { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; }
    .hl { position: fixed; z-index: 2147483647; pointer-events: none; border: 2px solid #e8590c; background: rgba(232,89,12,.12); border-radius: 3px; display: none; }
    .bar-btn { margin-left: 10px; background: #fff; color: #0b2f52; border: 0; border-radius: 5px; padding: 4px 10px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .bar { position: fixed; z-index: 2147483647; left: 50%; top: 12px; transform: translateX(-50%); background: #0b2f52; color: #fff; padding: 8px 16px; border-radius: 8px; font: 13px -apple-system, "Segoe UI", sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
  `;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.type) node.type = props.type;
    if (props.disabled !== undefined) node.disabled = props.disabled;
    for (const child of children) node.appendChild(child);
    return node;
  }

  // ---- automatic detection of a tree of checkboxes ----
  const SYMBOLS = /^[\s+\-\u2212\u2013\u229E\u229F\u25B6\u25BC\u25BA\u25B8\u25BE]*$/;
  const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const shown = (node) => {
    for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden) return false;
      const style = window.getComputedStyle(n);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  };
  const textOf = (node) => (node.textContent || node.value || "").trim().replace(/\s+/g, " ");

  // Small clickable things with no words of their own: the + and - that open and close branches.
  function expanderCandidates(host) {
    const out = [];
    for (const node of document.body.querySelectorAll("img, input[type=image], a, span, i, em, b, button, div, td")) {
      if (host && (node === host || host.contains(node))) continue;
      if (node.querySelector("input, select, textarea")) continue;
      if (node.children.length > 1 && node.tagName !== "A") continue;
      if (!shown(node)) continue;
      const own = node.tagName === "INPUT" ? "" : textOf(node);
      if (own && !SYMBOLS.test(own)) continue;
      if (node.tagName === "A" && node.getAttribute("href") && !/^(#|javascript:)/i.test(node.getAttribute("href"))) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width > 40 || rect.height > 40) continue;
      const hint = `${node.className} ${node.getAttribute("alt") || ""} ${node.getAttribute("src") || ""} ${node.getAttribute("title") || ""}`;
      const clickable = /^(IMG|BUTTON)$/.test(node.tagName) || node.tagName === "INPUT" || node.hasAttribute("onclick") || /plus|minus|expand|collapse|toggle|tree|node|arrow|caret|open|close/i.test(hint) || window.getComputedStyle(node).cursor === "pointer" || SYMBOLS.test(own) && own;
      if (clickable) out.push(node);
    }
    return out;
  }

  // Finds the checkboxes, the + buttons and the Save button of a window by itself, and TESTS
  // the + buttons by opening one to see whether more choices appear. Returns what it found
  // and plain-language notes about what it could not.
  async function detectTree(sb, host) {
    const found = { leaf: null, expander: null, saveButton: null, notes: [], summary: [] };
    const allBoxes = () => Array.from(document.querySelectorAll("input[type=checkbox]")).filter((b) => !(host && host.contains(b)));
    const boxesShown = () => allBoxes().filter(shown);
    const count = () => boxesShown().length + expanderCandidates(host).length;
    const settle = async () => { let last = count(); for (let k = 0; k < 8; k++) { await waitMs(70); const now = count(); if (now === last && k >= 2) return; last = now; } };
    const hadBoxes = allBoxes().length > 0;

    // The + buttons first: a tree that draws its choices only when a branch is opened has no checkboxes yet.
    const groups = new Map();
    for (const node of expanderCandidates(host)) {
      const i = sb.inspectButton(node, { allowMultiple: true, preferStable: true });
      const key = i.selectors[0];
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { info: i, nodes: [] });
      groups.get(key).nodes.push(node);
    }
    const ordered = Array.from(groups).sort((a, b) => b[1].nodes.length - a[1].nodes.length).slice(0, 6);
    for (const [, group] of ordered) {
      const node = group.nodes.find((n) => n.isConnected);
      if (!node) continue;
      const before = count();
      node.click();
      await settle();
      if (count() === before) continue;
      found.expander = group.info;
      found.summary.push(`+ buttons (${group.nodes.length}; opening one revealed more choices)`);
      if (hadBoxes) { node.click(); await settle(); } // put the branch back as it was
      break;
    }

    // Still no checkboxes: open the next + button down, a few levels deep, until choices appear.
    if (found.expander && !allBoxes().length) {
      for (let depth = 0; depth < 6 && !allBoxes().length; depth++) {
        const next = expanderCandidates(host).find((n) => !n.dataset?.sxTried);
        if (!next) break;
        if (next.dataset) next.dataset.sxTried = "1";
        next.click();
        await settle();
      }
      if (allBoxes().length) found.summary.push("opened branches until the choices appeared");
    }

    const boxes = allBoxes();
    if (!boxes.length) { found.notes.push("No checkboxes were found in this window, even after opening branches. Pick them yourself, or send this window's structure to the developer."); return found; }
    const info = sb.inspectButton(boxes[0], { allowMultiple: true, preferStable: true });
    const covers = (selector) => { try { return sb.matchAll(selector).length >= Math.ceil(boxes.length * 0.9); } catch { return false; } };
    const good = info.selectors.find(covers);
    found.leaf = { ...info, selectors: good ? [good, ...info.selectors.filter((x) => x !== good)] : ['input[type="checkbox"]'] };
    found.summary.unshift(`${boxes.length} checkbox${boxes.length === 1 ? "" : "es"}`);

    const buttons = Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], [role=button], a.btn")).filter((b) => shown(b) && !(host && host.contains(b)));
    const saves = buttons.filter((b) => /^save\b/i.test(textOf(b)));
    if (saves.length === 1) { found.saveButton = sb.inspectButton(saves[0], { allowMultiple: true, preferStable: true }); found.summary.push(`Save button "${textOf(saves[0])}"`); }
    else found.notes.push(saves.length ? "More than one Save button was found. Pick the right one yourself (step 4)." : "No Save button was found. Pick it yourself (step 4).");

    if (!found.expander) {
      if (boxes.every(shown)) found.summary.push("every choice is already visible, so no + button is needed");
      else found.notes.push("Some choices are hidden but no + button was found. Pick one + button yourself (step 1).");
    }
    return found;
  }

  function start(token) {
    if (globalThis.SXRTS.popupPicker.active) return;
    globalThis.SXRTS.popupPicker.active = true;
    const sb = globalThis.SXRTS.selectorBuilder;
    const host = document.createElement("div");
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(el("style", { text: CSS }));

    const state = { mode: "form", fields: [], tree: { expander: null, leaf: null }, preSave: [], saveButton: null, error: "", note: "", sent: false };
    const card = el("div", { className: "card" });
    shadow.appendChild(card);

    function pickElement(message) {
      return new Promise((resolve) => {
        const overlay = el("div", { className: "overlay" });
        const box = el("div", { className: "hl" });
        const label = el("span", { text: `${message}. Press Esc to cancel.` });
        const bar = el("div", { className: "bar" }, [label]);
        // "Let me click first": clicks go through to the page (open a + button,
        // switch a tab) until "Pick now".
        let clickThrough = false;
        const toggle = el("button", { className: "bar-btn", text: "Let me click the page first", type: "button" });
        toggle.addEventListener("click", () => {
          clickThrough = !clickThrough;
          overlay.style.pointerEvents = clickThrough ? "none" : "";
          if (clickThrough) box.style.display = "none";
          label.textContent = clickThrough
            ? "Click the page as you normally would. When the thing you want to pick is on screen, press Pick now."
            : `${message}. Press Esc to cancel.`;
          toggle.textContent = clickThrough ? "Pick now" : "Let me click the page first";
        });
        bar.appendChild(toggle);
        shadow.append(overlay, box, bar);
        card.style.display = "none";
        const targetAt = (event) => {
          overlay.style.pointerEvents = "none";
          const target = document.elementFromPoint(event.clientX, event.clientY);
          overlay.style.pointerEvents = clickThrough ? "none" : "";
          return target && target !== host ? target : null;
        };
        const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
        function finish(target) {
          window.removeEventListener("keydown", onKey, true);
          overlay.remove(); box.remove(); bar.remove();
          card.style.display = "";
          resolve(target);
        }
        function onKey(event) {
          if (event.key === "Escape") { event.preventDefault(); finish(null); }
        }
        overlay.addEventListener("mousemove", (event) => {
          const target = targetAt(event);
          if (!target) { box.style.display = "none"; return; }
          const rect = target.getBoundingClientRect();
          Object.assign(box.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        });
        overlay.addEventListener("click", (event) => { stop(event); const target = targetAt(event); if (target) finish(target); });
        for (const name of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "contextmenu"]) overlay.addEventListener(name, stop);
        window.addEventListener("keydown", onKey, true);
      });
    }

    async function pickField() {
      state.error = "";
      const target = await pickElement("Click the text box or dropdown to fill");
      if (target) {
        const control = sb.resolveControl(target);
        const info = control ? sb.inspectControl(control, { allowMultiple: true, preferStable: true }) : null;
        if (!info) state.error = "That is not a text box or native dropdown. Click directly on the input.";
        else if (info.kind === "unsupported") state.error = info.reason;
        else if (info.needsLabel) state.error = "Nothing about that box can identify it on this form. Pick a different box, or tell the developer which form this is.";
        else state.fields.push(info);
      }
      render();
    }

    // One click: find the checkboxes, + buttons and Save by itself (and test the + buttons).
    async function detect() {
      state.error = "";
      state.note = "Looking at this window…";
      render();
      const found = await detectTree(sb, host);
      if (found.leaf) state.tree.leaf = found.leaf;
      if (found.expander) state.tree.expander = found.expander;
      if (found.saveButton) state.saveButton = found.saveButton;
      state.note = found.summary.length ? `Found: ${found.summary.join("; ")}.` : "";
      state.error = found.notes.join(" ");
      render();
    }

    // Tree mode: a window that is a tree of checkboxes (for example Industry tagging).
    async function pickTreePart(slot) {
      state.error = "";
      const target = await pickElement(slot === "leaf" ? "Click one checkbox (a choice in the list)" : "Click one + button that opens a branch");
      if (target) {
        let picked = target;
        if (slot === "leaf") {
          picked = target.matches?.("input[type=checkbox]") ? target : (target.closest("label")?.querySelector("input[type=checkbox]") || target.closest("li, div")?.querySelector(":scope > input[type=checkbox]") || target);
          if (!(picked.matches?.("input[type=checkbox]"))) { state.error = "That is not a checkbox. Click directly on the box you tick."; return render(); }
        } else {
          picked = sb.resolveButton(target);
        }
        const info = sb.inspectButton(picked, { allowMultiple: true, preferStable: true });
        if (!info.selectors.length) state.error = "No reliable way to find that could be read. Pick a different one.";
        else state.tree[slot] = info;
      }
      render();
    }

    async function pickButton(slot, message) {
      state.error = "";
      const target = await pickElement(message);
      if (target) {
        const info = sb.inspectButton(sb.resolveButton(target), { allowMultiple: true, preferStable: true });
        if (!info.selectors.length && !info.text) state.error = "No reliable way to find that button could be read.";
        else if (slot === "preSave") state.preSave.push(info);
        else state.saveButton = info;
      }
      render();
    }

    function send() {
      const pick = state.mode === "tree"
        ? { path: location.pathname, fields: [], tree: { expander: state.tree.expander, leaf: state.tree.leaf }, preSave: state.preSave, saveButton: state.saveButton }
        : { path: location.pathname, fields: state.fields, preSave: state.preSave, saveButton: state.saveButton };
      chrome.storage.local.set({ [STORAGE_KEY]: { token, at: Date.now(), pick } }).then(() => {
        state.sent = true;
        render();
      });
    }

    function list(items, remove, describe) {
      return items.map((item, i) => {
        const x = el("button", { className: "x", text: "×", type: "button" });
        x.addEventListener("click", () => { remove(i); render(); });
        return el("div", { className: "item" }, [el("span", { text: describe(item) }), x]);
      });
    }

    function render() {
      card.replaceChildren();
      card.appendChild(el("div", { className: "head" }, [document.createTextNode("ScraperX · mapping this window"), el("small", { text: "Developed by Abhishek Tawte" })]));
      const body = el("div", { className: "body" });
      card.appendChild(body);
      if (state.sent) {
        body.appendChild(el("div", { className: "ok", text: "Sent to ScraperX. Go back to the RTS window to finish the mapping. You can close this window." }));
        return;
      }
      body.appendChild(el("div", { className: "muted", text: "Click each part of this form in the order you would use it. Nothing is typed or saved while mapping." }));

      body.appendChild(el("h4", { text: "What is in this window?" }));
      const modes = el("div", { className: "modes" });
      for (const [mode, text] of [["form", "A text box"], ["tree", "A tree of checkboxes"]]) {
        const choose = el("button", { className: `btn${state.mode === mode ? "" : " secondary"}`, text, type: "button" });
        choose.addEventListener("click", () => { state.mode = mode; state.error = ""; render(); });
        modes.appendChild(choose);
      }
      body.appendChild(modes);

      if (state.mode === "tree") {
        const auto = el("button", { className: "btn", text: "Detect automatically (one click)", type: "button" });
        auto.addEventListener("click", detect);
        body.appendChild(auto);
        body.appendChild(el("div", { className: "muted", text: "Finds the checkboxes, the + buttons and Save by itself and tests the + buttons (it opens and closes one branch). Nothing is ticked or saved. Or pick each part yourself below." }));
        if (state.note) body.appendChild(el("div", { className: "ok", text: state.note }));
        const share = el("button", { className: "btn secondary", text: "Copy this window's structure (for the developer)", type: "button" });
        share.addEventListener("click", async () => {
          const capture = globalThis.SXRTS.pageCapture;
          const text = capture ? capture.sanitize(document.body, { maxChars: 30000 }) : "";
          try { await navigator.clipboard.writeText(`WINDOW STRUCTURE (${location.pathname}; typed values and free text left out)\n${text}`); state.note = "Copied. Paste it to the developer if detection did not work."; }
          catch { state.error = "Copy was blocked by the browser."; }
          render();
        });
        body.appendChild(share);
        body.appendChild(el("h4", { text: "1 · A + button (opens a branch)" }));
        if (state.tree.expander) body.appendChild(el("div", { className: "item" }, [el("span", { text: `${state.tree.expander.tag} · ${state.tree.expander.selectors[0]}` })]));
        const addExpander = el("button", { className: "btn secondary", text: state.tree.expander ? "Re-pick the + button" : "Pick a + button", type: "button" });
        addExpander.addEventListener("click", () => pickTreePart("expander"));
        body.appendChild(addExpander);
        body.appendChild(el("div", { className: "muted", text: "Skip this if the whole list is already open." }));

        body.appendChild(el("h4", { text: "2 · A checkbox (a choice)" }));
        if (state.tree.leaf) body.appendChild(el("div", { className: "item" }, [el("span", { text: `${state.tree.leaf.tag} · ${state.tree.leaf.selectors[0]}` })]));
        const addLeaf = el("button", { className: "btn", text: state.tree.leaf ? "Re-pick the checkbox" : "Pick a checkbox", type: "button" });
        addLeaf.addEventListener("click", () => pickTreePart("leaf"));
        body.appendChild(addLeaf);
        body.appendChild(el("div", { className: "muted", text: "Click any one checkbox. The extension finds the right one by the name printed next to it." }));
      } else {
        body.appendChild(el("h4", { text: "1 · Text box(es) to fill" }));
        body.append(...list(state.fields, (i) => state.fields.splice(i, 1), (f) => `${f.label || f.tag} · ${f.selectors[0]}`));
        const addField = el("button", { className: "btn", text: state.fields.length ? "Pick another box" : "Pick the text box", type: "button" });
        addField.addEventListener("click", pickField);
        body.appendChild(addField);
      }

      body.appendChild(el("h4", { text: `${state.mode === "tree" ? 3 : 2} · Press before Save (optional)` }));
      body.append(...list(state.preSave, (i) => state.preSave.splice(i, 1), (b) => `${b.text || b.tag} · ${b.selectors[0] || "by text"}`));
      const addPre = el("button", { className: "btn secondary", text: "Pick a button to press first", type: "button" });
      addPre.addEventListener("click", () => pickButton("preSave", "Click the button that must be pressed before Save (for example Show existing data)"));
      body.appendChild(addPre);

      body.appendChild(el("h4", { text: `${state.mode === "tree" ? 4 : 3} · Save button` }));
      if (state.saveButton) body.appendChild(el("div", { className: "item" }, [el("span", { text: `${state.saveButton.text || state.saveButton.tag} · ${state.saveButton.selectors[0] || "by text"}` })]));
      const addSave = el("button", { className: "btn secondary", text: state.saveButton ? "Re-pick Save" : "Pick the Save button", type: "button" });
      addSave.addEventListener("click", () => pickButton("save", "Click the Save button (a greyed-out one works too)"));
      body.appendChild(addSave);

      if (state.error) body.appendChild(el("div", { className: "err", text: state.error }));
      const done = el("button", { className: "btn", text: "Done: send to ScraperX", type: "button", disabled: !((state.mode === "tree" ? state.tree.leaf : state.fields.length) && state.saveButton) });
      done.addEventListener("click", send);
      body.appendChild(done);
    }

    render();
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.popupPicker = { start, detectTree, STORAGE_KEY, active: false };
})();
