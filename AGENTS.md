# AGENTS.md

Read `README.md` for architecture, commands and deploy. Rules that are not obvious from the code:

- This repository is public and deployed by other people into their own Cloudflare accounts. Nothing account-specific goes in it: no account or resource IDs, domains, Access values or email addresses, in code, config, docs, tests or commit messages. `npm run check:neutral` enforces it. Settings a deployment needs are Worker variables or secrets (`Settings` in `src/worker/lib.ts`), never `wrangler.jsonc` `vars`.
- Do not add a `.dev.vars.example` or `.env.example`: the Deploy to Cloudflare button asks every deployer for each value in it.
- Sign-in lives in `src/worker/auth.ts` and must fail closed. Every `/api` and `/mcp` request goes through `accessIdentity`; only `/api/health` is public. `sameOriginWrites` refuses cross-site requests for every method except GET, so a GET route must never change anything. Changes there need cases in `test/auth.test.ts`. Keep the setup steps in `src/client/components/SetupScreen.tsx` and README "Turn on sign-in" the same.
- `/mcp` auth is Access managed OAuth; don't add an OAuth server or `WWW-Authenticate` handling in the Worker (Access owns the 401).
- The client loads nothing from other sites: no CDN scripts, hosted fonts, analytics or remote images. `public/_headers` sets the content security policy; do not loosen it to make something work.
- Never commit or log health data. `.ai-runs/` and `.wrangler/` are gitignored. Worker logs must not include result values or document text: log errors with `logMessage` (`src/worker/lib.ts`), never a raw parser error.
- Committed `lab_results` are the source of truth; every chart, grid, correlation and stat is computed client-side from the `/api/subjects/:sid/dataset` payload. Do not add derived/cached tables.
- Extraction output is a proposal (`extraction_candidates.document`). Never write `lab_panels`/`lab_results` from an extractor; only `src/worker/commit.ts` commits, in one D1 batch.
- Preserve values exactly as reported (`raw_value`, `raw_units`, `reference_text`). Numbers, ref bounds and inferred flags are derived by `deriveResultFields` in `src/shared/semantics.ts`; reported flags win over inferred ones. Never infer flags from catalog default ranges.
- Units are never converted. `src/shared/units.ts` only decides notation equivalence for the mixed-units warning.
- Dates: `draw_date` is a calendar date string. Do day math with `dayNumber()` (`src/shared/dates.ts`), not `new Date(date)` in local time.
- Migrations are additive and applied before the new code deploys (`npm run deploy`, `scripts/deploy.mjs`), so the previous Worker version must keep working against the new schema. Only a first deploy, which has no database yet, deploys before migrating. Every deploy path (button, imported copy, terminal) runs `npm run deploy`; keep it the one command.
- Correlations are leads, not findings: keep n, the 95% interval and the change-on-change correlation visible wherever an r is shown.
- URLs carry view state (`?m=`, `?range=`, `?scale=`, `?a=&b=`). Use `useParam`/`useListParam` (push history) rather than component state for anything shareable.
- MCP tools go through the `/api` routes (`apiClient` in `src/worker/mcp/tools.ts`), never straight to D1, so validation and revisions stay in one place. Mark tools that change or remove data `destructiveHint: true`. Tool output is health data: never log it. Who has access is not manageable over MCP.

- UI: compose `src/client/components/ui.tsx` (`PageHeader`, `SectionHeader`, `Button`/`ButtonLink`/`ButtonAnchor`, `StatGrid`/`Stat`, `Disclosure`, `CopyRow`, `linkClass`) and `SelectField`/`SearchField` (every dropdown; search appears above five options) with Tailwind classes. Don't add page-specific CSS classes to `styles.css`. Show range status only for out-of-range values.
- Focusing a text field or search box must never zoom the page on a phone (iOS zooms below 16px). The `pointer: coarse` rule in `styles.css` forces 16px on `input`/`select`/`textarea`; keep it, and give any other focusable text surface (e.g. `contenteditable`) 16px on touch. Never use `maximum-scale`/`user-scalable=no` to stop the zoom.

Verify with `npm run check`; for UI changes also run `npm run dev` and look at `/`, `/history?m=mk_crp`, `/correlations`, `/grid`, `/import`, `/settings`. To see the setup page, run without `DEV_AUTH_EMAIL`.
