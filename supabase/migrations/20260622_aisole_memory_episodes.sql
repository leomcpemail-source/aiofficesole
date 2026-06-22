-- AISole conversation memory: each finished/periodic room snapshot is stored so
-- the cast can recall past conversations in future sessions. Read/written only by
-- the service role (the `brain` edge function); RLS denies anon/authenticated.
create table if not exists public.aisole_episodes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  slugs text[] not null default '{}',
  topic text,
  summary text,
  transcript jsonb,
  created_at timestamptz not null default now()
);

create index if not exists aisole_episodes_client_idx on public.aisole_episodes (client_id, created_at desc);
create index if not exists aisole_episodes_slugs_idx on public.aisole_episodes using gin (slugs);

alter table public.aisole_episodes enable row level security;

-- Daily cleanup of stale memories (>30 days), matching AISole's TTL.
create extension if not exists pg_cron;
select cron.schedule(
  'aisole_cleanup_stale',
  '0 3 * * *',
  $$delete from public.aisole_episodes where created_at < now() - interval '30 days'$$
);
