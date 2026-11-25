import { expect, it } from 'vitest'
import { analyzeText, detectLanguage, summarize, compareSnapshots, type Snapshot } from '../index'
import { buildReport } from '../report'

it.each([
  ['Main.JAVA', 'java'],
  ['main.js', 'javascript'],
  ['main.mjs', 'javascript'],
  ['main.cjs', 'javascript'],
  ['main.ts', 'typescript'],
  ['types.d.ts', 'typescript'],
  ['main.mts', 'typescript'],
  ['main.cts', 'typescript'],
])('recognizes %s as %s', (path, language) => {
  expect(detectLanguage(path)).toBe(language)
  const result = analyzeText({ path, text: '' })
  expect(result.status).toBe('ok')
  expect(result.counts.total).toBe(0)
  expect(result.functionCount).toBeNull()
})

it.each(['java', 'javascript', 'typescript'])('keeps physical boundaries for %s', (language) => {
  const code = language === 'java' ? 'int n = 1;' : 'const n = 1;'
  for (const newline of ['\n', '\r\n', '\r']) {
    const result = analyzeText({
      path: 'snippet',
      language,
      text: [code, '// note', ''].join(newline) + newline,
    })
    expect(result.counts).toEqual({ total: 3, code: 1, commentOnly: 1, blank: 1, mixed: 0 })
    expect(result.warnings).toEqual([])
  }
})

it('counts Java statements and braces as physical lines, with mixed lines counted only once', () => {
  const result = analyzeText({
    path: 'A.java',
    text: 'int a = 1; int b = 2; // init\n// note\n\nif (a > 0) {\n b++;\n}\n',
  })
  expect(result.counts).toEqual({ total: 6, code: 4, commentOnly: 1, blank: 1, mixed: 1 })
  expect(result.warnings).toEqual([])
})

it('keeps all Java text-block lines as code but all Javadoc lines as comments', () => {
  const text = analyzeText({
    path: 'A.java',
    text: 'String s = """\nhello\n// text\n\nworld\n"""; // real',
  })
  expect(text.counts).toEqual({ total: 6, code: 6, commentOnly: 0, blank: 0, mixed: 1 })
  expect(text.warnings).toEqual([])
  const doc = analyzeText({ path: 'A.java', text: '/**\n * note\n\n */\nint n = 1;' })
  expect(doc.counts).toEqual({ total: 5, code: 1, commentOnly: 4, blank: 0, mixed: 0 })
})

it('keeps escaped triple quotes inside Java text blocks and does not continue line comments', () => {
  const result = analyzeText({
    path: 'A.java',
    text: [
      'String s = """',
      'hello\\"""world',
      '',
      '// printed',
      '"""; // real',
      '// no continuation \\',
      'int n = 1;',
    ].join('\n'),
  })
  expect(result.counts).toEqual({ total: 7, code: 6, commentOnly: 1, blank: 0, mixed: 1 })
  expect(result.warnings).toEqual([])
})

it('handles Java Unicode escapes before classification while preserving original physical lines', () => {
  expect(analyzeText({ path: 'A.java', text: String.raw`\u002f\u002f comment` }).counts).toEqual({
    total: 1,
    code: 0,
    commentOnly: 1,
    blank: 0,
    mixed: 0,
  })
  expect(analyzeText({ path: 'A.java', text: String.raw`// note\u000a int x;` }).counts).toEqual({
    total: 1,
    code: 1,
    commentOnly: 0,
    blank: 0,
    mixed: 1,
  })
  const literal = analyzeText({
    path: 'A.java',
    text: String.raw`String s = "\\u002f\\u002f"; // real`,
  })
  expect(literal.counts).toEqual({ total: 1, code: 1, commentOnly: 0, blank: 0, mixed: 1 })
  expect(literal.warnings).toEqual([])
})

it('distinguishes JavaScript template text from interpolated code, including nested templates', () => {
  const text = [
    'const s = `outer',
    '// text',
    '${(',
    '  // real',
    '',
    '  `inner',
    '',
    '  ${name}`',
    ')}',
    'end`;',
  ].join('\n')
  const result = analyzeText({ path: 'a.js', text })
  expect(result.counts).toEqual({ total: 10, code: 8, commentOnly: 1, blank: 1, mixed: 0 })
  expect(result.warnings).toEqual([])
  const discussed = analyzeText({
    path: 'a.js',
    text: 'const message = `hello ${\n // name\n userName\n}`;',
  })
  expect(discussed.counts).toEqual({ total: 4, code: 3, commentOnly: 1, blank: 0, mixed: 0 })
})

it('does not confuse JavaScript regexes, division, quoted markers or line-comment backslashes', () => {
  const result = analyzeText({
    path: 'a.mjs',
    text: [
      'const pattern = /[/*]/; // real',
      'const n = 12 / 2; /* real */',
      'const text = "// /* text */";',
      '// no continuation \\',
      'const after = 1;',
    ].join('\n'),
  })
  expect(result.counts).toEqual({ total: 5, code: 4, commentOnly: 1, blank: 0, mixed: 2 })
  expect(result.warnings).toEqual([])
})

it('recognizes a JavaScript hashbang without treating private class members as Python comments', () => {
  const result = analyzeText({
    path: 'a.cjs',
    text: '#!/usr/bin/env node\nclass A {\n #value = 1;\n}',
  })
  expect(result.counts).toEqual({ total: 4, code: 3, commentOnly: 1, blank: 0, mixed: 0 })
  expect(result.warnings).toEqual([])
})

it('counts TypeScript type declarations and multiline template types as source code', () => {
  const result = analyzeText({
    path: 'a.ts',
    text: 'interface User {\n name: string; // field\n}\ntype Id = string | number;',
  })
  expect(result.counts).toEqual({ total: 4, code: 4, commentOnly: 0, blank: 0, mixed: 1 })
  expect(result.warnings).toEqual([])
  const template = analyzeText({ path: 'a.ts', text: 'type Label = `hello\n\n${"a" | "b"}`;' })
  expect(template.counts).toEqual({ total: 3, code: 3, commentOnly: 0, blank: 0, mixed: 0 })
  expect(template.warnings).toEqual([])
})

it.each(['java', 'javascript', 'typescript'])(
  'warns on incomplete %s and keeps the line partition',
  (language) => {
    const result = analyzeText({
      path: 'snippet',
      language,
      text: '/* unfinished\n\nstill comment',
    })
    expect(result.counts).toEqual({ total: 3, code: 0, commentOnly: 3, blank: 0, mixed: 0 })
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(analyzeText({ path: 'snippet', language, text: 'bad\0bytes' }).status).toBe('error')
  },
)

it('aggregates all six languages, leaves unsupported functions unknown and separates old rules', () => {
  const result = summarize(
    [
      ['a.c', 'int n;'],
      ['a.cpp', 'int n;'],
      ['a.py', 'n = 1'],
      ['A.java', 'int n;'],
      ['a.js', 'const n = 1;'],
      ['a.ts', 'const n: number = 1;'],
    ].map(([path, text]) => analyzeText({ path: path!, text: text! })),
  )
  expect(result.languages).toHaveLength(6)
  expect(result.totals).toEqual({ total: 6, code: 6, commentOnly: 0, blank: 0, mixed: 0 })
  const report = buildReport(result)
  expect(report.total.sourceFiles).toBe(6)
  expect(report.total.functionCount).toBeNull()
  expect(report.byLanguage.find((row) => row.language === 'Java')?.functionCount).toBeNull()
  expect(report.byLanguage.find((row) => row.language === 'C')?.functionCount).toBe(0)
  const end: Snapshot = {
    ...result,
    id: 'new',
    projectId: 'p',
    projectName: 'P',
    scannedAt: new Date().toISOString(),
    timezone: 'UTC',
  }
  expect(
    compareSnapshots({ ...end, id: 'old', ruleVersion: 'physical-lines-1.0' }, end).value,
  ).toBeNull()
  expect(analyzeText({ path: 'a.vue', text: '<template />' }).status).toBe('skipped')
  expect(analyzeText({ path: 'a.tsx', text: '<div />' }).status).toBe('skipped')
})

it('locates H002 recovery without changing the line counts or declaring source errors', () => {
  const text = '// test\r\nconst flags: number[] = [0]\r\n\r\nflags[0]! |= 1\r\n'
  const result = analyzeText({ path: 'h002.ts', text })
  const control = analyzeText({
    path: 'control.ts',
    text: text.replace('flags[0]! |= 1', 'flags[0] = (flags[0] ?? 0) | 1'),
  })
  expect(result.counts).toEqual(control.counts)
  expect(result.warnings.join('')).toContain('第 4 行第')
  expect(result.warnings.join('')).toContain('不能据此判定源码错误')
  expect(result.warnings.join('')).toContain('行分类是否受影响尚未确认')
  expect(control.warnings).toEqual([])
})

it('reports Java source coordinates through Unicode escape translation', () => {
  const text = '\\u002f\\u002a unfinished\r\ncomment'
  const result = analyzeText({ path: 'Broken.java', text })
  expect(result.warnings.join('')).toContain('第 1 行第 1 列')
  expect(result.warnings.join('')).toContain('块注释未找到结束标记')
  expect(result.counts.commentOnly).toBe(2)
  expect(analyzeText({ path: 'Bad.java', text: 'int x;\n\\uQQQQ' }).warnings.join('')).toContain(
    '第 2 行第 1 列',
  )
})

it('caps parser recovery messages for a large malformed source', () => {
  const result = analyzeText({ path: 'bad.ts', text: 'flags[0]! |= 1\n'.repeat(100) })
  expect(result.warnings.length).toBeLessThanOrEqual(6)
  expect(result.warnings.at(-1)).toContain('仅列出前 5 处')
})
