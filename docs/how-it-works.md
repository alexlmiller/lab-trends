# How it works

The technical side, for anyone changing the code or checking how their data is handled. Running it locally: [CONTRIBUTING.md](../CONTRIBUTING.md).

## Architecture

One Worker (`src/worker`, Hono) serves the API under `/api/*`, the MCP server at `/mcp`, and the React app (`src/client`) as static assets. Routes are in `src/worker/routes/`. The MCP SDK is loaded only for `/mcp` requests.

| Binding | Resource | Use |
|---|---|---|
| `DB` | D1 `lab-trends` | All records (`migrations/`) |
| `FILES` | R2 `lab-trends-files` | Uploaded source files, key `<subject>/<file>/<name>` |
| `EXTRACTIONS` | Queue `lab-trends-extractions` | PDF and image extraction jobs (consumer in the same Worker) |
| `AI` | Workers AI | Extraction models |

Committed results are the source of truth. Every chart, stat and correlation is computed in the browser from `/api/subjects/:sid/dataset`, which the Worker loads in one round trip to D1.

`npm run deploy` (`scripts/deploy.mjs`) applies migrations before deploying the code, so the running version keeps working against the new schema. A first deploy has no database yet, so it deploys first and migrates straight after.

When a release changes how results are read, saved rows are brought up to date over the first few requests after the deploy (`src/worker/upgrade.ts`, `DATA_VERSION`): numbers, ranges and inferred flags are recomputed from the text each result was saved with.

## Sign-in

`src/worker/auth.ts`. Access adds a signed token to each request. The Worker checks its signature, issuer and audience, then checks the email against the owner and `allowed_users`.

- The trusted Access application is `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` when set, otherwise the one recorded in the `instance` table at first sign-in.
- A request without a valid token is refused, and so is a write the browser reports as coming from another site.
- Only `/api/health` is public.
- `DEV_AUTH_EMAIL` signs every request in as that address, on `localhost` only.

## Importing

Upload, then raw file to R2, then an `extraction_candidates` row (a proposal), then review and edit at `/import/:batchId`, then commit into `lab_panels`/`lab_results`. Nothing reaches the charts without a commit.

- **Limits:** 20 files and 64 MB per upload, 20 MB per file, 5,000 results per file. A spreadsheet is read with fixed limits on its size (`src/shared/xlsx.ts`, `src/shared/zip.ts`).
- **Values, ranges, flags and dates** (`src/shared/semantics.ts`, `src/shared/dates.ts`) give a number, a band, a flag or a date only when the whole text is understood. Anything else is kept as text. `test/parsers.test.ts` is the table of what reports print and what it means.
- **CSV/XLSX** are parsed in the Worker (`src/shared/tabular.ts`, `src/shared/xlsx.ts`). Both row-per-result files and the pivoted history layout (`Test | Reference Range | Units | <date>…`, one tab per panel) work. A `Cycle Day` row becomes draw tags. A sheet, column or row that is left out is named in a warning on the draft.
- **PDFs** get their text rebuilt with layout from pdf.js positions (`unpdf`, `src/shared/pdfLayout.ts`), identifiers redacted (`src/worker/redact.ts`), then go to `EXTRACTION_MODEL` with a JSON schema. If pdf.js fails it falls back to `env.AI.toMarkdown`. Scanned PDFs with no text need a photo instead.
- **Long PDFs** are read in chunks of whole pages (`src/worker/chunking.ts`: about 5,000 characters, 4 at a time, up to 40 chunks), because one reply holds about 200 results. Later chunks also get the top of page 1 for the collection date. A reply that runs out of tokens is split and re-read, and a chunk that still fails becomes a warning naming its pages. Panels from all chunks merge by collection date.
- **Time budget.** A queue consumer is stopped after 15 minutes, so no chunk is started after 9 and none is waited for past 13. A report too long for the model's speed ends early, with a warning naming the pages not read.
- **Photos** go as they are to `VISION_MODEL`.
- **Models** run with reasoning off and a JSON schema, with one repair retry on invalid JSON. Any `env.AI.run()` id works. A catalog id such as `anthropic/claude-sonnet-…` routes through AI Gateway Unified Billing and needs credits. A model that thinks unless told not to needs its own switch in `runModel` (`src/worker/extraction.ts`).
- **Errors.** Transient Workers AI errors (capacity, rate limits, timeouts) re-queue the file with backoff, up to 3 attempts. After that it shows as failed with a retry button. Two errors are not retried and stop the whole file, since every part would fail the same way: the model is not offered on the plan (5035), and the day's free allowance is used up (3036, which arrives as an HTTP 429). A file whose reading stopped without an answer is marked failed after 20 minutes (3 for a spreadsheet).
- **Review** (`annotateDocument` in `src/worker/resolve.ts`) unticks rows already saved for that date, including a saved value that differs, since that's likelier a misread than a correction. Ticking a differing row replaces the saved value and keeps the old one in `result_revisions` until the result is deleted. A panel whose numbers match a saved draw within 5 days gets a "same draw?" hint that moves it to that date.
- **Commit** (`src/worker/commit.ts`) claims the import first, so it is saved once however often it is asked. It merges into an existing draw on the same date and skips values already saved. One date holds one value per test: a second, different value in the same import is not saved. The reply to the commit lists it once, and the import's record keeps only the count.

Values are kept exactly as reported (`raw_value`, `raw_units`, `reference_text`). Numbers, range bounds and flags are derived in `src/shared/semantics.ts`, and a flag the lab reported wins over one inferred from the range. One rule, `resultStatus`, says whether a result is low, high, in range or flagged, on every screen, export and MCP tool. Units are never converted. Draw dates are calendar dates (`YYYY-MM-DD`), never instants.

The user guide for getting files out of portals is [importing.md](importing.md), and the same guide is in the app (`src/client/components/ImportGuide.tsx`). The research behind it is in [lab-portal-exports.md](lab-portal-exports.md).

## Deleting

`src/worker/storage.ts`. Nothing is soft-deleted. Removing a result, draw, test, import or person removes its rows and the R2 files nothing else points at, bytes first and rows second, so a failure can leave a row without its file but never a file nobody can find.

An upload is kept only while a draw (`panel_files`) or an open import uses it. Every upload that put a result on a draw is linked to that draw and deleted with the last draw that uses it.

## Pages

| Path | What it is |
|---|---|
| `/`, `/?draw=<id>` | Latest results, one page per draw. Out-of-range results first, with the reported range. Watched tests missing from that draw are listed with their last date. Editing and deleting draws and results happens here. |
| `/draws` | Every draw |
| `/history?m=<id>,<id>` | One test's record. Add tests to compare them on separate charts or one shared scale. Also event periods, targets, result edits and saved views. Opened from a test, not the navigation. |
| `/events` | Medications, illnesses and other events, as dates or periods. History compares the nearest results strictly before and after a selected day, start or end. |
| `/markers` | All tests |
| `/watchlist` | Watched tests, shared with the stars in `/markers` |
| `/grid` | Timeline: every result in a date-by-test grid |
| `/correlations` | Tests that move together |

View state lives in the URL (`?m=`, `?range=`, `?scale=`, `?layout=`, `?a=&b=`), so any view can be bookmarked or shared with someone who has access.

## MCP

`/mcp` is a stateless Streamable HTTP server (`createMcpHandler` from the MCP TypeScript SDK, `src/worker/mcp/`). Sign-in is Access [managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/), so requests carry the same `Cf-Access-Jwt-Assertion` as the web app.

- Tools write through the app's own `/api` routes in-process as the signed-in user, so validation stays in one place. They read with the same loaders the routes use.
- A request that names another site as its origin is refused, and the endpoint sends no CORS headers: an MCP client is a program, not a page.

Setup and the tool list: [mcp.md](mcp.md).

## Privacy

The summary is in the [README](../README.md#privacy-and-security). The specifics:

- **Where data lives.** Results, events and settings are in your D1 database. Uploaded files are in your R2 bucket, which has no public address.
- **What a model sees.** Spreadsheets are parsed inside the Worker and reach no model. PDF text has names, dates of birth, record numbers, addresses, phone numbers and emails removed where the report labels them (`src/worker/redact.ts`), then goes to the extraction model. An identifier printed without a label can still reach the model. Photos go to the model as they are. A file's name is never sent.
- **Who runs the model.** The default model runs on Cloudflare Workers AI, which [doesn't keep or train on](https://developers.cloudflare.com/workers-ai/platform/data-usage/) what it is sent. An AI Gateway, if you set one, may log it. A model id that doesn't start with `@cf/` sends it to that provider.
- **Who sees what.** Everyone with access sees every person's results. Only the owner sees the list of who has access.
- **Other sites.** `public/_headers` sets a content security policy that blocks loading anything from other sites.
- **Logs.** Worker logs hold request paths and error messages, never result values or report text (`logMessage` in `src/worker/lib.ts`).
- **Assistants.** An assistant connected over MCP receives whatever it reads, and so does the company that runs it.
