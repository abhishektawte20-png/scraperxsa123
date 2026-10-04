"use strict";

/*
 * Run history for quality assurance. Every validated (or rejected) paste is
 * kept with its date so that, weeks later, a QA specialist's findings can be
 * compared with what the agent returned on the day. Records are erased
 * automatically RETENTION_DAYS after they were saved; nothing leaves the
 * browser unless the researcher exports or copies it.
 */
(() => {
  const KEY = "sxrts_history";
  const RETENTION_DAYS = 15;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_RECORDS = 300;
  const MAX_FACTS = 400;
  const MAX_RAW = 200000;

  const store = () => globalThis.chrome?.storage?.local;

  async function readAll() {
    const area = store();
    if (!area) return [];
    const stored = await area.get(KEY);
    return Array.isArray(stored?.[KEY]) ? stored[KEY] : [];
  }

  async function writeAll(records) {
    const area = store();
    if (!area) return;
    let keep = records.slice(0, MAX_RECORDS);
    // Browser storage has a size limit: drop the oldest until it fits.
    for (;;) {
      try {
        await area.set({ [KEY]: keep });
        return;
      } catch (error) {
        if (keep.length <= 1) throw error;
        keep = keep.slice(0, Math.max(1, Math.floor(keep.length * 0.8)));
      }
    }
  }

  function fresh(records, now) {
    return records.filter((item) => item.expiresAt > now);
  }

  // Removes everything past its retention date. Returns how many were erased.
  async function purge(now = Date.now()) {
    const all = await readAll();
    const kept = fresh(all, now);
    if (kept.length !== all.length) await writeAll(kept);
    return all.length - kept.length;
  }

  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  // The values that go to RTS, flattened to "path" -> text, so two runs can be
  // compared field by field. Sources, warnings and bookkeeping are left out.
  function flatten(validated) {
    const facts = {};
    const skip = new Set(["rovo", "rulesApplied", "warnings", "meta", "schemaVersion", "source", "confidence", "action", "sourceDate"]);
    const walk = (node, trail) => {
      if (Object.keys(facts).length >= MAX_FACTS || node === null || node === undefined) return;
      if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${trail}[${index}]`)); return; }
      if (typeof node === "object") {
        for (const [key, value] of Object.entries(node)) if (!skip.has(key)) walk(value, trail ? `${trail}.${key}` : key);
        return;
      }
      facts[trail] = String(node);
    };
    walk(validated ?? {}, "");
    return facts;
  }

  function newId(now) {
    return `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  /*
   * Saves one run. The same paste for the same company within a minute updates
   * the earlier record instead of adding a duplicate.
   * entry: { domain, company, pbid, version, outcome, format, issues, raw, validated }
   */
  async function record(entry, now = Date.now()) {
    const all = fresh(await readAll(), now);
    const raw = String(entry.raw ?? "").slice(0, MAX_RAW);
    const digest = hash(raw);
    const domain = String(entry.domain ?? "").trim().toLowerCase();
    const existing = all.find((item) => item.hash === digest && item.domain === domain && now - item.savedAt < 60 * 1000);
    const issues = (entry.issues ?? []).map(String).slice(0, 80);
    const base = {
      domain, company: String(entry.company ?? ""), pbid: String(entry.pbid ?? ""), version: String(entry.version ?? ""),
      outcome: entry.outcome, format: entry.format || "json", errors: entry.errors ?? 0, warnings: entry.warnings ?? 0,
      issues, raw, hash: digest, facts: entry.validated ? flatten(entry.validated) : {}
    };
    let saved;
    if (existing) {
      saved = Object.assign(existing, base, { savedAt: now, expiresAt: now + RETENTION_DAYS * DAY_MS });
    } else {
      saved = { id: newId(now), savedAt: now, expiresAt: now + RETENTION_DAYS * DAY_MS, publish: null, ...base };
      all.unshift(saved);
    }
    await writeAll(all);
    return saved.id;
  }

  // What happened when the researcher published: one line per field.
  async function attachPublish(id, publish, now = Date.now()) {
    if (!id) return false;
    const all = fresh(await readAll(), now);
    const target = all.find((item) => item.id === id);
    if (!target) return false;
    target.publish = {
      at: now,
      saved: publish.saved ?? 0, skipped: publish.skipped ?? 0, failed: publish.failed ?? 0,
      rows: (publish.rows ?? []).slice(0, 120).map((row) => ({ field: String(row.field), status: String(row.status), message: String(row.message ?? ""), value: String(row.value ?? "").slice(0, 300) }))
    };
    await writeAll(all);
    return true;
  }

  async function list({ query = "", now = Date.now() } = {}) {
    const all = fresh(await readAll(), now);
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const rows = words.length
      ? all.filter((item) => words.every((word) => `${item.domain} ${item.company} ${item.pbid}`.toLowerCase().includes(word)))
      : all;
    return rows.slice().sort((a, b) => b.savedAt - a.savedAt);
  }

  async function remove(id) {
    await writeAll((await readAll()).filter((item) => item.id !== id));
  }

  async function clear() {
    const area = store();
    if (area) await area.remove(KEY);
  }

  function daysLeft(item, now = Date.now()) {
    return Math.max(0, Math.ceil((item.expiresAt - now) / DAY_MS));
  }

  // Field-by-field differences between two saved runs (older -> newer).
  function diff(older, newer) {
    const a = older?.facts ?? {};
    const b = newer?.facts ?? {};
    const out = [];
    for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[path] === b[path]) continue;
      out.push({ path, before: a[path] ?? null, after: b[path] ?? null });
    }
    return out.sort((x, y) => x.path.localeCompare(y.path));
  }

  function exportText(records, now = Date.now()) {
    return JSON.stringify({ exportedAt: new Date(now).toISOString(), retentionDays: RETENTION_DAYS, runs: records }, null, 2);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.history = { KEY, RETENTION_DAYS, MAX_RECORDS, purge, record, attachPublish, list, remove, clear, daysLeft, diff, flatten, exportText };
})();
