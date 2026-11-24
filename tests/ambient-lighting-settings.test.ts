import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SettingsStore,
  sanitizeAmbientLighting,
  sanitizeSettings
} from '../src/main/settings'
import { DEFAULT_AMBIENT_LIGHTING } from '../src/shared/types'

const tempFile = (): string => join(mkdtempSync(join(tmpdir(), 'tal-settings-test-')), 'settings.json')

describe('sanitizeAmbientLighting', () => {
  it('returns defaults for missing, null or invalid input', () => {
    expect(sanitizeAmbientLighting(undefined)).toEqual(DEFAULT_AMBIENT_LIGHTING)
    expect(sanitizeAmbientLighting(null)).toEqual(DEFAULT_AMBIENT_LIGHTING)
    expect(sanitizeAmbientLighting('not-an-object')).toEqual(DEFAULT_AMBIENT_LIGHTING)
  })

  it('preserves valid custom ambient lighting configuration', () => {
    const custom = {
      enabled: false,
      animation: 'static' as const,
      intensity: 0.65,
      thickness: 180,
      diffusion: 55,
      primaryColor: '#ff0077',
      secondaryColor: '#00ffcc',
      colorBalance: 0.35,
      autoColor: false,
      overrideColor: true
    }
    expect(sanitizeAmbientLighting(custom)).toEqual(custom)
  })

  it('clamps numerical values to valid ranges', () => {
    const clamped = sanitizeAmbientLighting({
      intensity: 1.5,
      thickness: 999,
      diffusion: 999,
      colorBalance: -0.5
    })
    expect(clamped.intensity).toBe(1.0)
    expect(clamped.thickness).toBe(200)
    expect(clamped.diffusion).toBe(100)
    expect(clamped.colorBalance).toBe(0.0)

    const clampedLow = sanitizeAmbientLighting({
      intensity: -0.2,
      thickness: 5,
      diffusion: 2,
      colorBalance: 1.8
    })
    expect(clampedLow.intensity).toBe(0.1)
    expect(clampedLow.thickness).toBe(10)
    expect(clampedLow.diffusion).toBe(10)
    expect(clampedLow.colorBalance).toBe(1.0)
  })

  it('validates hex colors and falls back to default on invalid hex', () => {
    const withBadColors = sanitizeAmbientLighting({
      primaryColor: 'red',
      secondaryColor: '#12345Z'
    })
    expect(withBadColors.primaryColor).toBe(DEFAULT_AMBIENT_LIGHTING.primaryColor)
    expect(withBadColors.secondaryColor).toBe(DEFAULT_AMBIENT_LIGHTING.secondaryColor)
  })

  it('validates animation mode and falls back to default on invalid', () => {
    const invalidAnim = sanitizeAmbientLighting({
      animation: 'disco' as unknown
    })
    expect(invalidAnim.animation).toBe('reactive')
  })
})

describe('SettingsStore with ambient lighting', () => {
  it('includes ambientLighting in default settings', () => {
    expect(DEFAULT_SETTINGS.ambientLighting).toEqual(DEFAULT_AMBIENT_LIGHTING)
  })

  it('allows partial updates to ambientLighting without losing existing values', () => {
    const store = new SettingsStore(tempFile())
    expect(store.get().ambientLighting.enabled).toBe(false)

    store.update({
      ambientLighting: {
        ...store.get().ambientLighting,
        intensity: 0.42
      }
    })

    expect(store.get().ambientLighting.intensity).toBe(0.42)
    expect(store.get().ambientLighting.thickness).toBe(DEFAULT_AMBIENT_LIGHTING.thickness)
    expect(store.get().ambientLighting.animation).toBe('reactive')
  })

  it('persists and reloads ambientLighting updates from disk', () => {
    const file = tempFile()
    const store1 = new SettingsStore(file)
    store1.update({
      ambientLighting: {
        ...store1.get().ambientLighting,
        enabled: false,
        animation: 'static',
        thickness: 200,
        primaryColor: '#e11d48'
      }
    })

    const store2 = new SettingsStore(file)
    expect(store2.get().ambientLighting.enabled).toBe(false)
    expect(store2.get().ambientLighting.animation).toBe('static')
    expect(store2.get().ambientLighting.thickness).toBe(200)
    expect(store2.get().ambientLighting.primaryColor).toBe('#e11d48')
  })
})
