import { useState, useEffect, useCallback } from 'react'

const API = '/api'

const OUTPUT_FORMATS: Record<string, { value: string; label: string }[]> = {
  video: [
    { value: 'mp4', label: 'MP4' },
    { value: 'mkv', label: 'MKV' },
    { value: 'webm', label: 'WebM' },
    { value: 'avi', label: 'AVI' },
    { value: 'flv', label: 'FLV' },
  ],
  audio: [
    { value: 'mp3', label: 'MP3' },
    { value: 'm4a', label: 'M4A' },
    { value: 'aac', label: 'AAC' },
    { value: 'ogg', label: 'OGG' },
    { value: 'wav', label: 'WAV' },
    { value: 'flac', label: 'FLAC' },
    { value: 'opus', label: 'Opus' },
  ],
  image: [
    { value: 'png', label: 'PNG' },
    { value: 'jpg', label: 'JPG' },
    { value: 'webp', label: 'WebP' },
  ],
}

const DEFAULT_OUTPUT_FORMAT: Record<string, string> = {
  video: 'mp4',
  audio: 'mp3',
  image: 'png',
}

type Crawl = {
  id: string
  url: string
  status: 'running' | 'completed' | 'failed'
  fileCount: number
  error: string | null
}

type Quality = { url: string; label: string; format_id?: string | null }

type FoundFile = {
  id: string
  url: string
  title: string
  type: 'video' | 'audio' | 'image'
  thumbnail: string
  source: string
  crawlId?: string
  crawlUrl?: string
  qualities?: Quality[]
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'add' | 'found'>('add')
  const [inputUrl, setInputUrl] = useState('')
  const [crawls, setCrawls] = useState<Crawl[]>([])
  const [files, setFiles] = useState<FoundFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCrawls = useCallback(async () => {
    try {
      const r = await fetch(`${API}/crawls`)
      if (r.ok) setCrawls(await r.json())
    } catch (_) {}
  }, [])

  const fetchFiles = useCallback(async () => {
    try {
      const r = await fetch(`${API}/files`)
      if (r.ok) setFiles(await r.json())
    } catch (_) {}
  }, [])

  useEffect(() => {
    fetchCrawls()
    fetchFiles()
    const t = setInterval(() => {
      fetchCrawls()
      fetchFiles()
    }, 2000)
    return () => clearInterval(t)
  }, [fetchCrawls, fetchFiles])

  async function startCrawl() {
    const url = inputUrl.trim()
    if (!url) {
      setError('Enter a URL')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const r = await fetch(`${API}/crawls?url=${encodeURIComponent(url)}`, { method: 'POST' })
      if (!r.ok) throw new Error(await r.text())
      const crawl = await r.json()
      setCrawls((prev) => [crawl, ...prev])
      setInputUrl('')
      setActiveTab('found')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start crawl')
    } finally {
      setLoading(false)
    }
  }

  const [selectedQuality, setSelectedQuality] = useState<Record<string, number>>({})
  const [selectedFormat, setSelectedFormat] = useState<Record<string, string>>({})
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadPhase, setDownloadPhase] = useState<'downloading' | 'converting' | 'streaming' | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [downloadBytes, setDownloadBytes] = useState<number>(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  function getDownloadUrl(file: FoundFile, qualityIndex?: number): string {
    const q = file.qualities && file.qualities.length > 0
      ? file.qualities[qualityIndex ?? selectedQuality[file.id] ?? 0]
      : null
    return (q && q.url) || file.url
  }

  function suggestDownloadFilename(file: FoundFile): string {
    const title = (file.title || 'download').replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 180) || 'download'
    const ext = getExtensionForFile(file)
    return ext ? `${title}.${ext}` : title
  }

  function getOutputFormat(file: FoundFile): string {
    return selectedFormat[file.id] ?? DEFAULT_OUTPUT_FORMAT[file.type] ?? (file.type === 'video' ? 'mp4' : file.type === 'audio' ? 'mp3' : 'png')
  }

  function getExtensionForFile(file: FoundFile): string {
    // Use selected output format when we have a format dropdown (video/audio/image)
    if (OUTPUT_FORMATS[file.type]) return getOutputFormat(file)
    const u = getDownloadUrl(file)
    const path = u.split('?')[0]
    const match = path.match(/\.([a-z0-9]+)$/i)
    if (match) return match[1].toLowerCase()
    if (file.type === 'video') return 'mp4'
    if (file.type === 'audio') return 'm4a'
    if (file.type === 'image') return 'png'
    return ''
  }

  async function downloadFile(file: FoundFile) {
    const filename = suggestDownloadFilename(file)
    const useYtDlp = file.source === 'yt-dlp' && file.crawlUrl && (file.type === 'video' || file.type === 'audio')
    const qualityIndex = selectedQuality[file.id] ?? 0
    const selectedQ = file.qualities?.[qualityIndex]
    const qualityLabel = selectedQ?.label
    const formatId = selectedQ && 'format_id' in selectedQ ? (selectedQ.format_id ?? undefined) : undefined

    const params = new URLSearchParams()
    if (useYtDlp && file.crawlUrl) {
      params.set('url', file.crawlUrl)
      if (file.type === 'video' && qualityLabel) params.set('quality', qualityLabel)
      if (file.type === 'audio' && formatId) params.set('format_id', formatId)
      params.set('media_type', file.type)
      const outFmt = getOutputFormat(file)
      if (outFmt) params.set('output_format', outFmt)
    } else {
      params.set('url', getDownloadUrl(file))
      const outFmt = getOutputFormat(file)
      if (outFmt) params.set('output_format', outFmt)
      params.set('media_type', file.type)
    }
    if (filename && filename !== 'download') params.set('filename', filename)
    const apiUrl = useYtDlp && file.crawlUrl
      ? `${API}/download-ytdlp?${params.toString()}`
      : `${API}/download?${params.toString()}`

    setDownloadError(null)
    setDownloadProgress(null)
    setDownloadBytes(0)
    setDownloadPhase(null)
    setDownloadingId(file.id)
    const expectProgressStream = useYtDlp && file.type === 'video'
    try {
      const res = await fetch(apiUrl)
      if (!res.ok) throw new Error(res.status === 502 ? 'Download failed (server or source error)' : `Download failed (${res.status})`)
      const totalHeader = res.headers.get('Content-Length')
      let totalNum = totalHeader ? parseInt(totalHeader, 10) : 0
      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let buffer = new Uint8Array(0)
      let fileSizeFromStream: number | null = null
      const fileChunks: Uint8Array[] = []
      let fileReceived = 0
      let lastPct = -1
      const decoder = new TextDecoder('utf-8')
      for (;;) {
        const { done, value } = await reader.read()
        if (done && !value?.length) break
        if (value && expectProgressStream && fileSizeFromStream == null) {
          const combined = new Uint8Array(buffer.length + value.length)
          combined.set(buffer)
          combined.set(value, buffer.length)
          buffer = combined
        } else if (value && (fileSizeFromStream != null || !expectProgressStream)) {
          if (fileSizeFromStream != null && fileSizeFromStream > 0) {
            const rem = fileSizeFromStream - fileReceived
            const take = Math.min(rem, value.length)
            fileChunks.push(take === value.length ? value : value.subarray(0, take))
            fileReceived += take
            const pct = Math.min(100, Math.round((fileReceived / fileSizeFromStream) * 100))
            if (pct !== lastPct) {
              lastPct = pct
              setDownloadProgress(pct)
            }
          } else {
            chunks.push(value)
            const totalReceived = chunks.reduce((a, c) => a + c.length, 0)
            if (totalNum > 0) setDownloadProgress(Math.min(100, Math.round((totalReceived / totalNum) * 100)))
            else setDownloadBytes(totalReceived)
          }
          continue
        } else if (value) {
          const combined = new Uint8Array(buffer.length + value.length)
          combined.set(buffer)
          combined.set(value, buffer.length)
          buffer = combined
        }
        if (!expectProgressStream) {
          if (value) chunks.push(value)
          continue
        }
        let newlineIdx = buffer.indexOf(0x0a)
        while (newlineIdx >= 0) {
          const lineBytes = buffer.slice(0, newlineIdx)
          buffer = buffer.slice(newlineIdx + 1)
          try {
            const obj = JSON.parse(decoder.decode(lineBytes)) as { progress?: { phase?: string; size?: number } }
            const phase = obj.progress?.phase
            const size = obj.progress?.size
            if (phase) {
              setDownloadPhase(phase as 'downloading' | 'converting' | 'streaming')
              if (phase === 'streaming' && typeof size === 'number' && size > 0) {
                fileSizeFromStream = size
                totalNum = size
                const take = Math.min(size, buffer.length)
                if (take > 0) {
                  fileChunks.push(buffer.slice(0, take))
                  fileReceived = take
                  if (buffer.length > take) {
                    const rest = Math.min(size - take, buffer.length - take)
                    fileChunks.push(buffer.slice(take, take + rest))
                    fileReceived += rest
                  }
                  buffer = new Uint8Array(0)
                  const pct = Math.min(100, Math.round((fileReceived / size) * 100))
                  setDownloadProgress(pct)
                  lastPct = pct
                }
              }
            }
          } catch {
            /* ignore */
          }
          newlineIdx = buffer.indexOf(0x0a)
        }
        if (done) break
      }
      if (expectProgressStream && fileSizeFromStream != null && fileSizeFromStream > 0 && buffer.length > 0) {
        const rem = fileSizeFromStream - fileReceived
        if (rem > 0) fileChunks.push(buffer.slice(0, rem))
      }
      const blob = new Blob(
        expectProgressStream && fileChunks.length > 0 ? fileChunks : chunks.length > 0 ? chunks : buffer.length > 0 ? [buffer] : []
      )
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename && filename !== 'download' ? filename : 'download'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloadingId(null)
      setDownloadPhase(null)
      setDownloadProgress(null)
      setDownloadBytes(0)
    }
  }

  function downloadButtonLabel(fileId: string): string {
    if (downloadingId !== fileId) return 'Download'
    if (downloadPhase === 'downloading') return 'Downloading…'
    if (downloadPhase === 'converting') return 'Converting…'
    if (downloadPhase === 'streaming' && downloadProgress != null) return `${downloadProgress}%`
    if (downloadPhase === 'streaming') return 'Sending…'
    if (downloadBytes > 0) return `Downloading ${(downloadBytes / 1024 / 1024).toFixed(1)} MB`
    return 'Downloading…'
  }

  const typeColor = (t: string) =>
    t === 'video' ? 'var(--video)' : t === 'audio' ? 'var(--audio)' : 'var(--image)'

  return (
    <div style={styles.layout}>
      <header style={styles.header}>
        <h1 style={styles.logo}>WebDownloader</h1>
        <nav style={styles.nav}>
          <button
            style={{ ...styles.tab, ...(activeTab === 'add' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('add')}
          >
            Add link
          </button>
          <button
            style={{ ...styles.tab, ...(activeTab === 'found' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('found')}
          >
            Found files {files.length > 0 && `(${files.length})`}
          </button>
        </nav>
      </header>

      <main style={styles.main}>
        {activeTab === 'add' && (
          <section style={styles.section}>
            <p style={styles.lead}>
              Paste a YouTube, Instagram, or any page URL. We'll find videos, audio, and images.
            </p>
            <div style={styles.inputRow}>
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startCrawl()}
                style={styles.input}
                disabled={loading}
              />
              <button
                style={styles.btn}
                onClick={startCrawl}
                disabled={loading}
              >
                {loading ? 'Crawling…' : 'Find files'}
              </button>
            </div>
            {error && <p style={styles.error}>{error}</p>}
            {crawls.length > 0 && (
              <div style={styles.crawlList}>
                <h3 style={styles.subtitle}>Recent crawls</h3>
                {crawls.slice(0, 10).map((c) => (
                  <div key={c.id} style={styles.crawlRow}>
                    <span style={styles.crawlUrl}>{c.url}</span>
                    <span
                      style={{
                        ...styles.crawlStatus,
                        color:
                          c.status === 'completed'
                            ? 'var(--accent)'
                            : c.status === 'failed'
                              ? 'var(--danger)'
                              : 'var(--text-muted)',
                      }}
                    >
                      {c.status === 'running' && '⏳ Running…'}
                      {c.status === 'completed' && `✓ ${c.fileCount} files`}
                      {c.status === 'failed' && (c.error || 'Failed')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'found' && (
          <section style={styles.section}>
            <h2 style={styles.subtitle}>Found files</h2>
            {downloadError && <p style={styles.error}>{downloadError}</p>}
            {files.length === 0 ? (
              <p style={styles.empty}>No files yet. Add a link and run a crawl.</p>
            ) : (
              <ul style={styles.fileList}>
                {files.map((f) => (
                  <li key={f.id} style={styles.fileRow}>
                    <div style={styles.fileThumb}>
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
                          {f.type === 'video' && '▶'}
                          {f.type === 'audio' && '♫'}
                          {f.type === 'image' && '🖼'}
                        </span>
                      )}
                    </div>
                    <div style={styles.fileInfo}>
                      <span style={styles.fileTitle}>{f.title || 'Untitled'}</span>
                      <span style={styles.fileMeta}>
                        <span style={{ color: typeColor(f.type), textTransform: 'capitalize' }}>
                          {f.type}
                        </span>
                        {f.qualities && f.qualities.length > 1 && (
                          <span style={styles.qualityCount}>{f.qualities.length} qualities</span>
                        )}
                        {f.crawlUrl && (
                          <span style={styles.fileSource}>{f.crawlUrl}</span>
                        )}
                      </span>
                    </div>
                    <div style={styles.qualityRow}>
                      {OUTPUT_FORMATS[f.type] && (
                        <select
                          style={styles.qualitySelect}
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
                          style={styles.qualitySelect}
                          value={selectedQuality[f.id] ?? 0}
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
                        onClick={() => downloadFile(f)}
                        disabled={downloadingId !== null}
                        title={f.qualities && f.qualities.length > 1 ? 'Download selected quality' : 'Download'}
                      >
                        {downloadButtonLabel(f.id)}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    maxWidth: 900,
    margin: '0 auto',
    padding: '0 24px',
  },
  header: {
    padding: '24px 0',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 16,
  },
  logo: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '-0.02em',
    color: 'var(--accent)',
  },
  nav: {
    display: 'flex',
    gap: 4,
  },
  tab: {
    padding: '10px 18px',
    background: 'transparent',
    color: 'var(--text-muted)',
    borderRadius: 'var(--radius)',
    fontWeight: 500,
    fontSize: 14,
  },
  tabActive: {
    background: 'var(--bg-elevated)',
    color: 'var(--text)',
  },
  main: {
    flex: 1,
    padding: '32px 0',
  },
  section: {
    width: '100%',
  },
  lead: {
    color: 'var(--text-muted)',
    marginBottom: 24,
    fontSize: 15,
  },
  inputRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    padding: '14px 18px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: 15,
  },
  btn: {
    padding: '14px 24px',
    background: 'var(--accent)',
    color: 'var(--bg)',
    borderRadius: 'var(--radius)',
    fontWeight: 600,
    fontSize: 15,
  },
  error: {
    color: 'var(--danger)',
    marginTop: 8,
    fontSize: 14,
  },
  crawlList: {
    marginTop: 32,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  crawlRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '12px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: 14,
  },
  crawlUrl: {
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0,
  },
  crawlStatus: {
    flexShrink: 0,
  },
  empty: {
    color: 'var(--text-muted)',
    marginTop: 24,
  },
  fileList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 0',
    borderBottom: '1px solid var(--border)',
  },
  fileThumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  typeIcon: {
    fontSize: 24,
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  fileTitle: {
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileMeta: {
    fontSize: 13,
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  fileSource: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 200,
  },
  qualityCount: {
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  qualityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  qualitySelect: {
    padding: '8px 12px',
    background: 'var(--bg-elevated)',
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
}
