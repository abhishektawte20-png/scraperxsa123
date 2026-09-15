# Security review

## Data flow

1. After a toolbar click, the extension injects its scripts into the active tab only.
2. The researcher pastes a Rovo JSON response into the panel; nothing is read automatically.
3. The JSON is validated against the schema (allowlisted keys, typed values, format checks) before anything else happens with it.
4. Once fields are evidenced (see `docs/evidence-checklist.md`), applying a field will use native value setters and dispatch normal input/change events, then require a saved-value read-back before it is ever reported as complete. No such field exists yet.
5. A profile-scoped record (execution plan + outcomes, not raw research text) is written to `chrome.storage.local`, keyed by the strongest available identifier (PBID > Entity ID > normalized domain). It never mixes across profiles and can be cleared by the researcher at any time.

There is no extension-initiated network transmission.

## Permissions

| Permission | Reason |
| --- | --- |
| `activeTab` | Temporary access to the tab only after the toolbar button is clicked. |
| `scripting` | Injects the packaged local assistant into that user-approved tab. |
| `storage` | New vs. the reference Conference extension. Required for profile-scoped resume/dedup caching (`core/cache.js`), per the project's requirement to support resuming an interrupted multi-section application without re-doing verified work. Stores only the execution plan and its per-action outcomes for the current profile — never raw company research text, credentials, cookies, or page content. |

No host permissions are requested. No clipboard-read permission exists; reading the clipboard automatically is out of scope unless a future, separately-justified permission is explicitly approved.

## Controls

- Manifest V3, packaged code only, no remote code or third-party dependencies.
- Extension-page CSP blocks network connections and objects (`connect-src 'none'`, `object-src 'none'`).
- No `fetch`, `XMLHttpRequest`, WebSocket, beacon, or dynamic script loading anywhere in the codebase.
- No automatic clipboard access.
- JSON input is allowlisted and type-checked field by field (`core/schema.js`); unknown keys are reported, never silently applied.
- DOM content is inserted using `textContent`/DOM element APIs, never `innerHTML`.
- No RTS field is automated until its selector registry entry is marked `evidenceStatus: "ready"` — see `registry/index.js` and `docs/evidence-checklist.md`.
- No automatic Save exists yet; when implemented (Stage 6) it defaults to a confirm-before-save mode per the project brief.

## Deployment recommendations

- Review source before internal distribution.
- Publish privately through managed Chrome/Edge administration.
- Pilot against a non-production/test RTS record before broad rollout, once fields are implemented.
- Re-run `npm test` after every change.
