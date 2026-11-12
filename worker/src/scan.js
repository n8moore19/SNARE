// SNARE scan: reads a receipt, a fridge shelf, or one item from a photo with
// Claude vision, and maps everything to the app's own product ids. The photo
// is used for this one request and never stored or logged.

import Anthropic from "@anthropic-ai/sdk";
import { addSpend } from "./agents.js";

const MODES = ["receipt", "shelf", "item"];
const MAX_IMAGE = 2_800_000; // characters of base64, about 2 MB
const BOX = { type: "array", items: { type: "number" } };

function schemaFor(mode, ids) {
  const id = { type: "string", enum: [...ids, "none"] };
  if (mode === "receipt") {
    return {
      type: "object",
      properties: {
        readable: { type: "boolean" },
        storeName: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { printed: { type: "string" }, id, price: { type: "number" }, box: BOX },
            required: ["printed", "id", "price", "box"],
            additionalProperties: false,
          },
        },
      },
      required: ["readable", "storeName", "lines"],
      additionalProperties: false,
    };
  }
  const item = {
    type: "object",
    properties: {
      id, qty: { type: "string" }, days: { type: "integer" }, conf: { type: "number" }, label: { type: "boolean" }, opened: { type: "boolean" },
      ...(mode === "shelf" ? { box: BOX } : { alts: { type: "array", items: { type: "string", enum: ids } } }),
    },
    required: ["id", "qty", "days", "conf", "label", "opened", mode === "shelf" ? "box" : "alts"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: { readable: { type: "boolean" }, items: { type: "array", items: item } },
    required: ["readable", "items"],
    additionalProperties: false,
  };
}

const COMMON = `You read photos for SNARE, a student food app in London, Ontario. Map every food you find to the closest id in the product list. Use "none" for anything that is not food for the fridge or pantry (bags, deposits, tax, cleaning products, cards). Never invent items you cannot see. If the photo is not a receipt or food, or is too blurry to read, set readable to false and return an empty list.
Boxes are [left, top, width, height] as percentages (0 to 100) of the image width and height, drawn tightly around the item or receipt line.`;

const PROMPTS = {
  receipt: `${COMMON}
This is a grocery receipt. Return each purchased line in order: the text as printed (short, uppercase is fine), the matching product id, and the line price in dollars (after any line discount; for weighed items use the line total). Skip subtotal, tax, total, payment and savings lines. storeName is the store as printed, like "No Frills".`,
  shelf: `${COMMON}
This is a photo of a fridge, a shelf or a counter. Return each distinct food item once (at most 14). qty is a short human amount like "Half a bag" or "6 left". days is your best estimate of days left before it should be used, from how it looks and typical keeping times; label is true only if you can read a date on the package. opened is true if it is clearly opened. conf is 0 to 1.`,
  item: `${COMMON}
This is a photo of one food item. Return exactly one item, or none if unreadable. qty is a short amount like "450 g pack". days is your best estimate of days left; label is true only if a printed date is readable. alts are the two next most likely product ids. conf is 0 to 1.`,
};

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12; // 12 scans per 10 minutes per visitor
}

const clampBox = (b) => {
  if (!Array.isArray(b) || b.length !== 4 || b.some((n) => typeof n !== "number" || !isFinite(n))) return null;
  const [x, y, w, h] = b.map((n) => Math.max(0, Math.min(100, n)));
  return w > 1 && h > 1 ? [x, y, Math.min(w, 100 - x), Math.min(h, 100 - y)] : null;
};

export async function handleScan(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "No API key" }, 503, cors);
  if (tooMany(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "Too many scans, try again in a few minutes" }, 429, cors);

  // Stop scanning (the app falls back to samples) once the monthly limit is hit.
  if (env.AGENTS) {
    const spend = await env.AGENTS.get(`spend:${new Date().toISOString().slice(0, 7)}`, "json");
    if (spend && spend.usd >= (Number(env.SPEND_LIMIT) || 30)) return json({ error: "Scanning is paused for this month" }, 503, cors);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
  const { mode, image, products } = body || {};
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image || "");
  if (!MODES.includes(mode) || !m || m[2].length > MAX_IMAGE) return json({ error: "Invalid request" }, 400, cors);
  if (!Array.isArray(products) || !products.length || products.length > 300 || !products.every((p) => p && /^[a-z0-9_]{1,40}$/.test(p.id) && typeof p.name === "string" && p.name.length <= 60)) {
    return json({ error: "Invalid product list" }, 400, cors);
  }
  const ids = products.map((p) => p.id);

  const model = env.SCAN_MODEL || "claude-sonnet-5-5";
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const r = await client.beta.messages.create({
      model, max_tokens: 6000,
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: schemaFor(mode, ids) } },
      system: PROMPTS[mode],
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: `image/${m[1]}`, data: m[2] } },
          { type: "text", text: `Product list (id: name):\n${products.map((p) => `${p.id}: ${p.name}`).join("\n")}` },
        ],
      }],
    });
    await addSpend(env, model, r.usage.input_tokens, r.usage.output_tokens);
    if (r.stop_reason === "refusal") return json({ readable: false }, 200, cors);
    const text = r.content.find((b) => b.type === "text");
    if (!text) return json({ error: "Empty reply" }, 502, cors);
    const out = JSON.parse(text.text);
    if (mode === "receipt") {
      out.lines = out.lines
        .filter((l) => l.id !== "none" && ids.includes(l.id) && l.price >= 0 && l.price < 500)
        .map((l) => ({ id: l.id, name: String(l.printed).slice(0, 40), price: Math.round(l.price * 100) / 100, box: clampBox(l.box) }))
        .slice(0, 60);
      out.storeName = String(out.storeName || "").slice(0, 40);
    } else {
      const seen = new Set();
      out.items = out.items
        .filter((i) => i.id !== "none" && ids.includes(i.id) && !seen.has(i.id) && seen.add(i.id))
        .map((i) => ({
          id: i.id, qty: String(i.qty).slice(0, 30), days: Math.max(0, Math.min(400, Math.round(i.days))),
          conf: Math.max(0, Math.min(1, i.conf)), label: !!i.label, opened: !!i.opened,
          ...(mode === "shelf" ? { box: clampBox(i.box) } : { alts: (i.alts || []).filter((a) => a !== i.id && ids.includes(a)).slice(0, 3) }),
        }))
        .slice(0, mode === "item" ? 1 : 14);
    }
    return json(out, 200, cors);
  } catch (error) {
    console.error("Scan failed:", error.status || "", String(error.message || error).slice(0, 400));
    if (error instanceof Anthropic.RateLimitError) return json({ error: "AI is busy" }, 429, cors);
    if (error instanceof Anthropic.APIError) return json({ error: `AI error ${error.status}` }, 502, cors);
    if (error instanceof SyntaxError) return json({ error: "Bad AI reply" }, 502, cors);
    return json({ error: "Unexpected server error" }, 500, cors);
  }
}
