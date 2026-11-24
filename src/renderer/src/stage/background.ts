import { DEFAULT_BACKGROUND_PALETTE, type BackgroundPalette, type StyleId } from '@shared/types'

export interface BackgroundLayerTarget {
  style: {
    setProperty(property: string, value: string): void
  }
  classList: {
    add(className: string): void
    remove(className: string): void
  }
}

export interface BackgroundElements {
  layerA: BackgroundLayerTarget
  layerB: BackgroundLayerTarget
  root?: { style: { setProperty(property: string, value: string): void } }
}

/**
 * Manages dynamic album-derived background layers and smooth crossfades between tracks.
 * Enforces strict style-awareness: styles with invariant backgrounds (e.g. Codestyle)
 * are completely shielded from album-derived background colors and layers.
 */
export class BackgroundManager {
  private currentPalette: BackgroundPalette = { ...DEFAULT_BACKGROUND_PALETTE }
  private activeLayerIsA = true
  private currentStyle: StyleId | null = null

  constructor(private readonly elements?: BackgroundElements) {
    if (elements) {
      this.applyPaletteToLayer(elements.layerA, this.currentPalette)
      elements.layerA.classList.add('active')
      elements.layerB.classList.remove('active')
    }
  }

  get palette(): BackgroundPalette {
    return this.currentPalette
  }

  get style(): StyleId | null {
    return this.currentStyle
  }

  /**
   * Adapts the background management to the active visualization style.
   * For Codestyle, deactivates album background layers completely to preserve
   * its original invariant background.
   */
  setStyle(style: StyleId): void {
    if (this.currentStyle === style) return
    const prevStyle = this.currentStyle
    this.currentStyle = style

    if (!this.elements) return

    if (style === 'codestyle') {
      // Invariant background rule: Codestyle MUST retain its original default background
      this.elements.layerA.classList.remove('active')
      this.elements.layerB.classList.remove('active')
    } else if (prevStyle === 'codestyle') {
      // Restoring a style that supports dynamic album backgrounds
      const activeLayer = this.activeLayerIsA ? this.elements.layerA : this.elements.layerB
      const inactiveLayer = this.activeLayerIsA ? this.elements.layerB : this.elements.layerA
      this.applyPaletteToLayer(activeLayer, this.currentPalette)
      activeLayer.classList.add('active')
      inactiveLayer.classList.remove('active')

      const root = this.elements.root
      if (root) {
        root.style.setProperty('--album-bg-primary', this.currentPalette.primary)
        root.style.setProperty('--album-bg-secondary', this.currentPalette.secondary)
        root.style.setProperty('--album-bg-tertiary', this.currentPalette.tertiary)
        root.style.setProperty('--album-bg-glow', this.currentPalette.glow)
        root.style.setProperty('--album-bg-base', this.currentPalette.base)
      }
    }
  }

  /**
   * Sets the current background palette and triggers a smooth crossfade if changed.
   * Has no visual side effects when Codestyle is active.
   */
  setPalette(palette: BackgroundPalette | null | undefined): void {
    const next = palette ?? DEFAULT_BACKGROUND_PALETTE
    if (this.isEqual(this.currentPalette, next)) return

    this.currentPalette = next

    // When Codestyle is active, do not apply album colors to root or layers
    if (this.currentStyle === 'codestyle') return

    // Apply global root properties for ambient elements (like the artwork glow)
    const root = this.elements?.root
    if (root) {
      root.style.setProperty('--album-bg-primary', next.primary)
      root.style.setProperty('--album-bg-secondary', next.secondary)
      root.style.setProperty('--album-bg-tertiary', next.tertiary)
      root.style.setProperty('--album-bg-glow', next.glow)
      root.style.setProperty('--album-bg-base', next.base)
    }

    if (!this.elements) return

    // Crossfade between Layer A and Layer B
    const incoming = this.activeLayerIsA ? this.elements.layerB : this.elements.layerA
    const outgoing = this.activeLayerIsA ? this.elements.layerA : this.elements.layerB

    this.applyPaletteToLayer(incoming, next)
    incoming.classList.add('active')
    outgoing.classList.remove('active')

    this.activeLayerIsA = !this.activeLayerIsA
  }

  private applyPaletteToLayer(layer: BackgroundLayerTarget, p: BackgroundPalette): void {
    layer.style.setProperty('--album-bg-primary', p.primary)
    layer.style.setProperty('--album-bg-secondary', p.secondary)
    layer.style.setProperty('--album-bg-tertiary', p.tertiary)
    layer.style.setProperty('--album-bg-glow', p.glow)
    layer.style.setProperty('--album-bg-base', p.base)
  }

  private isEqual(a: BackgroundPalette, b: BackgroundPalette): boolean {
    return (
      a.primary === b.primary &&
      a.secondary === b.secondary &&
      a.tertiary === b.tertiary &&
      a.glow === b.glow &&
      a.base === b.base
    )
  }
}
