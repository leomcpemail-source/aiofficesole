import React, { useState } from 'react'
import {
  ROSTER, colorForIndex, autoScene, genderForSlug,
  getCustomCharacters, saveCustomCharacter, deleteCustomCharacter,
  type RPCharacter, type RPSession, type CustomCharacter,
} from '../roleplay'
import { asset } from '../asset'

function rosterAvatar(slug: string): string {
  return asset(`/sprites/office/characters/${slug}-front-right.png`)
}

interface Props {
  onStart: (session: Omit<RPSession, 'active'>) => void
  onClose: () => void
}

type Screen = 'home' | 'guide' | 'characters' | 'wizard'

const MAX_CAST = 8

/** A pickable cast member — either a roster character or a saved custom one. */
interface Pickable { key: string; name: string; slug: string; persona: string; custom?: CustomCharacter }

const RolePlayStudio: React.FC<Props> = ({ onStart, onClose }) => {
  const [screen, setScreen] = useState<Screen>('home')
  const [customs, setCustoms] = useState<CustomCharacter[]>(() => getCustomCharacters())

  // Wizard state
  const [wizStep, setWizStep] = useState<1 | 2>(1)
  const [topic, setTopic] = useState('')
  const [backstory, setBackstory] = useState('')
  const [humanName, setHumanName] = useState('')
  const [cast, setCast] = useState<(RPCharacter & { _key?: string })[]>([])

  // Create-character form
  const [cName, setCName] = useState('')
  const [cSlug, setCSlug] = useState(ROSTER[0]?.slug ?? '')
  const [cPersona, setCPersona] = useState('')

  const pickables: Pickable[] = [
    ...customs.map(c => ({ key: `custom:${c.id}`, name: c.name, slug: c.slug, persona: c.persona, custom: c })),
    ...ROSTER.map(r => ({ key: r.slug, name: r.name, slug: r.slug, persona: '' })),
  ]

  const inCast = (key: string) => cast.some(c => c._key === key)

  // We tag each cast member with its pickable key via a non-persisted field.
  const toggle = (p: Pickable) => {
    setCast(prev => {
      const exists = prev.some(c => c._key === p.key)
      let next: (RPCharacter & { _key?: string })[]
      if (exists) next = prev.filter(c => c._key !== p.key)
      else {
        if (prev.length >= MAX_CAST) return prev
        next = [...prev, { roleKey: '', slug: p.slug, name: p.name, persona: p.persona, color: '', memId: p.key, gender: genderForSlug(p.slug), _key: p.key }]
      }
      return next.map((c, i) => ({ ...c, roleKey: `rp-${i}`, color: colorForIndex(i) }))
    })
  }

  const setPersona = (key: string, persona: string) =>
    setCast(prev => prev.map(c => (c._key === key ? { ...c, persona } : c)))

  const canStart = topic.trim().length > 0 && cast.length >= 2

  const start = () => {
    const clean = cast.map(({ roleKey, slug, name, persona, color, memId, gender }) => ({ roleKey, slug, name, persona, color, memId, gender }))
    onStart({ topic: topic.trim(), backstory: backstory.trim(), humanName: humanName.trim(), scene: autoScene(), cast: clean })
  }

  const createCharacter = () => {
    if (!cName.trim() || !cSlug) return
    const c: CustomCharacter = {
      id: 'cc-' + Date.now().toString(36),
      name: cName.trim(),
      slug: cSlug,
      persona: cPersona.trim(),
      color: colorForIndex(customs.length),
    }
    setCustoms(saveCustomCharacter(c))
    setCName(''); setCPersona('')
  }

  const removeCustom = (id: string) => setCustoms(deleteCustomCharacter(id))

  return (
    <div className="rp-overlay" role="dialog" aria-modal="true">
      <div className="rp-modal">
        <button className="rp-close" onClick={onClose} aria-label="ปิด">✕</button>
        <div className="rp-brand">
          <span className="rp-logo">🗣️ AISole</span>
          <span className="rp-tagline">นั่งดู AI คุยกันเอง — ตั้งตัวละคร + บทบาทเอง</span>
        </div>

        {/* ---------- HOME ---------- */}
        {screen === 'home' && (
          <div className="rp-home">
            <button className="rp-home-btn primary" onClick={() => { setScreen('wizard'); setWizStep(1) }}>
              🎬 เริ่มวงสนทนา
            </button>
            <button className="rp-home-btn" onClick={() => setScreen('characters')}>
              👥 คลังตัวละคร / สร้างตัวละคร
            </button>
            <button className="rp-home-btn" onClick={() => setScreen('guide')}>
              📖 คู่มือการใช้งาน
            </button>
            <p className="rp-home-hint">ฉากปรับตามเวลาท้องถิ่นของคุณอัตโนมัติ 🌅☀️🌇🌙</p>
          </div>
        )}

        {/* ---------- GUIDE ---------- */}
        {screen === 'guide' && (
          <div className="rp-body">
            <h3 className="rp-h3">📖 คู่มือการใช้งาน</h3>
            <ol className="rp-guide">
              <li><b>สร้างตัวละคร</b> (ไม่บังคับ) — ตั้งชื่อ เลือกหน้าตา และกำหนด “บทบาท” ที่อยากให้สวม เก็บไว้ในคลัง</li>
              <li><b>เริ่มวงสนทนา</b> — ใส่หัวข้อที่อยากให้คุย + ปูมหลัง (ถ้ามี) + ชื่อของคุณในวง</li>
              <li><b>เลือกตัวละคร</b> 2–8 ตัว จากคลัง แล้วกำหนด/แก้บทบาทของแต่ละตัว</li>
              <li><b>นั่งดู</b> ตัวละครเดินไปมาในห้องและคุยกันใน chat ด้วย AI จริง</li>
              <li><b>พิมพ์แทรก</b>ได้ตลอดในช่องแชต — ตัวละครจะตอบสนองคุณ</li>
              <li><b>ความจำ</b> — ตัวละครจำวงก่อนๆ ที่เคยคุยกับชุดเดียวกันได้ คุยต่อเนื่องขึ้นเรื่อยๆ</li>
            </ol>
            <p className="rp-home-hint">ฉากเช้า/กลางวัน/เย็น/กลางคืน ปรับตาม timezone ของคุณเอง ไม่ต้องเลือก</p>
            <div className="rp-actions"><button className="rp-btn-ghost" onClick={() => setScreen('home')}>← กลับ</button></div>
          </div>
        )}

        {/* ---------- CHARACTERS / CREATE ---------- */}
        {screen === 'characters' && (
          <div className="rp-body">
            <h3 className="rp-h3">✨ สร้างตัวละคร</h3>
            <div className="rp-create">
              <input className="rp-input" placeholder="ชื่อตัวละคร เช่น ป้าไพ" value={cName} onChange={e => setCName(e.target.value)} />
              <input className="rp-input" placeholder="บทบาท เช่น แม่ค้าขายหวยปากจัด" value={cPersona} onChange={e => setCPersona(e.target.value)} />
              <label className="rp-label">เลือกหน้าตา</label>
              <div className="rp-roster rp-roster-sm">
                {ROSTER.map(r => (
                  <button key={r.slug} className={`rp-card${cSlug === r.slug ? ' selected' : ''}`} onClick={() => setCSlug(r.slug)} title={r.name}>
                    <img src={rosterAvatar(r.slug)} alt={r.name} className="rp-card-img" onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                  </button>
                ))}
              </div>
              <button className="rp-btn-primary" disabled={!cName.trim()} onClick={createCharacter}>+ บันทึกตัวละคร</button>
            </div>

            {customs.length > 0 && (
              <>
                <label className="rp-label">ตัวละครของฉัน</label>
                <div className="rp-personas">
                  {customs.map(c => (
                    <div className="rp-persona-row" key={c.id}>
                      <img src={rosterAvatar(c.slug)} alt={c.name} className="rp-mini-avatar" />
                      <span className="rp-persona-chip" style={{ background: c.color }}>{c.name}</span>
                      <span className="rp-custom-persona">{c.persona || '—'}</span>
                      <button className="rp-del" onClick={() => removeCustom(c.id)} title="ลบ">✕</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="rp-actions">
              <button className="rp-btn-ghost" onClick={() => setScreen('home')}>← กลับ</button>
              <button className="rp-btn-primary" onClick={() => { setScreen('wizard'); setWizStep(1) }}>ไปเริ่มวง →</button>
            </div>
          </div>
        )}

        {/* ---------- WIZARD ---------- */}
        {screen === 'wizard' && wizStep === 1 && (
          <div className="rp-body">
            <label className="rp-label">หัวข้อที่อยากให้คุยกัน</label>
            <input className="rp-input" placeholder="เช่น ถ้าแมวพูดได้จะบ่นอะไร" value={topic} onChange={e => setTopic(e.target.value)} autoFocus />
            <label className="rp-label">ปูมหลัง / สถานการณ์ตั้งต้น (ไม่บังคับ)</label>
            <textarea className="rp-textarea" rows={3} placeholder="เช่น ทุกคนเพิ่งกินข้าวเที่ยงเสร็จ กำลังเถียงกันเล่นๆ" value={backstory} onChange={e => setBackstory(e.target.value)} />
            <label className="rp-label">ชื่อของคุณในวง (ไม่บังคับ)</label>
            <input className="rp-input" placeholder="เว้นว่าง = เป็น “ผู้ชม”" value={humanName} onChange={e => setHumanName(e.target.value)} />
            <div className="rp-actions">
              <button className="rp-btn-ghost" onClick={() => setScreen('home')}>← หน้าแรก</button>
              <button className="rp-btn-primary" disabled={!topic.trim()} onClick={() => setWizStep(2)}>ต่อไป →</button>
            </div>
          </div>
        )}

        {screen === 'wizard' && wizStep === 2 && (
          <div className="rp-body">
            <label className="rp-label">เลือกตัวละคร ({cast.length}/{MAX_CAST}) — อย่างน้อย 2 ตัว</label>
            <div className="rp-roster">
              {pickables.map(p => (
                <button key={p.key} className={`rp-card${inCast(p.key) ? ' selected' : ''}`} onClick={() => toggle(p)} title={p.name}>
                  <img src={rosterAvatar(p.slug)} alt={p.name} className="rp-card-img" onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                  <span className="rp-card-name">{p.custom ? '⭐ ' : ''}{p.name}</span>
                </button>
              ))}
            </div>

            {cast.length > 0 && (
              <>
                <label className="rp-label">บทบาทของแต่ละตัว</label>
                <div className="rp-personas">
                  {cast.map(c => (
                    <div className="rp-persona-row" key={(c as any)._key}>
                      <span className="rp-persona-chip" style={{ background: c.color }}>{c.name}</span>
                      <input className="rp-input rp-persona-input" placeholder="บทบาท เช่น นักปรัชญาขี้สงสัย" value={c.persona} onChange={e => setPersona((c as any)._key, e.target.value)} />
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="rp-actions">
              <button className="rp-btn-ghost" onClick={() => setWizStep(1)}>← กลับ</button>
              <button className="rp-btn-primary" disabled={!canStart} onClick={start}>🎬 เริ่มวงสนทนา</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default RolePlayStudio
