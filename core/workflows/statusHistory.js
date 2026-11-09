"use strict";

/*
 * Business Entity > Ownership Status History and Business Status History. Each is a small table (a ticked "current"
 * row, a date box and a status drop-down) with "Add New ... Status" and its own Save button.
 *
 * For one wanted row (a date and a status):
 *   - a row that already shows exactly that date and status: nothing is changed ("already in RTS");
 *   - otherwise, when the table has rows, the current row is overwritten with the wanted date and status;
 *   - an empty table gets a new row through "Add New ...".
 * The Save button is pressed once, and success is only claimed after the rows are read back from the page.
 */
(() => {
  const KINDS = {
    ownership: { title: "ownership status history", add: "Add New Ownership Status", save: "#saveOwnershipStatusHistory", label: "Ownership status history" },
    business: { title: "business status history", add: "Add New Business Status", save: "#saveTargetStageHistory", label: "Business status history" }
  };
  const TIMEOUTS = { add: 4000, field: 4000, save: 10000 };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const key = (text) => squash(text).toLowerCase();

  async function waitFor(check, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (check()) return true; await wait(40); }
    return Boolean(check());
  }
  const shown = (node) => (typeof node.checkVisibility === "function" ? node.checkVisibility() : true);

  function findAdd(kind) {
    return Array.from(document.querySelectorAll("input[type=button], input[type=submit], button")).find((node) => key(node.value || node.textContent) === key(KINDS[kind].add) && shown(node)) || null;
  }

  // The block that holds this table: the nearest ancestor of its Add button that also carries the table's heading.
  function sectionOf(add, kind) {
    for (let node = add.parentElement; node; node = node.parentElement) if (key(node.textContent).includes(KINDS[kind].title)) return node;
    return add.parentElement;
  }

  function rowsOf(section) {
    const rows = [];
    for (const date of Array.from(section.querySelectorAll("input.shDate"))) {
      let row = date.parentElement;
      while (row && row !== section && !row.querySelector("select.shStatus")) row = row.parentElement;
      const status = row && row !== section ? row.querySelector("select.shStatus") : null;
      if (status && !rows.some((r) => r.row === row)) rows.push({ row, date, status });
    }
    return rows;
  }
  const readRow = (r) => ({ date: squash(r.date.value), status: squash(r.status.selectedOptions[0]?.textContent) });

  // The row marked current: it carries a tick (an element whose class or name says check / current / tick), else the first.
  function currentRow(rows) {
    const marked = rows.find((r) => Array.from(r.row.querySelectorAll("*")).some((node) => /check|current|tick/i.test(`${typeof node.className === "string" ? node.className : ""} ${node.getAttribute?.("title") || ""} ${node.getAttribute?.("aria-label") || ""}`) && !node.matches?.("input.shDate, select.shStatus")));
    return marked || rows[0];
  }

  async function writeRow(r, wanted) {
    const textField = globalThis.SXRTS.adapters.textField;
    const nativeSelect = globalThis.SXRTS.adapters.nativeSelect;
    if (squash(r.date.value) !== wanted.date) {
      await textField.applyText(r.date, wanted.date);
      if (squash(r.date.value) !== wanted.date) throw new Error(`The date box did not keep ${wanted.date} (RTS may have rejected the date).`);
    }
    const option = nativeSelect.findExactOption(r.status, wanted.status);
    if (!option) throw new Error(`"${wanted.status}" is not one of the status choices in RTS.`);
    if (r.status.selectedOptions[0] !== option) {
      await nativeSelect.selectNativeOption(r.status, option.textContent);
      if (r.status.selectedOptions[0] !== option) throw new Error(`The status drop-down did not keep "${wanted.status}".`);
    }
  }

  // kind: "ownership" | "business"; wanted: { date: "MM/DD/YYYY", status: "Privately Held" }
  async function applyStatusHistory(kind, wanted) {
    const spec = KINDS[kind];
    if (!spec) throw new Error(`Unknown status history "${kind}".`);
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(wanted?.date))) throw new Error(`${spec.label}: the date must be MM/DD/YYYY.`);
    const add = findAdd(kind);
    if (!add) throw new Error(`The "${spec.add}" button was not found. Open the Business Entity tab and its section so ${spec.label} is on screen, then publish again.`);
    const section = sectionOf(add, kind);
    let rows = rowsOf(section);

    const same = rows.find((r) => { const now = readRow(r); return now.date === wanted.date && key(now.status) === key(wanted.status); });
    if (same) return { status: "skipped", reason: `${spec.label} already has ${wanted.date} · ${wanted.status}.` };

    let target;
    let before = "";
    if (rows.length) {
      target = currentRow(rows);
      const now = readRow(target);
      before = `${now.date || "(no date)"} · ${now.status || "(no status)"}`;
    } else {
      if (add.disabled) throw new Error(`The "${spec.add}" button is disabled right now.`);
      add.click();
      if (!(await waitFor(() => rowsOf(sectionOf(findAdd(kind) || add, kind)).length > rows.length, TIMEOUTS.add))) throw new Error(`Clicking "${spec.add}" did not add a row.`);
      rows = rowsOf(sectionOf(findAdd(kind) || add, kind));
      target = rows[rows.length - 1];
    }

    await writeRow(target, wanted);

    const save = document.querySelector(spec.save);
    if (!save) throw new Error(`The Save button for ${spec.label} (${spec.save}) was not found.`);
    if (!(await waitFor(() => !save.disabled, TIMEOUTS.field))) throw new Error(`The Save button for ${spec.label} stayed disabled, so RTS did not register the change.`);
    save.click();
    if (!(await waitFor(() => save.disabled || !save.isConnected, TIMEOUTS.save))) throw new Error(`Save did not complete for ${spec.label}: the Save button never returned to disabled.`);
    await wait(150);

    // Read back: a row now shows the wanted date and status.
    const again = rowsOf(sectionOf(findAdd(kind) || add, kind));
    const found = again.some((r) => { const now = readRow(r); return now.date === wanted.date && key(now.status) === key(wanted.status); });
    if (!found) throw new Error(`Save was pressed for ${spec.label}, but the table does not show ${wanted.date} · ${wanted.status} afterwards. Check it in RTS.`);
    return { status: "savedValueVerified", before, detail: before ? `${spec.label}: changed ${before} to ${wanted.date} · ${wanted.status}.` : `${spec.label}: added ${wanted.date} · ${wanted.status}.` };
  }

  // A start date as the report gives it ("2022", "05/2022", "2022-05", "May 2022", "05/17/2022") -> MM/DD/YYYY, or null.
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const two = (n) => String(n).padStart(2, "0");
  function toMdy(value) {
    const text = squash(value);
    let m;
    if ((m = /^(\d{4})$/.exec(text))) return `01/01/${m[1]}`;
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) return `${two(m[1])}/${two(m[2])}/${m[3]}`;
    if ((m = /^(\d{1,2})\/(\d{4})$/.exec(text))) return `${two(m[1])}/01/${m[2]}`;
    if ((m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(text))) return `${two(m[2])}/${two(m[3] || 1)}/${m[1]}`;
    if ((m = /^([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})/.exec(text))) { const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (mi >= 0) return `${two(mi + 1)}/${two(m[2] || 1)}/${m[3]}`; }
    if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(text))) { const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi >= 0) return `${two(mi + 1)}/${two(m[1])}/${m[3]}`; }
    if ((m = /^(\d{4})/.exec(text))) return `01/01/${m[1]}`;
    return null;
  }
  const todayMdy = (now = new Date()) => `${two(now.getMonth() + 1)}/${two(now.getDate())}/${now.getFullYear()}`;

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.statusHistory = { applyStatusHistory, toMdy, todayMdy, TIMEOUTS, KINDS };
})();
