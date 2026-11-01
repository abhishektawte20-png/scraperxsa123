"use strict";

/*
 * Check mappings. Goes through every mapping (the team's, yours, and the built-in ones) on the open profile and
 * says for each part whether it is found on the page: the buttons, boxes, tick boxes and Save buttons the
 * extension will press or fill. It WRITES NOTHING: no value is typed, nothing is ticked or saved. Windows and
 * dialogs it needs are opened and closed again, and sections are expanded.
 *
 * A field whose section is not showing is looked for on the profile's other tabs, then the tab you were on is
 * shown again.
 */
(() => {
  const wf = () => globalThis.SXRTS.workflows;
  const sb = () => globalThis.SXRTS.selectorBuilder;
  const mk = (name, ok, note = "") => ({ name, ok, note });
  const friendly = (path) => globalThis.SXRTS.resultsSummary?.friendly?.(path) || path;

  // The paths the built-in Site form fills: a taught mapping for them is never used.
  const SITE_PATHS = ["extras.address", "extras.city", "extras.state", "extras.country", "extras.postcode", "extras.phone", "extras.fax", "extras.siteEmail"];

  function statusOf(result) {
    const parts = result.parts || [];
    if (!parts.length) return "fail";
    if (parts.every((p) => p.ok)) return result.partial ? "warn" : "ok";
    return "fail";
  }

  // The tab button that looks selected, to put the researcher back where they were.
  function activeTab() {
    const buttons = Array.from(document.querySelectorAll("button.navigation__button"));
    const hit = buttons.find((b) => b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-current") === "true" || /\b(active|selected|current)\b/i.test(b.className));
    return hit ? hit.textContent.trim() : "";
  }

  async function withTabs(fn) {
    let result = await fn().catch((error) => ({ parts: [mk("Check", false, error.message)] }));
    const nav = globalThis.SXRTS.navigation;
    if (result.notOnScreen && nav?.navigateToSection) {
      for (const tab of ["Business Entity", "Company"]) {
        await nav.navigateToSection(tab);
        const again = await fn().catch((error) => ({ parts: [mk("Check", false, error.message)], notOnScreen: false }));
        if (!again.notOnScreen) { result = again; break; }
      }
    }
    return result;
  }

  // A built-in mapping kept in registry/*.js (website, email structure, notes, name variations, SIC).
  function checkRegistry(entry) {
    const parts = [];
    const found = (candidates) => (candidates || []).some((selector) => sb().matchAll(selector).length > 0);
    if (entry.addButton) parts.push(mk("Add button", found(entry.addButton.candidates)));
    // Boxes that only exist after Add is pressed are not looked for here.
    if (!entry.addButton) for (const [key, control] of Object.entries(entry.form || {})) parts.push(mk(key, found(control.candidates)));
    if (entry.saveButton) parts.push(mk("Save button", found(entry.saveButton.candidates)));
    return { parts, notOnScreen: parts.some((p) => !p.ok) };
  }

  // onProgress({ done, total, label })
  async function run(onProgress = () => {}) {
    const startTab = activeTab();
    const defs = (globalThis.SXRTS.customFields?.getCached?.() ?? []).filter((def) => !(wf().companySite && SITE_PATHS.includes(def.binds?.path)));
    const entries = (globalThis.SXRTS.registryEntries ?? []).filter((e) => e.evidenceStatus === "ready" && e.key !== "company.sites");
    const jobs = [
      ...(wf().companySite ? [{ group: "Built in", label: "Site (one form)", path: "company.sites", run: () => withTabs(() => wf().companySite.check()) }] : []),
      ...entries.map((e) => ({ group: "Built in", label: friendly(e.key) === e.key ? (e.section || e.key) : friendly(e.key), path: e.key, run: () => withTabs(async () => checkRegistry(e)) })),
      ...defs.map((def) => ({ group: def.binds ? "Mapped fields" : "Taught fields", label: def.label, path: def.binds?.path || def.key, run: () => wf().customField.checkField(def) }))
    ];
    try { await globalThis.SXRTS.navigation?.expandAll?.(); } catch { /* a page without the control carries on */ }
    const rows = [];
    for (const [i, job] of jobs.entries()) {
      onProgress({ done: i, total: jobs.length, label: job.label });
      let result;
      try { result = await job.run(); } catch (error) { result = { parts: [mk("Check", false, error.message)] }; }
      rows.push({ group: job.group, label: job.label, path: job.path, status: statusOf(result), parts: result.parts || [] });
    }
    if (startTab) { try { await globalThis.SXRTS.navigation?.navigateToSection?.(startTab); } catch { /* best effort */ } }
    onProgress({ done: jobs.length, total: jobs.length, label: "" });
    const count = (status) => rows.filter((r) => r.status === status).length;
    return { rows, ok: count("ok"), warn: count("warn"), fail: count("fail") };
  }

  // The report as text, for the developer.
  function asText(result) {
    const mark = { ok: "OK  ", warn: "WARN", fail: "FAIL" };
    const lines = [`Check mappings: ${result.ok} ok, ${result.warn} to look at, ${result.fail} not found (${result.rows.length} checked)`, ""];
    for (const row of result.rows) {
      lines.push(`${mark[row.status]} ${row.label} [${row.group}]`);
      for (const part of row.parts) if (!part.ok || part.note) lines.push(`       ${part.ok ? "·" : "✗"} ${part.name}${part.note ? ` — ${part.note}` : ""}`);
    }
    return lines.join("\n");
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.mappingCheck = { run, asText, statusOf, checkRegistry, SITE_PATHS };
})();
