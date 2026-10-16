# SNARE trip planner prototype

Clickable prototype for Team SNARE's Venturing Field Project. Enter a grocery list, starting
point, travel mode, distance, store limit and budget, and it plans the cheapest, quickest and a
balanced trip, with smart swaps, rescue deals and nearby food help.

All prices, deals and listings are demo data in `data.js`. To use real data later, replace the
arrays in that file and keep the same fields.

## Run it locally

Open `index.html` in a browser. An internet connection is needed for the map and font.

## Demo links

- `index.html#busy` Busy weeknight shopper (car, Masonville)
- `index.html#tight` Stretching the budget (transit, Old East Village, over budget)
- `index.html#eco` Waste less shopper (walking, Downtown)

## Put it online for free

**Netlify (easiest):** sign up at netlify.com, go to app.netlify.com/drop and drag this whole
folder onto the page. You get a link like `something.netlify.app` to share. Drag the folder
again to update it.

**GitHub Pages:** push this folder to a public GitHub repo, then Settings, Pages, deploy from
the `main` branch root. The site appears at `username.github.io/repo-name`.

## Files

- `index.html` page shell
- `styles.css` look and feel (Poppins, forest and lime palette)
- `data.js` demo stores, products, deals, rescue offers and food support listings
- `app.js` planner logic and screens
