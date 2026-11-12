// The AI budget. Every Claude call in the worker goes through aiClient(), which:
//   1. checks today's spend and the total since the last top up,
//   2. picks how hard to work: full, saving, minimal or paused,
//   3. sizes the call to match (model, answer length, effort, web searches),
//   4. refuses before calling if the estimated cost won't fit,
//   5. records what the call actually cost.
// When a call is refused, the app falls back to its built in answers and
// sample scans, and agent runs stop with a plain "budget" message.

import Anthropic from "@anthropic-ai/sdk";

const PRICES = { opus: [4, 20], sonnet: [2, 10], haiku: [0.1, 0.5] }; // $ per million tokens, in and out
const SEARCH_USD = 0.01;
const PAD = 1.25; // estimates err on the high side
export const tierOf = (model) => (String(model).includes("haiku") ? "haiku" : String(model).includes("sonnet") ? "sonnet" : "opus");

// Levels: 3 full, 2 saving, 1 minimal, 0 paused. Each use needs at least this level.
const NEEDS = { help: 1, chat: 1, scan: 2, ask: 2, guard: 2, agent: 2, search: 3 };
export const LEVELS = ["Paused", "Minimal", "Saving", "Full"];
// Site wide daily caps for features anyone can use, on top of per visitor limits.
const DAILY_CAPS = { chat: 40, scan: 25, help: 40, ask: 30 };
const MAX_TOKENS = { 3: 12000, 2: 6000, 1: 2000 };
const MAX_SEARCHES = { 3: 5, 2: 2 };
const DOWN = { opus: "claude-sonnet-5-5", sonnet: "claude-haiku-5-5", haiku: "claude-haiku-5-5" };

export class BudgetError extends Error {
  constructor(reason) { super("BUDGET"); this.reason = reason; }
}

export const limits = (env) => ({ day: Number(env.DAILY_BUDGET) || 1, total: Number(env.TOTAL_BUDGET) || 4.5 });
const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());

export async function readBudget(env) {
  const day = dayKey();
  const epoch = String(env.BUDGET_EPOCH || "1");
  let b = env.AGENTS ? await env.AGENTS.get("budget", "json") : null;
  if (!b || b.epoch !== epoch) b = { epoch, totalUsd: 0, day, dayUsd: 0, calls: 0, counts: {}, enabled: b ? b.enabled !== false : true };
  if (b.day !== day) Object.assign(b, { day, dayUsd: 0, counts: {} });
  return b;
}
const saveBudget = (env, b) => (env.AGENTS ? env.AGENTS.put("budget", JSON.stringify(b)) : null);
const leftOf = (env, b) => { const L = limits(env); return Math.max(0, Math.min(L.day - b.dayUsd, L.total - b.totalUsd)); };

export function levelOf(env, b) {
  if (!b.enabled) return 0;
  const L = limits(env);
  const left = leftOf(env, b);
  if (left < 0.01) return 0;
  if (left / L.day >= 0.5 && L.total - b.totalUsd >= 1) return 3;
  if (left / L.day >= 0.2) return 2;
  return 1;
}

export async function budgetStatus(env) {
  const b = await readBudget(env);
  const L = limits(env);
  const level = levelOf(env, b);
  return { day: b.day, dayUsd: round(b.dayUsd), dayLimit: L.day, totalUsd: round(b.totalUsd), totalLimit: L.total, left: round(leftOf(env, b)), level, mode: LEVELS[level], enabled: b.enabled, counts: b.counts, caps: DAILY_CAPS, calls: b.calls };
}
export async function setEnabled(env, on) {
  const b = await readBudget(env);
  b.enabled = !!on;
  await saveBudget(env, b);
  return budgetStatus(env);
}
const round = (n) => Math.round(n * 10000) / 10000;

// Record a cost against today, the total and the month (for the hub).
export async function recordUsd(env, usd) {
  if (!env.AGENTS || !(usd > 0)) return;
  try {
    const b = await readBudget(env);
    b.dayUsd = round(b.dayUsd + usd); b.totalUsd = round(b.totalUsd + usd); b.calls = (b.calls || 0) + 1;
    await saveBudget(env, b);
    const key = `spend:${new Date().toISOString().slice(0, 7)}`;
    const m = (await env.AGENTS.get(key, "json")) || { usd: 0, calls: 0 };
    m.usd = round(m.usd + usd); m.calls += 1;
    await env.AGENTS.put(key, JSON.stringify(m));
  } catch (e) {
    console.error("Spend log failed:", e.message);
  }
}
export function costOf(model, usage, factor = 1) {
  const [pin, pout] = PRICES[tierOf(model)];
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  const searches = (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  return ((inTok * pin + (usage.output_tokens || 0) * pout) / 1e6) * factor + searches * SEARCH_USD;
}

const hasSearch = (p) => (p.tools || []).some((t) => String(t.type).startsWith("web_search"));

// Size a request to the budget level.
function shape(params, level, purpose) {
  const q = { ...params };
  const search = hasSearch(q);
  const tier = tierOf(q.model);
  if (level === 2 && tier !== "haiku") {
    let m = DOWN[tier];
    if ((search || purpose === "scan") && tierOf(m) === "haiku") m = "claude-sonnet-5-5";
    q.model = m;
  }
  if (level === 1) q.model = "claude-haiku-5-5";
  q.max_tokens = Math.min(q.max_tokens || 4000, MAX_TOKENS[level]);
  if (q.output_config && level < 3) q.output_config = { ...q.output_config, effort: "low" };
  if (search) q.tools = q.tools.map((t) => (String(t.type).startsWith("web_search") ? { ...t, max_uses: Math.min(t.max_uses || 5, MAX_SEARCHES[level] || 1) } : t));
  if (tierOf(q.model) === "haiku") {
    delete q.fallbacks;
    if (q.betas) { q.betas = q.betas.filter((x) => !x.startsWith("server-side-fallback")); if (!q.betas.length) delete q.betas; }
  }
  return q;
}

// A rough upper estimate of one call, before it is made.
function estimate(q) {
  let chars = 0, images = 0;
  const walk = (v) => {
    if (typeof v === "string") { chars += v.length; return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      if (v.type === "image") { images++; return; }
      Object.values(v).forEach(walk);
    }
  };
  walk(q.system); walk(q.messages);
  const searches = hasSearch(q) ? Math.max(...q.tools.map((t) => t.max_uses || 0)) : 0;
  const inTok = chars / 3.5 + images * 1600 + searches * 3000;
  const outTok = Math.min(q.max_tokens || 4000, 3000);
  const [pin, pout] = PRICES[tierOf(q.model)];
  return ((inTok * pin + outTok * pout) / 1e6 + searches * SEARCH_USD) * PAD;
}

async function admit(env, params, purpose, factor = 1) {
  const b = await readBudget(env);
  const level = levelOf(env, b);
  const need = hasSearch(params) ? NEEDS.search : NEEDS[purpose] ?? 2;
  if (level === 0) throw new BudgetError(b.enabled ? "spent" : "off");
  if (level < need) throw new BudgetError("low");
  const cap = DAILY_CAPS[purpose];
  if (cap && (b.counts[purpose] || 0) >= cap) throw new BudgetError("cap");
  const q = shape(params, level, purpose);
  if (estimate(q) * factor > leftOf(env, b)) throw new BudgetError("low");
  b.counts[purpose] = (b.counts[purpose] || 0) + 1;
  await saveBudget(env, b);
  return q;
}

// Drop in for new Anthropic(): same calls, budget checked and recorded.
export function aiClient(env, purpose) {
  const real = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const guarded = (call) => async (params, ...rest) => {
    const q = await admit(env, params, purpose);
    const r = await call(q, ...rest);
    if (r && r.usage) await recordUsd(env, costOf(q.model, r.usage) * 1.1);
    return r;
  };
  return {
    beta: { messages: { create: guarded((p, ...a) => real.beta.messages.create(p, ...a)) } },
    messages: {
      create: guarded((p, ...a) => real.messages.create(p, ...a)),
      batches: {
        // Batches are half price and billed when collected (see collectInsights).
        create: async (p) => {
          const requests = [];
          for (const r of p.requests) requests.push({ ...r, params: await admit(env, r.params, purpose, 0.5) });
          return real.messages.batches.create({ ...p, requests });
        },
        retrieve: (...a) => real.messages.batches.retrieve(...a),
        results: (...a) => real.messages.batches.results(...a),
      },
    },
  };
}

export const budgetMessage = (e) => ({ off: "AI is switched off on the hub", spent: "today's AI budget is used up", low: "there isn't enough AI budget left today", cap: "today's limit for this feature is reached" }[e.reason] || "the AI budget is paused");
