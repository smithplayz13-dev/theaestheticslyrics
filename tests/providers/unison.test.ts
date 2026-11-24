import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LyricsCache, cacheKey, providerCacheKey } from '../../src/main/lyrics/cache'
import { LocalLyrics } from '../../src/main/lyrics/local'
import type { FetchLike, FindResult, LrclibClient } from '../../src/main/lyrics/lrclib'
import type { LrclibRecord, TrackQuery } from '../../src/main/lyrics/match'
import { LyricsService } from '../../src/main/lyrics/service'
import {
  UnisonClient,
  parseUnsyncedLines,
  syncQualityScore,
  unisonToTimedLyrics,
  type UnisonOptions,
  type UnisonEntry,
  type UnisonResult
} from '../../src/main/lyrics/unison'

const SAMPLE_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">
<body dur="32.000">
<div>
<p begin="0.500" end="4.200"><span begin="0.500" end="1.300">Paper</span> <span begin="1.300" end="2.400">lan</span><span begin="2.400" end="3.000">terns</span> <span begin="3.000" end="4.200">drifting</span></p>
<p begin="5.000" end="9.000"><span begin="5.000" end="5.600">Low</span> <span begin="5.600" end="6.200">over</span> <span begin="6.200" end="6.500">the</span> <span begin="6.500" end="9.000">rooftops</span></p>
</div>
</body>
</tt>`

const SAMPLE_WORD_LRC = `[00:00.50] <00:00.50>Paper <00:01.30>lanterns <00:03.00>drifting
[00:05.00] <00:05.00>Low <00:05.60>over <00:06.20>the <00:06.50>rooftops`

const SAMPLE_LINE_LRC = `[00:00.50]Paper lanterns drifting
[00:05.00]Low over the rooftops`

const SAMPLE_PLAIN = `Paper lanterns drifting
Low over the rooftops`

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

const client = (fetch: FetchLike, over: Partial<UnisonOptions> = {}): UnisonClient =>
  new UnisonClient({
    fetch,
    baseUrl: 'https://unison.betterlyrics.org',
    userAgent: 'theaestheticslyrics/test',
    ...over
  })

describe('Better Lyrics Unison Quality & Parsing', () => {
  it('correctly ranks sync quality levels', () => {
    expect(syncQualityScore('syllable')).toBe(4)
    expect(syncQualityScore('word')).toBe(3)
    expect(syncQualityScore('line')).toBe(2)
    expect(syncQualityScore('unsynced')).toBe(1)
    expect(syncQualityScore(undefined)).toBe(0)
  })

  it('parses unsynchronized lyrics without fabricating line timestamps', () => {
    const lines = parseUnsyncedLines(SAMPLE_PLAIN)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.text).toBe('Paper lanterns drifting')
    expect(lines[1]!.text).toBe('Low over the rooftops')
    // No artificial incrementing timestamps fabricated
    expect(lines[0]!.words).toBeUndefined()
  })

  it('converts syllable TTML entry into TimedLyrics with native word timing', () => {
    const entry: UnisonEntry = {
      id: 'unison-1',
      song: 'Paper Lanterns',
      artist: 'Lantern Test Band',
      lyrics: SAMPLE_TTML,
      format: 'ttml',
      syncType: 'richsync',
      submitter: 'community_user',
      confidence: 'high'
    }
    const converted = unisonToTimedLyrics(entry, 32_000)
    expect(converted).not.toBeNull()
    expect(converted?.syncQuality).toBe('syllable')
    expect(converted?.lyrics.wordTiming).toBe('native')
    expect(converted?.lyrics.lines[0]!.words).toBeDefined()
    expect(converted?.lyrics.lines[0]!.words![0]!.text).toBe('Paper')
  })

  it('converts word-synced entry into TimedLyrics with native word timing', () => {
    const entry: UnisonEntry = {
      id: 'unison-2',
      song: 'Paper Lanterns',
      artist: 'Lantern Test Band',
      lyrics: SAMPLE_WORD_LRC,
      format: 'lrc',
      syncType: 'word',
      submitter: 'karaoke_king'
    }
    const converted = unisonToTimedLyrics(entry, 32_000)
    expect(converted).not.toBeNull()
    expect(converted?.syncQuality).toBe('word')
    expect(converted?.lyrics.wordTiming).toBe('native')
  })

  it('converts line-synced entry into TimedLyrics with estimated word timing', () => {
    const entry: UnisonEntry = {
      id: 'unison-3',
      song: 'Paper Lanterns',
      artist: 'Lantern Test Band',
      lyrics: SAMPLE_LINE_LRC,
      format: 'lrc',
      syncType: 'line'
    }
    const converted = unisonToTimedLyrics(entry, 32_000)
    expect(converted).not.toBeNull()
    expect(converted?.syncQuality).toBe('line')
    expect(converted?.lyrics.wordTiming).toBe('estimated')
  })

  it('converts unsynchronized entry into TimedLyrics fallback', () => {
    const entry: UnisonEntry = {
      id: 'unison-4',
      song: 'Paper Lanterns',
      artist: 'Lantern Test Band',
      lyrics: SAMPLE_PLAIN,
      format: 'plain',
      syncType: 'unsynced'
    }
    const converted = unisonToTimedLyrics(entry, 32_000)
    expect(converted).not.toBeNull()
    expect(converted?.syncQuality).toBe('unsynced')
    expect(converted?.lyrics.lines).toHaveLength(2)
  })
})

describe('UnisonClient', () => {
  it('queries /lyrics with title and artist and returns attribution', async () => {
    const s = scripted([
      {
        status: 200,
        body: {
          success: true,
          data: {
            id: 'uni-100',
            song: 'Paper Lanterns',
            artist: 'Lantern Test Band',
            lyrics: SAMPLE_TTML,
            format: 'ttml',
            syncType: 'richsync',
            submitter: 'alice',
            confidence: 0.95
          }
        }
      }
    ])
    const c = client(s.fetch)
    const res = await c.find(query)

    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.syncQuality).toBe('syllable')
      expect(res.attribution.name).toBe('Unison')
      expect(res.attribution.id).toBe('uni-100')
      expect(res.attribution.submitter).toBe('alice')
      expect(res.attribution.syncType).toBe('richsync')
      expect(res.lyrics?.wordTiming).toBe('native')
    }
    expect(s.urls[0]).toContain('/lyrics?')
    expect(s.urls[0]).toContain('song=Paper+Lanterns')
    expect(s.urls[0]).toContain('artist=Lantern+Test+Band')
    expect(s.headers[0]!['User-Agent']).toBe('theaestheticslyrics/test')
  })

  it('falls back to search endpoint when primary lookup returns 404', async () => {
    const s = scripted([
      { status: 404, body: { error: 'not found' } },
      {
        status: 200,
        body: {
          success: true,
          data: [
            {
              id: 'uni-search-1',
              song: 'Paper Lanterns',
              artist: 'Lantern Test Band',
              lyrics: SAMPLE_LINE_LRC,
              format: 'lrc',
              syncType: 'line',
              submitter: 'bob'
            }
          ]
        }
      }
    ])
    const c = client(s.fetch)
    const res = await c.find(query)

    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.syncQuality).toBe('line')
      expect(res.attribution.submitter).toBe('bob')
    }
    expect(s.urls).toHaveLength(2)
    expect(s.urls[0]).toContain('/lyrics?')
    expect(s.urls[1]).toContain('/lyrics/search?')
  })

  it('reports not-found when both direct and search miss', async () => {
    const s = scripted([
      { status: 404, body: { error: 'not found' } },
      { status: 404, body: { error: 'search not found' } }
    ])
    const c = client(s.fetch)
    const res = await c.find(query)
    expect(res.status).toBe('not-found')
  })

  it('reports rate limited error on HTTP 429', async () => {
    const s = scripted([{ status: 429, body: 'Rate limit' }])
    const c = client(s.fetch)
    const res = await c.find(query)
    expect(res.status).toBe('error')
    if (res.status === 'error') {
      expect(res.message).toBe('rate limited')
    }
  })
})

describe('LyricsService Unison integration', () => {
  function serviceSetup(unisonFind: () => Promise<UnisonResult>) {
    const base = mkdtempSync(join(tmpdir(), 'tal-unison-'))
    const local = new LocalLyrics(join(base, 'local'))
    const cache = new LyricsCache(join(base, 'cache'))
    const lrclibFind = vi.fn(async (): Promise<FindResult> => ({ status: 'found', record: record() }))
    const unisonClient = { find: vi.fn(unisonFind) }
    const log = vi.fn()

    const service = new LyricsService({
      local,
      cache,
      client: { find: lrclibFind } as unknown as LrclibClient,
      unison: { client: unisonClient },
      log,
      provider: () => 'auto'
    })

    return { base, local, cache, lrclibFind, unisonClient, log, service }
  }

  it('uses Unison in automatic chain and caches community syllable lyrics', async () => {
    const converted = unisonToTimedLyrics(
      {
        id: 'u-1',
        song: 'Paper Lanterns',
        artist: 'Lantern Test Band',
        lyrics: SAMPLE_TTML,
        format: 'ttml',
        syncType: 'richsync',
        submitter: 'carol'
      },
      32_000
    )!

    const s = serviceSetup(async () => ({
      status: 'found',
      lyrics: converted.lyrics,
      syncQuality: 'syllable',
      rawPayload: SAMPLE_TTML,
      attribution: {
        name: 'Unison',
        id: 'u-1',
        submitter: 'carol',
        syncType: 'richsync'
      }
    }))

    const first = await s.service.get(query)
    expect(first).toMatchObject({
      status: 'found',
      source: 'unison',
      syncQuality: 'syllable'
    })
    expect(first.lyrics?.wordTiming).toBe('native')
    expect(first.attribution?.name).toBe('Unison')
    expect(first.attribution?.submitter).toBe('carol')
    expect(s.unisonClient.find).toHaveBeenCalledTimes(1)
    expect(s.lrclibFind).not.toHaveBeenCalled()

    // Second call serves from disk cache
    const second = await s.service.get(query)
    expect(second).toMatchObject({
      status: 'found',
      source: 'cache'
    })
    expect(second.lyrics?.wordTiming).toBe('native')
    expect(s.unisonClient.find).toHaveBeenCalledTimes(1)
  })

  it('pins Unison without falling back and keeps separate cache slot', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tal-unison-pin-'))
    const local = new LocalLyrics(join(base, 'local'))
    const cache = new LyricsCache(join(base, 'cache'))
    const lrclibFind = vi.fn(async (): Promise<FindResult> => ({ status: 'found', record: record() }))
    const converted = unisonToTimedLyrics(
      {
        id: 'u-2',
        song: 'Paper Lanterns',
        artist: 'Lantern Test Band',
        lyrics: SAMPLE_WORD_LRC,
        format: 'lrc',
        syncType: 'word'
      },
      32_000
    )!

    const unisonClient = {
      find: vi.fn(async (): Promise<UnisonResult> => ({
        status: 'found',
        lyrics: converted.lyrics,
        syncQuality: 'word',
        rawPayload: SAMPLE_WORD_LRC,
        attribution: { name: 'Unison', id: 'u-2' }
      }))
    }

    const service = new LyricsService({
      local,
      cache,
      client: { find: lrclibFind } as unknown as LrclibClient,
      unison: { client: unisonClient },
      log: () => {},
      provider: () => 'unison'
    })

    const res = await service.get(query)
    expect(res).toMatchObject({
      status: 'found',
      source: 'unison',
      syncQuality: 'word'
    })
    expect(unisonClient.find).toHaveBeenCalledTimes(1)
    expect(lrclibFind).not.toHaveBeenCalled()

    // Cache slot isolation
    const slot = await cache.get(providerCacheKey(query, 'unison'))
    expect(slot).toMatchObject({ status: 'found', source: 'unison' })
    expect(await cache.get(cacheKey(query))).toBeNull()
  })

  it('does not fall back to LRCLIB when Unison is pinned and misses', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tal-unison-miss-'))
    const local = new LocalLyrics(join(base, 'local'))
    const cache = new LyricsCache(join(base, 'cache'))
    const lrclibFind = vi.fn(async (): Promise<FindResult> => ({ status: 'found', record: record() }))
    const unisonClient = {
      find: vi.fn(async (): Promise<UnisonResult> => ({ status: 'not-found' }))
    }

    const service = new LyricsService({
      local,
      cache,
      client: { find: lrclibFind } as unknown as LrclibClient,
      unison: { client: unisonClient },
      log: () => {},
      provider: () => 'unison'
    })

    const res = await service.get(query)
    expect(res).toMatchObject({ status: 'not-found', source: 'unison' })
    expect(lrclibFind).not.toHaveBeenCalled()
  })
})
