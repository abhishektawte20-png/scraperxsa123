"use strict";

/*
 * Saved "output rules": small, deterministic text changes the researcher
 * defines once and the extension applies to the agent's output before it is
 * previewed or written to RTS (for example: Facebook -> keep only the last
 * part of the URL, so "facebook.com/RelianceIndustriesLimited/" becomes
 * "RelianceIndustriesLimited"). A rule = one target field + an ordered list
 * of steps. Literal text operations only (no regular expressions), so a rule
 * can never behave unpredictably. Rules live in this browser's storage.
 */
(() => {
  const STORAGE_KEY = "sxrts_output_rules";
  const LABEL_PATTERN = /^[^<>&"'`\\]{1,60}$/;
  const PARAM_PATTERN = /^[^\n\r]{0,120}$/;
  const MAX_STEPS = 8;
  let cached = [];

  // ---------- steps ----------

  const PROTOCOL = /^[a-z][a-z0-9+.-]*:\/\//i;

  function pathParts(value) {
    const base = value.trim().replace(PROTOCOL, "").split(/[?#]/)[0];
    return base.includes("/") ? base.split("/").filter(Boolean) : [];
  }

  const STEPS = {
    lastPathSegment: {
      label: "Keep only the last part of the URL (e.g. the handle)", params: [],
      run: (v) => { const parts = pathParts(v); return parts.length >= 2 ? parts[parts.length - 1] : v; }
    },
    pathAfterDomain: {
      label: "Remove the website name, keep the path after it", params: [],
      run: (v) => { const parts = pathParts(v); return parts.length >= 2 ? parts.slice(1).join("/") : v; }
    },
    removeProtocol: { label: "Remove https:// and www.", params: [], run: (v) => v.replace(PROTOCOL, "").replace(/^www\./i, "") },
    stripQuery: { label: "Remove ?query and #fragment", params: [], run: (v) => v.split(/[?#]/)[0] },
    stripTrailingSlash: { label: "Remove trailing slash", params: [], run: (v) => v.replace(/\/+$/, "") },
    stripAt: { label: "Remove a leading @", params: [], run: (v) => v.replace(/^@+/, "") },
    trim: { label: "Trim spaces", params: [], run: (v) => v.trim() },
    lowercase: { label: "Make lowercase", params: [], run: (v) => v.toLowerCase() },
    replace: {
      label: "Replace text", params: ["find", "with"],
      run: (v, p) => (p.find ? v.split(p.find).join(p.with ?? "") : v)
    },
    prefix: { label: "Add text at the start", params: ["text"], run: (v, p) => `${p.text ?? ""}${v}` },
    suffix: { label: "Add text at the end", params: ["text"], run: (v, p) => `${v}${p.text ?? ""}` }
  };

  function runSteps(steps, value) {
    let current = String(value);
    for (const step of steps) {
      const def = STEPS[step.type];
      if (def) current = def.run(current, step);
    }
    return current;
  }

  // ---------- targets ----------

  const NETWORKS = { facebook: "facebook", instagram: "instagram", linkedin: "linkedin", "twitter/x": "twitter_x", twitter: "twitter_x", x: "twitter_x", youtube: "youtube" };

  const TARGETS = [
    { id: "smi.facebook", label: "Social media: Facebook", example: "https://www.facebook.com/RelianceIndustriesLimited/" },
    { id: "smi.instagram", label: "Social media: Instagram", example: "https://www.instagram.com/relianceindustries/" },
    { id: "smi.linkedin", label: "Social media: LinkedIn", example: "https://www.linkedin.com/company/reliance-industries-limited/" },
    { id: "smi.twitter_x", label: "Social media: Twitter/X", example: "https://x.com/RelianceJio" },
    { id: "smi.youtube", label: "Social media: YouTube", example: "https://www.youtube.com/@RelianceIndustries" },
    { id: "smi.any", label: "Social media: every network", example: "https://www.facebook.com/RelianceIndustriesLimited/" },
    { id: "website", label: "Website Address", example: "https://www.reliance.com/" },
    { id: "nameVariations", label: "Name variations (the name)", example: "Reliance Industries Limited" },
    { id: "keywords", label: "Keywords", example: "streetwear apparel" },
    { id: "briefDescription", label: "Brief description", example: "Designer of streetwear apparel intended for individual consumers." },
    { id: "fullDescription", label: "Full description", example: "The company offers t-shirts, enabling customers to express individuality." }
  ];

  const isObject = (v) => v !== null && typeof v === "object";

  function refsFor(doc, targetId) {
    const refs = [];
    const add = (path, holder, key) => { if (isObject(holder) && typeof holder[key] === "string") refs.push({ path, get: () => holder[key], set: (v) => { holder[key] = v; } }); };
    const list = (value) => (Array.isArray(value) ? value : []);
    const be = doc?.businessEntity;
    const co = doc?.company;
    if (targetId.startsWith("smi.")) {
      const wanted = targetId.slice(4);
      list(be?.socialMediaIdentifiers).forEach((entry, i) => {
        const network = NETWORKS[String(entry?.network ?? "").trim().toLowerCase()];
        if (wanted === "any" || network === wanted) add(`businessEntity.socialMediaIdentifiers[${i}].handleOrUrl`, entry, "handleOrUrl");
      });
    } else if (targetId === "website") {
      list(be?.websiteAddresses).forEach((entry, i) => add(`businessEntity.websiteAddresses[${i}].value`, entry, "value"));
    } else if (targetId === "nameVariations") {
      list(be?.nameVariations).forEach((entry, i) => add(`businessEntity.nameVariations[${i}].name`, entry, "name"));
    } else if (targetId === "keywords") {
      list(co?.keywords).forEach((entry, i) => add(`company.keywords[${i}].value`, entry, "value"));
    } else if (targetId === "briefDescription" || targetId === "fullDescription") {
      add(`company.${targetId}.value`, co?.[targetId], "value");
    }
    return refs;
  }

  // ---------- rules ----------

  function validateRule(rule) {
    const errors = [];
    if (!isObject(rule)) return ["The rule must be an object."];
    if (!LABEL_PATTERN.test(rule.label || "")) errors.push('Give the rule a name (no < > & quotes or backslashes).');
    if (!TARGETS.some((t) => t.id === rule.target)) errors.push("Pick which field the rule applies to.");
    if (!Array.isArray(rule.steps) || !rule.steps.length) errors.push("Add at least one step.");
    else if (rule.steps.length > MAX_STEPS) errors.push(`A rule can have at most ${MAX_STEPS} steps.`);
    else {
      for (const step of rule.steps) {
        const def = STEPS[step?.type];
        if (!def) { errors.push(`Unknown step "${step?.type}".`); continue; }
        for (const param of def.params) {
          if (typeof (step[param] ?? "") !== "string" || !PARAM_PATTERN.test(step[param] ?? "")) errors.push(`Step "${def.label}": "${param}" must be short plain text.`);
        }
        if (step.type === "replace" && !step.find) errors.push('Step "Replace text" needs the text to find.');
      }
    }
    return errors;
  }

  // Like the field mappings: the team's shipped rules plus this browser's own,
  // a local rule with the same id replacing the team's. Only local ones are stored.
  let local = [];
  let team = [];

  function rebuild() {
    cached = [...team.filter((t) => !local.some((l) => l.id === t.id)).map((t) => ({ ...t, fromTeam: true })), ...local];
  }

  async function load() {
    const shipped = globalThis.SXRTS.teamDefaults?.rules;
    team = Array.isArray(shipped) ? shipped.filter((r) => validateRule(r).length === 0 && r.id) : [];
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      local = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY].filter((r) => validateRule(r).length === 0) : [];
    } catch {
      local = [];
    }
    rebuild();
    return cached;
  }

  const getCached = () => cached;
  const getTeam = () => team;
  const isFromTeam = (rule) => Boolean(rule?.fromTeam);
  const overridesTeam = (rule) => !rule?.fromTeam && team.some((t) => t.id === rule.id);

  async function persist(nextLocal) {
    await chrome.storage.local.set({ [STORAGE_KEY]: nextLocal });
    local = nextLocal;
    rebuild();
  }

  async function saveRule(rule) {
    const errors = validateRule(rule);
    if (errors.length) throw new Error(errors.join(" "));
    const record = { id: rule.id || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label: rule.label.trim(), target: rule.target, steps: rule.steps.map((s) => ({ ...s })), enabled: rule.enabled !== false };
    await persist([...local.filter((r) => r.id !== record.id), record]);
    return record;
  }

  // Removes this browser's own rule; a team rule with the same id comes back.
  async function removeRule(id) {
    await persist(local.filter((r) => r.id !== id));
  }

  async function resetToTeam() {
    const kept = local.filter((r) => !team.some((t) => t.id === r.id));
    const dropped = local.length - kept.length;
    await persist(kept);
    return dropped;
  }

  function exportable() {
    return cached.map(({ fromTeam, ...rule }) => rule);
  }

  async function importRules(list) {
    const skipped = [];
    let next = [...local];
    for (const rule of list) {
      const errors = validateRule(rule);
      if (errors.length || !rule.id) { skipped.push(`${rule?.label || "A rule"}: ${errors.join(" ") || "it has no id."}`); continue; }
      const { fromTeam, ...clean } = rule;
      next = [...next.filter((r) => r.id !== clean.id), clean];
    }
    await persist(next);
    return { imported: list.length - skipped.length, skipped };
  }

  // Applies every enabled rule to the internal document, in place. A step
  // chain that would leave a value empty is skipped, never applied.
  function apply(doc, rules = cached) {
    const applied = [];
    for (const rule of rules) {
      if (rule.enabled === false) continue;
      for (const ref of refsFor(doc, rule.target)) {
        const before = ref.get();
        const after = runSteps(rule.steps, before);
        if (after === before || !after.trim()) continue;
        ref.set(after);
        applied.push({ ruleId: rule.id, rule: rule.label, target: rule.target, path: ref.path, before, after });
      }
    }
    return applied;
  }

  function describeSteps(steps) {
    return steps.map((s) => {
      const def = STEPS[s.type];
      const detail = def?.params.map((p) => s[p]).filter((v) => v !== undefined && v !== "").join(" → ");
      return def ? `${def.label}${detail ? ` (${detail})` : ""}` : s.type;
    }).join(", then ");
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.outputRules = { STEPS, TARGETS, runSteps, refsFor, validateRule, load, getCached, saveRule, removeRule, apply, describeSteps, getTeam, isFromTeam, overridesTeam, resetToTeam, exportable, importRules };
})();
