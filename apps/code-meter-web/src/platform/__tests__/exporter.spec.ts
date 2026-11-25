import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startExport } from '../exporter'
import { summarize, type Snapshot } from '@/core'

class ExportWorker {
  static last: ExportWorker
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() {
    ExportWorker.last = this
  }
}
const snapshot: Snapshot = {
  ...summarize([]),
  id: 's',
  projectId: 'p',
  projectName: 'p',
  scannedAt: '2026-11-04T08:00:00Z',
  timezone: 'Asia/Shanghai',
}
beforeEach(() => vi.stubGlobal('Worker', ExportWorker))
afterEach(() => vi.unstubAllGlobals())

it('generates in a worker with the captured snapshot and releases it after completion', async () => {
  const task = startExport(snapshot, 'json')
  expect(ExportWorker.last.postMessage).toHaveBeenCalledWith({ snapshot, kind: 'json' })
  ExportWorker.last.onmessage!({ data: { type: 'result', content: 'report' } })
  await expect(task.promise).resolves.toBe('report')
  task.cancel()
  expect(ExportWorker.last.terminate).toHaveBeenCalledOnce()
})
it('rejects failures and cancelled work without accepting a late result', async () => {
  const task = startExport(snapshot, 'xlsx')
  const failure = task.promise.catch((error: unknown) => error)
  task.cancel()
  ExportWorker.last.onmessage!({ data: { type: 'result', content: new ArrayBuffer(0) } })
  await expect(failure).resolves.toMatchObject({ message: expect.stringContaining('导出已取消') })
  expect(ExportWorker.last.terminate).toHaveBeenCalledOnce()
  const broken = startExport(snapshot, 'csv')
  const error = broken.promise.catch((error: unknown) => error)
  ExportWorker.last.onmessage!({ data: { type: 'error', message: 'workbook unavailable' } })
  await expect(error).resolves.toMatchObject({
    message: expect.stringContaining('workbook unavailable'),
  })
})
it('reports startup and transfer failures', async () => {
  const task = startExport(snapshot, 'json')
  const failure = task.promise.catch((error: unknown) => error)
  ExportWorker.last.onmessageerror!()
  await expect(failure).resolves.toMatchObject({
    message: expect.stringContaining('导出文件传输失败'),
  })
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('blocked')
      }
    },
  )
  await expect(startExport(snapshot, 'csv').promise).rejects.toThrow('blocked')
})
