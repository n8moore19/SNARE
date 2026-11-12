// SNARE launch agents. Each agent reads real inputs where they exist, asks
// Claude for a structured result, and saves it to KV so the org page can show
// it. Agent 1 is the Chief of Staff: a daily brief for Team SNARE.

import Anthropic from "@anthropic-ai/sdk";
import { aiClient, BudgetError, budgetMessage, budgetStatus, setEnabled, recordUsd, costOf } from "./budget.js";

const REPO = "n8moore19/SNARE";
const TIMEZONE = "America/Toronto";
const MAX_TASKS = 100;

// The other agents, in build order. Their latest outputs feed the brief once
// they exist; until then the brief says they are not built yet.
const AGENT_IDS = ["market", "growth", "content", "sales", "insights", "router", "privacy", "support", "rewards"];

// No real users yet, so app metrics are sample numbers, labelled as such.
const SAMPLE_METRICS = {
  note: "SAMPLE DATA. SNARE has no real users yet. Treat every number here as illustrative and say so.",
  week: { newStudents: 84, signupGoal: 75, receiptsScanned: 1212, weeklyCheckinRate: 0.64, previousCheckinRate: 0.71, pointsEarned: 31400, giftCardPayoutsDollars: 468, payoutCapDollars: 500 },
};

const DEFAULT_TASKS = [
  { id: "t1", text: "Pivot SNARE to a free app plus a household food waste data business", owner: "Team", due: "", done: true },
  { id: "t2", text: "Run five validation interviews: a brand, a grocer, City of London, a students' union, students", owner: "Team", due: "", done: false },
  { id: "t3", text: "Launch a two week pilot with 20 students near Western", owner: "Team", due: "", done: false },
  { id: "t4", text: "Reach 50 students sharing data so real reports can be sold", owner: "Team", due: "", done: false },
  { id: "t5", text: "Send the first pitches to a bakery brand and a produce brand", owner: "Team", due: "", done: false },
  { id: "t6", text: "Book an intro call with City of London waste services", owner: "Team", due: "", done: false },
  { id: "t7", text: "Confirm a gift card reseller sells Loblaw gift cards in Canada", owner: "Team", due: "", done: false },
];

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    needsYou: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, detail: { type: "string" }, when: { type: "string", enum: ["today", "this week", "soon"] } },
        required: ["title", "detail", "when"],
        additionalProperties: false,
      },
    },
    deadlines: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, due: { type: "string" }, status: { type: "string", enum: ["on track", "at risk", "overdue", "no date"] } },
        required: ["title", "due", "status"],
        additionalProperties: false,
      },
    },
    shipped: { type: "array", items: { type: "string" } },
    metrics: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, value: { type: "string" }, sample: { type: "boolean" } },
        required: ["label", "value", "sample"],
        additionalProperties: false,
      },
    },
    risks: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "needsYou", "deadlines", "shipped", "metrics", "risks", "nextSteps"],
  additionalProperties: false,
};

const CHIEF_SYSTEM = `You are the Chief of Staff agent for Team SNARE, five students (Eason, Ava, Sally, Nate, Ruby) launching SNARE for the Ivey MSc Venturing Field Project.

SNARE is a free digital fridge app for students: snap a receipt, track what expires first, cook what you have, earn points (100 points = $1) that cash out as grocery gift cards. Students who opt in to anonymous sharing feed a household food waste panel; brands, grocers and cities pay for aggregate insights. Ten AI agents run most of the launch; humans approve three gates: the first data delivery to a new buyer, payouts over $500 a week, and anything the privacy agent cannot fix.

Each morning you write the team's daily operating brief for the business from the inputs you are given:
- tasks: the team's real task list and deadlines
- agents: the latest real output of each other agent (market research, student acquisition, content, sales prospects, insights, deliveries and offers, privacy checks, rewards)
- metrics: SAMPLE numbers, because there are no real users yet

Write about the business only: students, buyers, revenue, costs, risks and the launch. Never mention software, code, the website, the prototype, AI models, APIs, keys, workers, deployments or how the agents were built. Treat the agents as the team's operating staff.

Rules:
- Use only the inputs. Never invent tasks, deadlines, commits, buyers or numbers.
- Every metric taken from the sample block must have sample set to true. Never present sample numbers as real.
- needsYou lists only things a human must do or decide, most urgent first. Include gate items from agent outputs.
- deadlines covers open tasks. If a task has no due date, use status "no date" and due "". Mark overdue or at risk against today's date.
- shipped summarises real business progress in plain words: what the agents produced (leads found, groups found, posts ready, prospects pitched, reports written, checks passed) and tasks marked done.
- risks and nextSteps: at most 4 each, concrete and specific to the inputs.
- If an input is missing or empty, say so once in the most relevant section instead of guessing.
- Plain, warm, brief. Short sentences. No em dashes or hyphens used as dashes.`;

export const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// ---------- inputs ----------

async function getTasks(env) {
  const saved = env.AGENTS ? await env.AGENTS.get("tasks", "json") : null;
  return saved || DEFAULT_TASKS;
}

function validTasks(list) {
  if (!Array.isArray(list) || list.length > MAX_TASKS) return null;
  const clean = [];
  for (const t of list) {
    if (!t || typeof t.text !== "string" || !t.text.trim() || t.text.length > 200) return null;
    clean.push({
      id: String(t.id || crypto.randomUUID()).slice(0, 40),
      text: t.text.trim(),
      owner: typeof t.owner === "string" ? t.owner.slice(0, 40) : "",
      due: typeof t.due === "string" && /^(\d{4}-\d{2}-\d{2})?$/.test(t.due) ? t.due : "",
      done: !!t.done,
    });
  }
  return clean;
}

async function getCommits() {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits?since=${since}&per_page=30`, {
      headers: { "User-Agent": "snare-agents", Accept: "application/vnd.github+json" },
    });
    if (!r.ok) return { error: `GitHub returned ${r.status}` };
    const list = await r.json();
    return list.map((c) => ({ date: c.commit.author.date, author: c.commit.author.name, message: c.commit.message.split("\n")[0] }));
  } catch {
    return { error: "GitHub could not be reached" };
  }
}

async function getAgentOutputs(env) {
  const out = {};
  for (const id of AGENT_IDS) {
    const latest = env.AGENTS ? await env.AGENTS.get(`latest:${id}`, "json") : null;
    out[id] = latest ? { generatedAt: latest.generatedAt, output: latest.output } : "not built yet";
  }
  return out;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE, weekday: "long", year: "numeric", month: "long", day: "numeric" });

// ---------- the Chief of Staff ----------

export async function runChief(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("NO_KEY");
  const [tasks, agents] = await Promise.all([getTasks(env), getAgentOutputs(env)]);
  const inputs = { today: today(), tasks, agents, metrics: SAMPLE_METRICS };

  const client = aiClient(env, "agent");
  const response = await client.beta.messages.create({
    model: env.AGENT_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    // If Claude declines, retry on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: BRIEF_SCHEMA } },
    system: CHIEF_SYSTEM,
    messages: [{ role: "user", content: `Write today's brief from these inputs (JSON):\n${JSON.stringify(inputs)}` }],
  });
  const record = {
    agent: "chief",
    generatedAt: new Date().toISOString(),
    output: JSON.parse(textOf(response)),
    sources: {
      tasks: tasks.length,
      agentsLive: AGENT_IDS.filter((id) => agents[id] !== "not built yet"),
      metrics: "sample",
    },
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
  return save(env, "chief", record);
}

// ---------- shared ----------

const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

function textOf(response) {
  if (response.stop_reason === "refusal") throw new Error("REFUSED");
  if (response.stop_reason === "max_tokens") throw new Error("TOO_LONG");
  const text = response.content.find((b) => b.type === "text");
  if (!text) throw new Error("EMPTY");
  return text.text;
}

async function save(env, id, record) {
  if (env.AGENTS) await env.AGENTS.put(`latest:${id}`, JSON.stringify(record));
  return record;
}

// Live web research with Claude's server side search tool. A long turn can
// pause; resend it to resume. Returns the notes and every link search returned.
async function research(client, { model, system, prompt, maxUses }) {
  const sources = new Map();
  const notes = [];
  let searches = 0, inTok = 0, outTok = 0;
  const messages = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < 5; turn++) {
    const r = await client.beta.messages.create({
      model, max_tokens: 16000, ...FALLBACK,
      output_config: { effort: "medium" },
      system,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses, user_location: { type: "approximate", city: "London", region: "Ontario", country: "CA", timezone: TIMEZONE } }],
      messages,
    });
    inTok += r.usage.input_tokens; outTok += r.usage.output_tokens;
    if (r.stop_reason === "refusal") throw new Error("REFUSED");
    for (const b of r.content) {
      if (b.type === "server_tool_use") searches++;
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const x of b.content) if (x.type === "web_search_result") sources.set(x.url, { url: x.url, title: x.title, age: x.page_age || "" });
      }
      if (b.type === "text") notes.push(b.text);
    }
    if (r.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: r.content });
  }
  if (!sources.size) throw new Error("NO_SOURCES");
  return { notes, sources, searches, inTok, outTok };
}

async function structure(client, { model, system, schema, content }) {
  const f = await client.beta.messages.create({
    model, max_tokens: 16000, ...FALLBACK,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  return { output: JSON.parse(textOf(f)), inTok: f.usage.input_tokens, outTok: f.usage.output_tokens };
}

// ---------- live activity ----------
// One small KV record the org page polls: which agents are working right now,
// and the latest events (starts, finishes, reviews, deliveries, gate items).
// "from" and "to" name the agents whose work flows in and out, so the page can
// animate real communication along the network.

const READS = {
  chief: ["market", "growth", "content", "sales", "insights", "router", "privacy", "support", "rewards"],
  market: [], growth: ["market"], content: ["market", "growth", "insights"], sales: ["market"],
  insights: ["sales"], router: ["insights", "sales"], privacy: ["content", "growth", "sales", "router"], support: [], rewards: ["router"],
};
const SENDS = {
  chief: ["team"], market: ["sales", "content", "growth", "chief"], growth: ["content", "privacy", "chief"], content: ["privacy", "chief"],
  sales: ["insights", "router", "privacy", "chief"], insights: ["sales", "router", "content", "chief"], router: ["privacy", "rewards", "chief"],
  privacy: ["content", "growth", "sales", "router", "chief"], support: ["chief"], rewards: ["chief"],
};
const STALE_MS = 10 * 60e3;

async function readActivity(env) {
  const a = env.AGENTS ? await env.AGENTS.get("activity", "json") : null;
  return a || { running: {}, events: [] };
}

export async function activity(env, ev, running) {
  if (!env.AGENTS) return;
  try {
    const a = await readActivity(env);
    if (ev) a.events = [...a.events, { t: new Date().toISOString(), ...ev }].slice(-120);
    if (running) {
      const [id, on] = running;
      if (on) a.running[id] = Date.now(); else delete a.running[id];
    }
    await env.AGENTS.put("activity", JSON.stringify(a));
  } catch (e) {
    console.error("Activity log failed:", e.message);
  }
}

function runSummary(id, rec) {
  if (!rec) return "Finished";
  if (rec.pending) return "Sent this week's reports to Claude as a half price batch";
  const o = rec.output || {};
  if (id === "privacy") return `Checked the queue: ${o.waiting || 0} waiting at Gate 3`;
  if (id === "rewards" && o.book) return `Weekly close: ${o.book.flags.length} fraud flags, ${o.billing.invoices.length} invoices ready`;
  if (id === "growth" && o.newGroups) return `${o.newGroups.length} new student groups. ${o.headline || ""}`.trim();
  if (id === "sales" && o.newProspects) return `${o.newProspects.length} new prospects. ${o.headline || ""}`.trim();
  if (id === "content" && o.pieces) return `${o.pieces.length} posts ready. ${o.headline || ""}`.trim();
  return o.headline || "Finished";
}

// Plain words for the activity feed, never raw API errors.
function plainError(e) {
  if (e instanceof BudgetError) return `paused, ${budgetMessage(e)}`;
  const known = { NO_KEY: "the API key is missing", NO_STORE: "storage is not set up", REFUSED: "Claude declined the request", TOO_LONG: "the answer was cut off", EMPTY: "Claude sent an empty answer", NO_SOURCES: "web search found nothing" };
  if (known[e.message]) return known[e.message];
  if (e.status === 401) return "the API key was rejected";
  if (e.status === 429) return "Claude was busy, it will try again next run";
  if (e.status >= 500) return "Claude had a temporary problem";
  if (e.status === 400) return "Claude rejected the request";
  if (e instanceof SyntaxError) return "the answer was not in the expected format";
  return "an unexpected error";
}

// Wraps a run so the org page can see it start, work and finish.
// ---------- estimated spend ----------
// Claude reports tokens on every call; the worker adds up an estimated cost
// per month (list prices, cache discounts not counted) for the hub scoreboard.
const PRICES = { opus: [4, 20], sonnet: [2, 10], haiku: [0.1, 0.5] };
const tierOf = (model) => (String(model).includes("haiku") ? "haiku" : String(model).includes("sonnet") ? "sonnet" : "opus");
const AGENT_MODEL_VAR = { chief: "AGENT_MODEL", market: "MARKET_MODEL", growth: "GROWTH_MODEL", content: "CONTENT_MODEL", sales: "SALES_MODEL", insights: "INSIGHTS_MODEL", router: "ROUTER_MODEL", privacy: "PRIVACY_MODEL", rewards: "REWARDS_MODEL" };
const DEFAULT_MODEL = { chief: "claude-sonnet-5-5", market: "claude-sonnet-5-5", growth: "claude-sonnet-5-5", content: "claude-sonnet-5-5", sales: "claude-sonnet-5-5", insights: "claude-sonnet-5-5", router: "claude-sonnet-5-5", privacy: "claude-sonnet-5-5", rewards: "claude-haiku-5-5" };
export const modelFor = (env, id) => env[AGENT_MODEL_VAR[id]] || DEFAULT_MODEL[id] || "claude-opus-5-5";

// Batch results are recorded when collected (half price); everything else is
// recorded by aiClient() as each call returns.
export async function addSpend(env, model, inTok = 0, outTok = 0, extraUsd = 0, factor = 1) {
  await recordUsd(env, costOf(model, { input_tokens: inTok, output_tokens: outTok }, factor) * 1.1 + extraUsd);
}

export async function tracked(env, id, fn) {
  await activity(env, { agent: id, type: "start", from: READS[id] || [], text: "Started" }, [id, true]);
  try {
    const rec = await fn(env);
    await activity(env, { agent: id, type: "done", to: rec && rec.pending ? [] : SENDS[id] || [], text: runSummary(id, rec).slice(0, 200) }, [id, false]);
    return rec;
  } catch (error) {
    await activity(env, { agent: id, type: "error", text: `Stopped: ${plainError(error)}` }, [id, false]);
    throw error;
  }
}

// ---------- agent 2: Market intelligence ----------
// Two steps: research with live web search (Claude's server tool), then turn
// the notes into a structured brief. Findings keep only links that search
// actually returned, so the brief can't cite a made up source.

const DEFAULT_WATCHLIST = [
  { id: "w1", topic: "Competitors: Too Good To Go, Flashfood, Fetch rewards, Kitche and Remy, Olio, fridge and expiry tracking apps", kind: "competitor" },
  { id: "w2", topic: "Food brands in Canada changing pack sizes or packaging to cut food waste (bread, salad, produce, dairy)", kind: "buyer" },
  { id: "w3", topic: "Canadian grocers (Loblaw, Sobeys, Metro, Walmart Canada) food waste programs and data partnerships", kind: "buyer" },
  { id: "w5", topic: "Household food waste measurement and policy in Canada and the City of London, Ontario green bin program", kind: "policy" },
  { id: "w6", topic: "Student food insecurity and grocery prices in Canada, especially London, Ontario", kind: "market" },
];

const MARKET_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["competitor", "buyer lead", "funding", "policy", "market"] },
          title: { type: "string" },
          summary: { type: "string" },
          whyItMatters: { type: "string" },
          url: { type: "string" },
          source: { type: "string" },
          date: { type: "string" },
          sendTo: { type: "string", enum: ["sales", "content", "growth", "team", "none"] },
        },
        required: ["category", "title", "summary", "whyItMatters", "url", "source", "date", "sendTo"],
        additionalProperties: false,
      },
    },
    watchNext: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "items", "watchNext"],
  additionalProperties: false,
};

const MARKET_RESEARCH_SYSTEM = `You are the Market intelligence agent for SNARE, a student startup in London, Ontario (Ivey Venturing Field Project).
SNARE is a free digital fridge app for students that rewards logging what they buy, use and throw out. Students who opt in feed an anonymous household food waste panel that SNARE sells to food brands, grocers and cities. Watch competitors, buyers who might pay for food waste data, household food waste policy, and student food costs. Searches are set to London, Ontario: cover Canada, with London first.

Research the watchlist with web search. Focus on the last 30 days, and older only when it is still the latest news. Prefer primary and reputable sources. For each finding note what happened, the date, the source and URL, and why it matters to SNARE. Say plainly when you found nothing new for a topic. Do not speculate beyond what sources say.`;

const MARKET_FORMAT_SYSTEM = `You turn research notes into SNARE's weekly market brief.
Rules:
- Use only findings from the notes, and only URLs from the allowed source list, copied exactly.
- 4 to 10 items, most useful first. Skip anything older than 90 days unless it is the latest on a watched topic.
- whyItMatters is one or two sentences specific to SNARE.
- sendTo: "sales" for buyer leads, "content" for post ideas, "growth" for student acquisition ideas, "team" for decisions, otherwise "none".
- date as YYYY-MM-DD when known, otherwise "".
- headline: one sentence on the most important thing this week.
- watchNext: up to 3 things to check next week.
- Plain, short sentences. No em dashes or hyphens used as dashes.`;

async function getWatchlist(env) {
  const saved = env.AGENTS ? await env.AGENTS.get("watchlist", "json") : null;
  return saved || DEFAULT_WATCHLIST;
}

function validWatchlist(list) {
  if (!Array.isArray(list) || list.length > 20) return null;
  const kinds = ["competitor", "buyer", "funding", "policy", "market"];
  const clean = [];
  for (const w of list) {
    if (!w || typeof w.topic !== "string" || !w.topic.trim() || w.topic.length > 300) return null;
    clean.push({ id: String(w.id || crypto.randomUUID()).slice(0, 40), topic: w.topic.trim(), kind: kinds.includes(w.kind) ? w.kind : "market" });
  }
  return clean;
}

export async function runMarket(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("NO_KEY");
  const watchlist = await getWatchlist(env);
  const model = env.MARKET_MODEL || "claude-sonnet-5-5";
  const client = aiClient(env, "agent");

  // Step 1: research with live web search.
  const r = await research(client, {
    model, system: MARKET_RESEARCH_SYSTEM, maxUses: 12,
    prompt: `Today is ${today()}. Research this watchlist:\n${watchlist.map((w) => `- [${w.kind}] ${w.topic}`).join("\n")}`,
  });
  const { notes, sources, searches } = r;

  // Step 2: structure the notes. Only real links survive.
  const f = await structure(client, {
    model, system: MARKET_FORMAT_SYSTEM, schema: MARKET_SCHEMA,
    content: `Today is ${today()}.\n\nResearch notes:\n${notes.join("\n\n")}\n\nAllowed sources (JSON):\n${JSON.stringify([...sources.values()])}`,
  });
  const inTok = r.inTok + f.inTok, outTok = r.outTok + f.outTok;
  const output = f.output;
  const before = output.items.length;
  output.items = output.items.filter((i) => sources.has(i.url));

  return save(env, "market", {
    agent: "market",
    generatedAt: new Date().toISOString(),
    output,
    sources: { searches, links: sources.size, dropped: before - output.items.length, watchlist: watchlist.length },
    usage: { input: inTok, output: outTok },
  });
}

// ---------- agent 3: Student acquisition ----------
// Finds real student groups and campus events at Western and Fanshawe, drafts
// outreach the team sends, plans campaigns, and tracks the real waitlist.

const JOIN_URL = "https://n8moore19.github.io/SNARE/join.html";
const GROUP_STATUSES = ["new", "contacted", "replied", "partner", "not a fit"];
const CAMPUSES = ["Western", "Fanshawe", "Other"];

const GROWTH_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          campus: { type: "string", enum: ["Western", "Fanshawe"] },
          type: { type: "string", enum: ["sustainability", "food", "cooking", "business", "residence", "students' union", "other"] },
          why: { type: "string" },
          contact: { type: "string" },
          url: { type: "string" },
          channel: { type: "string", enum: ["email", "instagram", "contact form", "in person"] },
          subject: { type: "string" },
          message: { type: "string" },
        },
        required: ["name", "campus", "type", "why", "contact", "url", "channel", "subject", "message"],
        additionalProperties: false,
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" }, campus: { type: "string" }, event: { type: "string" }, idea: { type: "string" }, url: { type: "string" },
        },
        required: ["date", "campus", "event", "idea", "url"],
        additionalProperties: false,
      },
    },
    ambassador: { type: "string" },
    referral: { type: "string" },
    waitlistRead: { type: "string" },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "groups", "events", "ambassador", "referral", "waitlistRead", "nextSteps"],
  additionalProperties: false,
};

const GROWTH_RESEARCH_SYSTEM = `You are the Student acquisition agent for SNARE, a student startup from the Ivey Business School at Western University in London, Ontario.
SNARE is a free digital fridge app for students: snap a receipt, see what expires first, cook what you have, and earn points that cash out as grocery gift cards. It is pre launch and building a waitlist and a pilot with 20 students.

Use web search to find, at Western University and Fanshawe College only:
1. Real student groups that fit SNARE: sustainability, food, cooking, nutrition, food security, business and entrepreneurship clubs, residence councils, and students' union roles for sustainability or student life (Western USC, Fanshawe Student Union). For each, find its official public contact: a club email, Instagram handle or contact page, and the page you found it on.
2. Real campus events in the next 8 weeks where SNARE could show up: club fairs, sustainability weeks, food drives, exam season, residence events.

Only report what pages actually show. Use organisations' official contacts only, never a private person's details. Skip groups already in the pipeline.`;

const GROWTH_FORMAT_SYSTEM = `You turn research notes into SNARE's weekly student acquisition plan.
Rules:
- groups: up to 8 new groups from the notes, best fit first, none already in the pipeline. url must come from the allowed sources, copied exactly. contact is the official public email, handle or contact page from the notes, or "" if none was found.
- For each group write one outreach message the team will send themselves, from "Team SNARE (Ivey students)". Under 120 words, friendly, specific to that group, honest that SNARE is pre launch, with one clear ask (share the waitlist, a 10 minute chat, or a table at their event). Include the literal text {{JOIN_LINK}} where the waitlist link goes. subject is "" for Instagram.
- events: real upcoming events from the notes with a concrete idea for each. date as YYYY-MM-DD when known. url from the allowed sources or "".
- ambassador and referral: one short paragraph each, specific to these campuses and the current waitlist numbers.
- waitlistRead: one or two sentences reading the real waitlist numbers you are given. Never invent numbers.
- nextSteps: up to 4.
- Plain, short sentences. No em dashes or hyphens used as dashes.`;

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "group";

async function getGroups(env) {
  return (env.AGENTS ? await env.AGENTS.get("groups", "json") : null) || [];
}

function validGroups(list) {
  if (!Array.isArray(list) || list.length > 300) return null;
  const clean = [];
  for (const g of list) {
    if (!g || typeof g.name !== "string" || !g.name.trim() || g.name.length > 120) return null;
    const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    clean.push({
      id: str(g.id, 40) || crypto.randomUUID(), name: g.name.trim(), campus: CAMPUSES.includes(g.campus) ? g.campus : "Other",
      type: str(g.type, 40), why: str(g.why, 400), contact: str(g.contact, 200), url: str(g.url, 500), channel: str(g.channel, 30),
      subject: str(g.subject, 200), message: str(g.message, 2000), link: str(g.link, 300),
      status: GROUP_STATUSES.includes(g.status) ? g.status : "new", notes: str(g.notes, 500), added: str(g.added, 30),
    });
  }
  return clean;
}

// Waitlist: one KV key per email, with campus and source in the key's
// metadata so the summary can be built from a key listing alone.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

async function waitlistKeys(env) {
  const keys = [];
  if (!env.AGENTS) return keys;
  let cursor;
  do {
    const page = await env.AGENTS.list({ prefix: "wl:", cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}

async function waitlistSummary(env) {
  const keys = await waitlistKeys(env);
  const week = 7 * 864e5, now = Date.now();
  const byCampus = {}, bySource = {};
  const byWeek = [0, 0, 0, 0, 0, 0, 0, 0];
  let last7 = 0;
  for (const k of keys) {
    const m = k.metadata || {};
    byCampus[m.campus || "Other"] = (byCampus[m.campus || "Other"] || 0) + 1;
    bySource[m.source || "direct"] = (bySource[m.source || "direct"] || 0) + 1;
    const age = now - (m.t || now);
    if (age < week) last7++;
    const w = Math.floor(age / week);
    if (w < 8) byWeek[7 - w]++;
  }
  return { total: keys.length, last7, byCampus, bySource, byWeek };
}

async function joinWaitlist(request, env, cors) {
  if (!env.AGENTS) return json({ error: "The waitlist isn't open yet" }, 503, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Please check your email address" }, 400, cors);
  if (body.remove) {
    await env.AGENTS.delete(`wl:${email}`);
    return json({ removed: true }, 200, cors);
  }
  if (body.consent !== true) return json({ error: "Please tick the box to agree" }, 400, cors);
  const campus = CAMPUSES.includes(body.campus) ? body.campus : "Other";
  const source = slug(String(body.source || "direct")) || "direct";
  const existing = await env.AGENTS.getWithMetadata(`wl:${email}`);
  if (!existing.value) await env.AGENTS.put(`wl:${email}`, "1", { metadata: { campus, source, t: Date.now() } });
  return json({ joined: true }, 200, cors);
}

export async function runGrowth(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("NO_KEY");
  const model = env.GROWTH_MODEL || "claude-sonnet-5-5";
  const client = aiClient(env, "agent");
  const [groups, waitlist, market] = await Promise.all([
    getGroups(env), waitlistSummary(env), env.AGENTS ? env.AGENTS.get("latest:market", "json") : null,
  ]);
  const known = groups.map((g) => `${g.name} (${g.campus})`);
  const marketForGrowth = market ? market.output.items.filter((i) => i.sendTo === "growth").map((i) => i.title) : [];

  const r = await research(client, {
    model, system: GROWTH_RESEARCH_SYSTEM, maxUses: 10,
    prompt: `Today is ${today()}.\nAlready in the pipeline, skip these: ${known.length ? known.join("; ") : "none yet"}.\nFind new groups and upcoming events.`,
  });
  const f = await structure(client, {
    model, system: GROWTH_FORMAT_SYSTEM, schema: GROWTH_SCHEMA,
    content: `Today is ${today()}.\n\nReal waitlist numbers (JSON): ${JSON.stringify(waitlist)}\nAlready in the pipeline: ${known.join("; ") || "none"}\nIdeas sent by Market intelligence: ${marketForGrowth.join("; ") || "none"}\n\nResearch notes:\n${r.notes.join("\n\n")}\n\nAllowed sources (JSON):\n${JSON.stringify([...r.sources.values()])}`,
  });
  const out = f.output;

  // Keep only groups with a real source link, skip duplicates, and give each
  // one its own waitlist link so sign ups show which group they came from.
  const seen = new Set(groups.map((g) => g.name.toLowerCase()));
  const added = [];
  for (const g of out.groups) {
    if (!r.sources.has(g.url) || seen.has(g.name.toLowerCase())) continue;
    seen.add(g.name.toLowerCase());
    const link = `${env.JOIN_URL || JOIN_URL}?src=${slug(g.name)}`;
    added.push({ ...g, id: crypto.randomUUID(), message: g.message.split("{{JOIN_LINK}}").join(link), link, status: "new", notes: "", added: new Date().toISOString().slice(0, 10) });
  }
  out.events = out.events.filter((e) => !e.url || r.sources.has(e.url));
  const gg = await guard(env, added.map((x) => ({
    id: x.id, kind: "outreach", title: `Message to ${x.name}`, ref: { groupId: x.id }, fields: { subject: x.subject, message: x.message },
    context: "A message the team sends to a student club or residence council from their own account.",
  })));
  for (const x of added) { const r = gg[x.id]; x.subject = r.fields.subject; x.message = r.fields.message; x.privacy = { status: r.status, issues: r.issues }; }
  if (env.AGENTS && added.length) await env.AGENTS.put("groups", JSON.stringify([...groups, ...added]));

  return save(env, "growth", {
    agent: "growth",
    generatedAt: new Date().toISOString(),
    output: { headline: out.headline, newGroups: added.map((g) => g.name), events: out.events, ambassador: out.ambassador, referral: out.referral, waitlistRead: out.waitlistRead, nextSteps: out.nextSteps },
    sources: { searches: r.searches, links: r.sources.size, groupsFound: out.groups.length, groupsAdded: added.length, waitlist: waitlist.total },
    usage: { input: r.inTok + f.inTok, output: r.outTok + f.outTok },
  });
}

// ---------- agent 4: Content creation ----------
// Six pieces a week: Instagram, LinkedIn and campus posters or blurbs. Built
// from real cited food waste facts, other agents' work and the app's real
// recipes. Every number must cite a link that search returned; pieces with a
// bad citation are dropped. The team posts them; the page draws the images.

const SITE_URL = "https://n8moore19.github.io/SNARE";
const POST_STATUSES = ["draft", "ready", "posted", "skip"];
// Illustrations the org page can draw.
const SCENES = ["fridge", "spinach", "bread", "eggs", "tomatoes", "groceries", "phone", "pan"];

const CONTENT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    pieces: {
      type: "array",
      items: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["instagram", "instagram carousel", "linkedin", "poster", "blurb"] },
          title: { type: "string" },
          basedOn: { type: "string", enum: ["fact", "market", "event", "recipe"] },
          recipeId: { type: "string" },
          slides: {
            type: "array",
            items: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" } }, required: ["heading", "body"], additionalProperties: false },
          },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          facts: {
            type: "array",
            items: { type: "object", properties: { claim: { type: "string" }, url: { type: "string" }, source: { type: "string" } }, required: ["claim", "url", "source"], additionalProperties: false },
          },
          altText: { type: "string" },
          postWhen: { type: "string" },
          design: {
            type: "object",
            properties: {
              layout: { type: "string", enum: ["big number", "food scene", "receipt"] },
              scene: { type: "string", enum: SCENES },
              palette: { type: "string", enum: ["lime", "forest", "cream", "night", "tomato"] },
              bigNumber: { type: "string" },
              bigLabel: { type: "string" },
            },
            required: ["layout", "scene", "palette", "bigNumber", "bigLabel"],
            additionalProperties: false,
          },
        },
        required: ["format", "title", "basedOn", "recipeId", "slides", "caption", "hashtags", "facts", "altText", "postWhen", "design"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "pieces"],
  additionalProperties: false,
};

const CONTENT_RESEARCH_SYSTEM = `You research facts for SNARE's social posts. SNARE is a free digital fridge app for students in London, Ontario that helps them waste less food and earn grocery money; students who opt in feed an anonymous household food waste panel.
Use web search to find real, recent, well sourced numbers about household food waste and food costs: Canada first (Environment and Climate Change Canada, Second Harvest, National Zero Waste Council, Statistics Canada), then Ontario, students and young adults, and global numbers from the UN Environment Programme. For each fact record the exact number, what it measures, the year, and the page it came from. Skip anything you cannot source.`;

const CONTENT_FORMAT_SYSTEM = `You are SNARE's Content creation agent. Write exactly 6 pieces for this week from the inputs.
Mix: 2 to 3 Instagram (single "instagram" or "instagram carousel"), 1 to 2 "linkedin", and 1 to 2 campus pieces ("poster" for residence boards, "blurb" for club newsletters or the students' union).
Sources:
- Facts: use only facts from the research notes. Every number in a piece must appear in its facts list with a URL copied exactly from the allowed sources. If a piece uses no numbers, facts is [].
- Market ideas and campus events from the other agents, when given.
- Recipes: use only recipes from the recipe list, by its exact id in recipeId (otherwise ""). Never state a price for a recipe.
Never use app metrics or user numbers; SNARE has no real users yet. Never claim SNARE has launched: it is pre launch with a waitlist and a pilot.
Writing:
- slides: the text on the image. Single images and posters 1 slide; carousels 3 to 5. heading under 8 words, body under 30 words. A blurb has 1 slide with the headline and the full blurb as body.
- caption: Instagram under 120 words; LinkedIn 80 to 180 words, aimed at food brands, grocers, cities and the Ivey community; blurb and poster captions are a short note to the club or residence on how to share it.
- Instagram and poster CTA: join the waitlist at {{JOIN_LINK}}. LinkedIn CTA: follow along or get in touch.
- hashtags: 0 to 6, none for blurbs. altText describes the image.
- postWhen: a suggested day this week, like "Thursday".
- design: how the image looks. Vary it across the 6 pieces: use at least two layouts and three palettes.
  - layout "big number": only for a piece with facts. bigNumber is the number exactly as written in one of its fact claims (like "58%" or "2.2 million"), bigLabel says what it measures in under 10 words. Otherwise bigNumber and bigLabel are "".
  - layout "receipt": text styled as a grocery receipt. Good for recipes, ingredient lists, and "what students buy" posts.
  - layout "food scene": an illustration with the text. The default.
  - scene: the illustration that fits best (fridge, spinach, bread, eggs, tomatoes, groceries, phone for receipt snapping, pan for cooking).
  - palette: lime and forest are SNARE's main colours; cream, night and tomato add variety. LinkedIn usually forest or night.
- Warm, plain, student voice. No em dashes or hyphens used as dashes. No emoji in slides.
headline: one sentence on this week's theme.`;

async function getRecipes() {
  try {
    const r = await fetch(`${SITE_URL}/agents/recipes.json`);
    return r.ok ? (await r.json()).recipes : [];
  } catch {
    return [];
  }
}

export async function runContent(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("NO_KEY");
  const model = env.CONTENT_MODEL || "claude-sonnet-5-5";
  const client = aiClient(env, "agent");
  const [recipes, market, growth] = await Promise.all([
    getRecipes(),
    env.AGENTS ? env.AGENTS.get("latest:market", "json") : null,
    env.AGENTS ? env.AGENTS.get("latest:growth", "json") : null,
  ]);
  const ideas = market ? market.output.items.filter((i) => i.sendTo === "content").map((i) => ({ title: i.title, summary: i.summary, url: i.url })) : [];
  const insights = env.AGENTS ? await env.AGENTS.get("latest:insights", "json") : null;
  const panelStats = insights && insights.output.mode === "real" ? insights.output.contentStats : [];
  const events = growth ? growth.output.events : [];

  const r = await research(client, {
    model, system: CONTENT_RESEARCH_SYSTEM, maxUses: 8,
    prompt: `Today is ${today()}. Find 6 to 10 strong, current facts for posts this week.`,
  });
  // Market ideas carry their own real links; allow those too.
  for (const i of ideas) if (i.url) r.sources.set(i.url, { url: i.url, title: i.title, age: "" });

  const f = await structure(client, {
    model, system: CONTENT_FORMAT_SYSTEM, schema: CONTENT_SCHEMA,
    content: `Today is ${today()}.\n\nResearch notes:\n${r.notes.join("\n\n")}\n\nAllowed sources (JSON):\n${JSON.stringify([...r.sources.values()])}\n\nIdeas from Market intelligence (JSON): ${JSON.stringify(ideas)}\nCampus events from Student acquisition (JSON): ${JSON.stringify(events)}\nReal stats from SNARE's own student panel (each covers at least 50 students; cite source "SNARE student panel" with url ""; may be empty): ${JSON.stringify(panelStats)}\n\nRecipes (JSON): ${JSON.stringify(recipes.map(({ id, name, minutes, serves, meal, usesUp }) => ({ id, name, minutes, serves, meal, usesUp })))}`,
  });

  // Drop any piece with a citation search didn't return or a recipe that doesn't exist.
  const ids = new Set(recipes.map((x) => x.id));
  const before = f.output.pieces.length;
  const weekKey = new Date().toISOString().slice(0, 10);
  const pieces = f.output.pieces
    .filter((p) => p.facts.every((x) => r.sources.has(x.url) || (x.url === "" && x.source === "SNARE student panel" && panelStats.length)) && (!p.recipeId || ids.has(p.recipeId)))
    .map((p, n) => {
      const link = `${env.JOIN_URL || JOIN_URL}?src=${p.format === "poster" ? "poster" : p.format === "blurb" ? "club-blurb" : p.format.split(" ")[0]}`;
      const fill = (t) => t.split("{{JOIN_LINK}}").join(link);
      const recipe = p.recipeId ? recipes.find((x) => x.id === p.recipeId) : null;
      // A big number must come straight from a cited fact, or the layout falls back.
      const digits = (t) => t.replace(/[^0-9]/g, "");
      if (p.design.layout === "big number" && (!digits(p.design.bigNumber) || !p.facts.some((x) => digits(x.claim).includes(digits(p.design.bigNumber))))) {
        p.design = { ...p.design, layout: "food scene", bigNumber: "", bigLabel: "" };
      }
      return { ...p, id: `${weekKey}-${n + 1}`, link, caption: fill(p.caption), slides: p.slides.map((x) => ({ heading: fill(x.heading), body: fill(x.body) })), recipe: recipe ? { name: recipe.name, minutes: recipe.minutes, serves: recipe.serves } : null };
    });

  // Privacy guard: fix what it can, hold the rest at Gate 3.
  const g = await guard(env, pieces.map((p) => {
    const fields = { caption: p.caption };
    p.slides.forEach((x, n) => { fields[`slide${n}_heading`] = x.heading; fields[`slide${n}_body`] = x.body; });
    return {
      id: p.id, kind: "post", title: `${p.format}: ${p.title}`, ref: { pieceId: p.id }, fields,
      context: "A public social post or campus poster. Facts cite public sources; SNARE panel stats are only allowed from the real panel.",
      holdIf: [{ when: p.facts.some((x) => x.source === "SNARE student panel") && !panelStats.length, issue: "Uses SNARE panel numbers that are not from the real panel" }],
    };
  }));
  for (const p of pieces) {
    const r = g[p.id];
    p.caption = r.fields.caption;
    p.slides = p.slides.map((x, n) => ({ heading: r.fields[`slide${n}_heading`], body: r.fields[`slide${n}_body`] }));
    p.privacy = { status: r.status, issues: r.issues };
  }

  return save(env, "content", {
    agent: "content",
    generatedAt: new Date().toISOString(),
    output: { headline: f.output.headline, pieces },
    sources: { searches: r.searches, links: r.sources.size, dropped: before - pieces.length, recipes: recipes.length, ideas: ideas.length, events: events.length },
    usage: { input: r.inTok + f.inTok, output: r.outTok + f.outTok },
  });
}

// ---------- agent 5: B2B sales ----------
// Finds food brands, grocers and governments that could buy SNARE's food
// waste insights. Organisation and role only, never personal details. Writes
// an email and a one page pitch per prospect; the team sends. Stats must cite
// links the search returned; the example insight is always marked illustrative.

const DEAL_STAGES = ["new", "contacted", "replied", "meeting", "proposal", "won", "lost"];

const SALES_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    prospects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          org: { type: "string" },
          type: { type: "string", enum: ["food brand", "grocer", "government"] },
          whyNow: { type: "string" },
          roleToReach: { type: "string" },
          route: { type: "string" },
          routeUrl: { type: "string" },
          question: { type: "string" },
          offer: { type: "string", enum: ["single report", "annual subscription", "custom study"] },
          sources: { type: "array", items: { type: "string" } },
          email: {
            type: "object",
            properties: { subject: { type: "string" }, body: { type: "string" } },
            required: ["subject", "body"], additionalProperties: false,
          },
          onePager: {
            type: "object",
            properties: {
              headline: { type: "string" },
              problem: { type: "string" },
              whatWeTrack: { type: "array", items: { type: "string" } },
              exampleInsight: { type: "string" },
              stats: {
                type: "array",
                items: { type: "object", properties: { claim: { type: "string" }, url: { type: "string" }, source: { type: "string" } }, required: ["claim", "url", "source"], additionalProperties: false },
              },
              ask: { type: "string" },
            },
            required: ["headline", "problem", "whatWeTrack", "exampleInsight", "stats", "ask"], additionalProperties: false,
          },
        },
        required: ["org", "type", "whyNow", "roleToReach", "route", "routeUrl", "question", "offer", "sources", "email", "onePager"],
        additionalProperties: false,
      },
    },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "prospects", "nextSteps"],
  additionalProperties: false,
};

const OFFERS = {
  "single report": "A single insight report, about $5K",
  "annual subscription": "An annual subscription, about $10K a year",
  "custom study": "A custom study, about $20K to $50K",
};

const SALES_RESEARCH_SYSTEM = `You are the B2B sales agent for SNARE, a student startup from the Ivey Business School in London, Ontario.
SNARE is a free digital fridge app for students. Students who opt in feed an anonymous household food waste panel: what gets bought, used and thrown out, when, and why. SNARE sells aggregate insights (never individual data) to food brands (pack size, packaging, shelf life), grocers (home spoilage, campus stocking, store brands) and governments (Canada has no national household food waste baseline). It is pre launch: a waitlist and a 20 student pilot, no real panel data yet.

Use web search to find new, specific prospects in Canada, preferring those with recent news that makes SNARE timely (a pack size change, a food waste commitment, a sustainability report, a city waste study, a green bin program). For each prospect find: why now (with the source page), the role that would buy (like Director of Consumer Insights or Manager of Waste Diversion), a public route in (partnerships page, general contact, media or sustainability inbox) with its page, and one or two real public stats relevant to them. Organisations and roles only: never collect a private person's name, email or phone.`;

const SALES_FORMAT_SYSTEM = `You turn research into SNARE's weekly B2B sales prospects.
Rules:
- Up to 5 new prospects from the notes, best fit first, mixing types when possible, none already in the pipeline.
- sources: URLs from the allowed list that support whyNow. routeUrl and every stat url must be copied exactly from the allowed list, or routeUrl "" if none.
- route: how to reach them in words, like "Partnerships form on their sustainability page". Never a person's name or personal email.
- question: the one question SNARE's data answers for this prospect.
- offer: "single report" for most brands, "annual subscription" for grocers, "custom study" for governments, unless the notes suggest otherwise.
- email: from "Team SNARE, Ivey Business School students". Under 150 words. Honest that SNARE is pre launch and building a student panel. Specific to their news. Ask for a 20 minute conversation or feedback on a sample report. Do not state prices in the email.
- onePager: headline (under 12 words), problem (2 sentences, with their context), whatWeTrack (3 to 5 short items), exampleInsight (one sentence showing the kind of finding they'd get; it is illustrative and must not present a number as real), stats (1 to 3 real stats from the notes with urls), ask (one sentence).
- headline: one sentence on this week's prospecting. nextSteps: up to 4.
- Plain, short sentences. No em dashes or hyphens used as dashes.`;

async function getProspects(env) {
  return (env.AGENTS ? await env.AGENTS.get("prospects", "json") : null) || [];
}

export async function runSales(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("NO_KEY");
  const model = env.SALES_MODEL || "claude-opus-5-5";
  const client = aiClient(env, "agent");
  const [prospects, market] = await Promise.all([getProspects(env), env.AGENTS ? env.AGENTS.get("latest:market", "json") : null]);
  const known = prospects.map((x) => x.org);
  const leads = market ? market.output.items.filter((i) => i.sendTo === "sales" || i.category === "buyer lead").map((i) => ({ title: i.title, summary: i.summary, url: i.url })) : [];

  const r = await research(client, {
    model, system: SALES_RESEARCH_SYSTEM, maxUses: 12,
    prompt: `Today is ${today()}.\nAlready in the pipeline, skip these: ${known.join("; ") || "none yet"}.\nLeads from Market intelligence (JSON): ${JSON.stringify(leads)}\nFind new prospects across food brands, grocers and government.`,
  });
  for (const l of leads) if (l.url) r.sources.set(l.url, { url: l.url, title: l.title, age: "" });

  const f = await structure(client, {
    model, system: SALES_FORMAT_SYSTEM, schema: SALES_SCHEMA,
    content: `Today is ${today()}.\nAlready in the pipeline: ${known.join("; ") || "none"}\n\nResearch notes:\n${r.notes.join("\n\n")}\n\nAllowed sources (JSON):\n${JSON.stringify([...r.sources.values()])}`,
  });

  // Keep prospects backed by real links; strip any stat or route that isn't.
  const seen = new Set(known.map((x) => x.toLowerCase()));
  const added = [];
  for (const p of f.output.prospects) {
    const sources = p.sources.filter((u) => r.sources.has(u));
    if (!sources.length || seen.has(p.org.toLowerCase())) continue;
    seen.add(p.org.toLowerCase());
    added.push({
      ...p, sources,
      id: crypto.randomUUID(),
      routeUrl: r.sources.has(p.routeUrl) ? p.routeUrl : "",
      onePager: { ...p.onePager, stats: p.onePager.stats.filter((x) => r.sources.has(x.url)) },
      offerText: OFFERS[p.offer],
      status: "new", notes: "", added: new Date().toISOString().slice(0, 10),
    });
  }
  const sg = await guard(env, added.map((x) => ({
    id: x.id, kind: "sales", title: `Pitch to ${x.org}`, ref: { prospectId: x.id },
    fields: { emailSubject: x.email.subject, emailBody: x.email.body, headline: x.onePager.headline, problem: x.onePager.problem, exampleInsight: x.onePager.exampleInsight, ask: x.onePager.ask },
    context: "A B2B email and one page pitch to an organisation. SNARE is pre launch with no real panel data; the example insight must read as illustrative.",
  })));
  for (const x of added) {
    const r = sg[x.id].fields;
    x.email = { subject: r.emailSubject, body: r.emailBody };
    x.onePager = { ...x.onePager, headline: r.headline, problem: r.problem, exampleInsight: r.exampleInsight, ask: r.ask };
    x.privacy = { status: sg[x.id].status, issues: sg[x.id].issues };
  }
  if (env.AGENTS && added.length) await env.AGENTS.put("prospects", JSON.stringify([...prospects, ...added]));

  return save(env, "sales", {
    agent: "sales",
    generatedAt: new Date().toISOString(),
    output: { headline: f.output.headline, newProspects: added.map((x) => `${x.org} (${x.type})`), nextSteps: f.output.nextSteps },
    sources: { searches: r.searches, links: r.sources.size, found: f.output.prospects.length, added: added.length, leads: leads.length },
    usage: { input: r.inTok + f.inTok, output: r.outTok + f.outTok },
  });
}

// Status and notes only; the agent owns the rest of each prospect.
async function updateProspect(env, body) {
  const list = await getProspects(env);
  const p = list.find((x) => x.id === body.id);
  if (!p) return null;
  if (body.status !== undefined) {
    if (!DEAL_STAGES.includes(body.status)) return null;
    p.status = body.status;
  }
  if (body.notes !== undefined) p.notes = String(body.notes).slice(0, 1000);
  if (body.remove) list.splice(list.indexOf(p), 1);
  await env.AGENTS.put("prospects", JSON.stringify(list));
  return list;
}

// ---------- agent 6: Insights analyst ----------
// Real panel: pilot students who switch on anonymous sharing send used and
// tossed events from the app into D1. Every number needs at least 50 distinct
// students (K). Until the real panel reaches 50, reports run on a clearly
// labelled sample panel and switch to real data automatically. The weekly
// brief and prospect reports run as a Message Batch at half price: submitted
// on Fridays, collected on the next scheduled check.

const K = 50;
const DAY_MS = 864e5;
const EVENT_TYPES = ["bought", "used", "tossed"];
const REASONS = ["went off", "forgot", "too much", "didn't like", "unknown"];

const SAMPLE_PANEL = {
  students: 1240, period: "last 28 days",
  products: [
    ["Fresh spinach", "produce", 610, 0.41, 4.2], ["Whole wheat bread", "bakery", 702, 0.31, 5.1], ["Romaine lettuce", "produce", 388, 0.28, 4.8],
    ["Mushrooms", "produce", 305, 0.24, 4.4], ["Plain yogurt", "dairy", 344, 0.19, 9.6], ["Milk 2%", "dairy", 881, 0.14, 8.2],
    ["Flour tortillas", "bakery", 297, 0.11, 10.4], ["Eggs", "eggs", 812, 0.04, 16.0],
  ].map(([product, category, students, wasteShare, avgDaysToToss]) => ({ product, category, students, wasteShare, avgDaysToToss })),
  reasons: [["went off", 0.44], ["forgot", 0.27], ["too much", 0.18], ["didn't like", 0.11]].map(([reason, share]) => ({ reason, share })),
  weekly: [3.1, 3.4, 3.8, 3.6, 5.6, 4.0, 4.2, 4.4, 4.9, 5.3, 7.0, 6.4].map((kgPer100, i) => ({ week: i + 1, kgPer100 })),
  campus: [{ campus: "Western", students: 812, wasteShare: 0.19 }, { campus: "Fanshawe", students: 428, wasteShare: 0.17 }],
  household: [{ household: "solo", students: 318, wasteShare: 0.24 }, { household: "shared", students: 922, wasteShare: 0.16 }],
};

async function ensurePanel(env) {
  await env.PANEL.prepare(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, pid TEXT NOT NULL, t INTEGER NOT NULL, type TEXT NOT NULL, product TEXT NOT NULL, category TEXT, days REAL, reason TEXT, campus TEXT, household TEXT, source TEXT)`).run();
  await env.PANEL.prepare("CREATE INDEX IF NOT EXISTS events_t ON events (t)").run();
  await env.PANEL.prepare("CREATE INDEX IF NOT EXISTS events_pid ON events (pid)").run();
}

async function recordEvents(request, env, cors) {
  if (!env.PANEL) return json({ error: "Panel storage is not set up" }, 503, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
  const pid = String(body.pid || "");
  if (!/^[a-z0-9]{12,40}$/.test(pid)) return json({ error: "Invalid id" }, 400, cors);
  await ensurePanel(env);
  if (body.forget) {
    await env.PANEL.prepare("DELETE FROM events WHERE pid = ?").bind(pid).run();
    return json({ forgotten: true }, 200, cors);
  }
  const list = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  const now = Date.now();
  const campus = ["Western", "Fanshawe", "Other"].includes(body.campus) ? body.campus : "Other";
  const household = body.household === "shared" ? "shared" : "solo";
  const str = (v, n) => String(v || "").replace(/[^a-z0-9 _%'-]/gi, "").slice(0, n);
  const rows = [];
  for (const e of list) {
    const t = Number(e.t) || now;
    if (!EVENT_TYPES.includes(e.type) || t < now - 30 * DAY_MS || t > now + 3600e3) continue;
    const days = Number.isFinite(Number(e.days)) ? Math.max(-60, Math.min(400, Number(e.days))) : null;
    rows.push(env.PANEL.prepare("INSERT INTO events (pid, t, type, product, category, days, reason, campus, household, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(pid, t, e.type, str(e.product, 40), str(e.category, 20), days, e.type === "tossed" && REASONS.includes(e.reason) ? e.reason : null, campus, household, str(e.source, 20)));
  }
  if (rows.length) await env.PANEL.batch(rows);
  return json({ saved: rows.length }, 200, cors);
}

// Aggregates with the K rule applied to every cell.
async function realPanel(env) {
  if (!env.PANEL) return { students: 0 };
  await ensurePanel(env);
  const since = Date.now() - 28 * DAY_MS;
  const q = (sql, ...args) => env.PANEL.prepare(sql).bind(...args).all().then((r) => r.results);
  const [size] = await q("SELECT COUNT(DISTINCT pid) AS n FROM events WHERE t > ?", since);
  const students = size ? size.n : 0;
  if (students < K) return { students };
  const share = "CAST(SUM(type = 'tossed') AS REAL) / NULLIF(SUM(type IN ('used', 'tossed')), 0)";
  const products = await q(`SELECT product, category, COUNT(DISTINCT pid) AS students, ${share} AS wasteShare, AVG(CASE WHEN type = 'tossed' THEN days END) AS avgDaysToToss FROM events WHERE t > ? GROUP BY product HAVING students >= ? ORDER BY wasteShare DESC LIMIT 20`, since, K);
  const reasonRows = await q("SELECT reason, COUNT(*) AS n, COUNT(DISTINCT pid) AS s FROM events WHERE t > ? AND type = 'tossed' AND reason IS NOT NULL AND reason != 'unknown' GROUP BY reason HAVING s >= ?", since, K);
  const total = reasonRows.reduce((t, r) => t + r.n, 0) || 1;
  const weekly = await q("SELECT CAST(t / 604800000 AS INTEGER) AS week, COUNT(DISTINCT pid) AS s, SUM(type = 'tossed') AS tossed FROM events WHERE t > ? GROUP BY week HAVING s >= ? ORDER BY week", Date.now() - 84 * DAY_MS, K);
  const campus = await q(`SELECT campus, COUNT(DISTINCT pid) AS students, ${share} AS wasteShare FROM events WHERE t > ? GROUP BY campus HAVING students >= ?`, since, K);
  const household = await q(`SELECT household, COUNT(DISTINCT pid) AS students, ${share} AS wasteShare FROM events WHERE t > ? GROUP BY household HAVING students >= ?`, since, K);
  return {
    students, period: "last 28 days",
    products: products.map((r) => ({ ...r, wasteShare: Math.round((r.wasteShare || 0) * 100) / 100, avgDaysToToss: r.avgDaysToToss == null ? null : Math.round(r.avgDaysToToss * 10) / 10 })),
    reasons: reasonRows.map((r) => ({ reason: r.reason, share: Math.round((r.n / total) * 100) / 100 })),
    weekly: weekly.map((r, i) => ({ week: i + 1, itemsTossedPerStudent: Math.round((r.tossed / r.s) * 10) / 10 })),
    campus: campus.map((r) => ({ ...r, wasteShare: Math.round((r.wasteShare || 0) * 100) / 100 })),
    household: household.map((r) => ({ ...r, wasteShare: Math.round((r.wasteShare || 0) * 100) / 100 })),
  };
}

export async function panelSnapshot(env) {
  const real = await realPanel(env);
  return real.students >= K
    ? { mode: "real", k: K, realStudents: real.students, panel: real }
    : { mode: "sample", k: K, realStudents: real.students, panel: SAMPLE_PANEL };
}

const BRIEF_SCHEMA_INSIGHTS = {
  type: "object",
  properties: {
    headline: { type: "string" },
    topWaste: { type: "array", items: { type: "object", properties: { item: { type: "string" }, figure: { type: "string" }, note: { type: "string" } }, required: ["item", "figure", "note"], additionalProperties: false } },
    timing: { type: "string" },
    reasons: { type: "string" },
    forBuyers: { type: "array", items: { type: "string" } },
    contentStats: { type: "array", items: { type: "object", properties: { stat: { type: "string" }, context: { type: "string" } }, required: ["stat", "context"], additionalProperties: false } },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "topWaste", "timing", "reasons", "forBuyers", "contentStats", "nextSteps"],
  additionalProperties: false,
};

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    answer: { type: "string" },
    findings: { type: "array", items: { type: "object", properties: { finding: { type: "string" }, figure: { type: "string" } }, required: ["finding", "figure"], additionalProperties: false } },
    chartProducts: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" },
    method: { type: "string" },
  },
  required: ["title", "answer", "findings", "chartProducts", "recommendation", "method"],
  additionalProperties: false,
};

const INSIGHTS_SYSTEM = `You are SNARE's Insights analyst. SNARE runs an anonymous household food waste panel of students in London, Ontario who opted in to sharing. You get aggregate panel numbers in which every cell already covers at least 50 students.
Rules:
- Use only numbers in the panel data. Never invent, extrapolate or round into new claims. wasteShare is the share of used or tossed items that were tossed.
- The input says whether the panel is "real" or "sample". If sample, every output is an illustration of the format: say so plainly and never present a sample number as a real finding. contentStats must be [] when the panel is sample.
- Plain, short sentences. No em dashes or hyphens used as dashes.`;

async function getPending(env) { return env.AGENTS ? env.AGENTS.get("insights:pending", "json") : null; }

export async function runInsights(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("NO_KEY");
  if (!env.AGENTS) throw new Error("NO_STORE");
  const pending = await getPending(env);
  if (pending) return { pending };
  const snap = await panelSnapshot(env);
  const prospects = (await getProspects(env)).filter((p) => p.status !== "lost").slice(0, 8);
  const model = env.INSIGHTS_MODEL || "claude-opus-5-5";
  const data = JSON.stringify({ mode: snap.mode, panel: snap.panel });
  const params = (schema, content) => ({
    model, max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system: INSIGHTS_SYSTEM,
    messages: [{ role: "user", content }],
  });
  const requests = [{
    custom_id: "brief",
    params: params(BRIEF_SCHEMA_INSIGHTS, `Today is ${today()}. Write the weekly insights brief: what students wasted most, when, and why; what it means for buyers (food brands, grocers, cities); and, only if the panel is real, 2 to 4 shareable stats for social posts with context. Panel (JSON): ${data}`),
  }, ...prospects.map((p) => ({
    custom_id: `report-${p.id}`.slice(0, 64),
    params: params(REPORT_SCHEMA, `Today is ${today()}. Write a short insight report for ${p.org} (${p.type}). Their question: "${p.question}". Answer it from the panel only; if the panel cannot answer it directly, say what it does show and what data would answer it. chartProducts: up to 6 product names from the panel to chart. method: one sentence on the panel and the 50 student rule. Panel (JSON): ${data}`),
  }))];

  const client = aiClient(env, "agent");
  const batch = await client.messages.batches.create({ requests });
  const record = { batchId: batch.id, submittedAt: new Date().toISOString(), mode: snap.mode, realStudents: snap.realStudents, panel: snap.panel, prospects: prospects.map((p) => ({ id: p.id, org: p.org })) };
  await env.AGENTS.put("insights:pending", JSON.stringify(record));
  return { pending: record };
}

// Collect a finished batch. Cheap when nothing is pending.
export async function collectInsights(env) {
  const pending = await getPending(env);
  if (!pending || !env.ANTHROPIC_API_KEY) return null;
  const client = aiClient(env, "agent");
  const batch = await client.messages.batches.retrieve(pending.batchId);
  if (batch.processing_status !== "ended") return null;
  let brief = null; const reports = {}; let inTok = 0, outTok = 0, errors = 0;
  for await (const r of await client.messages.batches.results(pending.batchId)) {
    if (r.result.type !== "succeeded") { errors++; continue; }
    const m = r.result.message;
    inTok += m.usage.input_tokens; outTok += m.usage.output_tokens;
    let out;
    try { out = JSON.parse(textOf(m)); } catch { errors++; continue; }
    if (r.custom_id === "brief") brief = out;
    else reports[r.custom_id.replace(/^report-/, "")] = out;
  }
  if (brief && pending.mode !== "real") brief.contentStats = []; // never share sample numbers
  await addSpend(env, env.INSIGHTS_MODEL || "claude-sonnet-5-5", inTok, outTok, 0, 0.5); // batch: half price
  await env.AGENTS.delete("insights:pending");
  if (!brief && !Object.keys(reports).length) return null;
  await activity(env, { agent: "insights", type: "done", to: SENDS.insights, text: `Batch back: weekly brief and ${Object.keys(reports).length} prospect reports (${pending.mode} panel)` });
  return save(env, "insights", {
    agent: "insights",
    generatedAt: new Date().toISOString(),
    output: { mode: pending.mode, brief, reports, prospects: pending.prospects, panel: pending.panel, contentStats: brief ? brief.contentStats : [] },
    sources: { mode: pending.mode, realStudents: pending.realStudents, reports: Object.keys(reports).length, errors, batch: true },
    usage: { input: inTok, output: outTok },
  });
}

// ---------- agent 7: Data and offers router ----------
// Deliveries: every prospect marked "won" becomes a buyer with a private link
// (buyer.html?t=token). The first delivery waits at Gate 1 for a person; after
// that, each new insight report for that buyer is delivered on the daily run.
// Offers: the team manages them on the org page; the app downloads the active
// list and matches rules on the student's own phone. Only anonymous shown and
// redeemed counts come back, and brands only see counts of 50 or more.

const OFFER_RULES = ["everyone", "tossed", "bought"];

async function getBuyers(env) { return (env.AGENTS ? await env.AGENTS.get("buyers", "json") : null) || []; }
async function getOffers(env) { return (env.AGENTS ? await env.AGENTS.get("offers", "json") : null) || []; }

function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function validOffers(list) {
  if (!Array.isArray(list) || list.length > 100) return null;
  const clean = [];
  for (const o of list) {
    if (!o || typeof o.brand !== "string" || !o.brand.trim() || typeof o.product !== "string" || !/^[a-z_]{2,30}$/.test(o.product)) return null;
    const rule = o.rule && OFFER_RULES.includes(o.rule.type) ? o.rule : { type: "everyone" };
    const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    clean.push({
      id: str(o.id, 40) || "o" + Date.now().toString(36),
      brand: o.brand.trim().slice(0, 60), product: o.product, text: str(o.text, 120) || `Buy ${o.product}`, note: str(o.note, 160),
      points: Math.max(10, Math.min(500, Math.round(Number(o.points) || 50))),
      rule: { type: rule.type, product: /^[a-z_]{0,30}$/.test(rule.product || "") ? rule.product || "" : "", minTimes: Math.max(1, Math.min(10, Math.round(Number(rule.minTimes) || 1))) },
      buyerId: str(o.buyerId, 40), active: o.active !== false, created: str(o.created, 30) || new Date().toISOString().slice(0, 10),
    });
  }
  return clean;
}

async function ensureOfferTable(env) {
  await env.PANEL.prepare("CREATE TABLE IF NOT EXISTS offer_events (id INTEGER PRIMARY KEY, offer TEXT NOT NULL, event TEXT NOT NULL, sid TEXT NOT NULL, t INTEGER NOT NULL, UNIQUE (offer, event, sid))").run();
}

async function recordOfferEvent(request, env, cors) {
  if (!env.PANEL) return json({ error: "Panel storage is not set up" }, 503, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
  if (!["shown", "redeemed"].includes(body.event) || !/^[a-z0-9]{12,40}$/.test(String(body.sid || "")) || !/^[a-z0-9_-]{1,40}$/i.test(String(body.offer || ""))) return json({ error: "Invalid event" }, 400, cors);
  await ensureOfferTable(env);
  await env.PANEL.prepare("INSERT OR IGNORE INTO offer_events (offer, event, sid, t) VALUES (?, ?, ?, ?)").bind(body.offer, body.event, body.sid, Date.now()).run();
  return json({ ok: true }, 200, cors);
}

// Distinct students per offer. Counts under 50 are hidden from brands.
async function offerStats(env) {
  if (!env.PANEL) return {};
  await ensureOfferTable(env);
  const rows = (await env.PANEL.prepare("SELECT offer, event, COUNT(DISTINCT sid) AS n FROM offer_events GROUP BY offer, event").all()).results;
  const stats = {};
  for (const r of rows) {
    stats[r.offer] = stats[r.offer] || { shown: 0, redeemed: 0 };
    stats[r.offer][r.event] = r.n;
  }
  return stats;
}
const forBrand = (n) => (n >= K ? n : `fewer than ${K}`);

// Buyers come from won prospects; new ones wait at Gate 1.
async function syncBuyers(env) {
  const [buyers, prospects] = await Promise.all([getBuyers(env), getProspects(env)]);
  let changed = false;
  for (const p of prospects.filter((x) => x.status === "won")) {
    if (!buyers.some((b) => b.id === p.id)) {
      buyers.push({ id: p.id, org: p.org, type: p.type, offer: p.offerText || p.offer, token: newToken(), approved: false, revoked: false, deliveries: [], created: new Date().toISOString() });
      changed = true;
    }
  }
  if (changed && env.AGENTS) await env.AGENTS.put("buyers", JSON.stringify(buyers));
  return buyers;
}

// ---------- agent 8: Privacy guard ----------
// Checks everything that uses student data or speaks for SNARE before it goes
// out: buyer deliveries, social posts, outreach, sponsored offers. Hard rules
// in code first (personal contact details, the 50 student rule, sample data
// labelled), then a Claude review for anything subtler. Small problems are
// fixed; anything it can't fix is held at Gate 3 for a person. Every decision
// is logged. Panel events older than 12 months are deleted.

const RETENTION_DAYS = 365;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

const PRIVACY_POLICY = `SNARE privacy and honesty rules:
1. Never identify or single out a student or household. No private person's name, email, phone, address, residence room or exact location. Organisations, job roles and a club's official public contact are fine.
2. Panel numbers must cover at least 50 students. Never describe a group so narrow it could point to a few people (one residence floor, one small club, a rare diet on one street).
3. SNARE has no real panel data until 50 students share. Sample numbers must never be presented as real findings, and nothing may claim SNARE already has customers, partners or results it doesn't.
4. Keep the consent promises: totals only, never individual data; location off; nothing sold about one person; students can turn sharing off and their data is deleted.
5. Sponsored offers must be honest, not target sensitive traits (health, religion, ethnicity, sexuality, money trouble), never push students to buy more than they need, and never promote alcohol, tobacco or cannabis.
6. Outreach must be honest that SNARE is a pre launch student venture.`;

const GUARD_SCHEMA = {
  type: "object",
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["pass", "fix", "hold"] },
          issues: { type: "array", items: { type: "string" } },
          fixes: { type: "array", items: { type: "object", properties: { field: { type: "string" }, text: { type: "string" } }, required: ["field", "text"], additionalProperties: false } },
        },
        required: ["id", "verdict", "issues", "fixes"],
        additionalProperties: false,
      },
    },
  },
  required: ["reviews"],
  additionalProperties: false,
};

const GUARD_SYSTEM = `You are SNARE's Privacy guard. Review each item against these rules before it leaves SNARE.
${PRIVACY_POLICY}
For each item return a verdict:
- "pass" when nothing breaks a rule.
- "fix" when a small rewrite of one or more fields solves it. Give the full corrected text for each field you change, changing as little as possible and keeping the tone. Only use field names given.
- "hold" when it can't be fixed safely by rewriting, or when you are unsure. A person will decide.
issues: short plain sentences naming the rule and the problem. Empty for a pass. No em dashes or hyphens used as dashes.`;

// Code rules run first and can only make text safer.
function hardRules(item) {
  const issues = [];
  const fields = { ...item.fields };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== "string") continue;
    let t = v;
    const emails = (t.match(EMAIL_IN_TEXT) || []).filter((e) => !(item.allowEmails || []).includes(e.toLowerCase()));
    if (emails.length) { emails.forEach((e) => { t = t.split(e).join("[removed]"); }); issues.push(`Removed an email address from ${k}`); }
    if (PHONE_IN_TEXT.test(t)) { t = t.replace(PHONE_IN_TEXT, "[removed]"); issues.push(`Removed a phone number from ${k}`); }
    PHONE_IN_TEXT.lastIndex = 0;
    fields[k] = t;
  }
  for (const h of item.holdIf || []) if (h.when) issues.push(h.issue);
  return { fields, issues, hold: (item.holdIf || []).some((h) => h.when) };
}

async function privacyLog(env, entries) {
  if (!env.AGENTS || !entries.length) return;
  const log = (await env.AGENTS.get("privacy:log", "json")) || [];
  log.push(...entries);
  await env.AGENTS.put("privacy:log", JSON.stringify(log.slice(-300)));
}

async function privacyQueue(env, held) {
  if (!env.AGENTS || !held.length) return;
  const q = (await env.AGENTS.get("privacy:queue", "json")) || [];
  for (const h of held) if (!q.some((x) => x.qid === h.qid && x.status === "held")) q.push(h);
  await env.AGENTS.put("privacy:queue", JSON.stringify(q.slice(-200)));
}

// items: [{ id, kind, title, ref, fields: { name: text }, allowEmails?, holdIf?: [{ when, issue }] }]
// Returns { [id]: { status: "passed" | "fixed" | "held", issues, fields } }.
export async function guard(env, items) {
  const out = {};
  if (!items.length) return out;
  const hard = Object.fromEntries(items.map((i) => [i.id, hardRules(i)]));
  let reviews = {};
  let reviewed = false;
  if (env.ANTHROPIC_API_KEY) {
    try {
      const client = aiClient(env, "guard");
      const f = await structure(client, {
        model: env.PRIVACY_MODEL || "claude-sonnet-5-5", system: GUARD_SYSTEM, schema: GUARD_SCHEMA,
        content: `Items (JSON):\n${JSON.stringify(items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, context: i.context || "", fields: hard[i.id].fields })))}`,
      });
      reviews = Object.fromEntries(f.output.reviews.map((r) => [r.id, r]));
      reviewed = true;
    } catch (e) {
      console.error("Privacy review failed:", e.message);
    }
  }
  const log = [], held = [];
  for (const i of items) {
    const h = hard[i.id];
    const r = reviews[i.id];
    const fields = { ...h.fields };
    let status = h.issues.length ? "fixed" : "passed";
    const issues = [...h.issues];
    if (h.hold) status = "held";
    if (!reviewed) { status = "held"; issues.push("The Claude review could not run, so a person needs to check this"); }
    else if (!r) { status = "held"; issues.push("The review skipped this item"); }
    else {
      issues.push(...r.issues);
      if (r.verdict === "hold") status = "held";
      if (r.verdict === "fix" && status !== "held") {
        for (const fx of r.fixes) if (fx.field in fields) fields[fx.field] = fx.text;
        // A fix must still pass the code rules.
        const again = hardRules({ ...i, fields });
        if (again.issues.length) { status = "held"; issues.push("The rewrite still broke a rule"); } else status = "fixed";
      }
    }
    out[i.id] = { status, issues, fields, checkedAt: new Date().toISOString(), method: reviewed ? "rules and Claude review" : "rules only" };
    log.push({ t: out[i.id].checkedAt, kind: i.kind, title: i.title.slice(0, 120), status, issues: issues.slice(0, 5) });
    if (status === "held") held.push({ qid: `${i.kind}:${i.id}`.slice(0, 80), kind: i.kind, title: i.title.slice(0, 160), ref: i.ref, issues, fields, created: out[i.id].checkedAt, status: "held" });
  }
  await privacyLog(env, log);
  await privacyQueue(env, held);
  const AGENT_OF = { post: "content", outreach: "growth", sales: "sales", offer: "router", delivery: "router" };
  const from = [...new Set(items.map((i) => AGENT_OF[i.kind]).filter(Boolean))];
  const count = (st) => Object.values(out).filter((x) => x.status === st).length;
  await activity(env, { agent: "privacy", type: "review", from, to: [...from, ...(held.length ? ["team"] : [])], text: `Checked ${items.length} item${items.length === 1 ? "" : "s"}: ${count("passed")} passed, ${count("fixed")} fixed, ${held.length} held at Gate 3` });
  return out;
}

// Daily: delete panel events older than 12 months.
export async function runRetention(env) {
  if (!env.PANEL) return { deleted: 0 };
  await ensurePanel(env);
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  const a = await env.PANEL.prepare("DELETE FROM events WHERE t < ?").bind(cutoff).run();
  await ensureOfferTable(env);
  const b = await env.PANEL.prepare("DELETE FROM offer_events WHERE t < ?").bind(cutoff).run();
  await ensureRewardTable(env);
  const c = await env.PANEL.prepare("DELETE FROM reward_events WHERE t < ?").bind(cutoff).run();
  const deleted = (a.meta.changes || 0) + (b.meta.changes || 0) + (c.meta.changes || 0);
  if (env.AGENTS) await env.AGENTS.put("privacy:retention", JSON.stringify({ at: new Date().toISOString(), deleted, keepDays: RETENTION_DAYS }));
  return { deleted };
}

async function deliverOne(env, buyer, insights, stats, offers, force = false) {
  const original = insights && insights.output.reports ? insights.output.reports[buyer.id] : null;
  if (!original) return null;
  const last = buyer.deliveries[buyer.deliveries.length - 1];
  if (last && last.reportAt === insights.generatedAt) return null;
  if (!force && (buyer.heldReport === insights.generatedAt || buyer.rejectedReport === insights.generatedAt)) return null;
  const report = { ...original, findings: original.findings.map((x) => ({ ...x })) };
  const panel = insights.output.panel || {};
  const delivery = {
    org: buyer.org, mode: insights.output.mode, report, reportAt: insights.generatedAt, deliveredAt: new Date().toISOString(),
    panel: { students: panel.students, period: panel.period, products: (panel.products || []).filter((x) => report.chartProducts.some((n) => n.toLowerCase() === x.product.toLowerCase())) },
    offers: offers.filter((o) => o.buyerId === buyer.id).map((o) => ({ text: o.text, points: o.points, shown: forBrand((stats[o.id] || {}).shown || 0), redeemed: forBrand((stats[o.id] || {}).redeemed || 0) })),
  };
  // The 50 student rule, enforced again on the way out.
  delivery.panel.products = delivery.panel.products.filter((x) => x.students == null || x.students >= K);
  if (force) delivery.privacy = { status: "approved", checks: ["Approved by a person at Gate 3"] };
  else {
    const fields = { title: report.title, answer: report.answer, recommendation: report.recommendation, method: report.method };
    report.findings.forEach((x, n) => { fields[`finding${n}`] = x.finding; });
    const g = (await guard(env, [{
      id: `${buyer.id}-${insights.generatedAt}`, kind: "delivery", title: `Report for ${buyer.org}: ${report.title}`, ref: { buyerId: buyer.id, reportAt: insights.generatedAt },
      context: `Panel mode: ${delivery.mode}. ${delivery.mode === "real" ? "" : "This is a sample panel; the buyer page shows a sample banner."}`, fields,
    }]))[`${buyer.id}-${insights.generatedAt}`];
    if (g.status === "held") { buyer.heldReport = insights.generatedAt; return null; }
    Object.assign(report, { title: g.fields.title, answer: g.fields.answer, recommendation: g.fields.recommendation, method: g.fields.method });
    report.findings.forEach((x, n) => { x.finding = g.fields[`finding${n}`]; });
    delivery.privacy = { status: g.status, checks: ["Every panel number covers at least 50 students", "No names, emails or locations", g.method === "rules only" ? "Code rules" : "Reviewed by the Privacy guard", ...(delivery.mode !== "real" ? ["Marked as a sample report"] : [])] };
  }
  await env.AGENTS.put(`delivery:${buyer.token}`, JSON.stringify(delivery));
  buyer.deliveries.push({ reportAt: insights.generatedAt, deliveredAt: delivery.deliveredAt, title: report.title, mode: delivery.mode });
  return delivery;
}

// Daily: deliver any new report to approved buyers. No model call, so it's free.
export async function deliverAll(env) {
  if (!env.AGENTS) return { delivered: 0 };
  const buyers = await syncBuyers(env);
  const [insights, stats, offers] = await Promise.all([env.AGENTS.get("latest:insights", "json"), offerStats(env), getOffers(env)]);
  let delivered = 0;
  for (const b of buyers.filter((x) => x.approved && !x.revoked)) if (await deliverOne(env, b, insights, stats, offers)) delivered++;
  await env.AGENTS.put("buyers", JSON.stringify(buyers));
  const waiting = buyers.filter((b) => !b.approved && !b.revoked).length;
  if (delivered || waiting) await activity(env, { agent: "router", type: "deliver", to: waiting ? ["team"] : [], text: `${delivered} report${delivered === 1 ? "" : "s"} delivered to buyers${waiting ? `, ${waiting} waiting at Gate 1` : ""}` });
  return { delivered, buyers: buyers.length, waiting };
}

async function updateBuyer(env, id, action) {
  const buyers = await syncBuyers(env);
  const b = buyers.find((x) => x.id === id);
  if (!b || !["approve", "revoke", "restore"].includes(action)) return null;
  if (action === "approve") b.approved = true;
  if (action === "revoke") { b.revoked = true; await env.AGENTS.delete(`delivery:${b.token}`); }
  if (action === "restore") { b.revoked = false; b.token = newToken(); b.deliveries = []; }
  await env.AGENTS.put("buyers", JSON.stringify(buyers));
  if (b.approved && !b.revoked) {
    const [insights, stats, offers] = await Promise.all([env.AGENTS.get("latest:insights", "json"), offerStats(env), getOffers(env)]);
    await deliverOne(env, b, insights, stats, offers);
    await env.AGENTS.put("buyers", JSON.stringify(buyers));
  }
  return buyers;
}

const ROUTER_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    offerIdeas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          brandType: { type: "string" }, product: { type: "string" }, ruleType: { type: "string", enum: OFFER_RULES }, ruleProduct: { type: "string" },
          offerText: { type: "string" }, points: { type: "integer" }, pitch: { type: "string" }, prospect: { type: "string" },
        },
        required: ["brandType", "product", "ruleType", "ruleProduct", "offerText", "points", "pitch", "prospect"],
        additionalProperties: false,
      },
    },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "offerIdeas", "nextSteps"],
  additionalProperties: false,
};

const ROUTER_SYSTEM = `You are SNARE's Data and offers router. SNARE matches sponsored offers to students on their own phones by simple rules: "everyone", "tossed" (students who threw out a product at least N times) or "bought" (bought a product at least N times). Brands pay for offers and get anonymous counts only.
From the insights brief, the panel, the sales pipeline and current offers, suggest up to 4 new offers worth pitching to brands: which product, which rule, the offer text a student sees (under 12 words, like "Try the small spinach bag"), points (50 to 200), and a one sentence pitch to the brand. product and ruleProduct must be ids from the product list ("" for ruleProduct when the rule is everyone). prospect: the org name from the pipeline it fits, or "". Prefer offers that cut waste (smaller packs, freezer tips, longer life products), never offers that push students to buy more than they need. If the panel is a sample, say the ideas are based on sample data.
Plain, short sentences. No em dashes or hyphens used as dashes.`;

const PRODUCT_IDS = ["bananas", "apples", "carrots", "potatoes", "onions", "garlic", "spinach", "tomatoes", "lettuce", "broccoli", "bell_pepper", "mushrooms", "cucumber", "green_onions", "frozen_spinach", "frozen_veg", "milk", "cheddar", "yogurt", "butter", "eggs", "chicken_thighs", "chicken_breast", "ground_beef", "tofu", "lentils", "black_beans", "tuna", "pasta", "pasta_sauce", "rice", "oats", "salsa", "bread", "tortillas"];

export async function runRouter(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("NO_KEY");
  if (!env.AGENTS) throw new Error("NO_STORE");
  const delivery = await deliverAll(env);
  const [insights, offers, prospects, stats] = await Promise.all([env.AGENTS.get("latest:insights", "json"), getOffers(env), getProspects(env), offerStats(env)]);
  const client = aiClient(env, "agent");
  const f = await structure(client, {
    model: env.ROUTER_MODEL || "claude-sonnet-5-5", system: ROUTER_SYSTEM, schema: ROUTER_SCHEMA,
    content: `Today is ${today()}.\nProduct ids: ${PRODUCT_IDS.join(", ")}\nInsights (JSON): ${JSON.stringify(insights ? { mode: insights.output.mode, brief: insights.output.brief, panel: insights.output.panel } : "none yet")}\nPipeline: ${JSON.stringify(prospects.filter((p) => p.status !== "lost").map((p) => ({ org: p.org, type: p.type, status: p.status, question: p.question })))}\nCurrent offers: ${JSON.stringify(offers.map((o) => ({ brand: o.brand, product: o.product, rule: o.rule, text: o.text })))}`,
  });
  const ideas = f.output.offerIdeas.filter((i) => PRODUCT_IDS.includes(i.product) && (i.ruleType === "everyone" || PRODUCT_IDS.includes(i.ruleProduct)));
  return save(env, "router", {
    agent: "router",
    generatedAt: new Date().toISOString(),
    output: {
      headline: f.output.headline, offerIdeas: ideas, nextSteps: f.output.nextSteps,
      deliveries: delivery,
      offerStats: offers.map((o) => ({ brand: o.brand, text: o.text, shown: forBrand((stats[o.id] || {}).shown || 0), redeemed: forBrand((stats[o.id] || {}).redeemed || 0) })),
    },
    sources: { insights: insights ? insights.output.mode : "none", offers: offers.length, buyers: delivery.buyers },
    usage: { input: f.inTok, output: f.outTok },
  });
}

async function decideHeld(env, qid, decision) {
  const q = (await env.AGENTS.get("privacy:queue", "json")) || [];
  const item = q.find((x) => x.qid === qid && x.status === "held");
  if (!item || !["approve", "reject"].includes(decision)) return null;
  const ok = decision === "approve";
  const ref = item.ref || {};
  if (item.kind === "delivery") {
    const buyers = await getBuyers(env);
    const b = buyers.find((x) => x.id === ref.buyerId);
    if (b) {
      b.heldReport = null;
      if (ok) {
        const [insights, stats, offers] = await Promise.all([env.AGENTS.get("latest:insights", "json"), offerStats(env), getOffers(env)]);
        if (insights && insights.generatedAt === ref.reportAt) await deliverOne(env, b, insights, stats, offers, true);
      } else b.rejectedReport = ref.reportAt;
      await env.AGENTS.put("buyers", JSON.stringify(buyers));
    }
  }
  if (item.kind === "post") {
    const c = await env.AGENTS.get("latest:content", "json");
    const p = c && c.output.pieces.find((x) => x.id === ref.pieceId);
    if (p) { p.privacy = { ...p.privacy, status: ok ? "approved" : "rejected" }; await env.AGENTS.put("latest:content", JSON.stringify(c)); }
  }
  const patchList = async (key, id) => {
    const list = (await env.AGENTS.get(key, "json")) || [];
    const x = list.find((y) => y.id === id);
    if (x) {
      x.privacy = { ...(x.privacy || {}), status: ok ? "approved" : "rejected" };
      if (key === "offers") x.active = ok;
      await env.AGENTS.put(key, JSON.stringify(list));
    }
  };
  if (item.kind === "outreach") await patchList("groups", ref.groupId);
  if (item.kind === "sales") await patchList("prospects", ref.prospectId);
  if (item.kind === "offer") await patchList("offers", ref.offerId);
  item.status = ok ? "approved" : "rejected";
  item.decidedAt = new Date().toISOString();
  await env.AGENTS.put("privacy:queue", JSON.stringify(q));
  await privacyLog(env, [{ t: item.decidedAt, kind: item.kind, title: item.title, status: ok ? "approved at Gate 3" : "rejected at Gate 3", issues: [] }]);
  return q;
}

// Run now: re-check this week's posts and active offers, and apply retention.
export async function runPrivacy(env) {
  if (!env.AGENTS) throw new Error("NO_STORE");
  const retention = await runRetention(env).catch(() => ({ deleted: 0 }));
  const c = await env.AGENTS.get("latest:content", "json");
  const pieces = c ? c.output.pieces.filter((p) => !p.privacy) : [];
  if (pieces.length) {
    const g = await guard(env, pieces.map((p) => ({ id: p.id, kind: "post", title: `${p.format}: ${p.title}`, ref: { pieceId: p.id }, fields: { caption: p.caption } })));
    for (const p of pieces) { p.caption = g[p.id].fields.caption; p.privacy = { status: g[p.id].status, issues: g[p.id].issues }; }
    await env.AGENTS.put("latest:content", JSON.stringify(c));
  }
  const log = (await env.AGENTS.get("privacy:log", "json")) || [];
  const since = Date.now() - 30 * DAY_MS;
  const recent = log.filter((x) => Date.parse(x.t) > since);
  const count = (st) => recent.filter((x) => x.status === st).length;
  const queue = ((await env.AGENTS.get("privacy:queue", "json")) || []).filter((x) => x.status === "held");
  return save(env, "privacy", {
    agent: "privacy",
    generatedAt: new Date().toISOString(),
    output: { last30: { passed: count("passed"), fixed: count("fixed"), held: count("held"), approved: count("approved at Gate 3"), rejected: count("rejected at Gate 3") }, waiting: queue.length, retention, rechecked: pieces.length },
    sources: { log: log.length },
    usage: { input: 0, output: 0 },
  });
}

// ---------- agent 9: Student support ----------
// A help chat inside the app. Haiku 5.5 answers only from the help center
// (editable on the org page, starting from agents/help.json) and the account
// snapshot the student's own phone sends (points, cards, premium). When it
// can't help, the student can send the question to the team; the reply shows
// up in their help chat. No email or name is collected.

const SUPPORT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    articleIds: { type: "array", items: { type: "string" } },
    handoff: { type: "boolean" },
  },
  required: ["reply", "articleIds", "handoff"],
  additionalProperties: false,
};

const SUPPORT_SYSTEM = `You are SNARE's student support assistant, inside SNARE's help chat. SNARE is a free digital fridge app for students in London, Ontario, run by a student team at the Ivey Business School. It is a pilot.
Answer only from the help articles and the student's account details you are given. If they don't cover the question, say you're not sure and set handoff to true so the student can send it to the team. Also set handoff to true for bugs, missing points or gift cards, anything about money, complaints, and anything personal or upsetting.
Rules:
- Short, warm and plain: 1 to 4 sentences. Use the student's account numbers when they help.
- Never invent features, policies, prices, dates or promises. Never say a problem is fixed.
- Food safety: expiry dates are estimates; when in doubt, throw it out. Never say food is safe to eat.
- Don't ask for an email, phone number, name or address.
- articleIds: the ids of the articles you used.
- No em dashes or hyphens used as dashes. Plain text only.`;

async function getHelp(env) {
  const saved = env.AGENTS ? await env.AGENTS.get("help", "json") : null;
  if (saved) return saved;
  try {
    const r = await fetch(`${SITE_URL}/agents/help.json`);
    return r.ok ? (await r.json()).articles : [];
  } catch {
    return [];
  }
}

function validHelp(list) {
  if (!Array.isArray(list) || list.length > 60) return null;
  const clean = [];
  for (const a of list) {
    if (!a || typeof a.title !== "string" || !a.title.trim() || typeof a.body !== "string" || !a.body.trim()) return null;
    clean.push({ id: String(a.id || "h" + Date.now().toString(36)).replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "h" + Date.now().toString(36), title: a.title.trim().slice(0, 120), body: a.body.trim().slice(0, 2000) });
  }
  return clean;
}

const validSid = (v) => /^[a-z0-9]{12,40}$/.test(String(v || ""));

async function bumpSupport(env, fields) {
  if (!env.AGENTS) return;
  const st = (await env.AGENTS.get("support:stats", "json")) || { asks: 0, handoffs: 0, tickets: 0, articles: {}, since: new Date().toISOString() };
  st.asks += fields.asks || 0; st.handoffs += fields.handoffs || 0; st.tickets += fields.tickets || 0;
  for (const id of fields.articles || []) st.articles[id] = (st.articles[id] || 0) + 1;
  await env.AGENTS.put("support:stats", JSON.stringify(st));
}

async function supportAsk(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Help chat is offline" }, 503, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
  const msgs = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  if (!msgs.length || !msgs.every((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.length > 0 && m.content.length <= 1000) || msgs[0].role !== "user" || msgs[msgs.length - 1].role !== "user") return json({ error: "Invalid request" }, 400, cors);
  const a = body.account || {};
  const account = {
    points: Number(a.points) || 0, unusedGiftCards: Number(a.cards) || 0, premium: String(a.premium || "").slice(0, 80),
    anonymousSharing: !!a.share, weeklyBudget: Number(a.budget) || 0, sharedHouseFridge: !!a.house,
  };
  const help = await getHelp(env);
  const client = aiClient(env, "help");
  try {
    const r = await client.messages.create({
      model: env.SUPPORT_MODEL || "claude-haiku-5-5",
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SUPPORT_SCHEMA } },
      system: [
        { type: "text", text: SUPPORT_SYSTEM },
        { type: "text", text: `Help articles (JSON):\n${JSON.stringify(help)}`, cache_control: { type: "ephemeral" } },
        { type: "text", text: `This student's account (from their phone):\n${JSON.stringify(account)}` },
      ],
      messages: msgs,
    });
    if (r.stop_reason === "refusal") return json({ reply: "I can't help with that one here. You can send it to the team instead.", articleIds: [], handoff: true }, 200, cors);
    const out = JSON.parse(textOf(r));
    out.articleIds = out.articleIds.filter((id) => help.some((h) => h.id === id));
    await bumpSupport(env, { asks: 1, handoffs: out.handoff ? 1 : 0, articles: out.articleIds });
    // One activity line a minute at most, so a busy help chat doesn't flood the log.
    const last = (await readActivity(env)).events.filter((e) => e.agent === "support").pop();
    if (!last || Date.now() - Date.parse(last.t) > 60e3) await activity(env, { agent: "support", type: "chat", text: out.handoff ? "Answered a student and offered to pass it to the team" : "Answered a student question" });
    return json(out, 200, cors);
  } catch (error) {
    return agentError(error, cors);
  }
}

async function getTickets(env) { return (env.AGENTS ? await env.AGENTS.get("tickets", "json") : null) || []; }

async function supportTicket(request, env, cors) {
  if (!env.AGENTS) return json({ error: "Support inbox is not set up" }, 503, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
  if (!validSid(body.sid) || typeof body.question !== "string" || !body.question.trim()) return json({ error: "Invalid ticket" }, 400, cors);
  // Strip any email or phone number a student typed; replies come back in the app.
  const clean = (t) => hardRules({ fields: { t: String(t).slice(0, 1000) } }).fields.t;
  const transcript = (Array.isArray(body.transcript) ? body.transcript.slice(-6) : []).filter((m) => m && typeof m.content === "string").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: clean(m.content) }));
  const tickets = await getTickets(env);
  if (tickets.filter((t) => t.sid === body.sid && t.status === "open").length >= 5) return json({ error: "You already have 5 open questions. The team will reply soon." }, 429, cors);
  const t = { id: crypto.randomUUID(), sid: body.sid, question: clean(body.question), transcript, status: "open", reply: "", created: new Date().toISOString() };
  tickets.push(t);
  await env.AGENTS.put("tickets", JSON.stringify(tickets.slice(-500)));
  await bumpSupport(env, { tickets: 1 });
  await activity(env, { agent: "support", type: "handoff", to: ["team"], text: "A student sent a question to the team" });
  return json({ ticket: { id: t.id, question: t.question, status: t.status, created: t.created } }, 200, cors);
}

// ---------- agent 10: Rewards ops ----------
// Points live on each phone. Phones send an anonymous copy of points activity
// under a random id: what kind of action earned points, a hashed receipt
// fingerprint (store, date, total), and cash outs. Rewards ops totals it, runs
// fraud checks (duplicate receipts, earning limits, cash out patterns), tracks
// the $500 weekly payout cap (Gate 2), and drafts brand invoices on Sundays.
// Invoices only include an offer once 50 or more students redeemed it; smaller
// counts carry over. Payouts are demo codes for now.

const PAYOUT_CAP = 500;
const LIMITS = { receiptsPerDay: 5, pointsPerDay: 300, pointsPerWeek: 1000, newIdDays: 7, cashoutsPerWeek: 2 };
const REWARD_REASONS = ["receipt", "checkin", "used", "rate", "bonus", "other"];

async function ensureRewardTable(env) {
  await env.PANEL.prepare("CREATE TABLE IF NOT EXISTS reward_events (id INTEGER PRIMARY KEY, rid TEXT NOT NULL, t INTEGER NOT NULL, type TEXT NOT NULL, pts INTEGER NOT NULL, reason TEXT, fp TEXT, card TEXT, offer TEXT)").run();
  await env.PANEL.prepare("CREATE INDEX IF NOT EXISTS reward_rid ON reward_events (rid, t)").run();
}

async function recordReward(request, env, cors) {
  if (!env.PANEL) return json({ error: "Storage is not set up" }, 503, cors);
  let b;
  try { b = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
  const now = Date.now(), t = Number(b.t) || now;
  if (!/^[a-z0-9]{12,40}$/.test(String(b.rid || "")) || !["earn", "cashout"].includes(b.type) || t < now - 7 * DAY_MS || t > now + 3600e3) return json({ error: "Invalid event" }, 400, cors);
  const pts = Math.round(Number(b.pts));
  if (!Number.isFinite(pts) || pts <= 0 || pts > 1000) return json({ error: "Invalid points" }, 400, cors);
  await ensureRewardTable(env);
  await env.PANEL.prepare("INSERT INTO reward_events (rid, t, type, pts, reason, fp, card, offer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
    b.rid, t, b.type, pts, REWARD_REASONS.includes(b.reason) ? b.reason : null,
    /^[a-f0-9]{16}$/.test(String(b.fp || "")) ? b.fp : null, ["loblaw", "walmart", "visa"].includes(b.card) ? b.card : null,
    /^[a-z0-9_-]{1,40}$/i.test(String(b.offer || "")) ? b.offer : null,
  ).run();
  return json({ ok: true }, 200, cors);
}

const shortId = (rid) => rid.slice(0, 6);

async function rewardsBook(env) {
  if (!env.PANEL) return null;
  await ensureRewardTable(env);
  const q = (sql, ...a) => env.PANEL.prepare(sql).bind(...a).all().then((r) => r.results);
  const now = Date.now(), week = now - 7 * DAY_MS, month = now - 30 * DAY_MS;
  const [totals] = await q("SELECT COALESCE(SUM(CASE WHEN type = 'earn' THEN pts END), 0) AS earned, COALESCE(SUM(CASE WHEN type = 'cashout' THEN pts END), 0) AS cashed, COUNT(DISTINCT rid) AS ids FROM reward_events");
  const [wk] = await q("SELECT COALESCE(SUM(CASE WHEN type = 'earn' THEN pts END), 0) AS earned, COALESCE(SUM(CASE WHEN type = 'cashout' THEN pts END), 0) AS cashed, SUM(type = 'cashout') AS cashouts, COUNT(DISTINCT rid) AS ids FROM reward_events WHERE t > ?", week);
  const byReason = await q("SELECT reason, SUM(pts) AS pts FROM reward_events WHERE type = 'earn' AND t > ? GROUP BY reason", week);

  // Fraud checks. Ids are random and shown shortened; nothing names a student.
  const flags = [];
  for (const r of await q("SELECT fp, COUNT(*) AS n, COUNT(DISTINCT rid) AS ids, GROUP_CONCAT(DISTINCT rid) AS rids FROM reward_events WHERE reason = 'receipt' AND fp IS NOT NULL AND t > ? GROUP BY fp HAVING n > 1", month)) {
    flags.push({ check: "Duplicate receipt", severity: "high", detail: `The same receipt was scanned ${r.n} times${r.ids > 1 ? ` by ${r.ids} different phones` : " by one phone"}.`, ids: r.rids.split(",").map(shortId) });
  }
  for (const r of await q(`SELECT rid, CAST(t / ${DAY_MS} AS INTEGER) AS day, SUM(reason = 'receipt') AS receipts, SUM(pts) AS pts FROM reward_events WHERE type = 'earn' AND t > ? GROUP BY rid, day HAVING receipts > ? OR pts > ?`, week, LIMITS.receiptsPerDay, LIMITS.pointsPerDay)) {
    flags.push({ check: "Earning limit", severity: "medium", detail: `${r.receipts} receipts and ${r.pts} points in one day (limits ${LIMITS.receiptsPerDay} and ${LIMITS.pointsPerDay}).`, ids: [shortId(r.rid)] });
  }
  for (const r of await q("SELECT rid, SUM(pts) AS pts FROM reward_events WHERE type = 'earn' AND t > ? GROUP BY rid HAVING pts > ?", week, LIMITS.pointsPerWeek)) {
    flags.push({ check: "Earning limit", severity: "medium", detail: `${r.pts} points this week (limit ${LIMITS.pointsPerWeek}).`, ids: [shortId(r.rid)] });
  }
  for (const r of await q("SELECT rid, MIN(t) AS first, SUM(CASE WHEN type = 'cashout' AND t > ? THEN 1 ELSE 0 END) AS recent, SUM(CASE WHEN type = 'earn' THEN pts ELSE 0 END) AS earned, SUM(CASE WHEN type = 'cashout' THEN pts ELSE 0 END) AS cashed, MAX(CASE WHEN type = 'cashout' THEN t END) AS lastCash FROM reward_events GROUP BY rid HAVING recent > 0", week)) {
    if (r.lastCash - r.first < LIMITS.newIdDays * DAY_MS) flags.push({ check: "Cash out pattern", severity: "medium", detail: `Cashed out within ${LIMITS.newIdDays} days of first earning points.`, ids: [shortId(r.rid)] });
    if (r.recent > LIMITS.cashoutsPerWeek) flags.push({ check: "Cash out pattern", severity: "medium", detail: `${r.recent} cash outs this week (limit ${LIMITS.cashoutsPerWeek}).`, ids: [shortId(r.rid)] });
    if (r.cashed > r.earned) flags.push({ check: "Cash out pattern", severity: "high", detail: `Cashed out ${r.cashed} points but only earned ${r.earned}, so the phone's balance may have been edited.`, ids: [shortId(r.rid)] });
  }

  const payoutsWeek = (wk.cashed || 0) / PTS_PER_DOLLAR_W;
  return {
    allTime: { earned: totals.earned, cashed: totals.cashed, liabilityDollars: Math.max(0, totals.earned - totals.cashed) / PTS_PER_DOLLAR_W, ids: totals.ids },
    week: { earned: wk.earned, cashouts: wk.cashouts || 0, payoutDollars: payoutsWeek, ids: wk.ids, byReason: Object.fromEntries(byReason.map((r) => [r.reason || "other", r.pts])) },
    cap: { limit: PAYOUT_CAP, used: payoutsWeek, overCap: payoutsWeek > PAYOUT_CAP },
    flags,
  };
}
const PTS_PER_DOLLAR_W = 100;

// Invoices: redeemed bonuses per offer since that offer was last invoiced.
async function invoiceDrafts(env) {
  if (!env.PANEL || !env.AGENTS) return { fee: 0.5, invoices: [], carried: [] };
  await ensureOfferTable(env);
  const settings = (await env.AGENTS.get("billing:settings", "json")) || { fee: 0.5 };
  const state = (await env.AGENTS.get("billing:state", "json")) || {};
  const offers = await getOffers(env);
  const byBrand = {}, carried = [];
  for (const o of offers) {
    const since = state[o.id] || 0;
    const [r] = (await env.PANEL.prepare("SELECT COUNT(DISTINCT sid) AS n FROM offer_events WHERE offer = ? AND event = 'redeemed' AND t > ?").bind(o.id, since).all()).results;
    const n = r ? r.n : 0;
    if (!n) continue;
    if (n < K) { carried.push({ brand: o.brand, offer: o.text, redemptions: n }); continue; }
    const pointsCost = (n * o.points) / PTS_PER_DOLLAR_W, fee = n * settings.fee;
    (byBrand[o.brand] = byBrand[o.brand] || { brand: o.brand, buyerId: o.buyerId, lines: [], total: 0 }).lines.push({ offerId: o.id, offer: o.text, redemptions: n, points: o.points, pointsCost, fee, total: pointsCost + fee });
    byBrand[o.brand].total += pointsCost + fee;
  }
  return { fee: settings.fee, invoices: Object.values(byBrand), carried };
}

const REWARDS_SCHEMA = {
  type: "object",
  properties: { headline: { type: "string" }, notes: { type: "array", items: { type: "string" } } },
  required: ["headline", "notes"],
  additionalProperties: false,
};

export async function runRewards(env) {
  if (!env.AGENTS) throw new Error("NO_STORE");
  const [book, billing] = await Promise.all([rewardsBook(env), invoiceDrafts(env)]);
  let summary = { headline: "Weekly close ready.", notes: [] }, usage = { input: 0, output: 0 };
  if (env.ANTHROPIC_API_KEY && book) try {
    const client = aiClient(env, "agent");
    const r = await client.messages.create({
      model: env.REWARDS_MODEL || "claude-haiku-5-5", max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: REWARDS_SCHEMA } },
      system: `You write SNARE's weekly rewards close for the student team. Points are on students' phones; this is an anonymous copy. Payouts are demo gift card codes for now; the weekly payout cap is $${PAYOUT_CAP} (Gate 2). From the numbers given, write a one sentence headline and up to 4 short notes: what changed, which fraud flags matter and what to do, the payout cap, and invoices ready to send. Use only the numbers given. Plain, short sentences. No em dashes or hyphens used as dashes.`,
      messages: [{ role: "user", content: JSON.stringify({ book, billing }) }],
    });
    summary = JSON.parse(textOf(r)); usage = { input: r.usage.input_tokens, output: r.usage.output_tokens };
  } catch (e) {
    // The numbers and checks are code; only the wording needs Claude.
    summary = { headline: `Weekly close: ${book.flags.length} fraud flag${book.flags.length === 1 ? "" : "s"}, ${billing.invoices.length} invoice${billing.invoices.length === 1 ? "" : "s"} ready.`, notes: ["The written summary could not be generated, so these are the raw numbers."] };
  }
  return save(env, "rewards", {
    agent: "rewards",
    generatedAt: new Date().toISOString(),
    output: { ...summary, book, billing },
    sources: { flags: book ? book.flags.length : 0, invoices: billing.invoices.length, demoPayouts: true },
    usage,
  });
}

async function markInvoiced(env, brand) {
  const billing = await invoiceDrafts(env);
  const inv = billing.invoices.find((i) => i.brand === brand);
  if (!inv) return null;
  const state = (await env.AGENTS.get("billing:state", "json")) || {};
  for (const l of inv.lines) state[l.offerId] = Date.now();
  await env.AGENTS.put("billing:state", JSON.stringify(state));
  const sent = (await env.AGENTS.get("billing:sent", "json")) || [];
  sent.push({ ...inv, sentAt: new Date().toISOString() });
  await env.AGENTS.put("billing:sent", JSON.stringify(sent.slice(-200)));
  return sent;
}

// ---------- the hub: ask the Chief of Staff, and what's waiting ----------

const RUN_IDS = ["chief", "market", "growth", "content", "sales", "insights", "router", "privacy", "rewards"];
const ALL_IDS = [...RUN_IDS, "support"];

// Everything that is waiting for a person, in one place.
async function waitingForTeam(env) {
  const [buyers, queue, tickets, book, content] = await Promise.all([
    getBuyers(env), env.AGENTS ? env.AGENTS.get("privacy:queue", "json") : null, getTickets(env), rewardsBook(env).catch(() => null), env.AGENTS ? env.AGENTS.get("latest:content", "json") : null,
  ]);
  return {
    gate1: buyers.filter((b) => !b.approved && !b.revoked).map((b) => ({ org: b.org })),
    gate1held: buyers.filter((b) => b.heldReport && !b.revoked).map((b) => ({ org: b.org })),
    gate2: book ? { used: book.cap.used, cap: book.cap.limit, over: book.cap.overCap, flags: book.flags.length } : null,
    gate3: (queue || []).filter((x) => x.status === "held").map((x) => ({ kind: x.kind, title: x.title })),
    support: tickets.filter((t) => t.status === "open").map((t) => ({ question: t.question, created: t.created })),
    postsReady: content ? content.output.pieces.filter((p) => !p.privacy || ["passed", "fixed", "approved"].includes(p.privacy.status)).length : 0,
  };
}

// A compact picture of the whole organization for the Chief to answer from.
async function orgSnapshot(env) {
  const get = (k) => (env.AGENTS ? env.AGENTS.get(k, "json") : null);
  const [tasks, act, waiting, prospects, groups, waitlist, ...latest] = await Promise.all([
    getTasks(env), readActivity(env), waitingForTeam(env), getProspects(env), getGroups(env), waitlistSummary(env).catch(() => null),
    ...ALL_IDS.map((id) => get(`latest:${id}`)),
  ]);
  const L = Object.fromEntries(ALL_IDS.map((id, i) => [id, latest[i]]));
  const at = (r) => (r ? r.generatedAt : "never run");
  const o = (id) => (L[id] ? L[id].output : null);
  const stageCounts = {};
  prospects.forEach((p) => { stageCounts[p.status] = (stageCounts[p.status] || 0) + 1; });
  return {
    today: today(),
    tasks: tasks.map(({ text, owner, due, done }) => ({ text, owner, due, done })),
    waitingForTeam: waiting,
    agents: {
      chief: { lastRun: at(L.chief), brief: o("chief") && { headline: o("chief").headline, needsYou: o("chief").needsYou, risks: o("chief").risks } },
      market: { lastRun: at(L.market), headline: o("market") && o("market").headline, findings: o("market") && o("market").items.slice(0, 8).map((i) => ({ category: i.category, title: i.title, sendTo: i.sendTo })) },
      growth: { lastRun: at(L.growth), headline: o("growth") && o("growth").headline, newGroups: o("growth") && o("growth").newGroups, events: o("growth") && o("growth").events.slice(0, 5).map((e) => `${e.date} ${e.event}`), pipeline: groups.length, contacted: groups.filter((g) => g.status !== "new").length, waitlist },
      content: { lastRun: at(L.content), headline: o("content") && o("content").headline, posts: o("content") && o("content").pieces.map((p) => ({ format: p.format, title: p.title, privacy: p.privacy ? p.privacy.status : "unchecked" })) },
      sales: { lastRun: at(L.sales), headline: o("sales") && o("sales").headline, pipeline: stageCounts, prospects: prospects.slice(-10).map((p) => ({ org: p.org, type: p.type, stage: p.status })) },
      insights: { lastRun: at(L.insights), panel: o("insights") && o("insights").mode, brief: o("insights") && o("insights").brief && { headline: o("insights").brief.headline, topWaste: o("insights").brief.topWaste } },
      router: { lastRun: at(L.router), headline: o("router") && o("router").headline, offerIdeas: o("router") && o("router").offerIdeas.map((i) => i.offerText) },
      privacy: { lastRun: at(L.privacy), last30: o("privacy") && o("privacy").last30, heldAtGate3: waiting.gate3.length },
      support: { openQuestions: waiting.support.length },
      rewards: { lastRun: at(L.rewards), headline: o("rewards") && o("rewards").headline, fraudFlags: o("rewards") && o("rewards").book ? o("rewards").book.flags.length : null },
    },
    recentActivity: act.events.slice(-20).map((e) => `${e.t} ${e.agent} ${e.type}: ${e.text || ""}`),
  };
}

const CHIEF_ASK_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: { type: { type: "string", enum: ["run", "open", "addTask"] }, agent: { type: "string" }, task: { type: "string" }, label: { type: "string" } },
        required: ["type", "agent", "task", "label"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
};

const CHIEF_ASK_SYSTEM = `You are the Chief of Staff of Team SNARE's launch organization: ten AI agents and five students (Eason, Ava, Sally, Nate, Ruby). The team asks you questions about what is going on across the organization.
Answer from the organization snapshot only: tasks, what is waiting for the team, each agent's latest work and when it last ran, and recent activity. Say plainly when something hasn't run yet or the data isn't there. Never invent numbers, buyers, groups or results. Remember SNARE is pre launch; app numbers on the student panel are sample data until 50 students share.
Be brief and specific, like a sharp chief of staff: 2 to 6 sentences, or a short list. Plain text; "- " for list lines is fine. No em dashes or hyphens used as dashes.
Actions are buttons the person can press:
- "run" an agent (agent id from: ${RUN_IDS.join(", ")}) only when they ask you to run, refresh or redo something.
- "open" an agent's page (any of: ${ALL_IDS.join(", ")}) when pointing them to details.
- "addTask" with the task text when they ask you to add or remember a task.
For actions that don't use a field, set it to "". Labels are 2 to 4 words. Use an empty list when no action fits.`;

async function chiefAsk(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "The worker has no Anthropic API key yet" }, 500, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
  const msgs = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  if (!msgs.length || !msgs.every((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.length > 0 && m.content.length <= 2000) || msgs[0].role !== "user" || msgs[msgs.length - 1].role !== "user") return json({ error: "Invalid request" }, 400, cors);
  const snapshot = await orgSnapshot(env);
  const client = aiClient(env, "ask");
  try {
    const r = await client.beta.messages.create({
      model: env.AGENT_MODEL || "claude-opus-5-5", max_tokens: 8000, ...FALLBACK,
      output_config: { effort: "low", format: { type: "json_schema", schema: CHIEF_ASK_SCHEMA } },
      system: [{ type: "text", text: CHIEF_ASK_SYSTEM }, { type: "text", text: `Organization snapshot (JSON):\n${JSON.stringify(snapshot)}` }],
      messages: msgs,
    });
    if (r.stop_reason === "refusal") return json({ reply: "I can't help with that one. Ask me about the organization.", actions: [] }, 200, cors);
    const out = JSON.parse(textOf(r));
    out.actions = out.actions.filter((a) => (a.type === "run" && RUN_IDS.includes(a.agent)) || (a.type === "open" && ALL_IDS.includes(a.agent)) || (a.type === "addTask" && a.task.trim() && a.task.length <= 200)).slice(0, 3);
    return json(out, 200, cors);
  } catch (error) {
    return agentError(error, cors);
  }
}

async function getPostStatus(env) {
  return (env.AGENTS ? await env.AGENTS.get("postStatus", "json") : null) || {};
}

// ---------- routes ----------

function teamOk(request, env) {
  const given = request.headers.get("X-Team-Key") || "";
  const want = env.TEAM_KEY || "";
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

const runHits = new Map();
function tooManyRuns(ip, limit = 6, windowMs = 3600_000) {
  const now = Date.now();
  const recent = (runHits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  runHits.set(ip, recent);
  return recent.length > limit;
}

export async function handleAgents(request, env, cors) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");

  if (request.method === "GET" && path === "/agents/status") {
    return json({ connected: true, hasKey: !!env.ANTHROPIC_API_KEY, hasStore: !!env.AGENTS, hasTeamKey: !!env.TEAM_KEY, model: env.AGENT_MODEL || "claude-opus-5-5" }, 200, cors);
  }
  if (request.method === "GET" && path === "/agents/tasks") return json({ tasks: await getTasks(env) }, 200, cors);
  if (request.method === "GET" && path === "/agents/watchlist") return json({ watchlist: await getWatchlist(env) }, 200, cors);
  if (request.method === "GET" && path === "/agents/groups") return json({ groups: await getGroups(env) }, 200, cors);
  if (request.method === "GET" && path === "/agents/waitlist") return json({ summary: await waitlistSummary(env) }, 200, cors);
  if (request.method === "GET" && path === "/agents/poststatus") return json({ status: await getPostStatus(env) }, 200, cors);
  if (request.method === "GET" && path === "/agents/prospects") return json({ prospects: await getProspects(env) }, 200, cors);
  // Public: the app sends anonymous events here when a student opts in; also used to forget them.
  if (request.method === "POST" && path === "/agents/events") {
    if (tooManyRuns("events:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 120)) return json({ error: "Too many events" }, 429, cors);
    return recordEvents(request, env, cors);
  }
  if (request.method === "GET" && path === "/agents/panel") return json(await panelSnapshot(env), 200, cors);
  if (request.method === "GET" && path === "/agents/spend") {
    const month = new Date().toISOString().slice(0, 7);
    const cur = (env.AGENTS ? await env.AGENTS.get(`spend:${month}`, "json") : null) || { usd: 0, calls: 0 };
    return json({ month, usd: cur.usd, calls: cur.calls, limit: Number(env.SPEND_LIMIT) || 30, budget: await budgetStatus(env) }, 200, cors);
  }
  // Start the activity log fresh (team only), e.g. before going live.
  if (request.method === "POST" && path === "/agents/activity/clear") {
    if (!teamOk(request, env)) return json({ error: "Team passcode needed" }, 401, cors);
    if (env.AGENTS) await env.AGENTS.put("activity", JSON.stringify({ running: {}, events: [] }));
    return json({ ok: true }, 200, cors);
  }
  if (request.method === "POST" && path === "/agents/ai") {
    if (!teamOk(request, env)) return json({ error: "Team passcode needed" }, 401, cors);
    let body = {};
    try { body = await request.json(); } catch { /* empty */ }
    return json(await setEnabled(env, !!body.on), 200, cors);
  }
  if (request.method === "GET" && path === "/agents/activity") {
    const a = await readActivity(env);
    const now = Date.now();
    const running = Object.fromEntries(Object.entries(a.running).filter(([, t]) => now - t < STALE_MS).map(([k, t]) => [k, new Date(t).toISOString()]));
    return json({ running, events: a.events.slice(-60), now: new Date(now).toISOString() }, 200, cors);
  }
  // Public: the app downloads active offers and reports anonymous shown and redeemed events.
  if (request.method === "GET" && path === "/agents/offers") return json({ offers: (await getOffers(env)).filter((o) => o.active).map(({ id, brand, product, text, note, points, rule }) => ({ id, brand, product, text, note, points, rule })) }, 200, cors);
  if (request.method === "POST" && path === "/agents/offers/event") {
    if (tooManyRuns("offer:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 120)) return json({ error: "Too many events" }, 429, cors);
    return recordOfferEvent(request, env, cors);
  }
  // Public: anonymous points activity from phones (Rewards ops).
  if (request.method === "POST" && path === "/agents/rewards/event") {
    if (tooManyRuns("reward:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 120)) return json({ error: "Too many events" }, 429, cors);
    return recordReward(request, env, cors);
  }
  // Public: the app's help chat.
  if (request.method === "GET" && path === "/agents/help") return json({ articles: await getHelp(env) }, 200, cors);
  if (request.method === "POST" && path === "/agents/support/ask") {
    if (tooManyRuns("support:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 30)) return json({ error: "Too many questions this hour. Try again later." }, 429, cors);
    return supportAsk(request, env, cors);
  }
  if (request.method === "POST" && path === "/agents/support/ticket") {
    if (tooManyRuns("ticket:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 10)) return json({ error: "Too many tickets" }, 429, cors);
    return supportTicket(request, env, cors);
  }
  // A student's own tickets, by the random id only their phone knows.
  if (request.method === "GET" && path === "/agents/support/mine") {
    const sid = new URL(request.url).searchParams.get("sid");
    if (!validSid(sid)) return json({ error: "Invalid id" }, 400, cors);
    return json({ tickets: (await getTickets(env)).filter((t) => t.sid === sid).map(({ id, question, status, reply, created, answeredAt }) => ({ id, question, status, reply, created, answeredAt })) }, 200, cors);
  }
  // Public with a secret token: a buyer's private report page.
  if (request.method === "GET" && path === "/agents/buyer") {
    const t = new URL(request.url).searchParams.get("t") || "";
    if (!/^[a-f0-9]{36}$/.test(t) || !env.AGENTS) return json({ error: "This link is not valid" }, 404, cors);
    const d = await env.AGENTS.get(`delivery:${t}`, "json");
    const buyer = (await getBuyers(env)).find((b) => b.token === t && !b.revoked);
    if (!buyer) return json({ error: "This link is not valid" }, 404, cors);
    // Offer counts are read fresh; brands only ever see counts of 50 or more.
    if (d) {
      const [offers, stats] = await Promise.all([getOffers(env), offerStats(env)]);
      d.offers = offers.filter((o) => o.buyerId === buyer.id).map((o) => ({ text: o.text, points: o.points, shown: forBrand((stats[o.id] || {}).shown || 0), redeemed: forBrand((stats[o.id] || {}).redeemed || 0) }));
    }
    return json({ org: buyer.org, delivery: d, history: buyer.deliveries.map(({ title, deliveredAt, mode }) => ({ title, deliveredAt, mode })) }, 200, cors);
  }
  if (request.method === "GET" && path === "/agents/insights") {
    let latest = null;
    try { latest = await collectInsights(env); } catch { /* try again next time */ }
    latest = latest || (env.AGENTS ? await env.AGENTS.get("latest:insights", "json") : null);
    return json({ latest, pending: await getPending(env) }, 200, cors);
  }
  // Public: the join page posts here. Same site check as everything else.
  if (request.method === "POST" && path === "/agents/waitlist/join") {
    if (tooManyRuns("join:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 10)) return json({ error: "Too many tries, wait a bit" }, 429, cors);
    return joinWaitlist(request, env, cors);
  }
  const latestMatch = path.match(/^\/agents\/(chief|market|growth|content|sales|router)$/);
  if (request.method === "GET" && latestMatch) {
    const latest = env.AGENTS ? await env.AGENTS.get(`latest:${latestMatch[1]}`, "json") : null;
    return json({ latest }, 200, cors);
  }

  // Everything below changes data or costs money, so it needs the team passcode.
  if (!teamOk(request, env)) return json({ error: "Wrong or missing team passcode" }, 401, cors);

  if (request.method === "PUT" && path === "/agents/tasks") {
    if (!env.AGENTS) return json({ error: "Task storage is not set up on the worker" }, 500, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    const tasks = validTasks(body.tasks);
    if (!tasks) return json({ error: "Invalid task list" }, 400, cors);
    await env.AGENTS.put("tasks", JSON.stringify(tasks));
    return json({ tasks }, 200, cors);
  }

  if (request.method === "PUT" && path === "/agents/watchlist") {
    if (!env.AGENTS) return json({ error: "Storage is not set up on the worker" }, 500, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    const watchlist = validWatchlist(body.watchlist);
    if (!watchlist) return json({ error: "Invalid watchlist" }, 400, cors);
    await env.AGENTS.put("watchlist", JSON.stringify(watchlist));
    return json({ watchlist }, 200, cors);
  }

  if (request.method === "PUT" && path === "/agents/groups") {
    if (!env.AGENTS) return json({ error: "Storage is not set up on the worker" }, 500, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    const groups = validGroups(body.groups);
    if (!groups) return json({ error: "Invalid group list" }, 400, cors);
    await env.AGENTS.put("groups", JSON.stringify(groups));
    return json({ groups }, 200, cors);
  }

  if (request.method === "PUT" && path === "/agents/poststatus") {
    if (!env.AGENTS) return json({ error: "Storage is not set up on the worker" }, 500, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    if (typeof body.id !== "string" || body.id.length > 40 || !POST_STATUSES.includes(body.status)) return json({ error: "Invalid status" }, 400, cors);
    const status = await getPostStatus(env);
    status[body.id] = body.status;
    const keys = Object.keys(status);
    if (keys.length > 500) keys.slice(0, keys.length - 500).forEach((k) => delete status[k]);
    await env.AGENTS.put("postStatus", JSON.stringify(status));
    return json({ status }, 200, cors);
  }

  if (request.method === "PUT" && path === "/agents/prospects") {
    if (!env.AGENTS) return json({ error: "Storage is not set up on the worker" }, 500, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    const list = typeof body.id === "string" ? await updateProspect(env, body) : null;
    if (!list) return json({ error: "Invalid update" }, 400, cors);
    return json({ prospects: list }, 200, cors);
  }

  // Buyer links are secret, so even reading them needs the passcode.
  if (request.method === "GET" && path === "/agents/buyers") return json({ buyers: await syncBuyers(env) }, 200, cors);
  if (request.method === "GET" && path === "/agents/offers/all") return json({ offers: await getOffers(env), stats: await offerStats(env), k: K }, 200, cors);
  if (request.method === "PUT" && (path === "/agents/buyers" || path === "/agents/offers")) {
    if (!env.AGENTS) return json({ error: "Storage is not set up on the worker" }, 500, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    if (path === "/agents/buyers") {
      const buyers = await updateBuyer(env, String(body.id || ""), body.action);
      return buyers ? json({ buyers }, 200, cors) : json({ error: "Invalid update" }, 400, cors);
    }
    const offers = validOffers(body.offers);
    if (!offers) return json({ error: "Invalid offer list" }, 400, cors);
    // New or edited offers go through the Privacy guard; held ones stay paused.
    const prev = Object.fromEntries((await getOffers(env)).map((o) => [o.id, o]));
    const sig = (o) => JSON.stringify([o.brand, o.product, o.text, o.note, o.points, o.rule]);
    const changed = offers.filter((o) => !prev[o.id] || sig(prev[o.id]) !== sig(o) || !prev[o.id].privacy);
    for (const o of offers) if (!changed.includes(o)) o.privacy = prev[o.id].privacy;
    const og = await guard(env, changed.map((o) => ({
      id: o.id, kind: "offer", title: `Offer: ${o.brand}, ${o.text}`, ref: { offerId: o.id }, fields: { text: o.text, note: o.note },
      context: `Shown in the app labelled Sponsored. Points: ${o.points}. Who sees it: ${o.rule.type === "everyone" ? "everyone with sharing on" : `students who ${o.rule.type} ${o.rule.product} at least ${o.rule.minTimes} times`}.`,
    })));
    for (const o of changed) {
      const r = og[o.id];
      o.text = r.fields.text; o.note = r.fields.note; o.privacy = { status: r.status, issues: r.issues };
      if (r.status === "held") o.active = false;
    }
    for (const o of offers) if (o.privacy && o.privacy.status === "held") o.active = false;
    await env.AGENTS.put("offers", JSON.stringify(offers));
    return json({ offers }, 200, cors);
  }

  if (request.method === "POST" && path === "/agents/chief/ask") {
    if (tooManyRuns("ask:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 40)) return json({ error: "Too many questions this hour" }, 429, cors);
    return chiefAsk(request, env, cors);
  }
  if (request.method === "GET" && path === "/agents/waiting") return json(await waitingForTeam(env), 200, cors);
  if (request.method === "GET" && path === "/agents/rewards") {
    const [latest, sent, settings] = await Promise.all(["latest:rewards", "billing:sent", "billing:settings"].map((k) => (env.AGENTS ? env.AGENTS.get(k, "json") : null)));
    return json({ latest, live: { book: await rewardsBook(env), billing: await invoiceDrafts(env) }, sent: (sent || []).slice(-20).reverse(), settings: settings || { fee: 0.5 } }, 200, cors);
  }
  if (request.method === "PUT" && path === "/agents/rewards") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    if (!env.AGENTS) return json({ error: "Storage is not set up" }, 500, cors);
    if (body.fee !== undefined) {
      const fee = Number(body.fee);
      if (!Number.isFinite(fee) || fee < 0 || fee > 10) return json({ error: "Fee must be between $0 and $10" }, 400, cors);
      await env.AGENTS.put("billing:settings", JSON.stringify({ fee: Math.round(fee * 100) / 100 }));
      return json({ settings: { fee } }, 200, cors);
    }
    const sent = typeof body.invoiced === "string" ? await markInvoiced(env, body.invoiced) : null;
    return sent ? json({ sent: sent.slice(-20).reverse() }, 200, cors) : json({ error: "Nothing to invoice for that brand" }, 400, cors);
  }
  if (request.method === "GET" && path === "/agents/support/inbox") {
    const [tickets, stats] = await Promise.all([getTickets(env), env.AGENTS ? env.AGENTS.get("support:stats", "json") : null]);
    return json({ tickets: tickets.slice().reverse().map(({ sid, ...t }) => t), stats }, 200, cors);
  }
  if (request.method === "PUT" && path === "/agents/support/inbox") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    const tickets = await getTickets(env);
    const t = tickets.find((x) => x.id === body.id);
    if (!t || !["answered", "closed", "open"].includes(body.status)) return json({ error: "Invalid update" }, 400, cors);
    if (typeof body.reply === "string") t.reply = body.reply.slice(0, 2000);
    t.status = body.status;
    if (body.status === "answered") t.answeredAt = new Date().toISOString();
    await env.AGENTS.put("tickets", JSON.stringify(tickets));
    return json({ tickets: tickets.slice().reverse().map(({ sid, ...x }) => x) }, 200, cors);
  }
  if (request.method === "PUT" && path === "/agents/help") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    const help = validHelp(body.articles);
    if (!help || !env.AGENTS) return json({ error: "Invalid help articles" }, 400, cors);
    await env.AGENTS.put("help", JSON.stringify(help));
    return json({ articles: help }, 200, cors);
  }
  if (request.method === "GET" && path === "/agents/privacy") {
    const [log, queue, retention, latest] = await Promise.all(["privacy:log", "privacy:queue", "privacy:retention", "latest:privacy"].map((k) => (env.AGENTS ? env.AGENTS.get(k, "json") : null)));
    return json({ log: (log || []).slice(-100).reverse(), queue: (queue || []).filter((x) => x.status === "held"), retention, latest }, 200, cors);
  }
  if (request.method === "PUT" && path === "/agents/privacy") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    const q = env.AGENTS ? await decideHeld(env, String(body.qid || ""), body.decision) : null;
    return q ? json({ queue: q.filter((x) => x.status === "held") }, 200, cors) : json({ error: "Invalid decision" }, 400, cors);
  }

  if (request.method === "POST" && path === "/agents/insights/run") {
    try { return json(await tracked(env, "insights", runInsights), 200, cors); } catch (error) { return agentError(error, cors); }
  }

  const RUNNERS = { chief: runChief, market: runMarket, growth: runGrowth, content: runContent, sales: runSales, router: runRouter, privacy: runPrivacy, rewards: runRewards };
  const runMatch = path.match(/^\/agents\/(chief|market|growth|content|sales|router|privacy|rewards)\/run$/);
  if (request.method === "POST" && runMatch) {
    if (tooManyRuns(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "Too many runs this hour" }, 429, cors);
    try {
      return json({ latest: await tracked(env, runMatch[1], RUNNERS[runMatch[1]]) }, 200, cors);
    } catch (error) {
      return agentError(error, cors);
    }
  }

  return json({ error: "Not found" }, 404, cors);
}

function agentError(error, cors) {
  if (error instanceof BudgetError) return json({ error: `AI is paused: ${budgetMessage(error)}`, budget: error.reason }, 503, cors);
  if (error.message === "NO_KEY") return json({ error: "The worker has no Anthropic API key yet" }, 500, cors);
  if (error.message === "REFUSED") return json({ error: "Claude declined to write this brief" }, 502, cors);
  if (error.message === "TOO_LONG") return json({ error: "The brief was cut off. Try again." }, 502, cors);
  if (error.message === "NO_STORE") return json({ error: "Storage is not set up on the worker" }, 500, cors);
  if (error.message === "NO_SOURCES") return json({ error: "Web search returned no sources. Try again later." }, 502, cors);
  if (error instanceof Anthropic.AuthenticationError) return json({ error: "The worker's API key is invalid" }, 500, cors);
  if (error instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy, try again shortly" }, 429, cors);
  if (error instanceof Anthropic.BadRequestError) return json({ error: "Claude rejected the request" }, 502, cors);
  if (error instanceof Anthropic.APIError) return json({ error: `Claude error ${error.status}` }, 502, cors);
  if (error instanceof SyntaxError) return json({ error: "Claude's brief was not valid JSON" }, 502, cors);
  return json({ error: "Unexpected server error" }, 500, cors);
}
