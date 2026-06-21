import React, { useState } from 'react'
import {
  ROSTER, SCENES, colorForIndex,
  type RPCharacter, type RPSession, type SceneId,
} from '../roleplay'

/** Avatar thumbnail for a roster slug (Office sprite, front-right pose). */
function rosterAvatar(slug: string): string {
  return `/sprites/office/characters/${slug}-front-right.png`
}

interface Props {
  initial?: Partial<RPSession>
  onStart: (session: Omit<RPSession, 'active'>) => void
  onClose: () => void
}

type Step = 1 | 2 | 3

const MAX_CAST = 8

const RolePlayStudio: React.FC<Props> = ({ initial, onStart, onClose }) => {
  const [step, setStep] = useState<Step>(1)
  const [topic, setTopic] = useState(initial?.topic ?? '')
  const [backstory, setBackstory] = useState(initial?.backstory ?? '')
  const [humanName, setHumanName] = useState(initial?.humanName ?? '')
  const [scene, setScene] = useState<SceneId>(initial?.scene ?? 'office-day')
  const [cast, setCast] = useState<RPCharacter[]>(initial?.cast ?? [])

  const inCast = (slug: string) => cast.some(c => c.slug === slug)

  const toggleCharacter = (slug: string, name: string) => {
    setCast(prev => {
      if (prev.some(c => c.slug === slug)) {
        return prev
          .filter(c => c.slug !== slug)
          .map((c, i) => ({ ...c, roleKey: `rp-${i}`, color: colorForIndex(i) }))
      }
      if (prev.length >= MAX_CAST) return prev
      const i = prev.length
      return [...prev, { roleKey: `rp-${i}`, slug, name, persona: '', color: colorForIndex(i) }]
    })
  }

  const setPersona = (slug: string, persona: string) => {
    setCast(prev => prev.map(c => (c.slug === slug ? { ...c, persona } : c)))
  }

  const canStart = topic.trim().length > 0 && cast.length >= 2

  const start = () => {
    onStart({ topic: topic.trim(), backstory: backstory.trim(), humanName: humanName.trim(), scene, cast })
  }

  return (
    <div className="rp-overlay" role="dialog" aria-modal="true">
      <div className="rp-modal">
        <button className="rp-close" onClick={onClose} aria-label="ปิด">✕</button>

        <div className="rp-brand">
          <span className="rp-logo">🗣️ AISole</span>
          <span className="rp-tagline">นั่งดูตัวละครคุยกัน — ตั้งบทบาทเอง</span>
        </div>

        <div className="rp-steps">
          <span className={`rp-step-dot${step >= 1 ? ' on' : ''}`}>1 หัวข้อ</span>
          <span className={`rp-step-dot${step >= 2 ? ' on' : ''}`}>2 ตัวละคร</span>
          <span className={`rp-step-dot${step >= 3 ? ' on' : ''}`}>3 ฉาก</span>
        </div>

        {step === 1 && (
          <div className="rp-body">
            <label className="rp-label">หัวข้อที่อยากให้คุยกัน</label>
            <input
              className="rp-input"
              placeholder="เช่น ถ้าแมวพูดได้จะบ่นอะไร"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              autoFocus
            />
            <label className="rp-label">ปูมหลัง / สถานการณ์ตั้งต้น (ไม่บังคับ)</label>
            <textarea
              className="rp-textarea"
              placeholder="เช่น ทุกคนเพิ่งกินข้าวเที่ยงเสร็จ กำลังเถียงกันเล่นๆ"
              value={backstory}
              onChange={e => setBackstory(e.target.value)}
              rows={3}
            />
            <label className="rp-label">ชื่อของคุณในวง (ไม่บังคับ)</label>
            <input
              className="rp-input"
              placeholder="เว้นว่าง = เป็น “ผู้ชม”"
              value={humanName}
              onChange={e => setHumanName(e.target.value)}
            />
            <div className="rp-actions">
              <button className="rp-btn-primary" disabled={!topic.trim()} onClick={() => setStep(2)}>
                ต่อไป →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="rp-body">
            <label className="rp-label">เลือกตัวละคร ({cast.length}/{MAX_CAST}) — อย่างน้อย 2 ตัว</label>
            <div className="rp-roster">
              {ROSTER.map(r => (
                <button
                  key={r.slug}
                  className={`rp-card${inCast(r.slug) ? ' selected' : ''}`}
                  onClick={() => toggleCharacter(r.slug, r.name)}
                  title={r.name}
                >
                  <img
                    src={rosterAvatar(r.slug)}
                    alt={r.name}
                    className="rp-card-img"
                    onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                  />
                  <span className="rp-card-name">{r.name}</span>
                </button>
              ))}
            </div>

            {cast.length > 0 && (
              <>
                <label className="rp-label">กำหนดบทบาทให้แต่ละตัว (จะสวมบทตามนี้)</label>
                <div className="rp-personas">
                  {cast.map(c => (
                    <div className="rp-persona-row" key={c.slug}>
                      <span className="rp-persona-chip" style={{ background: c.color }}>{c.name}</span>
                      <input
                        className="rp-input rp-persona-input"
                        placeholder="บทบาท เช่น นักปรัชญาขี้สงสัย / พ่อค้าหัวใส"
                        value={c.persona}
                        onChange={e => setPersona(c.slug, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="rp-actions">
              <button className="rp-btn-ghost" onClick={() => setStep(1)}>← กลับ</button>
              <button className="rp-btn-primary" disabled={cast.length < 2} onClick={() => setStep(3)}>
                ต่อไป →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="rp-body">
            <label className="rp-label">เลือกฉาก</label>
            <div className="rp-scenes">
              {SCENES.map(s => (
                <button
                  key={s.id}
                  className={`rp-scene${scene === s.id ? ' selected' : ''}`}
                  onClick={() => setScene(s.id)}
                >
                  <span className="rp-scene-emoji">{s.emoji}</span>
                  <span className="rp-scene-label">{s.label}</span>
                </button>
              ))}
            </div>

            <div className="rp-summary">
              <div><b>หัวข้อ:</b> {topic}</div>
              <div className="rp-summary-cast">
                {cast.map(c => (
                  <span key={c.slug} className="rp-summary-chip" style={{ borderColor: c.color }}>
                    {c.name}{c.persona ? ` · ${c.persona}` : ''}
                  </span>
                ))}
              </div>
            </div>

            <div className="rp-actions">
              <button className="rp-btn-ghost" onClick={() => setStep(2)}>← กลับ</button>
              <button className="rp-btn-primary" disabled={!canStart} onClick={start}>
                🎬 เริ่มวงสนทนา
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default RolePlayStudio
