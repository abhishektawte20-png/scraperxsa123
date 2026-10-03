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
    .overlay { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; }
    .hl { position: fixed; z-index: 2147483647; pointer-events: none; border: 2px solid #e8590c; background: rgba(232,89,12,.12); border-radius: 3px; display: none; }
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

  function start(token) {
    if (globalThis.SXRTS.popupPicker.active) return;
    globalThis.SXRTS.popupPicker.active = true;
    const sb = globalThis.SXRTS.selectorBuilder;
    const host = document.createElement("div");
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(el("style", { text: CSS }));

    const state = { fields: [], preSave: [], saveButton: null, error: "", sent: false };
    const card = el("div", { className: "card" });
    shadow.appendChild(card);

    function pickElement(message) {
      return new Promise((resolve) => {
        const overlay = el("div", { className: "overlay" });
        const box = el("div", { className: "hl" });
        const bar = el("div", { className: "bar", text: `${message}. Press Esc to cancel.` });
        shadow.append(overlay, box, bar);
        card.style.display = "none";
        const targetAt = (event) => {
          overlay.style.pointerEvents = "none";
          const target = document.elementFromPoint(event.clientX, event.clientY);
          overlay.style.pointerEvents = "";
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
      const pick = { path: location.pathname, fields: state.fields, preSave: state.preSave, saveButton: state.saveButton };
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
      if (state.saveButton) body.appendChild(el("div", { className: "item" }, [el("span", { text: `${state.saveButton.text || state.saveButton.tag} · ${state.saveButton.selectors[0] || "by text"}` })]));
      const addSave = el("button", { className: "btn secondary", text: state.saveButton ? "Re-pick Save" : "Pick the Save button", type: "button" });
      addSave.addEventListener("click", () => pickButton("save", "Click the Save button (a greyed-out one works too)"));
      body.appendChild(addSave);

      if (state.error) body.appendChild(el("div", { className: "err", text: state.error }));
      const done = el("button", { className: "btn", text: "Done: send to ScraperX", type: "button", disabled: !(state.fields.length && state.saveButton) });
      done.addEventListener("click", send);
      body.appendChild(done);
    }

    render();
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.popupPicker = { start, STORAGE_KEY, active: false };
})();
