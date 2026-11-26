import type { FileStat, ScanResult } from './index'

export interface ReportRow {
  language: string
  sourceFiles: number
  codeLines: number
  blankLines: number
  commentLines: number
  functionCount: number | null
  functionLanguageCoverage?: { counted: number; total: number }
  maxFunctionLines: number | null
  minFunctionLines: number | null
  meanFunctionLines: number | null
  medianFunctionLines: number | null
  maxCodeLines: number | null
  minCodeLines: number | null
  meanCodeLines: number | null
  medianCodeLines: number | null
}

export const REPORT_COLUMNS = [
  { key: 'language', label: '语言' },
  { key: 'sourceFiles', label: '源文件数' },
  { key: 'codeLines', label: '代码行数' },
  { key: 'blankLines', label: '空行数' },
  { key: 'commentLines', label: '注释行数' },
  { key: 'functionCount', label: '函数个数' },
  { key: 'maxCodeLines', label: '最大值' },
  { key: 'minCodeLines', label: '最小值' },
  { key: 'meanCodeLines', label: '均值' },
  { key: 'medianCodeLines', label: '中位数' },
] as const

export const REPORT_COLUMNS_FUNCTIONS = [
  { key: 'maxFunctionLines', label: '最大值' },
  { key: 'minFunctionLines', label: '最小值' },
  { key: 'meanFunctionLines', label: '均值' },
  { key: 'medianFunctionLines', label: '中位数' },
] as const
export type ReportColumnKey =
  (typeof REPORT_COLUMNS)[number]['key'] | (typeof REPORT_COLUMNS_FUNCTIONS)[number]['key']

function summarizeRow(language: string, files: FileStat[]): ReportRow {
  const lengths = files.map((file) => file.counts.code).sort((a, b) => a - b)
  const count = lengths.length
  const codeLines = lengths.reduce((sum, length) => sum + length, 0)
  const middle = Math.floor(count / 2)
  const counted = files.filter((file) => typeof file.functionCount === 'number')
  const sizes = files.flatMap((file) => file.functionLineSizes ?? []).sort((a, b) => a - b)
  const functionMiddle = Math.floor(sizes.length / 2)
  return {
    language,
    sourceFiles: count,
    codeLines,
    blankLines: files.reduce((sum, file) => sum + file.counts.blank, 0),
    commentLines: files.reduce((sum, file) => sum + file.counts.commentOnly, 0),
    functionCount: counted.length
      ? counted.reduce((sum, file) => sum + file.functionCount!, 0)
      : null,
    functionLanguageCoverage: {
      counted: new Set(counted.map((file) => file.language)).size,
      total: new Set(files.map((file) => file.language)).size,
    },
    maxFunctionLines: sizes.at(-1) ?? null,
    minFunctionLines: sizes[0] ?? null,
    meanFunctionLines: sizes.length
      ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length
      : null,
    medianFunctionLines: sizes.length
      ? sizes.length % 2
        ? sizes[functionMiddle]!
        : (sizes[functionMiddle - 1]! + sizes[functionMiddle]!) / 2
      : null,
    maxCodeLines: lengths.at(-1) ?? null,
    minCodeLines: lengths[0] ?? null,
    meanCodeLines: count ? codeLines / count : null,
    medianCodeLines: count
      ? count % 2
        ? lengths[middle]!
        : (lengths[middle - 1]! + lengths[middle]!) / 2
      : null,
  }
}

/** Derive from successful files so both old and new snapshots get file-size statistics. */
export function buildReport(snapshot: ScanResult) {
  const successful = snapshot.files.filter((file) => file.status === 'ok' && file.language)
  const groups = new Map<string, FileStat[]>()
  for (const file of successful) {
    const group = groups.get(file.language!) ?? []
    group.push(file)
    groups.set(file.language!, group)
  }
  const byLanguage = [...groups].map(([language, files]) =>
    summarizeRow(
      snapshot.languages.find((item) => item.language === language)?.name ?? language,
      files,
    ),
  )
  return { byLanguage, total: summarizeRow('项目合计', successful) }
}
