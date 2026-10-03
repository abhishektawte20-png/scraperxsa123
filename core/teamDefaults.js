"use strict";

/*
 * Team defaults: the field mappings and output rules every researcher gets
 * from day one. This file ships inside the extension. To update it, use
 * "Export team defaults" in the extension (Mapped & taught fields window) and
 * replace this file with the downloaded one, then reload the extension.
 * Researchers can still change a mapping on their own browser; theirs wins
 * over the team default for that field, and "Reset to team defaults" undoes it.
 */
globalThis.SXRTS = globalThis.SXRTS || {};
globalThis.SXRTS.teamDefaults = {
  "format": "scraperx-team-defaults",
  "version": 1,
  "exportedAt": null,
  "extensionVersion": null,
  "mappings": [],
  "rules": []
};
