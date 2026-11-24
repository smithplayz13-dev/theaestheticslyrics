import { DEFAULT_AMBIENT_PALETTE, type AmbientLightingPalette, type BackgroundPalette } from '@shared/types'
import { HEX_COLOR } from '@shared/palette-defaults'
import { hueDistance, oklabToOklch, oklchToHex, rgbToOklab, type Oklab } from './color'

const CLUSTERS = 6
const ITERATIONS = 10
const MAX_SIDE_SAMPLES = 48
const MIN_SHARE = 0.02
const MIN_CHROMA = 0.035

interface Cluster extends Oklab {
  count: number
}

function kmeans(points: Oklab[]): Cluster[] {
  const byLightness = [...points].sort((p, q) => p.L - q.L)
  let centroids: Oklab[] = Array.from({ length: CLUSTERS }, (_, i) => {
    const p = byLightness[Math.min(byLightness.length - 1, Math.floor(((i + 0.5) / CLUSTERS) * byLightness.length))]!
    return { L: p.L, a: p.a, b: p.b }
  })
  const assignment = new Int32Array(points.length)
  let counts: number[] = []

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    points.forEach((p, i) => {
      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      centroids.forEach((c, j) => {
        const d = (p.L - c.L) ** 2 + (p.a - c.a) ** 2 + (p.b - c.b) ** 2
        if (d < bestDistance) {
          bestDistance = d
          best = j
        }
      })
      assignment[i] = best
    })
    const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, count: 0 }))
    points.forEach((p, i) => {
      const s = sums[assignment[i]!]!
      s.L += p.L
      s.a += p.a
      s.b += p.b
      s.count++
    })
    counts = sums.map((s) => s.count)
    centroids = sums.map((s, j) => (s.count ? { L: s.L / s.count, a: s.a / s.count, b: s.b / s.count } : centroids[j]!))
  }
  return centroids.map((c, j) => ({ ...c, count: counts[j] ?? 0 }))
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/**
 * Extracts two vibrant, complementary representative colours from album artwork bitmap (BGRA).
 * Generates an ambient lighting palette designed for soft, radiant LED perimeter diffusion.
 */
export function extractAmbientPalette(bgra: Uint8Array, width: number, height: number): AmbientLightingPalette | null {
  if (width < 4 || height < 4 || bgra.length < width * height * 4) return null

  const step = Math.max(1, Math.floor(Math.max(width, height) / MAX_SIDE_SAMPLES))
  const points: Oklab[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      if (bgra[i + 3]! < 128) continue
      points.push(rgbToOklab({ r: bgra[i + 2]!, g: bgra[i + 1]!, b: bgra[i]! }))
    }
  }
  if (points.length < 16) return null

  const clusters = kmeans(points)
    .filter((c) => c.count > 0)
    .map((c) => ({ ...oklabToOklch(c), share: c.count / points.length }))

  if (!clusters.length) return null

  const vivid = clusters.filter((c) => c.share >= MIN_SHARE && c.C >= MIN_CHROMA)
  if (!vivid.length) {
    // Greyscale / black-and-white artwork: provide clean, luminous moonlight tones
    return {
      primary: '#e2e8f0',
      secondary: '#94a3b8'
    }
  }

  const vibrancy = (c: { C: number; L: number; share: number }): number =>
    c.C * Math.sqrt(c.share) * (c.L < 0.12 || c.L > 0.96 ? 0.3 : 1)
  vivid.sort((p, q) => vibrancy(q) - vibrancy(p))

  const dominant = vivid[0]!

  // Primary: luminous and vibrant for bright LED emission (L ~ 0.58-0.72, C ~ 0.14-0.22)
  const primL = clamp(Math.max(dominant.L, 0.56), 0.56, 0.72)
  const primC = clamp(Math.max(dominant.C * 1.15, 0.14), 0.14, 0.23)
  const primary = oklchToHex(primL, primC, dominant.h)

  // Secondary: complementary or distinct harmonic hue (prefer hue distance >= 28)
  const secondCluster = vivid.slice(1).find((c) => hueDistance(c.h, dominant.h) >= 28)
  const secH = secondCluster ? secondCluster.h : (dominant.h + 150) % 360
  const secL = clamp(Math.max(secondCluster?.L ?? dominant.L * 0.9, 0.50), 0.50, 0.68)
  const secC = clamp(Math.max((secondCluster?.C ?? dominant.C) * 1.05, 0.12), 0.12, 0.21)
  const secondary = oklchToHex(secL, secC, secH)

  return { primary, secondary }
}

/**
 * Derives an ambient lighting palette from an extracted BackgroundPalette.
 */
export function ambientPaletteFromBackground(bg: BackgroundPalette): AmbientLightingPalette {
  return {
    primary: bg.glow || DEFAULT_AMBIENT_PALETTE.primary,
    secondary: bg.secondary || DEFAULT_AMBIENT_PALETTE.secondary
  }
}

/**
 * Normalizes user-provided hex strings into an ambient palette.
 */
export function ambientPaletteFromColors(primary: string, secondary: string): AmbientLightingPalette {
  const p = HEX_COLOR.test(primary) ? primary.toLowerCase() : DEFAULT_AMBIENT_PALETTE.primary
  const s = HEX_COLOR.test(secondary) ? secondary.toLowerCase() : DEFAULT_AMBIENT_PALETTE.secondary
  return { primary: p, secondary: s }
}
