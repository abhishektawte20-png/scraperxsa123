"use strict";

/*
 * Sharing mappings and output rules with the team. Export writes the
 * effective set (team defaults plus this browser's own) as a ready-to-use
 * core/teamDefaults.js; Import reads such a file (or the same data as plain
 * JSON) into this browser. Nothing here runs the imported text: it is parsed
 * as JSON and every mapping and rule is validated first.
 */
(() => {
  const FORMAT = "scraperx-team-defaults";
  const cf = () => globalThis.SXRTS.customFields;
  const rules = () => globalThis.SXRTS.outputRules;

  function buildData() {
    let extensionVersion = null;
    try { extensionVersion = chrome.runtime.getManifest().version; } catch { /* not in an extension page */ }
    return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), extensionVersion, mappings: cf().exportable(), rules: rules().exportable() };
  }

  function buildFile(data = buildData()) {
    return `"use strict";

/*
 * Team defaults for the ScraperX RTS Profile Assistant: the field mappings and
 * output rules every researcher gets from day one.
 *
 * To share: replace core/teamDefaults.js in the extension folder with this
 * file, reload the extension, then send the folder to the researchers.
 * Researchers can still change a mapping on their own browser; theirs wins
 * over the team default for that field.
 */
globalThis.SXRTS = globalThis.SXRTS || {};
globalThis.SXRTS.teamDefaults = ${JSON.stringify(data, null, 2)};
`;
  }

  // Accepts the exported .js file or plain JSON. Returns { data } or { error }.
  function parseFile(text) {
    let source = String(text ?? "").trim();
    const marker = /teamDefaults\s*=\s*/.exec(source);
    if (marker) {
      const start = source.indexOf("{", marker.index + marker[0].length);
      const end = source.lastIndexOf("}");
      source = start >= 0 && end > start ? source.slice(start, end + 1) : "";
    }
    let data;
    try {
      data = JSON.parse(source);
    } catch {
      return { error: "This is not a ScraperX team defaults file." };
    }
    if (!data || data.format !== FORMAT || !Array.isArray(data.mappings) || !Array.isArray(data.rules)) {
      return { error: "This is not a ScraperX team defaults file." };
    }
    return { data };
  }

  const describe = (data) => `${data.mappings.length} mapping(s) and ${data.rules.length} rule(s)`;

  function teamInfo() {
    return { mappings: cf().getTeam().length, rules: rules().getTeam().length, exportedAt: globalThis.SXRTS.teamDefaults?.exportedAt ?? null };
  }

  async function importData(data) {
    const mappings = await cf().importDefinitions(data.mappings);
    const imported = await rules().importRules(data.rules);
    return { imported: mappings.imported + imported.imported, skipped: [...mappings.skipped, ...imported.skipped] };
  }

  async function resetToTeam() {
    return (await cf().resetToTeam()) + (await rules().resetToTeam());
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.teamShare = { FORMAT, buildData, buildFile, parseFile, describe, teamInfo, importData, resetToTeam };
})();
