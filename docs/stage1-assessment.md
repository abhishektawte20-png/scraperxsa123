# Stage 1 assessment

## Current code assessment (Conference ScraperX Field Assistant, used as reference)

`content.js` is a solid architectural reference: closed shadow-DOM panel, a declarative field-definition array driving prompt generation/validation/preview/application, native-setter-based value injection for React-controlled inputs (`setNativeValue`), a custom-dropdown adapter with exact-text-match plus keyboard fallback (`selectFlatOption`), a bespoke industry-tree walker (`selectIndustry`), and a "verify after apply, never assume" pattern in the apply flow. It never clicks Save. `manifest.json`/`README.md`/`SECURITY.md` accurately describe the code (verified line by line): permissions match, no network APIs are used, no `innerHTML`.

Two things were referenced in the brief but **not actually attached** to the session: `selectors-data.js`, `test-static.mjs`, and the `icons/` folder (only `background.js`, `content.js`, `manifest.json`, `README.md`, `SECURITY.md` came through), and the sample Rovo JSON output for Psypher. Everything above is based on what was actually provided.

## Reusable capabilities

Utility layer (`wait`, `isVisible`, `waitFor`, popup detection, keyboard-driven selection) and value-setting (`setNativeValue`, `setNativeChecked`) are framework-agnostic and are reused directly in `core/adapters/`. The industry-tree walker and the specific custom-dropdown markup are **not** reused as-is — they're calibrated to the conference form's widget, and RTS's actual Industries/Add-New-Vertical/dropdown markup is unverified.

## Screenshot coverage map

**0%.** No RTS screenshot, DOM extract, or sample JSON was attached in this session. See `docs/evidence-checklist.md` for the full per-field status (all "Missing" as of this writing).

## Folder structure, schema, registry, cache, and state machine

Implemented in this repo — see `manifest.json`, `core/schema.js`, `registry/index.js`, `core/cache.js`, `core/stateMachine.js`, `core/executionPlan.js`. Summary:

- **Schema**: every mutable value is wrapped in an envelope (`value`, `action`, `source`, `sourceDate`, `confidence`) or, for repeatable records, carries those same fields per record. `action` ∈ `addIfMissing | updateIfBlank | replaceAfterConfirmation | skip`.
- **Registry**: one entry per RTS workflow, gated by `evidenceStatus` (`missing` → `ready`). The execution plan builder refuses to run any field whose entry is missing or unevidenced, and says why.
- **Cache**: `chrome.storage.local`, keyed by `pbId > entityId > normalized domain`, with an input-hash to detect re-pasted/edited JSON for the same profile.
- **State machine**: `pending → validated → navigating → editing → valueVerified → awaitingSave → saving → saved → savedValueVerified`, with `skipped`/`failed` reachable from the relevant states. Only `savedValueVerified` counts as done.

## Risks and open questions

1. **Repo**: the original target repo (`scraperxsa123`) contained an unrelated Express/Railway service that posts company data to OpenAI directly — this conflicts with the local-only, no-external-AI-API design and was not reused. Work now lives in `abhishektawte20-png/ScraperX-Clipboard-Ui-automation` instead.
2. **Evidence**: essentially the entire per-field checklist is outstanding (see `docs/evidence-checklist.md`). The plan is to evidence fields incrementally, one at a time.
3. **Reading RTS identity** (PBID/Entity ID/domain from the live page) is unimplemented — `identityLock.readRtsIdentityFromPage()` deliberately throws until the Entity Overview/Identifiers DOM is evidenced.
4. **Save behavior** (success signal detection: spinner, toast, disabled state, field refresh) is completely unknown for RTS and must not be guessed; Stage 6 stays blocked until evidenced.
