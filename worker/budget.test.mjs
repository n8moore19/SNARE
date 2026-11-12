// Offline check of the budget gate: fake storage, fake Claude, no network.
import { aiClient, readBudget, levelOf, recordUsd, budgetStatus, BudgetError } from "./src/budget.js";

const store = new Map();
const KV = { get: async (k, t) => (store.has(k) ? (t === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => store.set(k, v) };
const env = { AGENTS: KV, ANTHROPIC_API_KEY: "x", DAILY_BUDGET: "1.00", TOTAL_BUDGET: "4.50", BUDGET_EPOCH: "t1" };
let seen = [];
const fakeUsage = { input_tokens: 4000, output_tokens: 600 };

function client(purpose) {
  const c = aiClient(env, purpose);
  // swap the network call for a recorder
  const wrap = (fn) => async (p) => fn(p);
  return c;
}
// Patch the SDK: intercept fetch-level by monkeypatching Anthropic prototype is heavy; instead stub global fetch.
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  seen.push({ model: body.model, max_tokens: body.max_tokens, effort: body.output_config && body.output_config.effort, uses: (body.tools || []).map((t) => t.max_uses), fallbacks: body.fallbacks });
  return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: fakeUsage }), { status: 200, headers: { "content-type": "application/json" } });
};

const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const call = async (purpose, params) => {
  try { await aiClient(env, purpose).beta.messages.create(params); return "ok"; } catch (e) { return e instanceof BudgetError ? "budget:" + e.reason : "err:" + e.message; }
};
const base = { model: "claude-opus-5-5", max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium" }, system: "s", messages: [{ role: "user", content: "hi" }] };
const search = { ...base, model: "claude-sonnet-5-5", tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 12 }] };

// Full mode
ok((await call("agent", base)) === "ok", "full: agent call allowed");
ok(seen.at(-1).model === "claude-opus-5-5" && seen.at(-1).max_tokens === 12000 && seen.at(-1).effort === "medium", "full: keeps model and effort, caps answer at 12000 tokens");
ok((await call("agent", search)) === "ok" && seen.at(-1).uses[0] === 5, "full: web search allowed, capped at 5 searches");
let b = await budgetStatus(env);
ok(b.dayUsd > 0 && b.calls === 2, `spend recorded: $${b.dayUsd} over ${b.calls} calls`);

// Saving mode: spend 60 cents
await recordUsd(env, 0.6 - b.dayUsd);
b = await budgetStatus(env);
ok(b.mode === "Saving", `at $${b.dayUsd.toFixed(2)} today the mode is ${b.mode}`);
ok((await call("agent", base)) === "ok" && seen.at(-1).model === "claude-sonnet-5-5" && seen.at(-1).max_tokens === 6000 && seen.at(-1).effort === "low", "saving: Opus drops to Sonnet, 6000 tokens, low effort");
ok((await call("agent", search)) === "budget:low", "saving: web search agents are held");
ok((await call("chat", { ...base, model: "claude-sonnet-5-5" })) === "ok" && seen.at(-1).model === "claude-haiku-5-5" && seen.at(-1).fallbacks === undefined, "saving: Sonnet chat drops to Haiku, fallback removed");

// Minimal mode
b = await budgetStatus(env);
await recordUsd(env, 0.88 - b.dayUsd);
b = await budgetStatus(env);
ok(b.mode === "Minimal", `at $${b.dayUsd.toFixed(2)} today the mode is ${b.mode}`);
ok((await call("help", { ...base, model: "claude-haiku-5-5" })) === "ok" && seen.at(-1).max_tokens === 2000, "minimal: help chat still works, 2000 tokens");
ok((await call("scan", { ...base, model: "claude-sonnet-5-5" })) === "budget:low", "minimal: scans fall back to samples");
ok((await call("agent", base)) === "budget:low", "minimal: agents are held");

// Paused
await recordUsd(env, 0.2);
b = await budgetStatus(env);
ok(b.mode === "Paused" && (await call("help", { ...base, model: "claude-haiku-5-5" })) === "budget:spent", `over $1 today: ${b.mode}, even help is held`);

// New day resets the daily budget but not the total
const raw = JSON.parse(store.get("budget")); raw.day = "2000-01-01"; store.set("budget", JSON.stringify(raw));
b = await budgetStatus(env);
ok(b.dayUsd === 0 && b.totalUsd > 1 && b.mode === "Full", `next day: $0 today, $${b.totalUsd.toFixed(2)} total, ${b.mode}`);

// Total budget nearly gone forces saving even on a fresh day
const raw2 = JSON.parse(store.get("budget")); raw2.totalUsd = 3.9; store.set("budget", JSON.stringify(raw2));
b = await budgetStatus(env);
ok(b.mode === "Saving", `$0.60 left in total: ${b.mode}`);

// Daily cap on public chat
const raw3 = JSON.parse(store.get("budget")); raw3.totalUsd = 0; raw3.dayUsd = 0; raw3.day = b.day; raw3.counts = { chat: 40 }; store.set("budget", JSON.stringify(raw3));
ok((await call("chat", { ...base, model: "claude-haiku-5-5" })) === "budget:cap", "41st chat message of the day is held");

// Switched off
const raw4 = JSON.parse(store.get("budget")); raw4.enabled = false; raw4.counts = {}; store.set("budget", JSON.stringify(raw4));
ok((await call("help", { ...base, model: "claude-haiku-5-5" })) === "budget:off", "AI switched off: everything held");
