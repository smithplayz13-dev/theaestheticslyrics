import type { TimedLyrics, TrackInfo } from '@shared/types'

export type PresentationState =
  | 'lyrics'
  | 'transitioning-to-artwork'
  | 'artwork'
  | 'transitioning-to-lyrics'

export interface InstrumentalGap {
  start: number
  end: number
  duration: number
}

/** Minimum gap duration in ms to trigger the full instrumental artwork presentation. */
export const INSTRUMENTAL_MIN_GAP_MS = 8000
/** Lead time before the next lyric starts to begin fading back to lyrics. */
export const RETURN_TO_LYRICS_LEAD_MS = 500
/** Duration of the fade from lyrics to artwork. */
export const FADE_TO_ARTWORK_DURATION_MS = 500

/**
 * Normalizes lyric timestamps across providers (KaraLyr, Musixmatch, Better Lyrics,
 * LRCLIB, NetEase) and finds extended instrumental breaks.
 */
export function findInstrumentalGaps(lyrics: TimedLyrics | null, durationMs = 0): InstrumentalGap[] {
  if (!lyrics || !lyrics.lines.length) return []

  // Guard against missing/incomplete timestamps
  const hasTimestamps = lyrics.lines.some((line) => line.start > 0 || line.end > 0)
  if (!hasTimestamps) return []

  const lineStart = (l: TimedLyrics['lines'][number]): number =>
    l.words.length ? l.words[0]!.start : l.start
  const lineEnd = (l: TimedLyrics['lines'][number]): number =>
    l.words.length ? l.words[l.words.length - 1]!.end : l.end

  const gaps: InstrumentalGap[] = []

  // 1. Intro gap (before first lyric line)
  const firstStart = lineStart(lyrics.lines[0]!)
  if (firstStart >= INSTRUMENTAL_MIN_GAP_MS) {
    gaps.push({ start: 0, end: firstStart, duration: firstStart })
  }

  // 2. Interlude gaps (between consecutive lyric lines)
  for (let i = 0; i < lyrics.lines.length - 1; i++) {
    const currEnd = lineEnd(lyrics.lines[i]!)
    const nextStart = lineStart(lyrics.lines[i + 1]!)
    const gap = nextStart - currEnd
    if (gap >= INSTRUMENTAL_MIN_GAP_MS && nextStart > currEnd) {
      gaps.push({ start: currEnd, end: nextStart, duration: gap })
    }
  }

  // 3. Outro gap (after last lyric line, when duration is known)
  if (durationMs > 0) {
    const lastEnd = lineEnd(lyrics.lines[lyrics.lines.length - 1]!)
    const gap = durationMs - lastEnd
    if (gap >= INSTRUMENTAL_MIN_GAP_MS && durationMs > lastEnd) {
      gaps.push({ start: lastEnd, end: durationMs, duration: gap })
    }
  }

  return gaps
}

/**
 * Evaluates the appropriate presentation state for a given song time and list of gaps.
 */
export function evaluatePresentationState(
  songMs: number,
  gaps: InstrumentalGap[],
  hasArtwork: boolean
): PresentationState {
  if (!hasArtwork || !gaps.length) return 'lyrics'

  const gap = gaps.find((g) => songMs >= g.start && songMs < g.end)
  if (!gap) return 'lyrics'

  // When approaching the next lyric, transition back early
  if (songMs >= gap.end - RETURN_TO_LYRICS_LEAD_MS) {
    return 'transitioning-to-lyrics'
  }

  // When beginning the instrumental break, fade in to artwork
  if (songMs < gap.start + FADE_TO_ARTWORK_DURATION_MS) {
    return 'transitioning-to-artwork'
  }

  // Full instrumental artwork view
  return 'artwork'
}

export interface InstrumentalDomTarget {
  classList: {
    add(className: string): void
    remove(className: string): void
  }
  hidden?: boolean | string
}

export interface InstrumentalImageTarget {
  src: string
  removeAttribute(qualifiedName: string): void
}

export interface InstrumentalTextTarget {
  textContent: string | null
  hidden: boolean | string
}

export interface InstrumentalPresenterElements {
  container: InstrumentalDomTarget
  img: InstrumentalImageTarget
  glowImg?: InstrumentalImageTarget | null
  stage: InstrumentalDomTarget
  titleEl?: InstrumentalTextTarget | null
  artistEl?: InstrumentalTextTarget | null
  metaContainer?: InstrumentalDomTarget | null
  setPresentationState?: (state: PresentationState) => void
}

/**
 * Coordinates instrumental break detection, artwork transitions, and DOM state.
 */
export class InstrumentalPresenter {
  private gaps: InstrumentalGap[] = []
  private state: PresentationState = 'lyrics'
  private artworkUrl: string | null = null
  private track: TrackInfo | null = null
  private lastAppliedState: PresentationState | null = null

  constructor(private readonly elements?: InstrumentalPresenterElements) {}

  get currentState(): PresentationState {
    return this.state
  }

  get currentGaps(): readonly InstrumentalGap[] {
    return this.gaps
  }

  get currentTrack(): TrackInfo | null {
    return this.track
  }

  setLyrics(lyrics: TimedLyrics | null, durationMs = 0): void {
    this.gaps = findInstrumentalGaps(lyrics, durationMs)
  }

  setTrack(track: TrackInfo | null): void {
    this.track = track
    if (!this.elements) return

    const title = track?.title?.trim() ?? ''
    const artist = track?.artist?.trim() ?? ''

    if (this.elements.titleEl) {
      this.elements.titleEl.textContent = title
      this.elements.titleEl.hidden = !title
    }
    if (this.elements.artistEl) {
      this.elements.artistEl.textContent = artist
      this.elements.artistEl.hidden = !artist
    }
    if (this.elements.metaContainer) {
      this.elements.metaContainer.hidden = !title && !artist
    }
  }

  setArtwork(url: string | null): void {
    this.artworkUrl = url
    if (this.elements) {
      if (url) {
        this.elements.img.src = url
        if (this.elements.glowImg) this.elements.glowImg.src = url
      } else {
        this.elements.img.removeAttribute('src')
        if (this.elements.glowImg) this.elements.glowImg.removeAttribute('src')
      }
    }
  }

  /**
   * Updates state for the current frame.
   * Returns true if a transition is actively animating (requiring full 60fps).
   */
  update(songMs: number): boolean {
    const hasArtwork = Boolean(this.artworkUrl)
    const nextState = evaluatePresentationState(songMs, this.gaps, hasArtwork)
    this.state = nextState

    if (this.elements && this.state !== this.lastAppliedState) {
      this.lastAppliedState = this.state
      this.applyDom(this.state)
    }

    return this.state === 'transitioning-to-artwork' || this.state === 'transitioning-to-lyrics'
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

  private applyDom(state: PresentationState): void {
    if (!this.elements) return
    this.elements.setPresentationState?.(state)
    const isArt = state === 'artwork' || state === 'transitioning-to-artwork'

    if (isArt) {
      this.elements.container.classList.add('active')
      this.elements.stage.classList.add('dimmed')
    } else {
      this.elements.container.classList.remove('active')
      this.elements.stage.classList.remove('dimmed')
    }
  }
}
