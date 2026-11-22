# Lab Trends

Keep your lab results in one place and see how they change. Upload reports as PDFs, photos or spreadsheets, review what was read, then chart any test over time, compare tests, and mark medications, illnesses and other events against them.

You run your own copy in your own Cloudflare account. Nobody else, including the authors, can reach your data.

Lab Trends is a record-keeping tool. It is not a medical device and gives no medical advice. See [Licence](#licence).

## Prerequisites

| You need | What for | Cost |
|---|---|---|
| A [Cloudflare account](https://dash.cloudflare.com/sign-up) | The app, its database and its files all live in it. | Free |
| A payment method on that account | R2 asks for one before it switches on, on its free plan too. | No charge inside the free allowances |
| [R2](https://developers.cloudflare.com/r2/get-started/) switched on | Storing uploaded files. In the dashboard: **Storage & databases > R2 > Overview**, then complete the checkout. Do it before you deploy: Cloudflare refuses to create the bucket until R2 is on. | First 10 GB free |
| Cloudflare Access | Sign-in. Nothing to set up beforehand: you switch it on in the deploy form, and Cloudflare creates the Zero Trust organization behind it. | Free |
| A GitHub or GitLab account | The deploy button only. Cloudflare copies this repository into it and deploys from there. | Free |
| Node.js 22.12 or newer, and git | Deploying from a terminal only. | |
| The [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) | Importing PDFs and photos only. The model that reads them is [not offered on the free plan](https://developers.cloudflare.com/workers-ai/platform/pricing/). | $5 a month |

Without Workers Paid you can still type results in and import spreadsheets; a 540-value spreadsheet imports on the free plan. A PDF or photo import stops with a message saying the plan does not offer the model.

Past the free allowances Cloudflare bills by use: [Workers, D1 and Queues](https://developers.cloudflare.com/workers/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/). Workers AI includes 10,000 Neurons a day on both plans and bills beyond that on Workers Paid.

AI Gateway is not needed. Cloudflare also accepts prepaid [AI Gateway credits](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) in place of Workers Paid for the default model (card only, 5% fee on credits); that route has not been tried with this app.

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/alexlmiller/lab-trends)

1. Select the button above, sign in to Cloudflare and connect GitHub or GitLab.
2. On the setup form, tick **Create private Git repository**. Switch on **Protect with Cloudflare Access**, set its scope to **All traffic** and its policy to **Cloudflare account** (the members of your Cloudflare account: only you, unless you have invited others). Keep the suggested names and deploy.
3. Open the Worker's address (`https://lab-trends.<your-subdomain>.workers.dev`) and sign in with your Cloudflare account. The first person to sign in becomes the owner, so do this straight away. On a new account the address can take a few minutes to start answering.
4. Add a person, then go to **Import results**. Where to get files from each lab or patient portal: [`docs/importing.md`](docs/importing.md), also shown on that page.

If you left the Access switch off, the app shows **Turn on sign-in** and nothing else until you follow [Turn on sign-in](#turn-on-sign-in).

### From your own copy

To deploy a copy or fork that is already on your GitHub: in the Cloudflare dashboard, **Workers & Pages > Create application > Continue with GitHub**, and pick the repository. On the setup form use `lab-trends` (the `name` in `wrangler.jsonc`) as the project name, change the **Deploy command** to `npm run deploy` (the default skips database migrations), and switch on Access as in step 2.

### From a terminal instead

```bash
git clone https://github.com/alexlmiller/lab-trends.git
cd lab-trends
npm install
npx wrangler login
npm run deploy
```

`npm run deploy` builds, applies database migrations and deploys. On a first deploy Wrangler creates the database, bucket and queue, and on a new account registers a `workers.dev` address. Then [turn on sign-in](#turn-on-sign-in) and follow steps 3 and 4 above.

### If you already use Cloudflare

The same steps work. Things that differ:

- Several accounts: the deploy page asks which one. For Wrangler, set `CLOUDFLARE_ACCOUNT_ID`.
- Cloudflare's GitHub app already installed for another of your Cloudflare accounts: the deploy button's form may offer only **New GitHub connection**, and GitHub then has nothing new to install. Use [From your own copy](#from-your-own-copy) instead, which lists your repositories.
- Your own domain: add it under the Worker's **Settings > Domains & Routes**. Access on the Worker covers every address the Worker has. Do not add `routes` to `wrangler.jsonc`; domains added in the dashboard survive deploys.
- An Access application already in front of the address (by hostname, or "protect all Workers"): no extra step. The app locks to whichever Access application handles the first sign-in. To choose one explicitly, see [Settings](#settings).
- A database, bucket or queue already named `lab-trends`, `lab-trends-files` or `lab-trends-extractions`: Wrangler reuses it. Rename it on the deploy page or in `wrangler.jsonc` if that is not what you want.

## Turn on sign-in

Sign-in is [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). Until it is on, the app shows only a setup page and the API refuses every request. The deploy form's **Protect with Cloudflare Access** switch turns it on for you. If you left that off, or deployed from a terminal:

1. In the Cloudflare dashboard, open **Workers & Pages** and select the Worker.
2. Open its **Access** tab and choose **Protect this Worker behind Access**. If asked to set up Zero Trust first, pick any team name and the Free plan. It asks for a payment method and does not charge for this.
3. Choose **All traffic**. For who can sign in, choose **Cloudflare account** (the members of your Cloudflare account). Choose **Apply Access**.
4. Reload the app and sign in.

The app then accepts sign-ins only from that Access application, and only from the owner and the people the owner adds.

### Let someone else in

Two places, both needed:

1. Cloudflare: allow their email address in the policy on the Worker's Access application (**Zero Trust > Access controls > Policies**).
2. Lab Trends: **Settings > People with access > Add someone by email**.

Everyone with access sees and can change every person's results. There are no per-person permissions.

### Sign-in problems

| The app says | Cause | Fix |
|---|---|---|
| Turn on sign-in | The request did not pass through Access | [Turn on sign-in](#turn-on-sign-in) |
| Locked to a different sign-in | The Access application was recreated, the app moved accounts, or someone else signed in first on a new deployment | Clear the lock (below), reload, sign in |
| You're not on the list | Access let the address in; the app's list does not include it | The owner adds it in Settings |
| Almost there | Migrations have not run | `npm run db:migrate:remote`, or deploy again |
| Sign-in settings are incomplete | Only one of `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` is set | Set both or delete both ([Settings](#settings)) |

Clear the lock in the dashboard (**Storage & databases > D1 >** the database **> Console**) or from a checkout:

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM instance"
```

Results and the people list are untouched. The next person to sign in becomes the owner.

## Settings

All optional. Set them as variables or secrets on the Worker (**Settings > Variables and Secrets**, or `npx wrangler secret put NAME`), never in `wrangler.jsonc`. They survive deploys.

| Name | Effect |
|---|---|
| `OWNER_EMAIL` | The owner. Without it, the first person to sign in is the owner. Set it to change owner. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Trust only this Access application (team domain such as `<team>.cloudflareaccess.com`, and the application's audience tag) instead of the one seen at first sign-in. Set both: with only one, the app refuses every sign-in. |
| `EXTRACTION_MODEL` | Model that reads PDF text. Default `@cf/deepseek-ai/deepseek-v4.1-flash-1017`. |
| `VISION_MODEL` | Model that reads photos. Default: same as `EXTRACTION_MODEL`. |
| `AI_GATEWAY_ID` | Route model calls through a named AI Gateway. |

The default model needs the Workers Paid plan ([Prerequisites](#prerequisites)). A model id that does not start with `@cf/` is not run by Cloudflare: report text and photos go to that provider, and the Import page says so.

## Privacy

- Results, events and settings are in your D1 database. Uploaded files are in your R2 bucket, which has no public address. Both are in your Cloudflare account.
- Spreadsheets are parsed inside the Worker. PDF text has names, dates of birth, record numbers, phone numbers and emails removed by pattern (`src/worker/redact.ts`), then goes to the extraction model. Photos go to the model as they are. The default model runs on Cloudflare Workers AI.
- The pages load nothing from other sites: no fonts, analytics or scripts. `public/_headers` sets a content security policy that enforces this.
- Worker logs hold request paths and error messages, not result values or report text.
- An AI assistant connected over MCP receives whatever it reads, and so does the company that runs it.
- Turn on two-factor authentication for your Cloudflare account. Anyone who can sign in to it can read the database.

## Updating

Cloudflare's deploy button gives you a copy of the code, not a fork, so it does not update itself. From a checkout of your copy:

```bash
git pull https://github.com/alexlmiller/lab-trends.git main
git push
```

Cloudflare rebuilds and redeploys on push, and the deploy applies new migrations first. If you deployed from a terminal: `git pull && npm install && npm run deploy`.

## MCP server

`/mcp` on the app's address is a remote MCP server (`createMcpHandler` from the Agents SDK, stateless Streamable HTTP, `src/worker/mcp/`). Settings in the app shows the URL and the steps for Claude.

- Sign-in is Access [managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/). Turn it on for the Access application; MCP clients then sign in through the normal Access login and requests carry the same `Cf-Access-Jwt-Assertion` as the web app.
- Built for an assistant helping someone manage an ongoing condition. Orientation: `get_overview`. Read: people, tests, test history, draws, correlations, events, watchlist, `compare_around_event`. Write: events (periods with per-period notes; `add_periods`, `close_ongoing_on`), draw notes and tags (`update_draw`), watchlist, targets, result corrections, and new results through `draft_results` then `commit_results` or `discard_draft`. Prompts: `review_latest_results`, `prepare_visit_summary`, `treatment_response`.
- Not exposed: deleting a test, and changing who has access (web app only). `delete_result` requires `confirm: true`.
- Tools call the app's own `/api` routes in-process as the signed-in user, so edits write the same revisions as the web app, recorded as `<email> (via MCP)`.
- Inspect: `npx @modelcontextprotocol/inspector@latest` with the URL above.

## Backups and leaving

- D1 Time Travel restores the database to an earlier point: `npx wrangler d1 time-travel info DB`.
- Offline copy: `npx wrangler d1 export DB --remote --output <file>`. Settings > Export CSV gives a results file that can be imported again.
- To remove everything, first detach the Worker from the queue: Cloudflare refuses to delete either while they are attached. Then delete the Worker, the queue, the D1 database and the R2 bucket.

  ```bash
  npx wrangler queues consumer remove lab-trends-extractions lab-trends
  npx wrangler delete --name lab-trends
  npx wrangler queues delete lab-trends-extractions
  npx wrangler d1 delete lab-trends
  npx wrangler r2 bucket delete lab-trends-files
  ```

## Architecture

One Worker (`src/worker`, Hono) serves the API under `/api/*`, the MCP server at `/mcp`, and the React app (`src/client`) as static assets.

| Binding | Resource | Use |
|---|---|---|
| `DB` | D1 `lab-trends` | All records (`migrations/`) |
| `FILES` | R2 `lab-trends-files` | Uploaded source files, key `<subject>/<file>/<name>` |
| `EXTRACTIONS` | Queue `lab-trends-extractions` | PDF and image extraction jobs (consumer in the same Worker) |
| `AI` | Workers AI | Extraction models |

Sign-in (`src/worker/auth.ts`): Access adds a signed token to each request; the Worker verifies the signature, issuer and audience, then checks the email against the owner and `allowed_users`. The trusted Access application is `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` when set, otherwise the one recorded in the `instance` table at first sign-in. A request without a valid token is refused, and so is a write that the browser reports as coming from another site.

Import pipeline: upload → raw file to R2 → `extraction_candidates` row (a proposal) → review and edit in `/import/:batchId` → commit into `lab_panels`/`lab_results`. Nothing reaches charts without a commit. Research behind the import guide: `docs/lab-portal-exports.md`. The guide is also in the app (`src/client/components/ImportGuide.tsx`; keep both in step).

- CSV/XLSX: parsed in the Worker (`src/shared/tabular.ts`, `src/shared/xlsx.ts`). Supports row-per-result files and the pivoted history sheet (`Test | Reference Range | Units | <date>…`, one tab per panel; a `Cycle Day` row becomes draw tags).
- PDF: text rebuilt with layout from pdf.js positions (`unpdf`, `src/shared/pdfLayout.ts`), identifiers redacted, then `EXTRACTION_MODEL` with a JSON schema. Falls back to `env.AI.toMarkdown` if pdf.js fails. Scanned PDFs without text: upload a photo instead.
- Long PDFs are read in chunks of whole pages (`src/worker/chunking.ts`, about 5,000 characters, 4 at a time, up to 40 chunks), because one reply holds about 200 results. Later chunks also get the top of page 1 for the collection date. A reply that runs out of tokens is split and re-read; a chunk that still fails becomes a warning naming its pages. Panels from all chunks merge by collection date.
- Images: sent as they are to `VISION_MODEL`.
- Models are called with reasoning off and a JSON schema, plus one repair retry on invalid JSON. Any `env.AI.run()` id works; a catalog id such as `anthropic/claude-sonnet-…` routes through AI Gateway Unified Billing (needs credits).
- Transient Workers AI errors (capacity, rate limits, timeouts) re-queue the file with backoff, up to 3 attempts; then it shows as failed with a retry button.
- Review (`annotateDocument` in `src/worker/resolve.ts`) unticks rows already saved for that date, including a different saved value (likelier a misread than a correction). Ticking a differing row replaces the saved value on commit and writes a `result_revisions` row. A panel whose numbers match a saved draw within 5 days gets a "same draw?" hint that moves it to that date.
- Commit merges into an existing draw on the same date and skips values already saved.

Draw dates are calendar dates (`draw_date` `YYYY-MM-DD`), never instants.

## Develop

```bash
npm install
echo 'DEV_AUTH_EMAIL=you@example.com' > .dev.vars
npm run db:migrate:local
npm run db:seed:local   # optional: a fictional person with a few draws
npm run dev             # http://localhost:5173, entirely local
npm run check           # typecheck + tests + build
```

`DEV_AUTH_EMAIL` signs every request in as that address, as the owner, on `localhost` only. Without it you get the setup page, which is how to work on it. There is deliberately no `.dev.vars.example`: the deploy button would ask every deployer for its values.

`npm run dev` needs no Cloudflare account; PDF and photo import fail there because they call Workers AI. `npm run dev:ai` connects that binding to the account `npx wrangler login` used (set `CLOUDFLARE_ACCOUNT_ID` if you have several) and the usage is billed. MCP locally: `http://localhost:5173/mcp`.

`npm run check:neutral` fails if an account ID, domain, resource ID or email address is committed. CI runs it for this repository.

## Reading results

Latest results (`/`, or `/?draw=<id>` for an earlier draw) is the one page per draw, with draw and result editing and deletion; `/draws` lists every draw. It shows out-of-range results first, each with its reported range. Status appears only for out-of-range values. Followed tests absent from that draw appear separately with their last measurement date. `/watchlist` shares its followed tests with the stars in `/markers`. Numeric differences require two exact values in equivalent reported units.

History (`/history?m=id1,id2`) opens the first test's record. Add other tests to compare them on separate charts or a shared scale. The same view supports event periods, draw inspection, result edits, personal targets and saved views. History is opened from a test, not from the navigation; the chevron beside the title switches tests.

In `/events`, add dates or closed or ongoing periods to one named event. `/history` compares the nearest measured results strictly before and after the selected day, start, or end. Charts shade each period separately.

## Licence

[MIT](LICENSE). Third-party notices: [NOTICE](NOTICE). Report security problems privately: [SECURITY.md](SECURITY.md).

Lab Trends stores and displays what your lab reported. It does not diagnose, and its correlations are leads to raise with a clinician, not findings. Values read from PDFs and photos by a model can be wrong; check them against the report before saving.
