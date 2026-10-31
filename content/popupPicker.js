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
    .card { position: fixed; z-index: 2147483647; top: 12px; right: 12px; width: 300px; max-height: calc(100vh - 24px); display: flex; flex-direction: column; overflow: hidden; background: #fff; color: #1b2430; border-radius: 12px; box-shadow: 0 10px 32px rgba(15,30,60,.35); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
    .foot { border-top: 1px solid #e2e6ed; padding: 10px 12px; display: grid; gap: 6px; background: #fff; flex-shrink: 0; }
    details { font-size: 12px; } summary { cursor: pointer; color: #124a80; font-weight: 600; padding: 4px 0; }
    details[open] > .btn { margin-top: 6px; display: block; width: 100%; }
    .head { background: #0b2f52; color: #fff; padding: 10px 12px; font-weight: 600; flex-shrink: 0; }
    .head small { display: block; font-weight: 400; opacity: .8; }
    .body { padding: 10px 12px; display: grid; gap: 8px; overflow-y: auto; min-height: 0; flex: 1; align-content: start; }
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
  function expanderCandidates(host, { includeHidden = false } = {}) {
    const out = [];
    for (const node of document.body.querySelectorAll("img, input[type=image], a, span, i, em, b, button, div, td")) {
      if (host && (node === host || host.contains(node))) continue;
      if (isCheckboxLike(node, host) || node.matches?.(CHECKBOX_LIKE)) continue; // a tick box is never a + button: clicking it would tick it
      if (node.querySelector("input, select, textarea")) continue;
      if (node.children.length > 1 && node.tagName !== "A") continue;
      if (!includeHidden && !shown(node)) continue;
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

  // A choice box: a real checkbox, or one the page draws itself (RTS: div.controls_checkBox).
  const CHECKBOX_LIKE = "input[type=checkbox], [role=checkbox], [class*=checkbox i], [id*=checkbox i]";
  function isCheckboxLike(node, host) {
    if (!node || (host && (node === host || host.contains(node)))) return false;
    if (node.matches?.("input[type=checkbox], [role=checkbox]")) return true;
    if (!node.matches?.(CHECKBOX_LIKE)) return false;
    if (node.querySelector?.("input, select, textarea") || textOf(node)) return false; // a drawn box has no words of its own
    const rect = node.getBoundingClientRect();
    return rect.width <= 40 && rect.height <= 40;
  }
  const classKey = (node) => `${node.tagName}|${Array.from(node.classList).sort().join(" ")}`;
  // The usual look of the choices is "not ticked": the ticked ones are the odd ones out.
  function baseKeyFor(nodes) {
    const counts = new Map();
    for (const node of nodes) counts.set(classKey(node), (counts.get(classKey(node)) || 0) + 1);
    return Array.from(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }

  // The first real words after a node: the name printed beside a + button.
  function nextTextAfter(node) {
    const walker = document.createTreeWalker(document.body, 4);
    walker.currentNode = node;
    let t;
    for (let guard = 0; (t = walker.nextNode()) && guard < 40; guard++) {
      const v = t.nodeValue.replace(/\s+/g, " ").trim();
      if (v && !SYMBOLS.test(v) && t.parentElement && !/^(SCRIPT|STYLE)$/.test(t.parentElement.tagName)) return v;
    }
    return "";
  }

  // What kind of row a choice box sits in: a branch's own box comes straight after its + button, a choice's does not.
  function rowKind(box, expanders) {
    const walker = document.createTreeWalker(document.body, 1 | 4);
    walker.currentNode = box;
    let node = walker.previousNode();
    for (let guard = 0; node && guard < 80; guard++, node = walker.previousNode()) {
      if (node.nodeType === 1) {
        if (node.contains(box)) continue;
        if (expanders.has(node)) return "group";
        if (node.matches?.(CHECKBOX_LIKE)) return "leaf";
      } else if (/\S/.test(node.nodeValue)) return "leaf";
    }
    return "leaf";
  }

  // Finds the choice boxes, the + buttons and the Save button of a window by itself, TESTS the + buttons, and
  // then opens every branch to read the whole list (so what was found can be checked against all of it).
  async function detectTree(sb, host, onProgress = () => {}) {
    const found = { leaf: null, expander: null, saveButton: null, notes: [], summary: [], counts: null };
    const allBoxes = () => Array.from(document.querySelectorAll(CHECKBOX_LIKE)).filter((b) => isCheckboxLike(b, host));
    const innermost = (nodes) => nodes.filter((n) => !nodes.some((m) => m !== n && n.contains(m))); // the frame around a box is not the box
    // The choices only: boxes of branches (which come right after a + button) are left out.
    const choices = () => {
      const exp = new Set(expanderCandidates(host, { includeHidden: true })); // a hidden branch's own box still comes after its + button
      return innermost(allBoxes()).filter((b) => rowKind(b, exp) === "leaf");
    };
    const shownChoices = () => choices().filter(shown);
    const count = () => shownChoices().length + expanderCandidates(host).length;
    const settle = async () => { let last = count(); for (let k = 0; k < 8; k++) { await waitMs(70); const now = count(); if (now === last && k >= 2) return; last = now; } };
    const hadChoices = choices().length > 0;
    const before = new Map(allBoxes().map((b) => [b, classKey(b)])); // detection must never tick or untick anything

    // The + buttons first: a tree that draws its choices only when a branch is opened has none yet.
    const groups = new Map();
    for (const node of expanderCandidates(host)) {
      const i = sb.inspectButton(node, { allowMultiple: true, preferStable: true });
      const key = i.selectors[0];
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { info: i, nodes: [] });
      groups.get(key).nodes.push(node);
    }
    // Branches may come in levels with different ids (sectors, then groups): every group that really opens counts.
    const verified = [];
    for (const [, group] of Array.from(groups).sort((a, b) => b[1].nodes.length - a[1].nodes.length).slice(0, 8)) {
      const node = group.nodes.find((n) => n.isConnected);
      if (!node) continue;
      const before = count();
      node.click();
      await settle();
      if (count() === before) continue;
      verified.push(group.info);
      if (hadChoices || verified.length > 1) { node.click(); await settle(); } // put the branch back as it was
    }
    if (verified.length) found.expander = { ...verified[0], selectors: Array.from(new Set(verified.map((v) => v.selectors[0]))) };

    // Still no choices: open the next + button down, a few levels deep, until choices appear.
    if (found.expander && !choices().length) {
      for (let depth = 0; depth < 8 && !choices().length; depth++) {
        const next = expanderCandidates(host).find((n) => !n.dataset?.sxTried);
        if (!next) break;
        if (next.dataset) next.dataset.sxTried = "1";
        next.click();
        await settle();
      }
    }

    const boxes = choices();
    if (!boxes.length) { found.notes.push("No choice boxes were found in this window, even after opening branches. Press \"Copy this window's structure (for the developer)\" and send it, so this window can be supported."); return found; }
    const info = sb.inspectButton(boxes[0], { allowMultiple: true, preferStable: true });
    const covers = (selector) => { try { return sb.matchAll(selector).length >= Math.ceil(boxes.length * 0.9); } catch { return false; } };
    const native = boxes[0].matches("input[type=checkbox]");
    const good = info.selectors.find(covers);
    const selectors = good ? [good, ...info.selectors.filter((x) => x !== good)] : native ? ['input[type="checkbox"]'] : info.selectors;
    let matched = [];
    try { matched = sb.matchAll(selectors[0]); } catch { matched = boxes; }
    found.leaf = { ...info, selectors, ...(native ? {} : { baseKey: baseKeyFor(matched.length ? matched : boxes) }) };

    const buttons = Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], [role=button], a.btn")).filter((b) => shown(b) && !(host && host.contains(b)));
    const saves = buttons.filter((b) => /^save\b/i.test(textOf(b)));
    if (saves.length === 1) found.saveButton = sb.inspectButton(saves[0], { allowMultiple: true, preferStable: true });
    else found.notes.push(saves.length ? "More than one Save button was found. Pick the right one yourself." : "No Save button was found. Pick it yourself.");

    const realLevels = new Set(); // the + button patterns that really opened something (one per level of the tree)
    // Read the whole list: open every branch once (a branch that was open is opened again if the click closed it).
    if (found.expander) {
      const keyed = () => {
        const seen = {};
        return expanderCandidates(host).map((node) => { const label = nextTextAfter(node); seen[label] = (seen[label] || 0) + 1; return { key: `${label}#${seen[label]}`, node }; });
      };
      const done = new Set();
      const deadline = Date.now() + 90000;
      let opened = 0;
      for (let pass = 0; pass < 40 && Date.now() < deadline; pass++) {
        const fresh = keyed().filter((x) => !done.has(x.key));
        if (!fresh.length) break;
        for (const item of fresh) {
          if (Date.now() > deadline) break;
          const live = keyed().find((x) => x.key === item.key);
          if (!live) continue;
          const before = count();
          const signature = sb.inspectButton(live.node, { allowMultiple: true, preferStable: true }).selectors[0];
          live.node.click();
          await settle();
          done.add(item.key);
          if (signature && count() !== before) realLevels.add(signature);
          if (count() < before) { const again = keyed().find((x) => x.key === item.key); if (again) { again.node.click(); await settle(); } }
          opened++;
          onProgress(`Reading the whole list… ${opened} branches opened, ${choices().length} choices so far.`);
        }
      }
    }
    if (found.expander && realLevels.size > 1) {
      // Levels drawn later (groups inside sectors) have their own ids: keep every level, top level first.
      const firstOf = (sel) => { try { return sb.matchAll(sel)[0] || null; } catch { return null; } };
      const ordered = Array.from(new Set([...found.expander.selectors, ...realLevels])).map((sel) => ({ sel, node: firstOf(sel) })).filter((x) => x.node)
        .sort((a, b) => (a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1)).map((x) => x.sel);
      if (ordered.length) found.expander = { ...found.expander, selectors: ordered };
    }
    const changed = Array.from(before).filter(([b, key]) => b.isConnected && classKey(b) !== key);
    if (changed.length) found.notes.push(`Warning: ${changed.length} box${changed.length === 1 ? "" : "es"} in this window changed while detecting. Close this window WITHOUT pressing Save, and tell the developer.`);
    const total = choices();
    const covered = (() => { try { return sb.matchAll(selectors[0]).length; } catch { return 0; } })();
    found.counts = { choices: total.length, branches: expanderCandidates(host).length, covered };
    found.summary.push(`${total.length} choices in ${found.counts.branches} branches`);
    if (found.expander) found.summary.push("+ buttons tested");
    if (found.saveButton) found.summary.push(`Save button "${found.saveButton.text}"`);
    if (covered < total.length) found.notes.push(`The choice boxes were found, but the pattern covers only ${covered} of ${total.length}. Check with a test publish.`);
    if (!found.expander && !total.every(shown)) found.notes.push("Some choices are hidden but no + button was found. Pick one + button yourself.");
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

    const state = { mode: "form", fields: [], tree: { expander: null, leaf: null }, preSave: [], saveButton: null, error: "", note: "", busy: false, sent: false };
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
      state.busy = true;
      state.note = "Looking at this window…";
      render();
      const found = await detectTree(sb, host, (text) => { state.note = text; render(); });
      state.busy = false;
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
          picked = isCheckboxLike(target, host) ? target : (target.closest("label, li, div")?.querySelector?.(CHECKBOX_LIKE) || target);
          if (!isCheckboxLike(picked, host)) { state.error = "That does not look like a tick box. Click directly on the small box you tick."; return render(); }
        } else {
          picked = sb.resolveButton(target);
        }
        const info = sb.inspectButton(picked, { allowMultiple: true, preferStable: true });
        if (!info.selectors.length) state.error = "No reliable way to find that could be read. Pick a different one.";
        else {
          if (slot === "leaf" && !picked.matches("input[type=checkbox]")) {
            let matched = [];
            try { matched = sb.matchAll(info.selectors[0]); } catch { matched = [picked]; }
            info.baseKey = baseKeyFor(matched.length ? matched : [picked]);
          }
          state.tree[slot] = info;
        }
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
      const foot = el("div", { className: "foot" });
      card.append(body, foot);
      if (state.sent) {
        body.appendChild(el("div", { className: "ok", text: "Sent to ScraperX. Go back to the RTS window to finish the mapping. You can close this window." }));
        return;
      }
      body.appendChild(el("div", { className: "muted", text: "Nothing is typed, ticked or saved while mapping." }));

      body.appendChild(el("h4", { text: "What is in this window?" }));
      const modes = el("div", { className: "modes" });
      for (const [mode, text] of [["form", "A text box"], ["tree", "A tree of checkboxes"]]) {
        const choose = el("button", { className: `btn${state.mode === mode ? "" : " secondary"}`, text, type: "button" });
        choose.addEventListener("click", () => { state.mode = mode; state.error = ""; render(); });
        modes.appendChild(choose);
      }
      body.appendChild(modes);

      const item = (text, remove) => {
        const children = [el("span", { text })];
        if (remove) { const x = el("button", { className: "x", text: "×", type: "button" }); x.addEventListener("click", () => { remove(); render(); }); children.push(x); }
        return el("div", { className: "item" }, children);
      };
      const label = (b) => `${b.text || b.tag} · ${b.selectors?.[0] || "by text"}`;

      if (state.mode === "tree") {
        const auto = el("button", { className: "btn", text: state.busy ? "Reading…" : "Detect automatically (one click)", type: "button", disabled: state.busy });
        auto.addEventListener("click", detect);
        body.appendChild(auto);
        body.appendChild(el("div", { className: "muted", text: "Finds the choice boxes, the + buttons and Save, and opens every branch to read the whole list. Nothing is ticked or saved." }));
        if (state.note) body.appendChild(el("div", { className: "ok", text: state.note }));

        // What was found, in one place. The manual picking below is only for what detection missed.
        const ready = Boolean(state.tree.leaf && state.saveButton);
        const pieces = [
          ["+ button", state.tree.expander ? label(state.tree.expander) : "not needed if the list is already open"],
          ["Choice box", state.tree.leaf ? label(state.tree.leaf) : "not found yet"],
          ["Save", state.saveButton ? label(state.saveButton) : "not found yet"]
        ];
        for (const [name, value] of pieces) body.appendChild(el("div", { className: "item" }, [el("span", { text: `${name}: ${value}` })]));

        const manual = el("details", {});
        if (!ready) manual.open = true;
        manual.appendChild(el("summary", { text: "Pick the parts yourself instead" }));
        const addExpander = el("button", { className: "btn secondary", text: state.tree.expander ? "Re-pick the + button" : "Pick a + button", type: "button" });
        addExpander.addEventListener("click", () => pickTreePart("expander"));
        const addLeaf = el("button", { className: "btn secondary", text: state.tree.leaf ? "Re-pick the choice box" : "Pick a choice box", type: "button" });
        addLeaf.addEventListener("click", () => pickTreePart("leaf"));
        const addSave = el("button", { className: "btn secondary", text: state.saveButton ? "Re-pick the Save button" : "Pick the Save button", type: "button" });
        addSave.addEventListener("click", () => pickButton("save", "Click the Save button (a greyed-out one works too)"));
        manual.append(addExpander, addLeaf, addSave);
        body.appendChild(manual);

        const advanced = el("details", {});
        advanced.appendChild(el("summary", { text: "Advanced" }));
        advanced.append(...list(state.preSave, (i) => state.preSave.splice(i, 1), (b) => `Press first: ${label(b)}`));
        const addPre = el("button", { className: "btn secondary", text: "Pick a button to press before Save", type: "button" });
        addPre.addEventListener("click", () => pickButton("preSave", "Click the button that must be pressed before Save"));
        const share = el("button", { className: "btn secondary", text: "Copy this window's structure (for the developer)", type: "button" });
        share.addEventListener("click", async () => {
          const capture = globalThis.SXRTS.pageCapture;
          // Start from the area around the tree's + buttons (not the whole page), so it is the tree that is copied.
          const plus = expanderCandidates(host)[0];
          const root = plus ? capture.areaAround(plus, 5000, true) : document.body;
          const text = capture ? capture.sanitize(root, { maxChars: 40000 }) : "";
          try { await navigator.clipboard.writeText(`WINDOW STRUCTURE (${location.pathname}; typed values and free text left out)\n${text}`); state.note = "Copied. Paste it to the developer if detection did not work."; }
          catch { state.error = "Copy was blocked by the browser."; }
          render();
        });
        advanced.append(addPre, share);
        body.appendChild(advanced);
      } else {
        body.appendChild(el("h4", { text: "1 · Text box(es) to fill" }));
        body.append(...list(state.fields, (i) => state.fields.splice(i, 1), (f) => `${f.label || f.tag} · ${f.selectors[0]}`));
        const addField = el("button", { className: "btn", text: state.fields.length ? "Pick another box" : "Pick the text box", type: "button" });
        addField.addEventListener("click", pickField);
        body.appendChild(addField);

        body.appendChild(el("h4", { text: "2 · Press before Save (optional)" }));
        body.append(...list(state.preSave, (i) => state.preSave.splice(i, 1), (b) => `${b.text || b.tag} · ${b.selectors[0] || "by text"}`));
        const addPre = el("button", { className: "btn secondary", text: "Pick a button to press first", type: "button" });
        addPre.addEventListener("click", () => pickButton("preSave", "Click the button that must be pressed before Save (for example Show existing data)"));
        body.appendChild(addPre);

        body.appendChild(el("h4", { text: "3 · Save button" }));
        if (state.saveButton) body.appendChild(el("div", { className: "item" }, [el("span", { text: label(state.saveButton) })]));
        const addSave = el("button", { className: "btn secondary", text: state.saveButton ? "Re-pick Save" : "Pick the Save button", type: "button" });
        addSave.addEventListener("click", () => pickButton("save", "Click the Save button (a greyed-out one works too)"));
        body.appendChild(addSave);
      }

      // Always in view: what is still missing, and Done.
      const missing = [];
      if (state.mode === "tree" ? !state.tree.leaf : !state.fields.length) missing.push(state.mode === "tree" ? "a choice box" : "a text box");
      if (!state.saveButton) missing.push("the Save button");
      if (state.error) foot.appendChild(el("div", { className: "err", text: state.error }));
      if (missing.length) foot.appendChild(el("div", { className: "muted", text: `Still needed: ${missing.join(" and ")}.` }));
      const done = el("button", { className: "btn", text: "Done: send to ScraperX", type: "button", disabled: Boolean(missing.length) || state.busy });
      done.addEventListener("click", send);
      foot.appendChild(done);
    }

    render();
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.popupPicker = { start, detectTree, STORAGE_KEY, active: false };
})();
