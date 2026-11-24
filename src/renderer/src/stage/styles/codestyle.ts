import '../../css/codestyle.css'
import type { Palette, ShowOn, TrackInfo } from '@shared/types'
import type { LyricsModel } from '../model'
import { setStyle } from '../style-cache'
import { clamp, lerp } from '../util'
import {
  activeCodeLine,
  buildCodeScript,
  buildWallRows,
  completedChars,
  typedCharsAt,
  type CodeLine,
  type CodeScript,
  type CodeToken
} from './codestyle-code'
import type { FrameInfo, StageStyle } from './types'

interface TokenView {
  token: CodeToken
  span: HTMLSpanElement
}

interface LineView {
  el: HTMLDivElement
  gutter: HTMLSpanElement
  src: HTMLDivElement
  tokens: TokenView[]
  line: CodeLine
  lastCount: number
  filled: boolean
}

const TAG_FALLBACK = 'you'

const FALLBACK_PALETTE: Palette = {
  lyric: '#dc372a',
  highlight: '#ca415e',
  highlightText: '#fff1f3',
  secondary: '#e7b9c2'
}

const PIECE_POSITIONS = [
  { left: '6%', top: '7%', width: 'clamp(42px, 7vw, 118px)' },
  { left: '78%', top: '11%', width: 'clamp(34px, 5.4vw, 92px)' },
  { left: '30%', top: '20%', width: 'clamp(24px, 3.4vw, 58px)' },
  { left: '69%', top: '28%', width: 'clamp(26px, 3.8vw, 64px)' },
  { left: '4%', top: '64%', width: 'clamp(28px, 4.2vw, 70px)' },
  { left: '86%', top: '60%', width: 'clamp(22px, 3vw, 52px)' },
  { left: '60%', top: '4%', width: 'clamp(20px, 2.6vw, 44px)' },
  { left: '46%', top: '82%', width: 'clamp(18px, 2.2vw, 38px)' }
]

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

const pieceSvg = (gradientId: string): string => `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c7e2ff"/>
      <stop offset="0.28" stop-color="#7eabe0"/>
      <stop offset="0.68" stop-color="#35669f"/>
      <stop offset="1" stop-color="#142f53"/>
    </linearGradient>
  </defs>
  <path d="M18 14 H44 C44 4 56 4 56 14 H82 V40 C92 40 92 52 82 52 V86 H56 C56 96 44 96 44 86 H18 V52 C8 52 8 40 18 40 Z"
    fill="url(#${gradientId})" stroke="rgba(220,240,255,.58)" stroke-width="1.1"/>
  <path d="M22 18 H43 C45 9 55 9 57 18 H78 V39 C87 41 87 51 78 53 V82 H57 C55 91 45 91 43 82 H22 V53 C13 51 13 41 22 39 Z"
    fill="none" stroke="rgba(255,255,255,.24)" stroke-width="0.8"/>
  <path d="M25 22 H42 C45 13 54 13 57 22 H74 V38 C83 41 83 50 74 53 V79 H57 C54 88 45 88 42 79 H25 V53 C16 50 16 41 25 38 Z"
    fill="none" stroke="rgba(0,0,0,.2)" stroke-width="0.7"/>
</svg>`

const outroPieceSvg = (): string => `
<svg viewBox="0 0 200 200" aria-hidden="true">
  <defs>
    <linearGradient id="cs-outro-grad" x1="0" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#a9a9a5"/>
      <stop offset="0.45" stop-color="#7c7c79"/>
      <stop offset="1" stop-color="#4f4f4e"/>
    </linearGradient>
    <filter id="cs-outro-inner" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <path d="M40 30 H88 C88 12 112 12 112 30 H160 V78 C178 78 178 102 160 102 V170 H112 C112 188 88 188 88 170 H40 V102 C22 102 22 78 40 78 Z"
    fill="url(#cs-outro-grad)" stroke="#c7c7c2" stroke-width="1.4" filter="url(#cs-outro-inner)"/>
  <path d="M48 38 H86 C90 20 110 20 114 38 H152 V76 C170 80 170 100 152 104 V162 H114 C110 180 90 180 86 162 H48 V104 C30 100 30 80 48 76 Z"
    fill="none" stroke="rgba(255,255,255,.26)" stroke-width="1"/>
  <path d="M52 42 H84 C89 26 111 26 116 42 H148 V74 C164 79 164 99 148 104 V158 H116 C111 174 89 174 84 158 H52 V104 C36 99 36 79 52 74 Z"
    fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1"/>
</svg>`

const tagFor = (track: TrackInfo | null): string => {
  const candidate = (track?.artist || '')
    .split(/[\s,]+/)
    .find(Boolean)
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
  return candidate && candidate.length <= 10 ? candidate : TAG_FALLBACK
}

const createCodestyle = (): StageStyle => {
  let root: HTMLElement | null = null
  let wallEl: HTMLElement | null = null
  let wallGroups: HTMLElement[] = []
  let piecesEl: HTMLElement | null = null
  let pieces: HTMLElement[] = []
  let codeEl: HTMLElement | null = null
  let linesEl: HTMLElement | null = null
  let statusEl: HTMLElement | null = null
  let statusFill: HTMLElement | null = null
  let statusText: HTMLElement | null = null
  let outroEl: HTMLElement | null = null
  let outroPiece: HTMLElement | null = null
  let outroTag: HTMLElement | null = null
  let outroCaret: HTMLElement | null = null
  let cursorEl: HTMLSpanElement | null = null
  let caretEl: HTMLSpanElement | null = null
  let tagEl: HTMLSpanElement | null = null

  let model: LyricsModel | null = null
  let track: TrackInfo | null = null
  let palette: Palette = FALLBACK_PALETTE
  let mode: ShowOn = 'lock'
  let script: CodeScript | null = null
  let commentView: LineView | null = null
  let lineViews = new Map<number, LineView>()

  let width = 0
  let height = 0
  let maxLines = 14
  let lineHeight = 26
  let windowKey = ''
  let lastActive = -2
  let lastTyped = -1
  let lastCommentTyped = -1
  let lastStatus = ''
  let lastWallMs = 0
  let reducedMotion = false

  const rebuildWall = (): void => {
    if (!wallEl) return
    wallEl.replaceChildren()
    wallGroups = []
    const rows = buildWallRows(track)
    for (let groupIndex = 0; groupIndex < 2; groupIndex++) {
      const group = element('div', groupIndex === 1 ? 'cs-wall-group is-ghost' : 'cs-wall-group')
      for (const row of rows) {
        const rowEl = element('div', `cs-wall-row tone-${row.tone}`)
        rowEl.textContent = `${row.text}   ${row.text}   ${row.text}`
        rowEl.style.setProperty('--row-offset', String(row.offset))
        rowEl.style.setProperty(
          '--row-opacity',
          String(row.opacity * (groupIndex === 1 ? 0.5 : 1))
        )
        group.append(rowEl)
      }
      wallEl.append(group)
      wallGroups.push(group)
    }
  }

  const rebuildPieces = (): void => {
    const host = piecesEl
    if (!host) return
    host.replaceChildren()
    pieces = []
    PIECE_POSITIONS.forEach((position, index) => {
      const piece = element('div', 'cs-piece')
      piece.innerHTML = pieceSvg(`cs-piece-grad-${index}`)
      piece.style.left = position.left
      piece.style.top = position.top
      piece.style.width = position.width
      piece.dataset.phase = String(index * 1.37)
      host.append(piece)
      pieces.push(piece)
    })
  }

  const makeLineView = (line: CodeLine): LineView => {
    const el = element('div', line.comment ? 'cs-line is-comment' : 'cs-line')
    const gutter = element('span', 'cs-gutter')
    gutter.textContent = line.comment ? '' : String(line.lineIndex + 1)
    const src = element('div', 'cs-src')
    const tokens: TokenView[] = line.tokens.map((token) => {
      const span = element('span', `cs-token-${token.role}`)
      span.textContent = ''
      src.append(span)
      return { token, span }
    })
    el.append(gutter, src)
    return { el, gutter, src, tokens, line, lastCount: -1, filled: false }
  }

  const setLineText = (view: LineView, count: number, full: boolean): void => {
    if (!full && view.filled) view.filled = false
    if (full && view.filled) return
    for (const { token, span } of view.tokens) {
      const visible = full
        ? token.text.length
        : clamp(count - token.start, 0, token.text.length)
      if (span.textContent?.length !== visible) {
        span.textContent = token.text.slice(0, visible)
      }
    }
    view.lastCount = full ? view.line.text.length : count
    if (full) view.filled = true
  }

  const resetCode = (): void => {
    if (!linesEl) return
    linesEl.replaceChildren()
    lineViews.clear()
    commentView = null
    windowKey = ''
    lastActive = -2
    lastTyped = -1
    lastCommentTyped = -1
    lastStatus = ''
    if (cursorEl) cursorEl.style.display = 'none'
    setStyle(linesEl, 'transform', 'translateY(0px)')
    if (script) {
      commentView = makeLineView(script.comment)
      linesEl.append(commentView.el)
    }
  }

  const removeLineViewsOutside = (from: number, to: number): void => {
    for (const [index, view] of lineViews) {
      if (index < from || index > to) {
        view.el.remove()
        lineViews.delete(index)
      }
    }
  }

  const syncWindow = (active: number): void => {
    if (!linesEl || !script) return
    const from = active >= 0 ? Math.max(0, active - maxLines + 1) : 0
    const to = active
    removeLineViewsOutside(from, to)
    for (let index = from; index <= to; index++) {
      if (!lineViews.has(index)) {
        const line = script.lines[index]
        if (line) lineViews.set(index, makeLineView(line))
      }
    }
    if (commentView) linesEl.append(commentView.el)
    for (let index = from; index <= to; index++) {
      const view = lineViews.get(index)
      if (view) linesEl.append(view.el)
    }
    for (let index = from; index <= to; index++) {
      const view = lineViews.get(index)
      if (!view) continue
      view.el.classList.toggle('is-active', index === active)
      view.el.classList.toggle('is-past', index < active)
      if (index < active) setLineText(view, view.line.text.length, true)
    }
    if (active >= 0) {
      const activeView = lineViews.get(active)
      if (activeView) {
        activeView.el.classList.add('is-active')
        setLineText(activeView, 0, false)
      }
    }
    windowKey = `${active}:${maxLines}:${script.lines.length}`
  }

  const placeCursor = (view: LineView, count: number): void => {
    if (!cursorEl) return
    let reference: ChildNode | null = null
    if (count <= 0) {
      reference = view.src.firstChild
    } else {
      for (const { token, span } of view.tokens) {
        if (count <= token.start + token.text.length) {
          reference = span.nextSibling
          break
        }
      }
    }
    view.src.insertBefore(cursorEl, reference)
    cursorEl.style.display = ''
    const typing = count < view.line.text.length
    const blinkOn = reducedMotion || lastWallMs % 1100 < 660
    if (caretEl) caretEl.style.opacity = typing || blinkOn ? '1' : '0.16'
  }

  const hideCursor = (): void => {
    if (cursorEl) cursorEl.style.display = 'none'
  }

  const updateStatus = (active: number, activeTyped: number, commentTyped: number): void => {
    if (!statusEl || !statusText || !statusFill || !script) return
    const done = Math.min(
      script.totalChars,
      Math.min(commentTyped, script.comment.text.length) +
        completedChars(script, active, activeTyped)
    )
    const key = `${done}:${script.totalChars}`
    if (key === lastStatus) return
    lastStatus = key
    statusText.textContent = `+${done} / ${script.totalChars} complete`
    statusFill.style.transform = `scaleX(${script.totalChars > 0 ? done / script.totalChars : 0})`
    statusEl.classList.toggle('is-complete', done >= script.totalChars)
  }

  const measure = (): void => {
    if (!linesEl) return
    const fontSize = Number.parseFloat(getComputedStyle(linesEl).fontSize) || 16
    lineHeight = fontSize * 1.55
    const nextMax = Math.max(5, Math.min(18, Math.floor((height * 0.56) / lineHeight)))
    if (nextMax !== maxLines) {
      maxLines = nextMax
      windowKey = ''
    }
  }

  const animateLineShift = (direction: number): void => {
    if (!linesEl || reducedMotion || direction <= 0) return
    setStyle(linesEl, 'transform', `translateY(${lineHeight}px)`)
    void linesEl.offsetHeight
    setStyle(linesEl, 'transform', 'translateY(0px)')
  }

  const buildLayers = (host: HTMLElement): void => {
    root = element('div', 'codestyle-root')
    root.dataset.mode = mode
    root.style.setProperty('--cs-accent', '#ff2a1f')

    wallEl = element('div', 'cs-wall')
    root.append(wallEl)

    root.append(element('div', 'cs-puzzle'))
    root.append(element('div', 'cs-glow'))
    root.append(element('div', 'cs-disc'))
    root.append(element('div', 'cs-scrim'))

    piecesEl = element('div', 'cs-pieces')
    root.append(piecesEl)

    codeEl = element('div', 'cs-code')
    linesEl = element('div', 'cs-lines')
    codeEl.append(linesEl)
    root.append(codeEl)

    cursorEl = element('span', 'cs-cursor')
    caretEl = element('span', 'cs-caret')
    tagEl = element('span', 'cs-tag')
    tagEl.textContent = tagFor(track)
    cursorEl.append(caretEl, tagEl)
    cursorEl.style.display = 'none'

    statusEl = element('div', 'cs-status')
    const dot = element('span', 'cs-status-dot')
    const bar = element('span', 'cs-status-bar')
    statusFill = element('span', 'cs-status-fill')
    statusText = element('span', 'cs-status-text')
    bar.append(statusFill)
    statusEl.append(dot, bar, statusText)
    root.append(statusEl)

    outroEl = element('div', 'cs-outro')
    outroPiece = element('div', 'cs-outro-piece')
    outroPiece.innerHTML = outroPieceSvg()
    const outroRow = element('div', 'cs-outro-row')
    outroTag = element('div', 'cs-outro-tag')
    outroTag.textContent = tagFor(track)
    const outroCursor = element('div', 'cs-outro-cursor')
    outroCaret = element('span', 'cs-outro-caret')
    outroCursor.append(outroCaret)
    outroRow.append(outroTag, outroCursor)
    const pill = element('div', 'cs-outro-pill')
    const pillDot = element('span', 'cs-outro-dot')
    const pillText = element('span')
    pillText.textContent = '+1 piece left over'
    pill.append(pillDot, pillText)
    const band = element('div', 'cs-outro-band')
    const bandText = element('div', 'cs-outro-band-text')
    bandText.textContent = 'N/'
    band.append(bandText)
    outroEl.append(outroPiece, outroRow, pill, band)
    root.append(outroEl)

    root.append(element('div', 'cs-grain'))
    root.append(element('div', 'cs-scan'))
    root.append(element('div', 'cs-vignette'))

    host.append(root)
    rebuildWall()
    rebuildPieces()
    resetCode()
  }

  const frame = (info: FrameInfo): boolean => {
    if (!root) return false
    lastWallMs = info.wallMs
    if (info.width !== width || info.height !== height) {
      width = info.width
      height = info.height
      measure()
    }

    const currentScript = script
    let active = -1
    let commentTyped = 0
    let activeTyped = 0
    let activeLine: CodeLine | null = null

    if (currentScript) {
      active = activeCodeLine(currentScript, info.songMs)
      commentTyped = typedCharsAt(currentScript.comment, info.songMs)
      activeLine = active >= 0 ? currentScript.lines[active] ?? null : null
      if (activeLine) activeTyped = typedCharsAt(activeLine, info.songMs)

      const nextKey = `${active}:${maxLines}:${currentScript.lines.length}`
      if (nextKey !== windowKey) {
        const direction = active - lastActive
        syncWindow(active)
        animateLineShift(direction)
        lastActive = active
        lastTyped = -1
      }

      if (commentView) {
        setLineText(commentView, commentTyped, commentTyped >= currentScript.comment.text.length)
        commentView.el.classList.toggle('is-active', active < 0)
        commentView.el.classList.toggle('is-past', active >= 0)
      }

      if (activeLine) {
        const view = lineViews.get(active)
        if (view && (activeTyped !== lastTyped || active !== lastActive)) {
          setLineText(view, activeTyped, false)
          placeCursor(view, activeTyped)
          lastTyped = activeTyped
        } else if (view) {
          placeCursor(view, activeTyped)
        }
        lastCommentTyped = commentTyped
      } else if (commentView && commentTyped > 0) {
        placeCursor(commentView, commentTyped)
        lastCommentTyped = commentTyped
      } else {
        hideCursor()
      }

      updateStatus(active, activeTyped, commentTyped)
    } else {
      hideCursor()
      if (statusEl) setStyle(statusEl, 'opacity', '0')
    }

    const lineForMotion = activeLine ?? currentScript?.comment ?? null
    const sinceLine = lineForMotion ? info.songMs - lineForMotion.start : 9999
    const glitch = activeLine ? clamp(1 - sinceLine / 260) : 0
    const growth = clamp((active + 1) / 12, 0, 1)
    const introScale = lerp(1.14, 1, growth)
    const introLift = lerp(-9, 0, growth)
    const driftX =
      Math.sin(info.wallMs / 11000) * 0.55 + Math.sin(info.wallMs / 3700) * 0.18
    const driftY = Math.cos(info.wallMs / 9000) * 0.35
    const zoom = 1 + Math.sin(info.wallMs / 13000) * 0.012 + glitch * 0.008
    const rotate = Math.sin(info.wallMs / 17000) * 0.35 + glitch * 0.2

    if (codeEl) {
      setStyle(
        codeEl,
        'transform',
        `translate3d(${driftX}vw, ${introLift + driftY}vh, 0) scale(${introScale * zoom}) rotate(${rotate}deg)`
      )
      setStyle(
        codeEl,
        'filter',
        glitch > 0.02
          ? `drop-shadow(${glitch * 4}px 0 rgba(255,40,60,.55)) drop-shadow(${-glitch * 4}px 0 rgba(60,180,255,.45))`
          : 'none'
      )
    }

    if (wallGroups[0]) {
      setStyle(
        wallGroups[0],
        'transform',
        `translate3d(${Math.sin(info.wallMs / 17000) * 2.2}vw, ${Math.cos(info.wallMs / 21000) * 1.2}vh, 0) scale(1.06) rotate(${Math.sin(info.wallMs / 23000) * 1.2}deg)`
      )
    }
    if (wallGroups[1]) {
      setStyle(
        wallGroups[1],
        'transform',
        `translate3d(${Math.sin(info.wallMs / 24000 + 1.7) * 3.2}vw, ${Math.cos(info.wallMs / 19000 + 0.8) * 1.8}vh, 0) scale(1.13) rotate(${Math.cos(info.wallMs / 27000) * 1.6}deg)`
      )
    }

    for (const piece of pieces) {
      const phase = Number(piece.dataset.phase) || 0
      const t = info.wallMs / (10000 + phase * 900) + phase
      setStyle(
        piece,
        'transform',
        `translate3d(${Math.sin(t) * 1.4}vw, ${Math.cos(t * 1.13) * 1.8}vh, 0) rotate(${Math.sin(t * 0.8) * 14}deg)`
      )
    }

    const outroAt = currentScript?.lines.length
      ? (currentScript.lines[currentScript.lines.length - 1]?.end ?? 0) + 2400
      : 0
    const outroActive =
      !currentScript || currentScript.lines.length === 0 || info.songMs >= outroAt
    const outroProgress = outroActive
      ? currentScript
        ? clamp((info.songMs - outroAt) / 900)
        : 1
      : 0

    if (outroEl) {
      setStyle(outroEl, 'opacity', String(outroProgress))
      outroEl.style.pointerEvents = outroProgress > 0.5 ? 'auto' : 'none'
      outroEl.classList.toggle('is-outro', outroActive)
    }
    if (outroPiece) {
      setStyle(
        outroPiece,
        'transform',
        `rotate(${Math.sin(info.wallMs / 7000) * 7}deg) translateY(${Math.sin(info.wallMs / 5000) * 4}px)`
      )
    }
    if (outroCaret) {
      outroCaret.style.opacity = reducedMotion || info.wallMs % 1100 < 660 ? '1' : '0.16'
    }
    if (codeEl) setStyle(codeEl, 'opacity', String(1 - outroProgress))
    if (statusEl) setStyle(statusEl, 'opacity', String((1 - outroProgress) * 0.9))
    if (wallEl) setStyle(wallEl, 'opacity', String(1 - outroProgress * 0.72))
    if (piecesEl) setStyle(piecesEl, 'opacity', String(1 - outroProgress * 0.8))

    if (outroActive) {
      hideCursor()
      return outroProgress < 1
    }

    const typing =
      activeLine !== null
        ? activeTyped < activeLine.text.length
        : commentTyped < (currentScript?.comment.text.length ?? 0)
    return typing || glitch > 0.02
  }

  return {
    mount(host: HTMLElement): void {
      reducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      buildLayers(host)
    },
    setLyrics(next: LyricsModel | null): void {
      model = next
      script = buildCodeScript(model, track)
      resetCode()
    },
    setTrack(next: TrackInfo | null): void {
      if (track?.key === next?.key) return
      track = next
      rebuildWall()
      if (tagEl) tagEl.textContent = tagFor(track)
      if (outroTag) outroTag.textContent = tagFor(track)
      if (model) {
        script = buildCodeScript(model, track)
        resetCode()
      }
    },
    setPalette(next: Palette): void {
      palette = next
      // Invariant background & color aesthetic: Codestyle retains its fixed syntax palette
    },
    setMode(next: ShowOn): void {
      mode = next
      if (root) root.dataset.mode = mode
    },
    frame,
    async ready(): Promise<void> {
      try {
        await Promise.all([
          document.fonts.load('400 16px "Space Mono"'),
          document.fonts.load('700 16px "Space Mono"'),
          document.fonts.load('italic 400 16px "Space Mono"')
        ])
      } catch {
        // The system monospace fallback is acceptable if the bundled font cannot load.
      }
    },
    destroy(): void {
      root?.remove()
      root = null
      wallEl = null
      wallGroups = []
      piecesEl = null
      pieces = []
      codeEl = null
      linesEl = null
      statusEl = null
      statusFill = null
      statusText = null
      outroEl = null
      outroPiece = null
      outroTag = null
      outroCaret = null
      cursorEl = null
      caretEl = null
      tagEl = null
      model = null
      track = null
      script = null
      commentView = null
      lineViews.clear()
    }
  }
}

export { createCodestyle }
