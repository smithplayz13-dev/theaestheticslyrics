#!/usr/bin/env node
/**
 * Minimal Better Lyrics proxy — zero dependencies, one file, Node 22+.
 *
 *   GET /api/lyrics?song=E85&artist=Don%20Toliver&album=OCTANE&duration=154
 *   GET /api/lyrics?title=E85&artist=Don%20Toliver           (aliases work)
 *   GET /health
 *
 * The key (if you ever get one) stays here, never in the browser bundle:
 *   BETTER_LYRICS_API_KEY=... npm run lyrics:server
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'
const UPSTREAM = (process.env.BETTER_LYRICS_API_URL ?? 'https://api.betterlyrics.org').replace(/\/$/, '')
const API_KEY = (process.env.BETTER_LYRICS_API_KEY ?? '').trim()
const TIMEOUT_MS = Number(process.env.BETTER_LYRICS_TIMEOUT_MS ?? 8000)
const CACHE_TTL_MS = Number(process.env.BETTER_LYRICS_CACHE_TTL_MS ?? 10 * 60 * 1000)
const NOT_FOUND_TTL_MS = 60 * 1000
const MAX_CACHE_ENTRIES = 200

const ARTWORK_CACHE_TTL_MS = Number(process.env.ARTWORK_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000)
const ARTWORK_NOT_FOUND_TTL_MS = 60 * 1000
const MAX_ARTWORK_CACHE_ENTRIES = 500
const ITUNES_DEFAULT_COUNTRY = (process.env.ITUNES_COUNTRY ?? 'IN').trim().toUpperCase()
const ITUNES_TIMEOUT_MS = Number(process.env.ITUNES_TIMEOUT_MS ?? 8000)
const ITUNES_BASE_URL = 'https://itunes.apple.com/search'

/** Successful and known-missing replies only. Errors are never cached. */
const cache = new Map()
const artworkCache = new Map()
const inFlightArtwork = new Map()

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Access-Control-Max-Age': '86400'
}

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers
  })
  res.end(payload)
}

/** First non-empty value among the accepted parameter aliases. */
function param(params, ...names) {
  for (const name of names) {
    const value = params.get(name)?.trim()
    if (value) return value
  }
  return ''
}

function upstreamHeader(upstream, name, target) {
  const value = upstream.headers.get(name)
  return value ? { [target]: value } : {}
}

function remember(key, entry) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  cache.set(key, entry)
}

function recall(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expires < Date.now()) {
    cache.delete(key)
    return null
  }
  return hit
}

async function askUpstream({ song, artist, album, duration }) {
  const query = new URLSearchParams({ s: song, a: artist })
  if (album) query.set('al', album)
  if (duration) query.set('d', duration)

  const headers = { Accept: 'application/json', 'User-Agent': 'theaestheticslyrics-proxy/1.0' }
  if (API_KEY) headers['X-API-Key'] = API_KEY

  const started = Date.now()
  const upstream = await fetch(`${UPSTREAM}/getLyrics?${query}`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const text = await upstream.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // A Cloudflare HTML error page is not JSON; handled by the caller.
  }
  return { upstream, data, elapsedMs: Date.now() - started }
}

async function handleLyrics(url, res) {
  const song = param(url.searchParams, 'song', 's', 'songName', 'title')
  const artist = param(url.searchParams, 'artist', 'a', 'artistName')
  const album = param(url.searchParams, 'album', 'al', 'albumName')
  const rawDuration = param(url.searchParams, 'duration', 'd')
  const seconds = Number(rawDuration)

  if (!song || !artist) {
    return send(res, 400, {
      error: 'missing_parameters',
      message: 'Send both "song" (or "s") and "artist" (or "a").'
    })
  }

  // An unusable duration must not break the lookup: it is only a matching hint.
  const duration = Number.isFinite(seconds) && seconds > 0 && seconds < 36_000 ? String(Math.round(seconds)) : ''
  const key = JSON.stringify([song, artist, album, duration])

  const hit = recall(key)
  if (hit) {
    return send(res, hit.status, hit.body, { 'X-Proxy-Cache': 'HIT' })
  }

  try {
    const { upstream, data } = await askUpstream({ song, artist, album, duration })
    const passThrough = {
      ...upstreamHeader(upstream, 'x-cache-status', 'X-Upstream-Cache-Status'),
      ...upstreamHeader(upstream, 'x-auth-mode', 'X-Upstream-Auth-Mode'),
      ...upstreamHeader(upstream, 'x-ratelimit-type', 'X-Upstream-RateLimit-Type')
    }

    if (upstream.status === 200) {
      if (!data || typeof data.ttml !== 'string' || !data.ttml.trim()) {
        return send(res, 502, {
          error: 'invalid_upstream_reply',
          message: 'The lyrics service returned an empty or malformed response.'
        })
      }
      const body = {
        ttml: data.ttml,
        ...(typeof data.score === 'number' ? { score: data.score } : {})
      }
      remember(key, { status: 200, body, expires: Date.now() + CACHE_TTL_MS })
      return send(res, 200, body, { 'X-Proxy-Cache': 'MISS', ...passThrough })
    }

    if (upstream.status === 404) {
      const body = {
        error: 'not_found',
        message: 'No lyrics were found for this track.'
      }
      remember(key, { status: 404, body, expires: Date.now() + NOT_FOUND_TTL_MS })
      return send(res, 404, body, passThrough)
    }

    if (upstream.status === 401) {
      return send(res, 502, {
        error: 'api_key_required',
        message:
          'The lyrics service requires an API key for songs it has not cached. Set BETTER_LYRICS_API_KEY or wait for the song to be cached upstream.'
      }, passThrough)
    }

    if (upstream.status === 422) {
      return send(res, 400, {
        error: 'invalid_query',
        message: 'The lyrics service rejected the search parameters.'
      }, passThrough)
    }

    if (upstream.status === 429) {
      const retryAfter = upstream.headers.get('retry-after')
      return send(res, 429, {
        error: 'rate_limited',
        message: 'The lyrics service is rate limiting requests. Try again shortly.'
      }, { ...passThrough, ...(retryAfter ? { 'Retry-After': retryAfter } : {}) })
    }

    return send(res, 502, {
      error: 'upstream_error',
      message: `The lyrics service failed with HTTP ${upstream.status}.`
    }, passThrough)
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return send(res, timedOut ? 504 : 502, {
      error: timedOut ? 'upstream_timeout' : 'upstream_unavailable',
      message: timedOut
        ? `The lyrics service did not answer within ${TIMEOUT_MS} ms.`
        : 'The lyrics service could not be reached.'
    })
  }
}

/* ---------------------------------------------------------------------------------------
 * Centralized High-Resolution Artwork Retrieval (Apple iTunes Search + Candidate Matching)
 * ------------------------------------------------------------------------------------- */

const FEATURING_PATTERN = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi
const NOISE_BRACKETS_PATTERN =
  /\s*[([][^)\]]*\b(?:official|video|audio|lyrics?|visualizer|explicit|clean|remaster(?:ed)?|deluxe|anniversary|edition|bonus|version|mix|edit|mono|stereo|live)\b[^)\]]*[)\]]/gi
const NOISE_SUFFIX_PATTERN =
  /\s+[-–—]\s+[^-–—]*\b(?:remaster(?:ed)?|edit|version|mix|mono|stereo|bonus|deluxe|anniversary|explicit|clean|radio|live|from)\b.*$/i
const TRAILING_FEAT_PATTERN = /\s+(?:feat\.?|ft\.?|featuring)\s.*$/i

export function cleanTitle(title) {
  if (!title || typeof title !== 'string') return ''
  return (
    title
      .replace(FEATURING_PATTERN, '')
      .replace(NOISE_BRACKETS_PATTERN, '')
      .replace(NOISE_SUFFIX_PATTERN, '')
      .replace(TRAILING_FEAT_PATTERN, '')
      .trim() || title.trim()
  )
}

const ARTIST_SPLIT_PATTERN =
  /\s*(?:,|;|\/|\s&\s|\s\+\s|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+with\s+)\s*/i

export function primaryArtist(artist) {
  if (!artist || typeof artist !== 'string') return ''
  const first = artist.split(ARTIST_SPLIT_PATTERN)[0]?.trim()
  return first || artist.trim()
}

export function normalizeForMatch(s) {
  if (!s || typeof s !== 'string') return ''
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Inspects artwork URL. For verified Apple CDN (mzstatic.com), transforms dimension suffix
 * to 1200x1200bb.jpg for pristine uncompressed master quality. Non-Apple URLs are preserved as-is.
 */
export function upgradeArtworkUrl(url) {
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

/**
 * Confidence-based candidate matching comparing title, primary artist, album, duration,
 * and penalty filters (karaoke, tribute, live mismatch).
 */
export function scoreCandidate(query, candidate) {
  const qTitle = normalizeForMatch(cleanTitle(query.track || query.title || ''))
  const cTitle = normalizeForMatch(cleanTitle(candidate.trackName || ''))
  const qArtist = normalizeForMatch(primaryArtist(query.artist || ''))
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
  const fullQArtist = normalizeForMatch(query.artist || '')
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
  const queryDurationMs = Number(query.durationMs || (Number(query.duration) * 1000) || 0)
  if (queryDurationMs > 0 && candidate.trackTimeMillis > 0) {
    const diff = Math.abs(queryDurationMs - candidate.trackTimeMillis)
    if (diff <= 4000) durScore = 5
    else if (diff <= 10000) durScore = 3
    else if (diff > 60000) durScore = -15
  }

  let penalty = 0
  const qIsLive = /\blive\b/i.test((query.track || '') + ' ' + (query.album || ''))
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

  return {
    confidence,
    matchType,
    titleScore,
    artistScore,
    albumScore,
    durScore,
    penalty
  }
}

/**
 * Searches Apple iTunes Search API for artwork candidates.
 */
export async function searchItunesArtwork(query, options = {}) {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? ITUNES_TIMEOUT_MS
  const country = options.country ?? ITUNES_DEFAULT_COUNTRY

  const track = cleanTitle(query.track || query.title || '').trim()
  const artist = primaryArtist(query.artist || '').trim()
  const album = query.album ? cleanTitle(query.album).trim() : ''

  if (!track || !artist) return null

  const term = [track, artist, album].filter(Boolean).join(' ')
  const params = new URLSearchParams({
    term,
    entity: 'song',
    media: 'music',
    country,
    limit: '10'
  })

  let candidates = []
  try {
    const res = await fetchImpl(`${ITUNES_BASE_URL}?${params}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', 'User-Agent': 'theaestheticslyrics/1.2' }
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data && Array.isArray(data.results)) candidates = data.results
  } catch {
    return null
  }

  let best = null
  let bestScore = null
  for (const item of candidates) {
    const score = scoreCandidate(
      {
        track,
        artist,
        album,
        durationMs: query.durationMs || (query.duration ? Number(query.duration) * 1000 : 0)
      },
      item
    )
    if (score.confidence >= 0.65) {
      if (!bestScore || score.confidence > bestScore.confidence) {
        best = item
        bestScore = score
      }
    }
  }

  if (!best || !bestScore) return null

  const rawUrl =
    best.artworkUrl1024 ||
    best.artworkUrl600 ||
    best.artworkUrl512 ||
    best.artworkUrl100 ||
    best.artworkUrl60
  if (!rawUrl) return null

  const hiResUrl = upgradeArtworkUrl(rawUrl)
  return {
    url: hiResUrl,
    source: 'itunes',
    confidence: bestScore.confidence,
    matchType: bestScore.matchType,
    metadata: {
      trackName: best.trackName,
      artistName: best.artistName,
      collectionName: best.collectionName,
      releaseDate: best.releaseDate,
      primaryGenreName: best.primaryGenreName,
      country: best.country
    }
  }
}

/**
 * Retrieves album artwork with caching and in-flight request deduplication.
 */
export async function fetchArtwork(query, options = {}) {
  const track = cleanTitle(query.track || query.title || '').trim()
  const artist = primaryArtist(query.artist || '').trim()
  const album = query.album ? cleanTitle(query.album).trim() : ''
  const providerArtworkUrl = query.providerArtworkUrl || query.providerUrl || query.thumbnail || null

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

  const hit = artworkCache.get(cacheKey)
  if (hit) {
    if (hit.expires >= Date.now()) {
      return { ...hit.body, cached: true }
    }
    artworkCache.delete(cacheKey)
  }

  let pending = inFlightArtwork.get(cacheKey)
  if (!pending) {
    pending = (async () => {
      try {
        const itunesResult = await searchItunesArtwork(
          {
            track,
            artist,
            album,
            duration: query.duration,
            durationMs: query.durationMs,
            country: query.country
          },
          options
        )
        if (itunesResult && itunesResult.url) {
          const entry = {
            status: 200,
            body: itunesResult,
            expires: Date.now() + (options.cacheTtlMs ?? ARTWORK_CACHE_TTL_MS)
          }
          if (artworkCache.size >= MAX_ARTWORK_CACHE_ENTRIES) artworkCache.delete(artworkCache.keys().next().value)
          artworkCache.set(cacheKey, entry)
          return itunesResult
        }

        if (providerArtworkUrl) {
          const providerResult = {
            url: providerArtworkUrl,
            source: 'provider',
            confidence: 0.6,
            matchType: 'provider_fallback',
            metadata: null
          }
          const entry = {
            status: 200,
            body: providerResult,
            expires: Date.now() + (options.notFoundTtlMs ?? ARTWORK_NOT_FOUND_TTL_MS)
          }
          if (artworkCache.size >= MAX_ARTWORK_CACHE_ENTRIES) artworkCache.delete(artworkCache.keys().next().value)
          artworkCache.set(cacheKey, entry)
          return providerResult
        }

        const notFoundResult = {
          url: null,
          source: 'none',
          confidence: 0,
          matchType: 'not_found',
          metadata: null
        }
        const entry = {
          status: 404,
          body: notFoundResult,
          expires: Date.now() + (options.notFoundTtlMs ?? ARTWORK_NOT_FOUND_TTL_MS)
        }
        if (artworkCache.size >= MAX_ARTWORK_CACHE_ENTRIES) artworkCache.delete(artworkCache.keys().next().value)
        artworkCache.set(cacheKey, entry)
        return notFoundResult
      } finally {
        inFlightArtwork.delete(cacheKey)
      }
    })()
    inFlightArtwork.set(cacheKey, pending)
  }

  return await pending
}

export async function handleArtwork(url, res, options = {}) {
  const track = param(url.searchParams, 'track', 'song', 'title', 's', 'songName')
  const artist = param(url.searchParams, 'artist', 'a', 'artistName')
  const album = param(url.searchParams, 'album', 'al', 'albumName')
  const duration = param(url.searchParams, 'duration', 'd', 'durationMs')
  const providerArtworkUrl = param(url.searchParams, 'providerArtworkUrl', 'providerUrl', 'thumbnail', 'art')
  const country = param(url.searchParams, 'country') || ITUNES_DEFAULT_COUNTRY

  if (!track && !artist && !providerArtworkUrl) {
    return send(res, 400, {
      error: 'missing_parameters',
      message: 'Send at least "track" (or "song") and "artist", or "providerArtworkUrl".'
    })
  }

  try {
    const result = await fetchArtwork({ track, artist, album, duration, providerArtworkUrl, country }, options)
    const status = result.url ? 200 : 404
    const cacheStatus = result.cached ? 'HIT' : 'MISS'
    return send(res, status, result, { 'X-Proxy-Cache': cacheStatus })
  } catch (err) {
    return send(res, 502, {
      error: 'artwork_error',
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

const server = createServer(async (req, res) => {
  const started = Date.now()

  // One line per request, on every path including OPTIONS and errors.
  res.on('finish', () => {
    console.log(`${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started} ms)`)
  })

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    if (url.pathname === '/health') {
      return send(res, 200, { ok: true, upstream: UPSTREAM, apiKey: Boolean(API_KEY) })
    }

    if (
      url.pathname === '/api/artwork' ||
      url.pathname === '/getArtwork' ||
      url.pathname === '/artwork'
    ) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, {
          error: 'method_not_allowed',
          message: 'Only GET is supported.'
        }, { Allow: 'GET, HEAD, OPTIONS' })
      }
      return await handleArtwork(url, res)
    }

    if (url.pathname !== '/api/lyrics' && url.pathname !== '/getLyrics') {
      return send(res, 404, {
        error: 'not_found',
        message: 'Use GET /api/lyrics, GET /api/artwork, or GET /health.'
      })
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, {
        error: 'method_not_allowed',
        message: 'Only GET is supported.'
      }, { Allow: 'GET, HEAD, OPTIONS' })
    }

    await handleLyrics(url, res)
  } catch (err) {
    if (!res.headersSent) {
      send(res, 500, {
        error: 'internal_error',
        message: 'The proxy hit an unexpected error.'
      })
    }
    console.error('proxy error:', err)
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Start with PORT=8788 npm run lyrics:server`)
  } else {
    console.error('server error:', err)
  }
  process.exitCode = 1
})

const isDirectRun =
  Boolean(process.argv[1]) &&
  (typeof import.meta.filename === 'string'
    ? process.argv[1] === import.meta.filename
    : process.argv[1].endsWith('server.mjs'))

if (isDirectRun) {
  server.listen(PORT, HOST, () => {
    console.log(`Better Lyrics proxy listening on http://${HOST}:${PORT}`)
    console.log(`  GET /api/lyrics?song=...&artist=...&album=...&duration=...`)
    console.log(`  GET /api/artwork?track=...&artist=...&album=...&duration=...&providerArtworkUrl=...`)
    console.log(`  upstream: ${UPSTREAM}${API_KEY ? ' (API key configured)' : ' (cache-only)'}`)
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => process.exit(0))
    })
  }
}

export {
  server,
  cache,
  artworkCache,
  inFlightArtwork,
  handleLyrics,
  askUpstream,
  send,
  param,
  PORT,
  HOST
}
