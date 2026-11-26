import type { Snapshot } from '@/core'
import { buildReport, REPORT_COLUMNS, REPORT_COLUMNS_FUNCTIONS } from '@/core/report'

export const REPORT_DEFINITIONS = {
  sourceFiles: '仅包含本次快照中成功统计的源文件；空文件也参与文件数与分布统计。',
  pythonStubs:
    'physical-lines-1.2 起，.pyi 单列为 Python 类型声明，不并入 .py/.pyw 的 Python 汇总，默认计入项目总量。旧快照保留原始范围和数值。',
  codeLines: '有效物理代码行；混合行包含在代码行中。',
  commentLines: '纯注释行，不重复计入混合行。',
  distribution:
    '按文件的最大值、最小值、均值和中位数以每个成功源文件的有效代码行数为样本；项目合计按全部成功文件重新计算。按函数的分布以各函数体的有效代码行数为样本，不含空行与纯注释行；旧快照未记录尺寸时不补算。',
  functions:
    'C/C++/Python(.py/.pyw)/Java 按源文本中的具名函数定义计数：含方法、嵌套函数、匿名内部类中的方法，以及有函数体的构造/析构函数和运算符重载；不计只有声明没有函数体的方法、函数调用、宏定义与 lambda（lambda 的代码行并入外层函数）。函数行数为函数体内的有效代码行，不含空行与纯注释行。解析存在未识别内容时仍按可识别范围计数并标注不完整，可能偏少。Python 类型声明（.pyi）、JavaScript/TypeScript 不提供函数统计；未支持或旧快照未记录时为 null。',
  dailyActivity:
    '每天累计每次成功保存扫描的有效代码行；重复扫描累计。按所选区间的最高日合计归一化，不代表新增代码或开发工作量。',
}

export function snapshotReport(snapshot: Snapshot) {
  return {
    schemaVersion: 3,
    snapshot: {
      ...snapshot,
      files: snapshot.files.map(({ functionLineSizes, ...file }) => ({
        ...file,
        functionCount: file.functionCount ?? null,
      })),
    },
    summary: buildReport(snapshot),
    definitions: REPORT_DEFINITIONS,
  }
}

export function snapshotJson(snapshot: Snapshot): string {
  return JSON.stringify(snapshotReport(snapshot), null, 2)
}

type Cell = string | number
export function summaryRows(snapshot: Snapshot, mode: 'file' | 'function'): Cell[][] {
  const report = buildReport(snapshot)
  const columns = [
    ...REPORT_COLUMNS.slice(0, 6),
    ...(mode === 'file' ? REPORT_COLUMNS.slice(6) : REPORT_COLUMNS_FUNCTIONS),
  ]
  return [
    columns.map((column) => column.label),
    ...[...report.byLanguage, report.total].map((row) =>
      columns.map((column) => row[column.key] ?? '—'),
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
    ['报表版本', 3],
    [
      '版本变更',
      '版本 3：恢复四语言函数统计，增加按函数分布；CSV／Excel 同时输出两套分布，JSON 文件明细省略函数尺寸数组，汇总保留函数指标；旧快照不重算。',
    ],
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
    ...summaryBlocks(snapshot),
    [],
    ['文件明细'],
    ...fileRows(snapshot),
    [],
    ['统计说明'],
    ...metadataRows(snapshot),
  ]
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function summaryBlocks(snapshot: Snapshot): Cell[][] {
  return [
    ['语言汇总（按文件）'],
    ...summaryRows(snapshot, 'file'),
    [],
    ['语言汇总（按函数）'],
    ...summaryRows(snapshot, 'function'),
  ]
}

export async function snapshotXlsx(snapshot: Snapshot): Promise<ArrayBuffer> {
  // Loaded only on export so workbook code does not delay the initial page or scans.
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Code / Meter'
  for (const [name, rows] of [
    ['语言汇总', summaryBlocks(snapshot)],
    ['文件明细', fileRows(snapshot)],
    ['统计说明', metadataRows(snapshot)],
  ] as const) {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: name === '语言汇总' ? 2 : 1 }],
    })
    sheet.addRows(rows)
    rows.forEach((row, index) => {
      if (index !== 0 && !(name === '语言汇总' && (row.length === 1 || row[0] === '语言'))) return
      sheet.getRow(index + 1).font = { bold: true }
      sheet.getRow(index + 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEAE7DF' },
      }
    })
    sheet.columns.forEach((column, index) => {
      column.width = name === '统计说明' && index === 1 ? 100 : index === 0 ? 36 : 16
      if (name === '语言汇总' && (index === 8 || index === 9)) column.numFmt = '0.00'
    })
    if (name === '统计说明') sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
    else if (name !== '语言汇总')
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: rows.length, column: rows[0]!.length },
      }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer()).buffer
}
