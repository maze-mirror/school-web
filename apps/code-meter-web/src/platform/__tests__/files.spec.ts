import { it, expect } from 'vitest'
import { readSources } from '../files'
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
