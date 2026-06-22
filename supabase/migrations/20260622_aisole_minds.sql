-- Per-character persistent "mind": mood + relationships, scoped per device
-- (client_id) so the same name on device A vs B is a different character.
-- Read/written only by the service role (the brain edge function).
create table if not exists public.aisole_minds (
  client_id text not null,
  char_id text not null,
  name text,
  mood text,
  rels jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (client_id, char_id)
);
alter table public.aisole_minds enable row level security;

-- Upsert helper used by the brain's reflection step (merges relationships).
create or replace function public.aisole_upsert_mind(
  p_client text, p_char text, p_name text, p_mood text, p_rels jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.aisole_minds (client_id, char_id, name, mood, rels, updated_at)
  values (p_client, p_char, p_name, p_mood, coalesce(p_rels, '{}'::jsonb), now())
  on conflict (client_id, char_id) do update
    set name = excluded.name,
        mood = excluded.mood,
        rels = public.aisole_minds.rels || excluded.rels,
        updated_at = now();
$$;
revoke all on function public.aisole_upsert_mind(text, text, text, text, jsonb) from public;
grant execute on function public.aisole_upsert_mind(text, text, text, text, jsonb) to service_role;

-- Cleanup minds untouched for 90 days (orphans from incognito etc.).
select cron.schedule(
  'aisole_minds_cleanup',
  '40 3 * * *',
  $$delete from public.aisole_minds where updated_at < now() - interval '90 days'$$
);

-- NOTE: the dashboard admin secret moved from a static key to a TOTP secret
-- (Vault: DASH_TOTP_SECRET) — verified by the brain via Google Authenticator.
