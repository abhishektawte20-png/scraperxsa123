"use strict";

/*
 * Field health. After every publish, one line per field is kept: saved, already in RTS,
 * failed (with the message) or not mapped. From these the extension can show, per field,
 * how often it works, and build the weekly digest for the team channel.
 *
 * "Success rate" means: of the attempts to write the field, how many were saved and read
 * back from RTS (or were already there). It measures whether the automation works. It
 * cannot tell whether the agent's value was right; that stays with the researcher/QA.
 *
 * Kept in this browser for RETENTION_DAYS; nothing leaves it except the digest the
 * researcher sends, or the scheduled one posted to the team channel.
 */
(() => {
  const KEY = "sxrts_field_stats";
  const DIGEST_KEY = "sxrts_digest_state";
  const DAY = 24 * 60 * 60 * 1000;
  const RETENTION_DAYS = 35;
  const MAX_EVENTS = 3000;

  const store = () => globalThis.chrome?.storage?.local;
  const ALREADY = /already (has|exists|equals|ticked|there|linked|have)|already has an entry|\bduplicate\b|is already/i;
  const NOT_MAPPED = /No selector registry entry|Selector evidence|not been mapped|not mapped/i;
  const baseOf = (path) => String(path ?? "").replace(/\[\d+\]/g, "");

  // saved | already | failed | unmapped | other (a deliberate skip such as action=skip)
  function classify(row) {
    const status = String(row?.status ?? "");
    const message = String(row?.message ?? "");
    if (status === "savedValueVerified") return "saved";
    if (status === "failed") return "failed";
    if (status === "skipped") {
      if (ALREADY.test(message)) return "already";
      if (NOT_MAPPED.test(message)) return "unmapped";
      return "other";
    }
    return status === "pending" ? "other" : "other";
  }

  async function readAll() {
    const area = store();
    if (!area) return [];
    const stored = await area.get(KEY);
    return Array.isArray(stored?.[KEY]) ? stored[KEY] : [];
  }

  async function writeAll(events) {
    const area = store();
    if (!area) return;
    let keep = events.slice(-MAX_EVENTS);
    for (;;) {
      try { await area.set({ [KEY]: keep }); return; } catch (error) {
        if (keep.length <= 1) throw error;
        keep = keep.slice(Math.floor(keep.length * 0.2));
      }
    }
  }

  // rows: [{ field, status, message, value }]; meta: { domain, company, version }
  async function record(rows, meta = {}, now = Date.now()) {
    const events = (await readAll()).filter((e) => e.at > now - RETENTION_DAYS * DAY);
    for (const row of rows ?? []) {
      const kind = classify(row);
      if (kind === "other") continue;
      events.push({
        at: now, path: baseOf(row.field), kind,
        domain: String(meta.domain ?? "").slice(0, 80), version: String(meta.version ?? "").slice(0, 20),
        message: kind === "failed" ? String(row.message ?? "").slice(0, 300) : "",
        value: kind === "failed" ? String(row.value ?? "").slice(0, 160) : ""
      });
    }
    await writeAll(events);
  }

  function summarize(events, { since = 0 } = {}) {
    const rows = new Map();
    let total = { saved: 0, already: 0, failed: 0, unmapped: 0 };
    const runs = new Set();
    for (const e of events.filter((x) => x.at >= since)) {
      runs.add(e.at);
      const row = rows.get(e.path) ?? { path: e.path, saved: 0, already: 0, failed: 0, unmapped: 0, errors: new Map() };
      row[e.kind] += 1;
      total[e.kind] += 1;
      if (e.kind === "failed" && e.message) row.errors.set(e.message, (row.errors.get(e.message) ?? 0) + 1);
      rows.set(e.path, row);
    }
    const list = Array.from(rows.values()).map((r) => {
      const tried = r.saved + r.already + r.failed;
      const topError = Array.from(r.errors.entries()).sort((a, b) => b[1] - a[1])[0];
      return {
        path: r.path, saved: r.saved, already: r.already, failed: r.failed, unmapped: r.unmapped,
        tried, rate: tried ? (r.saved + r.already) / tried : null,
        topError: topError ? topError[0] : ""
      };
    }).sort((a, b) => (b.failed - a.failed) || (b.unmapped - a.unmapped) || a.path.localeCompare(b.path));
    const tried = total.saved + total.already + total.failed;
    return { runs: runs.size, rows: list, total: { ...total, tried, rate: tried ? (total.saved + total.already) / tried : null } };
  }

  const pct = (rate) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

  function failureLogs(events, { since = 0, limit = 25 } = {}) {
    return events.filter((e) => e.kind === "failed" && e.at >= since).sort((a, b) => b.at - a.at).slice(0, limit);
  }

  function label(path) {
    return globalThis.SXRTS?.resultsSummary?.friendly?.(path) || path;
  }

  // The digest as plain text: totals, the fields that fail most, and the failure logs.
  function digestText(events, { since, days = 7, now = Date.now() } = {}) {
    const from = since ?? now - days * DAY;
    const s = summarize(events, { since: from });
    const lines = [
      `ScraperX weekly digest · ${new Date(from).toISOString().slice(0, 10)} to ${new Date(now).toISOString().slice(0, 10)}`,
      `Fields attempted: ${s.total.tried} · saved ${s.total.saved} · already in RTS ${s.total.already} · failed ${s.total.failed} · not mapped ${s.total.unmapped}`,
      `Success rate (saved or already there, of attempts): ${pct(s.total.rate)}`,
      "",
      "Per field (success rate · saved/already/failed · not mapped):"
    ];
    if (!s.rows.length) lines.push("  No runs recorded in this period.");
    for (const r of s.rows) lines.push(`  ${label(r.path)}: ${pct(r.rate)} · ${r.saved}/${r.already}/${r.failed} · ${r.unmapped} not mapped${r.topError ? ` · most common error: ${r.topError.slice(0, 140)}` : ""}`);
    const logs = failureLogs(events, { since: from });
    lines.push("", `Failure log (${logs.length} most recent):`);
    if (!logs.length) lines.push("  No failures. ");
    for (const e of logs) lines.push(`  ${new Date(e.at).toISOString().slice(0, 16).replace("T", " ")} · ${e.domain || "no site"} · ${label(e.path)} · v${e.version || "?"} · ${e.message || "(no message)"}${e.value ? ` · value: ${e.value}` : ""}`);
    return { text: lines.join("\n"), summary: s, logs };
  }

  async function digest(opts = {}) {
    return digestText(await readAll(), opts);
  }

  async function clear() {
    await store()?.remove(KEY);
  }

  async function getState() {
    const stored = await store()?.get(DIGEST_KEY);
    return stored?.[DIGEST_KEY] ?? {};
  }
  async function setState(state) {
    await store()?.set({ [DIGEST_KEY]: state });
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.fieldStats = { KEY, DIGEST_KEY, DAY, RETENTION_DAYS, classify, record, summarize, failureLogs, digestText, digest, clear, readAll, getState, setState, pct };
})();
