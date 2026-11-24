import { describe, expect, it } from 'vitest'
import {
  RimLightingPresenter,
  computeCornerColor,
  hexToRgb,
  mixHex,
  rgbToHex,
  type RimLightingElements
} from '../src/renderer/src/stage/rim-lighting'
import { DEFAULT_AMBIENT_LIGHTING, DEFAULT_AMBIENT_PALETTE } from '../src/shared/types'
import { buildModel, type LyricsModel } from '../src/renderer/src/stage/model'

class MockElement {
  styleProperties = new Map<string, string>()
  classes = new Set<string>()

  style = {
    display: '',
    setProperty: (name: string, value: string) => {
      this.styleProperties.set(name, value)
    },
    getPropertyValue: (name: string) => {
      return this.styleProperties.get(name) || ''
    }
  }

  classList = {
    add: (cls: string) => this.classes.add(cls),
    remove: (cls: string) => this.classes.delete(cls),
    contains: (cls: string) => this.classes.has(cls)
  }
}

describe('Rim Lighting Color Calculations', () => {
  it('round-trips hex and rgb correctly', () => {
    expect(rgbToHex(hexToRgb('#7952ec'))).toBe('#7952ec')
    expect(rgbToHex(hexToRgb('#2563eb'))).toBe('#2563eb')
  })

  it('performs gamma-corrected light mixing', () => {
    expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#ff0000')
    expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#0000ff')
    const mid = mixHex('#ff0000', '#0000ff', 0.5)
    const rgb = hexToRgb(mid)
    // Red and Blue should be equal and luminous in mid purple
    expect(rgb.r).toBeGreaterThan(160)
    expect(rgb.b).toBeGreaterThan(160)
  })

  it('computes corner colors given primary, secondary and balance', () => {
    const p = '#ff0000'
    const s = '#0000ff'

    // At 50/50 balance (0.5):
    // Top-left is 100% primary, bottom-right is 100% secondary
    expect(computeCornerColor(p, s, 0.5, 'tl')).toBe(p)
    expect(computeCornerColor(p, s, 0.5, 'br')).toBe(s)

    // Corners tr and bl are equal 50/50 mix
    expect(computeCornerColor(p, s, 0.5, 'tr')).toBe(mixHex(p, s, 0.5))
    expect(computeCornerColor(p, s, 0.5, 'bl')).toBe(mixHex(p, s, 0.5))

    // When balance shifts to 0.8 (secondary dominant):
    const tr80 = computeCornerColor(p, s, 0.8, 'tr')
    expect(hexToRgb(tr80).b).toBeGreaterThan(hexToRgb(tr80).r)
  })
})

describe('RimLightingPresenter', () => {
  function createMockElements(): {
    container: MockElement
    layerA: MockElement
    layerB: MockElement
    elements: RimLightingElements
  } {
    const container = new MockElement()
    const layerA = new MockElement()
    const layerB = new MockElement()
    return {
      container,
      layerA,
      layerB,
      elements: {
        container,
        layerA,
        layerB
      }
    }
  }

  it('initializes layer A active and applies default CSS variables', () => {
    const { container, layerA, layerB, elements } = createMockElements()
    const presenter = new RimLightingPresenter(elements)

    expect(presenter.settings).toEqual(DEFAULT_AMBIENT_LIGHTING)
    expect(presenter.palette).toEqual(DEFAULT_AMBIENT_PALETTE)

    expect(layerA.classList.contains('active')).toBe(true)
    expect(layerB.classList.contains('active')).toBe(false)

    expect(container.styleProperties.get('--rim-thickness')).toBe(`${DEFAULT_AMBIENT_LIGHTING.thickness}px`)
    expect(container.styleProperties.get('--rim-intensity')).toBe(DEFAULT_AMBIENT_LIGHTING.intensity.toFixed(3))
    expect(container.styleProperties.get('--rim-diffusion')).toBe(`${DEFAULT_AMBIENT_LIGHTING.diffusion}px`)
  })

  it('hides container when disabled and restores when enabled', () => {
    const { container, elements } = createMockElements()
    const presenter = new RimLightingPresenter(elements)

    presenter.setSettings({ ...DEFAULT_AMBIENT_LIGHTING, enabled: false })
    expect(container.style.display).toBe('none')

    presenter.setSettings({ ...DEFAULT_AMBIENT_LIGHTING, enabled: true })
    expect(container.style.display).toBe('block')
  })

  it('smoothly crossfades between layers when track palette changes', () => {
    const { layerA, layerB, elements } = createMockElements()
    const presenter = new RimLightingPresenter(elements)

    expect(layerA.classList.contains('active')).toBe(true)
    expect(layerB.classList.contains('active')).toBe(false)

    const nextPalette = { primary: '#10b981', secondary: '#06b6d4' }
    presenter.setPalette(nextPalette)

    // Layer B should become active, Layer A should become inactive
    expect(layerB.classList.contains('active')).toBe(true)
    expect(layerA.classList.contains('active')).toBe(false)
    expect(layerB.styleProperties.get('--rim-primary')).toBe('#10b981')
    expect(layerB.styleProperties.get('--rim-secondary')).toBe('#06b6d4')

    // Subsequent palette change flips back to Layer A
    const thirdPalette = { primary: '#f59e0b', secondary: '#ef4444' }
    presenter.setPalette(thirdPalette)

    expect(layerA.classList.contains('active')).toBe(true)
    expect(layerB.classList.contains('active')).toBe(false)
    expect(layerA.styleProperties.get('--rim-primary')).toBe('#f59e0b')
  })

  it('ignores identical palette updates without triggering redundant crossfades', () => {
    const { layerA, layerB, elements } = createMockElements()
    const presenter = new RimLightingPresenter(elements)

    expect(layerA.classList.contains('active')).toBe(true)

    // Same palette
    presenter.setPalette({ ...DEFAULT_AMBIENT_PALETTE })
    expect(layerA.classList.contains('active')).toBe(true)
    expect(layerB.classList.contains('active')).toBe(false)
  })

  it('renders static mode with steady intensity without pulsing', () => {
    const { container, elements } = createMockElements()
    const presenter = new RimLightingPresenter(elements)

    presenter.setSettings({ ...DEFAULT_AMBIENT_LIGHTING, enabled: true, animation: 'static', intensity: 0.75 })
    const busy = presenter.frame(1000, 1000, null, true)

    expect(busy).toBe(false)
    expect(container.styleProperties.get('--rim-effective-intensity')).toBe((0.75).toFixed(3))
    expect(presenter.energy).toBe(0)
  })

  it('animates in music-reactive mode responding to word onsets', () => {
    const { container, elements } = createMockElements()
    const presenter = new RimLightingPresenter(elements)

    const lyrics = {
      lines: [
        {
          text: 'Hello world',
          start: 1000,
          end: 2000,
          words: [
            { text: 'Hello', start: 1000, end: 1400 },
            { text: 'world', start: 1500, end: 2000 }
          ]
        }
      ],
      wordTiming: 'native' as const
    }
    const model: LyricsModel = buildModel(lyrics)

    presenter.setSettings({ ...DEFAULT_AMBIENT_LIGHTING, enabled: true, animation: 'reactive' })

    // Frame right at word onset (1020ms)
    presenter.frame(1020, 1020, model, true)
    expect(presenter.energy).toBeGreaterThan(0)

    const effectiveIntensity = Number.parseFloat(container.styleProperties.get('--rim-effective-intensity') || '0')
    expect(effectiveIntensity).toBeGreaterThan(0)
  })

  it('decays reactive energy smoothly when music is paused', () => {
    const { elements } = createMockElements()
    const presenter = new RimLightingPresenter(elements)

    presenter.setSettings({ ...DEFAULT_AMBIENT_LIGHTING, enabled: true, animation: 'reactive' })

    // Build some energy while playing
    presenter.frame(1000, 1000, null, true)
    presenter.frame(1050, 1050, null, true)
    const initialEnergy = presenter.energy

    // Now paused
    presenter.frame(1100, 1100, null, false)
    presenter.frame(1200, 1200, null, false)
    presenter.frame(1300, 1300, null, false)

    expect(presenter.energy).toBeLessThan(initialEnergy)
  })
})
