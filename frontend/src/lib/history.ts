import type { HistoryEntry } from '../types'

const STORAGE_KEY = 'webdownloader-history'
const MAX_ENTRIES = 200

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e): e is HistoryEntry => e && typeof e.id === 'string' && typeof e.url === 'string')
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // ignore
  }
}

export function addToHistory(entry: Omit<HistoryEntry, 'addedAt'>): HistoryEntry[] {
  const list = loadHistory()
  const existing = list.findIndex((e) => e.url === entry.url)
  const newEntry: HistoryEntry = { ...entry, addedAt: Date.now() }
  let next: HistoryEntry[]
  if (existing >= 0) {
    next = [...list]
    next[existing] = { ...newEntry, addedAt: list[existing].addedAt, title: list[existing].title || entry.title }
  } else {
    next = [newEntry, ...list]
  }
  saveHistory(next)
  return next
}

export function updateHistoryEntry(id: string, patch: Partial<Pick<HistoryEntry, 'title' | 'lastCrawlId' | 'lastFileCount' | 'lastStatus'>>): HistoryEntry[] {
  const list = loadHistory()
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return list
  const next = [...list]
  next[idx] = { ...next[idx], ...patch }
  saveHistory(next)
  return next
}

export function removeFromHistory(id: string): HistoryEntry[] {
  const list = loadHistory().filter((e) => e.id !== id)
  saveHistory(list)
  return list
}

export function reorderHistory(entries: HistoryEntry[]): void {
  saveHistory(entries)
}
