-- AISole analytics: per-session records + richer dashboard aggregations.
-- A "session" = one watch-party the user starts (topic + cast). Written by the
-- brain edge function (service role) only; LLM-call metrics are tied back to a
-- session via aisole_metrics.session_id so the dashboard can drill down.

create table if not exists public.aisole_sessions (
  id text primary key,                 -- client-generated 's-...' id
  client_id text,                       -- per-browser visitor id
  topic text default '',
  cast_count int default 0,
  cast_names jsonb default '[]'::jsonb,
  country text default '',              -- 2-letter code derived on the client
  tz text default '',
  local_hour int,                       -- 0-23, the visitor's local hour
  created_at timestamptz not null default now()
);
create index if not exists aisole_sessions_created_idx on public.aisole_sessions (created_at desc);
alter table public.aisole_sessions enable row level security;

-- Tie each LLM call back to a session + visitor.
alter table public.aisole_metrics add column if not exists session_id text;
alter table public.aisole_metrics add column if not exists client_id text;
create index if not exists aisole_metrics_session_idx on public.aisole_metrics (session_id);

-- ---------------------------------------------------------------------------
-- Overview aggregation (a range bounded by p_since .. p_until).
-- ---------------------------------------------------------------------------
create or replace function public.aisole_overview(p_since timestamptz, p_until timestamptz)
returns json
language sql
security definer
set search_path = ''
as $$
  select json_build_object(
    'visitors', (select count(distinct client_id) from public.aisole_sessions
                 where created_at >= p_since and created_at < p_until),
    'sessions', (select count(*) from public.aisole_sessions
                 where created_at >= p_since and created_at < p_until),
    'llm_total', (select count(*) from public.aisole_metrics
                  where created_at >= p_since and created_at < p_until),
    'llm_ok', (select count(*) filter (where success) from public.aisole_metrics
               where created_at >= p_since and created_at < p_until),
    'avg_latency', (select coalesce(round(avg(latency_ms) filter (where success)), 0)
                    from public.aisole_metrics
                    where created_at >= p_since and created_at < p_until),
    'by_provider', (
      select coalesce(json_agg(t), '[]') from (
        select provider, model, count(*) as calls, count(*) filter (where success) as ok
        from public.aisole_metrics
        where created_at >= p_since and created_at < p_until
        group by provider, model order by calls desc
      ) t),
    'by_day', (
      select coalesce(json_agg(d), '[]') from (
        select to_char(date_trunc('day', created_at), 'MM-DD') as day,
               count(*) as sessions, count(distinct client_id) as visitors
        from public.aisole_sessions
        where created_at >= p_since and created_at < p_until
        group by date_trunc('day', created_at) order by date_trunc('day', created_at)
      ) d),
    'by_hour', (
      select coalesce(json_agg(h), '[]') from (
        select local_hour as hour, count(*) as sessions
        from public.aisole_sessions
        where created_at >= p_since and created_at < p_until and local_hour is not null
        group by local_hour order by local_hour
      ) h),
    'by_country', (
      select coalesce(json_agg(c), '[]') from (
        select coalesce(nullif(country, ''), 'XX') as country,
               count(*) as sessions, count(distinct client_id) as visitors
        from public.aisole_sessions
        where created_at >= p_since and created_at < p_until
        group by 1 order by sessions desc limit 30
      ) c),
    'topics', (
      select coalesce(json_agg(tp), '[]') from (
        select topic, cast_count, coalesce(nullif(country, ''), 'XX') as country,
               local_hour, created_at
        from public.aisole_sessions
        where created_at >= p_since and created_at < p_until and topic <> ''
        order by created_at desc limit 40
      ) tp)
  );
$$;
revoke all on function public.aisole_overview(timestamptz, timestamptz) from public;
grant execute on function public.aisole_overview(timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Per-session list with the LLM-provider rollup for drill-down.
-- ---------------------------------------------------------------------------
create or replace function public.aisole_sessions_list(p_since timestamptz, p_until timestamptz, p_limit int)
returns json
language sql
security definer
set search_path = ''
as $$
  select coalesce(json_agg(j order by created_at desc), '[]')
  from (
    select json_build_object(
      'id', s.id,
      'created_at', s.created_at,
      'topic', s.topic,
      'cast_count', s.cast_count,
      'cast_names', s.cast_names,
      'country', coalesce(nullif(s.country, ''), 'XX'),
      'local_hour', s.local_hour,
      'llm_calls', coalesce(m.calls, 0),
      'llm_ok', coalesce(m.ok, 0),
      'providers', coalesce(m.providers, '[]'::json)
    ) as j, s.created_at as created_at
    from public.aisole_sessions s
    left join lateral (
      select count(*) as calls, count(*) filter (where success) as ok,
        (select json_agg(p) from (
          select provider, count(*) as calls, count(*) filter (where success) as ok
          from public.aisole_metrics mm
          where mm.session_id = s.id
          group by provider order by count(*) desc
        ) p) as providers
      from public.aisole_metrics m2 where m2.session_id = s.id
    ) m on true
    where s.created_at >= p_since and s.created_at < p_until
    order by s.created_at desc
    limit p_limit
  ) q;
$$;
revoke all on function public.aisole_sessions_list(timestamptz, timestamptz, int) from public;
grant execute on function public.aisole_sessions_list(timestamptz, timestamptz, int) to service_role;

-- Cleanup stale sessions (>30 days) to match the metrics retention.
select cron.schedule(
  'aisole_sessions_cleanup',
  '25 3 * * *',
  $$delete from public.aisole_sessions where created_at < now() - interval '30 days'$$
);
