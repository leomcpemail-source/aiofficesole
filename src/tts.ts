// Thai text-to-speech via the browser Web Speech API — free, on-device, per
// character (pitch/rate vary by gender + seat so voices stay distinct).

let enabled = false
let voices: SpeechSynthesisVoice[] = []
let warmed = false

function hasTTS(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}
function loadVoices() {
  if (hasTTS()) voices = window.speechSynthesis.getVoices() || []
}
if (hasTTS()) {
  loadVoices()
  try { window.speechSynthesis.onvoiceschanged = loadVoices } catch { /* ignore */ }
  try { enabled = localStorage.getItem('aisole_tts') === '1' } catch { /* ignore */ }
}

export function ttsSupported(): boolean { return hasTTS() }
export function isTtsEnabled(): boolean { return enabled }

// Unlock the speech engine inside a user gesture (required by iOS Safari and
// some mobile Chrome before any async speak() will produce sound).
function warmUp() {
  if (!hasTTS() || warmed) return
  warmed = true
  try {
    window.speechSynthesis.resume()
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.speak(u)
  } catch { /* ignore */ }
}

export function setTtsEnabled(v: boolean) {
  enabled = v
  try { localStorage.setItem('aisole_tts', v ? '1' : '0') } catch { /* ignore */ }
  if (v) { loadVoices(); warmUp() } // must run within the click gesture
  else if (hasTTS()) window.speechSynthesis.cancel()
}

function thaiVoice(): SpeechSynthesisVoice | undefined {
  return voices.find(v => /^th([-_]|$)/i.test(v.lang)) ?? voices.find(v => /thai/i.test(v.name))
}

export function speak(text: string, opts: { gender?: 'male' | 'female'; index?: number } = {}) {
  if (!enabled || !hasTTS() || !text) return
  if (voices.length === 0) loadVoices()
  try { window.speechSynthesis.resume() } catch { /* ignore */ }
  const u = new SpeechSynthesisUtterance(text.replace(/@/g, '').slice(0, 240))
  const tv = thaiVoice()
  // Only force a language when we actually have that voice — otherwise setting
  // lang to th-TH with no Thai voice makes some browsers stay silent.
  if (tv) { u.voice = tv; u.lang = tv.lang }
  const i = opts.index ?? 0
  const base = opts.gender === 'female' ? 1.3 : 0.8
  u.pitch = Math.max(0, Math.min(2, base + ((i % 3) - 1) * 0.12))
  u.rate = 1 + ((i % 2) ? 0.06 : -0.04)
  try { window.speechSynthesis.speak(u) } catch { /* ignore */ }
}
