# Connecting an AI assistant (MCP)

Your copy has a remote MCP server at `/mcp` on its address, for example `https://lab-trends.<your-subdomain>.workers.dev/mcp`. **Settings** in the app shows the exact URL.

It's built for an assistant helping someone manage an ongoing condition: reviewing new draws, following watched tests, comparing results before and after a treatment, and keeping the timeline of medications and illnesses up to date.

## Set it up

1. Turn on [managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/) for the Worker's Access application. Assistants then sign in through the same Access login as the web app.
2. Add the server to your assistant:
   - **Claude (web, desktop or mobile):** Settings > Connectors > Add custom connector. Name it Lab Trends and paste the URL.
   - **Claude Code:** `claude mcp add --transport http lab-trends https://<your-address>/mcp`
   - **Other clients** that support OAuth work too. Their sign-in callback may need to be allowed in Access first.

To poke at it directly, run `npx @modelcontextprotocol/inspector@latest` with the same URL.

## What it can do

- **Start here:** `get_overview`.
- **Read:** people, tests, test history, draws, correlations, events, watchlist, and `compare_around_event`.
- **Write:** events (including periods with a note each; `add_periods`, `close_ongoing_on`, `delete_event`), draw notes and tags (`update_draw`), the watchlist, targets, result corrections, and new results through `draft_results`, then `commit_results` or `discard_draft`.
- **Prompts:** `review_latest_results`, `prepare_visit_summary`, `treatment_response`.

## Good to know

- Whatever the assistant reads is sent to the company that runs it.
- What it saves or changes goes through the same checks as the web app and is recorded as `<email> (via MCP)`.
- It can delete results and events, and those deletes are permanent. `delete_result` needs `confirm: true`.
- It can't delete a test, a draw or a person, or change who has access. Those are web app only.
- Text inside your records, such as a test name or a note, is treated as data. The server tells the assistant not to follow instructions found there.
