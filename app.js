(function () {
  'use strict';

  const D = window.SNARE_DATA;
  const app = document.getElementById('app');
  const backBtn = document.getElementById('back');
  const viewport = document.getElementById('viewport');

  const byId = list => Object.fromEntries(list.map(x => [x.id, x]));
  const products = byId(D.products);
  const stores = byId(D.stores);
  const supports = byId(D.support);
  const groupsById = byId(D.groups);
  const rescues = byId(D.rescue);
  const areas = byId(D.areas);

  // Travel assumptions. kmh is average door to door speed; perStop covers
  // parking, perLeg covers waiting for a bus.
  const MODES = {
    car: { label: 'Car', kmh: 35, perStop: 4, perLeg: 0, co2: 0.17 },
    transit: { label: 'Transit', kmh: 18, perStop: 0, perLeg: 9, co2: 0.05 },
    walk: { label: 'Walk', kmh: 4.8, perStop: 0, perLeg: 0, co2: 0 },
  };
  const ROAD_FACTOR = 1.35;   // straight line distance to rough road distance
  const TIME_VALUE = 15;      // dollars per hour, used to pick the balanced option
  const MIN_SWAP_SAVING = 0.25;
  const MAX_RADIUS = 30;      // km
  const LOADING_MS = 2900;    // length of the "finding your trip" animation
  const EXACT_ROUTE_LIMIT = 7; // above this many stops, use a quick nearest stop route

  const QUICK = ['milk', 'eggs', 'bread', 'bananas', 'rice', 'chicken_breast', 'pasta', 'apples'];

  const PRESETS = {
    busy: {
      area: 'masonville', mode: 'car', radius: 8, maxStores: 2, budget: 95, selected: 'quickest',
      items: [['milk', 1], ['eggs', 1], ['bread', 1], ['chicken_breast', 1], ['pasta', 2], ['pasta_sauce', 2], ['apples', 1], ['coffee', 1], ['cereal', 1], ['cheddar', 1], ['yogurt', 1], ['spinach', 1]],
    },
    tight: {
      area: 'oldeast', mode: 'transit', radius: 4, maxStores: 2, budget: 55, selected: 'cheapest',
      items: [['milk', 1], ['eggs', 1], ['bread', 1], ['rice', 1], ['black_beans', 2], ['chicken_breast', 1], ['ground_beef', 1], ['potatoes', 1], ['onions', 1], ['carrots', 1], ['cereal', 1], ['peanut_butter', 1], ['apples', 1], ['yogurt', 1]],
    },
    eco: {
      area: 'downtown', mode: 'walk', radius: 3, maxStores: 2, budget: 45, selected: 'balanced',
      items: [['tomatoes', 1], ['lettuce', 1], ['bread', 1], ['eggs', 1], ['yogurt', 1], ['tofu', 1], ['lentils', 1], ['pasta', 1], ['bananas', 1], ['carrots', 1]],
    },
  };

  // Alerts and trip history are kept in this browser only.
  const STORE_KEY = 'snare.v1';
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        priceAlerts: state.priceAlerts, rescueAlerts: state.rescueAlerts, trips: state.trips,
        joinedGroups: state.joinedGroups, userPosts: state.userPosts, userComments: state.userComments,
        votes: state.votes,
      }));
    } catch (e) { /* storage blocked, keep working in memory */ }
  }
  const saved = loadSaved();

  const state = {
    screen: 'home',
    items: [],
    area: 'downtown',
    myLocation: null,
    radius: 5,
    maxStores: 2,
    budget: 60,
    mode: 'car',
    extraStops: [],
    rescueAdded: [],
    selected: null,
    query: '',
    loggedTrip: false,
    priceAlerts: saved.priceAlerts || [{ product: 'chicken_thighs', target: 8.5 }, { product: 'coffee', target: 9.5 }],
    rescueAlerts: saved.rescueAlerts || { on: true, cats: ['Produce', 'Bakery'] },
    trips: saved.trips || [],
    // Community
    joinedGroups: saved.joinedGroups || ['g-downtown', 'g-oldeast'],
    userPosts: saved.userPosts || [],
    userComments: saved.userComments || {},
    votes: saved.votes || {},
    communityStops: [], // for this visit only, like the list
    planDirty: false,   // list or stops changed since the last trip was planned
    communityView: 'mine',
    groupId: null,
    openComments: [],
    draft: { text: '', place: '', photo: null, loc: null },
    liveShown: false,
  };
  let map = null;
  let result = null;
  let fresh = false; // true right after the loading animation, so results animate in

  // ---------- helpers ----------

  const money = n => '$' + n.toFixed(2);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

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
    if (state.area === 'me' && state.myLocation) return { name: 'Your location', ...state.myLocation };
    return areas[state.area];
  }

  // Price of a product at a store this week, or null if the store doesn't stock it.
  function priceAt(storeId, productId) {
    const s = stores[storeId], p = products[productId];
    if (s.carries && !s.carries.includes(p.cat)) return null;
    const deal = D.deals.find(d => d.store === storeId && d.product === productId);
    if (deal) return { price: deal.price, deal: true };
    const variance = (hash(storeId + ':' + productId) % 15 - 7) / 100;
    const raw = p.base * s.factor * (1 + variance);
    return { price: Math.max(0.49, Math.round(raw * 10) / 10 - 0.01), deal: false };
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

  const storeLimitText = () => state.maxStores ? 'up to ' + plural(state.maxStores, 'store') : 'any number of stores';

  // ---------- planner ----------

  function plan() {
    const start = home();
    const nearby = D.stores.filter(s => km(start, s) <= state.radius);
    const items = state.items;
    const coverable = items.filter(it => nearby.some(s => priceAt(s.id, it.id)));
    const missing = items.filter(it => !coverable.includes(it));
    const extras = [
      ...state.extraStops.map(id => ({ kind: 'help', ...supports[id] })),
      ...tipStops().map(t => ({ kind: 'tip', id: t.id, name: t.place, lat: t.lat, lng: t.lng })),
    ];
    const mode = MODES[state.mode];
    const totalQty = coverable.reduce((n, it) => n + it.qty, 0);

    const plans = [];
    const limit = state.maxStores ? Math.min(state.maxStores, nearby.length) : nearby.length;
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

        const stops = [...subset.map(s => ({ kind: 'store', ...s })), ...extras];
        const route = bestOrder(start, stops);
        const travel = route.km / mode.kmh * 60 + mode.perStop * stops.length + mode.perLeg * (stops.length + 1);
        const shopping = k * 8 + totalQty * 0.6 + extras.reduce((t, x) => t + (x.kind === 'help' ? 15 : 10), 0);
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

  // Rescue offers the user saved that sit at a store on this route.
  function routeRescue(p) {
    return state.rescueAdded.map(id => rescues[id]).filter(x => p.order.some(s => s.kind === 'store' && s.id === x.store));
  }

  // ---------- community ----------

  const pageLoaded = Date.now();
  let livePosts = [];

  function allPosts() {
    const seeded = D.posts.map(p => ({ ...p, createdAt: pageLoaded - p.minutesAgo * 60000 }));
    return [...state.userPosts, ...livePosts, ...seeded].sort((a, b) => b.createdAt - a.createdAt);
  }
  const postById = id => allPosts().find(p => p.id === id);
  const tipStops = () => state.communityStops.map(postById).filter(Boolean);

  function commentsFor(post) {
    const seeded = (post.comments || []).map(c => ({ ...c, createdAt: c.createdAt || pageLoaded - c.minutesAgo * 60000 }));
    return [...seeded, ...(state.userComments[post.id] || [])];
  }

  function voteCounts(post) {
    const mine = state.votes[post.id];
    return { mine, there: post.there + (mine === 'there' ? 1 : 0), gone: post.gone + (mine === 'gone' ? 1 : 0) };
  }

  function ago(t) {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    return Math.round(m / 1440) + ' d ago';
  }

  function avatar(name) {
    const initials = name === 'You' ? 'You' : name.split(' ').map(w => w[0]).join('').slice(0, 2);
    const hue = 70 + hash(name) % 90; // greens through teals
    return `<span class="avatar" style="background:hsl(${hue} 45% 82%);color:hsl(${hue} 60% 22%)">${esc(initials)}</span>`;
  }

  // Shrink a photo before keeping it, so posts stay small enough to save.
  function readPhoto(file, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // Current location for a post. The demo data is London only, so anywhere
  // else falls back to a spot near the trip's starting area.
  function locateForPost(cb) {
    const fallback = why => {
      const h = home();
      cb({ lat: h.lat + (Math.random() - 0.5) * 0.006, lng: h.lng + (Math.random() - 0.5) * 0.006, label: `Near ${h.name} (${why})` });
    };
    if (!navigator.geolocation) return fallback('location unavailable');
    navigator.geolocation.getCurrentPosition(pos => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (km(here, areas.downtown) > 30) fallback('demo, you are outside London');
      else cb({ ...here, label: 'Your current location' });
    }, () => fallback('location not shared'), { timeout: 8000 });
  }

  // For the demo: a new post arrives a few seconds after opening the feed.
  function scheduleLivePost() {
    if (state.liveShown) return;
    state.liveShown = true;
    setTimeout(() => {
      const gid = state.joinedGroups.find(id => groupsById[id].kind === 'area') || 'g-downtown';
      const g = groupsById[gid];
      const spot = areas[g.area] || areas.downtown;
      const store = [...D.stores].sort((a, b) => km(spot, a) - km(spot, b))[0];
      livePosts.push({
        id: 'live1', group: gid, author: 'Rosa V.', createdAt: Date.now(), fresh: true,
        text: `Bananas 3 lb for $1 at ${store.name} on ${store.where}. Lots left!`,
        place: `${store.name}, ${store.where}`, lat: store.lat, lng: store.lng, there: 1, gone: 0, comments: [],
      });
      if (['community', 'group'].includes(state.screen)) {
        toast(`New post in ${g.name}`);
        rerender();
      }
    }, 6000);
  }

  // ---------- alerts ----------

  const RESCUE_CATS = ['Produce', 'Bakery', 'Meat', 'Dairy', 'Prepared'];

  function nearbyStores() {
    const start = home();
    return D.stores.filter(s => km(start, s) <= state.radius);
  }

  function bestNearby(productId) {
    let best = null;
    for (const s of nearbyStores()) {
      const p = priceAt(s.id, productId);
      if (p && (!best || p.price < best.price)) best = { ...p, store: s.id };
    }
    return best;
  }

  function priceHits() {
    return state.priceAlerts.map(a => ({ a, best: bestNearby(a.product) })).filter(x => x.best && x.best.price <= x.a.target);
  }

  function rescueMatches() {
    if (!state.rescueAlerts.on) return [];
    const ids = nearbyStores().map(s => s.id);
    return D.rescue.filter(r => ids.includes(r.store) && state.rescueAlerts.cats.includes(r.cat));
  }

  const alertCount = () => priceHits().length + rescueMatches().length;
  const suggestTarget = price => Math.max(0.5, Math.floor(price * 0.85 * 4) / 4);

  // ---------- impact ----------

  const KG_PER_MEAL = 0.4;

  // Savings compare against regular shelf price for the same list.
  function tripRecord(p) {
    const lines = Object.values(p.assign).flat();
    const regular = lines.reduce((t, l) => t + products[l.id].base * l.qty, 0);
    const rescued = routeRescue(p);
    return {
      date: new Date().toISOString(),
      area: home().name,
      mode: state.mode,
      stores: p.storeCount,
      spent: p.cost + rescued.reduce((t, r) => t + r.price, 0),
      saved: Math.max(0, regular - p.cost) + rescued.reduce((t, r) => t + r.was - r.price, 0),
      kgRescued: rescued.reduce((t, r) => t + r.kg, 0),
      km: p.km,
      co2Avoided: p.km * (MODES.car.co2 - MODES[state.mode].co2),
    };
  }

  function sampleTrips() {
    const day = 864e5, now = Date.now();
    return [
      [38, 'transit', 2, 61.20, 12.40, 1.40, 5.5],
      [31, 'walk', 1, 34.80, 6.10, 0.90, 2.8],
      [24, 'transit', 2, 57.90, 14.75, 2.30, 6.2],
      [17, 'car', 3, 72.40, 18.20, 1.00, 12.4],
      [10, 'walk', 2, 41.60, 9.30, 1.70, 3.6],
      [3, 'transit', 2, 63.35, 15.60, 1.35, 5.5],
    ].map(([ago, mode, stores, spent, saved, kg, dist]) => ({
      date: new Date(now - ago * day).toISOString(),
      area: 'Old East Village', mode, stores, spent, saved, kgRescued: kg, km: dist,
      co2Avoided: dist * (MODES.car.co2 - MODES[mode].co2),
    }));
  }

  const shortDate = iso => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- rendering ----------

  function render() {
    if (map) { map.remove(); map = null; }
    backBtn.hidden = !['plan', 'results', 'group'].includes(state.screen);
    if (state.screen === 'home') renderHome();
    else if (state.screen === 'plan') renderPlan();
    else if (state.screen === 'loading') renderLoading();
    else if (state.screen === 'results') renderResults();
    else if (state.screen === 'alerts') renderAlerts();
    else if (state.screen === 'impact') renderImpact();
    else if (state.screen === 'community') renderCommunity();
    else if (state.screen === 'group') renderGroup();
    renderTabs();
  }

  function renderTabs() {
    const current = state.screen === 'group' ? 'community' : ['alerts', 'impact', 'community'].includes(state.screen) ? state.screen : 'plan';
    const n = alertCount();
    document.getElementById('tabs').innerHTML = [
      ['plan', 'Plan', ICONS.route],
      ['alerts', 'Alerts', ICONS.bell],
      ['community', 'Community', ICONS.people],
      ['impact', 'Impact', ICONS.leaf],
    ].map(([id, label, icon]) => `<button class="${current === id ? 'on' : ''}" data-tab="${id}">${icon}<span>${label}</span>${id === 'alerts' && n ? `<i>${n}</i>` : ''}</button>`).join('');
  }

  const ICONS = {
    wallet: '<svg viewBox="0 0 24 24"><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4z"/><path d="M4 7V6a2 2 0 0 1 2-2h10"/><circle cx="16" cy="13.5" r="1.2"/></svg>',
    scale: '<svg viewBox="0 0 24 24"><path d="M12 4v16M7 20h10M5 8h14"/><path d="M5 8l-2.5 6a2.5 2.5 0 0 0 5 0zM19 8l-2.5 6a2.5 2.5 0 0 0 5 0z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z"/></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    shrink: '<svg viewBox="0 0 24 24"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/></svg>',
    pinOut: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l7-7"/></svg>',
  };

  // Lime circle behind the first word, matching the deck's title style.
  function hl(text) {
    const i = text.indexOf(' ');
    return i < 0 ? `<span class="hl">${text}</span>` : `<span class="hl">${text.slice(0, i)}</span>${text.slice(i)}`;
  }

  // Colour band at the top of each screen: eyebrow, big headline, optional extras.
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

  function renderHome() {
    const n = alertCount();
    const savedTotal = state.trips.reduce((t, x) => t + x.saved, 0);
    app.innerHTML = `
      <section class="screen">
        <header class="band hero">
          <span class="eyebrow">Groceries, planned smarter</span>
          <h1>Make every food dollar count.</h1>
          <button class="btn" data-action="start">Plan my trip</button>
          <p>Tell us what you need, where you are and how far you'll go. We dig through this week's prices and plan your best trip.</p>
          <svg class="hero-art" viewBox="0 0 300 80" aria-hidden="true">
            <path d="M24 56 C 74 6, 112 82, 160 40 S 248 12, 276 30" fill="none" stroke="#004230" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>
            <circle cx="24" cy="56" r="13" fill="#004230"/><path d="M24 48l7 6h-2.5v7h-3v-4.5h-3v4.5h-3v-7H17z" fill="#fff"/>
            <circle cx="160" cy="40" r="13" fill="#fff" stroke="#004230" stroke-width="2.5"/><text x="160" y="45" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="13" fill="#004230">1</text>
            <circle cx="276" cy="30" r="13" fill="#1F1E1E"/><text x="276" y="35" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="13" fill="#A2DC5D">2</text>
          </svg>
        </header>

        <div class="glance">
          <button class="glance-card" data-action="tab" data-id="alerts">
            <span class="icon">${ICONS.bell}</span>
            <b>${n ? plural(n, 'new alert') : 'No new alerts'}</b>
            <span>Price drops and rescue deals near you</span>
          </button>
          <button class="glance-card" data-action="tab" data-id="impact">
            <span class="icon">${ICONS.leaf}</span>
            <b>${state.trips.length ? money(savedTotal) + ' saved' : 'Start tracking'}</b>
            <span>Your savings, food rescued and CO2 avoided</span>
          </button>
        </div>

        <h2 class="section-title">How it works</h2>
        <div class="how">
          <div><b>1</b><span>Add your list, your starting point, how you'll travel and your rough budget.</span></div>
          <div><b>2</b><span>SNARE compares flyer prices, deals and rescue offers at every store in range.</span></div>
          <div><b>3</b><span>Pick from the cheapest, quickest or a balanced trip, with smart swaps and nearby food help built in.</span></div>
        </div>
        <p class="footnote">Prototype with demo prices and listings for London, Ontario.</p>
      </section>`;
  }

  function renderPlan() {
    const areaOptions = D.areas.map(a => `<option value="${a.id}" ${state.area === a.id ? 'selected' : ''}>${a.name}</option>`).join('')
      + (state.myLocation ? `<option value="me" ${state.area === 'me' ? 'selected' : ''}>My location</option>` : '');
    const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, label]) =>
      `<button data-action="set" data-key="${key}" data-val="${v}" class="${String(state[key]) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;

    app.innerHTML = `
      <section class="screen plan">
        ${band('Step 1 of 2', 'Plan my trip', 'Your list, your distance, your budget.')}
        ${state.planDirty && result ? '<div class="banner ok changed"><strong>Your list changed</strong>Hit Find my best trip to update your route with what you added.</div>' : ''}

        <div class="card list-card">
          <h2>What do you need? <small id="count"></small></h2>
          <div class="search">
            <input id="q" type="text" placeholder="Search items, like milk or rice" autocomplete="off" value="${esc(state.query)}">
            <div id="suggest" class="suggest"></div>
          </div>
          <div class="quick">${QUICK.map(id => `<button class="chip" data-action="add" data-id="${id}">+ ${products[id].name}</button>`).join('')}</div>
          <ul id="items" class="items"></ul>
        </div>
        ${extraStopsCard()}

        <div class="card">
          <h2>Where are you starting?</h2>
          <div class="row">
            <select id="area" class="field">${areaOptions}</select>
            <button class="btn small outline locate" data-action="locate">Use my location</button>
          </div>
        </div>

        <div class="card">
          <h2>How are you getting there?</h2>
          ${seg('mode', [['car', 'Car'], ['transit', 'Transit'], ['walk', 'Walk']])}
        </div>

        <div class="card">
          <h2>How far will you go?</h2>
          <div class="dial">
            <input id="radius" type="range" min="0.5" max="${MAX_RADIUS}" step="0.5" value="${state.radius}" style="--fill:${state.radius / MAX_RADIUS * 100}%">
            <label class="unit-input"><input id="radius-num" type="number" min="0.5" max="${MAX_RADIUS}" step="0.5" value="${state.radius}"><span>km</span></label>
          </div>
          <div class="range-labels"><span>0.5 km</span><span>${MAX_RADIUS} km</span></div>
          <div class="quick">${[2, 5, 10, 20].map(v => `<button class="chip" data-action="radius" data-val="${v}">${v} km</button>`).join('')}</div>
        </div>

        <div class="card">
          <h2>How many stores at most?</h2>
          <div id="store-limit"></div>
        </div>

        <div class="card">
          <h2>Rough budget</h2>
          <div class="money-input"><span>$</span><input id="budget" class="field" type="number" min="0" step="5" value="${state.budget}"></div>
        </div>

        <div class="sticky"><button id="find" class="btn dark block" data-action="find">Find my best trip</button></div>
      </section>`;
    renderItems();
    renderSuggest();
    renderStoreLimit();
  }

  function renderStoreLimit() {
    const box = document.getElementById('store-limit');
    if (!box) return;
    const n = state.maxStores;
    box.innerHTML = `
      <div class="stepper">
        <button data-action="stores" data-d="-1" aria-label="Fewer stores" ${n === 1 ? 'disabled' : ''}>&minus;</button>
        <div><b>${n || 'Any'}</b><span>${n ? (n === 1 ? 'store' : 'stores') : 'number of stores'}</span></div>
        <button data-action="stores" data-d="1" aria-label="More stores" ${!n ? 'disabled' : ''}>+</button>
      </div>
      <button class="chip ${n ? '' : 'on'}" data-action="nolimit">No limit, find the best price anywhere</button>`;
  }

  function setRadius(v, from) {
    const r = Math.min(MAX_RADIUS, Math.max(0.5, Math.round((Number(v) || 0.5) * 2) / 2));
    state.radius = r;
    const range = document.getElementById('radius'), num = document.getElementById('radius-num');
    if (range && from !== 'range') range.value = r;
    if (num && from !== 'num') num.value = r;
    if (range) range.style.setProperty('--fill', r / MAX_RADIUS * 100 + '%');
  }

  function extraStopsCard() {
    const tips = tipStops();
    const savedDeals = state.rescueAdded.map(id => rescues[id]);
    const n = tips.length + savedDeals.length;
    if (!n) return '';
    const short = t => t.length > 60 ? t.slice(0, 57).trim() + '...' : t;
    return `<div class="card extras">
      <h2>Extra stops <small>${plural(n, 'stop')}</small></h2>
      <p class="card-note">Added from Community and Alerts. Community tips become stops on your route and don't change your prices.</p>
      <ul class="items">
        ${tips.map(t => `<li>
          <div><strong>${esc(t.place)}</strong><span><span class="src">Community tip</span>${esc(short(t.text))}</span></div>
          <button class="remove" data-action="tip" data-id="${t.id}" aria-label="Remove stop">&times;</button>
        </li>`).join('')}
        ${savedDeals.map(r => `<li>
          <div><strong>${r.name}, ${money(r.price)}</strong><span><span class="src">Rescue deal</span>${stores[r.store].name}. Added if your route stops there.</span></div>
          <button class="remove" data-action="rescue" data-id="${r.id}" aria-label="Remove deal">&times;</button>
        </li>`).join('')}
      </ul>
    </div>`;
  }

  function renderItems() {
    const ul = document.getElementById('items');
    if (!ul) return;
    ul.innerHTML = state.items.length
      ? state.items.map(it => {
        const p = products[it.id];
        return `<li>
            <div><strong>${p.name}${it.from ? `<span class="src">From ${it.from}</span>` : ''}</strong><span>${p.unit}</span></div>
            <div class="qty">
              <button data-action="qty" data-id="${it.id}" data-d="-1" aria-label="Fewer">&minus;</button>
              <b>${it.qty}</b>
              <button data-action="qty" data-id="${it.id}" data-d="1" aria-label="More">+</button>
            </div>
          </li>`;
      }).join('')
      : `<li class="empty">Your list is empty. Search above or tap a quick add.</li>`;
    document.getElementById('find').disabled = !state.items.length;
    document.getElementById('count').textContent = state.items.length ? plural(state.items.length, 'item') : '';
  }

  function renderSuggest() {
    const box = document.getElementById('suggest');
    if (!box) return;
    const q = state.query.trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    const hits = D.products.filter(p => (p.name + ' ' + (p.keywords || '')).toLowerCase().includes(q)).slice(0, 6);
    box.innerHTML = hits.length
      ? hits.map(p => `<button data-action="add" data-id="${p.id}">${p.name} <span>${p.unit}</span></button>`).join('')
      : `<div class="none">"${esc(state.query.trim())}" isn't in the demo catalog yet.</div>`;
  }

  function renderLoading() {
    const start = home();
    const inRange = D.stores.filter(s => km(start, s) <= state.radius);
    const steps = [
      `Reading this week's flyers at ${plural(inRange.length, 'store')}`,
      `Comparing prices for ${plural(state.items.length, 'item')}`,
      'Checking rescue deals and food help nearby',
      `Planning ${MODES[state.mode].label.toLowerCase()} routes`,
    ];
    const checks = state.items.length * inRange.length + D.deals.length + D.rescue.length;
    app.innerHTML = `
      <section class="loading">
        <div class="scan-map" id="scan-map">
          <div class="scan-chip"><span class="live"></span><b data-count="${checks}" data-fmt="">0</b>&nbsp;prices checked</div>
        </div>
        <div class="loading-copy">
          <h1>Finding your best trip</h1>
          <div class="progress"><span style="animation-duration:${LOADING_MS}ms"></span></div>
          <ul class="steps">${steps.map(s => `<li>${s}</li>`).join('')}</ul>
        </div>
      </section>`;
    app.querySelectorAll('.steps li').forEach((li, i) => setTimeout(() => li.classList.add('done'), 450 + i * 620));
    countUp(app, LOADING_MS - 500);
    drawScan(start, inRange);
  }

    function budgetPill(cost) {
    const diff = state.budget - cost;
    return diff >= 0
      ? `<span class="pill ok">${money(diff)} under</span>`
      : `<span class="pill over">${money(-diff)} over</span>`;
  }

  function tradeoffText(sel, options) {
    const others = options.filter(o => o !== sel);
    const lines = others.map(o => {
      const dCost = o.plan.cost - sel.plan.cost;
      const dMin = sel.plan.minutes - o.plan.minutes;
      if (dCost > 0 && dMin > 0) return `${o.label} saves ${dMin} min for ${money(dCost)} more.`;
      if (dCost < 0 && dMin < 0) return `${o.label} saves ${money(-dCost)} but takes ${-dMin} min longer.`;
      return null;
    }).filter(Boolean);
    return lines.join(' ');
  }

  function renderResults() {
    const r = result;
    const start = r.start;
    const settings = `${MODES[state.mode].label} · within ${state.radius} km · ${storeLimitText()} · ${money(state.budget)} budget`;

    const head = band('Step 2 of 2', `${plural(state.items.length, 'item')} from ${esc(start.name)}`, settings,
      '<button class="btn small outline" data-action="edit">Edit trip</button>');

    if (!r.options.length) {
      app.innerHTML = `<section class="screen">${head}
        <div class="banner info"><strong>No stores in range</strong>
        There are no stores within ${state.radius} km that carry your items. Try a longer distance.
        <div class="actions"><button class="btn small dark" data-action="edit">Change distance</button></div></div>
        ${moreWaysToSave(null, start)}
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
      ? `<div class="banner info"><strong>Not found within ${state.radius} km</strong>${r.missing.map(it => products[it.id].name).join(', ')}. A longer distance may find them.</div>`
      : '';

    let banner;
    const gap = cheapest.cost - state.budget;
    if (gap > 0) {
      const swapSave = swapsFor(cheapest).reduce((n, s) => n + s.saving, 0);
      banner = `<div class="banner over">
        <strong>About ${money(gap)} over your budget</strong>
        ${swapSave > 0 ? `Smart swaps could save ${money(swapSave)}, and there's` : `There's`} free and low cost food near your route that can make up the difference.
        <div class="actions">
          ${swapSave > 0 ? '<button class="btn small" data-action="scroll" data-to="swaps">See swaps</button>' : ''}
          <button class="btn small" data-action="scroll" data-to="more">See food nearby</button>
        </div></div>`;
    } else {
      const fits = r.options.filter(o => o.plan.cost <= state.budget).length;
      banner = `<div class="banner ok"><strong>${fits === r.options.length ? 'Every option fits your budget' : 'The cheapest option fits your budget'}</strong>
        Pick the trip that works best for your time.</div>`;
    }

    const cards = r.options.map(o => `
      <button class="opt ${o.id === sel.id ? 'on' : ''}" data-action="pick" data-id="${o.id}">
        <span class="opt-label"><span class="opt-icon">${ICONS[{ cheapest: 'wallet', balanced: 'scale', quickest: 'bolt' }[o.id]]}</span>${o.label}</span>
        <span class="opt-total">${counted(o.plan.cost, 'money')}</span>
        <span class="opt-meta">${plural(o.plan.storeCount, 'store')}</span>
        <span class="opt-meta">${o.plan.minutes} min total</span>
        ${budgetPill(o.plan.cost)}
      </button>`).join('');

    let n = 0;
    const stopsHtml = p.order.map(s => {
      n++;
      if (s.kind === 'tip') {
        return `<div class="stop"><div class="stop-head">
          <span class="pin tip">${n}</span>
          <div><strong>${esc(s.name)}</strong><span>Community tip · not checked by SNARE</span></div>
          <button class="link sub" data-action="tip" data-id="${s.id}">Remove</button>
        </div></div>`;
      }
      if (s.kind === 'help') {
        return `<div class="stop"><div class="stop-head">
          <span class="pin help">${n}</span>
          <div><strong>${s.name}</strong><span>${s.type} · ${s.hours}</span></div>
          <button class="link sub" data-action="help" data-id="${s.id}">Remove</button>
        </div></div>`;
      }
      const lines = p.assign[s.id] || [];
      const sub = lines.reduce((t, l) => t + l.price * l.qty, 0);
      const rescueHere = state.rescueAdded.map(id => rescues[id]).filter(x => x.store === s.id);
      return `<div class="stop">
        <div class="stop-head">
          <span class="pin store">${n}</span>
          <div><strong>${s.name}</strong><span>${s.where} · ${km(start, s).toFixed(1)} km from start</span></div>
          <span class="sub">${money(sub)}</span>
        </div>
        <ul class="lines">
          ${lines.map(l => {
            const watching = state.priceAlerts.some(a => a.product === l.id);
            return `<li><span>${products[l.id].name}${l.qty > 1 ? ` <em>x${l.qty}</em>` : ''}${l.deal ? '<span class="tag">Flyer deal</span>' : ''}</span>
              <span class="line-end"><button class="bell ${watching ? 'on' : ''}" data-action="watch" data-id="${l.id}" data-price="${l.price}" aria-label="${watching ? 'Stop price alert' : 'Alert me when cheaper'}" title="${watching ? 'Watching this price' : 'Alert me when cheaper'}">${ICONS.bell}</button>${money(l.price * l.qty)}</span></li>`;
          }).join('')}
          ${rescueHere.map(x => `<li><span>${x.name}<span class="tag rescue">Rescued</span></span><span>${money(x.price)}</span></li>`).join('')}
        </ul>
      </div>`;
    }).join('');

    const extra = routeRescue(p).reduce((t, x) => t + x.price, 0);
    const swaps = swapsFor(p);
    const swapTotal = swaps.reduce((t, s) => t + s.saving, 0);
    const swapsHtml = swaps.length
      ? swaps.map(s => `<div class="swap">
          <div><strong>${products[s.from].name} &rarr; ${products[s.to].name}</strong><span>Same store, ${stores[s.store].name}</span></div>
          <span class="save">Save ${money(s.saving)}</span>
          <button class="btn small" data-action="swap" data-from="${s.from}" data-to="${s.to}">Swap</button>
        </div>`).join('') + (swaps.length > 1 ? `<button class="btn outline block" data-action="swapall">Swap all and save ${money(swapTotal)}</button>` : '')
      : '<p class="empty-note">Your list is already using the best value picks at these stores.</p>';

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
          <div class="map-chip">${plural(p.order.length, 'stop')} · ${MODES[state.mode].label}</div>
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
        <button class="btn block log" data-action="log" ${state.loggedTrip ? 'disabled' : ''}>${state.loggedTrip ? 'Added to My impact' : 'I did this trip'}</button>
        <p class="hint">Adds this trip's savings, rescued food and CO2 to My impact. Tap a bell to get a price alert.</p>

        <h2 class="section-title" id="swaps">Smart swaps</h2>
        <p class="section-sub">Cheaper picks that do the same job, at the stores you're already visiting.</p>
        ${swapsHtml}

        ${moreWaysToSave(p, start)}
        ${groupTipsNear(start)}

        <p class="footnote">Prototype with demo prices and listings for London, Ontario.</p>
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
    const gMode = { car: 'driving', transit: 'transit', walk: 'walking' }[state.mode];
    const aMode = { car: 'd', transit: 'r', walk: 'w' }[state.mode];
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

  function listButton(productId) {
    const on = state.items.some(it => it.id === productId);
    return `<button class="btn small ${on ? 'added' : ''}" data-action="listadd" data-id="${productId}">${on ? 'On your list' : 'Add to list'}</button>`;
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

  function renderAlerts() {
    const start = home();
    const hits = priceHits();
    const matches = rescueMatches();

    const feed = [
      ...hits.map(({ a, best }) => `<div class="offer hit">
        <div class="offer-top">
          <div><span class="kind">Price drop · ${stores[best.store].name}</span><h3>${products[a.product].name}</h3><p>Under your ${money(a.target)} target</p></div>
          <div class="price"><b>${money(best.price)}</b><s>${money(products[a.product].base)}</s></div>
        </div>
        <div class="offer-foot"><small>${km(start, stores[best.store]).toFixed(1)} km away</small>${listButton(a.product)}</div>
      </div>`),
      ...matches.map(x => rescueCard(x, `${x.posted} · ${km(start, stores[x.store]).toFixed(1)} km away`)),
    ];

    const watched = state.priceAlerts.map(a => {
      const best = bestNearby(a.product);
      const hit = best && best.price <= a.target;
      return `<div class="alert-row">
        <div>
          <strong>${products[a.product].name}</strong>
          <span>${best ? `Best now ${money(best.price)} at ${stores[best.store].name}` : 'Not sold within your distance'}</span>
        </div>
        <div class="alert-target"><small>Alert under</small><b>${money(a.target)}</b></div>
        <span class="pill ${hit ? 'ok' : 'idle'}">${hit ? 'Price hit' : 'Watching'}</span>
        <button class="remove" data-action="alertdel" data-id="${a.product}" aria-label="Remove alert">&times;</button>
      </div>`;
    }).join('');

    const options = D.products
      .filter(p => !state.priceAlerts.some(a => a.product === p.id))
      .map(p => `<option value="${p.id}">${p.name}, ${p.unit}</option>`).join('');
    const first = D.products.find(p => !state.priceAlerts.some(a => a.product === p.id));
    const firstBest = first && bestNearby(first.id);

    app.innerHTML = `
      <section class="screen">
        ${band('Alerts', `This week near ${esc(start.name)}`, `Checking ${plural(nearbyStores().length, 'store')} within ${state.radius} km. Change your area or distance on the Plan tab.`)}
        ${feed.length ? feed.join('') : '<div class="banner info"><strong>Nothing new yet</strong>Add a price alert or turn on rescue deal alerts below.</div>'}

        <h2 class="section-title">Price alerts</h2>
        <p class="section-sub">We tell you when an item drops below your target at any store in range.</p>
        <div class="card">
          ${watched || '<p class="empty-note">No price alerts yet.</p>'}
          ${first ? `<div class="alert-form">
            <select id="alert-product" class="field">${options}</select>
            <div class="row">
              <div class="money-input"><span>$</span><input id="alert-target" class="field" type="number" min="0" step="0.25" value="${(firstBest ? suggestTarget(firstBest.price) : 5).toFixed(2)}"></div>
              <button class="btn dark" data-action="alertadd">Add alert</button>
            </div>
          </div>` : ''}
        </div>

        <h2 class="section-title">Rescue deal alerts</h2>
        <p class="section-sub">Stores post surplus and near expiry food. Get told the moment something you'd use shows up.</p>
        <div class="card">
          <button class="switch-row" data-action="rtoggle" aria-pressed="${state.rescueAlerts.on}">
            <span><strong>Tell me about rescue deals</strong><span>At stores within ${state.radius} km</span></span>
            <span class="switch ${state.rescueAlerts.on ? 'on' : ''}"></span>
          </button>
          <div class="quick ${state.rescueAlerts.on ? '' : 'muted'}">
            ${RESCUE_CATS.map(c => `<button class="chip ${state.rescueAlerts.cats.includes(c) ? 'on' : ''}" data-action="rcat" data-id="${c}">${c}</button>`).join('')}
          </div>
        </div>
        <p class="footnote">Prototype: alerts check this week's demo prices. The real app would send phone notifications.</p>
      </section>`;
  }

  function renderImpact() {
    const t = state.trips;
    const sum = key => t.reduce((n, x) => n + x[key], 0);
    const community = `
      <h2 class="section-title">SNARE in London this month</h2>
      <div class="stats">
        <div class="stat"><b>1,284 kg</b><span>food rescued</span></div>
        <div class="stat"><b>$18,920</b><span>saved by shoppers</span></div>
        <div class="stat"><b>312</b><span>households</span></div>
      </div>
      <p class="footnote">Community figures are illustrative for the prototype.</p>`;

    if (!t.length) {
      app.innerHTML = `
        <section class="screen">
          ${band('My impact', 'Every trip adds up.')}
          <div class="banner info"><strong>No trips logged yet</strong>
            Plan a trip and tap "I did this trip" to track money saved, food rescued and CO2 avoided.
            <div class="actions">
              <button class="btn small dark" data-action="tab" data-id="plan">Plan a trip</button>
              <button class="btn small outline" data-action="sample">Load sample history</button>
            </div>
          </div>
          ${community}
        </section>`;
      return;
    }

    const saved = sum('saved'), kg = sum('kgRescued'), co2 = sum('co2Avoided');
    const history = [...t].reverse().map(x => `
      <li>
        <div><strong>${shortDate(x.date)}</strong><span>${MODES[x.mode].label} · ${plural(x.stores, 'store')} · ${money(x.spent)} spent${x.kgRescued ? ` · ${x.kgRescued.toFixed(1)} kg rescued` : ''}</span></div>
        <b>+${money(x.saved)}</b>
      </li>`).join('');

    app.innerHTML = `
      <section class="screen">
        ${band("My impact · You've saved", counted(saved, 'money'), `across ${plural(t.length, 'trip')} since ${shortDate(t[0].date)}`)}
        <div class="stats">
          <div class="stat"><b>${kg.toFixed(1)} kg</b><span>food rescued, about ${Math.round(kg / KG_PER_MEAL)} meals</span></div>
          <div class="stat"><b>${co2.toFixed(1)} kg</b><span>CO2 avoided vs driving</span></div>
          <div class="stat"><b>${money(saved / t.length)}</b><span>saved per trip</span></div>
        </div>
        <div class="banner ok"><strong>Your part in SDG 12.3</strong>
          Every kilogram you rescue is edible food kept out of landfill, counting toward halving food waste.</div>

        <h2 class="section-title">Trip history</h2>
        <ul class="history">${history}</ul>
        <button class="link" data-action="clear">Clear history</button>

        ${community}
      </section>`;
    countUp(app, 1100);
  }

  function groupTipsNear(start) {
    const tips = allPosts()
      .filter(t => state.joinedGroups.includes(t.group) && !state.communityStops.includes(t.id) && km(start, t) <= state.radius + 1)
      .slice(0, 3);
    if (!tips.length) return '';
    return `
      <h2 class="section-title">Tips from your groups</h2>
      <p class="section-sub">Shared by neighbours and not checked by SNARE. Add one as a stop if you want to look for yourself.</p>
      ${tips.map(t => postCard(t, true, true)).join('')}
      <button class="btn outline block" data-action="tab" data-id="community">Open Community</button>`;
  }

  function postCard(post, showGroup, compact) {
    const v = voteCounts(post);
    const onRoute = state.communityStops.includes(post.id);
    const comments = commentsFor(post);
    const open = state.openComments.includes(post.id);
    const g = groupsById[post.group];
    return `<article class="post ${post.fresh ? 'fresh' : ''}">
      <div class="post-head">
        ${avatar(post.author)}
        <div><strong>${esc(post.author)}</strong><span>${showGroup ? `${esc(g.name)} · ` : ''}${ago(post.createdAt)}</span></div>
      </div>
      <p class="post-text">${esc(post.text)}</p>
      ${post.photo && !compact ? `<img class="post-photo" src="${post.photo}" alt="Photo shared with this post">` : ''}
      <div class="post-place">${ICONS.pinOut}<span>${esc(post.place)} · ${km(home(), post).toFixed(1)} km from your start</span><span class="kind">Community tip</span></div>
      <div class="post-actions">
        <button class="vote ${v.mine === 'there' ? 'on' : ''}" data-action="vote" data-id="${post.id}" data-v="there">${ICONS.check}Still there <b>${v.there}</b></button>
        <button class="vote gone ${v.mine === 'gone' ? 'on' : ''}" data-action="vote" data-id="${post.id}" data-v="gone">${ICONS.cross}Gone <b>${v.gone}</b></button>
        ${compact ? '' : `<button class="vote" data-action="comments" data-id="${post.id}">${ICONS.chat}<b>${comments.length}</b></button>`}
      </div>
      <button class="btn small block ${onRoute ? 'added' : 'outline'}" data-action="tip" data-id="${post.id}">${onRoute ? 'On your route' : 'Add to my route'}</button>
      ${open && !compact ? `<div class="comments">
        ${comments.map(c => `<div class="comment">${avatar(c.author)}<div><strong>${esc(c.author)}</strong> <span>${ago(c.createdAt)}</span><p>${esc(c.text)}</p></div></div>`).join('') || '<p class="empty-note">No comments yet.</p>'}
        <div class="row"><input class="field" id="c-${post.id}" placeholder="Add a comment" autocomplete="off"><button class="btn small" data-action="comment" data-id="${post.id}">Send</button></div>
      </div>` : ''}
    </article>`;
  }

  function groupCard(g) {
    const joined = state.joinedGroups.includes(g.id);
    const today = allPosts().filter(p => p.group === g.id && Date.now() - p.createdAt < 864e5).length;
    return `<div class="group-card">
      <button class="group-main" data-action="group" data-id="${g.id}">
        <span class="group-icon ${g.kind}">${g.kind === 'area' ? ICONS.pinOut : ICONS.people}</span>
        <span><strong>${g.name}</strong><span>${g.members.toLocaleString('en-CA')} members${today ? ` · ${plural(today, 'post')} today` : ''}</span></span>
      </button>
      <button class="btn small ${joined ? 'added' : 'outline'}" data-action="join" data-id="${g.id}">${joined ? 'Joined' : 'Join'}</button>
    </div>`;
  }

  function renderCommunity() {
    const joined = state.joinedGroups.map(id => groupsById[id]).filter(Boolean);
    const view = state.communityView;
    let body;
    if (view === 'mine') {
      const feed = allPosts().filter(p => state.joinedGroups.includes(p.group));
      body = joined.length
        ? `<div class="joined-row">${joined.map(g => `<button class="chip" data-action="group" data-id="${g.id}">${g.name}</button>`).join('')}</div>
           <h2 class="section-title live-title"><span class="live"></span>Live feed</h2>
           ${feed.map(p => postCard(p, true)).join('') || '<p class="empty-note">No posts yet in your groups.</p>'}`
        : `<div class="banner info"><strong>You haven't joined any groups</strong>Find groups for your neighbourhood or interests.
             <div class="actions"><button class="btn small" data-action="cview" data-id="discover">Discover groups</button></div></div>`;
    } else {
      const start = home();
      const areaGroups = D.groups.filter(g => g.kind === 'area').sort((a, b) => km(start, areas[a.area]) - km(start, areas[b.area]));
      body = `<h2 class="section-title">Near ${esc(start.name)}</h2>
        ${areaGroups.map(groupCard).join('')}
        <h2 class="section-title">By interest</h2>
        ${D.groups.filter(g => g.kind === 'interest').map(groupCard).join('')}`;
    }
    app.innerHTML = `
      <section class="screen community">
        ${band('Community', 'Deals your neighbours found.', 'Tips shared by people near you. SNARE does not check them, so look at the votes before you go.')}
        <div class="seg">
          <button class="${view === 'mine' ? 'on' : ''}" data-action="cview" data-id="mine">My groups</button>
          <button class="${view === 'discover' ? 'on' : ''}" data-action="cview" data-id="discover">Discover</button>
        </div>
        ${body}
      </section>`;
    scheduleLivePost();
  }

  function renderGroup() {
    const g = groupsById[state.groupId];
    const joined = state.joinedGroups.includes(g.id);
    const posts = allPosts().filter(p => p.group === g.id);
    const d = state.draft;
    const composer = joined ? `<div class="card composer">
        <h2>Share a deal</h2>
        <textarea id="post-text" class="field" rows="3" placeholder="What did you find? For example: mangoes 3 for $2">${esc(d.text)}</textarea>
        <input id="post-place" class="field" placeholder="Where is it? (optional) For example: fruit stand by the market" value="${esc(d.place)}">
        ${d.photo ? `<div class="photo-preview"><img src="${d.photo}" alt="Photo to post"><button class="remove" data-action="unphoto" aria-label="Remove photo">&times;</button></div>` : ''}
        <p class="loc-line">${ICONS.pinOut}<span>${d.loc ? esc(d.loc.label) : 'Your current location is added when you post'}</span></p>
        <div class="composer-row">
          <label class="btn small outline">${ICONS.camera}Photo<input type="file" accept="image/*" id="post-photo" hidden></label>
          <button class="btn small outline" data-action="postloc">${ICONS.pinOut}Location</button>
          <button class="btn small" data-action="post">Post</button>
        </div>
      </div>` : `<div class="banner info"><strong>Join to post</strong>Join this group to share deals and comment.</div>`;

    app.innerHTML = `
      <section class="screen community">
        ${band(g.kind === 'area' ? 'Neighbourhood group' : 'Interest group', g.name, `${g.members.toLocaleString('en-CA')} members · ${g.about}`,
          `<button class="btn small ${joined ? 'outline' : ''}" data-action="join" data-id="${g.id}">${joined ? 'Leave group' : 'Join group'}</button>`)}
        ${composer}
        <h2 class="section-title live-title"><span class="live"></span>Live feed</h2>
        ${posts.map(p => postCard(p, false)).join('') || '<p class="empty-note">No posts yet. Be the first to share a deal.</p>'}
      </section>`;
    scheduleLivePost();
  }

  // Rescue deals and food help share one card style on purpose: help looks
  // like any other way to save, so nobody has to go to a separate section.
  function moreWaysToSave(p, start) {
    const routeStores = p ? p.order.filter(s => s.kind === 'store') : [];
    const routePoints = [start, ...(p ? p.order : [])];

    const rescueCards = D.rescue.filter(x => routeStores.some(s => s.id === x.store)).map(x => rescueCard(x, 'Already on your route'));

    const helpCards = D.support
      .map(h => ({ h, d: Math.min(...routePoints.map(pt => km(pt, h))) }))
      .filter(({ h, d }) => km(start, h) <= state.radius + 1 || d <= 1.5)
      .sort((a, b) => a.d - b.d)
      .map(({ h, d }) => {
        const added = state.extraStops.includes(h.id);
        return `<div class="offer">
          <div class="offer-top">
            <div><span class="kind">${h.type}</span><h3>${h.name}</h3><p>${h.offer}</p></div>
            <div class="price"><b>${h.type === 'Pay what you can' ? 'PWYC' : 'Free'}</b><s></s></div>
          </div>
          <dl>
            <dt>When</dt><dd>${h.hours}</dd>
            <dt>Who</dt><dd>${h.serves}</dd>
            <dt>Bring</dt><dd>${h.bring}</dd>
            <dt>Contact</dt><dd>${h.phone}</dd>
          </dl>
          <div class="offer-foot"><small>${d.toFixed(1)} km from your route · Last verified ${h.verified}</small>
            <button class="btn small ${added ? 'added' : ''}" data-action="help" data-id="${h.id}">${added ? 'On your trip' : 'Add stop'}</button></div>
        </div>`;
      });

    const cards = [...rescueCards, ...helpCards];
    return `
      <h2 class="section-title" id="more">More ways to save near your route</h2>
      <p class="section-sub">Rescued food that would otherwise go to waste, plus free and low cost food in your area.</p>
      ${cards.length ? cards.join('') : '<p class="empty-note">Nothing extra near this route right now.</p>'}`;
  }

  // ---------- maps ----------

  const HOME_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>';
  const routeCache = {};

  function addTiles(m) {
    // Esri tiles load from a local file and from any host, unlike the
    // OpenStreetMap servers, which return an "Access blocked" image.
    const base = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    L.tileLayer(base + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      errorTileUrl: blank,
      attribution: 'Tiles &copy; Esri',
    }).addTo(m);
    L.tileLayer(base + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      errorTileUrl: blank,
      className: 'map-labels',
    }).addTo(m);
  }

  const homeIcon = () => L.divIcon({ className: '', html: `<div class="pin home pulse">${HOME_SVG}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });

  // Road geometry from the free OpenStreetMap routing service. Falls back to
  // straight lines if it is slow or offline.
  async function roadRoute(points) {
    const coords = points.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    const profile = state.mode === 'walk' ? 'routed-foot' : 'routed-car';
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
    const meters = state.radius * 1000;
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
      const reach = 1 - Math.cbrt(1 - Math.min(1, km(start, s) / state.radius)); // when the eased ring passes it
      const delay = 100 + reach * grow;
      setTimeout(() => {
        if (map !== thisMap) return;
        const m = L.marker([s.lat, s.lng], {
          icon: L.divIcon({ className: '', html: `<div class="scan-pin">${ICONS.check}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        }).addTo(map);
        setTimeout(() => { const e = m.getElement(); if (e) e.firstChild.classList.add('checked'); }, 600);
      }, delay);
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
      const cls = s.kind === 'store' ? 'store' : s.kind;
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', html: `<div class="pin ${cls} ${animate ? 'drop' : ''}" style="animation-delay:${300 + i * 220}ms">${i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
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

    // ---------- actions ----------

  function go(screen) {
    state.screen = screen;
    render();
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
    if (tab === 'plan') {
      const hasPlan = state.items.length || state.communityStops.length || state.rescueAdded.length;
      go(result && !state.planDirty ? 'results' : hasPlan ? 'plan' : 'home');
    }
    else go(tab);
  }

  function findTrip() {
    state.extraStops = [];
    state.planDirty = false;
    state.loggedTrip = false;
    go('loading');
    setTimeout(() => {
      result = plan();
      fresh = true;
      go('results');
    }, LOADING_MS);
  }

  function addItem(id) {
    const it = state.items.find(x => x.id === id);
    if (it) it.qty++;
    else state.items.push({ id, qty: 1 });
    state.query = '';
    const q = document.getElementById('q');
    if (q) q.value = '';
    renderItems();
    renderSuggest();
    renderStoreLimit();
  }

  function renderStoreLimit() {
    const box = document.getElementById('store-limit');
    if (!box) return;
    const n = state.maxStores;
    box.innerHTML = `
      <div class="stepper">
        <button data-action="stores" data-d="-1" aria-label="Fewer stores" ${n === 1 ? 'disabled' : ''}>&minus;</button>
        <div><b>${n || 'Any'}</b><span>${n ? (n === 1 ? 'store' : 'stores') : 'number of stores'}</span></div>
        <button data-action="stores" data-d="1" aria-label="More stores" ${!n ? 'disabled' : ''}>+</button>
      </div>
      <button class="chip ${n ? '' : 'on'}" data-action="nolimit">No limit, find the best price anywhere</button>`;
  }

  function setRadius(v, from) {
    const r = Math.min(MAX_RADIUS, Math.max(0.5, Math.round((Number(v) || 0.5) * 2) / 2));
    state.radius = r;
    const range = document.getElementById('radius'), num = document.getElementById('radius-num');
    if (range && from !== 'range') range.value = r;
    if (num && from !== 'num') num.value = r;
    if (range) range.style.setProperty('--fill', r / MAX_RADIUS * 100 + '%');
  }

  app.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;

    switch (action) {
      case 'start':
        go('plan');
        break;
      case 'tab':
        openTab(id);
        break;
      case 'add':
        addItem(id);
        break;
      case 'qty': {
        const it = state.items.find(x => x.id === id);
        it.qty += Number(el.dataset.d);
        if (it.qty <= 0) state.items = state.items.filter(x => x !== it);
        renderItems();
        break;
      }
      case 'set': {
        const key = el.dataset.key;
        state[key] = key === 'maxStores' ? Number(el.dataset.val) : el.dataset.val;
        el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
        break;
      }
      case 'locate':
        if (!navigator.geolocation) { alert('Location is not available in this browser.'); break; }
        navigator.geolocation.getCurrentPosition(pos => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (km(here, areas.downtown) > 30) { alert('The demo data only covers London, Ontario, so pick a London neighbourhood for now.'); return; }
          state.myLocation = here;
          state.area = 'me';
          renderPlan();
        }, () => alert('Could not get your location. Pick a neighbourhood instead.'));
        break;
      case 'radius':
        setRadius(el.dataset.val);
        break;
      case 'stores':
        state.maxStores = Math.min(D.stores.length, Math.max(1, (state.maxStores || D.stores.length) + Number(el.dataset.d)));
        renderStoreLimit();
        break;
      case 'nolimit':
        state.maxStores = state.maxStores ? 0 : 2;
        renderStoreLimit();
        break;
      case 'find':
        if (state.items.length) findTrip();
        break;
      case 'edit':
        go('plan');
        break;
      case 'pick':
        state.selected = id;
        replan(true);
        break;
      case 'swap':
        state.items.forEach(it => { if (it.id === el.dataset.from) it.id = el.dataset.to; });
        replan(true);
        break;
      case 'swapall':
        swapsFor(result.options.find(o => o.id === state.selected).plan)
          .forEach(s => state.items.forEach(it => { if (it.id === s.from) it.id = s.to; }));
        replan(true);
        break;
      case 'rescue':
        state.rescueAdded = state.rescueAdded.includes(id) ? state.rescueAdded.filter(x => x !== id) : [...state.rescueAdded, id];
        if (state.screen === 'results') replan(true);
        else {
          state.planDirty = true;
          if (state.screen === 'alerts' && state.rescueAdded.includes(id)) toast('Saved to Extra stops on Plan');
          rerender();
        }
        break;
      case 'watch': {
        const name = products[id].name;
        if (state.priceAlerts.some(a => a.product === id)) {
          state.priceAlerts = state.priceAlerts.filter(a => a.product !== id);
          toast(`Stopped watching ${name}`);
        } else {
          const target = suggestTarget(Number(el.dataset.price));
          state.priceAlerts.push({ product: id, target });
          toast(`We'll tell you when ${name} drops below ${money(target)}`);
        }
        persist();
        rerender();
        break;
      }
      case 'alertadd': {
        const product = document.getElementById('alert-product').value;
        const target = Number(document.getElementById('alert-target').value);
        if (!(target > 0)) { toast('Enter a target price'); break; }
        state.priceAlerts.push({ product, target });
        persist();
        toast(`Alert set for ${products[product].name}`);
        rerender();
        break;
      }
      case 'alertdel':
        state.priceAlerts = state.priceAlerts.filter(a => a.product !== id);
        persist();
        rerender();
        break;
      case 'rtoggle':
        state.rescueAlerts.on = !state.rescueAlerts.on;
        persist();
        rerender();
        break;
      case 'rcat': {
        const cats = state.rescueAlerts.cats;
        state.rescueAlerts.cats = cats.includes(id) ? cats.filter(c => c !== id) : [...cats, id];
        persist();
        rerender();
        break;
      }
      case 'listadd':
        if (!state.items.some(it => it.id === id)) {
          state.items.push({ id, qty: 1, from: 'Alerts' });
          state.planDirty = true;
          toast(`${products[id].name} added to your list on Plan`);
        }
        rerender();
        break;
      case 'log': {
        const p = result.options.find(o => o.id === state.selected).plan;
        const trip = tripRecord(p);
        state.trips.push(trip);
        state.loggedTrip = true;
        persist();
        go('impact');
        toast(`Trip logged: ${money(trip.saved)} saved`);
        break;
      }
      case 'sample':
        state.trips = sampleTrips();
        persist();
        rerender();
        break;
      case 'clear':
        if (confirm('Clear your trip history?')) {
          state.trips = [];
          persist();
          rerender();
        }
        break;
      case 'help':
        state.extraStops = state.extraStops.includes(id) ? state.extraStops.filter(x => x !== id) : [...state.extraStops, id];
        replan(true);
        break;
      case 'cview':
        state.communityView = id;
        rerender();
        break;
      case 'group':
        state.groupId = id;
        go('group');
        break;
      case 'join': {
        const g = groupsById[id];
        if (state.joinedGroups.includes(id)) {
          state.joinedGroups = state.joinedGroups.filter(x => x !== id);
          toast(`Left ${g.name}`);
        } else {
          state.joinedGroups.push(id);
          toast(`Joined ${g.name}`);
        }
        persist();
        rerender();
        break;
      }
      case 'vote': {
        const v = el.dataset.v;
        if (state.votes[id] === v) delete state.votes[id];
        else state.votes[id] = v;
        persist();
        rerender();
        break;
      }
      case 'comments':
        state.openComments = state.openComments.includes(id) ? state.openComments.filter(x => x !== id) : [...state.openComments, id];
        rerender();
        break;
      case 'comment': {
        const input = document.getElementById('c-' + id);
        const text = input.value.trim();
        if (!text) break;
        (state.userComments[id] = state.userComments[id] || []).push({ author: 'You', text, createdAt: Date.now() });
        persist();
        rerender();
        break;
      }
      case 'tip': {
        const on = state.communityStops.includes(id);
        state.communityStops = on ? state.communityStops.filter(x => x !== id) : [...state.communityStops, id];
        persist();
        if (state.screen === 'results') { replan(true); break; }
        state.planDirty = true;
        if (state.screen !== 'plan') toast(on ? 'Removed from your route' : 'Added to Extra stops on Plan');
        rerender();
        break;
      }
      case 'postloc':
        locateForPost(loc => { state.draft.loc = loc; rerender(); });
        break;
      case 'unphoto':
        state.draft.photo = null;
        rerender();
        break;
      case 'post': {
        const d = state.draft;
        if (!d.text.trim()) { toast('Say what you found first'); break; }
        const publish = loc => {
          state.userPosts.unshift({
            id: 'u' + Date.now(), group: state.groupId, author: 'You', createdAt: Date.now(), fresh: true,
            text: d.text.trim(), place: d.place.trim() || loc.label, lat: loc.lat, lng: loc.lng,
            photo: d.photo, there: 0, gone: 0, comments: [],
          });
          state.draft = { text: '', place: '', photo: null, loc: null };
          persist();
          toast(`Posted to ${groupsById[state.groupId].name}`);
          rerender();
        };
        if (d.loc) publish(d.loc);
        else locateForPost(publish);
        break;
      }
      case 'scroll':
        document.getElementById(el.dataset.to).scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
    }
  });

  app.addEventListener('input', e => {
    if (e.target.id === 'post-text') state.draft.text = e.target.value;
    if (e.target.id === 'post-place') state.draft.place = e.target.value;
    if (e.target.id === 'q') { state.query = e.target.value; renderSuggest(); }
    if (e.target.id === 'radius') setRadius(e.target.value, 'range');
    if (e.target.id === 'radius-num' && e.target.value !== '') setRadius(e.target.value, 'num');
    if (e.target.id === 'budget') state.budget = Math.max(0, Number(e.target.value) || 0);
  });

  document.getElementById('tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) openTab(b.dataset.tab);
  });

  app.addEventListener('change', e => {
    if (e.target.id === 'post-photo' && e.target.files[0]) {
      readPhoto(e.target.files[0], url => { state.draft.photo = url; rerender(); });
    }
    if (e.target.id === 'area') state.area = e.target.value;
    if (e.target.id === 'alert-product') {
      const best = bestNearby(e.target.value);
      document.getElementById('alert-target').value = best ? suggestTarget(best.price).toFixed(2) : '';
    }
    if (e.target.id === 'radius-num') setRadius(e.target.value);
  });

  app.addEventListener('keydown', e => {
    if (e.target.id && e.target.id.startsWith('c-') && e.key === 'Enter') {
      const btn = document.querySelector(`[data-action="comment"][data-id="${e.target.id.slice(2)}"]`);
      if (btn) btn.click();
    }
    if (e.target.id === 'q' && e.key === 'Enter') {
      const first = document.querySelector('#suggest button');
      if (first) addItem(first.dataset.id);
    }
  });

  document.querySelector('.bar').addEventListener('click', e => {
    if (e.target.closest('[data-action="home"]')) go('home');
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
    if (state.screen === 'results') go('plan');
    else if (state.screen === 'plan') go('home');
    else if (state.screen === 'group') go('community');
  });

  // Deep links: #busy, #tight or #eco open a sample trip's results; #alerts, #community and #impact open those tabs.
  const linked = PRESETS[location.hash.slice(1)];
  if (linked) {
    Object.assign(state, { area: linked.area, mode: linked.mode, radius: linked.radius, maxStores: linked.maxStores, budget: linked.budget, selected: linked.selected });
    state.items = linked.items.map(([pid, qty]) => ({ id: pid, qty }));
    findTrip();
  } else if (['alerts', 'impact', 'community'].includes(location.hash.slice(1))) {
    go(location.hash.slice(1));
  } else {
    render();
  }
})();
