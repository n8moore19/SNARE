# SNARE AI worker (live Claude)

A tiny Cloudflare Worker that lets the SNARE prototype talk to Claude. The website
sends the chat message and a snapshot of the app (fridge, list, budget, meals). The
worker adds the secret API key, asks Claude, and returns a short reply plus app
actions. The key never appears in the public website or on GitHub.

Until this is set up, the app uses its built in assistant, and it falls back to that
assistant automatically if the worker is ever unreachable.

## Setup (about 10 minutes)

1. **Anthropic API key**
   - Sign up at https://console.anthropic.com
   - Billing: add credit (for example $5).
   - Limits: set a monthly spend limit (for example $10) so a demo can never run up a bill.
   - API keys: create a key and copy it. Keep it private: don't paste it into chat, Slack or GitHub.

2. **Cloudflare account**: sign up free at https://dash.cloudflare.com

3. **Deploy** from Terminal on your Mac:

   ```bash
   cd ~/snare-prototype/worker
   npm install
   npx wrangler login                        # opens the browser to connect Cloudflare
   npx wrangler deploy                       # prints your worker URL
   npx wrangler secret put ANTHROPIC_API_KEY # paste the key when asked
   ```

   Then set up storage and a team passcode for the launch agents:

   ```bash
   npx wrangler kv namespace create AGENTS   # paste the id it prints into wrangler.toml
   npx wrangler secret put TEAM_KEY           # a passcode your team types to run agents and edit tasks
   npx wrangler deploy                        # deploy again so the agents and the 8:00 schedule go live
   ```

4. **Connect the app**: put the URL that `deploy` printed into `config.js` at the root
   of the project (`window.SNARE_AI_URL = 'https://snare-ai.<you>.workers.dev';`),
   then push to GitHub.

## Launch agents

The same worker runs the launch agents shown on `org.html`.

- **Chief of Staff** (built): writes the team's daily brief at 13:00 UTC (8:00 in Toronto
  in winter, 9:00 in summer), and on demand with Run now. It reads the team task list
  (edited on the org page, saved in KV), real commits to the SNARE repo from GitHub, the
  other agents' latest outputs, and sample app metrics (labelled sample until real users).
  About 10 to 15 cents a run on Opus 5.5.
- Routes: `GET /agents/status`, `GET /agents/tasks`, `PUT /agents/tasks`, `GET /agents/chief`,
  `POST /agents/chief/run`. Changing tasks or running an agent needs the `X-Team-Key` header
  (the team passcode).

## Settings (wrangler.toml)

- `MODEL`: `claude-opus-5-5` by default. At low effort for chat, expect roughly 2 to 3
  cents per message. `claude-haiku-5-5` costs a small fraction of that if you want it
  cheaper. Run `npx wrangler deploy` again after changing it.
- `ALLOWED_ORIGINS`: sites allowed to use the worker. Add `http://localhost:8000` (comma
  separated) to test locally.

## Safety

- The worker only answers requests from the allowed site and limits each visitor to
  about 20 messages a minute.
- The spend limit in the Anthropic console is the real backstop. Set it.
- Actions the model suggests are checked against the app's own recipes and products
  before anything runs.
