import type { Snapshot } from '@/core'

export type ExportKind = 'csv' | 'json' | 'xlsx'
export function startExport(snapshot: Snapshot, kind: ExportKind) {
  let worker: Worker | undefined
  let settled = false
  let cancelTask = () => {}
  const promise = new Promise<string | ArrayBuffer>((resolve, reject) => {
    const fail = (message: string) => {
      if (settled) return
      settled = true
      worker?.terminate()
      reject(new Error(message))
    }
    cancelTask = () => fail('导出已取消')
    try {
      worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (event) => {
        if (settled) return
        if (event.data?.type !== 'result') return fail(event.data?.message || '导出线程返回异常')
        settled = true
        worker?.terminate()
        resolve(event.data.content)
      }
      worker.onerror = (event) => fail('导出线程运行失败：' + (event.message || '请刷新后重试'))
      worker.onmessageerror = () => fail('导出文件传输失败，请重试。')
      worker.postMessage({ snapshot, kind })
    } catch (error) {
      fail('导出引擎启动失败：' + (error instanceof Error ? error.message : String(error)))
    }
  })
  return { promise, cancel: () => cancelTask() }
}
