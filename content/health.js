"use strict";

/*
 * "Field health" window: for every field, how often it was saved, was already in RTS, failed or had nothing
 * mapped (last 30 days), the most common error, the failure log, and the weekly digest (copy it, or send it to
 * the team channel now). Numbers come from core/fieldStats.js and stay in this browser until sent.
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

  function mount(shadow) {
    const fs = () => globalThis.SXRTS.fieldStats;
    const modal = el("div", { className: "hx-modal" });
    const card = el("div", { className: "hx-card" });
    modal.appendChild(card);
    let pressedOnBackdrop = false;
    modal.addEventListener("mousedown", (event) => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener("click", (event) => { if (event.target === modal && pressedOnBackdrop) close(); });
    let note = "";
    let days = 30;

    function close() { modal.classList.remove("open"); }
    const button = (text, onClick, kind = "secondary") => {
      const b = el("button", { className: `hx-btn ${kind}`, text, type: "button" });
      b.addEventListener("click", onClick);
      return b;
    };
    const label = (path) => globalThis.SXRTS.resultsSummary?.friendly?.(path) || path;

    async function render() {
      const events = await fs().readAll();
      const since = Date.now() - days * fs().DAY;
      const s = fs().summarize(events, { since });
      const x = el("button", { className: "hx-x", text: "×", type: "button" });
      x.title = "Close";
      x.addEventListener("click", close);
      card.replaceChildren(el("div", { className: "hx-head" }, [el("h2", { text: "Field health" }), x]));
      card.appendChild(el("p", { className: "hx-muted", text: "Success rate = of the times a field was written, how often RTS showed it saved (or already there). It shows whether the automation works, not whether the agent's value was right. Kept on this computer for 35 days." }));
      const range = el("div", { className: "hx-row" }, [7, 30].map((n) => button(`Last ${n} days`, () => { days = n; render(); }, days === n ? "" : "secondary")));
      card.appendChild(range);
      const t = s.total;
      card.appendChild(el("div", { className: "hx-note", text: `Overall: ${fs().pct(t.rate)} success · ${t.saved} saved · ${t.already} already in RTS · ${t.failed} failed · ${t.unmapped} not mapped` }));
      if (note) card.appendChild(el("div", { className: "hx-note", text: note }));

      if (!s.rows.length) {
        card.appendChild(el("p", { className: "hx-muted", text: "No publishes recorded in this period yet." }));
      } else {
        const table = el("table", { className: "hx-table" });
        table.appendChild(el("tr", {}, ["Field", "Success", "Saved", "Already", "Failed", "Not mapped"].map((h) => el("th", { text: h }))));
        for (const r of s.rows) {
          table.appendChild(el("tr", {}, [label(r.path), fs().pct(r.rate), r.saved, r.already, r.failed, r.unmapped].map((v) => el("td", { text: String(v) }))));
          if (r.topError) table.appendChild(el("tr", {}, [el("td", { className: "hx-muted", text: "most common error" }), (() => { const c = el("td", { className: "hx-muted", text: r.topError.slice(0, 220) }); c.colSpan = 5; return c; })()]));
        }
        card.appendChild(table);
      }

      const logs = fs().failureLogs(events, { since, limit: 15 });
      card.appendChild(el("div", { className: "hx-section", text: `Failure log (${logs.length} most recent)` }));
      if (!logs.length) card.appendChild(el("p", { className: "hx-muted", text: "No failures in this period." }));
      for (const e of logs) card.appendChild(el("div", { className: "hx-muted", text: `${new Date(e.at).toLocaleString()} · ${e.domain || "no site"} · ${label(e.path)} · ${e.message}` }));

      card.appendChild(el("div", { className: "hx-section", text: "Weekly digest" }));
      card.appendChild(el("p", { className: "hx-muted", text: "Posted to the team channel once a week when a channel is set (Feedback window). You can copy it or send it now." }));
      card.appendChild(el("div", { className: "hx-row" }, [
        button("Copy digest", async () => {
          try { await navigator.clipboard.writeText((await fs().digest()).text); note = "Digest copied."; } catch { note = "Copy was blocked by the browser."; }
          render();
        }),
        button("Send digest now", async () => {
          note = "Sending…"; await render();
          let reply;
          try { reply = await chrome.runtime.sendMessage({ type: "sxrts-digest-now" }); } catch (error) { reply = { ok: false, error: error.message }; }
          note = reply?.ok ? `Sent to ${reply.label}.` : `Not sent: ${reply?.error || "no answer from the extension"}`;
          render();
        }),
        button("Clear these numbers", async () => { if (window.confirm("Erase the field health numbers on this computer?")) { await fs().clear(); note = "Cleared."; render(); } }, "danger")
      ]));
    }

    async function open() {
      if (!modal.isConnected) shadow.appendChild(modal);
      note = "";
      await render();
      modal.classList.add("open");
    }
    return { open, close };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.healthUi = { mount };
})();
