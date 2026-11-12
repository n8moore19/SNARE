// SNARE launch agents. Each agent reads real inputs where they exist, asks
// Claude for a structured result, and saves it to KV so the org page can show
// it. Agent 1 is the Chief of Staff: a daily brief for Team SNARE.

import Anthropic from "@anthropic-ai/sdk";

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
  { id: "t2", text: "Add rewards, receipt scanning, consent screens and the buyer view to the prototype", owner: "Nate", due: "", done: true },
  { id: "t3", text: "Build the Agentic Launch Organization, one agent at a time", owner: "Nate", due: "", done: false },
  { id: "t4", text: "Run five validation interviews: a brand, a grocer, City of London, a students' union, students", owner: "Team", due: "", done: false },
  { id: "t5", text: "Plan a two week pilot with 20 students", owner: "Team", due: "", done: false },
  { id: "t6", text: "Set up the Anthropic API key and deploy the Cloudflare worker", owner: "Nate", due: "", done: false },
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

Each morning you write the team's daily brief from the inputs you are given:
- tasks: the team's real task list and deadlines
- github: real recent commits to the prototype repository
- agents: the latest real output of each other agent, or a note that it is not built yet
- metrics: SAMPLE numbers, because there are no real users yet

Rules:
- Use only the inputs. Never invent tasks, deadlines, commits, buyers or numbers.
- Every metric taken from the sample block must have sample set to true. Never present sample numbers as real.
- needsYou lists only things a human must do or decide, most urgent first. Include gate items from agent outputs.
- deadlines covers open tasks. If a task has no due date, use status "no date" and due "". Mark overdue or at risk against today's date.
- shipped summarises real progress in plain words, mostly from GitHub commits and tasks marked done this week. Skip merge noise.
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
  const [tasks, github, agents] = await Promise.all([getTasks(env), getCommits(), getAgentOutputs(env)]);
  const inputs = { today: today(), tasks, github, agents, metrics: SAMPLE_METRICS };

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
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
      commits: Array.isArray(github) ? github.length : github.error,
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
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

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
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
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
  if (env.AGENTS && added.length) await env.AGENTS.put("groups", JSON.stringify([...groups, ...added]));

  return save(env, "growth", {
    agent: "growth",
    generatedAt: new Date().toISOString(),
    output: { headline: out.headline, newGroups: added.map((g) => g.name), events: out.events, ambassador: out.ambassador, referral: out.referral, waitlistRead: out.waitlistRead, nextSteps: out.nextSteps },
    sources: { searches: r.searches, links: r.sources.size, groupsFound: out.groups.length, groupsAdded: added.length, waitlist: waitlist.total },
    usage: { input: r.inTok + f.inTok, output: r.outTok + f.outTok },
  });
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
  // Public: the join page posts here. Same site check as everything else.
  if (request.method === "POST" && path === "/agents/waitlist/join") {
    if (tooManyRuns("join:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 10)) return json({ error: "Too many tries, wait a bit" }, 429, cors);
    return joinWaitlist(request, env, cors);
  }
  const latestMatch = path.match(/^\/agents\/(chief|market|growth)$/);
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

  const RUNNERS = { chief: runChief, market: runMarket, growth: runGrowth };
  const runMatch = path.match(/^\/agents\/(chief|market|growth)\/run$/);
  if (request.method === "POST" && runMatch) {
    if (tooManyRuns(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "Too many runs this hour" }, 429, cors);
    try {
      return json({ latest: await RUNNERS[runMatch[1]](env) }, 200, cors);
    } catch (error) {
      return agentError(error, cors);
    }
  }

  return json({ error: "Not found" }, 404, cors);
}

function agentError(error, cors) {
  if (error.message === "NO_KEY") return json({ error: "The worker has no Anthropic API key yet" }, 500, cors);
  if (error.message === "REFUSED") return json({ error: "Claude declined to write this brief" }, 502, cors);
  if (error.message === "TOO_LONG") return json({ error: "The brief was cut off. Try again." }, 502, cors);
  if (error.message === "NO_SOURCES") return json({ error: "Web search returned no sources. Try again later." }, 502, cors);
  if (error instanceof Anthropic.AuthenticationError) return json({ error: "The worker's API key is invalid" }, 500, cors);
  if (error instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy, try again shortly" }, 429, cors);
  if (error instanceof Anthropic.BadRequestError) return json({ error: "Claude rejected the request" }, 502, cors);
  if (error instanceof Anthropic.APIError) return json({ error: `Claude error ${error.status}` }, 502, cors);
  if (error instanceof SyntaxError) return json({ error: "Claude's brief was not valid JSON" }, 502, cors);
  return json({ error: "Unexpected server error" }, 500, cors);
}
