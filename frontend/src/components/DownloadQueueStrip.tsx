import type { FoundFile } from '../types'

type Progress = { phase: 'downloading' | 'converting' | 'streaming'; progress: number | null; bytes: number }

type Props = {
  queue: FoundFile[]
  activeIds: string[]
  progress: Record<string, Progress>
  onRemove: (fileId: string) => void
  getLabel: (fileId: string) => string
  fullPage?: boolean
}

const styles: Record<string, React.CSSProperties> = {
  strip: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '12px 16px',
    marginBottom: 16,
  },
  fullPageWrap: { maxWidth: 720, margin: '0 auto' },
  pageTitle: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 20,
    color: 'var(--text)',
    background: 'var(--page-title-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 10,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 13,
  },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' },
  status: { color: 'var(--text-muted)', flexShrink: 0 },
  remove: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    background: 'transparent',
    color: 'var(--text-muted)',
    borderRadius: 6,
    flexShrink: 0,
  },
  removeIcon: {
    width: 18,
    height: 18,
    display: 'block',
  },
  bar: {
    height: 6,
    borderRadius: 3,
    background: 'var(--border)',
    overflow: 'hidden',
    width: 100,
    flexShrink: 0,
  },
  barFill: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: 3,
    transition: 'width 0.25s ease',
  },
  barIndeterminate: {
    height: '100%',
    width: '40%',
    background: 'var(--accent)',
    borderRadius: 3,
    animation: 'queue-bar-indeterminate 1.2s ease-in-out infinite',
  },
  statusMinWidth: { minWidth: 72, textAlign: 'right' as const },
  empty: {
    textAlign: 'center',
    padding: '48px 24px',
    color: 'var(--text-muted)',
    fontSize: 17,
    lineHeight: 1.5,
    background: 'var(--card-bg)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
  },
}

export function DownloadQueueStrip({ queue, activeIds, progress, onRemove, getLabel, fullPage }: Props) {
  const inQueue = queue.filter((f) => !activeIds.includes(f.id))
  const active = queue.filter((f) => activeIds.includes(f.id))
  const all = [...active, ...inQueue]

  if (fullPage) {
    return (
      <section style={styles.fullPageWrap} className="queue-page">
        <h2 style={styles.pageTitle}>Download queue</h2>
        {all.length === 0 ? (
          <p style={styles.empty}>
            Nothing in the queue. Go to <strong>Downloads</strong>, pick files, and click <strong>Add to queue</strong> to start.
          </p>
        ) : (
          <div style={styles.strip} className="download-queue-strip">
            <div style={styles.title}>Active & queued ({queue.length})</div>
            <div style={styles.list}>
              {all.map((f) => {
                const isActive = activeIds.includes(f.id)
                const prog = progress[f.id]
                const pct = prog?.progress
                const hasPct = pct != null && pct >= 0
                return (
                  <div key={f.id} style={styles.row}>
                    <span style={styles.name}>{f.title || 'Untitled'}</span>
                    {isActive ? (
                      <>
                        <div style={styles.bar}>
                          {hasPct ? (
                            <div style={{ ...styles.barFill, width: `${Math.min(100, Math.max(0, pct))}%` }} />
                          ) : (
                            <div style={styles.barIndeterminate} aria-hidden />
                          )}
                        </div>
                        <span style={{ ...styles.status, ...styles.statusMinWidth }}>{getLabel(f.id)}</span>
                      </>
                    ) : (
                      <span style={styles.status}>Queued</span>
                    )}
                    <button type="button" style={styles.remove} onClick={() => onRemove(f.id)} aria-label="Remove from queue" title="Remove from queue">
                      <svg style={styles.removeIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
    )
  }

  if (all.length === 0) return null

  return (
    <div style={styles.strip} className="download-queue-strip">
      <div style={styles.title}>Download queue ({queue.length})</div>
      <div style={styles.list}>
        {all.map((f) => {
          const isActive = activeIds.includes(f.id)
          const prog = progress[f.id]
          const pct = prog?.progress
          const hasPct = pct != null && pct >= 0
          return (
            <div key={f.id} style={styles.row}>
              <span style={styles.name}>{f.title || 'Untitled'}</span>
              {isActive ? (
                <>
                  <div style={styles.bar}>
                    {hasPct ? (
                      <div style={{ ...styles.barFill, width: `${Math.min(100, Math.max(0, pct))}%` }} />
                    ) : (
                      <div style={styles.barIndeterminate} aria-hidden />
                    )}
                  </div>
                  <span style={{ ...styles.status, ...styles.statusMinWidth }}>{getLabel(f.id)}</span>
                </>
              ) : (
                <span style={styles.status}>Queued</span>
              )}
              <button type="button" style={styles.remove} onClick={() => onRemove(f.id)} aria-label="Remove from queue" title="Remove from queue">
                <svg style={styles.removeIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
