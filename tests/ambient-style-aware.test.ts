import { describe, expect, it, vi } from 'vitest'
import { AmbientPresenter } from '../src/renderer/src/stage/ambient'
import { BackgroundManager } from '../src/renderer/src/stage/background'
import type { StyleId, TimedLyrics, TrackInfo } from '../src/shared/types'
import { DEFAULT_BACKGROUND_PALETTE } from '../src/shared/types'

function makeMockElements() {
  const container = {
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      contains: vi.fn((_cls: string) => false)
    },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn()
  }
  const stage = {
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      contains: vi.fn((_cls: string) => false)
    },
    style: {
      opacity: '1'
    }
  }
  const img = {
    src: '',
    removeAttribute: vi.fn((attr: string) => {
      if (attr === 'src') img.src = ''
    })
  }
  const glowImg = {
    src: '',
    removeAttribute: vi.fn((attr: string) => {
      if (attr === 'src') glowImg.src = ''
    })
  }
  const titleEl = { textContent: '' }
  const artistEl = { textContent: '' }
  const curTimeEl = { textContent: '' }
  const totalTimeEl = { textContent: '' }
  const fillEl = { style: { width: '' } }
  const thumbEl = { style: { left: '' } }
  const playPauseBtn = {
    dataset: { playing: 'false' },
    setAttribute: vi.fn((name: string, val: string) => {
      if (name === 'data-playing') playPauseBtn.dataset.playing = val
    })
  }
  const setPresentationMode = vi.fn()
  const setPresentationState = vi.fn()

  return {
    container,
    stage,
    img,
    glowImg,
    titleEl,
    artistEl,
    curTimeEl,
    totalTimeEl,
    fillEl,
    thumbEl,
    playPauseBtn,
    setPresentationMode,
    setPresentationState
  }
}

function makeMockBackgroundElements() {
  const layerA = {
    style: {
      props: new Map<string, string>(),
      setProperty: vi.fn((k: string, v: string) => {
        layerA.style.props.set(k, v)
      })
    },
    classList: {
      classes: new Set<string>(['active']),
      add: vi.fn((c: string) => layerA.classList.classes.add(c)),
      remove: vi.fn((c: string) => layerA.classList.classes.delete(c)),
      contains: vi.fn((c: string) => layerA.classList.classes.has(c))
    }
  }
  const layerB = {
    style: {
      props: new Map<string, string>(),
      setProperty: vi.fn((k: string, v: string) => {
        layerB.style.props.set(k, v)
      })
    },
    classList: {
      classes: new Set<string>(),
      add: vi.fn((c: string) => layerB.classList.classes.add(c)),
      remove: vi.fn((c: string) => layerB.classList.classes.delete(c)),
      contains: vi.fn((c: string) => layerB.classList.classes.has(c))
    }
  }
  const root = {
    style: {
      props: new Map<string, string>(),
      setProperty: vi.fn((k: string, v: string) => {
        root.style.props.set(k, v)
      })
    }
  }

  return { layerA, layerB, root }
}

const sampleLyricsWithGaps: TimedLyrics = {
  wordTiming: 'native',
  lines: [
    {
      text: 'Intro line arrives after a 10s opening',
      start: 10_000,
      end: 14_000,
      words: [
        { text: 'Intro', start: 10_000, end: 11_000 },
        { text: 'line', start: 11_000, end: 12_000 },
        { text: 'arrives', start: 12_000, end: 14_000 }
      ]
    },
    {
      text: 'Short pause line',
      start: 16_000, // 2s gap (not a qualifying gap)
      end: 20_000,
      words: [
        { text: 'Short', start: 16_000, end: 18_000 },
        { text: 'line', start: 18_000, end: 20_000 }
      ]
    },
    {
      text: 'Line after 12s guitar interlude',
      start: 32_000, // 12s gap (qualifying gap: 20_000 -> 32_000)
      end: 36_000,
      words: [
        { text: 'Guitar', start: 32_000, end: 34_000 },
        { text: 'solo', start: 34_000, end: 36_000 }
      ]
    }
  ]
}

const sampleTrack: TrackInfo = {
  key: 'test:track-1',
  title: 'Starry Night',
  artist: 'Retro Wave',
  album: 'Synth City',
  durationMs: 50_000, // Outro gap: 36_000 -> 50_000 (14s gap)
  app: 'spotify.exe'
}

describe('Style-Aware Ambient Mode', () => {
  const styles: StyleId[] = ['ship', 'fisheye', 'fisheye-visual', 'visual', 'codestyle']

  styles.forEach((styleId) => {
    describe(`Visualization Style: ${styleId}`, () => {
      it('initializes and configures presenter style identity', () => {
        const els = makeMockElements()
        const presenter = new AmbientPresenter(els)
        presenter.setStyle(styleId)
        expect(presenter.style).toBe(styleId)
      })

      it('correctly handles normal lyric playback', () => {
        const els = makeMockElements()
        const presenter = new AmbientPresenter(els)
        presenter.setStyle(styleId)
        presenter.setTrack(sampleTrack)
        presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
        presenter.setArtwork('https://art.example.com/cover.jpg')

        // Normal lyric playback at t=11_000 (inside first line)
        const isBusy = presenter.update(11_000)
        expect(presenter.state).toBe('lyrics')
        expect(presenter.isOverlayActive).toBe(false)
        expect(els.setPresentationState).toHaveBeenCalledWith('lyrics')
        expect(isBusy).toBe(false)
      })

      it('detects qualifying timestamp gaps and transitions to ambient presentation', () => {
        const els = makeMockElements()
        const presenter = new AmbientPresenter(els)
        presenter.setStyle(styleId)
        presenter.setTrack(sampleTrack)
        presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
        presenter.setArtwork('https://art.example.com/cover.jpg')

        // 1. Intro gap starts at t=0 (0..10_000ms): first 500ms is transitioning-to-artwork
        const busyIntro = presenter.update(100)
        expect(presenter.state).toBe('transitioning-to-artwork')
        expect(presenter.isOverlayActive).toBe(true)
        expect(busyIntro).toBe(true) // Requires 60fps for smooth crossfade

        // 2. Middle of intro gap at t=5000: full artwork presentation
        const busyMid = presenter.update(5000)
        expect(presenter.state).toBe('artwork')
        expect(presenter.isOverlayActive).toBe(true)
        expect(busyMid).toBe(false) // Settled state saves GPU power

        // Check aria-hidden is removed so assistive tech knows artwork player is active
        expect(els.container.removeAttribute).toHaveBeenCalledWith('aria-hidden')
      })

      it('restores lyrics presentation ~500ms before the next lyric begins', () => {
        const els = makeMockElements()
        const presenter = new AmbientPresenter(els)
        presenter.setStyle(styleId)
        presenter.setTrack(sampleTrack)
        presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
        presenter.setArtwork('https://art.example.com/cover.jpg')

        // Intro gap ends at 10_000ms.
        // At t=9600ms (within 500ms before next lyric): transitioning-to-lyrics!
        const busyReturn = presenter.update(9600)
        expect(presenter.state).toBe('transitioning-to-lyrics')
        expect(busyReturn).toBe(true)
        expect(els.setPresentationState).toHaveBeenCalledWith('transitioning-to-lyrics')

        // At t=10_000ms (lyric starts): back to lyrics!
        presenter.update(10_000)
        expect(presenter.state).toBe('lyrics')
        expect(presenter.isOverlayActive).toBe(false)
        expect(els.setPresentationState).toHaveBeenCalledWith('lyrics')
      })

      it('smoothly handles seeking directly into and out of ambient transitions', () => {
        const els = makeMockElements()
        const presenter = new AmbientPresenter(els)
        presenter.setStyle(styleId)
        presenter.setTrack(sampleTrack)
        presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
        presenter.setArtwork('https://art.example.com/cover.jpg')

        // User starts at vocal line t=18_000
        presenter.update(18_000)
        expect(presenter.state).toBe('lyrics')

        // User seeks directly to t=25_000 (in 20_000..32_000 solo break)
        presenter.update(25_000)
        expect(presenter.state).toBe('artwork')
        expect(presenter.isOverlayActive).toBe(true)

        // User seeks back into lyric line t=12_000
        presenter.update(12_000)
        expect(presenter.state).toBe('lyrics')
        expect(presenter.isOverlayActive).toBe(false)
      })

      it('reports accurate msUntilNextTransition to avoid sleeping through events', () => {
        const els = makeMockElements()
        const presenter = new AmbientPresenter(els)
        presenter.setStyle(styleId)
        presenter.setTrack(sampleTrack)
        presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
        presenter.setArtwork('https://art.example.com/cover.jpg')

        // During vocal line ending at 20_000ms, next gap starts at 20_000ms
        const until = presenter.msUntilNextTransition(17_000)
        expect(until).toBe(3000) // 20_000 - 17_000 = 3000ms
      })

      it('handles track changes and resets gap timeline properly', () => {
        const els = makeMockElements()
        const presenter = new AmbientPresenter(els)
        presenter.setStyle(styleId)
        presenter.setTrack(sampleTrack)
        presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
        presenter.setArtwork('https://art.example.com/cover.jpg')

        expect(presenter.currentGaps.length).toBeGreaterThan(0)

        // Switch track to one without qualifying instrumental gaps (all gaps < 8000ms)
        const seamlessTrack: TrackInfo = {
          key: 'test:track-2',
          title: 'Speed Up',
          artist: 'Pop Star',
          album: 'Hits',
          durationMs: 12_000,
          app: 'spotify.exe'
        }
        const continuousLyrics: TimedLyrics = {
          wordTiming: 'estimated',
          lines: [
            { text: 'Line 1', start: 1000, end: 5000, words: [] },
            { text: 'Line 2', start: 6000, end: 10000, words: [] }
          ]
        }

        presenter.setTrack(seamlessTrack)
        presenter.setLyrics(continuousLyrics, seamlessTrack.durationMs)

        // All gaps are under 8000ms (intro=1000, interlude=1000, outro=2000), so gaps list is empty
        expect(presenter.currentGaps).toHaveLength(0)

        // At t=5500, state must stay 'lyrics'
        presenter.update(5500)
        expect(presenter.state).toBe('lyrics')
      })
    })
  })
})

describe('Critical Exception: Codestyle Invariant Background', () => {
  it('suppresses stage-bg layers and root properties when Codestyle is active', () => {
    const bgEls = makeMockBackgroundElements()
    const bgManager = new BackgroundManager(bgEls)

    // Set non-codestyle style first
    bgManager.setStyle('ship')
    expect(bgManager.style).toBe('ship')

    const newPalette = {
      primary: '#551122',
      secondary: '#223344',
      tertiary: '#112211',
      glow: '#883355',
      base: '#020205'
    }
    bgManager.setPalette(newPalette)

    // In ship style, album colors are applied to root
    expect(bgEls.root.style.setProperty).toHaveBeenCalledWith('--album-bg-primary', '#551122')
    expect(bgEls.layerB.classList.add).toHaveBeenCalledWith('active')

    // Now switch to codestyle!
    vi.clearAllMocks()
    bgManager.setStyle('codestyle')
    expect(bgManager.style).toBe('codestyle')

    // Layer A and Layer B MUST be deactivated to protect Codestyle's invariant background
    expect(bgEls.layerA.classList.remove).toHaveBeenCalledWith('active')
    expect(bgEls.layerB.classList.remove).toHaveBeenCalledWith('active')

    // Attempting to set an album cover palette while Codestyle is active MUST NOT set root properties
    vi.clearAllMocks()
    bgManager.setPalette({
      primary: '#990000',
      secondary: '#009900',
      tertiary: '#000099',
      glow: '#ff0000',
      base: '#000000'
    })

    // Root properties MUST NOT be touched
    expect(bgEls.root.style.setProperty).not.toHaveBeenCalled()
  })

  it('restores album background layers when switching from Codestyle to another style', () => {
    const bgEls = makeMockBackgroundElements()
    const bgManager = new BackgroundManager(bgEls)

    bgManager.setStyle('codestyle')
    expect(bgManager.style).toBe('codestyle')

    // Switch back to visual style
    vi.clearAllMocks()
    bgManager.setStyle('visual')
    expect(bgManager.style).toBe('visual')

    // Root properties and active layer are restored
    expect(bgEls.root.style.setProperty).toHaveBeenCalledWith('--album-bg-primary', DEFAULT_BACKGROUND_PALETTE.primary)
  })

  it('preserves Codestyle stage visibility during instrumental gaps instead of dimming #stage', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)

    // In 'ship' style: stage dims during gaps
    presenter.setStyle('ship')
    presenter.setTrack(sampleTrack)
    presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
    presenter.setArtwork('https://art.example.com/cover.jpg')

    presenter.update(5000) // inside 0..10_000 gap
    expect(presenter.state).toBe('artwork')
    expect(els.stage.classList.add).toHaveBeenCalledWith('dimmed')

    // In 'codestyle' style: #stage NEVER dims (the background is invariant)
    vi.clearAllMocks()
    presenter.setStyle('codestyle')
    expect(presenter.style).toBe('codestyle')

    presenter.update(5000) // still in gap
    expect(presenter.state).toBe('artwork')
    // stage classList.add('dimmed') must NOT be called for codestyle!
    expect(els.stage.classList.add).not.toHaveBeenCalledWith('dimmed')
  })

  it('dynamically switches styles and updates presentation configuration immediately', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)
    presenter.setTrack(sampleTrack)
    presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
    presenter.setArtwork('https://art.example.com/cover.jpg')

    // Start with fisheye during gap
    presenter.setStyle('fisheye')
    presenter.update(5000)
    expect(presenter.state).toBe('artwork')
    expect(els.stage.classList.add).toHaveBeenCalledWith('dimmed')

    // Switch to codestyle while gap is still active
    vi.clearAllMocks()
    presenter.setStyle('codestyle')
    expect(presenter.style).toBe('codestyle')
    // Changing to codestyle dynamically undims stage so invariant background is displayed
    expect(els.stage.classList.remove).toHaveBeenCalledWith('dimmed')

    // Switch back to visual
    vi.clearAllMocks()
    presenter.setStyle('visual')
    expect(presenter.style).toBe('visual')
    expect(els.stage.classList.add).toHaveBeenCalledWith('dimmed')
  })
})

describe('Fisheye & Fisheye-Visual Ambient Integration', () => {
  const styles: StyleId[] = ['fisheye', 'fisheye-visual']

  for (const style of styles) {
    it(`enables dynamic album background for ${style}`, () => {
      const bgEls = makeMockBackgroundElements()
      const bgManager = new BackgroundManager(bgEls)

      bgManager.setStyle(style)
      expect(bgManager.style).toBe(style)

      const palette = {
        primary: '#332244',
        secondary: '#112233',
        tertiary: '#443322',
        glow: '#664488',
        base: '#030206'
      }
      bgManager.setPalette(palette)

      // Album art background must be applied and layer activated
      expect(bgEls.root.style.setProperty).toHaveBeenCalledWith('--album-bg-primary', '#332244')
      expect(bgEls.layerB.classList.add).toHaveBeenCalledWith('active')
    })

    it(`manages gap transitions smoothly for ${style}`, () => {
      const els = makeMockElements()
      const presenter = new AmbientPresenter(els)
      presenter.setStyle(style)
      presenter.setTrack(sampleTrack)
      presenter.setLyrics(sampleLyricsWithGaps, sampleTrack.durationMs)
      presenter.setArtwork('https://art.example.com/cover.jpg')

      // Normal lyrics
      presenter.update(12_000)
      expect(presenter.state).toBe('lyrics')
      expect(els.stage.classList.remove).toHaveBeenCalledWith('dimmed')

      // Pre-gap transition (gap starts at 20_000, 500ms fade into artwork)
      vi.clearAllMocks()
      presenter.update(20_200)
      expect(presenter.state).toBe('transitioning-to-artwork')
      expect(els.stage.classList.add).toHaveBeenCalledWith('dimmed')

      // In gap
      vi.clearAllMocks()
      presenter.update(26_000)
      expect(presenter.state).toBe('artwork')
      expect(els.stage.classList.add).toHaveBeenCalledWith('dimmed')

      // Return to lyrics transition (500ms lead before lyrics resume at 32_000ms)
      vi.clearAllMocks()
      presenter.update(31_800)
      expect(presenter.state).toBe('transitioning-to-lyrics')
      expect(els.stage.classList.remove).toHaveBeenCalledWith('dimmed')
    })
  }
})
