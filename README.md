# Lab Trends

Keep all your lab results in one place and see how they change over time. You run it in your own Cloudflare account, on the free plans, and nobody else can sign in to your copy.

**[Try the demo](https://labs-demo.alexmiller.net)**: made-up records, read-only.

![Latest results: watched tests first, then anything out of range, each shown against its reference range](docs/images/latest-results.png)

- **Import from anywhere.** PDFs, photos or spreadsheets from any lab or patient portal. A model reads the values and you check them before anything is saved.
- **See what changed.** Each report puts out-of-range results first, next to the reference range and your previous result.
- **Follow trends.** Chart any test over time with medications and illnesses on the same timeline, or overlay tests to see how they move together.
- **Bring an assistant.** Connect Claude or another assistant over [MCP](docs/mcp.md) to review new results and keep the timeline up to date.
- **Free to run.** Everything, including reading PDFs and photos, fits inside Cloudflare's free plans.

![LDL and HDL overlaid as z-scores: LDL falls and HDL rises after starting a statin](docs/images/compare-z-score.png)

Screenshots use fictional sample data. Lab Trends records what your lab reported; it isn't a medical device and doesn't give medical advice.

## Deploy your own

You need a [Cloudflare account](https://dash.cloudflare.com/sign-up) with [R2](https://developers.cloudflare.com/r2/get-started/) turned on (**Storage & databases > R2**). R2 asks for a payment method and charges nothing inside its free allowance.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/alexlmiller/lab-trends)

1. Click the button and connect GitHub or GitLab.
2. Turn on **Protect with Cloudflare Access**, with scope **All traffic** and policy **Cloudflare account**, then deploy.
3. Open `https://lab-trends.<your-subdomain>.workers.dev` and sign in straight away. The first person to sign in becomes the owner.

Or from a terminal, then [turn on sign-in](docs/deploying.md#turn-on-sign-in):

```bash
git clone https://github.com/alexlmiller/lab-trends.git && cd lab-trends
npm install && npx wrangler login && npm run deploy
```

Other ways to deploy, what the free plans allow, and letting someone else in: [docs/deploying.md](docs/deploying.md).

## Updating

The deploy button gives you a copy, not a fork, so pull changes into it yourself. Cloudflare redeploys on push:

```bash
git pull https://github.com/alexlmiller/lab-trends.git main && git push
```

If you deployed from a terminal, see [Updating](docs/deploying.md#updating).

## Privacy and security

- **Your account only.** The app, database and uploaded files all live in your Cloudflare account. There's no shared server and nothing runs on mine.
- **Cloudflare Access in front.** Cloudflare checks every request before it reaches the app, so a stranger never touches the app's code, and there's no password in the app to leak. The app also verifies each sign-in itself and only lets in people you've added.
- **Reports stay with Cloudflare.** A model on Workers AI reads your PDFs and photos, and Cloudflare [doesn't keep or train on](https://developers.cloudflare.com/workers-ai/platform/data-usage/) that data. Names, birth dates and record numbers are removed from PDF text first, where the report labels them. Photos are sent as they are.
- **Delete means delete.** Removing a result, a draw or a person removes it from the database and deletes its uploaded files.
- **Nothing from other sites.** No analytics, trackers or third-party scripts, enforced by a content security policy.

Turn on two-factor authentication for your Cloudflare account, since anyone who can sign in to it can read your data. Details are in [how it works](docs/how-it-works.md#privacy); please report security problems privately ([SECURITY.md](SECURITY.md)).

## More docs

- [Deploying](docs/deploying.md): what you need and what it costs, other ways to deploy, sign-in, adding people
- [Importing](docs/importing.md): getting results out of MyChart, Quest, Labcorp and other portals
- [Running your copy](docs/operating.md): settings, sign-in problems, backups, deleting, removing everything
- [MCP](docs/mcp.md): connecting an AI assistant
- [How it works](docs/how-it-works.md) and [Contributing](CONTRIBUTING.md)

[MIT](LICENSE) licensed. Third-party notices are in [NOTICE](NOTICE).
