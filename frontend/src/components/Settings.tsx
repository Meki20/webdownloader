import { useState } from 'react'
import type { Theme } from '../types'
import { applyTheme } from '../lib/theme'
import type { UserSettings, DefaultFormats } from '../lib/settings'
import { OUTPUT_FORMATS } from '../constants'

const API = '/api'
type UpdateCheckResult =
  | { upToDate: true; currentSha?: string }
  | { upToDate: false; behind: number; currentSha?: string; latestSha?: string }
  | { error: string; unavailable?: boolean }

type Props = {
  settings: UserSettings
  theme: Theme
  onThemeChange: (t: Theme) => void
  onClearHistory: () => void
  onSettingsChange: (s: UserSettings) => void
}

const styles: Record<string, React.CSSProperties> = {
  section: { maxWidth: 720, margin: '0 auto' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 24,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 28,
    color: 'var(--text)',
    background: 'var(--page-title-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  block: {
    marginBottom: 24,
    padding: '22px 24px',
    background: 'var(--card-bg)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--card-shadow)',
  },
  blockInGrid: {
    padding: '22px 24px',
    background: 'var(--card-bg)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--card-shadow)',
  },
  blockFullWidth: {
    gridColumn: '1 / -1',
  },
  blockTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text)',
    marginBottom: 16,
    letterSpacing: '0.02em',
  },
  row: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 },
  rowLast: { marginBottom: 0 },
  label: { fontSize: 15, color: 'var(--text-muted)', minWidth: 120 },
  select: {
    padding: '12px 14px',
    paddingRight: 36,
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: 15,
    fontFamily: 'inherit',
  },
  input: {
    flex: 1,
    padding: '12px 14px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: 15,
    fontFamily: 'var(--font-mono)',
  },
  hint: { fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 10, marginBottom: 4 },
  btn: {
    padding: '12px 20px',
    background: 'var(--bg-elevated)',
    color: 'var(--text)',
    borderRadius: 'var(--radius)',
    fontSize: 15,
    fontWeight: 500,
  },
  btnDanger: {
    padding: '12px 20px',
    background: 'transparent',
    color: 'var(--danger)',
    borderRadius: 'var(--radius)',
    fontSize: 15,
  },
  about: {
    marginTop: 32,
    padding: '22px 24px',
    background: 'var(--card-bg)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    fontSize: 14,
    color: 'var(--text-muted)',
    lineHeight: 1.6,
  },
}

export function Settings({ settings, theme, onThemeChange, onClearHistory, onSettingsChange }: Props) {
  const [checkStatus, setCheckStatus] = useState<'idle' | 'checking'>('idle')
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null)
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'done' | 'error'>('idle')
  const [installError, setInstallError] = useState<string | null>(null)

  const update = (patch: Partial<UserSettings>) => {
    const next = { ...settings, ...patch }
    onSettingsChange(next)
  }

  const setDefaultFormats = (type: keyof DefaultFormats, value: string) => {
    update({ defaultFormats: { ...settings.defaultFormats, [type]: value } })
  }

  async function handleCheckUpdates() {
    setCheckStatus('checking')
    setCheckResult(null)
    try {
      const r = await fetch(`${API}/updates/check`)
      const data = await r.json().catch(() => ({}))
      if (r.status === 404) {
        setCheckResult({ error: 'Update check not available on this server.', unavailable: true })
      } else if (!r.ok) {
        setCheckResult({ error: data.detail || r.statusText || 'Check failed' })
      } else {
        setCheckResult(data as UpdateCheckResult)
      }
    } catch (e) {
      setCheckResult({ error: e instanceof Error ? e.message : 'Check failed' })
    } finally {
      setCheckStatus('idle')
    }
  }

  async function handleInstallUpdate() {
    setInstallStatus('installing')
    setInstallError(null)
    try {
      const r = await fetch(`${API}/updates/install`, { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setInstallError(data.detail || r.statusText || 'Install failed')
        setInstallStatus('error')
      } else {
        setInstallStatus('done')
        setCheckResult(null)
      }
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : 'Install failed')
      setInstallStatus('error')
    }
  }

  return (
    <section style={styles.section} className="settings-section">
      <h2 style={styles.pageTitle}>Settings</h2>

      <div style={styles.block}>
        <div style={styles.blockTitle}>Default formats</div>
        <p style={styles.hint}>Used when you haven’t changed the format for a file.</p>
        {(['video', 'audio', 'image'] as const).map((type, i) => (
          <div key={type} style={i < 2 ? styles.row : { ...styles.row, ...styles.rowLast }}>
            <label style={styles.label}>{type}</label>
            <select
              style={styles.select}
              value={settings.defaultFormats[type]}
              onChange={(e) => setDefaultFormats(type, e.target.value)}
              aria-label={`Default ${type} format`}
            >
              {OUTPUT_FORMATS[type]?.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div style={styles.grid} className="settings-grid">
      <div style={styles.blockInGrid}>
        <div style={styles.blockTitle}>Appearance</div>
        <div style={styles.row}>
          <label htmlFor="theme" style={styles.label}>Theme</label>
          <select
            id="theme"
            style={styles.select}
            value={theme}
            onChange={(e) => {
              const v = e.target.value as Theme
              onThemeChange(v)
              applyTheme(v)
            }}
            aria-label="App theme"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      <div style={styles.blockInGrid}>
        <div style={styles.blockTitle}>History</div>
        <button type="button" style={styles.btnDanger} onClick={onClearHistory}>
          Clear all history
        </button>
      </div>

      <div style={styles.blockInGrid}>
        <div style={styles.blockTitle}>Default quality</div>
        <p style={styles.hint}>When multiple qualities exist, this option is pre-selected (0 = best/first).</p>
        <div style={styles.row}>
          <label style={styles.label}>Quality index</label>
          <select
            style={styles.select}
            value={settings.defaultQualityIndex}
            onChange={(e) => update({ defaultQualityIndex: Number(e.target.value) })}
            aria-label="Default quality index"
          >
            {[0, 1, 2, 3].map((i) => (
              <option key={i} value={i}>{i === 0 ? 'Best (first)' : `Option ${i + 1}`}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.blockInGrid}>
        <div style={styles.blockTitle}>File naming</div>
        <p style={styles.hint}>
          File name when you download (no extension). Use <code>%name%</code> for the original title, <code>%extension%</code> for the original extension, and <code>%date%</code> for the download date.
        </p>
        <div style={styles.row}>
          <input
            type="text"
            style={styles.input}
            value={settings.namingTemplate}
            onChange={(e) => update({ namingTemplate: e.target.value })}
            placeholder="%name%"
            aria-label="Naming template"
          />
        </div>
      </div>

      <div style={{ ...styles.blockInGrid, ...styles.blockFullWidth }}>
        <div style={styles.blockTitle}>Downloads</div>
        <p style={styles.hint}>How many files to download at the same time when using the queue.</p>
        <div style={styles.row}>
          <label style={styles.label}>Concurrency</label>
          <select
            style={styles.select}
            value={settings.downloadConcurrency}
            onChange={(e) => update({ downloadConcurrency: Number(e.target.value) })}
            aria-label="Download concurrency"
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
      </div>

      <div style={{ ...styles.block, marginTop: 24 }}>
        <div style={styles.blockTitle}>Updates</div>
        <p style={styles.hint}>Install the latest GitHub release and restart the app. Only applies when running from a git clone (e.g. Ubuntu deploy).</p>
        <div style={{ ...styles.row, flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            style={styles.btn}
            onClick={handleCheckUpdates}
            disabled={checkStatus === 'checking'}
          >
            {checkStatus === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {checkResult && 'error' in checkResult && (
            <span style={{ color: checkResult.unavailable ? 'var(--text-muted)' : 'var(--danger)', fontSize: 14 }}>
              {checkResult.error}
            </span>
          )}
          {checkResult && 'upToDate' in checkResult && checkResult.upToDate && (
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>You're up to date.</span>
          )}
          {checkResult && 'upToDate' in checkResult && !checkResult.upToDate && 'behind' in checkResult && (
            <>
              <span style={{ color: 'var(--text)', fontSize: 14 }}>
                {checkResult.behind} update{checkResult.behind !== 1 ? 's' : ''} available.
              </span>
              <button
                type="button"
                style={{ ...styles.btn, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                onClick={handleInstallUpdate}
                disabled={installStatus === 'installing'}
              >
                {installStatus === 'installing' ? 'Updating…' : 'Install update'}
              </button>
            </>
          )}
        </div>
        {installStatus === 'done' && (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 14, color: 'var(--success, var(--text))' }}>
            Update complete. Reload the page to use the new version.
          </p>
        )}
        {installStatus === 'error' && installError && (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 14, color: 'var(--danger)' }}>
            {installError}
          </p>
        )}
      </div>

      <div style={styles.about}>
        <p style={{ margin: 0 }}>
          WebDownloader finds and downloads media from any URL using yt-dlp and a fallback crawler. For production, set <code>CORS_ORIGINS</code>; optionally enable rate limiting with <code>RATE_LIMIT_PER_MINUTE</code> and <code>API_KEY</code>.
        </p>
      </div>
    </section>
  )
}
