export type Crawl = {
  id: string
  url: string
  status: 'running' | 'completed' | 'failed'
  fileCount: number
  error: string | null
}

export type Quality = { url: string; label: string; format_id?: string | null }

export type FoundFile = {
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

export type HistoryEntry = {
  id: string
  url: string
  title: string
  addedAt: number
  lastCrawlId?: string
  lastFileCount?: number
  lastStatus?: 'running' | 'completed' | 'failed'
}

export type Theme = 'light' | 'dark' | 'system'
