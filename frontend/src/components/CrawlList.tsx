import type { Crawl } from '../types'
import { truncateLink } from '../lib/utils'

type Props = {
  crawls: Crawl[]
  max?: number
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 24 },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '12px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: 14,
  },
  url: {
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0,
  },
  status: { flexShrink: 0 },
}

export function CrawlList({ crawls, max = 10 }: Props) {
  const list = crawls.slice(0, max)
  if (list.length === 0) return null
  return (
    <div style={styles.wrap}>
      <h3 style={styles.title}>Recent crawls</h3>
      {list.map((c) => (
        <div key={c.id} style={styles.row}>
          <span style={styles.url} title={c.url}>{truncateLink(c.url)}</span>
          <span
            style={{
              ...styles.status,
              color:
                c.status === 'completed'
                  ? 'var(--accent)'
                  : c.status === 'failed'
                    ? 'var(--danger)'
                    : 'var(--text-muted)',
            }}
          >
            {c.status === 'running' && 'Running…'}
            {c.status === 'completed' && `${c.fileCount} file${c.fileCount !== 1 ? 's' : ''}`}
            {c.status === 'failed' && (c.error || 'Failed')}
          </span>
        </div>
      ))}
    </div>
  )
}
