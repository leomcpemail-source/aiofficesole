import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// AISole "brain" — LLM relay + per-character memory/minds + dashboard.
//   POST {messages}                                   -> chat
//   POST {action:"recall",   clientId, slugs}         -> episodes + minds
//   POST {action:"remember", clientId, slugs, cast, topic, transcript} -> store + reflect
//   POST {action:"stats",    code|token, days}        -> dashboard (TOTP / session token)
// Keys + admin TOTP secret live in Supabase Vault. verify_jwt = false; guarded by
// an exact-origin allowlist (blocks forks) + per-IP rate limit.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Exact production origins only — a fork on another github.io/pages.dev is denied.
const ALLOWED_ORIGINS: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/leomcpemail-source\.github\.io$/,
];
function originAllowed(origin: string | null): boolean {
  if (!origin) return true; // non-browser (server-to-server / curl)
  return ALLOWED_ORIGINS.some((re) => re.test(origin));
}

const RATE = { windowMs: 60_000, max: 40 };
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t > RATE.windowMs)) hits.delete(k);
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

// ---- secrets ----
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

// ---- db helpers ----
async function dbGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } });
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
async function dbRpc(fn: string, args: unknown): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(args),
  }).catch(() => {});
}
function logMetric(provider: string, model: string, kind: string, success: boolean, latencyMs: number) {
  const pr = dbInsert("aisole_metrics", { provider, model, kind, success, latency_ms: latencyMs }).catch(() => {});
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(pr); } catch (_e) { /* ignore */ }
}

// ---- crypto: TOTP (Google Authenticator) + session token ----
function base32Decode(s: string): Uint8Array {
  const alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const idx = alph.indexOf(ch); if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}
async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8); const dv = new DataView(buf);
  dv.setUint32(4, counter >>> 0);
  dv.setUint32(0, Math.floor(counter / 2 ** 32) >>> 0);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = sig[sig.length - 1] & 0xf;
  const code = ((sig[off] & 0x7f) << 24) | ((sig[off + 1] & 0xff) << 16) | ((sig[off + 2] & 0xff) << 8) | (sig[off + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}
async function verifyTotp(secretB32: string, code: string): Promise<boolean> {
  const c = code.replace(/\D/g, ""); if (c.length !== 6) return false;
  const bytes = base32Decode(secretB32);
  const t = Math.floor(Date.now() / 1000 / 30);
  for (const o of [-1, 0, 1]) if (await hotp(bytes, t + o) === c) return true;
  return false;
}
async function hmacHex(keyStr: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(keyStr), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function makeToken(): Promise<string> {
  const exp = Date.now() + 30 * 60 * 1000;
  return `${exp}.${await hmacHex(SERVICE_ROLE, String(exp))}`;
}
async function verifyToken(tok: string): Promise<boolean> {
  const [exp, sig] = tok.split("."); if (!exp || !sig) return false;
  if (Date.now() > Number(exp)) return false;
  return (await hmacHex(SERVICE_ROLE, exp)) === sig;
}

// ---- LLM ----
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
  const res = await fetch(p.url, { method: "POST", headers, body: JSON.stringify({ model: p.model, messages, max_tokens: maxTokens, temperature: 0.9 }) });
  if (!res.ok) throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 180)}`);
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
    } catch (e) { logMetric(p.name, p.model, kind, false, Date.now() - t0); errors.push(String((e as Error)?.message ?? e)); }
  }
  throw new Error(`all providers failed: ${errors.join(" | ")}`);
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch (_e) { /* try to extract */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_e) { /* */ } }
  return null;
}

// ---- memory + minds ----
function sanitizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((s) => String(s).replace(/[^a-z0-9:_-]/gi, "")).filter(Boolean).slice(0, 12);
}

async function handleRecall(body: any, headers: Record<string, string>): Promise<Response> {
  const clientId = String(body?.clientId ?? "");
  const ids = sanitizeIds(body?.slugs);
  if (!clientId || ids.length === 0) return json({ memories: [], minds: [] }, 200, headers);
  try {
    const epPath = `aisole_episodes?client_id=eq.${encodeURIComponent(clientId)}&slugs=ov.{${ids.join(",")}}` +
      `&order=created_at.desc&limit=5&select=topic,summary,created_at,slugs`;
    const mindPath = `aisole_minds?client_id=eq.${encodeURIComponent(clientId)}&char_id=in.(${ids.map(encodeURIComponent).join(",")})` +
      `&select=char_id,name,mood,rels`;
    const [episodes, minds] = await Promise.all([dbGet(epPath), dbGet(mindPath)]);
    return json({ memories: episodes.filter((r) => r.summary), minds }, 200, headers);
  } catch (e) {
    return json({ memories: [], minds: [], error: String((e as Error)?.message ?? e) }, 200, headers);
  }
}

async function handleRemember(body: any, headers: Record<string, string>): Promise<Response> {
  const clientId = String(body?.clientId ?? "");
  const ids = sanitizeIds(body?.slugs);
  const topic = String(body?.topic ?? "");
  const transcript = Array.isArray(body?.transcript) ? body.transcript : [];
  const cast: { memId: string; name: string }[] = Array.isArray(body?.cast) ? body.cast : [];
  if (!clientId || transcript.length === 0) return json({ ok: false, error: "nothing to remember" }, 400, headers);

  const convo = transcript.map((t: any) => `${t.name}: ${t.text}`).join("\n").slice(0, 4000);
  let summary = "";
  try {
    const r = await generate([
      { role: "system", content: "สรุปบทสนทนาต่อไปนี้สั้นๆ 2-3 ประโยคเป็นภาษาไทย ว่าคุยเรื่องอะไร และใครมีจุดยืน/ความเห็นอย่างไร" },
      { role: "user", content: `หัวข้อ: ${topic}\n\n${convo}` },
    ], "summary", 220);
    summary = r.text;
  } catch (_e) { /* keep going */ }

  try { await dbInsert("aisole_episodes", { client_id: clientId, slugs: ids, topic, summary, transcript }); } catch (_e) { /* */ }

  // Reflection — update each character's mood + relationships.
  if (cast.length > 0) {
    try {
      const names = cast.map((c) => c.name).join(", ");
      const r = await generate([
        { role: "system", content: 'จากบทสนทนานี้ ให้สรุป "อารมณ์ล่าสุด" (mood) และ "ความสัมพันธ์ต่อคนอื่นในวง" (rels) ของแต่ละคน ' +
          'ตอบเป็น JSON ภาษาไทยเท่านั้น รูปแบบ {"ชื่อ":{"mood":"สั้นๆ","rels":{"ชื่ออื่น":"สั้นๆ"}}} ไม่ต้องมีข้อความอื่น' },
        { role: "user", content: `คนในวง: ${names}\n\n${convo}` },
      ], "reflect", 320);
      const parsed = safeJson(r.text);
      if (parsed) {
        for (const c of cast) {
          const m = parsed[c.name];
          if (m && (m.mood || m.rels)) {
            await dbRpc("aisole_upsert_mind", {
              p_client: clientId, p_char: String(c.memId).replace(/[^a-z0-9:_-]/gi, ""),
              p_name: c.name, p_mood: String(m.mood ?? ""), p_rels: m.rels && typeof m.rels === "object" ? m.rels : {},
            });
          }
        }
      }
    } catch (_e) { /* reflection is best-effort */ }
  }

  return json({ ok: true, summary }, 200, headers);
}

// ---- dashboard ----
async function handleStats(body: any, headers: Record<string, string>): Promise<Response> {
  let authed = false; let token: string | null = null;
  if (body?.token && await verifyToken(String(body.token))) { authed = true; token = String(body.token); }
  if (!authed && body?.code) {
    const secret = await getSecret("DASH_TOTP_SECRET");
    if (secret && await verifyTotp(secret, String(body.code))) { authed = true; token = await makeToken(); }
  }
  if (!authed) return json({ error: "unauthorized" }, 401, headers);

  const days = Number(body?.days ?? 7);
  const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : "1970-01-01T00:00:00Z";
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/aisole_stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ p_since: since }),
    });
    const data = await res.json();
    return json({ ...data, token }, 200, headers);
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
  if (req.method === "GET") return json({ ok: true, service: "aisole-brain", providers: PROVIDERS.map((p) => p.name) }, 200, headers);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "chat";
    if (action === "recall") return await handleRecall(body, headers);
    if (action === "remember") return await handleRemember(body, headers);
    if (action === "stats") return await handleStats(body, headers);
    const messages: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) return json({ error: "no messages" }, 400, headers);
    return json(await generate(messages, "chat"), 200, headers);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502, headers);
  }
});
