import { expect, it } from 'vitest'
import { analyzeText, summarize, activityDays, type Snapshot } from '@/core'
import { buildReport } from '../report'

it('counts Python async functions, methods and nested definitions, excluding lambdas, comments and strings', () => {
  const file = analyzeText({
    path: 'a.py',
    text: [
      '# def fake(): pass',
      'text = "def fake(): pass"',
      'f = lambda x: x',
      'class A:',
      '    def method(self):',
      '        def inner():',
      '            pass',
      '        return inner()',
      '@decorator',
      'async def task():',
      '    pass',
    ].join('\n'),
  })
  expect(file.functionCount).toBe(3)
  expect(file.warnings).toEqual([])
})

it('counts C definitions while excluding prototypes, function pointers, calls and control blocks', () => {
  const file = analyzeText({
    path: 'a.c',
    text: [
      'int f(int x);',
      'int (*callback)(int);',
      '/* int fake() {} */',
      'int f(int x) { if(x) { return x; } return 0; }',
      'int main(void) { for(int i=0;i<3;i++) { f(i); } return 0; }',
    ].join('\n'),
  })
  expect(file.functionCount).toBe(2)
  expect(file.warnings).toEqual([])
})

it('counts C++ methods, constructors, destructors and operators without counting lambda expressions', () => {
  const file = analyzeText({
    path: 'a.cpp',
    text:
      'class A { public: A(){} ~A(){} int method(){return 1;} int operator()(int x){return x;} };\n' +
      'auto lambda = [](){ return 1; };\nint declared();\n',
  })
  expect(file.functionCount).toBe(4)
  expect(file.warnings).toEqual([])
})

it('retains line counts but leaves functions unavailable on parser recovery; empty source has zero functions', () => {
  const broken = analyzeText({ path: 'bad.py', text: 'def broken(:\n    pass\n' })
  expect(broken.status).toBe('ok')
  expect(broken.counts.code).toBe(2)
  expect(broken.functionCount).toBeNull()
  expect(broken.warnings.join()).toContain('函数个数暂不可用')
  expect(analyzeText({ path: 'empty.py', text: '' }).functionCount).toBe(0)
})

it('does not expand C preprocessor macros into invented function definitions', () => {
  const file = analyzeText({
    path: 'macro.c',
    text: '#define MAKE_FN(name) int name() { return 1; }\nMAKE_FN(generated)\n',
  })
  // A macro invocation is not a reliably parsed source-level function body.
  expect(file.functionCount === 0 || file.functionCount === null).toBe(true)
})

it('computes per-file distributions by language and recomputes the project distribution from all files', () => {
  const scan = summarize([
    analyzeText({ path: 'a.c', text: 'int a;\n' }),
    analyzeText({ path: 'b.c', text: 'int b;\n'.repeat(5) }),
    analyzeText({ path: 'c.py', text: 'def f():\n    pass\n' }),
    analyzeText({ path: 'unsupported.java', text: 'ignored' }),
  ])
  const report = buildReport(scan)
  expect(report.byLanguage.find((row) => row.language === 'C')).toEqual({
    language: 'C',
    sourceFiles: 2,
    codeLines: 6,
    blankLines: 0,
    commentLines: 0,
    functionCount: 0,
    maxCodeLines: 5,
    minCodeLines: 1,
    meanCodeLines: 3,
    medianCodeLines: 3,
  })
  expect(report.total.sourceFiles).toBe(3)
  expect(report.total.functionCount).toBe(1)
  expect(report.total.meanCodeLines).toBe(8 / 3)
  expect(report.total.medianCodeLines).toBe(2)
  expect(report.total.maxCodeLines).toBe(5)
})

it('includes empty files as distribution samples and keeps old snapshot function counts unknown', () => {
  const empty = analyzeText({ path: 'a.py', text: '' })
  const old = analyzeText({ path: 'b.py', text: 'print(1)\nprint(2)' })
  delete old.functionCount
  delete old.functionRuleVersion
  const report = buildReport(summarize([empty, old]))
  expect(report.total.sourceFiles).toBe(2)
  expect(report.total.functionCount).toBeNull()
  expect(report.total.minCodeLines).toBe(0)
  expect(report.total.medianCodeLines).toBe(1)
  expect(report.total.meanCodeLines).toBe(1)
  const noFiles = buildReport(summarize([])).total
  expect(noFiles.maxCodeLines).toBeNull()
  expect(noFiles.meanCodeLines).toBeNull()
})

function snapshot(code: number, time: string): Snapshot {
  return {
    ...summarize([analyzeText({ path: 'a.py', text: 'print(1)\n'.repeat(code) })]),
    id: time,
    projectId: 'p',
    projectName: 'p',
    scannedAt: time,
    timezone: 'Asia/Shanghai',
  }
}

it('sums repeated scans per day and uses only the selected range to determine the darkest shade', () => {
  const scans = [
    snapshot(100, '2026-10-10T10:00:00'),
    snapshot(120, '2026-10-10T18:00:00'),
    snapshot(880, '2026-10-11T10:00:00'),
    snapshot(9999, '2026-10-12T10:00:00'),
  ]
  const days = activityDays(scans, new Date('2026-10-10T00:00:00'), new Date('2026-10-12T00:00:00'))
  expect(days.map((day) => day.scannedCode)).toEqual([220, 880])
  expect(days.map((day) => day.count)).toEqual([2, 1])
  expect(days.map((day) => day.level)).toEqual([1, 4])
  const shorter = activityDays(
    scans,
    new Date('2026-10-10T00:00:00'),
    new Date('2026-10-11T00:00:00'),
  )
  expect(shorter[0]?.level).toBe(4)
})

it('handles no scans and all-zero code without division by zero', () => {
  const days = activityDays(
    [snapshot(0, '2026-10-10T10:00:00')],
    new Date('2026-10-10T00:00:00'),
    new Date('2026-10-12T00:00:00'),
  )
  expect(days.map((day) => [day.count, day.scannedCode, day.level])).toEqual([
    [1, 0, 0],
    [0, 0, 0],
  ])
})
