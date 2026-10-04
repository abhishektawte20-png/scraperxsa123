"use strict";

/*
 * "History" window: the runs saved on this computer (core/history.js). Each one
 * can be opened to see the values the agent returned on that day, compared
 * with another run of the same company, copied, or deleted. Everything is
 * erased automatically after the retention period.
 */
(() => {
  const CSS = `
    .hx-modal { display: none; position: fixed; z-index: 2147483648; inset: 0; background: rgba(0,0,0,.5); align-items: center; justify-content: center; font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1b2430; }
    .hx-modal.open { display: flex; }
    .hx-card { background: #fff; border-radius: 14px; width: min(720px, 95vw); max-height: 90vh; overflow: auto; padding: 20px 22px; box-shadow: 0 20px 48px rgba(15,30,60,.28); }
    .hx-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e2e6ed; }
    .hx-head h2 { margin: 0; font-size: 16px; }
    .hx-x { background: none; border: 0; font-size: 24px; line-height: 1; color: #7a869c; cursor: pointer; }
    .hx-muted { color: #7a869c; font-size: 12px; }
    .hx-card input[type=text] { width: 100%; padding: 7px 9px; border: 1px solid #c9d1de; border-radius: 6px; font: inherit; margin: 8px 0; box-sizing: border-box; }
    .hx-item { border: 1px solid #e2e6ed; border-radius: 8px; padding: 10px 12px; margin: 8px 0; display: grid; gap: 6px; }
    .hx-top { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .hx-title { font-weight: 700; }
    .hx-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .hx-badge { display: inline-block; padding: 2px 8px; border-radius: 100px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .hx-valid { background: #e5f6ee; color: #166f4c; } .hx-invalid { background: #fdecea; color: #a3291c; } .hx-halted { background: #fff6e0; color: #8a5a00; }
    .hx-btn { background: #124a80; color: #fff; border: 1px solid #124a80; border-radius: 6px; padding: 5px 11px; font: inherit; font-size: 12px; cursor: pointer; }
    .hx-btn.secondary { background: #fff; color: #124a80; } .hx-btn.danger { background: #fff; color: #a3291c; border-color: #a3291c; }
    .hx-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0; }
    .hx-table td, .hx-table th { text-align: left; vertical-align: top; padding: 4px 6px; border-bottom: 1px solid #eef1f6; word-break: break-word; }
    .hx-table th { color: #124a80; font-size: 11px; text-transform: uppercase; }
    .hx-path { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #55637a; width: 34%; }
    .hx-before { background: #fdecea; } .hx-after { background: #e5f6ee; }
    .hx-section { margin: 14px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .3px; color: #124a80; font-weight: 700; }
    .hx-note { background: #eaf2fb; border-radius: 6px; padding: 8px 10px; margin: 8px 0; font-size: 12px; }
  `;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.type) node.type = props.type;
    if (props.placeholder) node.placeholder = props.placeholder;
    for (const child of children) node.appendChild(child);
    return node;
  }

  const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function mount(shadow) {
    const h = () => globalThis.SXRTS.history;
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
    const modal = el("div", { className: "hx-modal" });
    const card = el("div", { className: "hx-card" });
    modal.appendChild(card);
    let pressedOnBackdrop = false;
    modal.addEventListener("mousedown", (event) => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener("click", (event) => { if (event.target === modal && pressedOnBackdrop) close(); });

    let view = { name: "list" };
    let query = "";
    let picked = [];
    let note = "";

    function close() { modal.classList.remove("open"); }
    function header(title) {
      const x = el("button", { className: "hx-x", text: "×", type: "button", title: "Close" });
      x.addEventListener("click", close);
      card.appendChild(el("div", { className: "hx-head" }, [el("h2", { text: title }), x]));
    }
    const button = (text, onClick, kind = "secondary") => {
      const b = el("button", { className: `hx-btn ${kind}`, text, type: "button" });
      b.addEventListener("click", onClick);
      return b;
    };
    async function copy(text, done) {
      try { await navigator.clipboard.writeText(text); note = done; } catch { note = "Copy was blocked by the browser."; }
      await render();
    }

    async function renderList() {
      card.replaceChildren();
      header("Run history");
      card.appendChild(el("p", { className: "hx-muted", text: `Every checked report is kept on this computer for ${h().RETENTION_DAYS} days, then erased automatically. Use it to see what the agent returned on a given day when a quality check finds something different later.` }));
      const search = el("input", { type: "text", placeholder: "Search by company, website or PBID" });
      search.value = query;
      search.addEventListener("input", () => { query = search.value; renderListBody(); });
      card.appendChild(search);
      if (note) card.appendChild(el("div", { className: "hx-note", text: note }));
      card.appendChild(el("div", { className: "hx-body" }));
      await renderListBody();
    }

    async function renderListBody() {
      const body = card.querySelector(".hx-body");
      if (!body) return;
      const runs = await h().list({ query });
      body.replaceChildren();
      if (!runs.length) body.appendChild(el("p", { className: "hx-muted", text: query ? "No saved run matches that search." : "Nothing saved yet. A run is saved each time you press Validate." }));
      for (const run of runs) {
        const outcome = el("span", { className: `hx-badge hx-${run.outcome}`, text: run.outcome });
        const publish = run.publish ? ` · published ${run.publish.saved} saved, ${run.publish.skipped} skipped, ${run.publish.failed} failed` : " · not published";
        const check = el("input", { type: "checkbox" });
        check.checked = picked.includes(run.id);
        check.addEventListener("change", () => { picked = check.checked ? [...picked, run.id].slice(-2) : picked.filter((id) => id !== run.id); renderListBody(); });
        const top = el("div", { className: "hx-top" }, [
          el("div", { className: "hx-row" }, [check, el("span", { className: "hx-title", text: run.company || run.domain || "(unnamed)" }), outcome]),
          el("span", { className: "hx-muted", text: `${when(run.savedAt)} · erased in ${plural(h().daysLeft(run), "day")}` })
        ]);
        const detail = el("div", { className: "hx-muted", text: `${run.domain}${run.pbid ? ` · PBID ${run.pbid}` : ""} · ${plural(run.errors, "error")}, ${plural(run.warnings, "warning")}${publish}` });
        const actions = el("div", { className: "hx-row" }, [
          button("View", () => { view = { name: "run", id: run.id }; note = ""; render(); }, ""),
          button("Copy output", () => copy(run.raw, "The agent's output for this run was copied.")),
          button("Delete", async () => { await h().remove(run.id); picked = picked.filter((id) => id !== run.id); renderListBody(); }, "danger")
        ]);
        body.appendChild(el("div", { className: "hx-item" }, [top, detail, actions]));
      }
      const row = el("div", { className: "hx-row" });
      const compare = button("Compare the 2 ticked runs", () => { view = { name: "compare", ids: picked.slice() }; render(); }, "");
      compare.disabled = picked.length !== 2;
      compare.title = "Tick two runs to compare what changed between them.";
      row.appendChild(compare);
      row.appendChild(button("Export all (file)", async () => {
        const text = h().exportText(await h().list({}));
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url; link.download = `scraperx-history-${new Date().toISOString().slice(0, 10)}.json`;
        shadow.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }));
      row.appendChild(button("Erase all history", async () => {
        if (!window.confirm("Erase every saved run on this computer? This cannot be undone.")) return;
        await h().clear(); picked = []; await renderListBody();
      }, "danger"));
      body.appendChild(el("div", { className: "hx-section", text: "Everything" }));
      body.appendChild(row);
    }

    async function renderRun() {
      const run = (await h().list({})).find((item) => item.id === view.id);
      card.replaceChildren();
      header(run ? `${run.company || run.domain} · ${when(run.savedAt)}` : "Run history");
      if (!run) { card.appendChild(el("p", { text: "This run is no longer saved." })); card.appendChild(button("Back", () => { view = { name: "list" }; render(); })); return; }
      if (note) card.appendChild(el("div", { className: "hx-note", text: note }));
      card.appendChild(el("p", { className: "hx-muted", text: `${run.domain}${run.pbid ? ` · PBID ${run.pbid}` : ""} · tool v${run.version || "?"} · ${run.format} report · ${run.outcome} · erased in ${plural(h().daysLeft(run), "day")}` }));
      card.appendChild(el("div", { className: "hx-row" }, [button("Back", () => { view = { name: "list" }; note = ""; render(); }), button("Copy output", () => copy(run.raw, "The agent's output for this run was copied."))]));
      const facts = Object.entries(run.facts || {});
      card.appendChild(el("div", { className: "hx-section", text: `Values the agent returned (${facts.length})` }));
      if (!facts.length) card.appendChild(el("p", { className: "hx-muted", text: "No values were kept because this report was not accepted. The full output is still saved and can be copied." }));
      else card.appendChild(table(["Field", "Value"], facts.map(([path, value]) => [path, value])));
      if (run.issues.length) {
        card.appendChild(el("div", { className: "hx-section", text: `Messages (${run.issues.length})` }));
        for (const line of run.issues) card.appendChild(el("div", { className: "hx-muted", text: line }));
      }
      if (run.publish) {
        card.appendChild(el("div", { className: "hx-section", text: `Published ${when(run.publish.at)}` }));
        card.appendChild(table(["Field", "Result"], run.publish.rows.map((r) => [r.field, `${r.status}${r.message ? ` — ${r.message}` : ""}`])));
      }
    }

    function table(heads, rows) {
      const t = el("table", { className: "hx-table" }, [el("thead", {}, [el("tr", {}, heads.map((text) => el("th", { text })))]), el("tbody", {}, rows.map((cells) => el("tr", {}, cells.map((text, i) => el("td", { className: i === 0 ? "hx-path" : "", text })))))]);
      return t;
    }

    async function renderCompare() {
      const all = await h().list({});
      const [older, newer] = view.ids.map((id) => all.find((item) => item.id === id)).filter(Boolean).sort((a, b) => a.savedAt - b.savedAt);
      card.replaceChildren();
      header("Compare two runs");
      card.appendChild(el("div", { className: "hx-row" }, [button("Back", () => { view = { name: "list" }; render(); })]));
      if (!older || !newer) { card.appendChild(el("p", { text: "One of these runs is no longer saved." })); return; }
      card.appendChild(el("p", { className: "hx-muted", text: `Older: ${older.company || older.domain}, ${when(older.savedAt)}.  Newer: ${newer.company || newer.domain}, ${when(newer.savedAt)}.` }));
      if (older.domain !== newer.domain) card.appendChild(el("div", { className: "hx-note", text: "These runs are for different websites, so most values will differ." }));
      const changes = h().diff(older, newer);
      card.appendChild(el("div", { className: "hx-section", text: changes.length ? `${plural(changes.length, "value")} differ` : "No values differ" }));
      if (changes.length) {
        const t = el("table", { className: "hx-table" }, [el("thead", {}, [el("tr", {}, ["Field", "Older", "Newer"].map((text) => el("th", { text })))]),
          el("tbody", {}, changes.map((c) => el("tr", {}, [el("td", { className: "hx-path", text: c.path }), el("td", { className: "hx-before", text: c.before ?? "(not present)" }), el("td", { className: "hx-after", text: c.after ?? "(not present)" })])))]);
        card.appendChild(t);
      }
    }

    async function render() {
      if (view.name === "run") await renderRun();
      else if (view.name === "compare") await renderCompare();
      else await renderList();
    }

    async function open() {
      if (!modal.isConnected) shadow.appendChild(modal);
      view = { name: "list" }; note = "";
      try { await h().purge(); } catch { /* an unavailable store just shows an empty list */ }
      await render();
      modal.classList.add("open");
    }

    return { open, close };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.historyUi = { mount };
})();
