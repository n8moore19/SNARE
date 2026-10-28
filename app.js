(function () {
  'use strict';

  const D = window.SNARE_DATA;
  const app = document.getElementById('app');
  const backBtn = document.getElementById('back');
  const viewport = document.getElementById('viewport');
  const aiBox = document.getElementById('ai');
  const aiFab = document.getElementById('ai-fab');

  const byId = list => Object.fromEntries(list.map(x => [x.id, x]));
  const products = byId(D.products);
  const stores = byId(D.stores);
  const rescues = byId(D.rescue);
  const areas = byId(D.areas);
  const recipes = byId(D.recipes);

  // Travel assumptions. kmh is average door to door speed; perStop covers
  // parking, perLeg covers waiting for a bus.
  const MODES = {
    car: { label: 'Car', kmh: 35, perStop: 4, perLeg: 0, co2: 0.17 },
    transit: { label: 'Transit', kmh: 18, perStop: 0, perLeg: 9, co2: 0.05 },
    walk: { label: 'Walk', kmh: 4.8, perStop: 0, perLeg: 0, co2: 0 },
  };
  const ROAD_FACTOR = 1.35;    // straight line distance to rough road distance
  const TIME_VALUE = 15;       // dollars per hour, used to pick the balanced option
  const MIN_SWAP_SAVING = 0.25;
  const SLIDER_MAX = 30;       // km; the slider is a quick picker, the box takes any distance
  const MIN_RADIUS = 0.1;      // km
  const LOADING_MS = 2900;     // "finding your trip" animation
  const SHELF_SCAN_MS = 3200;  // "scanning your fridge" animation
  const ITEM_SCAN_MS = 1700;
  const EXACT_ROUTE_LIMIT = 7; // above this many stops, use a quick nearest stop route
  const DAY = 864e5;
  const USE_SOON = 3;          // days left at or below this counts as expiring
  const KG_PER_ITEM = 0.3;     // rough weight of a rescued item, for the impact estimate
  const CO2_PER_KG = 2.5;      // rough kg CO2e avoided per kg of food not wasted (estimate)

  const DIETS = [['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['halal', 'Halal'], ['gluten', 'Gluten free'], ['dairy', 'Dairy free']];
  const BUDGETS = [30, 50, 75, 100];
  const QUICK = ['eggs', 'milk', 'spinach', 'chicken_thighs', 'ground_beef', 'tomatoes', 'cheddar', 'bread'];

  // ---------- saved state (this browser only) ----------

  const STORE_KEY = 'snare.v2';
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        profile: state.profile, fridge: state.fridge, ratings: state.ratings, feedback: state.feedback,
        cooked: state.cooked, trips: state.trips, tossed: state.tossed,
        learn: state.learn, tossLog: state.tossLog, views: state.views,
      }));
    } catch (e) { /* storage blocked, keep working in memory */ }
  }
  const saved = loadSaved();
  const defaultProfile = () => ({ done: false, diet: [], budget: 50, area: 'campus', mode: 'walk', radius: 5, maxStores: 2, dislikes: [], house: false });

  const state = {
    screen: 'welcome',
    profile: { ...defaultProfile(), ...(saved.profile || {}) },
    fridge: saved.fridge || [],        // { uid, id, qty, exp, owner, added }
    ratings: saved.ratings || {},      // recipe id: 1 or -1
    feedback: saved.feedback || {},    // recipe id: reason chip
    cooked: saved.cooked || [],        // meals cooked from the fridge
    trips: saved.trips || [],
    tossed: saved.tossed || 0,
    learn: saved.learn || {},          // product id: days longer (+) or shorter (-) it lasts for this user
    tossLog: saved.tossLog || {},      // product id: times thrown out
    views: saved.views || {},          // recipe id: times opened
    openItem: null,
    nudgeDismissed: [],
    // This visit only
    items: [],                         // shopping list: { id, qty, why }
    rescueAdded: [],
    selected: null,
    loggedTrip: false,
    query: '',
    fridgeFilter: 'all',
    mealFilter: 'all',
    recipeId: null,
    justCooked: null,
    highlight: [],
    scan: null,                        // { mode, photo, found, item }
    itemScanIdx: 0,
    aiOpen: false,
    aiMsgs: [],
    aiTyping: false,
    myLocation: null,
  };
  const P = () => state.profile;
  // Fridge items saved by the first digital fridge version had a single date.
  state.fridge.forEach(f => { if (f.expLo == null) { f.expLo = f.expHi = f.exp; f.src = f.src || 'estimate'; } });
  let map = null;
  let result = null;
  let fresh = false; // true right after the loading animation, so results animate in

  // ---------- helpers ----------

  const money = n => '$' + n.toFixed(2);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
  const listText = arr => arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function km(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const roadKm = (a, b) => km(a, b) * ROAD_FACTOR;

  function combos(arr, k) {
    if (k === 0) return [[]];
    const out = [];
    arr.forEach((x, i) => combos(arr.slice(i + 1), k - 1).forEach(c => out.push([x, ...c])));
    return out;
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [x, ...p]));
  }

  function home() {
    if (P().area === 'me' && state.myLocation) return { name: 'Your location', ...state.myLocation };
    return areas[P().area] || areas.campus;
  }

  // Price of a product at a store this week, or null if the store doesn't stock it.
  function priceAt(storeId, productId) {
    const s = stores[storeId], p = products[productId];
    if (p.leftover || (s.carries && !s.carries.includes(p.cat))) return null;
    const deal = D.deals.find(d => d.store === storeId && d.product === productId);
    if (deal) return { price: deal.price, deal: true };
    const variance = (hash(storeId + ':' + productId) % 15 - 7) / 100;
    const raw = p.base * s.factor * (1 + variance);
    return { price: Math.max(0.49, Math.round(raw * 10) / 10 - 0.01), deal: false };
  }

  const nearbyStores = () => D.stores.filter(s => km(home(), s) <= P().radius);

  // Cheapest price for a product in range (or anywhere, if nothing is in range).
  function bestNearby(productId) {
    const pool = nearbyStores().length ? nearbyStores() : D.stores;
    let best = null;
    for (const s of pool) {
      const p = priceAt(s.id, productId);
      if (p && (!best || p.price < best.price)) best = { ...p, store: s.id };
    }
    return best;
  }

  // Shortest loop from home through every stop and back.
  function bestOrder(start, stops) {
    if (stops.length > EXACT_ROUTE_LIMIT) return nearestOrder(start, stops);
    let best = null;
    for (const order of permutations(stops)) {
      let dist = 0, prev = start;
      for (const s of order) { dist += roadKm(prev, s); prev = s; }
      dist += roadKm(prev, start);
      if (!best || dist < best.km) best = { order, km: dist };
    }
    return best;
  }

  function nearestOrder(start, stops) {
    const left = [...stops], order = [];
    let prev = start, dist = 0;
    while (left.length) {
      left.sort((a, b) => roadKm(prev, a) - roadKm(prev, b));
      const next = left.shift();
      dist += roadKm(prev, next);
      order.push(next);
      prev = next;
    }
    return { order, km: dist + roadKm(prev, start) };
  }

  const storeLimitText = () => P().maxStores ? 'up to ' + plural(P().maxStores, 'store') : 'any number of stores';

  // ---------- trip planner ----------

  function plan() {
    const start = home();
    const nearby = nearbyStores();
    const items = state.items;
    const coverable = items.filter(it => nearby.some(s => priceAt(s.id, it.id)));
    const missing = items.filter(it => !coverable.includes(it));
    const mode = MODES[P().mode];
    const totalQty = coverable.reduce((n, it) => n + it.qty, 0);

    const plans = [];
    const limit = P().maxStores ? Math.min(P().maxStores, nearby.length) : nearby.length;
    for (let k = 1; k <= limit; k++) {
      for (const subset of combos(nearby, k)) {
        const assign = {};
        let cost = 0, ok = true;
        for (const it of coverable) {
          let best = null;
          for (const s of subset) {
            const p = priceAt(s.id, it.id);
            if (p && (!best || p.price < best.price)) best = { ...p, store: s.id };
          }
          if (!best) { ok = false; break; }
          (assign[best.store] = assign[best.store] || []).push({ id: it.id, qty: it.qty, price: best.price, deal: best.deal });
          cost += best.price * it.qty;
        }
        // Skip sets with an unused store; the smaller set already covers that plan.
        if (!ok || Object.keys(assign).length < k) continue;

        const stops = subset.map(s => ({ kind: 'store', ...s }));
        const route = bestOrder(start, stops);
        const travel = route.km / mode.kmh * 60 + mode.perStop * stops.length + mode.perLeg * (stops.length + 1);
        const shopping = k * 8 + totalQty * 0.6;
        plans.push({
          key: subset.map(s => s.id).sort().join('+'),
          storeCount: k,
          assign,
          cost: Math.round(cost * 100) / 100,
          km: route.km,
          order: route.order,
          travelMin: Math.round(travel),
          minutes: Math.round(travel + shopping),
          co2: route.km * mode.co2,
        });
      }
    }

    const options = [];
    if (plans.length) {
      const cheapest = [...plans].sort((a, b) => a.cost - b.cost || a.minutes - b.minutes)[0];
      const quickest = [...plans].sort((a, b) => a.minutes - b.minutes || a.cost - b.cost)[0];
      const score = p => p.cost + p.minutes / 60 * TIME_VALUE;
      const balanced = [...plans]
        .sort((a, b) => score(a) - score(b))
        .find(p => p.key !== cheapest.key && p.key !== quickest.key && p.cost < quickest.cost && p.minutes < cheapest.minutes);

      if (cheapest.key === quickest.key) {
        options.push({ id: 'cheapest', label: 'Best pick', plan: cheapest });
        if (balanced) options.push({ id: 'balanced', label: 'Balanced', plan: balanced });
      } else {
        options.push({ id: 'cheapest', label: 'Cheapest', plan: cheapest });
        if (balanced) options.push({ id: 'balanced', label: 'Balanced', plan: balanced });
        options.push({ id: 'quickest', label: 'Quickest', plan: quickest });
      }
    }
    return { start, nearby, missing, options };
  }

  // Cheaper products that do the same job, priced at the store the item is already coming from.
  function swapsFor(p) {
    const out = [];
    for (const [storeId, lines] of Object.entries(p.assign)) {
      for (const line of lines) {
        const alt = products[line.id].swap;
        if (!alt || state.items.some(it => it.id === alt)) continue;
        const altPrice = priceAt(storeId, alt);
        if (!altPrice) continue;
        const saving = (line.price - altPrice.price) * line.qty;
        if (saving >= MIN_SWAP_SAVING) out.push({ from: line.id, to: alt, store: storeId, saving });
      }
    }
    return out.sort((a, b) => b.saving - a.saving);
  }

  const routeRescue = p => state.rescueAdded.map(id => rescues[id]).filter(x => p.order.some(s => s.id === x.store));

  // ---------- fridge ----------

  const newUid = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const daysUntil = t => Math.ceil((t - Date.now()) / DAY);
  const daysLeft = f => daysUntil(f.expLo);   // earliest it might go off
  const daysHi = f => daysUntil(f.expHi);     // latest it should last
  const itemName = f => f.label || products[f.id].name;
  const fmtDate = t => new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const learnAdj = id => Math.round(state.learn[id] || 0);

  // Estimates are a range: food can go off from about three quarters of its
  // usual life. Dates read off a label are exact.
  const estimateRange = (days, exact) => exact ? [days, days] : [Math.floor(days * 0.75), days];

  function setRange(f, days, exact) {
    const [lo, hi] = estimateRange(days, exact);
    const now = Date.now();
    f.expLo = now + lo * DAY - 3600e3;
    f.expHi = now + hi * DAY - 3600e3;
  }

  function addToFridge(id, opts = {}) {
    const p = products[id];
    const exact = !!opts.label;
    let days = opts.days ?? p.life;
    if (opts.opened && p.open && !exact) days = Math.min(days, p.open);
    if (!exact && learnAdj(id)) days = Math.max(1, days + learnAdj(id)); // what we learned from this user
    const item = {
      uid: newUid(), id,
      label: opts.labelText || null,
      qty: opts.qty || p.unit,
      src: opts.src || (exact ? 'label' : 'estimate'),
      opened: !!opts.opened,
      frozen: false,
      owner: opts.owner || 'You',
      added: Date.now(),
    };
    setRange(item, days, exact);
    state.fridge.push(item);
    return item;
  }

  // Everything the meal planner can use. Roommates' food counts, with a note to ask.
  const fridgeAll = () => state.fridge.filter(f => P().house || f.owner === 'You');

  function urgency(d) {
    if (d <= 1) return 'urgent';
    if (d <= USE_SOON) return 'soon';
    return 'fine';
  }

  function dayWord(d) {
    if (d <= 0) return 'at the end of its usual window';
    if (d === 1) return 'expires tomorrow';
    return `expires in ${d} days`;
  }
  const dayBadge = d => d <= 0 ? 'Check it' : d === 1 ? '1 day' : d > 60 ? `${Math.round(d / 30)} months` : d > 21 ? `${Math.round(d / 7)} weeks` : `${d} days`;

  function rangeText(f) {
    if (f.frozen) return 'Frozen';
    const lo = daysLeft(f), hi = daysHi(f);
    if (hi <= 0) return 'Check it';
    if (lo === hi || hi > 21) return dayBadge(hi);
    if (lo <= 0) return `Up to ${hi} ${hi === 1 ? 'day' : 'days'}`;
    return `${lo} to ${hi} days`;
  }
  const rangeFromDays = (d, exact) => { const [lo, hi] = estimateRange(d, exact); return lo === hi || hi > 21 ? dayBadge(hi) : lo <= 0 ? `Up to ${hi} ${hi === 1 ? 'day' : 'days'}` : `${lo} to ${hi} days`; };

  const expiringItems = () => fridgeAll().filter(f => !f.frozen && daysLeft(f) <= USE_SOON).sort((a, b) => a.expLo - b.expLo);

  function sourceText(f) {
    const p = products[f.id];
    switch (f.src) {
      case 'label': return `Date read from the label: ${fmtDate(f.expHi)}.`;
      case 'opened': return `Marked opened. Opened ${lower(p.name)} usually keeps about ${p.open} days.`;
      case 'frozen': return `In the freezer since ${fmtDate(f.frozenAt || Date.now())}. Keeps about ${Math.round(p.freeze / 30)} months frozen.`;
      case 'thawed': return 'Thawed. Use it within about 2 days.';
      case 'trip': return `Bought ${fmtDate(f.added)} on your SNARE trip, so we know exactly how old it is.`;
      case 'leftover': return `Cooked ${fmtDate(f.added)}. Leftovers keep 3 to 4 days in the fridge (Health Canada).`;
      case 'checked': return `You checked it on ${fmtDate(f.checkedAt || Date.now())}.`;
      default: return `Estimated from typical fridge storage for ${lower(p.name)} (USDA FoodKeeper).`;
    }
  }

  // ---------- expiry actions and learning ----------

  function markOpened(f) {
    const p = products[f.id];
    f.opened = true;
    if (p.open && daysHi(f) > p.open) { setRange(f, p.open, false); f.src = 'opened'; }
  }

  function freezeItem(f) {
    f.frozen = true;
    f.frozenAt = Date.now();
    setRange(f, products[f.id].freeze, false);
    f.src = 'frozen';
  }

  function thawItem(f) {
    f.frozen = false;
    setRange(f, 2, false);
    f.src = 'thawed';
  }

  function setLabelDate(f, iso) {
    const t = new Date(iso + 'T12:00').getTime();
    if (!t) return;
    f.expLo = f.expHi = t;
    f.frozen = false;
    f.src = 'label';
  }

  // Blend each real outcome into how long this food lasts for this user.
  function learnFrom(id, deltaDays) {
    const p = products[id];
    const cur = state.learn[id];
    const d = Math.max(-2, Math.min(2, deltaDays)); // one event moves the estimate at most 2 days
    const next = cur == null ? d : cur * 0.5 + d * 0.5;
    state.learn[id] = Math.max(-(p.life - 1), Math.min(p.life, next));
  }

  function stillGood(f) {
    learnFrom(f.id, 1);
    f.expLo = Date.now() + DAY;
    f.expHi = Math.max(f.expHi, Date.now() + 2 * DAY);
    f.src = 'checked';
    f.checkedAt = Date.now();
  }

  function tossItem(f) {
    // Thrown out before the early end of its window means it goes off sooner for this user.
    const early = daysLeft(f);
    if (!f.frozen && f.src !== 'label') learnFrom(f.id, early > 0 ? -early : -0.5);
    state.tossLog[f.id] = (state.tossLog[f.id] || 0) + 1;
    state.tossed++;
    state.fridge = state.fridge.filter(x => x.uid !== f.uid);
  }

  function toggleHouse(on) {
    P().house = on;
    if (on) {
      for (const h of D.houseItems) {
        if (!state.fridge.some(f => f.id === h.id && f.owner === h.owner)) addToFridge(h.id, h);
      }
    } else {
      state.fridge = state.fridge.filter(f => f.owner === 'You');
    }
    persist();
  }

  // ---------- meals: ranking and learning ----------

  function dietOk(r) {
    const req = r.ingredients.filter(i => !i.opt);
    const flags = new Set(req.flatMap(i => products[i.id].flags || []));
    const diet = P().diet;
    if (diet.includes('vegan') && ['meat', 'fish', 'dairy', 'egg'].some(f => flags.has(f))) return false;
    if (diet.includes('vegetarian') && (flags.has('meat') || flags.has('fish'))) return false;
    if (diet.includes('gluten') && flags.has('gluten')) return false;
    if (diet.includes('dairy') && flags.has('dairy')) return false;
    if (P().dislikes.some(id => req.some(i => i.id === id || (i.alt || []).includes(id)))) return false;
    return true;
  }

  function fridgeMatch(ing) {
    const ids = [ing.id, ...(ing.alt || [])];
    return fridgeAll().filter(f => ids.includes(f.id)).sort((a, b) => a.expLo - b.expLo)[0] || null;
  }

  const sharedIngredients = (a, b) => a.ingredients.filter(i => !i.opt && b.ingredients.some(j => !j.opt && j.id === i.id)).length;

  // Score = uses expiring food + uses what you have + cheap to finish + what
  // you and other students liked. This is the "learning" the demo shows.
  function analyse(r) {
    const have = [], need = [], opt = [];
    for (const ing of r.ingredients) {
      const f = fridgeMatch(ing);
      if (f) have.push({ ing, f, days: daysLeft(f) });
      else if (ing.opt) opt.push({ ing });
      else {
        // Leftovers can't be bought, so shop for the plain version instead.
        const buyId = products[ing.id].leftover ? (ing.alt || []).find(a => !products[a].leftover) : ing.id;
        need.push({ ing: { ...ing, id: buyId }, best: bestNearby(buyId) });
      }
    }
    const expiring = have.filter(h => h.days <= USE_SOON).sort((a, b) => a.days - b.days);
    const needCost = need.reduce((t, n) => t + (n.best ? n.best.price : products[n.ing.id].base), 0);
    const onSale = need.filter(n => n.best && n.best.deal);
    const rating = state.ratings[r.id] || 0;
    const likedSimilar = Object.keys(state.ratings)
      .filter(id => state.ratings[id] > 0 && id !== r.id)
      .map(id => recipes[id])
      .find(l => sharedIngredients(l, r) >= 2);
    let score = expiring.reduce((t, h) => t + (h.days <= 1 ? 16 : 11), 0) + have.length * 4 - need.length * 3 + onSale.length * 2 + r.pop / 20;
    if (rating > 0) score += 10;
    if (rating < 0) score -= 40;
    if (likedSimilar) score += 7;
    // Opened often but never cooked or rated: quietly rank it lower.
    score -= Math.min(9, skippedCount(r.id) * 3);
    return { r, have, need, opt, expiring, needCost, perServing: needCost / r.serves, onSale, rating, likedSimilar, score };
  }

  const skippedCount = rid => state.ratings[rid] || state.cooked.some(c => c.rid === rid) ? 0 : Math.max(0, (state.views[rid] || 0) - 2);

  function rankedMeals(filter = state.mealFilter) {
    return D.recipes.filter(dietOk).map(analyse)
      .filter(a => filter === 'ready' ? a.need.length === 0 : filter === 'cheap' ? a.perServing <= 3 : true)
      .sort((a, b) => b.score - a.score);
  }

  function reasons(a) {
    const out = [];
    if (a.expiring.length) {
      const [first, second] = a.expiring;
      out.push(`Uses your ${lower(itemName(first.f))} (${dayWord(first.days)})${second ? ` and ${lower(itemName(second.f))}` : ''}`);
    } else if (a.have.length) {
      out.push(`Uses ${plural(a.have.length, 'thing')} you have`);
    }
    if (a.onSale.length) {
      const s = a.onSale[0];
      out.push(`${products[s.ing.id].name} on sale at ${stores[s.best.store].name} (${money(s.best.price)})`);
    }
    if (a.rating > 0) out.push('You liked this');
    else if (a.likedSimilar) out.push(`Because you liked ${a.likedSimilar.name}`);
    return out;
  }

  const roommateNote = a => {
    const theirs = [...new Set(a.have.filter(h => !['You', 'Shared'].includes(h.f.owner)).map(h => h.f.owner))];
    return theirs.length ? `Uses ${listText(theirs)}'s food, ask first` : '';
  };

  function addMissing(rid) {
    const a = analyse(recipes[rid]);
    let n = 0;
    for (const m of a.need) {
      if (!state.items.some(it => it.id === m.ing.id)) {
        state.items.push({ id: m.ing.id, qty: 1, why: a.r.name });
        n++;
      }
    }
    toast(n ? `${plural(n, 'item')} added to your Shop list` : 'Those items are already on your list');
    return n;
  }

  function cook(rid) {
    const a = analyse(recipes[rid]);
    const rescued = a.expiring.length;
    const value = a.expiring.reduce((t, h) => t + products[h.f.id].base * 0.5, 0);
    // Perishables get used up; long life items (cheese, eggs, rice) stay.
    const used = a.have.filter(h => products[h.f.id].life <= 10).map(h => h.f.uid);
    state.fridge = state.fridge.filter(f => !used.includes(f.uid));
    state.cooked.push({ rid, date: Date.now(), rescued, value, kg: rescued * KG_PER_ITEM });
    if (a.r.serves >= 2) addToFridge('leftovers', { labelText: `Leftover ${a.r.name}`, days: 4, src: 'leftover', qty: `${a.r.serves - 1} servings` });
    state.justCooked = rid;
    persist();
  }

  // ---------- impact ----------

  function tripRecord(p) {
    const lines = Object.values(p.assign).flat();
    const regular = lines.reduce((t, l) => t + products[l.id].base * l.qty, 0);
    const rescued = routeRescue(p);
    return {
      date: Date.now(),
      mode: P().mode,
      stores: p.storeCount,
      spent: p.cost + rescued.reduce((t, r) => t + r.price, 0),
      saved: Math.max(0, regular - p.cost) + rescued.reduce((t, r) => t + r.was - r.price, 0),
      kg: rescued.reduce((t, r) => t + r.kg, 0),
      km: p.km,
    };
  }

  function sampleHistory() {
    const now = Date.now();
    const meals = [['burritobowl', 26, 2, 3.4], ['friedrice', 24, 2, 1.8], ['omelette', 20, 1, 2.2], ['tomatopasta', 17, 1, 2.0],
      ['quesadilla', 15, 2, 1.9], ['beefchili', 12, 2, 4.1], ['stirfry', 9, 3, 3.6], ['pancakes', 6, 1, 0.9], ['friedrice', 3, 2, 1.8], ['tacos', 1, 2, 3.2]];
    state.cooked = meals.map(([rid, ago, rescued, value]) => ({ rid, date: now - ago * DAY, rescued, value, kg: rescued * KG_PER_ITEM }));
    state.trips = [[22, 14.2, 0.9], [13, 11.6, 0], [5, 9.8, 1.4]].map(([ago, s, kg]) => ({ date: now - ago * DAY, mode: 'walk', stores: 2, spent: 38, saved: s, kg, km: 4 }));
    state.tossed = 3;
  }

  // Consecutive weeks (ending this week) with at least one meal cooked from the fridge.
  function weekStreak() {
    const weeks = new Set(state.cooked.map(c => Math.floor((Date.now() - c.date) / (7 * DAY))));
    let n = 0;
    while (weeks.has(n)) n++;
    return n;
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- rendering basics ----------

  const ICONS = {
    wallet: '<svg viewBox="0 0 24 24"><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4z"/><path d="M4 7V6a2 2 0 0 1 2-2h10"/><circle cx="16" cy="13.5" r="1.2"/></svg>',
    scale: '<svg viewBox="0 0 24 24"><path d="M12 4v16M7 20h10M5 8h14"/><path d="M5 8l-2.5 6a2.5 2.5 0 0 0 5 0zM19 8l-2.5 6a2.5 2.5 0 0 0 5 0z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z"/></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    shrink: '<svg viewBox="0 0 24 24"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/></svg>',
    pinOut: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l7-7"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    fridge: '<svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M5 10h14M8.5 6v1.5M8.5 13v3"/></svg>',
    pot: '<svg viewBox="0 0 24 24"><path d="M4 10h16v4a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/><path d="M2 10h20M9 6.5c0-1 1-1.5 1-2.5M14 6.5c0-1 1-1.5 1-2.5"/></svg>',
    cart: '<svg viewBox="0 0 24 24"><path d="M3 4h2.5l2.2 11h10.6l2-8H6.6"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M7 13V4H4v9zM7 13l4 7c1.5 0 2.5-1 2.5-2.5V15h5a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 17.3 4H7"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    house: '<svg viewBox="0 0 24 24"><path d="M3.5 11L12 4l8.5 7M6 9.5V20h12V9.5"/></svg>',
    snow: '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/></svg>',
  };

  function band(eyebrow, title, sub = '', extra = '') {
    return `<header class="band">
      ${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}
      <h1>${title}</h1>
      ${sub ? `<p>${sub}</p>` : ''}
      ${extra}
    </header>`;
  }

  function fmtCount(v, fmt) {
    if (fmt === 'money') return money(v);
    if (fmt === 'km') return v.toFixed(1) + ' km';
    if (fmt === 'kg') return v.toFixed(1) + ' kg';
    if (fmt === 'min') return Math.round(v) + ' min';
    return Math.round(v).toLocaleString('en-CA');
  }

  // Numbers marked with data-count tick up from zero to their value.
  function countUp(root, dur = 900) {
    root.querySelectorAll('[data-count]').forEach(el => {
      const end = Number(el.dataset.count), fmt = el.dataset.fmt, t0 = performance.now();
      (function tick(now) {
        const k = Math.min(1, Math.max(0, (now - t0) / dur));
        el.textContent = fmtCount(end * (1 - Math.pow(1 - k, 3)), fmt);
        if (k < 1) requestAnimationFrame(tick);
      })(t0);
      setTimeout(() => { el.textContent = fmtCount(end, fmt); }, dur + 150); // in case frames are paused
    });
  }
  const counted = (v, fmt) => `<span data-count="${v}" data-fmt="${fmt}">${fmtCount(v, fmt)}</span>`;

  const TAB_OF = { fridge: 'fridge', scan: 'fridge', scanning: 'fridge', review: 'fridge', meals: 'meals', recipe: 'meals', shop: 'shop', loading: 'shop', results: 'shop', impact: 'impact', profile: 'fridge' };
  const NO_CHROME = ['welcome', 'scanning', 'loading'];

  function render() {
    if (map) { map.remove(); map = null; }
    backBtn.hidden = !['scan', 'review', 'recipe', 'results', 'profile'].includes(state.screen);
    const r = {
      welcome: renderWelcome, fridge: renderFridge, scan: renderScan, scanning: renderScanning, review: renderReview,
      meals: renderMeals, recipe: renderRecipe, shop: renderShop, loading: renderLoading, results: renderResults,
      impact: renderImpact, profile: renderProfile,
    }[state.screen];
    r();
    renderTabs();
    aiFab.hidden = NO_CHROME.includes(state.screen);
    aiFab.classList.toggle('lift', ['shop', 'review'].includes(state.screen)); // clear the sticky button
    document.getElementById('tabs').hidden = state.screen === 'welcome';
  }

  function renderTabs() {
    const current = TAB_OF[state.screen];
    const urgent = expiringItems().length;
    const listN = state.items.length;
    document.getElementById('tabs').innerHTML = [
      ['fridge', 'Fridge', ICONS.fridge, urgent],
      ['meals', 'Meals', ICONS.pot, 0],
      ['shop', 'Shop', ICONS.cart, listN],
      ['impact', 'Impact', ICONS.leaf, 0],
    ].map(([id, label, icon, n]) => `<button class="${current === id ? 'on' : ''}" data-tab="${id}">${icon}<span>${label}</span>${n ? `<i>${n}</i>` : ''}</button>`).join('');
  }

  // ---------- welcome ----------

  function chipsHtml(action, opts, isOn) {
    return `<div class="quick">${opts.map(([v, label]) => `<button class="chip ${isOn(v) ? 'on' : ''}" data-action="${action}" data-id="${v}">${label}</button>`).join('')}</div>`;
  }

  const areaSelect = id => `<select id="${id}" class="field">${D.areas.map(a => `<option value="${a.id}" ${P().area === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}${state.myLocation ? `<option value="me" ${P().area === 'me' ? 'selected' : ''}>My location</option>` : ''}</select>`;
  const modeSeg = () => `<div class="seg">${Object.entries(MODES).map(([v, m]) => `<button data-action="mode" data-id="${v}" class="${P().mode === v ? 'on' : ''}">${m.label}</button>`).join('')}</div>`;

  function renderWelcome() {
    app.innerHTML = `
      <section class="screen welcome">
        <header class="band hero">
          <span class="eyebrow">For students, by students</span>
          <h1>Cook what you have. Waste less.</h1>
          <p>Scan your fridge. SNARE plans meals around what expires first and fills the gaps with what's on sale near you.</p>
          ${fridgeArt()}
        </header>
        <div class="card">
          <h2>Any food needs? <small>Pick any</small></h2>
          ${chipsHtml('diet', DIETS, v => P().diet.includes(v))}
        </div>
        <div class="card">
          <h2>Weekly food budget</h2>
          ${chipsHtml('budget', BUDGETS.map(b => [b, '$' + b]), v => P().budget === Number(v))}
        </div>
        <div class="card">
          <h2>Where do you live?</h2>
          ${areaSelect('area')}
          <div style="margin-top:10px">${modeSeg()}</div>
        </div>
        <div class="sticky">
          <button class="btn block" data-action="finishwelcome" data-id="scan">${ICONS.camera}Scan my fridge</button>
          <button class="link block-link" data-action="finishwelcome" data-id="fridge">Skip for now</button>
        </div>
      </section>`;
  }

  // Small decorative fridge for the welcome band.
  function fridgeArt() {
    return `<svg class="hero-art" viewBox="0 0 300 90" aria-hidden="true">
      <path d="M24 60 C 74 10, 112 86, 160 44 S 248 16, 276 34" fill="none" stroke="#004230" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>
      <rect x="10" y="38" width="30" height="44" rx="6" fill="#004230"/><path d="M10 54h30M17 44v4M17 59v8" stroke="#A2DC5D" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="160" cy="44" r="14" fill="#fff" stroke="#004230" stroke-width="2.5"/><path d="M152 46h16v3a5 5 0 0 1-5 5h-6a5 5 0 0 1-5-5zM150 46h20" stroke="#004230" stroke-width="2" fill="none" stroke-linecap="round"/>
      <circle cx="276" cy="34" r="14" fill="#1F1E1E"/><path d="M268 29h3l2 9h6l2-6h-11" stroke="#A2DC5D" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  // ---------- fridge ----------

  function fridgeRow(f) {
    const d = daysLeft(f);
    const p = products[f.id];
    const open = state.openItem === f.uid;
    const isNew = state.highlight.includes(f.uid);
    const hint = f.frozen ? 'frozen' : f.src === 'label' ? 'date from label' : f.src === 'opened' ? 'opened' : f.src === 'leftover' ? 'cooked leftovers' : '';
    const adj = learnAdj(f.id);
    return `<li class="frow ${isNew ? 'new' : ''} ${open ? 'open' : ''}">
      <span class="exp ${f.frozen ? 'frozen' : urgency(d)}">${rangeText(f)}</span>
      <button class="frow-main" data-action="openitem" data-id="${f.uid}" aria-expanded="${open}"><strong>${esc(itemName(f))}</strong><span>${esc(f.qty)}${f.owner !== 'You' ? ` · <b class="owner">${f.owner === 'Shared' ? 'Shared' : esc(f.owner) + "'s"}</b>` : ''}${hint ? ` · ${hint}` : ''}</span></button>
      <button class="icon-btn" data-action="used" data-id="${f.uid}" aria-label="Used it" title="Used it">${ICONS.check}</button>
      <button class="icon-btn" data-action="tossed" data-id="${f.uid}" aria-label="Threw it out" title="Threw it out">${ICONS.trash}</button>
    </li>
    ${open ? `<li class="fdetail">
      <p>${sourceText(f)}</p>
      ${adj && !f.frozen && f.src !== 'label' ? `<p class="learned">${ICONS.spark}Adjusted for you: about ${plural(Math.abs(adj), 'day')} ${adj < 0 ? 'shorter' : 'longer'} than usual, based on your past ${lower(p.name)}.</p>` : ''}
      <div class="detail-actions">
        ${p.open && !f.opened && !f.frozen ? `<button class="btn small outline" data-action="iopen" data-id="${f.uid}">Mark opened</button>` : ''}
        ${p.freeze && !f.frozen ? `<button class="btn small outline" data-action="ifreeze" data-id="${f.uid}">${ICONS.snow}Freeze it</button>` : ''}
        ${f.frozen ? `<button class="btn small outline" data-action="ithaw" data-id="${f.uid}">Thaw it</button>` : ''}
        <label class="date-set">Label date<input type="date" class="label-date" data-id="${f.uid}"></label>
      </div>
      ${!f.frozen ? `<div class="detail-check"><span>Is it still good?</span><button class="btn small" data-action="igood" data-id="${f.uid}">Still good</button><button class="btn small outline" data-action="igone" data-id="${f.uid}">Gone off</button></div>` : ''}
    </li>` : ''}`;
  }

  // One prompt at a time: meat that needs cooking or freezing today, or a
  // quick check on something at the early end of its window.
  function checkCard() {
    const due = fridgeAll().filter(f => !f.frozen && daysLeft(f) <= 0 && daysHi(f) >= 0).sort((a, b) => a.expLo - b.expLo);
    const meat = fridgeAll().find(f => !f.frozen && (products[f.id].flags || []).includes('meat') && daysHi(f) <= 1 && products[f.id].freeze);
    if (meat) {
      const top = rankedMeals('all').find(a => a.have.some(h => h.f.uid === meat.uid));
      return `<div class="check-card urgent">
        <span class="eyebrow">Today</span>
        <h3>Cook or freeze your ${lower(itemName(meat))}</h3>
        <p>Raw meat keeps about 1 to 2 days in the fridge. Freezing it now keeps it for months.</p>
        <div class="row">${top ? `<button class="btn small" data-action="recipe" data-id="${top.r.id}">Cook ${top.r.name}</button>` : ''}<button class="btn small outline" data-action="ifreeze" data-id="${meat.uid}">${ICONS.snow}Freeze it</button></div>
      </div>`;
    }
    const f = due[0];
    if (!f) return '';
    return `<div class="check-card">
      <span class="eyebrow">Quick check</span>
      <h3>${esc(itemName(f))}: still good?</h3>
      <p>It's at the early end of its usual window. Your answer makes future estimates more accurate.</p>
      <div class="row"><button class="btn small" data-action="igood" data-id="${f.uid}">Still good</button><button class="btn small outline" data-action="igone" data-id="${f.uid}">Gone off</button></div>
    </div>`;
  }

  // Food this user keeps throwing out.
  function wasteNudge() {
    const id = Object.keys(state.tossLog).find(k => state.tossLog[k] >= 2 && !products[k].leftover && !state.nudgeDismissed.includes(k));
    if (!id) return '';
    const p = products[id];
    const alt = p.swap && products[p.swap];
    return `<div class="nudge">
      ${ICONS.spark}
      <div><strong>You've thrown out ${lower(p.name)} ${state.tossLog[id]} times</strong>
      <span>Next time try ${alt ? `${lower(alt.name)} (keeps about ${Math.round(alt.life / 30)} months) or ` : ''}a smaller pack${p.freeze ? ', or freeze half when you get home' : ''}.</span></div>
      <button class="icon-btn" data-action="nudgeok" data-id="${id}" aria-label="Dismiss">${ICONS.cross}</button>
    </div>`;
  }

  function renderFridge() {
    const all = fridgeAll();
    const shown = all.filter(f => state.fridgeFilter === 'all' ? true : state.fridgeFilter === 'mine' ? f.owner === 'You' : f.owner !== 'You')
      .sort((a, b) => a.expLo - b.expLo);
    const urgent = expiringItems();
    const top = rankedMeals('all')[0];
    const groups = [
      ['Use soon', shown.filter(f => !f.frozen && daysLeft(f) <= USE_SOON)],
      ['This week', shown.filter(f => !f.frozen && daysLeft(f) > USE_SOON && daysLeft(f) <= 7)],
      ['Later', shown.filter(f => !f.frozen && daysLeft(f) > 7)],
      ['Freezer', shown.filter(f => f.frozen)],
    ].filter(([, list]) => list.length);

    const title = all.length ? `${plural(all.length, 'item')} in your fridge` : 'Your fridge is empty';
    const sub = all.length
      ? (urgent.length ? `${plural(urgent.length, 'item')} ${urgent.length === 1 ? 'needs' : 'need'} using in the next ${USE_SOON} days.` : 'Nothing is about to expire. Nice.')
      : 'Scan a shelf, a single item or type what you have.';

    const tonight = top && top.expiring.length ? `
      <div class="tonight">
        <span class="eyebrow">Tonight's pick</span>
        <h3>${top.r.name}</h3>
        <p>${reasons(top)[0]}${top.need.length ? ` · ${plural(top.need.length, 'item')} to buy` : ' · Nothing to buy'}</p>
        <div class="row"><button class="btn small" data-action="recipe" data-id="${top.r.id}">Cook it</button><button class="btn small outline" data-tab="meals">All meals</button></div>
      </div>` : '';

    app.innerHTML = `
      <section class="screen">
        ${band(P().house ? `${ICONS.house} House fridge` : 'Your fridge', title, sub,
          `<div class="band-actions"><button class="btn small" data-action="goscan">${ICONS.camera}Scan</button><button class="btn small outline" data-action="typeitems">${ICONS.plus}Add items</button></div>`)}
        ${checkCard()}
        ${wasteNudge()}
        ${tonight}
        ${P().house ? `<div class="seg fridge-filter">${[['all', 'Everything'], ['mine', 'Mine'], ['house', 'House and roommates']].map(([v, l]) => `<button class="${state.fridgeFilter === v ? 'on' : ''}" data-action="ffilter" data-id="${v}">${l}</button>`).join('')}</div>` : ''}
        ${groups.map(([label, list]) => `
          <h2 class="section-title">${label} <small>${list.length}</small></h2>
          <ul class="fridge-list">${list.map(fridgeRow).join('')}</ul>`).join('')}
        ${!all.length ? `<div class="empty-fridge">${ICONS.fridge}<p>Your fridge is empty. Scan it to get meal ideas built around what you already have.</p><button class="btn" data-action="goscan">${ICONS.camera}Scan my fridge</button></div>` : ''}
        <div class="card house-card">
          <button class="switch-row" data-action="house" aria-pressed="${P().house}">
            <span><strong>${ICONS.house} Shared house fridge</strong><span>${P().house ? `You, ${listText(D.housemates)} share this fridge` : 'Live with roommates? Share one fridge and see whose food is about to go off.'}</span></span>
            <span class="switch ${P().house ? 'on' : ''}"></span>
          </button>
        </div>
        <p class="footnote">Tap an item to mark it opened, freeze it or enter the label date. Estimates use typical storage (USDA FoodKeeper, Health Canada) and learn from your answers. When in doubt, throw it out.</p>
      </section>`;
    state.highlight = [];
  }

  // ---------- scanning ----------

  function renderScan() {
    app.innerHTML = `
      <section class="screen">
        ${band('Add food', 'Scan your fridge', 'Snap a shelf, the whole fridge, or one item at a time. You can keep scanning and it all goes into one fridge.')}
        <div class="scan-options">
          <label class="scan-option">
            <span class="so-icon">${ICONS.fridge}</span>
            <span><strong>Scan a shelf or the whole fridge</strong><span>Finds everything in the photo at once</span></span>
            <input type="file" accept="image/*" capture="environment" id="shelf-photo" hidden>
          </label>
          <label class="scan-option">
            <span class="so-icon">${ICONS.camera}</span>
            <span><strong>Scan one item</strong><span>Point at a single item, confirm, then scan the next</span></span>
            <input type="file" accept="image/*" capture="environment" id="item-photo" hidden>
          </label>
          <button class="scan-option" data-action="typeitems">
            <span class="so-icon">${ICONS.plus}</span>
            <span><strong>Type items instead</strong><span>Search and add what you have</span></span>
          </button>
        </div>
        <h2 class="section-title">No photo handy?</h2>
        <div class="row demo-row">
          <button class="btn outline" data-action="demoshelf">Try a demo fridge</button>
          <button class="btn outline" data-action="demoitem">Try a demo item</button>
        </div>
        <div class="banner info"><strong>Prototype</strong>Detection is simulated with sample results. The real app sends the photo to an AI vision model, keeps only the list of items, and deletes the photo.</div>
      </section>`;
  }

  function startShelfScan(photo) {
    state.scan = { mode: 'shelf', photo, found: D.demoScan.map(x => ({ ...x, keep: true })) };
    go('scanning');
    setTimeout(() => { if (state.screen === 'scanning') go('review'); }, SHELF_SCAN_MS);
  }

  function startItemScan(photo) {
    const guess = D.itemScans[state.itemScanIdx % D.itemScans.length];
    state.itemScanIdx++;
    state.scan = { mode: 'item', photo: photo || 'demo-item:' + guess.id, found: [{ ...guess, keep: true }] };
    go('scanning');
    setTimeout(() => { if (state.screen === 'scanning') go('review'); }, ITEM_SCAN_MS);
  }

  function scanImage() {
    const s = state.scan;
    if (s.photo === 'demo') return demoFridgeSvg();
    if (String(s.photo).startsWith('demo-item:')) return demoItemSvg(s.photo.slice(10));
    return `<img src="${s.photo}" alt="Your photo">`;
  }

  function renderScanning() {
    const s = state.scan;
    const shelf = s.mode === 'shelf';
    const ms = shelf ? SHELF_SCAN_MS : ITEM_SCAN_MS;
    const step = (ms - 600) / s.found.length;
    const boxes = shelf && s.photo === 'demo'
      ? s.found.map((f, i) => `<span class="det-box ${f.box[1] < 8 ? 'below' : ''}" style="left:${f.box[0]}%;top:${f.box[1]}%;width:${f.box[2]}%;height:${f.box[3]}%;animation-delay:${300 + i * step}ms"><em>${products[f.id].name}</em></span>`).join('')
      : '';
    app.innerHTML = `
      <section class="scanning">
        <div class="scan-frame ${shelf ? '' : 'single'}">
          ${scanImage()}
          ${boxes}
          <span class="sweep" style="animation-duration:${shelf ? 1.6 : 1.1}s"></span>
        </div>
        <div class="loading-copy">
          <h1>${shelf ? 'Spotting your food' : 'Identifying this item'}</h1>
          <div class="progress"><span style="animation-duration:${ms}ms"></span></div>
          <div class="found-chips">${s.found.map((f, i) => `<span class="chip on found" style="animation-delay:${300 + i * step}ms">${ICONS.check}${products[f.id].name}</span>`).join('')}</div>
          <p class="hint">Estimating how much is left and how long each item keeps.</p>
        </div>
      </section>`;
  }

  const confLabel = c => c == null ? ['Added by you', 'mine'] : c >= 0.85 ? ['High confidence', 'high'] : c >= 0.7 ? ['Likely', 'mid'] : ['Please check', 'low'];

  function renderReview() {
    const s = state.scan;
    if (s.mode === 'item') return renderItemReview();
    const kept = s.found.filter(f => f.keep);
    const typed = s.mode === 'type';
    app.innerHTML = `
      <section class="screen">
        ${band(typed ? 'Add food' : 'Review', typed ? 'What do you have?' : `We found ${plural(s.found.length, 'item')}`,
          typed ? 'Search and add items. We estimate how long each one keeps.' : 'Check the list, fix anything we got wrong, then add it to your fridge.')}
        ${!typed ? `<div class="review-photo">${scanImage()}</div>` : ''}
        <ul class="review-list">
          ${s.found.map((f, i) => {
            const [cl, cc] = confLabel(f.conf);
            return `<li class="${f.keep ? '' : 'off'}">
              <button class="tick ${f.keep ? 'on' : ''}" data-action="rkeep" data-id="${i}" aria-label="Keep this item">${ICONS.check}</button>
              <div class="rv-main"><strong>${products[f.id].name}</strong><span>${esc(f.qty || products[f.id].unit)} · <b class="conf ${cc}">${cl}</b>${f.label ? ' · <b class="conf high">date from label</b>' : ''}</span></div>
              <div class="days-step"><button data-action="rdays" data-id="${i}" data-d="-1" aria-label="Fewer days">&minus;</button><span class="exp ${urgency(estimateRange(f.days, f.label)[0])}">${rangeFromDays(f.days, f.label)}</span><button data-action="rdays" data-id="${i}" data-d="1" aria-label="More days">+</button></div>
            </li>`;
          }).join('') || '<li class="empty-note">Nothing added yet.</li>'}
        </ul>
        <div class="card">
          <h2>${typed ? 'Add an item' : 'Anything we missed?'}</h2>
          <div class="search"><input id="q" type="text" placeholder="Search, like eggs or spinach" autocomplete="off" value="${esc(state.query)}"><div id="suggest" class="suggest"></div></div>
          <div class="quick">${QUICK.map(id => `<button class="chip" data-action="radd" data-id="${id}">+ ${products[id].name}</button>`).join('')}</div>
        </div>
        <p class="footnote">Expiry dates are estimates. Use the + and − buttons if you know better.</p>
        <div class="sticky">
          <button class="btn block" data-action="rconfirm" ${kept.length ? '' : 'disabled'}>Add ${plural(kept.length, 'item')} to my fridge</button>
          ${!typed ? '<button class="link block-link" data-action="rescan">Scan another shelf</button>' : ''}
        </div>
      </section>`;
    renderSuggest();
  }

  function renderItemReview() {
    const f = state.scan.found[0];
    const p = products[f.id];
    const [cl, cc] = confLabel(f.conf);
    app.innerHTML = `
      <section class="screen">
        ${band('One item', `Is this ${lower(p.name)}?`, 'Confirm it, fix it, or pick the right one below.')}
        <div class="item-result">
          <div class="item-photo">${scanImage()}</div>
          <div class="item-info">
            <strong>${p.name}</strong>
            <span><b class="conf ${cc}">${cl}${f.conf ? ` · ${Math.round(f.conf * 100)}%` : ''}</b></span>
            <span>${esc(f.qty || p.unit)}${f.label ? ' · <b class="conf high">date read from label</b>' : ' · estimated'}</span>
            <div class="days-step"><button data-action="rdays" data-id="0" data-d="-1" aria-label="Fewer days">&minus;</button><span class="exp ${urgency(estimateRange(f.days, f.label)[0])}">${rangeFromDays(f.days, f.label)}</span><button data-action="rdays" data-id="0" data-d="1" aria-label="More days">+</button></div>
          </div>
        </div>
        <div class="card">
          <h2>Not right?</h2>
          <div class="quick">${(f.alts || []).map(id => `<button class="chip" data-action="ifix" data-id="${id}">${products[id].name}</button>`).join('')}</div>
          <div class="search"><input id="q" type="text" placeholder="Or search for it" autocomplete="off" value="${esc(state.query)}"><div id="suggest" class="suggest"></div></div>
        </div>
        <div class="sticky">
          <button class="btn block" data-action="inext">${ICONS.camera}Add and scan the next item</button>
          <button class="link block-link" data-action="idone">Add and finish</button>
        </div>
        <input type="file" accept="image/*" capture="environment" id="next-photo" hidden>
      </section>`;
    renderSuggest();
  }

  function confirmScan() {
    const kept = state.scan.found.filter(f => f.keep);
    const added = kept.map(f => addToFridge(f.id, { qty: f.qty, days: f.days, label: f.label, opened: f.opened, src: f.label ? 'label' : 'estimate' }));
    state.highlight = added.map(a => a.uid);
    persist();
    return added.length;
  }

  // Simple flat illustration standing in for a fridge photo. Item positions
  // match the detection boxes in data.js.
  function demoFridgeSvg() {
    return `<svg viewBox="0 0 300 360" class="demo-fridge" aria-label="Demo fridge photo">
      <defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4F8FA"/><stop offset="1" stop-color="#DCE6EA"/></linearGradient></defs>
      <rect width="300" height="360" fill="url(#fg)"/>
      <g stroke="#B9C8CF" stroke-width="4"><path d="M0 125h300M0 236h300M0 342h300"/></g>
      <rect x="26" y="24" width="60" height="96" rx="4" fill="#fff" stroke="#C9D3D8"/><rect x="26" y="24" width="60" height="24" fill="#2F6FB7"/><text x="56" y="88" text-anchor="middle" font-size="13" font-weight="700" fill="#2F6FB7" font-family="Poppins">MILK</text>
      <rect x="182" y="16" width="92" height="40" rx="7" fill="#E9F1F4" stroke="#A9BBC3"/><g fill="#F7F3E8">${Array.from({ length: 14 }, (_, i) => `<circle cx="${192 + (i % 7) * 12}" cy="${28 + Math.floor(i / 7) * 14}" r="4.5"/>`).join('')}</g>
      <rect x="104" y="68" width="170" height="44" rx="6" fill="#D8C7A4"/>${Array.from({ length: 8 }, (_, i) => `<ellipse cx="${118 + i * 20}" cy="88" rx="8" ry="10" fill="#F4E6CC"/>`).join('')}
      <rect x="28" y="158" width="60" height="42" rx="4" fill="#F2C14E"/><path d="M28 172h60" stroke="#E0A92E" stroke-width="3"/>
      <rect x="102" y="146" width="48" height="62" rx="6" fill="#fff" stroke="#C9D3D8"/><rect x="102" y="164" width="48" height="20" fill="#A2DC5D"/>
      <path d="M160 152h112l-6 54H166z" fill="#5BA35B"/><path d="M175 165c10 8 22 10 36 4M200 190c12-6 26-4 40 4" stroke="#3E7E3E" stroke-width="4" fill="none" stroke-linecap="round"/>
      <rect x="26" y="258" width="118" height="62" rx="8" fill="#F5D2CC" stroke="#E5A99F"/><path d="M40 274c20 10 50 12 88 0v30H40z" fill="#E98C80"/>
      <path d="M186 262c-16 0-24 16-20 32 4 18 14 22 20 22s16-4 20-22c4-16-4-32-20-32z" fill="#D8352A"/><path d="M186 262v-8" stroke="#3E7E3E" stroke-width="4" stroke-linecap="round"/>
      <rect x="218" y="256" width="64" height="64" rx="8" fill="#EFE3C8" stroke="#D9C79E"/><ellipse cx="250" cy="288" rx="24" ry="22" fill="#F7EEDB" stroke="#E2D2AE"/>
    </svg>`;
  }

  function demoItemSvg(id) {
    const p = products[id];
    const color = { meat: '#E98C80', produce: '#D8352A', dairy: '#F2C14E', eggs: '#F4E6CC', frozen: '#9CC6E0', pantry: '#C7A27A', bakery: '#E4C58F', protein: '#EDE6D6' }[p.cat] || '#A2DC5D';
    return `<svg viewBox="0 0 240 240" class="demo-item" aria-label="Demo photo of ${p.name}">
      <rect width="240" height="240" fill="#EEF3EA"/><ellipse cx="120" cy="196" rx="80" ry="12" fill="#D5DECF"/>
      <rect x="54" y="66" width="132" height="120" rx="22" fill="${color}"/><rect x="54" y="66" width="132" height="120" rx="22" fill="none" stroke="#1F1E1E" stroke-opacity="0.12" stroke-width="4"/>
      <text x="120" y="134" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="16" fill="#1F1E1E">${p.name}</text>
    </svg>`;
  }

  // ---------- meals ----------

  function recipeTags(r) {
    const req = r.ingredients.filter(i => !i.opt);
    const flags = new Set(req.flatMap(i => products[i.id].flags || []));
    const tags = [];
    if (!flags.has('meat') && !flags.has('fish')) tags.push(['meat', 'egg', 'dairy', 'fish'].some(f => flags.has(f)) ? 'Vegetarian' : 'Vegan');
    if (!flags.has('gluten')) tags.push('Gluten free');
    if (flags.has('meat') && P().diet.includes('halal')) tags.push('Use halal meat');
    return tags;
  }

  function mealCard(a) {
    const why = reasons(a);
    const rn = roommateNote(a);
    const total = a.have.length + a.need.length;
    return `<article class="meal" data-action="recipe" data-id="${a.r.id}">
      <div class="meal-top">
        <h3>${a.r.name}</h3>
        ${a.expiring.length ? `<span class="exp ${urgency(a.expiring[0].days)}">Uses ${a.expiring.length} expiring</span>` : ''}
      </div>
      ${why.length ? `<p class="why">${why.map(w => `<span>${w}</span>`).join('')}</p>` : ''}
      ${rn ? `<p class="why roommate">${ICONS.house}<span>${rn}</span></p>` : ''}
      <div class="meal-meta">
        <span>${ICONS.clock}${a.r.time} min</span>
        <span class="have">${ICONS.check}Have ${a.have.length} of ${total}</span>
        <span><b>${a.need.length ? money(a.perServing) : '$0.00'}</b> per serving to finish</span>
      </div>
      <div class="meal-foot">
        <span class="pop">${a.r.pop}% of students liked it</span>
        ${a.need.length ? `<button class="btn small outline" data-action="addmissing" data-id="${a.r.id}">Add ${a.need.length} to list</button>` : '<span class="ready">Ready to cook</span>'}
      </div>
    </article>`;
  }

  function renderMeals() {
    const list = rankedMeals();
    const hidden = [...P().diet.map(d => DIETS.find(x => x[0] === d)[1]), ...P().dislikes.map(id => 'No ' + lower(products[id].name))];
    const learned = Object.values(state.ratings).some(v => v);
    app.innerHTML = `
      <section class="screen">
        ${band('Meals', 'Cook what you have.', fridgeAll().length ? 'Ranked by what expires first, then what is cheapest to finish.' : 'Add food to your fridge and these will rank around it.')}
        ${state.justRated ? `<div class="banner ok"><strong>Suggestions updated</strong>${state.justRated}</div>` : ''}
        <div class="seg">${[['all', 'All'], ['ready', 'Ready now'], ['cheap', 'Under $3 a serving']].map(([v, l]) => `<button class="${state.mealFilter === v ? 'on' : ''}" data-action="mfilter" data-id="${v}">${l}</button>`).join('')}</div>
        ${hidden.length ? `<p class="filters-note">Showing meals that fit: ${hidden.map(h => `<span class="src">${h}</span>`).join('')} <button class="link" data-action="profile">Change</button></p>` : ''}
        ${learned ? '<p class="filters-note">Personalised from your ratings.</p>' : ''}
        <div class="meals">${list.map(mealCard).join('') || '<p class="empty-note">No meals match. Try another filter.</p>'}</div>
        <p class="footnote">Assumes basic pantry staples like oil, salt, spices and soy sauce.</p>
      </section>`;
    state.justRated = null;
  }

  function renderRecipe() {
    const r = recipes[state.recipeId];
    const a = analyse(r);
    const done = state.justCooked === r.id;
    const tags = recipeTags(r);
    const ing = [
      ...a.have.map(h => `<li class="ing have"><span class="ing-ic">${ICONS.check}</span><div><strong>${esc(itemName(h.f))}</strong><span>${esc(h.ing.amt)} · in your fridge${h.f.owner !== 'You' ? ` (${h.f.owner === 'Shared' ? 'shared' : esc(h.f.owner) + "'s"})` : ''}</span></div><span class="exp ${h.f.frozen ? 'frozen' : urgency(h.days)}">${rangeText(h.f)}</span></li>`),
      ...a.need.map(n => `<li class="ing need"><span class="ing-ic">${ICONS.cart}</span><div><strong>${products[n.ing.id].name}</strong><span>${esc(n.ing.amt)} · ${n.best ? `${money(n.best.price)} at ${stores[n.best.store].name}` : 'not sold nearby'}${n.best && n.best.deal ? ' <b class="tag">Sale</b>' : ''}</span></div></li>`),
      ...a.opt.map(o => `<li class="ing opt"><span class="ing-ic">${ICONS.plus}</span><div><strong>${products[o.ing.id].name}</strong><span>${esc(o.ing.amt)} · optional</span></div></li>`),
    ].join('');

    const feedback = done ? `
      <div class="card feedback">
        <h2>How was it?</h2>
        <p class="card-note">Your answer changes what SNARE suggests next.</p>
        <div class="thumbs">
          <button class="thumb up" data-action="rate" data-id="1">${ICONS.up}Loved it</button>
          <button class="thumb down" data-action="rate" data-id="-1">${ICONS.down}Not for me</button>
        </div>
        <div class="quick">${['Quick to make', 'Cheap', 'Filling', 'Too long', 'Too many steps'].map(c => `<button class="chip ${state.feedbackChip === c ? 'on' : ''}" data-action="fchip" data-id="${c}">${c}</button>`).join('')}</div>
      </div>` : '';

    app.innerHTML = `
      <section class="screen">
        ${band('Recipe', r.name, `${r.time} min · serves ${r.serves} · ${a.need.length ? `${money(a.perServing)} per serving to finish` : 'everything is in your fridge'}`,
          tags.length ? `<div class="tag-row">${tags.map(t => `<span class="src">${t}</span>`).join('')}</div>` : '')}
        ${feedback}
        ${!done ? `<div class="whybox">${ICONS.spark}<div><strong>Why SNARE picked this</strong>${reasons(a).map(w => `<span>${w}</span>`).join('') || '<span>A student favourite that fits your diet</span>'}${roommateNote(a) ? `<span>${roommateNote(a)}</span>` : ''}</div></div>` : ''}
        <h2 class="section-title">Ingredients <small>have ${a.have.length}, need ${a.need.length}</small></h2>
        <ul class="ing-list">${ing}</ul>
        ${a.need.length && !done ? `<button class="btn block" data-action="addmissing" data-id="${r.id}">${ICONS.cart}Add ${plural(a.need.length, 'missing item')} to Shop</button>` : ''}
        <h2 class="section-title">Steps</h2>
        <ol class="steps-list">${r.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        ${!done ? `<button class="btn block log" data-action="cook" data-id="${r.id}">I cooked this</button><p class="hint">Marks the fresh ingredients as used and counts the expiring ones as food rescued.</p>` : ''}
        <p class="footnote">Assumes basic pantry staples like oil, salt, spices and soy sauce.</p>
      </section>`;
  }

  // ---------- shop ----------

  function shopRow(it) {
    const p = products[it.id];
    const b = bestNearby(it.id);
    return `<li>
      <div><strong>${p.name}${b && b.deal ? '<b class="tag">Sale</b>' : ''}</strong><span>${b ? `${money(b.price)} at ${stores[b.store].name}` : 'Not sold nearby'}${it.why ? ` · for ${esc(it.why)}` : ''}</span>${(state.tossLog[it.id] || 0) >= 2 ? `<span class="toss-warn">You've thrown this out ${state.tossLog[it.id]} times. Buy a smaller pack?</span>` : ''}</div>
      <div class="qty">
        <button data-action="qty" data-id="${it.id}" data-d="-1" aria-label="Fewer">&minus;</button>
        <b>${it.qty}</b>
        <button data-action="qty" data-id="${it.id}" data-d="1" aria-label="More">+</button>
      </div>
    </li>`;
  }

  function rescueCard(x, foot) {
    const added = state.rescueAdded.includes(x.id);
    return `<div class="offer">
      <div class="offer-top">
        <div><span class="kind">Rescue deal · ${stores[x.store].name}</span><h3>${x.name}</h3><p>${x.size} · ${x.note}</p></div>
        <div class="price"><b>${money(x.price)}</b><s>${money(x.was)}</s></div>
      </div>
      <div class="offer-foot"><small>${foot}</small>
        <button class="btn small ${added ? 'added' : ''}" data-action="rescue" data-id="${x.id}">${added ? 'Saved for trip' : 'Save for my trip'}</button></div>
    </div>`;
  }

  function renderShop() {
    const near = nearbyStores();
    const deals = D.deals
      .filter(d => near.some(s => s.id === d.store) && !state.items.some(it => it.id === d.product))
      .filter(d => !P().dislikes.includes(d.product))
      .slice(0, 8);
    const rescue = D.rescue.filter(x => near.some(s => s.id === x.store)).slice(0, 3);
    const total = state.items.reduce((t, it) => { const b = bestNearby(it.id); return t + (b ? b.price : 0) * it.qty; }, 0);

    app.innerHTML = `
      <section class="screen shop">
        ${band('Shop', 'Only buy what you will use.', `Missing items for your meals, with sale prices near ${esc(home().name)} first.`)}
        <div class="card list-card">
          <h2>Your list <small id="count">${state.items.length ? `${plural(state.items.length, 'item')} · about ${money(total)}` : ''}</small></h2>
          <ul class="items" id="items">${state.items.map(shopRow).join('') || '<li class="empty">Nothing yet. Open a meal and tap Add to list, or search below.</li>'}</ul>
          <div class="search" style="margin-top:10px"><input id="q" type="text" placeholder="Add something, like rice or onions" autocomplete="off" value="${esc(state.query)}"><div id="suggest" class="suggest"></div></div>
          ${!state.items.length ? '<button class="btn small outline" data-tab="meals" style="margin-top:10px">Find meals</button>' : ''}
        </div>
        ${deals.length ? `<h2 class="section-title">On sale near you</h2>
        <div class="deal-strip">${deals.map(d => { const p = products[d.product]; return `<button class="deal" data-action="add" data-id="${d.product}"><span class="src">${stores[d.store].name}</span><strong>${p.name}</strong><span><b>${money(d.price)}</b> <s>${money(p.base)}</s></span><i>${ICONS.plus}</i></button>`; }).join('')}</div>` : ''}
        ${rescue.length ? `<h2 class="section-title">Rescue deals</h2><p class="section-sub">Food stores would otherwise throw out, at a big discount.</p>${rescue.map(x => rescueCard(x, 'Added if your route stops there')).join('')}` : ''}
        <div class="card trip-card">
          <h2>Your trip</h2>
          <div class="field-label">Starting from</div>
          <div class="row">${areaSelect('area')}<button class="btn small outline locate" data-action="locate">Use my location</button></div>
          <div class="field-label">Getting there</div>
          ${modeSeg()}
          <div class="field-label">How far you will go</div>
          <div class="dial">
            <input id="radius" type="range" min="0.5" max="${SLIDER_MAX}" step="0.5" value="${Math.min(P().radius, SLIDER_MAX)}" style="--fill:${Math.min(1, P().radius / SLIDER_MAX) * 100}%">
            <label class="unit-input"><input id="radius-num" type="number" min="${MIN_RADIUS}" step="any" inputmode="decimal" value="${P().radius}" aria-label="Distance in km"><span>km</span></label>
          </div>
          <div class="field-label">Most stores</div>
          <div id="store-limit"></div>
        </div>
        <div class="sticky"><button id="find" class="btn block" data-action="find" ${state.items.length ? '' : 'disabled'}>Find my cheapest trip</button></div>
      </section>`;
    renderStoreLimit();
    renderSuggest();
  }

  function renderStoreLimit() {
    const box = document.getElementById('store-limit');
    if (!box) return;
    const n = P().maxStores;
    box.innerHTML = `
      <div class="stepper">
        <button data-action="stores" data-d="-1" aria-label="Fewer stores" ${n === 1 ? 'disabled' : ''}>&minus;</button>
        <div><b>${n || 'Any'}</b><span>${n ? (n === 1 ? 'store' : 'stores') : 'number of stores'}</span></div>
        <button data-action="stores" data-d="1" aria-label="More stores" ${!n ? 'disabled' : ''}>+</button>
      </div>
      <button class="chip ${n ? '' : 'on'}" data-action="nolimit">No limit, find the best price anywhere</button>`;
  }

  function setRadius(v, from) {
    const r = Math.max(MIN_RADIUS, Math.round((Number(v) || MIN_RADIUS) * 10) / 10);
    P().radius = r;
    persist();
    const range = document.getElementById('radius'), num = document.getElementById('radius-num');
    if (range && from !== 'range') range.value = Math.min(r, SLIDER_MAX);
    if (num && from !== 'num') num.value = r;
    if (range) range.style.setProperty('--fill', Math.min(1, r / SLIDER_MAX) * 100 + '%');
  }

  function renderSuggest() {
    const box = document.getElementById('suggest');
    if (!box) return;
    const q = state.query.trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    const forFridge = ['review'].includes(state.screen);
    const hits = D.products.filter(p => (forFridge || !p.leftover) && (p.name + ' ' + (p.keywords || '')).toLowerCase().includes(q)).slice(0, 6);
    const action = state.screen === 'review' ? (state.scan.mode === 'item' ? 'ifix' : 'radd') : 'add';
    box.innerHTML = hits.length
      ? hits.map(p => `<button data-action="${action}" data-id="${p.id}">${p.name} <span>${p.unit}</span></button>`).join('')
      : `<div class="none">"${esc(state.query.trim())}" isn't in the demo catalog yet.</div>`;
  }

  // ---------- trip loading and results ----------

  function renderLoading() {
    const start = home();
    const inRange = nearbyStores();
    const steps = [
      `Reading this week's flyers at ${plural(inRange.length, 'store')}`,
      `Comparing prices for ${plural(state.items.length, 'item')}`,
      'Checking rescue deals on the way',
      `Planning ${MODES[P().mode].label.toLowerCase()} routes`,
    ];
    const checks = state.items.length * inRange.length + D.deals.length + D.rescue.length;
    app.innerHTML = `
      <section class="loading">
        <div class="scan-map" id="scan-map">
          <div class="scan-chip"><span class="live"></span><b data-count="${checks}" data-fmt="">0</b>&nbsp;prices checked</div>
        </div>
        <div class="loading-copy">
          <h1>Finding your cheapest trip</h1>
          <div class="progress"><span style="animation-duration:${LOADING_MS}ms"></span></div>
          <ul class="steps">${steps.map(s => `<li>${s}</li>`).join('')}</ul>
        </div>
      </section>`;
    app.querySelectorAll('.steps li').forEach((li, i) => setTimeout(() => li.classList.add('done'), 450 + i * 620));
    countUp(app, LOADING_MS - 500);
    drawScan(start, inRange);
  }

  function budgetPill(cost) {
    const diff = P().budget - cost;
    return diff >= 0
      ? `<span class="pill ok">${money(diff)} under</span>`
      : `<span class="pill over">${money(-diff)} over</span>`;
  }

  function tradeoffText(sel, options) {
    return options.filter(o => o !== sel).map(o => {
      const dCost = o.plan.cost - sel.plan.cost;
      const dMin = sel.plan.minutes - o.plan.minutes;
      if (dCost > 0 && dMin > 0) return `${o.label} saves ${dMin} min for ${money(dCost)} more.`;
      if (dCost < 0 && dMin < 0) return `${o.label} saves ${money(-dCost)} but takes ${-dMin} min longer.`;
      return null;
    }).filter(Boolean).join(' ');
  }

  function renderResults() {
    const r = result;
    const start = r.start;
    const settings = `${MODES[P().mode].label} · within ${P().radius} km · ${storeLimitText()} · ${money(P().budget)} weekly budget`;
    const head = band('Your trip', `${plural(state.items.length, 'item')} from ${esc(start.name)}`, settings,
      '<button class="btn small outline" data-action="edit">Edit trip</button>');

    if (!r.options.length) {
      app.innerHTML = `<section class="screen">${head}
        <div class="banner info"><strong>No stores in range</strong>
        There are no stores within ${P().radius} km that carry your items. Try a longer distance.
        <div class="actions"><button class="btn small dark" data-action="edit">Change distance</button></div></div>
      </section>`;
      return;
    }

    if (!r.options.some(o => o.id === state.selected)) {
      state.selected = (r.options.find(o => o.id === 'balanced') || r.options[0]).id;
    }
    const sel = r.options.find(o => o.id === state.selected);
    const p = sel.plan;
    const cheapest = r.options[0].plan;

    const missing = r.missing.length
      ? `<div class="banner info"><strong>Not found within ${P().radius} km</strong>${r.missing.map(it => products[it.id].name).join(', ')}. A longer distance may find them.</div>`
      : '';
    const gap = cheapest.cost - P().budget;
    const swapSave = swapsFor(cheapest).reduce((n, s) => n + s.saving, 0);
    const banner = gap > 0
      ? `<div class="banner over"><strong>About ${money(gap)} over your weekly budget</strong>${swapSave > 0 ? `Smart swaps below could save ${money(swapSave)}. ` : ''}Cooking more from your fridge first is the cheapest fix.</div>`
      : `<div class="banner ok"><strong>${r.options.every(o => o.plan.cost <= P().budget) ? 'Every option fits your budget' : 'The cheapest option fits your budget'}</strong>Pick the trip that works best for your time.</div>`;

    const cards = r.options.map(o => `
      <button class="opt ${o.id === sel.id ? 'on' : ''}" data-action="pick" data-id="${o.id}">
        <span class="opt-label"><span class="opt-icon">${ICONS[{ cheapest: 'wallet', balanced: 'scale', quickest: 'bolt' }[o.id]]}</span>${o.label}</span>
        <span class="opt-total">${counted(o.plan.cost, 'money')}</span>
        <span class="opt-meta">${plural(o.plan.storeCount, 'store')}</span>
        <span class="opt-meta">${o.plan.minutes} min total</span>
        ${budgetPill(o.plan.cost)}
      </button>`).join('');

    const stopsHtml = p.order.map((s, i) => {
      const lines = p.assign[s.id] || [];
      const sub = lines.reduce((t, l) => t + l.price * l.qty, 0);
      const rescueHere = state.rescueAdded.map(id => rescues[id]).filter(x => x.store === s.id);
      return `<div class="stop">
        <div class="stop-head">
          <span class="pin store">${i + 1}</span>
          <div><strong>${s.name}</strong><span>${s.where} · ${km(start, s).toFixed(1)} km from start</span></div>
          <span class="sub">${money(sub)}</span>
        </div>
        <ul class="lines">
          ${lines.map(l => `<li><span>${products[l.id].name}${l.qty > 1 ? ` <em>x${l.qty}</em>` : ''}${l.deal ? '<span class="tag">Sale</span>' : ''}</span><span>${money(l.price * l.qty)}</span></li>`).join('')}
          ${rescueHere.map(x => `<li><span>${x.name}<span class="tag rescue">Rescued</span></span><span>${money(x.price)}</span></li>`).join('')}
        </ul>
      </div>`;
    }).join('');

    const extra = routeRescue(p).reduce((t, x) => t + x.price, 0);
    const swaps = swapsFor(p);
    const rescueOnRoute = D.rescue.filter(x => p.order.some(s => s.id === x.store));

    app.innerHTML = `
      <section class="screen">
        ${head}
        <div class="results-grid">
        <div class="col-top">
        ${missing}
        ${banner}
        <h2 class="section-title">Your options</h2>
        <div class="options">${cards}</div>
        <p class="tradeoff">${tradeoffText(sel, r.options)}</p>
        </div>

        <div class="col-map">
        <div class="map-wrap">
          <div class="map" id="map"></div>
          <div class="map-chip">${plural(p.order.length, 'stop')} · ${MODES[P().mode].label}</div>
        </div>
        <p class="map-note">Times and distances are estimates.</p>
        <div class="stats">
          <div class="stat"><b>${counted(p.travelMin, 'min')}</b><span>travel</span></div>
          <div class="stat"><b>${counted(p.km, 'km')}</b><span>round trip</span></div>
          <div class="stat"><b>${p.co2 > 0 ? counted(p.co2, 'kg') : 'Zero'}</b><span>CO2 from travel</span></div>
        </div>
        ${navButtons(start, p)}
        </div>

        <div class="col-bottom">
        <h2 class="section-title">Your route</h2>
        ${stopsHtml}
        <div class="total-row">
          <span>Trip total${extra > 0 ? `<br>includes ${money(extra)} of rescued food` : ''}</span>
          <b>${counted(p.cost + extra, 'money')}</b>
        </div>
        <button class="btn block log" data-action="log" ${state.loggedTrip ? 'disabled' : ''}>${state.loggedTrip ? 'Added to your fridge' : 'I did this trip'}</button>
        <p class="hint">Puts what you bought into your fridge with expiry estimates, and adds your savings to Impact.</p>
        ${swaps.length ? `<h2 class="section-title">Smart swaps</h2>${swaps.map(s => `<div class="swap">
            <div><strong>${products[s.from].name} &rarr; ${products[s.to].name}</strong><span>Same store, ${stores[s.store].name}</span></div>
            <span class="save">Save ${money(s.saving)}</span>
            <button class="btn small" data-action="swap" data-from="${s.from}" data-to="${s.to}">Swap</button>
          </div>`).join('')}` : ''}
        ${rescueOnRoute.length ? `<h2 class="section-title">Rescue deals on your route</h2>${rescueOnRoute.map(x => rescueCard(x, 'Already on your route')).join('')}` : ''}
        <p class="footnote">Prototype with demo prices for London, Ontario.</p>
        </div>
        </div>
      </section>`;

    const animate = fresh;
    fresh = false;
    if (animate) countUp(app);
    drawMap(start, p, animate);
  }

  function navButtons(start, p) {
    const ll = x => `${x.lat.toFixed(5)},${x.lng.toFixed(5)}`;
    const stops = p.order.map(ll);
    const gMode = { car: 'driving', transit: 'transit', walk: 'walking' }[P().mode];
    const aMode = { car: 'd', transit: 'r', walk: 'w' }[P().mode];
    const google = `https://www.google.com/maps/dir/?api=1&origin=${ll(start)}&destination=${ll(start)}&waypoints=${encodeURIComponent(stops.join('|'))}&travelmode=${gMode}`;
    const apple = `https://maps.apple.com/?saddr=${ll(start)}&daddr=${[...stops, ll(start)].join('+to:')}&dirflg=${aMode}`;
    return `<div class="nav-out">
      <span>Take this route with you</span>
      <div>
        <a class="btn small outline" href="${google}" target="_blank" rel="noopener">${ICONS.pinOut}Google Maps</a>
        <a class="btn small outline" href="${apple}" target="_blank" rel="noopener">${ICONS.pinOut}Apple Maps</a>
      </div>
    </div>`;
  }

  // ---------- impact ----------

  function renderImpact() {
    const c = state.cooked, t = state.trips;
    const community = `
      <h2 class="section-title">Students in London this month</h2>
      <div class="stats">
        <div class="stat"><b>3,412</b><span>meals cooked from fridges</span></div>
        <div class="stat"><b>1,180 kg</b><span>food rescued</span></div>
        <div class="stat"><b>$41,600</b><span>saved</span></div>
      </div>
      <p class="footnote">Community figures are illustrative for the prototype.</p>`;

    if (!c.length && !t.length) {
      app.innerHTML = `
        <section class="screen">
          ${band('Impact', 'Every meal adds up.')}
          <div class="banner info"><strong>Nothing tracked yet</strong>
            Cook something from your fridge or finish a trip to start tracking money saved and food rescued.
            <div class="actions">
              <button class="btn small" data-tab="meals">Find a meal</button>
              <button class="btn small outline" data-action="sample">Load sample history</button>
            </div>
          </div>
          ${community}
        </section>`;
      return;
    }

    const rescued = c.reduce((n, x) => n + x.rescued, 0);
    const kg = c.reduce((n, x) => n + x.kg, 0) + t.reduce((n, x) => n + x.kg, 0);
    const saved = c.reduce((n, x) => n + x.value, 0) + t.reduce((n, x) => n + x.saved, 0);
    const wasteRate = rescued + state.tossed ? Math.round(state.tossed / (rescued + state.tossed) * 100) : 0;
    const streak = weekStreak();
    const history = [
      ...c.map(x => ({ date: x.date, title: recipes[x.rid] ? recipes[x.rid].name : 'Meal', sub: x.rescued ? `Rescued ${plural(x.rescued, 'expiring item')}` : 'Cooked from your fridge', amt: x.value })),
      ...t.map(x => ({ date: x.date, title: 'Grocery trip', sub: `${MODES[x.mode].label} · ${plural(x.stores, 'store')} · ${money(x.spent)} spent`, amt: x.saved })),
    ].sort((a, b) => b.date - a.date).slice(0, 8);

    app.innerHTML = `
      <section class="screen">
        ${band("Impact · You've saved", counted(saved, 'money'), 'Food you used before it went off, plus sale savings on your trips.')}
        <div class="stats">
          <div class="stat"><b>${counted(rescued, '')}</b><span>expiring items rescued</span></div>
          <div class="stat"><b>${counted(kg, 'kg')}</b><span>food waste avoided</span></div>
          <div class="stat"><b>${counted(kg * CO2_PER_KG, 'kg')}</b><span>CO2e avoided (est.)</span></div>
        </div>
        <div class="stats">
          <div class="stat"><b>${counted(c.length, '')}</b><span>meals from your fridge</span></div>
          <div class="stat"><b>${streak ? plural(streak, 'week') : 'None'}</b><span>cooking streak</span></div>
          <div class="stat"><b>${wasteRate}%</b><span>of expiring food thrown out</span></div>
        </div>
        <div class="banner ok"><strong>Your part in SDG 12.3</strong>
          Every item you rescue is edible food kept out of the bin, counting toward halving food waste by 2030.</div>
        <h2 class="section-title">Recent</h2>
        <ul class="history">${history.map(h => `<li><div><strong>${h.title}</strong><span>${new Date(h.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} · ${h.sub}</span></div><b>+${money(h.amt)}</b></li>`).join('')}</ul>
        <button class="link" data-action="clearhistory">Clear history</button>
        ${community}
      </section>`;
    countUp(app, 1100);
  }

  // ---------- profile and memory ----------

  function learnedList() {
    const rows = [
      ...Object.keys(state.learn).filter(id => learnAdj(id)).map(id => `${products[id].name}: about ${plural(Math.abs(learnAdj(id)), 'day')} ${learnAdj(id) < 0 ? 'shorter' : 'longer'} than usual in your fridge`),
      ...Object.keys(state.tossLog).filter(id => state.tossLog[id] >= 2 && !products[id].leftover).map(id => `You often throw out ${lower(products[id].name)}`),
      ...D.recipes.filter(r => skippedCount(r.id) > 0).map(r => `You keep skipping ${r.name}, so it ranks lower`),
    ];
    return rows.length ? `<ul class="learned-list">${rows.map(r => `<li>${r}</li>`).join('')}</ul>` : '';
  }

  function renderProfile() {
    const liked = Object.keys(state.ratings).filter(id => state.ratings[id] > 0).map(id => recipes[id]);
    const disliked = Object.keys(state.ratings).filter(id => state.ratings[id] < 0).map(id => recipes[id]);
    app.innerHTML = `
      <section class="screen">
        ${band('Profile', 'Your preferences', 'SNARE uses these to rank meals and plan trips.')}
        <div class="card"><h2>Food needs</h2>${chipsHtml('diet', DIETS, v => P().diet.includes(v))}</div>
        <div class="card"><h2>Weekly food budget</h2>${chipsHtml('budget', BUDGETS.map(b => [b, '$' + b]), v => P().budget === Number(v))}</div>
        <div class="card"><h2>Home and travel</h2>${areaSelect('area')}<div style="margin-top:10px">${modeSeg()}</div></div>
        <div class="card memory">
          <h2>${ICONS.spark} What SNARE remembers</h2>
          <p class="card-note">Learned from your chats and ratings. Tap × to forget something.</p>
          <div class="field-label">Doesn't eat</div>
          <div class="quick">${P().dislikes.map(id => `<button class="chip on" data-action="forget" data-id="${id}">${products[id].name} &times;</button>`).join('') || '<span class="empty-note">Nothing yet. Try telling the AI "I don\'t like mushrooms".</span>'}</div>
          <div class="field-label">Liked</div>
          <div class="quick">${liked.map(r => `<button class="chip" data-action="unrate" data-id="${r.id}">${r.name} &times;</button>`).join('') || '<span class="empty-note">Rate a meal after cooking it.</span>'}</div>
          ${disliked.length ? `<div class="field-label">Not for you</div><div class="quick">${disliked.map(r => `<button class="chip" data-action="unrate" data-id="${r.id}">${r.name} &times;</button>`).join('')}</div>` : ''}
        </div>
        <div class="card memory">
          <h2>${ICONS.spark} Learned from what you do</h2>
          <p class="card-note">No ratings needed. SNARE adjusts as you use and throw out food.</p>
          ${learnedList() || '<span class="empty-note">Nothing yet. Answer a "still good?" check or throw something out and it shows up here.</span>'}
          ${learnedList() ? '<button class="link" data-action="forgetlearned">Forget all of this</button>' : ''}
        </div>
        <div class="card">
          <button class="switch-row" data-action="house" aria-pressed="${P().house}">
            <span><strong>${ICONS.house} Shared house fridge</strong><span>${P().house ? `Sharing with ${listText(D.housemates)}` : 'Off'}</span></span>
            <span class="switch ${P().house ? 'on' : ''}"></span>
          </button>
        </div>
        <div class="banner info"><strong>Privacy</strong>In the real app, fridge photos are analysed and then deleted; only the item list is kept. In this prototype everything stays in your own browser.</div>
        <button class="btn outline block" data-action="reset" style="margin-top:14px">Clear my data and start over</button>
      </section>`;
  }

  // ---------- AI assistant ----------
  // Two brains share one chat. If window.SNARE_AI_URL is set (config.js), each
  // message goes to a small server that asks Claude, sending the app state as
  // context. Otherwise, or if that call fails, the scripted brain below answers
  // using the same app data. Both return { html, actions } and can act on the app.

  const AI_CHIPS = {
    fridge: ['What can I make tonight?', 'What should I use first?', 'Plan my meals for the week'],
    meals: ['Something quick under $3', 'Make it vegetarian', "Remember I don't like mushrooms"],
    recipe: ['What do I need for this?', 'What can I swap in?', 'Add the missing items'],
    shop: ['Plan my cheapest trip', "What's on sale near me?", 'How much will my list cost?'],
    impact: ['How much have I saved?', 'Plan my meals for the week', 'What should I use first?'],
  };

  // Conversation memory for follow-ups ("the second one", "cheaper", "yes").
  const aiCtx = { lastRecipes: [], lastRecipe: null, lastProduct: null, lastQuery: null, offset: 0, pending: null, awaitingRating: null };
  const aiHistory = []; // plain text turns sent to the live model

  function aiAct(label, act, arg = '') {
    const primary = ['trip', 'recipe', 'addall', 'addmissing'].includes(act);
    return `<button class="btn small ${primary ? '' : 'outline'}" data-action="aiact" data-act="${act}" data-arg="${esc(arg)}">${esc(label)}</button>`;
  }

  // ----- understanding the message -----

  const PRODUCT_ALIASES = {
    beef: 'ground_beef', 'ground beef': 'ground_beef', mince: 'ground_beef', hamburger: 'ground_beef',
    chicken: 'chicken_thighs', 'chicken thigh': 'chicken_thighs', 'chicken breast': 'chicken_breast',
    cheese: 'cheddar', pepper: 'bell_pepper', 'red pepper': 'bell_pepper', capsicum: 'bell_pepper',
    beans: 'black_beans', 'black bean': 'black_beans', scallion: 'green_onions', 'green onion': 'green_onions',
    egg: 'eggs', spaghetti: 'pasta', noodle: 'pasta', 'tomato sauce': 'pasta_sauce', marinara: 'pasta_sauce', sauce: 'pasta_sauce',
    tortilla: 'tortillas', wrap: 'tortillas', yoghurt: 'yogurt', 'sour cream': 'yogurt', toast: 'bread',
    potato: 'potatoes', tomato: 'tomatoes', salad: 'lettuce', oatmeal: 'oats', 'leftover rice': 'cooked_rice',
    leftover: 'leftovers', 'frozen veg': 'frozen_veg', 'frozen vegetable': 'frozen_veg', veggies: 'frozen_veg',
    'frozen spinach': 'frozen_spinach', lentil: 'lentils', banana: 'bananas', apple: 'apples', carrot: 'carrots',
    onion: 'onions', mushroom: 'mushrooms', cucumber: 'cucumber', milk: 'milk', rice: 'rice', tofu: 'tofu', tuna: 'tuna',
  };
  const RECIPE_ALIASES = {
    omelette: ['omelette', 'omelet'], friedrice: ['fried rice'], quesadilla: ['quesadilla'], burritobowl: ['burrito bowl', 'burrito'],
    stirfry: ['stir fry', 'stirfry', 'stir-fry'], tomatopasta: ['tomato pasta', 'tomato spinach pasta', 'one pot pasta'],
    shakshuka: ['shakshuka'], lentilcurry: ['lentil curry', 'curry', 'dal', 'dahl'], tacos: ['taco'], tofubowl: ['tofu bowl', 'tofu rice bowl'],
    pancakes: ['pancake'], potatoes: ['loaded potato', 'baked potato', 'microwave potato'], tunapasta: ['tuna pasta', 'pasta salad'],
    mushroompasta: ['mushroom pasta', 'creamy pasta'], parfait: ['parfait'], frenchtoast: ['french toast'],
    beefchili: ['beef chili', 'beef and bean chili', 'chili con carne'], chili: ['veggie chili', 'vegetarian chili', 'veggie bean chili'],
    wraps: ['chicken wrap', 'veggie wrap', 'chicken veggie wrap'],
  };

  // Hand picked aliases win; then full names, ids, keywords and the last word
  // of a name ("Fresh spinach" also answers to "spinach").
  const aliasList = (() => {
    const map = new Map(Object.entries(PRODUCT_ALIASES));
    const add = (a, id) => { if (a.length > 2 && !map.has(a)) map.set(a, id); };
    for (const p of D.products) {
      const name = p.name.toLowerCase();
      add(name, p.id);
      add(name.replace(/s$/, ''), p.id);
      add(p.id.replace(/_/g, ' '), p.id);
      (p.keywords || '').split(' ').filter(w => w.length > 3).forEach(w => add(w, p.id));
      const last = name.split(' ').pop();
      if (last.length > 3 && !p.leftover) add(last.replace(/s$/, ''), p.id);
    }
    return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  })();

  const wordRe = w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s)?\\b`, 'i');

  // Products mentioned, in order, without double counting overlapping words.
  function findProducts(text) {
    let t = ' ' + text.toLowerCase() + ' ';
    const found = [];
    for (const [alias, id] of aliasList) {
      const m = t.match(wordRe(alias));
      if (!m) continue;
      let pid = id;
      if (alias === 'chicken' && fridgeAll().some(f => f.id === 'chicken_breast')) pid = 'chicken_breast';
      found.push({ id: pid, at: m.index });
      t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length);
    }
    return [...new Map(found.sort((a, b) => a.at - b.at).map(f => [f.id, f])).keys()];
  }

  function findRecipe(text) {
    const t = text.toLowerCase();
    let best = null;
    for (const r of D.recipes) {
      for (const a of [r.name.toLowerCase(), ...(RECIPE_ALIASES[r.id] || [])]) {
        if (wordRe(a).test(t) && (!best || a.length > best.len)) best = { id: r.id, len: a.length };
      }
    }
    if (/\bchili\b/.test(t) && !best) {
      const ranked = rankedMeals('all').map(a => a.r.id);
      best = { id: ranked.indexOf('beefchili') !== -1 && (ranked.indexOf('chili') === -1 || ranked.indexOf('beefchili') < ranked.indexOf('chili')) ? 'beefchili' : 'chili' };
    }
    return best ? best.id : null;
  }

  // "the second one", "that", "it" after a list of meals.
  function recipeFromContext(text) {
    const t = text.toLowerCase();
    const ord = [['first', 0], ['1st', 0], ['second', 1], ['2nd', 1], ['third', 2], ['3rd', 2], ['last', -1]]
      .find(([w]) => new RegExp(`\\b(the ${w}|${w} one|${w} recipe|${w} meal)\\b`).test(t));
    if (ord && aiCtx.lastRecipes.length) return aiCtx.lastRecipes[ord[1] < 0 ? aiCtx.lastRecipes.length - 1 : Math.min(ord[1], aiCtx.lastRecipes.length - 1)];
    if (/\b(it|that|this|that one|this one|the recipe)\b/.test(t)) return aiCtx.lastRecipe || (state.screen === 'recipe' ? state.recipeId : null);
    return null;
  }

  function parseFilters(text) {
    const t = text.toLowerCase();
    const f = {};
    const min = t.match(/(\d+)\s*(min|minute)/);
    if (min) f.maxTime = Number(min[1]);
    else if (/\b(quick|fast|easy|lazy|no time|in a hurry)\b/.test(t)) f.maxTime = 15;
    const under = t.match(/(under|below|less than|max)\s*\$?\s*(\d+(\.\d+)?)/);
    if (under) f.maxCost = Number(under[2]);
    else if (/\b(cheap|cheapest|budget|broke|save money|inexpensive)\b/.test(t)) f.maxCost = 3;
    if (/\bvegan\b/.test(t)) f.diet = 'vegan';
    else if (/\bvegetarian|veggie|meatless|no meat\b/.test(t)) f.diet = 'vegetarian';
    if (/gluten[ -]?free/.test(t)) f.glutenFree = true;
    const meal = t.match(/\b(breakfast|lunch|dinner|supper)\b/);
    if (meal) f.meal = meal[1] === 'supper' ? 'dinner' : meal[1];
    if (/(nothing to buy|without (going )?shopping|no shopping|what i (already )?have|only what i have|ready now|without buying)/.test(t)) f.ready = true;
    const withM = t.match(/\b(with|using|use up|uses|has)\s+(.+?)(\?|$|\band\b|,)/);
    if (withM) f.with = findProducts(withM[2]).filter(id => !products[id].leftover || fridgeAll().some(x => x.id === id));
    const without = t.match(/\b(without|no|minus|except)\s+(.+?)(\?|$|,)/);
    if (without && !f.ready) f.without = findProducts(without[2]);
    const serves = t.match(/for\s+(\d+)\s*(people|of us|servings|person)/);
    if (serves) f.serves = Number(serves[1]);
    return f;
  }

  function mealsFor(f) {
    let list = rankedMeals('all');
    if (f.maxTime) list = list.filter(a => a.r.time <= f.maxTime);
    if (f.maxCost != null) list = list.filter(a => a.perServing <= f.maxCost);
    if (f.diet === 'vegan') list = list.filter(a => recipeTags(a.r).includes('Vegan'));
    if (f.diet === 'vegetarian') list = list.filter(a => recipeTags(a.r).some(t => t === 'Vegetarian' || t === 'Vegan'));
    if (f.glutenFree) list = list.filter(a => recipeTags(a.r).includes('Gluten free'));
    if (f.meal) list = list.filter(a => a.r.meal === f.meal || (f.meal === 'lunch' && a.r.meal === 'dinner'));
    if (f.ready) list = list.filter(a => !a.need.length);
    if (f.with && f.with.length) list = list.filter(a => f.with.every(id => a.r.ingredients.some(i => i.id === id || (i.alt || []).includes(id))));
    if (f.without && f.without.length) list = list.filter(a => !f.without.some(id => a.r.ingredients.some(i => !i.opt && i.id === id)));
    if (f.serves) list = [...list].sort((a, b) => (b.r.serves >= f.serves) - (a.r.serves >= f.serves));
    return list;
  }

  function describeFilters(f) {
    const bits = [];
    if (f.maxTime) bits.push(`under ${f.maxTime} min`);
    if (f.maxCost != null) bits.push(`under ${money(f.maxCost)} a serving`);
    if (f.diet) bits.push(f.diet);
    if (f.glutenFree) bits.push('gluten free');
    if (f.meal) bits.push(f.meal);
    if (f.ready) bits.push('nothing to buy');
    if (f.with && f.with.length) bits.push('with ' + listText(f.with.map(id => lower(products[id].name))));
    if (f.without && f.without.length) bits.push('without ' + listText(f.without.map(id => lower(products[id].name))));
    return bits.join(', ');
  }

  function mealMini(a, i) {
    return `<div class="ai-meal"><strong>${i != null ? `${i + 1}. ` : ''}${a.r.name}</strong><span>${reasons(a)[0] || `${a.r.time} min`} · ${a.need.length ? `${plural(a.need.length, 'item')} to buy, ${money(a.perServing)}/serving` : 'nothing to buy'}</span>${aiAct('Open', 'recipe', a.r.id)}</div>`;
  }

  function showMeals(list, intro, f) {
    const top = list.slice(aiCtx.offset, aiCtx.offset + 3);
    if (!top.length) {
      return { html: `I couldn't find a meal ${f && describeFilters(f) ? `that's ${describeFilters(f)}` : 'that fits'}. Want me to loosen it up? Try "something under $4" or "with what I have".`, actions: [] };
    }
    aiCtx.lastRecipes = top.map(a => a.r.id);
    aiCtx.lastRecipe = top[0].r.id;
    const skipped = P().dislikes.length ? ` (skipping ${listText(P().dislikes.map(id => lower(products[id].name)))}, like you asked)` : '';
    const more = list.length > aiCtx.offset + 3 ? '<p class="ai-hint">Say "more" for other ideas, or "the second one" to dig in.</p>' : '';
    const firstNeeds = top[0].need.length;
    if (firstNeeds) aiCtx.pending = { act: 'addmissing', arg: top[0].r.id, label: `add the ${plural(firstNeeds, 'item')} for ${top[0].r.name}` };
    return {
      html: `${intro}${skipped}:${top.map((a, i) => mealMini(a, i)).join('')}${more}`,
      actions: firstNeeds ? [aiAct(`Add missing for ${top[0].r.name}`, 'addmissing', top[0].r.id)] : [aiAct(`Cook ${top[0].r.name}`, 'recipe', top[0].r.id)],
    };
  }

  // Greedy week plan: each pick uses up what's expiring, then the next pick
  // works with what's left. Dinners first, no repeats.
  function planWeek(n) {
    const used = new Set();
    const picks = [];
    const all = D.recipes.filter(dietOk);
    for (let i = 0; i < n; i++) {
      const scored = all.filter(r => !picks.includes(r) && r.meal !== 'breakfast').map(r => {
        const a = analyse(r);
        const fresh = a.expiring.filter(h => !used.has(h.f.uid));
        return { r, a, s: a.score - (a.expiring.length - fresh.length) * 11 };
      }).sort((x, y) => y.s - x.s);
      if (!scored.length) break;
      picks.push(scored[0].r);
      scored[0].a.have.filter(h => products[h.f.id].life <= 10).forEach(h => used.add(h.f.uid));
    }
    const plans = picks.map(r => analyse(r));
    const need = [...new Set(plans.flatMap(a => a.need.map(m => m.ing.id)))].filter(id => !state.items.some(it => it.id === id));
    const cost = need.reduce((t, id) => t + ((bestNearby(id) || {}).price || products[id].base), 0);
    return { plans, need, cost };
  }

  // "Can you add milk to my list?" is a request, not a question.
  const isQuestion = t => !/^(can|could|would|will) you\b|^please\b/.test(t.trim()) && /\?|^(what|how|when|where|which|can|could|should|is|are|do|does|will|why)\b/.test(t.trim());

  // ----- the scripted brain -----

  function aiReply(raw) {
    const text = raw.trim();
    const t = text.toLowerCase();
    const say = (html, actions = []) => ({ html, actions });
    const prods = findProducts(t);
    const onRecipe = state.screen === 'recipe' && /(need|swap|substitut|cost|how long|steps|make this|missing|ingredient|freeze|leftover|serve|for \d|double|cheap|price)/.test(t) ? state.recipeId : null;
    const rid = findRecipe(t) || recipeFromContext(t) || onRecipe;

    // Yes / no to a suggestion
    if (aiCtx.pending && /^(yes|yeah|yep|yup|sure|ok|okay|do it|please|go ahead|sounds good|let'?s do it|perfect)\b/.test(t)) {
      const p = aiCtx.pending;
      aiCtx.pending = null;
      const done = runAiAction(p.act, p.arg, true);
      return say(`Done, I ${done || p.label}.`, p.act === 'addmissing' || p.act === 'addall' ? [aiAct('Plan my cheapest trip', 'trip'), aiAct('Open list', 'tab', 'shop')] : []);
    }
    if (aiCtx.pending && /^(no|nah|nope|not now|maybe later)\b/.test(t)) {
      aiCtx.pending = null;
      return say("No problem. Anything else?");
    }

    // Rating right after cooking
    if (aiCtx.awaitingRating && /(loved|liked|love it|good|great|tasty|delicious|amazing|yum)/.test(t) && !/(not|didn'?t)/.test(t)) {
      state.ratings[aiCtx.awaitingRating] = 1; persist();
      const r = recipes[aiCtx.awaitingRating]; aiCtx.awaitingRating = null;
      return say(`Noted! I'll rank meals like <b>${r.name}</b> higher from now on.`, [aiAct('See meals', 'tab', 'meals')]);
    }
    if (aiCtx.awaitingRating && /(didn'?t like|bad|gross|meh|not great|hated|not good|bland)/.test(t)) {
      state.ratings[aiCtx.awaitingRating] = -1; persist();
      const r = recipes[aiCtx.awaitingRating]; aiCtx.awaitingRating = null;
      return say(`Got it. I won't suggest <b>${r.name}</b> again.`);
    }

    // Memory: forget, diet, dislikes, allergies
    if (/\bforget\b/.test(t)) {
      const gone = prods.filter(id => P().dislikes.includes(id));
      if (gone.length) { P().dislikes = P().dislikes.filter(id => !gone.includes(id)); persist(); return say(`Okay, I've forgotten that you don't eat ${listText(gone.map(id => lower(products[id].name)))}.`); }
      const diet = DIETS.find(([v]) => t.includes(v === 'gluten' ? 'gluten' : v));
      if (diet && P().diet.includes(diet[0])) { P().diet = P().diet.filter(d => d !== diet[0]); persist(); return say(`Okay, I'm no longer filtering for ${lower(diet[1])}.`); }
    }
    const dietM = t.match(/\b(i'?m|i am|i eat|remember i'?m|i'?ve gone|i went)\s+(a\s+)?(vegetarian|vegan|halal|gluten[ -]?free|dairy[ -]?free)/);
    if (dietM) {
      const key = dietM[3].startsWith('gluten') ? 'gluten' : dietM[3].startsWith('dairy') ? 'dairy' : dietM[3];
      if (!P().diet.includes(key)) P().diet.push(key);
      if (key === 'vegan' && !P().diet.includes('vegetarian')) P().diet.push('vegetarian');
      persist();
      const n = D.recipes.filter(dietOk).length;
      return say(`Got it, I'll remember you're <b>${lower(DIETS.find(d => d[0] === key)[1])}</b>. ${plural(n, 'recipe')} fit.`, [aiAct('See meals', 'tab', 'meals')]);
    }
    if (/(don'?t like|do not like|don'?t eat|can'?t eat|hate|allergic|not a fan of|never eat|no more)/.test(t) && prods.length) {
      const add = prods.filter(id => !products[id].leftover);
      add.forEach(id => { if (!P().dislikes.includes(id)) P().dislikes.push(id); });
      persist();
      const hidden = D.recipes.filter(r => add.some(id => r.ingredients.some(i => !i.opt && (i.id === id || (i.alt || []).includes(id))))).length;
      const allergy = /allergic/.test(t) ? ' Always double check labels, since I only filter my own recipes.' : '';
      return say(`Got it, I'll remember you don't eat <b>${listText(add.map(id => lower(products[id].name)))}</b>. I've hidden ${plural(hidden, 'recipe')} that ${hidden === 1 ? 'needs' : 'need'} it.${allergy}`, [aiAct('See meals', 'tab', 'meals'), aiAct('What I remember', 'profile')]);
    }

    // Budget
    const budgetM = t.match(/budget\D{0,12}\$?\s*(\d{2,3})|\$\s*(\d{2,3})\s*(a|per|this|for the)\s*week/);
    if (budgetM && !isQuestion(t)) {
      P().budget = Number(budgetM[1] || budgetM[2]); persist();
      return say(`Updated: your weekly food budget is now <b>${money(P().budget)}</b>. I'll check trips against it.`);
    }

    // Week plan
    const weekM = t.match(/(plan|meal plan|meals? for|cook for|dinners? for)\b.*\b(week|weekdays|next (\d+) days)|(\d+)\s+(dinners|meals|days of (meals|dinners))/);
    if (weekM) {
      const n = Math.min(7, Number(weekM[3] || weekM[4]) || 5);
      const { plans, need, cost } = planWeek(n);
      if (!plans.length) return say("I couldn't build a plan with your current filters. Try loosening your diet settings.");
      aiCtx.lastRecipes = plans.map(a => a.r.id);
      aiCtx.lastRecipe = plans[0].r.id;
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const start = (new Date().getDay() + 6) % 7;
      const leftover = P().budget - cost - state.items.reduce((s, it) => s + ((bestNearby(it.id) || {}).price || 0) * it.qty, 0);
      if (need.length) aiCtx.pending = { act: 'addall', arg: need.join(','), label: `add ${plural(need.length, 'item')} to your list` };
      return say(`Here's ${n} days built around what expires first:${plans.map((a, i) => `<div class="ai-meal"><strong>${days[(start + i) % 7]}: ${a.r.name}</strong><span>${reasons(a)[0] || `${a.r.time} min`}</span>${aiAct('Open', 'recipe', a.r.id)}</div>`).join('')}
        <p>${need.length ? `You'd need <b>${plural(need.length, 'item')}</b> for about <b>${money(cost)}</b>, leaving roughly ${money(Math.max(0, leftover))} of your ${money(P().budget)} budget. Want me to add them to your list?` : 'You already have everything for this. Nice!'}</p>`,
        need.length ? [aiAct(`Add all ${need.length} to list`, 'addall', need.join(',')), aiAct('Plan the trip', 'addalltrip', need.join(','))] : []);
    }

    // Fridge edits: bought, used, threw out, froze, opened
    if (prods.length && !isQuestion(t)) {
      const names = ids => listText(ids.map(id => lower(products[id].name)));
      if (/(threw|thrown|tossed|went bad|gone off|go off|spoiled|moldy|mouldy|expired)/.test(t)) {
        const hit = prods.map(id => fridgeAll().find(f => f.id === id)).filter(Boolean);
        hit.forEach(f => tossItem(f)); persist();
        return say(hit.length ? `Logged ${names(hit.map(f => f.id))} as wasted. I'll warn you sooner next time${hit.some(f => (state.tossLog[f.id] || 0) >= 2) ? ', and suggest a smaller pack' : ''}.` : "I don't see that in your fridge.");
      }
      if (/\bfreez/.test(t)) {
        const hit = prods.map(id => fridgeAll().find(f => f.id === id && !f.frozen && products[id].freeze)).filter(Boolean);
        hit.forEach(freezeItem); persist();
        return say(hit.length ? `Moved ${names(hit.map(f => f.id))} to the freezer. ${hit.length === 1 ? 'It keeps' : 'They keep'} for months now.` : "That isn't in your fridge, or it doesn't freeze well.");
      }
      if (/\bopened\b/.test(t)) {
        const hit = prods.map(id => fridgeAll().find(f => f.id === id)).filter(Boolean);
        hit.forEach(markOpened); persist();
        return say(hit.length ? hit.map(f => `<b>${itemName(f)}</b> is now ${rangeText(f).toLowerCase()}.`).join(' ') : "I don't see that in your fridge.");
      }
      if (/(i (just )?(used|ate|finished|used up)|ran out of|i'?m out of|out of|all gone|finished the)/.test(t)) {
        const hit = prods.map(id => fridgeAll().find(f => f.id === id)).filter(Boolean);
        state.fridge = state.fridge.filter(f => !hit.includes(f)); persist();
        const buy = prods.filter(id => !products[id].leftover);
        if (/out of/.test(t) && buy.length) aiCtx.pending = { act: 'addall', arg: buy.join(','), label: `add ${names(buy)} to your list` };
        return say(`${hit.length ? `Removed ${names(hit.map(f => f.id))} from your fridge.` : ''} ${/out of/.test(t) && buy.length ? `Want me to add ${names(buy)} to your list?` : ''}`.trim() || 'Okay!',
          /out of/.test(t) && buy.length ? [aiAct('Add to list', 'addall', buy.join(','))] : []);
      }
      if (/(add|put|place|stick).*(to|on|onto|in)\s+(my |the )?(shopping )?list|^(i need|need|buy|get|grab|pick up)\b|add .* to shop/.test(t)) {
        const buy = prods.filter(id => !products[id].leftover);
        buy.forEach(id => { if (!state.items.some(it => it.id === id)) state.items.push({ id, qty: 1, why: 'Added by chat' }); });
        const total = buy.reduce((s, id) => s + ((bestNearby(id) || {}).price || 0), 0);
        return say(`Added ${names(buy)} to your list, about ${money(total)} at the cheapest stores near you.`, [aiAct('Plan my cheapest trip', 'trip'), aiAct('Open list', 'tab', 'shop')]);
      }
      if (/(remove|take|delete).*(off|from)\s+(my |the )?list/.test(t)) {
        state.items = state.items.filter(it => !prods.includes(it.id));
        return say(`Took ${names(prods)} off your list.`);
      }
      if (/(i (just )?(bought|got|picked up|grabbed|have|ve got)|add .* (to|in) (my |the )?fridge|put .* in (my |the )?fridge|^got\b)/.test(t)) {
        const added = prods.map(id => addToFridge(id, { src: /bought|picked|grabbed/.test(t) ? 'trip' : 'estimate' }));
        state.highlight = added.map(a => a.uid); persist();
        const usesAdded = a => a.have.filter(h => added.some(x => x.uid === h.f.uid)).length;
        const top = rankedMeals('all').filter(usesAdded).sort((a, b) => usesAdded(b) - usesAdded(a) || b.score - a.score)[0];
        if (top) { aiCtx.lastRecipe = top.r.id; aiCtx.lastRecipes = [top.r.id]; }
        return say(`Added ${added.map(f => `<b>${itemName(f)}</b> (${rangeText(f).toLowerCase()})`).join(', ')} to your fridge.${top ? ` That works great in <b>${top.r.name}</b>.` : ''}`, top ? [aiAct(`Open ${top.r.name}`, 'recipe', top.r.id), aiAct('See fridge', 'tab', 'fridge')] : [aiAct('See fridge', 'tab', 'fridge')]);
      }
    }

    // Cooked something
    const cookedM = /(i (just )?(made|cooked)|cooked the|made the)\b/.test(t);
    if (cookedM && rid) {
      cook(rid);
      aiCtx.awaitingRating = rid;
      const r = recipes[rid];
      return say(`Nice! I marked the fresh ingredients for <b>${r.name}</b> as used${r.serves >= 2 ? ' and added the leftovers to your fridge (good for 3 to 4 days)' : ''}. How was it?`, [aiAct('Loved it', 'rate', rid + ':1'), aiAct('Not for me', 'rate', rid + ':-1')]);
    }

    // "Add the missing items" for a recipe in view or just discussed
    if (rid && /add (the |all )?(missing|ingredients|what i need)/.test(t)) {
      const n = addMissing(rid);
      return say(n ? `Added ${plural(n, 'item')} for <b>${recipes[rid].name}</b> to your list.` : `You already have everything for <b>${recipes[rid].name}</b> on hand or on your list.`, n ? [aiAct('Plan my cheapest trip', 'trip'), aiAct('Open list', 'tab', 'shop')] : []);
    }

    // Recipe questions
    if (rid && !/(what can i make|ideas|suggest)/.test(t)) {
      const a = analyse(recipes[rid]);
      aiCtx.lastRecipe = rid;
      const r = a.r;
      if (/(how (do|to|would) (i )?(make|cook)|steps|instructions|method|recipe for)/.test(t)) {
        return say(`<b>${r.name}</b> (${r.time} min, serves ${r.serves}):<ol>${r.steps.map(s => `<li>${s}</li>`).join('')}</ol>`, [aiAct('Open recipe', 'recipe', rid)]);
      }
      if (/(how long|how much time|take)/.test(t)) return say(`<b>${r.name}</b> takes about <b>${r.time} minutes</b> and serves ${r.serves}.`, [aiAct('Open recipe', 'recipe', rid)]);
      if (/(cost|price|how much|expensive|cheap)/.test(t)) {
        return say(`To finish <b>${r.name}</b> you'd spend about <b>${money(a.needCost)}</b> (${money(a.perServing)} per serving).${a.have.length ? ` You already have ${plural(a.have.length, 'ingredient')}.` : ''}`, a.need.length ? [aiAct('Add missing items', 'addmissing', rid)] : []);
      }
      if (/(freeze|leftover|keep|store)/.test(t)) return say(`Leftover ${lower(r.name)} keeps 3 to 4 days in the fridge (Health Canada). ${['beefchili', 'chili', 'lentilcurry', 'tomatopasta'].includes(rid) ? 'It also freezes really well for 2 to 3 months.' : 'Most of it freezes okay for a few weeks.'}`);
      if (/(for (\d+)|double|half|scale)/.test(t)) {
        const n = Number((t.match(/for (\d+)/) || [])[1]) || (t.includes('double') ? r.serves * 2 : Math.ceil(r.serves / 2));
        return say(`<b>${r.name}</b> serves ${r.serves} as written. For ${n}, multiply everything by about <b>${(n / r.serves).toFixed(1)}</b>. Cooking time stays roughly the same.`);
      }
      if (/(swap|substitut|instead|replace|don'?t have)/.test(t)) {
        const miss = a.need.map(m => m.ing.id);
        const subs = miss.map(id => SUBS[id] ? `<li><b>${products[id].name}</b>: ${SUBS[id]}</li>` : '').join('');
        return say(subs ? `For <b>${r.name}</b>, you could swap:<ul>${subs}</ul>` : `You have everything for <b>${r.name}</b>, no swaps needed.`);
      }
      if (/(need|ingredient|missing|have|shopping|buy|add)/.test(t)) {
        if (a.need.length) aiCtx.pending = { act: 'addmissing', arg: rid, label: `add the ${plural(a.need.length, 'missing item')}` };
        return say(`For <b>${r.name}</b>:<ul>${a.have.map(h => `<li>Have: ${lower(itemName(h.f))}</li>`).join('')}${a.need.map(n => `<li>Need: <b>${lower(products[n.ing.id].name)}</b>${n.best ? `, ${money(n.best.price)} at ${stores[n.best.store].name}${n.best.deal ? ' (sale)' : ''}` : ''}</li>`).join('')}</ul>${a.need.length ? 'Want me to add the missing ones to your list?' : 'You have it all, go cook!'}`,
          a.need.length ? [aiAct(`Add ${a.need.length} missing`, 'addmissing', rid)] : [aiAct('Open recipe', 'recipe', rid)]);
      }
      const why = reasons(a);
      if (a.need.length) aiCtx.pending = { act: 'addmissing', arg: rid, label: `add the ${plural(a.need.length, 'missing item')}` };
      return say(`<b>${r.name}</b>: ${r.time} min, serves ${r.serves}, ${a.need.length ? `${plural(a.need.length, 'item')} to buy (${money(a.perServing)}/serving)` : 'nothing to buy'}.${why.length ? `<ul>${why.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}${roommateNote(a) ? `<p>${roommateNote(a)}.</p>` : ''}`,
        [aiAct('Open recipe', 'recipe', rid), ...(a.need.length ? [aiAct('Add missing', 'addmissing', rid)] : [])]);
    }

    // Item questions
    const pid = prods[0] || (/(it|that)\b/.test(t) ? aiCtx.lastProduct : null);
    if (pid && !/(what can i make|meal|recipe|cook|dinner|lunch|breakfast|ideas)/.test(t)) {
      aiCtx.lastProduct = pid;
      const p = products[pid];
      const f = fridgeAll().find(x => x.id === pid);
      if (/(swap|substitut|instead|replace|don'?t have|alternative)/.test(t)) return say(SUBS[pid] ? `Instead of <b>${lower(p.name)}</b>: ${SUBS[pid]}.` : `I don't have a good swap for ${lower(p.name)} yet.`);
      if (/(store|keep it|keep them|fridge or|where should i keep)/.test(t) && !/(still|good|safe)/.test(t)) return say(storageTip(p));
      if (/(price|cost|cheapest|where (can|do|should) i (buy|get)|on sale|deal)/.test(t)) {
        const b = bestNearby(pid);
        return say(b ? `Cheapest <b>${lower(p.name)}</b> near you is <b>${money(b.price)}</b> at ${stores[b.store].name}${b.deal ? ' (on sale this week)' : ''}. Regular price is about ${money(p.base)}.` : `I can't find ${lower(p.name)} within ${P().radius} km.`, b ? [aiAct('Add to list', 'additem', pid)] : []);
      }
      if (/(do i have|is there|have i got|any left)/.test(t)) return say(f ? `Yes, ${esc(f.qty)} of ${lower(itemName(f))}, ${rangeText(f).toLowerCase()} left${f.owner !== 'You' ? ` (it's ${f.owner === 'Shared' ? 'shared' : f.owner + "'s"})` : ''}.` : `No ${lower(p.name)} in your fridge. Want it on your list?`, f ? [] : [aiAct('Add to list', 'additem', pid)]);
      if (/(safe|still good|gone bad|go bad|smell|expire|expiry|best before|how long|last|spoil|off\b)/.test(t)) {
        const general = 'Best before dates are about quality, not safety (CFIA), but raw meat, fish and leftovers are the ones to be strict about. If it smells sour, feels slimy or looks off, throw it out. <b>When in doubt, throw it out.</b>';
        if (!f) return say(`${p.name} usually keeps about <b>${p.life} days</b>${p.open ? ` unopened and ${p.open} days once opened` : ''} in the fridge${p.freeze ? `, or ${Math.round(p.freeze / 30)} months frozen` : ''}. ${general}`);
        const top = rankedMeals('all').find(a => a.have.some(h => h.f.uid === f.uid));
        if (top) { aiCtx.lastRecipe = top.r.id; }
        return say(`<b>${esc(itemName(f))}</b>: ${rangeText(f).toLowerCase()} left. ${sourceText(f)} ${(p.flags || []).includes('meat') && daysHi(f) <= 2 ? 'Cook it today or freeze it.' : ''} ${general}`,
          [...(top ? [aiAct(`Cook ${top.r.name}`, 'recipe', top.r.id)] : []), ...(p.freeze && !f.frozen ? [aiAct('Freeze it', 'freeze', pid)] : [])]);
      }
    }

    // List and budget questions
    if (/(my list|shopping list|list cost|cost of my list|how much will)/.test(t)) {
      if (!state.items.length) return say('Your list is empty. Ask me for meal ideas and I can fill it with just what you need.');
      const lines = state.items.map(it => ({ it, b: bestNearby(it.id) }));
      const total = lines.reduce((s, x) => s + (x.b ? x.b.price * x.it.qty : 0), 0);
      return say(`Your list is ${plural(state.items.length, 'item')}, about <b>${money(total)}</b> at the cheapest stores near you. That's ${total <= P().budget ? `${money(P().budget - total)} under` : `${money(total - P().budget)} over`} your ${money(P().budget)} weekly budget.`, [aiAct('Plan my cheapest trip', 'trip'), aiAct('Open list', 'tab', 'shop')]);
    }

    // Fridge overview
    if (/(what'?s in my fridge|what do i have|my fridge|what have i got|inventory)/.test(t)) {
      const all = fridgeAll().filter(f => !f.frozen);
      if (!all.length) return say("Your fridge is empty. Scan it or tell me what you bought, like \"I bought eggs and spinach\".", [aiAct('Scan fridge', 'tab', 'fridge')]);
      const soon = all.filter(f => daysLeft(f) <= USE_SOON);
      return say(`You have ${plural(all.length, 'item')}${soon.length ? `, and these need using first:<ul>${soon.slice(0, 5).map(f => `<li><b>${esc(itemName(f))}</b>, ${rangeText(f).toLowerCase()}</li>`).join('')}</ul>` : ', and nothing is close to expiring.'}`, [aiAct('What can I make?', 'ask', 'What can I make tonight?')]);
    }

    // Trip planning, with optional changes
    if (/(trip|route|which store|where should i shop|plan my (shop|groceries)|go shopping|cheapest store)/.test(t)) {
      const changes = [];
      if (/\b(walk|walking|on foot)\b/.test(t)) { P().mode = 'walk'; changes.push('walking'); }
      if (/\b(bus|transit|ltc)\b/.test(t)) { P().mode = 'transit'; changes.push('by transit'); }
      if (/\b(drive|driving|car)\b/.test(t)) { P().mode = 'car'; changes.push('by car'); }
      const st = t.match(/(\d+|one|two|three)\s+stores?/);
      if (st) { P().maxStores = { one: 1, two: 2, three: 3 }[st[1]] || Number(st[1]); changes.push(`up to ${plural(P().maxStores, 'store')}`); }
      const kmM = t.match(/(\d+(\.\d+)?)\s*km/);
      if (kmM) { P().radius = Number(kmM[1]); changes.push(`within ${P().radius} km`); }
      persist();
      if (!state.items.length) {
        const top = rankedMeals('all').find(a => a.need.length);
        if (top) aiCtx.pending = { act: 'addplan', arg: top.r.id, label: `add what you need for ${top.r.name} and planned the trip` };
        return say(`Your list is empty. ${top ? `Want me to add what you need for <b>${top.r.name}</b> (${listText(top.need.map(n => lower(products[n.ing.id].name)))}) and plan the trip?` : 'Add a few items first.'}`, top ? [aiAct('Add and plan trip', 'addplan', top.r.id)] : [aiAct('Open Shop', 'tab', 'shop')]);
      }
      aiCtx.pending = { act: 'trip', arg: '', label: 'planned your trip' };
      return say(`${changes.length ? `Updated: ${changes.join(', ')}. ` : ''}I'll compare every store within ${P().radius} km for your ${plural(state.items.length, 'item')} and plan the cheapest ${MODES[P().mode].label.toLowerCase()} route. Ready?`, [aiAct('Plan my trip', 'trip'), aiAct('Open list', 'tab', 'shop')]);
    }

    // Deals
    if (/(sale|deal|discount|flyer|special)/.test(t)) {
      const near = nearbyStores();
      const deals = D.deals.filter(d => near.some(s => s.id === d.store) && !P().dislikes.includes(d.product))
        .sort((a, b) => (fridgeUseScore(b.product) - fridgeUseScore(a.product)));
      if (!deals.length) return say(`I don't see deals within ${P().radius} km. Try a longer distance in Shop.`, [aiAct('Open Shop', 'tab', 'shop')]);
      return say(`On sale near ${esc(home().name)} this week, most useful for your meals first:<ul>${deals.slice(0, 5).map(d => `<li><b>${products[d.product].name}</b> ${money(d.price)} at ${stores[d.store].name} <s>${money(products[d.product].base)}</s></li>`).join('')}</ul>`,
        deals.slice(0, 2).map(d => aiAct(`Add ${lower(products[d.product].name)}`, 'additem', d.product)));
    }

    // Use first
    if (/(use first|expir|going bad|about to|soon|waste|use up|go off)/.test(t)) {
      const exp = expiringItems();
      if (!exp.length) return say("Nothing is close to expiring. Nice work! Want ideas anyway?", [aiAct('Meal ideas', 'ask', 'What can I make tonight?')]);
      aiCtx.offset = 0;
      const top = rankedMeals('all').filter(a => a.expiring.length);
      aiCtx.lastRecipes = top.slice(0, 3).map(a => a.r.id);
      aiCtx.lastRecipe = aiCtx.lastRecipes[0];
      return say(`Use these first:<ul>${exp.slice(0, 4).map(f => `<li><b>${esc(itemName(f))}</b>, ${rangeText(f).toLowerCase()} left${f.owner !== 'You' && f.owner !== 'Shared' ? ` (${f.owner}'s)` : ''}</li>`).join('')}</ul>${top.length ? `Best way to use them:${top.slice(0, 2).map((a, i) => mealMini(a, i)).join('')}` : ''}`);
    }

    // Savings and progress
    if (/(saved|saving|impact|how much have|streak|progress|how am i doing)/.test(t)) {
      const total = state.cooked.reduce((n, x) => n + x.value, 0) + state.trips.reduce((n, x) => n + x.saved, 0);
      const rescued = state.cooked.reduce((n, x) => n + x.rescued, 0);
      const streak = weekStreak();
      return say(total ? `You've saved about <b>${money(total)}</b> and rescued <b>${plural(rescued, 'expiring item')}</b>${streak ? `, with a <b>${plural(streak, 'week')}</b> cooking streak` : ''}. ${state.tossed ? `You've thrown out ${plural(state.tossed, 'item')} so far.` : 'Nothing wasted yet!'}` : "Nothing tracked yet. Cook something from your fridge and I'll start counting.", [aiAct('See impact', 'tab', 'impact')]);
    }

    // Swaps in general
    if (/(swap|substitut|instead of|replace)/.test(t)) {
      return say('Easy student swaps:<ul><li>Yogurt for sour cream or mayo</li><li>Frozen spinach or veg for fresh (keeps for months)</li><li>Chicken thighs for breasts (cheaper, juicier)</li><li>Leftover rice for fresh in fried rice</li><li>Lentils or beans for half the ground beef</li></ul>Ask about a specific ingredient for more.');
    }

    // Follow ups on the last meal list
    if (aiCtx.lastQuery && /^(more|another|other|something else|different|next|show me more|any others)/.test(t)) {
      aiCtx.offset += 3;
      return showMeals(mealsFor(aiCtx.lastQuery), 'A few more', aiCtx.lastQuery);
    }
    if (aiCtx.lastQuery && t.split(/\s+/).length <= 6 && /(cheaper|quicker|faster|less time|make it|what about|vegetarian|vegan|without|gluten)/.test(t) && !prods.some(id => !(aiCtx.lastQuery.with || []).includes(id) && !/without/.test(t))) {
      const f = { ...aiCtx.lastQuery, ...parseFilters(t) };
      if (/cheaper/.test(t)) f.maxCost = Math.min(f.maxCost || 99, 2.5);
      if (/quicker|faster/.test(t)) f.maxTime = Math.min(f.maxTime || 99, 15);
      aiCtx.lastQuery = f; aiCtx.offset = 0;
      return showMeals(mealsFor(f), `Okay, ${describeFilters(f) || 'here you go'}`, f);
    }

    // Meal ideas
    if (/(make|cook|dinner|lunch|breakfast|recipe|tonight|hungry|eat|meal|idea|suggest|food|snack|quick|cheap|budget|under|vegetarian|vegan|serving|starving)/.test(t) || prods.length) {
      const f = parseFilters(t);
      if (!f.with && prods.length && /(with|using|have|use)/.test(t)) f.with = prods;
      aiCtx.lastQuery = f; aiCtx.offset = 0;
      const desc = describeFilters(f);
      const intro = fridgeAll().length ? `Based on your fridge${desc ? ` (${desc})` : ''}` : `Student favourites${desc ? ` (${desc})` : ''}`;
      return showMeals(mealsFor(f), intro, f);
    }

    if (/(what can you do|help|how does this work|what do you do)/.test(t)) {
      return say('I know your fridge, budget, diet and nearby deals. Try:<ul><li>"What can I make in 15 minutes?"</li><li>"I bought eggs and spinach"</li><li>"Plan my meals for the week"</li><li>"Is my chicken still good?"</li><li>"I\'m out of milk"</li><li>"Plan my trip walking, 1 store"</li><li>"Remember I\'m vegetarian"</li></ul>');
    }
    if (/^(hi|hey|hello|yo|sup)\b/.test(t)) return say(`Hey! ${expiringItems().length ? `Heads up: <b>${esc(itemName(expiringItems()[0]))}</b> (${dayWord(daysLeft(expiringItems()[0]))}). Want a recipe for it?` : 'What are you hungry for?'}`);
    if (/(thank|thanks|cheers|great|perfect|awesome|nice)/.test(t)) return say('Anytime. Happy cooking!');

    return say(`I didn't quite catch that. I can find meals, update your fridge or list, plan your week or your trip. Try "what can I make with chicken?" or "plan my meals for the week".`);
  }

  // How useful a sale item is for meals you could cook.
  const fridgeUseScore = pid => rankedMeals('all').slice(0, 8).filter(a => a.need.some(n => n.ing.id === pid)).length;

  const SUBS = {
    yogurt: 'sour cream, mayo, or a splash of milk', milk: 'water plus a little butter, or yogurt thinned with water', eggs: 'in pancakes, a mashed banana per egg',
    chicken_thighs: 'chicken breast, tofu, or a can of chickpeas', chicken_breast: 'chicken thighs (cheaper), or tofu', ground_beef: 'lentils or black beans (or half and half to stretch it)',
    spinach: 'frozen spinach, lettuce in a pinch, or any leafy green', cheddar: 'any cheese you have', tortillas: 'bread or a rice bowl instead',
    rice: 'leftover rice, pasta, or bread', pasta_sauce: 'chopped tomatoes with garlic and a pinch of salt', bell_pepper: 'carrots or any crunchy veg',
    broccoli: 'frozen mixed veg', tomatoes: 'pasta sauce or salsa', salsa: 'chopped tomatoes and onion', lettuce: 'spinach or cucumber',
    bread: 'tortillas', onions: 'green onions or a little garlic', garlic: 'garlic powder', black_beans: 'lentils or any canned beans', mushrooms: 'spinach or bell pepper',
    tofu: 'eggs or chickpeas', lentils: 'canned beans', cucumber: 'lettuce or carrots', oats: 'crushed cereal', bananas: 'apples, or skip it', potatoes: 'rice or pasta',
  };

  function storageTip(p) {
    const tips = {
      meat: 'Keep it on the bottom shelf in its package so it can\'t drip, and cook or freeze it within 1 to 2 days.',
      dairy: 'Keep it at the back of the fridge, not the door, where it stays coldest.',
      eggs: 'Keep eggs in their carton on a shelf, not the door.',
      bakery: 'Keep it on the counter for a few days, or freeze it and toast from frozen.',
      leftover: 'Cool it within 2 hours, keep it in a sealed container, and eat within 3 to 4 days.',
    };
    if (p.id === 'spinach' || p.id === 'lettuce') return 'Keep greens in the crisper drawer with a paper towel in the bag to soak up moisture. They last a few extra days that way.';
    if (p.id === 'tomatoes' || p.id === 'bananas' || p.id === 'potatoes' || p.id === 'onions') return `${p.name} keep best on the counter or in a cool, dark spot, not the fridge.`;
    return tips[p.cat] || `${p.name} keeps about ${p.life} days where it's usually stored.`;
  }

  // ----- live Claude (optional) -----

  const AI_URL = (window.SNARE_AI_URL || '').trim();

  // Everything the model needs to give personal answers, kept compact.
  function aiContext() {
    return {
      today: new Date().toDateString(),
      screen: state.screen,
      openRecipe: state.screen === 'recipe' ? state.recipeId : null,
      profile: { diet: P().diet, weeklyBudget: P().budget, area: home().name, travel: P().mode, radiusKm: P().radius, maxStores: P().maxStores || 'any', dislikes: P().dislikes, sharedHouse: P().house },
      fridge: fridgeAll().map(f => ({ product: f.id, name: itemName(f), qty: f.qty, left: rangeText(f), daysLeftEarliest: daysLeft(f), owner: f.owner, frozen: f.frozen, opened: f.opened })),
      shoppingList: state.items.map(it => ({ product: it.id, qty: it.qty, cheapest: (b => b ? `${money(b.price)} at ${stores[b.store].name}` : null)(bestNearby(it.id)) })),
      topMeals: rankedMeals('all').slice(0, 10).map(a => ({ id: a.r.id, name: a.r.name, minutes: a.r.time, serves: a.r.serves, why: reasons(a), have: a.have.map(h => h.f.id), need: a.need.map(n => n.ing.id), costPerServingToFinish: Number(a.perServing.toFixed(2)), studentLikePct: a.r.pop })),
      allRecipes: D.recipes.map(r => ({ id: r.id, name: r.name, minutes: r.time, meal: r.meal })),
      products: D.products.filter(p => !p.leftover).map(p => ({ id: p.id, name: p.name })),
      dealsNearby: D.deals.filter(d => nearbyStores().some(s => s.id === d.store)).map(d => ({ product: d.product, price: d.price, store: stores[d.store].name })),
      liked: Object.keys(state.ratings).filter(id => state.ratings[id] > 0),
      disliked: Object.keys(state.ratings).filter(id => state.ratings[id] < 0),
      learned: { oftenThrownOut: Object.keys(state.tossLog).filter(id => state.tossLog[id] >= 2), shelfLifeAdjustDays: Object.fromEntries(Object.keys(state.learn).filter(id => learnAdj(id)).map(id => [id, learnAdj(id)])) },
      progress: { mealsCooked: state.cooked.length, itemsRescued: state.cooked.reduce((n, x) => n + x.rescued, 0), streakWeeks: weekStreak() },
    };
  }

  // Map the model's actions onto the app's own actions, ignoring anything unknown.
  const LIVE_ACTS = {
    open_recipe: 'recipe', add_missing: 'addmissing', add_to_list: 'additem', remove_from_list: 'removeitem', add_to_fridge: 'fridgeadd',
    mark_used: 'useditem', freeze_item: 'freeze', plan_trip: 'trip', open_tab: 'tab', remember_dislike: 'dislike', set_diet: 'diet', set_budget: 'budget',
  };
  function validLiveAction(a) {
    const act = LIVE_ACTS[a.type];
    if (!act) return null;
    const tgt = String(a.target || '');
    if (['recipe', 'addmissing'].includes(act) && !recipes[tgt]) return null;
    if (['additem', 'removeitem', 'fridgeadd', 'useditem', 'freeze', 'dislike'].includes(act) && !products[tgt]) return null;
    if (act === 'tab' && !['fridge', 'meals', 'shop', 'impact', 'profile'].includes(tgt)) return null;
    if (act === 'diet' && !DIETS.some(d => d[0] === tgt)) return null;
    if (act === 'budget' && !(Number(tgt) > 0)) return null;
    return { act, arg: tgt, label: String(a.label || 'Do it').slice(0, 40), auto: !!a.auto };
  }

  // Light formatting for model text: escape, then **bold**, bullet lines and line breaks.
  function formatReply(s) {
    const lines = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
    let html = '', inList = false;
    for (const line of lines) {
      const m = line.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)/);
      if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += `<p>${line}</p>`;
    }
    return html + (inList ? '</ul>' : '');
  }

  async function liveReply(text) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...aiHistory.slice(-12), { role: 'user', content: text }], context: aiContext() }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('AI server ' + res.status);
      const data = await res.json();
      if (typeof data.reply !== 'string') throw new Error('Bad reply');
      const acts = (data.actions || []).map(validLiveAction).filter(Boolean);
      const done = acts.filter(a => a.auto).map(a => runAiAction(a.act, a.arg, true)).filter(Boolean);
      return {
        html: formatReply(data.reply) + (done.length ? `<p class="ai-done">${ICONS.check}${esc(done.join(' · '))}</p>` : ''),
        actions: acts.filter(a => !a.auto).map(a => aiAct(a.label, a.act, a.arg)),
        text: data.reply,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ----- chat panel -----

  function renderAI() {
    aiBox.hidden = !state.aiOpen;
    if (!state.aiOpen) return;
    const key = state.screen === 'recipe' ? 'recipe' : TAB_OF[state.screen];
    const chips = AI_CHIPS[key] || AI_CHIPS.fridge;
    aiBox.innerHTML = `
      <div class="ai-head"><span>${ICONS.spark}<strong>Ask SNARE</strong><small>Knows your fridge, budget and nearby deals</small></span><button class="icon-btn" data-ai="close" aria-label="Close">${ICONS.cross}</button></div>
      <div class="ai-msgs" id="ai-msgs">
        ${state.aiMsgs.map(m => `<div class="msg ${m.from}">${m.html}${m.actions && m.actions.length ? `<div class="msg-actions">${m.actions.join('')}</div>` : ''}</div>`).join('')}
        ${state.aiTyping ? '<div class="msg ai typing"><span></span><span></span><span></span></div>' : ''}
      </div>
      <div class="ai-chips">${chips.map(c => `<button class="chip" data-ai="ask" data-q="${esc(c)}">${c}</button>`).join('')}</div>
      <form class="ai-input" data-ai="form"><input id="ai-text" placeholder="Ask anything about food, your fridge or trips" autocomplete="off"><button class="btn small" aria-label="Send">${ICONS.send}</button></form>
      <p class="ai-note">${AI_URL ? (state.aiOffline ? 'Live AI unavailable, using the built in assistant.' : 'Powered by Claude. Answers can be wrong, so check food safety yourself.') : 'Built in assistant (prototype). Live Claude can be switched on in config.js.'}</p>`;
    const msgs = document.getElementById('ai-msgs');
    msgs.scrollTop = msgs.scrollHeight;
  }

  function openAI() {
    state.aiOpen = true;
    if (!state.aiMsgs.length) {
      const exp = expiringItems();
      const greet = `Hi! I can see your fridge, your ${money(P().budget)} weekly budget and deals near ${esc(home().name)}.${exp.length ? ` Heads up: <b>${esc(itemName(exp[0]))}</b> (${dayWord(daysLeft(exp[0]))}).` : ''} Ask me anything, or tell me what you bought.`;
      state.aiMsgs.push({ from: 'ai', html: greet });
    }
    renderAI();
    setTimeout(() => { const i = document.getElementById('ai-text'); if (i) i.focus(); }, 50);
  }

  async function askAI(text) {
    if (!text.trim() || state.aiTyping) return;
    state.aiMsgs.push({ from: 'you', html: esc(text) });
    state.aiTyping = true;
    renderAI();
    let reply;
    if (AI_URL) {
      try {
        reply = await liveReply(text);
        state.aiOffline = false;
      } catch (e) {
        state.aiOffline = true; // fall back to the built in brain
      }
    }
    if (!reply) {
      await new Promise(r => setTimeout(r, 450 + Math.random() * 350));
      reply = aiReply(text);
      reply.text = reply.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    aiHistory.push({ role: 'user', content: text }, { role: 'assistant', content: reply.text });
    state.aiTyping = false;
    state.aiMsgs.push({ from: 'ai', html: reply.html, actions: reply.actions });
    renderAI();
    if (['fridge', 'shop', 'meals', 'profile', 'impact'].includes(state.screen)) rerender();
  }

  // Runs an action from a chat button, a "yes", or the live model. Returns a
  // short past tense description when it changes something.
  function runAiAction(act, arg, quiet) {
    const ids = String(arg || '').split(',').filter(Boolean);
    let done = '';
    if (act === 'recipe') { state.aiOpen = false; openRecipe(arg); }
    else if (act === 'tab') { state.aiOpen = false; openTab(arg); }
    else if (act === 'profile') { state.aiOpen = false; go('profile'); }
    else if (act === 'ask') { askAI(arg); return ''; }
    else if (act === 'addmissing') { const n = addMissing(arg); done = `added ${plural(n, 'item')} for ${recipes[arg].name} to your list`; }
    else if (act === 'addall' || act === 'addalltrip') {
      ids.forEach(id => { if (!state.items.some(it => it.id === id)) state.items.push({ id, qty: 1, why: 'Week plan' }); });
      done = `added ${plural(ids.length, 'item')} to your list`;
      if (act === 'addalltrip') { state.aiOpen = false; findTrip(); }
    }
    else if (act === 'additem') { if (!state.items.some(it => it.id === arg)) state.items.push({ id: arg, qty: 1, why: 'Added by chat' }); done = `added ${lower(products[arg].name)} to your list`; }
    else if (act === 'removeitem') { state.items = state.items.filter(it => it.id !== arg); done = `took ${lower(products[arg].name)} off your list`; }
    else if (act === 'fridgeadd') { const f = addToFridge(arg); state.highlight = [f.uid]; persist(); done = `added ${lower(products[arg].name)} to your fridge`; }
    else if (act === 'useditem') { const f = fridgeAll().find(x => x.id === arg); if (f) { state.fridge = state.fridge.filter(x => x !== f); persist(); done = `marked ${lower(itemName(f))} as used`; } }
    else if (act === 'freeze') { const f = fridgeAll().find(x => x.id === arg && !x.frozen); if (f) { freezeItem(f); persist(); done = `froze your ${lower(itemName(f))}`; } }
    else if (act === 'dislike') { if (!P().dislikes.includes(arg)) P().dislikes.push(arg); persist(); done = `will remember you don't eat ${lower(products[arg].name)}`; }
    else if (act === 'diet') { if (!P().diet.includes(arg)) P().diet.push(arg); persist(); done = `will only show ${lower(DIETS.find(d => d[0] === arg)[1])} meals`; }
    else if (act === 'budget') { P().budget = Number(arg); persist(); done = `set your weekly budget to ${money(P().budget)}`; }
    else if (act === 'rate') { const [rid, v] = arg.split(':'); state.ratings[rid] = Number(v); aiCtx.awaitingRating = null; persist(); done = Number(v) > 0 ? `will suggest more like ${recipes[rid].name}` : `won't suggest ${recipes[rid].name} again`; }
    else if (act === 'trip') { state.aiOpen = false; findTrip(); done = 'planned your trip'; }
    else if (act === 'addplan') { const n = addMissing(arg); state.aiOpen = false; findTrip(); done = `added ${plural(n, 'item')} and planned your trip`; }
    if (!quiet && done && !['addmissing', 'addplan'].includes(act)) toast(done.charAt(0).toUpperCase() + done.slice(1)); // addMissing shows its own
    renderAI();
    if (state.screen !== 'loading' && !state.aiOpen) return done;
    if (['fridge', 'shop', 'meals', 'profile'].includes(state.screen)) rerender();
    return done;
  }

  // ---------- maps ----------

  const HOME_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>';
  const routeCache = {};

  function addTiles(m) {
    // Esri tiles load from a local file and from any host, unlike the
    // OpenStreetMap servers, which return an "Access blocked" image.
    const base = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    L.tileLayer(base + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, errorTileUrl: blank, attribution: 'Tiles &copy; Esri' }).addTo(m);
    L.tileLayer(base + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, errorTileUrl: blank, className: 'map-labels' }).addTo(m);
  }

  const homeIcon = () => L.divIcon({ className: '', html: `<div class="pin home pulse">${HOME_SVG}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });

  // Road geometry from the free OpenStreetMap routing service. Falls back to
  // straight lines if it is slow or offline.
  async function roadRoute(points) {
    const coords = points.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    const profile = P().mode === 'walk' ? 'routed-foot' : 'routed-car';
    const key = profile + coords;
    if (key in routeCache) return routeCache[key];
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`https://routing.openstreetmap.de/${profile}/route/v1/driving/${coords}?overview=full&geometries=geojson`, { signal: ctrl.signal });
      const data = await res.json();
      routeCache[key] = data.routes && data.routes[0] ? data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]) : null;
    } catch (e) {
      routeCache[key] = null;
    }
    return routeCache[key];
  }

  function drawScan(start, inRange) {
    const el = document.getElementById('scan-map');
    if (!el || !window.L) return;
    map = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false, boxZoom: false });
    addTiles(map);
    const centre = L.latLng(start.lat, start.lng);
    const meters = P().radius * 1000;
    map.fitBounds(centre.toBounds(meters * 2.3), { animate: false });
    L.marker(centre, { icon: homeIcon(), zIndexOffset: 1000 }).addTo(map);

    const ring = L.circle(centre, { radius: 0.1, color: '#004230', weight: 2, fillColor: '#A2DC5D', fillOpacity: 0.2 }).addTo(map);
    const thisMap = map, grow = 1400, t0 = performance.now();
    (function tick(now) {
      if (map !== thisMap) return;
      const k = Math.min(1, Math.max(0, (now - t0) / grow));
      ring.setRadius(meters * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    })(t0);

    // Each store appears as the ring reaches it, then gets checked off.
    inRange.forEach(s => {
      const reach = 1 - Math.cbrt(1 - Math.min(1, km(start, s) / P().radius)); // when the eased ring passes it
      setTimeout(() => {
        if (map !== thisMap) return;
        const m = L.marker([s.lat, s.lng], {
          icon: L.divIcon({ className: '', html: `<div class="scan-pin">${ICONS.check}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        }).addTo(map);
        setTimeout(() => { const e = m.getElement(); if (e) e.firstChild.classList.add('checked'); }, 600);
      }, 100 + reach * grow);
    });
  }

  function drawMap(start, p, animate) {
    const el = document.getElementById('map');
    if (!el) return;
    if (!window.L) { el.innerHTML = '<div class="fallback">Map needs an internet connection.</div>'; return; }
    map = L.map(el, { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    addTiles(map);
    const pts = [[start.lat, start.lng], ...p.order.map(s => [s.lat, s.lng])];
    L.marker(pts[0], { icon: homeIcon(), zIndexOffset: 1000 }).addTo(map);
    p.order.forEach((s, i) => {
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', html: `<div class="pin store ${animate ? 'drop' : ''}" style="animation-delay:${300 + i * 220}ms">${i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).addTo(map).bindTooltip(esc(s.name), { permanent: true, direction: 'top', offset: [0, -16], className: 'map-label' });
    });
    map.fitBounds(pts, { padding: [48, 48], maxZoom: 15 });

    const thisMap = map;
    const loop = [...pts, pts[0]].map(([lat, lng]) => ({ lat, lng }));
    roadRoute(loop).then(road => {
      if (map !== thisMap) return;
      const line = road || loop.map(q => [q.lat, q.lng]);
      const casing = L.polyline(line, { color: '#fff', weight: 9, opacity: 0.95, lineJoin: 'round' }).addTo(map);
      const route = L.polyline(line, { color: '#004230', weight: 4.5, lineJoin: 'round', dashArray: road ? null : '7 8' }).addTo(map);
      if (animate && road) {
        [casing, route].forEach(l => {
          const path = l.getElement();
          path.setAttribute('pathLength', '1');
          path.classList.add('route-draw');
        });
      }
      casing.bringToBack();
    });
  }

  // ---------- navigation ----------

  function go(screen) {
    state.screen = screen;
    render();
    renderAI();
    viewport.scrollTop = 0;
  }

  function replan(keepScroll) {
    const y = viewport.scrollTop;
    result = plan();
    render();
    viewport.scrollTop = keepScroll ? y : 0;
  }

  function rerender() {
    const y = viewport.scrollTop;
    render();
    viewport.scrollTop = y;
  }

  function openTab(tab) {
    if (tab === 'shop' && result && state.screen !== 'results' && state.lastPlannedList === listKey()) go('results');
    else go(tab);
  }

  function openRecipe(id) {
    state.recipeId = id;
    state.views[id] = (state.views[id] || 0) + 1;
    persist();
    if (state.justCooked !== id) state.justCooked = null;
    state.feedbackChip = null;
    go('recipe');
  }

  const listKey = () => state.items.map(it => it.id + it.qty).join(',');

  function findTrip() {
    if (!state.items.length) { toast('Add something to your list first'); go('shop'); return; }
    state.loggedTrip = false;
    go('loading');
    setTimeout(() => {
      result = plan();
      state.lastPlannedList = listKey();
      fresh = true;
      go('results');
    }, LOADING_MS);
  }

  function addToList(id) {
    const it = state.items.find(x => x.id === id);
    if (it) it.qty++;
    else state.items.push({ id, qty: 1 });
    state.query = '';
    toast(`${products[id].name} added to your list`);
  }

  // ---------- events ----------

  app.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn && app.contains(tabBtn)) { openTab(tabBtn.dataset.tab); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    if (el.classList.contains('meal') && e.target.closest('button')) return; // inner buttons handle themselves

    switch (action) {
      // profile and onboarding
      case 'diet': {
        const d = P().diet;
        P().diet = d.includes(id) ? d.filter(x => x !== id) : [...d, id];
        if (id === 'vegan' && !d.includes(id) && !P().diet.includes('vegetarian')) P().diet.push('vegetarian');
        persist(); rerender(); break;
      }
      case 'budget': P().budget = Number(id); persist(); rerender(); break;
      case 'mode': P().mode = id; persist(); el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); break;
      case 'finishwelcome': P().done = true; persist(); go(id === 'scan' ? 'scan' : 'fridge'); break;
      case 'profile': go('profile'); break;
      case 'forget': P().dislikes = P().dislikes.filter(x => x !== id); persist(); rerender(); break;
      case 'unrate': delete state.ratings[id]; persist(); rerender(); break;
      case 'house': toggleHouse(!P().house); toast(P().house ? `Sharing your fridge with ${listText(D.housemates)}` : 'Shared fridge turned off'); rerender(); break;
      case 'reset':
        if (confirm('Clear your fridge, ratings and history and start over?')) {
          try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
          location.hash = '';
          location.reload();
        }
        break;

      // fridge
      case 'goscan': go('scan'); break;
      case 'ffilter': state.fridgeFilter = id; rerender(); break;
      case 'used': {
        const f = state.fridge.find(x => x.uid === id);
        state.fridge = state.fridge.filter(x => x.uid !== id);
        toast(`${itemName(f)} marked as used`);
        persist(); rerender(); break;
      }
      case 'tossed':
      case 'igone': {
        const f = state.fridge.find(x => x.uid === id);
        tossItem(f);
        toast(`${itemName(f)} logged as wasted. We'll warn you sooner next time.`);
        persist(); rerender(); break;
      }
      case 'openitem': state.openItem = state.openItem === id ? null : id; rerender(); break;
      case 'iopen': { const f = state.fridge.find(x => x.uid === id); markOpened(f); toast(`${itemName(f)} marked opened: ${rangeText(f).toLowerCase()} left`); persist(); rerender(); break; }
      case 'ifreeze': { const f = state.fridge.find(x => x.uid === id); freezeItem(f); state.openItem = null; toast(`${itemName(f)} moved to the freezer. Good for about ${Math.round(products[f.id].freeze / 30)} months.`); persist(); rerender(); break; }
      case 'ithaw': { const f = state.fridge.find(x => x.uid === id); thawItem(f); toast(`${itemName(f)} thawed. Use it within 2 days.`); persist(); rerender(); break; }
      case 'igood': { const f = state.fridge.find(x => x.uid === id); stillGood(f); toast(`Thanks! We'll expect ${lower(products[f.id].name)} to last a little longer for you.`); persist(); rerender(); break; }
      case 'nudgeok': state.nudgeDismissed.push(id); rerender(); break;
      case 'forgetlearned': state.learn = {}; state.tossLog = {}; state.views = {}; persist(); rerender(); break;

      // scanning
      case 'demoshelf': startShelfScan('demo'); break;
      case 'demoitem': startItemScan(null); break;
      case 'typeitems': state.scan = { mode: 'type', found: [] }; state.query = ''; go('review'); break;
      case 'rkeep': state.scan.found[id].keep = !state.scan.found[id].keep; rerender(); break;
      case 'rdays': { const f = state.scan.found[id]; f.days = Math.max(0, f.days + Number(el.dataset.d)); rerender(); break; }
      case 'radd': {
        state.scan.found.push({ id, qty: products[id].unit, days: products[id].life, conf: null, keep: true });
        state.query = ''; rerender(); break;
      }
      case 'ifix': {
        const f = state.scan.found[0];
        Object.assign(f, { id, qty: products[id].unit, days: products[id].life, conf: null, label: false });
        state.query = ''; rerender(); break;
      }
      case 'rescan': { const n = confirmScan(); toast(`${plural(n, 'item')} added. Scan the next shelf.`); go('scan'); break; }
      case 'rconfirm': { const n = confirmScan(); toast(`${plural(n, 'item')} added to your fridge`); go('fridge'); break; }
      case 'inext': {
        const n = confirmScan();
        toast(`${products[state.scan.found[0].id].name} added. Next item!`);
        if (n && String(state.scan.photo).startsWith('demo-item:')) startItemScan(null);
        else document.getElementById('next-photo').click();
        break;
      }
      case 'idone': confirmScan(); toast(`${products[state.scan.found[0].id].name} added to your fridge`); go('fridge'); break;

      // meals
      case 'mfilter': state.mealFilter = id; rerender(); break;
      case 'recipe': openRecipe(id); break;
      case 'addmissing': addMissing(id); rerender(); break;
      case 'cook': cook(id); go('recipe'); toast('Nice! Your fridge and impact are updated.'); break;
      case 'fchip': state.feedbackChip = state.feedbackChip === id ? null : id; rerender(); break;
      case 'rate': {
        const r = recipes[state.recipeId];
        state.ratings[r.id] = Number(id);
        if (state.feedbackChip) state.feedback[r.id] = state.feedbackChip;
        persist();
        state.justCooked = null;
        state.justRated = Number(id) > 0
          ? `You liked ${r.name}, so similar meals now rank higher.`
          : `Got it. ${r.name} won't be suggested again unless you search for it.`;
        state.mealFilter = 'all';
        go('meals');
        break;
      }

      // shop and trip
      case 'add': addToList(id); rerender(); break;
      case 'qty': {
        const it = state.items.find(x => x.id === id);
        it.qty += Number(el.dataset.d);
        if (it.qty <= 0) state.items = state.items.filter(x => x !== it);
        rerender(); break;
      }
      case 'rescue':
        state.rescueAdded = state.rescueAdded.includes(id) ? state.rescueAdded.filter(x => x !== id) : [...state.rescueAdded, id];
        if (state.screen === 'results') replan(true); else rerender();
        break;
      case 'radius': setRadius(el.dataset.val); break;
      case 'stores':
        P().maxStores = Math.min(D.stores.length, Math.max(1, (P().maxStores || D.stores.length) + Number(el.dataset.d)));
        persist(); renderStoreLimit(); break;
      case 'nolimit': P().maxStores = P().maxStores ? 0 : 2; persist(); renderStoreLimit(); break;
      case 'locate':
        if (!navigator.geolocation) { alert('Location is not available in this browser.'); break; }
        navigator.geolocation.getCurrentPosition(pos => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (km(here, areas.downtown) > 30) { alert('The demo data only covers London, Ontario, so pick a London area for now.'); return; }
          state.myLocation = here;
          P().area = 'me';
          rerender();
        }, () => alert('Could not get your location. Pick an area instead.'));
        break;
      case 'find': findTrip(); break;
      case 'edit': go('shop'); break;
      case 'pick': state.selected = id; replan(true); break;
      case 'swap':
        state.items.forEach(it => { if (it.id === el.dataset.from) it.id = el.dataset.to; });
        replan(true); break;
      case 'log': {
        const p = result.options.find(o => o.id === state.selected).plan;
        state.trips.push(tripRecord(p));
        const bought = Object.values(p.assign).flat();
        const added = bought.map(l => addToFridge(l.id, { src: 'trip' }));
        state.highlight = added.map(a => a.uid);
        state.items = state.items.filter(it => !bought.some(l => l.id === it.id));
        state.loggedTrip = true;
        result = null;
        persist();
        toast(`${plural(added.length, 'item')} added to your fridge. Savings added to Impact.`);
        go('fridge');
        break;
      }

      // impact
      case 'sample': sampleHistory(); persist(); rerender(); break;
      case 'clearhistory':
        if (confirm('Clear your meal and trip history?')) { state.cooked = []; state.trips = []; state.tossed = 0; persist(); rerender(); }
        break;
    }
  });

  app.addEventListener('input', e => {
    if (e.target.id === 'q') { state.query = e.target.value; renderSuggest(); }
    if (e.target.id === 'radius') setRadius(e.target.value, 'range');
    if (e.target.id === 'radius-num' && e.target.value !== '') setRadius(e.target.value, 'num');
  });

  app.addEventListener('change', e => {
    if (e.target.classList.contains('label-date') && e.target.value) {
      const f = state.fridge.find(x => x.uid === e.target.dataset.id);
      setLabelDate(f, e.target.value);
      toast(`${itemName(f)} set to the label date, ${fmtDate(f.expHi)}`);
      persist(); rerender(); return;
    }
    if (e.target.id === 'area') { P().area = e.target.value; persist(); }
    if (e.target.id === 'radius-num') setRadius(e.target.value);
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (e.target.id === 'shelf-photo') startShelfScan(reader.result);
      if (e.target.id === 'item-photo' || e.target.id === 'next-photo') startItemScan(reader.result);
    };
    reader.readAsDataURL(file);
  });

  app.addEventListener('keydown', e => {
    if (e.target.id === 'q' && e.key === 'Enter') {
      const first = document.querySelector('#suggest button');
      if (first) first.click();
    }
  });

  document.getElementById('tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) openTab(b.dataset.tab);
  });

  document.querySelector('.bar').addEventListener('click', e => {
    if (e.target.closest('[data-action="home"]')) go(P().done ? 'fridge' : 'welcome');
    if (e.target.closest('[data-action="profile"]')) go('profile');
  });

  aiFab.addEventListener('click', openAI);
  aiBox.addEventListener('click', e => {
    const a = e.target.closest('[data-ai]');
    if (a && a.dataset.ai === 'close') { state.aiOpen = false; renderAI(); return; }
    if (a && a.dataset.ai === 'ask') { askAI(a.dataset.q); return; }
    const act = e.target.closest('[data-action="aiact"]');
    if (act) runAiAction(act.dataset.act, act.dataset.arg);
  });
  aiBox.addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('ai-text');
    askAI(input.value);
  });

  // Wide screens: switch between the phone mockup and a large expanded view.
  const expandBtn = document.getElementById('expand');
  function setExpanded(on) {
    document.body.classList.toggle('expanded', on);
    expandBtn.innerHTML = on ? `${ICONS.shrink}<span>Phone view</span>` : `${ICONS.expand}<span>Expand</span>`;
    try { localStorage.setItem('snare.expanded', on ? '1' : ''); } catch (e) { /* ignore */ }
    setTimeout(() => { if (map) map.invalidateSize(); }, 420);
  }
  expandBtn.addEventListener('click', () => setExpanded(!document.body.classList.contains('expanded')));
  let startExpanded = false;
  try { startExpanded = localStorage.getItem('snare.expanded') === '1'; } catch (e) { /* ignore */ }
  setExpanded(startExpanded);

  backBtn.addEventListener('click', () => {
    const to = { scan: 'fridge', review: 'scan', recipe: 'meals', results: 'shop', profile: 'fridge' }[state.screen];
    if (to) go(to);
  });

  // Deep links for demos: #demo loads a sample fridge, #welcome starts over,
  // #meals, #shop and #impact open those tabs.
  const hash0 = location.hash.slice(1);
  if (hash0 === 'welcome') {
    state.profile = defaultProfile();
    state.fridge = [];
    persist();
    go('welcome');
  } else if (hash0 === 'demo') {
    P().done = true;
    state.fridge = [];
    D.demoScan.forEach(x => addToFridge(x.id, x));
    persist();
    go('fridge');
  } else if (['meals', 'shop', 'impact', 'fridge'].includes(hash0)) {
    P().done = true;
    go(hash0);
  } else {
    go(P().done ? 'fridge' : 'welcome');
  }
})();
