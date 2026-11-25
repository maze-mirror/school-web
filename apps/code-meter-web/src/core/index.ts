import { countFunctions, FUNCTION_RULE_VERSION } from './functions'
import { analyzeModern } from './modern-languages'
export const RULE_VERSION = 'physical-lines-1.2'
export type Language = string
export const LANGUAGES: { id: Language; name: string; extensions: string[] }[] = [
  { id: 'c', name: 'C', extensions: ['c', 'h'] },
  { id: 'cpp', name: 'C++', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'] },
  { id: 'python', name: 'Python', extensions: ['py', 'pyw'] },
  { id: 'python-stub', name: 'Python 类型声明', extensions: ['pyi'] },
  { id: 'java', name: 'Java', extensions: ['java'] },
  { id: 'javascript', name: 'JavaScript', extensions: ['js', 'mjs', 'cjs'] },
  { id: 'typescript', name: 'TypeScript', extensions: ['ts', 'mts', 'cts'] },
]
export const supportedLanguageNames = () => LANGUAGES.map((language) => language.name).join(' / ')
export interface Counts {
  total: number
  blank: number
  commentOnly: number
  code: number
  mixed: number
}
export interface Source {
  path: string
  text: string
  language?: Language
  encoding?: 'utf-8' | 'gbk'
}
export interface FileStat {
  path: string
  language: Language | null
  status: 'ok' | 'skipped' | 'error'
  counts: Counts
  reason: string
  warnings: string[]
  functionCount?: number | null
  functionRuleVersion?: string
}
export interface LanguageStat {
  language: Language
  name: string
  files: number
  counts: Counts
}
export interface ScanResult {
  totals: Counts
  languages: LanguageStat[]
  files: FileStat[]
  configKey: string
  ruleVersion: string
}
export interface Snapshot extends ScanResult {
  id: string
  projectId: string
  projectName: string
  scannedAt: string
  timezone: string
}
export const emptyCounts = (): Counts => ({ total: 0, blank: 0, commentOnly: 0, code: 0, mixed: 0 })
export const detectLanguage = (path: string): Language | null => {
  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  return LANGUAGES.find((l) => l.extensions.includes(ext))?.id ?? null
}
type State = 'normal' | 'block' | 'quote' | 'triple' | 'raw' | 'line'

/** Physical-line lexer; Python docstrings stay code and source is never executed. */
function analyzeBuiltin(source: Source): FileStat {
  const language = source.language ?? detectLanguage(source.path)
  const output: FileStat = {
    path: source.path,
    language,
    status: 'ok',
    counts: emptyCounts(),
    reason: '',
    warnings: [],
  }
  if (!language)
    return {
      ...output,
      status: 'skipped',
      reason: '暂不支持此语言；当前支持 ' + supportedLanguageNames() + '。',
    }
  if (source.text.includes('\0'))
    return { ...output, status: 'error', reason: '内容含二进制空字符，未按源代码统计。' }
  if (!source.text) return output
  const lines = source.text.replace(/\r\n?/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  let state: State = 'normal',
    quote = '',
    rawEnd = ''
  const python = language === 'python' || language === 'python-stub'
  for (const line of lines) {
    let code = state === 'quote' || state === 'triple' || state === 'raw'
    let comment = state === 'block' || state === 'line'
    let i = 0
    if (state === 'line') {
      state = line.endsWith('\\') ? 'line' : 'normal'
      i = line.length
    }
    while (i < line.length) {
      const c = line[i]!,
        n = line[i + 1]
      if (state === 'block') {
        comment = true
        if (c === '*' && n === '/') {
          state = 'normal'
          i += 2
        } else i++
        continue
      }
      if (state === 'raw') {
        code = true
        if (line.startsWith(rawEnd, i)) {
          i += rawEnd.length
          state = 'normal'
        } else i++
        continue
      }
      if (state === 'triple') {
        code = true
        if (c === '\\') {
          i += 2
          continue
        }
        if (line.startsWith(quote.repeat(3), i)) {
          state = 'normal'
          i += 3
        } else i++
        continue
      }
      if (state === 'quote') {
        code = true
        if (c === '\\') {
          i += 2
          continue
        }
        if (c === quote) state = 'normal'
        i++
        continue
      }
      if (/\s/.test(c)) {
        i++
        continue
      }
      if (python && c === '#') {
        comment = true
        break
      }
      if (!python && c === '/' && n === '/') {
        comment = true
        if (line.endsWith('\\')) state = 'line'
        break
      }
      if (!python && c === '/' && n === '*') {
        comment = true
        state = 'block'
        i += 2
        continue
      }
      if (language === 'cpp') {
        const raw = /^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/.exec(line.slice(i))
        if (raw) {
          code = true
          rawEnd = ')' + raw[1] + '"'
          state = 'raw'
          i += raw[0].length
          continue
        }
      }
      if (
        language === 'cpp' &&
        c === "'" &&
        /(?:^|[^\w])(?:0[xX][0-9a-fA-F']+(?:\.[0-9a-fA-F']*)?(?:[pP][+-]?[0-9']+)?|0[bB][01']+|[0-9][0-9']*(?:\.[0-9']*)?(?:[eE][+-]?[0-9']+)?)$/.test(
          line.slice(0, i),
        ) &&
        /[\da-fA-F]/.test(n ?? '')
      ) {
        code = true
        i++
        continue
      }
      if (c === '"' || c === "'") {
        code = true
        quote = c
        if (python && line.startsWith(c.repeat(3), i)) {
          state = 'triple'
          i += 3
        } else {
          state = 'quote'
          i++
        }
        continue
      }
      code = true
      i++
    }
    output.counts.total++
    if (code) {
      output.counts.code++
      if (comment) output.counts.mixed++
    } else if (comment) output.counts.commentOnly++
    else output.counts.blank++
    if (state === 'quote' && !line.endsWith('\\')) {
      output.warnings.push(`第 ${output.counts.total} 行：字符串可能未闭合，按物理行扫描。`)
      state = 'normal'
    }
  }
  if (state === 'block' || state === 'raw' || state === 'triple')
    output.warnings.push('文件末尾有未闭合的注释或字符串；建议检查源文件。')
  return output
}
export type Analyzer = (source: Source) => FileStat
const analyzers = new Map<string, Analyzer>(
  LANGUAGES.map((language) => [
    language.id,
    ['java', 'javascript', 'typescript'].includes(language.id) ? analyzeModern : analyzeBuiltin,
  ]),
)
/** Extension point: registering an analyzer leaves summary, storage and charts unchanged. */
export function registerAnalyzer(
  definition: { id: Language; name: string; extensions: string[] },
  analyzer: Analyzer,
) {
  if (analyzers.has(definition.id)) throw new Error('语言标识已存在')
  LANGUAGES.push(definition)
  analyzers.set(definition.id, analyzer)
}
export function analyzeText(source: Source): FileStat {
  const language = source.language ?? detectLanguage(source.path)
  if (!language)
    return {
      path: source.path,
      language: null,
      status: 'skipped',
      counts: emptyCounts(),
      reason: '暂不支持此语言；当前支持 ' + supportedLanguageNames() + '。',
      warnings: [],
    }
  const analyzer = analyzers.get(language)
  if (!analyzer)
    return {
      path: source.path,
      language: null,
      status: 'skipped',
      counts: emptyCounts(),
      reason: '没有可用的语言分析器',
      warnings: [],
    }
  try {
    const result = analyzer({ ...source, language })
    if (source.encoding === 'gbk' && result.status === 'ok')
      result.warnings.push('已按所选编码策略使用 GBK 解码；请确认源文件编码，原文件未修改。')
    if (result.status === 'ok' && ['c', 'cpp', 'python'].includes(language)) {
      const functions = countFunctions(source.text, language)
      result.functionCount = functions.count
      result.functionRuleVersion = FUNCTION_RULE_VERSION
      if (functions.warning) result.warnings.push(functions.warning)
    }
    return result
  } catch (e) {
    return {
      path: source.path,
      language,
      status: 'error',
      counts: emptyCounts(),
      reason: e instanceof Error ? e.message : '分析失败',
      warnings: [],
    }
  }
}
export function summarize(files: FileStat[], configKey = 'default'): ScanResult {
  const totals = emptyCounts(),
    map = new Map<Language, LanguageStat>()
  for (const file of files) {
    if (file.status !== 'ok' || !file.language) continue
    let group = map.get(file.language)
    if (!group) {
      group = {
        language: file.language,
        name: LANGUAGES.find((l) => l.id === file.language)!.name,
        files: 0,
        counts: emptyCounts(),
      }
      map.set(file.language, group)
    }
    group.files++
    for (const key of Object.keys(totals) as (keyof Counts)[]) {
      totals[key] += file.counts[key]
      group.counts[key] += file.counts[key]
    }
  }
  return {
    totals,
    languages: [...map.values()].sort((a, b) => b.counts.code - a.counts.code),
    files,
    configKey,
    ruleVersion: RULE_VERSION,
  }
}
export function compareSnapshots(
  baseline: Snapshot | undefined,
  end: Snapshot | undefined,
): { value: number | null; reason: string } {
  if (!end) return { value: null, reason: '没有期末快照' }
  if (!baseline) return { value: null, reason: '缺少期初基线' }
  if (
    baseline.projectId !== end.projectId ||
    baseline.configKey !== end.configKey ||
    baseline.ruleVersion !== end.ruleVersion
  )
    return { value: null, reason: '项目或规则配置不同' }
  return { value: end.totals.code - baseline.totals.code, reason: '' }
}
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export interface ActivityDay {
  date: string
  count: number
  scannedCode: number
  level: number
}
export function activityDays(snapshots: Snapshot[], start: Date, end: Date): ActivityDay[] {
  const totals = new Map<string, { count: number; scannedCode: number }>()
  for (const s of snapshots) {
    const d = new Date(s.scannedAt)
    if (d >= start && d < end) {
      const key = localDateKey(d)
      const day = totals.get(key) ?? { count: 0, scannedCode: 0 }
      day.count++
      day.scannedCode += s.totals.code
      totals.set(key, day)
    }
  }
  const maximum = Math.max(0, ...[...totals.values()].map((day) => day.scannedCode))
  const days: ActivityDay[] = []
  const cursor = new Date(start)
  cursor.setHours(0, 0, 0, 0)
  while (cursor < end) {
    const date = localDateKey(cursor)
    const { count, scannedCode } = totals.get(date) ?? { count: 0, scannedCode: 0 }
    days.push({
      date,
      count,
      scannedCode,
      level: maximum > 0 ? Math.ceil((scannedCode / maximum) * 4) : 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}
export function periodSnapshots(snapshots: Snapshot[], projectId: string, start: Date, end: Date) {
  const sorted = snapshots
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt))
  const last = sorted.find((s) => new Date(s.scannedAt) < end)
  const baseline = last
    ? sorted.find(
        (s) =>
          new Date(s.scannedAt) < start &&
          s.configKey === last.configKey &&
          s.ruleVersion === last.ruleVersion,
      )
    : undefined
  const within = sorted.filter((s) => new Date(s.scannedAt) >= start && new Date(s.scannedAt) < end)
  return { last, baseline, within, comparison: compareSnapshots(baseline, last) }
}
