type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  loading: boolean
  error: string | null
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    width: '100%',
    maxWidth: 720,
    margin: '0 auto 24px',
    padding: '28px 24px',
    background: 'var(--card-bg)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--card-shadow)',
  },
  row: {
    display: 'flex',
    gap: 14,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    padding: '18px 20px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: 17,
  },
  btn: {
    padding: '18px 28px',
    background: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-text)',
    borderRadius: 'var(--radius)',
    fontWeight: 600,
    fontSize: 17,
    flexShrink: 0,
  },
  error: {
    color: 'var(--danger)',
    marginTop: 10,
    fontSize: 15,
  },
}

export function UrlInput({ value, onChange, onSubmit, loading, error }: Props) {
  return (
    <div style={styles.wrap} className="url-input-wrap">
      <div style={styles.row} className="url-input-row">
        <input
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          style={styles.input}
          disabled={loading}
          aria-label="URL to download"
        />
        <button style={styles.btn} onClick={onSubmit} disabled={loading}>
          {loading ? 'Finding…' : 'Find files'}
        </button>
      </div>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  )
}
