// supabase/functions/brain/index.ts
//
// The AISole "brain" — a Supabase Edge Function (Deno) that turns one roleplay
// turn into a single in-character line using Claude.
//
// Contract (matches src/roleplay.ts → buildBrainBody / generateLine):
//   Request  POST { messages: [{ role, content }, ...] }
//            messages[0] is the system prompt (role "system"); the rest is the
//            conversation history (role "user", each "Name: text").
//   Response 200 { text: string }
//            The client reads data.text ?? data.reply ?? data.content ?? data.message,
//            so any of those keys works; we return `text`.
//
// On any error we still answer 200 with an empty string so the front-end falls
// back to its offline persona engine and the show never stalls.
//
// Deploy:  supabase functions deploy brain --no-verify-jwt
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          (optional) BRAIN_MODEL, BRAIN_ALLOW_ORIGIN

import Anthropic from "npm:@anthropic-ai/sdk@^0.69.0";

// --- config ---------------------------------------------------------------
const MODEL = Deno.env.get("BRAIN_MODEL") ?? "claude-opus-4-8";
const ALLOW_ORIGIN = Deno.env.get("BRAIN_ALLOW_ORIGIN") ?? "*";
const MAX_TURNS = 24; // cap history we forward to keep prompts small/cheap

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

// Reuse one client across warm invocations.
const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface ChatMsg {
  role: string;
  content: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ text: "" }, 405);

  // Missing key → empty text so the client uses its offline engine.
  if (!client) {
    console.error("ANTHROPIC_API_KEY is not set");
    return json({ text: "" });
  }

  let messages: ChatMsg[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.messages)) messages = body.messages as ChatMsg[];
  } catch {
    return json({ text: "" }, 400);
  }

  // Split the system prompt from the conversation history.
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

  const history = messages
    .filter((m) => m.role !== "system" && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: "user" as const, content: m.content }));

  // Need at least one turn for the model to react to.
  if (history.length === 0) {
    history.push({ role: "user", content: "เริ่มบทสนทนาได้เลย" });
  }

  try {
    // Short, in-character lines — no thinking needed for speed/cost.
    // The system prompt (built by the client) already constrains length and
    // persona; we add a final-answer-only nudge so Opus doesn't narrate.
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system:
        (system ? system + "\n\n" : "") +
        "ตอบกลับเป็นบทพูดของตัวละครเท่านั้น 1-2 ประโยคสั้นๆ " +
        "ห้ามใส่คำอธิบาย ความคิดเห็นนอกบท หรือชื่อผู้พูดนำหน้า.",
      messages: history,
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    return json({ text });
  } catch (err) {
    // Surface the reason in logs, but keep the show running for the client.
    console.error("brain error:", err);
    return json({ text: "" });
  }
});
