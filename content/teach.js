"use strict";

/*
 * "Teach new field" mode. The researcher clicks the field (and its Add /
 * Save buttons) directly on the RTS page; the extension reads each
 * element's HTML, builds stable selectors, reads a native dropdown's
 * options, and stores the result as a custom field definition (see
 * core/customFields.js). Nothing here writes to the RTS form.
 */
(() => {
  const CSS = `
    .teach-modal { display: none; position: fixed; z-index: 2147483648; inset: 0; background: rgba(0,0,0,.5); align-items: center; justify-content: center; font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1b2430; }
    .teach-modal.open { display: flex; }
    .teach-card { background: #fff; border-radius: 14px; width: min(640px, 94vw); max-height: 90vh; overflow: auto; padding: 20px 22px; box-shadow: 0 20px 48px rgba(15,30,60,.28); }
    .teach-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e2e6ed; }
    .teach-head h2 { margin: 0; font-size: 16px; }
    .teach-x { background: none; border: 0; font-size: 24px; line-height: 1; color: #7a869c; cursor: pointer; }
    .teach-section { margin: 14px 0; }
    .teach-section h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .3px; color: #124a80; }
    .teach-card label { display: block; font-weight: 600; font-size: 12px; margin: 8px 0 3px; }
    .teach-card input[type=text], .teach-card input:not([type]) { width: 100%; padding: 7px 9px; border: 1px solid #c9d1de; border-radius: 6px; font: inherit; }
    .teach-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .teach-btn { background: #124a80; color: #fff; border: 1px solid #124a80; border-radius: 6px; padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer; }
    .teach-btn.secondary { background: #fff; color: #124a80; }
    .teach-btn.danger { background: #fff; color: #a3291c; border-color: #a3291c; }
    .teach-btn:disabled { opacity: .5; cursor: default; }
    .teach-picked { border: 1px solid #e2e6ed; border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: #f8fafc; }
    .teach-picked .meta { font-size: 12px; color: #4b5870; word-break: break-all; }
    .teach-picked code, .teach-pre { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; }
    .teach-pre { background: #f5f5f7; border: 1px solid #e2e6ed; border-radius: 6px; padding: 8px; max-height: 160px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin: 6px 0 0; }
    .teach-warn { color: #8a5a00; font-size: 12px; }
    .teach-error { background: #fdecea; color: #a3291c; border-radius: 6px; padding: 8px 10px; margin: 10px 0; white-space: pre-wrap; }
    .teach-ok { color: #166f4c; font-size: 12px; }
    .teach-muted { color: #7a869c; font-size: 12px; }
    .teach-item { border: 1px solid #e2e6ed; border-radius: 8px; padding: 10px 12px; margin: 8px 0; display: flex; gap: 10px; align-items: center; justify-content: space-between; }
    .teach-overlay { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; }
    .teach-hl { position: fixed; z-index: 2147483647; pointer-events: none; border: 2px solid #e8590c; background: rgba(232,89,12,.12); border-radius: 3px; display: none; }
    .teach-guide { background: #f2f7fd; border: 1px solid #d5e3f3; border-radius: 10px; padding: 10px 12px; margin: 4px 0 6px; }
    .teach-guide h4 { margin: 0 0 6px; font-size: 12px; color: #0b2f52; }
    .teach-guide ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .teach-guide li { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: #33405a; }
    .teach-guide .n { flex: 0 0 18px; height: 18px; border-radius: 50%; background: #c9d8ea; color: #0b2f52; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .teach-guide li.done .n { background: #1a8a5f; color: #fff; }
    .teach-guide li.done { color: #166f4c; }
    .teach-found { background: #fff8e6; border-left: 3px solid #b8860b; border-radius: 6px; padding: 7px 10px; margin: 6px 0; font-size: 12px; color: #6b5100; word-break: break-word; }
    .teach-bar button { margin-left: 10px; background: #fff; color: #0b2f52; border: 0; border-radius: 5px; padding: 4px 10px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .teach-bar button.ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.6); }
    .teach-section h3.teach-step { margin-top: 16px; }
    .teach-choice { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
    .teach-choice button { text-align: left; background: #fff; color: #1b2430; border: 1.5px solid #c9d1de; border-radius: 8px; padding: 9px 11px; font: inherit; font-size: 12px; cursor: pointer; }
    .teach-choice button b { display: block; font-size: 12.5px; color: #124a80; margin-bottom: 2px; }
    .teach-choice button.on { border-color: #124a80; background: #f2f7fd; box-shadow: 0 0 0 2px rgba(18,74,128,.15); }
    .teach-note { background: #eef7f1; border-left: 3px solid #1a8a5f; border-radius: 6px; padding: 7px 10px; margin: 6px 0; font-size: 12px; color: #166f4c; }
    .teach-bar { position: fixed; z-index: 2147483647; left: 50%; top: 12px; transform: translateX(-50%); background: #0b2f52; color: #fff; padding: 8px 16px; border-radius: 8px; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
  `;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.type) node.type = props.type;
    if (props.value !== undefined) node.value = props.value;
    if (props.placeholder) node.placeholder = props.placeholder;
    if (props.title) node.title = props.title;
    if (props.disabled !== undefined) node.disabled = props.disabled;
    for (const child of children) node.appendChild(child);
    return node;
  }

  // Popups on the page close when they see a click outside themselves, and
  // dialog libraries pull focus back inside a dialog. Our own window must not
  // trigger either, so its pointer and focus events stop here instead of
  // reaching the page's document-level listeners.
  function isolate(node) {
    for (const name of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "click", "focusin", "focusout"]) {
      node.addEventListener(name, (event) => event.stopPropagation());
    }
    return node;
  }

  function mount(shadow, { onChange, onMapped } = {}) {
    const sb = () => globalThis.SXRTS.selectorBuilder;
    const cf = () => globalThis.SXRTS.customFields;

    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);

    const modal = isolate(el("div", { className: "teach-modal" }));
    const card = el("div", { className: "teach-card" });
    modal.appendChild(card);

    let view = "list";
    let draft = null;

    const ui = () => globalThis.SXRTS.ui;
    const tipped = (node, text) => (ui() ? ui().tip(node, text) : node);

    function newDraft() {
      return { kind: "single", label: "", key: "", keyTouched: false, description: "", fields: [], addButton: null, saveButton: null, error: "", bind: null, samples: [], popup: false, openButton: null, closeButton: null, openNote: "", window: false, windowPick: null, rowBy: null, openEl: null };
    }

    // Draft for "Map this field": the report field decides the kind and name.
    function boundDraft(path, samples) {
      const bind = globalThis.SXRTS.outputFields.get(path);
      return { ...newDraft(), kind: bind.kind === "single" ? "single" : "record", label: bind.label, key: globalThis.SXRTS.outputFields.keyFor(path), keyTouched: true, bind, samples };
    }

    function close() {
      modal.classList.remove("open");
    }

    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });

    // ---------- on-page picker ----------
    // A transparent overlay (below the panel, above the page) receives every
    // pointer event, and the element under the pointer is found with
    // elementFromPoint. That is what makes a DISABLED button pickable (the
    // browser sends no click to a disabled control, and RTS Save buttons are
    // disabled until a field is edited), and it keeps the pick clicks away
    // from the page's own handlers.
    // actions: extra buttons on the bar, e.g. "Open the popup" while picking
    // inside one (the overlay blocks the page, so the researcher cannot click
    // the opener themselves).
    function pickElement(message, { actions = [] } = {}) {
      return new Promise((resolve) => {
        const overlay = el("div", { className: "teach-overlay" });
        const box = el("div", { className: "teach-hl" });
        const bar = isolate(el("div", { className: "teach-bar" }, [el("span", { text: `${message} — press Esc to cancel` })]));
        for (const action of actions) {
          const button = el("button", { text: action.label, type: "button" });
          button.addEventListener("click", () => action.run());
          bar.appendChild(button);
        }
        // The panel is moved out of the way while picking: a popup is often
        // centred right underneath it.
        const away = el("style", { text: ".panel { display: none !important; }" });
        shadow.append(overlay, box, bar, away);
        modal.classList.remove("open");

        function targetAt(event) {
          overlay.style.pointerEvents = "none";
          const target = document.elementFromPoint?.(event.clientX, event.clientY) ?? null;
          overlay.style.pointerEvents = "";
          return target && target !== shadow.host ? target : null;
        }
        function onMove(event) {
          const target = targetAt(event);
          if (!target) { box.style.display = "none"; return; }
          const rect = target.getBoundingClientRect();
          Object.assign(box.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        }
        function stop(event) {
          event.preventDefault();
          event.stopPropagation();
        }
        function onClick(event) {
          stop(event);
          const target = targetAt(event);
          if (target) finish(target);
        }
        function onKey(event) {
          if (event.key === "Escape") {
            event.preventDefault();
            finish(null);
          }
        }
        function finish(target) {
          window.removeEventListener("keydown", onKey, true);
          overlay.remove();
          box.remove();
          bar.remove();
          away.remove();
          modal.classList.add("open");
          resolve(target);
        }

        overlay.addEventListener("mousemove", onMove);
        overlay.addEventListener("click", onClick);
        for (const name of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "contextmenu"]) overlay.addEventListener(name, stop);
        window.addEventListener("keydown", onKey, true);
      });
    }

    // Hides this window and the dimmed backdrop so the researcher can use the
    // RTS page themselves (for example to open a popup), then continues when
    // they press Continue. Resolves true on Continue, false on Cancel/Esc.
    function waitForUser(message) {
      return new Promise((resolve) => {
        const go = el("button", { text: "Continue", type: "button" });
        const cancel = el("button", { className: "ghost", text: "Cancel", type: "button" });
        const bar = isolate(el("div", { className: "teach-bar" }, [el("span", { text: message }), go, cancel]));
        const away = el("style", { text: ".panel { display: none !important; }" });
        shadow.append(bar, away);
        modal.classList.remove("open");
        function finish(done) {
          window.removeEventListener("keydown", onKey, true);
          bar.remove();
          away.remove();
          modal.classList.add("open");
          resolve(done);
        }
        function onKey(event) {
          if (event.key === "Escape") finish(false);
        }
        go.addEventListener("click", () => finish(true));
        cancel.addEventListener("click", () => finish(false));
        window.addEventListener("keydown", onKey, true);
      });
    }

    // Clicks the mapped opener for the researcher. Programmatic clicks work
    // for ordinary buttons; if the page ignores one, they can open it
    // themselves with "I'll open it myself".
    function clickOpener() {
      const button = draft.openButton ? sb().resolveButtonByDefinition(draft.openButton) : null;
      if (!button) return false;
      button.click();
      return true;
    }

    // ---------- shared rendering pieces ----------
    function htmlDetails(outerHTML) {
      const pre = el("pre", { className: "teach-pre", text: outerHTML });
      const copy = el("button", { className: "teach-btn secondary", text: "Copy HTML", type: "button" });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(outerHTML);
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Copy blocked";
        }
      });
      const details = el("details", {}, [el("summary", { className: "teach-muted", text: "Show captured HTML" }), copy, pre]);
      return details;
    }

    function pickedBlock(info, extra = []) {
      const lines = [
        el("div", { className: "meta", text: `${info.tag}${info.kind ? ` · ${info.kind === "select" ? "native dropdown" : "text box"}` : ""}${info.label ? ` · "${info.label}"` : ""}` }),
        el("div", { className: "meta" }, [el("code", { text: info.selectors?.[0] || "(matched by button text)" })])
      ];
      if (info.options) lines.push(el("div", { className: "meta", text: `Options (${info.options.length}): ${info.options.map((o) => o.label).join(", ")}` }));
      if (info.fragile) lines.push(el("div", { className: "teach-warn", text: "⚠ No stable attribute found; this selector depends on page structure and may break when RTS changes." }));
      return el("div", { className: "teach-picked" }, [...lines, ...extra, htmlDetails(info.outerHTML)]);
    }

    // ---------- list view ----------
    function foundOnPage(def) {
      // A popup's field only exists while the popup is open, so what can be
      // checked from here is the button that opens it.
      if (def.openButton) return Boolean(sb().resolveButtonByDefinition(def.openButton));
      const controls = def.fields.every((field) => sb().resolveFirst(field.selectors));
      const save = sb().resolveButtonByDefinition(def.saveButton);
      return controls && Boolean(save);
    }

    function renderList() {
      card.replaceChildren();
      const close_ = el("button", { className: "teach-x", text: "×", type: "button", title: "Close" });
      close_.addEventListener("click", close);
      card.appendChild(el("div", { className: "teach-head" }, [el("h2", { text: "Mapped & taught fields" }), close_]));

      const teachBtn = tipped(el("button", { className: "teach-btn", text: "Teach new field", type: "button" }), "Add a brand-new RTS field that is not in the agent's report yet. To fill a field the agent already researched, use \"Map this field\" on its row in the preview instead.");
      teachBtn.addEventListener("click", () => { draft = newDraft(); view = "wizard"; render(); });
      card.appendChild(el("div", { className: "teach-row" }, [teachBtn]));
      card.appendChild(el("p", { className: "teach-muted", text: "Mappings tell the extension where an agent value goes in RTS. They are saved in this browser only." }));

      const defs = cf().getCached();
      if (!defs.length) {
        card.appendChild(el("p", { className: "teach-muted", text: "Nothing mapped yet. Click \"Map this field\" on a row marked Waiting for RTS mapping." }));
        return;
      }
      for (const def of defs) {
        const found = foundOnPage(def);
        const remove = el("button", { className: "teach-btn danger", text: "Delete", type: "button" });
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Delete "${def.label}"?`)) return;
          await cf().removeDefinition(def.key);
          onChange?.();
          render();
        });
        card.appendChild(el("div", { className: "teach-item" }, [
          el("div", {}, [
            el("div", { text: def.binds ? `${def.label}  ·  mapped from the agent's report` : `${def.label}  ·  custom.${def.key}` }),
            el("div", { className: "teach-muted", text: `${def.window ? (def.kind === "record" ? "List filled in a separate window" : "Single field in a separate window") : def.kind === "record" ? "Repeatable record" : def.openButton ? "Single field in a popup" : "Single field"} · ${def.fields.length} field(s)` }),
            el("div", { className: found ? "teach-ok" : "teach-warn", text: def.openButton
              ? (found ? `✓ Popup button "${def.openButton.text || "(no text)"}" found on this page` : "Popup button not found on this page (open the right tab/section)")
              : (found ? "✓ Found on this page" : "Not found on this page (open the right tab/section)") })
          ]),
          remove
        ]));
      }
    }

    // ---------- wizard view ----------
    function uniqueKey(base) {
      const clean = base && cf().KEY_PATTERN.test(base) ? base : "field";
      let key = clean;
      let n = 2;
      while (draft.fields.some((f) => f.key === key)) key = `${clean}${n++}`;
      return key;
    }

    async function pickField() {
      draft.error = "";
      const target = await pickElement(draft.kind === "record" ? "Click a text box or dropdown in the row" : draft.popup ? "Click the text box or dropdown inside the popup" : "Click the text box or dropdown to fill", { actions: popupActions() });
      if (!target) return render();
      const control = sb().resolveControl(target);
      if (!control) {
        draft.error = "That isn't a text box or native dropdown. Click directly on the input you want to fill.";
        return render();
      }
      const info = sb().inspectControl(control, { allowMultiple: draft.kind === "record" });
      if (info.kind === "unsupported") {
        draft.error = info.reason;
        return render();
      }
      const outKeys = draft.bind?.keys.map((k) => k.key) ?? [];
      if (draft.kind === "single") {
        draft.fields = [{ ...info, key: "value", description: "", out: outKeys[0] }];
      } else {
        const unused = outKeys.find((k) => !draft.fields.some((f) => f.out === k)) ?? outKeys[0];
        draft.fields.push({ ...info, key: uniqueKey(info.suggestedKey), description: "", out: unused });
      }
      if (!draft.bind) {
        if (!draft.label && info.label) draft.label = info.label.slice(0, 60);
        if (!draft.keyTouched && !draft.key) draft.key = sb().toCamelKey(draft.label);
      }
      render();
    }

    async function pickButton(slot, message) {
      draft.error = "";
      const target = await pickElement(message, { actions: slot === "openButton" ? [] : popupActions() });
      if (!target) return render();
      const button = sb().resolveButton(target);
      // A button that exists once per row (a "New" button in every network
      // row) must be recognised in every row, not just the one clicked.
      const rows = slot === "openButton" && draft.window && draft.bind?.rowKey;
      const info = sb().inspectButton(button, rows ? { allowMultiple: true, preferStable: true } : {});
      if (!info.selectors.length && !info.text) {
        draft.error = "No reliable selector or visible text could be read from that button.";
        return render();
      }
      if (rows) {
        const found = sb().inspectRow(button, info.selectors);
        if (!found) {
          draft.error = "The rows could not be told apart from this button. Pick the same kind of button in a row that is still open (for example a \"New\" button), or send the row's HTML to the developer.";
          return render();
        }
        draft.rowBy = { outKey: draft.bind.rowKey, rowSelector: found.selector };
        draft.openNote = `Recognised ${found.count} rows. The extension picks the row by its name (for example the network) when it publishes.`;
      } else if (slot === "openButton") {
        draft.openNote = "";
      }
      draft[slot] = info;
      if (slot === "openButton") draft.openEl = button;
      draft.windowPick = slot === "openButton" ? null : draft.windowPick;
      render();
      if (slot === "openButton" && !draft.window) await openNow();
    }

    // Opens the separate popup window from the picked button and has the
    // background worker put a field picker into it. The picks come back
    // through chrome.storage.local, keyed by a one-off token.
    function startWindowPick() {
      draft.error = "";
      if (!draft.openEl?.isConnected) {
        draft.error = "The opening button is no longer on the page. Pick it again.";
        return render();
      }
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const listener = (changes, area) => {
        const value = area === "local" ? changes[globalThis.SXRTS.popupPicker?.STORAGE_KEY || "sxrts_window_pick"]?.newValue : null;
        if (value?.token !== token) return;
        chrome.storage.onChanged.removeListener(listener);
        applyWindowPick(value.pick);
      };
      let port;
      try {
        port = chrome.runtime.connect({ name: "sx-window" });
      } catch {
        draft.error = "The extension connection is not available. Reload the extension and the RTS page.";
        return render();
      }
      chrome.storage.onChanged.addListener(listener);
      const stop = (message) => {
        chrome.storage.onChanged.removeListener(listener);
        draft.error = message;
        draft.openNote = "";
        try { port.disconnect(); } catch { /* closed */ }
        render();
      };
      port.onMessage.addListener((message) => {
        if (message.type === "armed") draft.openEl.click();
        else if (message.type === "picker-open") {
          draft.openNote = "The window opened with a ScraperX box in its top-right corner. Click the parts of the form there, press Done, then come back to this window.";
          render();
        } else if (message.type === "error") stop(message.error);
      });
      draft.openNote = "Opening the window…";
      render();
      port.postMessage({ type: "start", mode: "pick", token, origin: window.location.origin });
    }

    // Out keys a window input can take: the row's name (network) is used to
    // find the row, never typed into an input.
    function windowOutKeys() {
      return draft.bind ? draft.bind.keys.filter((k) => k.key !== draft.bind.rowKey) : [];
    }

    function applyWindowPick(pick) {
      draft.openNote = "";
      const outs = windowOutKeys().map((k) => k.key);
      const taken = new Set();
      const fields = pick.fields.map((info, i) => {
        const key = draft.kind === "single" ? "value" : (() => {
          let base = info.suggestedKey && cf().KEY_PATTERN.test(info.suggestedKey) ? info.suggestedKey : "field";
          let candidate = base;
          for (let n = 2; taken.has(candidate); n++) candidate = `${base}${n}`;
          return candidate;
        })();
        taken.add(key);
        return { ...info, key, description: "", out: outs[i] ?? outs[0] };
      });
      draft.windowPick = { ...pick, fields };
      if (!draft.bind && fields[0] && !draft.label && fields[0].label) draft.label = fields[0].label.slice(0, 60);
      render();
    }

    // While picking inside a popup the page is covered, so the bar offers a
    // way to bring the popup back if it closed.
    function popupActions() {
      return draft.popup && draft.openButton ? [{ label: "Open the popup", run: clickOpener }] : [];
    }

    async function openNow() {
      draft.error = "";
      if (!clickOpener()) {
        draft.error = "The opening button was not found on the page any more. Pick it again.";
        return render();
      }
      draft.openNote = "Clicked it for you. If the popup is now open on the page, pick the field inside it next. If nothing opened, use \"I'll open it myself\".";
      render();
    }

    async function openMyself() {
      draft.error = "";
      const done = await waitForUser("Open the popup on the RTS page yourself, then press Continue");
      if (done) draft.openNote = "Good. The popup is open: pick the field inside it next.";
      render();
    }

    async function save() {
      if (draft.window) return saveWindow();
      if (draft.popup && !draft.openButton) {
        draft.error = "Pick the button that opens the popup first, or choose \"Directly on the page\".";
        return render();
      }
      const def = {
        key: draft.key.trim(),
        label: draft.label.trim(),
        description: draft.description.trim(),
        kind: draft.kind,
        fields: draft.fields.map((f) => ({
          key: f.key, label: f.label || f.key, description: f.description || "", kind: f.kind, selectors: f.selectors,
          ...(f.kind === "select" ? { options: f.options } : {})
        })),
        saveButton: draft.saveButton ? { selectors: draft.saveButton.selectors, text: draft.saveButton.text } : null,
        ...(draft.kind === "single" && draft.popup && draft.openButton ? { openButton: { selectors: draft.openButton.selectors, text: draft.openButton.text } } : {}),
        ...(draft.kind === "single" && draft.popup && draft.openButton && draft.closeButton ? { closeButton: { selectors: draft.closeButton.selectors, text: draft.closeButton.text } } : {}),
        ...(draft.kind === "record" && draft.addButton ? { addButton: { selectors: draft.addButton.selectors, text: draft.addButton.text } } : {}),
        ...(draft.bind ? { binds: { path: draft.bind.path, map: Object.fromEntries(draft.fields.map((f) => [f.key, f.out])) } } : {})
      };
      return commit(def);
    }

    // Validates and stores a finished definition, then leaves the wizard.
    async function commit(def) {
      const errors = cf().validateDefinition(def);
      if (errors.length) {
        draft.error = errors.join("\n");
        return render();
      }
      try {
        await cf().saveDefinition(def);
      } catch (error) {
        draft.error = error.message;
        return render();
      }
      onChange?.();
      if (draft.bind) {
        // Mapping a field from its preview row: get out of the way so the
        // researcher can carry on with the preview.
        const label = draft.bind.label;
        close();
        onMapped?.(label);
        return;
      }
      view = "list";
      render();
    }

    async function saveWindow() {
      const pick = draft.windowPick;
      if (!draft.openButton) draft.error = "Pick the button that opens the window first.";
      else if (!pick?.fields.length || !pick.saveButton) draft.error = "Open the window and pick its text box and Save button first.";
      else if (draft.kind === "single" && pick.fields.length !== 1) draft.error = "A single field fills one box. Remove the extra boxes you picked in the window.";
      else if (draft.kind === "record" && !draft.rowBy) draft.error = "The rows were not recognised. Pick the opening button again.";
      if (draft.error) return render();
      const button = (b) => ({ selectors: b.selectors, text: b.text });
      draft.error = "";
      const def = {
        key: draft.key.trim(),
        label: draft.label.trim(),
        description: draft.description.trim(),
        kind: draft.kind,
        fields: pick.fields.map((f) => ({
          key: f.key, label: f.label || f.key, description: "", kind: f.kind, selectors: f.selectors,
          ...(f.kind === "select" ? { options: f.options } : {})
        })),
        saveButton: button(pick.saveButton),
        openButton: button(draft.openButton),
        window: { path: pick.path, preSave: pick.preSave.map(button) },
        ...(draft.kind === "record" ? { rowBy: draft.rowBy } : {}),
        ...(draft.bind ? { binds: { path: draft.bind.path, map: Object.fromEntries(pick.fields.map((f) => [f.key, f.out])) } } : {})
      };
      return commit(def);
    }

    function textInput(value, placeholder, onInput) {
      const input = el("input", { type: "text", value, placeholder });
      input.addEventListener("input", () => onInput(input.value));
      return input;
    }

    function windowSteps() {
      return [
        { done: Boolean(draft.openButton), text: draft.bind?.rowKey ? "Pick the button that opens the window in any one row (for example a \"New\" button). The extension finds the right row by its name later." : "Pick the button that opens the window." },
        { done: Boolean(draft.windowPick), text: "Press \"Open the window and pick its fields\". In the window, click the text box, any button to press before Save, and Save, then press Done." },
        { done: false, text: "Come back to this window, check the mapping, and save it." }
      ];
    }

    // The extra guide step shown when the field sits inside a popup.
    function popupSteps() {
      return draft.popup ? [{ done: Boolean(draft.openButton), text: "Pick the button that opens the popup. The extension then opens it for you." }] : [];
    }

    function guide(steps) {
      return el("div", { className: "teach-guide" }, [
        el("h4", { text: "How this works" }),
        el("ol", {}, steps.map((step, i) => el("li", { className: step.done ? "done" : "" }, [el("span", { className: "n", text: step.done ? "✓" : String(i + 1) }), el("span", { text: step.text })])))
      ]);
    }

    // Where is the field? On the page itself, inside a popup on the page
    // (single fields), or in a separate browser window that a button opens
    // (single fields, and lists whose rows each have such a button).
    function placeControls() {
      const section = el("div", { className: "teach-section" });
      const rowWindow = draft.kind === "record" && Boolean(draft.bind?.rowKey);
      if (draft.kind !== "single" && !rowWindow) return document.createDocumentFragment();
      section.appendChild(el("h3", { text: "Where is the field?" }));
      const choice = (on, title, text, tip) => tipped(el("button", { className: on ? "on" : "", type: "button" }, [el("b", { text: title }), el("span", { text })]), tip);
      const mode = draft.window ? "window" : draft.popup ? "popup" : "page";
      const options = [
        ["page", "Directly on the page", rowWindow ? "A row has an Add button and its boxes appear on the page." : "You can see the field without clicking anything.", "Choose this when the text box is on the RTS page itself."]
      ];
      if (!rowWindow) options.push(["popup", "Inside a popup", "A button opens a small box on the same page.", "Choose this when you click a button and a box appears on top of the same RTS page, where you type the value and press Save."]);
      options.push(["window", "Separate window", "A button opens a new browser window.", "Choose this when you click a button and a new Chrome window opens (it has its own address bar and title), where you type the value and press Save."]);
      const set = (value) => {
        draft.popup = value === "popup";
        draft.window = value === "window";
        if (value === "page") { draft.openButton = null; draft.closeButton = null; draft.openNote = ""; draft.openEl = null; draft.rowBy = null; draft.windowPick = null; }
        if (value !== "popup") draft.closeButton = null;
        if (value !== "window") { draft.rowBy = null; draft.windowPick = null; }
        render();
      };
      const buttons = options.map(([id, title, text, tip]) => {
        const button = choice(mode === id, title, text, tip);
        button.addEventListener("click", () => set(id));
        return button;
      });
      section.appendChild(el("div", { className: "teach-choice" }, buttons));
      if (mode === "page") return section;

      const noun = mode === "window" ? "window" : "popup";
      const openBtn = tipped(el("button", { className: "teach-btn secondary", text: draft.openButton ? "Re-pick the opening button" : `Pick the button that opens the ${noun}`, type: "button" }),
        mode === "window" && draft.bind?.rowKey
          ? "Click this, then click the button in ONE row that opens the window (for example the \"New\" button of any network). The extension recognises the same button in every row and picks the right row by its name when it publishes."
          : `Click this, then click the button on the RTS page that opens the ${noun}.`);
      openBtn.addEventListener("click", () => pickButton("openButton", `Click the button that opens the ${noun}`));
      section.appendChild(el("h3", { className: "teach-step", text: `Step A · The button that opens the ${noun}` }));
      section.appendChild(el("div", { className: "teach-row" }, [openBtn]));
      if (!draft.openButton) return section;
      section.appendChild(pickedBlock({ ...draft.openButton, kind: null, label: draft.openButton.text }));

      if (mode === "window") {
        if (draft.openNote) section.appendChild(el("div", { className: "teach-note", text: draft.openNote }));
        return section;
      }
      const now = tipped(el("button", { className: "teach-btn", text: "Open the popup now", type: "button" }), "The extension clicks the opening button for you. Use this again any time the popup has closed.");
      now.addEventListener("click", openNow);
      const mine = tipped(el("button", { className: "teach-btn secondary", text: "I'll open it myself", type: "button" }), "Hides this window so you can click the button on the page yourself. Press Continue when the popup is open.");
      mine.addEventListener("click", openMyself);
      section.appendChild(el("div", { className: "teach-row" }, [now, mine]));
      if (draft.openNote) section.appendChild(el("div", { className: "teach-note", text: draft.openNote }));
      return section;
    }

    // Step B for a separate window: open it, let the researcher click its
    // parts there, then show and finish the mapping here.
    function windowControls() {
      const section = el("div", { className: "teach-section" }, [el("h3", { className: "teach-step", text: "Step B · Pick the parts of the window" })]);
      if (!draft.openButton) {
        section.appendChild(el("p", { className: "teach-muted", text: "Pick the opening button first." }));
        return section;
      }
      const open = tipped(el("button", { className: "teach-btn", text: draft.windowPick ? "Open the window and pick again" : "Open the window and pick its fields", type: "button" }),
        "The extension clicks the opening button for you. The window opens with a small ScraperX box in its top-right corner: click the text box, any button that must be pressed before Save, and the Save button there, then press Done.");
      open.addEventListener("click", startWindowPick);
      section.appendChild(el("div", { className: "teach-row" }, [open]));
      section.appendChild(el("p", { className: "teach-muted", text: "If no window opens, Chrome blocked it: allow pop-ups for rts.pitchbook.com in Chrome's site settings." }));

      const pick = draft.windowPick;
      if (!pick) return section;
      const outs = windowOutKeys();
      for (const [index, field] of pick.fields.entries()) {
        const extra = [];
        if (draft.bind && draft.kind === "record") {
          const select = el("select");
          for (const key of outs) select.appendChild(el("option", { value: key.key, text: key.label }));
          select.value = field.out;
          select.addEventListener("change", () => { field.out = select.value; });
          extra.push(tipped(el("label", { text: "Which agent value goes into this box?" }), "Each box of the window takes one value from the agent's report. Choose which one belongs here."), select);
        }
        const remove = el("button", { className: "teach-btn danger", text: "Remove", type: "button" });
        remove.addEventListener("click", () => { pick.fields.splice(index, 1); render(); });
        extra.push(el("div", { className: "teach-row" }, [remove]));
        section.appendChild(pickedBlock(field, extra));
      }
      for (const button of pick.preSave) section.appendChild(pickedBlock({ ...button, kind: null, label: `Pressed before Save: ${button.text}` }));
      if (pick.saveButton) section.appendChild(pickedBlock({ ...pick.saveButton, kind: null, label: `Save: ${pick.saveButton.text}` }));
      return section;
    }

    // The part of the wizard that picks fields: the page itself, or the window.
    function controlsSections() {
      if (draft.window) return [windowControls()];
      return [pickControls(), saveControls()];
    }

    function pickControls() {
      const section = el("div", { className: "teach-section" }, [el("h3", { text: draft.kind === "record" ? "Pick the Add button, then each input of a row" : draft.popup ? "Step B · Pick the field inside the popup" : "Pick the field in RTS" })]);
      if (draft.kind === "record") {
        const addBtn = tipped(el("button", { className: "teach-btn secondary", text: draft.addButton ? "Re-pick Add button" : "Pick Add button", type: "button" }),
          "Click this, then click the button on the RTS page that adds a new row (for example \"Add New ...\"). The extension clicks it for every item it needs to add.");
        addBtn.addEventListener("click", () => pickButton("addButton", "Click the Add button that creates a new row"));
        section.appendChild(el("div", { className: "teach-row" }, [addBtn]));
        if (draft.addButton) section.appendChild(pickedBlock({ ...draft.addButton, kind: null, label: draft.addButton.text }));
      }
      for (const [index, field] of draft.fields.entries()) {
        const extra = [];
        if (draft.bind && draft.kind === "record") {
          const select = el("select");
          for (const key of draft.bind.keys) select.appendChild(el("option", { value: key.key, text: key.label }));
          select.value = field.out;
          select.addEventListener("change", () => { field.out = select.value; });
          extra.push(tipped(el("label", { text: "Which agent value goes into this input?" }), "Each input of the RTS row takes one value from the agent's report. Choose which one belongs here."), select);
        } else if (!draft.bind && draft.kind === "record") {
          const keyBox = textInput(field.key, "field key", (v) => { field.key = v; });
          const descBox = textInput(field.description, "what goes here (for Rovo)", (v) => { field.description = v; });
          extra.push(el("label", { text: "Key in the JSON" }), keyBox, el("label", { text: "Description" }), descBox);
        }
        if (draft.kind === "record") {
          const removeBtn = el("button", { className: "teach-btn danger", text: "Remove", type: "button" });
          removeBtn.addEventListener("click", () => { draft.fields.splice(index, 1); render(); });
          extra.push(el("div", { className: "teach-row" }, [removeBtn]));
        }
        section.appendChild(pickedBlock(field, extra));
      }
      const label = draft.kind === "record" ? "Pick an input" : (draft.fields.length ? "Re-pick field" : "Pick field on page");
      const pickBtn = tipped(el("button", { className: "teach-btn", text: label, type: "button" }),
        "Click this, then move over the RTS page: the field you would fill is outlined in orange. Click it to select. Press Esc to cancel. Only plain text boxes and native dropdowns are supported.");
      pickBtn.addEventListener("click", pickField);
      section.appendChild(el("div", { className: "teach-row" }, [pickBtn]));
      return section;
    }

    function saveControls() {
      const btn = tipped(el("button", { className: "teach-btn secondary", text: draft.saveButton ? "Re-pick Save button" : "Pick Save button", type: "button" }),
        "Click this, then click the Save button for this section in RTS. A greyed-out Save button can still be picked. The extension clicks it once after filling, then checks the value really saved.");
      btn.addEventListener("click", () => pickButton("saveButton", "Click the Save button for this section"));
      const section = el("div", { className: "teach-section" }, [el("h3", { text: draft.popup ? "Step C · Pick the popup's Save button" : "Pick its Save button" }), el("div", { className: "teach-row" }, [btn])]);
      if (draft.saveButton) section.appendChild(pickedBlock({ ...draft.saveButton, kind: null, label: draft.saveButton.text }));
      if (draft.popup) {
        const close = tipped(el("button", { className: "teach-btn secondary", text: draft.closeButton ? "Re-pick Close button" : "Pick Close button (optional)", type: "button" }),
          "Optional. Click this, then the popup's Close or Cancel button. The extension uses it to close the popup after it has checked the saved value. Without it, the Esc key is used.");
        close.addEventListener("click", () => pickButton("closeButton", "Click the popup's Close (or Cancel) button"));
        section.appendChild(el("div", { className: "teach-row" }, [close]));
        if (draft.closeButton) section.appendChild(pickedBlock({ ...draft.closeButton, kind: null, label: draft.closeButton.text }));
      }
      return section;
    }

    function footer(saveLabel) {
      const saveDef = el("button", { className: "teach-btn", text: saveLabel, type: "button" });
      saveDef.addEventListener("click", save);
      const cancel = el("button", { className: "teach-btn secondary", text: "Cancel", type: "button" });
      cancel.addEventListener("click", () => { view = "list"; render(); });
      return el("div", { className: "teach-row" }, [saveDef, cancel]);
    }

    function renderWizard() {
      card.replaceChildren();
      const back = el("button", { className: "teach-x", text: "×", type: "button", title: "Back" });
      back.addEventListener("click", () => { view = "list"; render(); });
      const bound = Boolean(draft.bind);
      card.appendChild(el("div", { className: "teach-head" }, [el("h2", { text: bound ? `Map "${draft.bind.label}" to RTS` : "Teach a new field" }), back]));

      const hasFields = draft.window ? Boolean(draft.windowPick?.fields.length) : draft.fields.length > 0 && (draft.kind === "single" || Boolean(draft.addButton));
      if (bound) {
        if (draft.samples?.length) {
          const shown = draft.samples.slice(0, 3).map((r) => draft.bind.keys.map((k) => r[k.key]).filter(Boolean).join(" / ")).join("  ·  ");
          card.appendChild(el("div", { className: "teach-found", text: `The agent found: ${shown}${draft.samples.length > 3 ? ` (+${draft.samples.length - 3} more)` : ""}` }));
        }
        card.appendChild(guide([
          { done: false, text: `In RTS, open the page or section where "${draft.bind.label}" is entered and keep it visible. ${draft.bind.hint}` },
          ...(draft.window ? windowSteps() : [...popupSteps(),
          { done: hasFields, text: draft.kind === "record" ? "Click \"Pick Add button\", then \"Pick an input\" for each box in a row, and choose which agent value goes in each." : draft.popup ? "Click \"Pick field on page\", then click the text box inside the popup." : "Click \"Pick field on page\", then click the field in RTS." },
          { done: Boolean(draft.saveButton), text: draft.popup ? "Click \"Pick Save button\", then click the popup's Save button. Then save the mapping." : "Click \"Pick Save button\", then click the section's Save button. Then save the mapping." }])
        ]));
        card.appendChild(placeControls());
        card.append(...controlsSections());
        if (draft.error) card.appendChild(el("div", { className: "teach-error", text: draft.error }));
        card.appendChild(footer("Save mapping"));
        return;
      }

      card.appendChild(guide([
        { done: Boolean(draft.label && draft.key), text: "Choose the kind of field and name it." },
        ...(draft.window ? windowSteps() : [...popupSteps(),
        { done: hasFields, text: draft.popup ? "With the popup open, pick the text box inside it." : "Open the field in RTS, then pick it on the page." },
        { done: Boolean(draft.saveButton), text: draft.popup ? "Pick the popup's Save button, then save." : "Pick the Save button, then save." }])
      ]));
      const single = tipped(el("button", { className: `teach-btn${draft.kind === "single" ? "" : " secondary"}`, text: "Single field", type: "button" }), "One value in one box or dropdown (for example Founded year).");
      const record = tipped(el("button", { className: `teach-btn${draft.kind === "record" ? "" : " secondary"}`, text: "Repeatable record (Add → fill → Save)", type: "button" }), "A list where you click an Add button to get a new row, fill the row, then save (for example Name Variations).");
      const setKind = (kind) => { if (draft.kind !== kind) { draft.kind = kind; draft.fields = []; draft.addButton = null; draft.popup = false; draft.window = false; draft.windowPick = null; draft.rowBy = null; draft.openEl = null; draft.openButton = null; draft.closeButton = null; draft.openNote = ""; render(); } };
      single.addEventListener("click", () => setKind("single"));
      record.addEventListener("click", () => setKind("record"));
      card.appendChild(el("div", { className: "teach-section" }, [el("h3", { text: "1 · What kind of field?" }), el("div", { className: "teach-row" }, [single, record])]));

      const keyInput = textInput(draft.key, "e.g. foundedYear", (v) => { draft.key = v; draft.keyTouched = true; });
      card.appendChild(el("div", { className: "teach-section" }, [
        el("h3", { text: "2 · Name it" }),
        el("label", { text: "Field name (shown in the preview)" }),
        textInput(draft.label, "e.g. Founded year", (v) => { draft.label = v; if (!draft.keyTouched) { draft.key = sb().toCamelKey(v); keyInput.value = draft.key; } }),
        el("label", { text: "JSON key (the agent returns it under custom.<key>)" }),
        keyInput,
        el("label", { text: "What should the agent research for it?" }),
        textInput(draft.description, "e.g. Year the company was founded, 4 digits", (v) => { draft.description = v; })
      ]));
      card.appendChild(placeControls());
      card.append(...controlsSections());
      if (draft.error) card.appendChild(el("div", { className: "teach-error", text: draft.error }));
      card.appendChild(footer("Save taught field"));
    }

    function render() {
      if (view === "wizard") renderWizard();
      else renderList();
    }

    // open({ bindPath, samples }) jumps straight into mapping that report field.
    function open(options = {}) {
      // Appended on first use, after the panel, so it stacks above it (both
      // sit at the browser's maximum z-index; DOM order breaks the tie).
      if (!modal.isConnected) shadow.appendChild(modal);
      if (options.bindPath && globalThis.SXRTS.outputFields?.get(options.bindPath)) {
        draft = boundDraft(options.bindPath, options.samples ?? []);
        view = "wizard";
      } else {
        view = "list";
      }
      render();
      modal.classList.add("open");
    }

    return { open, close, pickElement };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.teach = { mount };
})();
