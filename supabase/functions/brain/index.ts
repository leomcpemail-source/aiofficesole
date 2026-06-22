import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// AISole "brain" — LLM relay + memory + dashboard metrics.
//   POST {messages}                              -> chat (relay to provider pool)
//   POST {action:"recall",   clientId, slugs}    -> past episode summaries
//   POST {action:"remember", clientId, slugs, topic, transcript} -> summarize + store
//   POST {action:"stats",    key, days}          -> dashboard aggregates (admin key)
// Keys live in Supabase Vault (read via service-role RPC). verify_jwt = false;
// guarded by an Origin allowlist + per-IP rate limit.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGINS: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.github\.io$/,
  /^https:\/\/[a-z0-9-]+\.pages\.dev$/,
];
function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((re) => re.test(origin));
}

const RATE = { windowMs: 60_000, max: 40 };
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t > RATE.windowMs)) hits.delete(k);
  }
  return arr.length > RATE.max;
}

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// ---- secrets (Vault via service-role RPC) ----
const secretCache = new Map<string, string>();
async function getSecret(name: string): Promise<string | null> {
  if (secretCache.has(name)) return secretCache.get(name)!;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_provider_secret`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ secret_name: name }),
    });
    if (!res.ok) return null;
    const val = await res.json();
    if (typeof val === "string" && val) { secretCache.set(name, val); return val; }
  } catch (_e) { /* ignore */ }
  return null;
}

// ---- db helpers (PostgREST, service role) ----
async function dbGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) throw new Error(`db get ${res.status}`);
  return res.json();
}
async function dbInsert(table: string, row: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`db insert ${res.status}: ${(await res.text()).slice(0, 140)}`);
}

function logMetric(provider: string, model: string, kind: string, success: boolean, latencyMs: number) {
  const pr = dbInsert("aisole_metrics", { provider, model, kind, success, latency_ms: latencyMs }).catch(() => {});
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(pr); } catch (_e) { /* ignore */ }
}

// ---- LLM providers ----
interface Msg { role: string; content: string; }
interface Provider { name: string; secret: string; url: string; model: string; }
const PROVIDERS: Provider[] = [
  { name: "openrouter", secret: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/chat/completions", model: "nex-agi/nex-n2-pro:free" },
  { name: "mistral", secret: "MISTRAL_API_KEY", url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" },
  { name: "thaillm", secret: "THAILLM_API_KEY", url: "https://api.opentyphoon.ai/v1/chat/completions", model: "typhoon-v2.1-12b-instruct" },
];

async function callProvider(p: Provider, key: string, messages: Msg[], maxTokens = 380): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  if (p.name === "openrouter") { headers["HTTP-Referer"] = "https://aisole.app"; headers["X-Title"] = "AISole"; }
  const res = await fetch(p.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: p.model, messages, max_tokens: maxTokens, temperature: 0.9 }),
  });
  if (!res.ok) { throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 180)}`); }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim?.() ?? "";
  if (!text) throw new Error(`${p.name}: empty response`);
  return text;
}

async function generate(messages: Msg[], kind = "chat", maxTokens = 380): Promise<{ text: string; provider: string; model: string }> {
  const errors: string[] = [];
  for (const p of PROVIDERS) {
    const key = await getSecret(p.secret);
    if (!key) { errors.push(`${p.name}: no key`); continue; }
    const t0 = Date.now();
    try {
      const text = await callProvider(p, key, messages, maxTokens);
      logMetric(p.name, p.model, kind, true, Date.now() - t0);
      return { text, provider: p.name, model: p.model };
    } catch (e) {
      logMetric(p.name, p.model, kind, false, Date.now() - t0);
      errors.push(String((e as Error)?.message ?? e));
    }
  }
  throw new Error(`all providers failed: ${errors.join(" | ")}`);
}

// ---- memory ----
function sanitizeSlugs(slugs: unknown): string[] {
  if (!Array.isArray(slugs)) return [];
  return slugs.map((s) => String(s).replace(/[^a-z0-9:_-]/gi, "")).filter(Boolean).slice(0, 12);
}

async function handleRecall(body: any, headers: Record<string, string>): Promise<Response> {
  const clientId = String(body?.clientId ?? "");
  const slugs = sanitizeSlugs(body?.slugs);
  if (!clientId || slugs.length === 0) return json({ memories: [] }, 200, headers);
  try {
    const path = `aisole_episodes?client_id=eq.${encodeURIComponent(clientId)}&slugs=ov.{${slugs.join(",")}}` +
      `&order=created_at.desc&limit=5&select=topic,summary,created_at,slugs`;
    const rows = await dbGet(path);
    return json({ memories: rows.filter((r) => r.summary) }, 200, headers);
  } catch (e) {
    return json({ memories: [], error: String((e as Error)?.message ?? e) }, 200, headers);
  }
}

async function handleRemember(body: any, headers: Record<string, string>): Promise<Response> {
  const clientId = String(body?.clientId ?? "");
  const slugs = sanitizeSlugs(body?.slugs);
  const topic = String(body?.topic ?? "");
  const transcript = Array.isArray(body?.transcript) ? body.transcript : [];
  if (!clientId || transcript.length === 0) return json({ ok: false, error: "nothing to remember" }, 400, headers);

  const convo = transcript.map((t: any) => `${t.name}: ${t.text}`).join("\n").slice(0, 4000);
  let summary = "";
  try {
    const r = await generate([
      { role: "system", content: "สรุปบทสนทนาต่อไปนี้สั้นๆ 2-3 ประโยคเป็นภาษาไทย ว่าคุยเรื่องอะไร และใครมีจุดยืน/ความเห็นอย่างไร เพื่อใช้เป็นความทรงจำของตัวละครในครั้งถัดไป" },
      { role: "user", content: `หัวข้อ: ${topic}\n\n${convo}` },
    ], "summary", 220);
    summary = r.text;
  } catch (_e) { /* store transcript even if summary fails */ }

  try {
    await dbInsert("aisole_episodes", { client_id: clientId, slugs, topic, summary, transcript });
    return json({ ok: true, summary }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 200, headers);
  }
}

// ---- dashboard ----
async function handleStats(body: any, headers: Record<string, string>): Promise<Response> {
  const key = String(body?.key ?? "");
  const dash = await getSecret("DASH_KEY");
  if (!dash || key !== dash) return json({ error: "unauthorized" }, 401, headers);
  const days = Number(body?.days ?? 7);
  const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : "1970-01-01T00:00:00Z";
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/aisole_stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ p_since: since }),
    });
    const data = await res.json();
    return json(data, 200, headers);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 200, headers);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (!originAllowed(origin)) return json({ error: "origin not allowed" }, 403, headers);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return json({ error: "rate limited, slow down" }, 429, headers);

  if (req.method === "GET") {
    return json({ ok: true, service: "aisole-brain", providers: PROVIDERS.map((p) => p.name) }, 200, headers);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "chat";
    if (action === "recall") return await handleRecall(body, headers);
    if (action === "remember") return await handleRemember(body, headers);
    if (action === "stats") return await handleStats(body, headers);

    const messages: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) return json({ error: "no messages" }, 400, headers);
    const r = await generate(messages, "chat");
    return json(r, 200, headers);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502, headers);
  }
});
