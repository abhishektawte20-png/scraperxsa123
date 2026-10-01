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

  function mount(shadow, { onChange } = {}) {
    const sb = () => globalThis.SXRTS.selectorBuilder;
    const cf = () => globalThis.SXRTS.customFields;

    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);

    const modal = el("div", { className: "teach-modal" });
    const card = el("div", { className: "teach-card" });
    modal.appendChild(card);

    let view = "list";
    let draft = null;

    function newDraft() {
      return { kind: "single", label: "", key: "", keyTouched: false, description: "", fields: [], addButton: null, saveButton: null, error: "" };
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
    function pickElement(message) {
      return new Promise((resolve) => {
        const overlay = el("div", { className: "teach-overlay" });
        const box = el("div", { className: "teach-hl" });
        const bar = el("div", { className: "teach-bar", text: `${message} — press Esc to cancel` });
        shadow.append(overlay, box, bar);
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
          modal.classList.add("open");
          resolve(target);
        }

        overlay.addEventListener("mousemove", onMove);
        overlay.addEventListener("click", onClick);
        for (const name of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "contextmenu"]) overlay.addEventListener(name, stop);
        window.addEventListener("keydown", onKey, true);
      });
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
      const controls = def.fields.every((field) => sb().resolveFirst(field.selectors));
      const save = sb().resolveButtonByDefinition(def.saveButton);
      return controls && Boolean(save);
    }

    function renderList() {
      card.replaceChildren();
      const close_ = el("button", { className: "teach-x", text: "×", type: "button", title: "Close" });
      close_.addEventListener("click", close);
      card.appendChild(el("div", { className: "teach-head" }, [el("h2", { text: "Taught fields" }), close_]));

      const teachBtn = el("button", { className: "teach-btn", text: "Teach new field", type: "button" });
      teachBtn.addEventListener("click", () => { draft = newDraft(); view = "wizard"; render(); });
      card.appendChild(el("div", { className: "teach-row" }, [teachBtn]));
      card.appendChild(el("p", { className: "teach-muted", text: "Fields you teach here are added to the Rovo prompt and filled from the pasted JSON, the same way as the built-in fields. They are stored in this browser only." }));

      const defs = cf().getCached();
      if (!defs.length) {
        card.appendChild(el("p", { className: "teach-muted", text: "No taught fields yet." }));
        return;
      }
      for (const def of defs) {
        const found = foundOnPage(def);
        const remove = el("button", { className: "teach-btn danger", text: "Delete", type: "button" });
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Delete the taught field "${def.label}"?`)) return;
          await cf().removeDefinition(def.key);
          onChange?.();
          render();
        });
        card.appendChild(el("div", { className: "teach-item" }, [
          el("div", {}, [
            el("div", { text: `${def.label}  ·  custom.${def.key}` }),
            el("div", { className: "teach-muted", text: `${def.kind === "record" ? "Repeatable record" : "Single field"} · ${def.fields.length} field(s)` }),
            el("div", { className: found ? "teach-ok" : "teach-warn", text: found ? "✓ Found on this page" : "Not found on this page (open the right tab/section)" })
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
      const target = await pickElement(draft.kind === "record" ? "Click a text box or dropdown in the row" : "Click the text box or dropdown to fill");
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
      if (draft.kind === "single") {
        draft.fields = [{ ...info, key: "value", description: "" }];
      } else {
        draft.fields.push({ ...info, key: uniqueKey(info.suggestedKey), description: "" });
      }
      if (!draft.label && info.label) draft.label = info.label.slice(0, 60);
      if (!draft.keyTouched && !draft.key) draft.key = sb().toCamelKey(draft.label);
      render();
    }

    async function pickButton(slot, message) {
      draft.error = "";
      const target = await pickElement(message);
      if (!target) return render();
      const info = sb().inspectButton(sb().resolveButton(target));
      if (!info.selectors.length && !info.text) {
        draft.error = "No reliable selector or visible text could be read from that button.";
        return render();
      }
      draft[slot] = info;
      render();
    }

    async function save() {
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
        ...(draft.kind === "record" && draft.addButton ? { addButton: { selectors: draft.addButton.selectors, text: draft.addButton.text } } : {})
      };
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
      view = "list";
      render();
    }

    function textInput(value, placeholder, onInput) {
      const input = el("input", { type: "text", value, placeholder });
      input.addEventListener("input", () => onInput(input.value));
      return input;
    }

    function renderWizard() {
      card.replaceChildren();
      const back = el("button", { className: "teach-x", text: "×", type: "button", title: "Back to list" });
      back.addEventListener("click", () => { view = "list"; render(); });
      card.appendChild(el("div", { className: "teach-head" }, [el("h2", { text: "Teach a new field" }), back]));

      // 1. type
      const single = el("button", { className: `teach-btn${draft.kind === "single" ? "" : " secondary"}`, text: "Single field", type: "button" });
      const record = el("button", { className: `teach-btn${draft.kind === "record" ? "" : " secondary"}`, text: "Repeatable record (Add → fill → Save)", type: "button" });
      const setKind = (kind) => { if (draft.kind !== kind) { draft.kind = kind; draft.fields = []; draft.addButton = null; render(); } };
      single.addEventListener("click", () => setKind("single"));
      record.addEventListener("click", () => setKind("record"));
      card.appendChild(el("div", { className: "teach-section" }, [el("h3", { text: "1 · What kind of field?" }), el("div", { className: "teach-row" }, [single, record])]));

      // 2. name + description
      const keyInput = textInput(draft.key, "e.g. foundedYear", (v) => { draft.key = v; draft.keyTouched = true; });
      const nameSection = el("div", { className: "teach-section" }, [
        el("h3", { text: "2 · Name it" }),
        el("label", { text: "Field name (shown in the preview)" }),
        textInput(draft.label, "e.g. Founded year", (v) => { draft.label = v; if (!draft.keyTouched) { draft.key = sb().toCamelKey(v); keyInput.value = draft.key; } }),
        el("label", { text: "JSON key (Rovo will return it under custom.<key>)" }),
        keyInput,
        el("label", { text: "What should Rovo research for it? (added to the prompt)" }),
        textInput(draft.description, "e.g. Year the company was founded, 4 digits", (v) => { draft.description = v; })
      ]);
      card.appendChild(nameSection);

      // 3. pick on page
      const pickSection = el("div", { className: "teach-section" }, [el("h3", { text: draft.kind === "record" ? "3 · Pick the Add button, then each input in a row" : "3 · Pick the field on the page" })]);
      if (draft.kind === "record") {
        const addBtn = el("button", { className: "teach-btn secondary", text: draft.addButton ? "Re-pick Add button" : "Pick Add button", type: "button" });
        addBtn.addEventListener("click", () => pickButton("addButton", "Click the Add button that creates a new row"));
        pickSection.appendChild(el("div", { className: "teach-row" }, [addBtn]));
        if (draft.addButton) pickSection.appendChild(pickedBlock({ ...draft.addButton, kind: null, label: draft.addButton.text }));
      }
      for (const [index, field] of draft.fields.entries()) {
        const extra = [];
        if (draft.kind === "record") {
          const keyBox = textInput(field.key, "field key", (v) => { field.key = v; });
          const descBox = textInput(field.description, "what goes here (for Rovo)", (v) => { field.description = v; });
          const removeBtn = el("button", { className: "teach-btn danger", text: "Remove", type: "button" });
          removeBtn.addEventListener("click", () => { draft.fields.splice(index, 1); render(); });
          extra.push(el("label", { text: "Key in the JSON" }), keyBox, el("label", { text: "Description" }), descBox, el("div", { className: "teach-row" }, [removeBtn]));
        }
        pickSection.appendChild(pickedBlock(field, extra));
      }
      const pickBtn = el("button", { className: "teach-btn", text: draft.kind === "record" ? "Pick another input" : (draft.fields.length ? "Re-pick field" : "Pick field on page"), type: "button" });
      pickBtn.addEventListener("click", pickField);
      pickSection.appendChild(el("div", { className: "teach-row" }, [pickBtn]));
      card.appendChild(pickSection);

      // 4. save button
      const saveBtnPick = el("button", { className: "teach-btn secondary", text: draft.saveButton ? "Re-pick Save button" : "Pick Save button", type: "button" });
      saveBtnPick.addEventListener("click", () => pickButton("saveButton", "Click the Save button for this section"));
      const saveSection = el("div", { className: "teach-section" }, [el("h3", { text: "4 · Pick its Save button" }), el("div", { className: "teach-row" }, [saveBtnPick])]);
      if (draft.saveButton) saveSection.appendChild(pickedBlock({ ...draft.saveButton, kind: null, label: draft.saveButton.text }));
      card.appendChild(saveSection);

      if (draft.error) card.appendChild(el("div", { className: "teach-error", text: draft.error }));

      const saveDef = el("button", { className: "teach-btn", text: "Save taught field", type: "button" });
      saveDef.addEventListener("click", save);
      const cancel = el("button", { className: "teach-btn secondary", text: "Cancel", type: "button" });
      cancel.addEventListener("click", () => { view = "list"; render(); });
      card.appendChild(el("div", { className: "teach-row" }, [saveDef, cancel]));
    }

    function render() {
      if (view === "wizard") renderWizard();
      else renderList();
    }

    function open() {
      // Appended on first use, after the panel, so it stacks above it (both
      // sit at the browser's maximum z-index; DOM order breaks the tie).
      if (!modal.isConnected) shadow.appendChild(modal);
      view = "list";
      render();
      modal.classList.add("open");
    }

    return { open, close, pickElement };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.teach = { mount };
})();
