import { describe, expect, it } from 'vitest'
import {
  ambientPaletteFromBackground,
  ambientPaletteFromColors,
  extractAmbientPalette
} from '../src/main/palette/ambient'
import { oklabToOklch, rgbToOklab, hexToRgb } from '../src/main/palette/color'
import { DEFAULT_AMBIENT_PALETTE, DEFAULT_BACKGROUND_PALETTE } from '../src/shared/types'

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
const chromaOf = (hex: string): number => oklabToOklch(rgbToOklab(hexToRgb(hex))).C
const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('extractAmbientPalette', () => {
  const redCover = bitmap(32, 32, (x, y) => ((x + y) % 7 === 0 ? [20, 18, 22] : [220, 35, 45]))

  it('extracts radiant, luminous primary and complementary secondary colours', () => {
    const palette = extractAmbientPalette(redCover, 32, 32)
    expect(palette).not.toBeNull()
    if (!palette) return

    // Primary should follow dominant red hue (near 29°)
    expect(hueDistance(hueOf(palette.primary), 29)).toBeLessThan(30)
    // Primary lightness should be radiant for LED emission (>= 0.55)
    expect(lightnessOf(palette.primary)).toBeGreaterThanOrEqual(0.55)
    // Primary chroma should be vivid (>= 0.12)
    expect(chromaOf(palette.primary)).toBeGreaterThanOrEqual(0.12)

    // Secondary should provide a complementary or harmonic contrast
    expect(palette.secondary).toMatch(/^#[0-9a-f]{6}$/i)
    expect(lightnessOf(palette.secondary)).toBeGreaterThanOrEqual(0.48)
  })

  it('extracts distinct complementary colours for two-tone covers', () => {
    // Left half vivid magenta/purple, right half cyan/blue
    const twoTone = bitmap(32, 32, (x) => (x < 16 ? [180, 40, 220] : [20, 180, 230]))
    const palette = extractAmbientPalette(twoTone, 32, 32)
    expect(palette).not.toBeNull()
    if (!palette) return

    const diff = hueDistance(hueOf(palette.primary), hueOf(palette.secondary))
    expect(diff).toBeGreaterThan(25)
  })

  it('gracefully handles monochromatic / grayscale covers with refined moonlight tones', () => {
    const greyCover = bitmap(32, 32, () => [80, 80, 80])
    const palette = extractAmbientPalette(greyCover, 32, 32)
    expect(palette).not.toBeNull()
    if (!palette) return

    expect(palette.primary).toBe('#e2e8f0')
    expect(palette.secondary).toBe('#94a3b8')
  })

  it('returns null for insufficient or invalid bitmap dimensions', () => {
    expect(extractAmbientPalette(new Uint8Array(10), 2, 2)).toBeNull()
    expect(extractAmbientPalette(new Uint8Array(64), 4, 4)).toBeNull()
  })

  it('derives ambient palette from BackgroundPalette when bitmap is unavailable', () => {
    const bg = { ...DEFAULT_BACKGROUND_PALETTE, glow: '#8b5cf6', secondary: '#3b82f6' }
    const palette = ambientPaletteFromBackground(bg)
    expect(palette.primary).toBe('#8b5cf6')
    expect(palette.secondary).toBe('#3b82f6')
  })

  it('falls back to default colors when BackgroundPalette has missing values', () => {
    const bg = { ...DEFAULT_BACKGROUND_PALETTE, glow: '', secondary: '' }
    const palette = ambientPaletteFromBackground(bg)
    expect(palette.primary).toBe(DEFAULT_AMBIENT_PALETTE.primary)
    expect(palette.secondary).toBe(DEFAULT_AMBIENT_PALETTE.secondary)
  })

  it('normalizes manual primary and secondary hex strings', () => {
    const palette = ambientPaletteFromColors('#FF0055', '#00AAFF')
    expect(palette.primary).toBe('#ff0055')
    expect(palette.secondary).toBe('#00aaff')

    // Invalid hex falls back to defaults
    const invalid = ambientPaletteFromColors('invalid', 'blue')
    expect(invalid.primary).toBe(DEFAULT_AMBIENT_PALETTE.primary)
    expect(invalid.secondary).toBe(DEFAULT_AMBIENT_PALETTE.secondary)
  })
})
