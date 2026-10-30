import { parser as javascriptParser } from '@lezer/javascript'
import type { FileStat, Source } from './index'

const typescriptParser = javascriptParser.configure({ dialect: 'ts' })
const COMMENT = 1
const CODE = 2
type Span = { from: number; to: number; kind: number }

/** Only lexical classification is required for Java; preserve escaped text-block delimiters. */
function javaSpans(input: string) {
  const spans: Span[] = []
  let incomplete = false
  let i = 0
  while (i < input.length) {
    const from = i
    if (input.startsWith('//', i)) {
      const end = input.indexOf('\n', i + 2)
      i = end < 0 ? input.length : end
      spans.push({ from, to: i, kind: COMMENT })
    } else if (input.startsWith('/*', i)) {
      const end = input.indexOf('*/', i + 2)
      if (end < 0) incomplete = true
      i = end < 0 ? input.length : end + 2
      spans.push({ from, to: i, kind: COMMENT })
    } else if (input[i] === '"' || input[i] === "'") {
      const quote = input[i]!
      const block = input.startsWith('"""', i) && /^"""[ \t\f]*\n/.test(input.slice(i))
      i += block ? 3 : 1
      let closed = false
      while (i < input.length) {
        if (input[i] === '\\') {
          if (!block && input[i + 1] === '\n') incomplete = true
          i = Math.min(input.length, i + 2)
        } else if (block ? input.startsWith('"""', i) : input[i] === quote) {
          i += block ? 3 : 1
          closed = true
          break
        } else if (!block && input[i] === '\n') break
        else i++
      }
      if (!closed) incomplete = true
      spans.push({ from, to: i, kind: CODE })
    } else i++
  }
  return { spans, incomplete }
}

/** Java translates eligible Unicode escapes before recognizing comments and strings.
 * Keep an offset map so escaped line terminators never invent source physical lines.
 */
function javaInput(text: string) {
  const edits: { end: number; removed: number }[] = []
  const chunks: string[] = []
  let slashes = 0
  let previousEscape = false
  let copied = 0
  let removed = 0
  let malformed = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') {
      slashes = 0
      previousEscape = false
      continue
    }
    const eligible = previousEscape || slashes % 2 === 0
    const escape = eligible ? /^\\u+([\da-fA-F]{4})/.exec(text.slice(i)) : null
    if (escape) {
      const value = String.fromCharCode(parseInt(escape[1]!, 16)).replace(/\r/g, '\n')
      chunks.push(text.slice(copied, i), value)
      removed += escape[0].length - 1
      copied = i + escape[0].length
      edits.push({ end: copied - removed, removed })
      i = copied - 1
      slashes = value === '\\' ? slashes + 1 : 0
      previousEscape = true
    } else {
      if (eligible && text[i + 1] === 'u') malformed = true
      slashes++
      previousEscape = false
    }
  }
  const input = edits.length ? chunks.join('') + text.slice(copied) : text
  function sourceOffset(offset: number) {
    let low = 0
    let high = edits.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (edits[middle]!.end <= offset) low = middle + 1
      else high = middle
    }
    return offset + (edits[low - 1]?.removed ?? 0)
  }
  return { input, sourceOffset, malformed }
}

/** Classify parser-recognized lexical regions; do not execute or count statements. */
export function analyzeModern(source: Source): FileStat {
  const language = source.language!
  const output: FileStat = {
    path: source.path,
    language,
    status: 'ok',
    counts: { total: 0, blank: 0, commentOnly: 0, code: 0, mixed: 0 },
    reason: '',
    warnings: [],
    functionCount: null,
  }
  if (source.text.includes('\0')) {
    return { ...output, status: 'error', reason: '内容含二进制空字符，未按源代码统计。' }
  }
  const text = source.text.replace(/\r\n?/g, '\n')
  if (!text) return output
  const { input, sourceOffset, malformed } =
    language === 'java'
      ? javaInput(text)
      : { input: text, sourceOffset: (offset: number) => offset, malformed: false }
  const spans: Span[] = []
  let incomplete = malformed
  if (language === 'java') {
    const lexical = javaSpans(input)
    for (const span of lexical.spans) spans.push(span)
    incomplete ||= lexical.incomplete
  } else {
    const parser = language === 'typescript' ? typescriptParser : javascriptParser
    parser.parse(input).iterate({
      enter(node) {
        const name = node.type.name
        if (node.type.isError) incomplete = true
        if (name === 'LineComment' || name === 'BlockComment' || name === 'Hashbang') {
          spans.push({ from: node.from, to: node.to, kind: COMMENT })
        }
        if (name === 'String' || name === 'RegExp') {
          spans.push({ from: node.from, to: node.to, kind: CODE })
          if (name === 'String' && input[node.to - 1] !== input[node.from]) incomplete = true
          if (name === 'RegExp') {
            const literal = input.slice(node.from, node.to)
            const closing = literal.lastIndexOf('/')
            let slashes = 0
            for (let at = closing - 1; at >= 0 && literal[at] === '\\'; at--) slashes++
            if (closing < 1 || slashes % 2 || !/^[dgimsuvy]*$/.test(literal.slice(closing + 1)))
              incomplete = true
          }
        }
        if (name === 'TemplateString' || name === 'TemplateType') {
          let from = node.from
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name !== 'Interpolation') continue
            spans.push({ from, to: child.from, kind: CODE })
            from = child.to
          }
          spans.push({ from, to: node.to, kind: CODE })
          // Visit interpolated code, including nested templates and real comments.
        }
      },
    })
  }
  spans.sort((a, b) => a.from - b.from || a.to - b.to)
  const lineStarts = [0]
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1)
  }
  const flags = new Uint8Array(lineStarts.length)
  function lineAt(offset: number) {
    let low = 0
    let high = lineStarts.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (lineStarts[middle]! <= offset) low = middle + 1
      else high = middle
    }
    return Math.max(0, low - 1)
  }
  function mark(from: number, to: number, kind: number) {
    if (to <= from) return
    const first = lineAt(sourceOffset(from))
    const last = lineAt(sourceOffset(to) - 1)
    for (let line = first; line <= last; line++) flags[line]! |= kind
  }
  function markCode(from: number, to: number) {
    for (const match of input.slice(from, to).matchAll(/\S+/g)) {
      mark(from + match.index, from + match.index + match[0].length, CODE)
    }
  }
  let offset = 0
  for (const span of spans) {
    if (span.from > offset) markCode(offset, span.from)
    mark(Math.max(offset, span.from), span.to, span.kind)
    offset = Math.max(offset, span.to)
  }
  markCode(offset, input.length)
  output.counts.total = flags.length
  for (const flag of flags) {
    if (flag & CODE) {
      output.counts.code++
      if (flag & COMMENT) output.counts.mixed++
    } else if (flag & COMMENT) output.counts.commentOnly++
    else output.counts.blank++
  }
  if (incomplete) {
    output.warnings.push('存在未完整识别的语法或未闭合内容；行统计基于已识别区域，请结合源码复核。')
  }
  return output
}
