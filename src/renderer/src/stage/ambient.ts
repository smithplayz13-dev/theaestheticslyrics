import type { TrackInfo } from '@shared/types'
import { formatTime } from './instrumental'

export interface AmbientDomTarget {
  classList: {
    add(className: string): void
    remove(className: string): void
  }
}

export interface AmbientTextTarget {
  textContent: string | null
}

export interface AmbientImageTarget {
  src: string
  removeAttribute(qualifiedName: string): void
}

export interface AmbientStyleTarget {
  style: {
    width?: string
    left?: string
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
  breakIndicator?: AmbientDomTarget | null
  stage?: AmbientDomTarget | null
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
}

export class AmbientPresenter {
  private ambientMode = false
  private track: TrackInfo | null = null
  private durationMs = 0
  private isSeeking = false

  constructor(private readonly elements?: AmbientPresenterElements) {}

  get isAmbient(): boolean {
    return this.ambientMode
  }

  get seeking(): boolean {
    return this.isSeeking
  }

  setSeeking(seeking: boolean): void {
    this.isSeeking = seeking
  }

  setAmbientMode(active: boolean): void {
    this.ambientMode = active
    this.elements?.setPresentationMode?.(active ? 'ambient' : 'normal')
    if (this.elements?.container) {
      if (active) {
        this.elements.container.removeAttribute?.('aria-hidden')
      } else {
        this.elements.container.setAttribute?.('aria-hidden', 'true')
      }
    }
  }

  setTrack(track: TrackInfo | null): void {
    this.track = track
    this.durationMs = track?.durationMs ?? 0
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

  update(songMs: number, isBreak: boolean): void {
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

    if (this.elements?.breakIndicator && this.elements?.stage) {
      if (isBreak) {
        this.elements.breakIndicator.classList.add('active')
        this.elements.stage.classList.add('ambient-break')
      } else {
        this.elements.breakIndicator.classList.remove('active')
        this.elements.stage.classList.remove('ambient-break')
      }
    }
  }
}
