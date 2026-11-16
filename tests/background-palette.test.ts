import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToRgb, oklabToOklch, rgbToOklab } from '../src/main/palette/color'
import { BackgroundPaletteCache, extractBackgroundPalette } from '../src/main/palette/background'
import { DEFAULT_BACKGROUND_PALETTE } from '../src/shared/types'

function bitmap(w: number, h: number, color: (x: number, y: number) => [number, number, number, number?]): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = color(x, y)
      const i = (y * w + x) * 4
      out[i] = b
      out[i + 1] = g
      out[i + 2] = r
      out[i + 3] = a
    }
  }
  return out
}

const hueOf = (hex: string): number => oklabToOklch(rgbToOklab(hexToRgb(hex))).h
const lightnessOf = (hex: string): number => oklabToOklch(rgbToOklab(hexToRgb(hex))).L
const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('extractBackgroundPalette', () => {
  const redCover = bitmap(32, 32, (x, y) => ((x + y) % 7 === 0 ? [20, 18, 22] : [200, 30, 40]))

  it('extracts cohesive, dark and subdued background tones', () => {
    const bg = extractBackgroundPalette(redCover, 32, 32)
    expect(bg).not.toBeNull()
    if (!bg) return

    // Primary should be a dark tone of the dominant red
    expect(hueDistance(hueOf(bg.primary), 25)).toBeLessThan(25)
    expect(lightnessOf(bg.primary)).toBeLessThan(0.25)
    expect(lightnessOf(bg.primary)).toBeGreaterThan(0.10)

    // Base tone should be near-black
    expect(lightnessOf(bg.base)).toBeLessThan(0.10)

    // Glow should be more vibrant and luminous for the halo
    expect(lightnessOf(bg.glow)).toBeGreaterThan(0.28)

    // Contrast: white text on primary background should have excellent readability
    expect(contrastRatio('#ffffff', bg.primary)).toBeGreaterThan(7)
  })

  it('handles multi-colored covers with complementary secondary and tertiary hues', () => {
    // Left half red, right half deep teal/blue
    const twoTone = bitmap(32, 32, (x) => (x < 16 ? [220, 40, 40] : [20, 120, 220]))
    const bg = extractBackgroundPalette(twoTone, 32, 32)
    expect(bg).not.toBeNull()
    if (!bg) return

    // Secondary hue should be well differentiated from primary
    const diff = hueDistance(hueOf(bg.primary), hueOf(bg.secondary))
    expect(diff).toBeGreaterThan(25)
  })

  it('returns null for too-small or incomplete bitmaps', () => {
    expect(extractBackgroundPalette(new Uint8Array(10), 2, 2)).toBeNull()
    expect(extractBackgroundPalette(new Uint8Array(64), 4, 4)).toBeNull()
  })

  it('handles monochromatic / dark covers gracefully', () => {
    const darkMono = bitmap(32, 32, () => [25, 25, 25])
    const bg = extractBackgroundPalette(darkMono, 32, 32)
    expect(bg).not.toBeNull()
    if (!bg) return
    expect(lightnessOf(bg.primary)).toBeLessThan(0.25)
  })
})

describe('BackgroundPaletteCache', () => {
  it('stores and retrieves cached palettes', () => {
    const cache = new BackgroundPaletteCache(3)
    const p1 = { ...DEFAULT_BACKGROUND_PALETTE, primary: '#112233' }
    cache.set('song-1', p1)
    expect(cache.get('song-1')).toEqual(p1)
    expect(cache.get('song-2')).toBeUndefined()
  })

  it('evicts oldest entries when capacity is exceeded', () => {
    const cache = new BackgroundPaletteCache(2)
    cache.set('a', { ...DEFAULT_BACKGROUND_PALETTE, primary: '#111111' })
    cache.set('b', { ...DEFAULT_BACKGROUND_PALETTE, primary: '#222222' })
    cache.set('c', { ...DEFAULT_BACKGROUND_PALETTE, primary: '#333333' })
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
  })
})
