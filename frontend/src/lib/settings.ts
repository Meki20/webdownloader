import type { Theme } from '../types'

const KEY = 'webdownloader-settings'

export type DefaultFormats = {
  video: string
  audio: string
  image: string
}

export type UserSettings = {
  defaultFormats: DefaultFormats
  defaultQualityIndex: number
  namingTemplate: string
  downloadConcurrency: number
  theme?: Theme
}

const defaults: UserSettings = {
  defaultFormats: { video: 'mp4', audio: 'mp3', image: 'png' },
  defaultQualityIndex: 0,
  namingTemplate: '%name%',
  downloadConcurrency: 3,
  theme: 'system',
}

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<UserSettings>
    return {
      defaultFormats: { ...defaults.defaultFormats, ...parsed.defaultFormats },
      defaultQualityIndex: typeof parsed.defaultQualityIndex === 'number' ? parsed.defaultQualityIndex : defaults.defaultQualityIndex,
      namingTemplate: typeof parsed.namingTemplate === 'string' && parsed.namingTemplate.trim() ? parsed.namingTemplate.trim() : defaults.namingTemplate,
      downloadConcurrency: typeof parsed.downloadConcurrency === 'number' && parsed.downloadConcurrency >= 1 ? Math.min(parsed.downloadConcurrency, 6) : defaults.downloadConcurrency,
    }
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(s: Partial<UserSettings>): UserSettings {
  const next = { ...loadSettings(), ...s }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    //
  }
  return next
}

/** Apply naming template: %name%, %extension%, %date% (date when file was downloaded). */
export function applyNamingTemplate(
  template: string,
  name: string,
  extension: string,
  date: Date = new Date()
): string {
  const dateStr = date.toISOString().slice(0, 10)
  return template
    .replace(/%name%/gi, name || 'download')
    .replace(/%extension%/gi, extension || '')
    .replace(/%date%/gi, dateStr)
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 180) || 'download'
}
