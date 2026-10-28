# SNARE: digital fridge prototype

Clickable prototype for Team SNARE's Venturing Field Project (Ivey). A digital fridge for
students: scan a shelf or single items, see what expires first, get meals ranked around it,
add only the missing items to a list, and plan the cheapest trip to buy them.

All prices, deals, recipes and scan results are demo data in `data.js`. The Ask AI chat
uses a built in assistant (`aiReply()` in `app.js`) that understands follow-ups and can
edit the fridge and list, plan a week and plan trips. To switch on live Claude, deploy the
worker in `worker/` (see `worker/README.md`) and put its URL in `config.js`.

## Demo links

- `#welcome` start fresh at onboarding
- `#demo` load a sample fridge
- `#meals`, `#shop`, `#impact` open those tabs

## Files

- `index.html` page shell (phone mockup, AI panel)
- `config.js` live AI switch (worker URL)
- `styles.css` look and feel
- `data.js` stores, products with shelf life, deals, recipes, demo scans
- `app.js` fridge, scanning, meal ranking and learning, shop and routing, impact, AI chat
- `worker/` Cloudflare Worker that calls Claude with the API key kept secret
