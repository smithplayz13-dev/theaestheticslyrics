import { describe, expect, it, vi } from 'vitest'
import { AmbientPresenter } from '../src/renderer/src/stage/ambient'
import type { TrackInfo } from '../src/shared/types'

function makeMockElements() {
  const container = {
    classList: {
      add: vi.fn(),
      remove: vi.fn()
    },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn()
  }
  const breakIndicator = {
    classList: {
      add: vi.fn(),
      remove: vi.fn()
    }
  }
  const stage = {
    classList: {
      add: vi.fn(),
      remove: vi.fn()
    }
  }
  const img = {
    src: '',
    removeAttribute: vi.fn((attr) => {
      if (attr === 'src') img.src = ''
    })
  }
  const glowImg = {
    src: '',
    removeAttribute: vi.fn((attr) => {
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
    setAttribute: vi.fn()
  }
  const setPresentationMode = vi.fn()

  return {
    container,
    breakIndicator,
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
    setPresentationMode
  }
}

describe('AmbientPresenter', () => {
  it('toggles ambient presentation state and updates aria attributes', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)

    expect(presenter.isAmbient).toBe(false)
    presenter.setAmbientMode(true)
    expect(presenter.isAmbient).toBe(true)
    expect(els.setPresentationMode).toHaveBeenCalledWith('ambient')
    expect(els.container.removeAttribute).toHaveBeenCalledWith('aria-hidden')

    presenter.setAmbientMode(false)
    expect(presenter.isAmbient).toBe(false)
    expect(els.setPresentationMode).toHaveBeenCalledWith('normal')
    expect(els.container.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true')
  })

  it('populates metadata and total duration from TrackInfo', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)

    const track: TrackInfo = {
      key: 'test-track',
      app: 'spotify.exe',
      title: 'Bring Me To Life',
      artist: 'Evanescence',
      album: 'Fallen',
      durationMs: 235_000
    }

    presenter.setTrack(track)
    expect(els.titleEl.textContent).toBe('Bring Me To Life')
    expect(els.artistEl.textContent).toBe('Evanescence')
    expect(els.totalTimeEl.textContent).toBe('3:55')
  })

  it('sets and clears artwork URL on foreground and ambient glow images', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)

    presenter.setArtwork('data:image/jpeg;base64,abc123')
    expect(els.img.src).toBe('data:image/jpeg;base64,abc123')
    expect(els.glowImg.src).toBe('data:image/jpeg;base64,abc123')

    presenter.setArtwork(null)
    expect(els.img.removeAttribute).toHaveBeenCalledWith('src')
    expect(els.glowImg.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('updates playing state on play/pause button', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)

    presenter.setPlaying(true)
    expect(els.playPauseBtn.dataset.playing).toBe('true')
    expect(els.playPauseBtn.setAttribute).toHaveBeenCalledWith('data-playing', 'true')

    presenter.setPlaying(false)
    expect(els.playPauseBtn.dataset.playing).toBe('false')
    expect(els.playPauseBtn.setAttribute).toHaveBeenCalledWith('data-playing', 'false')
  })

  it('updates current playback progress, fill, and thumb during playback', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)

    presenter.setTrack({
      key: 'k',
      app: 'spotify.exe',
      title: 'T',
      artist: 'A',
      album: 'Al',
      durationMs: 200_000
    })

    presenter.update(50_000, false)
    expect(els.curTimeEl.textContent).toBe('0:50')
    expect(els.fillEl.style.width).toBe('25.00%')
    expect(els.thumbEl.style.left).toBe('25.00%')
  })

  it('calculates seek position and updates preview during seeking', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)

    presenter.setTrack({
      key: 'k',
      app: 'spotify.exe',
      title: 'T',
      artist: 'A',
      album: 'Al',
      durationMs: 200_000
    })

    const targetMs = presenter.seekToPercent(0.5)
    expect(targetMs).toBe(100_000)
    expect(els.curTimeEl.textContent).toBe('1:40')
    expect(els.fillEl.style.width).toBe('50.00%')
    expect(els.thumbEl.style.left).toBe('50.00%')
  })

  it('activates break indicator and dims stage during instrumental breaks', () => {
    const els = makeMockElements()
    const presenter = new AmbientPresenter(els)

    presenter.update(10_000, true)
    expect(els.breakIndicator.classList.add).toHaveBeenCalledWith('active')
    expect(els.stage.classList.add).toHaveBeenCalledWith('ambient-break')

    presenter.update(12_000, false)
    expect(els.breakIndicator.classList.remove).toHaveBeenCalledWith('active')
    expect(els.stage.classList.remove).toHaveBeenCalledWith('ambient-break')
  })
})
