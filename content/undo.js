"use strict";

/*
 * "Undo" window: the latest publishes with what each one saved. "Undo this run" puts back what the extension
 * can revert and read back from RTS (industry tick, replaced website / email structure, replaced single values)
 * and lists exactly what to delete by hand for rows that were added. Blocked on a different profile.
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
  const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  function mount(shadow) {
    const led = () => globalThis.SXRTS.undoLedger;
    const modal = el("div", { className: "hx-modal" });
    const card = el("div", { className: "hx-card" });
    modal.appendChild(card);
    let pressedOnBackdrop = false;
    modal.addEventListener("mousedown", (event) => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener("click", (event) => { if (event.target === modal && pressedOnBackdrop) close(); });
    let note = "";
    let busy = false;

    function close() { modal.classList.remove("open"); }
    const button = (text, onClick, kind = "secondary", disabled = false) => {
      const b = el("button", { className: `hx-btn ${kind}`, text, type: "button" });
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      return b;
    };

    // Same profile as the run was made on? Returns an error text, or "" when it may go ahead.
    function profileProblem(run) {
      let now;
      try { now = globalThis.SXRTS.identityLock.readRtsIdentityFromPage(); } catch (error) { return `The open page is not an RTS profile (${error.message}).`; }
      const then = run.rtsIdentity || {};
      const verdict = globalThis.SXRTS.identityLock.compareIdentity({ pbId: then.pbId, entityId: then.entityId, domain: then.domain, companyName: then.formalName }, now);
      if (verdict.status === "mismatch") return `This is a different profile than the run was made on:\n${verdict.reasons.join("\n")}`;
      if (verdict.status === "insufficient" && !window.confirm(`Nothing proves this is the same profile as the run (${run.company || run.domain}). Only go ahead if you have checked. Undo anyway?`)) return "Undo cancelled.";
      return "";
    }

    async function undoRun(run) {
      const problem = profileProblem(run);
      if (problem) { note = problem; await render(); return; }
      if (!window.confirm(`Undo ${run.items.filter((i) => i.auto && i.state === "pending").length} change(s) from this run in RTS now? This makes live changes.`)) return;
      busy = true;
      for (const item of run.items.filter((i) => i.auto && i.state === "pending")) {
        note = `Undoing ${item.label}…`; await render();
        const result = await led().undoItem(item);
        await led().markItem(run.id, item.id, result.ok ? "undone" : "failed", result.message);
      }
      busy = false;
      note = "Done. Each line below says what RTS showed afterwards.";
      await render();
    }

    async function render() {
      const runs = await led().list();
      const x = el("button", { className: "hx-x", text: "×", type: "button" });
      x.title = "Close";
      x.addEventListener("click", close);
      card.replaceChildren(el("div", { className: "hx-head" }, [el("h2", { text: "Undo" }), x]));
      card.appendChild(el("p", { className: "hx-muted", text: `What each publish saved to RTS, kept ${led().RETENTION_DAYS} days. Open the same profile in RTS before undoing. The extension reverts what it can and reads RTS again to confirm; rows that were added must be deleted by hand, and are listed exactly.` }));
      if (note) card.appendChild(el("div", { className: "hx-note", text: note }));
      if (!runs.length) card.appendChild(el("p", { className: "hx-muted", text: "Nothing to undo yet. A publish that saves something appears here." }));
      for (const run of runs) {
        const autos = run.items.filter((i) => i.auto && i.state === "pending").length;
        const box = el("div", { className: "hx-item" });
        box.appendChild(el("div", { className: "hx-top" }, [
          el("span", { className: "hx-title", text: run.company || run.domain || "(unnamed)" }),
          el("span", { className: "hx-muted", text: when(run.at) })
        ]));
        for (const item of run.items) {
          const status = item.state === "undone" ? "undone" : item.state === "failed" ? "could not undo" : item.auto ? "can undo" : "remove by hand";
          const detail = item.state !== "pending" && item.note ? ` — ${item.note}` : item.auto ? (item.kind === "industry" ? " — will be unticked" : item.before ? ` — will go back to "${item.before}"` : " — will be emptied") : ` — ${item.hint}`;
          box.appendChild(el("div", { className: "hx-row" }, [
            el("span", { className: `hx-badge ${item.state === "undone" ? "hx-valid" : item.state === "failed" ? "hx-invalid" : item.auto ? "hx-halted" : "hx-halted"}`, text: status }),
            el("span", { text: `${item.label}: ${item.value}${detail}` })
          ]));
        }
        box.appendChild(el("div", { className: "hx-row" }, [
          button(autos ? `Undo ${autos} change${autos === 1 ? "" : "s"}` : "Nothing the extension can undo", () => undoRun(run), "", busy || !autos),
          button("Copy list", async () => {
            const text = run.items.map((i) => `${i.label}: ${i.value} [${i.state === "undone" ? "undone" : i.auto ? "can undo" : "remove by hand — " + i.hint}]`).join("\n");
            try { await navigator.clipboard.writeText(`${run.company || run.domain} · ${when(run.at)}\n${text}`); note = "List copied."; } catch { note = "Copy was blocked by the browser."; }
            render();
          })
        ]));
        card.appendChild(box);
      }
    }

    async function open() {
      if (!modal.isConnected) shadow.appendChild(modal);
      note = "";
      await render();
      modal.classList.add("open");
    }
    return { open, close, refresh: () => (modal.classList.contains("open") ? render() : null) };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.undoUi = { mount };
})();
