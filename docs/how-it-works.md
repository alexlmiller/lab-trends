# How it works

The technical side, for anyone changing the code or checking how their data is handled. Running it locally: [CONTRIBUTING.md](../CONTRIBUTING.md).

## Architecture

One Worker (`src/worker`, Hono) serves the API under `/api/*`, the MCP server at `/mcp`, and the React app (`src/client`) as static assets.

| Binding | Resource | Use |
|---|---|---|
| `DB` | D1 `lab-trends` | All records (`migrations/`) |
| `FILES` | R2 `lab-trends-files` | Uploaded source files, key `<subject>/<file>/<name>` |
| `EXTRACTIONS` | Queue `lab-trends-extractions` | PDF and image extraction jobs (consumer in the same Worker) |
| `AI` | Workers AI | Extraction models |

Committed results are the source of truth. Every chart, stat and correlation is computed in the browser from `/api/subjects/:sid/dataset`.

`npm run deploy` (`scripts/deploy.mjs`) applies migrations before deploying the code, so the running version keeps working against the new schema. A first deploy has no database yet, so it deploys first and migrates straight after.

## Sign-in

`src/worker/auth.ts`. Access adds a signed token to each request. The Worker checks its signature, issuer and audience, then checks the email against the owner and `allowed_users`.

- The trusted Access application is `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` when set, otherwise the one recorded in the `instance` table at first sign-in.
- A request without a valid token is refused, and so is a write the browser reports as coming from another site.
- Only `/api/health` is public.
- `DEV_AUTH_EMAIL` signs every request in as that address, on `localhost` only.
- `DEMO_MODE=read-only` (exactly that value) is for a public demo: no Access, every GET is answered as a demo visitor, and every other method, including all of `/mcp`, is refused with `demo_read_only`. It refuses to serve at all (`demo_unsafe`) while the database holds anyone whose id doesn't start with `demo`, so setting it on a real deployment exposes nothing. The records come from `scripts/demo-data.mjs`.

## Importing

Upload, then raw file to R2, then an `extraction_candidates` row (a proposal), then review and edit at `/import/:batchId`, then commit into `lab_panels`/`lab_results`. Nothing reaches the charts without a commit.

- **CSV/XLSX** are parsed in the Worker (`src/shared/tabular.ts`, `src/shared/xlsx.ts`). Both row-per-result files and the pivoted history layout (`Test | Reference Range | Units | <date>…`, one tab per panel) work. A `Cycle Day` row becomes draw tags.
- **PDFs** get their text rebuilt with layout from pdf.js positions (`unpdf`, `src/shared/pdfLayout.ts`), identifiers redacted (`src/worker/redact.ts`), then go to `EXTRACTION_MODEL` with a JSON schema. If pdf.js fails it falls back to `env.AI.toMarkdown`. Scanned PDFs with no text need a photo instead.
- **Long PDFs** are read in chunks of whole pages (`src/worker/chunking.ts`: about 5,000 characters, 4 at a time, up to 40 chunks), because one reply holds about 200 results. Later chunks also get the top of page 1 for the collection date. A reply that runs out of tokens is split and re-read, and a chunk that still fails becomes a warning naming its pages. Panels from all chunks merge by collection date.
- **Photos** go as they are to `VISION_MODEL`.
- Models run with reasoning off and a JSON schema, with one repair retry on invalid JSON. Any `env.AI.run()` id works. A catalog id such as `anthropic/claude-sonnet-…` routes through AI Gateway Unified Billing and needs credits.
- Transient Workers AI errors (capacity, rate limits, timeouts) re-queue the file with backoff, up to 3 attempts. After that it shows as failed with a retry button.
- **Review** (`annotateDocument` in `src/worker/resolve.ts`) unticks rows already saved for that date, including a saved value that differs, since that's likelier a misread than a correction. Ticking a differing row replaces the saved value and writes a `result_revisions` row. A panel whose numbers match a saved draw within 5 days gets a "same draw?" hint that moves it to that date.
- **Commit** merges into an existing draw on the same date and skips values already saved.

Values are kept exactly as reported (`raw_value`, `raw_units`, `reference_text`). Numbers, range bounds and flags are derived in `src/shared/semantics.ts`, and a flag the lab reported wins over one inferred from the range. Units are never converted. Draw dates are calendar dates (`YYYY-MM-DD`), never instants.

The user guide for getting files out of portals is [importing.md](importing.md), and the same guide is in the app (`src/client/components/ImportGuide.tsx`). The research behind it is in [lab-portal-exports.md](lab-portal-exports.md).

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

`/mcp` is a stateless Streamable HTTP server (`createMcpHandler` from the Agents SDK, `src/worker/mcp/`). Sign-in is Access [managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/), so requests carry the same `Cf-Access-Jwt-Assertion` as the web app. Tools call the app's own `/api` routes in-process as the signed-in user, so validation and revisions stay in one place. Setup and the tool list: [mcp.md](mcp.md).

## Privacy

The summary is in the [README](../README.md#privacy-and-security). Where each part lives:

- PDF redaction is pattern-based (`src/worker/redact.ts`): names, dates of birth, record numbers, phone numbers and emails. It runs before the text reaches any model.
- `public/_headers` sets a content security policy that blocks loading anything from other sites.
- Worker logs hold request paths and error messages, never result values or report text (`logMessage` in `src/worker/lib.ts`).