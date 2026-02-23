import { OUTPUT_FORMATS } from '../constants'

const types: { id: 'video' | 'audio' | 'image'; name: string; iconClass: string }[] = [
  { id: 'video', name: 'Videos', iconClass: 'fa-solid fa-video' },
  { id: 'audio', name: 'Audio', iconClass: 'fa-solid fa-music' },
  { id: 'image', name: 'Images', iconClass: 'fa-solid fa-image' },
]

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    maxWidth: 720,
    margin: '24px auto 0',
    width: '100%',
    boxSizing: 'border-box',
  },
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '20px 16px',
    boxShadow: 'var(--card-shadow)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
  },
  name: {
    fontWeight: 600,
    fontSize: 15,
  },
  meta: {
    fontSize: 12,
    color: 'var(--text-muted)',
    lineHeight: 1.4,
  },
}

function formatList(type: 'video' | 'audio' | 'image'): string {
  const list = OUTPUT_FORMATS[type]
  return list ? list.map((f) => f.label).join(', ') : ''
}

export function DownloadTypeCards() {
  return (
    <div style={styles.wrap} className="download-type-cards">
      {types.map(({ id, name, iconClass }) => (
        <div key={id} style={styles.card}>
          <div style={styles.topRow}>
            <div style={{ ...styles.iconWrap, color: `var(--${id})`, background: 'var(--bg-elevated)' }}>
              <i className={iconClass} aria-hidden />
            </div>
            <span style={{ ...styles.name, color: `var(--${id})` }}>{name}</span>
          </div>
          <span style={styles.meta}>{formatList(id)}</span>
        </div>
      ))}
    </div>
  )
}
