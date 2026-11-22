# Deploying

The short version is in the [README](../README.md#deploy-your-own). This page has the details.

## What you need

- **A Cloudflare account.** [Sign up](https://dash.cloudflare.com/sign-up) if you don't have one. The free plans cover everything, including reading PDFs and photos.
- **R2 turned on, before you deploy.** In the dashboard go to **Storage & databases > R2 > Overview** and finish the checkout. Cloudflare asks for a payment method even on the free plan, but the first 10 GB are free and this app stays within that. Cloudflare won't create the storage bucket until R2 is on.
- **A GitHub or GitLab account** for the deploy button, or **Node.js 22.12+ and git** to deploy from a terminal.

Sign-in is [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/), which is free. You turn it on during the deploy, so there's nothing to set up ahead of time.

### What the free plans allow

Nothing is billed on the free plans. An allowance that's used up stops that feature until it resets. Two of them shape what the app can do:

- **[Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) gives 10,000 Neurons a day.** Reading a report of 40 results uses about 100, and one of 90 results about 250, so that's dozens of reports a day. When the allowance is gone, a PDF or photo import stops with a message saying so, and works again after midnight UTC. Spreadsheets and results you type in use none.
- **[Workers Free](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) allows 10 ms of CPU per request,** and Cloudflare lets a Worker run over now and then. Imports do run over: in testing, turning a PDF into text took 50 ms for one page and 1.4 seconds for 99, and a 5,000-row spreadsheet 90 ms. On a free account these all imported: PDFs of 1 to 99 pages, a 2.4 MB photo, a 5,000-row spreadsheet. Cloudflare doesn't say how much running over it allows, so heavy use may be stopped. An import that fails with "Reading this file did not finish" is the sign.

Reading takes about 15 seconds for a short report, a minute or two for one of 40 to 90 results, and 10 minutes for 99 pages.

[Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/) ($5/month) lifts both limits and bills by use past its own allowances: [Workers, D1 and Queues](https://developers.cloudflare.com/workers/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## With the deploy button

1. Click the button in the README, sign in to Cloudflare and connect GitHub or GitLab.
2. On the setup form:
   - Tick **Create private Git repository**.
   - Turn on **Protect with Cloudflare Access**. Set the scope to **All traffic** and the policy to **Cloudflare account**, which means the members of your Cloudflare account (just you, unless you've invited others).
   - Keep the suggested names and deploy.
3. Open `https://lab-trends.<your-subdomain>.workers.dev` and sign in. **The first person to sign in becomes the owner**, so do this straight away. On a new account the address can take a few minutes to start working.
4. Add a person, then go to **Import results**. [Importing](importing.md) covers where to find your files in MyChart, Quest, Labcorp and other portals. The same guide is on that page.

If you left Access off, the app shows a **Turn on sign-in** page and nothing else until you [turn it on](#turn-on-sign-in).

## From a terminal

```bash
git clone https://github.com/alexlmiller/lab-trends.git
cd lab-trends
npm install
npx wrangler login
npm run deploy
```

`npm run deploy` builds, applies database migrations, then deploys. The first time, Wrangler creates the database, storage bucket and queue, and sets up a `workers.dev` subdomain if the account doesn't have one yet. Then [turn on sign-in](#turn-on-sign-in) and do steps 3 and 4 above.

## From a copy that's already on GitHub

In the Cloudflare dashboard go to **Workers & Pages > Create application > Continue with GitHub** and pick the repository. On the setup form:

- Use `lab-trends` as the project name (the `name` in `wrangler.jsonc`).
- Change the **Deploy command** to `npm run deploy`. The default skips database migrations.
- Turn on Access as in step 2 above.

## If you already use Cloudflare

The same steps work. A few things to know:

- **More than one account:** the deploy page asks which one. With Wrangler, set `CLOUDFLARE_ACCOUNT_ID`.
- **Cloudflare's GitHub app is already installed for another of your accounts:** the button's form may only offer **New GitHub connection** and then have nothing to install. Deploy [from a copy that's already on GitHub](#from-a-copy-thats-already-on-github) instead.
- **Your own domain:** add it under the Worker's **Settings > Domains & Routes**. Access on the Worker covers every address it has. Don't add `routes` to `wrangler.jsonc`, since domains added in the dashboard survive deploys.
- **An Access application already covers the address** (by hostname, or "protect all Workers"): nothing extra to do. The app locks to whichever Access application handles the first sign-in. To pick one explicitly, see [Settings](operating.md#settings).
- **A database, bucket or queue already named `lab-trends`, `lab-trends-files` or `lab-trends-extractions`:** Wrangler reuses it. Rename it on the deploy page or in `wrangler.jsonc` if you don't want that.

## Turn on sign-in

Only needed if you didn't turn on Access during the deploy. Until it's on, the app shows only a setup page and the API refuses every request.

1. In the Cloudflare dashboard, open **Workers & Pages** and select the Worker.
2. Open its **Access** tab and choose **Protect this Worker behind Access**. If it asks you to set up Zero Trust first, pick any team name and the Free plan. It asks for a payment method but doesn't charge for this.
3. Choose **All traffic**. For who can sign in, choose **Cloudflare account**. Then choose **Apply Access**.
4. Reload the app and sign in.

From then on the app only accepts sign-ins through that Access application, and only from the owner and the people the owner adds. If the app shows something other than your results after this, see [Sign-in problems](operating.md#sign-in-problems).

## Let someone else in

You need to add them in two places:

1. **Cloudflare:** allow their email address in the policy on the Worker's Access application (**Zero Trust > Access controls > Policies**).
2. **Lab Trends:** **Settings > People with access > Add someone by email**.

Everyone with access can see and change every person's results. There are no per-person permissions. Only the owner can see the list of people, change it, or delete a person.

## Updating

The deploy button gives you a copy of the code, not a fork, so it won't update on its own. From a checkout of your copy:

```bash
git pull https://github.com/alexlmiller/lab-trends.git main
git push
```

Cloudflare rebuilds and redeploys on push and applies any new migrations first. If you deployed from a terminal, run `git pull && npm install && npm run deploy` instead.

When an update changes how results are read, the app brings your saved results up to date by itself over the first few requests after the deploy: numbers, ranges and flags are worked out again from the text each result was saved with. Nothing you entered is changed.
