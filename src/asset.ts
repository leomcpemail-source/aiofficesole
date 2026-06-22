/**
 * asset.ts — resolve a public asset path against the app's base URL.
 *
 * Sprites/rooms are referenced with absolute paths like "/sprites/x.png".
 * When the app is hosted under a sub-path (e.g. GitHub Pages at
 * "/aiofficesole/"), those must be prefixed with import.meta.env.BASE_URL.
 * In dev (base "/") this is a no-op.
 */
export function asset(p: string): string {
  if (!p) return p
  if (/^(https?:|data:|blob:)/.test(p)) return p // already absolute/external
  let base = ((import.meta as any).env?.BASE_URL as string) || '/'
  if (!base.endsWith('/')) base += '/'
  return base + p.replace(/^\//, '')
}
