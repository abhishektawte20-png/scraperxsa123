"use strict";

/*
 * "Analyze page" window. Reads the page (or the open dialog) and lists every box and button with its words;
 * pressing a button shows what it reveals; and a whole form can be turned into ONE mapping: choose which report
 * field it fills, which box takes which value (or a fixed value), and its Save button. Nothing is typed or saved
 * on the page by the analysis itself.
 */
(() => {
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.type) node.type = props.type;
    if (props.value !== undefined) node.value = props.value;
    if (props.placeholder) node.placeholder = props.placeholder;
    for (const child of children) node.appendChild(child);
    return node;
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const KIND = { text: "box", select: "dropdown", button: "button", checkbox: "tick box", radio: "round button" };

  function mount(shadow, { onMapped } = {}) {
    const pa = () => globalThis.SXRTS.pageAnalysis;
    const cf = () => globalThis.SXRTS.customFields;
    const modal = el("div", { className: "hx-modal" });
    const card = el("div", { className: "hx-card" });
    modal.appendChild(card);
    let pressedOnBackdrop = false;
    modal.addEventListener("mousedown", (event) => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener("click", (event) => { if (event.target === modal && pressedOnBackdrop && !state.busy) close(); });

    // page: the first scan; opened: what the pressed button revealed (items), formItems: the boxes of the form to map.
    let state = null;
    const fresh = () => ({ page: null, opener: -1, opened: null, formItems: [], windowScan: null, target: "", assign: new Map(), fixed: new Map(), saveId: -1, note: "", error: "", busy: false, scope: "auto" });

    function close() { modal.classList.remove("open"); }
    const button = (text, onClick, kind = "secondary", disabled = false) => {
      const b = el("button", { className: `hx-btn ${kind}`, text, type: "button" });
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      return b;
    };
    const select = (options, value, onChange) => {
      const s = el("select");
      for (const [v, label] of options) { const o = el("option", { text: label }); o.value = v; s.appendChild(o); }
      s.value = value;
      s.addEventListener("change", () => onChange(s.value));
      return s;
    };

    // ---- scanning ----
    async function doScan() {
      state.busy = true; state.error = ""; state.note = ""; render();
      await wait(30);
      try {
        state.page = pa().scan({ scope: state.scope });
        state.opener = -1; state.opened = null; state.formItems = []; state.windowScan = null; state.assign = new Map(); state.fixed = new Map(); state.saveId = -1;
        state.note = `${state.page.note} ${state.page.count} control(s) found.`;
      } catch (error) { state.error = error.message; }
      state.busy = false; render();
    }

    // Presses the chosen button and reads what appeared; if nothing appeared on the page, a separate window may have.
    async function pressAndScan() {
      const opener = state.page.buttons[state.opener];
      if (!opener?.element?.isConnected) { state.error = "That button is no longer on the page. Scan again."; return render(); }
      if (opener.disabled) { state.error = "That button is greyed out right now."; return render(); }
      state.busy = true; state.error = ""; state.note = `Pressing "${opener.label}"…`; render();
      let windowScan = null;
      let port = null;
      try { port = chrome.runtime.connect({ name: "sx-window" }); } catch { port = null; }
      const windowAnswer = new Promise((resolve) => {
        if (!port) return resolve(null);
        port.onMessage.addListener((message) => {
          if (message.type === "armed") opener.element.click();
          else if (message.type === "scan") resolve(message.inventory);
          else if (message.type === "error") resolve(null);
        });
        port.onDisconnect.addListener(() => resolve(null));
        port.postMessage({ type: "start", mode: "scan", origin: window.location.origin });
      });
      if (!port) opener.element.click();
      await wait(1300);
      const after = pa().scan({ scope: state.scope });
      const appeared = pa().appeared(state.page, after);
      if (appeared.length) {
        try { port?.disconnect(); } catch { /* closed */ }
      } else {
        windowScan = await Promise.race([windowAnswer, wait(3500).then(() => null)]);
        try { port?.disconnect(); } catch { /* closed */ }
      }
      state.opened = after;
      state.formItems = appeared;
      state.windowScan = windowScan;
      state.assign = new Map(); state.fixed = new Map();
      state.saveId = -1;
      const saveGuess = [...appeared.filter((i) => i.kind === "button"), ...after.buttons].find((b) => /^save/i.test(b.label));
      state.opened = after;
      if (saveGuess) state.saveId = saveGuess.id;
      const labels = appeared.filter((i) => i.mappable).map((i) => i.label);
      const guess = pa().suggestField(labels);
      if (guess) state.target = guess;
      applySuggestions();
      state.note = appeared.length
        ? `Pressing "${opener.label}" showed ${appeared.length} new control(s).`
        : windowScan ? `Pressing "${opener.label}" opened a separate window (${windowScan.count} control(s), listed below).` : `Pressing "${opener.label}" showed nothing new on the page and no window opened.`;
      state.busy = false; render();
    }

    function targetField() { return globalThis.SXRTS.outputFields?.get(state.target) || null; }
    function applySuggestions() {
      state.assign = new Map();
      const field = targetField();
      if (!field) return;
      const used = new Set();
      for (const item of state.formItems.filter((i) => i.mappable)) {
        const key = pa().suggestKey(item.label, field);
        if (key && !used.has(key)) { state.assign.set(item.id, key); used.add(key); }
      }
    }

    // ---- building the mapping ----
    const nameOf = (label, n) => (globalThis.SXRTS.selectorBuilder.toCamelKey(label) || `box${n}`).slice(0, 38);
    async function createMapping() {
      state.error = "";
      const field = targetField();
      const opener = state.opener >= 0 ? state.page.buttons[state.opener] : null;
      const boxes = state.formItems.filter((i) => i.mappable && (state.assign.get(i.id) || state.fixed.has(i.id)));
      if (!field) state.error = "Choose which report field this form fills.";
      else if (!boxes.length) state.error = "Choose a report value (or a fixed value) for at least one box.";
      else if (!boxes.some((i) => state.assign.get(i.id))) state.error = "At least one box must take a value from the report.";
      else if (state.saveId < 0) state.error = "Choose the form's Save button.";
      if (state.error) return render();

      const save = (state.opened ?? state.page).buttons.find((b) => b.id === state.saveId);
      // The form's Cancel / Close button, used to put it away again after a check.
      const cancel = (state.opened ?? state.page).buttons.find((b) => /^(cancel|close)$/i.test(b.label) && b.id !== state.saveId);
      const seen = new Set();
      const fields = boxes.map((item, n) => {
        let key = nameOf(item.label, n);
        while (seen.has(key)) key = `${key.slice(0, 36)}${n}`;
        seen.add(key);
        const fixed = state.fixed.has(item.id) && !state.assign.get(item.id) ? state.fixed.get(item.id) : undefined;
        return { key, item, fixed, out: fixed === undefined ? state.assign.get(item.id) : null };
      });
      const single = field.kind === "single";
      if (single && (fields.length !== 1 || fields[0].fixed !== undefined)) {
        state.error = `${field.label} is a single value: pick exactly one box for it, or choose a list-type report field such as Management.`;
        return render();
      }
      const def = {
        key: globalThis.SXRTS.outputFields.keyFor(field.path), label: field.label, description: "", kind: single ? "single" : "record",
        fields: fields.map(({ key, item, fixed }) => ({ key: single ? "value" : key, label: item.label || key, description: "", kind: item.kind === "select" ? "select" : "text", selectors: item.selectors, ...(item.kind === "select" ? { options: item.options } : {}), ...(fixed !== undefined ? { fixed } : {}) })),
        saveButton: { selectors: save.selectors, text: save.text || save.label },
        ...(opener ? { openButton: { selectors: opener.selectors, text: opener.text || opener.label } } : {}),
        ...(opener && cancel ? { closeButton: { selectors: cancel.selectors, text: cancel.text || cancel.label } } : {}),
        ...(single ? {} : { form: true }),
        binds: { path: field.path, map: Object.fromEntries(fields.filter((f) => f.fixed === undefined).map((f) => [single ? "value" : f.key, f.out])) }
      };
      const errors = cf().validateDefinition(def);
      if (errors.length) { state.error = errors.join(" "); return render(); }
      try { await cf().saveDefinition(def); } catch (error) { state.error = error.message; return render(); }
      state.note = `Mapped "${field.label}" as one form (${fields.length} box${fields.length === 1 ? "" : "es"}, one Save). It is ready: run "Check mappings" to test it.`;
      onMapped?.(field.label);
      render();
    }

    // ---- display ----
    const lineOf = (item) => {
      const bits = [KIND[item.kind] || item.kind, item.required ? "required" : "", item.disabled ? "greyed out" : "", item.options ? `${item.options.length} choices` : "", item.reason && !item.mappable ? "not fillable yet" : ""].filter(Boolean).join(" · ");
      return `${item.label || "(no label)"}  —  ${bits}`;
    };

    function renderScan(scan, title) {
      card.appendChild(el("div", { className: "hx-section", text: title }));
      for (const region of scan.regions) {
        card.appendChild(el("div", { className: "hx-title", text: region.title }));
        for (const item of region.items.slice(0, 60)) card.appendChild(el("div", { className: "hx-muted", text: lineOf(item) }));
        if (region.items.length > 60) card.appendChild(el("div", { className: "hx-muted", text: `… ${region.items.length - 60} more` }));
      }
    }

    function renderMapper() {
      const fields = (globalThis.SXRTS.outputFields?.FIELDS ?? []).filter((f) => !f.picker && f.path !== "extras.industryCode");
      card.appendChild(el("div", { className: "hx-section", text: "Map this form" }));
      const fillable = state.formItems.filter((i) => i.mappable);
      if (!fillable.length) { card.appendChild(el("p", { className: "hx-muted", text: "Press a button above to see the form it opens, or choose a button that shows no form. Then its boxes appear here." })); return; }
      card.appendChild(el("p", { className: "hx-muted", text: "Choose which report field this form fills, and for each box which value goes into it. A box can also take a fixed value that is always used (for example a status). The extension fills the whole form and presses Save once." }));
      card.appendChild(el("label", { text: "This form fills" }));
      card.appendChild(select([["", "— choose —"], ...fields.map((f) => [f.path, `${f.label}${f.kind === "single" ? " (one value)" : ""}`])], state.target, (v) => { state.target = v; applySuggestions(); render(); }));
      const field = targetField();
      for (const item of fillable) {
        const keys = (field?.keys ?? []).map((k) => [k.key, k.label]);
        const fixedNow = state.fixed.has(item.id);
        const value = fixedNow ? "__fixed" : state.assign.get(item.id) || "";
        const row = el("div", { className: "hx-row" }, [el("span", { text: `${item.label || "(no label)"}${item.required ? " *" : ""} →` })]);
        row.appendChild(select([["", "— don't use —"], ...keys, ["__fixed", "a fixed value"]], value, (v) => {
          if (v === "__fixed") { state.assign.delete(item.id); state.fixed.set(item.id, item.options?.[0]?.label ?? ""); }
          else { state.fixed.delete(item.id); if (v) state.assign.set(item.id, v); else state.assign.delete(item.id); }
          render();
        }));
        if (fixedNow) {
          if (item.options) row.appendChild(select(item.options.map((o) => [o.label, o.label]), state.fixed.get(item.id), (v) => { state.fixed.set(item.id, v); }));
          else { const input = el("input", { type: "text", value: state.fixed.get(item.id) ?? "", placeholder: "always type this" }); input.addEventListener("input", () => { state.fixed.set(item.id, input.value); }); row.appendChild(input); }
        }
        card.appendChild(row);
      }
      const saves = (state.opened ?? state.page).buttons;
      card.appendChild(el("label", { text: "The form's Save button" }));
      card.appendChild(select([["-1", "— choose —"], ...saves.map((b) => [String(b.id), b.label || "(no text)"])], String(state.saveId), (v) => { state.saveId = Number(v); }));
      card.appendChild(el("div", { className: "hx-row" }, [button("Create mapping", createMapping, "")]));
    }

    function render() {
      const x = el("button", { className: "hx-x", text: "×", type: "button" });
      x.title = "Close";
      x.addEventListener("click", () => { if (!state.busy) close(); });
      card.replaceChildren(el("div", { className: "hx-head" }, [el("h2", { text: "Analyze page" }), x]));
      card.appendChild(el("p", { className: "hx-muted", text: "Reads the page you are looking at (or the open window) and lists every box and button with its words. Use it when a field cannot be mapped the usual way: see what is there, press a button to see the form it opens, and turn that form into one mapping. Scanning only reads; nothing is typed or saved." }));
      if (state.error) card.appendChild(el("div", { className: "hx-note", text: state.error }));
      if (state.note) card.appendChild(el("div", { className: "hx-note", text: state.note }));
      const scope = select([["auto", "The open window if there is one, else the page"], ["page", "The whole page"]], state.scope, (v) => { state.scope = v; });
      card.appendChild(el("div", { className: "hx-row" }, [scope, button(state.busy ? "Working…" : state.page ? "Scan again" : "Scan this page", doScan, "", state.busy), ...(state.page ? [button("Copy analysis", copy)] : [])]));
      if (!state.page) return;

      const buttons = state.page.buttons;
      card.appendChild(el("div", { className: "hx-section", text: "What opens the form?" }));
      card.appendChild(el("div", { className: "hx-row" }, [
        select([["-1", "— the form is already on the page —"], ...buttons.map((b, i) => [String(i), `${b.label || "(no text)"}${b.disabled ? " (greyed out)" : ""}`])], String(state.opener), (v) => { state.opener = Number(v); state.opened = null; state.windowScan = null; if (state.opener < 0) { state.formItems = state.page.items.filter((i) => i.mappable); applySuggestions(); } else state.formItems = []; render(); }),
        ...(state.opener >= 0 ? [button("Press it and scan", pressAndScan, "", state.busy)] : [])
      ]));
      if (state.opener < 0 && state.saveId < 0) { const guess = state.page.buttons.find((b) => /^save/i.test(b.label)); if (guess) state.saveId = guess.id; }
      if (state.opener < 0 && !state.formItems.length) { state.formItems = state.page.items.filter((i) => i.mappable); const g = pa().suggestField(state.formItems.map((i) => i.label)); if (g && !state.target) state.target = g; applySuggestions(); }

      if (state.windowScan) renderScan(state.windowScan, "A separate window opened (read-only here: use Teach new field > Separate window to map it, or Copy analysis and send it to the developer)");
      else renderScan(state.opened && state.formItems.length ? { regions: [{ title: "New on the page after pressing", items: state.formItems }] } : state.page, state.opened ? "After pressing" : "On the page");
      renderMapper();
    }

    async function copy() {
      const parts = [pa().asText(state.page, "Page")];
      if (state.opened) parts.push("", pa().asText({ ...state.opened, note: "After pressing the button." }, "After pressing"));
      if (state.windowScan) parts.push("", typeof state.windowScan.regions === "object" ? pa().asText(state.windowScan, "Separate window") : "");
      try { await navigator.clipboard.writeText(parts.join("\n")); state.note = "Analysis copied. It has the words and how each box is found, and no typed values."; } catch { state.note = "Copy was blocked by the browser."; }
      render();
    }

    function open() {
      if (!modal.isConnected) shadow.appendChild(modal);
      state = fresh();
      render();
      modal.classList.add("open");
    }
    return { open, close };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.analyzeUi = { mount };
})();
