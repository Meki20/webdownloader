import { useState, useEffect, useRef } from 'react'

const nav = [
  { id: 'home' as const, label: 'Home' },
  { id: 'downloads' as const, label: 'Downloads' },
  { id: 'queue' as const, label: 'Queue' },
  { id: 'history' as const, label: 'History' },
  { id: 'settings' as const, label: 'Settings' },
  { id: 'about' as const, label: 'About' },
]

type TabId = 'home' | 'downloads' | 'queue' | 'history' | 'settings' | 'about'

type Props = {
  activeTab: TabId
  onTab: (tab: TabId) => void
  downloadCount?: number
  queueCount?: number
}

const tabRadius = 20

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    marginTop: 24,
  },
  titleRow: {
    textAlign: 'center',
    marginBottom: 16,
  },
  logo: {
    margin: 0,
    fontSize: '2rem',
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '-0.02em',
    background: 'var(--logo-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  navWrap: {
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
    borderRadius: 24,
    background: 'var(--header-bg)',
    boxShadow: 'var(--header-shadow)',
    width: '100%',
    maxWidth: 720,
    margin: '0 auto',
    boxSizing: 'border-box' as const,
  },
  nav: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    position: 'relative' as const,
  },
  tab: {
    padding: '12px 20px',
    background: 'transparent',
    color: 'var(--text)',
    borderRadius: tabRadius,
    fontWeight: 600,
    fontSize: 16,
    position: 'relative' as const,
    zIndex: 1,
  },
  tabActive: {
    color: 'var(--text)',
  },
  pill: {
    position: 'absolute' as const,
    borderRadius: tabRadius,
    background: 'var(--tab-pill-bg)',
    pointerEvents: 'none',
    transition: 'left 0.25s ease, width 0.25s ease, top 0.25s ease, height 0.25s ease',
    zIndex: 0,
  },
}

export function Header({ activeTab, onTab, downloadCount = 0, queueCount = 0 }: Props) {
  const navRef = useRef<HTMLDivElement>(null)
  const [pillStyle, setPillStyle] = useState({ left: 0, top: 0, width: 0, height: 0, opacity: 0 })

  function measurePill() {
    const container = navRef.current
    const el = container?.querySelector('[aria-selected="true"]') as HTMLElement | null
    if (!el || !container) return
    const cr = container.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    setPillStyle({
      left: er.left - cr.left,
      top: er.top - cr.top,
      width: er.width,
      height: er.height,
      opacity: 1,
    })
  }

  // Measure pill when active tab or label (counts) change; run after paint so layout is correct on reload
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      measurePill()
      requestAnimationFrame(measurePill)
    })
    return () => cancelAnimationFrame(raf)
  }, [activeTab, downloadCount, queueCount])

  // Re-measure when container or tab size changes (resize, wrap)
  useEffect(() => {
    const container = navRef.current
    if (!container) return
    const ro = new ResizeObserver(() => measurePill())
    ro.observe(container)
    const activeEl = container.querySelector('[aria-selected="true"]') as HTMLElement | null
    if (activeEl) {
      const roTab = new ResizeObserver(() => measurePill())
      roTab.observe(activeEl)
      return () => {
        ro.disconnect()
        roTab.disconnect()
      }
    }
    return () => ro.disconnect()
  }, [activeTab, downloadCount, queueCount])

  return (
    <header style={styles.wrapper} className="app-header">
      <div style={styles.titleRow}>
        <h1 style={styles.logo}>WebDownloader</h1>
      </div>
      <nav style={styles.navWrap} role="tablist" aria-label="Main navigation">
        <div ref={navRef} style={styles.nav}>
          {pillStyle.opacity > 0 && (
            <div
              style={{
                ...styles.pill,
                left: pillStyle.left,
                top: pillStyle.top,
                width: pillStyle.width,
                height: pillStyle.height,
                opacity: pillStyle.opacity,
              }}
              className="tab-pill"
              aria-hidden
            />
          )}
          {nav.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              style={{ ...styles.tab, ...(activeTab === id ? styles.tabActive : {}) }}
              onClick={() => onTab(id)}
            >
              {id === 'downloads' && downloadCount > 0 ? `${label} (${downloadCount})` : id === 'queue' && queueCount > 0 ? `${label} (${queueCount})` : label}
            </button>
          ))}
        </div>
      </nav>
    </header>
  )
}
