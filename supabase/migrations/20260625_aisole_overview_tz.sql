-- Bucket the dashboard's daily chart by the viewer's timezone instead of UTC,
-- so evening sessions are attributed to the correct local calendar day.
drop function if exists public.aisole_overview(timestamptz, timestamptz);

create or replace function public.aisole_overview(p_since timestamptz, p_until timestamptz, p_tz text)
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
        select to_char(date_trunc('day', created_at at time zone p_tz), 'MM-DD') as day,
               count(*) as sessions, count(distinct client_id) as visitors
        from public.aisole_sessions
        where created_at >= p_since and created_at < p_until
        group by date_trunc('day', created_at at time zone p_tz)
        order by date_trunc('day', created_at at time zone p_tz)
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
revoke all on function public.aisole_overview(timestamptz, timestamptz, text) from public;
grant execute on function public.aisole_overview(timestamptz, timestamptz, text) to service_role;
