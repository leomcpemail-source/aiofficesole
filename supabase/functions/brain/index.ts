import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// AISole "brain" — relays a conversation turn to an LLM provider pool and
// hides the API keys server-side. Keys live in Supabase Vault and are read via
// the service-role-only RPC public.get_provider_secret(). Deployed with
// verify_jwt = false so the browser can call it directly (public, like AISole).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// In-memory cache of decrypted secrets (per cold start)
const secretCache = new Map<string, string>();
async function getSecret(name: string): Promise<string | null> {
  if (secretCache.has(name)) return secretCache.get(name)!;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_provider_secret`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ secret_name: name }),
    });
    if (!res.ok) return null;
    const val = await res.json();
    if (typeof val === "string" && val) {
      secretCache.set(name, val);
      return val;
    }
  } catch (_e) { /* ignore */ }
  return null;
}

interface Msg { role: string; content: string; }

interface Provider { name: string; secret: string; url: string; model: string; }

// Ordered by preference; on 429/error the next provider is tried.
const PROVIDERS: Provider[] = [
  { name: "openrouter", secret: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/chat/completions", model: "nex-agi/nex-n2-pro:free" },
  { name: "mistral", secret: "MISTRAL_API_KEY", url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" },
  { name: "thaillm", secret: "THAILLM_API_KEY", url: "https://api.opentyphoon.ai/v1/chat/completions", model: "typhoon-v2.1-12b-instruct" },
];

async function callProvider(p: Provider, key: string, messages: Msg[]): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (p.name === "openrouter") {
    headers["HTTP-Referer"] = "https://aisole.app";
    headers["X-Title"] = "AISole";
  }
  const res = await fetch(p.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: p.model, messages, max_tokens: 380, temperature: 0.9 }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${p.name} ${res.status}: ${t.slice(0, 180)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim?.() ?? "";
  if (!text) throw new Error(`${p.name}: empty response`);
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") {
    return json({ ok: true, service: "aisole-brain", providers: PROVIDERS.map((p) => p.name) });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const messages: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) return json({ error: "no messages" }, 400);

    const errors: string[] = [];
    for (const p of PROVIDERS) {
      const key = await getSecret(p.secret);
      if (!key) { errors.push(`${p.name}: no key`); continue; }
      try {
        const text = await callProvider(p, key, messages);
        return json({ text, provider: p.name, model: p.model });
      } catch (e) {
        errors.push(String((e as Error)?.message ?? e));
      }
    }
    return json({ error: "all providers failed", details: errors }, 502);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
