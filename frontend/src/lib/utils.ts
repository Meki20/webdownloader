const TRUNCATE_MAX = 50

export function truncateLink(url: string, maxLen: number = TRUNCATE_MAX): string {
  if (typeof url !== 'string') return ''
  if (url.length <= maxLen) return url
  const head = 25
  const tail = maxLen - head - 1
  return url.slice(0, head) + '…' + url.slice(-tail)
}
