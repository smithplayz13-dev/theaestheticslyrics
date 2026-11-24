import type { StyleId, TimedLyrics, TrackInfo } from '@shared/types'
import {
  evaluatePresentationState,
  FADE_TO_ARTWORK_DURATION_MS,
  findInstrumentalGaps,
  formatTime,
  type InstrumentalGap,
  type PresentationState,
  RETURN_TO_LYRICS_LEAD_MS
} from './instrumental'

export type { InstrumentalGap, PresentationState }
export {
  evaluatePresentationState,
  FADE_TO_ARTWORK_DURATION_MS,
  findInstrumentalGaps,
  formatTime,
  RETURN_TO_LYRICS_LEAD_MS
}

export interface AmbientDomTarget {
  classList: {
    add(className: string): void
    remove(className: string): void
  }
}

export interface AmbientTextTarget {
  textContent: string | null
  hidden?: boolean | string
}

export interface AmbientImageTarget {
  src: string
  removeAttribute(qualifiedName: string): void
}

export interface AmbientStyleTarget {
  style: {
    width?: string
    left?: string
    opacity?: string
  }
}

export interface AmbientButtonTarget {
  dataset?: {
    playing?: string
  }
  setAttribute?(qualifiedName: string, value: string): void
}

export interface AmbientPresenterElements {
  container?: (AmbientDomTarget & { setAttribute?(name: string, val: string): void; removeAttribute?(name: string): void }) | null
  stage?: (AmbientDomTarget & { style?: { opacity?: string } }) | null
  img?: AmbientImageTarget | null
  glowImg?: AmbientImageTarget | null
  titleEl?: AmbientTextTarget | null
  artistEl?: AmbientTextTarget | null
  curTimeEl?: AmbientTextTarget | null
  totalTimeEl?: AmbientTextTarget | null
  fillEl?: AmbientStyleTarget | null
  thumbEl?: AmbientStyleTarget | null
  playPauseBtn?: AmbientButtonTarget | null
  setPresentationMode?: (mode: string) => void
  setPresentationState?: (state: PresentationState) => void
}

/**
 * Centralized, style-aware Ambient Mode presenter.
 * Coordinates explicit fullscreen Ambient Mode, automatic lyrics-to-ambient transitions
 * during qualifying instrumental breaks (~8s), and style-specific background/presentation adaptation.
 */
export class AmbientPresenter {
  private ambientMode = false
  private currentStyle: StyleId = 'ship'
  private track: TrackInfo | null = null
  private lyrics: TimedLyrics | null = null
  private gaps: InstrumentalGap[] = []
  private artworkUrl: string | null = null
  private durationMs = 0
  private isSeeking = false
  private presentationState: PresentationState = 'lyrics'
  private lastAppliedState: PresentationState | null = null

  constructor(private readonly elements?: AmbientPresenterElements) {}

  get isAmbient(): boolean {
    return this.ambientMode
  }

  get isOverlayActive(): boolean {
    return this.presentationState === 'artwork' || this.presentationState === 'transitioning-to-artwork'
  }

  get isPresentationActive(): boolean {
    return this.ambientMode || this.isOverlayActive
  }

  get state(): PresentationState {
    return this.presentationState
  }

  get currentGaps(): readonly InstrumentalGap[] {
    return this.gaps
  }

  get style(): StyleId {
    return this.currentStyle
  }

  get seeking(): boolean {
    return this.isSeeking
  }

  setSeeking(seeking: boolean): void {
    this.isSeeking = seeking
  }

  setStyle(style: StyleId): void {
    if (this.currentStyle === style) return
    this.currentStyle = style
    // Re-apply presentation state with style-specific considerations if active
    if (this.lastAppliedState) {
      this.applyPresentationState(this.lastAppliedState)
    }
  }

  setAmbientMode(active: boolean): void {
    this.ambientMode = active
    this.elements?.setPresentationMode?.(active ? 'ambient' : 'normal')
    if (this.elements?.container) {
      if (active || this.isOverlayActive) {
        this.elements.container.removeAttribute?.('aria-hidden')
      } else {
        this.elements.container.setAttribute?.('aria-hidden', 'true')
      }
    }
  }

  setLyrics(lyrics: TimedLyrics | null, durationMs?: number): void {
    this.lyrics = lyrics
    const dur = durationMs ?? this.durationMs
    this.gaps = findInstrumentalGaps(lyrics, dur)
  }

  setTrack(track: TrackInfo | null): void {
    this.track = track
    this.durationMs = track?.durationMs ?? 0
    // Recalculate gaps when track/duration changes
    if (this.lyrics) {
      this.gaps = findInstrumentalGaps(this.lyrics, this.durationMs)
    }
    if (this.elements?.titleEl) {
      this.elements.titleEl.textContent = track?.title?.trim() || ''
    }
    if (this.elements?.artistEl) {
      this.elements.artistEl.textContent = track?.artist?.trim() || ''
    }
    if (this.elements?.totalTimeEl) {
      this.elements.totalTimeEl.textContent = formatTime(this.durationMs)
    }
  }

  setArtwork(url: string | null): void {
    this.artworkUrl = url
    if (this.elements?.img) {
      if (url) {
        this.elements.img.src = url
      } else {
        this.elements.img.removeAttribute('src')
      }
    }
    if (this.elements?.glowImg) {
      if (url) {
        this.elements.glowImg.src = url
      } else {
        this.elements.glowImg.removeAttribute('src')
      }
    }
  }

  setPlaying(playing: boolean): void {
    if (this.elements?.playPauseBtn) {
      if (this.elements.playPauseBtn.dataset) {
        this.elements.playPauseBtn.dataset.playing = String(playing)
      }
      this.elements.playPauseBtn.setAttribute?.('data-playing', String(playing))
    }
  }

  seekToPercent(pct: number): number {
    const clamped = Math.max(0, Math.min(1, pct))
    const targetMs = Math.round(clamped * this.durationMs)
    const pctStr = `${(clamped * 100).toFixed(2)}%`
    if (this.elements?.fillEl) {
      this.elements.fillEl.style.width = pctStr
    }
    if (this.elements?.thumbEl) {
      this.elements.thumbEl.style.left = pctStr
    }
    if (this.elements?.curTimeEl) {
      this.elements.curTimeEl.textContent = formatTime(targetMs)
    }
    return targetMs
  }

  /**
   * Evaluates presentation state and updates ambient progress elements.
   * Returns true while a transition is actively animating (requiring full 60fps).
   */
  update(songMs: number): boolean {
    const hasArtwork = Boolean(this.artworkUrl)
    const nextState = evaluatePresentationState(songMs, this.gaps, hasArtwork)
    this.presentationState = nextState

    if (this.presentationState !== this.lastAppliedState) {
      this.lastAppliedState = this.presentationState
      this.applyPresentationState(this.presentationState)
    }

    if (!this.isSeeking) {
      const dur = this.durationMs > 0 ? this.durationMs : 0
      const pct = dur > 0 ? Math.max(0, Math.min(1, songMs / dur)) : 0
      const pctStr = `${(pct * 100).toFixed(2)}%`

      if (this.elements?.fillEl) {
        this.elements.fillEl.style.width = pctStr
      }
      if (this.elements?.thumbEl) {
        this.elements.thumbEl.style.left = pctStr
      }
      if (this.elements?.curTimeEl) {
        this.elements.curTimeEl.textContent = formatTime(songMs)
      }
      if (this.elements?.totalTimeEl) {
        this.elements.totalTimeEl.textContent = formatTime(dur)
      }
    }

    const isTransitioning =
      this.presentationState === 'transitioning-to-artwork' ||
      this.presentationState === 'transitioning-to-lyrics'

    return isTransitioning || this.isSeeking
  }

  /**
   * Returns ms until the next instrumental transition begins or ends,
   * ensuring the render loop doesn't sleep past an upcoming transition.
   */
  msUntilNextTransition(songMs: number): number {
    if (!this.artworkUrl || !this.gaps.length) return Number.POSITIVE_INFINITY

    let nearest = Number.POSITIVE_INFINITY
    for (const g of this.gaps) {
      if (songMs < g.start) {
        nearest = Math.min(nearest, g.start - songMs)
      } else if (songMs < g.start + FADE_TO_ARTWORK_DURATION_MS) {
        nearest = Math.min(nearest, g.start + FADE_TO_ARTWORK_DURATION_MS - songMs)
      } else if (songMs < g.end - RETURN_TO_LYRICS_LEAD_MS) {
        nearest = Math.min(nearest, g.end - RETURN_TO_LYRICS_LEAD_MS - songMs)
      } else if (songMs < g.end) {
        nearest = Math.min(nearest, g.end - songMs)
      }
    }
    return nearest
  }

  private applyPresentationState(state: PresentationState): void {
    this.elements?.setPresentationState?.(state)
    const isArt = state === 'artwork' || state === 'transitioning-to-artwork'

    if (this.elements?.container) {
      if (this.ambientMode || isArt) {
        this.elements.container.removeAttribute?.('aria-hidden')
      } else {
        this.elements.container.setAttribute?.('aria-hidden', 'true')
      }
    }

    if (this.elements?.stage) {
      if (isArt) {
        // For Codestyle, the background is invariant and managed via CSS so that
        // #stage remains visible while code lines fade; for all other styles, stage dims.
        if (this.currentStyle === 'codestyle') {
          this.elements.stage.classList.remove('dimmed')
        } else {
          this.elements.stage.classList.add('dimmed')
        }
      } else {
        this.elements.stage.classList.remove('dimmed')
      }
    }
  }
}
