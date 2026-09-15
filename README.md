# ScraperX RTS Profile Assistant

A Chrome/Edge Manifest V3 extension that maps structured JSON from a ScraperX Rovo research agent into PitchBook RTS Business Entity and Company fields, with profile identity locking, preview/conflict review, and profile-scoped caching.

**Current status.** Four fields are `evidenceStatus: "ready"` and live in the panel's Apply flow: `businessEntity.nameVariations`, `businessEntity.websiteAddresses`, `businessEntity.emailDefaultStructure`, `businessEntity.researchNotes` (the last three share one Save button and apply together as a group), and `company.sicCodes`. All are unblocked by a working identity lock (reads PBID/domain/formal name from the live RTS page). Everything else is still preview-only. Management is out of scope by explicit decision (duplicate-detection risk). Industries and Verticals both open their Add/Edit UI in a separate browser window; by decision, this stays a manual step (researcher re-clicks the toolbar icon in that window) rather than requesting a broader `tabs`/`windows` permission.

The related [Conference ScraperX Field Assistant](https://github.com/abhishektawte20-png/scraperxsa123) is the architectural reference for this project and is not modified by this repo.

## Privacy model

- No backend, analytics, telemetry, remote scripts, or AI API calls from the extension itself.
- No network requests of any kind (`connect-src 'none'` in the extension CSP).
- Permissions: `activeTab`, `scripting`, and `storage` (see `SECURITY.md` for why `storage` was added over the reference extension).
- Data enters only by manual paste; nothing is read from the clipboard automatically.
- Cache holds only the execution plan and its outcomes for the current profile, never raw research text — see `SECURITY.md`.

## Install for testing

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Pin **ScraperX RTS Profile Assistant** to the toolbar.

## Researcher workflow (current)

0. **One-time setup**: click **Copy agent setup instructions** and paste them into the ScraperX Rovo agent's own configuration (not into a chat message) — see `docs/rovo-agent-instructions.md` for why. A per-run prompt alone was not enough to stop the agent from replying with a prose report instead of JSON.
1. Open the company's Business Entity record in RTS, then click the toolbar icon. Company name and website prefill automatically if the identity lock can read them; otherwise enter them manually.
2. Click **Copy prompt**, then **Open Rovo** and run the prompt there.
3. Paste the JSON response back into the panel and click **Validate JSON** — the preview builds automatically on success.
4. Review the preview: each proposed change is its own card (RTS area, status) with every field of that record shown as its own labeled, editable input — fix a small mistake directly there, no JSON editing required. Uncheck anything you don't want touched, or **Select all pending**.
5. Click **Publish selected to RTS** — you'll be asked to confirm before anything is written. The identity lock runs first and blocks the whole batch on any mismatch.
6. **Clear cache for this profile** removes the saved plan for the currently open company from `chrome.storage.local` at any time.

Every build of the preview is saved to a profile-scoped cache automatically (keyed by PBID/domain), so reopening the assistant on the same record shows a "cached plan found" notice — this only remembers which fields were proposed and their outcome, never raw research text.

## Repository layout

```
manifest.json
background/background.js       # injects the assistant on toolbar click
core/
  schema.js                    # canonical JSON schema + validator
  identityLock.js               # identity comparison + RTS-read (PBID/domain/formal name)
  duplicates.js                  # generic normalized-match duplicate detector
  cache.js                        # profile-scoped chrome.storage.local cache
  stateMachine.js                  # pending -> ... -> savedValueVerified
  promptBuilder.js                  # builds the Rovo research prompt from the registry's own catalogs
  executionPlan.js                  # validated JSON + registry -> action list
  adapters/
    textField.js                    # native-setter text/textarea adapter
    nativeSelect.js                   # native <select> adapter (exact match)
    contentEditable.js                 # contenteditable adapter (e.g. Research Notes)
  workflows/
    businessEntityNameVariations.js     # ready
    businessEntityGeneral.js             # ready (Website Address, Email Default Structure, Research Notes)
    companySic.js                         # ready
registry/
  index.js                        # aggregates per-field registry files
  businessEntity.nameVariations.js  # ready
  businessEntity.general.js          # ready
  company.sic.js                      # ready
  company.sites.js                     # missing — catalog-only (Site Type/Status/Country), feeds the prompt
content/panel.js, bootstrap.js   # shadow-DOM UI
tests/
  test-static.mjs                 # pure-logic suite (schema, cache, state machine, execution plan)
  test-name-variations.mjs        # jsdom suite for the name-variations workflow
  test-identity-lock.mjs           # jsdom suite for RTS identity reading
  test-business-entity-general.mjs  # jsdom suite for the shared-save-group workflow
  test-company-sic.mjs              # jsdom suite for the SIC workflow
  test-panel-smoke.mjs              # mounts the real panel UI and exercises validate/preview/publish-guard
  e2e/
    live-browser.test.mjs           # real Chromium (Playwright) run of the actual extension against the evidenced fixtures — see e2e/README.md
fixtures/
docs/
  stage1-assessment.md
  evidence-checklist.md
```

## Running tests

```
npm install   # first time only, pulls in jsdom + playwright (both devDependencies)
npm test      # fast jsdom suite (no browser needed) — run this constantly
```

There's also a real-browser end-to-end test, kept separate because it needs an actual Chromium install and takes a bit longer:

```
npx playwright install chromium   # first time only
npm run test:e2e
```

See `tests/e2e/README.md` for what it checks and why it exists — it's already caught two real integration bugs (a broken Email Default Structure publish, and an over-strict identity lock) that the jsdom suite couldn't see because jsdom doesn't exercise real event timing or rendering. Run it before shipping any change that touches `core/executionPlan.js`, `content/panel.js`, or a `core/workflows/*.js` file.

## Supported JSON (schema v1.0)

See `core/schema.js` for the authoritative shape. Top level: `schemaVersion`, `meta`, `profileIdentity`, `businessEntity`, `company`. Every mutable value carries an explicit `action` (`addIfMissing`, `updateIfBlank`, `replaceAfterConfirmation`, `skip`); unrestricted replacement is never allowed. `profileIdentity` must include `companyName` and at least one of `pbId`, `entityId`, or `domain`.

`core/promptBuilder.js` asks Rovo for the full schema-supported shape (description, keywords, industries, verticals, employee history, SIC/NAICS, sites, social media identifiers) even though only 5 fields have a wired-up workflow so far — fields without one just show up in the preview as skipped, so the research only has to happen once. `company.management` is deliberately never requested — that's excluded by decision, not an evidence gap. The parser also detects markdown-link-corrupted pastes (a common artifact of copying out of a chat UI that auto-linkifies URLs) and fails with a specific, actionable message rather than guessing at a repair.

## Important limitations

- Custom/searchable dropdowns, the Industries popup, Keywords' likely-taxonomy-backed autocomplete, and controlled auto-save are all unimplemented pending evidence — see `docs/evidence-checklist.md`.
- `identityLock.readRtsIdentityFromPage()` reads PBID, domain (with a Website-Address-derived fallback), and formal name. Entity ID has no selector evidence yet, but isn't required — PBID/domain are enough to lock the profile.
- The "View All Name Variations" expand toggle's selector is unconfirmed; the workflow falls back to its exact visible text if the Add button isn't already present in the DOM.
- The primary Formal Name field (`input[name="formalNameVariations"]`) shares the `businessEntityName` class with variation rows; the registry selector explicitly excludes it (`:not(.businessEntityNameMain)`) so it's never misread as a variation or overwritten.
- Website Address, Email Default Structure, and Research Notes (Business Entity) share one Save button and are applied/saved together as one group.
- **Management is out of scope by decision** (duplicate-detection risk), not just missing evidence — it will not be revisited without an explicit request.
- **Industries has an open architecture question**: its "Add/Edit Industry" control opens a separate browser window, not an in-page popup, which the current `activeTab`/`scripting`-only permission model can't reach without a new, explicitly justified permission. See `docs/evidence-checklist.md`.
