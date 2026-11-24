import type { TimedLyrics, TimedWord } from '@shared/types'
import { parseTtmlLines, ttmlToTimedLyrics } from './betterlyrics'
import type { ParsedLine } from './lrc'
import { parseLrc } from './lrc'
import type { FetchLike } from './lrclib'
import type { TrackQuery } from './match'
import { cleanTitle, primaryArtist } from './normalize'
import { buildTimedLyrics, flattenOverlaps } from './word-timing'

/**
 * Better Lyrics Portato provides word-level and syllable-level synchronized lyrics
 * sourced through the Better Lyrics QQ Music/Portato relay.
 *
 * Supported formats:
 * - QRC: `[lineStart,lineDuration]Word1(wordStart,wordDuration)Word2(wordStart,wordDuration)`
 * - TTML: Apple-Music-style syllable-timed TTML served by the Portato endpoint
 * - Enhanced LRC fallback
 */

export interface PortatoRecord {
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  qrc?: string
  ttml?: string
  lyrics?: string
  format?: 'qrc' | 'ttml' | 'lrc'
}

export type PortatoResult =
  | { status: 'found'; lyrics: TimedLyrics; rawPayload: string; format: 'qrc' | 'ttml' | 'lrc'; score?: number }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

export interface PortatoOptions {
  fetch?: FetchLike
  timeoutMs?: number
  baseUrl?: string
  proxyUrl?: string
  apiKey?: string
  userAgent?: string
}

const DEFAULT_BASE_URL = 'https://api.betterlyrics.org'
const DEFAULT_TIMEOUT_MS = 5000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const envOrUndefined = (name: string): string | undefined => {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity.toLowerCase()] ?? whole
  })
}

/* ---------------------------------------------------------------------------------------
 * QRC Parsing
 * ------------------------------------------------------------------------------------- */

const QRC_LINE_RE = /^\[(\d+),(\d+)(?:,\d+)?\](.*)$/
const QRC_PREFIX_WORD_RE = /(?:\(|\<)(\d+),(\d+)(?:,\d+)?(?:\)|\>)([^()<]*)/g
const QRC_POSTFIX_WORD_RE = /([^()<]+)(?:\(|\<)(\d+),(\d+)(?:,\d+)?(?:\)|\>)/g
const QRC_TAG_RE = /^\[([a-z#][\w#]*):(.*)\]$/i

/**
 * Extracts QRC text if embedded in an XML wrapper like `<Lyric_1 ... LyricContent="..."/>`.
 */
export function extractQrcText(raw: string): string {
  if (typeof raw !== 'string') return ''
  // Look for LyricContent="..." attribute
  const contentMatch = /LyricContent\s*=\s*["']([^"']+)["']/i.exec(raw)
  if (contentMatch) {
    return decodeXmlEntities(contentMatch[1]!)
  }
  // Look for CDATA
  const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(raw)
  if (cdataMatch) {
    return cdataMatch[1]!
  }
  return raw
}

/**
 * Parses QRC text into `ParsedLine[]` with native word timestamps.
 */
export function parseQrcLines(qrcText: string): ParsedLine[] | null {
  const text = extractQrcText(qrcText).trim()
  if (!text) return null

  // If text is TTML, delegate to TTML parser
  if (text.includes('<p') && (text.includes('<tt') || text.includes('begin='))) {
    return parseTtmlLines(text)
  }

  const rawLines = text.split(/\r?\n/)
  const lines: ParsedLine[] = []
  let offsetMs = 0

  for (const raw of rawLines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Check for [offset:xxx] metadata
    const tagMatch = QRC_TAG_RE.exec(trimmed)
    if (tagMatch) {
      if (tagMatch[1]!.toLowerCase() === 'offset') {
        const parsedOffset = Number.parseInt(tagMatch[2]!, 10)
        if (Number.isFinite(parsedOffset)) offsetMs = parsedOffset
      }
      continue
    }

    const lineMatch = QRC_LINE_RE.exec(trimmed)
    if (!lineMatch) continue

    const lineStart = Number(lineMatch[1]!) + offsetMs
    const lineDuration = Number(lineMatch[2]!)
    const lineEnd = lineStart + lineDuration
    const rest = lineMatch[3] ?? ''

    // Parse words: prefix (start,dur)text or postfix text(start,dur)
    type RawPiece = { text: string; start: number; end: number }
    let rawPieces: RawPiece[] = []

    const prefixMatches = [...rest.matchAll(QRC_PREFIX_WORD_RE)]
    if (prefixMatches.length > 0) {
      rawPieces = prefixMatches.map((m) => {
        const wStart = Number(m[1]!) + offsetMs
        const wDuration = Number(m[2]!)
        return {
          text: decodeXmlEntities(m[3] ?? ''),
          start: wStart,
          end: wStart + wDuration
        }
      })
    } else {
      const postfixMatches = [...rest.matchAll(QRC_POSTFIX_WORD_RE)]
      if (postfixMatches.length > 0) {
        rawPieces = postfixMatches.map((m) => {
          const wStart = Number(m[2]!) + offsetMs
          const wDuration = Number(m[3]!)
          return {
            text: decodeXmlEntities(m[1] ?? ''),
            start: wStart,
            end: wStart + wDuration
          }
        })
      }
    }

    if (!rawPieces.length) {
      // Line-timed line without per-word timestamps
      const clean = rest.trim()
      if (clean) {
        lines.push({
          start: lineStart,
          end: lineEnd,
          text: clean
        })
      }
      continue
    }

    const words: TimedWord[] = []
    let currentWord: { text: string; start: number; end: number } | null = null

    for (let i = 0; i < rawPieces.length; i++) {
      const piece = rawPieces[i]!
      const pieceRaw = piece.text
      const wStart = piece.start
      const wEnd = piece.end

      // Whitespace handling: words are separated by spaces or punctuation
      const hasLeadingSpace = /^\s/.test(pieceRaw)
      const hasTrailingSpace = /\s$/.test(pieceRaw)
      const cleanPiece = pieceRaw.trim()
      const isCjk = /[\u4e00-\u9fa5\u3040-\u30ff]/.test(cleanPiece)

      if (!cleanPiece) continue

      if ((hasLeadingSpace || isCjk) && currentWord) {
        words.push({ ...currentWord, text: currentWord.text.trim() })
        currentWord = null
      }

      if (currentWord) {
        // Syllable continuation
        currentWord.text += cleanPiece
        currentWord.end = Math.max(currentWord.end, wEnd)
      } else {
        currentWord = { text: cleanPiece, start: wStart, end: wEnd }
      }

      if ((hasTrailingSpace || isCjk) && currentWord) {
        words.push({ ...currentWord, text: currentWord.text.trim() })
        currentWord = null
      }
    }

    if (currentWord) {
      words.push({ ...currentWord, text: currentWord.text.trim() })
    }

    const lineText = words
      .map((w) => w.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (lineText) {
      lines.push({
        start: lineStart,
        end: lineEnd,
        text: lineText,
        words: words.length > 0 ? words : undefined
      })
    }
  }

  return lines.length ? flattenOverlaps(lines) : null
}

/**
 * Converts a Portato payload (QRC, TTML, or LRC) into `TimedLyrics`.
 */
export function portatoToTimedLyrics(payload: string, durationMs = 0): TimedLyrics | null {
  if (!payload || typeof payload !== 'string') return null
  const trimmed = payload.trim()

  // 1. TTML
  if (trimmed.includes('<p') && (trimmed.includes('<tt') || trimmed.includes('begin='))) {
    return ttmlToTimedLyrics(trimmed, durationMs)
  }

  // 2. QRC
  if (trimmed.includes('[') && (trimmed.includes('(') || /\[\d+,\d+\]/.test(trimmed))) {
    const lines = parseQrcLines(trimmed)
    if (lines && lines.length > 0) {
      return buildTimedLyrics(lines, durationMs > 0 ? durationMs : undefined)
    }
  }

  // 3. LRC fallback
  const lrcLines = parseLrc(trimmed)
  if (lrcLines.length > 0) {
    return buildTimedLyrics(lrcLines, durationMs > 0 ? durationMs : undefined)
  }

  return null
}

/* ---------------------------------------------------------------------------------------
 * Better Lyrics Portato Client
 * ------------------------------------------------------------------------------------- */

export class BetterLyricsPortatoClient {
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly userAgent: string
  private readonly path: string

  constructor(opts: PortatoOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.userAgent = opts.userAgent ?? 'theaestheticslyrics'

    const proxy = (opts.proxyUrl ?? envOrUndefined('BETTER_LYRICS_PROXY_URL') ?? '').trim()
    const base =
      proxy ||
      opts.baseUrl ||
      envOrUndefined('BETTER_LYRICS_PORTATO_API_URL') ||
      envOrUndefined('PORTATO_API_URL') ||
      envOrUndefined('BETTER_LYRICS_API_URL') ||
      DEFAULT_BASE_URL

    this.baseUrl = base.replace(/\/$/, '')
    this.path = proxy ? '/api/portato' : '/qq/getLyrics'
    this.apiKey = proxy ? '' : (opts.apiKey ?? envOrUndefined('BETTER_LYRICS_API_KEY') ?? '').trim()
  }

  async find(q: TrackQuery): Promise<PortatoResult> {
    const song = cleanTitle(q.title).trim()
    const artist = primaryArtist(q.artist).trim()
    if (!song || !artist) return { status: 'not-found' }

    const params = new URLSearchParams({ song, artist, s: song, a: artist })
    if (q.album.trim()) {
      params.set('album', q.album.trim())
      params.set('al', q.album.trim())
    }
    if (q.durationMs > 0) {
      const durSec = String(Math.round(q.durationMs / 1000))
      params.set('duration', durSec)
      params.set('dur', durSec)
    }

    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': this.userAgent
    }
    if (this.apiKey) headers['X-API-Key'] = this.apiKey

    try {
      const url = `${this.baseUrl}${this.path}?${params}`
      let res = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs)
      })

      // If /qq/getLyrics returned 404 and we're not on proxy, retry with /getLyrics?source=portato
      if (res.status === 404 && this.path === '/qq/getLyrics') {
        try {
          const altParams = new URLSearchParams(params)
          altParams.set('source', 'portato')
          const altRes = await this.fetchImpl(`${this.baseUrl}/getLyrics?${altParams}`, {
            headers,
            signal: AbortSignal.timeout(this.timeoutMs)
          })
          if (altRes.ok || altRes.status !== 404) {
            res = altRes
          }
        } catch {
          // If fallback lookup fails or is not mocked, keep original 404
        }
      }

      if (res.status === 404) return { status: 'not-found' }
      if (res.status === 401) return { status: 'error', message: 'API key required (cache miss)' }
      if (res.status === 422) return { status: 'error', message: 'invalid query' }
      if (res.status === 429) return { status: 'error', message: 'rate limited' }
      if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` }

      // Content may be JSON, an object, or text
      let body: unknown
      let rawPayload = ''
      let format: 'qrc' | 'ttml' | 'lrc' = 'qrc'
      let score: number | undefined

      try {
        const textFn = (res as unknown as { text?: () => Promise<string> }).text
        if (typeof textFn === 'function') {
          const raw = await textFn.call(res)
          try {
            body = JSON.parse(raw)
          } catch {
            rawPayload = raw
          }
        } else {
          body = await res.json()
        }
      } catch {
        return { status: 'error', message: 'unreadable reply' }
      }

      if (typeof body === 'string') {
        rawPayload = body
      } else if (isRecord(body)) {
        if (typeof body.score === 'number') score = body.score

        if (typeof body.qrc === 'string' && body.qrc.trim()) {
          rawPayload = body.qrc
          format = 'qrc'
        } else if (typeof body.ttml === 'string' && body.ttml.trim()) {
          rawPayload = body.ttml
          format = 'ttml'
        } else if (typeof body.lyrics === 'string' && body.lyrics.trim()) {
          rawPayload = body.lyrics
          format = body.format === 'ttml' ? 'ttml' : body.format === 'lrc' ? 'lrc' : 'qrc'
        } else if (isRecord(body.data)) {
          const d = body.data
          if (typeof d.lyrics === 'string') rawPayload = d.lyrics
          else if (typeof d.qrc === 'string') rawPayload = d.qrc
          else if (typeof d.ttml === 'string') rawPayload = d.ttml
          format = d.format === 'ttml' ? 'ttml' : d.format === 'lrc' ? 'lrc' : 'qrc'
        }
      }

      if (!rawPayload.trim()) return { status: 'not-found' }

      if (rawPayload.includes('<tt') || rawPayload.includes('<p begin=')) format = 'ttml'
      else if (rawPayload.includes('[00:') || rawPayload.includes('[01:')) format = 'lrc'

      if (!rawPayload.trim()) return { status: 'not-found' }

      const lyrics = portatoToTimedLyrics(rawPayload, q.durationMs)
      if (!lyrics) return { status: 'not-found' }

      return {
        status: 'found',
        lyrics,
        rawPayload,
        format,
        ...(typeof score === 'number' ? { score } : {})
      }
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }
}
