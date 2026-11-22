# Running your copy

Settings, fixing sign-in and imports, backups, deleting and removing a deployment. Deploying and updating: [deploying.md](deploying.md).

## Settings

All optional. Set them as variables or secrets on the Worker (**Settings > Variables and Secrets**, or `npx wrangler secret put NAME`), never in `wrangler.jsonc`. They survive deploys.

| Name | Effect |
|---|---|
| `OWNER_EMAIL` | The owner. Without it, the first person to sign in is the owner. Set it to change the owner. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Trust only this Access application (team domain such as `<team>.cloudflareaccess.com`, and the application's audience tag) instead of the one seen at first sign-in. Set both: with only one, the app refuses every sign-in. |
| `EXTRACTION_MODEL` | Model that reads PDF text. Default [`@cf/google/gemma-4-26b-a4b-it`](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/). |
| `VISION_MODEL` | Model that reads photos. Defaults to `EXTRACTION_MODEL`. |
| `AI_GATEWAY_ID` | Send model calls through a named [AI Gateway](https://developers.cloudflare.com/ai-gateway/). Depending on its settings, a gateway logs or caches what passes through, which here is report text and photos. The Import page says when one is set. |
| `DEMO_MODE` | `read-only` turns a deployment into a public demo: no sign-in, nothing can be changed, sample records only. Never set it on a copy with your own records; the app refuses to show anything if you do. |

The default model is offered on the Workers Free plan. Some Workers AI models aren't: with one of those set on a free account, a PDF or photo import stops with a message saying so. A model id that doesn't start with `@cf/` isn't run by Cloudflare: report text and photos go to that provider, and the Import page says so.

## Sign-in problems

| The app says | Cause | Fix |
|---|---|---|
| Turn on sign-in | The request didn't pass through Access | [Turn on sign-in](deploying.md#turn-on-sign-in) |
| Locked to a different sign-in | The Access application was recreated, the app moved accounts, or someone else signed in first on a new deployment | Clear the lock (below), reload, sign in |
| You're not on the list | Access let the address in, but the app's list doesn't include it | The owner adds it in Settings |
| Almost there | Migrations haven't run | `npm run db:migrate:remote`, or deploy again |
| Sign-in settings are incomplete | Only one of `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` is set | Set both or delete both ([Settings](#settings)) |

To clear the lock, run this in the D1 console in the dashboard (**Storage & databases > D1 >** the database **> Console**) or from a checkout:

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM instance"
```

Results and the people list aren't touched. The next person to sign in becomes the owner.

## Import problems

| The import says | Cause | Fix |
|---|---|---|
| Today's free Workers AI allowance … is used up | The account's 10,000 free Neurons for the day are spent | Choose **Try again** after midnight UTC |
| The model set for this app … is not offered on the Workers Free plan | `EXTRACTION_MODEL` or `VISION_MODEL` names a model that needs Workers Paid | Delete the setting to use the default, or upgrade |
| Reading this file did not finish | The Worker reading it was stopped, most likely for running over the free plan's CPU allowance | Try again. If it keeps happening, upload fewer pages at a time, or upgrade to Workers Paid |
| This PDF took too long to read in one go | The report is longer than the model can read in the time one read is allowed | Upload the pages it names as a separate PDF |

What the free plans allow: [deploying.md](deploying.md#what-the-free-plans-allow).

## Backups

- D1 Time Travel restores the database to an earlier point: `npx wrangler d1 time-travel info DB`. It reaches back 7 days on Workers Free and 30 on Workers Paid.
- For an offline copy: `npx wrangler d1 export DB --remote --output <file>`.
- **Settings > Export CSV** gives a results file you can import again. **Export everything** gives a JSON file with results, draws, events, targets and saved views.
- None of these includes the uploaded reports. Those are in the R2 bucket.

## Deleting

Deleting is permanent. A deleted result, draw, test, import or person is removed from the database, and its uploaded files from R2.

- Discarding an import, or leaving a file out of one, deletes that upload.
- An upload stays while any draw still shows it as a source, and goes with the last one.
- **Settings > Delete person** removes a person and everything recorded about them. Only the owner can do it.
- **Settings > Uploads not shown on any draw** lists files kept from older imports that no draw links to, so you can delete them.

Time Travel can still restore the database to a point before a deletion. It doesn't bring back files.

## Removing everything

Detach the Worker from the queue first. Cloudflare won't delete either while they're attached. Then delete the Worker, queue and database.

R2 won't delete a bucket that still holds files, so empty it first: in the dashboard, **Storage & databases > R2 >** the bucket **> Settings > Empty Bucket**. Then delete the bucket.

```bash
npx wrangler queues consumer remove lab-trends-extractions lab-trends
npx wrangler delete --name lab-trends
npx wrangler queues delete lab-trends-extractions
npx wrangler d1 delete lab-trends
npx wrangler r2 bucket delete lab-trends-files
```

Then check two places in the dashboard and delete what's left: the Worker's Access application (**Zero Trust > Access controls > Applications**), and the logs of an AI Gateway if you set one.
