import { describe, expect, it } from 'vitest'
import type { TimedLyrics } from '../src/shared/types'
import {
  evaluatePresentationState,
  findInstrumentalGaps,
  formatTime,
  InstrumentalPresenter,
  INSTRUMENTAL_MIN_GAP_MS,
  RETURN_TO_LYRICS_LEAD_MS
} from '../src/renderer/src/stage/instrumental'
import { richsyncToTimedLyrics } from '../src/main/lyrics/richsync'
import { karalyrToTimedLyrics } from '../src/main/lyrics/karalyr'
import { ttmlToTimedLyrics } from '../src/main/lyrics/betterlyrics'
import { parseLrc } from '../src/main/lyrics/lrc'
import { buildTimedLyrics } from '../src/main/lyrics/word-timing'

const sampleLyrics: TimedLyrics = {
  wordTiming: 'native',
  lines: [
    {
      text: 'Intro lyric line',
      start: 12_000,
      end: 15_000,
      words: [
        { text: 'Intro', start: 12_000, end: 13_000 },
        { text: 'lyric', start: 13_000, end: 14_000 },
        { text: 'line', start: 14_000, end: 15_000 }
      ]
    },
    {
      text: 'Short pause line',
      start: 18_000, // Gap of 3,000 ms (under 5s threshold)
      end: 22_000,
      words: [
        { text: 'Short', start: 18_000, end: 19_000 },
        { text: 'pause', start: 19_000, end: 20_000 },
        { text: 'line', start: 20_000, end: 22_000 }
      ]
    },
    {
      text: 'Solo follows after this line',
      start: 32_000, // Gap of 10,000 ms (qualifying > 8s instrumental interlude)
      end: 36_000,
      words: [
        { text: 'Solo', start: 32_000, end: 33_000 },
        { text: 'follows', start: 33_000, end: 34_000 },
        { text: 'after', start: 34_000, end: 35_000 },
        { text: 'this', start: 35_000, end: 35_500 },
        { text: 'line', start: 35_500, end: 36_000 }
      ]
    },
    {
      text: 'Outro line begins',
      start: 56_000, // Gap of 20,000 ms (guitar solo)
      end: 60_000,
      words: [
        { text: 'Outro', start: 56_000, end: 57_000 },
        { text: 'line', start: 57_000, end: 58_000 },
        { text: 'begins', start: 58_000, end: 60_000 }
      ]
    }
  ]
}

describe('findInstrumentalGaps', () => {
  it('detects intro, interlude, and outro instrumental breaks >= 8s', () => {
    const songDuration = 80_000 // Last line ends at 60_000, gap of 20_000 ms to end
    const gaps = findInstrumentalGaps(sampleLyrics, songDuration)

    // Expected:
    // 1. Intro: 0 to 12_000 ms (duration 12_000 >= 8000)
    // 2. Interlude: 22_000 to 32_000 ms (duration 10_000 >= 8000)
    // 3. Interlude: 36_000 to 56_000 ms (duration 20_000 >= 8000)
    // 4. Outro: 60_000 to 80_000 ms (duration 20_000 >= 8000)
    expect(gaps).toHaveLength(4)

    expect(gaps[0]).toEqual({ start: 0, end: 12_000, duration: 12_000 })
    expect(gaps[1]).toEqual({ start: 22_000, end: 32_000, duration: 10_000 })
    expect(gaps[2]).toEqual({ start: 36_000, end: 56_000, duration: 20_000 })
    expect(gaps[3]).toEqual({ start: 60_000, end: 80_000, duration: 20_000 })
  })

  it('ignores short gaps under 8s threshold', () => {
    const gaps = findInstrumentalGaps(sampleLyrics, 60_000)
    // The gap between 15_000 and 18_000 (3s) must NOT be in gaps
    const shortGap = gaps.find((g) => g.start === 15_000)
    expect(shortGap).toBeUndefined()
  })

  it('handles null, empty, or unsynced lyrics without errors', () => {
    expect(findInstrumentalGaps(null)).toEqual([])
    expect(findInstrumentalGaps({ lines: [], wordTiming: 'estimated' })).toEqual([])

    // Unsynced lines (0 timestamps)
    const unsynced: TimedLyrics = {
      wordTiming: 'estimated',
      lines: [
        { text: 'Line 1', start: 0, end: 0, words: [] },
        { text: 'Line 2', start: 0, end: 0, words: [] }
      ]
    }
    expect(findInstrumentalGaps(unsynced)).toEqual([])
  })

  it('handles line-level timestamps when word timing is absent', () => {
    const lineOnly: TimedLyrics = {
      wordTiming: 'estimated',
      lines: [
        { text: 'First line', start: 10_000, end: 14_000, words: [] },
        { text: 'Second line', start: 26_000, end: 30_000, words: [] }
      ]
    }
    const gaps = findInstrumentalGaps(lineOnly, 0)
    expect(gaps).toHaveLength(2)
    expect(gaps[0]).toEqual({ start: 0, end: 10_000, duration: 10_000 })
    expect(gaps[1]).toEqual({ start: 14_000, end: 26_000, duration: 12_000 })
  })
})

describe('formatTime', () => {
  it('formats milliseconds to m:ss cleanly', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(-100)).toBe('0:00')
    expect(formatTime(5000)).toBe('0:05')
    expect(formatTime(65_000)).toBe('1:05')
    expect(formatTime(214_000)).toBe('3:34')
    expect(formatTime(354_000)).toBe('5:54')
  })
})

describe('evaluatePresentationState', () => {
  const gaps = [
    { start: 0, end: 10_000, duration: 10_000 },
    { start: 20_000, end: 35_000, duration: 15_000 }
  ]

  it('always returns lyrics when hasArtwork is false', () => {
    expect(evaluatePresentationState(5000, gaps, false)).toBe('lyrics')
    expect(evaluatePresentationState(25_000, gaps, false)).toBe('lyrics')
  })

  it('progresses through transition -> artwork -> return-to-lyrics', () => {
    // Gap starts at 20_000, ends at 35_000
    // At 20_100 (beginning of break): transitioning-to-artwork
    expect(evaluatePresentationState(20_100, gaps, true)).toBe('transitioning-to-artwork')

    // At 25_000 (well inside the break): artwork
    expect(evaluatePresentationState(25_000, gaps, true)).toBe('artwork')

    // At 34_600 (within 500 ms lead before next lyric at 35_000): transitioning-to-lyrics
    expect(evaluatePresentationState(34_600, gaps, true)).toBe('transitioning-to-lyrics')

    // At 35_000 (lyric has started): lyrics
    expect(evaluatePresentationState(35_000, gaps, true)).toBe('lyrics')

    // At 15_000 (between lyrics): lyrics
    expect(evaluatePresentationState(15_000, gaps, true)).toBe('lyrics')
  })
})

describe('InstrumentalPresenter', () => {
  it('manages presenter lifecycle and reports transition lead time', () => {
    const presenter = new InstrumentalPresenter()
    presenter.setLyrics(sampleLyrics, 80_000)
    presenter.setArtwork('data:image/jpeg;base64,...')

    // At t=0 (in intro gap 0..12000): should be transitioning-to-artwork
    const busy = presenter.update(0)
    expect(busy).toBe(true)
    expect(presenter.currentState).toBe('transitioning-to-artwork')

    // At t=6000: deep in intro artwork
    presenter.update(6000)
    expect(presenter.currentState).toBe('artwork')

    // At t=11_600: within 500ms before 12000 -> transitioning-to-lyrics
    presenter.update(11_600)
    expect(presenter.currentState).toBe('transitioning-to-lyrics')

    // Lead time to next transition from t=15_000 (line ends, gap is 22000..32000)
    const msUntil = presenter.msUntilNextTransition(15_000)
    expect(msUntil).toBe(7000) // 22_000 - 15_000 = 7000 ms
  })

  it('stays in lyrics state if artwork is cleared', () => {
    const presenter = new InstrumentalPresenter()
    presenter.setLyrics(sampleLyrics, 80_000)
    presenter.setArtwork(null)

    presenter.update(6000)
    expect(presenter.currentState).toBe('lyrics')
  })

  it('handles user seeking directly into and out of gaps', () => {
    const presenter = new InstrumentalPresenter()
    presenter.setLyrics(sampleLyrics, 80_000)
    presenter.setArtwork('data:image/jpeg;base64,...')

    // Initial play at lyric line
    presenter.update(13_000)
    expect(presenter.currentState).toBe('lyrics')

    // User seeks directly to t=45_000 (middle of 36_000..56_000 solo)
    presenter.update(45_000)
    expect(presenter.currentState).toBe('artwork')

    // User seeks to t=58_000 (outro vocal line)
    presenter.update(58_000)
    expect(presenter.currentState).toBe('lyrics')
  })

  it('toggles DOM targets and notifies presentation state changes', () => {
    let notifiedState = ''
    const containerClasses = new Set<string>()
    const stageClasses = new Set<string>()
    let imgSrc = ''

    const presenter = new InstrumentalPresenter({
      container: {
        classList: {
          add: (c) => containerClasses.add(c),
          remove: (c) => containerClasses.delete(c)
        }
      },
      stage: {
        classList: {
          add: (c) => stageClasses.add(c),
          remove: (c) => stageClasses.delete(c)
        }
      },
      img: {
        src: '',
        removeAttribute: () => {
          imgSrc = ''
        }
      },
      setPresentationState: (st) => {
        notifiedState = st
      }
    })

    presenter.setLyrics(sampleLyrics, 80_000)
    presenter.setArtwork('data:image/png;base64,abc')

    // In intro break: artwork should be active, stage dimmed
    presenter.update(5000)
    expect(presenter.currentState).toBe('artwork')
    expect(notifiedState).toBe('artwork')
    expect(containerClasses.has('active')).toBe(true)
    expect(stageClasses.has('dimmed')).toBe(true)

    // In lyric line: artwork inactive, stage not dimmed
    presenter.update(13_000)
    expect(presenter.currentState).toBe('lyrics')
    expect(notifiedState).toBe('lyrics')
    expect(containerClasses.has('active')).toBe(false)
    expect(stageClasses.has('dimmed')).toBe(false)
  })

  it('updates track metadata (title and artist) and handles missing fields gracefully', () => {
    const titleTarget = { textContent: null as string | null, hidden: false }
    const artistTarget = { textContent: null as string | null, hidden: false }
    const metaContainer = { classList: { add: () => {}, remove: () => {} }, hidden: false }

    const presenter = new InstrumentalPresenter({
      container: { classList: { add: () => {}, remove: () => {} } },
      stage: { classList: { add: () => {}, remove: () => {} } },
      img: { src: '', removeAttribute: () => {} },
      titleEl: titleTarget,
      artistEl: artistTarget,
      metaContainer
    })

    // 1. Full metadata
    presenter.setTrack({
      key: 'test:1',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      durationMs: 354_000,
      app: 'spotify'
    })
    expect(presenter.currentTrack?.title).toBe('Bohemian Rhapsody')
    expect(titleTarget.textContent).toBe('Bohemian Rhapsody')
    expect(titleTarget.hidden).toBe(false)
    expect(artistTarget.textContent).toBe('Queen')
    expect(artistTarget.hidden).toBe(false)
    expect(metaContainer.hidden).toBe(false)

    // 2. Missing artist
    presenter.setTrack({
      key: 'test:2',
      title: 'Solo Piano',
      artist: '',
      album: 'Album',
      durationMs: 180_000,
      app: 'spotify'
    })
    expect(titleTarget.textContent).toBe('Solo Piano')
    expect(titleTarget.hidden).toBe(false)
    expect(artistTarget.hidden).toBe(true)
    expect(metaContainer.hidden).toBe(false)

    // 3. Null track
    presenter.setTrack(null)
    expect(presenter.currentTrack).toBeNull()
    expect(titleTarget.hidden).toBe(true)
    expect(artistTarget.hidden).toBe(true)
    expect(metaContainer.hidden).toBe(true)
  })

  it('updates playback controls state (playing/pause) and track progress display', () => {
    const fillTarget = { style: { width: '0%' } }
    const curTimeTarget = { textContent: '0:00' }
    const totalTimeTarget = { textContent: '0:00' }
    const playPauseBtn = {
      dataset: { playing: 'false' },
      setAttribute: (name: string, val: string) => {
        if (name === 'data-playing') playPauseBtn.dataset.playing = val
      }
    }

    const presenter = new InstrumentalPresenter({
      container: { classList: { add: () => {}, remove: () => {} } },
      stage: { classList: { add: () => {}, remove: () => {} } },
      img: { src: '', removeAttribute: () => {} },
      fillEl: fillTarget,
      curTimeEl: curTimeTarget,
      totalTimeEl: totalTimeTarget,
      playPauseBtn
    })

    presenter.setLyrics(sampleLyrics, 100_000)
    presenter.setArtwork('data:image/jpeg;base64,...')
    presenter.setTrack({
      key: 'test:song',
      title: 'Comfortably Numb',
      artist: 'Pink Floyd',
      album: 'The Wall',
      durationMs: 100_000,
      app: 'spotify'
    })

    // Test setPlaying
    expect(presenter.playing).toBe(false)
    presenter.setPlaying(true)
    expect(presenter.playing).toBe(true)
    expect(playPauseBtn.dataset.playing).toBe('true')

    // At t=6000 (inside intro break 0..12000): isOverlayActive should be true
    presenter.update(6000)
    expect(presenter.isOverlayActive).toBe(true)
    expect(curTimeTarget.textContent).toBe('0:06')
    expect(totalTimeTarget.textContent).toBe('1:40')
    expect(fillTarget.style.width).toBe('6.00%')

    // Mid-song solo at t=45000 (45%)
    presenter.update(45_000)
    expect(presenter.isOverlayActive).toBe(true)
    expect(curTimeTarget.textContent).toBe('0:45')
    expect(fillTarget.style.width).toBe('45.00%')

    // During lyrics playback at t=14000
    presenter.update(14_000)
    expect(presenter.isOverlayActive).toBe(false)
  })
})

describe('provider compatibility with instrumental break detection', () => {
  it('detects breaks accurately from Musixmatch richsync', () => {
    const richsyncBody = [
      {
        ts: 10.0, // 10s intro gap!
        te: 14.0,
        l: 'First verse begins',
        w: [
          { ts: 10.0, te: 12.0, w: 'First ' },
          { ts: 12.0, te: 13.0, w: 'verse ' },
          { ts: 13.0, te: 14.0, w: 'begins' }
        ]
      },
      {
        ts: 26.0, // Gap of 12s between 14.0 and 26.0!
        te: 30.0,
        l: 'Second verse arrives',
        w: [
          { ts: 26.0, te: 28.0, w: 'Second ' },
          { ts: 28.0, te: 30.0, w: 'verse' }
        ]
      }
    ]
    const timed = richsyncToTimedLyrics(richsyncBody, 45_000)
    expect(timed).not.toBeNull()

    const gaps = findInstrumentalGaps(timed, 45_000)
    expect(gaps).toHaveLength(3) // Intro (0..10s), Interlude (14..26s), Outro (30..45s)
    expect(gaps[0]!.duration).toBe(10_000)
    expect(gaps[1]!.start).toBe(14_000)
    expect(gaps[1]!.end).toBe(26_000)
    expect(gaps[2]!.start).toBe(30_000)
    expect(gaps[2]!.end).toBe(45_000)
  })

  it('detects breaks accurately from KaraLyr payloads', () => {
    const karalyrPayload = {
      format_version: 1 as const,
      meta: { language: 'en', has_word_timing: true, countdown_lines: [] },
      lines: [
        {
          start_ms: 15_000,
          end_ms: 19_000,
          singer: null,
          text: 'Start line',
          words: [
            { text: 'Start', start_ms: 15_000, end_ms: 17_000 },
            { text: 'line', start_ms: 17_000, end_ms: 19_000 }
          ]
        },
        {
          start_ms: 30_000,
          end_ms: 34_000,
          singer: null,
          text: 'Next line',
          words: [
            { text: 'Next', start_ms: 30_000, end_ms: 32_000 },
            { text: 'line', start_ms: 32_000, end_ms: 34_000 }
          ]
        }
      ]
    }
    const timed = karalyrToTimedLyrics(karalyrPayload, 50_000)
    expect(timed).not.toBeNull()

    const gaps = findInstrumentalGaps(timed, 50_000)
    expect(gaps).toHaveLength(3)
    expect(gaps[0]!.end).toBe(15_000)
    expect(gaps[1]!.start).toBe(19_000)
    expect(gaps[1]!.end).toBe(30_000)
  })

  it('detects breaks accurately from Better Lyrics TTML', () => {
    const ttml = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
  <body>
    <div>
      <p begin="00:00:10.000" end="00:00:15.000">
        <span begin="00:00:10.000" end="00:00:12.500">Hello </span>
        <span begin="00:00:12.500" end="00:00:15.000">world</span>
      </p>
      <p begin="00:00:27.000" end="00:00:32.000">
        <span begin="00:00:27.000" end="00:00:32.000">Again</span>
      </p>
    </div>
  </body>
</tt>`
    const timed = ttmlToTimedLyrics(ttml, 45_000)
    expect(timed).not.toBeNull()

    const gaps = findInstrumentalGaps(timed, 45_000)
    expect(gaps).toHaveLength(3) // Intro (0..10s), Interlude (15..27s), Outro (32..45s)
    expect(gaps[0]!.end).toBe(10_000)
    expect(gaps[1]!.start).toBe(15_000)
    expect(gaps[1]!.end).toBe(27_000)
  })

  it('detects breaks accurately from standard LRC line timing', () => {
    const lrc = `[00:12.00]First line of the song
[00:16.00]Second line of the song
[00:40.00]Third line after long guitar break`
    const parsed = parseLrc(lrc)
    const timed = buildTimedLyrics(parsed, 60_000)
    expect(timed).not.toBeNull()

    const gaps = findInstrumentalGaps(timed, 60_000)
    // Intro gap (0..12s) and interlude between line 2 and line 3
    expect(gaps[0]!.end).toBe(12_000)
    const interlude = gaps.find((g) => g.end === 40_000)
    expect(interlude).toBeDefined()
    expect(interlude!.duration).toBeGreaterThanOrEqual(INSTRUMENTAL_MIN_GAP_MS)
  })
})
