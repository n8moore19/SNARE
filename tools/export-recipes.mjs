// Exports the app's real recipes from data.js to agents/recipes.json so the
// Content creation agent (in the Cloudflare worker) can read them.
// Run after changing recipes: node tools/export-recipes.mjs
// Prices are left out on purpose: the app's catalog prices are demo numbers.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL('../data.js', import.meta.url), 'utf8'), sandbox);
const D = sandbox.window.SNARE_DATA;
const products = Object.fromEntries(D.products.map(p => [p.id, p]));

const recipes = D.recipes.map(r => {
  const req = r.ingredients.filter(i => !i.opt);
  return {
    id: r.id, name: r.name, minutes: r.time, serves: r.serves, meal: r.meal,
    ingredients: r.ingredients.map(i => ({ name: products[i.id].name, amount: i.amt, optional: !!i.opt })),
    steps: r.steps,
    usesUp: [...new Set(req.filter(i => products[i.id].life <= 7).map(i => products[i.id].name))],
  };
});
writeFileSync(new URL('../agents/recipes.json', import.meta.url), JSON.stringify({ recipes }, null, 1) + '\n');
console.log(`Exported ${recipes.length} recipes`);
