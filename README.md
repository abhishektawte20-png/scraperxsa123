# ScraperX

Two pieces that work together for private-company profile research:

| | |
|---|---|
| [`extension/`](extension/) | Chrome extension that runs the boolean library against Google and ranks what comes back |
| `index.js` | Enrichment server — takes a run's findings and returns a structured company profile |

The extension is the part researchers use. The server is optional.

---

## The extension

Researchers currently work a sheet of booleans one row at a time: click **Copy
Boolean**, paste into Google, read the results, decide what matters, move to the
next row — twenty-three times per company. The extension does the running and
the first pass of the reading.

Enter a company once; it runs the whole library, scores every result on entity
match, signal match, source quality and recency, surfaces the sources that
several booleans agree on, and exports a report.

**Install:** `chrome://extensions` → Developer mode → **Load unpacked** →
select `extension/`. Full documentation in [`extension/README.md`](extension/README.md).

---

## The enrichment server

Express service exposing `POST /enrich`, which sends a run's findings to OpenAI
and returns the profile JSON (`company_name`, `website`, `start_date`,
`hq_address`, `social_handles`, descriptions, industries, and so on).

### Deploy on Railway

1. Railway → **New Project → Deploy from GitHub** → this repo.
2. **Variables** → `OPENAI_API_KEY = sk-...`
3. Deploy. The endpoint is `https://<project>.up.railway.app/enrich`.

Paste that URL into the extension's settings under **Enrichment** to wire the two
together.

### Locally

```bash
npm install
OPENAI_API_KEY=sk-... npm start     # listens on :8080
```

---

## Tests

```bash
npm install
npm test              # unit + end-to-end
npm run test:unit     # query building, signal derivation, scoring, exports
npm run test:e2e      # loads the extension in Chromium and drives a full run
```

The e2e suite loads the real unpacked extension, serves a synthetic Google
results page, clicks through the actual side panel, and asserts on extraction,
ranking, cross-boolean aggregation, on-page highlighting, and CAPTCHA handling.
