# AISole brain — Supabase Edge Function

This is the optional LLM "brain" that powers the **AISole role-play studio**
(`src/roleplay.ts`). The front-end runs fully offline with a local persona
engine; when `VITE_BRAIN_URL` points at this function, each conversation turn is
relayed here and answered by Claude instead. If the function is unreachable or
errors, the client silently falls back to the offline engine — the show never
stalls.

```
browser (src/roleplay.ts → generateLine)
   │  POST { messages: [ {role:"system",…}, {role:"user","Name: text"}… ] }
   ▼
supabase/functions/brain  ──►  Claude (Messages API)
   │  200 { text: "…in-character line…" }
   ▼
chat panel
```

## One-time setup

### 1. Join the Supabase org (you, in a browser)

The org **AISole office** (`datapik20241@gmail.com`) already sent an invite to
`leomcpemail@gmail.com`. Open the invite email and click **Join this
organization** — this step is interactive and can't be automated from here.

### 2. Create a project + grab its ref

In the **AISole office** org, create a project (any region). Copy its
**Project ref** from *Project Settings → General* (a 20-char string).

### 3. Link this repo to the project

```bash
npm i -g supabase            # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
```

### 4. Set the secret(s)

```bash
cp supabase/.env.example supabase/.env
# edit supabase/.env and paste your ANTHROPIC_API_KEY
supabase secrets set --env-file supabase/.env
```

> The Anthropic key lives only in Supabase secrets — it is never shipped to the
> browser. The browser only ever sees the function URL.

### 5. Deploy

```bash
supabase functions deploy brain --no-verify-jwt
```

The deploy prints the function URL, e.g.
`https://<project-ref>.supabase.co/functions/v1/brain`.

### 6. Point the front-end at it

```bash
# .env (gitignored) at the repo root
VITE_BRAIN_URL=https://<project-ref>.supabase.co/functions/v1/brain
```

Restart `npm run dev`. The role-play studio now relays turns to Claude.

## Local development

```bash
supabase functions serve brain --env-file supabase/.env
# → http://localhost:54321/functions/v1/brain
```

Smoke test:

```bash
curl -s http://localhost:54321/functions/v1/brain \
  -H 'content-type: application/json' \
  -d '{"messages":[
        {"role":"system","content":"คุณคือไมเคิล หัวหน้าออฟฟิศจอมกวน"},
        {"role":"user","content":"Jim: วันนี้ยอดขายเป็นไงบ้างครับ"}
      ]}'
# → {"text":"..."}
```

## Configuration

| Secret / env var      | Required | Default            | Purpose                                   |
| --------------------- | -------- | ------------------ | ----------------------------------------- |
| `ANTHROPIC_API_KEY`   | yes      | —                  | Calls the Claude Messages API.            |
| `BRAIN_MODEL`         | no       | `claude-opus-4-8`  | Model id. Use `claude-haiku-4-5` for cheaper/faster turns. |
| `BRAIN_ALLOW_ORIGIN`  | no       | `*`                | CORS origin — set to your app's origin in production. |

## Notes

- Turns are short in-character lines, so the function caps `max_tokens` at 256
  and forwards at most the last 24 turns of history to keep latency and cost
  low.
- `verify_jwt = false` (see `config.toml`) because the browser calls the
  function directly without a Supabase session. Lock down access with
  `BRAIN_ALLOW_ORIGIN` and, if needed, an API gateway / rate limit in front.
