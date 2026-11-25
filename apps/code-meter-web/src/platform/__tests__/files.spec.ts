import { it, expect, vi } from 'vitest'
import { LIMITS, prepareFiles, readSources } from '../files'
import { snapshotCsv } from '../storage'
import { summarize, analyzeText, type Snapshot } from '@/core'
function file(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.length,
    webkitRelativePath: '',
    arrayBuffer: async () => bytes.slice().buffer,
  } as File
}
it('rejects duplicate paths and invalid UTF-8 while retaining readable files', async () => {
  const files = [
    file('a.c', new TextEncoder().encode('int x;')),
    file('a.c', new TextEncoder().encode('int y;')),
    file('bad.c', new Uint8Array([0xff])),
  ]
  const result = await readSources(files, [])
  expect(result.sources).toHaveLength(1)
  expect(result.rejected).toHaveLength(2)
})
it('applies path exclusions', async () => {
  const f = {
    ...file('a.c', new TextEncoder().encode('int x;')),
    webkitRelativePath: 'project/node_modules/a.c',
  } as File
  const result = await readSources([f], ['node_modules'])
  expect(result.sources).toHaveLength(0)
  expect(result.rejected[0]?.status).toBe('skipped')
})
it('escapes formula prefixes and quoted paths in CSV', () => {
  const s: Snapshot = {
    ...summarize([analyzeText({ path: '=evil.c', text: 'int a;', language: 'c' })]),
    id: 's',
    projectId: 'p',
    projectName: '项目',
    scannedAt: '2026-10-14T00:00:00Z',
    timezone: 'UTC',
  }
  expect(snapshotCsv(s)).toContain('"\'=evil.c"')
  expect(snapshotCsv(s)).toContain('项目合计')
})

it('quota applies after directory exclusions', async () => {
  const excluded = {
    ...file('huge.js', new Uint8Array()),
    size: 100 * 1024 * 1024,
    webkitRelativePath: 'project/node_modules/huge.js',
  } as File
  const good = file('a.c', new TextEncoder().encode('int a;'))
  expect((await readSources([excluded, good], ['node_modules'])).sources).toHaveLength(1)
  const many = Array.from(
    { length: 2100 },
    (_, i) =>
      ({
        ...excluded,
        name: i + '.js',
        webkitRelativePath: 'project/node_modules/' + i + '.js',
      }) as File,
  )
  expect((await readSources([...many, good], ['node_modules'])).sources).toHaveLength(1)
})

it('reads a mixed upload with new languages and keeps unknown files explicitly skipped', async () => {
  const input = [
    ['A.java', 'int n = 1; // note'],
    ['module.mjs', 'const n = 1;'],
    ['types.d.ts', 'interface A { value: number }'],
    ['component.vue', '<template />'],
  ].map(([name, text]) => file(name!, new TextEncoder().encode(text!)))
  const prepared = await readSources(input, [])
  const result = summarize([...prepared.sources.map(analyzeText), ...prepared.rejected])
  expect(result.languages.map((language) => language.language)).toEqual([
    'java',
    'javascript',
    'typescript',
  ])
  expect(result.files.at(-1)?.status).toBe('skipped')
  expect(result.totals.code).toBe(3)
})

it('skips unsupported binaries before reading or any quota and counts unique candidates only', async () => {
  const unread = vi.fn(async () => {
    throw new Error('must not read')
  })
  const ignored = Array.from(
    { length: 5100 },
    (_, i) =>
      ({
        ...file(`${i}.so`, new Uint8Array()),
        size: LIMITS.maxTotalBytes + 1,
        arrayBuffer: unread,
      }) as File,
  )
  const good = file('a.c', new TextEncoder().encode('int x;'))
  const prepared = prepareFiles([...ignored, good, good], [])
  expect(prepared.candidates).toEqual([good])
  expect(prepared.totalBytes).toBe(good.size)
  const result = await readSources([...ignored, good, good], [])
  expect(unread).not.toHaveBeenCalled()
  expect(result.sources).toHaveLength(1)
  expect(result.rejected.filter((item) => item.status === 'skipped')).toHaveLength(5100)
  expect(result.rejected.at(-1)?.reason).toContain('相对路径重复')
})

it('accepts over 2000 stubs and enforces the new candidate count and byte limits before reading', async () => {
  const read = vi.fn(async () => new ArrayBuffer(0))
  const candidates = Array.from(
    { length: LIMITS.maxFiles },
    (_, i) =>
      ({
        ...file(`${i}.pyi`, new Uint8Array()),
        arrayBuffer: read,
      }) as File,
  )
  expect((await readSources(candidates, [])).sources).toHaveLength(LIMITS.maxFiles)
  read.mockClear()
  await expect(readSources([...candidates, file('extra.c', new Uint8Array())], [])).rejects.toThrow(
    '5000',
  )
  await expect(
    readSources([{ ...candidates[0], size: LIMITS.maxTotalBytes + 1 } as File], []),
  ).rejects.toThrow('40 MB')
  expect(read).not.toHaveBeenCalled()
  const tooLarge = { ...candidates[0], size: LIMITS.maxFileBytes + 1 } as File
  const result = await readSources([tooLarge], [])
  expect(result.rejected[0]?.reason).toContain('5 MB')
  expect(read).not.toHaveBeenCalled()
})

it('keeps UTF-8 strict by default and supports explicit mixed and GBK-only decoding', async () => {
  // GBK bytes for the comment 中文.
  const gbk = file('legacy.c', new Uint8Array([47, 47, 32, 0xd6, 0xd0, 0xce, 0xc4, 10]))
  const utf8 = file('utf8.py', new TextEncoder().encode('# 中文\nprint(1)'))
  const strict = await readSources([gbk, utf8], [])
  expect(strict.sources.map((item) => item.path)).toEqual(['utf8.py'])
  expect(strict.rejected[0]?.reason).toContain('UTF-8 优先，失败按 GBK')
  const mixed = await readSources([gbk, utf8], [], 'utf-8-gbk')
  expect(mixed.rejected).toEqual([])
  expect(mixed.sources[0]).toMatchObject({
    text: '// 中文\n',
    encoding: 'gbk',
  })
  expect(mixed.sources[1]).toMatchObject({
    text: '# 中文\nprint(1)',
    encoding: 'utf-8',
  })
  expect(analyzeText(mixed.sources[0]!).warnings.join('')).toContain('GBK')
  expect((await readSources([gbk], [], 'gbk')).sources[0]?.text).toBe('// 中文\n')
  const invalid = file('invalid.c', new Uint8Array([0xff]))
  expect((await readSources([invalid], [], 'utf-8-gbk')).rejected[0]?.reason).toContain('解码失败')
})

it('distinguishes read failures and binary content from encoding errors', async () => {
  const binary = file('binary.c', new Uint8Array([0xff, 0, 0xff]))
  const broken = {
    ...file('missing.py', new Uint8Array()),
    arrayBuffer: async () => {
      throw new Error('gone')
    },
  } as File
  const result = await readSources([binary, broken], [], 'utf-8-gbk')
  expect(result.sources).toEqual([])
  expect(result.rejected[0]?.reason).toContain('二进制空字符')
  expect(result.rejected[0]?.reason).not.toContain('解码失败')
  expect(result.rejected[1]?.reason).toContain('文件读取失败')
})

it('reports candidate reading progress including failures, without counting skipped files', async () => {
  const progress = vi.fn()
  const input = [
    file('a.py', new TextEncoder().encode('x = 1')),
    file('bad.c', new Uint8Array([0xff])),
    file('native.so', new Uint8Array([0])),
  ]
  await readSources(input, [], 'utf-8', { onProgress: progress })
  expect(progress.mock.calls.map(([value]) => value)).toEqual([
    { done: 0, total: 2, path: '' },
    { done: 0, total: 2, path: 'a.py' },
    { done: 1, total: 2, path: 'a.py' },
    { done: 1, total: 2, path: 'bad.c' },
    { done: 2, total: 2, path: 'bad.c' },
  ])
})

it('cancels a pending read promptly, does not read the next file or accept late data', async () => {
  const controller = new AbortController()
  let complete!: (bytes: ArrayBuffer) => void
  const next = vi.fn(async () => new ArrayBuffer(0))
  const progress = vi.fn()
  const first = {
    ...file('pending.py', new Uint8Array()),
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        complete = resolve
      }),
  } as File
  const task = readSources(
    [first, { ...file('next.py', new Uint8Array()), arrayBuffer: next } as File],
    [],
    'utf-8',
    { signal: controller.signal, onProgress: progress },
  )
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  const failure = task.catch((error: unknown) => error)
  controller.abort()
  await expect(failure).resolves.toMatchObject({ name: 'AbortError' })
  const calls = progress.mock.calls.length
  complete(new ArrayBuffer(0))
  await Promise.resolve()
  expect(next).not.toHaveBeenCalled()
  expect(progress).toHaveBeenCalledTimes(calls)
})

it('uses an abortable native FileReader and reads a near-limit source', async () => {
  const text = '# ' + 'a'.repeat(LIMITS.maxFileBytes - 2)
  const native = new File([text], 'large.pyi')
  const result = await readSources([native], [])
  expect(result.sources[0]?.text.length).toBe(LIMITS.maxFileBytes)
  const controller = new AbortController()
  const abort = vi.spyOn(FileReader.prototype, 'abort')
  const pending = readSources([native], [], 'utf-8', { signal: controller.signal })
  const failure = pending.catch((error: unknown) => error)
  controller.abort()
  await expect(failure).resolves.toMatchObject({ name: 'AbortError' })
  expect(abort).toHaveBeenCalledOnce()
  abort.mockRestore()
})
