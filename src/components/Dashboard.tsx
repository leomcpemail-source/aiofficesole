import React, { useCallback, useEffect, useState } from 'react'
import { fetchStats } from '../roleplay'

interface ProviderRow { provider: string; model: string; calls: number; ok: number }
interface DayRow { day: string; calls: number; ok: number }
interface Stats {
  total: number; ok: number; avg_latency: number
  by_provider: ProviderRow[]; by_day: DayRow[]
  error?: string
}

const RANGES: { label: string; days: number }[] = [
  { label: 'วันนี้', days: 1 },
  { label: '7 วัน', days: 7 },
  { label: '30 วัน', days: 30 },
  { label: 'ทั้งหมด', days: 0 },
]

function pct(ok: number, total: number): string {
  if (!total) return '—'
  return Math.round((ok / total) * 100) + '%'
}

const Dashboard: React.FC = () => {
  const tokenRef = React.useRef<string>(localStorage.getItem('aisole_dash_token') ?? '')
  const [code, setCode] = useState('')
  const [authed, setAuthed] = useState(false)
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (auth: { code?: string; token?: string }, d: number) => {
    setLoading(true); setErr(null)
    try {
      const data = await fetchStats(auth, d)
      if (data?.error) {
        setErr(data.error === 'unauthorized' ? 'รหัสไม่ถูกต้อง / หมดเวลา' : data.error)
        if (data.error === 'unauthorized') { setAuthed(false); tokenRef.current = ''; localStorage.removeItem('aisole_dash_token') }
        return
      }
      if (data.token) { tokenRef.current = data.token; localStorage.setItem('aisole_dash_token', data.token) }
      setAuthed(true)
      setStats(data as Stats)
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (tokenRef.current) load({ token: tokenRef.current }, days) }, []) // eslint-disable-line
  useEffect(() => { if (authed) load({ token: tokenRef.current }, days) }, [days]) // eslint-disable-line

  const maxDay = stats ? Math.max(1, ...stats.by_day.map(d => d.calls)) : 1

  return (
    <div className="dash-root">
      <div className="dash-head">
        <span className="dash-logo">🗣️ AISole · Dashboard</span>
        <a className="dash-back" href="./">← กลับเว็บ</a>
      </div>

      {!authed ? (
        <div className="dash-login">
          <p className="dash-login-label">ใส่รหัส 6 หลักจาก Google Authenticator</p>
          <input
            className="dash-input"
            inputMode="numeric"
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) load({ code }, days) }}
            autoFocus
          />
          <button className="dash-btn" disabled={code.length !== 6 || loading} onClick={() => load({ code }, days)}>
            {loading ? 'กำลังตรวจ…' : 'เข้าสู่ระบบ'}
          </button>
          {err && <p className="dash-err">{err}</p>}
        </div>
      ) : (
        <div className="dash-body">
          <div className="dash-ranges">
            {RANGES.map(r => (
              <button key={r.days} className={`dash-range${days === r.days ? ' on' : ''}`} onClick={() => setDays(r.days)}>{r.label}</button>
            ))}
            <button className="dash-range" onClick={() => load({ token: tokenRef.current }, days)} title="รีเฟรช">↻</button>
          </div>

          {err && <p className="dash-err">{err}</p>}

          {stats && (
            <>
              <div className="dash-cards">
                <div className="dash-card"><span className="dash-num">{stats.total}</span><span className="dash-cap">เรียก LLM</span></div>
                <div className="dash-card"><span className="dash-num">{pct(stats.ok, stats.total)}</span><span className="dash-cap">สำเร็จ</span></div>
                <div className="dash-card"><span className="dash-num">{stats.avg_latency}<small>ms</small></span><span className="dash-cap">latency เฉลี่ย</span></div>
              </div>

              <h3 className="dash-h3">แยกตามค่าย / โมเดล</h3>
              <table className="dash-table">
                <thead><tr><th>ค่าย</th><th>โมเดล</th><th>เรียก</th><th>สำเร็จ</th><th>%</th></tr></thead>
                <tbody>
                  {stats.by_provider.length === 0 && <tr><td colSpan={5} className="dash-empty">ยังไม่มีข้อมูล</td></tr>}
                  {stats.by_provider.map((p, i) => (
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

              <h3 className="dash-h3">รายวัน</h3>
              <div className="dash-bars">
                {stats.by_day.length === 0 && <span className="dash-empty">ยังไม่มีข้อมูล</span>}
                {stats.by_day.map((d, i) => (
                  <div className="dash-bar-col" key={i} title={`${d.day}: ${d.ok}/${d.calls}`}>
                    <div className="dash-bar" style={{ height: `${(d.calls / maxDay) * 100}%` }}>
                      <div className="dash-bar-ok" style={{ height: `${(d.ok / d.calls) * 100}%` }} />
                    </div>
                    <span className="dash-bar-label">{d.day}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default Dashboard
