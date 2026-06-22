// Thai text-to-speech via the browser Web Speech API — free, on-device, per
// character (pitch/rate vary by gender + seat so voices stay distinct).

let enabled = false
let voices: SpeechSynthesisVoice[] = []

function hasTTS(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}
function loadVoices() {
  if (hasTTS()) voices = window.speechSynthesis.getVoices()
}
if (hasTTS()) {
  loadVoices()
  window.speechSynthesis.onvoiceschanged = loadVoices
  try { enabled = localStorage.getItem('aisole_tts') === '1' } catch { /* ignore */ }
}

export function ttsSupported(): boolean { return hasTTS() }
export function isTtsEnabled(): boolean { return enabled }
export function setTtsEnabled(v: boolean) {
  enabled = v
  try { localStorage.setItem('aisole_tts', v ? '1' : '0') } catch { /* ignore */ }
  if (!v && hasTTS()) window.speechSynthesis.cancel()
}

function thaiVoice(): SpeechSynthesisVoice | undefined {
  return voices.find(v => /^th([-_]|$)/i.test(v.lang)) ?? voices.find(v => /thai/i.test(v.name))
}

export function speak(text: string, opts: { gender?: 'male' | 'female'; index?: number } = {}) {
  if (!enabled || !hasTTS() || !text) return
  const u = new SpeechSynthesisUtterance(text.replace(/@/g, '').slice(0, 240))
  const tv = thaiVoice()
  if (tv) u.voice = tv
  u.lang = tv?.lang ?? 'th-TH'
  const i = opts.index ?? 0
  // Distinct voice per character: base pitch by gender, small per-seat offset.
  const base = opts.gender === 'female' ? 1.3 : 0.8
  u.pitch = Math.max(0, Math.min(2, base + ((i % 3) - 1) * 0.12))
  u.rate = 1 + ((i % 2) ? 0.06 : -0.04)
  try { window.speechSynthesis.speak(u) } catch { /* ignore */ }
}
