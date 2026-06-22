-- AISole dashboard: per-LLM-call metrics + aggregation RPC.
-- Read/written only by the service role (the brain edge function).
create table if not exists public.aisole_metrics (
  id bigint generated always as identity primary key,
  provider text,
  model text,
  kind text,
  success boolean,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists aisole_metrics_created_idx on public.aisole_metrics (created_at desc);
alter table public.aisole_metrics enable row level security;

-- Aggregated stats since a timestamp (JSON) for the dashboard. The admin key
-- (Vault secret DASH_KEY) is checked in the brain before this is called.
create or replace function public.aisole_stats(p_since timestamptz)
returns json
language sql
security definer
set search_path = ''
as $$
  select json_build_object(
    'total', count(*),
    'ok', count(*) filter (where success),
    'avg_latency', coalesce(round(avg(latency_ms) filter (where success)), 0),
    'by_provider', (
      select coalesce(json_agg(t), '[]') from (
        select provider, model, count(*) as calls, count(*) filter (where success) as ok
        from public.aisole_metrics where created_at >= p_since
        group by provider, model order by calls desc
      ) t),
    'by_day', (
      select coalesce(json_agg(d), '[]') from (
        select to_char(date_trunc('day', created_at), 'MM-DD') as day,
               count(*) as calls, count(*) filter (where success) as ok
        from public.aisole_metrics where created_at >= p_since
        group by 1 order by 1
      ) d)
  )
  from public.aisole_metrics where created_at >= p_since;
$$;
revoke all on function public.aisole_stats(timestamptz) from public;
grant execute on function public.aisole_stats(timestamptz) to service_role;

-- Cleanup stale metrics (>30 days).
select cron.schedule(
  'aisole_metrics_cleanup',
  '20 3 * * *',
  $$delete from public.aisole_metrics where created_at < now() - interval '30 days'$$
);
