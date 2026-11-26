// @vitest-environment node
import { expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { analyzeText, summarize, type Snapshot } from '@/core'
import { snapshotCsv, snapshotJson, snapshotXlsx, summaryRows } from '../reports'

function sample(): Snapshot {
  return {
    ...summarize([
      analyzeText({
        path: '=evil.py',
        text: 'def f():\n    return 1\n\n# comment\n',
      }),
      analyzeText({ path: 'empty.py', text: '' }),
    ]),
    id: 's',
    projectId: 'p',
    projectName: '项目',
    scannedAt: '2026-10-21T08:00:00Z',
    timezone: 'Asia/Shanghai',
  }
}

it('exports the requested summary fields, file details and metric definitions in JSON', () => {
  const snapshot = sample()
  const json = JSON.parse(snapshotJson(snapshot))
  expect(json.schemaVersion).toBe(3)
  expect(json.summary.byLanguage[0]).toEqual({
    language: 'Python',
    sourceFiles: 2,
    codeLines: 2,
    blankLines: 1,
    commentLines: 1,
    functionCount: 1,
    functionLanguageCoverage: { counted: 1, total: 1 },
    maxFunctionLines: 2,
    minFunctionLines: 2,
    meanFunctionLines: 2,
    medianFunctionLines: 2,
    maxCodeLines: 2,
    minCodeLines: 0,
    meanCodeLines: 1,
    medianCodeLines: 1,
  })
  expect(json.snapshot.files[0].functionCount).toBe(1)
  expect(json.snapshot.files[0].functionIncomplete).toBe(false)
  expect(json.snapshot.files[0].functionRuleVersion).toBe('function-definitions-2.0')
  expect(snapshot.files[0]!.functionLineSizes).toEqual([2])
  expect(JSON.stringify(json)).not.toContain('functionLineSizes')
  expect(json.definitions.dailyActivity).toContain('重复扫描累计')
  expect(JSON.stringify(json)).not.toContain('return 1')
})

it('exports new languages through CSV, JSON and Excel without inventing function counts', async () => {
  const s = sample()
  Object.assign(
    s,
    summarize([
      analyzeText({ path: 'A.java', text: 'int n = 1; // note' }),
      analyzeText({ path: 'a.js', text: 'const n = 1;' }),
      analyzeText({ path: 'a.ts', text: 'const n: number = 1;' }),
    ]),
  )
  const json = JSON.parse(snapshotJson(s))
  expect(json.summary.byLanguage.map((row: { language: string }) => row.language)).toEqual([
    'Java',
    'JavaScript',
    'TypeScript',
  ])
  expect(json.summary.total.functionCount).toBe(0)
  expect(json.summary.total.functionLanguageCoverage).toEqual({ counted: 1, total: 3 })
  expect(summaryRows(s, 'function')[2]!.slice(5)).toEqual(['—', '—', '—', '—', '—'])
  expect(json.snapshot.ruleVersion).toBe('physical-lines-1.2')
  for (const name of ['Java', 'JavaScript', 'TypeScript'])
    expect(snapshotCsv(s)).toContain('"' + name + '"')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await snapshotXlsx(s))
  const summary = workbook.getWorksheet('语言汇总')!
  expect(summary.getCell('A3').value).toBe('Java')
  expect(summary.getCell('A5').value).toBe('TypeScript')
  expect(summary.getCell('C6').value).toBe(3)
  expect(summary.getCell('F5').value).toBe('—')
  expect(summary.getCell('F6').value).toBe(0)
})

it('keeps old snapshot function counts null while computing the available file statistics', () => {
  const s = sample()
  s.files.forEach((file) => {
    delete file.functionCount
    delete file.functionRuleVersion
    delete file.functionLineSizes
    delete file.functionIncomplete
  })
  const report = JSON.parse(snapshotJson(s))
  expect(report.summary.total.functionCount).toBeNull()
  expect(
    report.snapshot.files.every(
      (file: { functionCount: number | null }) => file.functionCount === null,
    ),
  ).toBe(true)
  expect(report.summary.total.meanCodeLines).toBe(1)
  expect(report.summary.total.medianFunctionLines).toBeNull()
  expect(summaryRows(s, 'function')[1]!.slice(5)).toEqual(['—', '—', '—', '—', '—'])
  expect(snapshotCsv(s)).toContain('—')
})

it('writes summary first in CSV and preserves safe file details', () => {
  const csv = snapshotCsv(sample())
  expect(
    csv.startsWith(
      '\ufeff"语言汇总（按文件）"\r\n"语言","源文件数","代码行数","空行数","注释行数","函数个数","最大值","最小值","均值","中位数"',
    ),
  ).toBe(true)
  expect(csv).toContain('"Python","2","2","1","1","1","2","0","1","1"')
  expect(csv).toContain('"语言汇总（按函数）"')
  expect(csv).toContain('"Python","2","2","1","1","1","2","2","2","2"')
  expect(csv).toContain('"报表版本","3"')
  expect(csv).toContain('"\'=evil.py"')
  expect(csv).toContain('文件明细')
})

it('creates a real Excel workbook with numeric summaries, file details and definitions', async () => {
  const bytes = await snapshotXlsx(sample())
  expect(Array.from(new Uint8Array(bytes).slice(0, 2))).toEqual([80, 75])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    '语言汇总',
    '文件明细',
    '统计说明',
  ])
  const summary = workbook.getWorksheet('语言汇总')!
  expect(summary.getCell('A1').value).toBe('语言汇总（按文件）')
  expect(summary.getCell('A6').value).toBe('语言汇总（按函数）')
  expect(summary.getRow(3).values).toEqual([undefined, 'Python', 2, 2, 1, 1, 1, 2, 0, 1, 1])
  expect(summary.getRow(8).values).toEqual([undefined, 'Python', 2, 2, 1, 1, 1, 2, 2, 2, 2])
  for (const row of [3, 8]) {
    expect(summary.getCell(row, 9).numFmt).toBe('0.00')
    expect(summary.getCell(row, 10).numFmt).toBe('0.00')
    expect(summary.getCell(row, 8).numFmt).not.toBe('0.00')
  }
  expect(summary.autoFilter).toBeUndefined()
  const filename = workbook.getWorksheet('文件明细')!.getCell('A2')
  expect(filename.value).toBe('=evil.py')
  expect(filename.type).toBe(ExcelJS.ValueType.String)
  expect(workbook.getWorksheet('统计说明')!.getCell('B1').value).toBe('项目')
})

it('keeps Python stubs separate in all exports, including GBK notes and old rule metadata', async () => {
  const s = {
    ...sample(),
    ...summarize([
      analyzeText({ path: 'a.py', text: 'x = 1' }),
      analyzeText({
        path: 'types.pyi',
        text: '# 声明\nx: int\ny: str',
        encoding: 'gbk',
      }),
    ]),
  }
  const json = JSON.parse(snapshotJson(s))
  expect(
    json.summary.byLanguage.map((row: { language: string; codeLines: number }) => [
      row.language,
      row.codeLines,
    ]),
  ).toEqual([
    ['Python', 1],
    ['Python 类型声明', 2],
  ])
  expect(json.summary.total.codeLines).toBe(3)
  expect(json.snapshot.files[1].functionCount).toBeNull()
  expect(snapshotCsv(s)).toContain('"Python 类型声明","1","2","0","1","—"')
  expect(snapshotCsv(s)).toContain('GBK 解码')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await snapshotXlsx(s))
  expect(workbook.getWorksheet('语言汇总')!.getCell('A4').value).toBe('Python 类型声明')
  expect(workbook.getWorksheet('语言汇总')!.getCell('C5').value).toBe(3)
  expect(workbook.getWorksheet('文件明细')!.getCell('J3').value).toContain('GBK 解码')
  const old = { ...s, ruleVersion: 'physical-lines-1.1' }
  expect(JSON.parse(snapshotJson(old)).snapshot.ruleVersion).toBe('physical-lines-1.1')
})
