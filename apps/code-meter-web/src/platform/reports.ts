import type { Snapshot } from '@/core'
import { buildReport, REPORT_COLUMNS } from '@/core/report'

export const REPORT_DEFINITIONS = {
  sourceFiles: '仅包含本次快照中成功统计的源文件；空文件也参与文件数与分布统计。',
  codeLines: '有效物理代码行；混合行包含在代码行中。',
  commentLines: '纯注释行，不重复计入混合行。',
  distribution:
    '最大值、最小值、均值和中位数以每个成功源文件的有效代码行数为样本；项目合计按全部成功文件重新计算。',
  functions:
    'C/C++/Python 按源文本中的命名函数定义计数；含嵌套函数、方法和有函数体的构造/析构函数，不计调用、声明或 lambda。未展开 C/C++ 宏与条件编译。Java/JavaScript/TypeScript 暂不提供函数统计；未支持、语法无法完整识别或旧历史未记录时为 null。',
  dailyActivity:
    '每天累计每次成功保存扫描的有效代码行；重复扫描累计。按所选区间的最高日合计归一化，不代表新增代码或开发工作量。',
}

export function snapshotReport(snapshot: Snapshot) {
  return {
    schemaVersion: 2,
    snapshot: {
      ...snapshot,
      files: snapshot.files.map((file) => ({ ...file, functionCount: file.functionCount ?? null })),
    },
    summary: buildReport(snapshot),
    definitions: REPORT_DEFINITIONS,
  }
}

export function snapshotJson(snapshot: Snapshot): string {
  return JSON.stringify(snapshotReport(snapshot), null, 2)
}

type Cell = string | number
export function summaryRows(snapshot: Snapshot): Cell[][] {
  const report = buildReport(snapshot)
  return [
    REPORT_COLUMNS.map((column) => column.label),
    ...[...report.byLanguage, report.total].map((row) =>
      REPORT_COLUMNS.map((column) => row[column.key] ?? '—'),
    ),
  ]
}

function fileRows(snapshot: Snapshot): Cell[][] {
  return [
    ['路径', '语言', '状态', '总行', '空行', '注释行', '代码行', '混合行', '函数个数', '说明'],
    ...snapshot.files.map((file) => [
      file.path,
      file.language ?? '未知',
      file.status,
      ...(['total', 'blank', 'commentOnly', 'code', 'mixed'] as const).map((key) =>
        file.status === 'ok' ? file.counts[key] : '—',
      ),
      file.status === 'ok' ? (file.functionCount ?? '—') : '—',
      [file.reason, ...file.warnings].filter(Boolean).join('；'),
    ]),
  ]
}

function metadataRows(snapshot: Snapshot): Cell[][] {
  return [
    ['项目名称', snapshot.projectName],
    ['项目编号', snapshot.projectId],
    ['扫描时间', snapshot.scannedAt],
    ['时区', snapshot.timezone],
    ['行统计规则', snapshot.ruleVersion],
    ['报表版本', 2],
    [
      '函数规则版本',
      [...new Set(snapshot.files.map((file) => file.functionRuleVersion).filter(Boolean))].join(
        '；',
      ) || '未记录',
    ],
    ...Object.entries(REPORT_DEFINITIONS),
    ['缺失值', 'JSON 使用 null；CSV 和 Excel 使用 —，不将未知函数个数写成 0。'],
  ]
}

function csvCell(value: Cell): string {
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}

export function snapshotCsv(snapshot: Snapshot): string {
  const rows = [
    ...summaryRows(snapshot),
    [],
    ['文件明细'],
    ...fileRows(snapshot),
    [],
    ['统计说明'],
    ...metadataRows(snapshot),
  ]
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export async function snapshotXlsx(snapshot: Snapshot): Promise<ArrayBuffer> {
  // Loaded only on export so workbook code does not delay the initial page or scans.
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Code / Meter'
  for (const [name, rows] of [
    ['语言汇总', summaryRows(snapshot)],
    ['文件明细', fileRows(snapshot)],
    ['统计说明', metadataRows(snapshot)],
  ] as const) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.addRows(rows)
    sheet.getRow(1).font = { bold: true }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAE7DF' } }
    sheet.columns.forEach((column, index) => {
      column.width = name === '统计说明' && index === 1 ? 100 : index === 0 ? 36 : 16
      if (name === '语言汇总' && index >= 8) column.numFmt = '0.00'
    })
    if (name === '统计说明') sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
    else
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: rows.length, column: rows[0]!.length },
      }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer()).buffer
}
