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

  const COUNTRY_NAMES = { usa: "united states", us: "united states", "u s": "united states", "u s a": "united states", "united states of america": "united states", america: "united states", uk: "united kingdom", "u k": "united kingdom", "great britain": "united kingdom", england: "united kingdom", uae: "united arab emirates", "south korea": "south korea", korea: "south korea", czechia: "czech republic" };
  const canonicalCountry = (text) => { const k = String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return COUNTRY_NAMES[k] || k; };
  const DEFAULT_PHONE_FORMATS = { "united states": "###-###-####", canada: "###-###-####" };

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
    // 10 digits (or 1 + 10, or +1 + 10) become 281-941-6001. Any other number is left exactly as it is.
    phoneUS: {
      label: "Format as a US phone number (281-941-6001)", params: [],
      run: (v) => {
        const text = String(v).trim();
        if (/^\+/.test(text) && !/^\+1\b/.test(text)) return v;
        const digits = text.replace(/\D/g, "");
        const ten = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
        return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : v;
      }
    },
    // ---- your own conditions: "if ... then replace the value with ..." (no match: the value is left as it is) ----
    ifBetween: {
      label: "If the number is between … and … (inclusive), replace the value with …", params: ["from", "to", "then"],
      hints: { from: "from, e.g. 2", to: "to, e.g. 10", then: "replace the value with, e.g. 2-10" },
      check: (step) => (Number.isFinite(Number(step.from)) && String(step.from).trim() !== "" && Number.isFinite(Number(step.to)) && String(step.to).trim() !== "" ? "" : 'Step "If the number is between": "from" and "to" must be numbers.'),
      // A single number (or "500+") must lie inside; a range such as "5-8" must lie entirely inside.
      run: (v, p) => {
        const lo = Number(p.from); const hi = Number(p.to);
        const nums = (String(v).replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
        if (!nums.length || !Number.isFinite(lo) || !Number.isFinite(hi)) return v;
        const inside = nums.length >= 2 ? nums[0] >= lo && nums[1] <= hi : nums[0] >= lo && nums[0] <= hi;
        return inside ? (p.then ?? "") : v;
      }
    },
    ifEquals: { label: "If the value is … replace it with …", params: ["text", "then"], hints: { text: "the value, e.g. USA", then: "replace it with, e.g. United States" }, run: (v, p) => (p.text !== undefined && p.text !== "" && v.trim().toLowerCase() === String(p.text).trim().toLowerCase() ? (p.then ?? "") : v) },
    ifContains: { label: "If the value contains … replace it with …", params: ["text", "then"], hints: { text: "contains, e.g. Inc", then: "replace it with" }, run: (v, p) => (p.text && v.toLowerCase().includes(String(p.text).toLowerCase()) ? (p.then ?? "") : v) },
    ifStartsWith: { label: "If the value starts with … replace it with …", params: ["text", "then"], hints: { text: "starts with", then: "replace it with" }, run: (v, p) => (p.text && v.trim().toLowerCase().startsWith(String(p.text).toLowerCase()) ? (p.then ?? "") : v) },
    ifEndsWith: { label: "If the value ends with … replace it with …", params: ["text", "then"], hints: { text: "ends with", then: "replace it with" }, run: (v, p) => (p.text && v.trim().toLowerCase().endsWith(String(p.text).toLowerCase()) ? (p.then ?? "") : v) },
    // Puts another field's text in front: the full description is the brief description followed by the full one.
    prependField: {
      label: "Put another field's text in front (for example the brief description before the full description)", params: ["path"], maxLen: { path: 80 },
      hints: { path: "field path, e.g. company.briefDescription" },
      check: (step) => (/^[A-Za-z][\w.]*$/.test(String(step.path || "")) ? "" : 'Step "Put another field in front": write a field path such as company.briefDescription.'),
      run: (v, p, ctx) => {
        let other = ctx?.doc;
        for (const key of String(p.path || "").split(".")) other = other && typeof other === "object" ? other[key] : undefined;
        if (other && typeof other === "object" && "value" in other) other = other.value;
        const front = typeof other === "string" ? other.trim() : "";
        if (!front || v.trim().toLowerCase().startsWith(front.toLowerCase())) return v; // nothing to add, or already there
        return `${front} ${v.trim()}`;
      }
    },
    mapValues: {
      label: "Change values by a list (a=b; c=d)", params: ["pairs"], maxLen: { pairs: 600 },
      hints: { pairs: "e.g. 2-10=Small; 11-50=Medium; 51-200=Large" },
      check: (step) => (/=/.test(String(step.pairs || "")) ? "" : 'Step "Change values by a list": write pairs like  a=b; c=d.'),
      run: (v, p) => {
        const hit = String(p.pairs || "").split(";").map((pair) => pair.split("=")).find(([from]) => from !== undefined && from.trim().toLowerCase() === v.trim().toLowerCase() && from.trim() !== "");
        return hit ? hit.slice(1).join("=").trim() : v;
      }
    },
    // The phone is written the way its COUNTRY needs it. The country is the one in the same record (the site's
    // country, or the report's country). A pattern uses # for each digit; other characters are copied.
    phoneByCountry: {
      label: "Format the phone for the country", params: ["formats"], maxLen: { formats: 600 },
      hints: { formats: "empty = US and Canada as 281-941-6001. Add countries: Germany=+49 ### ########; India=+91 ##### #####" },
      check: (step) => { const text = String(step.formats || "").trim(); if (!text) return ""; return text.split(";").every((pair) => /^[^=]+=[^=]*#[^=]*$/.test(pair.trim())) ? "" : 'Step "Format the phone for the country": write  Country=pattern  with # for each digit, separated by ;'; },
      run: (v, p, ctx) => {
        const country = canonicalCountry(ctx?.country);
        if (!country) return v;
        const table = { ...DEFAULT_PHONE_FORMATS };
        for (const pair of String(p.formats || "").split(";")) { const [name, pattern] = pair.split("="); if (name && pattern) table[canonicalCountry(name)] = pattern.trim(); }
        const pattern = table[country];
        if (!pattern) return v;
        const digits = String(v).replace(/\D/g, "");
        const fixed = (pattern.match(/\d/g) || []).join("");
        const slots = (pattern.match(/#/g) || []).length;
        let own = "";
        if (digits.length === slots) own = digits;
        else if (fixed && digits.length === slots + fixed.length && digits.startsWith(fixed)) own = digits.slice(fixed.length);
        else if (!fixed && digits.length === slots + 1 && digits[0] === "1" && /^(united states|canada)$/.test(country)) own = digits.slice(1);
        else return v;
        let i = 0;
        return pattern.replace(/#/g, () => own[i++]);
      }
    },
    trim: { label: "Trim spaces", params: [], run: (v) => v.trim() },
    lowercase: { label: "Make lowercase", params: [], run: (v) => v.toLowerCase() },
    replace: {
      label: "Replace text", params: ["find", "with"],
      run: (v, p) => (p.find ? v.split(p.find).join(p.with ?? "") : v)
    },
    prefix: { label: "Add text at the start", params: ["text"], run: (v, p) => `${p.text ?? ""}${v}` },
    suffix: { label: "Add text at the end", params: ["text"], run: (v, p) => `${v}${p.text ?? ""}` }
  };

  function runSteps(steps, value, ctx) {
    let current = String(value);
    for (const step of steps) {
      const def = STEPS[step.type];
      if (def) current = def.run(current, step, ctx);
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

  // ---------- dynamic targets ----------
  // Every field of the agent's report, every field mapped or taught, can carry a rule: the list is built
  // from the fields themselves, so a new field appears here by itself. Ids: "field:<path>:<key>" and
  // "custom:<key>:<fieldKey>". The older fixed ids above keep working.
  const EXAMPLES = {
    "extras.employeeCount": "250 employees", "extras.address": "12600 Crystal View Blvd., Texas City", "extras.city": "Texas City", "extras.state": "TX", "extras.country": "USA",
    "extras.postcode": "77568", "extras.phone": "+1 (281) 941-6001", "extras.fax": "281-941-6002", "extras.siteEmail": "info@example.com", "extras.startDate": "2024",
    "extras.industryCode": "2.1.2 — Clothing", "company.naicsCodes": "541511 – Custom Computer Programming Services", "extras.verticals": "Fashion Tech", "extras.management": "Jane Doe",
    "businessEntity.emailDefaultStructure": "First.Last@domain.com", "company.searchKeywords": "streetwear apparel", "company.startDate": "2024"
  };
  const ID_PATTERN = /^(field:[A-Za-z0-9_.]+:[A-Za-z0-9_]+|custom:[A-Za-z0-9_]+:[A-Za-z0-9_]+)$/;

  function dynamicTargets() {
    const out = [];
    const seen = new Set(TARGETS.map((t) => t.id));
    const add = (id, label, example) => { if (!seen.has(id)) { seen.add(id); out.push({ id, label, example: example ?? "" }); } };
    for (const field of globalThis.SXRTS?.outputFields?.FIELDS ?? []) {
      for (const k of field.keys ?? []) add(`field:${field.path}:${k.key}`, field.keys.length > 1 ? `${field.label} — ${k.label}` : field.label, EXAMPLES[field.path]);
    }
    for (const source of globalThis.SXRTS?.executionPlan?.FIELD_SOURCES ?? []) {
      if (source.kind !== "envelope") continue;
      const name = source.jsonPath.split(".").pop().replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
      add(`field:${source.jsonPath}:value`, name, EXAMPLES[source.jsonPath]);
    }
    for (const def of globalThis.SXRTS?.customFields?.getCached?.() ?? []) {
      if (def.binds) continue;
      for (const f of def.fields ?? []) add(`custom:${def.key}:${f.key}`, `${def.label}${def.fields.length > 1 ? ` — ${f.label || f.key}` : ""} (taught)`, "");
    }
    return out;
  }

  // The fixed targets first, then everything else, in the report's own order.
  const targets = () => [...TARGETS, ...dynamicTargets()];
  const targetFor = (id) => targets().find((t) => t.id === id) ?? null;
  const isTarget = (id) => TARGETS.some((t) => t.id === id) || ID_PATTERN.test(String(id ?? ""));

  function refsFor(doc, targetId) {
    const refs = [];
    const add = (path, holder, key) => { if (isObject(holder) && typeof holder[key] === "string") refs.push({ path, holder, get: () => holder[key], set: (v) => { holder[key] = v; } }); };
    const list = (value) => (Array.isArray(value) ? value : []);
    const be = doc?.businessEntity;
    const co = doc?.company;
    if (targetId.startsWith("field:") || targetId.startsWith("custom:")) {
      const [kind, where, key] = targetId.split(":");
      const node = kind === "field" ? where.split(".").reduce((n, part) => (isObject(n) ? n[part] : undefined), doc) : doc?.custom?.[where];
      (Array.isArray(node) ? node : [node]).forEach((entry, i) => add(kind === "field" ? `${where}${Array.isArray(node) ? `[${i}]` : ""}.${key}` : `custom.${where}${Array.isArray(node) ? `[${i}]` : ""}.${key}`, entry, key));
    } else if (targetId.startsWith("smi.")) {
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
    if (!isTarget(rule.target)) errors.push("Pick which field the rule applies to.");
    if (!Array.isArray(rule.steps) || !rule.steps.length) errors.push("Add at least one step.");
    else if (rule.steps.length > MAX_STEPS) errors.push(`A rule can have at most ${MAX_STEPS} steps.`);
    else {
      for (const step of rule.steps) {
        const def = STEPS[step?.type];
        if (!def) { errors.push(`Unknown step "${step?.type}".`); continue; }
        for (const param of def.params) {
          const value = step[param] ?? "";
          const limit = def.maxLen?.[param] ?? 120;
          if (typeof value !== "string" || /[\n\r]/.test(value) || value.length > limit) errors.push(`Step "${def.label}": "${param}" must be short plain text.`);
        }
        if (step.type === "replace" && !step.find) errors.push('Step "Replace text" needs the text to find.');
        const problem = def.check?.(step);
        if (problem) errors.push(problem);
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

  // The country a value belongs to: the one in the same record, else the report's own country, else the first site's.
  function countryFor(doc, holder) {
    if (isObject(holder) && typeof holder.country === "string" && holder.country.trim()) return holder.country;
    const own = doc?.extras?.country?.value;
    if (typeof own === "string" && own.trim()) return own;
    const site = (Array.isArray(doc?.company?.sites) ? doc.company.sites : []).find((x) => typeof x?.country === "string" && x.country.trim());
    return site ? site.country : "";
  }

  // Applies every enabled rule to the internal document, in place. A step
  // chain that would leave a value empty is skipped, never applied.
  function apply(doc, rules = cached) {
    const applied = [];
    for (const rule of rules) {
      if (rule.enabled === false) continue;
      for (const ref of refsFor(doc, rule.target)) {
        const before = ref.get();
        const after = runSteps(rule.steps, before, { doc, holder: ref.holder, country: countryFor(doc, ref.holder) });
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
  globalThis.SXRTS.outputRules = { STEPS, TARGETS, targets, targetFor, isTarget, runSteps, refsFor, validateRule, load, getCached, saveRule, removeRule, apply, describeSteps, getTeam, isFromTeam, overridesTeam, resetToTeam, exportable, importRules };
})();
