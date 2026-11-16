import { cleanTitle, normalizeForMatch, primaryArtist } from '../lyrics/normalize'

export interface ArtworkQuery {
  track: string
  artist: string
  album?: string
  durationMs?: number
  providerArtworkUrl?: string | null
}

export interface ArtworkMetadata {
  trackName?: string
  artistName?: string
  collectionName?: string
  releaseDate?: string
  primaryGenreName?: string
  country?: string
}

export interface ArtworkResult {
  url: string | null
  source: 'itunes' | 'provider' | 'none'
  confidence: number
  matchType?: string
  metadata?: ArtworkMetadata | null
  cached?: boolean
}

export interface ArtworkServiceOptions {
  proxyUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
  log?: (msg: string) => void
  country?: string
}

const ITUNES_BASE_URL = 'https://itunes.apple.com/search'
const DEFAULT_TIMEOUT_MS = 6000

export function upgradeArtworkUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('mzstatic.com')) return url
    return url.replace(/\/(\d+)x(\d+)(bb|wa)?(-[a-z0-9]+)?\.(jpg|png|webp)$/i, (_m, _w, _h, kind, _extra, ext) => {
      const suffix = kind || 'bb'
      return `/1200x1200${suffix}.${ext}`
    })
  } catch {
    return url
  }
}

export interface CandidateScore {
  confidence: number
  matchType: string
}

export function scoreCandidate(
  query: { track: string; artist: string; album?: string; durationMs?: number },
  candidate: {
    trackName?: string
    artistName?: string
    collectionName?: string
    trackTimeMillis?: number
  }
): CandidateScore {
  const qTitle = normalizeForMatch(cleanTitle(query.track))
  const cTitle = normalizeForMatch(cleanTitle(candidate.trackName || ''))
  const qArtist = normalizeForMatch(primaryArtist(query.artist))
  const cArtist = normalizeForMatch(primaryArtist(candidate.artistName || ''))

  if (!qTitle || !cTitle || !qArtist || !cArtist) return { confidence: 0, matchType: 'none' }

  let titleScore = 0
  if (qTitle === cTitle) {
    titleScore = 45
  } else if (qTitle.includes(cTitle) || cTitle.includes(qTitle)) {
    titleScore = 32
  } else {
    const qWords = qTitle.split(' ')
    const cWords = cTitle.split(' ')
    const shared = qWords.filter((w) => cWords.includes(w))
    const ratio = shared.length / Math.max(qWords.length, cWords.length)
    if (ratio >= 0.6) {
      titleScore = Math.round(30 * ratio)
    } else {
      return { confidence: 0, matchType: 'none' }
    }
  }

  let artistScore = 0
  const fullQArtist = normalizeForMatch(query.artist)
  const fullCArtist = normalizeForMatch(candidate.artistName || '')
  if (qArtist === cArtist || fullQArtist === fullCArtist) {
    artistScore = 35
  } else if (fullCArtist.includes(qArtist) || fullQArtist.includes(cArtist)) {
    artistScore = 30
  } else {
    const aWords = fullQArtist.split(' ')
    const bWords = fullCArtist.split(' ')
    const sharedA = aWords.filter((w) => bWords.includes(w))
    if (sharedA.length >= 1 && sharedA.length / Math.max(aWords.length, bWords.length) >= 0.5) {
      artistScore = 25
    } else {
      return { confidence: 0, matchType: 'none' }
    }
  }

  let albumScore = 10
  if (query.album && query.album.trim()) {
    const qAlb = normalizeForMatch(cleanTitle(query.album))
    const cAlb = normalizeForMatch(cleanTitle(candidate.collectionName || ''))
    if (qAlb && cAlb) {
      if (qAlb === cAlb) albumScore = 15
      else if (qAlb.includes(cAlb) || cAlb.includes(qAlb)) albumScore = 12
      else albumScore = 2
    }
  }

  let durScore = 0
  const queryDurationMs = query.durationMs || 0
  if (queryDurationMs > 0 && candidate.trackTimeMillis && candidate.trackTimeMillis > 0) {
    const diff = Math.abs(queryDurationMs - candidate.trackTimeMillis)
    if (diff <= 4000) durScore = 5
    else if (diff <= 10000) durScore = 3
    else if (diff > 60000) durScore = -15
  }

  let penalty = 0
  const qIsLive = /\blive\b/i.test(query.track + ' ' + (query.album || ''))
  const cIsLive = /\blive\b/i.test((candidate.trackName || '') + ' ' + (candidate.collectionName || ''))
  if (!qIsLive && cIsLive) penalty += 15

  const cIsKaraoke = /\b(karaoke|tribute|in the style of|originally performed by)\b/i.test(
    (candidate.trackName || '') + ' ' + (candidate.artistName || '')
  )
  if (cIsKaraoke) penalty += 60

  const total = Math.max(0, titleScore + artistScore + albumScore + durScore - penalty)
  const confidence = Math.round((total / 100) * 100) / 100

  let matchType = 'low'
  if (confidence >= 0.9) matchType = 'exact'
  else if (confidence >= 0.75) matchType = 'high'
  else if (confidence >= 0.65) matchType = 'fuzzy'

  return { confidence, matchType }
}

export class ArtworkService {
  private readonly proxyUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly country: string
  private readonly log: (msg: string) => void
  private readonly cache = new Map<string, { result: ArtworkResult; expires: number }>()
  private readonly inFlight = new Map<string, Promise<ArtworkResult>>()

  constructor(opts: ArtworkServiceOptions = {}) {
    this.proxyUrl = (opts.proxyUrl ?? process.env.BETTER_LYRICS_PROXY_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
    this.fetchImpl = opts.fetch ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.country = (opts.country ?? process.env.ITUNES_COUNTRY ?? 'IN').trim().toUpperCase()
    this.log = opts.log ?? (() => {})
  }

  async getArtwork(query: ArtworkQuery): Promise<ArtworkResult> {
    const track = cleanTitle(query.track || '').trim()
    const artist = primaryArtist(query.artist || '').trim()
    const album = query.album ? cleanTitle(query.album).trim() : ''
    const providerArtworkUrl = query.providerArtworkUrl || null

    if (!track || !artist) {
      if (providerArtworkUrl) {
        return {
          url: providerArtworkUrl,
          source: 'provider',
          confidence: 0.6,
          matchType: 'provider_fallback',
          metadata: null
        }
      }
      return {
        url: null,
        source: 'none',
        confidence: 0,
        matchType: 'missing_parameters',
        metadata: null
      }
    }

    const cacheKey = JSON.stringify([normalizeForMatch(track), normalizeForMatch(artist), normalizeForMatch(album)])

    const cached = this.cache.get(cacheKey)
    if (cached) {
      if (cached.expires >= Date.now()) {
        return { ...cached.result, cached: true }
      }
      this.cache.delete(cacheKey)
    }

    let pending = this.inFlight.get(cacheKey)
    if (!pending) {
      pending = this.executeLookup({ track, artist, album, durationMs: query.durationMs, providerArtworkUrl })
        .then((res) => {
          const ttl = res.url ? 24 * 60 * 60 * 1000 : 60 * 1000
          if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value!)
          this.cache.set(cacheKey, { result: res, expires: Date.now() + ttl })
          return res
        })
        .finally(() => {
          this.inFlight.delete(cacheKey)
        })
      this.inFlight.set(cacheKey, pending)
    }

    return await pending
  }

  private async executeLookup(query: ArtworkQuery): Promise<ArtworkResult> {
    // 1. Try centralized backend proxy endpoint first
    try {
      const params = new URLSearchParams({
        track: query.track,
        artist: query.artist
      })
      if (query.album) params.set('album', query.album)
      if (query.durationMs && query.durationMs > 0) {
        params.set('duration', String(Math.round(query.durationMs / 1000)))
      }
      if (query.providerArtworkUrl) params.set('providerArtworkUrl', query.providerArtworkUrl)
      if (this.country) params.set('country', this.country)

      const backendUrl = `${this.proxyUrl}/api/artwork?${params}`
      const res = await this.fetchImpl(backendUrl, {
        headers: { Accept: 'application/json', 'User-Agent': 'theaestheticslyrics/1.2' },
        signal: AbortSignal.timeout(this.timeoutMs)
      })

      if (res.ok) {
        const body = (await res.json()) as ArtworkResult
        if (body && typeof body === 'object') {
          this.log(`artwork: backend returned ${body.source} (confidence ${body.confidence}) for "${query.track}"`)
          return body
        }
      }
    } catch (_err) {
      // Backend not running on proxyUrl (e.g. standalone app); fall back to direct iTunes provider
    }

    // 2. Direct Apple iTunes Search API lookup with candidate matching
    try {
      const itunesResult = await this.searchItunesDirect(query)
      if (itunesResult && itunesResult.url) {
        this.log(`artwork: iTunes matched (confidence ${itunesResult.confidence}) for "${query.track}"`)
        return itunesResult
      }
    } catch (err) {
      this.log(`artwork: iTunes search failed (${String(err)})`)
    }

    // 3. Fallback to existing playback-provider artwork
    if (query.providerArtworkUrl) {
      this.log(`artwork: using provider thumbnail fallback for "${query.track}"`)
      return {
        url: query.providerArtworkUrl,
        source: 'provider',
        confidence: 0.6,
        matchType: 'provider_fallback',
        metadata: null
      }
    }

    return {
      url: null,
      source: 'none',
      confidence: 0,
      matchType: 'not_found',
      metadata: null
    }
  }

  private async searchItunesDirect(query: ArtworkQuery): Promise<ArtworkResult | null> {
    const term = [query.track, query.artist, query.album].filter(Boolean).join(' ')
    const params = new URLSearchParams({
      term,
      entity: 'song',
      media: 'music',
      country: this.country,
      limit: '10'
    })

    const res = await this.fetchImpl(`${ITUNES_BASE_URL}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'theaestheticslyrics/1.2' },
      signal: AbortSignal.timeout(this.timeoutMs)
    })

    if (!res.ok) return null
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
    if (!data || !Array.isArray(data.results) || data.results.length === 0) return null

    let best: Record<string, unknown> | null = null
    let bestScore: CandidateScore | null = null

    for (const item of data.results) {
      const score = scoreCandidate(
        {
          track: query.track,
          artist: query.artist,
          album: query.album,
          durationMs: query.durationMs
        },
        {
          trackName: String(item.trackName || ''),
          artistName: String(item.artistName || ''),
          collectionName: String(item.collectionName || ''),
          trackTimeMillis: Number(item.trackTimeMillis || 0)
        }
      )

      if (score.confidence >= 0.65) {
        if (!bestScore || score.confidence > bestScore.confidence) {
          best = item
          bestScore = score
        }
      }
    }

    if (!best || !bestScore) return null

    const rawUrl = String(
      best.artworkUrl1024 ||
        best.artworkUrl600 ||
        best.artworkUrl512 ||
        best.artworkUrl100 ||
        best.artworkUrl60 ||
        ''
    )
    if (!rawUrl) return null

    const hiResUrl = upgradeArtworkUrl(rawUrl)
    return {
      url: hiResUrl,
      source: 'itunes',
      confidence: bestScore.confidence,
      matchType: bestScore.matchType,
      metadata: {
        trackName: String(best.trackName || ''),
        artistName: String(best.artistName || ''),
        collectionName: String(best.collectionName || ''),
        releaseDate: String(best.releaseDate || ''),
        primaryGenreName: String(best.primaryGenreName || ''),
        country: String(best.country || '')
      }
    }
  }
}
