import type { TimedLyrics, TimedWord } from '@shared/types'
import { parseTtmlLines, ttmlToTimedLyrics } from './betterlyrics'
import type { ParsedLine } from './lrc'
import { parseLrc } from './lrc'
import type { FetchLike } from './lrclib'
import type { TrackQuery } from './match'
import { cleanTitle, primaryArtist } from './normalize'
import { parseQrcLines } from './portato'
import { buildTimedLyrics } from './word-timing'

/**
 * Synchronization quality tiers:
 * 1. Syllable-synchronized (richsync / TTML syllable spans)
 * 2. Word-synchronized (word-level timestamps)
 * 3. Line-synchronized (line timestamps)
 * 4. Unsynchronized (plain text fallback, no timestamps fabricated)
 */
export type SyncQuality = 'syllable' | 'word' | 'line' | 'unsynced'

export function syncQualityScore(quality: SyncQuality | undefined | null): number {
  switch (quality) {
    case 'syllable':
      return 4
    case 'word':
      return 3
    case 'line':
      return 2
    case 'unsynced':
      return 1
    default:
      return 0
  }
}

export interface UnisonEntry {
  id?: number | string
  song?: string
  artist?: string
  album?: string
  lyrics?: string
  format?: 'ttml' | 'lrc' | 'plain' | 'qrc'
  syncType?: 'richsync' | 'word' | 'line' | 'unsynced'
  confidence?: 'high' | 'medium' | 'low'
  curator?: string
  submitter?: string
}

export type UnisonResult =
  | {
      status: 'found'
      lyrics: TimedLyrics
      syncQuality: SyncQuality
      rawPayload: string
      attribution: {
        name: string
        id?: number | string
        submitter?: string
        syncType?: string
        confidence?: string
      }
    }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

export interface UnisonOptions {
  fetch?: FetchLike
  timeoutMs?: number
  baseUrl?: string
  userAgent?: string
}

const DEFAULT_BASE_URL = 'https://unison.betterlyrics.org'
const DEFAULT_TIMEOUT_MS = 5000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const envOrUndefined = (name: string): string | undefined => {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/**
 * Parses plain (unsynchronized) text without fabricating timestamps.
 */
export function parseUnsyncedLines(text: string): ParsedLine[] {
  const rawLines = text.split(/\r?\n/)
  const lines: ParsedLine[] = []

  for (const raw of rawLines) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    // No timestamps fabricated; start and end set to 0
    lines.push({
      start: 0,
      end: 0,
      text: trimmed
    })
  }

  return lines
}

/**
 * Normalizes Unison lyrics into `TimedLyrics` while preserving the exact sync level.
 */
export function unisonToTimedLyrics(
  entry: UnisonEntry,
  durationMs = 0
): { lyrics: TimedLyrics; syncQuality: SyncQuality } | null {
  const raw = entry.lyrics?.trim()
  if (!raw) return null

  const format = entry.format?.toLowerCase()
  const syncType = entry.syncType?.toLowerCase()

  // 1. TTML / Richsync format
  if (format === 'ttml' || raw.includes('<tt') || raw.includes('<p begin=')) {
    const lyrics = ttmlToTimedLyrics(raw, durationMs)
    if (lyrics && lyrics.lines.length > 0) {
      const hasNativeWords = lyrics.wordTiming === 'native'
      const quality: SyncQuality = syncType === 'richsync' || hasNativeWords ? 'syllable' : 'line'
      return { lyrics, syncQuality: quality }
    }
  }

  // 2. QRC format
  if (format === 'qrc' || (/\[\d+,\d+\]/.test(raw) && raw.includes('('))) {
    const lines = parseQrcLines(raw)
    if (lines && lines.length > 0) {
      const lyrics = buildTimedLyrics(lines, durationMs > 0 ? durationMs : undefined)
      if (lyrics) {
        return { lyrics, syncQuality: 'word' }
      }
    }
  }

  // 3. LRC format (Line or Enhanced Word-LRC)
  if (format === 'lrc' || raw.includes('[00:') || raw.includes('[01:') || /\[\d{2}:\d{2}/.test(raw)) {
    const lines = parseLrc(raw)
    if (lines && lines.length > 0) {
      const lyrics = buildTimedLyrics(lines, durationMs > 0 ? durationMs : undefined)
      if (lyrics) {
        const hasNativeWords = lyrics.wordTiming === 'native'
        const quality: SyncQuality =
          syncType === 'richsync' ? 'syllable' : syncType === 'word' || hasNativeWords ? 'word' : 'line'
        return { lyrics, syncQuality: quality }
      }
    }
  }

  // 4. Unsynchronized fallback
  if (format === 'plain' || syncType === 'unsynced' || raw) {
    const lines = parseUnsyncedLines(raw)
    if (lines.length > 0) {
      const lyrics: TimedLyrics = {
        lines: lines.map((l) => ({
          text: l.text,
          start: 0,
          end: 0,
          words: []
        })),
        wordTiming: 'estimated',
        estimatedCount: lines.length
      }
      return { lyrics, syncQuality: 'unsynced' }
    }
  }

  return null
}

/* ---------------------------------------------------------------------------------------
 * Unison Client
 * ------------------------------------------------------------------------------------- */

export class UnisonClient {
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number
  private readonly baseUrl: string
  private readonly userAgent: string
  /** ETag cache for 304 Not Modified optimization */
  private readonly etags = new Map<string, string>()

  constructor(opts: UnisonOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.userAgent = opts.userAgent ?? 'theaestheticslyrics'

    const base =
      opts.baseUrl ||
      envOrUndefined('UNISON_API_URL') ||
      envOrUndefined('BETTER_LYRICS_UNISON_API_URL') ||
      DEFAULT_BASE_URL

    this.baseUrl = base.replace(/\/$/, '')
  }

  async find(q: TrackQuery): Promise<UnisonResult> {
    const song = cleanTitle(q.title).trim()
    const artist = primaryArtist(q.artist).trim()
    if (!song || !artist) return { status: 'not-found' }

    const params = new URLSearchParams({ song, artist })
    if (q.album.trim()) params.set('album', q.album.trim())
    if (q.durationMs > 0) params.set('duration', String(Math.round(q.durationMs / 1000)))

    const url = `${this.baseUrl}/lyrics?${params}`
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.userAgent
    }

    const cachedEtag = this.etags.get(url)
    if (cachedEtag) headers['If-None-Match'] = cachedEtag

    try {
      let res = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs)
      })

      // Search fallback if primary lookup is 404
      if (res.status === 404) {
        const searchUrl = `${this.baseUrl}/lyrics/search?q=${encodeURIComponent(`${song} ${artist}`)}`
        res = await this.fetchImpl(searchUrl, {
          headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs)
        })
      }

      if (res.status === 404) return { status: 'not-found' }
      if (res.status === 422) return { status: 'error', message: 'invalid query' }
      if (res.status === 429) return { status: 'error', message: 'rate limited' }
      if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` }

      let body: unknown
      try {
        const textFn = (res as unknown as { text?: () => Promise<string> }).text
        if (typeof textFn === 'function') {
          const raw = await textFn.call(res)
          body = JSON.parse(raw)
        } else {
          body = await res.json()
        }
      } catch {
        return { status: 'error', message: 'unreadable reply' }
      }

      let entry: UnisonEntry | null = null

      if (isRecord(body)) {
        if (body.success === true && isRecord(body.data)) {
          entry = body.data as UnisonEntry
        } else if (Array.isArray(body.data) && body.data.length > 0 && isRecord(body.data[0])) {
          entry = body.data[0] as UnisonEntry
        } else if (typeof body.lyrics === 'string') {
          entry = body as UnisonEntry
        }
      }

      if (!entry || !entry.lyrics?.trim()) return { status: 'not-found' }

      const converted = unisonToTimedLyrics(entry, q.durationMs)
      if (!converted) return { status: 'not-found' }

      return {
        status: 'found',
        lyrics: converted.lyrics,
        syncQuality: converted.syncQuality,
        rawPayload: entry.lyrics,
        attribution: {
          name: 'Unison',
          id: entry.id,
          submitter: entry.submitter ?? entry.curator,
          syncType: entry.syncType,
          confidence: entry.confidence
        }
      }
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }
}
