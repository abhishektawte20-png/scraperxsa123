"use strict";

/*
 * Undo. Every publish writes a ledger: what was saved to RTS, the value that was there before (when the
 * workflow could read it) and how it can be put back.
 *
 *   - Reverted by the extension, then read back from RTS: the Industry tick (unticked and saved), Website
 *     address and Email default structure (the previous value restored, or the box emptied for a website that
 *     was empty), and mapped single-value fields that held a value before.
 *   - Listed for removal by hand: everything added as a new row (name variations, keywords, SIC/NAICS, sites,
 *     social media, management, research notes). The ledger names each item exactly, because the extension has
 *     not been taught how RTS deletes those rows and will not guess.
 *
 * An undo never claims success unless RTS shows the previous state afterwards. It is blocked on a different
 * profile than the one the run was made on. Kept RETENTION_DAYS, like the run history.
 */
(() => {
  const KEY = "sxrts_undo_ledger";
  const DAY = 24 * 60 * 60 * 1000;
  const RETENTION_DAYS = 15;
  const MAX_RUNS = 20;

  const store = () => globalThis.chrome?.storage?.local;
  const baseOf = (path) => String(path ?? "").replace(/\[\d+\]/g, "");

  const MANUAL_HINT = {
    "businessEntity.nameVariations": "Delete this name variation row in Business Entity > Name Variations.",
    "company.keywords": "Remove this keyword tag in Company > Keywords.",
    "company.sicCodes": "Delete this SIC code row in the Company's SIC section.",
    "company.naicsCodes": "Delete this NAICS code row.",
    "businessEntity.socialMediaIdentifiers": "Delete this social media identifier row.",
    "businessEntity.researchNotes": "Remove this text from the Research Notes box.",
    "extras.management": "Remove this management entry.",
    "company.sites": "Delete this site in Company > Site (use its Delete / remove control)."
  };

  // How an undo can be done for one published item. `before` is the value RTS held before the run.
  function planFor(item) {
    const path = baseOf(item.path);
    if (item.customKey && item.treeWindow) return { kind: "industry", auto: true };
    if (path === "businessEntity.websiteAddresses") return { kind: "website", auto: item.before !== undefined && item.before !== null };
    if (path === "businessEntity.emailDefaultStructure") return { kind: "email", auto: Boolean(item.before) };
    if (item.customKey && item.single && item.before) return { kind: "single", auto: true };
    return { kind: "manual", auto: false, hint: MANUAL_HINT[path] || "Remove this entry in RTS." };
  }

  async function readAll() {
    const area = store();
    if (!area) return [];
    const stored = await area.get(KEY);
    return Array.isArray(stored?.[KEY]) ? stored[KEY] : [];
  }
  async function writeAll(runs) {
    const area = store();
    if (!area) return;
    await area.set({ [KEY]: runs.slice(0, MAX_RUNS) });
  }
  const fresh = (runs, now) => runs.filter((run) => run.expiresAt > now);

  // run: { domain, company, rtsIdentity, items: [{ path, label, value, before?, customKey?, treeWindow?, single? }] }
  async function record(run, now = Date.now()) {
    const items = (run.items ?? []).map((item, i) => {
      const plan = planFor(item);
      return {
        id: `${i}`, path: String(item.path), label: String(item.label ?? item.path), value: String(item.value ?? "").slice(0, 400),
        before: item.before === undefined || item.before === null ? null : String(item.before).slice(0, 400),
        customKey: item.customKey || null, kind: plan.kind, auto: plan.auto, hint: plan.hint || "", state: "pending", note: ""
      };
    });
    if (!items.length) return null;
    const saved = {
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now, expiresAt: now + RETENTION_DAYS * DAY,
      domain: String(run.domain ?? ""), company: String(run.company ?? ""), rtsIdentity: run.rtsIdentity ?? null, items
    };
    await writeAll([saved, ...fresh(await readAll(), now)]);
    return saved.id;
  }

  async function list(now = Date.now()) {
    return fresh(await readAll(), now).sort((a, b) => b.at - a.at);
  }

  async function markItem(runId, itemId, state, note = "") {
    const runs = await readAll();
    const item = runs.find((r) => r.id === runId)?.items.find((i) => i.id === itemId);
    if (!item) return false;
    item.state = state;
    item.note = note;
    await writeAll(runs);
    return true;
  }

  async function clear() {
    await store()?.remove(KEY);
  }

  // Reverts one item in the open RTS page. Returns { ok, message }. Never reports ok without RTS showing the old state.
  async function undoItem(item) {
    const wf = globalThis.SXRTS.workflows;
    try {
      if (item.kind === "industry") {
        const def = globalThis.SXRTS.customFields?.getDefinition(item.customKey);
        if (!def) return { ok: false, message: "The mapping for this field no longer exists." };
        const result = await wf.customField.applyCustomField(def, { action: "addIfMissing", value: item.value, undo: true });
        if (result.status === "savedValueVerified") return { ok: true, message: "Unticked and read back from RTS." };
        if (result.status === "skipped") return { ok: true, message: result.reason || "Already not ticked." };
        return { ok: false, message: `Unexpected result (${result.status}).` };
      }
      if (item.kind === "website" || item.kind === "email") {
        const key = item.kind === "website" ? "websiteAddresses" : "emailDefaultStructure";
        const record = { action: "replaceAfterConfirmation", value: item.before ?? "" };
        const group = await wf.businessEntityGeneral.applyBusinessEntityGeneral({ [key]: item.kind === "website" ? [record] : record });
        const outcome = group.results?.[key];
        if (outcome?.status === "savedValueVerified") return { ok: true, message: item.before ? `Put back "${item.before}".` : "Emptied." };
        return { ok: false, message: outcome?.reason || group.reason || "RTS did not confirm the change." };
      }
      if (item.kind === "single") {
        const def = globalThis.SXRTS.customFields?.getDefinition(item.customKey);
        if (!def) return { ok: false, message: "The mapping for this field no longer exists." };
        const result = await wf.customField.applyCustomField(def, { action: "replaceAfterConfirmation", value: item.before });
        if (result.status === "savedValueVerified") return { ok: true, message: `Put back "${item.before}".` };
        return { ok: false, message: result.reason || result.detail || `Unexpected result (${result.status}).` };
      }
      return { ok: false, message: "This one has to be removed by hand." };
    } catch (error) {
      return { ok: false, message: error.message || String(error) };
    }
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.undoLedger = { KEY, RETENTION_DAYS, planFor, record, list, markItem, clear, undoItem };
})();
