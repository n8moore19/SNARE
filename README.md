# SNARE: digital fridge prototype

Clickable prototype for Team SNARE's Venturing Field Project (Ivey). A digital fridge for
students: scan a shelf or single items, see what expires first, get meals ranked around it,
add only the missing items to a list, and plan the cheapest trip to buy them.

All prices, deals, recipes, scan results and AI answers are demo data in `data.js` and
`app.js`. The AI is simulated; `aiReply()` in `app.js` is where a real model would plug in.

## Demo links

- `#welcome` start fresh at onboarding
- `#demo` load a sample fridge
- `#meals`, `#shop`, `#impact` open those tabs

## Files

- `index.html` page shell (phone mockup, AI panel)
- `styles.css` look and feel
- `data.js` stores, products with shelf life, deals, recipes, demo scans
- `app.js` fridge, scanning, meal ranking and learning, shop and routing, impact, AI chat
