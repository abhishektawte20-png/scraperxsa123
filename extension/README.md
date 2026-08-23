# ScraperX Research Automation (Chrome extension)

Replaces the copy-paste loop. Instead of clicking **Copy Boolean**, pasting into
Google, reading twenty blue links, and repeating twenty-three times per company,
you type the company once and the extension runs the whole boolean library,
scores every result, and shows you what is worth reading.

## Install

1. `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Pin ScraperX and click it to open the side panel.

Chrome 116+ (side panel API).

## Running a company

1. **Run** tab: enter the company name, website, and any aliases (DBAs, former
   names). The entity group Google will actually receive is previewed live —
   `("L&L Exhibition Management" OR "www.homeshowcenter.com")`, exactly the
   prefix the sheet builds by hand.
2. Tick the booleans. **Defaults** is the everyday set; **+ ROVO-down backups**
   adds the Employee Count / Revenue / EBITDA / Net Income fallbacks that are
   only meant to run when ROVO is down.
3. **Run all booleans**. One query at a time, in one tab, at human pace.
4. Results stream into the **Results** tab as each boolean finishes.

## What it gives you that the manual loop does not

**Every result is scored, not just listed.** Four axes:

| Axis | What it asks |
|---|---|
| Entity match | Does this actually name the company, its domain, or an alias? |
| Signal match | Does it contain the phrases the boolean went looking for (`raised`, `chapter 11`, `headquartered`)? |
| Source class | Company site and registries outrank press, press outranks social, aggregators like PitchBook are pushed to the bottom — they are not citable secondary sources |
| Recency | The date Google prints on the snippet, parsed and weighted |

Results land in one of four tiers — **critical**, **strong**, **weak**, **noise** —
and each one shows its reasons, so the score is auditable rather than magic.

**Result counts are captured.** The "About 12,300 results" figure is parsed and
stored per boolean, so you can see search volume per query without reading it
off the screen.

**Cross-boolean corroboration.** The thing you cannot see running booleans one at
a time: a URL surfaced by six different booleans is almost always the source
worth citing. The Results tab ranks those first, with the list of booleans that
found each one.

**Highlighting on the page itself.** When a run navigates a SERP, matched entity
and signal terms are highlighted in place and each result gets its score badge —
so if you open the run tab mid-flight, the important lines are already marked.

**Exports.** Copy a full Markdown report, or export JSON / CSV. CSV is one row
per result with `score`, `tier`, `signals`, `date` — ready for the profile sheet.

## Pacing, and why it is what it is

The extension drives a real tab, one query at a time, with a randomised 4–9s gap
and a longer pause every twelve queries. That is roughly what a person doing this
by hand produces, and it is deliberate: Google serves a CAPTCHA to anything that
looks automated, and a tripped CAPTCHA stalls the run and costs more time than
the pacing saved.

If one is served anyway, the run **stops** rather than pushing through. The tab is
brought to the front, the panel shows a banner, and **Resume** picks up at the
query that was interrupted — nothing is skipped or silently recorded as empty.

You can shorten the gaps in settings. Doing so makes CAPTCHAs more likely, not
less; the defaults exist because they work.

## The boolean library

The **Booleans** tab holds the same strings that sit behind each *Copy Boolean*
button, transcribed from the sheet. Edit any of them and every future run uses
the new version — you are not stuck with what shipped.

Placeholders available in a query:

| Placeholder | Becomes |
|---|---|
| `{{entity}}` | `("Company" OR "www.site.com" OR "alias")` |
| `{{company}}` | the raw company name |
| `{{website}}` | the website as entered |
| `{{domain}}` | bare hostname, no scheme or `www.` |

**Grab from open tab** reads the boolean sheet directly: open the internal tool,
click it, and every `google.com/search` URL on the page is imported, with the
baked-in company swapped back out for `{{entity}}`. Imports arrive disabled —
review them, then tick them on. Import/Export move the library between machines
as JSON, which is how you keep a team on one shared set.

The two ROVO agents are in the library but marked **opens only**: they are agent
URLs, not searches, so the extension opens them for you and never pretends to
have scraped them.

## Settings

Pacing, results requested per query (`num`), how many to keep, a 2-year recency
filter, country code (`gl`), whether to highlight SERPs, and whether the run tab
lives in a separate minimised window or a background tab in the current one.

**Enrichment** is optional: point it at the `/enrich` endpoint of the ScraperX
server in this repo and a finished run can be POSTed there for the AI extraction
pass, either on a button or automatically when a run completes.

## Tests

```
npm run test:unit    # query building, signal derivation, scoring, exports
npm run test:e2e     # loads the extension in Chromium and runs it end to end
```

The e2e suite loads the real extension, intercepts Google with a synthetic SERP,
drives the actual panel UI, and asserts on extraction, ranking, aggregation,
on-page highlighting, and CAPTCHA handling. It needs `playwright` installed
(`npm i`); set `CHROME_PATH` if you have a Chromium you want it to use.

## Notes

- Storage is local to the browser. Nothing leaves the machine unless you
  configure an enrichment endpoint.
- Runs are kept in history (last 25) and can be reopened from the History tab.
- The content script stays completely inert on Google searches you run yourself —
  it only acts on tabs the extension is driving.
