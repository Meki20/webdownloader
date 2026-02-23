const styles: Record<string, React.CSSProperties> = {
  hero: {
    textAlign: 'center',
    padding: '56px 24px 48px',
    width: '100%',
    maxWidth: 720,
    margin: '0 auto',
    background: 'var(--hero-bg)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    marginBottom: 32,
  },
  title: {
    margin: '0 0 16px',
    fontSize: 'clamp(2rem, 5vw, 2.75rem)',
    fontWeight: 700,
    lineHeight: 1.2,
    background: 'var(--hero-title-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  subtitle: {
    margin: '0 0 40px',
    fontSize: 18,
    color: 'var(--text-muted)',
    lineHeight: 1.6,
  },
}

export function Hero() {
  return (
    <section style={styles.hero} className="hero-section">
      <h2 style={styles.title}>The downloader you'll love.</h2>
      <p style={styles.subtitle}>
        Paste any URL — YouTube, Instagram, or any page. We find videos, audio, and images so you can download in one click. No ads, open source.
      </p>
    </section>
  )
}
