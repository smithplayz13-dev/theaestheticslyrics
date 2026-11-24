/** The four display styles, mirroring Verci's menu. */
export type StyleId = 'ship' | 'fisheye' | 'fisheye-visual' | 'visual' | 'codestyle'

/** Where the words show: the lock-style screen, or an always-on overlay. */
export type ShowOn = 'lock' | 'always'

export type ColorRole = 'lyric' | 'highlight' | 'secondary'

/** All colours are lowercase `#rrggbb`. */
export interface Palette {
  lyric: string
  highlight: string
  /** Text drawn on top of the highlight box. */
  highlightText: string
  secondary: string
}

/** Background gradient palette derived from album artwork. */
export interface BackgroundPalette {
  primary: string
  secondary: string
  tertiary: string
  glow: string
  base: string
}

export const DEFAULT_BACKGROUND_PALETTE: BackgroundPalette = {
  primary: '#14111d',
  secondary: '#0f141f',
  tertiary: '#181412',
  glow: '#3b304c',
  base: '#050508'
}

export type AmbientAnimation = 'static' | 'reactive'

/** Settings for Lumn-inspired native ambient rim lighting. */
export interface AmbientLightingSettings {
  /** Ambient lighting enabled or disabled. */
  enabled: boolean
  /** Animation mode: static glow or dynamic music reactive. */
  animation: AmbientAnimation
  /** Glow intensity from 0.1 to 1.0. */
  intensity: number
  /** Perimeter rim thickness in pixels (40 to 250). */
  thickness: number
  /** Diffusion / blur radius in pixels (10 to 80). */
  diffusion: number
  /** User manual primary color hex (#rrggbb). */
  primaryColor: string
  /** User manual secondary color hex (#rrggbb). */
  secondaryColor: string
  /** Balance between primary and secondary (0.0 = 100% primary, 1.0 = 100% secondary, 0.5 = 50/50). */
  colorBalance: number
  /** Automatically extract colors from currently playing album artwork. */
  autoColor: boolean
  /** Override album colors with user chosen primary/secondary colors. */
  overrideColor: boolean
}

export const DEFAULT_AMBIENT_LIGHTING: Readonly<AmbientLightingSettings> = Object.freeze({
  enabled: false,
  animation: 'reactive',
  intensity: 0.92,
  thickness: 28,
  diffusion: 42,
  primaryColor: '#7952ec',
  secondaryColor: '#2563eb',
  colorBalance: 0.5,
  autoColor: true,
  overrideColor: false
})

/** Representative two-color gradient palette for ambient rim lighting. */
export interface AmbientLightingPalette {
  primary: string
  secondary: string
}

export const DEFAULT_AMBIENT_PALETTE: Readonly<AmbientLightingPalette> = Object.freeze({
  primary: '#7952ec',
  secondary: '#2563eb'
})

/** Times are integer milliseconds of song time. */
export interface TimedWord {
  text: string
  start: number
  end: number
}

export interface TimedLine {
  text: string
  start: number
  end: number
  words: TimedWord[]
}

export type LyricsSource =
  | 'local'
  | 'cache'
  | 'lrclib'
  | 'netease'
  | 'musixmatch'
  | 'karalyr'
  | 'betterlyrics'
  | 'portato'
  | 'unison'

export type SyncQuality = 'syllable' | 'word' | 'line' | 'unsynced'

export interface TimedLyrics {
  lines: TimedLine[]
  /** `native` when the source carried per-word tags, `estimated` otherwise. */
  wordTiming: 'native' | 'estimated'
  estimatedCount?: number
  source?: LyricsSource
  syncQuality?: SyncQuality
}

export interface TrackInfo {
  /** Stable identity of the track within one player session. */
  key: string
  app: string
  title: string
  artist: string
  album: string
  /** 0 when the player does not report a duration. */
  durationMs: number
}

/**
 * Song position `positionMs` was true at wall-clock `atEpochMs`.
 * While `playing`, the current position is extrapolated from that anchor.
 */
export interface PlaybackAnchor {
  trackKey: string
  positionMs: number
  atEpochMs: number
  playing: boolean
  rate: number
}

export type LyricsStatus = 'idle' | 'searching' | 'found' | 'not-found' | 'instrumental' | 'error'

export const STYLE_IDS: readonly StyleId[] = [
  'ship',
  'fisheye',
  'fisheye-visual',
  'visual',
  'codestyle'
]

export const STYLE_LABELS: Record<StyleId, string> = {
  ship: 'Ship',
  fisheye: 'Fisheye',
  'fisheye-visual': 'Fisheye Visual',
  visual: 'Visual',
  codestyle: 'Codestyle'
}
