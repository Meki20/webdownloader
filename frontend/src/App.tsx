import { useState, useEffect, useCallback } from 'react'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { UrlInput } from './components/UrlInput'
import { FileList } from './components/FileList'
import { HistoryList } from './components/HistoryList'
import { Settings } from './components/Settings'
import { About } from './components/About'
import { DownloadQueueStrip } from './components/DownloadQueueStrip'
import { DownloadTypeCards } from './components/DownloadTypeCards'
import type { Crawl, FoundFile, HistoryEntry, Theme } from './types'
import { OUTPUT_FORMATS } from './constants'
import * as historyLib from './lib/history'
import { randomUUID } from './lib/utils'
import { initTheme, getStoredTheme, applyTheme } from './lib/theme'
import { loadSettings, applyNamingTemplate, type UserSettings } from './lib/settings'

const API = '/api'
const MAX_HISTORY = 200

type TabId = 'home' | 'downloads' | 'queue' | 'history' | 'settings' | 'about'
const TAB_ORDER: TabId[] = ['home', 'downloads', 'queue', 'history', 'settings', 'about']
type ProgressState = { phase: 'downloading' | 'converting' | 'streaming'; progress: number | null; bytes: number }

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(r.statusText)
  return r.json()
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [tabDirection, setTabDirection] = useState<'left' | 'right'>('right')

  function handleTabChange(tab: TabId) {
    const fromIdx = TAB_ORDER.indexOf(activeTab)
    const toIdx = TAB_ORDER.indexOf(tab)
    setTabDirection(toIdx > fromIdx ? 'right' : 'left')
    setActiveTab(tab)
  }
  const [inputUrl, setInputUrl] = useState('')
  const [crawls, setCrawls] = useState<Crawl[]>([])
  const [files, setFiles] = useState<FoundFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings())
  const [downloadQueue, setDownloadQueue] = useState<FoundFile[]>([])
  const [activeDownloadIds, setActiveDownloadIds] = useState<string[]>([])
  const [downloadProgress, setDownloadProgress] = useState<Record<string, ProgressState>>({})
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [pendingSearchUrl, setPendingSearchUrl] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  const queueConcurrency = settings.downloadConcurrency

  useEffect(() => {
    initTheme()
  }, [])

  // Load per-IP settings, history, queue from API (fallback to localStorage/empty if API fails)
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchJson<UserSettings>(`${API}/settings`).catch(() => loadSettings()),
      fetchJson<HistoryEntry[]>(`${API}/history`).catch(() => historyLib.loadHistory()),
      fetchJson<FoundFile[]>(`${API}/queue`).catch(() => []),
    ]).then(([apiSettings, apiHistory, apiQueue]) => {
      if (cancelled) return
      setSettings(apiSettings)
      const themeVal = apiSettings.theme ?? 'system'
      setTheme(themeVal)
      applyTheme(themeVal)
      setHistoryEntries(Array.isArray(apiHistory) ? apiHistory : [])
      setDownloadQueue(Array.isArray(apiQueue) ? apiQueue : [])
      setDataLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  const saveSettingsToApi = useCallback((s: UserSettings) => {
    fetch(`${API}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
      .then((r) => { if (!r.ok) console.warn('Save settings failed', r.status) })
      .catch((e) => console.warn('Save settings error', e))
  }, [])

  const saveHistoryToApi = useCallback((entries: HistoryEntry[]) => {
    fetch(`${API}/history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entries.slice(0, MAX_HISTORY)) })
      .then((r) => { if (!r.ok) console.warn('Save history failed', r.status) })
      .catch((e) => console.warn('Save history error', e))
  }, [])

  const saveQueueToApi = useCallback((queue: FoundFile[]) => {
    fetch(`${API}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queue) })
      .then((r) => { if (!r.ok) console.warn('Save queue failed', r.status) })
      .catch((e) => console.warn('Save queue error', e))
  }, [])

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

  const hasRunningCrawl = crawls.some((c) => c.status === 'running')
  // Poll only when Home or Downloads is active and page visible; slower interval to avoid rate limits
  useEffect(() => {
    fetchCrawls()
    fetchFiles()
    const isRelevant = activeTab === 'home' || activeTab === 'downloads'
    if (!isRelevant) return
    const intervalMs = hasRunningCrawl ? 4000 : 8000
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchCrawls()
      fetchFiles()
    }, intervalMs)
    return () => clearInterval(t)
  }, [activeTab, hasRunningCrawl, fetchCrawls, fetchFiles])

  // Clear "searching" state when we have files for this URL or crawl finished
  useEffect(() => {
    if (!pendingSearchUrl) return
    const crawlDone = crawls.some((c) => c.url === pendingSearchUrl && (c.status === 'completed' || c.status === 'failed'))
    const hasFilesForUrl = files.some((f) => f.crawlUrl === pendingSearchUrl)
    if (crawlDone || hasFilesForUrl) setPendingSearchUrl(null)
  }, [pendingSearchUrl, crawls, files])

  // Sync history with crawl results (most recent crawl per URL)
  useEffect(() => {
    if (!dataLoaded) return
    let changed = false
    const next = historyEntries.map((e) => {
      const crawl = crawls.find((c) => c.url === e.url) // crawls are newest first
      if (!crawl) return e
      if (e.lastCrawlId === crawl.id && e.lastFileCount === crawl.fileCount && e.lastStatus === crawl.status) return e
      changed = true
      return { ...e, lastCrawlId: crawl.id, lastFileCount: crawl.fileCount, lastStatus: crawl.status }
    })
    if (changed) {
      setHistoryEntries(next)
      saveHistoryToApi(next)
    }
  }, [crawls, dataLoaded, historyEntries, saveHistoryToApi])

  function addHistoryEntryAndSave(entry: Omit<HistoryEntry, 'addedAt'>) {
    const newEntry: HistoryEntry = { ...entry, addedAt: Date.now() }
    const existing = historyEntries.findIndex((e) => e.url === entry.url)
    let next: HistoryEntry[]
    if (existing >= 0) {
      next = [...historyEntries]
      next[existing] = { ...newEntry, addedAt: historyEntries[existing]!.addedAt, title: historyEntries[existing]!.title || entry.title }
    } else {
      next = [newEntry, ...historyEntries]
    }
    setHistoryEntries(next)
    saveHistoryToApi(next)
  }

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
      addHistoryEntryAndSave({ id: randomUUID(), url, title: url, lastCrawlId: crawl.id, lastFileCount: 0, lastStatus: 'running' })
      setPendingSearchUrl(url)
      handleTabChange('downloads')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start crawl')
    } finally {
      setLoading(false)
    }
  }

  function startCrawlByUrl(url: string) {
    setInputUrl(url)
    setError(null)
    setLoading(true)
    fetch(`${API}/crawls?url=${encodeURIComponent(url)}`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      })
      .then((crawl) => {
        setCrawls((prev) => [crawl, ...prev])
        addHistoryEntryAndSave({ id: randomUUID(), url, title: url, lastCrawlId: crawl.id, lastFileCount: 0, lastStatus: 'running' })
        setPendingSearchUrl(url)
        handleTabChange('downloads')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to start crawl'))
      .finally(() => setLoading(false))
  }

  const [selectedQuality, setSelectedQuality] = useState<Record<string, number>>({})
  const [selectedFormat, setSelectedFormat] = useState<Record<string, string>>({})

  function getDownloadUrl(file: FoundFile, qualityIndex?: number): string {
    const q = file.qualities && file.qualities.length > 0
      ? file.qualities[qualityIndex ?? selectedQuality[file.id] ?? 0]
      : null
    return (q && q.url) || file.url
  }

  function suggestDownloadFilename(file: FoundFile): string {
    const name = (file.title || 'download').trim()
    const ext = getExtensionForFile(file)
    const base = applyNamingTemplate(settings.namingTemplate, name, ext)
    return ext ? `${base}.${ext}` : base
  }

  function getOutputFormat(file: FoundFile): string {
    return selectedFormat[file.id] ?? settings.defaultFormats[file.type] ?? (file.type === 'video' ? 'mp4' : file.type === 'audio' ? 'mp3' : 'png')
  }

  function getExtensionForFile(file: FoundFile): string {
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

  const setProgress = useCallback((fileId: string, patch: Partial<ProgressState> | null) => {
    if (patch === null) {
      setDownloadProgress((prev) => {
        const next = { ...prev }
        delete next[fileId]
        return next
      })
      return
    }
    setDownloadProgress((prev) => {
      const current = prev[fileId] ?? { phase: 'downloading' as const, progress: null, bytes: 0 }
      return { ...prev, [fileId]: { ...current, ...patch } }
    })
  }, [])

  async function performDownload(file: FoundFile) {
    const filename = suggestDownloadFilename(file)
    const useYtDlp = file.source === 'yt-dlp' && file.crawlUrl && (file.type === 'video' || file.type === 'audio')
    const qualityIndex = selectedQuality[file.id] ?? settings.defaultQualityIndex ?? 0
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

    const expectProgressStream = useYtDlp && file.type === 'video'
    try {
      setProgress(file.id, { phase: 'downloading', progress: null, bytes: 0 })
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
      let lastBytesReport = 0
      const decoder = new TextDecoder('utf-8')

      function processStreamingChunk(data: Uint8Array): Uint8Array {
        if (fileSizeFromStream == null || fileSizeFromStream <= 0) return data
        const rem = fileSizeFromStream - fileReceived
        const take = Math.min(rem, data.length)
        if (take > 0) {
          fileChunks.push(take === data.length ? data : data.subarray(0, take))
          fileReceived += take
          const pct = Math.min(100, Math.round((fileReceived / fileSizeFromStream) * 100))
          if (pct !== lastPct) {
            lastPct = pct
            setProgress(file.id, { phase: 'streaming', progress: pct, bytes: 0 })
          }
        }
        return data.length > take ? data.subarray(take) : new Uint8Array(0)
      }

      for (;;) {
        const { done, value } = await reader.read()
        const hasValue = value && value.length > 0

        if (expectProgressStream && fileSizeFromStream == null) {
          if (hasValue) {
            const combined = new Uint8Array(buffer.length + value!.length)
            combined.set(buffer)
            combined.set(value!, buffer.length)
            buffer = combined
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
                setProgress(file.id, { phase: phase as ProgressState['phase'], progress: null, bytes: 0 })
                if (phase === 'streaming' && typeof size === 'number' && size > 0) {
                  fileSizeFromStream = size
                  totalNum = size
                  buffer = processStreamingChunk(buffer)
                }
              }
            } catch {
              /* ignore parse errors */
            }
            newlineIdx = buffer.indexOf(0x0a)
          }
        } else if (fileSizeFromStream != null && (hasValue || buffer.length > 0)) {
          if (hasValue && buffer.length > 0) {
            const combined = new Uint8Array(buffer.length + value!.length)
            combined.set(buffer)
            combined.set(value!, buffer.length)
            buffer = combined
          } else if (hasValue) {
            buffer = value!
          }
          buffer = processStreamingChunk(buffer)
        } else if (!expectProgressStream && hasValue) {
          chunks.push(value!)
          const totalReceived = chunks.reduce((a, c) => a + c.length, 0)
          if (totalNum > 0) {
            const pct = Math.min(100, Math.round((totalReceived / totalNum) * 100))
            if (pct !== lastPct) {
              lastPct = pct
              setProgress(file.id, { phase: 'streaming', progress: pct, bytes: totalReceived })
            }
          } else {
            if (lastBytesReport === 0 || totalReceived - lastBytesReport >= 1024 * 100) {
              lastBytesReport = totalReceived
              setProgress(file.id, { phase: 'streaming', progress: null, bytes: totalReceived })
            }
          }
        }

        if (done) break
      }

      if (expectProgressStream && fileSizeFromStream != null && buffer.length > 0) {
        const rem = fileSizeFromStream - fileReceived
        if (rem > 0) fileChunks.push(buffer.slice(0, Math.min(rem, buffer.length)))
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
      setActiveDownloadIds((prev) => prev.filter((id) => id !== file.id))
      setDownloadQueue((prev) => {
        const next = prev.filter((f) => f.id !== file.id)
        saveQueueToApi(next)
        return next
      })
      setProgress(file.id, null)
    }
  }

  function addToQueue(file: FoundFile) {
    setDownloadQueue((prev) => {
      if (prev.some((f) => f.id === file.id)) return prev
      const next = [...prev, file]
      saveQueueToApi(next)
      return next
    })
  }

  function removeFromQueue(fileId: string) {
    setDownloadQueue((prev) => {
      const next = prev.filter((f) => f.id !== fileId)
      saveQueueToApi(next)
      return next
    })
  }

  useEffect(() => {
    const waiting = downloadQueue.filter((f) => !activeDownloadIds.includes(f.id))
    const slots = queueConcurrency - activeDownloadIds.length
    if (slots <= 0 || waiting.length === 0) return
    const toStart = waiting.slice(0, slots)
    setActiveDownloadIds((prev) => [...prev, ...toStart.map((f) => f.id)])
    toStart.forEach((file) => performDownload(file))
  }, [downloadQueue, activeDownloadIds.length, queueConcurrency])

  /** Label for Queue page only: shows phase and progress/bytes */
  function queueItemLabel(fileId: string): string {
    const prog = downloadProgress[fileId]
    if (!prog) return 'Queued'
    if (prog.phase === 'downloading') return 'Downloading'
    if (prog.phase === 'converting') return 'Converting'
    if (prog.phase === 'streaming' && prog.progress != null) return `${prog.progress}%`
    if (prog.phase === 'streaming' && prog.bytes > 0) return `${(prog.bytes / 1024 / 1024).toFixed(1)} MB`
    if (prog.phase === 'streaming') return 'Sending'
    if (prog.bytes > 0) return `${(prog.bytes / 1024 / 1024).toFixed(1)} MB`
    return prog.phase
  }

  /** Label for Downloads page button only: never show progress, just Add to queue / In queue */
  function downloadButtonLabel(fileId: string): string {
    return downloadQueue.some((f) => f.id === fileId) ? 'In queue' : 'Add to queue'
  }

  function handleThemeChange(t: Theme) {
    setTheme(t)
    applyTheme(t)
  }

  return (
    <div className="app-layout" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 960, margin: '0 auto', padding: '0 20px' }}>
      <Header activeTab={activeTab} onTab={handleTabChange} downloadCount={files.length} queueCount={downloadQueue.length} />
      <main style={{ flex: 1, padding: '24px 0', overflow: 'hidden' }} className="main-content">
        <div key={activeTab} className={`tab-content tab-content-enter tab-content-enter-${tabDirection}`}>
        {activeTab === 'home' && (
          <>
            <Hero />
            <UrlInput
              value={inputUrl}
              onChange={setInputUrl}
              onSubmit={startCrawl}
              loading={loading}
              error={error}
            />
            <DownloadTypeCards />
          </>
        )}
        {activeTab === 'downloads' && (
          <FileList
              files={files}
              pendingSearchUrl={pendingSearchUrl}
              selectedQuality={selectedQuality}
              setSelectedQuality={setSelectedQuality}
              selectedFormat={selectedFormat}
              setSelectedFormat={setSelectedFormat}
              downloadError={downloadError}
              getDownloadUrl={getDownloadUrl}
              getOutputFormat={getOutputFormat}
              getExtensionForFile={getExtensionForFile}
              suggestDownloadFilename={suggestDownloadFilename}
              downloadButtonLabel={downloadButtonLabel}
              onDownload={addToQueue}
              defaultQualityIndex={settings.defaultQualityIndex}
            />
        )}
        {activeTab === 'queue' && (
          <DownloadQueueStrip
            queue={downloadQueue}
            activeIds={activeDownloadIds}
            progress={downloadProgress}
            onRemove={removeFromQueue}
            getLabel={queueItemLabel}
            fullPage
          />
        )}
        {activeTab === 'history' && (
          <HistoryList
            entries={historyEntries}
            onUpdateTitle={(id, title) => {
              const next = historyEntries.map((e) => (e.id === id ? { ...e, title } : e))
              setHistoryEntries(next)
              saveHistoryToApi(next)
            }}
            onDelete={(id) => {
              const next = historyEntries.filter((e) => e.id !== id)
              setHistoryEntries(next)
              saveHistoryToApi(next)
            }}
            onReCrawl={(url) => startCrawlByUrl(url)}
          />
        )}
        {activeTab === 'settings' && (
          <Settings
            settings={settings}
            theme={theme}
            onThemeChange={(t) => {
              handleThemeChange(t)
              const next = { ...settings, theme: t }
              setSettings(next)
              saveSettingsToApi(next)
            }}
            onClearHistory={() => {
              setHistoryEntries([])
              saveHistoryToApi([])
            }}
            onSettingsChange={(s) => {
              setSettings(s)
              saveSettingsToApi(s)
            }}
          />
        )}
        {activeTab === 'about' && <About />}
        </div>
      </main>
    </div>
  )
}
