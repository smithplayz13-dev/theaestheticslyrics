import {
  DEFAULT_AMBIENT_LIGHTING,
  DEFAULT_AMBIENT_PALETTE,
  type AmbientLightingPalette,
  type AmbientLightingSettings
} from '@shared/types'
import type { LyricsModel } from './model'
import { activeWordIndex } from './model'

export interface RimDomTarget {
  style: {
    display?: string
    setProperty(property: string, value: string): void
    getPropertyValue?(property: string): string
  }
  classList: {
    add(className: string): void
    remove(className: string): void
    contains?(className: string): boolean
  }
}

export interface RimLightingElements {
  container?: RimDomTarget | null
  layerA?: RimDomTarget | null
  layerB?: RimDomTarget | null
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 121, g: 82, b: 236 }
  const n = Number.parseInt(m[1]!, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const ch = (v: number): string =>
    Math.round(Math.min(255, Math.max(0, Number.isFinite(v) ? v : 0)))
      .toString(16)
      .padStart(2, '0')
  return `#${ch(r)}${ch(g)}${ch(b)}`
}

/**
 * Gamma-corrected optical light mixing of two hex colors.
 */
export function mixHex(c1: string, c2: string, weight: number): string {
  const w = Math.max(0, Math.min(1, weight))
  const rgb1 = hexToRgb(c1)
  const rgb2 = hexToRgb(c2)
  const r = Math.sqrt((1 - w) * rgb1.r ** 2 + w * rgb2.r ** 2)
  const g = Math.sqrt((1 - w) * rgb1.g ** 2 + w * rgb2.g ** 2)
  const b = Math.sqrt((1 - w) * rgb1.b ** 2 + w * rgb2.b ** 2)
  return rgbToHex({ r, g, b })
}

/**
 * Computes corner color along the perimeter given primary/secondary colors and balance.
 */
export function computeCornerColor(
  primary: string,
  secondary: string,
  balance: number,
  corner: 'tl' | 'tr' | 'br' | 'bl'
): string {
  const b = Math.max(0, Math.min(1, balance))
  switch (corner) {
    case 'tl':
      return b > 0.5 ? mixHex(primary, secondary, (b - 0.5) * 0.7) : primary
    case 'br':
      return b < 0.5 ? mixHex(secondary, primary, (0.5 - b) * 0.7) : secondary
    case 'tr':
    case 'bl':
      return mixHex(primary, secondary, b)
  }
}

/**
 * Manages native Lumn-inspired ambient rim lighting around all four edges of the application window.
 * Provides continuous edge lighting, smooth crossfades between tracks, and music-reactive animation.
 */
export class RimLightingPresenter {
  private currentSettings: AmbientLightingSettings = { ...DEFAULT_AMBIENT_LIGHTING }
  private currentPalette: AmbientLightingPalette = { ...DEFAULT_AMBIENT_PALETTE }
  private activeLayerIsA = true
  private reactiveEnergy = 0
  private lastWordIndex = -1

  constructor(private readonly elements?: RimLightingElements) {
    if (elements?.layerA && elements?.layerB) {
      this.applyPaletteToLayer(elements.layerA, this.currentPalette, this.currentSettings.colorBalance)
      elements.layerA.classList.add('active')
      elements.layerB.classList.remove('active')
    }
    if (elements?.container) {
      this.applySettingsToContainer(this.currentSettings)
    }
  }

  get settings(): AmbientLightingSettings {
    return this.currentSettings
  }

  get palette(): AmbientLightingPalette {
    return this.currentPalette
  }

  get energy(): number {
    return this.reactiveEnergy
  }

  /**
   * Updates ambient rim lighting settings (intensity, thickness, diffusion, balance, etc.).
   */
  setSettings(settings: AmbientLightingSettings | null | undefined): void {
    const next = settings ? { ...settings } : { ...DEFAULT_AMBIENT_LIGHTING }
    const balanceChanged = this.currentSettings.colorBalance !== next.colorBalance
    this.currentSettings = next

    if (this.elements?.container) {
      this.applySettingsToContainer(next)
    }

    if (balanceChanged) {
      // Re-apply corner colors with the updated balance
      const activeLayer = this.activeLayerIsA ? this.elements?.layerA : this.elements?.layerB
      if (activeLayer) {
        this.applyPaletteToLayer(activeLayer, this.currentPalette, next.colorBalance)
      }
    }
  }

  /**
   * Sets the current ambient palette and triggers a smooth crossfade if changed.
   */
  setPalette(palette: AmbientLightingPalette | null | undefined): void {
    const next = palette ?? DEFAULT_AMBIENT_PALETTE
    if (this.isEqual(this.currentPalette, next)) return

    this.currentPalette = next

    if (!this.elements?.layerA || !this.elements?.layerB) return

    const incoming = this.activeLayerIsA ? this.elements.layerB : this.elements.layerA
    const outgoing = this.activeLayerIsA ? this.elements.layerA : this.elements.layerB

    this.applyPaletteToLayer(incoming, next, this.currentSettings.colorBalance)
    incoming.classList.add('active')
    outgoing.classList.remove('active')

    this.activeLayerIsA = !this.activeLayerIsA
  }

  /**
   * Frame tick called by the stage render loop to update reactive animation.
   */
  frame(songMs: number, _wallMs: number, model: LyricsModel | null, playing: boolean): boolean {
    if (!this.currentSettings.enabled) return false

    const container = this.elements?.container
    if (!container) return false

    const reducedMotion = this.prefersReducedMotion()
    const isStatic = this.currentSettings.animation === 'static' || reducedMotion

    if (isStatic) {
      container.style.setProperty('--rim-effective-intensity', this.currentSettings.intensity.toFixed(3))
      container.style.setProperty('--rim-effective-thickness', `${this.currentSettings.thickness.toFixed(1)}px`)
      container.style.setProperty(
        '--rim-total',
        `${(this.currentSettings.thickness + this.currentSettings.diffusion).toFixed(1)}px`
      )
      this.reactiveEnergy = 0
      return false
    }

    // Music Reactive mode
    let wordImpulse = 0
    if (playing) {
      if (model && model.words.length > 0) {
        const wIdx = activeWordIndex(model, songMs)
        if (wIdx >= 0 && wIdx < model.words.length) {
          const word = model.words[wIdx]!
          const since = songMs - word.start
          if (since >= 0 && since < 350) {
            wordImpulse = Math.exp(-since / 120)
          }
          if (wIdx !== this.lastWordIndex) {
            this.lastWordIndex = wIdx
          }
        }
      }

      // Gentle organic musical rhythm breathing cycle (~115 BPM)
      const rhythm = 0.5 + 0.5 * Math.sin((songMs / 520) * 2 * Math.PI)
      const targetEnergy = Math.max(0, Math.min(1, 0.65 * wordImpulse + 0.35 * rhythm))

      // Smooth attack and subtle decay
      const rate = targetEnergy > this.reactiveEnergy ? 0.22 : 0.09
      this.reactiveEnergy += (targetEnergy - this.reactiveEnergy) * rate
    } else {
      // Music paused: smoothly settle toward resting calm glow
      this.reactiveEnergy += (0 - this.reactiveEnergy) * 0.08
    }

    // Subtle, high-fidelity modulation avoiding harsh strobing:
    // Intensity modulates within ±12% of user's chosen setting;
    // Thickness blooms inward up to +6% on peaks.
    const effectiveIntensity = this.currentSettings.intensity * (0.88 + 0.24 * this.reactiveEnergy)
    const effectiveThickness = this.currentSettings.thickness * (1 + 0.06 * this.reactiveEnergy)
    const effectiveTotal = effectiveThickness + this.currentSettings.diffusion

    container.style.setProperty('--rim-effective-intensity', effectiveIntensity.toFixed(3))
    container.style.setProperty('--rim-effective-thickness', `${effectiveThickness.toFixed(1)}px`)
    container.style.setProperty('--rim-total', `${effectiveTotal.toFixed(1)}px`)

    return playing && this.reactiveEnergy > 0.02
  }

  private applySettingsToContainer(s: AmbientLightingSettings): void {
    const c = this.elements?.container
    if (!c) return

    c.style.setProperty('--rim-thickness', `${s.thickness}px`)
    c.style.setProperty('--rim-intensity', s.intensity.toFixed(3))
    c.style.setProperty('--rim-diffusion', `${s.diffusion}px`)
    c.style.setProperty('--rim-balance', s.colorBalance.toFixed(3))
    c.style.setProperty('--rim-total', `${s.thickness + s.diffusion}px`)
    c.style.display = s.enabled ? 'block' : 'none'
  }

  private applyPaletteToLayer(layer: RimDomTarget, p: AmbientLightingPalette, balance: number): void {
    const c_tl = computeCornerColor(p.primary, p.secondary, balance, 'tl')
    const c_tr = computeCornerColor(p.primary, p.secondary, balance, 'tr')
    const c_br = computeCornerColor(p.primary, p.secondary, balance, 'br')
    const c_bl = computeCornerColor(p.primary, p.secondary, balance, 'bl')

    layer.style.setProperty('--rim-c-tl', c_tl)
    layer.style.setProperty('--rim-c-tr', c_tr)
    layer.style.setProperty('--rim-c-br', c_br)
    layer.style.setProperty('--rim-c-bl', c_bl)
    layer.style.setProperty('--rim-primary', p.primary)
    layer.style.setProperty('--rim-secondary', p.secondary)
  }

  private isEqual(a: AmbientLightingPalette, b: AmbientLightingPalette): boolean {
    return a.primary.toLowerCase() === b.primary.toLowerCase() && a.secondary.toLowerCase() === b.secondary.toLowerCase()
  }

  private prefersReducedMotion(): boolean {
    const g = globalThis as unknown as { matchMedia?: (query: string) => { matches: boolean } }
    if (typeof g.matchMedia === 'function') {
      return g.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    return false
  }
}
