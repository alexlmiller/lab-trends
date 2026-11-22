# Security

Lab Trends holds health records, so please report problems privately.

## Reporting

Use **Security > Report a vulnerability** on this repository (GitHub private vulnerability reporting). Do not open a public issue for anything that could expose someone's records.

Include what you did, what happened, and the commit you tested. Never include real health data; `npm run db:seed:local` gives fictional records.

## What counts

- Reaching `/api` or `/mcp` data without a valid Cloudflare Access sign-in, or as someone who is not the owner or on the people list (`src/worker/auth.ts`).
- Taking over a deployment that has already been claimed.
- Result values, report text or uploaded files reaching logs, another site, or anyone but the deployment's own users.
- Script injection through uploaded files, extracted text, or imported values.
- On a deployment with `DEMO_MODE=read-only`: changing anything, or reading records of anyone other than the demo people.

Known and accepted: a deployment that nobody has signed in to yet can be claimed by whoever signs in first ([docs/operating.md](docs/operating.md#sign-in-problems) explains the reset). It holds no data at that point.

## Your own deployment

Its security rests on your Cloudflare account. Turn on two-factor authentication there, keep the Worker behind Access, and keep the copy you deployed up to date ([Updating](docs/deploying.md#updating)).
