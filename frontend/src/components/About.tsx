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
  footer: {
    marginTop: 40,
    paddingTop: 24,
    borderTop: '1px solid var(--border)',
    fontSize: 13,
    color: 'var(--text-muted)',
  },
  link: { color: 'var(--accent)' },
}

export function About() {
  return (
    <section style={styles.section} className="about-section">
      <h2 style={styles.title}>About</h2>
      <p style={styles.paragraph}>
        WebDownloader finds and downloads videos, audio, and images from any URL. Paste a link from YouTube, Instagram, or any webpage; we discover media and let you choose quality and format, then add downloads to a queue so multiple files download at once.
      </p>
      <p style={styles.paragraph}>
        Supported sites use yt-dlp for fast, reliable downloads; other pages are crawled so we can still grab direct media links. No file size limit, no ads, and the app can be self-hosted.
      </p>
      <footer style={styles.footer}>
        You can set default formats, download naming, and theme in Settings.
        <br />
        Made by Luka Meklin 2026
      </footer>
    </section>
  )
}
