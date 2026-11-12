# SNARE: digital fridge prototype

Clickable prototype for Team SNARE's Venturing Field Project (Ivey). A digital fridge for
students: scan a shelf or single items, see what expires first, get meals ranked around it,
add only the missing items to a list, and plan the cheapest trip to buy them.

Business model shown in the prototype: the app is free. Students snap receipts and do a
30 second weekly check in, earning points (100 points = $1) that cash out as grocery gift
cards or renew premium ($20 a year, free trial until Dec 31). Students who opt in to
anonymous sharing feed a household food waste panel that brands, grocers and cities pay
for. `insights.html` shows what a buyer would see (illustrative data).

All prices, deals, recipes and scan results are demo data in `data.js`. The Ask AI chat
uses a built in assistant (`aiReply()` in `app.js`) that understands follow-ups and can
edit the fridge and list, plan a week and plan trips. To switch on live Claude, deploy the
worker in `worker/` (see `worker/README.md`) and put its URL in `config.js`.

## Demo links

- `#welcome` start fresh at onboarding
- `#demo` load a sample fridge
- `#demo` also loads sample points (430) and history, so one demo receipt passes the $5 cash out
- `#meals`, `#shop`, `#impact`, `#rewards` open those tabs
- `insights.html` the buyer view
- `org.html` the Agentic Launch Organization: ten mostly autonomous agents, three human gates, data routing to buyers, and monthly cost estimates at launch, growth and scale

## Files

- `index.html` page shell (phone mockup, AI panel)
- `config.js` live AI switch (worker URL)
- `styles.css` look and feel
- `data.js` stores, products with shelf life, deals, recipes, demo scans
- `app.js` fridge, scanning, meal ranking and learning, shop and routing, impact, AI chat
- `worker/` Cloudflare Worker that calls Claude with the API key kept secret
