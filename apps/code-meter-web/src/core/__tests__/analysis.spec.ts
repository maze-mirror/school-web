import { describe, it, expect } from 'vitest'
import {
  analyzeText,
  summarize,
  compareSnapshots,
  activityDays,
  periodSnapshots,
  localDateKey,
  type Snapshot,
} from '../index'
function scan(text: string, language: 'c' | 'cpp' | 'python' = 'c') {
  return analyzeText({ path: 'test', text, language }).counts
}
function snapshot(code: number, when = '2026-10-14T10:00:00+08:00'): Snapshot {
  return {
    ...summarize([analyzeText({ path: 'a.c', text: 'int a;\n'.repeat(code) })]),
    id: when,
    projectId: 'p',
    projectName: '项目',
    scannedAt: when,
    timezone: 'Asia/Shanghai',
  }
}
describe('physical-line boundaries', () => {
  it('empty, final newline and blank physical lines', () => {
    expect(scan('').total).toBe(0)
    expect(scan('\n')).toEqual({ total: 1, blank: 1, commentOnly: 0, code: 0, mixed: 0 })
    expect(scan('a\n').total).toBe(1)
    expect(scan('a').total).toBe(1)
    expect(scan('a\n\n').blank).toBe(1)
  })
  it.each(['\n', '\r\n', '\r'])('normalizes %j', (nl) =>
    expect(scan(['int a;', '', '// note'].join(nl))).toEqual({
      total: 3,
      blank: 1,
      commentOnly: 1,
      code: 1,
      mixed: 0,
    }),
  )
  it('classifies block internal blanks and mixed closing line', () =>
    expect(scan('/* note\n\n*/ int a; // last\n')).toEqual({
      total: 3,
      blank: 0,
      commentOnly: 2,
      code: 1,
      mixed: 1,
    }))
  it('keeps markers and escaped quotes in C strings', () =>
    expect(scan('char *a = "// /* not comment */";\nchar *b = "\\\" //"; // yes')).toEqual({
      total: 2,
      blank: 0,
      commentOnly: 0,
      code: 2,
      mixed: 1,
    }))
  it('keeps hash and triple strings in Python', () =>
    expect(scan('# note\nx = "# text"\n\n"""doc\n\nend"""\nprint(x) # note\n', 'python')).toEqual({
      total: 7,
      blank: 1,
      commentOnly: 1,
      code: 5,
      mixed: 1,
    }))
  it('supports prefixed Python strings', () =>
    expect(scan("path = r'# literal'\nname = f'hello {42}' # note", 'python').mixed).toBe(1))
  it('supports C++ raw strings and numeric separators', () => {
    expect(scan('auto x = u8R"tag(// text\n\n/* text */)tag"; // note', 'cpp')).toEqual({
      total: 3,
      blank: 0,
      commentOnly: 0,
      code: 3,
      mixed: 1,
    })
    expect(analyzeText({ path: 'a.cpp', text: "auto n = 1'000; // note" }).warnings).toEqual([])
  })
  it('supports continuation of C line comments', () =>
    expect(scan('// note \\\ncontinued\nint x;')).toEqual({
      total: 3,
      blank: 0,
      commentOnly: 2,
      code: 1,
      mixed: 0,
    }))
  it('reports unclosed strings and blocks', () => {
    expect(analyzeText({ path: 'a.c', text: '/* unfinished' }).warnings.length).toBeGreaterThan(0)
    expect(analyzeText({ path: 'a.py', text: '"""unfinished' }).warnings.length).toBeGreaterThan(0)
  })
  it('unknown and binary files do not fabricate counts', () => {
    expect(analyzeText({ path: 'a.rs', text: 'fn main() {}' }).status).toBe('skipped')
    expect(analyzeText({ path: 'a.c', text: 'a\0b' }).status).toBe('error')
  })
  it('aggregates only successful files and preserves the partition', () => {
    const result = summarize([
      analyzeText({ path: 'a.c', text: 'int a; // x\n\n// x' }),
      analyzeText({ path: 'b.py', text: 'print(1)\n# x' }),
      analyzeText({ path: 'x.txt', text: 'ignored' }),
    ])
    expect(result.totals).toEqual({ total: 5, blank: 1, commentOnly: 2, code: 2, mixed: 1 })
    expect(result.languages.reduce((sum, l) => sum + l.counts.code, 0)).toBe(result.totals.code)
  })
})
describe('snapshot and real activity', () => {
  it('returns positive, negative and zero scale differences', () => {
    expect(compareSnapshots(snapshot(2), snapshot(5)).value).toBe(3)
    expect(compareSnapshots(snapshot(5), snapshot(2)).value).toBe(-3)
    expect(compareSnapshots(snapshot(2), snapshot(2)).value).toBe(0)
  })
  it('requires baseline and compatible project/config/rules', () => {
    expect(compareSnapshots(undefined, snapshot(3)).value).toBeNull()
    for (const changed of [
      { projectId: 'other' },
      { configKey: 'different' },
      { ruleVersion: 'different' },
    ])
      expect(compareSnapshots(snapshot(2), { ...snapshot(3), ...changed }).value).toBeNull()
  })
  it('uses actual latest snapshot rather than sum; start inclusive/end exclusive', () => {
    const a = snapshot(3, '2026-10-01T12:00:00'),
      b = snapshot(5, '2026-10-10T00:00:00'),
      c = snapshot(7, '2026-10-15T00:00:00')
    const data = periodSnapshots(
      [a, b, c],
      'p',
      new Date('2026-10-10T00:00:00'),
      new Date('2026-10-15T00:00:00'),
    )
    expect(data.within).toHaveLength(1)
    expect(data.last?.totals.code).toBe(5)
    expect(data.comparison.value).toBe(2)
  })
  it('keeps latest snapshot on a range with no new scans', () => {
    const data = periodSnapshots(
      [snapshot(3, '2026-10-01T12:00:00')],
      'p',
      new Date('2026-10-10T00:00:00'),
      new Date('2026-10-15T00:00:00'),
    )
    expect(data.within).toHaveLength(0)
    expect(data.last?.totals.code).toBe(3)
    expect(data.comparison.value).toBe(0)
  })
  it('counts real scans with five levels and zero days', () => {
    const samples = [1, 2, 4, 7].flatMap((count, i) =>
      Array.from({ length: count }, (_, j) =>
        snapshot(
          1,
          `2026-10-${String(i + 10).padStart(2, '0')}T12:${String(j).padStart(2, '0')}:00`,
        ),
      ),
    )
    const days = activityDays(
      samples,
      new Date('2026-10-10T00:00:00'),
      new Date('2026-10-15T00:00:00'),
    )
    expect(days.map((d) => d.count)).toEqual([1, 2, 4, 7, 0])
    expect(days.map((d) => d.level)).toEqual([1, 2, 3, 4, 0])
    expect(localDateKey(new Date('2026-10-14T00:00:00'))).toBe('2026-10-14')
  })
})

it.each(['a', '0'])('UTF-8 character literal %s is not a digit separator', (char) => {
  const result = analyzeText({
    path: 'a.cpp',
    text: "auto c = u8'" + char + "'; /* comment\n\n*/\n",
  })
  expect(result.counts).toEqual({ total: 3, blank: 0, commentOnly: 2, code: 1, mixed: 1 })
  expect(result.warnings).toEqual([])
})

it.each(["0xAB.CD'EFp0", "0xA.Bp1'0"])(
  'hexadecimal floating separators remain code: %s',
  (number) => {
    const result = analyzeText({
      path: 'a.cpp',
      text: 'auto n = ' + number + '; /* comment\n\n*/\n',
    })
    expect(result.counts).toEqual({ total: 3, blank: 0, commentOnly: 2, code: 1, mixed: 1 })
    expect(result.warnings).toEqual([])
  },
)
