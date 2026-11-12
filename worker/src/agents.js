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
  if (response.stop_reason === "refusal") throw new Error("REFUSED");
  if (response.stop_reason === "max_tokens") throw new Error("TOO_LONG");
  const text = response.content.find((b) => b.type === "text");
  if (!text) throw new Error("EMPTY");

  const record = {
    agent: "chief",
    generatedAt: new Date().toISOString(),
    output: JSON.parse(text.text),
    sources: {
      tasks: tasks.length,
      commits: Array.isArray(github) ? github.length : github.error,
      agentsLive: AGENT_IDS.filter((id) => agents[id] !== "not built yet"),
      metrics: "sample",
    },
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
  if (env.AGENTS) await env.AGENTS.put("latest:chief", JSON.stringify(record));
  return record;
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
  if (request.method === "GET" && path === "/agents/chief") {
    const latest = env.AGENTS ? await env.AGENTS.get("latest:chief", "json") : null;
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

  if (request.method === "POST" && path === "/agents/chief/run") {
    if (tooManyRuns(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "Too many runs this hour" }, 429, cors);
    try {
      return json({ latest: await runChief(env) }, 200, cors);
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
  if (error instanceof Anthropic.AuthenticationError) return json({ error: "The worker's API key is invalid" }, 500, cors);
  if (error instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy, try again shortly" }, 429, cors);
  if (error instanceof Anthropic.BadRequestError) return json({ error: "Claude rejected the request" }, 502, cors);
  if (error instanceof Anthropic.APIError) return json({ error: `Claude error ${error.status}` }, 502, cors);
  if (error instanceof SyntaxError) return json({ error: "Claude's brief was not valid JSON" }, 502, cors);
  return json({ error: "Unexpected server error" }, 500, cors);
}
