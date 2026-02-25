const TRUNCATE_MAX = 50

/** UUID v4; uses crypto.randomUUID() when available, else crypto.getRandomValues() fallback. */
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function truncateLink(url: string, maxLen: number = TRUNCATE_MAX): string {
  if (typeof url !== 'string') return ''
  if (url.length <= maxLen) return url
  const head = 25
  const tail = maxLen - head - 1
  return url.slice(0, head) + '…' + url.slice(-tail)
}

/** True if URL is a YouTube playlist (has list= or /playlist?list=). */
export function isYoutubePlaylistUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  const lower = url.trim().toLowerCase()
  if (!lower.includes('youtube.com') && !lower.includes('youtu.be')) return false
  return lower.includes('list=')
}
