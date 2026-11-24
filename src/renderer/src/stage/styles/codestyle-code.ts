import type { TrackInfo } from '@shared/types'
import type { LyricsModel } from '../model'

/** Visual role of a token in the generated source. */
export type CodeRole = 'method' | 'arg' | 'keyword' | 'pronoun' | 'neutral' | 'punct' | 'comment'

export interface CodeToken {
  text: string
  role: CodeRole
  /** Start offset in the line's plain text. */
  start: number
  /** Index into the source line's words when this token is a word. */
  wordIndex?: number
}

export interface CodeLine {
  tokens: CodeToken[]
  text: string
  start: number
  end: number
  /** Time at which each character becomes visible. Strictly non-decreasing. */
  charTimes: number[]
  /** Index in the generated code block, or -1 for the header comment. */
  lineIndex: number
  comment: boolean
}

export interface CodeScript {
  comment: CodeLine
  lines: CodeLine[]
  totalChars: number
}

export interface WallRow {
  text: string
  tone: number
  /** Horizontal offset as a fraction of the row width. */
  offset: number
  opacity: number
}

const BLUE_WORDS = new Set([
  'so',
  'not',
  'just',
  'once',
  'twice',
  'when',
  'until',
  'if',
  'then',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'to',
  'of',
  'in',
  'on',
  'at',
  'from',
  'with',
  'as',
  'away',
  'a',
  'an',
  'the',
  'it',
  'your',
  'my',
  'our',
  'their',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'we',
  'they',
  'he',
  'me',
  'us',
  'them',
  'can',
  'could',
  'will',
  'would',
  'should',
  'do',
  'does',
  'did',
  'got',
  'feel',
  'look',
  'looks',
  'falling',
  'returning',
  'burning'
])

const cleanWord = (text: string): string => {
  const lowered = text.toLowerCase().trim()
  const cleaned = lowered.replace(/[^\p{L}\p{N}']/gu, '').replace(/'/g, '')
  // Some scripts (and instrumental markers) have no latin identifier characters.
  return cleaned || lowered.replace(/\s+/g, '')
}

const roleForWord = (word: string, position: 'head' | 'arg', lastInChunk: boolean): CodeRole => {
  if (word === 'she' || word === 'her') return 'pronoun'
  if (position === 'head') return 'method'
  if (BLUE_WORDS.has(word)) return 'keyword'
  return lastInChunk ? 'arg' : 'neutral'
}

const chunkWords = (words: string[]): string[][] => {
  if (words.length === 0) return []
  if (words.length === 1) return [words]
  if (words.length === 2) return [[words[0]!], [words[1]!]]
  if (words.length === 3) return [[words[0]!, words[1]!], [words[2]!]]

  const headLength = words.length <= 6 ? 2 : 3
  const head = words.slice(0, headLength)
  const rest = words.slice(headLength)
  const middle = Math.ceil(rest.length / 2)
  return [head, rest.slice(0, middle), rest.slice(middle)].filter((chunk) => chunk.length > 0)
}

const pushToken = (
  tokens: CodeToken[],
  text: string,
  role: CodeRole,
  wordIndex?: number
): void => {
  if (!text) return
  const start = tokens.reduce((sum, token) => sum + token.text.length, 0)
  tokens.push({ text, role, start, ...(wordIndex === undefined ? {} : { wordIndex }) })
}

const pushChain = (
  tokens: CodeToken[],
  words: string[],
  wordIndices: number[],
  position: 'head' | 'arg'
): void => {
  words.forEach((word, i) => {
    if (i > 0) pushToken(tokens, '.', 'punct')
    pushToken(tokens, word, roleForWord(word, position, i === words.length - 1), wordIndices[i])
  })
}

/** Turns one lyric line into a single line of readable pseudo-code. */
const codeLineFor = (words: string[], wordIndices: number[]): CodeToken[] => {
  const tokens: CodeToken[] = []
  const chunks = chunkWords(words)
  if (chunks.length === 0) return tokens

  const head = chunks[0]!
  const headIndices = wordIndices.slice(0, head.length)
  pushChain(tokens, head, headIndices, 'head')
  pushToken(tokens, '(', 'punct')

  const args = chunks.slice(1)
  if (args.length === 0) {
    // A single word becomes a call with no arguments.
    pushToken(tokens, ')', 'punct')
  } else {
    let cursor = head.length
    args.forEach((chunk, chunkIndex) => {
      if (chunkIndex > 0) pushToken(tokens, ', ', 'punct')
      const indices = wordIndices.slice(cursor, cursor + chunk.length)
      pushChain(tokens, chunk, indices, 'arg')
      cursor += chunk.length
    })
    pushToken(tokens, ')', 'punct')
  }
  pushToken(tokens, ';', 'punct')
  return tokens
}

const tokensText = (tokens: CodeToken[]): string => tokens.map((token) => token.text).join('')

const distributeTimes = (line: CodeLine, model: LyricsModel, sourceLine: number): void => {
  const source = model.lines[sourceLine]
  const words = source?.words ?? []
  const times: number[] = []
  let last = line.start

  for (const token of line.tokens) {
    if (token.wordIndex === undefined) {
      // Punctuation lands just after the previous character, then the monotonic pass
      // below keeps it from overtaking a word that starts earlier than expected.
      for (let i = 0; i < token.text.length; i++) {
        last = Math.max(last + 22, line.start)
        times.push(last)
      }
      continue
    }

    const word = words[token.wordIndex]
    const wordStart = word?.start ?? line.start
    const wordEnd = Math.max(word?.end ?? line.end, wordStart + 80)
    const span = Math.max(1, wordEnd - wordStart)
    for (let i = 0; i < token.text.length; i++) {
      const at = token.text.length <= 1 ? wordStart : wordStart + (span * i) / (token.text.length - 1)
      times.push(at)
      last = at
    }
  }

  // Words can overlap in real word-level timing. The reveal must still be monotonic.
  let previous = line.start
  for (let i = 0; i < times.length; i++) {
    const next = Math.max(times[i]!, previous + (i === 0 ? 0 : 4))
    times[i] = next
    previous = next
  }
  line.charTimes = times
}

const makeLine = (
  tokens: CodeToken[],
  start: number,
  end: number,
  lineIndex: number,
  comment: boolean
): CodeLine => ({
  tokens,
  text: tokensText(tokens),
  start,
  end: Math.max(end, start + 300),
  charTimes: [],
  lineIndex,
  comment
})

const commentFor = (track: TrackInfo | null): string => {
  const artist = track?.artist?.trim()
  const album = track?.album?.trim()
  const title = track?.title?.trim()
  const detail = [artist, album || title].filter(Boolean).join(', ').toLowerCase()
  return `// ${detail || 'lyrics, in progress'}.`
}

export const buildCodeScript = (model: LyricsModel | null, track: TrackInfo | null): CodeScript => {
  const commentText = commentFor(track)
  const firstStart = model?.lines.find((line) => line.text.trim())?.start ?? 0
  const commentStart = Math.max(0, firstStart - 2400)
  const commentEnd = commentStart + Math.max(900, Math.min(2200, commentText.length * 46))
  const commentTokens: CodeToken[] = []
  pushToken(commentTokens, commentText, 'comment')
  const comment = makeLine(commentTokens, commentStart, commentEnd, -1, true)
  comment.charTimes = Array.from({ length: comment.text.length }, (_, i) =>
    commentStart + ((commentEnd - commentStart) * i) / Math.max(1, comment.text.length - 1)
  )

  const lines: CodeLine[] = []
  model?.lines.forEach((source, sourceIndex) => {
    const entries = source.words
      .map((word, index) => ({ text: cleanWord(word.text), index }))
      .filter((entry) => entry.text.length > 0)
    if (!entries.length) return
    const tokens = codeLineFor(
      entries.map((entry) => entry.text),
      entries.map((entry) => entry.index)
    )
    if (!tokens.length) return
    const line = makeLine(tokens, source.start, source.end, lines.length, false)
    distributeTimes(line, model, sourceIndex)
    lines.push(line)
  })

  const totalChars = comment.text.length + lines.reduce((sum, line) => sum + line.text.length, 0)
  return { comment, lines, totalChars }
}

/** Number of characters visible at `songMs`. */
export const typedCharsAt = (line: CodeLine, songMs: number): number => {
  if (songMs < line.start) return 0
  if (songMs >= line.end) return line.text.length
  let low = 0
  let high = line.charTimes.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (line.charTimes[mid]! <= songMs) low = mid + 1
    else high = mid
  }
  return low
}

/** Index of the last code line that has started, or -1 before the first one. */
export const activeCodeLine = (script: CodeScript, songMs: number): number => {
  let low = 0
  let high = script.lines.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (script.lines[mid]!.start <= songMs) low = mid + 1
    else high = mid
  }
  return low - 1
}

export const completedChars = (script: CodeScript, active: number, activeTyped: number): number => {
  if (active < 0) return 0
  let total = 0
  for (let i = 0; i < active; i++) total += script.lines[i]!.text.length
  return total + activeTyped
}

const titleVariants = (title: string): string[] => {
  const upper = title.toUpperCase().replace(/\s+/g, ' ').trim()
  const words = upper.split(' ').filter(Boolean)
  if (!words.length) return ['LYRICS']
  if (words.length === 1) return [words[0]!, `${words[0]}/`, `${words[0]}/ ${words[0]}`, words[0]!]
  const first = words[0]!
  const rest = words.slice(1).join(' ')
  return [`${first}/ ${rest}`, `${first} ${rest.slice(0, Math.max(1, Math.ceil(rest.length / 2)))}/${rest.slice(Math.ceil(rest.length / 2))}`, `${first} ${rest}/`, `${first}/ ${rest}`]
}

/** Rows for the oversized album-title wall behind the code. */
export const buildWallRows = (track: TrackInfo | null): WallRow[] => {
  const title = track?.title?.trim() || 'Lyrics'
  const artist = track?.artist?.trim()?.toUpperCase() || 'Unknown Artist'
  const album = track?.album?.trim()?.toUpperCase() || title.toUpperCase()
  const variants = titleVariants(title)
  const rows: Array<{ text: string; tone: number }> = [
    { text: variants[0]!, tone: 0 },
    { text: variants[1]!, tone: 1 },
    { text: variants[2]!, tone: 2 },
    { text: variants[3]!, tone: 3 },
    { text: artist, tone: 4 },
    { text: artist, tone: 1 },
    { text: album, tone: 5 },
    { text: variants[0]!, tone: 2 },
    { text: artist, tone: 0 }
  ]
  return rows.map((row, i) => ({
    text: row.text,
    tone: row.tone,
    offset: -(((i * 37) % 100) / 100) * 0.32,
    opacity: i % 3 === 2 ? 0.55 : 0.82
  }))
}
