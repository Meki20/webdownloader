import { useState } from 'react'
import type { HistoryEntry } from '../types'
import { truncateLink } from '../lib/utils'

type Props = {
  entries: HistoryEntry[]
  onUpdateTitle: (id: string, title: string) => void
  onDelete: (id: string) => void
  onReCrawl: (url: string) => void
}

const styles: Record<string, React.CSSProperties> = {
  section: { maxWidth: 720, margin: '0 auto' },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 20,
    color: 'var(--text)',
    background: 'var(--page-title-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  empty: { color: 'var(--text-muted)', marginTop: 24, fontSize: 14 },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 0',
    borderBottom: '1px solid var(--border)',
  },
  main: { flex: 1, minWidth: 0, overflow: 'hidden' },
  linkTitle: {
    fontWeight: 500,
    fontSize: 14,
    color: 'var(--text)',
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  url: {
    display: 'block',
    fontSize: 12,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginTop: 2,
    minWidth: 0,
  },
  meta: {
    fontSize: 12,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  actions: { display: 'flex', gap: 8, flexShrink: 0 },
  btn: {
    padding: '8px 14px',
    background: 'var(--bg-elevated)',
    color: 'var(--text)',
    borderRadius: 'var(--radius)',
    fontSize: 13,
    fontWeight: 500,
  },
  btnDanger: {
    padding: '8px 14px',
    background: 'transparent',
    color: 'var(--danger)',
    borderRadius: 'var(--radius)',
    fontSize: 13,
  },
  input: {
    width: '100%',
    padding: '6px 10px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text)',
    fontSize: 14,
  },
}

export function HistoryList({ entries, onUpdateTitle, onDelete, onReCrawl }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (e: HistoryEntry) => {
    setEditingId(e.id)
    setEditValue(e.title || e.url)
  }
  const submitEdit = (id: string) => {
    if (editValue.trim()) onUpdateTitle(id, editValue.trim())
    setEditingId(null)
  }

  if (entries.length === 0) {
    return (
      <section style={styles.section}>
        <h2 style={styles.title}>History</h2>
        <p style={styles.empty}>No URLs saved yet. Paste a link on Home and find files — we'll remember it here.</p>
      </section>
    )
  }

  return (
    <section style={styles.section} className="history-section">
      <h2 style={styles.title}>History ({entries.length})</h2>
      <ul style={styles.list}>
        {entries.map((e) => (
          <li key={e.id} style={styles.row} className="history-row">
            <div style={styles.main} className="main">
              {editingId === e.id ? (
                <input
                  style={styles.input}
                  value={editValue}
                  onChange={(ev) => setEditValue(ev.target.value)}
                  onBlur={() => submitEdit(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') submitEdit(e.id)
                    if (ev.key === 'Escape') {
                      setEditingId(null)
                      setEditValue(e.title || e.url)
                    }
                  }}
                  autoFocus
                  aria-label="Edit title"
                />
              ) : (
                <>
                  <span style={styles.linkTitle} title={e.title || e.url}>{truncateLink(e.title || e.url)}</span>
                  <span style={styles.url} title={e.url}>{truncateLink(e.url)}</span>
                </>
              )}
            </div>
            {e.lastFileCount != null && e.lastStatus === 'completed' && (
              <span style={styles.meta}>{e.lastFileCount} file{e.lastFileCount !== 1 ? 's' : ''}</span>
            )}
            <div style={styles.actions}>
              <button type="button" style={styles.btn} onClick={() => startEdit(e)} aria-label="Edit title">
                Edit
              </button>
              <button type="button" style={styles.btn} onClick={() => onReCrawl(e.url)}>
                Find again
              </button>
              <button type="button" style={styles.btnDanger} onClick={() => onDelete(e.id)} aria-label="Remove from history">
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
