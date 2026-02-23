import type { Theme } from '../types'

const STORAGE_KEY = 'webdownloader-theme'

export function getStoredTheme(): Theme {
  try {
    const t = localStorage.getItem(STORAGE_KEY) as Theme | null
    if (t === 'light' || t === 'dark' || t === 'system') return t
  } catch {
    //
  }
  return 'system'
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    //
  }
}

function getEffectiveTheme(): 'light' | 'dark' {
  const stored = getStoredTheme()
  if (stored === 'light') return 'light'
  if (stored === 'dark') return 'dark'
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

export function applyTheme(theme: Theme): void {
  setStoredTheme(theme)
  const effective = theme === 'system' ? (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  document.documentElement.setAttribute('data-theme', effective)
}

export function initTheme(): void {
  const effective = getEffectiveTheme()
  document.documentElement.setAttribute('data-theme', effective)
}
