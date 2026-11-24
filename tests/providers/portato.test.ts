import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LyricsCache, cacheKey, providerCacheKey } from '../../src/main/lyrics/cache'
import { LocalLyrics } from '../../src/main/lyrics/local'
import type { FetchLike, FindResult, LrclibClient } from '../../src/main/lyrics/lrclib'
import type { LrclibRecord, TrackQuery } from '../../src/main/lyrics/match'
import {
  BetterLyricsPortatoClient,
  extractQrcText,
  parseQrcLines,
  portatoToTimedLyrics,
  type PortatoOptions,
  type PortatoResult
} from '../../src/main/lyrics/portato'
import { LyricsService } from '../../src/main/lyrics/service'

// Sample QRC payload: line start+duration in brackets, syllable start+duration in parens
const SAMPLE_QRC = `[ti:Paper Lanterns]
[ar:Lantern Test Band]
[al:Fixtures]
[500,3700](500,800,0)Paper (1300,1100,0)lan(2400,600,0)terns (3000,1200,0)drifting
[5000,4000](5000,600,0)Low (5600,600,0)over (6200,300,0)the (6500,2500,0)rooftops
`

// XML-wrapped QRC payload as returned by QQ Music endpoints
const XML_QRC = `<?xml version="1.0" encoding="utf-8"?>
<root>
  <Lyric_1 LyricType="1" LyricContent="[500,3700](500,800,0)Paper (1300,1700,0)lanterns (3000,1200,0)drifting&#10;[5000,4000](5000,600,0)Low (5600,600,0)over (6200,300,0)the (6500,2500,0)rooftops"/>
</root>`

const CDATA_QRC = `<?xml version="1.0" encoding="utf-8"?>
<Lyric_1 LyricType="1">
  <LyricContent><![CDATA[[500,3700](500,800,0)Paper (1300,1700,0)lanterns (3000,1200,0)drifting]]></LyricContent>
</Lyric_1>`

const TTML_PAYLOAD = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">
<body dur="32.000">
<div>
<p begin="0.500" end="4.200"><span begin="0.500" end="1.300">Paper</span> <span begin="1.300" end="3.000">lanterns</span> <span begin="3.000" end="4.200">drifting</span></p>
</div>
</body>
</tt>`

const query: TrackQuery = {
  title: 'Paper Lanterns',
  artist: 'Lantern Test Band',
  album: 'Fixtures',
  durationMs: 32_000
}

const record = (over: Partial<LrclibRecord> = {}): LrclibRecord => ({
  id: 1,
  trackName: 'Paper Lanterns',
  artistName: 'Lantern Test Band',
  albumName: 'Fixtures',
  duration: 32,
  instrumental: false,
  plainLyrics: 'Paper lanterns drifting\nLow over the rooftops',
  syncedLyrics: '[00:00.50]Paper lanterns drifting\n[00:05.00]Low over the rooftops',
  lyricsfile: null,
  ...over
})

type Reply = { status?: number; body?: unknown } | Error

function scripted(replies: Reply[]): { fetch: FetchLike; urls: string[]; headers: Record<string, string>[] } {
  const urls: string[] = []
  const headers: Record<string, string>[] = []
  const fetch: FetchLike = async (url, init) => {
    urls.push(url)
    headers.push((init?.headers as Record<string, string>) ?? {})
    const reply = replies.shift()
    if (!reply) throw new Error(`unexpected request ${url}`)
    if (reply instanceof Error) throw reply
    const status = reply.status ?? 200
    const body = reply.body
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    } as unknown as { status: number; ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> }
  }
  return { fetch, urls, headers }
}

const client = (fetch: FetchLike, over: Partial<PortatoOptions> = {}): BetterLyricsPortatoClient =>
  new BetterLyricsPortatoClient({
    fetch,
    baseUrl: 'https://api.betterlyrics.org',
    userAgent: 'theaestheticslyrics/test',
    ...over
  })

describe('Better Lyrics Portato QRC parsing', () => {
  it('extracts raw QRC text from direct string', () => {
    expect(extractQrcText(SAMPLE_QRC)).toBe(SAMPLE_QRC)
  })

  it('extracts QRC text from XML attributes and decodes XML entities', () => {
    const extracted = extractQrcText(XML_QRC)
    expect(extracted).toContain('[500,3700](500,800,0)Paper')
    expect(extracted).toContain('\n[5000,4000]')
  })

  it('extracts QRC text from XML CDATA sections', () => {
    const extracted = extractQrcText(CDATA_QRC)
    expect(extracted).toBe('[500,3700](500,800,0)Paper (1300,1700,0)lanterns (3000,1200,0)drifting')
  })

  it('parses QRC lines into native word-timed lyrics', () => {
    const lines = parseQrcLines(SAMPLE_QRC)
    expect(lines).not.toBeNull()
    expect(lines).toHaveLength(2)

    const firstLine = lines![0]!
    expect(firstLine.text).toBe('Paper lanterns drifting')
    expect(firstLine.start).toBe(500)
    expect(firstLine.end).toBe(4200) // 500 + 3700
    expect(firstLine.words).toBeDefined()
    expect(firstLine.words).toHaveLength(3)
    expect(firstLine.words![0]).toEqual({ text: 'Paper', start: 500, end: 1300 })
    expect(firstLine.words![1]).toEqual({ text: 'lanterns', start: 1300, end: 3000 })
    expect(firstLine.words![2]).toEqual({ text: 'drifting', start: 3000, end: 4200 })

    const secondLine = lines![1]!
    expect(secondLine.text).toBe('Low over the rooftops')
    expect(secondLine.start).toBe(5000)
    expect(secondLine.end).toBe(9000) // 5000 + 4000
    expect(secondLine.words).toHaveLength(4)
    expect(secondLine.words![0]).toEqual({ text: 'Low', start: 5000, end: 5600 })
    expect(secondLine.words![3]).toEqual({ text: 'rooftops', start: 6500, end: 9000 })
  })

  it('converts QRC to TimedLyrics with native word timing', () => {
    const timed = portatoToTimedLyrics(SAMPLE_QRC, 32_000)
    expect(timed).not.toBeNull()
    expect(timed?.wordTiming).toBe('native')
    expect(timed?.lines).toHaveLength(2)
  })

  it('handles TTML payload fallback through portatoToTimedLyrics', () => {
    const timed = portatoToTimedLyrics(TTML_PAYLOAD, 32_000)
    expect(timed).not.toBeNull()
    expect(timed?.wordTiming).toBe('native')
    expect(timed?.lines[0]!.text).toBe('Paper lanterns drifting')
  })

  it('returns null on invalid payload', () => {
    expect(portatoToTimedLyrics('totally invalid not lyrics', 32_000)).toBeNull()
  })
})

describe('BetterLyricsPortatoClient', () => {
  it('queries /qq/getLyrics with accurate song parameters and user agent', async () => {
    const s = scripted([{ status: 200, body: { qrc: SAMPLE_QRC } }])
    const c = client(s.fetch)
    const result = await c.find(query)

    expect(result.status).toBe('found')
    expect(s.urls).toHaveLength(1)
    expect(s.urls[0]!).toContain('/qq/getLyrics?')
    expect(s.urls[0]!).toContain('song=Paper+Lanterns')
    expect(s.urls[0]!).toContain('artist=Lantern+Test+Band')
    expect(s.urls[0]!).toContain('album=Fixtures')
    expect(s.headers[0]!['User-Agent']).toBe('theaestheticslyrics/test')
  })

  it('handles raw text QRC payload in response body', async () => {
    const s = scripted([{ status: 200, body: SAMPLE_QRC }])
    const c = client(s.fetch)
    const result = await c.find(query)

    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.rawPayload).toBe(SAMPLE_QRC)
      expect(result.lyrics?.wordTiming).toBe('native')
    }
  })

  it('handles 404 as not-found', async () => {
    const s = scripted([{ status: 404, body: { error: 'not found' } }])
    const c = client(s.fetch)
    const result = await c.find(query)
    expect(result.status).toBe('not-found')
  })

  it('handles 429 as rate limited error', async () => {
    const s = scripted([{ status: 429, body: 'Rate limit exceeded' }])
    const c = client(s.fetch)
    const result = await c.find(query)
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.message).toBe('rate limited')
    }
  })

  it('returns error when fetch throws an exception', async () => {
    const s = scripted([new Error('Connection aborted')])
    const c = client(s.fetch)
    const result = await c.find(query)
    expect(result.status).toBe('error')
  })
})

describe('LyricsService Better Lyrics Portato integration', () => {
  function serviceSetup(portatoFind: () => Promise<PortatoResult>) {
    const base = mkdtempSync(join(tmpdir(), 'tal-portato-'))
    const local = new LocalLyrics(join(base, 'local'))
    const cache = new LyricsCache(join(base, 'cache'))
    const lrclibFind = vi.fn(async (): Promise<FindResult> => ({ status: 'found', record: record() }))
    const portatoClient = { find: vi.fn(portatoFind) }
    const log = vi.fn()

    const service = new LyricsService({
      local,
      cache,
      client: { find: lrclibFind } as unknown as LrclibClient,
      portato: { client: portatoClient },
      log,
      provider: () => 'auto'
    })

    return { base, local, cache, lrclibFind, portatoClient, log, service }
  }

  it('uses Portato in automatic chain and caches its word-timed payload', async () => {
    const s = serviceSetup(async () => ({
      status: 'found',
      rawPayload: SAMPLE_QRC,
      format: 'qrc',
      lyrics: portatoToTimedLyrics(SAMPLE_QRC, 32_000)!
    }))

    const first = await s.service.get(query)
    expect(first).toMatchObject({
      status: 'found',
      source: 'portato',
      syncQuality: 'word'
    })
    expect(first.lyrics?.wordTiming).toBe('native')
    expect(first.attribution?.name).toBe('Better Lyrics Portato')
    expect(s.portatoClient.find).toHaveBeenCalledTimes(1)
    expect(s.lrclibFind).not.toHaveBeenCalled()

    // Second call serves from disk cache
    const second = await s.service.get(query)
    expect(second).toMatchObject({
      status: 'found',
      source: 'cache'
    })
    expect(second.lyrics?.wordTiming).toBe('native')
    expect(s.portatoClient.find).toHaveBeenCalledTimes(1)
  })

  it('pins Portato without falling back and keeps isolated cache slot', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tal-portato-pin-'))
    const local = new LocalLyrics(join(base, 'local'))
    const cache = new LyricsCache(join(base, 'cache'))
    const lrclibFind = vi.fn(async (): Promise<FindResult> => ({ status: 'found', record: record() }))
    const portatoClient = {
      find: vi.fn(async (): Promise<PortatoResult> => ({
        status: 'found',
        rawPayload: SAMPLE_QRC,
        format: 'qrc',
        lyrics: portatoToTimedLyrics(SAMPLE_QRC, 32_000)!
      }))
    }

    const service = new LyricsService({
      local,
      cache,
      client: { find: lrclibFind } as unknown as LrclibClient,
      portato: { client: portatoClient },
      log: () => {},
      provider: () => 'portato'
    })

    const res = await service.get(query)
    expect(res).toMatchObject({
      status: 'found',
      source: 'portato',
      syncQuality: 'word'
    })
    expect(portatoClient.find).toHaveBeenCalledTimes(1)
    expect(lrclibFind).not.toHaveBeenCalled()

    // Isolated cache slot
    const cachedSlot = await cache.get(providerCacheKey(query, 'portato'))
    expect(cachedSlot).toMatchObject({ status: 'found', source: 'portato' })
    expect(await cache.get(cacheKey(query))).toBeNull()
  })

  it('does not fall back to LRCLIB when Portato is pinned and misses', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tal-portato-miss-'))
    const local = new LocalLyrics(join(base, 'local'))
    const cache = new LyricsCache(join(base, 'cache'))
    const lrclibFind = vi.fn(async (): Promise<FindResult> => ({ status: 'found', record: record() }))
    const portatoClient = {
      find: vi.fn(async (): Promise<PortatoResult> => ({ status: 'not-found' }))
    }

    const service = new LyricsService({
      local,
      cache,
      client: { find: lrclibFind } as unknown as LrclibClient,
      portato: { client: portatoClient },
      log: () => {},
      provider: () => 'portato'
    })

    const res = await service.get(query)
    expect(res).toMatchObject({ status: 'not-found', source: 'portato' })
    expect(lrclibFind).not.toHaveBeenCalled()
  })
})
