# Contributing

Issues and pull requests are welcome. Please never include real health data in either, and report anything security-related privately ([SECURITY.md](SECURITY.md)).

## Run it locally

```bash
npm install
echo 'DEV_AUTH_EMAIL=you@example.com' > .dev.vars
npm run db:migrate:local
npm run db:seed:local   # optional: two fictional people, three years of results
npm run dev             # http://localhost:5173
```

This runs entirely on your machine and needs no Cloudflare account. `DEV_AUTH_EMAIL` signs every request in as that address, as the owner, on `localhost` only. Leave it out to see the setup page, or set `DEMO_MODE=read-only` instead to see the public demo.

PDF and photo import fail locally because they call Workers AI. `npm run dev:ai` connects that binding to the account `npx wrangler login` used (set `CLOUDFLARE_ACCOUNT_ID` if you have several), and that usage is billed. The MCP server is at `http://localhost:5173/mcp`.

There's deliberately no `.dev.vars.example`. The deploy button would ask every deployer for its values.

## Before you open a pull request

```bash
npm run check           # typecheck, tests, build
npm run check:neutral   # no account IDs, domains or email addresses committed
```

The tests run the API against Node's built-in SQLite with the real migrations (`test/helpers.ts`), so they need Node 22.13 or newer. Two of them are worth knowing before you start:

- `test/parsers.test.ts` is the table of what lab reports print and what it means. Add the case there before changing a parser.
- `test/queries.test.ts` fails when a statement the app runs often reads a whole table or sorts its rows. Add new hot statements to it.

For UI changes, also look at `/`, `/history?m=mk_crp`, `/correlations`, `/grid`, `/import` and `/settings` with the sample data loaded.

[AGENTS.md](AGENTS.md) has the rules that aren't obvious from the code: keeping the repo account-neutral, how sign-in must fail closed, never logging health data, keeping values exactly as reported, and so on. They apply to people as well as coding agents. [docs/how-it-works.md](docs/how-it-works.md) covers the architecture.

## Sample records

`scripts/demo-data.mjs` writes the fictional records used by `npm run db:seed:local`, the screenshots and the public demo. Dates count back from today (or `--today YYYY-MM-DD`), and running it again replaces every demo person.

## Screenshots

The images in `docs/images` come from the sample records with `--today 2026-11-22`, at 1280 px wide and 2x: `/` and `/history?m=mk_ldl,mk_hdl&layout=overlay&scale=z&event=statin`.
