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

4. **Connect the app**: put the URL that `deploy` printed into `config.js` at the root
   of the project (`window.SNARE_AI_URL = 'https://snare-ai.<you>.workers.dev';`),
   then push to GitHub.

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
