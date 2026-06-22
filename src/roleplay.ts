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
import type { DayPhase } from './daylight'

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
  /** Stable identity for long-term memory (custom char id, or "slug:<slug>") */
  memId: string
}

// Scenes follow the viewer's local time of day (their timezone) — no manual pick.
export type SceneId = 'morning' | 'day' | 'evening' | 'night'

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

// Thai nicknames for the sprite roster (no foreign names). Roughly gender-matched.
const TH_NAMES: Record<string, string> = {
  'andy-bernard': 'ก้อง', 'angela-martin': 'ส้ม', 'bob-vance': 'ต้น', 'carol-stills': 'ฟ้า',
  'creed-bratton': 'ลุงเอก', 'darryl-philbin': 'บอย', 'david-wallace': 'กล้า', 'dwight-schrute': 'ดิว',
  'erin-hannon': 'มิ้น', 'gabe-lewis': 'แบงค์', 'holly-flax': 'แนน', 'jan-levinson': 'อ้อม',
  'jim-halpert': 'ปอนด์', 'karen-filippelli': 'มุก', 'kelly-kapoor': 'แพรว', 'kevin-malone': 'บูม',
  'meredith-palmer': 'ใบเฟิร์น', 'michael-scott': 'ตูน', 'nellie-bertram': 'ดาว', 'oscar-martinez': 'นัท',
  'pam-beesly': 'นก', 'phyllis-vance': 'หนิง', 'robert-california': 'เสือ', 'roy-anderson': 'โต้ง',
  'ryan-howard': 'ปิง', 'stanley-hudson': 'ลุงสมาน', 'toby-flenderson': 'ตี๋',
}

/** All castable characters from this repo, with Thai display names. */
export const ROSTER: RosterEntry[] = getAllOfficeCharacters().map(slug => ({
  slug,
  name: TH_NAMES[slug] ?? displayNameFromSlug(slug),
}))

/** Accent palette dealt to cast members in order — AISole sunset/neon vibe. */
export const PALETTE = [
  '#ff5f9e', '#ff8a5c', '#ffd166', '#7ee787',
  '#5ec8ff', '#b14aed', '#ff6b6b', '#42d6c3',
]

export function colorForIndex(i: number): string {
  return PALETTE[i % PALETTE.length]
}

/** Time-of-day scenes mapped to the office lighting phases. */
export const SCENES: { id: SceneId; label: string; emoji: string; phase: DayPhase; night: boolean }[] = [
  { id: 'morning', label: 'เช้า', emoji: '🌅', phase: 'dawn', night: false },
  { id: 'day', label: 'กลางวัน', emoji: '☀️', phase: 'afternoon', night: false },
  { id: 'evening', label: 'เย็น', emoji: '🌇', phase: 'dusk', night: false },
  { id: 'night', label: 'กลางคืน', emoji: '🌙', phase: 'night', night: true },
]

/** Pick the scene matching the viewer's current local time (their timezone). */
export function autoScene(): SceneId {
  const h = new Date().getHours()
  if (h >= 5 && h < 11) return 'morning'
  if (h >= 11 && h < 16) return 'day'
  if (h >= 16 && h < 19) return 'evening'
  return 'night'
}

/** Lighting phase for a scene (drives the day/night image + tint overlay). */
export function scenePhase(id: SceneId): DayPhase {
  return SCENES.find(s => s.id === id)?.phase ?? 'afternoon'
}

// ---------------------------------------------------------------------------
// Custom characters — user-created cast saved in localStorage
// ---------------------------------------------------------------------------

export interface CustomCharacter {
  id: string
  name: string
  slug: string      // which roster sprite represents them
  persona: string
  color: string
}

const CUSTOM_KEY = 'aisole_custom_chars'

export function getCustomCharacters(): CustomCharacter[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    return raw ? (JSON.parse(raw) as CustomCharacter[]) : []
  } catch {
    return []
  }
}

export function saveCustomCharacter(c: CustomCharacter): CustomCharacter[] {
  const list = getCustomCharacters()
  const i = list.findIndex(x => x.id === c.id)
  if (i >= 0) list[i] = c
  else list.push(c)
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)) } catch {}
  return list
}

export function deleteCustomCharacter(id: string): CustomCharacter[] {
  const list = getCustomCharacters().filter(x => x.id !== id)
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)) } catch {}
  return list
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'aisole_session'

function emptySession(): RPSession {
  return { active: false, topic: '', backstory: '', humanName: '', scene: autoScene(), cast: [] }
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
// Stable per-browser client id (used to scope long-term memory in Supabase)
// ---------------------------------------------------------------------------

export function getClientId(): string {
  try {
    let id = localStorage.getItem('aisole_client_id')
    if (!id) {
      id = 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('aisole_client_id', id)
    }
    return id
  } catch {
    return 'anon'
  }
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
  /** Summaries of past conversations recalled from Supabase (shared memory) */
  memories?: string[]
}

// ---------------------------------------------------------------------------
// Long-term memory — recall past episodes / store the current one (via brain)
// ---------------------------------------------------------------------------

export interface MemoryEpisode { summary: string; ids: string[] }

/**
 * Fetch past episodes that involved any of these character identities (memIds).
 * Returns each episode's summary + the ids that were present, so the caller can
 * build per-character memory (a character recalls only what IT experienced).
 */
export async function recallMemories(ids: string[]): Promise<MemoryEpisode[]> {
  try {
    const res = await fetch(BRAIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recall', clientId: getClientId(), slugs: ids }),
    })
    const data = await res.json()
    const mems = Array.isArray(data?.memories) ? data.memories : []
    return mems
      .filter((m: any) => m.summary)
      .map((m: any) => ({ summary: m.summary as string, ids: Array.isArray(m.slugs) ? m.slugs : [] }))
  } catch {
    return []
  }
}

/** Group recalled episodes into per-character memory (memId -> its summaries). */
export function memoriesByCharacter(episodes: MemoryEpisode[], castIds: string[]): Record<string, string[]> {
  const sanitize = (s: string) => s.replace(/[^a-z0-9:_-]/gi, '')
  const map: Record<string, string[]> = {}
  for (const id of castIds) {
    const sid = sanitize(id)
    map[id] = episodes.filter(e => e.ids.some(x => sanitize(x) === sid)).map(e => e.summary)
  }
  return map
}

/** Dashboard stats from the brain (admin key required). days=0 means all-time. */
export async function fetchStats(key: string, days: number): Promise<any> {
  const res = await fetch(BRAIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'stats', key, days }),
  })
  return res.json()
}

/** Summarize + persist the current transcript so the cast remembers it later. */
export async function rememberEpisode(
  slugs: string[],
  topic: string,
  transcript: { name: string; text: string }[],
): Promise<void> {
  if (transcript.length < 3) return
  try {
    await fetch(BRAIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remember', clientId: getClientId(), slugs, topic, transcript }),
    })
  } catch {
    /* best-effort */
  }
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

/** Build a chat-style prompt for the remote brain. */
function buildBrainBody(speaker: RPCharacter, cast: RPCharacter[], ctx: TurnContext) {
  const roster = cast.map(c => `${c.name}${c.persona ? ` (${c.persona})` : ''}`).join(', ')
  const memBlock = ctx.memories && ctx.memories.length
    ? `สิ่งที่ "${speaker.name}" จำได้จากอดีต (เป็นพื้นเพ/ประสบการณ์ของตัวเอง ใช้ให้เข้ากับนิสัย ` +
      `ไม่ต้องพูดถึงตรงๆ และห้ามดึงให้วงไปคุยเรื่องเก่าถ้าไม่เกี่ยวกับหัวข้อ): \n- ${ctx.memories.join('\n- ')}\n`
    : ''
  const phase = ctx.turn < 8
    ? 'ช่วงนี้เกาะหัวข้อหลักไว้'
    : ctx.turn < 20 ? 'ช่วงนี้แตกประเด็นที่เกี่ยวข้องได้' : 'ช่วงนี้ต่อยอดได้อิสระ แต่ให้ต่อจากบทสนทนา'
  const system =
    `คุณกำลังสวมบทเป็น "${speaker.name}" บทบาท: ${speaker.persona || 'เป็นตัวของตัวเอง'}\n` +
    `ผู้ร่วมวง: ${roster}\n` +
    (ctx.backstory ? `ปูมหลัง: ${ctx.backstory}\n` : '') +
    memBlock +
    `หัวข้อ: ${ctx.topic}\n` +
    `กติกา: พูดในฐานะ "${speaker.name}" เท่านั้น 1-2 ประโยคสั้นๆ ภาษาพูดเป็นธรรมชาติ อยู่ในบทบาทเสมอ ` +
    `ตอบรับและต่อยอดจากสิ่งที่คนล่าสุดพูด ห้ามพูดซ้ำของเดิม ห้ามเล่นเป็นคนอื่น ` +
    `ถ้าพาดพิงใครให้ใช้ @ชื่อเต็มตรงตามรายชื่อ ${phase} ` +
    `ตอบเฉพาะบทพูด ไม่ต้องมีชื่อนำหน้าหรือเครื่องหมายคำพูด`
  const history = ctx.history.map((h, i) => ({ role: 'user' as const, content: `[${i + 1}] ${h.name}: ${h.text}` }))
  if (ctx.humanPending) {
    history.push({ role: 'user' as const, content: `[ผู้ชม] ${ctx.humanName || 'ผู้ชม'}: ${ctx.humanPending}` })
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
