// Cloudflare Pages Function — TTB Alcohol Label Verification
// Route: POST /for/us-treasury/verify
//
// 1. Receive a label image (data URL) + optional "application" record to match against.
// 2. Ask Claude (vision, via the Vercel AI Gateway) to EXTRACT the printed fields verbatim.
// 3. Deterministic rules in lib/ttb-verify-core.mjs render the verdicts.
//
// The API key lives only in the Pages env binding (AI_GATEWAY_API_KEY) — never in the browser.
// One label per request, so each verification stays well under the 5s bar and the front-end
// can fan a batch out concurrently.

import { runChecks } from "../lib/ttb-verify-core.mjs";

// Haiku clears the stakeholder's hard 5-second bar (~3s/label here) while still
// nailing the strict warning-formatting checks. Sonnet was accurate too but ran ~6s.
const MODEL = "anthropic/claude-haiku-4.5";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

const EXTRACT_INSTRUCTIONS = `You are a meticulous TTB label-compliance assistant. You are shown a photo of an alcohol beverage label. Read ONLY what is printed — never guess or fill in missing text.

Return a single JSON object, no markdown, with exactly these keys:
{
  "brand_name": string|null,
  "class_type": string|null,
  "alcohol_content": string|null,        // verbatim, e.g. "45% Alc./Vol. (90 Proof)"
  "abv_percent": number|null,            // the ABV as a number, e.g. 45
  "net_contents": string|null,
  "producer_name_address": string|null,
  "country_of_origin": string|null,
  "government_warning": {
    "present": boolean,                  // is a Government Warning statement on the label?
    "verbatim_text": string|null,        // the warning EXACTLY as printed, including punctuation
    "prefix_is_all_caps": boolean,       // is the "GOVERNMENT WARNING:" lead-in in ALL CAPITAL letters?
    "appears_bold": boolean|null         // does the "GOVERNMENT WARNING:" lead-in appear bold? null if unsure
  },
  "legibility_notes": string|null        // glare, angle, blur, or cropping that hurt the read; else null
}
Transcribe the warning letter-for-letter; do not normalize its capitalization. Respond with JSON only.`;

async function extractFields(env, imageDataUrl) {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_INSTRUCTIONS },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gateway ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  let text = data?.choices?.[0]?.message?.content || "";
  text = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const started = Date.now();

  if (!env.AI_GATEWAY_API_KEY)
    return json({ error: "Server is missing AI_GATEWAY_API_KEY. Bind it in the Pages project settings." }, 500);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const { image, application = {}, mode = "single", name = null } = payload;
  if (!image || typeof image !== "string" || !image.startsWith("data:image/"))
    return json({ error: "Provide `image` as a data URL (data:image/...;base64,...)." }, 400);

  let extracted;
  try {
    extracted = await extractFields(env, image);
  } catch (e) {
    return json({ error: `Extraction failed: ${e.message}`, name }, 502);
  }

  const { status, checks } = runChecks(mode, application, extracted);
  return json({
    name,
    mode,
    status,
    checks,
    extracted,
    legibility: extracted.legibility_notes || null,
    elapsedMs: Date.now() - started,
    model: MODEL,
  });
}
