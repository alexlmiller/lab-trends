# Running your copy

Settings, fixing sign-in, backups and removing a deployment. Deploying and updating are in the [README](../README.md).

## Settings

All optional. Set them as variables or secrets on the Worker (**Settings > Variables and Secrets**, or `npx wrangler secret put NAME`), never in `wrangler.jsonc`. They survive deploys.

| Name | Effect |
|---|---|
| `OWNER_EMAIL` | The owner. Without it, the first person to sign in is the owner. Set it to change the owner. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Trust only this Access application (team domain such as `<team>.cloudflareaccess.com`, and the application's audience tag) instead of the one seen at first sign-in. Set both: with only one, the app refuses every sign-in. |
| `EXTRACTION_MODEL` | Model that reads PDF text. Default `@cf/deepseek-ai/deepseek-v4.1-flash-1017`. |
| `VISION_MODEL` | Model that reads photos. Defaults to `EXTRACTION_MODEL`. |
| `AI_GATEWAY_ID` | Send model calls through a named [AI Gateway](https://developers.cloudflare.com/ai-gateway/). |

The default model needs Workers Paid. A model id that doesn't start with `@cf/` isn't run by Cloudflare: report text and photos go to that provider, and the Import page says so.

Cloudflare also accepts prepaid [AI Gateway credits](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) in place of Workers Paid for the default model (card only, 5% fee on credits). That route hasn't been tried with this app.

## Sign-in problems

| The app says | Cause | Fix |
|---|---|---|
| Turn on sign-in | The request didn't pass through Access | [Turn on sign-in](../README.md#turn-on-sign-in) |
| Locked to a different sign-in | The Access application was recreated, the app moved accounts, or someone else signed in first on a new deployment | Clear the lock (below), reload, sign in |
| You're not on the list | Access let the address in, but the app's list doesn't include it | The owner adds it in Settings |
| Almost there | Migrations haven't run | `npm run db:migrate:remote`, or deploy again |
| Sign-in settings are incomplete | Only one of `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` is set | Set both or delete both ([Settings](#settings)) |

To clear the lock, run this in the D1 console in the dashboard (**Storage & databases > D1 >** the database **> Console**) or from a checkout:

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM instance"
```

Results and the people list aren't touched. The next person to sign in becomes the owner.

## Backups

- D1 Time Travel restores the database to an earlier point: `npx wrangler d1 time-travel info DB`.
- For an offline copy: `npx wrangler d1 export DB --remote --output <file>`.
- **Settings > Export CSV** gives a results file you can import again.

## Removing everything

Detach the Worker from the queue first. Cloudflare won't delete either while they're attached. Then delete the Worker, queue, database and bucket:

```bash
npx wrangler queues consumer remove lab-trends-extractions lab-trends
npx wrangler delete --name lab-trends
npx wrangler queues delete lab-trends-extractions
npx wrangler d1 delete lab-trends
npx wrangler r2 bucket delete lab-trends-files
```

If you turned on Access just for this app, you can also delete its Access application under **Zero Trust > Access controls > Applications**.
