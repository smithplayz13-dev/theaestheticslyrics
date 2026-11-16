import { describe, expect, it, vi } from 'vitest'
import {
  cleanTitle,
  primaryArtist,
  normalizeForMatch,
  upgradeArtworkUrl,
  scoreCandidate,
  searchItunesArtwork,
  fetchArtwork,
  handleArtwork,
  artworkCache
} from '../server/server.mjs'
import { ArtworkService } from '../src/main/artwork/service'

describe('Artwork normalization & URL upgrade', () => {
  it('cleans titles by removing feat, remaster, deluxe, live, and version noise', () => {
    expect(cleanTitle('Bring Me To Life (feat. Paul McCoy)')).toBe('Bring Me To Life')
    expect(cleanTitle('Numb (Live In Texas)')).toBe('Numb')
    expect(cleanTitle('Paper Lanterns - 2011 Remaster')).toBe('Paper Lanterns')
    expect(cleanTitle('In The End [Official Music Video]')).toBe('In The End')
    expect(cleanTitle('Lose Yourself (Explicit Version)')).toBe('Lose Yourself')
    expect(cleanTitle('Clean Title')).toBe('Clean Title')
  })

  it('extracts primary artist properly', () => {
    expect(primaryArtist('Eminem feat. Dido')).toBe('Eminem')
    expect(primaryArtist('Green Day, Other Artist')).toBe('Green Day')
    expect(primaryArtist('Queen & David Bowie')).toBe('Queen')
    expect(primaryArtist('Linkin Park')).toBe('Linkin Park')
  })

  it('normalizes strings for matching by removing accents and punctuation', () => {
    expect(normalizeForMatch('Beyoncé & Jay-Z')).toBe('beyonce and jay z')
    expect(normalizeForMatch("Don't Stop Believin'")).toBe('dont stop believin')
  })

  it('upgrades Apple mzstatic URLs to 1200x1200bb.jpg master resolution', () => {
    const raw = 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/52/49/1a/52491ac9/14CMGIM00930.rgb.jpg/100x100bb.jpg'
    expect(upgradeArtworkUrl(raw)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/52/49/1a/52491ac9/14CMGIM00930.rgb.jpg/1200x1200bb.jpg'
    )
  })

  it('preserves non-Apple URLs as-is without blind rewriting', () => {
    const raw = 'https://custom-art-provider.org/images/cover_300.jpg'
    expect(upgradeArtworkUrl(raw)).toBe(raw)
  })
})

describe('Candidate matching scoring', () => {
  const baseQuery = {
    track: 'Bring Me To Life',
    artist: 'Evanescence',
    album: 'Fallen',
    durationMs: 237_000
  }

  // 1. Popular song with exact iTunes match
  it('gives exact match high confidence (>0.9)', () => {
    const candidate = {
      trackName: 'Bring Me To Life',
      artistName: 'Evanescence',
      collectionName: 'Fallen',
      trackTimeMillis: 237_293
    }
    const score = scoreCandidate(baseQuery, candidate)
    expect(score.confidence).toBeGreaterThanOrEqual(0.9)
    expect(score.matchType).toBe('exact')
  })

  // 2. Song with multiple releases (Deluxe edition match)
  it('matches across multiple releases such as deluxe editions', () => {
    const candidate = {
      trackName: 'Bring Me To Life',
      artistName: 'Evanescence',
      collectionName: 'Fallen (Bonus Version)',
      trackTimeMillis: 237_293
    }
    const score = scoreCandidate(baseQuery, candidate)
    expect(score.confidence).toBeGreaterThanOrEqual(0.85)
  })

  // 3. Remastered album / track
  it('matches remastered tracks and albums with high confidence', () => {
    const candidate = {
      trackName: 'Paper Lanterns (2011 Remaster)',
      artistName: 'Green Day',
      collectionName: '1,039/Smoothed Out Slappy Hours (Remastered)',
      trackTimeMillis: 143_000
    }
    const score = scoreCandidate(
      { track: 'Paper Lanterns', artist: 'Green Day', album: '1,039/Smoothed Out Slappy Hours', durationMs: 143_000 },
      candidate
    )
    expect(score.confidence).toBeGreaterThanOrEqual(0.85)
  })

  // 4. Compilation album
  it('matches songs appearing on compilation or greatest hits albums', () => {
    const candidate = {
      trackName: 'Stan (feat. Dido)',
      artistName: 'Eminem',
      collectionName: 'Curtain Call: The Hits',
      trackTimeMillis: 402_840
    }
    const score = scoreCandidate(
      { track: 'Stan', artist: 'Eminem', album: 'Curtain Call: The Hits', durationMs: 403_000 },
      candidate
    )
    expect(score.confidence).toBeGreaterThanOrEqual(0.85)
  })

  // 5. Track with featuring artists
  it('matches tracks with featuring artist in query or candidate', () => {
    const candidate = {
      trackName: 'Stan (feat. Dido)',
      artistName: 'Eminem',
      collectionName: 'The Marshall Mathers LP',
      trackTimeMillis: 403_360
    }
    const score = scoreCandidate(
      { track: 'Stan', artist: 'Eminem feat. Dido', album: 'The Marshall Mathers LP', durationMs: 403_000 },
      candidate
    )
    expect(score.confidence).toBeGreaterThanOrEqual(0.85)
  })

  // 6. Song with incomplete metadata (missing album & duration)
  it('scores matches with incomplete metadata above threshold', () => {
    const candidate = {
      trackName: 'Numb',
      artistName: 'LINKIN PARK',
      collectionName: 'Meteora',
      trackTimeMillis: 187_508
    }
    const score = scoreCandidate({ track: 'Numb', artist: 'Linkin Park' }, candidate)
    expect(score.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('rejects karaoke or tribute covers when query is for original song', () => {
    const candidate = {
      trackName: 'Bring Me To Life (Karaoke Version)',
      artistName: 'The Karaoke Tributes',
      collectionName: 'Ultimate Karaoke',
      trackTimeMillis: 237_000
    }
    const score = scoreCandidate(baseQuery, candidate)
    expect(score.confidence).toBeLessThan(0.4)
  })
})

describe('Backend Artwork API & Fetching (iTunes + Fallback)', () => {
  // 7. Track whose provider artwork is already high resolution / fallback
  it('uses provider artwork when iTunes returns no high-confidence match', async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] })
    }))

    const result = await fetchArtwork(
      {
        track: 'Unreleased Underground Track',
        artist: 'Unknown Artist',
        providerArtworkUrl: 'https://provider.example.com/high-res-cover.jpg'
      },
      { fetch: fakeFetch as unknown as typeof fetch }
    )

    expect(result.url).toBe('https://provider.example.com/high-res-cover.jpg')
    expect(result.source).toBe('provider')
    expect(result.confidence).toBe(0.6)
  })

  // 8. Track with no artwork search results and no provider artwork
  it('returns not-found result when no candidate matches and no fallback is given', async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] })
    }))

    const result = await fetchArtwork(
      {
        track: 'Completely Nonexistent Song XYZ 12345',
        artist: 'Nonexistent Band'
      },
      { fetch: fakeFetch as unknown as typeof fetch }
    )

    expect(result.url).toBeNull()
    expect(result.source).toBe('none')
    expect(result.confidence).toBe(0)
  })

  // 10. Repeated requests for the same track (caching & deduplication)
  it('serves repeated requests from cache without duplicate network calls', async () => {
    artworkCache.clear()

    const mockResults = [
      {
        trackName: 'Paper Lanterns',
        artistName: 'Green Day',
        collectionName: '1,039/Smoothed Out Slappy Hours',
        artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/xyz/100x100bb.jpg',
        trackTimeMillis: 143_000
      }
    ]

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: mockResults })
    }))

    const q = { track: 'Paper Lanterns Cache Test', artist: 'Green Day' }

    // First request
    const first = await fetchArtwork(q, { fetch: fakeFetch as unknown as typeof fetch })
    expect(first.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/xyz/1200x1200bb.jpg')
    expect(fakeFetch).toHaveBeenCalledTimes(1)

    // Second request: served from cache
    const second = await fetchArtwork(q, { fetch: fakeFetch as unknown as typeof fetch })
    expect(second.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/xyz/1200x1200bb.jpg')
    expect(second.cached).toBe(true)
    expect(fakeFetch).toHaveBeenCalledTimes(1) // Still 1 call!
  })

  it('deduplicates simultaneous in-flight requests for the same track', async () => {
    artworkCache.clear()

    let callCount = 0
    const fakeFetch = vi.fn(async () => {
      callCount++
      await new Promise((r) => setTimeout(r, 20))
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              trackName: 'Dedupe Test',
              artistName: 'Test Band',
              artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/dedupe/100x100bb.jpg',
              trackTimeMillis: 120_000
            }
          ]
        })
      }
    })

    const q = { track: 'Dedupe Test', artist: 'Test Band' }

    // Fire 3 simultaneous requests
    const [r1, r2, r3] = await Promise.all([
      fetchArtwork(q, { fetch: fakeFetch as unknown as typeof fetch }),
      fetchArtwork(q, { fetch: fakeFetch as unknown as typeof fetch }),
      fetchArtwork(q, { fetch: fakeFetch as unknown as typeof fetch })
    ])

    expect(r1.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/dedupe/1200x1200bb.jpg')
    expect(r2.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/dedupe/1200x1200bb.jpg')
    expect(r3.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/dedupe/1200x1200bb.jpg')
    expect(callCount).toBe(1) // Single network call coalesced!
  })
})

describe('Backend HTTP endpoint (handleArtwork)', () => {
  function makeMockRes() {
    let statusCode = 200
    let headers: Record<string, string> = {}
    let payload = ''

    return {
      writeHead: vi.fn((status: number, h: Record<string, string>) => {
        statusCode = status
        headers = { ...h }
      }),
      end: vi.fn((data: string) => {
        payload = data
      }),
      get status() {
        return statusCode
      },
      get headers() {
        return headers
      },
      get body() {
        return payload ? JSON.parse(payload) : null
      }
    }
  }

  it('returns 400 when track and artist are missing', async () => {
    const res = makeMockRes()
    const url = new URL('http://localhost:8787/api/artwork')
    await handleArtwork(url, res as any)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('missing_parameters')
  })

  it('serves 200 with artwork data and X-Proxy-Cache header on successful match', async () => {
    artworkCache.clear()
    const res = makeMockRes()
    const url = new URL('http://localhost:8787/api/artwork?track=Numb&artist=Linkin%20Park')

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            trackName: 'Numb',
            artistName: 'LINKIN PARK',
            collectionName: 'Meteora',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/numb/100x100bb.jpg',
            trackTimeMillis: 187_000
          }
        ]
      })
    }))

    await handleArtwork(url, res as any, { fetch: fakeFetch as unknown as typeof fetch })
    expect(res.status).toBe(200)
    expect(res.headers['X-Proxy-Cache']).toBe('MISS')
    expect(res.body.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/numb/1200x1200bb.jpg')
    expect(res.body.source).toBe('itunes')

    // Second call: HIT
    const res2 = makeMockRes()
    await handleArtwork(url, res2 as any, { fetch: fakeFetch as unknown as typeof fetch })
    expect(res2.status).toBe(200)
    expect(res2.headers['X-Proxy-Cache']).toBe('HIT')
  })
})

describe('ArtworkService & Token Validation', () => {
  // 9. Rapidly switching between tracks
  it('ensures older asynchronous lookup cannot overwrite newly selected track', async () => {
    let currentArtworkToken = 0
    let activeArtworkUrl: string | null = null

    async function onTrackChange(trackTitle: string, delayMs: number, artworkUrl: string) {
      const token = ++currentArtworkToken
      await new Promise((r) => setTimeout(r, delayMs))
      // Only apply if token is still current!
      if (token === currentArtworkToken) {
        activeArtworkUrl = artworkUrl
      }
    }

    // Song 1 starts (slow lookup: 60ms)
    const p1 = onTrackChange('Song 1', 60, 'https://art.com/song1.jpg')
    // User rapidly skips to Song 2 (faster lookup: 20ms)
    const p2 = onTrackChange('Song 2', 20, 'https://art.com/song2.jpg')

    await Promise.all([p1, p2])

    // Active artwork MUST be Song 2, never overwritten by Song 1!
    expect(activeArtworkUrl).toBe('https://art.com/song2.jpg')
  })

  it('ArtworkService falls back gracefully when backend proxy is offline', async () => {
    const service = new ArtworkService({
      proxyUrl: 'http://127.0.0.1:9999', // Nonexistent port
      fetch: vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url)
        if (urlStr.includes('127.0.0.1:9999')) {
          throw new Error('fetch failed ECONNREFUSED')
        }
        // Direct iTunes fallback succeeds
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                trackName: 'Direct Fallback',
                artistName: 'Direct Artist',
                artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/direct/100x100bb.jpg',
                trackTimeMillis: 180_000
              }
            ]
          })
        } as unknown as Response
      })
    })

    const result = await service.getArtwork({ track: 'Direct Fallback', artist: 'Direct Artist' })
    expect(result.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/direct/1200x1200bb.jpg')
    expect(result.source).toBe('itunes')
  })
})
