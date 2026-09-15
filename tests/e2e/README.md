# Real-browser end-to-end tests

Everything under `tests/*.mjs` runs against jsdom — fast, but it can't catch
real-browser bugs (event timing, actual rendering, real click/focus
behavior). This directory runs the **real, unmodified extension code** in an
actual Chromium browser (via Playwright) against the same evidenced RTS
fixtures the jsdom tests use, driving the full panel → execution plan →
workflow chain exactly as a researcher would.

This exists because it already caught two real bugs jsdom couldn't have:
the `emailDefaultStructure` publish bug (executionPlan.js was unwrapping the
proposed value to a bare scalar) and the identity-lock "insufficient" block
on a legitimate profile — both found by actually running the extension
end to end, not by reasoning about the code.

## Running it

```
npm run test:e2e
```

First time only, install the Chromium build Playwright needs:

```
npx playwright install chromium
```

## What it does

`live-browser.spec.mjs`:

1. Builds a single test page out of the real evidenced fixtures
   (`fixtures/business-entity-name-variations.html`,
   `fixtures/business-entity-general.html`, `fixtures/company-sic.html`)
   plus a minimal PBID/domain identity snippet — never a hand-maintained
   duplicate of the DOM, so it can't silently drift from what the fixture
   files (and the fixture-based unit tests) already describe.
2. Injects the exact same ordered script list `background/background.js`
   loads into a real tab, then mounts `content/panel.js` into an (open,
   for Playwright's sake — production uses `closed`) shadow root, exactly
   like `content/bootstrap.js` does.
3. Pastes a realistic full research JSON, clicks through
   Validate → Publish, and asserts on the **real DOM** afterward — the
   name variation was actually added, the website field actually holds
   the value, the Email Default Structure `<select>` actually landed on
   the right option, the research note actually appended, and the SIC
   code actually got added with its source — plus that every Save button
   genuinely returned to `disabled`.

Run this before shipping any change that touches `core/executionPlan.js`,
`content/panel.js`, or any `core/workflows/*.js` file — it is the fastest
way to catch an integration bug the unit tests can't see (they mock too
much of the DOM to exercise the seams between these files).
