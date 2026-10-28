// SNARE AI worker: receives a chat message plus a snapshot of the user's app
// state from the prototype, asks Claude, and returns a short reply with a list
// of app actions. The website never sees the API key.

import Anthropic from "@anthropic-ai/sdk";

const ACTION_TYPES = [
  "open_recipe",      // target: recipe id
  "add_missing",      // target: recipe id, adds its missing ingredients to the shopping list
  "add_to_list",      // target: product id
  "remove_from_list", // target: product id
  "add_to_fridge",    // target: product id
  "mark_used",        // target: product id
  "freeze_item",      // target: product id
  "plan_trip",        // target: ""
  "open_tab",         // target: fridge | meals | shop | impact | profile
  "remember_dislike", // target: product id
  "set_diet",         // target: vegetarian | vegan | halal | gluten | dairy
  "set_budget",       // target: weekly budget in dollars, e.g. "40"
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ACTION_TYPES },
          target: { type: "string" },
          label: { type: "string" },
          auto: { type: "boolean" },
        },
        required: ["type", "target", "label", "auto"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
};

const SYSTEM = `You are SNARE, the assistant inside a student food app. SNARE is a digital fridge: it tracks what's in the student's fridge and how soon each item expires, ranks meals by what should be used first, and plans the cheapest grocery trip for only the missing items. The goal is to save students money and cut food waste (UN SDG 12.3).

Each request includes the student's current app state as JSON: their fridge (with expiry ranges), shopping list, profile (diet, weekly budget, area, travel mode, dislikes), the app's ranked meal suggestions with reasons, every recipe and product the app knows, nearby deals, ratings, and what the app has learned about their habits.

How to answer:
- Be warm, practical and brief, like a friend who cooks on a budget. Usually 2 to 5 short sentences, or a short list. A week plan can be longer.
- Ground everything in the app state. Prefer recipes from allRecipes and topMeals, and use their exact names. Lead with food that expires soonest. Never invent prices, deals, stores or items; if something isn't in the data, say so.
- Respect diet and dislikes without being asked. If a roommate owns an item, suggest asking them first.
- Mention money when it helps: cost per serving, list total versus their weekly budget, sale items.
- Food safety: never say food is "safe to eat". Expiry dates are estimates. Raw meat, fish and leftovers deserve the most caution. When in doubt, throw it out.
- Plain text only. You may use **bold** and lines starting with "- " for lists. No headings, no emoji.

Actions:
- Add actions so the student can act on your answer in one tap: open a recipe, add missing ingredients, plan the trip, and so on. Use only ids that appear in the app state (recipe ids from allRecipes, product ids from products).
- Set auto to true only when the student clearly asked you to do that exact thing now (for example "add milk to my list", "freeze the chicken", "I'm vegetarian", "my budget is $40"). Otherwise set auto to false so it shows as a button.
- When the student tells you a lasting preference (a food they don't eat, a diet, a budget), include the matching action with auto true.
- Labels are 2 to 4 words, like "Open recipe" or "Add 3 to list".
- Use an empty actions list when no action fits.`;

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// Best effort per-visitor limit (each worker instance keeps its own counts).
const hits = new Map();
function tooMany(ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > limit;
}

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20) return false;
  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") return false;
  return messages.every(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length > 0 && m.content.length <= 2000,
  );
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Use POST" }, 405, cors);
    if (!allowed.includes(origin)) return json({ error: "This site is not allowed" }, 403, cors);
    if (tooMany(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "Too many messages, slow down" }, 429, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }
    const context = JSON.stringify(body.context || {});
    if (!validMessages(body.messages) || context.length > 60_000) return json({ error: "Invalid request" }, 400, cors);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    try {
      const response = await client.beta.messages.create({
        model: env.MODEL || "claude-opus-5-5",
        max_tokens: 16000,
        // If Claude declines, retry on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Chat: low effort keeps replies quick and cheap.
        output_config: { effort: "low", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
        system: [
          { type: "text", text: SYSTEM },
          { type: "text", text: `Current app state (JSON):\n${context}` },
        ],
        messages: body.messages,
      });

      if (response.stop_reason === "refusal") {
        return json({ reply: "I can't help with that one. Ask me about your fridge, meals, groceries or budget.", actions: [] }, 200, cors);
      }
      const text = response.content.find((b) => b.type === "text");
      if (!text) return json({ error: "Empty reply" }, 502, cors);
      return json(JSON.parse(text.text), 200, cors);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return json({ error: "Server API key is missing or invalid" }, 500, cors);
      if (error instanceof Anthropic.RateLimitError) return json({ error: "AI is busy, try again shortly" }, 429, cors);
      if (error instanceof Anthropic.BadRequestError) return json({ error: "AI rejected the request" }, 502, cors);
      if (error instanceof Anthropic.APIError) return json({ error: `AI error ${error.status}` }, 502, cors);
      if (error instanceof SyntaxError) return json({ error: "AI reply was not valid JSON" }, 502, cors);
      return json({ error: "Unexpected server error" }, 500, cors);
    }
  },
};
