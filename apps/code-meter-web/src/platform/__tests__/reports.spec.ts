// @vitest-environment node
import { expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { analyzeText, summarize, type Snapshot } from '@/core'
import { snapshotCsv, snapshotJson, snapshotXlsx } from '../reports'

function sample(): Snapshot {
  return {
    ...summarize([
      analyzeText({ path: '=evil.py', text: 'def f():\n    return 1\n\n# comment\n' }),
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
  const json = JSON.parse(snapshotJson(sample()))
  expect(json.schemaVersion).toBe(2)
  expect(json.summary.byLanguage[0]).toEqual({
    language: 'Python',
    sourceFiles: 2,
    codeLines: 2,
    blankLines: 1,
    commentLines: 1,
    functionCount: 1,
    maxCodeLines: 2,
    minCodeLines: 0,
    meanCodeLines: 1,
    medianCodeLines: 1,
  })
  expect(json.snapshot.files[0].functionCount).toBe(1)
  expect(json.definitions.dailyActivity).toContain('重复扫描累计')
  expect(JSON.stringify(json)).not.toContain('return 1')
})

it('keeps old snapshot function counts null while computing the available file statistics', () => {
  const s = sample()
  s.files.forEach((file) => {
    delete file.functionCount
    delete file.functionRuleVersion
  })
  const report = JSON.parse(snapshotJson(s))
  expect(report.summary.total.functionCount).toBeNull()
  expect(
    report.snapshot.files.every(
      (file: { functionCount: number | null }) => file.functionCount === null,
    ),
  ).toBe(true)
  expect(report.summary.total.meanCodeLines).toBe(1)
  expect(snapshotCsv(s)).toContain('—')
})

it('writes summary first in CSV and preserves safe file details', () => {
  const csv = snapshotCsv(sample())
  expect(
    csv.startsWith(
      '\ufeff"语言","源文件数","代码行数","空行数","注释行数","函数个数","最大值","最小值","均值","中位数"',
    ),
  ).toBe(true)
  expect(csv).toContain('"Python","2","2","1","1","1","2","0","1","1"')
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
  expect(workbook.getWorksheet('语言汇总')!.getRow(2).values).toEqual([
    undefined,
    'Python',
    2,
    2,
    1,
    1,
    1,
    2,
    0,
    1,
    1,
  ])
  const filename = workbook.getWorksheet('文件明细')!.getCell('A2')
  expect(filename.value).toBe('=evil.py')
  expect(filename.type).toBe(ExcelJS.ValueType.String)
  expect(workbook.getWorksheet('统计说明')!.getCell('B1').value).toBe('项目')
})
