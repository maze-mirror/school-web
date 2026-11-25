import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startScan } from '../scanner'
import { summarize } from '@/core'
class MockWorker {
  static last: MockWorker
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string; filename: string; lineno: number }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() {
    MockWorker.last = this
  }
}
beforeEach(() => vi.stubGlobal('Worker', MockWorker))
afterEach(() => vi.unstubAllGlobals())
it('preserves worker error details and releases failed worker', async () => {
  const task = startScan([], [], 'test', vi.fn())
  const failure = task.promise.catch((error: unknown) => error)
  MockWorker.last.onerror!({
    message: 'Failed to fetch module',
    filename: '/scan.worker.ts',
    lineno: 2,
  })
  await expect(failure).resolves.toMatchObject({
    message: expect.stringContaining('Failed to fetch module'),
  })
  expect(MockWorker.last.terminate).toHaveBeenCalledOnce()
})
it('catches startup failures through the task promise', async () => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('Blocked by policy')
      }
    },
  )
  await expect(startScan([], [], 'test', vi.fn()).promise).rejects.toThrow('Blocked by policy')
})
it('handles result deserialization failure', async () => {
  const task = startScan([], [], 'test', vi.fn())
  const failure = task.promise.catch((error: unknown) => error)
  MockWorker.last.onmessageerror!()
  await expect(failure).resolves.toMatchObject({
    message: expect.stringContaining('统计结果传输失败'),
  })
  expect(MockWorker.last.terminate).toHaveBeenCalledOnce()
})
it('reports progress and terminates exactly once after success', async () => {
  const progress = vi.fn()
  const task = startScan([], [], 'test', progress)
  MockWorker.last.onmessage!({ data: { type: 'progress', done: 2, total: 2, path: 'b.py' } })
  const result = summarize([])
  MockWorker.last.onmessage!({ data: { type: 'result', result } })
  await expect(task.promise).resolves.toEqual(result)
  task.cancel()
  expect(progress).toHaveBeenCalledWith(2, 2, 'b.py')
  expect(MockWorker.last.terminate).toHaveBeenCalledOnce()
})
it('cancels and ignores late messages', async () => {
  const progress = vi.fn()
  const task = startScan([], [], 'test', progress)
  const failure = task.promise.catch((error: unknown) => error)
  task.cancel()
  MockWorker.last.onmessage!({ data: { type: 'progress', done: 1, total: 2 } })
  await expect(failure).resolves.toMatchObject({ message: expect.stringContaining('统计已取消') })
  expect(progress).not.toHaveBeenCalled()
})
