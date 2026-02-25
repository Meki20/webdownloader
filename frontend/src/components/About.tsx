export type VersionInfo = {
  version: string
  tag?: string
  name?: string
  body?: string
  published_at?: string
  html_url?: string
} | null

const styles: Record<string, React.CSSProperties> = {
  section: {
    maxWidth: 560,
    margin: '0 auto',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 20,
    background: 'var(--page-title-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  paragraph: {
    fontSize: 15,
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    marginBottom: 20,
  },
  versionBlock: {
    marginBottom: 24,
    padding: '16px 20px',
    background: 'var(--card-bg)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
  },
  versionTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text)',
    marginBottom: 8,
  },
  versionMeta: {
    fontSize: 13,
    color: 'var(--text-muted)',
    marginBottom: 12,
  },
  releaseBody: {
    fontSize: 14,
    color: 'var(--text)',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  link: { color: 'var(--accent)' },
  footer: {
    marginTop: 40,
    paddingTop: 24,
    borderTop: '1px solid var(--border)',
    fontSize: 13,
    color: 'var(--text-muted)',
  },
}

function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export function About({ versionInfo }: { versionInfo: VersionInfo }) {
  return (
    <section style={styles.section} className="about-section">
      <h2 style={styles.title}>About</h2>
      <p style={styles.paragraph}>
        WebDownloader finds and downloads videos, audio, and images from any URL. Paste a link from YouTube, Instagram, or any webpage; we discover media and let you choose quality and format, then add downloads to a queue so multiple files download at once.
      </p>
      <p style={styles.paragraph}>
        Supported sites use yt-dlp for fast, reliable downloads; other pages are crawled so we can still grab direct media links. No file size limit, no ads, and the app can be self-hosted.
      </p>
      {versionInfo && (
        <div style={styles.versionBlock}>
          <div style={styles.versionTitle}>
            Version {versionInfo.version}
            {versionInfo.name && versionInfo.name !== versionInfo.tag && ` — ${versionInfo.name}`}
          </div>
          {(versionInfo.published_at || versionInfo.html_url) && (
            <div style={styles.versionMeta}>
              {versionInfo.published_at && formatDate(versionInfo.published_at)}
              {versionInfo.html_url && (
                <>
                  {' · '}
                  <a href={versionInfo.html_url} target="_blank" rel="noopener noreferrer" style={styles.link}>
                    View release on GitHub
                  </a>
                </>
              )}
            </div>
          )}
          {versionInfo.body && (
            <div style={styles.releaseBody}>{versionInfo.body.trim()}</div>
          )}
        </div>
      )}
      <footer style={styles.footer}>
        You can set default formats, download naming, and theme in Settings.
        <br />
        Made by Luka Meklin 2026
      </footer>
    </section>
  )
}
