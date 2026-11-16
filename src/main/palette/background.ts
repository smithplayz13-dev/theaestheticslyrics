import { DEFAULT_BACKGROUND_PALETTE, type BackgroundPalette } from '@shared/types'
import { hueDistance, oklabToOklch, oklchToHex, rgbToOklab, type Oklab } from './color'

const CLUSTERS = 6
const ITERATIONS = 10
const MAX_SIDE_SAMPLES = 48
const MIN_SHARE = 0.02
const MIN_CHROMA = 0.03

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
 * Extracts 3–5 cohesive, subdued background tones from album artwork bitmap (BGRA).
 * Darker and subtle shades ensure lyrics remain ultra-readable (WCAG AAA).
 */
export function extractBackgroundPalette(bgra: Uint8Array, width: number, height: number): BackgroundPalette | null {
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

  // Rank by chroma & share to find vibrant components
  const vivid = clusters.filter((c) => c.share >= MIN_SHARE && c.C >= MIN_CHROMA)
  const vibrancy = (c: { C: number; L: number; share: number }): number =>
    c.C * Math.sqrt(c.share) * (c.L < 0.12 || c.L > 0.96 ? 0.3 : 1)
  vivid.sort((p, q) => vibrancy(q) - vibrancy(p))

  const dominant = vivid[0] ?? clusters.sort((a, b) => b.share - a.share)[0]!

  // Primary: deep, atmospheric dominant tone (L ~ 0.14-0.20, subdued C)
  const primL = clamp(dominant.L * 0.35, 0.13, 0.20)
  const primC = clamp(dominant.C * 0.65, 0.04, 0.11)
  const primary = oklchToHex(primL, primC, dominant.h)

  // Secondary: complementary or distinct harmonic hue (prefer hue distance >= 30)
  const secondCluster = vivid.slice(1).find((c) => hueDistance(c.h, dominant.h) >= 28)
  const secH = secondCluster ? secondCluster.h : (dominant.h + 45) % 360
  const secL = clamp((secondCluster?.L ?? dominant.L) * 0.3, 0.11, 0.18)
  const secC = clamp((secondCluster?.C ?? dominant.C) * 0.55, 0.03, 0.09)
  const secondary = oklchToHex(secL, secC, secH)

  // Tertiary: atmospheric subtle tone (shifted hue or third cluster)
  const thirdCluster = vivid.slice(1).find((c) => c !== secondCluster && hueDistance(c.h, dominant.h) >= 40)
  const tertH = thirdCluster ? thirdCluster.h : (dominant.h + 210) % 360
  const tertL = clamp((thirdCluster?.L ?? dominant.L) * 0.25, 0.09, 0.15)
  const tertC = clamp((thirdCluster?.C ?? dominant.C) * 0.45, 0.02, 0.07)
  const tertiary = oklchToHex(tertL, tertC, tertH)

  // Base: very deep near-black baseline tinted with dominant hue
  const base = oklchToHex(0.045, Math.min(dominant.C * 0.2, 0.02), dominant.h)

  // Glow: vibrant accent for artwork halo during instrumental breaks
  const glowL = clamp(dominant.L * 0.75, 0.32, 0.46)
  const glowC = clamp(dominant.C * 1.15, 0.09, 0.20)
  const glow = oklchToHex(glowL, glowC, dominant.h)

  return { primary, secondary, tertiary, base, glow }
}

/** Cache of extracted background palettes keyed by art or track key. */
export class BackgroundPaletteCache {
  private readonly map = new Map<string, BackgroundPalette>()
  private readonly maxSize: number

  constructor(maxSize = 20) {
    this.maxSize = maxSize
  }

  get(key: string): BackgroundPalette | undefined {
    return this.map.get(key)
  }

  set(key: string, palette: BackgroundPalette): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxSize) {
      const first = this.map.keys().next().value
      if (first !== undefined) this.map.delete(first)
    }
    this.map.set(key, palette)
  }

  clear(): void {
    this.map.clear()
  }
}
