import '../css/stage.css'
import { DEFAULT_PALETTE } from '@shared/palette-defaults'
import type { StageState } from '@shared/ipc'
import type { Palette, ShowOn, StyleId } from '@shared/types'
import { SongClock } from './clock'
import { LockClock } from './lock-clock'
import { buildModel, msUntilNextWord, type LyricsModel } from './model'
import { BackgroundManager } from './background'
import { AmbientPresenter } from './ambient'
import { createStyle } from './styles/registry'
import type { StageStyle } from './styles/types'

const api = window.lyricsApp.stage
const root = document.getElementById('stage')!
const clock = new SongClock()
const lockClock = new LockClock(document.body)

const bgManager = new BackgroundManager({
  layerA: document.getElementById('stage-bg-a')!,
  layerB: document.getElementById('stage-bg-b')!,
  root: document.documentElement
})

const ambient = new AmbientPresenter({
  container: document.getElementById('ambient-view'),
  stage: root,
  img: document.getElementById('ambient-img') as HTMLImageElement | null,
  glowImg: document.getElementById('ambient-glow-img') as HTMLImageElement | null,
  titleEl: document.getElementById('ambient-title'),
  artistEl: document.getElementById('ambient-artist'),
  curTimeEl: document.getElementById('ambient-time-cur'),
  totalTimeEl: document.getElementById('ambient-time-total'),
  fillEl: document.getElementById('ambient-track-fill'),
  thumbEl: document.getElementById('ambient-track-thumb'),
  playPauseBtn: document.getElementById('ambient-btn-play-pause'),
  setPresentationMode: (m) => {
    document.body.dataset.presentationMode = m
  }
})

document.getElementById('ambient-enter-btn')?.addEventListener('click', (e) => {
  e.stopPropagation()
  api.toggleAmbient(true)
})

document.getElementById('ambient-exit-btn')?.addEventListener('click', (e) => {
  e.stopPropagation()
  api.toggleAmbient(false)
})

document.getElementById('ambient-btn-play-pause')?.addEventListener('click', (e) => {
  e.stopPropagation()
  api.controlMedia('play-pause')
})
document.getElementById('ambient-btn-prev')?.addEventListener('click', (e) => {
  e.stopPropagation()
  api.controlMedia('previous')
})
document.getElementById('ambient-btn-next')?.addEventListener('click', (e) => {
  e.stopPropagation()
  api.controlMedia('next')
})

const trackBar = document.getElementById('ambient-track-bar')
if (trackBar) {
  let isDragging = false
  const getPct = (clientX: number): number => {
    const rect = trackBar.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const onPointerMove = (e: MouseEvent | TouchEvent): void => {
    if (!isDragging) return
    const clientX = 'touches' in e && e.touches[0] ? e.touches[0].clientX : (e as MouseEvent).clientX
    ambient.seekToPercent(getPct(clientX))
  }

  const onPointerUp = (e: MouseEvent | TouchEvent): void => {
    if (!isDragging) return
    isDragging = false
    ambient.setSeeking(false)
    trackBar.classList.remove('dragging')
    window.removeEventListener('mousemove', onPointerMove)
    window.removeEventListener('mouseup', onPointerUp)
    window.removeEventListener('touchmove', onPointerMove)
    window.removeEventListener('touchend', onPointerUp)

    const clientX = 'changedTouches' in e && e.changedTouches[0] ? e.changedTouches[0].clientX : (e as MouseEvent).clientX
    const targetMs = ambient.seekToPercent(getPct(clientX))
    clock.seek(targetMs, performance.now(), Date.now())
    api.controlMedia('seek', targetMs / 1000)
    render(targetMs, performance.now())
  }

  const onPointerDown = (e: MouseEvent | TouchEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    isDragging = true
    ambient.setSeeking(true)
    trackBar.classList.add('dragging')
    const clientX = 'touches' in e && e.touches[0] ? e.touches[0].clientX : (e as MouseEvent).clientX
    ambient.seekToPercent(getPct(clientX))

    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
    window.addEventListener('touchmove', onPointerMove, { passive: true })
    window.addEventListener('touchend', onPointerUp)
  }

  trackBar.addEventListener('mousedown', onPointerDown)
  trackBar.addEventListener('touchstart', onPointerDown, { passive: false })
}

let style: StageStyle | null = null
let styleId: StyleId | null = null
let model: LyricsModel | null = null
let lyricsSignature = ''
let palette: Palette = { ...DEFAULT_PALETTE }
let mode: ShowOn = 'lock'
let snapshotMode = false
let loopRunning = false
let pendingState: StageState | null = null

// Text is measured on a canvas, so the bundled font must be ready before the first layout.
const fontsReady = Promise.all([
  document.fonts.load('700 100px "Inter Variable"'),
  document.fonts.load('600 100px "Inter Variable"')
]).then(
  () => undefined,
  () => undefined
)

function signature(state: StageState): string {
  const l = state.lyrics
  if (!l) return `${state.track?.key ?? ''}|none`
  const last = l.lines.at(-1)
  return `${state.track?.key ?? ''}|${l.lines.length}|${l.lines[0]?.start ?? 0}|${last?.end ?? 0}|${l.wordTiming}`
}

function applyPaletteVars(p: Palette): void {
  const s = document.documentElement.style
  s.setProperty('--lyric', p.lyric)
  s.setProperty('--highlight', p.highlight)
  s.setProperty('--highlight-text', p.highlightText)
  s.setProperty('--secondary', p.secondary)
}

function applyState(state: StageState): void {
  mode = state.config.mode
  document.body.dataset.mode = mode
  const ambientActive = Boolean(state.config.ambientMode)
  ambient.setAmbientMode(ambientActive)
  lockClock.setVisible(mode === 'lock' && !ambientActive)
  palette = state.config.palette
  applyPaletteVars(palette)
  bgManager.setPalette(state.backgroundPalette)
  ambient.setTrack(state.track)
  ambient.setArtwork(state.artworkUrl ?? null)
  ambient.setPlaying(clock.playing)
  clock.setOffset(state.config.offsetMs)

  const sig = signature(state)
  const lyricsChanged = sig !== lyricsSignature
  if (lyricsChanged) {
    lyricsSignature = sig
    model = state.lyrics ? buildModel(state.lyrics) : null
  }

  if (state.config.style !== styleId || !style) {
    style?.destroy()
    style = createStyle(state.config.style)
    styleId = state.config.style
    style.mount(root)
    style.setLyrics(model)
  } else if (lyricsChanged) {
    style.setLyrics(model)
  }
  style.setMode(mode)
  style.setPalette(palette)
  startLoop()
  render(clock.now(performance.now(), Date.now()), performance.now())
}

/**
 * Frames per second: full rate only while a word is popping in; the slow ambient drift
 * looks the same at a lower rate and costs a fraction of the power. The desktop overlay
 * is capped lower because Windows composites transparent full-screen windows expensively.
 */
const FRAME_RATE: Record<ShowOn, { busy: number; idle: number }> = {
  lock: { busy: 60, idle: 24 },
  always: { busy: 30, idle: 15 }
}

function render(songMs: number, wallMs: number): boolean {
  const isAmbient = ambient.isAmbient
  ambient.update(songMs)

  const W = root.clientWidth || window.innerWidth
  const H = root.clientHeight || window.innerHeight
  const styleBusy = style?.frame({ songMs, wallMs, width: W, height: H }) ?? false
  if (mode === 'lock' && !isAmbient) lockClock.update(Date.now())
  return styleBusy || ambient.seeking
}

function loop(): void {
  if (snapshotMode) {
    loopRunning = false
    return
  }
  const started = performance.now()
  const songMs = clock.now(started, Date.now())
  const busy = render(songMs, started)
  const fps = FRAME_RATE[mode][busy ? 'busy' : 'idle']
  if (fps >= 60) {
    requestAnimationFrame(loop)
    return
  }
  // Wait out most of the frame budget, then align the next frame to vsync — but never
  // sleep through the start of the next word.
  let wait = 1000 / fps - (performance.now() - started) - 8
  if (clock.playing) {
    const nextWord = model ? msUntilNextWord(model, songMs) : Number.POSITIVE_INFINITY
    if (Number.isFinite(nextWord)) wait = Math.min(wait, nextWord - 12)
  }
  setTimeout(() => requestAnimationFrame(loop), Math.max(0, wait))
}

function startLoop(): void {
  if (loopRunning || snapshotMode) return
  loopRunning = true
  requestAnimationFrame(loop)
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

api.onState((state) => {
  pendingState = state
  void fontsReady.then(() => {
    if (!pendingState) return
    const s = pendingState
    pendingState = null
    applyState(s)
  })
})

api.onAnchor((anchor) => {
  clock.setAnchor(anchor, performance.now(), Date.now())
  ambient.setPlaying(anchor.playing)
  startLoop()
})

api.onSnapshot((req) => {
  snapshotMode = true
  void fontsReady.then(async () => {
    if (pendingState) {
      applyState(pendingState)
      pendingState = null
    }
    await style?.ready?.()
    render(req.songMs, req.wallMs)
    await nextFrame()
    await nextFrame()
    api.snapshotDone(req.id)
  })
})

// Lock mode: any real input closes the screen (the main process applies a grace period).
let travelled = 0
let lastMove: { x: number; y: number; at: number } | null = null
window.addEventListener('mousemove', (e) => {
  if (mode !== 'lock') return
  if (ambient.isAmbient) {
    // When Ambient Mode is active, mouse interaction is expected!
    // Do not dismiss the screen on mouse movements.
    travelled = 0
    lastMove = { x: e.screenX, y: e.screenY, at: e.timeStamp }
    return
  }
  const from = lastMove
  if (from && e.timeStamp - from.at < 600) travelled += Math.hypot(e.screenX - from.x, e.screenY - from.y)
  else travelled = 0
  lastMove = { x: e.screenX, y: e.screenY, at: e.timeStamp }
  if (travelled > 12) {
    api.dismiss({
      kind: 'input',
      detail: `mousemove ${Math.round(travelled)}px (${from?.x},${from?.y})→(${e.screenX},${e.screenY}) trusted=${e.isTrusted}`
    })
    travelled = 0
  }
})

window.addEventListener('keydown', (e) => {
  if (ambient.isAmbient) {
    if (e.key === 'Escape') {
      e.preventDefault()
      api.toggleAmbient(false)
      return
    }
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault()
      api.toggleAmbient(false)
      return
    }
    if (e.code === 'Space') {
      e.preventDefault()
      api.controlMedia('play-pause')
      return
    }
    if (e.code === 'MediaTrackNext' || (e.ctrlKey && e.code === 'ArrowRight') || e.code === 'ArrowRight') {
      e.preventDefault()
      api.controlMedia('next')
      return
    }
    if (e.code === 'MediaTrackPrevious' || (e.ctrlKey && e.code === 'ArrowLeft') || e.code === 'ArrowLeft') {
      e.preventDefault()
      api.controlMedia('previous')
      return
    }
    return
  }

  // Not in ambient mode: pressing 'a' or 'A' activates Ambient Mode
  if (e.key === 'a' || e.key === 'A') {
    e.preventDefault()
    api.toggleAmbient(true)
    return
  }

  if (mode !== 'lock') return
  if (e.key === 'Escape') {
    api.dismiss({ kind: 'escape', detail: 'Esc' })
    return
  }
  api.dismiss({ kind: 'input', detail: `keydown key=${e.key} repeat=${e.repeat} trusted=${e.isTrusted}` })
})

for (const type of ['mousedown', 'wheel', 'touchstart'] as const) {
  window.addEventListener(
    type,
    (e) => {
      if (ambient.isAmbient) {
        // Ambient mode is an interactive player view: do not dismiss on mouse or touch input!
        return
      }
      if (mode !== 'lock') return
      const target = e.target as HTMLElement | null
      if (target && target.closest('#ambient-enter-btn')) {
        // Clicked the enter ambient button: do not dismiss!
        return
      }
      api.dismiss({ kind: 'input', detail: `${type} trusted=${e.isTrusted}` })
    },
    { passive: false }
  )
}

// "Press Esc to close" fades in and out when a lyrics screen opens that only Esc closes.
const hint = document.createElement('div')
hint.className = 'stage-hint'
document.body.append(hint)
api.onSession(({ hint: text }) => {
  hint.classList.remove('show')
  if (!text) return
  hint.textContent = text
  void hint.offsetWidth // restart the fade animation
  hint.classList.add('show')
})
