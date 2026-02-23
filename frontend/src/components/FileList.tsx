import { useState, useMemo } from 'react'
import type { FoundFile } from '../types'
import { OUTPUT_FORMATS } from '../constants'
import { truncateLink } from '../lib/utils'

type SortKey = 'recent' | 'type' | 'title'

type Props = {
  files: FoundFile[]
  pendingSearchUrl?: string | null
  selectedQuality: Record<string, number>
  setSelectedQuality: React.Dispatch<React.SetStateAction<Record<string, number>>>
  selectedFormat: Record<string, string>
  setSelectedFormat: React.Dispatch<React.SetStateAction<Record<string, string>>>
  downloadError: string | null
  getDownloadUrl: (file: FoundFile, qualityIndex?: number) => string
  getOutputFormat: (file: FoundFile) => string
  getExtensionForFile: (file: FoundFile) => string
  suggestDownloadFilename: (file: FoundFile) => string
  downloadButtonLabel: (fileId: string) => string
  onDownload: (file: FoundFile) => void
  defaultQualityIndex?: number
}

const typeOrder = { video: 0, audio: 1, image: 2 }

const styles: Record<string, React.CSSProperties> = {
  section: { maxWidth: 720, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
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
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  sortSelect: {
    padding: '10px 14px',
    paddingRight: 36,
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  error: { color: 'var(--danger)', marginBottom: 12, fontSize: 15 },
  groupList: { listStyle: 'none', margin: 0, padding: 0 },
  groupCard: {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    marginBottom: 16,
    overflow: 'hidden',
    boxShadow: 'var(--card-shadow)',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 20px',
    cursor: 'pointer',
    background: 'var(--group-header-bg)',
    borderBottom: '1px solid var(--border)',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
  },
  groupThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    objectFit: 'cover' as const,
    flexShrink: 0,
  },
  groupThumbPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  groupChevron: {
    fontSize: 18,
    color: 'var(--text-muted)',
    transition: 'transform 0.2s ease',
    flexShrink: 0,
  },
  groupLinkWrap: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
  },
  groupLink: {
    width: '100%',
    fontFamily: 'var(--font-mono)',
    fontSize: 14,
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  groupMeta: {
    fontSize: 13,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  groupBody: {
    padding: '8px 0',
  },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 20px',
    borderBottom: '1px solid var(--border)',
  },
  rowLast: { borderBottom: 'none' },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' as const },
  typeIcon: { fontSize: 22 },
  info: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  fileTitle: {
    fontWeight: 500,
    fontSize: 15,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: 13,
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  qualityRow: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  select: {
    padding: '8px 12px',
    paddingRight: 36,
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: 13,
    fontFamily: 'inherit',
  },
  downloadBtn: {
    padding: '10px 18px',
    background: 'var(--bg-hover)',
    color: 'var(--accent)',
    borderRadius: 'var(--radius)',
    fontWeight: 500,
    fontSize: 14,
    flexShrink: 0,
  },
  empty: { color: 'var(--text-muted)', marginTop: 24, fontSize: 16 },
  searchingWrap: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '24px 20px',
    marginBottom: 20,
    boxShadow: 'var(--card-shadow)',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  searchingSpinner: {
    color: 'var(--accent)',
    fontSize: 22,
    flexShrink: 0,
  },
  searchingText: {
    color: 'var(--text)',
    fontSize: 15,
  },
  searchingUrl: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    color: 'var(--text-muted)',
    marginTop: 4,
  },
}

function typeColor(t: string): string {
  return t === 'video' ? 'var(--video)' : t === 'audio' ? 'var(--audio)' : 'var(--image)'
}

function getGroupKey(f: FoundFile): string {
  return f.crawlUrl && f.crawlUrl.trim() ? f.crawlUrl : 'other'
}

export function FileList(props: Props) {
  const {
    files,
    pendingSearchUrl,
    selectedQuality,
    setSelectedQuality,
    setSelectedFormat,
    downloadError,
    getOutputFormat,
    downloadButtonLabel,
    onDownload,
    defaultQualityIndex = 0,
  } = props
  const [sortBy, setSortBy] = useState<SortKey>('recent')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [thumbFail, setThumbFail] = useState<Record<string, boolean>>({})

  const grouped = useMemo(() => {
    const byKey: Record<string, FoundFile[]> = {}
    for (const f of files) {
      const key = getGroupKey(f)
      if (!byKey[key]) byKey[key] = []
      byKey[key].push(f)
    }
    for (const key of Object.keys(byKey)) {
      const list = byKey[key]
      if (sortBy === 'type') list.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || (a.title || '').localeCompare(b.title || ''))
      else if (sortBy === 'title') list.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }))
    }
    return byKey
  }, [files, sortBy])

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  if (files.length === 0 && !pendingSearchUrl) {
    return (
      <section style={styles.section} className="downloads-content">
        <h2 style={styles.pageTitle}>Downloads</h2>
        <p style={styles.empty}>No files yet. Paste a URL on Home and click Find files.</p>
      </section>
    )
  }

  const groupEntries = [...Object.entries(grouped)].reverse()

  return (
    <section style={styles.section} className="downloads-content">
      {pendingSearchUrl && (
        <div style={styles.searchingWrap}>
          <i className="fa-solid fa-circle-notch fa-spin" style={styles.searchingSpinner} aria-hidden />
          <div>
            <div style={styles.searchingText}>Searching for files from this link…</div>
            <div style={styles.searchingUrl} title={pendingSearchUrl}>{truncateLink(pendingSearchUrl)}</div>
          </div>
        </div>
      )}
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Downloads ({files.length})</h2>
        <select
          style={styles.sortSelect}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          aria-label="Sort by"
        >
          <option value="recent">Recent</option>
          <option value="type">Type</option>
          <option value="title">Title</option>
        </select>
      </div>
      {downloadError && <p style={styles.error}>{downloadError}</p>}
      <ul style={styles.groupList}>
        {groupEntries.map(([key, groupFiles]) => {
          const isCollapsed = collapsed[key]
          const linkLabel = key === 'other' ? 'Other media' : truncateLink(key)
          const groupThumbUrl = groupFiles.find((f) => f.thumbnail)?.thumbnail || ''
          const showThumb = groupThumbUrl && !thumbFail[key]
          return (
            <li key={key} style={styles.groupCard} className="file-group-card">
              <button
                type="button"
                className="group-header-btn"
                style={styles.groupHeader}
                onClick={() => toggleCollapsed(key)}
                aria-expanded={!isCollapsed}
              >
                {showThumb ? (
                  <img
                    src={groupThumbUrl}
                    alt=""
                    className="group-thumb-img"
                    style={styles.groupThumb}
                    onError={() => setThumbFail((prev) => ({ ...prev, [key]: true }))}
                  />
                ) : (
                  <span className="group-thumb-placeholder" style={styles.groupThumbPlaceholder}>🔗</span>
                )}
                <span style={{ ...styles.groupChevron, transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                <div style={styles.groupLinkWrap}>
                  <span style={styles.groupLink} title={key === 'other' ? 'Other media' : key}>{linkLabel}</span>
                </div>
                <span style={styles.groupMeta}>{groupFiles.length} file{groupFiles.length !== 1 ? 's' : ''}</span>
              </button>
              {!isCollapsed && (
                <div style={styles.groupBody}>
                  <ul style={styles.list}>
                    {groupFiles.map((f, i) => (
                      <li
                        key={f.id}
                        style={{ ...styles.row, ...(i === groupFiles.length - 1 ? styles.rowLast : {}) }}
                        className="file-list-row file-row-anim"
                      >
                        <div style={styles.thumb}>
                          {f.thumbnail ? (
                            <img
                              src={f.thumbnail}
                              alt=""
                              style={styles.thumbImg}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <span style={{ ...styles.typeIcon, color: typeColor(f.type) }}>
                              {f.type === 'video' && <i className="fa-solid fa-video" aria-hidden />}
                              {f.type === 'audio' && <i className="fa-solid fa-music" aria-hidden />}
                              {f.type === 'image' && <i className="fa-solid fa-image" aria-hidden />}
                            </span>
                          )}
                        </div>
                        <div style={styles.info}>
                          <span style={styles.fileTitle}>{f.title || 'Untitled'}</span>
                          <span style={styles.meta}>
                            <span style={{ color: typeColor(f.type), textTransform: 'capitalize' }}>{f.type}</span>
                            {f.qualities && f.qualities.length > 1 && <span>{f.qualities.length} qualities</span>}
                          </span>
                        </div>
                        <div style={styles.qualityRow} className="file-list-quality-wrap">
                          {OUTPUT_FORMATS[f.type] && (
                            <select
                              style={styles.select}
                              value={getOutputFormat(f)}
                              onChange={(e) => setSelectedFormat((prev) => ({ ...prev, [f.id]: e.target.value }))}
                              aria-label="Format"
                              title="Output format"
                            >
                              {OUTPUT_FORMATS[f.type].map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          )}
                          {f.qualities && f.qualities.length > 1 && (
                            <select
                              style={styles.select}
                              value={selectedQuality[f.id] ?? defaultQualityIndex}
                              onChange={(e) => setSelectedQuality((prev) => ({ ...prev, [f.id]: Number(e.target.value) }))}
                              aria-label="Quality"
                            >
                              {f.qualities.map((q, i) => (
                                <option key={i} value={i}>{q.label}</option>
                              ))}
                            </select>
                          )}
                          <button
                            style={styles.downloadBtn}
                            onClick={() => onDownload(f)}
                            title={f.qualities && f.qualities.length > 1 ? 'Add to queue' : 'Add to queue'}
                          >
                            {downloadButtonLabel(f.id)}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
