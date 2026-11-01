"use strict";

/*
 * "Check mappings" window: runs core/mappingCheck.js and shows, per mapping, whether every button, box,
 * tick box and Save button is found on the open profile. Writes nothing to RTS.
 */
(() => {
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.type) node.type = props.type;
    for (const child of children) node.appendChild(child);
    return node;
  }
  const LABEL = { ok: "found", warn: "look at", fail: "not found" };
  const CLASS = { ok: "hx-valid", warn: "hx-halted", fail: "hx-invalid" };

  function mount(shadow) {
    const mc = () => globalThis.SXRTS.mappingCheck;
    const modal = el("div", { className: "hx-modal" });
    const card = el("div", { className: "hx-card" });
    modal.appendChild(card);
    let pressedOnBackdrop = false;
    modal.addEventListener("mousedown", (event) => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener("click", (event) => { if (event.target === modal && pressedOnBackdrop && !running) close(); });
    let running = false;
    let result = null;
    let note = "";
    let progress = "";

    function close() { modal.classList.remove("open"); }
    const button = (text, onClick, kind = "secondary", disabled = false) => {
      const b = el("button", { className: `hx-btn ${kind}`, text, type: "button" });
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      return b;
    };

    function render() {
      const x = el("button", { className: "hx-x", text: "×", type: "button" });
      x.title = "Close";
      x.addEventListener("click", () => { if (!running) close(); });
      card.replaceChildren(el("div", { className: "hx-head" }, [el("h2", { text: "Check mappings" }), x]));
      card.appendChild(el("p", { className: "hx-muted", text: "Looks on this profile for every button, box, tick box and Save button the extension will use, and says which are found. It writes nothing: no value is typed, nothing is ticked or saved. Windows and dialogs it needs open and close by themselves, so leave the page alone while it runs." }));
      if (note) card.appendChild(el("div", { className: "hx-note", text: note }));
      const actions = [button(running ? "Checking…" : result ? "Check again" : "Start check", start, "", running)];
      if (result) actions.push(button("Copy report", copy));
      card.appendChild(el("div", { className: "hx-row" }, actions));
      if (running) card.appendChild(el("div", { className: "hx-note", text: progress || "Starting…" }));
      if (!result) return;
      card.appendChild(el("div", { className: "hx-note", text: `${result.rows.length} checked · ${result.ok} found · ${result.warn} to look at · ${result.fail} not found` }));
      let group = "";
      for (const row of result.rows) {
        if (row.group !== group) { group = row.group; card.appendChild(el("div", { className: "hx-section", text: group })); }
        const box = el("div", { className: "hx-item" });
        box.appendChild(el("div", { className: "hx-row" }, [el("span", { className: `hx-badge ${CLASS[row.status]}`, text: LABEL[row.status] }), el("span", { className: "hx-title", text: row.label })]));
        const shown = row.parts.filter((p) => !p.ok || p.note);
        for (const part of row.status === "ok" ? shown : row.parts) box.appendChild(el("div", { className: "hx-muted", text: `${part.ok ? "✓" : "✗"} ${part.name}${part.note ? ` — ${part.note}` : ""}` }));
        if (row.status === "fail") box.appendChild(el("div", { className: "hx-muted", text: "Open that part of the profile and check again; if it is still not found, re-map the field (Teach new field)." }));
        card.appendChild(box);
      }
    }

    async function start() {
      running = true; note = ""; progress = ""; render();
      try {
        result = await mc().run(({ done, total, label }) => { progress = label ? `Checking ${done + 1} of ${total}: ${label}` : "Finishing…"; render(); });
      } catch (error) {
        note = `The check stopped: ${error.message}`;
      }
      running = false; render();
    }

    async function copy() {
      try { await navigator.clipboard.writeText(mc().asText(result)); note = "Report copied."; } catch { note = "Copy was blocked by the browser."; }
      render();
    }

    function open() {
      if (!modal.isConnected) shadow.appendChild(modal);
      note = "";
      render();
      modal.classList.add("open");
    }
    return { open, close };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.checkUi = { mount };
})();
