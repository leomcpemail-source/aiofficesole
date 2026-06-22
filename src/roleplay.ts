/**
 * roleplay.ts — AISole "watch the cast talk" engine.
 *
 * Adapts the Office sim into the AISole concept (https://aisole — AI โสเหล่):
 * the user picks characters from this repo's cast, gives each a ROLE/persona and
 * a TOPIC, then watches them converse in the chat panel while walking the room.
 *
 * This module is a tiny external store (same pattern as theme.ts) plus a
 * conversation director. Line generation works fully offline with a local
 * persona engine; if `VITE_BRAIN_URL` is set it relays to a real LLM brain
 * (the AISole Supabase edge function), exactly like AISole's js/api.js.
 */

import { useSyncExternalStore } from 'react'
import { getAllOfficeCharacters, displayNameFromSlug } from './theme'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RPCharacter {
  /** Unique role key used as the agent.role + AGENT_CONFIGS key (e.g. "rp-0") */
  roleKey: string
  /** Office character sprite slug, e.g. "michael-scott" */
  slug: string
  /** Display name shown in chat + speech bubbles */
  name: string
  /** The role the user wants this character to play (free text) */
  persona: string
  /** Accent colour (chat avatar border, sprite glow) */
  color: string
}

export type SceneId = 'office-day' | 'office-night' | 'lounge' | 'cafe' | 'sunset' | 'studio'

export interface RPSession {
  active: boolean
  topic: string
  backstory: string
  humanName: string
  scene: SceneId
  cast: RPCharacter[]
}

export interface RosterEntry { slug: string; name: string }

// ---------------------------------------------------------------------------
// Roster + palette
// ---------------------------------------------------------------------------

/** All castable characters from this repo, with friendly display names. */
export const ROSTER: RosterEntry[] = getAllOfficeCharacters().map(slug => ({
  slug,
  name: displayNameFromSlug(slug),
}))

/** Accent palette dealt to cast members in order — AISole sunset/neon vibe. */
export const PALETTE = [
  '#ff5f9e', '#ff8a5c', '#ffd166', '#7ee787',
  '#5ec8ff', '#b14aed', '#ff6b6b', '#42d6c3',
]

export function colorForIndex(i: number): string {
  return PALETTE[i % PALETTE.length]
}

/** Scenes the user can stage the conversation in. */
export const SCENES: { id: SceneId; label: string; emoji: string; night: boolean }[] = [
  { id: 'office-day', label: 'ออฟฟิศ (กลางวัน)', emoji: '🏢', night: false },
  { id: 'office-night', label: 'ออฟฟิศ (กลางคืน)', emoji: '🌙', night: true },
  { id: 'lounge', label: 'เลานจ์', emoji: '🛋️', night: false },
  { id: 'cafe', label: 'คาเฟ่', emoji: '☕', night: false },
  { id: 'sunset', label: 'พระอาทิตย์ตก', emoji: '🌇', night: true },
  { id: 'studio', label: 'สตูดิโอ', emoji: '🎬', night: true },
]

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'aisole_session'

function emptySession(): RPSession {
  return { active: false, topic: '', backstory: '', humanName: '', scene: 'office-day', cast: [] }
}

let session: RPSession = loadInitial()
const listeners = new Set<() => void>()

function loadInitial(): RPSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as RPSession
      // Never auto-resume as "active" on reload — require an explicit Start.
      return { ...emptySession(), ...parsed, active: false }
    }
  } catch {}
  return emptySession()
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)) } catch {}
}

function emit() { listeners.forEach(l => l()) }

export function getSession(): RPSession { return session }

export function startSession(next: Omit<RPSession, 'active'>) {
  session = { ...next, active: true }
  persist()
  emit()
}

export function stopSession() {
  session = { ...session, active: false }
  persist()
  emit()
}

export function useRPSession(): RPSession {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => session,
    () => emptySession(),
  )
}

// ---------------------------------------------------------------------------
// Human interjection queue — the audience typing into the chat
// ---------------------------------------------------------------------------

let pendingHuman: string | null = null
export function pushHuman(text: string) { pendingHuman = text }
export function consumeHuman(): string | null {
  const v = pendingHuman
  pendingHuman = null
  return v
}

// ---------------------------------------------------------------------------
// Director — picks who speaks and what they say
// ---------------------------------------------------------------------------

export interface TurnContext {
  topic: string
  backstory: string
  humanName: string
  turn: number
  history: { name: string; text: string }[]
  humanPending: string | null
}

// AISole "brain" edge function — relays a turn to the LLM provider pool and
// hides the API keys server-side. Override per-deploy with VITE_BRAIN_URL.
const DEFAULT_BRAIN_URL = 'https://heqosjeyqzolijqvblax.supabase.co/functions/v1/brain'
const BRAIN_URL: string = (import.meta as any).env?.VITE_BRAIN_URL || DEFAULT_BRAIN_URL

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

/** Short, readable fragment of a persona for weaving into a line. */
function personaTag(persona: string): string {
  const p = (persona || '').trim()
  if (!p) return 'ตัวเอง'
  return p.length > 28 ? p.slice(0, 28).trim() + '…' : p
}

const OPINIONS = [
  'น่าสนใจกว่าที่คิดนะ',
  'ต้องลองดูก่อนถึงจะรู้',
  'ผมไม่ค่อยเห็นด้วยเท่าไหร่',
  'มันขึ้นอยู่กับมุมมองล้วนๆ',
  'จริงๆ แล้วมันสนุกดีออก',
  'เรื่องนี้ต้องคิดให้รอบคอบ',
  'เป็นไปได้ทั้งนั้นแหละ',
  'ผมว่ามันลึกกว่าที่เห็น',
  'อย่าเพิ่งด่วนสรุปสิ',
  'ลองมองอีกมุมก็ดีนะ',
]

const TANGENTS = [
  'พูดถึงเรื่องนี้แล้วนึกถึงตอนเด็กๆ เลย',
  'มันโยงไปถึงเรื่องชีวิตประจำวันได้นะ',
  'จริงๆ เรื่องนี้กับเรื่องเงินก็เกี่ยวกันอยู่',
  'แอบนอกเรื่องนิดนึง แต่มันต่อกันได้',
]

function clean(s: string): string {
  // Strip stray JSON/system noise the way AISole's filter.js does, lightly.
  let t = s.replace(/[{}\[\]]/g, '').replace(/\s+/g, ' ').trim()
  // Models sometimes wrap the whole line in quotes — peel one pair off.
  t = t.replace(/^["'“”](.*)["'“”]$/, '$1').trim()
  return t.slice(0, 220)
}

/** Build a chat-style prompt for the optional remote brain. */
function buildBrainBody(speaker: RPCharacter, cast: RPCharacter[], ctx: TurnContext) {
  const roster = cast.map(c => `${c.name} (${c.persona || 'ไม่ระบุบทบาท'})`).join(', ')
  const system =
    `คุณกำลังสวมบทเป็น "${speaker.name}" บทบาท: ${speaker.persona || 'เป็นตัวของตัวเอง'}.\n` +
    `วงสนทนา: ${roster}.\n` +
    (ctx.backstory ? `ปูมหลัง: ${ctx.backstory}\n` : '') +
    `หัวข้อ: ${ctx.topic}.\n` +
    `พูดสั้นๆ 1-2 ประโยค ภาษาพูด เป็นธรรมชาติ อยู่ในบทบาทเสมอ ` +
    `ถ้าจะพาดพิงคนในวงให้ใช้ @ชื่อเต็ม.`
  const history = ctx.history.map(h => ({ role: 'user', content: `${h.name}: ${h.text}` }))
  if (ctx.humanPending) {
    history.push({ role: 'user', content: `${ctx.humanName || 'ผู้ชม'}: ${ctx.humanPending}` })
  }
  return { messages: [{ role: 'system', content: system }, ...history] }
}

/** Local, offline persona line generator. */
function localLine(speaker: RPCharacter, cast: RPCharacter[], ctx: TurnContext): string {
  const tag = personaTag(speaker.persona)
  const topic = ctx.topic || 'เรื่องนี้'
  const others = cast.filter(c => c.roleKey !== speaker.roleKey)
  const mention = others.length ? `@${pick(others).name}` : ''

  // Respond directly to an audience interjection if there is one.
  if (ctx.humanPending) {
    const who = ctx.humanName ? `@${ctx.humanName}` : 'คนที่นั่งฟัง'
    return clean(pick([
      `${who} ถามได้ดีนะ — ในฐานะ${tag} ${pick(OPINIONS)}`,
      `${who} เดี๋ยวผมตอบให้ ${pick(OPINIONS)} โดยเฉพาะเรื่อง ${ctx.humanPending}`,
      `อืม ${who} พูดมาแบบนี้ ${tag}อย่างผมว่า ${pick(OPINIONS)}`,
    ]))
  }

  // Phase-based topic adherence, like AISole's director.js.
  if (ctx.turn < 10) {
    return clean(pick([
      `เรื่อง${topic}เนี่ย ในฐานะ${tag} ผมว่า${pick(OPINIONS)}`,
      `${topic}เหรอ? ${tag}อย่างผมมองว่า${pick(OPINIONS)}`,
      mention ? `${mention} พูดมาก็มีเหตุผล แต่ถ้าเป็น${tag} ผมจะ${pick(OPINIONS)}` :
        `ถ้าให้พูดตรงๆ เรื่อง${topic} ${pick(OPINIONS)}`,
    ]))
  }
  if (ctx.turn < 22) {
    return clean(pick([
      `${pick(TANGENTS)} แต่ยังเกี่ยวกับ${topic}อยู่นะ`,
      mention ? `${mention} เนี่ย ผมว่า${pick(OPINIONS)} นะในมุม${tag}` :
        `ในมุม${tag} ${pick(OPINIONS)}`,
      `${pick(OPINIONS)} ยิ่งคุยยิ่งสนุก`,
    ]))
  }
  return clean(pick([
    `เอาจริงๆ ${pick(OPINIONS)} 555`,
    mention ? `${mention} เห็นด้วยกับที่ว่ามานะ ${pick(OPINIONS)}` : `${pick(OPINIONS)}`,
    `${tag}อย่างผมขอปิดท้ายว่า ${pick(OPINIONS)}`,
  ]))
}

/**
 * Produce the next line for `speaker`. Tries the remote brain first (if
 * configured), then falls back to the offline persona engine so the show
 * never stalls — matching AISole's "never let an error reach the user" rule.
 */
export async function generateLine(
  speaker: RPCharacter,
  cast: RPCharacter[],
  ctx: TurnContext,
): Promise<string> {
  if (BRAIN_URL) {
    try {
      const res = await fetch(BRAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBrainBody(speaker, cast, ctx)),
      })
      const data = await res.json()
      const txt = (data.text ?? data.reply ?? data.content ?? data.message ?? '').toString().trim()
      if (txt) return clean(txt)
    } catch {
      /* fall through to local engine */
    }
  }
  return localLine(speaker, cast, ctx)
}
