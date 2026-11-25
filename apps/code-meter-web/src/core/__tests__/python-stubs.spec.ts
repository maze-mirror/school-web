import { expect, it } from 'vitest'
import { analyzeText, compareSnapshots, detectLanguage, summarize, type Snapshot } from '../index'
import { dailyComposition } from '../composition'

it('classifies stubs with Python line rules while keeping implementation and functions separate', () => {
  expect(detectLanguage('types.PYI')).toBe('python-stub')
  expect(detectLanguage('pyi')).toBeNull()
  expect(detectLanguage('dir.pyi/README')).toBeNull()
  const stub = analyzeText({
    path: 'types.pyi',
    text: '# types\n\nx: str # field\n"""doc\n\nend"""\ndef f() -> None: ...\n',
  })
  expect(stub.counts).toEqual({
    total: 7,
    code: 5,
    commentOnly: 1,
    blank: 1,
    mixed: 1,
  })
  expect(stub.functionCount).toBeUndefined()
  expect(stub.functionRuleVersion).toBeUndefined()
  const result = summarize([stub, analyzeText({ path: 'main.py', text: 'def f(): pass' })])
  expect(result.totals.code).toBe(6)
  expect(result.languages.find((item) => item.language === 'python')?.counts.code).toBe(1)
  expect(result.languages.find((item) => item.language === 'python-stub')?.name).toBe(
    'Python 类型声明',
  )
})

it('preserves old history and accumulates stubs separately in daily composition', () => {
  const current: Snapshot = {
    ...summarize([analyzeText({ path: 'types.pyi', text: 'x: int' })]),
    id: 'new',
    projectId: 'p',
    projectName: 'p',
    scannedAt: '2026-11-04T08:00:00Z',
    timezone: 'Asia/Shanghai',
  }
  const old: Snapshot = {
    ...current,
    ...summarize([analyzeText({ path: 'a.py', text: 'x = 1' })]),
    id: 'old',
    ruleVersion: 'physical-lines-1.1',
  }
  const original = JSON.stringify(old)
  expect(compareSnapshots(old, current).value).toBeNull()
  const day = dailyComposition([old, current], '2026-11-04')
  expect(day.code).toBe(2)
  expect(day.languages.map((item) => item.language)).toEqual(['python', 'python-stub'])
  expect(JSON.stringify(old)).toBe(original)
})
