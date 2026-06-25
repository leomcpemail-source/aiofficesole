import React, { useCallback, useEffect, useState } from 'react'
import { fetchOverview, fetchSessions, type StatsAuth, type StatsRange } from '../roleplay'

// ---- types mirroring the brain's overview / sessions payloads ----
interface ProviderRow { provider: string; model?: string; calls: number; ok: number }
interface DayRow { day: string; sessions: number; visitors: number }
interface HourRow { hour: number; sessions: number }
interface CountryRow { country: string; sessions: number; visitors: number }
interface TopicRow { topic: string; cast_count: number; country: string; local_hour: number; created_at: string }
interface Overview {
  visitors: number; sessions: number; llm_total: number; llm_ok: number; avg_latency: number
  by_provider: ProviderRow[]; by_day: DayRow[]; by_hour: HourRow[]
  by_country: CountryRow[]; topics: TopicRow[]; error?: string
}
interface SessionRow {
  id: string; created_at: string; topic: string; cast_count: number
  cast_names: string[]; country: string; local_hour: number
  llm_calls: number; llm_ok: number; providers: ProviderRow[]
}

type Tab = 'overview' | 'sessions'

const RANGES: { label: string; days: number }[] = [
  { label: 'วันนี้', days: 1 },
  { label: '3 วัน', days: 3 },
  { label: '7 วัน', days: 7 },
  { label: '30 วัน', days: 30 },
  { label: 'ทั้งหมด', days: 0 },
]

function pct(ok: number, total: number): string {
  if (!total) return '—'
  return Math.round((ok / total) * 100) + '%'
}
function flag(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return '🏳️'
  const base = 0x1f1e6
  return String.fromCodePoint(base + cc.toUpperCase().charCodeAt(0) - 65, base + cc.toUpperCase().charCodeAt(1) - 65)
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

const Dashboard: React.FC = () => {
  const tokenRef = React.useRef<string>(localStorage.getItem('aisole_dash_token') ?? '')
  const [code, setCode] = useState('')
  const [authed, setAuthed] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')

  // Range: a rolling window (days) or an explicit custom range.
  const [days, setDays] = useState<number>(7)
  const [customOn, setCustomOn] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [overview, setOverview] = useState<Overview | null>(null)
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Build the range from the viewer's LOCAL calendar day, so "today" means the
  // current day where the viewer is (not a rolling 24h window in UTC).
  const range = useCallback((): StatsRange => {
    if (customOn && from && to) {
      return { since: new Date(from + 'T00:00:00').toISOString(), until: new Date(to + 'T23:59:59').toISOString() }
    }
    const until = new Date().toISOString()
    if (days <= 0) return { since: '1970-01-01T00:00:00.000Z', until } // all time
    const start = new Date()
    start.setHours(0, 0, 0, 0)              // local midnight today
    start.setDate(start.getDate() - (days - 1)) // include today + (days-1) prior local days
    return { since: start.toISOString(), until }
  }, [customOn, from, to, days])

  const handleAuthResult = (data: any): boolean => {
    if (data?.error === 'unauthorized') {
      setErr('รหัสไม่ถูกต้อง / หมดเวลา'); setAuthed(false)
      tokenRef.current = ''; localStorage.removeItem('aisole_dash_token')
      return false
    }
    if (data?.token) { tokenRef.current = data.token; localStorage.setItem('aisole_dash_token', data.token) }
    setAuthed(true)
    return true
  }

  const load = useCallback(async (auth: StatsAuth, which: Tab) => {
    setLoading(true); setErr(null)
    try {
      if (which === 'sessions') {
        const data = await fetchSessions(auth, range())
        if (!handleAuthResult(data)) return
        if (data?.error) { setErr(data.error); return }
        setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      } else {
        const data = await fetchOverview(auth, range())
        if (!handleAuthResult(data)) return
        if (data?.error) { setErr(data.error); return }
        setOverview(data as Overview)
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [range])

  // Initial auto-login from a stored token.
  useEffect(() => { if (tokenRef.current) load({ token: tokenRef.current }, tab) }, []) // eslint-disable-line
  // Reload when the tab or range changes (once authed).
  useEffect(() => { if (authed) load({ token: tokenRef.current }, tab) }, [tab, days, customOn, from, to]) // eslint-disable-line

  const login = () => load({ code }, tab)

  // ---- render: login gate ----
  if (!authed) {
    return (
      <div className="dash-root">
        <div className="dash-head">
          <span className="dash-logo">🗣️ AISole · Dashboard</span>
          <a className="dash-back" href="./">← กลับเว็บ</a>
        </div>
        <div className="dash-login">
          <p className="dash-login-label">ใส่รหัส 6 หลักจาก Google Authenticator</p>
          <input
            className="dash-input" inputMode="numeric" placeholder="000000" value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) login() }}
            autoFocus
          />
          <button className="dash-btn" disabled={code.length !== 6 || loading} onClick={login}>
            {loading ? 'กำลังตรวจ…' : 'เข้าสู่ระบบ'}
          </button>
          {err && <p className="dash-err">{err}</p>}
        </div>
      </div>
    )
  }

  const maxDay = overview ? Math.max(1, ...overview.by_day.map(d => d.sessions)) : 1
  const maxHour = overview ? Math.max(1, ...overview.by_hour.map(h => h.sessions)) : 1
  const maxCountry = overview ? Math.max(1, ...overview.by_country.map(c => c.sessions)) : 1

  return (
    <div className="dash-root">
      <div className="dash-head">
        <span className="dash-logo">🗣️ AISole · Dashboard</span>
        <a className="dash-back" href="./">← กลับเว็บ</a>
      </div>

      <div className="dash-body">
        {/* Tabs */}
        <div className="dash-tabs">
          <button className={`dash-tab${tab === 'overview' ? ' on' : ''}`} onClick={() => setTab('overview')}>📊 ภาพรวม</button>
          <button className={`dash-tab${tab === 'sessions' ? ' on' : ''}`} onClick={() => setTab('sessions')}>🗂️ รายเซสชัน</button>
        </div>

        {/* Range controls */}
        <div className="dash-ranges">
          {RANGES.map(r => (
            <button
              key={r.days}
              className={`dash-range${!customOn && days === r.days ? ' on' : ''}`}
              onClick={() => { setCustomOn(false); setDays(r.days) }}
            >{r.label}</button>
          ))}
          <button className={`dash-range${customOn ? ' on' : ''}`} onClick={() => setCustomOn(v => !v)}>📅 เลือกวัน</button>
          <button className="dash-range" onClick={() => load({ token: tokenRef.current }, tab)} title="รีเฟรช">↻</button>
        </div>
        {customOn && (
          <div className="dash-custom">
            <label>ตั้งแต่ <input type="date" className="dash-date" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label>ถึง <input type="date" className="dash-date" value={to} onChange={e => setTo(e.target.value)} /></label>
          </div>
        )}

        {err && <p className="dash-err">{err}</p>}

        {/* ---------- OVERVIEW ---------- */}
        {tab === 'overview' && overview && (
          <>
            <div className="dash-cards">
              <div className="dash-card"><span className="dash-num">{overview.visitors}</span><span className="dash-cap">ผู้เข้าชม</span></div>
              <div className="dash-card"><span className="dash-num">{overview.sessions}</span><span className="dash-cap">เซสชัน</span></div>
              <div className="dash-card"><span className="dash-num">{overview.llm_total}</span><span className="dash-cap">เรียก LLM</span></div>
              <div className="dash-card"><span className="dash-num">{pct(overview.llm_ok, overview.llm_total)}</span><span className="dash-cap">สำเร็จ</span></div>
              <div className="dash-card"><span className="dash-num">{overview.avg_latency}<small>ms</small></span><span className="dash-cap">latency เฉลี่ย</span></div>
            </div>

            <h3 className="dash-h3">เซสชันรายวัน</h3>
            <div className="dash-bars">
              {overview.by_day.length === 0 && <span className="dash-empty">ยังไม่มีข้อมูล</span>}
              {overview.by_day.map((d, i) => (
                <div className="dash-bar-col" key={i} title={`${d.day}: ${d.sessions} เซสชัน · ${d.visitors} คน`}>
                  <div className="dash-bar" style={{ height: `${(d.sessions / maxDay) * 100}%` }} />
                  <span className="dash-bar-label">{d.day}</span>
                </div>
              ))}
            </div>

            <h3 className="dash-h3">ช่วงเวลาที่เข้าใช้ (ตามเวลาผู้ชม)</h3>
            <div className="dash-bars dash-bars-hour">
              {overview.by_hour.length === 0 && <span className="dash-empty">ยังไม่มีข้อมูล</span>}
              {overview.by_hour.map((h, i) => (
                <div className="dash-bar-col" key={i} title={`${h.hour}:00 — ${h.sessions} เซสชัน`}>
                  <div className="dash-bar dash-bar-hour" style={{ height: `${(h.sessions / maxHour) * 100}%` }} />
                  <span className="dash-bar-label">{h.hour}</span>
                </div>
              ))}
            </div>

            <h3 className="dash-h3">ประเทศของผู้ชม</h3>
            <div className="dash-country-list">
              {overview.by_country.length === 0 && <span className="dash-empty">ยังไม่มีข้อมูล</span>}
              {overview.by_country.map((c, i) => (
                <div className="dash-country-row" key={i}>
                  <span className="dash-country-name">{flag(c.country)} {c.country}</span>
                  <span className="dash-country-bar"><span style={{ width: `${(c.sessions / maxCountry) * 100}%` }} /></span>
                  <span className="dash-country-num">{c.sessions} เซสชัน · {c.visitors} คน</span>
                </div>
              ))}
            </div>

            <h3 className="dash-h3">AI ที่ตอบ — แยกตามค่าย / โมเดล</h3>
            <table className="dash-table">
              <thead><tr><th>ค่าย</th><th>โมเดล</th><th>เรียก</th><th>สำเร็จ</th><th>%</th></tr></thead>
              <tbody>
                {overview.by_provider.length === 0 && <tr><td colSpan={5} className="dash-empty">ยังไม่มีข้อมูล</td></tr>}
                {overview.by_provider.map((p, i) => (
                  <tr key={i}>
                    <td>{p.provider}</td>
                    <td className="dash-model">{p.model}</td>
                    <td>{p.calls}</td>
                    <td>{p.ok}</td>
                    <td className={p.ok / p.calls < 0.5 ? 'dash-bad' : 'dash-good'}>{pct(p.ok, p.calls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="dash-h3">หัวข้อที่คุยกันล่าสุด</h3>
            <div className="dash-topics">
              {overview.topics.length === 0 && <span className="dash-empty">ยังไม่มีข้อมูล</span>}
              {overview.topics.map((t, i) => (
                <div className="dash-topic-row" key={i}>
                  <span className="dash-topic-text">{t.topic}</span>
                  <span className="dash-topic-meta">{flag(t.country)} · 👥 {t.cast_count} · {fmtTime(t.created_at)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---------- SESSIONS ---------- */}
        {tab === 'sessions' && sessions && (
          <table className="dash-table dash-sessions">
            <thead>
              <tr><th>เวลา</th><th>ประเทศ</th><th>หัวข้อ</th><th>ตัวละคร</th><th>LLM</th><th></th></tr>
            </thead>
            <tbody>
              {sessions.length === 0 && <tr><td colSpan={6} className="dash-empty">ยังไม่มีข้อมูลในช่วงนี้</td></tr>}
              {sessions.map(s => (
                <React.Fragment key={s.id}>
                  <tr className="dash-session-row" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                    <td className="dash-nowrap">{fmtTime(s.created_at)}</td>
                    <td>{flag(s.country)} {s.country}</td>
                    <td className="dash-topic-cell">{s.topic || '—'}</td>
                    <td>👥 {s.cast_count}</td>
                    <td className={s.llm_calls && s.llm_ok / s.llm_calls < 0.5 ? 'dash-bad' : 'dash-good'}>
                      {s.llm_ok}/{s.llm_calls}
                    </td>
                    <td className="dash-expand-cell">{expanded === s.id ? '▾' : '▸'}</td>
                  </tr>
                  {expanded === s.id && (
                    <tr className="dash-detail-row">
                      <td colSpan={6}>
                        <div className="dash-detail">
                          <div className="dash-detail-block">
                            <b>ตัวละคร ({s.cast_count})</b>
                            <span>{(s.cast_names ?? []).join(' · ') || '—'}</span>
                          </div>
                          <div className="dash-detail-block">
                            <b>AI ที่ตอบในเซสชันนี้</b>
                            {s.providers && s.providers.length > 0 ? (
                              <div className="dash-prov-chips">
                                {s.providers.map((p, i) => (
                                  <span key={i} className={`dash-prov-chip${p.ok / p.calls < 0.5 ? ' bad' : ''}`}>
                                    {p.provider}: {p.ok}/{p.calls} ({pct(p.ok, p.calls)})
                                  </span>
                                ))}
                              </div>
                            ) : <span>ยังไม่มีการเรียก LLM</span>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}

        {loading && <p className="dash-loading">กำลังโหลด…</p>}
      </div>
    </div>
  )
}

export default Dashboard
